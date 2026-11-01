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

const URL_DEFAULT = "https://models.dev/api.json";
const DAY_MS = 86_400_000;

// Bumped when the shape below changes, so an older cache is refetched once
// rather than read with missing fields.
const VERSION = 1;

// The published file is about 6 MB and most of it is prose we never show.
// Only these fields are kept, which brings the cache under a megabyte.
function compact(raw) {
  const providers = {};
  for (const [id, provider] of Object.entries(raw)) {
    const models = {};
    for (const [modelId, info] of Object.entries(provider.models ?? {})) {
      const context = info.limit?.context > 0 ? info.limit.context : undefined;
      const entry = {
        context,
        maxOutput: info.limit?.output > 0 ? info.limit.output : undefined,
        input: info.cost?.input,
        output: info.cost?.output,
        // Absent means "nobody said", which is not the same as false: a
        // missing tool_call is treated as capable, the way models.dev's own
        // consumers read it.
        tools: info.tool_call !== false,
        vision: Array.isArray(info.modalities?.input)
          ? info.modalities.input.includes("image")
          : Boolean(info.attachment),
        reasoning: Boolean(info.reasoning),
      };
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
  table ??= readCache();
  const fresh = table && Date.now() - table.at < DAY_MS;
  if (!force && (fresh || process.env.OPENCC_NO_MODELS_DEV)) return table;

  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeout) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    table = { v: VERSION, at: Date.now(), providers: compact(await res.json()) };
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

// What is known about `model` as served by the backend at `baseUrl`, or null.
//
// The provider whose own API URL matches is asked first, because the same
// name can mean different things at two providers — a gateway may serve a
// quantised build with a shorter window. Only if no provider matches by URL
// does any provider listing that name answer, which is what makes this work
// for key-rotating proxies and self-hosted gateways.
export function lookupModel(baseUrl, model) {
  if (!table || !model) return null;

  const wanted = [norm(model), norm(String(model).split("/").pop())];
  const host = hostOf(baseUrl);

  const findIn = (provider) => {
    for (const [id, info] of Object.entries(provider.models)) {
      const candidate = norm(id);
      if (wanted.includes(candidate) || wanted.includes(norm(id.split("/").pop()))) return info;
    }
    return null;
  };

  const all = Object.values(table.providers);
  if (host) {
    for (const provider of all) {
      if (provider.api && hostOf(provider.api) === host) {
        const hit = findIn(provider);
        if (hit) return hit;
      }
    }
  }

  for (const provider of all) {
    const hit = findIn(provider);
    if (hit) return hit;
  }
  return null;
}

// Characters per token, used only to turn a published context window into a
// request size opencc can compare against.
//
// Deliberately generous. Real text runs about 3.5 characters per token and
// code rather less, so assuming 5 understates how many tokens a request
// carries and the ceiling only trips when a request overflows even on the
// kindest reading. Being wrong here would demote a model that could have
// answered, so the bias is all one way.
const CHARS_PER_TOKEN = 5;

// Does the catalogue say this model cannot possibly hold a request this big?
// Null means it does not know, which is not a no.
export function tooBigForCatalog(baseUrl, model, chars) {
  if (!Number.isFinite(chars)) return false;
  const known = lookupModel(baseUrl, model);
  if (!known?.context) return false;
  return chars / CHARS_PER_TOKEN > known.context;
}

// For tests and for `opencc --reset-stats`, which should not leave a cached
// catalogue behind pretending to be fresh.
export function forgetCatalog() {
  table = null;
}
