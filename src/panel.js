// The admin panel: which providers exist, which models they offer, and how
// each of those has actually been doing.
//
// Nothing here sets ordering and nothing probes for capabilities. Ordering is
// read from the record in stats.jsonl as the proxy runs; what a model can do
// is read from models.dev. What is left to set is the part neither can know:
// a URL, a key, and which models to put in the pot.
//
// No dependencies: Node's http server, one hand-written page, and a small
// JSON API over the same configStore the rest of opencc reads.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { readStoredConfig, writeStoredConfig } from "./configStore.js";
import { providersFromEnv, displayName, streamingFromEnv, rankFromEnv } from "./config.js";
import { allStats, successRate, coolingFor, record, resetStats } from "./stats.js";
import { loadCatalog, lookupModel, catalogAge, catalogSize } from "./modelsdev.js";
import { listRequests, clearRequests, KEEP } from "./reqlog.js";
import { bus } from "./events.js";
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

// Read once: it cannot change while the process is running, and the page
// shows it beside the name in the sidebar.
let version = "";
try {
  const here = dirname(fileURLToPath(import.meta.url));
  version = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8")).version;
} catch {
  // Running from somewhere package.json is not reachable.
}

function loadState() {
  const stored = readStoredConfig();
  return {
    providers: providersFromEnv(stored).map((p) => ({ ...p, label: displayName(p) })),
    port: stored.PORT || "3000",
    streaming: streamingFromEnv(stored),
    rank: rankFromEnv(stored),
    version,
  };
}

// One real request, and what came back.
//
// Not a capability check: what a model can do is models.dev's answer, read
// from the catalogue, and opencc does not go asking. This is "does this name
// exist at this backend, and does it answer", which is the question a wrong
// model name or a dead key actually raises. The result is recorded like any
// other call, so the Record column has something in it before Claude Code
// sends the first request.
//
// The request and the reply are both returned, trimmed, because "it failed"
// without the body is the answer that sends you to curl.
const DUMP_LIMIT = 4000;
const trim = (text) => (text.length > DUMP_LIMIT ? text.slice(0, DUMP_LIMIT) + "\n…" : text);

async function testModel(provider, model) {
  const headers = { "Content-Type": "application/json" };
  if (provider.apiKey) headers.Authorization = `Bearer ${provider.apiKey}`;

  const body = {
    model,
    messages: [{ role: "user", content: "Reply with the single word: ok" }],
    max_tokens: 16,
  };
  const sent = JSON.stringify(body, null, 2);
  const startedAt = Date.now();

  try {
    const res = await fetch(`${provider.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120000),
    });
    const ms = Date.now() - startedAt;
    const text = await res.text();

    // "text" rather than a needs-based kind: this request carries no tools,
    // no image and no document, so that is the bucket it belongs in.
    record({ baseUrl: provider.baseUrl, model, kind: "text", status: res.status, ms });

    let got = text;
    try {
      got = JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      // Not JSON — an HTML error page, most likely. Shown as it came.
    }

    return {
      ok: res.ok,
      status: res.status,
      ms,
      sent: trim(sent),
      got: trim(got),
      error: res.ok ? undefined : reasonFrom(text) || `HTTP ${res.status}`,
    };
  } catch (err) {
    const ms = Date.now() - startedAt;
    record({ baseUrl: provider.baseUrl, model, kind: "text", status: 0, ms });
    return { ok: false, status: 0, ms, sent: trim(sent), error: err.message };
  }
}

// Providers say why in a dozen shapes: a JSON envelope, a bare string, or a
// whole HTML error page. Pull out the sentence if there is one, and failing
// that collapse it onto a line, because a 403 from Google is a document.
function reasonFrom(body) {
  try {
    const parsed = JSON.parse(body);
    for (const candidate of [parsed?.error?.message, parsed?.message, parsed?.detail, parsed?.title, parsed?.error]) {
      if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
    }
  } catch {
    // Fall through to the flattened text.
  }
  return body.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 300);
}

export const DEFAULT_PANEL_PORT = 3450;

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    // localhost only — this edits your API keys.
    server.listen(port, "localhost", () => resolve(server));
  });
}

export async function runPanel({ port = DEFAULT_PANEL_PORT, onSave } = {}) {
  // Warmed in the background so the first page load has it, and ignored if
  // it fails: everything here works without a catalogue, just with less to
  // show.
  loadCatalog().catch(() => {});

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

      // What has actually worked. This is the whole of what decides routing,
      // so the page shows it per model and per kind of request.
      if (req.method === "GET" && path === "/api/stats") {
        // Coverage below reads the catalogue, so it has to be loaded first or
        // the first paint reports every model as untested and offers to probe
        // the lot.
        await loadCatalog();
        const { providers } = loadState();
        const cooling = {};
        for (const p of providers) {
          for (const model of p.models) {
            const ms = coolingFor(p.baseUrl, model);
            if (ms) cooling[p.baseUrl + "|" + model] = ms;
          }
        }
        json(res, 200, {
          cooling,
          rows: allStats().map((row) => ({ ...row, rate: successRate(row) })),
        });
        return;
      }

      // Start over. Every model goes back to untried and routing is even
      // odds again until real requests fill it back in.
      if (req.method === "POST" && path === "/api/stats/reset") {
        json(res, 200, resetStats());
        return;
      }

      if (req.method === "POST" && path === "/api/state") {
        const body = await readBody(req);
        writeStoredConfig({
          providers: body.providers ?? [],
          port: body.port,
          streaming: body.streaming !== false,
          rank: Array.isArray(body.rank) ? body.rank : [],
        });
        json(res, 200, loadState());
        // The proxy may have been waiting for exactly this.
        await onSave?.();
        return;
      }

      if (req.method === "POST" && path === "/api/test") {
        const { index, model, kind = "tools" } = await readBody(req);
        const provider = loadState().providers[index];
        if (!provider) {
          json(res, 404, { ok: false, error: "no such provider" });
          return;
        }
        const outcome = await testModel(provider, model, kind);
        // A model that just answered may be the one the proxy was waiting for.
        await onSave?.();
        json(res, 200, outcome);
        return;
      }

      // Every request the proxy has served, newest first. The page filters
      // these itself: the whole list is at most a few hundred summaries.
      if (req.method === "GET" && path === "/api/requests") {
        json(res, 200, { keep: KEEP, items: listRequests() });
        return;
      }

      if (req.method === "POST" && path === "/api/requests/clear") {
        json(res, 200, clearRequests());
        return;
      }

      // What models.dev says about the models you have configured: context
      // window, price, and whether it lists them as calling tools or reading
      // images. A hint shown beside the record, never instead of it.
      if (req.method === "GET" && path === "/api/catalog") {
        await loadCatalog();
        const { providers } = loadState();
        const known = {};
        for (const p of providers) {
          for (const model of p.models) {
            const info = lookupModel(p.baseUrl, model);
            if (info) known[p.baseUrl + "|" + model] = info;
          }
        }
        json(res, 200, { known, size: catalogSize(), age: catalogAge() });
        return;
      }

      if (req.method === "POST" && path === "/api/catalog/refresh") {
        try {
          await loadCatalog({ force: true });
          json(res, 200, { size: catalogSize(), age: catalogAge() });
        } catch (err) {
          json(res, 200, { error: err.message, size: catalogSize(), age: catalogAge() });
        }
        return;
      }

      // Server-sent events, so a request served by the proxy shows up in the
      // page without it polling. The payload is only ever "something
      // changed": the page refetches what it needs, which keeps one copy of
      // the rule for what each view shows.
      if (req.method === "GET" && path === "/api/events") {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });
        res.write("retry: 2000\n\n");

        const send = (what) => {
          if (!res.writableEnded) res.write(`data: ${JSON.stringify({ what })}\n\n`);
        };
        const onRequest = () => send("request");
        const onCleared = () => send("requests-cleared");
        bus.on("request", onRequest);
        bus.on("requests-cleared", onCleared);

        // Proxies and browsers drop an idle event stream; a comment line
        // every twenty seconds is enough to keep it open and costs nothing.
        const beat = setInterval(() => {
          if (!res.writableEnded) res.write(": beat\n\n");
        }, 20000);

        req.on("close", () => {
          clearInterval(beat);
          bus.off("request", onRequest);
          bus.off("requests-cleared", onCleared);
        });
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
          // A backend that refuses to list is worth saying out loud rather
          // than showing as an empty catalogue: "this provider has no
          // models" and "this provider would not tell us" are different
          // problems with different fixes.
          if (!upstream.ok) {
            json(res, 200, { models: [], error: `${upstream.status} ${(await upstream.text()).slice(0, 200)}` });
            return;
          }
          const body = await upstream.json();
          const data = Array.isArray(body) ? body : (body.data ?? []);
          await loadCatalog();
          const models = data
            .map((m) => m.id)
            .filter(Boolean)
            .sort()
            .map((id) => ({ id, ...(lookupModel(provider.baseUrl, id) ?? {}) }));
          json(res, 200, { models });
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

  // Taken rather than asked for: one command should not open with two
  // questions. If the port is busy we move up until one is free.
  let chosen = port;
  for (let tries = 0; tries < 20; tries++) {
    try {
      await listen(server, chosen);
      return server;
    } catch (err) {
      if (err.code !== "EADDRINUSE") throw err;
      chosen += 1;
    }
  }
  throw new Error(`no free port for the panel between ${port} and ${chosen}`);
}

export function openBrowser(url) {
  // Headless machines and test runs don't want a browser launched at them.
  if (process.env.OPENCC_NO_BROWSER) return;
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  try {
    // Detached and ignored: if no browser can be opened we just print the URL.
    spawn(cmd, [url], { stdio: "ignore", detached: true, shell: process.platform === "win32" }).unref();
  } catch {
    /* printed by the caller either way */
  }
}
