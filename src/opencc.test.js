// Run with: npm test
import test from "node:test";
import assert from "node:assert/strict";
import { providersFromEnv, displayName } from "./config.js";
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

  const result = await callUpstream(REQ, [
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

  await callUpstream({ ...REQ, model: "claude-3-5-haiku-20241022" }, [
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

  const result = await callUpstream(REQ, [
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

  const result = await callUpstream(REQ, [
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

  const result = await callUpstream(REQ, [
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

  await callUpstream({ ...REQ, model: "claude-3-5-haiku" }, [
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

  const result = await callUpstream(REQ, [
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

  const result = await callUpstream(REQ, [
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

  const on = await callUpstream({ ...REQ, stream: true }, providers, true);
  assert.equal(seen[0].body.stream, true, "streaming on: upstream streams");
  assert.equal(on.streamed, true);

  const off = await callUpstream({ ...REQ, stream: true }, providers, false);
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

test("retries a 5xx once on the same model before moving on", async (t) => {
  const realFetch = globalThis.fetch;
  t.after(() => (globalThis.fetch = realFetch));

  const seen = stubFetch([503, 200]);

  const result = await callUpstream(REQ, [
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

  const result = await callUpstream(REQ, [
    { baseUrl: "https://one.test/v1", apiKey: "k", bigModels: ["m1"], smallModels: [], name: "one" },
    { baseUrl: "https://two.test/v1", apiKey: "k", bigModels: ["m2"], smallModels: [], name: "two" },
  ]);

  assert.equal(result.provider.name, "two");
  assert.deepEqual(seen.map((s) => s.body.model), ["m1", "m1", "m2"]);
});

test("does not retry a 429, and does not retry an unreachable host", async (t) => {
  const realFetch = globalThis.fetch;
  t.after(() => (globalThis.fetch = realFetch));

  const seen = stubFetch([429, "connect ECONNREFUSED", 200]);

  const result = await callUpstream(REQ, [
    { baseUrl: "https://one.test/v1", apiKey: "k", bigModels: ["m1"], smallModels: [], name: "one" },
    { baseUrl: "https://two.test/v1", apiKey: "k", bigModels: ["m2"], smallModels: [], name: "two" },
    { baseUrl: "https://three.test/v1", apiKey: "k", bigModels: ["m3"], smallModels: [], name: "three" },
  ]);

  assert.equal(result.provider.name, "three");
  assert.equal(seen.length, 3, "one attempt each — neither case is retried");
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
