#!/usr/bin/env node

const args = process.argv.slice(2);
const subcommand = args[0];

// Anything after "claude" belongs to Claude Code, including its own --help,
// so this only answers when opencc itself is being asked.
if (subcommand !== "claude" && (args.includes("-h") || args.includes("--help"))) {
  console.log(`
opencc - use Claude Code with any OpenAI-compatible API

  opencc                 start the panel and the proxy
  opencc claude [args]   start Claude Code through the proxy
  opencc --reset-stats   forget every result and start learning again

Options

  --port N               port for the proxy (default: from your config)
  --panel-port N         port for the panel (default: 3450)
  --no-warmup            do not test new models at startup
  -h, --help             this

The panel is where you add providers. The proxy is what Claude Code talks to,
and it only starts once at least one model can call tools.

  config   ~/.opencc/.env
  record   ~/.opencc/stats.jsonl
`);
  process.exit(0);
}

// Checked before anything else dispatches, so it works wherever you put it
// on the line. It only ever touches what opencc learned: providers, models,
// keys and settings are in a different file and are not read here.
if (args.includes("--reset-stats")) {
  const { resetStats } = await import("./stats.js");
  const { moved, previous } = resetStats();
  console.log("");
  console.log(moved
    ? `  Record reset. The old one is at ${previous}`
    : "  Nothing on record, so nothing to reset.");
  console.log("  Providers, models and keys are untouched.");
  console.log("  The next time you run opencc it warms up and starts learning again.");
  console.log("");
  process.exit(0);
}

if (subcommand === "claude") {
  await runClaude(args.slice(1));
} else {
  // "opencc" and "opencc init" are the same thing. There is one command: it
  // serves the panel, and it serves the proxy as soon as there is something
  // to route to.
  await run();
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

function flagValue(name) {
  const at = args.indexOf(name);
  const given = at === -1 ? NaN : Number(args[at + 1]);
  return Number.isInteger(given) && given > 0 && given < 65536 ? given : undefined;
}

// One command, two servers.
//
// The panel always comes up: without it there is no way to add a provider.
// The proxy only comes up once there is at least one provider with a model,
// because a proxy with nothing behind it can only fail. Adding one in the
// panel brings the proxy up on the spot, so the first run is: start opencc,
// fill in the panel, start Claude Code.
async function run() {
  const { getConfig, isConfigured } = await import("./config.js");
  const { coverage } = await import("./stats.js");
  const { runPanel, openBrowser, DEFAULT_PANEL_PORT } = await import("./panel.js");
  const { startServer } = await import("./server.js");

  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

  let proxyPort = null;
  // Why the proxy is not up, as lines to print. Null once it is.
  let heldBack = ["proxy  waiting - add a provider in the panel and it starts on its own"];

  // Whether there is any point exposing the proxy yet.
  //
  // Tool calling is not optional: Claude Code reads and edits files with it,
  // so a proxy whose models all fail at it can only waste your time. The bar
  // is "we know it cannot work", not "we have not proved it can" - a model
  // nobody has asked yet gets the benefit of the doubt, or a fresh install
  // started with --no-warmup would never come up.
  function blockedBecause(live) {
    if (!isConfigured(live)) {
      return ["proxy  waiting - add a provider in the panel and it starts on its own"];
    }

    const tools = coverage(live.providers, "tools");
    if (tools.can === 0 && tools.untried === 0) {
      return [
        `proxy  not started - none of your ${plural(tools.cannot, "model")} can call tools`,
        "       Claude Code needs it to read and edit files.",
        "       Add a model that can, in the panel, and it starts.",
      ];
    }

    return null;
  }

  async function startProxy({ announce = true } = {}) {
    if (proxyPort !== null) return;

    const live = getConfig();
    heldBack = blockedBecause(live);
    if (heldBack) return;

    // The port is taken before the warm-up runs, so a clash is known in a
    // moment rather than after a minute of probing.
    let port = flagValue("--port") ?? live.port;
    for (let tries = 0; ; tries++) {
      try {
        await startServer(port);
        break;
      } catch (err) {
        if (err.code !== "EADDRINUSE" || tries >= 20) throw err;
        port += 1;
      }
    }
    proxyPort = port;
    await rememberPort(port);

    if (!args.includes("--no-warmup")) {
      const { warmUp, printingReporter } = await import("./warmup.js");
      await warmUp(live.providers, { onEvent: printingReporter() });
    }

    if (!announce) return;

    const enabled = live.providers.filter((p) => !p.disabled);
    const models = enabled.reduce((n, p) => n + p.models.length - (p.disabledModels ?? []).length, 0);

    console.log("");
    console.log(`  proxy  http://localhost:${port}   ${plural(models, "model")}, ${plural(enabled.length, "provider")}`);
    if (!live.streaming) console.log("  streaming is off, so replies arrive complete");

    // Images are optional: Claude Code works fine without them, you just
    // cannot paste a screenshot. Worth saying, not worth blocking over.
    const images = coverage(live.providers, "image");
    if (images.can === 0 && images.untried === 0) {
      console.log("  no model can take images, so pasted screenshots will fail");
    }

    console.log("");
    console.log("  in another terminal: opencc claude");
    console.log("");
  }

  const panel = await runPanel({
    port: flagValue("--panel-port") ?? DEFAULT_PANEL_PORT,
    onSave: startProxy,
  });
  const panelUrl = `http://localhost:${panel.address().port}`;

  console.log("");
  console.log(`  panel  ${panelUrl}`);

  await startProxy();

  if (heldBack) {
    for (const lineText of heldBack) console.log(`  ${lineText}`);
    console.log("");
    // There is nothing to do but open the panel and fix it.
    openBrowser(panelUrl);
  }

  // Both servers keep the process alive. Ctrl+C stops both.
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
