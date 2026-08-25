import { existsSync, readFileSync } from "node:fs";
import { GLOBAL_CONFIG_PATH } from "./paths.js";

function parseEnvFile(path) {
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

function readConfig() {
  // A project-local .env (running from inside a clone of this repo) always
  // wins over the global config `opencc init` writes.
  const merged = { ...parseEnvFile(GLOBAL_CONFIG_PATH), ...parseEnvFile(".env") };

  return {
    openaiBaseUrl: (merged.OPENAI_BASE_URL || "").replace(/\/+$/, ""),
    openaiApiKey: merged.OPENAI_API_KEY || "",
    bigModel: merged.BIG_MODEL || "",
    smallModel: merged.SMALL_MODEL || merged.BIG_MODEL || "",
    port: Number(merged.PORT || 3000),
  };
}

export const config = readConfig();

export function isConfigured(c = config) {
  return Boolean(c.openaiBaseUrl && c.openaiApiKey && c.bigModel);
}
