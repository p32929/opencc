#!/usr/bin/env node

const args = process.argv.slice(2);
const subcommand = args[0];

if (subcommand === "init") {
  // The browser panel is the default — it's a better place to manage a dozen
  // models and their capabilities. --tui keeps the terminal menu for a machine
  // with no browser, over SSH for instance. Both edit the same config.
  if (args.includes("--tui")) {
    const { runInit } = await import("./init.js");
    await runInit();
    process.exit(0);
  }

  const { runPanel } = await import("./panel.js");
  // --port skips the question, for scripting.
  const flag = args.indexOf("--port");
  const given = flag !== -1 ? Number(args[flag + 1]) : undefined;
  await runPanel(Number.isInteger(given) ? { port: given, ask: false } : {});
  // The panel's own listening server keeps this process alive; Ctrl+C stops
  // it. Nothing else runs — init edits config, it doesn't serve the proxy.
} else if (subcommand === "claude") {
  await runClaude(args.slice(1));
} else {
  await runServer();
}

// Asked every time the proxy starts, so you always know which port it's on and
// can move it without editing config first. Skipped when there's no terminal
// to ask (a script, a process manager) or when --port already said.
async function askPort(label, fallback) {
  if (!process.stdin.isTTY) return Number(fallback);
  const { createInterface } = await import("node:readline/promises");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(`  ${label} [${fallback}]: `)).trim();
  rl.close();
  if (!answer) return Number(fallback);
  const n = Number(answer);
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : Number(fallback);
}

// The chosen port is written back, because "opencc claude" and the panel both
// read it from config. A proxy listening somewhere the config doesn't know
// about is how you get "proxy isn't running" while it plainly is.
async function rememberPort(port) {
  const { readStoredConfig, writeStoredConfig } = await import("./configStore.js");
  const { providersFromEnv, streamingFromEnv } = await import("./config.js");
  const stored = readStoredConfig();
  if (String(stored.PORT ?? "") === String(port)) return;
  writeStoredConfig({
    providers: providersFromEnv(stored),
    port: String(port),
    streaming: streamingFromEnv(stored),
  });
}

async function runServer() {
  const { isConfigured, config, displayName } = await import("./config.js");

  if (!isConfigured()) {
    console.error("opencc is not configured yet.");
    console.error('Run "opencc init" to set it up.');
    process.exit(1);
  }

  const flag = args.indexOf("--port");
  const given = flag !== -1 ? Number(args[flag + 1]) : undefined;
  let port = Number.isInteger(given) ? given : await askPort("Port for the proxy", config.port);

  const { startServer } = await import("./server.js");
  while (true) {
    try {
      await startServer(port);
      break;
    } catch (err) {
      if (err.code !== "EADDRINUSE") throw err;
      console.log(`  Port ${port} is already in use.`);
      if (!process.stdin.isTTY || Number.isInteger(given)) process.exit(1);
      port = await askPort("Port for the proxy", port + 1);
    }
  }
  await rememberPort(port);

  console.log(`opencc listening on http://localhost:${port}`);
  console.log("");
  config.providers.forEach((provider, i) => {
    if (provider.disabled) {
      console.log(`  ${i + 1}. ${displayName(provider)} (disabled — skipped)`);
      return;
    }
    console.log(`  ${i + 1}. ${displayName(provider)}`);
    console.log(`       Big (Opus, Sonnet) -> ${provider.bigModels.join(" → ")}`);
    const small = provider.smallModels.length ? provider.smallModels : provider.bigModels;
    console.log(`       Small (Haiku)      -> ${small.join(" → ")}`);
  });
  if (!config.streaming) {
    console.log("");
    console.log("  Streaming is off — replies arrive complete instead of token by token.");
  }
  if (config.providers.every((provider) => provider.disabled)) {
    console.log("");
    console.log('  Every provider is disabled — run "opencc init" to enable one.');
  }
  if (config.providers.filter((p) => !p.disabled).length > 1) {
    console.log("");
    console.log("  Tried in order — if one fails, the next one takes over.");
  }
  console.log("");
  console.log("In another terminal, run: opencc claude");
  console.log('(Arguments after "claude" are passed through to Claude Code.)');
  console.log("");
  console.log('To change these settings, run "opencc init" (from either terminal).');
  console.log("");
  // No further action needed — the listening server keeps this process
  // alive on its own. Ctrl+C (or closing the terminal) stops it; nothing
  // runs in the background beyond that.
}

async function isProxyReachable(port) {
  try {
    const res = await fetch(`http://localhost:${port}/`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

function quoteArg(arg) {
  if (process.platform === "win32") {
    return `"${String(arg).replace(/"/g, '""')}"`;
  }
  return `'${String(arg).replace(/'/g, `'\\''`)}'`;
}

async function runClaude(claudeArgs) {
  const { config } = await import("./config.js");
  const { spawn } = await import("node:child_process");

  if (!(await isProxyReachable(config.port))) {
    console.error(`opencc's proxy isn't running on http://localhost:${config.port}`);
    console.error("Start it in another terminal with: opencc");
    process.exit(1);
  }

  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  env.ANTHROPIC_BASE_URL = `http://localhost:${config.port}`;
  env.ANTHROPIC_AUTH_TOKEN = "not-needed";

  // shell: true resolves "claude" the same way whether it's a POSIX binary,
  // a Windows .cmd shim, or anything else on PATH — this is what makes the
  // same script work unmodified on macOS, Linux, and Windows. We build one
  // pre-quoted command string (rather than an args array) since Node warns
  // that shell:true + an args array concatenates arguments unescaped.
  const quoted = claudeArgs.map(quoteArg).join(" ");
  const child = spawn(quoted ? `claude ${quoted}` : "claude", {
    stdio: "inherit",
    shell: true,
    env,
  });

  child.on("error", (err) => {
    console.error(`Failed to start Claude Code: ${err.message}`);
    console.error("Install it with: npm install -g @anthropic-ai/claude-code");
    process.exit(1);
  });

  child.on("exit", (code, signal) => {
    process.exit(code ?? (signal ? 1 : 0));
  });
}
