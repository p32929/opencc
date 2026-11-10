import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { config, getConfig, isConfigured, displayName } from "./config.js";
import { pickModels, toOpenAIRequest, toAnthropicResponse, toAnthropicError } from "./translate.js";
import { streamOpenAIToAnthropic, sendAnthropicAsStream, primeStream } from "./stream.js";
import { DEFAULTS as BEHAVIOR_DEFAULTS, effortFor } from "./behavior.js";
import { outage, isPage, retryAfterMs } from "./failures.js";
import { applyQuirks, refusedPart, limitStated } from "./learned.js";
import { leakedMarkup, tokensOf, family } from "./textfix.js";
import { renderTag, stripTags, tagMessage } from "./replytag.js";
import { requirementsOf, describeNeeds, kindOf, chooseOrder, record, coolOff, cooledOffSuccessfully, coolingFor, verdictFor, isTooBig, TOO_BIG_VERDICT, STREAM_DIED_VERDICT } from "./stats.js";
import { logRequest, saveDetail } from "./reqlog.js";
import { randomBytes } from "node:crypto";
import { quirksOf, learnQuirk, learnLimit, learnFromUsage } from "./learned.js";
import { addUsage } from "./usage.js";
import { probeSoon } from "./probe.js";
import { bonusFor } from "./fit.js";
import { conversationKey, stickyFor, stick } from "./conversations.js";
import { tooBigForCatalog, unfitFor, factsFor } from "./modelsdev.js";
import { setupFor } from "./setup.js";
import { fetch } from "./http.js"; // not the built-in one: see http.js

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

// Walks every provider/model pair in the order the record draws, until one
// accepts the request: the best candidates first, and a pair that is
// exhausted, down, or unrecognised is skipped; the last error is reported if
// every pair fails.
//
// Note this can only fail over before the reply starts. A streamed reply is
// held until its first real chunk has arrived (primeStream), so a model that
// never starts, or answers with an error inside a 200, still hands over to
// the next one. Once the first chunk has gone to the client there is no way
// to retract it, so a failure after that is still fatal.
//
// What a failure does depends on what kind it is (failures.js): a 5xx is the
// provider breaking, worth one more try on the same model; anything else in
// the 4xx range is a decision about this request, and asking the same model
// again cannot change it. With "if one fails" set to retry, an outage or a
// rate limit is asked again, waiting as long as the provider says.
const RETRY_DELAY_MS = 400;
const MAX_RETRY_WAIT_MS = 30000;
// A refusal of one part of a request can be worked around by leaving that
// part out. More than this many in a row is not a quirk, it is a refusal.
const MAX_QUIRK_RETRIES = 3;

// A failure that says the whole provider is the problem, not one of its
// models: no connection at all, a refused key, a gateway that is down. Its
// other models are held back until the other providers have had a turn. A 429
// or a 404 is about one model (free tiers limit each separately), so the
// provider keeps its place for the rest.
const providerWide = (status) => !status || [401, 402, 403, 407, 502, 503, 504].includes(status);

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

const sleep = (ms, signal) =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
  });

export async function callUpstream(
  anthropicReq,
  providers = config.providers,
  streaming = config.streaming,
  // Injectable so a caller can run without touching the stats file at all —
  // it is shared mutable state on disk, which otherwise makes this function's
  // behaviour depend on every request that came before it. `order` is here so
  // a test can pin the draw that would otherwise be random.
  stats = { order: chooseOrder, record, coolOff, settled: cooledOffSuccessfully, cooling: coolingFor },
  // Serialising a request is not free - a big one runs to most of a
  // millisecond - and the caller has usually measured it already.
  chars = JSON.stringify(anthropicReq).length,
  // Your provider ranking, best first. Empty is the default and means the
  // record decides on its own.
  rank = config.rank,
  // Whether this model streams. Injectable so a test does not read the
  // setup file of whoever runs it.
  modelStreams = (baseUrl, model) => setupFor(baseUrl, model)?.stream !== false,
  // How to treat failures (behavior.js), a signal that fires when the client
  // goes away, and what the walk may learn and remember. Everything that
  // touches a file or the network beyond the request itself is a hook, so a
  // caller that passes none gets a walk that changes nothing.
  //   hooks: quirksOf(baseUrl, model), learnQuirk(baseUrl, model, quirk),
  //          learnLimit(baseUrl, model, limit), learnUsage(baseUrl, model,
  //          used, estimate), usage(baseUrl, model, usage) -> { cost },
  //          probe(provider, model), bonus(baseUrl, model),
  //          unfit(baseUrl, model, needs), can(baseUrl, model) -> { vision,
  //          tools, thinks }
  //   preferred: { baseUrl, model } to try first (a conversation's model)
  opts = {},
) {
  const behavior = { ...BEHAVIOR_DEFAULTS, ...(opts.behavior ?? {}) };
  const hooks = opts.hooks ?? {};
  const signal = opts.signal;
  let failures = [];
  // One entry per model actually asked, in the order they were tried. Handed
  // back with the result so the request log can show the whole walk rather
  // than only whichever model happened to answer.
  const trail = [];
  const deadline = Date.now() + (opts.deadlineMs ?? TOTAL_DEADLINE_MS);
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
    // Three ways to end up here and they need different fixes, so say which
    // one it is. The old message blamed disabled providers for all of them,
    // which sent you looking for a switch that was already on.
    const live = providers.filter((provider) => !provider.disabled);
    const message = providers.length === 0
      ? "No providers are set up yet. Add one in the opencc panel."
      : live.length === 0
        ? `Every provider is switched off (${providers.length} of them). Switch one on in the opencc panel.`
        : "Pick a model first. " +
          `${live.length === 1 ? "The provider is" : `All ${live.length} providers are`} set up, ` +
          "but no model has been put in the pot, so there is nothing to route to. " +
          "Open the opencc panel, go to Providers, and click the models you want.";

    return { status: 503, message, trail };
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

  // The request's size in tokens, estimated once and only if something asks:
  // the models whose window is known are checked against it.
  let tokensMemo;
  const tokens = () => (tokensMemo ??= tokensOf(JSON.stringify(anthropicReq)));

  // Your order, when that is how models are picked (the default): where each
  // one stands in the list saved on Your models.
  const fixed = behavior.pick === "order" && opts.order?.length
    ? new Map(opts.order.flatMap((e, place) => {
        const p = providers.find((x) => x.name === e.provider);
        return p ? [[`${p.baseUrl}\u0000${e.model}`, place]] : [];
      }))
    : null;

  const order = () => {
    const ordered = stats.order(candidates, kind, {
      chars,
      // The size decides whether a model can take this at all, so it goes
      // into the ordering as well as into the record. The window comes from
      // you, the server, models.dev or what a refusal showed (modelsdev.js).
      catalogTooBig: opts.catalogTooBig ?? ((baseUrl, model, size) => tooBigForCatalog(baseUrl, model, size, tokens())),
      rank,
      bonus: hooks.bonus,
      unfit: hooks.unfit && ((baseUrl, model) => hooks.unfit(baseUrl, model, needs)),
      fixed,
    });
    // A conversation stays on the model that answered it, while that model is
    // available: the provider's prompt cache holds, and nothing is relearned.
    const at = opts.preferred
      ? ordered.attempts.findIndex((a) => a.provider.baseUrl === opts.preferred.baseUrl && a.model === opts.preferred.model)
      : -1;
    if (at > 0 && !stats.cooling?.(opts.preferred.baseUrl, opts.preferred.model)) {
      ordered.attempts.unshift(...ordered.attempts.splice(at, 1));
      ordered.head.unshift(`${opts.preferred.model} (this conversation's)`);
    }
    return ordered;
  };

  // With streaming off we ask upstream for the whole reply at once, then
  // re-stream it ourselves if the client wanted a stream.
  const wantsStream = Boolean(anthropicReq.stream) && streaming;

  // One model: the request, its refusals, its retries. Returns the upstream
  // that answered, or null with `fault` filled in.
  async function askModel(provider, model, label, fault) {
    const baseUrl = provider.baseUrl;
    // Per model as well as global: a backend whose streaming is unreliable
    // can be told so for that one model, without giving up streaming for the
    // rest. Set in the model's setup.
    const streamUpstream = wantsStream && modelStreams(baseUrl, model);

    const headers = { "Content-Type": "application/json" };
    // Omitted entirely when blank — a local backend may reject an empty bearer.
    if (provider.apiKey) headers.Authorization = `Bearer ${provider.apiKey}`;

    // What this model has refused before leaves the request; what it refuses
    // now is left out and asked again, and learned when that works.
    const quirks = { ...(hooks.quirksOf?.(baseUrl, model) ?? {}) };
    const tried = [];
    const can = hooks.can?.(baseUrl, model) ?? {};
    const effort = effortFor(behavior.effort, anthropicReq);
    const build = () => JSON.stringify(
      applyQuirks(toOpenAIRequest(anthropicReq, model, baseUrl, streamUpstream, { can, effort }), quirks),
    );

    let first = null; // the refusal the workaround was for
    let tries = 0;
    let quirkRetries = 0;
    for (;;) {
      if (signal?.aborted) {
        fault.status = 499;
        fault.error = "the client went away";
        return null;
      }
      const body = build();

      // Printed before the call, not after. A single request can sit for two
      // minutes on a slow backend, and without this the log goes quiet with no
      // indication of which model it's waiting on.
      console.log(`[opencc]   ${label}${tries > 0 ? " (retry)" : ""} …`);
      const startedAt = Date.now();
      const took = () => `${((Date.now() - startedAt) / 1000).toFixed(1)}s`;

      // What the model actually gets. Less than the full timeout means the
      // overall deadline is the thing cutting it off, which is about how long
      // this walk has been running and not about this model.
      const budget = Math.min(UPSTREAM_TIMEOUT_MS, Math.max(MIN_ATTEMPT_MS, deadline - Date.now()));
      const shortened = budget < UPSTREAM_TIMEOUT_MS;

      let upstream;
      let networkError;
      try {
        upstream = await fetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers,
          body,
          signal: signal ? AbortSignal.any([AbortSignal.timeout(budget), signal]) : AbortSignal.timeout(budget),
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
        // once it knows.
        headStatus = upstream.status;
        headMs = Date.now() - startedAt;
        // What it took leaving out is what it does not take.
        for (const part of tried) hooks.learnQuirk?.(baseUrl, model, part);
        return { upstream, streamUpstream };
      }

      let errorText = "";
      if (!networkError) errorText = await upstream.text().catch(() => "");
      const status = networkError ? 0 : upstream.status;
      const page = !networkError && isPage(errorText);

      // The part of the request it refused: the same request without it. A
      // retry that is refused again takes the workaround back and the
      // original refusal stands.
      if (!networkError && quirkRetries < MAX_QUIRK_RETRIES) {
        const part = refusedPart(status, errorText, JSON.parse(body), quirks);
        if (part) {
          console.error(`[opencc]   ${label} refused ${part.replace(/^no/, "").toLowerCase()}: asking again without it`);
          quirks[part] = true;
          tried.push(part);
          first ??= { status, errorText };
          quirkRetries += 1;
          continue;
        }
      }
      if (first && (status === 400 || status === 422)) {
        // Whatever was left out did not help: what it said first stands.
        tried.length = 0;
        ({ status: fault.status, errorText: fault.body } = { status: first.status, errorText: first.errorText });
      }

      const reportedStatus = first && (status === 400 || status === 422) ? first.status : status;
      const reportedText = first && (status === 400 || status === 422) ? first.errorText : errorText;
      const soft = outage({ status: reportedStatus, page });
      const asked = networkError ? 0 : retryAfterMs(upstream.headers, reportedText);

      // A dropped connection isn't retried on the default setting either: a
      // refused or timed-out request won't heal in 400ms, and the next model
      // is a better bet than waiting out a second timeout.
      const serverFault = !networkError && reportedStatus >= 500;

      // 0 stands for "never reached it", which is as much a failure as a 500.
      //
      // Unless the deadline is what stopped it. An attempt that was never
      // given the full timeout tells us nothing about the model, and
      // recording it would hold a slow walk against whichever models happened
      // to be at the end of it.
      if (networkError && shortened) {
        console.error(`[opencc]   ${label} cut short by the deadline after ${took()} — not counted against it`);
      } else if (networkError && signal?.aborted) {
        console.error(`[opencc]   ${label} stopped: the client went away`);
      } else {
        // An oversized request is about the request, not the model. Recorded
        // so the ceiling is learned, weighed at nothing so the model is not
        // blamed for it.
        const oversized = !networkError && isTooBig(reportedStatus, reportedText);
        stats.record({
          baseUrl, model, kind, status: reportedStatus, chars,
          verdict: oversized ? TOO_BIG_VERDICT : undefined,
        });
        if (oversized) console.error(`[opencc]   ${label} is too small for this request (${chars} chars)`);
        // A refusal that states its limit is the model's window, or your
        // per-minute cap at this provider; either way it is kept.
        const limit = !networkError && limitStated(reportedStatus, reportedText);
        if (limit) hooks.learnLimit?.(baseUrl, model, limit);
        // Rate limits and outages say "not now" rather than "not ever", so
        // on top of the record they park the model, for as long as the
        // provider asked when it said.
        const cool = stats.coolOff(baseUrl, model, reportedStatus, undefined, asked);
        if (cool) console.error(`[opencc]   ${label} cooling off for ${cool / 1000}s`);
      }

      const reason = networkError
        ? `unreachable after ${took()}: ${networkError.message}`
        : `failed ${reportedStatus} after ${took()}: ${reportedText.slice(0, 300)}`;

      // Ask this one again? On the default only a 5xx, once. "retries" asks
      // again for anything waiting can fix, as many times as it says, for as
      // long as the provider asked. "any" never.
      let again = false;
      const base = opts.retryDelayMs ?? RETRY_DELAY_MS;
      let wait = base;
      if (!(networkError && (shortened || signal?.aborted))) {
        if (behavior.onFail === "failure") again = serverFault && tries === 0;
        else if (behavior.onFail === "retries") {
          again = soft && tries + 1 < behavior.retries;
          wait = Math.min(asked || base * 2 ** (tries + 1), MAX_RETRY_WAIT_MS);
          if (Date.now() + wait + MIN_ATTEMPT_MS > deadline) again = false;
        }
      }
      if (again) {
        console.error(`[opencc]   ${label} ${reason} — retrying${behavior.onFail === "retries" ? ` in ${(wait / 1000).toFixed(1)}s` : " once"}`);
        await sleep(wait, signal);
        tries += 1;
        continue;
      }

      console.error(`[opencc]   ${label} ${reason}`);
      trail.push({
        provider: displayName(provider),
        model,
        status: reportedStatus,
        ms: Date.now() - startedAt,
        error: reason,
      });
      fault.status = reportedStatus;
      fault.soft = soft;
      fault.asked = asked;
      fault.error = networkError
        ? networkError.message
        : `${reportedStatus}: ${reportedText.slice(0, 300)}`;
      return null;
    }
  }

  let round = 0;
  for (;;) {
    const ordered = order();
    if (round === 0) {
      console.log(
        `[opencc]   ${candidates.length} model(s) for ${describeNeeds(needs)}` +
          (ordered.cooling ? `, ${ordered.cooling} cooling off` : "") +
          (ordered.tooSmall ? `, ${ordered.tooSmall} too small for ${chars} chars` : "") +
          `: ${ordered.head.join(", ")}`,
      );
    }

    failures = [];
    let allHard = true;
    let longestAsk = 0;
    // A provider that answered with an error is not asked again through its
    // other models: the next is from another provider. When every provider
    // has had its turn, the ones held back go in order.
    const down = new Set();
    // Another version of a model that just failed, at the same provider
    // (mistral-large-2411 after mistral-large-latest), would likely fail the
    // same way: it goes back with the held ones.
    const failedFamilies = new Set();
    const familyKey = (provider, model) => `${provider.baseUrl}\u0000${family(model)}`;
    const queue = ordered.attempts.map((a) => ({ ...a, second: false }));
    const held = [];

    for (let q = 0; q < queue.length; q++) {
      const { provider, model, second } = queue[q];
      const label = `attempt ${q + 1}/${queue.length} (${displayName(provider)}, ${model})${round ? ` round ${round + 1}` : ""}`;

      if (!second && (down.has(provider.baseUrl) || failedFamilies.has(familyKey(provider, model)))) {
        held.push({ provider, model, second: true });
      } else {
        const remaining = deadline - Date.now();
        if (remaining < MIN_ATTEMPT_MS) {
          console.error(`[opencc]   giving up after ${(opts.deadlineMs ?? TOTAL_DEADLINE_MS) / 1000}s, ${queue.length - q} attempt(s) untried`);
          failures.push(`stopped after ${(opts.deadlineMs ?? TOTAL_DEADLINE_MS) / 1000}s with ${queue.length - q} attempt(s) untried`);
          allHard = true;
          break;
        }
        if (signal?.aborted) break;

        hooks.probe?.(provider, model);
        const fault = {};
        const got = await askModel(provider, model, label, fault);

        if (got) {
          let { upstream, streamUpstream } = got;
          const baseUrl = provider.baseUrl;
          const can = hooks.can?.(baseUrl, model) ?? {};

          // A streamed reply is waited for until it starts, so a model that
          // does not, or says an error inside the stream, can be passed over.
          if (streamUpstream) {
            const startedAt = Date.now();
            try {
              upstream = await primeStream(upstream, { startMs: behavior.replyStart * 1000, idleMs: opts.idleMs ?? behavior.replyIdle * 1000 });
            } catch (err) {
              const status = err.status ?? 0;
              stats.record({ baseUrl, model, kind, status, chars, verdict: err.empty ? "empty" : undefined });
              const cool = stats.coolOff(baseUrl, model, status);
              if (cool) console.error(`[opencc]   ${label} cooling off for ${cool / 1000}s`);
              console.error(`[opencc]   ${label} ${err.message}, trying the next one`);
              failures.push(`${displayName(provider)}/${model}: ${err.message}`);
              trail.push({ provider: displayName(provider), model, status: status || headStatus, ms: Date.now() - startedAt + headMs, error: err.message });
              lastStatus = status || 502;
              allHard &&= !outage({ status });
              if (providerWide(status)) down.add(baseUrl);
              failedFamilies.add(familyKey(provider, model));
              continue;
            }
          }

          if (!streamUpstream) {
            // Read here rather than in the caller, because a 200 carrying
            // nothing usable is not an answer and the next model should get a
            // turn. By the time the caller has it, it has already been
            // promised to the client.
            let reply;
            let usage;
            try {
              const json = await upstream.json();
              reply = toAnthropicResponse(json, anthropicReq.model, baseUrl);
              usage = json.usage && {
                input: json.usage.prompt_tokens ?? 0, output: json.usage.completion_tokens ?? 0,
                cached: json.usage.prompt_tokens_details?.cached_tokens ?? 0, cost: json.usage.cost,
              };
            } catch (err) {
              stats.record({ baseUrl, model, kind, status: headStatus, chars, verdict: "unreadable" });
              failures.push(`${displayName(provider)}/${model}: reply was not JSON: ${err.message}`);
              console.error(`[opencc]   ${label} answered with something that is not JSON`);
              trail.push({ provider: displayName(provider), model, status: headStatus, ms: headMs, verdict: "unreadable", error: err.message });
              allHard = false;
              continue;
            }

            const toolBlocks = reply.content.filter((block) => block.type === "tool_use");
            const verdict = verdictFor(anthropicReq, {
              blocks: reply.content.filter((block) => block.type !== "text" || block.text !== "").length,
              toolUse: toolBlocks.length > 0,
              badArguments: toolBlocks.some((block) => !block.input || typeof block.input !== "object"),
              garbled: needs.tools && toolBlocks.length === 0 && Boolean(leakedMarkup(reply.content.map((b) => b.text ?? "").join(""))),
            });

            stats.record({ baseUrl, model, kind, status: headStatus, ms: headMs, chars, verdict });

            if (verdict !== "ok") {
              failures.push(`${displayName(provider)}/${model}: 200 but ${verdict}`);
              console.error(`[opencc]   ${label} -> 200 but ${verdict}, trying the next one`);
              trail.push({ provider: displayName(provider), model, status: headStatus, ms: headMs, verdict, error: `200 but ${verdict}` });
              allHard = false;
              continue;
            }

            stats.settled(baseUrl, model);
            trail.push({ provider: displayName(provider), model, status: headStatus, ms: headMs, verdict });
            const spent = usage && finishUsage(baseUrl, model, usage);
            return { reply, provider, model, streamed: false, trail, ms: headMs, usage, cost: spent?.cost, firstMs: headMs };
          }

          const entry = { provider: displayName(provider), model, status: headStatus, ms: headMs };
          trail.push(entry);
          return {
            upstream, provider, model, streamed: true, trail, ms: headMs, can, thinks: Boolean(can.thinks),
            // Called once the reply has been read. Until then this attempt is
            // not in the record at all.
            report: (verdict, sent) => {
              entry.verdict = verdict;
              stats.record({
                baseUrl, model, kind, status: headStatus, ms: headMs, verdict, chars,
              });
              if (verdict === "ok") stats.settled?.(baseUrl, model);
              return sent?.usage ? finishUsage(baseUrl, model, sent.usage) : null;
            },
          };
        }

        // Anything still failing moves to the next pair. Providers disagree
        // wildly about what they reject and with which status (a 400 from one
        // often succeeds on another), so there's no status worth
        // special-casing.
        failures.push(`${displayName(provider)}/${model} ${fault.error}`);
        lastStatus = fault.status || lastStatus;
        allHard &&= !fault.soft;
        longestAsk = Math.max(longestAsk, fault.asked ?? 0);
        if (providerWide(fault.status)) down.add(provider.baseUrl);
        failedFamilies.add(familyKey(provider, model));
      }

      // Every provider has had its turn: the held-back models go now.
      if (q === queue.length - 1 && held.length) {
        queue.push(...held.splice(0));
      }
    }

    // Everything failed with something that may pass (a rate limit, an
    // outage): wait, then go round again, until there is no time left or the
    // client goes away. Only when asked for: the default gives Claude Code
    // the error, which has its own retries.
    const left = deadline - Date.now();
    if (behavior.keepTrying && !allHard && !signal?.aborted && left > MIN_ATTEMPT_MS * 2) {
      const wait = Math.min(Math.max(longestAsk, (opts.roundWaitMs ?? 1000) * 2 ** Math.min(round, 5)), 60000, left - MIN_ATTEMPT_MS);
      console.error(`[opencc]   every model failed; waiting ${(wait / 1000).toFixed(1)}s, then another round`);
      await sleep(wait, signal);
      round += 1;
      continue;
    }
    break;
  }

  return {
    status: lastStatus,
    message: `All ${candidates.length} provider/model attempt(s) failed:\n${failures.join("\n")}`,
    trail,
  };

  // What a reply cost, kept; and what it showed about how much the model takes.
  function finishUsage(baseUrl, model, usage) {
    hooks.learnUsage?.(baseUrl, model, usage.input, tokens());
    return hooks.usage?.(baseUrl, model, usage) ?? null;
  }
}

// What a request to this proxy may learn and remember, for the walk in
// callUpstream: quirks, windows, usage and cost, rankings, a probe of what a
// local server says about its window.
function liveHooks(behavior, needs, chars) {
  return {
    quirksOf, learnQuirk, learnLimit, learnUsage: learnFromUsage,
    usage: (baseUrl, model, usage) => addUsage(baseUrl, model, usage),
    probe: probeSoon,
    bonus: behavior.fit ? bonusFor(needs, chars) : undefined,
    unfit: unfitFor,
    can: (baseUrl, model) => {
      const f = factsFor(baseUrl, model);
      return {
        vision: f && f.vision === false ? false : undefined,
        tools: f && f.tools === false ? false : undefined,
        thinks: Boolean(f?.reasoning),
      };
    },
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

  // The label this setup puts on replies is taken back off the earlier ones,
  // so a model does not learn to write it itself.
  if (live.replyTag) anthropicReq = { ...anthropicReq, messages: stripTags(live.replyTag, anthropicReq.messages) };

  const behavior = live.behavior ?? BEHAVIOR_DEFAULTS;
  const needs = requirementsOf(anthropicReq);

  // Gone when the client is: nothing is left to answer, so no more models are
  // asked on its account.
  const gone = new AbortController();
  res.on("close", () => { if (!res.writableEnded) gone.abort(); });

  const conversation = behavior.stay ? conversationKey(anthropicReq) : null;

  const startedAt = Date.now();
  const result = await callUpstream(
    anthropicReq, live.providers, live.streaming, undefined, chars, live.rank, undefined,
    {
      behavior,
      signal: gone.signal,
      hooks: liveHooks(behavior, needs, chars),
      preferred: conversation ? stickyFor(conversation) : null,
      order: live.order,
    },
  );

  // Common to every outcome below; `served` and the rest are filled in by
  // whichever branch actually ends the request.
  const logged = {
    at: startedAt,
    model: anthropicReq.model,
    kind: kindOf(needs),
    chars,
    tools: (anthropicReq.tools ?? []).length,
    stream: Boolean(anthropicReq.stream),
    attempts: result.trail ?? [],
  };
  // Kept with the summary when the log is set to: the whole request and what
  // came back.
  const keep = (extra, reply) => {
    if (behavior.logDetail !== "full") return extra;
    const id = randomBytes(6).toString("hex");
    saveDetail(id, { at: startedAt, request: anthropicReq, reply, trail: logged.attempts }, behavior.logDays);
    return { ...extra, id, detail: true };
  };
  const place = (served) => {
    const at = logged.attempts.findIndex((a) => a.provider === served.provider && a.model === served.model);
    return at < 0 ? undefined : { at: at + 1, of: logged.attempts.length };
  };

  if (!result.upstream && !result.reply) {
    logRequest(keep({ ...logged, status: result.status, error: result.message, ms: Date.now() - startedAt }, { error: result.message }));
    sendJson(res, result.status, toAnthropicError(result.status, result.message));
    return;
  }

  const served = `${displayName(result.provider)}/${result.model}`;
  if (conversation) stick(conversation, result.provider.baseUrl, result.model);
  const tag = renderTag(live.replyTag, {
    provider: displayName(result.provider), model: result.model, requested: anthropicReq.model,
  });
  const where = place({ provider: displayName(result.provider), model: result.model });

  if (result.streamed) {
    try {
      const sent = await streamOpenAIToAnthropic(
        result.upstream, res, anthropicReq.model, result.provider.baseUrl, tag,
        { thinks: result.thinks, hadTools: needs.tools },
      );
      const spent = result.report(verdictFor(anthropicReq, sent), sent);
      if (sent.cut) console.error(`[opencc]   ${result.model}: the stream ended without [DONE] or a finish reason, so the reply may be cut off`);
      logRequest(keep({
        ...logged, served, status: 200, ms: Date.now() - startedAt,
        firstMs: sent.firstMs ? sent.firstMs - startedAt : undefined, place: where, usage: sent.usage, cost: spent?.cost,
      }, { text: sent.text, calls: sent.calls, usage: sent.usage, looped: sent.looped }));
    } catch (err) {
      // The worst outcome there is: the reply started, Claude Code has half
      // of it, and there is no retrying. It used to be the one failure that
      // went unrecorded, so a model that did it reliably kept a clean sheet.
      console.error(`[opencc]   stream from ${result.model} died part way: ${err.message}`);
      result.report(STREAM_DIED_VERDICT);
      // Not "served": the client got half a reply, which is a failure however
      // the status line started out.
      logRequest(keep({ ...logged, status: 200, error: `stream died part way: ${err.message}`, ms: Date.now() - startedAt }, { error: err.message }));
      if (!res.writableEnded) res.end();
    }
    return;
  }

  // Already read, checked and recorded inside the walk.
  logRequest(keep({
    ...logged, served, status: 200, ms: Date.now() - startedAt,
    firstMs: result.firstMs, place: where, usage: result.usage, cost: result.cost,
  }, { content: result.reply.content, usage: result.usage }));
  const reply = tagMessage(result.reply, tag);
  if (anthropicReq.stream) sendAnthropicAsStream(res, reply);
  else sendJson(res, 200, reply);
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
