import { createInterface } from "node:readline/promises";
import { GLOBAL_CONFIG_PATH } from "./paths.js";
import { readStoredConfig, writeStoredConfig } from "./configStore.js";

async function ask(rl, label, def) {
  const suffix = def ? ` [${def}]` : "";
  const answer = (await rl.question(`${label}${suffix}: `)).trim();
  return answer || def || "";
}

export async function runInit() {
  const existing = readStoredConfig();

  console.log(`opencc setup — this writes to ${GLOBAL_CONFIG_PATH}`);
  console.log("Press enter to keep a value shown in [brackets].");
  console.log("");

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const baseUrl = await ask(rl, "OpenAI-compatible base URL (e.g. https://api.openai.com/v1)", existing.OPENAI_BASE_URL);
  const apiKey = await ask(rl, "OpenAI-compatible API key", existing.OPENAI_API_KEY);
  const bigModel = await ask(rl, "Model for normal Sonnet/Opus-tier requests", existing.BIG_MODEL);
  const smallModel = await ask(
    rl,
    "Model for cheap Haiku-tier background requests (blank = same as above)",
    existing.SMALL_MODEL,
  );
  const port = await ask(rl, "Port", existing.PORT || "3000");
  rl.close();

  writeStoredConfig({
    OPENAI_BASE_URL: baseUrl,
    OPENAI_API_KEY: apiKey,
    BIG_MODEL: bigModel,
    SMALL_MODEL: smallModel,
    PORT: port,
  });

  console.log("");
  console.log(`Saved to ${GLOBAL_CONFIG_PATH}`);
  console.log('Run "opencc" to start the proxy, then "opencc claude" in another terminal.');
}
