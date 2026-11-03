// "Best fit": a small tilt toward the models people rate higher at what this
// request needs, by public rankings (rankings.js: LMArena, per skill). It is a
// thumb on the scale, added to the draw like your provider ranking and far too
// small to float a model that keeps failing above one that works: the record
// still decides. A model the rankings do not know gets no tilt at all.
//
// HeartCode asks a model to name the skills a task needs. A proxy sees the
// request itself, so the skills are read from it: code always, agent work
// when tools are offered, images when there are some, long input when it is
// long.
import { rankings, loadRankings, score } from "./rankings.js";

export const FIT_WEIGHT = 0.1;
const LONG_REQUEST_CHARS = 60000;
const WEEK_MS = 7 * 24 * 3600_000;

export function skillsFor(needs = {}, chars = 0) {
  const skills = ["coding"];
  if (needs.tools) skills.push("agent");
  if (needs.vision) skills.push("vision");
  if (chars > LONG_REQUEST_CHARS) skills.push("long-input");
  return skills;
}

let cached = null;
let cachedAt = 0;
let refreshing = false;

// The rankings as last fetched, read from disk at most once a minute. If there
// are none, or they are a week old, they are fetched in the background; this
// request goes without them, the next one has them.
export function currentRankings(now = Date.now()) {
  if (!cached || now - cachedAt > 60000) {
    cached = loadRankings();
    cachedAt = now;
  }
  if ((!cached || now - cached.fetched > WEEK_MS) && !refreshing && !process.env.OPENCC_NO_RANKINGS) {
    refreshing = true;
    rankings().then((d) => { cached = d ?? cached; cachedAt = Date.now(); }, () => {}).finally(() => { refreshing = false; });
  }
  return cached;
}

export const forgetRankingsCache = () => {
  cached = null;
  cachedAt = 0;
};

// (baseUrl, model) => the tilt, or null when there are no rankings yet.
export function bonusFor(needs, chars, data = currentRankings()) {
  if (!data) return null;
  const skills = skillsFor(needs, chars);
  const seen = new Map();
  return (baseUrl, model) => {
    if (!seen.has(model)) {
      const sc = score(model, skills, data);
      seen.set(model, sc == null ? 0 : FIT_WEIGHT * (1 - sc));
    }
    return seen.get(model);
  };
}
