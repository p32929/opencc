// A line per request the proxy served, so "why did that fail" survives the
// terminal scrolling away.
//
// Summary only. Which models were tried, what each one answered, how long it
// took and which one ended up replying — never the request body, the reply,
// or a key. That keeps a few hundred requests under a megabyte and means the
// file can be read by anyone who can already read the config.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { REQUESTS_PATH } from "./paths.js";
import { bus } from "./events.js";

// How many are kept. There is no time limit: a request from last month is
// worth the same as one from this morning when you are working out why
// something failed, and "the last 100" is a number you can reason about
// without knowing how busy the week was.
export const KEEP = 100;

let appended = 0;
// Pruning used to be driven by this counter alone, which reset with the
// process. A session that served fewer than KEEP requests therefore never
// pruned, and across enough restarts the file grew without limit while the
// panel read all of it on every load. One prune on the first write of each
// process bounds it however short the sessions are.
let prunedThisRun = false;

const MAX_ERROR_CHARS = 400;

const trim = (text) =>
  typeof text === "string" && text.length > MAX_ERROR_CHARS
    ? text.slice(0, MAX_ERROR_CHARS) + "…"
    : text;

function readLines() {
  try {
    return readFileSync(REQUESTS_PATH, "utf8").split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

function prune() {
  const lines = readLines();
  if (lines.length <= KEEP) return;
  writeFileSync(REQUESTS_PATH, lines.slice(-KEEP).join("\n") + "\n");
}

// `entry` is built by the server as it walks the candidates:
//   { at, model, kind, chars, tools, stream, attempts: [...], served, status, error }
// Each attempt is { provider, model, status, ms, error, verdict }.
export function logRequest(entry) {
  const attempts = (entry.attempts ?? []).map((a) => ({ ...a, error: trim(a.error) }));

  const record = {
    at: entry.at ?? Date.now(),
    model: entry.model,
    kind: entry.kind,
    chars: entry.chars,
    tools: entry.tools,
    stream: Boolean(entry.stream),
    ok: Boolean(entry.served),
    // Which provider/model actually answered, if any.
    served: entry.served ?? null,
    status: entry.status ?? null,
    error: trim(entry.error),
    ms: entry.ms,
    attempts,
    // The first candidate failing and a later one answering is the single
    // most interesting thing in this file, so it is marked rather than left
    // to be worked out from the attempt list each time it is read.
    fallback: Boolean(entry.served) && attempts.length > 1,
  };

  try {
    mkdirSync(dirname(REQUESTS_PATH), { recursive: true });
    // O_APPEND, so two opencc processes writing at once interleave whole
    // lines rather than losing one of them — the same reason stats.jsonl is
    // newline-delimited.
    appendFileSync(REQUESTS_PATH, JSON.stringify(record) + "\n");
    if (!prunedThisRun) {
      prunedThisRun = true;
      prune();
    } else if (++appended >= KEEP) {
      appended = 0;
      prune();
    }
  } catch {
    // The log is a convenience. A full disk or a read-only home should never
    // take the proxy down with it.
  }

  bus.emit("request", record);
  return record;
}

// Newest first, which is the order the panel shows them in.
export function listRequests({ limit = KEEP } = {}) {
  const out = [];
  for (const line of readLines().slice(-limit)) {
    try {
      out.push(JSON.parse(line));
    } catch {
      // A line half-written when the process was killed. Skipping it is
      // better than failing the whole listing.
    }
  }
  return out.reverse();
}

export function clearRequests() {
  try {
    rmSync(REQUESTS_PATH, { force: true });
  } catch {
    return { cleared: 0 };
  }
  appended = 0;
  prunedThisRun = false;
  bus.emit("requests-cleared");
  return { cleared: 1 };
}
