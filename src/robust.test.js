// How the proxy treats a model that fails, stalls, loops or refuses part of a
// request. The walk is driven with a stubbed fetch and no stats file, so each
// of these is about one rule and not about whatever else has been served.
import test from "node:test";
import assert from "node:assert/strict";
import { callUpstream } from "./server.js";
import { streamOpenAIToAnthropic, primeStream } from "./stream.js";
import { refusedPart, applyQuirks, limitStated, windowFor } from "./learned.js";
import { outage, unusable, isPage, retryAfterMs } from "./failures.js";
import { stripThink, visible, loopStart, leakedMarkup, callId, simpleSchema, est, tokensOf } from "./textfix.js";
import { effortFor, behaviorFromEnv, behaviorToEnv, changeBehavior, DEFAULTS } from "./behavior.js";
import { toOpenAIRequest, toAnthropicResponse } from "./translate.js";
import { renderTag } from "./replytag.js";

const NO_STATS = {
  order: (attempts) => ({ attempts, head: [], cooling: 0 }),
  record: () => {},
  coolOff: () => 0,
  settled: () => {},
};
const REQ = { model: "claude-x", messages: [{ role: "user", content: "hi" }], max_tokens: 16 };
const PROVIDER = (name, ...models) => ({ baseUrl: `https://${name}.test/v1`, apiKey: "k", models, name });

const sse = (...chunks) =>
  new Response(chunks.map((c) => `data: ${typeof c === "string" ? c : JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n").body;
// One network read per event, as a real stream arrives.
const sseEach = (...chunks) => {
  const enc = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    pull(c) {
      if (i < chunks.length) c.enqueue(enc.encode(`data: ${JSON.stringify(chunks[i++])}\n\n`));
      else { c.enqueue(enc.encode("data: [DONE]\n\n")); c.close(); }
    },
  });
};
const ok = (extra = {}) => ({
  ok: true, status: 200, headers: new Headers(),
  text: async () => "", json: async () => ({ choices: [{ message: { content: "fine" }, finish_reason: "stop" }] }),
  body: sse({ choices: [{ delta: { content: "fine" } }] }), ...extra,
});
const fail = (status, text = "no", headers = {}) => ({
  ok: false, status, headers: new Headers(headers), text: async () => text, body: null,
});

// responders: a function (call, init) => response; calls are recorded.
function stub(t, responder) {
  const realFetch = globalThis.fetch;
  t.after(() => (globalThis.fetch = realFetch));
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const call = { url, body: JSON.parse(init.body), n: calls.length };
    calls.push(call);
    return responder(call, init);
  };
  return calls;
}
const walk = (req, providers, opts = {}, streaming = false) =>
  callUpstream(req, providers, streaming, NO_STATS, undefined, [], undefined, { retryDelayMs: 1, roundWaitMs: 1, ...opts });

// --- what a failure is ---------------------------------------------------

test("an outage is what waiting can fix, and a web page 403 is a gateway's", () => {
  assert.equal(outage({ status: 429 }), true);
  assert.equal(outage({ status: 503 }), true);
  assert.equal(outage({}), true, "no status: no connection");
  assert.equal(outage({ status: 400 }), false);
  assert.equal(outage({ status: 403, page: false }), false);
  assert.equal(outage({ status: 403, page: true }), true);
  assert.equal(unusable({ status: 401 }), true);
  assert.equal(unusable({ status: 429 }), false);
  assert.equal(isPage("<html>"), true);
  assert.equal(isPage('{"error":1}'), false);
});

test("how long to wait is read from Retry-After or from Gemini's body", () => {
  assert.equal(retryAfterMs(new Headers({ "retry-after": "7" })), 7000);
  assert.equal(retryAfterMs(new Headers(), '{"retryDelay": "31s"}'), 31000);
  assert.equal(retryAfterMs(new Headers()), 0);
  assert.ok(retryAfterMs(new Headers({ "retry-after": new Date(Date.now() + 5000).toUTCString() })) > 3000);
});

// --- refusals of one part of a request -----------------------------------

test("a refusal names the part it is about, and a too-large one is not a quirk", () => {
  assert.equal(refusedPart(400, "unsupported parameter: temperature", { temperature: 1 }), "noTemperature");
  assert.equal(refusedPart(422, "reasoning_effort not allowed", { reasoning_effort: "low" }), "noEffort");
  assert.equal(refusedPart(400, "stream_options is invalid", { stream: true, stream_options: {} }), "noStreamUsage");
  assert.equal(refusedPart(400, "tools[0].parameters: anyOf not supported", { tools: [{}] }), "simpleSchemas");
  assert.equal(refusedPart(400, "prompt is too long", { temperature: 1 }), null);
  assert.equal(refusedPart(500, "temperature", { temperature: 1 }), null);
  const images = { messages: [{ content: [{ type: "image_url", image_url: { url: "x" } }] }] };
  assert.equal(refusedPart(400, "something else", images), "noImages", "refused without a name: images first");
  assert.equal(refusedPart(400, "something else", { tools: [{}] }), null);
});

test("what a model refused is left out of the request", () => {
  const req = {
    temperature: 1, top_p: 1, reasoning_effort: "low", stream: true, stream_options: {},
    messages: [{ content: [{ type: "image_url", image_url: { url: "x" } }] }],
    tools: [{ type: "function", function: { name: "t", parameters: { type: "object", properties: { a: { anyOf: [{ type: "string" }, { type: "null" }] } } } } }],
  };
  const out = applyQuirks(req, { noTemperature: true, noEffort: true, noStreamUsage: true, noImages: true, simpleSchemas: true });
  assert.equal("temperature" in out, false);
  assert.equal("top_p" in out, false);
  assert.equal("reasoning_effort" in out, false);
  assert.equal("stream_options" in out, false);
  assert.equal(out.messages[0].content[0].type, "text");
  assert.equal(out.tools[0].function.parameters.properties.a.type, "string");
  assert.equal(req.temperature, 1, "the original is untouched");
  assert.equal(applyQuirks(req, { noStream: true }).stream, false);
});

test("a refused part is asked again without it, and learned only when that works", async (t) => {
  const learned = [];
  const calls = stub(t, (c) => (c.body.temperature !== undefined ? fail(400, "unsupported parameter: temperature") : ok()));
  const r = await walk({ ...REQ, temperature: 0.5 }, [PROVIDER("one", "m")], { hooks: { learnQuirk: (...a) => learned.push(a.slice(2)) } });
  assert.equal(r.model, "m");
  assert.equal(calls.length, 2);
  assert.equal("temperature" in calls[1].body, false);
  assert.deepEqual(learned, [["noTemperature"]]);
});

test("a model that has refused something before is not sent it again", async (t) => {
  const calls = stub(t, () => ok());
  await walk({ ...REQ, temperature: 0.5 }, [PROVIDER("one", "m")], { hooks: { quirksOf: () => ({ noTemperature: true }) } });
  assert.equal(calls.length, 1);
  assert.equal("temperature" in calls[0].body, false);
});

test("when leaving it out does not help, the first refusal stands and nothing is learned", async (t) => {
  const learned = [];
  stub(t, () => fail(400, "unsupported parameter: temperature"));
  const r = await walk({ ...REQ, temperature: 0.5 }, [PROVIDER("one", "m")], { hooks: { learnQuirk: (...a) => learned.push(a) } });
  assert.equal(r.status, 400);
  assert.deepEqual(learned, []);
});

// --- what a failure does -------------------------------------------------

test("by default a server error is asked again once; with 'any' nothing is asked again", async (t) => {
  const calls = stub(t, () => fail(500));
  await walk(REQ, [PROVIDER("one", "m")]);
  assert.equal(calls.length, 2);
  calls.length = 0;
  await walk(REQ, [PROVIDER("one", "m")], { behavior: { onFail: "any" } });
  assert.equal(calls.length, 1);
});

test("with 'retries' a busy model is asked again up to the limit, then the next one", async (t) => {
  const calls = stub(t, (c) => (c.url.includes("one") ? fail(429) : ok()));
  const r = await walk(REQ, [PROVIDER("one", "m1"), PROVIDER("two", "m2")], { behavior: { onFail: "retries", retries: 3 } });
  assert.equal(calls.filter((c) => c.url.includes("one")).length, 3);
  assert.equal(r.model, "m2");
});

test("with 'retries' a busy model that recovers answers", async (t) => {
  const calls = stub(t, (c) => (c.n < 2 ? fail(429) : ok()));
  const r = await walk(REQ, [PROVIDER("one", "m1"), PROVIDER("two", "m2")], { behavior: { onFail: "retries", retries: 5 } });
  assert.equal(r.model, "m1");
  assert.equal(calls.length, 3);
});

test("with 'retries' a refusal waiting cannot fix moves on at once", async (t) => {
  const calls = stub(t, (c) => (c.url.includes("one") ? fail(404) : ok()));
  await walk(REQ, [PROVIDER("one", "m1"), PROVIDER("two", "m2")], { behavior: { onFail: "retries", retries: 5 } });
  assert.equal(calls.filter((c) => c.url.includes("one")).length, 1);
});

test("a provider whose key is refused is not asked again through its other models until the others have had a turn", async (t) => {
  const calls = stub(t, (c) => (c.url.includes("one") ? fail(401) : c.url.includes("two") ? fail(500) : ok()));
  const r = await walk(REQ, [PROVIDER("one", "a", "b"), PROVIDER("two", "c"), PROVIDER("three", "d")], { behavior: { onFail: "any" } });
  assert.deepEqual(calls.map((c) => c.body.model), ["a", "c", "d"]);
  assert.equal(r.model, "d");
});

test("a rate-limited model does not hold back its provider's other models", async (t) => {
  const calls = stub(t, (c) => (c.body.model === "a" ? fail(429) : ok()));
  const r = await walk(REQ, [PROVIDER("one", "a", "b"), PROVIDER("two", "c")]);
  assert.equal(r.model, "b");
  assert.equal(calls.length, 2);
});

test("held-back models are tried at the end rather than never", async (t) => {
  stub(t, (c) => (c.body.model === "b" ? ok() : fail(401)));
  const r = await walk(REQ, [PROVIDER("one", "a", "b"), PROVIDER("two", "c")], { behavior: { onFail: "any" } });
  assert.equal(r.model, "b");
});

test("with keepTrying, everything busy waits and goes round again", async (t) => {
  let round = 0;
  const calls = stub(t, () => (++round <= 2 ? fail(429, "busy", { "retry-after": "0" }) : ok()));
  const r = await walk(REQ, [PROVIDER("one", "a"), PROVIDER("two", "b")], { behavior: { keepTrying: true, onFail: "any" } });
  assert.ok(r.reply, "answered on the second round");
  assert.equal(calls.length, 3);
});

test("without keepTrying, everything busy is the answer", async (t) => {
  stub(t, () => fail(429));
  const r = await walk(REQ, [PROVIDER("one", "a")], { behavior: { onFail: "any" } });
  assert.equal(r.status, 429);
});

test("with keepTrying, a refusal waiting cannot fix is still the answer", async (t) => {
  const calls = stub(t, () => fail(400, "bad request"));
  const r = await walk(REQ, [PROVIDER("one", "a")], { behavior: { keepTrying: true, onFail: "any" } });
  assert.equal(r.status, 400);
  assert.equal(calls.length, 1);
});

test("the walk stops asking when the client has gone", async (t) => {
  const gone = new AbortController();
  const calls = stub(t, () => { gone.abort(); return fail(500); });
  await walk(REQ, [PROVIDER("one", "a", "b", "c")], { behavior: { onFail: "any" }, signal: gone.signal });
  assert.equal(calls.length, 1);
});

test("how long a provider asked to wait goes to the cooling", async (t) => {
  const asked = [];
  stub(t, () => fail(429, "busy", { "retry-after": "42" }));
  await callUpstream(REQ, [PROVIDER("one", "a")], false,
    { ...NO_STATS, coolOff: (b, m, status, now, ms) => { asked.push(ms); return 0; } }, undefined, [], undefined,
    { retryDelayMs: 1, behavior: { onFail: "any" } });
  assert.deepEqual(asked, [42000]);
});

test("a reply that wrote its tool call out as text is not an answer", async (t) => {
  const withTools = { ...REQ, tools: [{ name: "t", input_schema: { type: "object" } }] };
  const calls = stub(t, (c) => c.url.includes("one")
    ? ok({ json: async () => ({ choices: [{ message: { content: "<tool_call>{}</tool_call>" }, finish_reason: "stop" }] }) })
    : ok());
  const r = await walk(withTools, [PROVIDER("one", "a"), PROVIDER("two", "b")]);
  assert.equal(r.model, "b");
  assert.equal(calls.length, 2);
});

test("effort is sent when set, and follows Claude Code's thinking budget", async (t) => {
  const calls = stub(t, () => ok());
  await walk(REQ, [PROVIDER("one", "a")], { behavior: { effort: "high" } });
  assert.equal(calls[0].body.reasoning_effort, "high");
  await walk(REQ, [PROVIDER("one", "a")]);
  assert.equal("reasoning_effort" in calls[1].body, false, "nothing by default");
  assert.equal(effortFor("follow", { thinking: { type: "enabled", budget_tokens: 1024 } }), "low");
  assert.equal(effortFor("follow", { thinking: { type: "enabled", budget_tokens: 8000 } }), "medium");
  assert.equal(effortFor("follow", { thinking: { type: "enabled", budget_tokens: 31999 } }), "high");
  assert.equal(effortFor("follow", {}), undefined);
});

test("a conversation's model is tried first, when it is there", async (t) => {
  const calls = stub(t, () => ok());
  const r = await callUpstream(REQ, [PROVIDER("one", "a"), PROVIDER("two", "b")], false, NO_STATS, undefined, [], undefined,
    { preferred: { baseUrl: "https://two.test/v1", model: "b" } });
  assert.equal(r.model, "b");
  assert.equal(calls.length, 1);
});

test("a model that cannot see images gets a note, and one that cannot call tools gets the history as text", () => {
  const req = {
    model: "x", max_tokens: 1,
    tools: [{ name: "t", input_schema: { type: "object" } }],
    messages: [
      { role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: "AAA" } }] },
      { role: "assistant", content: [{ type: "tool_use", id: "call_1", name: "t", input: { a: 1 } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "call_1", content: "done" }] },
    ],
  };
  const out = toOpenAIRequest(req, "m", "https://x.test", false, { can: { vision: false, tools: false } });
  assert.equal(out.tools, undefined);
  assert.equal(JSON.stringify(out).includes("image_url"), false);
  assert.ok(out.messages.every((m) => m.role !== "tool" && !m.tool_calls));
  assert.match(JSON.stringify(out.messages), /you called t/);
});

test("tool call ids go out as nine letters and digits, the same for a call and its result", () => {
  const req = {
    model: "x", max_tokens: 1,
    messages: [
      { role: "assistant", content: [{ type: "tool_use", id: "toolu_01ABCdef-xyz", name: "t", input: {} }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_01ABCdef-xyz", content: "ok" }] },
    ],
  };
  const out = toOpenAIRequest(req, "m", "https://x.test");
  const id = out.messages[0].tool_calls[0].id;
  assert.match(id, /^[A-Za-z0-9]{9}$/);
  assert.equal(out.messages[1].tool_call_id, id);
  assert.equal(callId("abc123XYZ"), "abc123XYZ", "one that is fine stays");
});

// --- a reply that has to start ---------------------------------------------

const stalled = () => new ReadableStream({ start() {} }); // never says anything

test("a stream that does not start is given up on, and the next model goes on", async (t) => {
  const calls = stub(t, (c) => c.url.includes("one") ? ok({ body: stalled() }) : ok());
  const r = await walk({ ...REQ, stream: true }, [PROVIDER("one", "a"), PROVIDER("two", "b")], { behavior: { replyStart: 0.15 } }, true);
  assert.equal(r.model, "b");
  assert.equal(calls.length, 2);
});

test("a keep-alive does not count as starting", async (t) => {
  const keepAlive = () => new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(": ping\n\n")); } });
  stub(t, (c) => c.url.includes("one") ? ok({ body: keepAlive() }) : ok());
  const r = await walk({ ...REQ, stream: true }, [PROVIDER("one", "a"), PROVIDER("two", "b")], { behavior: { replyStart: 0.15 } }, true);
  assert.equal(r.model, "b");
});

test("an error sent inside a 200 stream hands over to the next model", async (t) => {
  stub(t, (c) => c.url.includes("one") ? ok({ body: sse({ error: { code: 429, message: "busy" } }) }) : ok());
  const r = await walk({ ...REQ, stream: true }, [PROVIDER("one", "a"), PROVIDER("two", "b")], {}, true);
  assert.equal(r.model, "b");
});

test("a stream that ends with nothing in it is a failure, not an empty answer", async (t) => {
  stub(t, (c) => c.url.includes("one") ? ok({ body: new Response("data: [DONE]\n\n").body }) : ok());
  const r = await walk({ ...REQ, stream: true }, [PROVIDER("one", "a"), PROVIDER("two", "b")], {}, true);
  assert.equal(r.model, "b");
});

test("a primed stream gives back everything it read, in order", async () => {
  const primed = await primeStream({ body: sse({ choices: [{ delta: { content: "a" } }] }, { choices: [{ delta: { content: "b" } }] }) });
  const reader = primed.body.getReader();
  let text = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    text += new TextDecoder().decode(value);
  }
  assert.match(text, /"a"[\s\S]*"b"/);
});

test("a stream that goes quiet after it started fails instead of hanging", async () => {
  let sent = false;
  const body = new ReadableStream({ pull(c) { if (!sent) { sent = true; c.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"hi"}}]}\n\n')); } else return new Promise(() => {}); } });
  const primed = await primeStream({ body }, { startMs: 1000, idleMs: 100 });
  const reader = primed.body.getReader();
  await reader.read();
  await assert.rejects(() => reader.read(), /sent nothing/);
});

// --- what the stream does to a reply -------------------------------------

const fakeRes = () => ({ chunks: [], writeHead() {}, write(c) { this.chunks.push(c); }, end() { this.writableEnded = true; } });
const events = (res) => res.chunks.join("").split("\n\n").filter(Boolean).map((e) => JSON.parse(e.split("\ndata: ")[1]));

test("the model's own <think> block is not shown, wherever the chunks cut it", async () => {
  const res = fakeRes();
  await streamOpenAIToAnthropic({ body: sse(
    { choices: [{ delta: { content: "<thi" } }] }, { choices: [{ delta: { content: "nk>plan</th" } }] },
    { choices: [{ delta: { content: "ink>The answer" }, finish_reason: "stop" }] },
  ) }, res, "m", "http://x");
  const text = events(res).filter((e) => e.delta?.type === "text_delta").map((e) => e.delta.text).join("");
  assert.equal(text, "The answer");
});

test("a reply going round in circles is stopped, and said so", async () => {
  const res = fakeRes();
  const loop = "This is the line that goes round and round and round. ".repeat(4);
  const chunks = Array.from({ length: 80 }, () => ({ choices: [{ delta: { content: loop } }] }));
  const sent = await streamOpenAIToAnthropic({ body: sseEach(...chunks) }, res, "m", "http://x");
  assert.ok(sent.looped, "reported as a loop");
  const text = events(res).filter((e) => e.delta?.type === "text_delta").map((e) => e.delta.text).join("");
  assert.ok(text.length < loop.length * 80, "cut before the end");
  assert.ok(events(res).some((e) => e.type === "message_stop"), "and ended properly");
});

test("a stream says what it used and what it wrote", async () => {
  const res = fakeRes();
  const sent = await streamOpenAIToAnthropic({ body: sse(
    { choices: [{ delta: { content: "hi" } }] },
    { choices: [], usage: { prompt_tokens: 12, completion_tokens: 3, prompt_tokens_details: { cached_tokens: 5 } } },
  ) }, res, "m", "http://x", "");
  assert.deepEqual(sent.usage, { input: 12, output: 3, cached: 5, cost: undefined });
  assert.equal(sent.text, "hi");
});

test("a tool call written out as text in a stream is reported", async () => {
  const res = fakeRes();
  const sent = await streamOpenAIToAnthropic({ body: sse({ choices: [{ delta: { content: "<tool_call>{}</tool_call>" } }] }) }, res, "m", "http://x", "", { hadTools: true });
  assert.equal(sent.garbled, true);
});

// --- small things ------------------------------------------------------------

test("thinking is taken out of a reply however it is written", () => {
  assert.equal(stripThink("<think>a\nb</think>\n\nanswer"), "answer");
  assert.equal(stripThink("mentions <think> later"), "mentions <think> later");
  assert.equal(stripThink("no opening</think>answer", true), "answer");
  assert.equal(stripThink("no opening</think>answer", false), "no opening</think>answer");
  assert.equal(visible("<think>still going"), "");
  assert.equal(visible("done <thi"), "done ");
  const reply = toAnthropicResponse({ choices: [{ message: { content: "<think>x</think>hello" }, finish_reason: "stop" }] }, "m", "u");
  assert.equal(reply.content[0].text, "hello");
});

test("a loop is found only when the end of the text has been said many times", () => {
  assert.equal(loopStart("a".repeat(500)), -1, "too short to tell");
  const looping = "intro " + "the same sentence goes round. ".repeat(100);
  assert.ok(loopStart(looping) > 0);
  assert.equal(loopStart(Array.from({ length: 300 }, (_, i) => `line number ${i} says something new`).join("\n")), -1);
});

test("tool-call markup counts only outside code and at the end", () => {
  assert.ok(leakedMarkup("sure <tool_call>{}</tool_call>"));
  assert.equal(leakedMarkup("use ```\n<tool_call>\n``` to call"), null);
  assert.equal(leakedMarkup("the <tool_call> tag is for calls, I think"), null);
});

test("a schema is flattened to what the most limited providers take", () => {
  const out = simpleSchema({ type: "object", additionalProperties: false, properties: { a: { type: ["string", "null"], format: "uri" }, b: { oneOf: [{ type: "number" }, { type: "null" }] } }, required: ["a", "gone"] });
  assert.equal(out.additionalProperties, undefined);
  assert.equal(out.properties.a.type, "string");
  assert.equal(out.properties.a.format, undefined);
  assert.equal(out.properties.b.type, "number");
  assert.deepEqual(out.required, ["a"]);
});

test("size is counted the way tokenizers split, never under characters / 4, with images as images", () => {
  const code = 'const a = {b: [1,2,3], c: "x"};'.repeat(50);
  assert.ok(est(code) > code.length / 4, "code is denser than prose");
  assert.ok(tokensOf(code, 0.3) >= Math.min(est(code), code.length / 4), "a ratio learned on prose does not shrink it");
  const withImage = JSON.stringify({ u: "data:image/png;base64," + "A".repeat(100000) });
  assert.ok(tokensOf(withImage) < 2000, "an image is not its base64");
});

test("the window comes from you, then the server, then models.dev, then what a refusal showed", () => {
  const fresh = (base) => windowFor("http://nobody.test", "nothing", base);
  assert.deepEqual(fresh({ measured: 5000, size: 9000 }), { size: 5000, from: "measured" });
  assert.deepEqual(fresh({ size: 9000 }), { size: 9000, from: "models.dev" });
  assert.equal(fresh({}), null);
});

test("a refusal's stated limit is read, and a per-minute cap is told apart from the window", () => {
  assert.deepEqual(limitStated(400, "This model's maximum context length is 131072 tokens"), { tokens: 131072, rate: false });
  assert.deepEqual(limitStated(413, "Limit 6000, Requested 9000 per minute (TPM)"), { tokens: 6000, rate: true });
  assert.equal(limitStated(400, "context length exceeded"), null, "no number: nothing learned");
  assert.equal(limitStated(500, "boom"), null);
});

test("behavior settings read, validate, and write only what differs", () => {
  assert.deepEqual(behaviorFromEnv({}), DEFAULTS);
  const b = behaviorFromEnv({ ON_FAIL: "retries", RETRIES: "99", REPLY_START: "1", STAY: "on", EFFORT: "nonsense" });
  assert.equal(b.onFail, "retries");
  assert.equal(b.retries, 20, "clamped");
  assert.equal(b.replyStart, 5, "clamped");
  assert.equal(b.stay, true);
  assert.equal(b.effort, "default");
  assert.deepEqual(behaviorToEnv(DEFAULTS), []);
  assert.deepEqual(behaviorToEnv({ ...DEFAULTS, stay: true, retries: 5 }), ["RETRIES=5", "STAY=on"]);
  assert.throws(() => changeBehavior(DEFAULTS, { onFail: "sometimes" }), /if one fails/);
  assert.throws(() => changeBehavior(DEFAULTS, { retries: 0 }), /retries/);
  assert.throws(() => changeBehavior(DEFAULTS, { stay: "yes" }), /on or off/);
  assert.equal(changeBehavior(DEFAULTS, { replyStart: 30 }).replyStart, 30);
});

test("the label still works with the new walk", () => {
  assert.equal(renderTag("[{model}]", { provider: "p", model: "m", requested: "r" }), "[m] ");
});
