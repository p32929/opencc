// The admin panel's single page. Kept as one string so opencc stays
// dependency-free and there's nothing to build.
export const page = () => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>opencc</title>
<style>
  :root {
    --bg: #fbfbfc; --panel: #fff; --panel-2: #f4f6f8;
    --rule: #e2e6eb; --ink: #161a21; --ink-2: #495362; --ink-3: #78828f;
    --accent: #2b5fd9; --ok: #106844; --ok-bg: #e2f0e9;
    --warn: #8a5806; --warn-bg: #f8eedc; --bad: #9b2c2c; --bad-bg: #f7e7e7;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0e1116; --panel: #151922; --panel-2: #1c222d;
      --rule: #272e3a; --ink: #e7eaef; --ink-2: #aeb7c4; --ink-3: #828d9c;
      --accent: #8aaaff; --ok: #6fd3a5; --ok-bg: #12291f;
      --warn: #e4b261; --warn-bg: #2a2112; --bad: #f08c8c; --bad-bg: #2c1818;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--ink-2);
    font: 14px/1.55 ui-sans-serif, system-ui, -apple-system, sans-serif;
  }
  .wrap { width: 100%; margin: 0; padding: 28px 28px 80px; }
  @media (max-width: 600px) { .wrap { padding: 20px 16px 60px; } }
  h1 { font-size: 22px; color: var(--ink); margin: 0; letter-spacing: -.01em; }
  .sub { color: var(--ink-3); margin: 6px 0 0; }
  header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
  .globals { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
  .card {
    background: var(--panel); border: 1px solid var(--rule); border-radius: 6px;
    margin-top: 14px; padding: 16px 18px;
  }
  .card.off { opacity: .55; }
  .card-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .pos {
    font: 600 12px/1 ui-monospace, monospace; color: var(--ink-3);
    background: var(--panel-2); border: 1px solid var(--rule);
    border-radius: 4px; padding: 5px 7px;
  }
  .grow { flex: 1; min-width: 180px; }
  label { display: block; font-size: 11.5px; text-transform: uppercase; letter-spacing: .06em; color: var(--ink-3); margin: 12px 0 4px; }
  input[type=text], input[type=password], input[type=number] {
    width: 100%; padding: 7px 9px; border: 1px solid var(--rule); border-radius: 4px;
    background: var(--bg); color: var(--ink); font: 13px ui-monospace, monospace;
  }
  input:focus-visible, button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  .row { display: flex; gap: 10px; flex-wrap: wrap; }
  .row > * { flex: 1; min-width: 220px; }
  button {
    font: 500 12.5px/1 ui-sans-serif, system-ui, sans-serif; cursor: pointer;
    background: var(--panel-2); color: var(--ink); border: 1px solid var(--rule);
    border-radius: 4px; padding: 7px 10px;
  }
  button:hover { border-color: var(--ink-3); }
  button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
  button.danger { color: var(--bad); }
  button.tiny { padding: 4px 7px; font-size: 11.5px; }
  .models { margin-top: 12px; border-top: 1px dashed var(--rule); padding-top: 10px; }
  .m {
    display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
    padding: 6px 0; border-bottom: 1px solid var(--rule);
  }
  .m:last-child { border-bottom: 0; }
  .m code { font: 12.5px ui-monospace, monospace; color: var(--ink); flex: 1; min-width: 200px; word-break: break-all; }
  .chip {
    font: 600 10.5px/1 ui-monospace, monospace; text-transform: uppercase;
    letter-spacing: .05em; padding: 4px 7px; border-radius: 3px; white-space: nowrap;
  }
  .chip.yes { color: var(--ok); background: var(--ok-bg); }
  .chip.no { color: var(--bad); background: var(--bad-bg); }
  .chip.unk { color: var(--warn); background: var(--warn-bg); }
  .chip.tier { color: var(--ink-3); background: var(--panel-2); }
  .status { font-size: 12.5px; color: var(--ink-3); min-height: 18px; }
  .toast {
    position: fixed; left: 50%; bottom: 20px; transform: translateX(-50%);
    background: var(--ink); color: var(--bg); padding: 9px 14px; border-radius: 5px;
    font-size: 13px; opacity: 0; transition: opacity .18s; pointer-events: none;
  }
  .toast.show { opacity: 1; }
  .empty { color: var(--ink-3); padding: 24px; text-align: center; }

  /* Detection can run for minutes, so it gets a real dialog rather than a
     disabled button, and the dialog reports which model it's on. */
  .scrim {
    position: fixed; inset: 0; background: rgba(0,0,0,.45);
    display: none; align-items: center; justify-content: center; padding: 20px;
    backdrop-filter: blur(2px);
  }
  .scrim.show { display: flex; }
  .dialog {
    background: var(--panel); border: 1px solid var(--rule); border-radius: 8px;
    padding: 22px 24px; width: 100%; max-width: 460px;
  }
  .dialog h2 { font-size: 16px; color: var(--ink); margin: 0 0 6px; }
  .dialog p { margin: 0; color: var(--ink-3); font-size: 13px; }
  .bar { height: 6px; background: var(--panel-2); border-radius: 3px; overflow: hidden; margin: 16px 0 8px; }
  .bar > i { display: block; height: 100%; background: var(--accent); width: 0; transition: width .25s; }
  .now { font: 12.5px ui-monospace, monospace; color: var(--ink); word-break: break-all; min-height: 18px; }
  .spin {
    display: inline-block; width: 13px; height: 13px; vertical-align: -2px; margin-right: 7px;
    border: 2px solid var(--rule); border-top-color: var(--accent); border-radius: 50%;
    animation: spin .7s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .spin { animation-duration: 2.4s; } }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <div>
      <h1>opencc</h1>
      <p class="sub">Providers are tried top to bottom, models left to right. Changes save as you make them.</p>
      <p class="sub" id="where"></p>
    </div>
    <div class="globals">
      <span class="chip tier" title="The port the proxy will listen on when you run opencc — not this panel's port">Proxy port</span>
      <input type="number" id="port" style="width:90px" min="1" max="65535"
             title="Used by the proxy when you run opencc. Editing it here changes that setting; it does not start anything.">
      <button id="streaming"></button>
      <button id="detectAll">Detect all capabilities</button>
      <button id="clearCaps">Clear capabilities</button>
      <button class="primary" id="add">+ Add provider</button>
    </div>
  </header>

  <p class="status" id="status"></p>
  <div id="list"></div>
</div>
<div class="toast" id="toast"></div>
<div class="scrim" id="scrim" role="dialog" aria-modal="true" aria-labelledby="dlgTitle">
  <div class="dialog">
    <h2 id="dlgTitle"><span class="spin"></span>Detecting capabilities</h2>
    <p>Each model gets a tiny real request. A slow backend can take a while — this
       only has to run once per model.</p>
    <div class="bar"><i id="bar"></i></div>
    <p class="status" id="count"></p>
    <p class="now" id="now"></p>
  </div>
</div>

<script>
let state = { providers: [], port: "3000", streaming: true, capabilities: {} };
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const capKey = (baseUrl, model) => baseUrl + "|" + model;

function showDialog() {
  $("bar").style.width = "0%";
  $("count").textContent = "Starting…";
  $("now").textContent = "";
  $("scrim").classList.add("show");
}

function hideDialog() {
  $("scrim").classList.remove("show");
}

async function pollProgress() {
  try {
    const p = await (await fetch("/api/detect/progress")).json();
    if (!p || !p.total) return;
    const pct = Math.round((p.done / p.total) * 100);
    $("bar").style.width = pct + "%";
    $("count").textContent = p.done + " of " + p.total + " done";
    $("now").textContent = p.current || "";
  } catch {
    // The dialog is cosmetic; a dropped poll shouldn't surface an error.
  }
}

let toastTimer;
function toast(msg) {
  $("toast").textContent = msg;
  $("toast").classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("toast").classList.remove("show"), 1800);
}

async function api(path, opts) {
  const res = await fetch(path, opts);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.status);
  return res.json();
}

async function load() {
  state = await api("/api/state");
  render();
}

// Everything funnels through here, so the file on disk always matches what
// you see — the same immediate-save behaviour the terminal menu has.
async function save() {
  const payload = {
    providers: state.providers.map((p) => ({
      name: p.name, baseUrl: p.baseUrl, apiKey: p.apiKey,
      bigModels: p.bigModels, smallModels: p.smallModels,
      disabled: p.disabled, retry: p.retry,
    })),
    port: state.port,
    streaming: state.streaming,
  };
  state = { ...(await api("/api/state", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
  })) };
  render();
  toast("Saved");
}

const parseModels = (text) => text.split(",").map((m) => m.trim()).filter(Boolean);

function capChip(caps, field, labelText) {
  const v = caps ? caps[field] : undefined;
  const cls = v === true ? "yes" : v === false ? "no" : "unk";
  const mark = v === true ? "yes" : v === false ? "no" : "?";
  return '<span class="chip ' + cls + '">' + labelText + " " + mark + "</span>";
}

function modelRow(p, index, model, tier) {
  const caps = state.capabilities[capKey(p.baseUrl, model)];
  return '<div class="m">' +
    '<span class="chip tier">' + tier + "</span>" +
    "<code>" + esc(model) + "</code>" +
    capChip(caps, "tools", "tools") +
    capChip(caps, "vision", "image") +
    (caps && caps.contextLength ? '<span class="chip tier">' + caps.contextLength.toLocaleString() + " ctx</span>" : "") +
    '<button class="tiny" data-act="test" data-i="' + index + '" data-m="' + esc(model) + '">Test</button>' +
    '<button class="tiny" data-act="cap" data-i="' + index + '" data-m="' + esc(model) + '">Set</button>' +
    "</div>";
}

function render() {
  $("where").textContent =
    "This panel is on localhost:" + (location.port || "80") +
    " and only edits settings. The proxy listens on " + state.port +
    " when you run opencc separately — nothing here starts it.";
  $("port").value = state.port;
  $("streaming").textContent = "Streaming: " + (state.streaming ? "on" : "off");

  const active = state.providers.filter((p) => !p.disabled).length;
  const detected = Object.keys(state.capabilities).length;
  $("status").textContent = state.providers.length
    ? state.providers.length + " provider(s), " + active + " active · " +
      (detected ? detected + " model(s) with detected capabilities" : "no capabilities detected yet — everything gets tried")
    : "";

  if (!state.providers.length) {
    $("list").innerHTML = '<div class="card empty">No providers yet — add one to get started.</div>';
    return;
  }

  $("list").innerHTML = state.providers.map((p, i) => {
    const models = [...new Set([...p.bigModels, ...p.smallModels])];
    return '<div class="card' + (p.disabled ? " off" : "") + '">' +
      '<div class="card-head">' +
        '<span class="pos">' + (i + 1) + "</span>" +
        '<input class="grow" type="text" data-f="name" data-i="' + i + '" value="' + esc(p.name) + '" placeholder="' + esc(p.label) + '">' +
        '<button class="tiny" data-act="up" data-i="' + i + '"' + (i === 0 ? " disabled" : "") + ">↑</button>" +
        '<button class="tiny" data-act="down" data-i="' + i + '"' + (i === state.providers.length - 1 ? " disabled" : "") + ">↓</button>" +
        '<button class="tiny" data-act="toggle" data-i="' + i + '">' + (p.disabled ? "Enable" : "Disable") + "</button>" +
        '<button class="tiny" data-act="retry" data-i="' + i + '">Retry: ' + (p.retry ? "on" : "off") + "</button>" +
        '<button class="tiny" data-act="detect" data-i="' + i + '">Detect</button>' +
        '<button class="tiny danger" data-act="del" data-i="' + i + '">Delete</button>' +
      "</div>" +
      "<label>Base URL</label>" +
      '<input type="text" data-f="baseUrl" data-i="' + i + '" value="' + esc(p.baseUrl) + '" placeholder="https://openrouter.ai/api/v1">' +
      "<label>API key — leave empty if the backend needs none</label>" +
      '<input type="password" data-f="apiKey" data-i="' + i + '" value="' + esc(p.apiKey) + '">' +
      '<div class="row">' +
        "<div><label>Big models (Opus, Sonnet) — comma separated, tried in order</label>" +
        '<input type="text" data-f="bigModels" data-i="' + i + '" value="' + esc(p.bigModels.join(", ")) + '"></div>' +
        "<div><label>Small models (Haiku) — empty reuses the big ones</label>" +
        '<input type="text" data-f="smallModels" data-i="' + i + '" value="' + esc(p.smallModels.join(", ")) + '"></div>' +
      "</div>" +
      (models.length ? '<div class="models">' + models.map((m) =>
          modelRow(p, i, m, p.bigModels.includes(m) ? (p.smallModels.includes(m) ? "both" : "big") : "small")
        ).join("") + "</div>" : "") +
      "</div>";
  }).join("");
}

// --- events ---------------------------------------------------------------

document.addEventListener("change", async (e) => {
  const field = e.target.dataset.f;
  if (field) {
    const p = state.providers[Number(e.target.dataset.i)];
    p[field] = field.endsWith("Models") ? parseModels(e.target.value) : e.target.value;
    await save();
    return;
  }
  if (e.target.id === "port") {
    state.port = e.target.value || "3000";
    await save();
  }
});

document.addEventListener("click", async (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  const i = Number(btn.dataset.i);
  const act = btn.dataset.act;

  if (btn.id === "add") {
    state.providers.push({ name: "", baseUrl: "", apiKey: "", bigModels: [], smallModels: [], disabled: false, retry: false });
    render();
    return;
  }
  if (btn.id === "streaming") { state.streaming = !state.streaming; await save(); return; }

  if (btn.id === "detectAll" || act === "detect") {
    const body = act === "detect" ? { index: i } : {};
    showDialog();
    // The run is one long POST, so progress comes from polling alongside it.
    const poll = setInterval(pollProgress, 500);
    try {
      const out = await api("/api/detect", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      state.capabilities = out.capabilities;
      render();
      const n = (out.results || []).length;
      toast(n ? "Detected " + n + " model(s)" : "Nothing to detect");
    } catch (err) {
      toast("Detection failed: " + err.message);
    } finally {
      clearInterval(poll);
      hideDialog();
    }
    return;
  }

  if (btn.id === "clearCaps") {
    if (!Object.keys(state.capabilities).length) { toast("Nothing saved"); return; }
    if (!confirm("Forget all " + Object.keys(state.capabilities).length +
                 " saved capabilities? Every model goes back to untested, which means they all get tried again until you re-detect.")) return;
    state.capabilities = (await api("/api/capability/clear", { method: "POST" })).capabilities;
    render();
    toast("Capabilities cleared");
    return;
  }

  if (act === "up" || act === "down") {
    const j = act === "up" ? i - 1 : i + 1;
    [state.providers[i], state.providers[j]] = [state.providers[j], state.providers[i]];
    await save();
    return;
  }
  if (act === "toggle") { state.providers[i].disabled = !state.providers[i].disabled; await save(); return; }
  if (act === "retry") { state.providers[i].retry = !state.providers[i].retry; await save(); return; }
  if (act === "del") {
    if (!confirm("Delete provider " + (i + 1) + "? Its API key goes with it — Disable keeps it.")) return;
    state.providers.splice(i, 1);
    await save();
    return;
  }

  if (act === "test") {
    btn.textContent = "…";
    btn.disabled = true;
    try {
      const r = await api("/api/test", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ index: i, model: btn.dataset.m }),
      });
      toast(r.ok ? btn.dataset.m + ": OK" : btn.dataset.m + ": " + r.error);
    } catch (err) {
      toast("Test failed: " + err.message);
    } finally {
      btn.textContent = "Test";
      btn.disabled = false;
    }
    return;
  }

  if (act === "cap") {
    const model = btn.dataset.m;
    const current = state.capabilities[capKey(state.providers[i].baseUrl, model)] || {};
    const answer = prompt(
      "Capabilities for " + model + "\ \ Type: tools, image — whichever it supports, comma separated.\ Empty means neither.",
      [current.tools ? "tools" : "", current.vision ? "image" : ""].filter(Boolean).join(", "),
    );
    if (answer === null) return;
    const wanted = answer.toLowerCase();
    state.capabilities = (await api("/api/capability", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        baseUrl: state.providers[i].baseUrl, model,
        caps: { tools: wanted.includes("tool"), vision: wanted.includes("image") || wanted.includes("vision"), contextLength: current.contextLength },
      }),
    })).capabilities;
    render();
    toast("Set by hand");
  }
});

load().catch((err) => { $("status").textContent = "Could not load config: " + err.message; });
</script>
</body>
</html>`;
