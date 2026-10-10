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
    BIG_MODEL: "gpt-4o",
    SMALL_MODEL: "gpt-4o-mini",
  });

  assert.equal(providers.length, 1);
  assert.equal(providers[0].baseUrl, "https://api.openai.com/v1", "trailing slash stripped");
  assert.equal(displayName(providers[0]), "api.openai.com");
});

test("reads numbered providers in order, keeps gaps, drops incomplete ones", () => {
  const providers = providersFromEnv({
    OPENAI_BASE_URL: "https://one.test/v1",
    BIG_MODEL: "a",
    // no _2 at all — must not stop the scan at the gap
    OPENAI_BASE_URL_3: "http://localhost:11434/v1",
    BIG_MODEL_3: "llama3",
    // _4 has a URL but no model, so it can never serve a request
    OPENAI_BASE_URL_4: "https://four.test/v1",
  });

  assert.deepEqual(
    providers.map((p) => p.baseUrl),
    ["https://one.test/v1", "http://localhost:11434/v1"],
  );
  assert.equal(providers[1].apiKey, "", "a keyless local backend is valid");
  assert.deepEqual(providers[0].bigModels, ["a"], "a single model parses as a one-item list");
});

test("names a provider by its PROVIDER_NAME, falling back to the host", () => {
  const providers = providersFromEnv({
    PROVIDER_NAME: "work openrouter",
    OPENAI_BASE_URL: "https://openrouter.ai/api/v1",
    BIG_MODEL: "openai/gpt-4o",
    OPENAI_BASE_URL_2: "https://openrouter.ai/api/v1",
    BIG_MODEL_2: "openai/gpt-4o",
  });

  assert.equal(displayName(providers[0]), "work openrouter", "a set name wins");
  assert.equal(displayName(providers[1]), "openrouter.ai", "an unnamed one falls back to its host");
});

// callUpstream reads and writes the shared stats file by default, which would
// both pollute the real one and make these tests depend on each other's
// history. Every call here goes through this instead.
const NO_STATS = { lookup: () => null, record: () => {} };
const up = (req, providers, streaming = true, caps = null) =>
  callUpstream(req, providers, streaming, caps, NO_STATS);

const REQ = { model: "claude-sonnet-4", messages: [{ role: "user", content: "hi" }], max_tokens: 16 };

function stubFetch(responders) {
  const seen = [];
  globalThis.fetch = async (url, init) => {
    seen.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    const responder = responders[seen.length - 1];
    if (typeof responder === "string") throw new Error(responder);
    return { ok: responder < 400, status: responder, text: async () => `status ${responder}` };
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
    { baseUrl: "https://one.test/v1", apiKey: "k1", bigModels: ["big-1"], smallModels: [], name: "one" },
    { baseUrl: "https://two.test/v1", apiKey: "k2", bigModels: ["big-2"], smallModels: [], name: "two" },
    { baseUrl: "https://three.test/v1", apiKey: "", bigModels: ["big-3"], smallModels: [], name: "three" },
  ]);

  assert.equal(result.provider.name, "three");
  assert.equal(result.model, "big-3", "uses the winning provider's own model name");
  assert.equal(seen.length, 3, "stops as soon as one succeeds");
  assert.equal(seen[0].headers.Authorization, "Bearer k1");
  assert.equal(seen[2].headers.Authorization, undefined, "no auth header when the key is blank");
});

test("routes background requests to each provider's small models", async (t) => {
  const realFetch = globalThis.fetch;
  t.after(() => (globalThis.fetch = realFetch));

  // 429 rather than 500: a 5xx is retried on the same model, which would
  // make this test about retrying instead of about tier routing.
  const seen = stubFetch([429, 200]);

  await up({ ...REQ, model: "claude-3-5-haiku-20241022" }, [
    { baseUrl: "https://one.test/v1", apiKey: "k", bigModels: ["big-1"], smallModels: ["small-1"], name: "one" },
    { baseUrl: "https://two.test/v1", apiKey: "k", bigModels: ["big-2"], smallModels: [], name: "two" },
  ]);

  assert.equal(seen[0].body.model, "small-1");
  assert.equal(seen[1].body.model, "big-2", "falls back to the big model when no small one is set");
});

test("reports the last error when every provider fails", async (t) => {
  const realFetch = globalThis.fetch;
  t.after(() => (globalThis.fetch = realFetch));

  stubFetch([429, 402]);

  const result = await up(REQ, [
    { baseUrl: "https://one.test/v1", apiKey: "k", bigModels: ["big-1"], smallModels: [], name: "one" },
    { baseUrl: "https://two.test/v1", apiKey: "k", bigModels: ["big-2"], smallModels: [], name: "two" },
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

import { toAnthropicResponse } from "./translate.js";
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

test("parses a comma-separated model list in priority order", () => {
  const [p] = providersFromEnv({
    OPENAI_BASE_URL: "https://one.test/v1",
    BIG_MODEL: "first, second ,third",
    SMALL_MODEL: " cheap-a , cheap-b ",
  });

  assert.deepEqual(p.bigModels, ["first", "second", "third"]);
  assert.deepEqual(p.smallModels, ["cheap-a", "cheap-b"]);
});

test("tries each model of a provider before moving to the next provider", async (t) => {
  const realFetch = globalThis.fetch;
  t.after(() => (globalThis.fetch = realFetch));

  // first two models of provider one fail, its third works
  const seen = stubFetch([429, 429, 200]);

  const result = await up(REQ, [
    { baseUrl: "https://one.test/v1", apiKey: "k", bigModels: ["m1", "m2", "m3"], smallModels: [], name: "one" },
    { baseUrl: "https://two.test/v1", apiKey: "k", bigModels: ["other"], smallModels: [], name: "two" },
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
    { baseUrl: "https://one.test/v1", apiKey: "k", bigModels: ["m1", "m2"], smallModels: [], name: "one" },
    { baseUrl: "https://two.test/v1", apiKey: "k", bigModels: ["m3"], smallModels: [], name: "two" },
  ]);

  assert.equal(result.provider.name, "two");
  assert.equal(result.model, "m3");
  assert.deepEqual(seen.map((s) => s.url), [
    "https://one.test/v1/chat/completions",
    "https://one.test/v1/chat/completions",
    "https://two.test/v1/chat/completions",
  ]);
});

test("background requests walk the small-model list in order", async (t) => {
  const realFetch = globalThis.fetch;
  t.after(() => (globalThis.fetch = realFetch));

  const seen = stubFetch([429, 200]);

  await up({ ...REQ, model: "claude-3-5-haiku" }, [
    { baseUrl: "https://one.test/v1", apiKey: "k", bigModels: ["big"], smallModels: ["cheap-a", "cheap-b"], name: "one" },
  ]);

  assert.deepEqual(seen.map((s) => s.body.model), ["cheap-a", "cheap-b"]);
});

// --- disabling a provider -------------------------------------------------

test("reads PROVIDER_DISABLED and keeps the provider in place", () => {
  const providers = providersFromEnv({
    OPENAI_BASE_URL: "https://one.test/v1",
    BIG_MODEL: "m1",
    PROVIDER_DISABLED_2: "true",
    OPENAI_BASE_URL_2: "https://two.test/v1",
    BIG_MODEL_2: "m2",
    OPENAI_BASE_URL_3: "https://three.test/v1",
    BIG_MODEL_3: "m3",
  });

  assert.deepEqual(providers.map((p) => p.disabled), [false, true, false]);
  assert.equal(providers[1].baseUrl, "https://two.test/v1", "it keeps its settings, not deleted");
});

test("a disabled provider is skipped without shifting the others", async (t) => {
  const realFetch = globalThis.fetch;
  t.after(() => (globalThis.fetch = realFetch));

  const seen = stubFetch([200]);

  const result = await up(REQ, [
    { baseUrl: "https://one.test/v1", apiKey: "k", bigModels: ["m1"], smallModels: [], name: "one", disabled: true },
    { baseUrl: "https://two.test/v1", apiKey: "k", bigModels: ["m2"], smallModels: [], name: "two" },
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
    { baseUrl: "https://one.test/v1", apiKey: "k", bigModels: ["m1"], smallModels: [], name: "one", disabled: true },
  ]);

  assert.equal(result.upstream, undefined);
  assert.equal(result.status, 503);
  assert.match(result.message, /all 1 are disabled/);
  assert.equal(seen.length, 0);
});

// --- global streaming switch ----------------------------------------------

test("streaming off asks upstream for a complete reply", async (t) => {
  const realFetch = globalThis.fetch;
  t.after(() => (globalThis.fetch = realFetch));

  const seen = stubFetch([200, 200]);
  const providers = [
    { baseUrl: "https://one.test/v1", apiKey: "k", bigModels: ["m1"], smallModels: [], name: "one" },
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
    { baseUrl: "https://one.test/v1", apiKey: "k", bigModels: ["m1"], smallModels: [], name: "one" },
    { baseUrl: "https://two.test/v1", apiKey: "k", bigModels: ["m2"], smallModels: [], name: "two" },
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
    { baseUrl: "https://one.test/v1", apiKey: "k", bigModels: ["m1"], smallModels: [], name: "one" },
    { baseUrl: "https://two.test/v1", apiKey: "k", bigModels: ["m2"], smallModels: [], name: "two" },
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
    { baseUrl: "https://one.test/v1", apiKey: "k", bigModels: ["m1"], smallModels: [], name: "one" },
    { baseUrl: "https://two.test/v1", apiKey: "k", bigModels: ["m2"], smallModels: [], name: "two" },
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
    { baseUrl: "https://one.test/v1", apiKey: "k", bigModels: ["m1"], smallModels: [], name: "one" },
    { baseUrl: "https://two.test/v1", apiKey: "k", bigModels: ["m2"], smallModels: [], name: "two" },
  ]);

  assert.equal(result.provider.name, "two");
  assert.equal(seen.length, 2);
});

test("a 400 is never retried", async (t) => {
  const realFetch = globalThis.fetch;
  t.after(() => (globalThis.fetch = realFetch));

  const seen = stubFetch([400, 200]);

  const result = await up(REQ, [
    { baseUrl: "https://one.test/v1", apiKey: "k", bigModels: ["m1"], smallModels: [], name: "one" },
    { baseUrl: "https://two.test/v1", apiKey: "k", bigModels: ["m2"], smallModels: [], name: "two" },
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
  const provider = { baseUrl: "https://one.test/v1", apiKey: "k", bigModels: ["m1"], smallModels: [], name: "one" };

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

// --- capability-aware routing ---------------------------------------------

import { requirementsOf, canServe } from "./capabilities.js";

test("works out what a request needs", () => {
  assert.deepEqual(requirementsOf({ messages: [{ role: "user", content: "hi" }] }), {
    tools: false, vision: false, documents: false,
  });

  assert.equal(requirementsOf({ messages: [], tools: [{ name: "Read" }] }).tools, true);
  assert.equal(requirementsOf({ messages: [], tools: [] }).tools, false, "an empty array needs nothing");

  const withImage = {
    messages: [{ role: "user", content: [
      { type: "text", text: "what is this" },
      { type: "image", source: { media_type: "image/png", data: "x" } },
    ] }],
  };
  assert.equal(requirementsOf(withImage).vision, true);

  const withPdf = {
    messages: [{ role: "user", content: [{ type: "document", source: { data: "x" } }] }],
  };
  assert.equal(requirementsOf(withPdf).documents, true);
});

test("an undetected model is allowed through, a known-incapable one is not", () => {
  const needsVision = { tools: false, vision: true, documents: false };
  assert.equal(canServe(null, needsVision), true, "unknown means untested, not incapable");
  assert.equal(canServe({ vision: undefined }, needsVision), true);
  assert.equal(canServe({ vision: false }, needsVision), false);
  assert.equal(canServe({ vision: true }, needsVision), true);
  assert.equal(canServe({ vision: false }, { tools: false, vision: false, documents: false }), true,
    "no image in the request, so vision doesn't matter");
});

test("an image request skips models known to lack vision", async (t) => {
  const realFetch = globalThis.fetch;
  t.after(() => (globalThis.fetch = realFetch));

  const seen = stubFetch([200]);
  const providers = [
    { baseUrl: "https://blind.test/v1", apiKey: "k", bigModels: ["text-only"], smallModels: [], name: "blind" },
    { baseUrl: "https://seeing.test/v1", apiKey: "k", bigModels: ["vision-model"], smallModels: [], name: "seeing" },
  ];
  const caps = {
    "https://blind.test/v1|text-only": { vision: false, tools: true },
    "https://seeing.test/v1|vision-model": { vision: true, tools: true },
  };
  const imageReq = {
    ...REQ,
    messages: [{ role: "user", content: [{ type: "image", source: { media_type: "image/png", data: "x" } }] }],
  };

  const result = await up(imageReq, providers, true, caps);
  assert.equal(result.provider.name, "seeing");
  assert.equal(seen.length, 1, "the blind model is never called");
});

test("nothing capable gives a 503 naming what was needed", async (t) => {
  const realFetch = globalThis.fetch;
  t.after(() => (globalThis.fetch = realFetch));

  const seen = stubFetch([]);
  const providers = [
    { baseUrl: "https://blind.test/v1", apiKey: "k", bigModels: ["text-only"], smallModels: [], name: "blind" },
  ];
  const caps = { "https://blind.test/v1|text-only": { vision: false } };
  const imageReq = {
    ...REQ,
    messages: [{ role: "user", content: [{ type: "image", source: { media_type: "image/png", data: "x" } }] }],
  };

  const result = await up(imageReq, providers, true, caps);
  assert.equal(result.status, 503);
  assert.match(result.message, /needs images/);
  assert.match(result.message, /blind\/text-only/);
  assert.equal(seen.length, 0, "no request is sent at all");
});

// --- capability probing ---------------------------------------------------

import { probeVision, fetchCatalogue, detectCapabilities } from "./capabilities.js";

function stubStatuses(statuses) {
  const seen = [];
  globalThis.fetch = async (url, init) => {
    const status = statuses[seen.length] ?? 200;
    seen.push({ url, body: JSON.parse(init.body) });
    if (status < 400) {
      return { ok: true, status, json: async () => ({ choices: [{ message: { content: "ok" } }] }) };
    }
    return { ok: false, status, text: async () => `status ${status}` };
  };
  return seen;
}

test("a rate-limited model is left unknown, not marked incapable", async (t) => {
  const realFetch = globalThis.fetch;
  t.after(() => (globalThis.fetch = realFetch));

  // 429 throughout. It sits in the 4xx range but is purely load, so
  // concluding "no vision" from it would permanently route images away from a
  // model that handles them.
  const seen = stubStatuses([429, 429, 429]);
  assert.equal(await probeVision({ baseUrl: "https://x.test/v1", apiKey: "k" }, "m", 5000), undefined);
  assert.equal(seen.length, 3, "three attempts, then unknown rather than a verdict");
});

test("a real rejection is conclusive once the plain request succeeds", async (t) => {
  const realFetch = globalThis.fetch;
  t.after(() => (globalThis.fetch = realFetch));

  // image -> 400, control -> 200, then the negative is confirmed with a
  // second image request that also fails.
  const seen = stubStatuses([400, 200, 400]);
  assert.equal(await probeVision({ baseUrl: "https://x.test/v1", apiKey: "k" }, "m", 5000), false);
  assert.equal(seen.length, 3);
  assert.equal(JSON.stringify(seen[0].body).includes("image_url"), true, "first carried the image");
  assert.equal(JSON.stringify(seen[1].body).includes("image_url"), false, "second was the control");
  assert.equal(JSON.stringify(seen[2].body).includes("image_url"), true, "third re-tested the feature");
});

test("a 400 on both requests is inconclusive, not a capability answer", async (t) => {
  const realFetch = globalThis.fetch;
  t.after(() => (globalThis.fetch = realFetch));

  // The plain request fails too, so the image was never shown to be the cause.
  stubStatuses([400, 400]);
  assert.equal(await probeVision({ baseUrl: "https://x.test/v1", apiKey: "k" }, "m", 5000), undefined);
});

test("accepting an image is enough to conclude vision", async (t) => {
  const realFetch = globalThis.fetch;
  t.after(() => (globalThis.fetch = realFetch));

  stubStatuses([200]);
  assert.equal(await probeVision({ baseUrl: "https://x.test/v1", apiKey: "k" }, "m", 5000), true);
});


test("a routing variant falls back to the base model in the catalogue", async (t) => {
  const realFetch = globalThis.fetch;
  t.after(() => (globalThis.fetch = realFetch));

  // OpenRouter publishes "qwen/qwen3.8-27b" but serves "qwen/qwen3.8-27b:free",
  // and the variant is absent from the catalogue.
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      data: [{
        id: "qwen/qwen3.8-27b",
        architecture: { input_modalities: ["text", "image", "video"] },
        supported_parameters: ["tools", "temperature"],
        context_length: 1000000,
      }],
    }),
  });

  const provider = { baseUrl: "https://openrouter.test/v1", apiKey: "k" };
  const catalogue = await fetchCatalogue(provider);
  const caps = await detectCapabilities(provider, "qwen/qwen3.8-27b:free", catalogue);

  assert.equal(caps.tools, true);
  assert.equal(caps.vision, true, "resolved without probing the variant");
  assert.equal(caps.contextLength, 1000000);
  assert.equal(caps.source, "catalogue");
});


test("a 403 is never a capability answer, even an HTML one", async (t) => {
  const realFetch = globalThis.fetch;
  t.after(() => (globalThis.fetch = realFetch));

  // Google's frontend answers an over-quota probe with a 403 HTML page. Read
  // as a verdict it marked gemini-3.5-flash — which serves tool calls all
  // day — as tools=false, taking it out of rotation for every request.
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return { ok: false, status: 403, text: async () => "<!DOCTYPE html><html><title>Error 403</title>" };
  };

  assert.equal(await probeVision({ baseUrl: "https://x.test/v1", apiKey: "k" }, "m", 5000), undefined);
  assert.equal(calls, 1, "403 isn't load either, so it isn't retried — just inconclusive");
});

test("a flaky rejection does not become a negative", async (t) => {
  const realFetch = globalThis.fetch;
  t.after(() => (globalThis.fetch = realFetch));

  // image -> 400, control -> 200, confirmation -> 200. The first rejection
  // didn't hold up, so the answer is yes rather than no.
  const seen = stubStatuses([400, 200, 200]);
  assert.equal(await probeVision({ baseUrl: "https://x.test/v1", apiKey: "k" }, "m", 5000), true);
  assert.equal(seen.length, 3);
});

// --- parking a single model ------------------------------------------------

test("a disabled model keeps its place but never gets a turn", async (t) => {
  const realFetch = globalThis.fetch;
  t.after(() => (globalThis.fetch = realFetch));

  const seen = stubFetch([200]);
  const result = await up(REQ, [{
    baseUrl: "https://one.test/v1", apiKey: "k", name: "one",
    bigModels: ["m1", "m2", "m3"], smallModels: [],
    disabledModels: ["m1"],
  }]);

  assert.equal(result.model, "m2", "m1 is skipped, order otherwise kept");
  assert.deepEqual(seen.map((s) => s.body.model), ["m2"]);
});

test("parking applies to both tiers, and an absent list changes nothing", () => {
  const provider = {
    baseUrl: "https://one.test/v1", bigModels: ["big-1", "shared"], smallModels: ["shared", "small-1"],
    disabledModels: ["shared"],
  };
  assert.deepEqual(pickModels("claude-sonnet-4-5", provider), ["big-1"]);
  assert.deepEqual(pickModels("claude-3-5-haiku", provider), ["small-1"]);

  // providers written by an older version have no such field
  const old = { baseUrl: "x", bigModels: ["a", "b"], smallModels: [] };
  assert.deepEqual(pickModels("claude-sonnet-4-5", old), ["a", "b"]);
});

test("PROVIDER_MODELS_DISABLED round-trips through the config", () => {
  const [p] = providersFromEnv({
    OPENAI_BASE_URL: "https://one.test/v1",
    BIG_MODEL: "a, b, c",
    PROVIDER_MODELS_DISABLED: "b",
  });
  assert.deepEqual(p.bigModels, ["a", "b", "c"], "the list keeps every model");
  assert.deepEqual(p.disabledModels, ["b"]);
  assert.deepEqual(pickModels("claude-sonnet-4-5", p), ["a", "c"]);
});

// --- learning from what has worked ----------------------------------------

import { kindOf, reliability, orderByReliability } from "./stats.js";

test("a request is classified by the most specific thing it needs", () => {
  assert.equal(kindOf({ tools: false, vision: false }), "text");
  assert.equal(kindOf({ tools: true, vision: false }), "tools");
  assert.equal(kindOf({ tools: false, vision: true }), "image");
  assert.equal(kindOf({ tools: true, vision: true }), "image", "an image request is an image request");
});

test("a thin record is no record — one bad afternoon shouldn't reorder anything", () => {
  assert.equal(reliability(null), null);
  assert.equal(reliability({ ok: 0, fail: 3 }), null, "under the attempt threshold");
  assert.equal(reliability({ ok: 0, fail: 4 }), 0, "at the threshold it counts");
  assert.equal(reliability({ ok: 9, fail: 1 }), 0.9);
});

const attempt = (name, model) => ({ provider: { baseUrl: "https://" + name + "/v1", name }, model });

test("a model that keeps failing this kind of request is tried last", () => {
  const attempts = [attempt("one", "m1"), attempt("two", "m2"), attempt("three", "m3")];
  const lookup = (baseUrl) =>
    baseUrl.includes("one") ? { ok: 0, fail: 9 } : { ok: 9, fail: 1 };

  const { attempts: order, demoted } = orderByReliability(attempts, "tools", lookup);
  assert.deepEqual(order.map((a) => a.model), ["m2", "m3", "m1"], "m1 moved to the back, rest untouched");
  assert.deepEqual(demoted.map((d) => d.model), ["m1"]);
});

test("models are never dropped, and a clean sheet keeps the configured order", () => {
  const attempts = [attempt("one", "m1"), attempt("two", "m2")];

  // nothing known about either
  const { attempts: a1, demoted: d1 } = orderByReliability(attempts, "text", () => null);
  assert.deepEqual(a1.map((a) => a.model), ["m1", "m2"]);
  assert.deepEqual(d1, []);

  // both failing: reordering would be pointless, so leave it alone
  const { attempts: a2, demoted: d2 } = orderByReliability(attempts, "text", () => ({ ok: 0, fail: 9 }));
  assert.deepEqual(a2.map((a) => a.model), ["m1", "m2"]);
  assert.deepEqual(d2, [], "no point shuffling when everything is equally bad");
});

test("stats are per kind — failing at images doesn't demote a model for text", () => {
  const attempts = [attempt("one", "m1"), attempt("two", "m2")];
  const lookup = (baseUrl, model, kind) =>
    baseUrl.includes("one") && kind === "image" ? { ok: 0, fail: 9 } : { ok: 9, fail: 1 };

  assert.deepEqual(orderByReliability(attempts, "image", lookup).attempts.map((a) => a.model), ["m2", "m1"]);
  assert.deepEqual(orderByReliability(attempts, "text", lookup).attempts.map((a) => a.model), ["m1", "m2"]);
});
