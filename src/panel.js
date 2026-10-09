// The admin panel `opencc init` opens. Same job as the terminal menu, but a
// browser is a better place to manage a dozen models and their capabilities.
//
// No dependencies: Node's http server, one hand-written page, and a small JSON
// API over the same configStore the terminal menu uses, so the two stay
// interchangeable.
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { readStoredConfig, writeStoredConfig } from "./configStore.js";
import { providersFromEnv, displayName } from "./config.js";
import {
  readCapabilities,
  writeCapabilities,
  setCapability,
  fetchCatalogue,
  detectCapabilities,
} from "./capabilities.js";
import { page } from "./panelPage.js";

const json = (res, status, body) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
      if (raw.length > 2_000_000) reject(new Error("body too large"));
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

const streamingOf = (stored) =>
  !["off", "false", "0", "no"].includes((stored.STREAMING || "on").trim().toLowerCase());

function loadState() {
  const stored = readStoredConfig();
  return {
    providers: providersFromEnv(stored).map((p) => ({ ...p, label: displayName(p) })),
    port: stored.PORT || "3000",
    streaming: streamingOf(stored),
    capabilities: readCapabilities(),
  };
}

// One real "Hi" through the provider, the same check the terminal menu runs.
async function testModel(provider, model) {
  const headers = { "Content-Type": "application/json" };
  if (provider.apiKey) headers.Authorization = `Bearer ${provider.apiKey}`;
  try {
    const res = await fetch(`${provider.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({ model, messages: [{ role: "user", content: "Hi" }] }),
      signal: AbortSignal.timeout(300000),
    });
    if (!res.ok) return { ok: false, error: `${res.status} ${(await res.text()).slice(0, 200)}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function openBrowser(url) {
  // Headless machines and test runs don't want a browser launched at them.
  if (process.env.OPENCC_NO_BROWSER) return;
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  try {
    // Detached and ignored: if no browser can be opened we just print the URL.
    spawn(cmd, [url], { stdio: "ignore", detached: true, shell: process.platform === "win32" }).unref();
  } catch {
    /* printed below either way */
  }
}

export function runPanel() {
  const server = createServer(async (req, res) => {
    const path = req.url.split("?")[0];

    try {
      if (req.method === "GET" && (path === "/" || path === "/index.html")) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(page());
        return;
      }

      if (req.method === "GET" && path === "/api/state") {
        json(res, 200, loadState());
        return;
      }

      if (req.method === "POST" && path === "/api/state") {
        const body = await readBody(req);
        writeStoredConfig({
          providers: body.providers ?? [],
          port: body.port,
          streaming: body.streaming !== false,
        });
        json(res, 200, loadState());
        return;
      }

      // Capabilities the user set by hand win over anything detected.
      if (req.method === "POST" && path === "/api/capability") {
        const { baseUrl, model, caps } = await readBody(req);
        const all = setCapability(readCapabilities(), baseUrl, model, {
          ...caps,
          source: "manual",
          detectedAt: new Date().toISOString(),
        });
        writeCapabilities(all);
        json(res, 200, { capabilities: all });
        return;
      }

      if (req.method === "POST" && path === "/api/detect") {
        const { index } = await readBody(req);
        const { providers } = loadState();
        const chosen = typeof index === "number" ? [providers[index]] : providers;

        let all = readCapabilities();
        for (const provider of chosen.filter(Boolean)) {
          const catalogue = await fetchCatalogue(provider);
          const models = [...new Set([...provider.bigModels, ...provider.smallModels])];
          // Sequential per provider so a detection run can't hammer one key.
          for (const model of models) {
            all = setCapability(all, provider.baseUrl, model, await detectCapabilities(provider, model, catalogue));
          }
        }
        writeCapabilities(all);
        json(res, 200, { capabilities: all });
        return;
      }

      if (req.method === "POST" && path === "/api/test") {
        const { index, model } = await readBody(req);
        const provider = loadState().providers[index];
        if (!provider) {
          json(res, 404, { ok: false, error: "no such provider" });
          return;
        }
        json(res, 200, await testModel(provider, model));
        return;
      }

      // The provider's own catalogue, so you can pick a model instead of
      // typing one and finding out later it doesn't exist.
      if (req.method === "GET" && path === "/api/catalogue") {
        const index = Number(new URL(req.url, "http://localhost").searchParams.get("index"));
        const provider = loadState().providers[index];
        if (!provider) {
          json(res, 404, { models: [] });
          return;
        }
        const headers = {};
        if (provider.apiKey) headers.Authorization = `Bearer ${provider.apiKey}`;
        try {
          const upstream = await fetch(`${provider.baseUrl}/models`, {
            headers,
            signal: AbortSignal.timeout(30000),
          });
          const body = await upstream.json();
          const data = Array.isArray(body) ? body : (body.data ?? []);
          json(res, 200, { models: data.map((m) => m.id).filter(Boolean).sort() });
        } catch (err) {
          json(res, 200, { models: [], error: err.message });
        }
        return;
      }

      json(res, 404, { error: "not found" });
    } catch (err) {
      json(res, 500, { error: err.message });
    }
  });

  return new Promise((resolve) => {
    // Port 0 picks a free one, so the panel can never collide with the proxy,
    // and localhost only — this edits your API keys.
    server.listen(0, "localhost", () => {
      const { port } = server.address();
      const url = `http://localhost:${port}`;
      console.log("");
      console.log(`  opencc admin panel → ${url}`);
      console.log("  Changes save as you make them. Ctrl+C when you're done.");
      console.log("");
      openBrowser(url);
      resolve(server);
    });
  });
}
