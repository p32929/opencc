// What you have said about a model. models.dev is right about most of them
// and wrong about some — a gateway that strips tool calling, a local build
// with a smaller window — and silent about the rest, so what you set wins.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { SETUP_PATH } from "./paths.js";

let table = null;

const read = () => {
  if (table) return table;
  try {
    table = existsSync(SETUP_PATH) ? JSON.parse(readFileSync(SETUP_PATH, "utf8")) : {};
  } catch {
    table = {};
  }
  return table;
};

const write = () => {
  mkdirSync(dirname(SETUP_PATH), { recursive: true });
  writeFileSync(SETUP_PATH, JSON.stringify(table, null, 2), { mode: 0o600 });
};

const keyOf = (baseUrl, model) => `${baseUrl}|${model}`;

export const setupFor = (baseUrl, model) => read()[keyOf(baseUrl, model)] ?? null;

// context: tokens, or null for "as found". The four booleans are all stored
// together, as HeartCode does: a setup is a statement about the whole model,
// not four independent overrides.
export function saveSetup(baseUrl, model, { context, tools, thinking, images, stream }) {
  if (context !== null && context !== undefined && !(Number.isInteger(context) && context >= 512 && context <= 100_000_000)) {
    throw new Error("the context window: a whole number of tokens (512 or more), or empty");
  }
  for (const [name, value] of Object.entries({ tools, thinking, images, stream })) {
    if (typeof value !== "boolean") throw new Error(`${name}: yes or no`);
  }
  const before = setupFor(baseUrl, model) ?? {};
  read()[keyOf(baseUrl, model)] = {
    ...(context ? { context } : {}),
    ...(before.measured ? { measured: before.measured, measuredAt: before.measuredAt } : {}),
    tools, thinking, images, stream,
  };
  write();
}

// What the server said its window is, kept apart from what you typed so the
// dialog can show both.
export function saveMeasured(baseUrl, model, tokens) {
  const key = keyOf(baseUrl, model);
  const before = read()[key] ?? {};
  read()[key] = { ...before, measured: tokens, measuredAt: new Date().toISOString() };
  write();
}

export function forgetSetup(baseUrl, model) {
  if (read()[keyOf(baseUrl, model)]) {
    delete read()[keyOf(baseUrl, model)];
    write();
  }
}

// models.dev's facts with yours laid over them. Context: what you typed, else
// what the server measured, else what models.dev says. The rest: what you set,
// else models.dev. Returns null when nobody knows anything.
//
// `source` says where the abilities came from, which is the answer to "why
// does this row say it cannot call tools".
export function withSetup(info, baseUrl, model) {
  const set = setupFor(baseUrl, model);
  if (!set && !info) return null;
  if (!set) return { ...info, source: "models.dev" };

  const merged = { ...(info ?? {}) };
  const context = set.context ?? set.measured ?? info?.context;
  if (context) merged.context = context;
  if (set.tools !== undefined) merged.tools = set.tools;
  if (set.thinking !== undefined) merged.reasoning = set.thinking;
  if (set.images !== undefined) merged.vision = set.images;
  merged.source = "you";
  merged.set = set;
  return merged;
}

// For tests: forget what was read, so a different HOME is read afresh.
export const forgetSetupCache = () => {
  table = null;
};
