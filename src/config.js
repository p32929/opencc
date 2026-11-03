import { existsSync, readFileSync } from "node:fs";
import { GLOBAL_CONFIG_PATH } from "./paths.js";
import { behaviorFromEnv } from "./behavior.js";

export function parseEnvFile(path) {
  if (!existsSync(path)) return {};
  const values = {};

  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;

    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }

  return values;
}

// Providers are numbered in the .env file: the first one carries no suffix
// (so an older single-provider config keeps working as-is) and the rest are
// _2, _3, ... — OPENAI_BASE_URL_2, OPENAI_API_KEY_2, MODELS_2, and so on.
// The numbering is just how the file is laid out; it is not a priority.
// The host on its own, used when a provider hasn't been given a name.
function providerLabel(baseUrl) {
  return baseUrl ? baseUrl.replace(/^https?:\/\//, "").split("/")[0] : "";
}

// What a provider is called in logs, menus and the startup banner: whatever
// name was set for it, otherwise just its host.
export function displayName(provider) {
  return provider.name || providerLabel(provider.baseUrl) || "(unnamed)";
}

// MODELS holds a comma-separated list. The order in it means nothing: what
// gets called is decided from the record in stats.jsonl, not from where a
// name sits in the file.
function modelList(value) {
  return (value || "").split(",").map((m) => m.trim()).filter(Boolean);
}

// Configs written before the tiers were dropped carry BIG_MODEL and
// SMALL_MODEL instead. Both become one list, in the order they appeared,
// without duplicates. Nothing needs to be rewritten for this to work; the
// next save through the panel writes MODELS and the old keys fall away.
function modelsOf(values, suffix) {
  const current = modelList(values[`MODELS${suffix}`]);
  if (current.length > 0) return current;
  return [...new Set([
    ...modelList(values[`BIG_MODEL${suffix}`]),
    ...modelList(values[`SMALL_MODEL${suffix}`]),
  ])];
}

export function providersFromEnv(values) {
  // Collect the indexes actually present rather than counting up from 1, so
  // a hand-edited file with a gap (no _2 but a _3) doesn't silently lose it.
  const indexes = new Set([1]);
  for (const key of Object.keys(values)) {
    const match = key.match(/^OPENAI_BASE_URL_(\d+)$/);
    if (match) indexes.add(Number(match[1]));
  }

  return [...indexes]
    .sort((a, b) => a - b)
    .map((i) => {
      const suffix = i === 1 ? "" : `_${i}`;
      const baseUrl = (values[`OPENAI_BASE_URL${suffix}`] || "").replace(/\/+$/, "");
      // Optional free-text name, so "work openrouter" and "personal
      // openrouter" are tellable apart in the list and the logs.
      const name = values[`PROVIDER_NAME${suffix}`] || "";
      return {
        name,
        // Parked rather than deleted: it keeps its place and its key, and is
        // skipped when picking a provider to call.
        disabled: values[`PROVIDER_DISABLED${suffix}`] === "true",
        baseUrl,
        // Optional: a local backend (Ollama, llama.cpp) usually wants no key,
        // and we omit the Authorization header entirely when it's blank.
        apiKey: values[`OPENAI_API_KEY${suffix}`] || "",
        models: modelsOf(values, suffix),
        // Parked models keep their place in the lists above and are skipped
        // when picking one to call. Per provider rather than per tier: "this
        // model, from this provider" is the thing you want to switch off.
        disabledModels: modelList(values[`PROVIDER_MODELS_DISABLED${suffix}`]),
        // Whether to ask this provider for its model list at all. Some
        // backends have thousands of models, charge for the listing, or do
        // not implement it; with it off only the models you have added by
        // name show. Anything but "off" means on.
        list: String(values[`PROVIDER_LIST${suffix}`] ?? "").trim().toLowerCase() !== "off",
        // Models added by name, which the provider's own list may not carry.
        // Remembered separately from the pot: taking one out of the pot does
        // not forget it, so it can be put back without retyping.
        added: modelList(values[`PROVIDER_ADDED${suffix}`]),
      };
    })
    // A provider with no models is kept. It cannot be routed to, and the
    // proxy says so when a request arrives, but dropping it would delete the
    // URL and key you just typed in the moment before you pick a model.
    .filter((provider) => provider.baseUrl);
}

// Streaming is on unless explicitly turned off. Some OpenAI-compatible
// backends have flaky SSE — truncated streams, missing usage, malformed
// tool-call deltas — and turning this off makes opencc fetch the whole reply
// first, then hand it to Claude Code as a single-shot stream.
// Exported so anything rewriting the config preserves the setting rather than
// guessing at it.
// Which providers you would rather use, best first, by base URL.
//
// Absent means no preference at all, which is the default and is not the same
// as "the order they happen to sit in the file". Only the ranking dialog
// writes this, so a preference is never inferred from how you added them.
export function rankFromEnv(values) {
  return (values.PROVIDER_RANK || "")
    .split(",")
    .map((url) => url.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}

// How long the panel's Test button waits for a model to say hello, in
// seconds. Saying "ok" is not hard work, so ten is generous; a backend you
// know to be slow but worth keeping can be given longer.
//
// This is the panel's budget only. A real request carries a large tool set
// and legitimately runs to minutes, which is why the proxy has its own far
// longer timeout and this must never be wired to it.
export const DEFAULT_TEST_TIMEOUT = 10;
const MIN_TEST_TIMEOUT = 1;
const MAX_TEST_TIMEOUT = 300;

export function testTimeoutFromEnv(values) {
  // An empty value means the key is there but says nothing, which is the
  // default rather than zero. Number("") is 0, and 0 would clamp to the
  // minimum, so a blank line would silently set a one-second timeout.
  const text = String(values.TEST_TIMEOUT ?? "").trim();
  if (!text) return DEFAULT_TEST_TIMEOUT;

  const raw = Number(text);
  if (!Number.isFinite(raw)) return DEFAULT_TEST_TIMEOUT;
  return Math.min(MAX_TEST_TIMEOUT, Math.max(MIN_TEST_TIMEOUT, Math.round(raw)));
}

// How many of one provider's models are tested at once.
//
// HeartCode derives this from the list length alone (one lane per hundred
// models), which means one at a time per provider for any list under a
// hundred. Measured on nine providers and 54 models, that is 17.8s against
// 8.1s at four lanes: with one lane the run is as long as the slowest
// provider's queue taken one model after another.
//
// So four by default, and still one more lane per hundred models on top, so
// a very long list keeps scaling. Set it to 1 for HeartCode's exact pacing.
export const DEFAULT_TEST_LANES = 4;
const MAX_TEST_LANES = 16;

export function testLanesFromEnv(values) {
  const text = String(values.TEST_LANES ?? "").trim();
  if (!text) return DEFAULT_TEST_LANES;
  const raw = Number(text);
  if (!Number.isFinite(raw)) return DEFAULT_TEST_LANES;
  return Math.min(MAX_TEST_LANES, Math.max(1, Math.round(raw)));
}

export function streamingFromEnv(values) {
  return !["off", "false", "0", "no"].includes((values.STREAMING || "on").trim().toLowerCase());
}

function readConfig() {
  // A project-local .env (running from inside a clone of this repo) always
  // wins over the global config `opencc init` writes.
  const merged = { ...parseEnvFile(GLOBAL_CONFIG_PATH), ...parseEnvFile(".env") };

  const streaming = streamingFromEnv(merged);

  return {
    providers: providersFromEnv(merged),
    rank: rankFromEnv(merged),
    port: Number(merged.PORT || 3000),
    streaming,
    testTimeout: testTimeoutFromEnv(merged),
    testLanes: testLanesFromEnv(merged),
    replyTag: (merged.REPLY_TAG || "").trim(),
    behavior: behaviorFromEnv(merged),
  };
}

// Re-read on every call rather than caching: the files are about a kilobyte,
// and the alternative was a restart after every change in `opencc init`.
// PORT is the exception — the socket is already bound, so changing it still
// needs a restart.
export function getConfig() {
  return readConfig();
}

// Snapshot taken at import, used for the startup banner and for binding the
// port. Request handling calls getConfig() so edits apply immediately.
export const config = readConfig();

export function isConfigured(c = config) {
  return c.providers.length > 0;
}
