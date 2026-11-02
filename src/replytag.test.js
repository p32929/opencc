import test from "node:test";
import assert from "node:assert/strict";
import { renderTag, stripTags, tagMessage } from "./replytag.js";
import { streamOpenAIToAnthropic } from "./stream.js";

const who = { provider: "groq", model: "llama-3", requested: "claude-sonnet" };

test("no template means no label", () => {
  assert.equal(renderTag("", who), "");
  assert.equal(renderTag(undefined, who), "");
  const msg = { content: [{ type: "text", text: "hi" }] };
  assert.equal(tagMessage(msg, ""), msg);
});

test("a template is filled in and followed by a space, or a line break if it ends in one", () => {
  assert.equal(renderTag("[{provider}-{model}]", who), "[groq-llama-3] ");
  assert.equal(renderTag("[{model}] for {requested}", who), "[llama-3] for claude-sonnet ");
  assert.equal(renderTag("[{provider}]\\n", who), "[groq]\n");
  assert.equal(renderTag("{nope}", who), "{nope} ");
});

test("the label goes in front of the first text, and a tool-only reply gets a text block", () => {
  const tagged = tagMessage({ content: [{ type: "tool_use", id: "a" }, { type: "text", text: "ok" }] }, "[x] ");
  assert.equal(tagged.content[1].text, "[x] ok");
  const only = tagMessage({ content: [{ type: "tool_use", id: "a" }] }, "[x] ");
  assert.deepEqual(only.content[0], { type: "text", text: "[x]" });
});

test("earlier labels are taken off assistant text only", () => {
  const out = stripTags("[{provider}-{model}]", [
    { role: "user", content: "[a-b] keep" },
    { role: "assistant", content: [{ type: "text", text: "[groq-llama-3] hello" }, { type: "tool_use", id: "t" }] },
    { role: "assistant", content: "[x-y] plain" },
  ]);
  assert.equal(out[0].content, "[a-b] keep");
  assert.equal(out[1].content[0].text, "hello");
  assert.equal(out[2].content, "plain");
});

test("streaming puts the label on the first text delta only", async () => {
  const chunks = [];
  const res = { writeHead() {}, write: (c) => chunks.push(c), end() {}, writableEnded: false };
  const enc = new TextEncoder();
  const lines = [{ choices: [{ delta: { content: "he" } }] }, { choices: [{ delta: { content: "llo" }, finish_reason: "stop" }] }]
    .map((o) => `data: ${JSON.stringify(o)}\n\n`).join("") + "data: [DONE]\n\n";
  const upstream = { body: new ReadableStream({ start(c) { c.enqueue(enc.encode(lines)); c.close(); } }) };
  await streamOpenAIToAnthropic(upstream, res, "m", "http://x", "[g-m] ");
  const text = chunks.join("");
  assert.match(text, /"text":"\[g-m\] he"/);
  assert.equal((text.match(/\[g-m\]/g) || []).length, 1);
});
