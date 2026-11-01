// The first run problem.
//
// Routing is learned from what the models have done, which is a fine design
// with one hole in it: on a fresh install nothing has done anything, so the
// first real request walks a list in no particular order and the person
// watching has no idea which of their models work.
//
// So the proxy warms up before it says it is ready. One small tool-calling
// request per model, which is the shape nearly every Claude Code request
// takes, and the result goes into the same record everything else uses. It is
// not a separate capability store and not a different kind of knowledge: it
// is the same evidence, gathered a minute earlier than it otherwise would be.
//
// Most of that is now free. models.dev publishes whether a model calls tools
// and whether it reads images, so those models are not asked at all. What is
// left is the part nobody has published:
//
//   - a model the catalogue has never heard of: anything local, fine-tuned,
//     or renamed by a gateway. The probe is the only thing that catches a
//     model name that does not exist before a session is wasted on it.
//   - whether a backend takes a PDF. There is no published field for it,
//     because it is a property of the endpoint rather than the model.
//
// Models are probed one per provider at a time: in parallel across providers
// so it finishes quickly, sequential within one so a single key does not get
// a dozen requests at once and answer with rate limits that mean nothing.
import { record, statsFor } from "./stats.js";
import { pickModels } from "./translate.js";
import { displayName } from "./config.js";
import { catalogSays } from "./modelsdev.js";

const PROBE_TIMEOUT_MS = 60000;

// The run is only as long as its slowest provider, because models within one
// provider go one at a time. A provider with eight models needs eight probes'
// worth of runway; a flat 180s cut the tail off its queue.
const MAX_DEADLINE_MS = 600000;
export const deadlineFor = (longestQueue) =>
  Math.min(Math.max(longestQueue, 1) * PROBE_TIMEOUT_MS, MAX_DEADLINE_MS);

// A tool small enough to be free and specific enough that a capable model
// will call it rather than answer in prose.
// A 16x16 solid grey PNG. Deliberately not a 1x1: some backends reject a
// single pixel as unusable and the answer then says nothing about whether the
// model can see.
const PNG_16 =
  "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFElEQVR4nGNoIBEwjGoY1TB8NQAAJYSAEGy7FvQAAAAASUVORK5CYII=";

// A 1-page PDF containing the word "opencc". Built by hand because the whole
// point is that it is small enough to paste into a source file.
const PDF_MIN =
  "JVBERi0xLjQKMSAwIG9iago8PC9UeXBlL0NhdGFsb2cvUGFnZXMgMiAwIFI+PgplbmRvYmoKMiAw" +
  "IG9iago8PC9UeXBlL1BhZ2VzL0tpZHNbMyAwIFJdL0NvdW50IDE+PgplbmRvYmoKMyAwIG9iago8" +
  "PC9UeXBlL1BhZ2UvUGFyZW50IDIgMCBSL01lZGlhQm94WzAgMCA5OSA5OV0vQ29udGVudHMgNCAw" +
  "IFIvUmVzb3VyY2VzPDwvRm9udDw8L0YxIDUgMCBSPj4+Pj4+CmVuZG9iago0IDAgb2JqCjw8L0xl" +
  "bmd0aCA0ND4+CnN0cmVhbQpCVCAvRjEgMTIgVGYgMTAgNTAgVGQgKG9wZW5jYykgVGogRVQKZW5k" +
  "c3RyZWFtCmVuZG9iago1IDAgb2JqCjw8L1R5cGUvRm9udC9TdWJ0eXBlL1R5cGUxL0Jhc2VGb250" +
  "L0hlbHZldGljYT4+CmVuZG9iagp0cmFpbGVyCjw8L1Jvb3QgMSAwIFI+Pgo=";

// One probe per kind of request, each the smallest thing that still proves
// the model can do it.
const PROBE_BODIES = {
  tools: {
    messages: [{
      role: "user",
      content: "Call the ping tool with the word hello. Do not reply in prose.",
    }],
    tools: [{
      type: "function",
      function: {
        name: "ping",
        description: "Reply to a ping with a word",
        parameters: {
          type: "object",
          properties: { word: { type: "string", description: "Any word" } },
          required: ["word"],
        },
      },
    }],
    tool_choice: "auto",
  },
  // The smallest valid PDF that still has a page and a word on it.
  document: {
    messages: [{
      role: "user",
      content: [
        { type: "text", text: "What word is in this PDF? Answer in one word." },
        { type: "file", file: { filename: "probe.pdf", file_data: `data:application/pdf;base64,${PDF_MIN}` } },
      ],
    }],
  },
  image: {
    messages: [{
      role: "user",
      content: [
        { type: "text", text: "What colour is this image? Answer in one word." },
        { type: "image_url", image_url: { url: `data:image/png;base64,${PNG_16}` } },
      ],
    }],
  },
};

// Only the models nothing can answer for yet.
//
// Two ways to already have the answer: opencc has asked this model something
// of this kind before, or models.dev publishes it. Either way there is no
// case for spending a request to find out again — which, for a typical set of
// models, leaves only the handful the catalogue has never heard of.
export function pendingModels(providers, kind = "tools", lookup = statsFor, says = catalogSays) {
  return providers
    .filter((provider) => !provider.disabled)
    .map((provider) => ({
      provider,
      models: pickModels("", provider).filter((model) => {
        const entry = lookup(provider.baseUrl, model, kind);
        if (entry && entry.ok + entry.fail > 0) return false;
        return says(provider.baseUrl, model, kind) === null;
      }),
    }))
    .filter((group) => group.models.length > 0);
}

// Providers say why in a dozen different shapes: a JSON envelope, a bare
// string, or a whole HTML error page. Pull out the sentence if there is one,
// and failing that collapse whatever came back onto a single line, because a
// 403 from Google is an entire document and printed raw it tears the progress
// display apart.
export function reason(body) {
  try {
    const parsed = JSON.parse(body);
    // Seen in the wild, in this order of preference: OpenAI's envelope,
    // a bare message, RFC 7807 problem details ("detail"/"title"), and a
    // plain string under "error".
    for (const candidate of [
      parsed?.error?.message, parsed?.message, parsed?.detail, parsed?.title, parsed?.error,
    ]) {
      if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
    }
  } catch {
    // Not JSON, so fall through to the flattened text.
  }
  return body.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

// Exported because the panel's Test button runs exactly this. It used to
// send a bare "Hi" and record it under "text" — a bucket the panel does not
// show and Claude Code never produces — so a model could pass Test and still
// be useless for every real request.
export async function probeModel(provider, model, kind = "tools", signal) {
  const headers = { "Content-Type": "application/json" };
  if (provider.apiKey) headers.Authorization = `Bearer ${provider.apiKey}`;

  const startedAt = Date.now();
  try {
    const res = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({ model, ...PROBE_BODIES[kind] }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(PROBE_TIMEOUT_MS)].filter(Boolean)),
    });

    const took = Date.now() - startedAt;
    if (!res.ok) return { ok: false, status: res.status, took, error: reason(await res.text()) };

    // Whether it actually reached for the tool, rather than answering in
    // prose. Both count as the request having worked, which is what the
    // record is about, but the difference is worth showing: a model that
    // never calls a tool is not much use to Claude Code.
    let calledTool = false;
    try {
      const body = await res.json();
      calledTool = Boolean(body?.choices?.[0]?.message?.tool_calls?.length);
    } catch {
      // A 200 that isn't JSON is odd but it still answered.
    }
    return { status: res.status, took, calledTool };
  } catch (err) {
    return { ok: false, status: 0, took: Date.now() - startedAt, error: err.message };
  }
}

// Runs the warm-up and reports as it goes. `onEvent` is called with
// {type: "start"|"result"|"done", ...} so the caller decides how to show it.
export async function warmUp(providers, {
  kind = "tools",
  onEvent = () => {},
  deadlineMs,
  save = record,
} = {}) {
  const groups = pendingModels(providers, kind);
  const total = groups.reduce((n, g) => n + g.models.length, 0);
  const deadline = deadlineMs ?? deadlineFor(Math.max(0, ...groups.map((g) => g.models.length)));

  if (total === 0) {
    onEvent({ type: "done", kind, total: 0, results: [] });
    return [];
  }

  onEvent({ type: "start", kind, total, providers: groups.length });

  // One abort for the whole run, so a slow provider cannot hold up the start
  // of the proxy indefinitely.
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), deadline);

  const results = [];
  let done = 0;

  await Promise.all(groups.map(async ({ provider, models }) => {
    for (const model of models) {
      if (stop.signal.aborted) {
        results.push({ provider, model, skipped: true });
        continue;
      }
      const outcome = await probeModel(provider, model, kind, stop.signal);

      // A probe the run deadline cut short says nothing about the model: it
      // never got its full turn. Recording it would teach the router to avoid
      // a model for being late in a queue.
      if (stop.signal.aborted && !outcome.ok && outcome.status === 0) {
        results.push({ provider, model, skipped: true });
        continue;
      }

      save({ baseUrl: provider.baseUrl, model, kind, status: outcome.status, ms: outcome.took });
      done += 1;
      const result = { provider, model, ...outcome };
      results.push(result);
      onEvent({ type: "result", kind, done, total, ...result });
    }
  }));

  clearTimeout(timer);
  onEvent({ type: "done", kind, total, results });
  return results;
}

// The terminal view of the above.
//
// A result that went fine is worth one line of progress while you wait and
// nothing afterwards, so on a terminal it overwrites itself and only the
// failures stay on screen. Piped to a file there is nothing to overwrite, so
// it falls back to one line each.
export function printingReporter(out = process.stdout) {
  const live = Boolean(out.isTTY);
  const write = (text) => out.write(text);
  const line = (text) => out.write(`${text}\n`);
  const clear = () => live && out.write("\r\u001b[2K");

  const fit = (text, n) => (text.length > n ? `${text.slice(0, n - 1)}\u2026` : text);

  return (event) => {
    if (event.type === "start") {
      line("");
      const what = { tools: "tool calling", image: "images", document: "PDFs" }[event.kind] ?? event.kind;
      line(`  testing ${event.total} models for ${what}, across ${event.providers} providers`);
      return;
    }

    if (event.type === "result") {
      clear();
      const where = `${displayName(event.provider)} ${event.model}`;
      const secs = `${(event.took / 1000).toFixed(1)}s`;

      // Failures stay. They are the reason to be reading this at all.
      if (event.skipped) {
        line(`  ${fit(where, 44)}  skipped, out of time`);
      } else if (!(event.status >= 200 && event.status < 300)) {
        const why = event.status === 0 ? "no answer" : event.status;
        line(`  ${fit(where, 44).padEnd(44)}  ${why}  ${fit(event.error ?? "", 64)}`.trimEnd());
      } else if (!live) {
        const how = event.kind === "tools" && !event.calledTool ? "answered, no tool call" : "ok";
        line(`  ${fit(where, 44).padEnd(44)}  ${how}  ${secs}`);
      }

      if (live && event.done < event.total) {
        write(`  [${event.done}/${event.total}] ${fit(where, 44)}`);
      }
      return;
    }

    if (event.type === "done" && event.total > 0) {
      clear();
      const ok = event.results.filter((r) => r.status >= 200 && r.status < 300);
      const cut = event.results.filter((r) => r.skipped).length;
      line(event.kind === "tools"
        ? `  ${ok.length} of ${event.total} answered, ${ok.filter((r) => r.calledTool).length} called the tool`
        : `  ${ok.length} of ${event.total} answered`);
      if (cut > 0) line(`  ${cut} ran out of time and were left untested`);
      if (ok.length === 0) line("  nothing answered. check your keys and model names in the panel");
    }
  };
}
