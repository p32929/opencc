// Tokens used and what they cost, per model at each provider. Prices per
// million tokens come from models.dev (modelsdev.js); a model it has no price
// for counts tokens only. OpenRouter says what it charged, and that wins.
//
// Kept in one small file, rewritten a moment after it changes: it is a
// running total, not a log, so two processes losing one update is the cost of
// keeping it simple.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { USAGE_PATH, GLOBAL_CONFIG_DIR } from "./paths.js";
import { lookupModel } from "./modelsdev.js";

let table = null;
let timer = null;

const read = () => {
  if (table) return table;
  try {
    table = JSON.parse(readFileSync(USAGE_PATH, "utf8"));
  } catch {
    table = {};
  }
  return table;
};

const keyOf = (baseUrl, model) => `${baseUrl}\u0000${model}`;

export function flushUsage() {
  clearTimeout(timer);
  timer = null;
  if (!table) return;
  try {
    mkdirSync(GLOBAL_CONFIG_DIR, { recursive: true });
    writeFileSync(USAGE_PATH, JSON.stringify(table));
  } catch {
    // A convenience: a read-only home must not stop the proxy.
  }
}
process.on("exit", flushUsage);

// What one reply cost, in dollars: u is { input, output, cached, cost }. The
// provider's own figure wins; else the cached part at the cache price and the
// rest at the input price.
export function costOf(price, u) {
  if (typeof u.cost === "number") return { cost: u.cost, priced: true };
  if (!price || price.input === undefined) return { cost: 0, priced: false };
  const cached = u.cached ?? 0;
  const fresh = Math.max(0, (u.input ?? 0) - cached);
  const cost =
    (fresh * price.input + cached * (price.cacheRead ?? price.input) + (u.output ?? 0) * (price.output ?? 0)) / 1e6;
  return { cost, priced: true };
}

export function addUsage(baseUrl, model, u) {
  if (!u || !(u.input > 0 || u.output > 0)) return null;
  const { cost, priced } = costOf(lookupModel(baseUrl, model), u);
  const row = (read()[keyOf(baseUrl, model)] ??= { requests: 0, input: 0, output: 0, cached: 0, cost: 0, priced: false });
  row.requests += 1;
  row.input += u.input ?? 0;
  row.output += u.output ?? 0;
  row.cached += u.cached ?? 0;
  row.cost += cost;
  row.priced ||= priced;
  if (!timer) {
    timer = setTimeout(flushUsage, 3000);
    timer.unref?.();
  }
  return { cost: priced ? cost : undefined, priced };
}

export function usageOf(baseUrl, model) {
  return read()[keyOf(baseUrl, model)] ?? null;
}

// Every model's totals, keyed "baseUrl|model" the way the page keys its record.
export function allUsage() {
  return Object.fromEntries(Object.entries(read()).map(([k, v]) => [k.replace("\u0000", "|"), v]));
}

export function resetUsage() {
  table = {};
  flushUsage();
}
export const dropUsageCache = () => {
  table = null;
};
