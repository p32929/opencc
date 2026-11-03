// Run with: npm test
import test from "node:test";
import assert from "node:assert/strict";
import { providersFromEnv, displayName } from "./config.js";
import { pickModels } from "./translate.js";
import { callUpstream } from "./server.js";

test("reads an old single-provider config as provider 1", () => {
  const providers = providersFromEnv({
    OPENAI_BASE_URL: "https://api.openai.com/v1/",
    OPENAI_API_KEY: "k1",
    MODELS: "gpt-4o",
  });

  assert.equal(providers.length, 1);
  assert.equal(providers[0].baseUrl, "https://api.openai.com/v1", "trailing slash stripped");
  assert.equal(displayName(providers[0]), "api.openai.com");
});

test("a config written before the tiers were dropped folds into one list", () => {
  const [p] = providersFromEnv({
    OPENAI_BASE_URL: "https://one.test/v1",
    BIG_MODEL: "big-a, shared",
    SMALL_MODEL: "shared, small-a",
  });

  assert.deepEqual(p.models, ["big-a", "shared", "small-a"], "merged, in order, without repeats");
});

test("MODELS wins when both the old and the new keys are present", () => {
  const [p] = providersFromEnv({
    OPENAI_BASE_URL: "https://one.test/v1",
    MODELS: "current",
    BIG_MODEL: "stale",
  });

  assert.deepEqual(p.models, ["current"]);
});

test("reads numbered providers in order, keeps gaps, and keeps the model-less", () => {
  const providers = providersFromEnv({
    OPENAI_BASE_URL: "https://one.test/v1",
    MODELS: "a",
    // no _2 at all — must not stop the scan at the gap
    OPENAI_BASE_URL_3: "http://localhost:11434/v1",
    MODELS_3: "llama3",
    // _4 has a URL and no model. It cannot serve a request, but it is kept:
    // adding the backends first and picking models second is a normal way to
    // set opencc up, and dropping it would throw away the URL and the key
    // between those two steps.
    OPENAI_BASE_URL_4: "https://four.test/v1",
  });

  assert.deepEqual(
    providers.map((p) => p.baseUrl),
    ["https://one.test/v1", "http://localhost:11434/v1", "https://four.test/v1"],
  );
  assert.deepEqual(providers[2].models, [], "it just has nothing in the pot yet");
  assert.equal(providers[1].apiKey, "", "a keyless local backend is valid");
  assert.deepEqual(providers[0].models, ["a"], "a single model parses as a one-item list");
});

test("a provider with no URL is still dropped", () => {
  // Nothing can be done with it: there is nowhere to send a request.
  const providers = providersFromEnv({
    OPENAI_BASE_URL: "https://one.test/v1",
    MODELS: "a",
    PROVIDER_NAME_2: "typo",
    MODELS_2: "b",
  });
  assert.deepEqual(providers.map((p) => p.baseUrl), ["https://one.test/v1"]);
});

test("names a provider by its PROVIDER_NAME, falling back to the host", () => {
  const providers = providersFromEnv({
    PROVIDER_NAME: "work openrouter",
    OPENAI_BASE_URL: "https://openrouter.ai/api/v1",
    MODELS: "openai/gpt-4o",
    OPENAI_BASE_URL_2: "https://openrouter.ai/api/v1",
    MODELS_2: "openai/gpt-4o",
  });

  assert.equal(displayName(providers[0]), "work openrouter", "a set name wins");
  assert.equal(displayName(providers[1]), "openrouter.ai", "an unnamed one falls back to its host");
});

// callUpstream draws its order from the shared stats file, which would both
// pollute the real one and make these tests depend on each other's history.
// These walk the list exactly as given, so a test about the walk is about the
// walk and not about a random draw.
const NO_STATS = {
  order: (attempts) => ({ attempts, head: [], cooling: 0 }),
  record: () => {},
  coolOff: () => 0,
  settled: () => {},
};
const up = (req, providers, streaming = true) => callUpstream(req, providers, streaming, NO_STATS);

const REQ = { model: "claude-sonnet-4", messages: [{ role: "user", content: "hi" }], max_tokens: 16 };

function stubFetch(responders) {
  const seen = [];
  globalThis.fetch = async (url, init) => {
    seen.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    const responder = responders[seen.length - 1];
    if (typeof responder === "string") throw new Error(responder);
    return {
      ok: responder < 400,
      status: responder,
      text: async () => `status ${responder}`,
      // The walk reads a non-streamed reply to check it is usable, so a
      // stubbed success has to look like one.
      json: async () => ({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }] }),
      // A streamed success has to start, or the walk passes it over.
      body: new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n').body,
    };
  };
  return seen;
}

test("falls through exhausted providers to the first one that works", async (t) => {
  const realFetch = globalThis.fetch;
  t.after(() => (globalThis.fetch = realFetch));

  // 429 rate-limited, then an unreachable host, then a provider that answers.
  // Neither status is retryable, so each is one attempt.
  const seen = stubFetch([429, "connect ECONNREFUSED", 200]);

  const result = await up(REQ, [
    { baseUrl: "https://one.test/v1", apiKey: "k1", models: ["big-1"], name: "one" },
    { baseUrl: "https://two.test/v1", apiKey: "k2", models: ["big-2"], name: "two" },
    { baseUrl: "https://three.test/v1", apiKey: "", models: ["big-3"], name: "three" },
  ]);

  assert.equal(result.provider.name, "three");
  assert.equal(result.model, "big-3", "uses the winning provider's own model name");
  assert.equal(seen.length, 3, "stops as soon as one succeeds");
  assert.equal(seen[0].headers.Authorization, "Bearer k1");
  assert.equal(seen[2].headers.Authorization, undefined, "no auth header when the key is blank");
});

test("reports the last error when every provider fails", async (t) => {
  const realFetch = globalThis.fetch;
  t.after(() => (globalThis.fetch = realFetch));

  stubFetch([429, 402]);

  const result = await up(REQ, [
    { baseUrl: "https://one.test/v1", apiKey: "k", models: ["big-1"], name: "one" },
    { baseUrl: "https://two.test/v1", apiKey: "k", models: ["big-2"], name: "two" },
  ]);

  assert.equal(result.upstream, undefined);
  assert.equal(result.status, 402);
  assert.match(result.message, /All 2 provider\/model attempt\(s\) failed/);
  assert.match(result.message, /one\/big-1 429/);
  assert.match(result.message, /two\/big-2 402/);
});

// --- stop_reason must follow the content, not the backend's claim ---------
// Many OpenAI-compatible backends stream tool calls while reporting
// finish_reason "stop"; Claude Code reads "end_turn" as the turn being over
// and never runs the tool.

import { toAnthropicResponse, toOpenAIRequest } from "./translate.js";
import { streamOpenAIToAnthropic, sendAnthropicAsStream } from "./stream.js";

test("non-streaming: a tool call reports tool_use even if finish_reason says stop", () => {
  const out = toAnthropicResponse({
    choices: [{
      finish_reason: "stop",
      message: { content: null, tool_calls: [{ id: "c1", function: { name: "Read", arguments: '{"file_path":"/etc/hosts"}' } }] },
    }],
    usage: { prompt_tokens: 9, completion_tokens: 4 },
  }, "claude-sonnet-4-5");

  assert.equal(out.stop_reason, "tool_use");
  assert.equal(out.content[0].type, "tool_use");
  assert.deepEqual(out.content[0].input, { file_path: "/etc/hosts" });
});

test("non-streaming: a plain text reply still reports end_turn", () => {
  const out = toAnthropicResponse(
    { choices: [{ finish_reason: "stop", message: { content: "hi" } }], usage: {} },
    "claude-sonnet-4-5",
  );
  assert.equal(out.stop_reason, "end_turn");
});

function fakeRes() {
  return { chunks: [], writeHead() {}, write(c) { this.chunks.push(c); }, end() {} };
}

function sseUpstream(chunks) {
  const text = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n";
  return {
    body: {
      getReader() {
        let sent = false;
        return { read: async () => (sent ? { done: true } : ((sent = true), { done: false, value: new TextEncoder().encode(text) })) };
      },
    },
  };
}

test("streaming: a tool call reports tool_use even if finish_reason says stop", async () => {
  const res = fakeRes();
  await streamOpenAIToAnthropic(sseUpstream([
    { choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "Bash", arguments: '{"command":"ls"}' } }] } }] },
    { choices: [{ delta: {}, finish_reason: "stop" }] },
  ]), res, "claude-sonnet-4-5");

  const body = res.chunks.join("");
  assert.match(body, /"stop_reason":"tool_use"/);
  assert.match(body, /"type":"tool_use"/);
  assert.match(body, /input_json_delta/);
});

test("streaming: a plain text reply still reports end_turn", async () => {
  const res = fakeRes();
  await streamOpenAIToAnthropic(sseUpstream([
    { choices: [{ delta: { content: "hi" } }] },
    { choices: [{ delta: {}, finish_reason: "stop" }] },
  ]), res, "claude-sonnet-4-5");

  assert.match(res.chunks.join(""), /"stop_reason":"end_turn"/);
});

// --- model priority lists -------------------------------------------------

test("parses a comma-separated model list", () => {
  const [p] = providersFromEnv({
    OPENAI_BASE_URL: "https://one.test/v1",
    MODELS: "first, second ,third , ",
  });

  assert.deepEqual(p.models, ["first", "second", "third"], "trimmed, blanks dropped");
});

test("tries each model of a provider before moving to the next provider", async (t) => {
  const realFetch = globalThis.fetch;
  t.after(() => (globalThis.fetch = realFetch));

  // first two models of provider one fail, its third works
  const seen = stubFetch([429, 429, 200]);

  const result = await up(REQ, [
    { baseUrl: "https://one.test/v1", apiKey: "k", models: ["m1", "m2", "m3"], name: "one" },
    { baseUrl: "https://two.test/v1", apiKey: "k", models: ["other"], name: "two" },
  ]);

  assert.equal(result.provider.name, "one", "stays on a provider that still has models left");
  assert.equal(result.model, "m3");
  assert.deepEqual(seen.map((s) => s.body.model), ["m1", "m2", "m3"]);
});

test("moves to the next provider once a provider's models are exhausted", async (t) => {
  const realFetch = globalThis.fetch;
  t.after(() => (globalThis.fetch = realFetch));

  const seen = stubFetch([429, 429, 200]);

  const result = await up(REQ, [
    { baseUrl: "https://one.test/v1", apiKey: "k", models: ["m1", "m2"], name: "one" },
    { baseUrl: "https://two.test/v1", apiKey: "k", models: ["m3"], name: "two" },
  ]);

  assert.equal(result.provider.name, "two");
  assert.equal(result.model, "m3");
  assert.deepEqual(seen.map((s) => s.url), [
    "https://one.test/v1/chat/completions",
    "https://one.test/v1/chat/completions",
    "https://two.test/v1/chat/completions",
  ]);
});

// --- disabling a provider -------------------------------------------------

test("reads PROVIDER_DISABLED and keeps the provider in place", () => {
  const providers = providersFromEnv({
    OPENAI_BASE_URL: "https://one.test/v1",
    MODELS: "m1",
    PROVIDER_DISABLED_2: "true",
    OPENAI_BASE_URL_2: "https://two.test/v1",
    MODELS_2: "m2",
    OPENAI_BASE_URL_3: "https://three.test/v1",
    MODELS_3: "m3",
  });

  assert.deepEqual(providers.map((p) => p.disabled), [false, true, false]);
  assert.equal(providers[1].baseUrl, "https://two.test/v1", "it keeps its settings, not deleted");
});

test("a disabled provider is skipped without shifting the others", async (t) => {
  const realFetch = globalThis.fetch;
  t.after(() => (globalThis.fetch = realFetch));

  const seen = stubFetch([200]);

  const result = await up(REQ, [
    { baseUrl: "https://one.test/v1", apiKey: "k", models: ["m1"], name: "one", disabled: true },
    { baseUrl: "https://two.test/v1", apiKey: "k", models: ["m2"], name: "two" },
  ]);

  assert.equal(result.provider.name, "two");
  assert.equal(seen.length, 1, "the disabled provider is never called");
  assert.equal(seen[0].url, "https://two.test/v1/chat/completions");
});

test("all providers disabled reports 503 rather than an empty failure list", async (t) => {
  const realFetch = globalThis.fetch;
  t.after(() => (globalThis.fetch = realFetch));

  const seen = stubFetch([]);

  const result = await up(REQ, [
    { baseUrl: "https://one.test/v1", apiKey: "k", models: ["m1"], name: "one", disabled: true },
  ]);

  assert.equal(result.upstream, undefined);
  assert.equal(result.status, 503);
  assert.match(result.message, /Every provider is switched off/);
  assert.equal(seen.length, 0);
});

// --- global streaming switch ----------------------------------------------

test("streaming off asks upstream for a complete reply", async (t) => {
  const realFetch = globalThis.fetch;
  t.after(() => (globalThis.fetch = realFetch));

  const seen = stubFetch([200, 200]);
  const providers = [
    { baseUrl: "https://one.test/v1", apiKey: "k", models: ["m1"], name: "one" },
  ];

  const on = await up({ ...REQ, stream: true }, providers, true);
  assert.equal(seen[0].body.stream, true, "streaming on: upstream streams");
  assert.equal(on.streamed, true);

  const off = await up({ ...REQ, stream: true }, providers, false);
  assert.equal(seen[1].body.stream, false, "streaming off: upstream does not stream");
  assert.equal(off.streamed, false, "so the caller knows to re-stream it itself");
});

test("a finished message re-streams as well-formed Anthropic SSE", () => {
  const res = fakeRes();
  sendAnthropicAsStream(res, {
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-4-5",
    stop_reason: "tool_use",
    stop_sequence: null,
    content: [
      { type: "text", text: "Reading it." },
      { type: "tool_use", id: "tu_1", name: "Read", input: { file_path: "/etc/hosts" } },
    ],
    usage: { input_tokens: 11, output_tokens: 7 },
  });

  const body = res.chunks.join("");
  for (const event of ["message_start", "content_block_start", "content_block_delta", "content_block_stop", "message_delta", "message_stop"]) {
    assert.match(body, new RegExp(`event: ${event}`), `emits ${event}`);
  }
  assert.match(body, /"text_delta","text":"Reading it\."/);
  assert.match(body, /"input_json_delta","partial_json":"\{\\"file_path\\":\\"\/etc\/hosts\\"\}"/);
  assert.match(body, /"stop_reason":"tool_use"/);
  assert.match(body, /"output_tokens":7/);
  // message_start must not carry the content — the blocks follow as events.
  assert.match(body, /"message_start"[\s\S]*?"content":\[\]/);
});

// --- one retry on a transient upstream failure ----------------------------

test("retries a 5xx once on the same model", async (t) => {
  const realFetch = globalThis.fetch;
  t.after(() => (globalThis.fetch = realFetch));

  const seen = stubFetch([503, 200]);

  const result = await up(REQ, [
    { baseUrl: "https://one.test/v1", apiKey: "k", models: ["m1"], name: "one" },
    { baseUrl: "https://two.test/v1", apiKey: "k", models: ["m2"], name: "two" },
  ]);

  assert.equal(result.provider.name, "one", "stays on the preferred provider");
  assert.equal(result.model, "m1");
  assert.deepEqual(seen.map((s) => s.body.model), ["m1", "m1"], "same model, twice");
});

test("gives up on a model after two 5xx and moves to the next", async (t) => {
  const realFetch = globalThis.fetch;
  t.after(() => (globalThis.fetch = realFetch));

  const seen = stubFetch([500, 500, 200]);

  const result = await up(REQ, [
    { baseUrl: "https://one.test/v1", apiKey: "k", models: ["m1"], name: "one" },
    { baseUrl: "https://two.test/v1", apiKey: "k", models: ["m2"], name: "two" },
  ]);

  assert.equal(result.provider.name, "two");
  assert.deepEqual(seen.map((s) => s.body.model), ["m1", "m1", "m2"]);
});

test("a 429 moves to the next model rather than being retried", async (t) => {
  const realFetch = globalThis.fetch;
  t.after(() => (globalThis.fetch = realFetch));

  // 429 is a 4xx: asking the same model again can't change it, and the key
  // rotator in front of some providers is a separate concern.
  const seen = stubFetch([429, 200]);

  const result = await up(REQ, [
    { baseUrl: "https://one.test/v1", apiKey: "k", models: ["m1"], name: "one" },
    { baseUrl: "https://two.test/v1", apiKey: "k", models: ["m2"], name: "two" },
  ]);

  assert.equal(result.provider.name, "two");
  assert.deepEqual(seen.map((s) => s.body.model), ["m1", "m2"], "m1 tried once only");
});

test("an unreachable host moves on without a retry", async (t) => {
  const realFetch = globalThis.fetch;
  t.after(() => (globalThis.fetch = realFetch));

  // A refused or timed-out request won't heal in 400ms, and the next model is
  // a better bet than waiting out a second timeout.
  const seen = stubFetch(["connect ECONNREFUSED", 200]);

  const result = await up(REQ, [
    { baseUrl: "https://one.test/v1", apiKey: "k", models: ["m1"], name: "one" },
    { baseUrl: "https://two.test/v1", apiKey: "k", models: ["m2"], name: "two" },
  ]);

  assert.equal(result.provider.name, "two");
  assert.equal(seen.length, 2);
});

test("a 400 is never retried", async (t) => {
  const realFetch = globalThis.fetch;
  t.after(() => (globalThis.fetch = realFetch));

  const seen = stubFetch([400, 200]);

  const result = await up(REQ, [
    { baseUrl: "https://one.test/v1", apiKey: "k", models: ["m1"], name: "one" },
    { baseUrl: "https://two.test/v1", apiKey: "k", models: ["m2"], name: "two" },
  ]);

  assert.equal(result.provider.name, "two");
  assert.deepEqual(seen.map((s) => s.body.model), ["m1", "m2"], "no point retrying a 400");
});

// --- never an empty content array -----------------------------------------

test("a reply with no content falls back to the reasoning text", () => {
  const out = toAnthropicResponse(
    { choices: [{ finish_reason: "length", message: { content: null, reasoning: "thinking out loud" } }], usage: {} },
    "claude-sonnet-4-5",
  );
  assert.equal(out.content.length, 1, "never an empty content array");
  assert.deepEqual(out.content[0], { type: "text", text: "thinking out loud" });
});

test("a reply with nothing at all still returns one empty text block", () => {
  const out = toAnthropicResponse(
    { choices: [{ finish_reason: "length", message: { content: null } }], usage: {} },
    "claude-sonnet-4-5",
  );
  assert.deepEqual(out.content, [{ type: "text", text: "" }]);
});

test("streaming: a reply that produced nothing still emits one text block", async () => {
  const res = fakeRes();
  await streamOpenAIToAnthropic(sseUpstream([{ choices: [{ delta: {}, finish_reason: "length" }] }]), res, "claude-sonnet-4-5");
  const body = res.chunks.join("");
  assert.match(body, /"content_block_start"[\s\S]*?"type":"text"/);
  assert.match(body, /event: content_block_stop/);
});

// --- max_tokens is not forwarded --------------------------------------------
// Anthropic requires it so Claude Code always sends one (128000 as of Opus
// 5.5), but it's optional upstream and z.ai rejects anything over 98304.

test("does not forward max_tokens, whatever the client asked for", async (t) => {
  const realFetch = globalThis.fetch;
  t.after(() => (globalThis.fetch = realFetch));

  const seen = stubFetch([200, 200]);
  const provider = { baseUrl: "https://one.test/v1", apiKey: "k", models: ["m1"], name: "one" };

  await up({ ...REQ, max_tokens: 128000 }, [provider]);
  assert.equal("max_tokens" in seen[0].body, false, "absent from the upstream request");

  await up({ ...REQ, max_tokens: 64 }, [provider]);
  assert.equal("max_tokens" in seen[1].body, false, "absent even for a small ask");
});

test("still maps a length finish_reason to max_tokens", () => {
  const out = toAnthropicResponse(
    { choices: [{ finish_reason: "length", message: { content: "cut off" } }], usage: {} },
    "claude-sonnet-4-5",
  );
  assert.equal(out.stop_reason, "max_tokens");
});

// --- parking a single model ------------------------------------------------

test("a disabled model keeps its place but never gets a turn", async (t) => {
  const realFetch = globalThis.fetch;
  t.after(() => (globalThis.fetch = realFetch));

  const seen = stubFetch([200]);
  const result = await up(REQ, [{
    baseUrl: "https://one.test/v1", apiKey: "k", name: "one",
    models: ["m1", "m2", "m3"],
    disabledModels: ["m1"],
  }]);

  assert.equal(result.model, "m2", "m1 is skipped, order otherwise kept");
  assert.deepEqual(seen.map((s) => s.body.model), ["m2"]);
});

test("parking removes a model from the pot, and an absent list changes nothing", () => {
  const provider = {
    baseUrl: "https://one.test/v1", models: ["m1", "parked", "m2"], disabledModels: ["parked"],
  };
  assert.deepEqual(pickModels("claude-sonnet-4-5", provider), ["m1", "m2"]);

  // providers written by an older version have no such field
  assert.deepEqual(pickModels("claude-sonnet-4-5", { baseUrl: "x", models: ["a", "b"] }), ["a", "b"]);
});

test("the model Claude Code asks for no longer picks the list", () => {
  const provider = { baseUrl: "https://one.test/v1", models: ["m1", "m2"] };
  assert.deepEqual(
    pickModels("claude-3-5-haiku", provider),
    pickModels("claude-opus-4", provider),
    "every model is a candidate for every request",
  );
});

test("PROVIDER_MODELS_DISABLED round-trips through the config", () => {
  const [p] = providersFromEnv({
    OPENAI_BASE_URL: "https://one.test/v1",
    MODELS: "a, b, c",
    PROVIDER_MODELS_DISABLED: "b",
  });
  assert.deepEqual(p.models, ["a", "b", "c"], "the list keeps every model");
  assert.deepEqual(p.disabledModels, ["b"]);
  assert.deepEqual(pickModels("claude-sonnet-4-5", p), ["a", "c"]);
});


// --- routing is learned, not configured ------------------------------------

import {
  requirementsOf, describeNeeds, kindOf, successRate,
  belief, betaSample, chooseOrder, coolOff, coolingFor, clearCooldowns,
} from "./stats.js";

test("works out what a request needs", () => {
  assert.deepEqual(requirementsOf({}), { tools: false, vision: false, documents: false });
  assert.deepEqual(
    requirementsOf({ tools: [{ name: "Read" }] }),
    { tools: true, vision: false, documents: false },
  );
  assert.deepEqual(
    requirementsOf({ messages: [{ role: "user", content: [{ type: "image" }] }] }),
    { tools: false, vision: true, documents: false },
  );
  assert.equal(describeNeeds({ tools: true, vision: true }), "tool calling + images");
  assert.equal(describeNeeds({}), "plain text");
});

test("a request is classified by the most specific thing it needs", () => {
  assert.equal(kindOf({ tools: false, vision: false }), "text");
  assert.equal(kindOf({ tools: true, vision: false }), "tools");
  assert.equal(kindOf({ tools: false, vision: true }), "image");
  assert.equal(kindOf({ tools: true, vision: true }), "image", "an image request is an image request");
});

test("the plain rate is for reading, and says nothing when there is nothing to say", () => {
  assert.equal(successRate(null), null);
  assert.equal(successRate({ ok: 0, fail: 0 }), null);
  assert.equal(successRate({ ok: 0, fail: 4 }), 0);
  assert.equal(successRate({ ok: 9, fail: 1 }), 0.9);
});

test("an untried model is held at even odds, not at zero", () => {
  const { a, b } = belief(null, null);
  assert.equal(a, b, "no reason to think it works, no reason to think it doesn't");
});

test("what a model did at other kinds nudges its first try at a new one", () => {
  const good = belief(null, { ok: 40, fail: 0 });
  const bad = belief(null, { ok: 0, fail: 40 });
  assert.ok(good.a / (good.a + good.b) > bad.a / (bad.a + bad.b),
    "a model that answers text is a better first guess for tools");
});

test("a few real results outweigh the nudge from other kinds", () => {
  // 100 clean text replies, then three failures at tools: the three win.
  const { a, b } = belief({ ok: 0, fail: 3 }, { ok: 100, fail: 0 });
  assert.ok(a / (a + b) < 0.5, "it cannot call tools, whatever it does with text");
});

// A small deterministic generator, so a test about the draw is repeatable.
function seeded(seed) {
  let x = seed;
  return () => {
    x = (x * 1664525 + 1013904223) % 4294967296;
    return x / 4294967296;
  };
}

test("the draw lands inside the unit interval", () => {
  const rng = seeded(7);
  for (let i = 0; i < 200; i++) {
    const v = betaSample(1 + i, 1 + (200 - i), rng);
    assert.ok(v > 0 && v < 1, `drew ${v}`);
  }
});

test("the draw tracks the record it came from", () => {
  const rng = seeded(11);
  const mean = (a, b) => {
    let total = 0;
    for (let i = 0; i < 4000; i++) total += betaSample(a, b, rng);
    return total / 4000;
  };
  assert.ok(Math.abs(mean(9, 1) - 0.9) < 0.02, "nine of ten draws high");
  assert.ok(Math.abs(mean(1, 9) - 0.1) < 0.02, "one of ten draws low");
});

const attempt = (host, model) => ({ provider: { baseUrl: `https://${host}/v1`, name: host }, model });

// How often each model comes out in front over many draws. This is the
// behaviour that matters: not which model wins, but how the wins are shared.
function firstPlaceCounts(attempts, kind, records, runs = 600) {
  const rng = seeded(3);
  const counts = {};
  for (const a of attempts) counts[a.model] = 0;
  for (let i = 0; i < runs; i++) {
    const { attempts: order } = chooseOrder(attempts, kind, {
      lookup: (baseUrl, model) => records[model] ?? null,
      lookupOther: () => null,
      rng,
    });
    counts[order[0].model] += 1;
  }
  return counts;
}

test("a model with a long bad record effectively stops being asked", () => {
  const attempts = [attempt("one", "good"), attempt("two", "poor")];
  const counts = firstPlaceCounts(attempts, "tools", {
    good: { ok: 40, fail: 4 },
    poor: { ok: 3, fail: 40 },
  });

  assert.equal(counts.poor, 0, `forty failures is an answer: ${JSON.stringify(counts)}`);
});

test("a model with only a few failures keeps getting re-checked", () => {
  // This is the half of the trade the old threshold version had no answer
  // for. Two of eight is a bad afternoon, not a verdict, so it still takes
  // the lead sometimes and can earn its place back.
  const attempts = [attempt("one", "good"), attempt("two", "thin")];
  const counts = firstPlaceCounts(attempts, "tools", {
    good: { ok: 12, fail: 3 },
    thin: { ok: 2, fail: 6 },
  }, 4000);

  assert.ok(counts.good > counts.thin * 10, `good still leads: ${JSON.stringify(counts)}`);
  assert.ok(counts.thin > 10, `and the thin one is retried: ${JSON.stringify(counts)}`);
});

test("work spreads across models that are doing equally well", () => {
  const attempts = [attempt("one", "a"), attempt("two", "b"), attempt("three", "c")];
  const record = { ok: 30, fail: 3 };
  const counts = firstPlaceCounts(attempts, "tools", { a: record, b: record, c: record });

  // The old version sorted by rate and sent everything to whichever model was
  // in front. Each of these should take roughly a third.
  for (const model of ["a", "b", "c"]) {
    assert.ok(counts[model] > 120, `${model} took only ${counts[model]} of 600`);
  }
});

test("a model that has never done this kind of request still gets a turn", () => {
  const attempts = [attempt("one", "known-bad"), attempt("two", "untried")];
  const counts = firstPlaceCounts(attempts, "image", { "known-bad": { ok: 0, fail: 25 } });

  assert.ok(counts.untried > counts["known-bad"] * 5,
    `untried should lead: ${JSON.stringify(counts)}`);
});

test("failing at images does not cost a model its place for text", () => {
  const attempts = [attempt("one", "m1"), attempt("two", "m2")];
  const records = { image: { m1: { ok: 0, fail: 30 } }, text: {} };
  const counts = (kind) => {
    const rng = seeded(5);
    const out = { m1: 0, m2: 0 };
    for (let i = 0; i < 400; i++) {
      const { attempts: order } = chooseOrder(attempts, kind, {
        lookup: (baseUrl, model) => records[kind][model] ?? null,
        lookupOther: () => null,
        rng,
      });
      out[order[0].model] += 1;
    }
    return out;
  };

  assert.ok(counts("image").m2 > counts("image").m1 * 5, "sunk for images");
  const text = counts("text");
  assert.ok(Math.abs(text.m1 - text.m2) < 120, "and untouched for text");
});

test("nothing is ever struck off: every model stays in the walk", () => {
  const attempts = [attempt("one", "hopeless"), attempt("two", "fine")];
  const { attempts: order } = chooseOrder(attempts, "tools", {
    lookup: (baseUrl, model) => (model === "hopeless" ? { ok: 0, fail: 500 } : { ok: 500, fail: 0 }),
    lookupOther: () => null,
    rng: seeded(1),
  });

  assert.equal(order.length, 2);
  assert.deepEqual(order.map((a) => a.model), ["fine", "hopeless"], "last, but still there");
});

// --- a rate limit is about the next minute, not about the model ------------

test("a rate-limited model goes to the back and comes back on its own", () => {
  clearCooldowns();
  const attempts = [attempt("one", "limited"), attempt("two", "free")];
  const lookups = { lookup: () => ({ ok: 50, fail: 0 }), lookupOther: () => null, rng: seeded(2) };

  coolOff("https://one/v1", "limited", 429, 1000);

  const during = chooseOrder(attempts, "tools", { ...lookups, now: 2000 });
  assert.deepEqual(during.attempts.map((a) => a.model), ["free", "limited"], "back of the queue");
  assert.equal(during.cooling, 1);

  const after = chooseOrder(attempts, "tools", { ...lookups, now: 1000 + 60000 + 1 });
  assert.equal(after.cooling, 0, "the timer ran out and nobody had to do anything");
});

test("only a rate limit or an outage starts the timer", () => {
  clearCooldowns();
  assert.ok(coolOff("https://x/v1", "m", 429) > 0, "rate limited");
  assert.ok(coolOff("https://x/v1", "m", 503) > 0, "unavailable");
  assert.ok(coolOff("https://x/v1", "m", 0) > 0, "never answered");
  assert.equal(coolOff("https://x/v1", "m", 400), 0, "a 400 is about the request, not the minute");
  assert.equal(coolOff("https://x/v1", "m", 200), 0);
  clearCooldowns();
  assert.equal(coolingFor("https://x/v1", "m"), 0);
});

test("a cooling model is still reachable when nothing else is left", async (t) => {
  const realFetch = globalThis.fetch;
  t.after(() => (globalThis.fetch = realFetch));
  clearCooldowns();

  coolOff("https://one.test/v1", "m1", 429);
  const seen = stubFetch([500, 500, 200]);

  // Real ordering this time, so the cooldown actually applies.
  const result = await callUpstream(
    REQ,
    [
      { baseUrl: "https://one.test/v1", apiKey: "k", models: ["m1"], name: "one" },
      { baseUrl: "https://two.test/v1", apiKey: "k", models: ["m2"], name: "two" },
    ],
    true,
    { order: chooseOrder, record: () => {}, coolOff: () => 0, settled: () => {} },
  );

  assert.deepEqual(seen.map((s) => s.body.model), ["m2", "m2", "m1"],
    "the cooling model is tried last rather than skipped");
  assert.equal(result.model, "m1");
  clearCooldowns();
});

// --- the record forgets ----------------------------------------------------

import { decayed } from "./stats.js";

const DAY = 86400000;
const daysAgo = (now, n) => String(Math.floor((now - n * DAY) / DAY));

test("an entry with no day buckets is used as it stands", () => {
  // "weighted" is what the router scores on; with no status to weigh it
  // falls back to the plain count.
  assert.deepEqual(decayed({ ok: 3, fail: 1 }), { ok: 3, fail: 1, weighted: 1 });
  assert.equal(decayed(null), null);
});

test("today's results count fully", () => {
  const now = Date.now();
  const entry = { ok: 4, fail: 1, days: { [daysAgo(now, 0)]: { ok: 4, fail: 1 } } };
  const out = decayed(entry, now);
  assert.ok(Math.abs(out.ok - 4) < 0.01 && Math.abs(out.fail - 1) < 0.01);
});

test("old results fade", () => {
  const now = Date.now();
  const stale = { ok: 0, fail: 20, days: { [daysAgo(now, 30)]: { ok: 0, fail: 20 } } };
  const out = decayed(stale, now);
  assert.ok(out.fail / 20 < 0.01, `a month of silence should leave under 1%, left ${(out.fail / 20 * 100).toFixed(1)}%`);
  assert.ok(out.fail > 0, "faded, not erased");
});

test("a bad week does not outweigh a good today", () => {
  const now = Date.now();
  const entry = {
    ok: 5, fail: 20,
    days: {
      [daysAgo(now, 14)]: { ok: 0, fail: 20 },  // a fortnight ago it was broken
      [daysAgo(now, 0)]: { ok: 5, fail: 0 },    // today it works
    },
  };

  const raw = 5 / 25;
  const out = decayed(entry, now);
  const recent = out.ok / (out.ok + out.fail);
  assert.ok(recent > 0.7, `should read as working now, got ${recent.toFixed(2)} against ${raw.toFixed(2)} all-time`);
});

test("a model that has been broken for a month climbs back ahead of one still failing", () => {
  const now = Date.now();
  const recovered = { ok: 0, fail: 40, days: { [daysAgo(now, 40)]: { ok: 0, fail: 40 } } };
  const stillBad = { ok: 0, fail: 8, days: { [daysAgo(now, 0)]: { ok: 0, fail: 8 } } };

  const a = belief(recovered, null, now);
  const b = belief(stillBad, null, now);
  assert.ok(
    a.a / (a.a + a.b) > b.a / (b.a + b.b),
    "forty failures last month says less than eight failures today",
  );
});

test("compaction shares a day out across statuses without losing any", () => {
  // Three results in a day, five different failure codes on record. Rounding
  // each share on its own gives 0.6 -> 1 five times, or floors to zero five
  // times; neither adds up to three.
  const statuses = { 429: 3, 500: 3, 502: 3, 0: 3, 400: 3 };
  const count = 3;
  const group = Object.entries(statuses);
  const total = group.reduce((sum, [, n]) => sum + n, 0);

  const shares = group.map(([status, n]) => {
    const exact = (n / total) * count;
    return { status, n: Math.floor(exact), frac: exact - Math.floor(exact) };
  });
  let spare = count - shares.reduce((sum, s) => sum + s.n, 0);
  for (const share of [...shares].sort((x, y) => y.frac - x.frac)) {
    if (spare <= 0) break;
    share.n += 1;
    spare -= 1;
  }

  assert.equal(shares.reduce((sum, s) => sum + s.n, 0), count, "every result accounted for");
});

test("a reset moves the log aside rather than deleting it", async (t) => {
  // Its own HOME, so the real record is never in reach of this test.
  const { mkdtempSync, writeFileSync, existsSync, readFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { execFileSync } = await import("node:child_process");

  const home = mkdtempSync(join(tmpdir(), "opencc-reset-"));
  const script = join(home, "run.mjs");
  const here = new URL(".", import.meta.url).pathname;

  writeFileSync(script, [
    `import { record, flush, aggregate, resetStats } from "${join(here, "stats.js")}";`,
    `import { STATS_PATH } from "${join(here, "paths.js")}";`,
    `import { existsSync, readFileSync } from "node:fs";`,
    `record({ baseUrl: "https://p/v1", model: "m", kind: "tools", status: 200 });`,
    `flush();`,
    `const before = [...aggregate().values()].reduce((n, e) => n + e.ok + e.fail, 0);`,
    `const { moved, previous } = resetStats();`,
    `const after = [...aggregate().values()].reduce((n, e) => n + e.ok + e.fail, 0);`,
    `console.log(JSON.stringify({`,
    `  before, after, moved,`,
    `  logGone: !existsSync(STATS_PATH),`,
    `  keptCopy: existsSync(previous) && readFileSync(previous, "utf8").includes('"m"'),`,
    `}));`,
  ].join("\n"));

  const out = JSON.parse(execFileSync(process.execPath, [script], { env: { ...process.env, HOME: home } }).toString());

  assert.equal(out.before, 1, "one result on record");
  assert.equal(out.after, 0, "and none after the reset");
  assert.equal(out.moved, true);
  assert.equal(out.logGone, true, "the live log is gone");
  assert.equal(out.keptCopy, true, "but the previous copy still holds it");
});

test("resetting an empty record is harmless", async () => {
  // In its own HOME. Calling resetStats() in this process would move the
  // real log aside, which is a thing this test did exactly once.
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { execFileSync } = await import("node:child_process");

  const home = mkdtempSync(join(tmpdir(), "opencc-reset-empty-"));
  const script = join(home, "run.mjs");
  const here = new URL(".", import.meta.url).pathname;

  writeFileSync(script, [
    `import { resetStats } from "${join(here, "stats.js")}";`,
    `console.log(JSON.stringify(resetStats()));`,
  ].join("\n"));

  const out = JSON.parse(execFileSync(process.execPath, [script], { env: { ...process.env, HOME: home } }).toString());
  assert.equal(out.moved, false, "nothing to move, and nothing thrown");
});

test("opencc --reset-stats clears the record and leaves the config alone", async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, existsSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join, dirname } = await import("node:path");
  const { execFileSync } = await import("node:child_process");

  const home = mkdtempSync(join(tmpdir(), "opencc-cli-reset-"));
  mkdirSync(join(home, ".opencc"));
  const config = [
    "PROVIDER_NAME=kept",
    "OPENAI_BASE_URL=https://example.test/v1",
    "OPENAI_API_KEY=keep-me",
    "MODELS=m1, m2",
    "PROVIDER_MODELS_DISABLED=m2",
    "PORT=4242",
    "",
  ].join("\n");
  writeFileSync(join(home, ".opencc", ".env"), config);

  const here = dirname(new URL(import.meta.url).pathname);
  const env = { ...process.env, HOME: home };

  // give it something to forget
  const seed = join(home, "seed.mjs");
  writeFileSync(seed,
    `import { record } from "${join(here, "stats.js")}";\n` +
    `for (let i = 0; i < 9; i++) record({ baseUrl: "https://example.test/v1", model: "m1", kind: "tools", status: 200 });\n`);
  execFileSync(process.execPath, [seed], { env });
  assert.ok(existsSync(join(home, ".opencc", "stats.jsonl")), "seeded");

  const out = execFileSync(process.execPath, [join(here, "cli.js"), "--reset-stats"], { env }).toString();

  assert.match(out, /Record reset/);
  assert.equal(existsSync(join(home, ".opencc", "stats.jsonl")), false, "the live log is gone");
  assert.ok(existsSync(join(home, ".opencc", "stats.jsonl.previous")), "kept as the previous one");

  const { readFileSync } = await import("node:fs");
  assert.equal(readFileSync(join(home, ".opencc", ".env"), "utf8"), config,
    "providers, models, keys, parking and port all byte-for-byte unchanged");
});

test("--reset-stats on an empty record says so and keeps any earlier backup", async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, readFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join, dirname } = await import("node:path");
  const { execFileSync } = await import("node:child_process");

  const home = mkdtempSync(join(tmpdir(), "opencc-cli-reset-empty-"));
  mkdirSync(join(home, ".opencc"));
  writeFileSync(join(home, ".opencc", "stats.jsonl.previous"), "an earlier reset\n");

  const here = dirname(new URL(import.meta.url).pathname);
  const out = execFileSync(process.execPath, [join(here, "cli.js"), "--reset-stats"], {
    env: { ...process.env, HOME: home },
  }).toString();

  assert.match(out, /Nothing on record/);
  assert.equal(readFileSync(join(home, ".opencc", "stats.jsonl.previous"), "utf8"), "an earlier reset\n",
    "a reset with nothing to reset must not overwrite what is already there");
});


test("a result written by another process is picked up without a restart", async () => {
  // The panel tests a newly added model in its own process. A proxy already
  // running has to see that without being restarted, or adding a model would
  // only take effect next time you start it.
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join, dirname } = await import("node:path");
  const { execFileSync } = await import("node:child_process");

  const home = mkdtempSync(join(tmpdir(), "opencc-shared-"));
  const here = dirname(new URL(import.meta.url).pathname);
  const stats = join(here, "stats.js");

  // one long-lived reader, one writer that runs part way through it
  const reader = join(home, "reader.mjs");
  writeFileSync(reader, [
    `import { statsFor } from "${stats}";`,
    `import { execFileSync } from "node:child_process";`,
    `import { writeFileSync } from "node:fs";`,
    `const look = () => statsFor("https://p/v1", "m", "tools");`,
    `const before = look();`,
    `const w = "${join(home, "writer.mjs")}";`,
    `writeFileSync(w, 'import { record } from "${stats}";\\n' +`,
    `  'for (let i = 0; i < 5; i++) record({ baseUrl: "https://p/v1", model: "m", kind: "tools", status: 200 });\\n');`,
    `execFileSync(process.execPath, [w], { env: process.env });`,
    `const after = look();`,
    `console.log(JSON.stringify({ before, after }));`,
  ].join("\n"));

  const out = JSON.parse(execFileSync(process.execPath, [reader], {
    env: { ...process.env, HOME: home },
  }).toString());

  assert.equal(out.before, null, "nothing on record to start with");
  assert.equal(out.after.ok, 5, "the same reader sees the other process's writes");
});

test("the proxy stays down until a provider exists, then comes up on its own", async () => {
  const { mkdtempSync, mkdirSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join, dirname } = await import("node:path");
  const { spawn } = await import("node:child_process");

  const home = mkdtempSync(join(tmpdir(), "opencc-merge-"));
  mkdirSync(join(home, ".opencc"));
  const here = dirname(new URL(import.meta.url).pathname);

  const panelPort = 3491;
  const proxyPort = 3492;
  const child = spawn(process.execPath, [
    join(here, "cli.js"), "--panel-port", String(panelPort), "--port", String(proxyPort),
  ], { env: { ...process.env, HOME: home, OPENCC_NO_BROWSER: "1" }, stdio: "ignore" });

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const up = async (port) => {
    try {
      await fetch(`http://localhost:${port}/`, { signal: AbortSignal.timeout(500) });
      return true;
    } catch { return false; }
  };

  try {
    for (let i = 0; i < 40 && !(await up(panelPort)); i++) await wait(100);
    assert.equal(await up(panelPort), true, "the panel always comes up");
    assert.equal(await up(proxyPort), false, "the proxy does not, with nothing to route to");

    // add a provider exactly as the panel's form does
    const added = await fetch(`http://localhost:${panelPort}/api/provider`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "test", baseUrl: "https://example.test/v1", apiKey: "" }),
    });
    assert.equal(added.status, 200);

    for (let i = 0; i < 40 && !(await up(proxyPort)); i++) await wait(100);
    assert.equal(await up(proxyPort), true, "and starts by itself once there is");
  } finally {
    child.kill();
  }
});





// --- is it worth exposing the proxy at all ---------------------------------


const pot = (models, parked = []) => [{
  baseUrl: "https://one/v1", name: "one", models, disabledModels: parked, disabled: false,
}];



test("a model with nothing but failures no longer keeps the proxy down", async () => {
  // It used to: the proxy refused to start unless something had proved it
  // could call tools, which meant probing every model on every cold start to
  // answer what models.dev already answers. A model that fails is a routing
  // problem, and routing handles it by drawing something else.
  const { mkdtempSync, mkdirSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join, dirname } = await import("node:path");
  const { spawn, execFileSync } = await import("node:child_process");

  const home = mkdtempSync(join(tmpdir(), "opencc-gate-"));
  mkdirSync(join(home, ".opencc"));
  const here = dirname(new URL(import.meta.url).pathname);

  const panelPort = 3493;
  const proxyPort = 3494;
  writeFileSync(join(home, ".opencc", ".env"), [
    "OPENAI_BASE_URL=https://example.test/v1",
    "OPENAI_API_KEY=",
    "MODELS=m",
    `PORT=${proxyPort}`,
    "",
  ].join("\n"));

  // Ten failures and not one success.
  const seed = join(home, "seed.mjs");
  writeFileSync(seed,
    `import { record } from "${join(here, "stats.js")}";\n` +
    `for (let i = 0; i < 10; i++) record({ baseUrl: "https://example.test/v1", model: "m", kind: "tools", status: 400 });\n`);
  execFileSync(process.execPath, [seed], { env: { ...process.env, HOME: home } });

  const child = spawn(process.execPath, [
    join(here, "cli.js"), "--panel-port", String(panelPort), "--port", String(proxyPort),
  ], { env: { ...process.env, HOME: home, OPENCC_NO_BROWSER: "1" }, stdio: "ignore" });

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const up = async (port) => {
    try {
      await fetch(`http://localhost:${port}/`, { signal: AbortSignal.timeout(500) });
      return true;
    } catch { return false; }
  };

  try {
    for (let i = 0; i < 40 && !(await up(proxyPort)); i++) await wait(100);
    assert.equal(await up(proxyPort), true, "there is a provider with a model, so it serves");
  } finally {
    child.kill();
  }
});

// --- a PDF must never vanish quietly ---------------------------------------

test("a document block is forwarded, not dropped", () => {
  const out = toOpenAIRequest({
    model: "c",
    messages: [{
      role: "user",
      content: [
        { type: "text", text: "Summarise this." },
        { type: "document", title: "report.pdf", source: { type: "base64", media_type: "application/pdf", data: "AAAA" } },
      ],
    }],
  }, "m", "https://x/v1", false);

  const parts = out.messages[0].content;
  assert.equal(parts.length, 2, "the text and the document both go");
  assert.equal(parts[1].type, "file");
  assert.equal(parts[1].file.filename, "report.pdf");
  assert.match(parts[1].file.file_data, /^data:application\/pdf;base64,/);
});

test("a document block from a URL is forwarded too", () => {
  const out = toOpenAIRequest({
    model: "c",
    messages: [{ role: "user", content: [{ type: "document", source: { type: "url", url: "https://x/a.pdf" } }] }],
  }, "m", "https://x/v1", false);

  assert.equal(out.messages[0].content[0].file.file_data, "https://x/a.pdf");
});

test("a request carrying a PDF is routed as a document, not as text", () => {
  // It used to come out as "text", so a model that cannot read PDFs looked
  // like a fine choice and then answered about a document it never saw.
  const pdf = { messages: [{ role: "user", content: [{ type: "document", source: {} }] }] };
  assert.equal(kindOf(requirementsOf(pdf)), "document");

  // and the most demanding need wins when several are present
  const everything = {
    tools: [{ name: "t" }],
    messages: [{ role: "user", content: [{ type: "image" }, { type: "document", source: {} }] }],
  };
  assert.equal(kindOf(requirementsOf(everything)), "document");
});


// --- what a failure actually means -----------------------------------------

import { weightOf, cooledOffSuccessfully } from "./stats.js";

test("a failure is weighed by whether it settles anything", () => {
  assert.equal(weightOf(200), 0, "a success is not a failure");

  // The provider told us the request can never work here.
  for (const status of [400, 401, 402, 403, 404, 413, 422, 501]) {
    assert.equal(weightOf(status), 4, `${status} is conclusive`);
  }

  // The minute was busy, the host was down, nobody answered.
  for (const status of [0, 408, 425, 429, 500, 503]) {
    assert.equal(weightOf(status), 0.25, `${status} says nothing about the model`);
  }
});

test("two conclusive failures sink a model further than ten busy ones", () => {
  const rate = (entry) => {
    const { a, b } = belief(entry, null);
    return a / (a + b);
  };

  const told = rate({ ok: 0, fail: 2, weighted: 2 * weightOf(400) });
  const busy = rate({ ok: 0, fail: 10, weighted: 10 * weightOf(429) });

  assert.ok(told < busy, `conclusive ${told.toFixed(2)} should sit below throttled ${busy.toFixed(2)}`);
});

test("the plain counts are left alone for display", () => {
  // The panel shows "3 of 19 answered". Weighting is for the router only, so
  // nobody has to be told about it to read the page.
  const entry = decayed({ ok: 3, fail: 16, weighted: 40 });
  assert.equal(entry.ok, 3);
  assert.equal(entry.fail, 16, "still the real number of failures");
  assert.equal(entry.weighted, 40, "and the router's view is separate");
});

// --- a provider that has run dry moves as one ------------------------------

test("once half a provider's models are cooling, the rest go with them", () => {
  clearCooldowns();
  const DRY = "https://dry/v1";
  const FINE = "https://fine/v1";
  const attempts = [
    ...["a", "b", "c", "d"].map((m) => ({ provider: { baseUrl: DRY, name: "dry" }, model: m })),
    ...["x", "y"].map((m) => ({ provider: { baseUrl: FINE, name: "fine" }, model: m })),
  ];

  // two of four start refusing, which is what a spent quota looks like
  coolOff(DRY, "a", 429);
  coolOff(DRY, "b", 429);

  const { attempts: order } = chooseOrder(attempts, "tools", {
    lookup: () => ({ ok: 9, fail: 1 }), lookupOther: () => null, rng: seeded(4),
  });

  const firstTwo = order.slice(0, 2).map((a) => a.provider.name);
  assert.deepEqual(firstTwo.sort(), ["fine", "fine"], "the working provider goes first");
  assert.equal(order.length, 6, "and nothing is dropped");
  clearCooldowns();
});

test("one cooling model does not condemn its provider", () => {
  clearCooldowns();
  const P = "https://p/v1";
  const attempts = ["a", "b", "c", "d"].map((m) => ({ provider: { baseUrl: P, name: "p" }, model: m }));
  coolOff(P, "a", 429);

  const { cooling } = chooseOrder(attempts, "tools", {
    lookup: () => ({ ok: 9, fail: 1 }), lookupOther: () => null, rng: seeded(4),
  });

  assert.equal(cooling, 1, "one in four is a model having a moment, not a dead provider");
  clearCooldowns();
});

// --- speed is part of the choice -------------------------------------------

import { slowness, meanMs } from "./stats.js";

test("a reply under a second costs nothing, and the penalty is bounded", () => {
  assert.equal(slowness(900), 0, "fast is free");
  assert.equal(slowness(1000), 0);
  assert.ok(slowness(60000) < 0.15, "and never enough to outrank a real difference in reliability");
  assert.ok(slowness(10000) > slowness(3000), "but slower is always worse");
});

test("latency is only kept for answers", () => {
  assert.equal(meanMs(null), null);
  assert.equal(meanMs({ timed: 0, totalMs: 0 }), null, "nothing timed yet");
  assert.equal(meanMs({ timed: 2, totalMs: 3000 }), 1500);
});

test("between two equally good models the faster one wins more often", () => {
  const attempts = [attempt("one", "quick"), attempt("two", "slow")];
  const record = { ok: 30, fail: 2, weighted: 2 };
  const lookup = (baseUrl, model) =>
    model === "quick" ? { ...record, timed: 10, totalMs: 8000 }     // 0.8s
                      : { ...record, timed: 10, totalMs: 400000 };  // 40s

  const rng = seeded(9);
  const counts = { quick: 0, slow: 0 };
  for (let i = 0; i < 2000; i++) {
    const { attempts: order } = chooseOrder(attempts, "tools", { lookup, lookupOther: () => null, rng });
    counts[order[0].model] += 1;
  }

  assert.ok(counts.quick > counts.slow, `quick should lead: ${JSON.stringify(counts)}`);
  assert.ok(counts.slow > 100, `but slow still gets a turn: ${JSON.stringify(counts)}`);
});

test("speed never rescues a model that does not work", () => {
  const attempts = [attempt("one", "fast-and-broken"), attempt("two", "slow-and-good")];
  const lookup = (baseUrl, model) =>
    model === "fast-and-broken"
      ? { ok: 0, fail: 20, weighted: 80, timed: 5, totalMs: 1000 }
      : { ok: 20, fail: 0, weighted: 0, timed: 5, totalMs: 200000 };

  const rng = seeded(3);
  let good = 0;
  for (let i = 0; i < 500; i++) {
    const { attempts: order } = chooseOrder(attempts, "tools", { lookup, lookupOther: () => null, rng });
    if (order[0].model === "slow-and-good") good += 1;
  }
  assert.ok(good > 480, `working beats fast: ${good} of 500`);
});

// --- a 200 is not automatically a success ----------------------------------

import { verdictFor } from "./stats.js";

test("an empty reply is a failure however polite the status line", () => {
  assert.equal(verdictFor({}, { blocks: 0, toolUse: false }), "empty");
});

test("tool arguments that will not parse are a failure", () => {
  assert.equal(verdictFor({}, { blocks: 1, toolUse: true, badArguments: true }), "bad_arguments");
});

test("answering in prose is only a failure when a tool call was required", () => {
  // Claude Code offers tools on nearly every request. Replying "this function
  // sorts the list" is the right answer, not a broken model, so this must not
  // be counted against it.
  assert.equal(verdictFor({ tool_choice: { type: "auto" } }, { blocks: 1, toolUse: false }), "ok");
  assert.equal(verdictFor({}, { blocks: 1, toolUse: false }), "ok");

  // tool_choice any/tool means the model was told it had to call one.
  assert.equal(verdictFor({ tool_choice: { type: "any" } }, { blocks: 1, toolUse: false }), "no_tool_call");
  assert.equal(verdictFor({ tool_choice: { type: "tool" } }, { blocks: 1, toolUse: false }), "no_tool_call");
  assert.equal(verdictFor({ tool_choice: { type: "any" } }, { blocks: 1, toolUse: true }), "ok");
});

test("a 200 with a bad verdict counts against the model like a 400 would", async () => {
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join, dirname } = await import("node:path");
  const { execFileSync } = await import("node:child_process");

  const home = mkdtempSync(join(tmpdir(), "opencc-verdict-"));
  const here = dirname(new URL(import.meta.url).pathname);
  const script = join(home, "run.mjs");

  writeFileSync(script, [
    `import { record, flush, statsFor, decayed } from "${join(here, "stats.js")}";`,
    `record({ baseUrl: "https://p/v1", model: "m", kind: "tools", status: 200 });`,
    `record({ baseUrl: "https://p/v1", model: "m", kind: "tools", status: 200, verdict: "empty" });`,
    `flush();`,
    `const e = statsFor("https://p/v1", "m", "tools");`,
    `console.log(JSON.stringify({ ok: e.ok, fail: e.fail, weighted: decayed(e).weighted }));`,
  ].join("\n"));

  const out = JSON.parse(execFileSync(process.execPath, [script], { env: { ...process.env, HOME: home } }).toString());

  assert.equal(out.ok, 1, "only the good one counts as an answer");
  assert.equal(out.fail, 1, "the empty 200 is a failure");
  assert.ok(out.weighted >= 4, `and it carries conclusive weight, got ${out.weighted}`);
});

// --- too big is about the request, not the model ---------------------------

import { isTooBig, knownTooSmall, TOO_BIG_VERDICT } from "./stats.js";

test("an overflow is told apart from a real refusal", () => {
  // These two are what ollama and z.ai actually send, captured by sending
  // deliberately oversized requests rather than guessed.
  assert.equal(isTooBig(400, '{"error":{"message":"The prompt is too long: 133418, model maximum context length: 131072"}}'), true);
  assert.equal(isTooBig(400, '{"error":{"code":"1261","message":"Prompt exceeds max length"}}'), true);
  assert.equal(isTooBig(413, ""), true, "payload too large needs no message");

  // and the failures that are about the model
  assert.equal(isTooBig(400, '{"error":{"message":"this model does not support image input"}}'), false);
  assert.equal(isTooBig(429, "rate limited"), false);
  assert.equal(isTooBig(403, "Authorization failed"), false);
});

test("a model that refused a smaller request cannot take a bigger one", () => {
  const entry = { minTooBig: 100000 };
  assert.equal(knownTooSmall(entry, 150000), true);
  assert.equal(knownTooSmall(entry, 100000), true, "the same size failed once already");
  assert.equal(knownTooSmall(entry, 50000), false, "smaller is still worth trying");
  assert.equal(knownTooSmall({ minTooBig: Infinity }, 999999), false, "never refused anything");
  assert.equal(knownTooSmall(null, 1000), false);
});

test("a model too small for this request goes behind even a cooling one", () => {
  clearCooldowns();
  const attempts = [attempt("one", "small"), attempt("two", "cooling"), attempt("three", "fine")];
  coolOff("https://two/v1", "cooling", 429);

  const { attempts: order, tooSmall } = chooseOrder(attempts, "tools", {
    lookup: (baseUrl, model) =>
      model === "small" ? { ok: 5, fail: 1, weighted: 1, minTooBig: 90000 } : { ok: 5, fail: 1, weighted: 1 },
    lookupOther: () => null,
    rng: seeded(6),
    chars: 120000,
  });

  assert.deepEqual(order.map((a) => a.model), ["fine", "cooling", "small"]);
  assert.equal(tooSmall, 1);
  clearCooldowns();
});

test("an oversized request does not count against the model", async () => {
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join, dirname } = await import("node:path");
  const { execFileSync } = await import("node:child_process");

  const home = mkdtempSync(join(tmpdir(), "opencc-toobig-"));
  const here = dirname(new URL(import.meta.url).pathname);
  const script = join(home, "run.mjs");

  writeFileSync(script, [
    `import { record, flush, statsFor, decayed } from "${join(here, "stats.js")}";`,
    `record({ baseUrl: "https://p/v1", model: "m", kind: "tools", status: 400, chars: 500000, verdict: "${TOO_BIG_VERDICT}" });`,
    `record({ baseUrl: "https://p/v1", model: "m", kind: "tools", status: 400 });`,
    `flush();`,
    `const e = statsFor("https://p/v1", "m", "tools");`,
    `console.log(JSON.stringify({ fail: e.fail, weighted: decayed(e).weighted, minTooBig: e.minTooBig }));`,
  ].join("\n"));

  const out = JSON.parse(execFileSync(process.execPath, [script], { env: { ...process.env, HOME: home } }).toString());

  assert.equal(out.fail, 2, "both failed");
  assert.equal(out.minTooBig, 500000, "and the ceiling was learned from the oversized one");
  // Only the plain 400 should carry weight: 4 for a conclusive refusal, and
  // nothing at all for the request simply being too long.
  assert.ok(out.weighted >= 3.9 && out.weighted <= 4.1, `expected ~4, got ${out.weighted}`);
});

// --- a reply we can see is useless gets another model ----------------------

test("a 200 that came back empty is not served, the next model is tried", async (t) => {
  const realFetch = globalThis.fetch;
  t.after(() => (globalThis.fetch = realFetch));

  const seen = [];
  globalThis.fetch = async (url, init) => {
    const model = JSON.parse(init.body).model;
    seen.push(model);
    return {
      ok: true, status: 200, text: async () => "",
      json: async () => (model === "hollow"
        ? { choices: [{ message: { content: "" }, finish_reason: "stop" }] }
        : { choices: [{ message: { content: "a real answer" }, finish_reason: "stop" }] }),
    };
  };

  const result = await up(REQ, [
    { baseUrl: "https://one.test/v1", apiKey: "k", models: ["hollow"], name: "one" },
    { baseUrl: "https://two.test/v1", apiKey: "k", models: ["solid"], name: "two" },
  ]);

  assert.deepEqual(seen, ["hollow", "solid"], "the empty one was not good enough");
  assert.equal(result.model, "solid");
  assert.equal(result.reply.content[0].text, "a real answer");
});

test("a reply that is not JSON at all moves on rather than throwing", async (t) => {
  const realFetch = globalThis.fetch;
  t.after(() => (globalThis.fetch = realFetch));

  globalThis.fetch = async (url, init) => {
    const model = JSON.parse(init.body).model;
    return {
      ok: true, status: 200, text: async () => "",
      json: async () => {
        if (model === "html") throw new Error("Unexpected token <");
        return { choices: [{ message: { content: "fine" }, finish_reason: "stop" }] };
      },
    };
  };

  const result = await up(REQ, [
    { baseUrl: "https://one.test/v1", apiKey: "k", models: ["html"], name: "one" },
    { baseUrl: "https://two.test/v1", apiKey: "k", models: ["good"], name: "two" },
  ]);

  assert.equal(result.model, "good");
});

test("every model returning something useless reports a failure, not an empty answer", async (t) => {
  const realFetch = globalThis.fetch;
  t.after(() => (globalThis.fetch = realFetch));

  globalThis.fetch = async () => ({
    ok: true, status: 200, text: async () => "",
    json: async () => ({ choices: [{ message: { content: "" }, finish_reason: "stop" }] }),
  });

  const result = await up(REQ, [
    { baseUrl: "https://one.test/v1", apiKey: "k", models: ["a", "b"], name: "one" },
  ]);

  assert.equal(result.reply, undefined, "nothing worth sending");
  assert.ok(result.status >= 400, `should report a failure, got ${result.status}`);
  assert.match(result.message, /200 but empty/, "and it says why");
});

// --- a run of refusals is treated as a run ---------------------------------

test("each refusal in a row doubles the wait, and an answer clears it", () => {
  clearCooldowns();
  const U = "https://p/v1";

  const first = coolOff(U, "m", 429);
  const second = coolOff(U, "m", 429);
  const third = coolOff(U, "m", 429);

  assert.equal(second, first * 2);
  assert.equal(third, first * 4);

  cooledOffSuccessfully(U, "m");
  assert.equal(coolingFor(U, "m"), 0, "an answer also ends the current wait");
  assert.equal(coolOff(U, "m", 429), first, "and the next refusal starts over");
  clearCooldowns();
});

test("the wait is capped, so a dead model is retried hourly rather than never", () => {
  clearCooldowns();
  const U = "https://p/v1";
  let last = 0;
  for (let i = 0; i < 20; i++) last = coolOff(U, "m", 429);
  assert.equal(last, 60 * 60 * 1000, "an hour, not a week");
  clearCooldowns();
});

// --- the record must not get slower the longer you use it ------------------

test("day buckets are pruned, so a year of use costs what a week does", async () => {
  const { mkdtempSync, mkdirSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join, dirname } = await import("node:path");
  const { execFileSync } = await import("node:child_process");

  const home = mkdtempSync(join(tmpdir(), "opencc-prune-"));
  mkdirSync(join(home, ".opencc"));
  const here = dirname(new URL(import.meta.url).pathname);
  const script = join(home, "run.mjs");

  writeFileSync(script, [
    `import { writeFileSync } from "node:fs";`,
    `import { STATS_PATH } from "${join(here, "paths.js")}";`,
    `const day = 86400000, now = Date.now();`,
    `const lines = [];`,
    `for (let d = 400; d >= 0; d--) lines.push(JSON.stringify({ p: "https://p/v1", m: "m", k: "tools", s: 200, n: 1, t: now - d * day }));`,
    `writeFileSync(STATS_PATH, lines.join("\\n") + "\\n");`,
    `const { statsFor } = await import("${join(here, "stats.js")}");`,
    `const e = statsFor("https://p/v1", "m", "tools");`,
    `console.log(JSON.stringify({ ok: e.ok, buckets: Object.keys(e.days).length }));`,
  ].join("\n"));

  const out = JSON.parse(execFileSync(process.execPath, [script], { env: { ...process.env, HOME: home } }).toString());

  assert.equal(out.ok, 401, "every result still counts toward the totals");
  assert.ok(out.buckets <= 34, `only recent days are kept in detail, got ${out.buckets}`);
});

test("callUpstream does not re-serialise a request the caller already measured", async (t) => {
  const realFetch = globalThis.fetch;
  t.after(() => (globalThis.fetch = realFetch));
  stubFetch([200]);

  // A size nothing would compute by accident, passed in rather than measured.
  let seen = null;
  const result = await callUpstream(
    REQ,
    [{ baseUrl: "https://one.test/v1", apiKey: "k", models: ["m"], name: "one" }],
    true,
    { ...NO_STATS, record: (row) => { seen = row.chars; } },
    123456,
  );

  assert.equal(result.model, "m");
  assert.equal(seen, 123456, "the size it was handed, not one it worked out again");
});

// --- outcomes are counted, not listed --------------------------------------

test("a batch of identical outcomes is one line with a count", async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, readFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join, dirname } = await import("node:path");
  const { execFileSync } = await import("node:child_process");

  const home = mkdtempSync(join(tmpdir(), "opencc-batch-"));
  mkdirSync(join(home, ".opencc"));
  const here = dirname(new URL(import.meta.url).pathname);
  const script = join(home, "run.mjs");

  writeFileSync(script, [
    `import { record, flush, aggregate, meanMs } from "${join(here, "stats.js")}";`,
    `import { STATS_PATH } from "${join(here, "paths.js")}";`,
    `import { readFileSync } from "node:fs";`,
    `for (let i = 0; i < 200; i++) record({ baseUrl: "https://p/v1", model: "m", kind: "tools", status: 200, ms: 1500, chars: 9000 });`,
    `flush();`,
    `const file = readFileSync(STATS_PATH, "utf8");`,
    `const e = aggregate().get("https://p/v1\\u0000m\\u0000tools");`,
    `console.log(JSON.stringify({ lines: file.split("\\n").filter(Boolean).length, bytes: file.length, ok: e.ok, mean: meanMs(e), maxOk: e.maxOk }));`,
  ].join("\n"));

  const out = JSON.parse(execFileSync(process.execPath, [script], { env: { ...process.env, HOME: home } }).toString());

  assert.equal(out.lines, 1, "two hundred outcomes, one line");
  assert.ok(out.bytes < 200, `and it stays small: ${out.bytes} bytes`);
  assert.equal(out.ok, 200, "all of them counted");
  // A batch sums its time; folding must not multiply by the count again.
  assert.equal(out.mean, 1500, "the mean is the time recorded, not the total");
  assert.equal(out.maxOk, 9000);
});

test("lines written before batching still read correctly", async () => {
  const { mkdtempSync, mkdirSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join, dirname } = await import("node:path");
  const { execFileSync } = await import("node:child_process");

  const home = mkdtempSync(join(tmpdir(), "opencc-legacy-"));
  mkdirSync(join(home, ".opencc"));
  const here = dirname(new URL(import.meta.url).pathname);
  const script = join(home, "run.mjs");

  writeFileSync(script, [
    `import { writeFileSync } from "node:fs";`,
    `import { STATS_PATH } from "${join(here, "paths.js")}";`,
    `const t = Date.now();`,
    // one event per line, the shape opencc wrote before batching
    `writeFileSync(STATS_PATH, [`,
    `  JSON.stringify({ p: "https://p/v1", m: "m", k: "tools", s: 200, n: 1, t, ms: 800 }),`,
    `  JSON.stringify({ p: "https://p/v1", m: "m", k: "tools", s: 200, n: 1, t, ms: 1200 }),`,
    `  JSON.stringify({ p: "https://p/v1", m: "m", k: "tools", s: 429, n: 3, t }),`,
    `].join("\\n") + "\\n");`,
    `const { aggregate, meanMs } = await import("${join(here, "stats.js")}");`,
    `const e = aggregate().get("https://p/v1\\u0000m\\u0000tools");`,
    `console.log(JSON.stringify({ ok: e.ok, fail: e.fail, mean: meanMs(e) }));`,
  ].join("\n"));

  const out = JSON.parse(execFileSync(process.execPath, [script], { env: { ...process.env, HOME: home } }).toString());

  assert.equal(out.ok, 2);
  assert.equal(out.fail, 3, "n is still honoured on an old line");
  assert.equal(out.mean, 1000, "and its timings average rather than sum");
});

// --- a stray system turn must not land in the middle -----------------------

test("system turns inside messages are folded into the one at the front", () => {
  // A SessionStart hook makes Claude Code put a system-role turn after the
  // first user message, and its content is blocks rather than a string.
  // vLLM answers that with "System message must be at the beginning" and
  // rejects the whole request, so every system turn has to move to the front.
  const out = toOpenAIRequest({
    model: "c",
    system: "top level rules",
    messages: [
      { role: "user", content: [{ type: "text", text: "hello" }] },
      { role: "system", content: [{ type: "text", text: "hook output" }] },
      { role: "assistant", content: [{ type: "text", text: "hi" }] },
    ],
  }, "m", "https://x/v1", false);

  assert.deepEqual(out.messages.map((m) => m.role), ["system", "user", "assistant"]);
  assert.equal(out.messages[0].content, "top level rules\n\nhook output");
  // and it is the text, not the JSON of the block array
  assert.doesNotMatch(out.messages[0].content, /"type"/);
});

test("a system turn survives even with no top-level system field", () => {
  const out = toOpenAIRequest({
    model: "c",
    messages: [
      { role: "user", content: "hello" },
      { role: "system", content: "hook output" },
    ],
  }, "m", "https://x/v1", false);

  assert.deepEqual(out.messages.map((m) => m.role), ["system", "user"]);
  assert.equal(out.messages[0].content, "hook output");
});

// --- what models.dev knows -------------------------------------------------

// Both of these run in their own HOME, in their own process. loadCatalog
// writes its cache beside the config, and an in-process test overwrote the
// real one with its fixture.
const catalogProbe = async (body) => {
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { execFileSync } = await import("node:child_process");

  const home = mkdtempSync(join(tmpdir(), "opencc-md-"));
  const script = join(home, "run.mjs");
  writeFileSync(script, `
    import { loadCatalog, lookupModel, tooBigForCatalog } from ${JSON.stringify(new URL("./modelsdev.js", import.meta.url).href)};
    ${body}
  `);
  return JSON.parse(execFileSync(process.execPath, [script], { env: { ...process.env, HOME: home } }).toString());
};

test("a model is matched past the spelling a provider happens to use", async () => {
  const out = await catalogProbe(`
    const fake = {
      groq: { api: "https://api.groq.com/openai/v1", models: { "llama-3.3-70b": { limit: { context: 131072 }, cost: { input: 0.59, output: 0.79 }, tool_call: true } } },
      other: { api: "https://other.test/v1", models: { "llama-3.3-70b": { limit: { context: 8000 }, tool_call: false } } },
    };
    await loadCatalog({ force: true, fetchImpl: async () => ({ ok: true, json: async () => fake }) });
    const ctx = (url, name) => lookupModel(url, name)?.context ?? null;
    console.log(JSON.stringify({
      byHost: ctx("https://api.groq.com/openai/v1", "llama-3.3-70b"),
      byOtherHost: ctx("https://other.test/v1", "llama-3.3-70b"),
      viaProxy: ctx("https://proxy.example/zai", "llama-3.3-70b"),
      normalised: ctx("https://proxy.example/x", "Llama_3.3_70B"),
      vendorPrefix: ctx("https://proxy.example/x", "meta/llama-3.3-70b"),
      unknown: ctx("https://proxy.example/x", "nothing-like-this"),
    }));
  `);

  // The provider whose own URL matches answers first: the same name means
  // different things at two backends.
  assert.equal(out.byHost, 131072);
  assert.equal(out.byOtherHost, 8000);
  // An unknown host still gets an answer from whoever lists the name, which
  // is what makes this work behind a key-rotating proxy.
  assert.ok(out.viaProxy);
  // Punctuation, case and a vendor prefix carry no meaning in a model name.
  assert.ok(out.normalised, "normalised");
  assert.ok(out.vendorPrefix, "vendor prefix dropped");
  assert.equal(out.unknown, null);
});

test("the published window only ever rules a request out, never in", async () => {
  const out = await catalogProbe(`
    await loadCatalog({ force: true, fetchImpl: async () => ({ ok: true, json: async () => ({
      p: { api: "https://p.test/v1", models: { small: { limit: { context: 1000 } }, nolimit: { cost: { input: 1, output: 2 } } } },
    }) }) });
    const big = (name, chars) => tooBigForCatalog("https://p.test/v1", name, chars);
    console.log(JSON.stringify({
      inside: big("small", 4000), edge: big("small", 5000), over: big("small", 9000),
      noLimit: big("nolimit", 10000000), unknown: big("unknown-model", 10000000),
    }));
  `);

  // 1000 tokens at the generous 5 chars/token this uses is 5000 characters.
  assert.equal(out.inside, false, "comfortably inside");
  assert.equal(out.edge, false, "exactly at the edge is not over");
  assert.equal(out.over, true, "over even on the kindest reading");
  // Nothing published, nothing claimed.
  assert.equal(out.noLimit, false);
  assert.equal(out.unknown, false);
});

test("what a model has actually done outranks what the catalogue says", async () => {
  const { chooseOrder } = await import("./stats.js");
  const attempts = [
    { provider: { baseUrl: "https://a.test/v1" }, model: "tiny" },
    { provider: { baseUrl: "https://b.test/v1" }, model: "roomy" },
  ];
  // Every model looks equally good on the record, so only the size rule
  // can separate them.
  const blank = { ok: 5, fail: 0, statuses: {}, days: {}, totalMs: 0, timed: 0, maxOk: 0, minTooBig: Infinity };
  const catalogTooBig = (baseUrl) => baseUrl === "https://a.test/v1";

  const demoted = chooseOrder(attempts, "tools", {
    lookup: () => blank, lookupOther: () => null, rng: () => 0.5, chars: 50_000, catalogTooBig,
  });
  assert.equal(demoted.attempts[0].model, "roomy", "the one the catalogue rules out goes last");
  assert.equal(demoted.tooSmall, 1);

  // Once the model has taken a request this big, the catalogue is simply
  // wrong about it and is ignored from then on.
  const proven = { ...blank, maxOk: 60_000 };
  const kept = chooseOrder(attempts, "tools", {
    lookup: (baseUrl) => (baseUrl === "https://a.test/v1" ? proven : blank),
    lookupOther: () => null, rng: () => 0.5, chars: 50_000, catalogTooBig,
  });
  assert.equal(kept.tooSmall, 0, "a request this size already went through");

  // And with no catalogue at all the ordering is what it always was.
  const none = chooseOrder(attempts, "tools", {
    lookup: () => blank, lookupOther: () => null, rng: () => 0.5, chars: 50_000,
  });
  assert.equal(none.tooSmall, 0);
});

// --- the request log -------------------------------------------------------

test("a request log entry keeps the whole walk, and marks a fallback", async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { execFileSync } = await import("node:child_process");

  // Its own HOME: this writes a file beside the real record.
  const home = mkdtempSync(join(tmpdir(), "opencc-reqlog-"));
  const script = join(home, "run.mjs");
  const { writeFileSync } = await import("node:fs");
  writeFileSync(script, `
    import { logRequest, listRequests, clearRequests } from ${JSON.stringify(new URL("./reqlog.js", import.meta.url).href)};
    logRequest({ at: 1, model: "claude", kind: "tools", chars: 10, tools: 2,
      attempts: [{ provider: "a", model: "m1", status: 500, error: "x".repeat(900) }], status: 500, error: "all failed" });
    logRequest({ at: 2, model: "claude", kind: "tools", chars: 10, tools: 2,
      attempts: [{ provider: "a", model: "m1", status: 429 }, { provider: "b", model: "m2", status: 200 }], served: "b/m2" });
    logRequest({ at: 3, model: "claude", kind: "text", chars: 10, tools: 0,
      attempts: [{ provider: "b", model: "m2", status: 200 }], served: "b/m2" });
    const items = listRequests();
    console.log(JSON.stringify({
      order: items.map((r) => r.at),
      failed: items.filter((r) => !r.ok).length,
      fallbacks: items.filter((r) => r.fallback).map((r) => r.at),
      trimmed: items.find((r) => r.at === 1).attempts[0].error.length,
      cleared: (clearRequests(), listRequests().length),
    }));
  `);
  const out = JSON.parse(execFileSync(process.execPath, [script], { env: { ...process.env, HOME: home } }).toString());

  assert.deepEqual(out.order, [3, 2, 1], "newest first");
  assert.equal(out.failed, 1);
  // Served by the second model tried, not the first: the one thing in this
  // file worth finding quickly.
  assert.deepEqual(out.fallbacks, [2], "one attempt is not a fallback, two is");
  assert.ok(out.trimmed <= 401, "a long error is cut so the file stays small");
  assert.equal(out.cleared, 0);
});

test("a half-written line does not take the whole log listing down", async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, appendFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { execFileSync } = await import("node:child_process");

  const home = mkdtempSync(join(tmpdir(), "opencc-reqlog-torn-"));
  mkdirSync(join(home, ".opencc"), { recursive: true });
  // What a process killed mid-append leaves behind.
  appendFileSync(join(home, ".opencc", "requests.jsonl"),
    JSON.stringify({ at: 1, ok: true, attempts: [] }) + "\n" + '{"at":2,"ok":fal');

  const script = join(home, "run.mjs");
  writeFileSync(script, `
    import { listRequests } from ${JSON.stringify(new URL("./reqlog.js", import.meta.url).href)};
    console.log(JSON.stringify(listRequests().map((r) => r.at)));
  `);
  const out = JSON.parse(execFileSync(process.execPath, [script], { env: { ...process.env, HOME: home } }).toString());
  assert.deepEqual(out, [1], "the torn line is skipped, the good one still reads");
});

// --- the catalogue removes work, it does not replace the record ------------






// --- nothing to route to ---------------------------------------------------

test("with providers but no models, the answer says to pick one", async () => {
  // Adding providers first and models second is a normal way to set opencc
  // up. The old message blamed disabled providers for it, which sent you
  // looking for a switch that was already on.
  const out = await callUpstream(
    { model: "claude", messages: [{ role: "user", content: "hi" }] },
    [
      { name: "a", baseUrl: "https://a.test/v1", apiKey: "", models: [], disabled: false, disabledModels: [] },
      { name: "b", baseUrl: "https://b.test/v1", apiKey: "", models: [], disabled: false, disabledModels: [] },
    ],
    true,
    { order: () => ({ attempts: [], head: [] }), record() {}, coolOff() {}, settled() {} },
  );

  assert.equal(out.status, 503);
  assert.match(out.message, /^Pick a model first/);
  assert.match(out.message, /All 2 providers are set up/);
  assert.doesNotMatch(out.message, /disabled|switched off/, "they are not off, they are empty");
});

test("a provider switched off is reported as off, not as empty", async () => {
  const out = await callUpstream(
    { model: "claude", messages: [{ role: "user", content: "hi" }] },
    [{ name: "a", baseUrl: "https://a.test/v1", apiKey: "", models: ["m"], disabled: true, disabledModels: [] }],
    true,
    { order: () => ({ attempts: [], head: [] }), record() {}, coolOff() {}, settled() {} },
  );

  assert.equal(out.status, 503);
  assert.match(out.message, /switched off/);
  assert.doesNotMatch(out.message, /Pick a model/);
});

test("one provider reads as singular", async () => {
  const out = await callUpstream(
    { model: "claude", messages: [{ role: "user", content: "hi" }] },
    [{ name: "a", baseUrl: "https://a.test/v1", apiKey: "", models: [], disabled: false, disabledModels: [] }],
    true,
    { order: () => ({ attempts: [], head: [] }), record() {}, coolOff() {}, settled() {} },
  );
  assert.match(out.message, /The provider is set up/);
});

// --- provider ranking ------------------------------------------------------

// An aggregate as stats.js actually builds one. belief() reads the decayed
// day buckets rather than the running totals, so a fixture with an empty
// `days` is an untried model however big its ok/fail look.
function record(ok, fail) {
  const today = Math.floor(Date.now() / 86400000);
  return {
    ok, fail, statuses: {}, totalMs: 0, timed: 0, maxOk: 0, minTooBig: Infinity,
    days: { [today]: { ok, fail, weighted: fail } },
  };
}

test("ranking separates models the record cannot tell apart", async () => {
  const { chooseOrder } = await import("./stats.js");
  const attempts = [
    { provider: { baseUrl: "https://slowpoke/v1" }, model: "m" },
    { provider: { baseUrl: "https://favourite/v1" }, model: "m" },
  ];
  // Identical records, so only the ranking can order them. The counts have to
  // live in a day bucket: that is what belief() decays and reads.
  const same = record(20, 2);
  const rank = ["https://favourite/v1", "https://slowpoke/v1"];

  const out = chooseOrder(attempts, "tools", {
    lookup: () => same, lookupOther: () => null, rng: () => 0.5, rank,
  });
  assert.equal(out.attempts[0].provider.baseUrl, "https://favourite/v1");

  // and with no ranking at all nothing is added, so the order is whatever the
  // draw said — here a tie, broken by position.
  const none = chooseOrder(attempts, "tools", {
    lookup: () => same, lookupOther: () => null, rng: () => 0.5,
  });
  assert.equal(none.attempts[0].provider.baseUrl, "https://slowpoke/v1", "first in, no preference applied");
});

test("ranking cannot float a model that keeps failing", async () => {
  const { chooseOrder } = await import("./stats.js");
  const attempts = [
    { provider: { baseUrl: "https://broken/v1" }, model: "m" },
    { provider: { baseUrl: "https://works/v1" }, model: "m" },
  ];
  const records = {
    "https://broken/v1": record(0, 40),
    "https://works/v1": record(40, 0),
  };
  // The broken one is ranked top. It must still lose.
  const rank = ["https://broken/v1", "https://works/v1"];

  for (const rng of [() => 0.1, () => 0.5, () => 0.9]) {
    const out = chooseOrder(attempts, "tools", {
      lookup: (baseUrl) => records[baseUrl], lookupOther: () => null, rng, rank,
    });
    assert.equal(out.attempts[0].provider.baseUrl, "https://works/v1",
      "the record outranks the ranking, whatever the draw");
  }
});

test("a provider you have not ranked sorts below the ones you have", async () => {
  const { preferenceOf } = await import("./stats.js");
  const prefer = preferenceOf(["https://a/v1", "https://b/v1", "https://c/v1"]);

  assert.ok(prefer("https://a/v1") > prefer("https://b/v1"), "best gets the most");
  assert.ok(prefer("https://b/v1") > prefer("https://c/v1"));
  assert.equal(prefer("https://c/v1"), 0, "last ranked gets nothing");
  // A provider added after you ranked must not jump the queue.
  assert.equal(prefer("https://brand-new/v1"), 0);

  // One provider, or none, is not a ranking.
  assert.equal(preferenceOf(["https://a/v1"])("https://a/v1"), 0);
  assert.equal(preferenceOf([])("https://a/v1"), 0);
});

test("the ranking survives a round trip through the config file", async () => {
  const { mkdtempSync, writeFileSync, readFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { execFileSync } = await import("node:child_process");

  const home = mkdtempSync(join(tmpdir(), "opencc-rank-"));
  const script = join(home, "run.mjs");
  const here = new URL(".", import.meta.url).pathname;
  writeFileSync(script, `
    import { writeStoredConfig, readStoredConfig } from "${join(here, "configStore.js")}";
    import { rankFromEnv } from "${join(here, "config.js")}";
    const providers = [
      { name: "a", baseUrl: "https://a.test/v1", apiKey: "", models: ["m"] },
      { name: "b", baseUrl: "https://b.test/v1", apiKey: "", models: ["m"] },
    ];
    writeStoredConfig({ providers, port: "9753", rank: ["https://b.test/v1", "https://a.test/v1"] });
    const back = rankFromEnv(readStoredConfig());
    writeStoredConfig({ providers, port: "9753" });
    console.log(JSON.stringify({ back, cleared: rankFromEnv(readStoredConfig()) }));
  `);
  const out = JSON.parse(execFileSync(process.execPath, [script], { env: { ...process.env, HOME: home } }).toString());

  assert.deepEqual(out.back, ["https://b.test/v1", "https://a.test/v1"]);
  // Not written at all when there is none, rather than written empty: an
  // empty key would read back as a preference for nothing.
  assert.deepEqual(out.cleared, []);
});

test("short sessions still bound the request log", async () => {
  // The prune counter resets with the process, so a run that serves fewer
  // than KEEP requests used to never prune at all. Twenty runs of five
  // requests each must still leave the file at the cap.
  const { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, readFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { execFileSync } = await import("node:child_process");

  const home = mkdtempSync(join(tmpdir(), "opencc-prune-"));
  mkdirSync(join(home, ".opencc"), { recursive: true });
  const file = join(home, ".opencc", "requests.jsonl");

  // Start well over the cap, as a long-running install would.
  const seed = [];
  for (let i = 0; i < 900; i++) {
    seed.push(JSON.stringify({ at: i, ok: true, attempts: [], chars: 0, tools: 0, kind: "text" }));
  }
  writeFileSync(file, seed.join("\n") + "\n");

  const script = join(home, "run.mjs");
  writeFileSync(script, `
    import { logRequest, listRequests, KEEP } from ${JSON.stringify(new URL("./reqlog.js", import.meta.url).href)};
    for (let i = 0; i < 5; i++) logRequest({ at: Date.now() + i, model: "m", kind: "text", chars: 1, tools: 0, served: "a/b" });
    console.log(JSON.stringify({ shown: listRequests().length, keep: KEEP }));
  `);

  // Each run is its own process, which is the case that used to leak.
  let out;
  for (let run = 0; run < 3; run++) {
    out = JSON.parse(execFileSync(process.execPath, [script], { env: { ...process.env, HOME: home } }).toString());
  }

  // Bounded, not exact: a prune trims to KEEP and the writes after it in the
  // same run append past that. Rewriting the whole file on every append to
  // hold it at exactly KEEP would cost far more than it is worth. What must
  // never happen is unbounded growth, and 900 seeded lines coming back under
  // two caps is that.
  const lines = readFileSync(file, "utf8").split("\n").filter(Boolean).length;
  assert.ok(lines <= out.keep * 2, `file holds ${lines}, bound is ${out.keep * 2}`);
  assert.ok(lines < 900, "the 900 it started with were trimmed");
  assert.equal(out.shown, out.keep, "and the panel shows at most the cap");

  // and the newest write survived the trim
  const newest = JSON.parse(readFileSync(file, "utf8").split("\n").filter(Boolean).pop());
  assert.equal(newest.model, "m");
});

// --- the test timeout ------------------------------------------------------

test("the test timeout is read, clamped, and defaults to ten seconds", async () => {
  const { testTimeoutFromEnv, DEFAULT_TEST_TIMEOUT } = await import("./config.js");

  assert.equal(DEFAULT_TEST_TIMEOUT, 10);
  assert.equal(testTimeoutFromEnv({}), 10, "absent means the default");
  assert.equal(testTimeoutFromEnv({ TEST_TIMEOUT: "25" }), 25);
  assert.equal(testTimeoutFromEnv({ TEST_TIMEOUT: "2.6" }), 3, "whole seconds");

  // Nonsense must not turn into no timeout at all, which is the one outcome
  // worth protecting against: a test that never gives up.
  assert.equal(testTimeoutFromEnv({ TEST_TIMEOUT: "abc" }), 10);
  assert.equal(testTimeoutFromEnv({ TEST_TIMEOUT: "" }), 10);
  assert.equal(testTimeoutFromEnv({ TEST_TIMEOUT: "0" }), 1, "never zero");
  assert.equal(testTimeoutFromEnv({ TEST_TIMEOUT: "-5" }), 1);
  assert.equal(testTimeoutFromEnv({ TEST_TIMEOUT: "99999" }), 300, "and never unbounded");
});

test("the test timeout survives the config file, and the default is not written", async () => {
  const { mkdtempSync, writeFileSync, readFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { execFileSync } = await import("node:child_process");

  const home = mkdtempSync(join(tmpdir(), "opencc-ttl-"));
  const here = new URL(".", import.meta.url).pathname;
  const script = join(home, "run.mjs");
  writeFileSync(script, `
    import { writeStoredConfig, readStoredConfig } from "${join(here, "configStore.js")}";
    import { testTimeoutFromEnv } from "${join(here, "config.js")}";
    const providers = [{ name: "a", baseUrl: "https://a.test/v1", apiKey: "", models: ["m"] }];
    writeStoredConfig({ providers, port: "9753", testTimeout: 30 });
    const changed = { value: testTimeoutFromEnv(readStoredConfig()), written: readStoredConfig().TEST_TIMEOUT };
    writeStoredConfig({ providers, port: "9753", testTimeout: 10 });
    const asDefault = { value: testTimeoutFromEnv(readStoredConfig()), written: readStoredConfig().TEST_TIMEOUT };
    console.log(JSON.stringify({ changed, asDefault }));
  `);
  const out = JSON.parse(execFileSync(process.execPath, [script], { env: { ...process.env, HOME: home } }).toString());

  assert.equal(out.changed.value, 30);
  assert.equal(out.changed.written, "30");
  // Back at the default it leaves the file, so the config stays a record of
  // what you changed rather than of every setting that exists.
  assert.equal(out.asDefault.value, 10);
  assert.equal(out.asDefault.written, undefined);
});
