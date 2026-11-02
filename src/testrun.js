// Test runs. They live on the server, not in the page: a browser holds six
// connections to one origin on HTTP/1.1, so a page firing thirty-six slow
// requests at its own panel gets six at a time however many lanes it thinks
// it has. From here there is no such ceiling, and closing the tab no longer
// stops a run.
//
// Every provider at once, a few models at a time from each. A provider that
// says it is busy (429) is not giving a verdict on the model: it drops to one
// lane, waits as long as it asks, and the model goes back on the queue.
import { bus } from "./events.js";
import { record } from "./stats.js";
import { loadConfig, tryModel } from "./providers.js";

// Test results are what is true right now, not a record. They are cleared
// when the panel starts, again for every model a run covers, and whenever a
// provider changes, because a result from an hour ago sitting beside one from
// this second reads as one set of numbers and is not. The record in
// stats.jsonl is what remembers, and it is separate.
export const tests = {};
// By provider NAME, not address: two providers can share an address (the same
// gateway with two keys) and their results are not the same results.
export const testKey = (providerName, model) => `${providerName}|${model}`;

let run = null;
export const running = () => run !== null;

// How many requests this process has out to providers right now. Reported
// with the run, because "it has gone quiet" and "it is waiting on a hundred
// replies" look identical from the outside and need different fixes.
let inFlight = 0;

// Set by the panel, so a finished run can tell the proxy to look again: a
// model that has just answered may be the one it was waiting for.
let afterRun = null;
export const onRunEnd = (fn) => {
  afterRun = fn;
};

export function forgetTests() {
  for (const key of Object.keys(tests)) delete tests[key];
  bus.emit("testsforgotten");
}

// One test, recorded like any other call so the Record column has something
// in it before Claude Code sends the first request.
async function tryOne(provider, model, timeoutMs) {
  inFlight += 1;
  try {
    const outcome = await tryModel(provider, model, timeoutMs);
    record({
      baseUrl: provider.baseUrl, model, kind: "text", status: outcome.status, ms: outcome.ms,
      // A 200 that said nothing is not a success, whatever the status line says.
      verdict: outcome.status === 200 && !outcome.ok ? "empty" : undefined,
    });
    return outcome;
  } finally {
    inFlight -= 1;
  }
}

// A single test, on its own: it does not wait for a run and a run does not
// wait for it.
export async function testOne(providerName, model) {
  const live = loadConfig();
  const provider = live.providers.find((p) => p.name === providerName);
  if (!provider) throw new Error(`no provider "${providerName}"`);

  const outcome = await tryOne(provider, model, live.testTimeout * 1000);
  const key = testKey(provider.name, model);
  tests[key] = { ...outcome, at: Date.now() };
  bus.emit("tested", { key, result: tests[key] });
  return tests[key];
}

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

export function runState() {
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

// Progress goes out at most this often. Every result used to emit, and so did
// every worker on every pass of a pause: at sixteen lanes across nine
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

export function stopRun() {
  if (run && !run.stopping) {
    run.stopping = true;
    sendProgress(true);
  }
}

// items: [{ provider: <name>, model }]. Resolves when the run is over.
export async function startRun(items) {
  const live = loadConfig();
  const timeoutMs = live.testTimeout * 1000;
  // Your setting, and one more lane per hundred models so a long list keeps
  // scaling.
  const lanes = Math.max(live.testLanes, Math.ceil(items.length / 100));

  run = { total: 0, done: 0, good: 0, lanes, stopping: false, provs: new Map() };

  for (const t of items) {
    const provider = live.providers.find((p) => p.name === t.provider);
    if (!provider) continue;
    // Whatever this model said last time goes now, so the counts under the
    // strip are this run's and nothing else's.
    delete tests[testKey(provider.name, t.model)];

    if (!run.provs.has(provider.name)) {
      run.provs.set(provider.name, {
        provider, queue: [], cap: lanes, until: 0, pausedAt: 0,
        backoff: FIRST_BACKOFF, refused: new Map(), live: 0,
      });
    }
    run.provs.get(provider.name).queue.push(t.model);
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
  // the others wait; one always carries on, or a queue narrowed to one lane
  // would never drain.
  const worker = async (p, n) => {
    while (!run.stopping && p.queue.length) {
      if (p.until > Date.now()) {
        await sleep(Math.min(200, p.until - Date.now()));
        continue;
      }
      // Over the cap: wait for it to come back rather than leave. Exiting here
      // is what made a busy provider stay at one lane for the whole run —
      // measured, the in-flight count collapsed from 127 to 15 within ten
      // seconds and never recovered.
      if (n >= p.cap && n > 0) {
        await sleep(150);
        continue;
      }

      const model = p.queue.shift();
      const key = testKey(p.provider.name, model);
      const sentAt = Date.now();
      const outcome = await tryOne(p.provider, model, timeoutMs);

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
        // Anything that is not a 429 means the provider is talking to us: a 402
        // or a 404 is an answer about the model, not a complaint about the
        // rate. So it gets its lanes back. This used to require a success, and
        // these lists are mostly models the account cannot use, so one 429
        // pinned a provider at a single lane for the rest of the run.
        p.backoff = FIRST_BACKOFF;
        p.cap = lanes;
      }

      tests[key] = { ...outcome, at: Date.now() };
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
    await afterRun?.();
    bus.emit("testrun", over);
  }
}
