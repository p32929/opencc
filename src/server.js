import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { config, getConfig, isConfigured, displayName } from "./config.js";
import { pickModels, toOpenAIRequest, toAnthropicResponse, toAnthropicError } from "./translate.js";
import { streamOpenAIToAnthropic, sendAnthropicAsStream } from "./stream.js";
import { requirementsOf, describeNeeds, kindOf, chooseOrder, record, coolOff, cooledOffSuccessfully, verdictFor, isTooBig, TOO_BIG_VERDICT, STREAM_DIED_VERDICT } from "./stats.js";

const MAX_BODY_BYTES = 25 * 1024 * 1024;

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("Request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });

    req.on("error", reject);
  });
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(body);
}

// Walks every provider/model pair in priority order until one accepts the
// request: each provider's models are tried left to right before moving to the
// next provider, so a provider that works stays in use even if its preferred
// model is rate-limited. A pair that's exhausted, down, or unrecognised is
// skipped; the last error is reported if every pair fails.
//
// Note this can only fail over on the *response status*, which arrives
// before any bytes are written to the client. Once a stream has started
// there's no way to retract it, so a mid-stream failure is still fatal.
// 5xx is the provider breaking, which is worth one more try on the same model.
// Anything in the 4xx range is a decision about this request — wrong model,
// no quota, bad shape — and asking the same model again cannot change it, so
// the walk moves on instead.
const RETRY_DELAY_MS = 400;

// Per attempt, and for the whole walk. The deadline is what actually prevents
// a hang — without it a bad run could work through every model before
// answering — so the per-attempt timeout can afford to be generous. It needs
// to be: a request carrying a large tool set runs to several minutes on some
// backends, and cutting those off fails requests that would have succeeded.
const UPSTREAM_TIMEOUT_MS = 300000;
const TOTAL_DEADLINE_MS = 600000;

// With less than this left on the deadline there is no point starting another
// attempt: the slowest working models here answer in a minute, so a few
// seconds of runway only produces an abort. It used to start them anyway —
// with a one-second floor on the timeout — which recorded a failure against
// every model at the tail of a slow walk and taught the router to avoid
// models that had never actually been asked.
const MIN_ATTEMPT_MS = 20000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function callUpstream(
  anthropicReq,
  providers = config.providers,
  streaming = config.streaming,
  // Injectable so a caller can run without touching the stats file at all —
  // it is shared mutable state on disk, which otherwise makes this function's
  // behaviour depend on every request that came before it. `order` is here so
  // a test can pin the draw that would otherwise be random.
  stats = { order: chooseOrder, record, coolOff, settled: cooledOffSuccessfully },
  // Serialising a request is not free - a big one runs to most of a
  // millisecond - and the caller has usually measured it already.
  chars = JSON.stringify(anthropicReq).length,
) {
  const failures = [];
  const deadline = Date.now() + TOTAL_DEADLINE_MS;
  let lastStatus = 502;
  let headStatus = 0;
  let headMs = 0;

  // Flattened up front so the log can show "attempt 3/7" rather than a
  // provider index that says nothing about how much runway is left.
  const candidates = providers
    .filter((provider) => !provider.disabled)
    .flatMap((provider) =>
      pickModels(anthropicReq.model, provider).map((model) => ({ provider, model })),
    );

  if (candidates.length === 0) {
    return {
      status: 503,
      message: `No provider is available: all ${providers.length} are disabled. Run "opencc init" to enable one.`,
    };
  }

  // Every model is a candidate for every request. Which one goes first is
  // drawn from what each has actually done with this kind of request before,
  // so a model that cannot call tools sinks for tool requests without anyone
  // having to test it, and keeps its place for plain text.
  //
  // The draw is random, weighted by the record. Two identical requests a
  // second apart will not necessarily pick the same model, which is the
  // point: it spreads load over everything that works and keeps re-checking
  // the ones that did not.
  const needs = requirementsOf(anthropicReq);
  const kind = kindOf(needs);
  // The size decides whether a model can take this at all, so it goes into
  // the ordering as well as into the record.
  const ordered = stats.order(candidates, kind, { chars });

  console.log(
    `[opencc]   ${candidates.length} model(s) for ${describeNeeds(needs)}` +
      (ordered.cooling ? `, ${ordered.cooling} cooling off` : "") +
      (ordered.tooSmall ? `, ${ordered.tooSmall} too small for ${chars} chars` : "") +
      `: ${ordered.head.join(", ")}`,
  );

  // With streaming off we ask upstream for the whole reply at once, then
  // re-stream it ourselves if the client wanted a stream.
  const streamUpstream = Boolean(anthropicReq.stream) && streaming;

  for (const [i, { provider, model }] of ordered.attempts.entries()) {
    const label = `attempt ${i + 1}/${ordered.attempts.length} (${displayName(provider)}, ${model})`;

    const remaining = deadline - Date.now();
    if (remaining < MIN_ATTEMPT_MS) {
      console.error(`[opencc]   giving up after ${TOTAL_DEADLINE_MS / 1000}s, ${ordered.attempts.length - i} attempt(s) untried`);
      failures.push(`stopped after ${TOTAL_DEADLINE_MS / 1000}s with ${ordered.attempts.length - i} attempt(s) untried`);
      break;
    }

    const headers = { "Content-Type": "application/json" };
    // Omitted entirely when blank — a local backend may reject an empty bearer.
    if (provider.apiKey) headers.Authorization = `Bearer ${provider.apiKey}`;

    const body = JSON.stringify(
      toOpenAIRequest(anthropicReq, model, provider.baseUrl, streamUpstream),
    );

    let upstream;
    let networkError;
    let errorText;

    // Two passes at most, and the second only for a 5xx.
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) await sleep(RETRY_DELAY_MS);

      upstream = undefined;
      networkError = undefined;
      errorText = undefined;

      // Printed before the call, not after. A single request can sit for two
      // minutes on a slow backend, and without this the log goes quiet with no
      // indication of which model it's waiting on.
      console.log(`[opencc]   ${label}${attempt > 0 ? " (retry)" : ""} …`);
      const startedAt = Date.now();
      const took = () => `${((Date.now() - startedAt) / 1000).toFixed(1)}s`;

      // What the model actually gets. Less than the full timeout means the
      // overall deadline is the thing cutting it off, which is about how long
      // this walk has been running and not about this model.
      const budget = Math.min(UPSTREAM_TIMEOUT_MS, Math.max(MIN_ATTEMPT_MS, deadline - Date.now()));
      const shortened = budget < UPSTREAM_TIMEOUT_MS;

      try {
        upstream = await fetch(`${provider.baseUrl}/chat/completions`, {
          method: "POST",
          headers,
          body,
          signal: AbortSignal.timeout(budget),
        });
      } catch (err) {
        // Unreachable host, DNS failure, connection reset, timeout, ...
        networkError = err;
      }

      if (upstream?.ok) {
        console.log(`[opencc]   ${label} -> ${upstream.status} in ${took()}`);
        // Deliberately not recorded here. A 200 whose body turned out to be
        // empty, or to carry tool arguments nothing can parse, is not a
        // success, and the body has not been read yet. The caller reports it
        // once it knows, through `report` below.
        headStatus = upstream.status;
        headMs = Date.now() - startedAt;
        break;
      }

      if (!networkError) errorText = await upstream.text();
      // A dropped connection isn't retried either: a refused or timed-out
      // request won't heal in 400ms, and the next model is a better bet than
      // waiting out a second timeout.
      const serverFault = !networkError && upstream.status >= 500;

      // 0 stands for "never reached it", which is as much a failure as a 500.
      //
      // Unless the deadline is what stopped it. An attempt that was never
      // given the full timeout tells us nothing about the model, and
      // recording it would hold a slow walk against whichever models happened
      // to be at the end of it.
      if (networkError && shortened) {
        console.error(`[opencc]   ${label} cut short by the deadline after ${took()} — not counted against it`);
      } else {
        const status = networkError ? 0 : upstream.status;
        // An oversized request is about the request, not the model. Recorded
        // so the ceiling is learned, weighed at nothing so the model is not
        // blamed for it.
        const oversized = !networkError && isTooBig(status, errorText ?? "");
        stats.record({
          baseUrl: provider.baseUrl, model, kind, status, chars,
          verdict: oversized ? TOO_BIG_VERDICT : undefined,
        });
        if (oversized) console.error(`[opencc]   ${label} is too small for this request (${chars} chars)`);
        // Rate limits and outages say "not now" rather than "not ever", so
        // on top of the record they park the model for a minute or so.
        const cool = stats.coolOff(provider.baseUrl, model, status);
        if (cool) console.error(`[opencc]   ${label} cooling off for ${cool / 1000}s`);
      }

      const reason = networkError
        ? `unreachable after ${took()}: ${networkError.message}`
        : `failed ${upstream.status} after ${took()}: ${errorText.slice(0, 300)}`;

      if (serverFault && attempt === 0) {
        console.error(`[opencc]   ${label} ${reason} — retrying once`);
        continue;
      }

      console.error(`[opencc]   ${label} ${reason}`);
      break;
    }

    if (upstream?.ok && !streamUpstream) {
      // Read here rather than in the caller, because a 200 carrying nothing
      // usable is not an answer and the next model should get a turn. By the
      // time the caller has it, it has already been promised to the client.
      let reply;
      try {
        reply = toAnthropicResponse(await upstream.json(), anthropicReq.model, provider.baseUrl);
      } catch (err) {
        stats.record({ baseUrl: provider.baseUrl, model, kind, status: headStatus, chars, verdict: "unreadable" });
        failures.push(`${displayName(provider)}/${model}: reply was not JSON: ${err.message}`);
        console.error(`[opencc]   ${label} answered with something that is not JSON`);
        continue;
      }

      const toolBlocks = reply.content.filter((block) => block.type === "tool_use");
      const verdict = verdictFor(anthropicReq, {
        blocks: reply.content.filter((block) => block.type !== "text" || block.text !== "").length,
        toolUse: toolBlocks.length > 0,
        badArguments: toolBlocks.some((block) => !block.input || typeof block.input !== "object"),
      });

      stats.record({ baseUrl: provider.baseUrl, model, kind, status: headStatus, ms: headMs, chars, verdict });

      if (verdict !== "ok") {
        failures.push(`${displayName(provider)}/${model}: 200 but ${verdict}`);
        console.error(`[opencc]   ${label} -> 200 but ${verdict}, trying the next one`);
        continue;
      }

      stats.settled(provider.baseUrl, model);
      return { reply, provider, model, streamed: false };
    }

    if (upstream?.ok) {
      return {
        upstream, provider, model, streamed: streamUpstream,
        // Called once the reply has been read. Until then this attempt is
        // not in the record at all.
        report: (verdict) => stats.record({
          baseUrl: provider.baseUrl, model, kind, status: headStatus, ms: headMs, verdict, chars,
        }),
      };
    }

    // Anything still failing moves to the next pair. Providers disagree wildly
    // about what they reject and with which status (a 400 from one often
    // succeeds on another), so there's no status worth special-casing.
    if (networkError) {
      failures.push(`${displayName(provider)}/${model}: ${networkError.message}`);
    } else {
      failures.push(`${displayName(provider)}/${model} ${upstream.status}: ${errorText.slice(0, 300)}`);
      lastStatus = upstream.status;
    }
  }

  return {
    status: lastStatus,
    message: `All ${ordered.attempts.length} provider/model attempt(s) failed:\n${failures.join("\n")}`,
  };
}

async function handleMessages(anthropicReq, res) {
  // Read fresh each request so edits in `opencc init` apply without a restart.
  const live = getConfig();

  if (!isConfigured(live)) {
    sendJson(res, 503, toAnthropicError(503, 'opencc is not configured. Run "opencc init" first.'));
    return;
  }

  // Size of the incoming request, which is what you want when a backend
  // complains about length. max_tokens is shown as asked for, not forwarded.
  const chars = JSON.stringify(anthropicReq).length;
  console.log(
    `[opencc]   model=${anthropicReq.model} stream=${Boolean(anthropicReq.stream)}` +
      ` asked_max_tokens=${anthropicReq.max_tokens} (not forwarded)` +
      ` tools=${(anthropicReq.tools ?? []).length} chars=${chars}`,
  );

  const result = await callUpstream(anthropicReq, live.providers, live.streaming, undefined, chars);

  if (!result.upstream && !result.reply) {
    sendJson(res, result.status, toAnthropicError(result.status, result.message));
    return;
  }

  if (result.streamed) {
    try {
      const sent = await streamOpenAIToAnthropic(result.upstream, res, anthropicReq.model, result.provider.baseUrl);
      result.report(verdictFor(anthropicReq, sent));
    } catch (err) {
      // The worst outcome there is: the reply started, Claude Code has half
      // of it, and there is no retrying. It used to be the one failure that
      // went unrecorded, so a model that did it reliably kept a clean sheet.
      console.error(`[opencc]   stream from ${result.model} died part way: ${err.message}`);
      result.report(STREAM_DIED_VERDICT);
      if (!res.writableEnded) res.end();
    }
    return;
  }

  // Already read, checked and recorded inside the walk.
  if (anthropicReq.stream) sendAnthropicAsStream(res, result.reply);
  else sendJson(res, 200, result.reply);
}

const server = createServer(async (req, res) => {
  // Ignore query strings and a trailing slash so a client that appends
  // either of those still matches our routes.
  const path = req.url.split("?")[0].replace(/\/$/, "") || "/";
  console.log(`[opencc] ${req.method} ${req.url}`);

  try {
    if (req.method === "GET" && path === "/") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("opencc is running");
      return;
    }

    if (req.method === "POST" && path === "/v1/messages") {
      const body = await readJsonBody(req);
      await handleMessages(body, res);
      return;
    }

    console.log(`[opencc]   no route matched for ${req.method} ${path}`);
    sendJson(res, 404, toAnthropicError(404, "Not found"));
  } catch (err) {
    console.error(err);
    if (!res.headersSent) {
      sendJson(res, 500, toAnthropicError(500, err.message));
    } else {
      res.end();
    }
  }
});

export function startServer(port = config.port) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    // "localhost" only — never exposed to the LAN.
    server.listen(port, "localhost", () => {
      resolve(server);
    });
  });
}

// This runs the proxy on its own, useful for watching its request logs in
// a dedicated terminal without going through cli.js's config check. `opencc`
// (src/cli.js, no arguments) is the normal way to start the server.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  await startServer();
  console.log(`opencc listening on http://localhost:${config.port}`);
  console.log("");
}
