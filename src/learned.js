// What opencc has learned by asking about each model at each provider: parts
// of a request it refuses (quirks), and how much it really takes. Kept for a
// day, then learned again if it still holds: a refused request costs nothing.
//
// Keyed by address + model, like the record. Nothing here is a judgement
// about the model; it is about how to talk to it.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { LEARNED_PATH, GLOBAL_CONFIG_DIR } from "./paths.js";
import { simpleSchema } from "./textfix.js";
import { isTooBig } from "./stats.js";

export const DAY_MS = 86_400_000;

let table = null;
let timer = null;

const read = () => {
  if (table) return table;
  try {
    table = JSON.parse(readFileSync(LEARNED_PATH, "utf8"));
  } catch {
    table = {};
  }
  return table;
};

const keyOf = (baseUrl, model) => `${baseUrl}\u0000${model}`;

function save() {
  if (timer) return;
  timer = setTimeout(flushLearned, 1500);
  timer.unref?.();
}

export function flushLearned() {
  clearTimeout(timer);
  timer = null;
  if (!table) return;
  try {
    mkdirSync(GLOBAL_CONFIG_DIR, { recursive: true });
    writeFileSync(LEARNED_PATH, JSON.stringify(table));
  } catch {
    // Learning is a convenience: a read-only home must not stop the proxy.
  }
}
process.on("exit", flushLearned);

export const learnedFor = (baseUrl, model) => read()[keyOf(baseUrl, model)] ?? {};
const entryFor = (baseUrl, model) => (read()[keyOf(baseUrl, model)] ??= {});

// For tests, and for Reset record: forget everything learned.
export function forgetLearned() {
  table = {};
  save();
}
// For tests: read from a different HOME afresh.
export const dropLearnedCache = () => {
  table = null;
};

// --- quirks -----------------------------------------------------------------

// Refusals a provider may make of one part of a request, learned when sending
// it without that part works.
export const QUIRKS = [
  "noTemperature", "noEffort", "noStreamUsage", "noStream", "noImages", "noParallel", "simpleSchemas",
];

// The quirks still holding (learned within a day) for a model.
export function quirksOf(baseUrl, model, now = Date.now()) {
  const q = learnedFor(baseUrl, model).quirks ?? {};
  return Object.fromEntries(Object.entries(q).filter(([, at]) => now - at < DAY_MS).map(([k]) => [k, true]));
}

export function learnQuirk(baseUrl, model, quirk) {
  const e = entryFor(baseUrl, model);
  (e.quirks ??= {})[quirk] = Date.now();
  save();
}

// The request without the parts this model has refused before.
export function applyQuirks(req, quirks) {
  const out = { ...req };
  if (quirks.noTemperature) {
    delete out.temperature;
    delete out.top_p;
  }
  if (quirks.noEffort) delete out.reasoning_effort;
  if (quirks.noStreamUsage) delete out.stream_options;
  if (quirks.noParallel) delete out.parallel_tool_calls;
  if (quirks.noStream) {
    out.stream = false;
    delete out.stream_options;
  }
  if (quirks.noImages && Array.isArray(out.messages)) {
    out.messages = out.messages.map((m) =>
      Array.isArray(m.content)
        ? { ...m, content: m.content.map((p) => (p.type === "image_url" ? { type: "text", text: IMAGE_NOTE } : p)) }
        : m);
  }
  if (quirks.simpleSchemas && out.tools) {
    out.tools = out.tools.map((t) => ({ ...t, function: { ...t.function, parameters: simpleSchema(t.function.parameters) } }));
  }
  return out;
}

export const IMAGE_NOTE = "(an image was here, but this model can't see images)";

// Which part of the request a refusal (400, or 422 from the ones that check
// requests against a schema) is about, or null. The part the error names
// first; with none named, images (a model listed as seeing them that doesn't
// take them), then the parallel calls. `req` is what was sent; `quirks` what
// is already switched on.
export function refusedPart(status, text, req, quirks = {}) {
  if (status !== 400 && status !== 422) return null;
  if (isTooBig(status, text)) return null; // "too large": the caller sends less
  const said = String(text ?? "");
  const imagesSent = !quirks.noImages && req.messages?.some((m) => Array.isArray(m.content) && m.content.some((p) => p.type === "image_url"));
  if (/temperature|top_p/i.test(said) && ("temperature" in req || "top_p" in req) && !quirks.noTemperature) return "noTemperature";
  if (/reasoning_effort/.test(said) && "reasoning_effort" in req && !quirks.noEffort) return "noEffort";
  if (/stream_options/.test(said) && req.stream_options && !quirks.noStreamUsage) return "noStreamUsage";
  if (/parallel_tool_calls/.test(said) && req.parallel_tool_calls && !quirks.noParallel) return "noParallel";
  if (/stream/i.test(said) && req.stream && !quirks.noStream) return "noStream";
  if (imagesSent && /image|vision|multimodal|modalit|content.{0,20}(type|part)/i.test(said)) return "noImages";
  if (req.tools?.length && !quirks.simpleSchemas && /schema|function_declarations|parameters|additionalProperties|exclusiveM|minItems|unknown name|invalid.{0,40}(tool|function)|tools\[/i.test(said)) return "simpleSchemas";
  if (imagesSent) return "noImages";
  if (req.parallel_tool_calls && !quirks.noParallel) return "noParallel"; // refused without naming it
  return null;
}

// --- how much it takes ------------------------------------------------------

// "Request too large" when the error states its limit: { tokens, rate }
// (rate: a per-minute cap on your account, not the model's window), or null
// (no number in it: nothing is learned from a guess).
const LIMIT_IN_MESSAGE = [
  /maximum context length is (\d+)/i,
  /(\d+) maximum context length/i,
  /available context size \((\d+)/i,
  /> ?(\d+) maximum/i,
  /allowed \((\d+)\)/i,
  /context (?:window|length|size) (?:of|is) (\d+)/i,
  /\bLimit (\d+)/,
];
export function limitStated(status, message) {
  if (!isTooBig(status, message) && !(status >= 400 && status < 500 && /too (large|long|big)|exceeds|context (length|window|size)|too many .*tokens/i.test(message))) return null;
  const n = Number(LIMIT_IN_MESSAGE.map((re) => re.exec(message)?.[1]).find(Boolean));
  return n > 0
    ? { tokens: n, rate: /per (minute|hour|day)|tokens per (min|hour|day)|\bTP[MHD]\b|rate.?limit|quota/i.test(message) }
    : null;
}

// A refusal that stated its limit: kept for a day (a per-minute cap is yours,
// not the model's, so it is kept apart and lasts until the minute is out).
export function learnLimit(baseUrl, model, { tokens, rate }, now = Date.now()) {
  const e = entryFor(baseUrl, model);
  if (rate) e.rateCap = { tokens, until: now + DAY_MS };
  else {
    e.inputLimit = Math.min(e.inputLimit ?? Infinity, tokens);
    e.inputLimitAt = now;
  }
  save();
}

// After a reply: `used` is what the server says the request had (prompt
// tokens), `estimate` what opencc thought it sent. Learns the ratio between
// them, a silent cut (Ollama beyond its num_ctx drops the start: far fewer
// tokens counted than sent, seen twice at about the same size before it
// counts), and that a bigger request than a learned limit worked. Returns
// 'cut' | 'grew' | null.
export function learnFromUsage(baseUrl, model, used, estimate) {
  if (!(used > 0) || !(estimate > 0)) return null;
  const p = entryFor(baseUrl, model);
  const expected = estimate * (p.tokenRatio ?? 1);
  let change = null;
  if (estimate > 3000 && used >= 1024 && used < expected * 0.5) {
    if (p.cutAt && Math.abs(used - p.cutAt) / p.cutAt < 0.15) {
      p.inputLimit = Math.min(p.inputLimit ?? Infinity, Math.max(used, p.cutAt));
      p.inputLimitAt = Date.now();
      delete p.cutAt;
      save();
      return "cut";
    }
    p.cutAt = used;
    save();
    return null;
  }
  if (estimate > 500) {
    const r = Math.min(3, Math.max(0.3, used / estimate));
    p.tokenRatio = Math.round(((p.tokenRatio ?? r) * 0.7 + r * 0.3) * 1000) / 1000;
    change = "ratio";
  }
  if (p.inputLimit && used > p.inputLimit * 1.05) {
    delete p.inputLimit;
    delete p.inputLimitAt;
    change = "grew";
  }
  if (p.rateCap && used > p.rateCap.tokens) {
    delete p.rateCap;
    change = "grew";
  }
  if (used > (p.largestAccepted ?? 0) * 1.1) {
    p.largestAccepted = used;
    change = "grew";
  }
  if (change) save();
  return change;
}

// What the running server said its window is (probed, see probe.js).
export function learnServer(baseUrl, model, { size, server }) {
  const e = entryFor(baseUrl, model);
  e.server = { size: size ?? null, kind: server ?? null, at: Date.now() };
  save();
}

// Where the window comes from, from most to least trusted: measured (the
// server's own limit from an oversized request), what the running server says
// (llama.cpp, LM Studio, Ollama, vLLM, a /models list), models.dev's published
// limit; then a limit a refusal stated or a silent cut showed (within a
// day), then a per-minute cap (your account's, not the model's).
// `base`: { measured, size (models.dev or the provider's list) }. Returns
// { size, from } or null when nothing is known.
export function windowFor(baseUrl, model, base = {}, now = Date.now()) {
  const p = learnedFor(baseUrl, model);
  let size;
  let from;
  if (base.measured > 0) [size, from] = [base.measured, "measured"];
  else if (p.server?.size > 0) [size, from] = [p.server.size, "server"];
  else if (base.size > 0) [size, from] = [base.size, base.sizeFrom ?? "models.dev"];
  if (p.inputLimit > 0 && !(now - p.inputLimitAt > DAY_MS) && !(size <= p.inputLimit)) [size, from] = [p.inputLimit, "learned"];
  if (p.rateCap?.until > now && !(size <= p.rateCap.tokens)) [size, from] = [p.rateCap.tokens, "rate"];
  return size ? { size, from } : null;
}

export const ratioOf = (baseUrl, model) => learnedFor(baseUrl, model).tokenRatio ?? 1;
