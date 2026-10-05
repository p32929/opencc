import { GLOBAL_CONFIG_PATH } from "./paths.js";
import { readStoredConfig, writeStoredConfig } from "./configStore.js";
import { providersFromEnv, displayName } from "./config.js";
import { menu, prompt, confirm, pause, withSpinner, dim, bold, red, green, cyan } from "./tui.js";

// Sends a minimal real request ("Hi") to confirm the base URL, key and model
// actually work together — rather than only finding out later, mid Claude
// Code session, that something was typed wrong.
async function testModel(provider, model) {
  try {
    const headers = { "Content-Type": "application/json" };
    if (provider.apiKey) headers.Authorization = `Bearer ${provider.apiKey}`;

    const res = await fetch(`${provider.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({ model, messages: [{ role: "user", content: "Hi" }], max_tokens: 10 }),
      signal: AbortSignal.timeout(300000),
    });

    if (!res.ok) return { ok: false, error: `${res.status} ${(await res.text()).slice(0, 160)}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

const testableModels = (provider) => [
  ...new Set([...provider.bigModels, ...provider.smallModels]),
];

// Runs `work` over `items` with at most `limit` in flight. Testing used to be
// strictly sequential, which meant 17 models behind a 300s timeout each —
// potentially over an hour for a run that takes well under a minute in
// parallel. Capped rather than unbounded so we don't look like an attack.
async function mapLimit(items, limit, work) {
  const results = new Array(items.length);
  let next = 0;

  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await work(items[i], i);
    }
  };

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

const TEST_CONCURRENCY = 6;

// Tests every model in both priority lists, since any of them can be the one
// that actually serves a request.
async function testModels(jobs) {
  let done = 0;

  const run = mapLimit(jobs, TEST_CONCURRENCY, async ({ provider, model }) => {
    const result = await testModel(provider, model);
    done += 1;
    return { provider, model, result };
  });

  // One spinner for the whole run; the per-model lines are printed after, so
  // finished output can't fight the animation for the same line.
  await withSpinner(() => `Testing ${jobs.length} model(s) — ${done}/${jobs.length} done`, run);
  const results = await run;

  for (const { provider, model, result } of results) {
    console.log(
      `  ${displayName(provider)} · ${model} ... ${result.ok ? green("OK") : red(`FAILED — ${result.error}`)}`,
    );
  }

  return results.every(({ result }) => result.ok);
}

function maskKey(key) {
  if (!key) return dim("(none)");
  return key.length <= 10 ? "•".repeat(key.length) : `${key.slice(0, 4)}${"•".repeat(6)}${key.slice(-4)}`;
}

const FIELDS = [
  { id: "baseUrl", label: "Base URL", hint: "e.g. https://openrouter.ai/api/v1" },
  { id: "apiKey", label: "API key", hint: "leave empty if the backend needs none (e.g. local Ollama)", empty: "(none)" },
  {
    id: "bigModels",
    label: "Big models (Opus, Sonnet)",
    list: true,
    hint: "do the real work — comma-separated, tried in order",
  },
  {
    id: "smallModels",
    label: "Small models (Haiku)",
    list: true,
    hint: "cheap background tasks, comma-separated; empty = same as the big models",
    empty: "(same as big)",
  },
  { id: "name", label: "Name", hint: "optional — what to call this one; empty uses the host" },
];

// Column the value text starts at in the provider menu: the pointer and its
// space, the label padded to the widest one, and the two spaces the menu puts
// before a value. Continuation lines are padded to match so a wrapped model
// list stays in its column.
const VALUE_COLUMN = 2 + Math.max(...FIELDS.map((field) => field.label.length)) + 2;

// Splits a comma-separated list across as many lines as it needs, given how
// much room is left to the right of the label.
function wrapInline(models, column) {
  const width = Math.max(20, (process.stdout.columns || 80) - column - 1);
  const lines = [];
  let line = "";

  models.forEach((model, i) => {
    const piece = model + (i < models.length - 1 ? "," : "");
    if (!line) line = piece;
    else if (`${line} ${piece}`.length > width) {
      lines.push(line);
      line = piece;
    } else {
      line += ` ${piece}`;
    }
  });

  lines.push(line);
  return lines;
}

// How a field's current value is shown in the provider menu.
function fieldValue(provider, field) {
  if (field.id === "apiKey") return maskKey(provider.apiKey);
  if (field.id === "name") return provider.name || dim(displayName(provider));
  if (field.list && !provider[field.id].length) return dim(field.empty ?? "(empty)");
  return provider[field.id] || dim(field.empty ?? "(empty)");
}

const parseModels = (text) => text.split(",").map((m) => m.trim()).filter(Boolean);

// "Big:   a, b, c" — wrapped onto continuation lines so a long list stays
// readable instead of being cut off at the right edge of the terminal.
function wrapModels(label, models, suffix = "") {
  const width = (process.stdout.columns || 80) - 8;
  const indent = " ".repeat(label.length);
  const out = [];
  let line = label;

  models.forEach((model, i) => {
    const piece = model + (i < models.length - 1 ? "," : "");
    const candidate = line === label || line === indent ? line + piece : `${line} ${piece}`;
    if (candidate.length > width && line !== label && line !== indent) {
      out.push(line);
      line = indent + piece;
    } else {
      line = candidate;
    }
  });

  out.push(line + suffix);
  return out;
}

// A brand-new provider walks the fields in order, since there's nothing to
// pick from yet. Returns null if the base URL is left empty.
async function addProvider() {
  console.log("");
  console.log(bold("  New provider"));

  const provider = { name: "", baseUrl: "", apiKey: "", bigModels: [], smallModels: [], disabled: false };
  for (const field of FIELDS) {
    const answer = await prompt(field.label, "", field.hint, { keep: true });
    if (answer === null) {
      console.log("");
      console.log(dim("  Cancelled — nothing added."));
      return null;
    }
    provider[field.id] = field.list ? parseModels(answer) : answer;
    if (field.id === "baseUrl" && !provider.baseUrl) return null;
  }

  if (!provider.bigModels.length) {
    console.log("");
    console.log(red("  At least one big model is required — this provider wasn't added."));
    await pause();
    return null;
  }

  return provider;
}

// Returns "deleted", "up", "down", or undefined when simply going back.
async function providerScreen(provider, position, total) {
  let index = 0;

  while (true) {
    const items = FIELDS.map((field) => {
      const models = field.list ? provider[field.id] : null;
      if (!models?.length) {
        return { id: field.id, label: field.label, value: fieldValue(provider, field) };
      }

      // The whole list, wrapped. The menu indents its detail lines by 4, so
      // pad the rest of the way to land under the value column.
      const [first, ...rest] = wrapInline(models, VALUE_COLUMN);
      return {
        id: field.id,
        label: field.label,
        value: first,
        lines: rest.map((line) => " ".repeat(VALUE_COLUMN - 4) + line),
      };
    });

    items.push({ separator: true });
    items.push(
      provider.disabled
        ? { id: "toggle", label: green("Enable provider"), hint: "start using it again" }
        : { id: "toggle", label: "Disable provider", hint: "skip it without losing the key" },
    );
    if (position > 1) items.push({ id: "up", label: "Move up", hint: "try this provider sooner" });
    if (position < total) items.push({ id: "down", label: "Move down", hint: "try this provider later" });
    items.push({ id: "test", label: "Test this provider" });
    items.push({ id: "delete", label: red("Delete provider") });
    items.push({ separator: true });
    items.push({ id: "back", label: "Back" });

    const selection = await menu({
      title: `Provider ${position} of ${total} — ${displayName(provider)}${provider.disabled ? " (disabled)" : ""}`,
      subtitle: "Pick a field to edit it.",
      items,
      index,
      footer: "↑↓ move · enter edit · u/d reorder · space on/off · x delete · esc back",
      shortcuts: { space: "toggle", u: "up", d: "down", x: "delete", t: "test" },
    });

    const choice = selection?.id;
    // Keep the cursor where it was, whether the action came from the list or
    // a shortcut that never moved it.
    index = selection ? selection.index : index;

    if (choice === undefined || choice === "back") return undefined;
    if (choice === "up" && position > 1) return "up";
    if (choice === "down" && position < total) return "down";
    if (choice === "up" || choice === "down") continue; // already at the end

    if (choice === "toggle") {
      provider.disabled = !provider.disabled;
      return "toggled";
    }

    if (choice === "delete") {
      const sure = await confirm(
        `Delete provider ${position} (${displayName(provider)})?`,
        "Its API key will be removed from the config file.",
      );
      if (sure) {
        return "deleted";
      }
      continue;
    }

    if (choice === "test") {
      console.log("");
      await testModels(testableModels(provider).map((model) => ({ provider, model })));
      await pause();
      continue;
    }

    const field = FIELDS.find((f) => f.id === choice);
    if (!field) continue; // a shortcut that doesn't apply on this row
    const current = field.list ? provider[field.id].join(", ") : provider[field.id];
    const value = await prompt(field.label, current, field.hint);
    if (value === null) continue; // escape — leave it as it was
    if (field.id === "baseUrl" && !value) continue; // can't clear the URL; use Delete
    if (field.list && field.id === "bigModels" && !parseModels(value).length) continue;
    provider[field.id] = field.list ? parseModels(value) : value;
  }
}

export async function runInit() {
  const stored = readStoredConfig();
  const providers = providersFromEnv(stored);
  let port = stored.PORT || "3000";
  let streaming = !["off", "false", "0", "no"].includes(
    (stored.STREAMING || "on").trim().toLowerCase(),
  );
  let index = 0;

  const save = () => writeStoredConfig({ providers, port, streaming });

  // Nothing configured yet — go straight to adding the first provider
  // instead of showing an empty list.
  if (providers.length === 0) {
    console.log("");
    console.log(bold("  Welcome to opencc"));
    console.log(dim("  Add the OpenAI-compatible API you want Claude Code to use."));
    const first = await addProvider();
    if (!first) {
      console.log("");
      console.log("  Nothing saved. Run \"opencc init\" again any time.");
      return;
    }
    providers.push(first);
    save();
  }

  while (true) {
    const items = providers.map((provider, i) => ({
      id: `provider:${i}`,
      label: `${i + 1}. ${displayName(provider)}`,
      lines: provider.disabled
        ? ["disabled — skipped"]
        : [
            ...wrapModels("Big (Opus, Sonnet):  ", provider.bigModels),
            ...wrapModels(
              "Small (Haiku):       ",
              provider.smallModels.length ? provider.smallModels : provider.bigModels,
              provider.smallModels.length ? "" : "  (same as big)",
            ),
          ],
    }));

    items.push({ separator: true });
    items.push({ id: "add", label: cyan("+ Add provider"), hint: "tried after the ones above" });
    items.push({ id: "port", label: "Port", value: String(port) });
    items.push({
      id: "streaming",
      label: "Streaming",
      value: streaming ? green("on") : red("off"),
      hint: streaming ? "replies arrive as they're generated" : "waits for the full reply, then sends it",
    });
    items.push({ id: "test", label: "Test all providers", hint: 'sends "Hi" to each model' });
    items.push({ separator: true });
    items.push({ id: "done", label: "Save and exit" });

    const selection = await menu({
      title: "opencc — providers",
      subtitle:
        providers.filter((p) => !p.disabled).length > 1
          ? "Tried top to bottom — if one fails, the next takes over."
          : "Add a second provider to fall back to when this one fails.",
      items,
      index,
      footer: "↑↓ move · enter open · u/d reorder · space on/off · x delete · a add · q save",
      shortcuts: {
        a: "add",
        t: "test",
        p: "port",
        space: "row-toggle",
        u: "row-up",
        d: "row-down",
        x: "row-delete",
      },
    });

    let choice = selection?.id;
    index = selection ? selection.index : index;

    // The row shortcuts act on whatever provider the cursor is on, so they
    // only mean anything when it's actually sitting on one.
    if (typeof choice === "string" && choice.startsWith("row-")) {
      const focused = selection.item?.id;
      if (typeof focused !== "string" || !focused.startsWith("provider:")) continue;
      const at = Number(focused.split(":")[1]);
      const action = choice.slice(4);

      if (action === "up" || action === "down") {
        const target = at + (action === "up" ? -1 : 1);
        if (target < 0 || target >= providers.length) continue;
        [providers[at], providers[target]] = [providers[target], providers[at]];
        index = target;
        save();
        continue;
      }

      if (action === "toggle") {
        providers[at].disabled = !providers[at].disabled;
        save();
        continue;
      }

      if (action === "delete") {
        const sure = await confirm(
          `Delete provider ${at + 1} (${displayName(providers[at])})?`,
          "Its API key will be removed from the config file. Press space to just disable it instead.",
        );
        if (!sure) continue;
        providers.splice(at, 1);
        index = 0;
        save();
        if (providers.length === 0) {
          const first = await addProvider();
          if (first) providers.push(first);
          save();
          if (providers.length === 0) {
            console.log("");
            console.log(`  All providers removed. Run "opencc init" to add one.`);
            return;
          }
        }
        continue;
      }
    }

    if (choice === undefined || choice === "done") {
      save();
      console.log("");
      console.log(`  Saved ${providers.length} provider(s) to ${GLOBAL_CONFIG_PATH}`);
      console.log(dim('  Run "opencc" to start the proxy, then "opencc claude" in another terminal.'));
      console.log("");
      return;
    }

    if (choice === "add") {
      const added = await addProvider();
      if (added) {
        providers.push(added);
        save();
      }
      continue;
    }

    if (choice === "streaming") {
      streaming = !streaming;
      save();
      continue;
    }

    if (choice === "port") {
      const value = await prompt("Port", String(port), "the proxy listens here; Claude Code connects to it");
      if (value !== null && value) {
        port = value;
        save();
      }
      continue;
    }

    if (choice === "test") {
      const active = providers.filter((p) => !p.disabled);
      const jobs = active.flatMap((provider) =>
        testableModels(provider).map((model) => ({ provider, model })),
      );

      console.log("");
      for (const provider of providers) {
        if (provider.disabled) {
          console.log(`  ${displayName(provider)} ... ${dim("skipped (disabled)")}`);
        }
      }
      const allOk = await testModels(jobs);
      console.log("");
      console.log(
        allOk
          ? green("  All providers answered.")
          : dim("  A provider that fails here is simply skipped at runtime, so a\n  partly-working chain is still fine to keep."),
      );
      await pause();
      continue;
    }

    const position = Number(choice.split(":")[1]);
    const result = await providerScreen(providers[position], position + 1, providers.length);

    if (result === "deleted") {
      providers.splice(position, 1);
      index = 0;
      save();
      if (providers.length === 0) {
        const first = await addProvider();
        if (first) providers.push(first);
        save();
        if (providers.length === 0) {
          console.log("");
          console.log(`  All providers removed. Run "opencc init" to add one.`);
          return;
        }
      }
    } else if (result === "toggled") {
      save();
    } else if (result === "up" || result === "down") {
      const target = position + (result === "up" ? -1 : 1);
      [providers[position], providers[target]] = [providers[target], providers[position]];
      index = target;
      save();
    } else {
      save();
    }
  }
}
