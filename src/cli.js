#!/usr/bin/env node

const args = process.argv.slice(2);
const subcommand = args[0];

if (subcommand === "init") {
  const { runInit } = await import("./init.js");
  await runInit();
  process.exit(0);
}

if (subcommand === "claude") {
  await runClaude(args.slice(1));
} else {
  await runServer();
}

async function runServer() {
  const { isConfigured, config } = await import("./config.js");

  if (!isConfigured()) {
    console.error("opencc is not configured yet.");
    console.error('Run "opencc init" to set it up.');
    process.exit(1);
  }

  const { startServer } = await import("./server.js");
  await startServer();

  console.log(`opencc listening on http://localhost:${config.port}`);
  console.log("");
  console.log(`  Sonnet/Opus requests -> ${config.bigModel}`);
  console.log(`  Haiku requests       -> ${config.smallModel}`);
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
