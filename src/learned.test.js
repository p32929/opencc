// What is kept between runs, the panel's gate, rankings, prices and the
// update check. Anything that writes a file runs in a child process with its
// own HOME, so no test touches the real ~/.opencc.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { conversationKey, stickyFor, stick, forgetConversations } from "./conversations.js";
import { authorize, isPrivateAddress, isLoopbackAddress } from "./access.js";
import { newer, checkForUpdate } from "./update.js";
import { costOf } from "./usage.js";
import { place, score, words, rankIn } from "./rankings.js";
import { skillsFor, bonusFor } from "./fit.js";
import { readParquet } from "./parquet.js";

const here = dirname(new URL(import.meta.url).pathname);

// Runs `code` as a module in a child with a fresh HOME; returns { out, home }.
function inHome(code) {
  const home = mkdtempSync(join(tmpdir(), "opencc-learned-"));
  const run = spawnSync(process.execPath, ["--input-type=module", "-e", code], {
    cwd: here, env: { ...process.env, HOME: home, OPENCC_NO_MODELS_DEV: "1" }, encoding: "utf8",
  });
  assert.equal(run.status, 0, run.stderr);
  return { out: run.stdout.trim(), home };
}

test("a learned quirk is kept, expires after a day, and is forgotten on request", () => {
  const { out, home } = inHome(`
    import { learnQuirk, quirksOf, flushLearned, forgetLearned, DAY_MS } from "./learned.js";
    learnQuirk("http://a", "m", "noTemperature");
    const now = quirksOf("http://a", "m");
    const later = quirksOf("http://a", "m", Date.now() + DAY_MS + 1000);
    flushLearned();
    console.log(JSON.stringify({ now, later, other: quirksOf("http://a", "n") }));
  `);
  assert.deepEqual(JSON.parse(out), { now: { noTemperature: true }, later: {}, other: {} });
  assert.ok(existsSync(join(home, ".opencc", "model-learned.json")));
});

test("a limit a refusal stated lowers the window for a day, and a bigger request that works lifts it", () => {
  const { out } = inHome(`
    import { learnLimit, learnFromUsage, windowFor, DAY_MS } from "./learned.js";
    learnLimit("http://a", "m", { tokens: 8000, rate: false });
    const lowered = windowFor("http://a", "m", { size: 128000 });
    const expired = windowFor("http://a", "m", { size: 128000 }, Date.now() + DAY_MS + 1000);
    const change = learnFromUsage("http://a", "m", 20000, 20000);
    const lifted = windowFor("http://a", "m", { size: 128000 });
    console.log(JSON.stringify({ lowered, expired, change, lifted }));
  `);
  const r = JSON.parse(out);
  assert.deepEqual(r.lowered, { size: 8000, from: "learned" });
  assert.deepEqual(r.expired, { size: 128000, from: "models.dev" });
  assert.equal(r.change, "grew");
  assert.deepEqual(r.lifted, { size: 128000, from: "models.dev" });
});

test("a per-minute cap is kept apart from the window and lasts until it is out", () => {
  const { out } = inHome(`
    import { learnLimit, windowFor } from "./learned.js";
    learnLimit("http://a", "m", { tokens: 6000, rate: true });
    console.log(JSON.stringify(windowFor("http://a", "m", { size: 128000 })));
  `);
  assert.deepEqual(JSON.parse(out), { size: 6000, from: "rate" });
});

test("a silent cut is learned only when seen twice at about the same size", () => {
  const { out } = inHome(`
    import { learnFromUsage, windowFor } from "./learned.js";
    const once = learnFromUsage("http://a", "m", 4096, 20000);
    const midway = windowFor("http://a", "m", { size: 128000 });
    const twice = learnFromUsage("http://a", "m", 4100, 20000);
    console.log(JSON.stringify({ once, midway, twice, after: windowFor("http://a", "m", { size: 128000 }) }));
  `);
  const r = JSON.parse(out);
  assert.equal(r.once, null);
  assert.equal(r.midway.size, 128000, "one odd count changes nothing");
  assert.equal(r.twice, "cut");
  assert.equal(r.after.from, "learned");
});

test("the server's own window is read ahead of models.dev, and a measured one ahead of both", () => {
  const { out } = inHome(`
    import { learnServer, windowFor } from "./learned.js";
    learnServer("http://a", "m", { size: 32768, server: "llama.cpp" });
    console.log(JSON.stringify([windowFor("http://a", "m", { size: 128000 }), windowFor("http://a", "m", { measured: 16000, size: 128000 })]));
  `);
  assert.deepEqual(JSON.parse(out), [{ size: 32768, from: "server" }, { size: 16000, from: "measured" }]);
});

test("what a model used and cost is added up and kept, and reset clears it", () => {
  const { out } = inHome(`
    import { addUsage, allUsage, flushUsage, resetUsage } from "./usage.js";
    addUsage("http://a", "m", { input: 1000, output: 200, cached: 0, cost: 0.5 });
    addUsage("http://a", "m", { input: 500, output: 100 });
    const row = allUsage()["http://a|m"];
    flushUsage();
    resetUsage();
    console.log(JSON.stringify({ row, after: allUsage() }));
  `);
  const r = JSON.parse(out);
  assert.equal(r.row.requests, 2);
  assert.equal(r.row.input, 1500);
  assert.equal(r.row.cost, 0.5, "the provider's figure; the other has no price");
  assert.deepEqual(r.after, {});
});

test("a price turns tokens into dollars, the cached part at the cache price", () => {
  assert.equal(costOf({ input: 2, output: 8 }, { input: 1e6, output: 1e6 }).cost, 10);
  assert.equal(costOf({ input: 2, output: 8, cacheRead: 0.5 }, { input: 1e6, output: 0, cached: 1e6 }).cost, 0.5);
  assert.equal(costOf(null, { input: 5, output: 5 }).priced, false);
  assert.equal(costOf({ input: 2 }, { input: 1, output: 1, cost: 0.01 }).cost, 0.01);
});

test("the panel's key is made once and kept", () => {
  const { out, home } = inHome(`
    import { panelKey } from "./access.js";
    console.log(panelKey());
  `);
  assert.match(out, /^[a-f0-9]{32}$/);
  assert.equal(readFileSync(join(home, ".opencc", "panel-key"), "utf8").trim(), out);
});

// --- who may reach the panel -------------------------------------------------

const request = (headers, remoteAddress, method = "GET") => ({ headers, socket: { remoteAddress }, method });
const url = (path = "/") => new URL(path, "http://x");
const HOSTS = new Set(["localhost", "127.0.0.1", "::1", "192.168.1.5", "mybox"]);

test("this machine is let in, with no key", () => {
  assert.equal(authorize(request({ host: "localhost:3450" }, "::1"), url(), { hosts: HOSTS }).ok, true);
  assert.equal(authorize(request({ host: "127.0.0.1:3450" }, "127.0.0.1"), url(), { hosts: HOSTS }).ok, true);
  assert.equal(authorize(request({ host: "localhost:3450" }, "::ffff:127.0.0.1"), url(), { hosts: HOSTS }).ok, true);
});

test("a name that is not this machine's is refused: a web page pointing its own name here", () => {
  const r = authorize(request({ host: "evil.example:3450" }, "127.0.0.1"), url(), { hosts: HOSTS });
  assert.equal(r.ok, false);
  assert.equal(r.status, 421);
});

test("a request a web page from another site made is refused", () => {
  const r = authorize(request({ host: "localhost:3450", origin: "https://evil.example" }, "127.0.0.1", "POST"), url(), { hosts: HOSTS });
  assert.equal(r.ok, false);
  assert.equal(r.status, 403);
  assert.equal(authorize(request({ host: "localhost:3450", origin: "http://localhost:3450" }, "127.0.0.1", "POST"), url(), { hosts: HOSTS }).ok, true);
  assert.equal(authorize(request({ host: "localhost:3450", origin: "null" }, "127.0.0.1", "POST"), url(), { hosts: HOSTS }).ok, false);
});

test("another device is refused unless that is switched on, then needs the key and a private address", () => {
  const other = request({ host: "192.168.1.5:3450" }, "192.168.1.9");
  assert.equal(authorize(other, url(), { hosts: HOSTS, remote: false }).status, 403);
  assert.equal(authorize(other, url(), { hosts: HOSTS, remote: true }).status, 401, "no key");
  const wrong = authorize(request({ host: "192.168.1.5:3450", "x-opencc-key": "nope" }, "192.168.1.9"), url(), { hosts: HOSTS, remote: true });
  assert.equal(wrong.status, 401);
  const stranger = authorize(request({ host: "192.168.1.5:3450" }, "8.8.8.8"), url(), { hosts: HOSTS, remote: true });
  assert.equal(stranger.status, 403, "not on your network");
});

test("with the key in the link, a device gets a cookie and the link without it", () => {
  const { out } = inHome(`
    import { authorize, panelKey } from "./access.js";
    const key = panelKey();
    const hosts = new Set(["192.168.1.5"]);
    const req = { headers: { host: "192.168.1.5:3450" }, socket: { remoteAddress: "192.168.1.9" }, method: "GET" };
    const first = authorize(req, new URL("/?t=" + key + "&x=1", "http://x"), { hosts, remote: true });
    const withCookie = authorize({ ...req, headers: { ...req.headers, cookie: "a=b; opencc_key=" + key } }, new URL("/api/state", "http://x"), { hosts, remote: true });
    console.log(JSON.stringify({ first, withCookie }));
  `);
  const r = JSON.parse(out);
  assert.equal(r.first.ok, true);
  assert.equal(r.first.redirect, "/?x=1", "the key is not left in the address bar");
  assert.match(r.first.cookie, /HttpOnly; SameSite=Strict/);
  assert.equal(r.withCookie.ok, true);
});

test("which addresses are on a private network", () => {
  for (const a of ["10.1.2.3", "192.168.0.7", "172.16.5.5", "172.31.0.1", "169.254.1.1", "::ffff:192.168.1.1", "fd12::1", "fe80::1", "127.0.0.1", "::1"]) assert.equal(isPrivateAddress(a), true, a);
  for (const a of ["8.8.8.8", "172.32.0.1", "172.15.0.1", "2001:db8::1"]) assert.equal(isPrivateAddress(a), false, a);
  assert.equal(isLoopbackAddress("::ffff:127.0.0.1"), true);
  assert.equal(isLoopbackAddress("192.168.1.1"), false);
});

// --- a conversation stays ------------------------------------------------------

test("a conversation is the same as it grows, and different from another", () => {
  const a = { system: "be brief", messages: [{ role: "user", content: "fix the bug" }] };
  const grown = { system: "be brief", messages: [...a.messages, { role: "assistant", content: "ok" }, { role: "user", content: "and now?" }] };
  assert.equal(conversationKey(a), conversationKey(grown));
  assert.notEqual(conversationKey(a), conversationKey({ ...a, messages: [{ role: "user", content: "something else" }] }));
});

test("the model that answered is remembered for an hour, and the oldest conversations go first", () => {
  forgetConversations();
  stick("k1", "http://a", "m", 1000);
  assert.deepEqual(stickyFor("k1", 2000), { baseUrl: "http://a", model: "m" });
  assert.equal(stickyFor("k1", 1000 + 3600_000 + 1), null);
  for (let i = 0; i < 520; i++) stick(`c${i}`, "http://a", "m");
  assert.equal(stickyFor("c0"), null);
  assert.ok(stickyFor("c519"));
  forgetConversations();
});

// --- updates ---------------------------------------------------------------------

test("a version is newer by its numbers, not its text", () => {
  assert.equal(newer("5.1.0", "5.0.9"), true);
  assert.equal(newer("10.0.0", "9.9.9"), true);
  assert.equal(newer("5.0.0", "5.0.0"), false);
  assert.equal(newer("4.9.9", "5.0.0"), false);
});

test("the update check asks npm and keeps the answer, and no answer is no news", async () => {
  const { out } = inHome(`
    import { checkForUpdate, updateFor } from "./update.js";
    const latest = await checkForUpdate({ fetchImpl: async () => ({ ok: true, json: async () => ({ version: "9.9.9" }) }) });
    const broken = await checkForUpdate({ fetchImpl: async () => { throw new Error("offline"); } });
    console.log(JSON.stringify({ latest, broken, news: updateFor("5.0.0"), none: updateFor("9.9.9") }));
  `);
  assert.deepEqual(JSON.parse(out), { latest: "9.9.9", broken: null, news: "9.9.9", none: null });
});

// --- rankings -----------------------------------------------------------------------

const LISTS = {
  "text:overall": [{ name: "Gemini 3.6 Flash (High)", rank: 1, score: 1500, votes: 9 }, { name: "Nemotron 3 Super 120B A12B", rank: 2, score: 1490, votes: 8 }, { name: "Claude Opus 5", rank: 3, score: 1480, votes: 7 }, { name: "Llama 3.3", rank: 4, score: 1400, votes: 6 }],
  "text:coding": [{ name: "Claude Opus 5", rank: 1, score: 1520, votes: 5 }, { name: "Gemini 3.6 Flash (High)", rank: 2, score: 1510, votes: 5 }],
  "agent:overall": [{ name: "Claude Opus 5", rank: 1, score: 1, votes: 1 }],
};
const DATA = { lists: LISTS };

test("a model is found in a ranking however its name is written", () => {
  assert.deepEqual(words("models/gemini-3.6-flash"), words("Gemini 3.6 Flash (High)"));
  assert.equal(place("gemini-3.6-flash", LISTS["text:overall"]), 0.25, "its place: rank over the list's length");
  assert.ok(place("nemotron-3-super", LISTS["text:overall"]) != null, "its size after the name is allowed");
  assert.equal(place("nemotron-3", LISTS["text:overall"]), null, "a different model is not this one");
  assert.equal(place("claude-opus-5-2512", LISTS["text:overall"]), place("claude-opus-5", LISTS["text:overall"]), "a dated version is the same model");
});

test("a model's score is the average of its places, its overall place standing in for a skill it is not ranked on", () => {
  assert.equal(score("claude-opus-5", ["coding"], DATA), 0.5, "first of two");
  assert.equal(score("gemini-3.6-flash", ["coding"], DATA), 1, "last of two");
  assert.equal(score("llama-3.3", ["coding"], DATA), 1, "not in the coding list: its overall place (4 of 4) stands in");
  assert.equal(score("not-a-model", ["coding"], DATA), null);
  assert.deepEqual(rankIn("claude-opus-5", "text:coding", DATA), { rank: 1, of: 2, as: "Claude Opus 5", score: 1520, votes: 5 });
  assert.equal(rankIn("llama-3.3", "text:coding", DATA), null);
});

test("what a request needs is read from the request itself", () => {
  assert.deepEqual(skillsFor({}, 100), ["coding"]);
  assert.deepEqual(skillsFor({ tools: true, vision: true }, 100000), ["coding", "agent", "vision", "long-input"]);
});

test("the tilt is small, best ranked highest, and nothing for a model the rankings do not know", () => {
  const bonus = bonusFor({ tools: false }, 100, DATA);
  assert.equal(bonus("u", "claude-opus-5"), 0.05, "first of two");
  assert.equal(bonus("u", "gemini-3.6-flash"), 0, "last of two");
  assert.ok(bonus("u", "claude-opus-5") <= 0.1, "never more than the weight");
  assert.equal(bonus("u", "unknown-model"), 0);
  assert.equal(bonusFor({}, 1, null), null, "no rankings yet: no tilt");
});

test("a Parquet table is read, and an unsupported one says so", () => {
  assert.throws(() => readParquet(Buffer.from("not parquet at all, really"), ["a"]), /./);
});

// --- models.dev matching and the window ----------------------------------------

const catalogue = `{
  "alpha": { "api": "https://api.alpha.test/v1", "models": {
    "gpt-oss-120b": { "limit": { "context": 131072, "output": 8192 }, "tool_call": true, "modalities": { "input": ["text"] }, "cost": { "input": 1, "output": 2 } },
    "magistral-small-2509": { "limit": { "context": 128000 }, "tool_call": true, "modalities": { "input": ["text", "image"] } },
    "magistral-small-2412": { "limit": { "context": 32000 }, "tool_call": true },
    "tiny-chat": { "limit": { "context": 4096 }, "tool_call": false }
  } },
  "beta": { "api": "https://api.beta.test/v1", "models": {
    "shared": { "limit": { "context": 64000 }, "modalities": { "input": ["text", "image"] } }
  } },
  "gamma": { "api": "https://api.gamma.test/v1", "models": {
    "shared": { "limit": { "context": 64000 }, "modalities": { "input": ["text"] } }
  } }
}`;

test("a model is found by its name however a provider writes it", () => {
  const { out } = inHome(`
    import { loadCatalog, lookupModel } from "./modelsdev.js";
    await loadCatalog({ force: true, fetchImpl: async () => ({ ok: true, json: async () => (${catalogue}) }) });
    const c = (m) => lookupModel("http://nobody.test", m)?.context ?? null;
    console.log(JSON.stringify({
      exact: c("gpt-oss-120b"), colon: c("gpt-oss:120b"), vendor: c("openai/gpt-oss-120b"), models: c("models/gpt-oss-120b"),
      suffix: c("gpt-oss-120b:free"), cloud: c("gpt-oss-120b-cloud"), latest: c("magistral-small-latest"), none: c("nothing-like-it"),
    }));
  `);
  assert.deepEqual(JSON.parse(out), {
    exact: 131072, colon: 131072, vendor: 131072, models: 131072, suffix: 131072, cloud: 131072,
    latest: 128000, none: null,
  });
});

test("a provider models.dev knows by address is asked first; images only if every listing takes them", () => {
  const { out } = inHome(`
    import { loadCatalog, lookupModel } from "./modelsdev.js";
    await loadCatalog({ force: true, fetchImpl: async () => ({ ok: true, json: async () => (${catalogue}) }) });
    console.log(JSON.stringify({
      own: lookupModel("https://api.beta.test/v1", "shared").vision,
      other: lookupModel("https://unknown.test/v1", "shared").vision,
    }));
  `);
  assert.deepEqual(JSON.parse(out), { own: true, other: false });
});

test("the window a request is measured against is the one you set, then what was learned", () => {
  const { out } = inHome(`
    import { loadCatalog, factsFor, tooBigForCatalog, unfitFor, windowOfModel } from "./modelsdev.js";
    import { learnLimit, learnServer } from "./learned.js";
    import { saveSetup } from "./setup.js";
    await loadCatalog({ force: true, fetchImpl: async () => ({ ok: true, json: async () => (${catalogue}) }) });
    const u = "https://api.alpha.test/v1";
    const base = windowOfModel(u, "gpt-oss-120b");
    const big = { chars: 300000, tokens: 100000 };
    const before = tooBigForCatalog(u, "gpt-oss-120b", big.chars, big.tokens);
    learnLimit(u, "gpt-oss-120b", { tokens: 8000, rate: false });
    const lowered = windowOfModel(u, "gpt-oss-120b");
    const after = tooBigForCatalog(u, "gpt-oss-120b", big.chars, big.tokens);
    saveSetup(u, "gpt-oss-120b", { context: 500000, tools: true, thinking: false, images: false, stream: true });
    const youSet = windowOfModel(u, "gpt-oss-120b");
    console.log(JSON.stringify({ base, before, lowered, after, youSet, shown: factsFor(u, "gpt-oss-120b").context,
      cantTools: unfitFor(u, "tiny-chat", { tools: true }), canTools: unfitFor(u, "gpt-oss-120b", { tools: true }),
      cantImages: unfitFor(u, "gpt-oss-120b", { vision: true }), unknown: unfitFor(u, "never-heard", { tools: true }) }));
  `);
  const r = JSON.parse(out);
  assert.deepEqual(r.base, { size: 131072, from: "models.dev" });
  assert.equal(r.before, false);
  assert.deepEqual(r.lowered, { size: 8000, from: "learned" });
  assert.equal(r.after, true);
  assert.deepEqual(r.youSet, { size: 500000, from: "you" });
  assert.equal(r.shown, 500000);
  assert.deepEqual([r.cantTools, r.canTools, r.cantImages, r.unknown], [true, false, true, false]);
});

test("the running panel refuses a foreign name, a foreign site and another device, and still answers this machine", async () => {
  const { mkdirSync } = await import("node:fs");
  const { spawn } = await import("node:child_process");
  const { request } = await import("node:http");
  const home = mkdtempSync(join(tmpdir(), "opencc-gate-"));
  mkdirSync(join(home, ".opencc"));
  const child = spawn(process.execPath, [join(here, "cli.js"), "--panel-port", "3495", "--port", "3496"], {
    env: { ...process.env, HOME: home, OPENCC_NO_BROWSER: "1", OPENCC_NO_UPDATE_CHECK: "1" }, stdio: "ignore",
  });
  // fetch cannot set Host, so this speaks http directly.
  const ask = (headers, method = "GET", path = "/api/state") => new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port: 3495, path, method, headers }, (res) => { res.resume(); res.on("end", () => resolve(res.statusCode)); });
    req.on("error", reject);
    req.end(method === "POST" ? "{}" : undefined);
  });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    for (let i = 0; i < 50; i++) { try { await ask({}); break; } catch { await wait(100); } }
    assert.equal(await ask({ host: "localhost:3495" }), 200, "this machine");
    assert.equal(await ask({ host: "evil.example:3495" }), 421, "a name that is not this machine's");
    assert.equal(await ask({ host: "localhost:3495", origin: "https://evil.example", "content-type": "application/json" }, "POST", "/api/settings"), 403, "another site");
    assert.equal(await ask({ host: "192.168.1.50:3495" }), 421, "an address this machine does not have");
  } finally {
    child.kill();
  }
});
