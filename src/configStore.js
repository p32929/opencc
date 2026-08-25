import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { GLOBAL_CONFIG_DIR, GLOBAL_CONFIG_PATH } from "./paths.js";

export function readStoredConfig() {
  if (!existsSync(GLOBAL_CONFIG_PATH)) return {};
  const values = {};
  for (const line of readFileSync(GLOBAL_CONFIG_PATH, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    values[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return values;
}

// values: { OPENAI_BASE_URL, OPENAI_API_KEY, BIG_MODEL, SMALL_MODEL, PORT }
export function writeStoredConfig(values) {
  mkdirSync(GLOBAL_CONFIG_DIR, { recursive: true });

  const lines = [
    `OPENAI_BASE_URL=${values.OPENAI_BASE_URL || ""}`,
    `OPENAI_API_KEY=${values.OPENAI_API_KEY || ""}`,
    `BIG_MODEL=${values.BIG_MODEL || ""}`,
    values.SMALL_MODEL ? `SMALL_MODEL=${values.SMALL_MODEL}` : null,
    `PORT=${values.PORT || "3000"}`,
  ].filter(Boolean);

  writeFileSync(GLOBAL_CONFIG_PATH, lines.join("\n") + "\n", { mode: 0o600 });
}
