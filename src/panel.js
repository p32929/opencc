// The admin panel: which providers exist, which models they offer, and how
// each of those has actually been doing.
//
// Nothing here sets ordering and nothing probes for capabilities. Ordering is
// read from the record in stats.jsonl as the proxy runs; what a model can do
// is read from models.dev, and from what you have said about it. What is left
// to set is the part neither can know: a URL, a key, and which models to put
// in the pot.
//
// No dependencies: Node's http server, one hand-written page, and a small
// JSON API. Every change to a provider or to the pot is its own request,
// applied to the config in one synchronous step, so the page never sends the
// whole config back and can never overwrite a change it has not seen.
import { createServer } from "node:http";
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { displayName } from "./config.js";
import {
  mask, loadConfig, fetchModelEntries, entryDetails, hello, measureContext,
  saveProvider, deleteProvider, setProviderOn, setProviderList, setAdded,
  potAdd, potRemove, potPark, saveSettings,
} from "./providers.js";
import { allStats, successRate, coolingFor, resetStats } from "./stats.js";
import { loadCatalog, factsFor, catalogAge, catalogSize } from "./modelsdev.js";
import { saveSetup, saveMeasured, forgetSetup, setupFor } from "./setup.js";
import {
  tests, runState, startRun, stopRun, running, testOne, forgetTests, onRunEnd,
} from "./testrun.js";
import { listRequests, clearRequests, readDetail, KEEP } from "./reqlog.js";
import { authorize, panelLinks } from "./access.js";
import { readStoredConfig } from "./configStore.js";
import { behaviorFromEnv } from "./behavior.js";
import { rankings, loadRankings, rankIn } from "./rankings.js";
import { forgetRankingsCache } from "./fit.js";
import { allUsage, resetUsage } from "./usage.js";
import { updateFor, checkForUpdate } from "./update.js";
import { bus } from "./events.js";
import { LISTS_PATH, OLD_LISTS_PATH, TESTS_PATH, PREFS_PATH, GLOBAL_CONFIG_DIR } from "./paths.js";
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

// --- what is kept on disk --------------------------------------------------
const readJson = (path, fallback) => {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
};

const writeJson = (path, value) => {
  try {
    mkdirSync(GLOBAL_CONFIG_DIR, { recursive: true });
    writeFileSync(path, JSON.stringify(value), { mode: 0o600 });
  } catch {
    // A full disk should not take a request down with it.
  }
};

// Test results are not kept (see testrun.js), and neither is the file an
// older version kept them in. The model lists it used to keep by address are
// replaced by the ones kept by name.
rmSync(TESTS_PATH, { force: true });
rmSync(OLD_LISTS_PATH, { force: true });

// Each provider's model list, kept after it is loaded:
//   name -> { v, baseUrl, at, models, details }
// what the provider said (names, sizes, prices), not what is known from
// models.dev or from you, which changes. Asked for again when its list is
// switched on or off, when the provider is changed, and on Refresh.
//
// A provider that listed nothing is asked again every time, which is what
// makes a failed or empty answer retryable instead of permanent.
const LIST_V = 2; // how a saved list was read; another: read again
const lists = readJson(LISTS_PATH, {});
const saveLists = () => writeJson(LISTS_PATH, lists);

function forgetList(...names) {
  let changed = false;
  for (const name of names) {
    if (name in lists) {
      delete lists[name];
      changed = true;
    }
  }
  if (changed) saveLists();
}

// The page's own choices — sorts, folded providers, filters, the model
// search — kept here and not in the browser, whose storage is per address and
// a new port is a new address.
const PREF_KEYS = ["catSort", "freeOnly", "folded", "sorts", "filters"];
const prefs = () => readJson(PREFS_PATH, {});

// --- the state the page draws from ----------------------------------------

// What a provider looks like to the page. Never the key: an edit that leaves
// the key box empty keeps the one it has.
const shown = (p) => ({
  name: p.name,
  label: displayName(p),
  baseUrl: p.baseUrl,
  key: mask(p.apiKey),
  list: p.list,
  disabled: p.disabled,
  models: p.models,
  disabledModels: p.disabledModels,
  added: p.added,
});

function stateOf() {
  const cfg = loadConfig();
  return {
    providers: cfg.providers.map(shown),
    port: cfg.port,
    streaming: cfg.streaming,
    rank: cfg.rank,
    testTimeout: cfg.testTimeout,
    testLanes: cfg.testLanes,
    replyTag: cfg.replyTag,
    behavior: cfg.behavior,
    rankings: rankingsMeta(),
    update: updateFor(version),
    prefs: prefs(),
    version,
  };
}

// The facts the page shows for a model: models.dev's with yours laid over
// them, and where they came from.
const knownOf = (baseUrl, model) => factsFor(baseUrl, model) ?? undefined;

// What the public rankings are and when they were fetched, for the sidebar.
function rankingsMeta() {
  const data = loadRankings();
  return data ? { at: data.fetched, source: data.source, lists: Object.keys(data.lists).length } : null;
}

// Where each of these models stands in the rankings the page shows: coding,
// web apps and vision, as { rank, of, score, votes } or nothing.
const RANK_COLUMNS = { coding: "text:coding", webdev: "webdev:webdev", vision: "vision:overall" };
function ranksOf(models) {
  const data = loadRankings();
  if (!data) return {};
  const out = {};
  for (const model of models) {
    const row = {};
    for (const [column, list] of Object.entries(RANK_COLUMNS)) {
      const r = rankIn(model, list, data);
      if (r) row[column] = r;
    }
    if (Object.keys(row).length) out[model] = row;
  }
  return out;
}

// A provider's models and what is known about each: what its own list says
// (name, window, owner, date, description, price), and what is known from
// models.dev and from you. The facts are attached when asked, never stored
// with the list, because they change when models.dev is fetched again.
async function modelsOf(name, fresh) {
  const provider = loadConfig().providers.find((p) => p.name === name);
  if (!provider) throw Object.assign(new Error(`no provider "${name}"`), { status: 404 });
  if (!provider.list) return { models: [], details: {}, off: true };

  let saved = lists[name];
  const valid = saved && saved.baseUrl === provider.baseUrl && saved.v === LIST_V && saved.models?.length;
  if (!valid || fresh) {
    const entries = await fetchModelEntries(provider);
    saved = {
      v: LIST_V,
      baseUrl: provider.baseUrl,
      at: Date.now(),
      models: entries.map((m) => String(m.id ?? m.name)),
      details: Object.fromEntries(entries.map((m) => [String(m.id ?? m.name), entryDetails(m)])),
    };
    lists[name] = saved;
    saveLists();
  }

  await loadCatalog().catch(() => {});
  const details = Object.fromEntries(saved.models.map((id) => [
    id, { ...saved.details[id], known: knownOf(provider.baseUrl, id) },
  ]));
  return { models: saved.models, details, at: saved.at };
}

export const DEFAULT_PANEL_PORT = 3450;

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once("error", (err) => {
      // No IPv6 on this machine: every IPv4 address instead.
      if (err.code === "EAFNOSUPPORT" || err.code === "EADDRNOTAVAIL") {
        server.once("error", reject);
        server.listen(port, "0.0.0.0", () => resolve(server));
        return;
      }
      reject(err);
    });
    // localhost only: this edits your providers.
    //
    // Bound to every address so that, when you switch it on, other devices on
    // your network can reach it; whether they may is decided per request
    // (access.js), and the answer is no unless you said yes.
    server.listen(port, "::", () => resolve(server));
  });
}

export async function runPanel({ port = DEFAULT_PANEL_PORT, onSave } = {}) {
  // Warmed in the background so the first page load has it, and ignored if
  // it fails: everything here works without a catalogue, just with less to
  // show.
  loadCatalog().catch(() => {});
  onRunEnd(onSave);

  // After anything that changes what there is to route to, so a proxy that
  // was waiting for exactly this starts.
  const changed = async () => {
    await onSave?.();
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const path = url.pathname;

    // Who is asking, before anything is read or changed.
    const verdict = authorize(req, url, { remote: behaviorFromEnv(readStoredConfig()).remote });
    if (!verdict.ok) {
      res.writeHead(verdict.status, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(verdict.message);
      return;
    }
    if (verdict.redirect) {
      res.writeHead(302, { Location: verdict.redirect, "Set-Cookie": verdict.cookie });
      res.end();
      return;
    }

    try {
      if (req.method === "GET" && (path === "/" || path === "/index.html")) {
        // The page is built fresh from source on every request and has no
        // URL to version, so a cached copy is only ever a stale one.
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store, must-revalidate",
        });
        res.end(page());
        return;
      }

      if (req.method === "GET" && path === "/api/state") {
        json(res, 200, stateOf());
        return;
      }

      // --- providers ---------------------------------------------------

      // Add one, or change one (`was`: the name it had, if it is renamed).
      // Anything that changes where it points or how it signs in makes its
      // model list and its test results stale.
      if (req.method === "POST" && path === "/api/provider") {
        const body = await readBody(req);
        const done = await saveProvider(body);
        forgetList(done.name, ...(done.was ? [done.was] : []));
        forgetTests();
        json(res, 200, { ...stateOf(), saved: done.name });
        await changed();
        return;
      }

      if (req.method === "POST" && path === "/api/provider/delete") {
        const { name } = await readBody(req);
        const gone = loadConfig().providers.find((p) => p.name === name);
        deleteProvider(name);
        forgetList(name);
        forgetTests();
        // What was said about its models went with it.
        for (const model of gone?.models ?? []) forgetSetup(gone.baseUrl, model);
        json(res, 200, stateOf());
        await changed();
        return;
      }

      // One provider's list on or off, or every provider's (no name).
      if (req.method === "POST" && path === "/api/provider/list") {
        const { name, on } = await readBody(req);
        const names = setProviderList(name, on);
        forgetList(...names);
        json(res, 200, stateOf());
        return;
      }

      // A provider switched off keeps its key and its models, and is skipped.
      if (req.method === "POST" && path === "/api/provider/on") {
        const { name, on } = await readBody(req);
        setProviderOn(name, on);
        json(res, 200, stateOf());
        await changed();
        return;
      }

      // A model added by name: one the provider does not list, or whose list
      // is off. Remembered, and forgotten one by one or all at once.
      if (req.method === "POST" && path === "/api/provider/added") {
        const { name, ...rest } = await readBody(req);
        setAdded(name, rest);
        json(res, 200, stateOf());
        return;
      }

      // --- the pot -----------------------------------------------------

      if (req.method === "POST" && path === "/api/pot/add") {
        const { items } = await readBody(req);
        potAdd(items ?? []);
        json(res, 200, stateOf());
        await changed();
        return;
      }

      if (req.method === "POST" && path === "/api/pot/remove") {
        const { items } = await readBody(req);
        potRemove(items ?? []);
        json(res, 200, stateOf());
        await changed();
        return;
      }

      if (req.method === "POST" && path === "/api/pot/park") {
        const { provider, model, parked } = await readBody(req);
        potPark(provider, model, parked);
        json(res, 200, stateOf());
        await changed();
        return;
      }

      if (req.method === "POST" && path === "/api/settings") {
        saveSettings(await readBody(req));
        json(res, 200, stateOf());
        return;
      }

      if (req.method === "POST" && path === "/api/prefs") {
        const { key, value } = await readBody(req);
        if (!PREF_KEYS.includes(key)) throw new Error(`no such choice: ${key}`);
        writeJson(PREFS_PATH, { ...prefs(), [key]: value });
        json(res, 200, {});
        return;
      }

      // --- a provider's model list ------------------------------------

      if (req.method === "POST" && path === "/api/models") {
        const { name, fresh } = await readBody(req);
        json(res, 200, await modelsOf(name, Boolean(fresh)));
        return;
      }

      // --- models.dev, and what you have said about a model -----------

      if (req.method === "GET" && path === "/api/catalog") {
        await loadCatalog();
        const known = {};
        for (const p of loadConfig().providers) {
          for (const model of p.models) {
            const info = knownOf(p.baseUrl, model);
            if (info) known[`${p.baseUrl}|${model}`] = info;
          }
        }
        json(res, 200, { known, size: catalogSize(), age: catalogAge() });
        return;
      }

      // Fetch models.dev again. Its facts are never stored with a model list,
      // so there is nothing else to refresh.
      if (req.method === "POST" && path === "/api/catalog/refresh") {
        try {
          await loadCatalog({ force: true });
          json(res, 200, { size: catalogSize(), age: catalogAge() });
        } catch (err) {
          json(res, 200, { error: err.message, size: catalogSize(), age: catalogAge() });
        }
        return;
      }

      // What a model can do, set by you: for one models.dev does not know, or
      // to correct it. Kept above what models.dev says.
      if (req.method === "POST" && path === "/api/model-setup") {
        const { provider, model, context, tools, thinking, images, stream } = await readBody(req);
        const target = loadConfig().providers.find((p) => p.name === provider);
        if (!target) throw new Error(`no provider "${provider}"`);
        if (!String(model ?? "").trim()) throw new Error("a model is needed");
        saveSetup(target.baseUrl, model, { context, tools, thinking, images, stream });
        json(res, 200, { known: knownOf(target.baseUrl, model) ?? null });
        return;
      }

      // Take back what you said about a model: it is what models.dev says again.
      if (req.method === "POST" && path === "/api/model-setup/forget") {
        const { provider, model } = await readBody(req);
        const target = loadConfig().providers.find((p) => p.name === provider);
        if (!target) throw new Error(`no provider "${provider}"`);
        forgetSetup(target.baseUrl, model);
        json(res, 200, { known: knownOf(target.baseUrl, model) ?? null });
        return;
      }

      // Measure a model's window: one request far too big for any model; the
      // server's refusal states its limit, which is kept above models.dev's.
      if (req.method === "POST" && path === "/api/measure") {
        const { provider, model } = await readBody(req);
        const target = loadConfig().providers.find((p) => p.name === provider);
        if (!target) throw new Error(`no provider "${provider}"`);
        const measured = await measureContext(target, model);
        if (measured.error) throw new Error(`couldn't measure it: ${measured.error}`);
        if (measured.limit) saveMeasured(target.baseUrl, model, measured.limit);
        json(res, 200, { measured, known: knownOf(target.baseUrl, model) ?? null, set: setupFor(target.baseUrl, model) });
        return;
      }

      // --- testing ------------------------------------------------------

      // "Hello" to a model, and exactly what was sent and what came back.
      if (req.method === "POST" && path === "/api/hello") {
        const { provider, model } = await readBody(req);
        const cfg = loadConfig();
        const target = cfg.providers.find((p) => p.name === provider);
        if (!target || !model) throw new Error(`no provider "${provider}"`);
        json(res, 200, await hello(target, model, cfg.testTimeout * 1000));
        return;
      }

      // One short test, on its own: it neither waits for a run nor stops one.
      if (req.method === "POST" && path === "/api/try") {
        const { provider, model } = await readBody(req);
        const result = await testOne(provider, String(model ?? ""));
        json(res, 200, result);
        await changed();
        return;
      }

      // Start, stop, and what is known so far. The page asks for a run and
      // then watches; it never drives one itself.
      if (req.method === "POST" && path === "/api/tests/start") {
        if (running()) {
          json(res, 409, { error: "a test run is going already" });
          return;
        }
        const body = await readBody(req);
        const cfg = loadConfig();
        const items = Array.isArray(body.only) && body.only.length
          ? body.only
          : cfg.providers.flatMap((p) =>
              p.disabled ? [] : p.models.map((model) => ({ provider: p.name, model })));

        if (!items.length) {
          json(res, 200, { ...runState(), results: tests });
          return;
        }
        // Answer at once; the run reports itself over /api/events.
        startRun(items).catch(() => {});
        json(res, 200, { ...runState(), results: tests });
        return;
      }

      if (req.method === "POST" && path === "/api/tests/stop") {
        stopRun();
        json(res, 200, runState());
        return;
      }

      // `since` asks for only the results newer than a moment, which is what
      // the page polls with while a run is going.
      //
      // The stream is the fast path, not the only one. An event stream that
      // drops — and one does, under a few hundred results a second — takes
      // every event with it, because there is nothing to replay. The page
      // caught up to nothing and sat there looking seized while the run was
      // still going.
      if (req.method === "GET" && path === "/api/tests") {
        const since = Number(url.searchParams.get("since"));
        let results = tests;
        if (Number.isFinite(since) && since > 0) {
          results = {};
          for (const [key, value] of Object.entries(tests)) {
            if (value.at > since) results[key] = value;
          }
        }
        json(res, 200, { ...runState(), results, now: Date.now() });
        return;
      }

      // --- the record and the log --------------------------------------

      // What has actually worked. This is the whole of what decides routing,
      // so the page shows it per model and per kind of request.
      if (req.method === "GET" && path === "/api/stats") {
        const cooling = {};
        for (const p of loadConfig().providers) {
          for (const model of p.models) {
            const ms = coolingFor(p.baseUrl, model);
            if (ms) cooling[`${p.baseUrl}|${model}`] = ms;
          }
        }
        json(res, 200, {
          cooling,
          rows: allStats().map((row) => ({ ...row, rate: successRate(row) })),
        });
        return;
      }

      // Start over. Every model goes back to untried and routing is even odds
      // again until real requests fill it back in.
      if (req.method === "POST" && path === "/api/stats/reset") {
        resetUsage();
        json(res, 200, resetStats());
        return;
      }

      // Tokens and money spent per model, keyed like the record.
      if (req.method === "GET" && path === "/api/usage") {
        json(res, 200, { usage: allUsage() });
        return;
      }

      // Where each model stands in the public rankings.
      if (req.method === "POST" && path === "/api/ranks") {
        const { models } = await readBody(req);
        json(res, 200, { ranks: ranksOf(Array.isArray(models) ? models.map(String) : []), meta: rankingsMeta() });
        return;
      }

      // models.dev and the rankings, both fetched again: the one button.
      if (req.method === "POST" && path === "/api/info/update") {
        const out = { errors: [] };
        try {
          await loadCatalog({ force: true });
        } catch (err) {
          out.errors.push(err.message);
        }
        try {
          if (!(await rankings({ now: true }))) throw new Error("could not get the rankings (huggingface.co)");
          forgetRankingsCache();
        } catch (err) {
          out.errors.push(err.message);
        }
        json(res, 200, { ...out, size: catalogSize(), age: catalogAge(), rankings: rankingsMeta() });
        return;
      }

      // How to open the panel: here, and from other devices.
      if (req.method === "GET" && path === "/api/link") {
        json(res, 200, panelLinks(req.socket.localPort));
        return;
      }

      // A newer opencc, asked of npm now.
      if (req.method === "POST" && path === "/api/update/check") {
        await checkForUpdate();
        json(res, 200, { update: updateFor(version) });
        return;
      }

      // One request in full, kept when the log is set to keep them.
      if (req.method === "GET" && path === "/api/request") {
        const detail = readDetail(url.searchParams.get("id"));
        if (!detail) throw Object.assign(new Error("that request's detail is not kept"), { status: 404 });
        json(res, 200, detail);
        return;
      }

      if (req.method === "GET" && path === "/api/requests") {
        json(res, 200, { keep: KEEP, items: listRequests() });
        return;
      }

      if (req.method === "POST" && path === "/api/requests/clear") {
        json(res, 200, clearRequests());
        return;
      }

      // Server-sent events, so a request served by the proxy, or a test
      // result, shows up in the page without it polling.
      if (req.method === "GET" && path === "/api/events") {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });
        res.write("retry: 2000\n\n");

        const send = (what, extra) => {
          if (!res.writableEnded) res.write(`data: ${JSON.stringify({ what, ...extra })}\n\n`);
        };
        const handlers = {
          request: () => send("request"),
          "requests-cleared": () => send("requests-cleared"),
          testsforgotten: () => send("testsforgotten"),
          // These two carry a payload: the page needs the result itself, not
          // a nudge to go and refetch every result it already has.
          tested: (e) => send("tested", e),
          testrun: (state) => send("testrun", { run: state }),
        };
        for (const [name, fn] of Object.entries(handlers)) bus.on(name, fn);

        // Proxies and browsers drop an idle event stream; a comment line every
        // twenty seconds keeps it open and costs nothing.
        const beat = setInterval(() => {
          if (!res.writableEnded) res.write(": beat\n\n");
        }, 20000);

        req.on("close", () => {
          clearInterval(beat);
          for (const [name, fn] of Object.entries(handlers)) bus.off(name, fn);
        });
        return;
      }

      json(res, 404, { error: "not found" });
    } catch (err) {
      json(res, err.status === 404 ? 404 : 400, { error: err.message });
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
