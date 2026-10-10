import { mkdirSync, writeFileSync } from "node:fs";
import { GLOBAL_CONFIG_DIR, GLOBAL_CONFIG_PATH } from "./paths.js";
import { parseEnvFile } from "./config.js";

export function readStoredConfig() {
  return parseEnvFile(GLOBAL_CONFIG_PATH);
}

const joinModels = (models) => (Array.isArray(models) ? models.join(", ") : models || "");

// providers: [{ name, baseUrl, apiKey, bigModels, smallModels }, ...] in
// priority order. `name` is optional; the model fields take an array (a
// priority list) or a plain string. `streaming` defaults to on, so it only
// gets written when it's switched off.
export function writeStoredConfig({ providers, port, streaming = true }) {
  mkdirSync(GLOBAL_CONFIG_DIR, { recursive: true });

  const lines = [];
  providers.forEach((provider, i) => {
    // First provider keeps the unsuffixed key names, so a file written here
    // is still readable by an older opencc (it just sees provider 1).
    const suffix = i === 0 ? "" : `_${i + 1}`;
    if (i > 0) lines.push("");
    if (provider.name) lines.push(`PROVIDER_NAME${suffix}=${provider.name}`);
    if (provider.disabled) lines.push(`PROVIDER_DISABLED${suffix}=true`);
    const off = joinModels(provider.disabledModels);
    if (off) lines.push(`PROVIDER_MODELS_DISABLED${suffix}=${off}`);
    lines.push(`OPENAI_BASE_URL${suffix}=${provider.baseUrl}`);
    lines.push(`OPENAI_API_KEY${suffix}=${provider.apiKey || ""}`);
    lines.push(`BIG_MODEL${suffix}=${joinModels(provider.bigModels)}`);
    const small = joinModels(provider.smallModels);
    if (small) lines.push(`SMALL_MODEL${suffix}=${small}`);
  });

  lines.push("");
  lines.push(`PORT=${port || "3000"}`);
  if (!streaming) lines.push("STREAMING=off");

  writeFileSync(GLOBAL_CONFIG_PATH, lines.join("\n") + "\n", { mode: 0o600 });
}
