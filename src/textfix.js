// Small, pure fixes to what models send and what they are sent.
import { createHash } from "node:crypto";

// --- thinking written into the reply ---------------------------------------

// Removes the thinking some models put in the normal content: a <think> block
// the reply starts with (still open: all of it so far). A reply that only
// mentions the tag later keeps its text. A closing tag with no opening one
// counts only for a model that thinks (some leave the opening out).
export function stripThink(text, thinks = false) {
  const t = String(text ?? "");
  const lead = /^\s*<think>[\s\S]*?(<\/think>|$)/.exec(t);
  if (lead) return t.slice(lead[0].length).trimStart();
  const close = thinks && !t.includes("<think>") ? t.indexOf("</think>") : -1;
  return close !== -1 ? t.slice(close + 8).trimStart() : t;
}

// What can be shown so far while streaming: holds back a half-received "<think>".
export function visible(full, thinks = false) {
  const v = stripThink(full, thinks);
  for (let k = 7; k > 0; k--) {
    if (v.endsWith("<think>".slice(0, k))) return v.slice(0, -k);
  }
  return v;
}

// --- a reply going round in circles ----------------------------------------

// Where a text started going round: its newest 200 characters are already
// there 6+ times in its last 12,000 (a phrase or a block of up to 2000
// characters, repeated). -1: it isn't.
export function loopStart(text) {
  if (text.length < 2000) return -1;
  const probe = text.slice(-200);
  const win = text.slice(-12_000);
  let n = 0;
  let first = -1;
  for (let i = win.indexOf(probe); i !== -1; i = win.indexOf(probe, i + 1)) {
    n++;
    if (first < 0) first = i;
  }
  return n >= 6 ? text.length - win.length + first : -1;
}

// --- a tool call written out as text ---------------------------------------

// A chat template's tool-call markup in a reply's text: outside code blocks,
// and the reply ends in it (an answer that only mentions such tags isn't one).
const MARKUP = /<\/?tool_call>|<\/?arg_(?:key|value)>|<function=[\w.-]+>|<\|[a-z_]+\|>/i;
export function leakedMarkup(text) {
  const prose = String(text ?? "").replace(/```[\s\S]*?(```|$)/g, (m) => " ".repeat(m.length));
  const m = MARKUP.exec(prose);
  return m && /[>}]\s*$/.test(prose) ? m : null;
}

// --- tool call ids ----------------------------------------------------------

// Nine letters and digits is the one form every provider takes (Mistral
// refuses the rest). Derived from the id, so a call and its result, sent in
// different requests, come out the same.
export const callId = (id) =>
  /^[A-Za-z0-9]{9}$/.test(id) ? id : createHash("sha256").update(String(id)).digest("hex").slice(0, 9);

// --- tool schemas -----------------------------------------------------------

// A tool's arguments as the most limited providers take them (Gemini's
// function declarations): only types, properties, required, items, enum and
// descriptions; a choice of types (anyOf, oneOf, ["string", "null"]) becomes
// its first real one.
const KEEP = new Set(["type", "properties", "required", "items", "enum", "description"]);
export function simpleSchema(x) {
  if (!x || typeof x !== "object" || Array.isArray(x)) return x;
  const alt = x.anyOf ?? x.oneOf;
  if (alt?.length) {
    const pick = alt.find((a) => a?.type !== "null") ?? alt[0];
    return simpleSchema({ ...pick, ...(x.description && { description: x.description }) });
  }
  const out = {};
  for (const [k, v] of Object.entries(x)) {
    if (!KEEP.has(k)) continue;
    if (k === "properties") out.properties = Object.fromEntries(Object.entries(v ?? {}).map(([n, s]) => [n, simpleSchema(s)]));
    else if (k === "items") out.items = simpleSchema(Array.isArray(v) ? v[0] : v);
    else if (k === "type" && Array.isArray(v)) out.type = v.find((y) => y !== "null") ?? "string";
    else out[k] = v;
  }
  out.type ??= out.properties ? "object" : "string";
  if (Array.isArray(out.required) && out.properties) out.required = out.required.filter((r) => r in out.properties);
  return out;
}

// --- sizes ------------------------------------------------------------------

// Tokens in a text, estimated the way tokenizers split it: a word or a number
// is about one, a long word more, every symbol one. Prose comes out near
// characters / 4; code, CSS, JSON and SVG paths, dense with symbols and
// digits, far higher (a flat characters / 3.5 was 2x low on them).
const PIECE = /[A-Za-z]+|\d{1,3}|[^\sA-Za-z\d]/g;
export const est = (text) => {
  const t = String(text ?? "");
  let n = 0;
  for (const [w] of t.matchAll(PIECE)) n += w.length > 7 && /[A-Za-z]/.test(w[0]) ? Math.ceil(w.length / 6) : 1;
  return Math.max(n, Math.ceil(t.length / 4));
};

// A request's size in a model's tokens, estimated from its serialised text:
// by that model's ratio of counted to estimated tokens, never below
// characters / 4 (a ratio learned on prose would otherwise make code look
// smaller than it is). Images are not text: about 800 tokens each, not their
// base64.
export function tokensOf(text, ratio = 1) {
  let images = 0;
  const bare = String(text).replace(/"data:[^"]{200,}"/g, () => (images++, '""'));
  const e = est(bare);
  const floor = bare.length / 4;
  return Math.round(Math.max(e * ratio, Math.min(e, floor))) + images * 800;
}
