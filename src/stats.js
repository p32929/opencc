// What has actually worked, per provider, model and kind of request — and,
// from that alone, which model to call next.
//
// There is no configured priority and no capability detection. A model's
// place in the queue is earned: every request writes down what happened, and
// the next request reads it back. A model that answers tool calls rises for
// tool calls; one that returns 400 on an image sinks for images and keeps its
// place for everything else. Nothing is ever struck off, so a model that was
// broken last week can win its slot back.
//
// Two Claude Code sessions mean two opencc processes writing this at the same
// time. Anything that reads a file, edits it and writes it back loses one of
// the two updates and can leave a half-written document behind, so this is an
// append-only log instead: one JSON object per line, written with a single
// O_APPEND write, which POSIX makes atomic with respect to other appends.
// Nobody locks anything, nobody waits, and a torn line costs one record.
//
// Nothing here is allowed to break a request. Every filesystem call is
// wrapped: if stats can't be written or read, routing carries on without them.
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, renameSync, statSync, unlinkSync } from "node:fs";
import { CAPABILITIES_PATH, GLOBAL_CONFIG_DIR, STATS_PATH } from "./paths.js";

// Past this the log is folded into one line per key. Big enough that it
// happens rarely, small enough that reading it stays trivial.
const COMPACT_AT_BYTES = 256 * 1024;

const DAY_MS = 86400000;

// How fast the past stops counting. A week-old result carries about a third
// of the weight of today's, and a month-old one almost none.
//
// Without this the record is an average over all time, which sounds fair and
// behaves badly: a provider that was broken for a day never fully recovers,
// and a model carries its worst week forever. Forgetting is most of what
// makes the thing adaptive rather than merely tallied.
const HALF_LIFE_DAYS = 4;

// Past this a day's results are worth under a percent of today's, so keeping
// them only makes the sum longer. Without pruning, a year of use turned a
// 1.4us lookup into 147us, times every model, on every request.
const KEEP_DAYS = 8 * HALF_LIFE_DAYS;

// Not every failure says the same thing.
//
// "400 this model does not support image input" settles the question on the
// first try: asking again cannot change it. A 429 says the minute was busy
// and nothing about the model. Counting them equally meant a model that had
// told us definitively still needed several more failures to sink, while a
// model that was merely throttled sank alongside it.
const CONCLUSIVE = 4;   // it told us, and it will keep telling us
const ORDINARY = 1;     // a plain refusal, no explanation
const PASSING = 0.25;   // busy, broken or unreachable right now

// Does this failure mean "the request was too big" rather than "this model
// cannot do that"?
//
// Written against what these providers actually say, captured by sending
// deliberately oversized requests rather than guessed:
//
//   ollama  400  The prompt is too long: 133418, model maximum context
//                length: 131072
//   z.ai    400  Prompt exceeds max length
//
// The rest are the phrasings OpenAI and Anthropic use, which most
// OpenAI-compatible backends copy.
const TOO_BIG = /prompt is too long|exceeds max length|maximum context length|context[_ ]length[_ ]exceeded|too many tokens|input is too long|reduce the length|request too large|payload too large/i;

export function isTooBig(status, body = "") {
  if (status === 413) return true;
  if (status !== 400 && status !== 422) return false;
  return TOO_BIG.test(body);
}

export function weightOf(status) {
  if (status >= 200 && status < 300) return 0;
  // Checked first: 501 is "not implemented", which is a settled answer even
  // though it sits in the 5xx range where everything else is a wobble.
  if ([400, 401, 402, 403, 404, 413, 422, 501].includes(status)) return CONCLUSIVE;
  if (status === 0 || status === 408 || status === 425 || status === 429 || status >= 500) return PASSING;
  return ORDINARY;
}

// --- what a request needs --------------------------------------------------

// Claude Code puts images in user content blocks and tools at the top level,
// so both are cheap to spot.
export function requirementsOf(anthropicReq) {
  const tools = Array.isArray(anthropicReq.tools) && anthropicReq.tools.length > 0;

  let vision = false;
  let documents = false;
  for (const message of anthropicReq.messages ?? []) {
    if (!Array.isArray(message.content)) continue;
    for (const block of message.content) {
      if (block.type === "image") vision = true;
      if (block.type === "document") documents = true;
    }
  }

  return { tools, vision, documents };
}

// One bucket per kind of request. This is the whole of what used to be
// capability detection: "can this model call tools" is answered by whether it
// has ever answered a tools request, which is a thing we find out for free
// every time we send one.
// Most demanding first. A request carrying a PDF needs a model that takes
// PDFs, whatever else is in it.
export const kindOf = (needs) =>
  needs.documents ? "document" : needs.vision ? "image" : needs.tools ? "tools" : "text";

export function describeNeeds(needs) {
  const parts = [];
  if (needs.tools) parts.push("tool calling");
  if (needs.vision) parts.push("images");
  if (needs.documents) parts.push("documents");
  return parts.length ? parts.join(" + ") : "plain text";
}

// Every bucket a request can land in. "text" is still one of them, because a
// request carrying no tools, no image and no PDF has to be filed somewhere
// and folding it into "tools" would credit a model that cannot call tools.
export const KINDS = ["text", "tools", "image", "document"];

// What Claude Code actually asks for, and so the only things worth testing
// and showing. It puts tools on nearly every request, so a bare text request
// is rare enough that probing for it proves nothing and clutters the page.
// What a 200 actually delivered.
//
// Only facts here, nothing that needs judgement. The tempting fourth check -
// "tools were offered and none came back" - is not a fact: Claude Code puts
// tools on nearly every request, and answering "what does this function do?"
// in prose is correct. It only counts when tool_choice demanded a call.
export const TOO_BIG_VERDICT = "too_big";

// The reply started arriving and then stopped. Worse than a refusal: the
// request cannot be retried, because Claude Code already has half an answer.
export const STREAM_DIED_VERDICT = "stream_died";

export function verdictFor(anthropicReq, { blocks, toolUse, badArguments }) {
  if (blocks === 0) return "empty";
  if (badArguments) return "bad_arguments";

  const choice = anthropicReq?.tool_choice?.type;
  if ((choice === "any" || choice === "tool") && !toolUse) return "no_tool_call";

  return "ok";
}

export const NEEDED = ["tools", "image", "document"];

// --- writing ---------------------------------------------------------------

const keyOf = (baseUrl, model, kind) => `${baseUrl}\u0000${model}\u0000${kind}`;

// Outcomes are counted in memory and written in batches.
//
// One line per request repeated the provider URL and the model name every
// time, which is most of 126 bytes to say "that happened again", and paid for
// a synchronous write on every one. A batch says it once with a number beside
// it.
//
// Still appended rather than rewritten. A counters document would have to be
// read, edited and written back, and two opencc processes doing that lose one
// of the two updates - which is the whole reason this is a log and not a
// file of totals.
const FLUSH_AFTER_MS = 2000;
const FLUSH_AT_KEYS = 64;

let pending = new Map();
let flushTimer = null;

function pendingKey(baseUrl, model, kind, status, verdict) {
  return `${baseUrl}\u0000${model}\u0000${kind}\u0000${status}\u0000${verdict ?? ""}`;
}

export function record({ baseUrl, model, kind, status, ms, verdict, chars }) {
  const key = pendingKey(baseUrl, model, kind, status, verdict);
  const row = pending.get(key) ?? { p: baseUrl, m: model, k: kind, s: status, n: 0 };
  row.n += 1;
  if (verdict && verdict !== "ok") row.q = verdict;

  // Summed, not averaged, so a batch of five carries the same weight as five
  // separate lines would have.
  if (Number.isFinite(ms) && status >= 200 && status < 300) row.ms = (row.ms ?? 0) + Math.round(ms);
  if (Number.isFinite(chars)) {
    // The largest answered and the smallest refused are what bracket the
    // size ceiling, so a batch keeps whichever end matters for its outcome.
    row.c = row.c === undefined ? chars
      : (status >= 200 && status < 300 ? Math.max(row.c, chars) : Math.min(row.c, chars));
  }
  pending.set(key, row);

  if (pending.size >= FLUSH_AT_KEYS) {
    flush();
    return;
  }
  if (flushTimer === null) {
    flushTimer = setTimeout(flush, FLUSH_AFTER_MS);
    // Never a reason to hold the process open for statistics.
    flushTimer.unref?.();
  }
}

export function flush() {
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (pending.size === 0) return;

  const batch = [...pending.values()];
  pending = new Map();

  try {
    mkdirSync(GLOBAL_CONFIG_DIR, { recursive: true });
    appendFileSync(STATS_PATH, `${JSON.stringify({ t: Date.now(), b: batch })}\n`, { mode: 0o600 });
    maybeCompact();
  } catch {
    // Stats are an optimisation. Losing them must never cost a request.
  }
}

// Whatever is still buffered when the process goes. A kill -9 loses it, which
// costs a couple of seconds of statistics and nothing else.
process.on("exit", flush);

// --- reading ---------------------------------------------------------------

// Folding the whole log on every request would be wasteful, so the aggregate
// is kept in memory and only the bytes appended since last time are read.
// A file that shrank means someone compacted it, so start over.
let cache = { offset: 0, agg: new Map() };

function foldLine(agg, line) {
  let parsed;
  try {
    parsed = JSON.parse(line);
  } catch {
    // A process killed mid-append leaves one unparseable line. Skip it.
    return;
  }
  if (!parsed) return;

  // A batch carries its own timestamp for everything in it. Lines written
  // before batching are single events and still read fine.
  if (Array.isArray(parsed.b)) {
    for (const row of parsed.b) foldEvent(agg, { ...row, t: parsed.t });
    return;
  }
  foldEvent(agg, parsed);
}

function foldEvent(agg, event) {
  if (!event || typeof event.p !== "string" || typeof event.m !== "string") return;

  const key = keyOf(event.p, event.m, event.k ?? "text");
  const entry = agg.get(key) ?? { ok: 0, fail: 0, statuses: {}, days: {}, lastOk: 0, lastFail: 0, totalMs: 0, timed: 0, maxOk: 0, minTooBig: Infinity };
  const n = Number.isFinite(event.n) ? event.n : 1;
  const status = Number(event.s) || 0;
  const when = event.t ?? Date.now();

  // A 200 that came back empty, or with tool arguments nothing can parse, is
  // not a success however polite the status line was.
  const usable = status >= 200 && status < 300 && !event.q;

  // Kept per day as well as in total, so the router can weigh what happened
  // this week more heavily than what happened last month. See `decayed`.
  const day = Math.floor(when / DAY_MS);
  const bucket = entry.days[day] ?? (entry.days[day] = { ok: 0, fail: 0, weighted: 0 });

  // Drop anything the discount has already reduced to noise. The totals above
  // keep the whole history; only the per-day detail is trimmed.
  const kept = Object.keys(entry.days);
  if (kept.length > KEEP_DAYS) {
    const cutoff = day - KEEP_DAYS;
    for (const old of kept) {
      if (Number(old) < cutoff) delete entry.days[old];
    }
  }

  if (usable) {
    entry.ok += n;
    bucket.ok += n;
    entry.lastOk = Math.max(entry.lastOk, when);
    if (Number.isFinite(event.ms)) {
      // Already a total: a batch sums the time over its n outcomes, and a
      // single event is a batch of one. Multiplying by n again counted each
      // batch n times over.
      entry.totalMs += event.ms;
      entry.timed += n;
    }
    if (Number.isFinite(event.c)) entry.maxOk = Math.max(entry.maxOk, event.c);
  } else {
    entry.fail += n;
    bucket.fail += n;
    // The smallest request this model has refused for being too big. With
    // maxOk above, the real ceiling is somewhere between the two, and the
    // gap closes on its own as you use it.
    if (event.q === TOO_BIG_VERDICT && Number.isFinite(event.c)) {
      entry.minTooBig = Math.min(entry.minTooBig, event.c);
    }
    // What the router actually scores on. `fail` stays the plain count, so
    // the panel can still show "3 of 19 answered" without explaining a
    // weighting scheme to anybody.
      // A 200 that delivered nothing is the model telling us it cannot do
    // this, same as a 400 would. An oversized request is the opposite: it
    // says nothing about the model, so it carries no weight at all. It is
    // still kept, because it is how the size ceiling is learned.
    bucket.weighted += n * (event.q === TOO_BIG_VERDICT ? 0 : event.q ? CONCLUSIVE : weightOf(status));
    entry.lastFail = Math.max(entry.lastFail, when);
  }
  entry.statuses[status] = (entry.statuses[status] ?? 0) + n;
  agg.set(key, entry);
}

function readFrom(offset) {
  // Read only the tail, and only up to the last complete line — a partial
  // line at the end is someone else's append still in flight.
  const fd = openSync(STATS_PATH, "r");
  try {
    const { size } = statSync(STATS_PATH);
    if (size <= offset) return { text: "", consumed: offset };
    const buf = Buffer.allocUnsafe(size - offset);
    const read = readSync(fd, buf, 0, buf.length, offset);
    const text = buf.subarray(0, read).toString("utf8");
    const cut = text.lastIndexOf("\n");
    if (cut === -1) return { text: "", consumed: offset };
    return { text: text.slice(0, cut + 1), consumed: offset + Buffer.byteLength(text.slice(0, cut + 1)) };
  } finally {
    closeSync(fd);
  }
}

export function aggregate() {
  try {
    if (!existsSync(STATS_PATH)) return cache.agg;
    const { size } = statSync(STATS_PATH);

    if (size < cache.offset) cache = { offset: 0, agg: new Map() };
    if (size === cache.offset) return cache.agg;

    const { text, consumed } = readFrom(cache.offset);
    for (const line of text.split("\n")) {
      if (line) foldLine(cache.agg, line);
    }
    cache.offset = consumed;
    return cache.agg;
  } catch {
    return cache.agg;
  }
}

export function statsFor(baseUrl, model, kind) {
  return aggregate().get(keyOf(baseUrl, model, kind)) ?? null;
}

// The same model's record at every *other* kind, summed. Used as a weak prior
// the first time it is asked to do something new: a model that answers text
// reliably is a better first guess for tools than one that answers nothing.
export function statsForOtherKinds(baseUrl, model, kind) {
  let ok = 0;
  let fail = 0;
  const days = {};
  for (const other of KINDS) {
    if (other === kind) continue;
    const entry = statsFor(baseUrl, model, other);
    if (!entry) continue;
    ok += entry.ok;
    fail += entry.fail;
    // Merged per day too, so these get the same discount for age.
    for (const [day, counts] of Object.entries(entry.days ?? {})) {
      const bucket = days[day] ?? (days[day] = { ok: 0, fail: 0 });
      bucket.ok += counts.ok;
      bucket.fail += counts.fail;
    }
  }
  return ok + fail === 0 ? null : { ok, fail, days };
}

// The same record with age discounted. An entry that predates day buckets,
// or one hand-built in a test, is used as-is.
export function decayed(entry, now = Date.now()) {
  if (!entry) return null;
  if (!entry.days) return { ok: entry.ok, fail: entry.fail, weighted: entry.weighted ?? entry.fail };

  const today = Math.floor(now / DAY_MS);
  let ok = 0;
  let fail = 0;
  let weighted = 0;
  for (const [day, counts] of Object.entries(entry.days)) {
    const age = Math.pow(0.5, (today - Number(day)) / HALF_LIFE_DAYS);
    ok += counts.ok * age;
    fail += counts.fail * age;
    weighted += (counts.weighted ?? counts.fail) * age;
  }
  return { ok, fail, weighted };
}

// The plain rate, for showing a human a percentage. Null when there is
// nothing to show, which is different from zero.
// How long this model takes when it does answer, in milliseconds. Null until
// something has been timed.
export function meanMs(entry) {
  if (!entry || !entry.timed) return null;
  return entry.totalMs / entry.timed;
}

export function successRate(entry) {
  if (!entry) return null;
  const total = entry.ok + entry.fail;
  return total === 0 ? null : entry.ok / total;
}

// Everything on record, flattened for display.
export function allStats() {
  const rows = [];
  for (const [key, entry] of aggregate()) {
    const [baseUrl, model, kind] = key.split("\u0000");
    rows.push({
      baseUrl, model, kind,
      ok: entry.ok, fail: entry.fail,
      statuses: entry.statuses,
      lastOk: entry.lastOk, lastFail: entry.lastFail,
    });
  }
  return rows;
}

// How many of your models can serve a given kind of request, as far as anyone
// knows. One definition, used by the panel's coverage strip and by the check
// that decides whether the proxy is worth exposing at all.
//
// "untried" is deliberately its own number rather than being lumped in with
// "cannot": a model nobody has asked is not a model that failed, and the
// difference decides whether a gap is a real problem or just unknown.
export function coverage(providers, kind, lookup = statsFor) {
  let can = 0;
  let cannot = 0;
  let untried = 0;

  for (const provider of providers) {
    if (provider.disabled) continue;
    const parked = provider.disabledModels ?? [];
    for (const model of provider.models) {
      if (parked.includes(model)) continue;
      const entry = lookup(provider.baseUrl, model, kind);
      if (!entry || entry.ok + entry.fail === 0) untried += 1;
      else if (entry.ok > 0) can += 1;
      else cannot += 1;
    }
  }

  return { can, cannot, untried };
}

// --- short-term availability -----------------------------------------------

// Rate limits and outages are not a judgement about the model, they are a
// judgement about the next minute. Holding them against a model's long-run
// record would teach us to avoid a model that is merely busy, so they get
// their own mechanism: a timer, in memory, that pushes the model to the back
// of the queue and then forgets about it. Nothing on disk, nothing to decay,
// gone on restart.
const COOLDOWN_MS = { 429: 60000, 503: 30000, other: 15000 };
const COOLDOWN_CAP_MS = 60 * 60 * 1000;
const cooling = new Map();

// How many times in a row this model has refused without an answer in
// between. A free tier that is merely busy comes back on the first retry; one
// whose daily quota is gone refuses every time until the quota resets, and a
// flat minute means asking it all evening. Each consecutive refusal doubles
// the wait, up to an hour. One answer clears it.
const streaks = new Map();

const coolKey = (baseUrl, model) => `${baseUrl}\u0000${model}`;

export function coolOff(baseUrl, model, status, now = Date.now()) {
  const base = status === 429 ? COOLDOWN_MS[429]
    : status === 503 ? COOLDOWN_MS[503]
    : status === 0 || status >= 500 ? COOLDOWN_MS.other
    : 0;
  if (!base) return 0;

  const key = coolKey(baseUrl, model);
  const streak = (streaks.get(key) ?? 0) + 1;
  streaks.set(key, streak);

  const ms = Math.min(base * Math.pow(2, streak - 1), COOLDOWN_CAP_MS);
  cooling.set(key, now + ms);
  return ms;
}

// Called when a model answers. Whatever run of refusals it was on is over.
export function cooledOffSuccessfully(baseUrl, model) {
  streaks.delete(coolKey(baseUrl, model));
  cooling.delete(coolKey(baseUrl, model));
}

export function coolingFor(baseUrl, model, now = Date.now()) {
  const until = cooling.get(coolKey(baseUrl, model));
  if (until === undefined) return 0;
  if (until <= now) {
    cooling.delete(coolKey(baseUrl, model));
    return 0;
  }
  return until - now;
}

export function clearCooldowns() {
  cooling.clear();
  streaks.clear();
}

// Forget everything and start over.
//
// The log is moved aside rather than deleted, because "reset" and "I would
// like that back" are two minutes apart more often than anyone admits. One
// previous copy is kept; resetting twice overwrites it.
export function resetStats() {
  const previous = `${STATS_PATH}.previous`;
  let moved = false;

  try {
    if (existsSync(STATS_PATH)) {
      renameSync(STATS_PATH, previous);
      moved = true;
    }
  } catch {
    // Nothing to move, or it could not be moved. Either way carry on and
    // clear what is in memory, which is the part that affects routing now.
  }

  // Left over from when capabilities were detected and cached. Nothing has
  // read it since, so a reset is a good moment to stop it lying around.
  try {
    if (existsSync(CAPABILITIES_PATH)) unlinkSync(CAPABILITIES_PATH);
  } catch {
    // Not important enough to fail a reset over.
  }

  cache = { offset: 0, agg: new Map() };
  cooling.clear();
  return { moved, previous };
}

// --- choosing --------------------------------------------------------------

// How much a record at other kinds is allowed to say about this one, measured
// in pseudo-observations. Two is enough to break the tie on a model's first
// tools request and small enough that three real results outweigh it.
const CROSS_KIND_WEIGHT = 2;

// Two models with the same record are not equally good if one answers in a
// second and the other in a minute: you sit and wait for both. This shaves a
// little off the slow one's draw - enough to settle a near-tie, never enough
// to put a broken model ahead of a working one.
//
// Log-scaled, so the gap that matters is 1s against 10s, not 50s against 60s.
const SLOW_PENALTY_MAX = 0.12;

export function slowness(ms) {
  if (!Number.isFinite(ms) || ms <= 1000) return 0;
  return SLOW_PENALTY_MAX * Math.min(1, Math.log10(ms / 1000) / 2);
}

// The model's record as a Beta distribution: `a` stands for successes, `b`
// for failures, both nudged by what it has done at other kinds and by the
// flat +1 that keeps an untried model at even odds rather than at zero.
export function belief(entry, otherEntry, now = Date.now()) {
  const other = decayed(otherEntry, now) ?? { ok: 0, fail: 0 };
  const otherTotal = other.ok + other.fail;
  const otherRate = otherTotal === 0 ? 0.5 : other.ok / otherTotal;
  const here = decayed(entry, now) ?? { ok: 0, fail: 0 };

  return {
    a: 1 + here.ok + CROSS_KIND_WEIGHT * otherRate,
    b: 1 + (here.weighted ?? here.fail) + CROSS_KIND_WEIGHT * (1 - otherRate),
  };
}

// Box-Muller, and Marsaglia-Tsang for the gamma. Both shapes are at least 1
// here, which is the case Marsaglia-Tsang is written for.
function normal(rng) {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function gamma(shape, rng) {
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (let guard = 0; guard < 1000; guard++) {
    let x;
    let v;
    do {
      x = normal(rng);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = rng();
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
  return d;
}

export function betaSample(a, b, rng = Math.random) {
  const x = gamma(a, rng);
  const y = gamma(b, rng);
  return x + y === 0 ? 0.5 : x / (x + y);
}

// The order to try things in, drawn fresh for every request.
//
// This is Thompson sampling: rather than ranking models by their average and
// sending everything to whichever is in front, each model draws a number from
// its own record and the draws decide the order. A model with a good record
// usually draws high, so it usually goes first. A model nobody has tried has
// a wide spread, so it draws high often enough to get a real chance. A model
// with a bad record draws low most of the time but not every time, so it is
// re-checked now and then and can climb back.
//
// The practical effect is the one you want from a pile of free tiers: load
// spreads across everything that works instead of hammering whichever model
// happened to be in front, and the ordering keeps adjusting on its own.
// When a free tier's quota runs out, every model behind that key starts
// refusing at once. Cooling them one at a time means a provider with eight
// models burns eight attempts to learn one fact, so once enough of a
// provider's models are cooling the rest go to the back with them.
//
// Derived from the per-model timers rather than kept separately: there is
// nothing to expire, nothing to reset, and no second thing to keep in step.
const PROVIDER_COOLING_SHARE = 0.5;
const PROVIDER_COOLING_MIN = 2;

function providersCoolingOff(rows) {
  const byProvider = new Map();
  for (const row of rows) {
    const url = row.attempt.provider.baseUrl;
    const seen = byProvider.get(url) ?? { total: 0, cooling: 0 };
    seen.total += 1;
    if (row.cooling > 0) seen.cooling += 1;
    byProvider.set(url, seen);
  }

  const out = new Set();
  for (const [url, seen] of byProvider) {
    if (seen.cooling >= PROVIDER_COOLING_MIN && seen.cooling >= seen.total * PROVIDER_COOLING_SHARE) {
      out.add(url);
    }
  }
  return out;
}

// Has this model already refused something no bigger than this?
//
// Demoted rather than excluded: a 400 could have been read as an overflow
// when it was something else, and being wrong should cost a place in the
// queue, not the model's whole turn.
export function knownTooSmall(entry, chars) {
  if (!entry || !Number.isFinite(chars)) return false;
  return Number.isFinite(entry.minTooBig) && chars >= entry.minTooBig;
}

export function chooseOrder(attempts, kind, {
  lookup = statsFor,
  lookupOther = statsForOtherKinds,
  rng = Math.random,
  now = Date.now(),
  chars,
} = {}) {
  const rows = attempts.map((attempt, position) => {
    const { baseUrl } = attempt.provider;
    const entry = lookup(baseUrl, attempt.model, kind);
    const { a, b } = belief(entry, lookupOther(baseUrl, attempt.model, kind), now);
    return {
      attempt,
      position,
      a,
      b,
      cooling: coolingFor(baseUrl, attempt.model, now),
      tooSmall: knownTooSmall(entry, chars),
      draw: betaSample(a, b, rng) - slowness(meanMs(entry)),
    };
  });

  // A model on a provider that has clearly run dry is treated as cooling
  // even if its own timer has not been set, because it is about to be.
  const dryProviders = providersCoolingOff(rows);
  for (const row of rows) {
    if (row.cooling === 0 && dryProviders.has(row.attempt.provider.baseUrl)) {
      row.cooling = 1;
      row.providerDry = true;
    }
  }

  // Anything cooling off goes to the back, in order of when it frees up.
  // It is still reachable: if everything else fails, we would rather ask a
  // rate-limited model than give up.
  rows.sort((x, y) =>
    // A model too small for this request goes behind even a cooling one: the
    // cooling model will work in a minute, this one will never take this.
    (x.tooSmall ? 1 : 0) - (y.tooSmall ? 1 : 0) ||
    (x.cooling === 0 ? 0 : 1) - (y.cooling === 0 ? 0 : 1) ||
    x.cooling - y.cooling ||
    y.draw - x.draw ||
    x.position - y.position);

  return {
    attempts: rows.map((row) => row.attempt),
    // Enough to explain the head of the queue in one log line.
    head: rows.slice(0, 3).map((row) => {
      const mean = row.a / (row.a + row.b);
      return `${row.attempt.model} ${Math.round(mean * 100)}%` + (row.cooling ? " (cooling)" : "");
    }),
    cooling: rows.filter((row) => row.cooling > 0).length,
    tooSmall: rows.filter((row) => row.tooSmall).length,
  };
}

// --- compaction ------------------------------------------------------------

// Folds the log into one line per key.
//
// The file is renamed out of the way first, then folded, then its summary is
// appended to the fresh log. That ordering is what makes it lossless: appends
// land on whichever file exists when they open it, so everything before the
// rename is in the file being folded and everything after is in the new one.
// Writing a snapshot over the live file instead loses whatever arrived while
// the snapshot was being built — measured at 432 of 5600 events under eight
// concurrent writers.
//
// Two processes compacting at once is safe for the same reason: each renames
// to a name carrying its own pid, so they fold disjoint data and both append
// their summaries.
function maybeCompact() {
  let taken;
  try {
    if (statSync(STATS_PATH).size < COMPACT_AT_BYTES) return;
    taken = `${STATS_PATH}.${process.pid}.${Date.now()}.folding`;
    renameSync(STATS_PATH, taken);
  } catch {
    // Someone else got there first, or the file went away. Either is fine.
    return;
  }

  try {
    const folding = readFileSync(taken, "utf8");
    const agg = new Map();
    for (const line of folding.split("\n")) {
      if (line) foldLine(agg, line);
    }

    // One line per key, per status, per day. Keeping the day is what lets a
    // compacted log still be discounted for age: fold it to a single
    // timestamp and every old result would look like it happened at once.
    const lines = [];
    for (const [key, entry] of agg) {
      const [p, m, k] = key.split("\u0000");
      const outcomes = Object.entries(entry.statuses);
      const ok = outcomes.filter(([status]) => Number(status) >= 200 && Number(status) < 300);
      const bad = outcomes.filter(([status]) => !(Number(status) >= 200 && Number(status) < 300));

      for (const [day, counts] of Object.entries(entry.days ?? {})) {
        const t = Number(day) * DAY_MS;
        // The per-day split knows how many succeeded, the per-status split
        // knows which codes came up. Neither knows both, so the statuses are
        // shared out over the days in proportion.
        for (const [group, count] of [[ok, counts.ok], [bad, counts.fail]]) {
          const total = group.reduce((sum, [, n]) => sum + n, 0);
          if (total === 0 || count === 0) continue;

          // Largest remainder, not rounding each share on its own. Rounding
          // independently does not add back up: five statuses sharing a day
          // of three results round to zero apiece and the day disappears.
          const shares = group.map(([status, n]) => {
            const exact = (n / total) * count;
            return { status, n: Math.floor(exact), frac: exact - Math.floor(exact) };
          });
          let spare = count - shares.reduce((sum, share) => sum + share.n, 0);
          for (const share of [...shares].sort((x, y) => y.frac - x.frac)) {
            if (spare <= 0) break;
            share.n += 1;
            spare -= 1;
          }

          for (const share of shares) {
            if (share.n > 0) lines.push(JSON.stringify({ p, m, k, s: Number(share.status), n: share.n, t }));
          }
        }
      }
    }

    if (lines.length > 0) appendFileSync(STATS_PATH, `${lines.join("\n")}\n`, { mode: 0o600 });

    // A writer that had the old file open when we renamed it is still
    // appending to it, and those lines arrived after we read it. Carry them
    // over instead of deleting them along with the file. Measured across
    // eight concurrent writers and 120,000 events: 23 lost without this,
    // none with it.
    const late = readFileSync(taken, "utf8").slice(folding.length);
    if (late.length > 0) appendFileSync(STATS_PATH, late, { mode: 0o600 });

    unlinkSync(taken);
  } catch {
    // The folded data is still sitting in the renamed file, so nothing is
    // gone; it just won't be counted. Better than taking down a request.
  }

  cache = { offset: 0, agg: new Map() };
}
