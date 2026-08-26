import { createInterface } from "node:readline/promises";
import { GLOBAL_CONFIG_PATH } from "./paths.js";
import { readStoredConfig, writeStoredConfig } from "./configStore.js";

async function ask(rl, label, def) {
  const suffix = def ? ` [${def}]` : "";
  const answer = (await rl.question(`${label}${suffix}: `)).trim();
  return answer || def || "";
}

// Sends a minimal real request ("Hi") to confirm the base URL, key, and
// model actually work together — rather than only finding out later, mid
// Claude Code session, that something was typed wrong.
async function testModel(baseUrl, apiKey, model) {
  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "Hi" }],
        max_tokens: 10,
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      const text = await res.text();
      return { ok: false, error: `${res.status} ${text.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export async function runInit() {
  let existing = readStoredConfig();

  while (true) {
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

    // Save immediately — nothing you just typed is lost even if the test
    // below fails, and the next loop (if any) starts from these values.
    writeStoredConfig({
      OPENAI_BASE_URL: baseUrl,
      OPENAI_API_KEY: apiKey,
      BIG_MODEL: bigModel,
      SMALL_MODEL: smallModel,
      PORT: port,
    });
    existing = { OPENAI_BASE_URL: baseUrl, OPENAI_API_KEY: apiKey, BIG_MODEL: bigModel, SMALL_MODEL: smallModel, PORT: port };

    console.log("");
    console.log('Testing — sending "Hi" to each model...');

    const effectiveSmallModel = smallModel || bigModel;
    const bigResult = await testModel(baseUrl, apiKey, bigModel);
    const smallResult =
      effectiveSmallModel === bigModel ? bigResult : await testModel(baseUrl, apiKey, effectiveSmallModel);

    console.log(bigResult.ok ? `  normal model (${bigModel}): OK` : `  normal model (${bigModel}): FAILED — ${bigResult.error}`);
    if (effectiveSmallModel !== bigModel) {
      console.log(
        smallResult.ok
          ? `  background model (${effectiveSmallModel}): OK`
          : `  background model (${effectiveSmallModel}): FAILED — ${smallResult.error}`,
      );
    }

    if (bigResult.ok && smallResult.ok) {
      console.log("");
      console.log(`Saved to ${GLOBAL_CONFIG_PATH}`);
      console.log('Run "opencc" to start the proxy, then "opencc claude" in another terminal.');
      return;
    }

    console.log("");
    console.log("Something's wrong — double-check the base URL, API key, and model");
    console.log("name(s) above. What you entered is saved, so trying again starts");
    console.log("from those values.");
    console.log("");

    const retryRl = createInterface({ input: process.stdin, output: process.stdout });
    const retry = (await retryRl.question("Try again? [Y/n]: ")).trim().toLowerCase();
    retryRl.close();

    if (retry === "n" || retry === "no") {
      console.log("");
      console.log('Left as-is. Run "opencc init" again any time to fix it.');
      return;
    }
    console.log("");
  }
}
