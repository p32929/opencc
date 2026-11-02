// Everything about a provider that is not HTTP routing: how its name and
// address are cleaned, how its model list is read, what its own list says
// each model costs, and the three things you can ask it to do — answer a
// "Hello", answer a test, and state its context window.
//
// Ported from HeartCode's settings server, because providers disagree about
// all of this and HeartCode already learned how.
import { readStoredConfig, writeStoredConfig } from "./configStore.js";
import {
  providersFromEnv, streamingFromEnv, rankFromEnv, testTimeoutFromEnv, testLanesFromEnv,
} from "./config.js";

// --- names and addresses ---------------------------------------------------

// What a provider's key looks like where it is shown. The page never receives
// the key itself: an edit that leaves the key box empty keeps the one it has.
export const mask = (key) => (key ? (key.length > 12 ? `${key.slice(0, 4)}…${key.slice(-4)}` : "…") : "");

// A provider's name is how everything addresses it, so it is lower case and
// made of letters, digits, dashes and underscores.
export const safeName = (name) =>
  String(name ?? "").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");

// An address typed without http:// or https://: whichever the server answers
// on, https first. Any answer at all, even a 401, means it is there. If
// neither answers it is https anyway: a key is never sent in the clear on a
// guess.
export async function schemeFor(address) {
  const bare = address.replace(/\/+$/, "");
  try {
    await fetch(`https://${bare}/models`, { redirect: "manual", signal: AbortSignal.timeout(8000) });
  } catch (err) {
    // https cannot connect at all (refused, or a server that only speaks
    // http): http, if that answers.
    if (err.name !== "TimeoutError") {
      try {
        await fetch(`http://${bare}/models`, { redirect: "manual", signal: AbortSignal.timeout(8000) });
        return `http://${address}`;
      } catch {
        // Neither: fall through to https.
      }
    }
  }
  return `https://${address}`;
}

// --- what a provider's own model list says ---------------------------------

const cfPrice = (m, unit) =>
  Array.isArray(m.properties)
    ? m.properties.find((p) => p?.property_id === "price")?.value?.find?.((v) => unit.test(v?.unit ?? ""))?.price
    : undefined;

// What a model costs at this provider, per million tokens, as its own list
// says: { input, output } (either may be missing), or undefined. Not
// models.dev's: the same model costs differently at different providers.
//
// The forms lists use: pricing.prompt/completion (per token, OpenRouter's);
// pricing.input/output with a unit; input_price/output_price (per token);
// pricepermilliontokens (in cents: api.airforce's 88 is its own 880000
// micro-dollars); Cloudflare's properties ("per M input tokens"); and only a
// free tier (is_free, or a tier named free). A list's "free tier" with a
// price is a plan that may use it, not a model that costs nothing.
export function listedPrice(m) {
  // -1 means "varies" (a router's "auto"), which is not a price.
  const num = (x) => (x === null || x === undefined || x === "" || !(Number(x) >= 0) ? undefined : Number(x));
  const pr = m.pricing && typeof m.pricing === "object" && !Array.isArray(m.pricing) ? m.pricing : {};
  const unit = (x) => (pr.unit ? (/1m|million/i.test(pr.unit) ? 1 : 1e6) : x < 0.001 ? 1e6 : 1);

  for (const [i, o, k] of [
    [num(pr.prompt), num(pr.completion), () => 1e6],
    [num(pr.input), num(pr.output), unit],
    [num(m.input_price), num(m.output_price), () => 1e6],
    [num(m.pricepermilliontokens), num(m.output_pricepermilliontokens), () => 0.01],
    [num(cfPrice(m, /^per M input tokens$/i)), num(cfPrice(m, /^per M output tokens$/i)), () => 1],
  ]) {
    if (i === undefined && o === undefined) continue;
    const per = (x) => (x === undefined ? undefined : Number((x * k(x)).toPrecision(6)));
    return { input: per(i), output: per(o) };
  }
  if (m.is_free === true || m.tier === "free" || m.access_tier === "free") return { input: 0, output: 0 };
  return undefined;
}

// A model's window from a /models entry, whatever the provider calls it.
// OpenRouter and Together: context_length (and top_provider.context_length).
// vLLM: max_model_len. Groq: context_window. Mistral: max_context_length.
// LiteLLM: max_input_tokens. Gemini: inputTokenLimit.
export function windowOf(m) {
  if (!m) return undefined;
  const n = [
    m.context_length, m.top_provider?.context_length, m.max_model_len, m.context_window,
    m.max_context_length, m.max_input_tokens, m.inputTokenLimit, m.context_size, m.n_ctx,
    m.meta?.n_ctx_train,
  ].map(Number).find((x) => x > 0);
  return n;
}

// The entries of a /models answer, whichever shape it came in. Cloudflare's
// is { result: [...] } where the id is an internal one and the name is the
// model's; Gemini's native is { models: [...] }; most are { data: [...] };
// some are a bare array.
export function listEntries(data) {
  if (Array.isArray(data)) return data.filter((m) => m && (m.id ?? m.name));
  if (Array.isArray(data?.result)) return data.result.filter((m) => m?.name).map((m) => ({ ...m, id: m.name }));
  return (data?.data ?? data?.models ?? []).filter((m) => m && (m.id ?? m.name));
}

// What the provider's list says about one entry, for the page's tooltips and
// its Free only and price sort. Only what it actually said.
export function entryDetails(m) {
  const id = String(m.id ?? m.name);
  const created = Number(m.created);
  const clean = {
    name: m.name && String(m.name) !== id ? String(m.name) : undefined,
    context: windowOf(m),
    owner: m.owned_by && m.owned_by !== "system" ? String(m.owned_by) : undefined,
    // Seconds; anything before 2000 is not a date.
    created: created > 946684800 ? created * 1000 : undefined,
    description: m.description ? String(m.description).slice(0, 400) : undefined,
    price: listedPrice(m),
  };
  for (const key of Object.keys(clean)) if (clean[key] === undefined) delete clean[key];
  return clean;
}

// --- talking to a provider -------------------------------------------------

const authHeaders = (provider, extra = {}) => ({
  "Content-Type": "application/json",
  ...(provider.apiKey && { Authorization: `Bearer ${provider.apiKey}` }),
  ...extra,
});

const root = (provider) => provider.baseUrl.replace(/\/+$/, "");

// Providers say why in a dozen shapes: a JSON envelope, a bare string, or a
// whole HTML page. The sentence if there is one, otherwise the text flattened
// onto a line, because a 403 from Google is a document.
export function reasonFrom(body) {
  try {
    const parsed = [JSON.parse(body)].flat()[0];
    for (const candidate of [
      parsed?.error?.message, parsed?.message, parsed?.detail, parsed?.title, parsed?.error,
    ]) {
      if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
    }
  } catch {
    // Not JSON: fall through to the flattened text.
  }
  return String(body ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 300);
}

// The provider's own model list: the raw entries, or an error that says why.
export async function fetchModelEntries(provider, timeout = 10000) {
  const res = await fetch(`${root(provider)}/models`, {
    headers: authHeaders(provider),
    signal: AbortSignal.timeout(timeout),
  });
  const text = await res.text().catch(() => "");
  if (!res.ok) {
    const err = new Error(`${res.status}: ${reasonFrom(text) || "no reason given"}`);
    err.status = res.status;
    throw err;
  }
  try {
    return listEntries(JSON.parse(text));
  } catch {
    throw new Error("its model list is not JSON");
  }
}

// "Hello" to a model, and exactly what was sent and what came back, for the
// page to show. Not streamed, so the answer is the provider's own JSON. The
// key is masked in what is sent.
export async function hello(provider, model, timeoutMs) {
  const url = `${root(provider)}/chat/completions`;
  const body = { model, messages: [{ role: "user", content: "Hello" }] };
  const sent = {
    method: "POST", url,
    headers: authHeaders({ apiKey: provider.apiKey ? mask(provider.apiKey) : "" }),
    body,
  };

  const startedAt = Date.now();
  try {
    const res = await fetch(url, {
      method: "POST", headers: authHeaders(provider), body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      // An HTML error page, most likely. Shown as it came.
    }
    const reply = parsed?.choices?.[0]?.message?.content ?? null;
    return {
      sent,
      received: {
        status: res.status, ok: res.ok, ms: Date.now() - startedAt,
        type: res.headers.get("content-type"), body: parsed ?? text.slice(0, 20000),
      },
      reply,
    };
  } catch (err) {
    const timedOut = err.name === "TimeoutError";
    return {
      sent,
      received: {
        error: timedOut
          ? `no answer within ${Math.round(timeoutMs / 1000)} seconds`
          : `couldn't send it: ${err.cause?.code || err.cause?.message || err.message}`,
        ms: Date.now() - startedAt,
      },
    };
  }
}

// The text of a streamed reply, read to the end: what the model said, whether
// it reached for a tool, and what it says it wrote.
async function readStream(res) {
  const decoder = new TextDecoder();
  let buffer = "";
  const out = { content: "", reasoning: "", tools: 0, tokens: undefined };

  const take = (line) => {
    if (!line.startsWith("data:")) return;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") return;
    let chunk;
    try {
      chunk = JSON.parse(payload);
    } catch {
      return;
    }
    const delta = chunk.choices?.[0]?.delta ?? chunk.choices?.[0]?.message ?? {};
    if (typeof delta.content === "string") out.content += delta.content;
    out.reasoning += delta.reasoning_content ?? delta.reasoning ?? "";
    if (delta.tool_calls?.length) out.tools += delta.tool_calls.length;
    if (chunk.usage?.completion_tokens) out.tokens = chunk.usage.completion_tokens;
  };

  for await (const part of res.body) {
    buffer += decoder.decode(part, { stream: true });
    let at;
    while ((at = buffer.indexOf("\n")) >= 0) {
      take(buffer.slice(0, at).trim());
      buffer = buffer.slice(at + 1);
    }
  }
  take(buffer.trim());
  return out;
}

// One short message to a model, to see that it really answers: the key, the
// access to it, its name, the server itself. Never throws.
//
// Streamed with no max_tokens, which is what HeartCode sends. On a single
// request that makes no difference; with a hundred in flight a buffered reply
// holds its connection until the provider has written all of it, and a
// hundred of those through one gateway queue behind each other.
export async function tryModel(provider, model, timeoutMs) {
  const body = {
    model,
    messages: [{ role: "user", content: "Reply with just the word OK." }],
    stream: true,
  };
  const startedAt = Date.now();
  try {
    const res = await fetch(`${root(provider)}/chat/completions`, {
      method: "POST", headers: authHeaders(provider), body: JSON.stringify(body),
      // Covers reading the body too: a stream that stays open is cut here.
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!res.ok) {
      const after = Number(res.headers.get("retry-after"));
      // The status is already known. A gateway can close the connection while
      // the error body is still being read, and when that threw the 404 was
      // lost and shown as "couldn't reach it", which sends you looking at the
      // network instead of at the model name.
      const text = await res.text().catch(() => "");
      return {
        ok: false, status: res.status, ms: Date.now() - startedAt,
        error: reasonFrom(text) || `HTTP ${res.status}`,
        ...(after > 0 && { retryAfter: after }),
      };
    }

    const type = res.headers.get("content-type") ?? "";
    let reply;
    let tools = 0;
    let tokens;
    if (/json/i.test(type)) {
      // A provider that ignored stream: true and sent the whole thing.
      const parsed = await res.json().catch(() => null);
      const message = parsed?.choices?.[0]?.message ?? {};
      reply = String(message.content ?? "").trim();
      tools = message.tool_calls?.length ?? 0;
      tokens = parsed?.usage?.completion_tokens;
    } else {
      const read = await readStream(res);
      reply = read.content.trim();
      tools = read.tools;
      tokens = read.tokens;
    }

    const ms = Date.now() - startedAt;
    // A 200 that says nothing is not an answer.
    if (!reply && !tools) {
      return {
        ok: false, status: res.status, ms,
        error: `it answered with nothing${tokens ? ` (${tokens} tokens it said it wrote)` : ""}`,
      };
    }
    return { ok: true, status: res.status, ms, reply: reply.slice(0, 80) };
  } catch (err) {
    const ms = Date.now() - startedAt;
    if (err.name === "TimeoutError") {
      return { ok: false, status: 0, ms, error: `no answer within ${Math.round(timeoutMs / 1000)} seconds` };
    }
    return {
      ok: false, status: 0, ms,
      error: `couldn't reach it: ${err.cause?.code || err.cause?.message || err.message}`,
    };
  }
}

// --- the context window ----------------------------------------------------

// How servers say the limit: OpenAI and vLLM, Mistral, llama.cpp,
// Anthropic-style, Gemini, "context window of N", Groq's per-request cap.
const LIMIT_IN_MESSAGE = [
  /maximum context length is (\d+)/i,
  /(\d+) maximum context length/i,
  /available context size \((\d+)/i,
  /> ?(\d+) maximum/i,
  /allowed \((\d+)\)/i,
  /context (?:window|length|size) (?:of|is) (\d+)/i,
  /\bLimit (\d+)/,
];

const TOO_LARGE =
  /\b(request|prompt|input|message|messages|context|payload|body)\b[^.]{0,30}\btoo (large|long|big)|reduce the length|reduce your message|context length|context window|context size|too many (input )?tokens|exceeds? the (maximum|available|context)|maximum (number of )?(input |context )?tokens/i;

// The limit when the error states it: { tokens, rate } (rate: a per-minute cap
// on your account, not the model's window), or null. A guess is not learned
// from: with no number in it there is nothing to take.
export function limitSaid({ status, message }) {
  const big = status === 413 || (status >= 400 && status < 500 && TOO_LARGE.test(message));
  if (!big) return null;
  const n = Number(LIMIT_IN_MESSAGE.map((re) => re.exec(message)?.[1]).find(Boolean));
  return n > 0
    ? { tokens: n, rate: /per (minute|hour|day)|tokens per (min|hour|day)|\bTP[MHD]\b|rate.?limit|quota/i.test(message) }
    : null;
}

// Ask a model how big its window is by sending it far more than any model
// takes. A server refuses it with its limit in the error, and a refused
// request is not charged. One that does take it is stopped at once.
export async function measureContext(provider, model, { tokens = 2_200_000, timeoutMs = 180000 } = {}) {
  const stop = new AbortController();
  const body = JSON.stringify({ model, messages: [{ role: "user", content: "a ".repeat(tokens) }], stream: true });

  let res;
  try {
    res = await fetch(`${root(provider)}/chat/completions`, {
      method: "POST", headers: authHeaders(provider), body,
      signal: AbortSignal.any([stop.signal, AbortSignal.timeout(timeoutMs)]),
    });
  } catch (err) {
    return { error: `couldn't send it: ${err.cause?.code || err.cause?.message || err.message}` };
  }

  if (res.ok) {
    stop.abort();
    return { over: tokens };
  }

  const text = await res.text().catch(() => "");
  const said = limitSaid({ status: res.status, message: `${res.status} ${text.slice(0, 4000)}` });
  if (said && !said.rate) return { limit: said.tokens };
  return {
    error: `${res.status}: ${reasonFrom(text).slice(0, 300)}` +
      (said?.rate ? " (a per-minute cap on your account, not the window)" : ""),
  };
}

// --- changing the config ---------------------------------------------------

// Every change is read, changed and written in one synchronous step, so two
// requests cannot interleave and the page can never overwrite a change it
// has not seen. The page used to send the whole config on every edit, which
// lost whatever another tab, or a test run, had changed in the meantime.
export function loadConfig() {
  const stored = readStoredConfig();
  const providers = providersFromEnv(stored);

  // A provider with no name still needs one to be addressed by.
  const taken = new Set(providers.map((p) => p.name).filter(Boolean));
  for (const provider of providers) {
    if (provider.name) continue;
    const host = (() => {
      try {
        return new URL(provider.baseUrl).hostname;
      } catch {
        return "provider";
      }
    })();
    let name = safeName(host) || "provider";
    for (let n = 2; taken.has(name); n++) name = `${safeName(host) || "provider"}-${n}`;
    taken.add(name);
    provider.name = name;
  }

  return {
    providers,
    port: stored.PORT || "3000",
    streaming: streamingFromEnv(stored),
    rank: rankFromEnv(stored),
    testTimeout: testTimeoutFromEnv(stored),
    testLanes: testLanesFromEnv(stored),
  };
}

export function edit(mutate) {
  const cfg = loadConfig();
  const result = mutate(cfg);
  writeStoredConfig(cfg);
  return result;
}

const find = (cfg, name) => {
  const provider = cfg.providers.find((p) => p.name === name);
  if (!provider) throw new Error(`no provider "${name}"`);
  return provider;
};

// Add a provider, or change one (`was`: the name it had, if it is being
// renamed). The key box empty means keep the key it has. Returns the
// provider's new name, and the old one if it changed.
export async function saveProvider(input) {
  const name = safeName(input.name);
  if (!name) throw new Error("a name is needed");

  let baseUrl = String(input.baseUrl ?? "").trim();
  if (!baseUrl) throw new Error("an address is needed");
  if (!/^https?:\/\//i.test(baseUrl)) baseUrl = await schemeFor(baseUrl);
  try {
    if (!new URL(baseUrl).hostname) throw new Error();
  } catch {
    throw new Error(`"${baseUrl}" is not a URL`);
  }
  baseUrl = baseUrl.replace(/\/+$/, "");

  return edit((cfg) => {
    const old = input.was ? find(cfg, input.was) : undefined;
    if (cfg.providers.some((p) => p.name === name && p !== old)) {
      throw new Error(`there is a provider named "${name}" already`);
    }

    const apiKey = input.keepKey ? old?.apiKey ?? "" : String(input.apiKey ?? "").trim();

    if (old) {
      // Its list switch, its models and the ones added by name all stay.
      const renamed = old.name !== name;
      const wasUrl = old.baseUrl;
      Object.assign(old, { name, baseUrl, apiKey });
      if (renamed || wasUrl !== baseUrl) {
        cfg.rank = cfg.rank.map((url) => (url === wasUrl ? baseUrl : url));
      }
      return { name, was: input.was, created: false };
    }

    cfg.providers.push({
      name, baseUrl, apiKey, models: [], disabled: false, disabledModels: [], list: true, added: [],
    });
    return { name, created: true };
  });
}

export function deleteProvider(name) {
  return edit((cfg) => {
    const gone = find(cfg, name);
    cfg.providers = cfg.providers.filter((p) => p !== gone);
    cfg.rank = cfg.rank.filter((url) => url !== gone.baseUrl);
    return { name };
  });
}

// Switch a provider on or off: kept, with its key and its models, but skipped
// until it is on again.
export function setProviderOn(name, on) {
  return edit((cfg) => {
    find(cfg, name).disabled = !on;
  });
}

// Whether to ask a provider for its model list: one, or every provider when
// no name is given.
export function setProviderList(name, on) {
  return edit((cfg) => {
    const targets = name === undefined ? cfg.providers : [find(cfg, name)];
    for (const provider of targets) provider.list = Boolean(on);
    return targets.map((p) => p.name);
  });
}

// A model added by name, remembered so the provider's row keeps it; or one
// forgotten; or every one forgotten at once.
export function setAdded(name, { model, remove, all }) {
  return edit((cfg) => {
    const provider = find(cfg, name);
    if (all) {
      const gone = new Set(provider.added);
      provider.added = [];
      return [...gone];
    }
    const id = String(model ?? "").trim();
    if (!id) throw new Error("a model is needed");
    const rest = provider.added.filter((m) => m !== id);
    provider.added = remove ? rest : [...rest, id];
    return [id];
  });
}

// Models in and out of the pot, and parked. By provider name, so adding or
// removing one cannot disturb another, and a delete cannot shift the rest.
export function potAdd(items) {
  return edit((cfg) => {
    let n = 0;
    for (const { provider, model } of items) {
      const target = find(cfg, provider);
      const id = String(model ?? "").trim();
      if (!id) throw new Error("a model is needed");
      if (!target.models.includes(id)) {
        target.models.push(id);
        n += 1;
      }
    }
    return n;
  });
}

export function potRemove(items) {
  return edit((cfg) => {
    let n = 0;
    for (const { provider, model } of items) {
      const target = find(cfg, provider);
      const at = target.models.indexOf(model);
      if (at < 0) continue;
      target.models.splice(at, 1);
      target.disabledModels = target.disabledModels.filter((m) => m !== model);
      n += 1;
    }
    return n;
  });
}

export function potPark(provider, model, parked) {
  return edit((cfg) => {
    const target = find(cfg, provider);
    const rest = target.disabledModels.filter((m) => m !== model);
    target.disabledModels = parked ? [...rest, model] : rest;
  });
}

// The settings that are not about a provider.
export function saveSettings(input) {
  return edit((cfg) => {
    if (input.port !== undefined) cfg.port = String(input.port || "3000");
    if (input.streaming !== undefined) cfg.streaming = input.streaming !== false;
    if (Array.isArray(input.rank)) cfg.rank = input.rank;
    if (input.testTimeout !== undefined) cfg.testTimeout = testTimeoutFromEnv({ TEST_TIMEOUT: input.testTimeout });
    if (input.testLanes !== undefined) cfg.testLanes = testLanesFromEnv({ TEST_LANES: input.testLanes });
  });
}
