import { mkdirSync, writeFileSync } from "node:fs";
import { GLOBAL_CONFIG_DIR, GLOBAL_CONFIG_PATH } from "./paths.js";
import { parseEnvFile } from "./config.js";

export function readStoredConfig() {
  return parseEnvFile(GLOBAL_CONFIG_PATH);
}

const joinModels = (models) => (Array.isArray(models) ? models.join(", ") : models || "");

// providers: [{ name, baseUrl, apiKey, models }, ...]. `name` is optional and
// `models` takes an array or a plain string. The order of either is only how
// the file reads; what gets called is decided from the record in stats.jsonl.
// `streaming` defaults to on, so it only gets written when it's switched off.
export function writeStoredConfig({ providers, port, streaming = true, rank = [] }) {
  mkdirSync(GLOBAL_CONFIG_DIR, { recursive: true });

  const lines = [];
  providers.forEach((provider, i) => {
    // The first provider keeps the unsuffixed key names, which is only a
    // convention the reader also follows.
    const suffix = i === 0 ? "" : `_${i + 1}`;
    if (i > 0) lines.push("");
    if (provider.name) lines.push(`PROVIDER_NAME${suffix}=${provider.name}`);
    if (provider.disabled) lines.push(`PROVIDER_DISABLED${suffix}=true`);
    const off = joinModels(provider.disabledModels);
    if (off) lines.push(`PROVIDER_MODELS_DISABLED${suffix}=${off}`);
    lines.push(`OPENAI_BASE_URL${suffix}=${provider.baseUrl}`);
    lines.push(`OPENAI_API_KEY${suffix}=${provider.apiKey || ""}`);
    lines.push(`MODELS${suffix}=${joinModels(provider.models)}`);
  });

  lines.push("");
  lines.push(`PORT=${port || "3000"}`);
  if (!streaming) lines.push("STREAMING=off");
  // Only written once you have actually ranked them. An empty key would read
  // back as a preference for nothing, and no key at all is the honest way to
  // say you have not expressed one.
  if (rank.length) lines.push(`PROVIDER_RANK=${rank.join(", ")}`);

  writeFileSync(GLOBAL_CONFIG_PATH, lines.join("\n") + "\n", { mode: 0o600 });
}
