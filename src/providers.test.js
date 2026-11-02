import test from "node:test";
import assert from "node:assert/strict";
import { mask, safeName, listedPrice, windowOf, listEntries, entryDetails, limitSaid } from "./providers.js";
import { saveSetup } from "./setup.js";

test("a key is masked to its ends, and a short one to nothing", () => {
  assert.equal(mask("sk-abcdefghijklmnop"), "sk-a…mnop");
  assert.equal(mask("short"), "…");
  assert.equal(mask(""), "");
});

test("a provider's name is lower case letters, digits, dashes and underscores", () => {
  assert.equal(safeName("  My Provider! "), "my-provider");
  assert.equal(safeName(undefined), "");
});

test("a list's price is read from the shapes providers use", () => {
  assert.deepEqual(listedPrice({ pricing: { prompt: "0.000001", completion: "0.000002" } }), { input: 1, output: 2 });
  assert.deepEqual(listedPrice({ is_free: true }), { input: 0, output: 0 });
  assert.equal(listedPrice({ pricing: { prompt: "-1", completion: "-1" } }), undefined);
  assert.equal(listedPrice({ id: "x" }), undefined);
});

test("a model's window is found under whatever name the provider uses", () => {
  assert.equal(windowOf({ context_length: 8192 }), 8192);
  assert.equal(windowOf({ max_model_len: 4096 }), 4096);
  assert.equal(windowOf({ inputTokenLimit: 1000000 }), 1000000);
  assert.equal(windowOf({}), undefined);
});

test("a /models answer is read whichever shape it came in", () => {
  assert.equal(listEntries([{ id: "a" }, null]).length, 1);
  assert.equal(listEntries({ data: [{ id: "a" }, { id: "b" }] }).length, 2);
  assert.deepEqual(listEntries({ result: [{ name: "cf/x" }] }), [{ name: "cf/x", id: "cf/x" }]);
  assert.deepEqual(listEntries({}), []);
});

test("only what the list said about a model is kept", () => {
  assert.deepEqual(entryDetails({ id: "m", context_length: 1000, owned_by: "system" }), { context: 1000 });
});

test("a limit is learned only when the error states it", () => {
  assert.deepEqual(limitSaid({ status: 400, message: "maximum context length is 8192 tokens" })?.tokens, 8192);
  assert.equal(limitSaid({ status: 400, message: "context length exceeded" }), null);
  assert.equal(limitSaid({ status: 500, message: "boom" }), null);
});

test("a setup with a bad context window or a non-yes/no is refused before anything is written", () => {
  const ok = { tools: true, thinking: false, images: false, stream: true };
  assert.throws(() => saveSetup("http://x", "m", { ...ok, context: 100 }), /context window/);
  assert.throws(() => saveSetup("http://x", "m", { ...ok, context: 1.5 }), /context window/);
  assert.throws(() => saveSetup("http://x", "m", { ...ok, context: 2048, tools: "yes" }), /tools/);
});
