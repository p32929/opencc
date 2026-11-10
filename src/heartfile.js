// The config in HeartCode's own format, so the file can be copied between
// the two: config.json with
//
//   providers   { name: { baseUrl, apiKey, off?, list?, models? } }
//               off: switched off; list: false: its model list is not asked
//               for; models: the ones added by name
//   provider, model   the first of your models
//   rotation    { on, retries, next, then: [{ provider, model }] }
//               then: the rest of your models, in order, which is the order
//               they are asked in
//   testTimeout, replyStart, replyIdle   seconds
//
// What only opencc has (its port, streaming, the provider ranking, the reply
// label, the other behavior settings, parked models) is under "opencc", which
// HeartCode leaves alone. Anything else in the file is kept as it was.
//
// The rest of opencc reads settings as the lines of a .env file, so this
// turns the file into that, and back. A .env from before this is read as it
// was, and replaced by config.json the first time anything is saved.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { CONFIG_JSON_PATH, GLOBAL_CONFIG_DIR, GLOBAL_CONFIG_PATH } from "./paths.js";
import { DEFAULTS, ENV } from "./behavior.js";

export const readConfigJson = () => {
  try {
    const parsed = JSON.parse(readFileSync(CONFIG_JSON_PATH, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
};

const byName = (a, b) => a.localeCompare(b, undefined, { sensitivity: "base" });
const keyOf = (e) => `${e.provider}\u0000${e.model}`;
const bool = (v) => (v ? "on" : "off");

// The models in the order they are asked in: the first one, then the rest.
export function orderOf(json) {
  const names = new Set(Object.keys(json.providers ?? {}));
  const all = [{ provider: json.provider, model: json.model }, ...(json.rotation?.then ?? [])];
  const seen = new Set();
  return all.filter((e) => e && names.has(e.provider) && e.model && !seen.has(keyOf(e)) && seen.add(keyOf(e)));
}

// config.json as the lines of a .env, with `__order` beside them.
export function envFromJson(json) {
  const o = json.opencc ?? {};
  const b = o.behavior ?? {};
  const rot = json.rotation ?? {};
  const order = orderOf(json);
  const env = { __order: order };
  Object.keys(json.providers ?? {}).sort(byName).forEach((name, i) => {
    const p = json.providers[name] ?? {};
    const s = i === 0 ? "" : `_${i + 1}`;
    env[`PROVIDER_NAME${s}`] = name;
    if (p.off === true) env[`PROVIDER_DISABLED${s}`] = "true";
    if (o.parked?.[name]?.length) env[`PROVIDER_MODELS_DISABLED${s}`] = o.parked[name].join(", ");
    if (p.list === false) env[`PROVIDER_LIST${s}`] = "off";
    if (p.models?.length) env[`PROVIDER_ADDED${s}`] = p.models.join(", ");
    env[`OPENAI_BASE_URL${s}`] = p.baseUrl ?? "";
    env[`OPENAI_API_KEY${s}`] = p.apiKey ?? "";
    env[`MODELS${s}`] = order.filter((e) => e.provider === name).map((e) => e.model).join(", ");
  });
  const put = (k, v) => { if (v !== undefined && v !== null && v !== "") env[k] = String(v); };
  put("PORT", o.port);
  if (o.streaming === false) env.STREAMING = "off";
  if (o.rank?.length) env.PROVIDER_RANK = o.rank.join(", ");
  put("TEST_TIMEOUT", json.testTimeout);
  put("TEST_LANES", o.testLanes);
  put("REPLY_TAG", o.replyTag);
  put(ENV.onFail, b.onFail ?? rot.on);
  put(ENV.retries, rot.retries);
  put(ENV.replyStart, json.replyStart);
  put(ENV.replyIdle, json.replyIdle);
  for (const k of ["pick", "effort", "logDetail", "logDays"]) put(ENV[k], b[k]);
  for (const k of ["keepTrying", "remote", "fit", "stay"]) if (typeof b[k] === "boolean") env[ENV[k]] = bool(b[k]);
  return env;
}

// The settings, from config.json when there is one, else from the old .env
// (`parseEnv` reads it). `__order` is the order your models are asked in.
export function readGlobalConfig(parseEnv) {
  const json = readConfigJson();
  if (json) return envFromJson(json);
  const env = parseEnv(GLOBAL_CONFIG_PATH);
  // Before there was an order, it was how the file listed them.
  const order = [];
  for (const key of Object.keys(env)) {
    const m = /^MODELS(_\d+)?$/.exec(key);
    if (!m) continue;
    const name = env[`PROVIDER_NAME${m[1] ?? ""}`];
    if (name) for (const model of env[key].split(",").map((x) => x.trim()).filter(Boolean)) order.push({ provider: name, model });
  }
  return { ...env, __order: order };
}

// `order` with what is gone taken out and what is new put at the end.
export function mergeOrder(order, providers) {
  const have = new Set();
  for (const p of providers) for (const m of p.models ?? []) have.add(keyOf({ provider: p.name, model: m }));
  const seen = new Set();
  const out = [];
  for (const e of order ?? []) {
    if (e && have.has(keyOf(e)) && !seen.has(keyOf(e))) { seen.add(keyOf(e)); out.push({ provider: e.provider, model: e.model }); }
  }
  for (const p of providers) {
    for (const m of p.models ?? []) {
      const e = { provider: p.name, model: m };
      if (!seen.has(keyOf(e))) { seen.add(keyOf(e)); out.push(e); }
    }
  }
  return out;
}

// providers: [{ name, baseUrl, apiKey, models, disabled, disabledModels, list, added }]
export function writeConfigJson({ providers, order, port, streaming = true, rank = [], testTimeout, testLanes, replyTag, behavior }, defaults) {
  const json = readConfigJson() ?? {};
  const was = json.providers ?? {};
  const out = {};
  for (const p of [...providers].sort((a, b) => byName(a.name, b.name))) {
    const o = { ...(was[p.name] ?? {}), baseUrl: p.baseUrl, apiKey: p.apiKey || "" };
    p.disabled ? (o.off = true) : delete o.off;
    p.list === false ? (o.list = false) : delete o.list;
    p.added?.length ? (o.models = [...p.added]) : delete o.models;
    out[p.name] = o;
  }
  json.providers = out;

  const merged = mergeOrder(order, providers);
  if (merged.length) Object.assign(json, { provider: merged[0].provider, model: merged[0].model });
  else { delete json.provider; delete json.model; }

  const b = { ...DEFAULTS, ...(behavior ?? {}) };
  json.rotation = { next: "first", ...(json.rotation ?? {}), on: b.onFail === "retries" ? "retries" : "failure", retries: b.retries, then: merged.slice(1) };

  const keep = (key, value, fallback) => (value !== undefined && value !== fallback ? (json[key] = value) : delete json[key]);
  keep("testTimeout", testTimeout, defaults.testTimeout);
  keep("replyStart", b.replyStart, DEFAULTS.replyStart);
  keep("replyIdle", b.replyIdle, DEFAULTS.replyIdle);

  const x = {};
  if (port) x.port = String(port);
  if (!streaming) x.streaming = false;
  if (rank.length) x.rank = rank;
  if (testLanes && testLanes !== defaults.testLanes) x.testLanes = testLanes;
  if (replyTag) x.replyTag = replyTag;
  const extra = {};
  if (b.onFail === "any") extra.onFail = "any";
  for (const k of ["pick", "effort", "logDetail", "logDays", "keepTrying", "remote", "fit", "stay"]) if (b[k] !== DEFAULTS[k]) extra[k] = b[k];
  if (Object.keys(extra).length) x.behavior = extra;
  const parked = Object.fromEntries(providers.filter((p) => p.disabledModels?.length).map((p) => [p.name, p.disabledModels]));
  if (Object.keys(parked).length) x.parked = parked;
  Object.keys(x).length ? (json.opencc = x) : delete json.opencc;

  mkdirSync(GLOBAL_CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_JSON_PATH, JSON.stringify(json, null, 2) + "\n", { mode: 0o600 });
  // The old file is not read any more: kept beside it under another name.
  if (existsSync(GLOBAL_CONFIG_PATH)) renameSync(GLOBAL_CONFIG_PATH, `${GLOBAL_CONFIG_PATH}.before-config-json`);
}
