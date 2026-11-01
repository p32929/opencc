// The admin panel `opencc init` opens: which providers exist, which models
// they offer, and how each of those models has actually been doing.
//
// There is nothing here for ordering or for capabilities. Both are worked out
// from the record in stats.jsonl while the proxy runs, so the only things
// left to set are the facts opencc cannot discover on its own: a URL, a key,
// and which models to put in the pot.
//
// No dependencies: Node's http server, one hand-written page, and a small
// JSON API over the same configStore the rest of opencc reads.
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { readStoredConfig, writeStoredConfig } from "./configStore.js";
import { providersFromEnv, displayName, streamingFromEnv } from "./config.js";
import { allStats, successRate, coolingFor, coverage, record, resetStats, NEEDED } from "./stats.js";
import { warmUp, pendingModels } from "./warmup.js";
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

// A warm-up started from the panel. Module state is fine: the panel is a
// single local process serving one person.
let warming = null;

function loadState() {
  const stored = readStoredConfig();
  return {
    providers: providersFromEnv(stored).map((p) => ({ ...p, label: displayName(p) })),
    port: stored.PORT || "3000",
    streaming: streamingFromEnv(stored),
  };
}

// One real "Hi" through the provider. The result is recorded like any other
// call, so pressing Test is not just a check: it is the first entry in a new
// model's record, and the router reads it straight away.
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
    record({ baseUrl: provider.baseUrl, model, kind: "text", status: res.status });
    if (!res.ok) return { ok: false, error: `${res.status} ${(await res.text()).slice(0, 200)}` };
    return { ok: true };
  } catch (err) {
    record({ baseUrl: provider.baseUrl, model, kind: "text", status: 0 });
    return { ok: false, error: err.message };
  }
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
        const { providers } = loadState();
        const cooling = {};
        for (const p of providers) {
          for (const model of p.models) {
            const ms = coolingFor(p.baseUrl, model);
            if (ms) cooling[p.baseUrl + "|" + model] = ms;
          }
        }
        json(res, 200, {
          kinds: NEEDED,
          cooling,
          // Worked out here rather than in the page: two copies of this rule
          // drifted apart the first time one of them changed.
          coverage: Object.fromEntries(NEEDED.map((kind) => [kind, coverage(providers, kind)])),
          rows: allStats().map((row) => ({ ...row, rate: successRate(row) })),
        });
        return;
      }

      // Start over. The next "opencc" start finds an empty record and warms
      // up again, which is the quickest way to a clean measured baseline.
      if (req.method === "POST" && path === "/api/stats/reset") {
        json(res, 200, resetStats());
        return;
      }

      // Which models have never been asked anything. The page checks this
      // after every save so a model added by hand gets tested straight away.
      if (req.method === "GET" && path === "/api/warmup/pending") {
        const kind = new URL(req.url, "http://localhost").searchParams.get("kind") || "tools";
        const groups = pendingModels(loadState().providers, kind);
        json(res, 200, {
          total: groups.reduce((n, g) => n + g.models.length, 0),
          models: groups.flatMap((g) => g.models.map((m) => `${displayName(g.provider)} ${m}`)),
        });
        return;
      }

      if (req.method === "GET" && path === "/api/warmup/progress") {
        json(res, 200, warming ?? { running: false });
        return;
      }

      // One small tool-calling request per untested model, the same thing
      // `opencc` does on a cold start. The results land in the shared log, so
      // a proxy already running picks them up without being restarted.
      if (req.method === "POST" && path === "/api/warmup") {
        if (warming?.running) {
          json(res, 409, { error: "a warm-up is already running" });
          return;
        }

        const { kind = "tools" } = await readBody(req);
        warming = { running: true, kind, done: 0, total: 0, current: "", results: [] };
        try {
          await warmUp(loadState().providers, {
            kind,
            onEvent: (event) => {
              if (event.type === "start") warming.total = event.total;
              if (event.type === "result") {
                warming.done = event.done;
                warming.current = `${displayName(event.provider)} ${event.model}`;
                warming.results.push({
                  model: event.model,
                  provider: displayName(event.provider),
                  status: event.status,
                  calledTool: Boolean(event.calledTool),
                  error: event.error,
                });
              }
            },
          });
        } finally {
          warming = { ...warming, running: false, current: "" };
        }

        // A model that just proved it can call tools may be the one the
        // proxy was waiting for.
        await onSave?.();

        json(res, 200, { results: warming.results });
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
        // The proxy may have been waiting for exactly this.
        await onSave?.();
        return;
      }

      if (req.method === "POST" && path === "/api/test") {
        const { index, model } = await readBody(req);
        const provider = loadState().providers[index];
        if (!provider) {
          json(res, 404, { ok: false, error: "no such provider" });
          return;
        }
        const outcome = await testModel(provider, model);
        // Same reason as the warm-up: one passing test can unblock the proxy.
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
