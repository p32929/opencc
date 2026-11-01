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

// How many are kept. Enough to cover a long Claude Code session, few enough
// that the panel can render the lot without paging.
export const KEEP = 500;

// Rewriting the file on every request would turn one append into a full read
// and write, so it is pruned only once it has drifted this far past the cap.
const PRUNE_AT = KEEP * 2;

let appended = 0;

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
    if (++appended >= PRUNE_AT - KEEP) {
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
  bus.emit("requests-cleared");
  return { cleared: 1 };
}
