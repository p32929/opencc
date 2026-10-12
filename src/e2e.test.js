// End to end, against the real thing.
//
// Everything in opencc.test.js stubs fetch: it checks that the walk, the
// sampler and the parser behave, and it would pass on a machine that cannot
// reach a single provider. This file is the other half. It starts the actual
// proxy on a real socket, sends real Anthropic-shaped requests over real HTTP
// to whatever is in ~/.opencc/.env, and reads what comes back.
//
// It therefore needs working providers and it costs real tokens, so it is off
// unless you ask for it:
//
//   OPENCC_E2E=1 node --test src/e2e.test.js
//
// Requests made here are recorded like any other, which is correct: they are
// real calls, and what they teach the router is true.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { getConfig } from "./config.js";
import { startServer } from "./server.js";

const enabled = process.env.OPENCC_E2E === "1";
const live = getConfig().providers.filter((p) => !p.disabled);

const skip = !enabled
  ? "set OPENCC_E2E=1 to run (makes real API calls)"
  : live.length === 0
    ? "no enabled providers in ~/.opencc/.env"
    : false;

// One server for the whole file. It has to outlive every test in it, so it
// goes in file-level hooks rather than in the first test's cleanup.
let base;
let server;

before(async () => {
  if (skip) return;
  server = await startServer(0);
  base = `http://localhost:${server.address().port}`;
});

after(() => server?.close());

test("the proxy starts and answers", { skip }, async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.ok, true, "the health route answers");
});

const ask = (body) =>
  fetch(`${base}/v1/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(300000),
  });

test("a plain request comes back as a well-formed Anthropic message", { skip }, async () => {
  const res = await ask({
    model: "claude-sonnet-4",
    max_tokens: 64,
    messages: [{ role: "user", content: "Reply with exactly: pong" }],
  });

  const body = await res.json();
  assert.equal(res.status, 200, `upstream said ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
  assert.equal(body.type, "message");
  assert.equal(body.role, "assistant");
  assert.ok(Array.isArray(body.content) && body.content.length > 0, "never an empty content array");
  assert.ok(body.content.some((b) => b.type === "text" && b.text.length > 0), "said something");
  assert.ok(["end_turn", "max_tokens", "stop_sequence"].includes(body.stop_reason), body.stop_reason);
});

test("a tool request comes back as a real tool_use block", { skip }, async () => {
  const res = await ask({
    model: "claude-sonnet-4",
    max_tokens: 256,
    tools: [{
      name: "get_weather",
      description: "Get the current weather in a given city",
      input_schema: {
        type: "object",
        properties: { city: { type: "string", description: "City name" } },
        required: ["city"],
      },
    }],
    tool_choice: { type: "any" },
    messages: [{ role: "user", content: "What is the weather in Dhaka? Use the tool." }],
  });

  const body = await res.json();
  assert.equal(res.status, 200, `upstream said ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);

  const call = body.content.find((b) => b.type === "tool_use");
  assert.ok(call, `expected a tool_use block, got ${JSON.stringify(body.content).slice(0, 300)}`);
  assert.equal(call.name, "get_weather");
  assert.ok(call.input && typeof call.input === "object", "arguments parsed into an object");
  // The bug that made Claude Code silently skip tools: the backend says
  // "stop" and we have to notice there is a tool call anyway.
  assert.equal(body.stop_reason, "tool_use", "stop_reason follows the content, not the backend");
});

test("a streamed reply is well-formed SSE that ends properly", { skip }, async () => {
  const res = await ask({
    model: "claude-sonnet-4",
    max_tokens: 64,
    stream: true,
    messages: [{ role: "user", content: "Count to three." }],
  });

  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") || "", /text\/event-stream/);

  const text = await res.text();
  const events = [...text.matchAll(/^event: (.+)$/gm)].map((m) => m[1]);

  assert.equal(events[0], "message_start");
  assert.equal(events.at(-1), "message_stop");
  for (const required of ["content_block_start", "content_block_delta", "content_block_stop", "message_delta"]) {
    assert.ok(events.includes(required), `missing ${required} in ${events.join(", ")}`);
  }
  // Every data line has to be parseable or Claude Code drops the stream.
  for (const [, payload] of text.matchAll(/^data: (.+)$/gm)) JSON.parse(payload);
});

test("a tool result round-trips back into a follow-up turn", { skip }, async () => {
  // The multi-turn shape that broke on Gemini: the assistant's tool call has
  // to be replayed well enough for the next request to be accepted.
  const tools = [{
    name: "add",
    description: "Add two numbers",
    input_schema: {
      type: "object",
      properties: { a: { type: "number" }, b: { type: "number" } },
      required: ["a", "b"],
    },
  }];

  const first = await ask({
    model: "claude-sonnet-4", max_tokens: 256, tools,
    tool_choice: { type: "any" },
    messages: [{ role: "user", content: "What is 2 plus 3? Use the tool." }],
  });
  const firstBody = await first.json();
  assert.equal(first.status, 200, JSON.stringify(firstBody).slice(0, 300));

  const call = firstBody.content.find((b) => b.type === "tool_use");
  assert.ok(call, "first turn produced a tool call");

  const second = await ask({
    model: "claude-sonnet-4", max_tokens: 256, tools,
    messages: [
      { role: "user", content: "What is 2 plus 3? Use the tool." },
      { role: "assistant", content: firstBody.content },
      { role: "user", content: [{ type: "tool_result", tool_use_id: call.id, content: "5" }] },
    ],
  });
  const secondBody = await second.json();
  assert.equal(second.status, 200, `follow-up said ${second.status}: ${JSON.stringify(secondBody).slice(0, 300)}`);
  assert.ok(secondBody.content.length > 0, "answered the follow-up");
});

test("an unroutable request fails as an Anthropic error, not a crash", { skip }, async () => {
  const res = await fetch(`${base}/v1/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{ not json",
  });

  const body = await res.json();
  assert.ok(res.status >= 400);
  assert.equal(body.type, "error", JSON.stringify(body).slice(0, 200));
  assert.ok(body.error?.message, "an error carries a message");
});
