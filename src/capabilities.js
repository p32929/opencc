// What a model can do, and what a request needs.
//
// Claude Code sends one shape of request for everything, but the models behind
// opencc differ: some take images, some do tool calling, some do neither.
// Rather than discover that as a mid-session failure, work out what each
// request needs and only try models that can serve it.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { CAPABILITIES_PATH, GLOBAL_CONFIG_DIR } from "./paths.js";

// A 1x1 transparent PNG — the smallest thing that makes a backend admit
// whether it accepts images at all.
const PIXEL =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=";

const key = (baseUrl, model) => `${baseUrl}|${model}`;

export function readCapabilities() {
  if (!existsSync(CAPABILITIES_PATH)) return {};
  try {
    return JSON.parse(readFileSync(CAPABILITIES_PATH, "utf8"));
  } catch {
    // A corrupt cache should cost us detection, not the whole proxy.
    return {};
  }
}

export function writeCapabilities(all) {
  mkdirSync(GLOBAL_CONFIG_DIR, { recursive: true });
  writeFileSync(CAPABILITIES_PATH, `${JSON.stringify(all, null, 2)}\n`, { mode: 0o600 });
}

export function capabilityFor(all, baseUrl, model) {
  return all[key(baseUrl, model)] ?? null;
}

export function setCapability(all, baseUrl, model, caps) {
  return { ...all, [key(baseUrl, model)]: caps };
}

// What this request actually needs. Claude Code puts images in user content
// blocks and tools at the top level, so both are cheap to spot.
export function requirementsOf(anthropicReq) {
  const tools = Array.isArray(anthropicReq.tools) && anthropicReq.tools.length > 0;

  let vision = false;
  let documents = false;
  for (const message of anthropicReq.messages ?? []) {
    if (!Array.isArray(message.content)) continue;
    for (const block of message.content) {
      if (block.type === "image") vision = true;
      if (block.type === "document") documents = true;
    }
  }

  return { tools, vision, documents };
}

// Unknown capabilities are treated as "probably fine": a model nobody has
// detected yet should still get a turn, otherwise adding a provider would
// silently take it out of rotation until a detection run happened.
export function canServe(caps, needs) {
  if (!caps) return true;
  if (needs.tools && caps.tools === false) return false;
  if (needs.vision && caps.vision === false) return false;
  return true;
}

export function describeNeeds(needs) {
  const parts = [];
  if (needs.tools) parts.push("tool calling");
  if (needs.vision) parts.push("images");
  if (needs.documents) parts.push("documents");
  return parts.length ? parts.join(" + ") : "plain text";
}

// --- detection -------------------------------------------------------------

const authHeaders = (provider) => {
  const headers = { "Content-Type": "application/json" };
  if (provider.apiKey) headers.Authorization = `Bearer ${provider.apiKey}`;
  return headers;
};

// Some providers describe their models properly (OpenRouter publishes
// architecture.input_modalities and supported_parameters); most publish
// nothing but an id. Try the catalogue first, since it costs one call for
// every model rather than two calls each.
export async function fetchCatalogue(provider, timeoutMs = 30000) {
  try {
    const res = await fetch(`${provider.baseUrl}/models`, {
      headers: authHeaders(provider),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return {};
    const body = await res.json();
    const data = Array.isArray(body) ? body : (body.data ?? []);

    const byId = {};
    for (const entry of data) {
      if (!entry?.id) continue;
      const modalities = entry.architecture?.input_modalities;
      const params = entry.supported_parameters;
      if (!Array.isArray(modalities) && !Array.isArray(params)) continue;

      byId[entry.id] = {
        tools: Array.isArray(params) ? params.includes("tools") : undefined,
        vision: Array.isArray(modalities) ? modalities.includes("image") : undefined,
        contextLength: entry.context_length ?? entry.top_provider?.context_length ?? undefined,
        source: "catalogue",
      };
    }
    return byId;
  } catch {
    return {};
  }
}

// Deliberately much shorter than the proxy's own timeout. A probe sends a
// handful of tokens, so anything past a minute means a queue rather than real
// work — and giving up costs little, because "unknown" still lets the model be
// tried. Detection is best-effort; a slow backend just stays undetected.
// Worst case per capability is this x2 (the differential) x2 (one retry).
const PROBE_TIMEOUT_MS = 60000;

const TOOL = {
  type: "function",
  function: {
    name: "ping",
    description: "Send a ping",
    parameters: { type: "object", properties: { value: { type: "number" } }, required: ["value"] },
  },
};

const PIXEL_BLOCK = { type: "image_url", image_url: { url: `data:image/png;base64,${PIXEL}` } };

async function once(provider, model, body, timeoutMs) {
  try {
    const res = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: "POST",
      headers: authHeaders(provider),
      body: JSON.stringify({ model, ...body }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.ok) return { ok: true, json: await res.json() };
    return { ok: false, status: res.status, text: (await res.text()).slice(0, 300) };
  } catch (err) {
    return { ok: false, status: 0, text: err.message };
  }
}

// Load, not capability: a busy or unreachable backend tells us nothing about
// what the model can do, however many times we ask.
const isLoad = (status) => status === 0 || status === 408 || status === 425 || status === 429 || status >= 500;

// Only a client error that isn't load can mean "this feature is unsupported".
// 429 is the trap: it sits in the 4xx range but is purely about load, and
// treating it as an answer marks a rate-limited vision model permanently
// blind.
const isCapabilitySignal = (status) => status >= 400 && status < 500 && !isLoad(status);

async function attempt(provider, model, body, timeoutMs) {
  const first = await once(provider, model, body, timeoutMs);
  if (first.ok || !isLoad(first.status)) return first;
  await new Promise((r) => setTimeout(r, 1500));
  return once(provider, model, body, timeoutMs);
}

// Differential probe. Asking "did the error message mention images?" means
// guessing at prose that varies per backend — z.ai says
// "messages.content.type is invalid, allowed values: ['text']", which names
// neither images nor vision. Instead, send the request with the feature and,
// if that is rejected, send the same request without it: only if the plain
// one succeeds has the feature been shown to be the cause.
async function differential(provider, model, withFeature, timeoutMs) {
  const used = await attempt(provider, model, withFeature, timeoutMs);
  if (used.ok) return { supported: true, json: used.json };

  if (!isCapabilitySignal(used.status)) return { supported: undefined };

  const plain = await attempt(
    provider,
    model,
    { messages: [{ role: "user", content: "Reply with: ok" }] },
    timeoutMs,
  );
  return { supported: plain.ok ? false : undefined, evidence: used.text };
}

// True once the backend accepts tool definitions — that's what decides whether
// a request fails. Whether the model chose to call one is recorded separately,
// since a capable model may legitimately answer without calling anything.
export async function probeTools(provider, model, timeoutMs = PROBE_TIMEOUT_MS) {
  const { supported, json } = await differential(provider, model, {
    messages: [{ role: "user", content: "Call ping with value 1. Reply only with the tool call." }],
    tools: [TOOL],
    tool_choice: "auto",
  }, timeoutMs);

  return {
    supported,
    called: supported === true ? Boolean(json?.choices?.[0]?.message?.tool_calls?.length) : undefined,
  };
}

export async function probeVision(provider, model, timeoutMs = PROBE_TIMEOUT_MS) {
  const { supported } = await differential(provider, model, {
    messages: [{ role: "user", content: [{ type: "text", text: "Reply with: ok" }, PIXEL_BLOCK] }],
  }, timeoutMs);
  return supported;
}

// Resolves one model's capabilities, preferring the provider's own catalogue
// and falling back to probing. `catalogue` is passed in so a run over many
// models fetches it once per provider.
export async function detectCapabilities(provider, model, catalogue = {}) {
  const published = catalogue[model];
  if (published && published.tools !== undefined && published.vision !== undefined) {
    return { ...published, detectedAt: new Date().toISOString() };
  }

  const [toolResult, vision] = await Promise.all([
    published?.tools === undefined ? probeTools(provider, model) : { supported: published.tools },
    published?.vision === undefined ? probeVision(provider, model) : published.vision,
  ]);

  return {
    tools: toolResult.supported,
    toolsCalled: toolResult.called,
    vision,
    contextLength: published?.contextLength,
    source: published ? "catalogue+probe" : "probe",
    detectedAt: new Date().toISOString(),
  };
}
