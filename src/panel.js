// The admin panel: which providers exist, which models they offer, and how
// each of those has actually been doing.
//
// Nothing here sets ordering and nothing probes for capabilities. Ordering is
// read from the record in stats.jsonl as the proxy runs; what a model can do
// is read from models.dev. What is left to set is the part neither can know:
// a URL, a key, and which models to put in the pot.
//
// No dependencies: Node's http server, one hand-written page, and a small
// JSON API over the same configStore the rest of opencc reads.
import { createServer } from "node:http";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { readStoredConfig, writeStoredConfig } from "./configStore.js";
import { providersFromEnv, displayName, streamingFromEnv, rankFromEnv, testTimeoutFromEnv, testLanesFromEnv } from "./config.js";
import { allStats, successRate, coolingFor, record, resetStats } from "./stats.js";
import { loadCatalog, lookupModel, catalogAge, catalogSize } from "./modelsdev.js";
import { listRequests, clearRequests, KEEP } from "./reqlog.js";
import { bus } from "./events.js";
import { CATALOGUES_PATH, TESTS_PATH, GLOBAL_CONFIG_DIR } from "./paths.js";
import { page } from "./panelPage.js";

const json = (res, status, body) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
      if (raw.length > 2_000_000) reject(new Error("body too large"));
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

// Read once: it cannot change while the process is running, and the page
// shows it beside the name in the sidebar.
let version = "";
try {
  const here = dirname(fileURLToPath(import.meta.url));
  version = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8")).version;
} catch {
  // Running from somewhere package.json is not reachable.
}

function loadState() {
  const stored = readStoredConfig();
  return {
    providers: providersFromEnv(stored).map((p) => ({ ...p, label: displayName(p) })),
    port: stored.PORT || "3000",
    streaming: streamingFromEnv(stored),
    rank: rankFromEnv(stored),
    testTimeout: testTimeoutFromEnv(stored),
    testLanes: testLanesFromEnv(stored),
    version,
  };
}

// One real request, and what came back.
//
// Not a capability check: what a model can do is models.dev's answer, read
// from the catalogue, and opencc does not go asking. This is "does this name
// exist at this backend, and does it answer", which is the question a wrong
// model name or a dead key actually raises. The result is recorded like any
// other call, so the Record column has something in it before Claude Code
// sends the first request.
//
// The request and the reply are both returned, trimmed, because "it failed"
// without the body is the answer that sends you to curl.
const DUMP_LIMIT = 4000;
const trim = (text) => (text.length > DUMP_LIMIT ? text.slice(0, DUMP_LIMIT) + "\n…" : text);

// How many requests this process has out to providers right now. Reported
// with the run, because "it has gone quiet" and "it is waiting on a hundred
// replies" look identical from the outside and need different fixes.
let inFlight = 0;

async function testModel(provider, model, timeoutMs, keepDump) {
  inFlight += 1;
  try {
    return await testModelInner(provider, model, timeoutMs, keepDump);
  } finally {
    inFlight -= 1;
  }
}

async function testModelInner(provider, model, timeoutMs, keepDump) {
  const headers = { "Content-Type": "application/json" };
  if (provider.apiKey) headers.Authorization = `Bearer ${provider.apiKey}`;

  // Streamed, and with no max_tokens, which is what HeartCode sends.
  //
  // On a single request this makes no difference — measured, four models
  // serially came out the same either way. At a hundred-odd in flight it
  // makes all of it: a buffered reply holds the connection until the
  // provider has written the whole thing, and a hundred of those through one
  // rotator queue behind each other. Streaming, the first bytes come back at
  // once and the connection clears. 127 in flight with 2 finished at two
  // seconds was the shape of the problem.
  const body = {
    model,
    messages: [{ role: "user", content: "Reply with just the word OK." }],
    stream: true,
  };
  // Pretty-printing the request and the reply for every model costs real CPU
  // on a run of a thousand, and that CPU is the same event loop driving the
  // requests. Only a single Test keeps them, which is the only place they
  // are ever read.
  const sent = keepDump ? JSON.stringify(body, null, 2) : "";
  const startedAt = Date.now();

  try {
    const res = await fetch(`${provider.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const ms = Date.now() - startedAt;
    const text = await res.text();

    // "text" rather than a needs-based kind: this request carries no tools,
    // no image and no document, so that is the bucket it belongs in.
    record({ baseUrl: provider.baseUrl, model, kind: "text", status: res.status, ms });

    let got = "";
    if (keepDump) {
      got = text;
      try {
        got = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        // Not JSON — an HTML error page, most likely. Shown as it came.
      }
    }

    // A 429 usually says when to come back. Honouring it beats guessing,
    // and a run that waits the stated time turns a rate limit into a result
    // instead of recording the model as broken.
    const after = Number(res.headers.get("retry-after"));

    return {
      ok: res.ok,
      status: res.status,
      ms,
      retryAfter: Number.isFinite(after) && after > 0 ? after : undefined,
      sent: keepDump ? trim(sent) : undefined,
      got: keepDump ? trim(got) : undefined,
      error: res.ok ? undefined : reasonFrom(text) || `HTTP ${res.status}`,
    };
  } catch (err) {
    const ms = Date.now() - startedAt;
    record({ baseUrl: provider.baseUrl, model, kind: "text", status: 0, ms });
    // "The operation was aborted due to timeout" is the runtime's wording for
    // something the person asked for, so say what actually happened.
    const timedOut = err.name === "TimeoutError" || /timeout/i.test(err.message);
    return {
      ok: false,
      status: 0,
      ms,
      sent: trim(sent),
      error: timedOut ? `no answer within ${Math.round(timeoutMs / 1000)}s` : err.message,
    };
  }
}

// Providers say why in a dozen shapes: a JSON envelope, a bare string, or a
// whole HTML error page. Pull out the sentence if there is one, and failing
// that collapse it onto a line, because a 403 from Google is a document.
function reasonFrom(body) {
  try {
    const parsed = JSON.parse(body);
    for (const candidate of [parsed?.error?.message, parsed?.message, parsed?.detail, parsed?.title, parsed?.error]) {
      if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
    }
  } catch {
    // Fall through to the flattened text.
  }
  return body.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 300);
}

// --- test runs -------------------------------------------------------------
// Runs live here rather than in the page, which is how HeartCode does it and
// the reason its runs are quick. A browser holds six connections to one
// origin on HTTP/1.1, so a page firing thirty-six slow requests at its own
// panel gets six at a time however many lanes it thinks it has. From here
// there is no such ceiling. Closing the tab no longer stops a run either,
// and the results are still here when you come back.
// --- what is kept on disk --------------------------------------------------
// Test results and provider model lists both used to live only in memory, so
// a restart threw away a run that had taken minutes and every provider had
// to be asked for its catalogue again on every visit.
function readJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

// Written a moment after the last change rather than on every one: a run
// lands hundreds of results a second and each would otherwise be a file
// write.
function saveLater(path, get) {
  let timer = null;
  return () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      try {
        mkdirSync(GLOBAL_CONFIG_DIR, { recursive: true });
        writeFileSync(path, JSON.stringify(get()), { mode: 0o600 });
      } catch {
        // A full disk should not take a run down with it.
      }
    }, 1000);
  };
}

const tests = readJson(TESTS_PATH, {});
const saveTests = saveLater(TESTS_PATH, () => tests);

// baseUrl -> { models, error, at }
const catalogues = readJson(CATALOGUES_PATH, {});
const saveCatalogues = saveLater(CATALOGUES_PATH, () => catalogues);
let run = null;

const testKey = (baseUrl, model) => `${baseUrl}|${model}`;

// A 429 is the provider saying "not now", so the model is tried again rather
// than written down as broken.
//
// These numbers look over-patient on a short list and are not. A shorter
// ladder (5s, 10s, 20s) was measured against this one on the full 1482-model
// catalogue: it came back before the limit had cleared, earned another 429,
// and spent the run thrashing between short pauses — 17.8 models a second
// against 38. Waiting 15 seconds once beats waiting 5 seconds three times.
//
// A Retry-After from the provider still wins over the ladder.
const RATE_TRIES = 4;
const FIRST_BACKOFF = 15000;
const MAX_BACKOFF = 120000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function runState() {
  if (!run) return { running: false };
  const paused = {};
  for (const [name, p] of run.provs) {
    const left = p.until - Date.now();
    if (left > 0) paused[name] = Math.ceil(left / 1000);
  }
  return {
    running: true,
    total: run.total, done: run.done, good: run.good,
    lanes: run.lanes, stopping: run.stopping, paused, inFlight,
  };
}

// Progress goes out at most this often. Every result used to emit, and so
// did every worker on every pass of a pause: at sixteen lanes across nine
// providers that is a hundred and forty workers, several hundred events a
// second, each one re-serialising the whole run. The page drowned and the
// progress strip stopped moving, which read as the run being stuck.
const PROGRESS_EVERY_MS = 250;
let lastProgress = 0;
let progressTimer = null;

function sendProgress(force) {
  if (progressTimer) {
    clearTimeout(progressTimer);
    progressTimer = null;
  }
  const wait = PROGRESS_EVERY_MS - (Date.now() - lastProgress);
  if (!force && wait > 0) {
    // Nothing is lost by coalescing: the state is read when it is sent, so a
    // late send carries the newest numbers rather than the ones that were
    // current when it was asked for.
    progressTimer = setTimeout(() => {
      progressTimer = null;
      sendProgress(true);
    }, wait);
    return;
  }
  lastProgress = Date.now();
  bus.emit("testrun", runState());
}

async function startRun(items) {
  const live = loadState();
  const timeoutMs = live.testTimeout * 1000;
  // Your setting, and one more lane per hundred models so a long list keeps
  // scaling.
  const lanes = Math.max(live.testLanes, Math.ceil(items.length / 100));

  run = { total: items.length, done: 0, good: 0, lanes, stopping: false, provs: new Map() };

  for (const t of items) {
    const provider = live.providers[t.index];
    if (!provider) continue;
    const name = displayName(provider);
    if (!run.provs.has(name)) {
      run.provs.set(name, {
        provider, queue: [], cap: lanes, until: 0, pausedAt: 0,
        backoff: FIRST_BACKOFF, refused: new Map(), live: 0,
      });
    }
    run.provs.get(name).queue.push(t.model);
  }
  run.total = [...run.provs.values()].reduce((n, p) => n + p.queue.length, 0);
  sendProgress(true);

  // The pauses counting down, which nothing else reports now that a waiting
  // worker is silent.
  const ticker = setInterval(() => {
    if (run && Object.keys(runState().paused).length) sendProgress(true);
  }, 1000);

  // Worker n of a provider: takes its next model while there is one and n is
  // under the cap. A provider that says it is busy drops its cap to one, so
  // the others finish and leave; the last never does, or the queue would
  // never drain.
  const worker = async (p, n) => {
    while (!run.stopping && p.queue.length) {
      if (p.until > Date.now()) {
        await sleep(Math.min(200, p.until - Date.now()));
        continue;
      }
      // Over the cap: wait for it to come back rather than leave. Exiting
      // here is what made a busy provider stay at one lane for the whole
      // run — measured, the in-flight count collapsed from 127 to 15 within
      // ten seconds and never recovered. One worker always carries on, or a
      // queue narrowed to one lane would never drain.
      if (n >= p.cap && n > 0) {
        await sleep(150);
        continue;
      }

      const model = p.queue.shift();
      const key = testKey(p.provider.baseUrl, model);
      const sentAt = Date.now();
      const outcome = await testModel(p.provider, model, timeoutMs, false);

      if (outcome.status === 429) {
        const times = (p.refused.get(key) ?? 0) + 1;
        p.refused.set(key, times);
        p.cap = 1;
        // One pause per burst: refusals of requests sent before the current
        // pause began are the same burst and must not extend it again.
        if (!(sentAt < p.pausedAt)) {
          p.pausedAt = Date.now();
          p.until = Date.now() + Math.min(MAX_BACKOFF, outcome.retryAfter > 0 ? outcome.retryAfter * 1000 : p.backoff);
          p.backoff = Math.min(MAX_BACKOFF, p.backoff * 2);
        }
        if (times < RATE_TRIES) {
          p.queue.push(model);
          sendProgress();
          continue;
        }
        outcome.error = `the provider kept saying it is busy (429), ${times} times with pauses between: try it again later`;
      } else {
        // Anything that is not a 429 means the provider is talking to us: a
        // 402 or a 404 is an answer about the model, not a complaint about
        // the rate. So it gets its lanes back.
        //
        // This used to require a success, and these lists are mostly models
        // the account cannot use. One 429 therefore pinned a provider at a
        // single lane for the rest of the run: measured, 785 models finished
        // in the first three seconds and the remaining six hundred trickled
        // out one at a time behind two throttled providers.
        p.backoff = FIRST_BACKOFF;
        p.cap = lanes;
      }

      tests[key] = { ...outcome, at: Date.now() };
      saveTests();
      run.done += 1;
      if (outcome.ok) run.good += 1;
      bus.emit("tested", { key, result: tests[key] });
      sendProgress();
    }
    p.live -= 1;
  };

  const all = [];
  for (const p of run.provs.values()) {
    p.live = Math.min(lanes, p.queue.length);
    for (let n = 0; n < p.live; n++) all.push(worker(p, n));
  }

  try {
    await Promise.all(all);
  } finally {
    clearInterval(ticker);
    if (progressTimer) {
      clearTimeout(progressTimer);
      progressTimer = null;
    }
    const over = { ...runState(), running: false, over: true };
    run = null;
    await onSaveRef?.();
    bus.emit("testrun", over);
  }
}

// Set by runPanel, so a finished run can tell the proxy to look again.
let onSaveRef = null;

export const DEFAULT_PANEL_PORT = 3450;

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    // localhost only — this edits your API keys.
    server.listen(port, "localhost", () => resolve(server));
  });
}

export async function runPanel({ port = DEFAULT_PANEL_PORT, onSave } = {}) {
  // Warmed in the background so the first page load has it, and ignored if
  // it fails: everything here works without a catalogue, just with less to
  // show.
  loadCatalog().catch(() => {});
  onSaveRef = onSave;

  const server = createServer(async (req, res) => {
    const path = req.url.split("?")[0];

    try {
      if (req.method === "GET" && (path === "/" || path === "/index.html")) {
        // The page is built fresh from source on every request and has no
        // URL to version, so a cached copy is only ever a stale one. Without
        // this a browser keeps serving yesterday's panel after an upgrade,
        // and the only cure is a hard reload nobody thinks to do.
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store, must-revalidate",
        });
        res.end(page());
        return;
      }

      if (req.method === "GET" && path === "/api/state") {
        json(res, 200, loadState());
        return;
      }

      // What has actually worked. This is the whole of what decides routing,
      // so the page shows it per model and per kind of request.
      if (req.method === "GET" && path === "/api/stats") {
        // Coverage below reads the catalogue, so it has to be loaded first or
        // the first paint reports every model as untested and offers to probe
        // the lot.
        await loadCatalog();
        const { providers } = loadState();
        const cooling = {};
        for (const p of providers) {
          for (const model of p.models) {
            const ms = coolingFor(p.baseUrl, model);
            if (ms) cooling[p.baseUrl + "|" + model] = ms;
          }
        }
        json(res, 200, {
          cooling,
          rows: allStats().map((row) => ({ ...row, rate: successRate(row) })),
        });
        return;
      }

      // Start over. Every model goes back to untried and routing is even
      // odds again until real requests fill it back in.
      if (req.method === "POST" && path === "/api/stats/reset") {
        json(res, 200, resetStats());
        return;
      }

      if (req.method === "POST" && path === "/api/state") {
        const body = await readBody(req);
        writeStoredConfig({
          providers: body.providers ?? [],
          port: body.port,
          streaming: body.streaming !== false,
          rank: Array.isArray(body.rank) ? body.rank : [],
          testTimeout: Number(body.testTimeout) || undefined,
          testLanes: Number(body.testLanes) || undefined,
        });
        json(res, 200, loadState());
        // The proxy may have been waiting for exactly this.
        await onSave?.();
        return;
      }

      // Start, stop, and what is known so far. The page asks for a run and
      // then watches; it never drives one itself.
      if (req.method === "POST" && path === "/api/tests/start") {
        if (run) {
          json(res, 409, { error: "a test run is going already" });
          return;
        }
        const body = await readBody(req);
        const live = loadState();
        const items = Array.isArray(body.only) && body.only.length
          ? body.only
          : live.providers.flatMap((p, index) =>
              p.disabled ? [] : p.models.map((model) => ({ index, model })));

        if (!items.length) {
          json(res, 200, { ...runState(), results: tests });
          return;
        }
        // Answer at once; the run reports itself over /api/events.
        startRun(items).catch(() => {});
        json(res, 200, { ...runState(), results: tests });
        return;
      }

      if (req.method === "POST" && path === "/api/tests/stop") {
        if (run) run.stopping = true;
        json(res, 200, runState());
        return;
      }

      // `since` asks for only the results newer than a moment, which is what
      // the page polls with while a run is going.
      //
      // The stream is the fast path, not the only one. An event stream that
      // drops — and one does, under a few hundred results a second — takes
      // every event with it, because there is nothing to replay. The page
      // caught up to nothing and sat there looking seized while the run was
      // still going: measured at 318 of 1471 on screen against 650 here.
      if (req.method === "GET" && path === "/api/tests") {
        const since = Number(new URL(req.url, "http://localhost").searchParams.get("since"));
        let results = tests;
        if (Number.isFinite(since) && since > 0) {
          results = {};
          for (const [key, value] of Object.entries(tests)) {
            if (value.at > since) results[key] = value;
          }
        }
        json(res, 200, { ...runState(), results, now: Date.now() });
        return;
      }

      if (req.method === "POST" && path === "/api/test") {
        // `kind` used to be accepted here and quietly ignored: testModel has
        // taken no such argument since the capability probes were removed.
        const { index, model } = await readBody(req);
        const live = loadState();
        const provider = live.providers[index];
        if (!provider) {
          json(res, 404, { ok: false, error: "no such provider" });
          return;
        }
        // Read fresh, so changing the timeout in the panel applies to the
        // next test without a restart.
        const outcome = await testModel(provider, model, live.testTimeout * 1000, true);
        tests[testKey(provider.baseUrl, model)] = { ...outcome, at: Date.now() };
        saveTests();
        bus.emit("tested", { key: testKey(provider.baseUrl, model), result: tests[testKey(provider.baseUrl, model)] });
        // A model that just answered may be the one the proxy was waiting for.
        await onSave?.();
        json(res, 200, outcome);
        return;
      }

      // Every request the proxy has served, newest first. The page filters
      // these itself: the whole list is at most a few hundred summaries.
      if (req.method === "GET" && path === "/api/requests") {
        json(res, 200, { keep: KEEP, items: listRequests() });
        return;
      }

      if (req.method === "POST" && path === "/api/requests/clear") {
        json(res, 200, clearRequests());
        return;
      }

      // What models.dev says about the models you have configured: context
      // window, price, and whether it lists them as calling tools or reading
      // images. A hint shown beside the record, never instead of it.
      if (req.method === "GET" && path === "/api/catalog") {
        await loadCatalog();
        const { providers } = loadState();
        const known = {};
        for (const p of providers) {
          for (const model of p.models) {
            const info = lookupModel(p.baseUrl, model);
            if (info) known[p.baseUrl + "|" + model] = info;
          }
        }
        json(res, 200, { known, size: catalogSize(), age: catalogAge() });
        return;
      }

      if (req.method === "POST" && path === "/api/catalog/refresh") {
        try {
          await loadCatalog({ force: true });
          json(res, 200, { size: catalogSize(), age: catalogAge() });
        } catch (err) {
          json(res, 200, { error: err.message, size: catalogSize(), age: catalogAge() });
        }
        return;
      }

      // Server-sent events, so a request served by the proxy shows up in the
      // page without it polling. The payload is only ever "something
      // changed": the page refetches what it needs, which keeps one copy of
      // the rule for what each view shows.
      if (req.method === "GET" && path === "/api/events") {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });
        res.write("retry: 2000\n\n");

        const send = (what) => {
          if (!res.writableEnded) res.write(`data: ${JSON.stringify({ what })}\n\n`);
        };
        const onRequest = () => send("request");
        const onCleared = () => send("requests-cleared");
        // These two carry a payload: the page needs the result itself, not a
        // nudge to go and refetch every result it already has.
        const onTested = (e) => {
          if (!res.writableEnded) res.write(`data: ${JSON.stringify({ what: "tested", ...e })}\n\n`);
        };
        const onRun = (state) => {
          if (!res.writableEnded) res.write(`data: ${JSON.stringify({ what: "testrun", run: state })}\n\n`);
        };
        bus.on("request", onRequest);
        bus.on("requests-cleared", onCleared);
        bus.on("tested", onTested);
        bus.on("testrun", onRun);

        // Proxies and browsers drop an idle event stream; a comment line
        // every twenty seconds is enough to keep it open and costs nothing.
        const beat = setInterval(() => {
          if (!res.writableEnded) res.write(": beat\n\n");
        }, 20000);

        req.on("close", () => {
          clearInterval(beat);
          bus.off("request", onRequest);
          bus.off("requests-cleared", onCleared);
          bus.off("tested", onTested);
          bus.off("testrun", onRun);
        });
        return;
      }

      // The provider's own catalogue, so you can pick a model instead of
      // typing one and finding out later it doesn't exist.
      // A provider's own model list, from the last time it was asked.
      //
      // It used to be fetched on every visit, so adding a provider, picking
      // models, leaving and coming back meant waiting for all of them again.
      // Kept on disk now and only refetched when you press Refresh, or when
      // nothing has ever been fetched for that backend.
      if (req.method === "GET" && path === "/api/catalogue") {
        const url = new URL(req.url, "http://localhost");
        const index = Number(url.searchParams.get("index"));
        const fresh = url.searchParams.get("fresh") === "1";
        const provider = loadState().providers[index];
        if (!provider) {
          json(res, 404, { models: [] });
          return;
        }

        const cached = catalogues[provider.baseUrl];
        if (cached && !fresh) {
          // models.dev may know more than it did when this was stored, so
          // the facts are attached now rather than frozen in with the names.
          await loadCatalog();
          json(res, 200, {
            models: cached.models.map((id) => ({ id, ...(lookupModel(provider.baseUrl, id) ?? {}) })),
            error: cached.error || undefined,
            at: cached.at,
            cached: true,
          });
          return;
        }

        const headers = {};
        if (provider.apiKey) headers.Authorization = `Bearer ${provider.apiKey}`;
        try {
          const upstream = await fetch(`${provider.baseUrl}/models`, {
            headers,
            signal: AbortSignal.timeout(30000),
          });
          // A backend that refuses to list is worth saying out loud rather
          // than showing as an empty catalogue: "this provider has no
          // models" and "this provider would not tell us" are different
          // problems with different fixes.
          if (!upstream.ok) {
            const error = `${upstream.status} ${(await upstream.text()).slice(0, 200)}`;
            // Remembered too: a provider that will not list should not be
            // asked again on every visit either.
            catalogues[provider.baseUrl] = { models: cached?.models ?? [], error, at: Date.now() };
            saveCatalogues();
            json(res, 200, { models: [], error });
            return;
          }
          const body = await upstream.json();
          const data = Array.isArray(body) ? body : (body.data ?? []);
          const ids = data.map((m) => m.id).filter(Boolean).sort();

          catalogues[provider.baseUrl] = { models: ids, error: "", at: Date.now() };
          saveCatalogues();

          await loadCatalog();
          json(res, 200, {
            models: ids.map((id) => ({ id, ...(lookupModel(provider.baseUrl, id) ?? {}) })),
            at: catalogues[provider.baseUrl].at,
          });
        } catch (err) {
          catalogues[provider.baseUrl] = { models: cached?.models ?? [], error: err.message, at: Date.now() };
          saveCatalogues();
          json(res, 200, { models: cached?.models?.map((id) => ({ id })) ?? [], error: err.message });
        }
        return;
      }

      json(res, 404, { error: "not found" });
    } catch (err) {
      json(res, 500, { error: err.message });
    }
  });

  // Taken rather than asked for: one command should not open with two
  // questions. If the port is busy we move up until one is free.
  let chosen = port;
  for (let tries = 0; tries < 20; tries++) {
    try {
      await listen(server, chosen);
      return server;
    } catch (err) {
      if (err.code !== "EADDRINUSE") throw err;
      chosen += 1;
    }
  }
  throw new Error(`no free port for the panel between ${port} and ${chosen}`);
}

export function openBrowser(url) {
  // Headless machines and test runs don't want a browser launched at them.
  if (process.env.OPENCC_NO_BROWSER) return;
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  try {
    // Detached and ignored: if no browser can be opened we just print the URL.
    spawn(cmd, [url], { stdio: "ignore", detached: true, shell: process.platform === "win32" }).unref();
  } catch {
    /* printed by the caller either way */
  }
}
