import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { config, getConfig, isConfigured, displayName } from "./config.js";
import { pickModels, toOpenAIRequest, toAnthropicResponse, toAnthropicError } from "./translate.js";
import { streamOpenAIToAnthropic, sendAnthropicAsStream } from "./stream.js";

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
// 5xx means the provider broke, not that the request was wrong, so it's worth
// one quick retry before giving up on a model. 429 is deliberately excluded —
// that needs backoff, not an immediate retry.
// Only for providers with retry switched on, and only for failures that could
// plausibly go the other way a moment later: a 5xx, a dropped connection, or a
// 429 (the key rotator in front of some providers may land on a fresh key).
// A 400/401/403/404 is settled — retrying it just wastes the budget.
const NOT_WORTH_RETRYING = new Set([400, 401, 403, 404, 413, 422]);
const RETRY_DELAY_MS = 400;

// Per attempt, and for the whole walk. The deadline is what actually prevents
// a hang — without it a bad run could work through every model before
// answering — so the per-attempt timeout can afford to be generous. It needs
// to be: a request carrying a large tool set runs to several minutes on some
// backends, and cutting those off fails requests that would have succeeded.
const UPSTREAM_TIMEOUT_MS = 300000;
const TOTAL_DEADLINE_MS = 600000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function callUpstream(
  anthropicReq,
  providers = config.providers,
  streaming = config.streaming,
) {
  const failures = [];
  const deadline = Date.now() + TOTAL_DEADLINE_MS;
  let lastStatus = 502;

  // Flattened up front so the log can show "attempt 3/7" rather than a
  // provider index that says nothing about how much runway is left.
  const attempts = providers
    .filter((provider) => !provider.disabled)
    .flatMap((provider) =>
      pickModels(anthropicReq.model, provider).map((model) => ({ provider, model })),
    );

  if (attempts.length === 0) {
    return {
      status: 503,
      message: `No provider is available: all ${providers.length} are disabled. Run "opencc init" to enable one.`,
    };
  }

  // With streaming off we ask upstream for the whole reply at once, then
  // re-stream it ourselves if the client wanted a stream.
  const streamUpstream = Boolean(anthropicReq.stream) && streaming;

  for (const [i, { provider, model }] of attempts.entries()) {
    const label = `attempt ${i + 1}/${attempts.length} (${displayName(provider)}, ${model})`;

    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      console.error(`[opencc]   giving up after ${TOTAL_DEADLINE_MS / 1000}s, ${attempts.length - i} attempt(s) untried`);
      failures.push(`stopped after ${TOTAL_DEADLINE_MS / 1000}s with ${attempts.length - i} attempt(s) untried`);
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

    // One pass unless this provider has retry switched on, and even then the
    // second pass only happens for a failure worth retrying.
    const maxTries = provider.retry ? 2 : 1;
    for (let attempt = 0; attempt < maxTries; attempt++) {
      if (attempt > 0) await sleep(RETRY_DELAY_MS);

      upstream = undefined;
      networkError = undefined;
      errorText = undefined;

      try {
        upstream = await fetch(`${provider.baseUrl}/chat/completions`, {
          method: "POST",
          headers,
          body,
          signal: AbortSignal.timeout(Math.min(UPSTREAM_TIMEOUT_MS, Math.max(1000, deadline - Date.now()))),
        });
      } catch (err) {
        // Unreachable host, DNS failure, connection reset, timeout, ...
        networkError = err;
      }

      if (upstream?.ok) break;

      if (!networkError) errorText = await upstream.text();
      const transient = networkError ? true : !NOT_WORTH_RETRYING.has(upstream.status);

      const reason = networkError
        ? `unreachable: ${networkError.message}`
        : `failed ${upstream.status}: ${errorText.slice(0, 300)}`;

      if (transient && attempt + 1 < maxTries) {
        console.error(`[opencc]   ${label} ${reason} — retrying once`);
        continue;
      }

      console.error(`[opencc]   ${label} ${reason}`);
      break;
    }

    if (upstream?.ok) {
      console.log(`[opencc]   ${label} -> ${upstream.status}`);
      return { upstream, provider, model, streamed: streamUpstream };
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
    message: `All ${attempts.length} provider/model attempt(s) failed:\n${failures.join("\n")}`,
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
  console.log(
    `[opencc]   model=${anthropicReq.model} stream=${Boolean(anthropicReq.stream)}` +
      ` asked_max_tokens=${anthropicReq.max_tokens} (not forwarded)` +
      ` tools=${(anthropicReq.tools ?? []).length} chars=${JSON.stringify(anthropicReq).length}`,
  );

  const result = await callUpstream(anthropicReq, live.providers, live.streaming);

  if (!result.upstream) {
    sendJson(res, result.status, toAnthropicError(result.status, result.message));
    return;
  }

  if (result.streamed) {
    await streamOpenAIToAnthropic(result.upstream, res, anthropicReq.model, result.provider.baseUrl);
    return;
  }

  const data = await result.upstream.json();
  const message = toAnthropicResponse(data, anthropicReq.model, result.provider.baseUrl);

  // The client asked for a stream but streaming is off, so hand it the
  // finished message as a one-shot stream rather than a plain JSON body.
  if (anthropicReq.stream) sendAnthropicAsStream(res, message);
  else sendJson(res, 200, message);
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

export function startServer() {
  return new Promise((resolve) => {
    // "localhost" only — never exposed to the LAN.
    server.listen(config.port, "localhost", () => {
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
