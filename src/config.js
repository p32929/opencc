import { existsSync, readFileSync } from "node:fs";
import { GLOBAL_CONFIG_PATH } from "./paths.js";

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
// _2, _3, ... — OPENAI_BASE_URL_2, OPENAI_API_KEY_2, BIG_MODEL_2, and so on.
// They're tried in this order, so put your preferred one first.
// The host on its own, used when a provider hasn't been given a name.
function providerLabel(baseUrl) {
  return baseUrl ? baseUrl.replace(/^https?:\/\//, "").split("/")[0] : "";
}

// What a provider is called in logs, menus and the startup banner: whatever
// name was set for it, otherwise just its host.
export function displayName(provider) {
  return provider.name || providerLabel(provider.baseUrl) || "(unnamed)";
}

// BIG_MODEL / SMALL_MODEL hold a comma-separated priority list, tried left to
// right. A single value is just a list of one, so older configs still parse.
function modelList(value) {
  return (value || "").split(",").map((m) => m.trim()).filter(Boolean);
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
        bigModels: modelList(values[`BIG_MODEL${suffix}`]),
        smallModels: modelList(values[`SMALL_MODEL${suffix}`]),
      };
    })
    .filter((provider) => provider.baseUrl && provider.bigModels.length > 0);
}

function readConfig() {
  // A project-local .env (running from inside a clone of this repo) always
  // wins over the global config `opencc init` writes.
  const merged = { ...parseEnvFile(GLOBAL_CONFIG_PATH), ...parseEnvFile(".env") };

  // Streaming is on unless explicitly turned off. Some OpenAI-compatible
  // backends have flaky SSE — truncated streams, missing usage, malformed
  // tool-call deltas — and turning this off makes opencc fetch the whole
  // reply first, then hand it to Claude Code as a single-shot stream.
  const streaming = !["off", "false", "0", "no"].includes(
    (merged.STREAMING || "on").trim().toLowerCase(),
  );

  return {
    providers: providersFromEnv(merged),
    port: Number(merged.PORT || 3000),
    streaming,
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
