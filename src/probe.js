// Best effort: asks a server how big the loaded context window is, and what
// the server is. Only a server that is one of these is treated as a model
// server on this machine or network; an address (localhost, 192.168...) says
// nothing about it (a proxy there may serve Gemini).
import { windowOf } from "./providers.js";
import { learnServer } from "./learned.js";

const n = (x) => (Number(x) > 0 ? Number(x) : undefined);

async function getJson(provider, url, init, timeout = 5000) {
  const headers = { "Content-Type": "application/json", ...(provider.apiKey && { Authorization: `Bearer ${provider.apiKey}` }) };
  const res = await fetch(url, { ...init, headers, signal: AbortSignal.timeout(timeout) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// { size, server }: server is llama.cpp, lmstudio, ollama, ollama-cloud,
// vllm, or null.
export async function contextSize(provider, model) {
  const base = provider.baseUrl.replace(/\/+$/, "");
  const root = base.replace(/\/v1$/, "");
  const host = new URL(root).hostname;
  const tries = [
    async () => {
      const p = await getJson(provider, root + "/props");
      if (p.default_generation_settings || "n_ctx" in p) return { size: n(p.default_generation_settings?.n_ctx ?? p.n_ctx), server: "llama.cpp" };
    },
    async () => {
      const m = await getJson(provider, `${root}/api/v0/models/${encodeURIComponent(model)}`);
      return { size: n(m.loaded_context_length ?? m.max_context_length), server: "lmstudio" };
    },
    async () => {
      // Ollama (it answers /api/version), or Ollama's cloud (ollama.com): the
      // window of the model as loaded now, else its num_ctx, else on this
      // machine Ollama's default and in the cloud the model's own length.
      const cloud = host === "ollama.com" || host.endsWith(".ollama.com");
      if (!cloud) await getJson(provider, root + "/api/version");
      const ps = cloud ? null : await getJson(provider, root + "/api/ps").catch(() => null);
      const loaded = ps?.models?.find((m) => m.name === model || m.model === model)?.context_length;
      const s = await getJson(provider, root + "/api/show", { method: "POST", body: JSON.stringify({ model }) }).catch(() => null);
      const set = /num_ctx\s+(\d+)/.exec(s?.parameters ?? "")?.[1];
      const trained = Object.entries(s?.model_info ?? {}).find(([k]) => k.endsWith(".context_length"))?.[1];
      return { size: n(loaded) ?? n(set) ?? (cloud ? n(trained) : s ? 4096 : undefined), server: cloud ? "ollama-cloud" : "ollama" };
    },
    async () => {
      const d = await getJson(provider, base + "/models");
      const m = (d.data ?? d.models ?? []).find((x) => x.id === model || x.name === model);
      return { size: n(windowOf(m)), server: m?.owned_by === "vllm" || m?.max_model_len ? "vllm" : null };
    },
  ];
  let server = null;
  for (const t of tries) {
    try {
      const r = await t();
      if (r?.server) server ??= r.server;
      if (r?.size) return { size: r.size, server: server ?? r.server ?? null };
    } catch {
      // Not that kind of server; try the next.
    }
  }
  return { size: undefined, server };
}

// Asked once per model a day, when a request first goes to it, without
// holding that request up. The answer is kept (learned.js) and read the next
// time the window is needed.
const asked = new Map();
export function probeSoon(provider, model, now = Date.now()) {
  const key = `${provider.baseUrl}\u0000${model}`;
  if (now - (asked.get(key) ?? -Infinity) < 86_400_000) return;
  asked.set(key, now);
  contextSize(provider, model).then((r) => { if (r.size || r.server) learnServer(provider.baseUrl, model, r); }, () => {});
}
