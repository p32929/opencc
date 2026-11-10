// What models.dev publishes about every model it knows: context window,
// price per million tokens, and whether it calls tools or reads images.
//
// opencc learns all of that by asking. That works, but it costs a real
// request per fact and the context window is only learned the slow way, by
// bracketing between the largest request a model took and the smallest it
// refused. This fills in a starting answer for free.
//
// It is a hint, never a verdict. The record always wins: a provider can
// serve a model under a different name, with a smaller window, or behind a
// gateway that strips tool calling, and only an actual request shows that.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { GLOBAL_CONFIG_DIR, MODELS_DEV_PATH } from "./paths.js";
import { withSetup } from "./setup.js";
import { windowFor, ratioOf } from "./learned.js";
import { fetch } from "./http.js"; // not the built-in one: see http.js

const URL_DEFAULT = "https://models.dev/api.json";

// Bumped when the shape below changes, so an older cache is refetched once
// rather than read with fields missing from it.
const VERSION = 2;

// Everything models.dev publishes about a model, less the prose.
//
// It is fetched once and then kept. There is no expiry: a six megabyte
// download to learn that a context window is still what it was yesterday is
// not worth doing on a timer. The models.dev button fetches it again when
// you want it, and that is the only thing that does.
function compact(raw) {
  const providers = {};
  for (const [id, provider] of Object.entries(raw)) {
    const models = {};
    for (const [modelId, info] of Object.entries(provider.models ?? {})) {
      const context = info.limit?.context > 0 ? info.limit.context : undefined;
      const inputs = Array.isArray(info.modalities?.input) ? info.modalities.input : null;
      const entry = {
        name: info.name,
        family: info.family,
        context,
        maxOutput: info.limit?.output > 0 ? info.limit.output : undefined,
        input: info.cost?.input,
        output: info.cost?.output,
        cacheRead: info.cost?.cache_read,
        cacheWrite: info.cost?.cache_write,
        // Absent means "nobody said", which is not the same as false: a
        // missing tool_call is treated as capable, the way models.dev's own
        // consumers read it.
        tools: info.tool_call !== false,
        vision: inputs ? inputs.includes("image") : Boolean(info.attachment),
        audio: inputs ? inputs.includes("audio") : undefined,
        video: inputs ? inputs.includes("video") : undefined,
        pdf: inputs ? inputs.includes("pdf") : undefined,
        reasoning: Boolean(info.reasoning),
        temperature: info.temperature,
        attachment: info.attachment,
        openWeights: info.open_weights,
        knowledge: info.knowledge,
        released: info.release_date,
        updated: info.last_updated,
        status: info.status,
        canonical: info.canonical_model_id,
        inputs: inputs || undefined,
        outputs: Array.isArray(info.modalities?.output) ? info.modalities.output : undefined,
      };
      for (const key of Object.keys(entry)) if (entry[key] === undefined) delete entry[key];
      // A model with nothing useful on it is not worth a line in the cache.
      if (context || entry.input !== undefined || entry.vision || info.tool_call === false) {
        models[modelId] = entry;
      }
    }
    if (Object.keys(models).length) providers[id] = { api: provider.api ?? null, models };
  }
  return providers;
}

let table = null;

// Built once per catalogue, because lookupModel is called for every model on
// the page and a scan of nine thousand entries per call turned a cached
// catalogue listing into nearly four seconds of work.
//
// Every entry under its name made plain, the whole id and its last part, with
// the host of the provider that lists it and its place in the list (ties go
// to the first). Names are matched against this, not scanned.
let index = null;
let memo = new Map();

function buildIndex() {
  const byName = new Map();
  let n = 0;
  for (const provider of Object.values(table?.providers ?? {})) {
    const host = provider.api ? hostOf(provider.api) : "";
    for (const [id, info] of Object.entries(provider.models)) {
      const hit = { host, info, n: n++ };
      for (const name of new Set([norm(id), norm(id.split("/").pop())])) {
        if (!name) continue;
        const list = byName.get(name);
        if (list) list.push(hit); else byName.set(name, [hit]);
      }
    }
  }
  index = byName;
  memo = new Map();
}

function readCache() {
  try {
    const parsed = JSON.parse(readFileSync(MODELS_DEV_PATH, "utf8"));
    return parsed?.v === VERSION ? parsed : null;
  } catch {
    return null;
  }
}

// Never throws unless `force` is set: a missing catalogue degrades to the
// behaviour opencc had before it existed, which is to learn everything by
// asking. `force` is the panel's refresh button, where a failure is the
// answer the person is waiting for.
export async function loadCatalog({
  url = URL_DEFAULT,
  timeout = 20000,
  force = false,
  // Injectable so a test can hand over a catalogue without a network call,
  // and without the 6 MB real one.
  fetchImpl = fetch,
} = {}) {
  if (!table) {
    table = readCache();
    index = null;
    memo = new Map();
  }
  // Kept until you ask for it again. There was a day's expiry here, which
  // meant re-downloading six megabytes to be told the same thing.
  if (!force && (table || process.env.OPENCC_NO_MODELS_DEV)) return table;

  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeout) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    table = { v: VERSION, at: Date.now(), providers: compact(await res.json()) };
    index = null;
    memo = new Map();
    mkdirSync(dirname(MODELS_DEV_PATH) || GLOBAL_CONFIG_DIR, { recursive: true });
    writeFileSync(MODELS_DEV_PATH, JSON.stringify(table));
  } catch (err) {
    if (force) throw new Error(`could not reach models.dev: ${err.message}`);
    // Whatever was on disk, however old, beats nothing.
  }
  return table;
}

export function catalogAge() {
  return table?.at ? Date.now() - table.at : null;
}

export function catalogSize() {
  if (!table) return 0;
  return Object.values(table.providers).reduce((n, p) => n + Object.keys(p.models).length, 0);
}

const hostOf = (url) => {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
};

// Names are matched loosely because the same model is listed under many
// spellings: "Qwen/Qwen3-32B", "qwen3-32b", "qwen3_32b". Punctuation and
// case carry no meaning here.
const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

// A "...-latest" name models.dev doesn't list: the newest dated version it
// does list (magistral-small-latest -> magistral-small-2509), its entries at
// every provider. [] if none.
function newestOf(name) {
  const base = /^(.+?)[-_.:]?latest$/i.exec(name)?.[1];
  if (!base) return [];
  // A date or version after the name (2509, 20250929); a vendor before it
  // (mistral.magistral-small-2509).
  const re = new RegExp(`^[a-z]{0,12}${norm(base)}(\\d{4,8})$`);
  let best = null;
  for (const [k, list] of index) {
    const d = re.exec(k)?.[1];
    if (d && (!best || Number(d) > Number(best.d))) best = { d, list };
  }
  return best ? [...best.list].sort((a, b) => a.n - b.n) : [];
}

// What is known about `model` as served by the backend at `baseUrl`, or null.
//
// Found by its name however it is written (google/gemini-2.5-flash,
// models/gemini-2.5-flash, gpt-oss:120b is gpt-oss-120b). Not by its whole
// name: without what a provider adds at the end (":free", "-cloud",
// "-instruct-turbo"), one part at a time, the most specific first.
//
// The provider whose own API URL matches is asked first, because the same
// name can mean different things at two providers (a gateway may serve a
// quantised build with a shorter window). Otherwise, among all that list it,
// the window most of them say: a proxy or a provider models.dev does not know
// serves the model at its usual size. And not at one it does not know: images
// only when every provider that lists the model takes them, since one that
// does not would refuse the request.
export function lookupModel(baseUrl, model) {
  if (!table || !model) return null;
  if (!index) buildIndex();
  const host = hostOf(baseUrl);
  const memoKey = `${host}\u0000${model}`;
  if (memo.has(memoKey)) return memo.get(memoKey);

  const last = (m) => m.split("/").pop();
  const lookup = (names) =>
    [...new Set(names.map(norm).flatMap((w) => index.get(w) ?? []))].sort((a, b) => a.n - b.n);
  let hits = lookup([model, String(model).replace(/^models\//, ""), last(String(model))]);
  for (let name = last(String(model)); !hits.length && /[:-][^:-]+$/.test(name);) {
    hits = lookup([(name = name.replace(/[:-][^:-]+$/, ""))]);
  }
  if (!hits.length) hits = newestOf(last(String(model)));

  let found = null;
  if (hits.length) {
    const own = host ? hits.filter((h) => h.host === host) : [];
    const list = own.length ? own : hits;
    const count = (x) => list.filter((y) => y.info.context === x.info.context).length;
    const best = list.reduce((a, b) => (count(b) > count(a) || (count(b) === count(a) && b.info.context > a.info.context) ? b : a));
    found = own.length ? best.info : { ...best.info, vision: list.every((x) => x.info.vision) };
  }
  memo.set(memoKey, found);
  return found;
}

// What is known about a model, with what you said about it laid over what
// models.dev says: a window you set beats everything; then what the server
// stated when asked (measured, or what the running server says), models.dev's
// published one, and what a refusal showed (see learned.js).
export function factsFor(baseUrl, model) {
  const facts = withSetup(lookupModel(baseUrl, model), baseUrl, model);
  if (!facts || facts.set?.context) return facts;
  const w = windowOfModel(baseUrl, model, facts);
  return w ? { ...facts, context: w.size, contextFrom: w.from } : facts;
}

// The window to plan with: { size, from } or null. A window you set wins; then
// the ladder in learned.js. `facts` is what factsFor started from, so it can
// be called from inside it.
export function windowOfModel(baseUrl, model, facts = withSetup(lookupModel(baseUrl, model), baseUrl, model)) {
  if (facts?.set?.context) return { size: facts.set.context, from: "you" };
  return windowFor(baseUrl, model, {
    measured: facts?.set?.measured,
    size: lookupModel(baseUrl, model)?.context,
  });
}

// Does this model's window say it cannot hold a request this big?
// Null means it does not know, which is not a no.
//
// `tokens` is the request estimated the way tokenizers split it (textfix.js);
// without it, characters at five to a token, which is deliberately generous:
// being wrong here would demote a model that could have answered, so the
// bias is all one way.
export function tooBigForCatalog(baseUrl, model, chars, tokens) {
  if (!Number.isFinite(chars)) return false;
  const window = windowOfModel(baseUrl, model);
  if (!window) return false;
  const need = Number.isFinite(tokens)
    ? Math.max(tokens * ratioOf(baseUrl, model), Math.min(tokens, chars / 4))
    : chars / 5;
  return need > window.size;
}

// Is the model known not to do something this request needs? What it can do
// comes from models.dev and from you; a model nobody has described is not
// "unfit", it is unknown.
export function unfitFor(baseUrl, model, needs = {}) {
  const facts = factsFor(baseUrl, model);
  if (!facts) return false;
  return (needs.tools && facts.tools === false) || (needs.vision && facts.vision === false) || false;
}

// For tests and for `opencc --reset-stats`, which should not leave a cached
// catalogue behind pretending to be fresh.
export function forgetCatalog() {
  table = null;
  index = null;
  memo = new Map();
}
