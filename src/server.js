import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { config, isConfigured } from "./config.js";
import { pickModel, toOpenAIRequest, toAnthropicResponse, toAnthropicError } from "./translate.js";
import { streamOpenAIToAnthropic } from "./stream.js";

const MAX_BODY_BYTES = 25 * 1024 * 1024;

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("Request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });

    req.on("error", reject);
  });
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(body);
}

async function handleMessages(anthropicReq, res) {
  if (!isConfigured()) {
    sendJson(res, 503, toAnthropicError(503, 'opencc is not configured. Run "opencc init" first.'));
    return;
  }

  const model = pickModel(anthropicReq.model);
  const openaiReq = toOpenAIRequest(anthropicReq, model);

  const upstream = await fetch(`${config.openaiBaseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.openaiApiKey}`,
    },
    body: JSON.stringify(openaiReq),
  });

  if (!upstream.ok) {
    const text = await upstream.text();
    console.error(`[opencc]   upstream ${upstream.status}: ${text}`);
    sendJson(res, upstream.status, toAnthropicError(upstream.status, text));
    return;
  }

  if (anthropicReq.stream) {
    await streamOpenAIToAnthropic(upstream, res, anthropicReq.model);
  } else {
    const data = await upstream.json();
    sendJson(res, 200, toAnthropicResponse(data, anthropicReq.model));
  }
}

// Claude Code calls this to estimate a request's size before sending it.
// A precise Anthropic-compatible tokenizer isn't available here, so this
// returns a rough character-based estimate instead.
function handleCountTokens(body, res) {
  let chars = 0;

  const system = body.system;
  if (typeof system === "string") chars += system.length;
  else if (Array.isArray(system)) {
    chars += system.filter((b) => b.type === "text").reduce((sum, b) => sum + b.text.length, 0);
  }

  for (const msg of body.messages ?? []) {
    if (typeof msg.content === "string") {
      chars += msg.content.length;
    } else if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === "text") chars += block.text.length;
        else if (block.type === "tool_use") chars += JSON.stringify(block.input ?? {}).length;
        else if (block.type === "tool_result") chars += JSON.stringify(block.content ?? "").length;
      }
    }
  }

  sendJson(res, 200, { input_tokens: Math.ceil(chars / 4) });
}

const server = createServer(async (req, res) => {
  // Ignore query strings and a trailing slash so a client that appends
  // either of those still matches our routes.
  const path = req.url.split("?")[0].replace(/\/$/, "") || "/";
  console.log(`[opencc] ${req.method} ${req.url}`);

  try {
    if (req.method === "GET" && path === "/") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("opencc is running");
      return;
    }

    if (req.method === "POST" && path === "/v1/messages") {
      const body = await readJsonBody(req);
      console.log(`[opencc]   model=${body.model} stream=${Boolean(body.stream)}`);
      await handleMessages(body, res);
      return;
    }

    if (req.method === "POST" && path === "/v1/messages/count_tokens") {
      const body = await readJsonBody(req);
      handleCountTokens(body, res);
      return;
    }

    console.log(`[opencc]   no route matched for ${req.method} ${path}`);
    sendJson(res, 404, toAnthropicError(404, "Not found"));
  } catch (err) {
    console.error(err);
    if (!res.headersSent) {
      sendJson(res, 500, toAnthropicError(500, err.message));
    } else {
      res.end();
    }
  }
});

export function startServer() {
  return new Promise((resolve) => {
    // "localhost" only — never exposed to the LAN.
    server.listen(config.port, "localhost", () => {
      resolve(server);
    });
  });
}

// This runs the proxy on its own, useful for watching its request logs in
// a dedicated terminal without going through cli.js's config check. `opencc`
// (src/cli.js, no arguments) is the normal way to start the server.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  await startServer();
  console.log(`opencc listening on http://localhost:${config.port}`);
  console.log("");
}
