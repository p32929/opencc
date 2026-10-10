// What has actually worked, per provider, model and kind of request.
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
import { GLOBAL_CONFIG_DIR, STATS_PATH } from "./paths.js";

// Past this the log is folded into one line per key. Big enough that it
// happens rarely, small enough that reading it stays trivial.
const COMPACT_AT_BYTES = 256 * 1024;

export const kindOf = (needs) => (needs.vision ? "image" : needs.tools ? "tools" : "text");

const keyOf = (baseUrl, model, kind) => `${baseUrl}\u0000${model}\u0000${kind}`;

export function record({ baseUrl, model, kind, status }) {
  const line = `${JSON.stringify({ p: baseUrl, m: model, k: kind, s: status, n: 1, t: Date.now() })}\n`;
  try {
    mkdirSync(GLOBAL_CONFIG_DIR, { recursive: true });
    appendFileSync(STATS_PATH, line, { mode: 0o600 });
    maybeCompact();
  } catch {
    // Stats are an optimisation. Losing them must never cost a request.
  }
}

// --- reading ---------------------------------------------------------------

// Folding the whole log on every request would be wasteful, so the aggregate
// is kept in memory and only the bytes appended since last time are read.
// A file that shrank means someone compacted it, so start over.
let cache = { offset: 0, agg: new Map() };

function foldLine(agg, line) {
  let event;
  try {
    event = JSON.parse(line);
  } catch {
    // A process killed mid-append leaves one unparseable line. Skip it.
    return;
  }
  if (!event || typeof event.p !== "string" || typeof event.m !== "string") return;

  const key = keyOf(event.p, event.m, event.k ?? "text");
  const entry = agg.get(key) ?? { ok: 0, fail: 0, statuses: {}, lastOk: 0, lastFail: 0 };
  const n = Number.isFinite(event.n) ? event.n : 1;
  const status = Number(event.s) || 0;

  if (status >= 200 && status < 300) {
    entry.ok += n;
    entry.lastOk = Math.max(entry.lastOk, event.t ?? 0);
  } else {
    entry.fail += n;
    entry.lastFail = Math.max(entry.lastFail, event.t ?? 0);
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

// --- ordering --------------------------------------------------------------

// A model counts as broken for a kind of request once it has been tried a few
// times and almost never worked. The threshold is deliberately high: the
// configured order is a deliberate choice, and shuffling it on one bad
// afternoon would be worse than trying a model that then fails over.
const MIN_ATTEMPTS = 4;
const BAD_BELOW = 0.2;

export function reliability(entry) {
  if (!entry) return null;
  const total = entry.ok + entry.fail;
  if (total < MIN_ATTEMPTS) return null;
  return entry.ok / total;
}

// Stable: models are only moved when the evidence says they're failing, and
// everything else keeps the order you set.
export function orderByReliability(attempts, kind, lookup = statsFor) {
  const scored = attempts.map((attempt, position) => {
    const rate = reliability(lookup(attempt.provider.baseUrl, attempt.model, kind));
    return { attempt, position, demote: rate !== null && rate < BAD_BELOW, rate };
  });

  const demoted = scored.filter((x) => x.demote);
  if (demoted.length === 0 || demoted.length === scored.length) {
    return { attempts, demoted: [] };
  }

  const keep = scored.filter((x) => !x.demote);
  return {
    attempts: [...keep, ...demoted].map((x) => x.attempt),
    demoted: demoted.map((x) => ({ model: x.attempt.model, rate: x.rate })),
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
    const agg = new Map();
    for (const line of readFileSync(taken, "utf8").split("\n")) {
      if (line) foldLine(agg, line);
    }

    const lines = [];
    for (const [key, entry] of agg) {
      const [p, m, k] = key.split("\u0000");
      for (const [status, n] of Object.entries(entry.statuses)) {
        lines.push(JSON.stringify({
          p, m, k, s: Number(status), n,
          t: entry.lastOk || entry.lastFail || Date.now(),
        }));
      }
    }

    if (lines.length > 0) appendFileSync(STATS_PATH, `${lines.join("\n")}\n`, { mode: 0o600 });
    unlinkSync(taken);
  } catch {
    // The folded data is still sitting in the renamed file, so nothing is
    // gone; it just won't be counted. Better than taking down a request.
  }

  cache = { offset: 0, agg: new Map() };
}
