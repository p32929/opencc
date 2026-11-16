// Each model's track record from real requests: what it answered and what it failed at, kept in
// ~/.opencc/records.json (HeartCode's file, same shape: "provider/model" to { good, bad, at }).
// On unless trackRecord is off. Where a model is picked by ranking (what comes after the first one
// failed), a model that keeps doing well moves up and one that keeps failing moves down; a model
// that has failed most of its work doesn't come first while another can.
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { GLOBAL_CONFIG_DIR, RECORDS_PATH } from "./paths.js";

// what each event adds: [good, bad]
//   done        a reply that was whole and usable
//   bad-reply   one that was not (empty, going round, a tool call written as text, broken arguments)
//   handover    one that died part way
//   no-answer   no answer, a refused key, a plan needed, an error (a rate limit passes)
const WEIGHT = { done: [1, 0], "bad-reply": [0, 0.5], handover: [0, 1], "no-answer": [0, 1] };
export const records = { on: true };
export const useRecords = (behavior) => (records.on = behavior?.trackRecord !== false);
const keyOf = (t) => `${t.provider}/${t.model}`;

// read again only when the file changed (other runs write it too)
let cache = { at: null, all: {} };
const readAll = () => {
  try {
    return JSON.parse(readFileSync(RECORDS_PATH, "utf8"));
  } catch {
    return {};
  }
};
function all() {
  let at = "";
  try {
    const st = statSync(RECORDS_PATH);
    at = `${st.mtimeMs}:${st.size}`;
  } catch {
    // none yet
  }
  if (cache.at !== at) cache = { at, all: readAll() };
  return cache.all;
}

// One event for a model ({ provider, model }, the provider by name). Older events fade (each new
// one counts a little more than the last: after about 25 more, an event counts half), so a model
// that got better shows it.
export function record(t, what) {
  if (!records.on || !t?.model || !WEIGHT[what]) return;
  const [good, bad] = WEIGHT[what];
  try {
    const now = readAll();
    const r = now[keyOf(t)] ?? { good: 0, bad: 0 };
    now[keyOf(t)] = { good: r.good * 0.97 + good, bad: r.bad * 0.97 + bad, at: Date.now() };
    mkdirSync(GLOBAL_CONFIG_DIR, { recursive: true });
    writeFileSync(RECORDS_PATH, JSON.stringify(now));
  } catch {
    // A full disk should not take a request down with it.
  }
}

export const recordOf = (t) => all()[keyOf(t)] ?? null;
export const forgetRecords = () => rmSync(RECORDS_PATH, { force: true });

// How often it failed, from 0 to 1 (0.5 with no record either way); null: too little to tell, or off
export function failRate(t) {
  const r = records.on ? recordOf(t) : null;
  if (!r || r.good + r.bad < 3) return null;
  return (r.bad + 1) / (r.good + r.bad + 2);
}

// failed most of its work (3.5 events' worth after fading: about 4 recent ones)
export const unreliable = (t) => (failRate(t) ?? 0) >= 0.7 && recordOf(t).good + recordOf(t).bad >= 3.5;

// A ranking score (scoreOf: lower is better, Infinity: not ranked) moved by the record: a model
// that never failed x0.3, one that always does x1.7, no record x1. A model not ranked with a good
// record comes before the other unranked ones.
export function withRecord(t, rank) {
  const f = failRate(t);
  if (f === null) return rank;
  if (rank === Infinity) return f < 0.5 ? 1 + f : Infinity;
  return rank * (0.3 + 1.4 * f);
}

// What the page shows: the record rounded, and whether the model is poor (it doesn't come first)
export function recordView(t) {
  const r = records.on ? recordOf(t) : null;
  return r && { done: Math.round(r.good), failed: Math.round(r.bad), poor: unreliable(t) };
}
