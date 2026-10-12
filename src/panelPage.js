// The admin panel's single page. Kept as one string so opencc stays
// dependency-free and there's nothing to build.
//
// There is nothing here for priority and nothing for capabilities, because
// neither is something you set any more. Both are read off what the models
// have actually done, which this page shows per model and per kind of
// request, and which is the only thing deciding what gets called.
//
// What is left is the part opencc cannot work out for itself: which backends
// exist, what their keys are, and which models to put in the pot.
export const page = () => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>opencc</title>
<style>
  /* One accent, neutral everything else. Two radii: 6px for containers,
     4px for controls. Nothing else gets a corner. */
  :root {
    --bg: #fbfbfc; --panel: #fff; --panel-2: #f4f6f8;
    --rule: #e2e6eb; --ink: #161a21; --ink-2: #495362; --ink-3: #78828f;
    --accent: #2b5fd9; --accent-ink: #fff;
    --ok: #106844; --ok-bg: #e2f0e9;
    --warn: #8a5806; --warn-bg: #f8eedc;
    --bad: #9b2c2c; --bad-bg: #f7e7e7;
    --r-box: 6px; --r-ctl: 4px;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0e1116; --panel: #151922; --panel-2: #1c222d;
      --rule: #272e3a; --ink: #e7eaef; --ink-2: #aeb7c4; --ink-3: #828d9c;
      --accent: #4d7dee; --accent-ink: #fff;
      --ok: #6fd3a5; --ok-bg: #12291f;
      --warn: #e4b261; --warn-bg: #2a2112;
      --bad: #f08c8c; --bad-bg: #2c1818;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--ink-2);
    font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, sans-serif;
  }
  code, .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }

  header {
    position: sticky; top: 0; z-index: 20;
    background: var(--panel); border-bottom: 1px solid var(--rule);
    padding: 14px 20px;
  }
  .bar-top { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
  h1 { font-size: 17px; color: var(--ink); margin: 0; letter-spacing: -.01em; }
  #summary { font: 12.5px ui-monospace, monospace; color: var(--ink-3); }
  .spacer { flex: 1; min-width: 0; }
  .field-inline { display: flex; align-items: center; gap: 6px; }
  .field-inline > span { font-size: 12px; color: var(--ink-3); white-space: nowrap; }
  .sub { color: var(--ink-3); font-size: 12.5px; margin: 7px 0 0; }
  .banner {
    margin: 10px 0 0; padding: 9px 12px; border-radius: var(--r-ctl);
    font-size: 13px; background: var(--warn-bg); color: var(--warn);
    border: 1px solid currentColor;
  }
  .banner.hide { display: none; }

  /* What Claude Code needs, and whether anything can serve it. The first
     thing on the page, because a missing capability is the one problem the
     per-model rows cannot show you: it is a property of the whole set. */
  .cover { display: flex; gap: 8px; flex-wrap: wrap; margin: 11px 0 0; }
  .cap {
    display: flex; align-items: center; gap: 9px;
    border: 1px solid var(--rule); border-radius: var(--r-ctl);
    padding: 8px 11px; background: var(--panel-2);
  }
  .cap.good { border-color: var(--ok); background: var(--ok-bg); }
  .cap.none { border-color: var(--bad); background: var(--bad-bg); }
  .cap.unk { border-color: var(--warn); background: var(--warn-bg); }
  .cap b { font-size: 13px; color: var(--ink); font-weight: 600; }
  .cap .n { font: 12px ui-monospace, monospace; }
  .cap.good .n { color: var(--ok); }
  .cap.none .n { color: var(--bad); }
  .cap.unk .n { color: var(--warn); }
  .cap button { padding: 4px 8px; font-size: 11.5px; }
  main { padding: 16px 20px 72px; }
  @media (max-width: 640px) {
    header { padding: 12px 14px; }
    main { padding: 12px 14px 56px; }
  }

  input[type=text], input[type=password], input[type=number] {
    width: 100%; padding: 7px 9px; border: 1px solid var(--rule);
    border-radius: var(--r-ctl); background: var(--bg); color: var(--ink);
    font: 13px ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  input::placeholder { color: var(--ink-3); }
  input:focus-visible, button:focus-visible, summary:focus-visible {
    outline: 2px solid var(--accent); outline-offset: 1px;
  }
  label {
    display: block; font-size: 11px; text-transform: uppercase;
    letter-spacing: .06em; color: var(--ink-3); margin: 14px 0 5px;
  }
  label .hint { text-transform: none; letter-spacing: 0; color: var(--ink-3); }
  button {
    font: 500 12.5px/1 ui-sans-serif, system-ui, sans-serif; cursor: pointer;
    background: var(--panel-2); color: var(--ink); border: 1px solid var(--rule);
    border-radius: var(--r-ctl); padding: 7px 10px;
  }
  button:hover:not(:disabled) { border-color: var(--ink-3); }
  button:active:not(:disabled) { transform: translateY(1px); }
  button:disabled { opacity: .4; cursor: default; }
  button.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); }
  button.danger { color: var(--bad); }
  button.icon { padding: 4px 8px; font-size: 12px; }

  .prov {
    background: var(--panel); border: 1px solid var(--rule);
    border-radius: var(--r-box); margin-bottom: 8px;
  }
  .prov[data-off="1"] .head-name { color: var(--ink-3); text-decoration: line-through; }
  .prov summary {
    display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
    padding: 11px 13px; cursor: pointer; list-style: none;
  }
  .prov summary::-webkit-details-marker { display: none; }
  .caret { color: var(--ink-3); font-size: 11px; width: 10px; flex: none; }
  .prov[open] .caret { transform: rotate(90deg); }
  .head-name { color: var(--ink); font-weight: 600; font-size: 14px; }
  .head-url { color: var(--ink-3); font-size: 12px; }
  .body { padding: 0 13px 14px; border-top: 1px solid var(--rule); }
  .two { display: flex; gap: 12px; flex-wrap: wrap; }
  .two > div { flex: 1; min-width: 240px; }

  /* The add box sits above the list, not under it: with a dozen models in a
     list, putting it last means scrolling past everything to add one more. */
  .addbar {
    display: flex; gap: 6px; flex-wrap: wrap; align-items: center;
    background: var(--panel-2); border: 1px solid var(--rule);
    border-radius: var(--r-ctl); padding: 8px; margin-top: 6px;
  }
  .addbar input { flex: 1; min-width: 190px; background: var(--panel); }
  .mlist { margin-top: 8px; }
  .m {
    display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
    padding: 7px 2px; border-bottom: 1px solid var(--rule);
  }
  .m:last-child { border-bottom: 0; }
  .m[data-off="1"] { opacity: .5; }
  .m code { font-size: 12.5px; color: var(--ink); flex: 1; min-width: 180px; word-break: break-all; }
  .m .acts { display: flex; gap: 4px; flex: none; }

  /* The record, per kind of request. This replaced the capability chips:
     "does it call tools" and "is it any good at calling tools" turned out to
     be the same question, and this answers both with the same number. */
  .kinds { display: flex; gap: 4px; flex: none; }
  .k {
    font: 11px/1 ui-monospace, monospace; padding: 5px 6px;
    border-radius: var(--r-ctl); white-space: nowrap; min-width: 76px; text-align: center;
  }
  .k.good { color: var(--ok); background: var(--ok-bg); }
  .k.mid { color: var(--warn); background: var(--warn-bg); }
  .k.poor { color: var(--bad); background: var(--bad-bg); }
  .k.none { color: var(--ink-3); background: var(--panel-2); }
  .chip {
    font: 600 10.5px/1 ui-monospace, monospace; text-transform: uppercase;
    letter-spacing: .04em; padding: 4px 6px; border-radius: var(--r-ctl); white-space: nowrap;
  }
  .chip.no { color: var(--bad); background: var(--bad-bg); }
  .chip.wait { color: var(--warn); background: var(--warn-bg); }
  .chip.flat { color: var(--ink-3); background: var(--panel-2); }
  .empty-list { color: var(--ink-3); font-size: 12.5px; padding: 10px 2px; border-bottom: 0; }
  .nothing {
    background: var(--panel); border: 1px dashed var(--rule);
    border-radius: var(--r-box); padding: 36px; text-align: center; color: var(--ink-3);
  }

  .scrim {
    position: fixed; inset: 0; background: rgba(0,0,0,.45); z-index: 40;
    display: none; align-items: center; justify-content: center; padding: 20px;
    backdrop-filter: blur(2px);
  }
  .scrim.show { display: flex; }
  .dialog {
    background: var(--panel); border: 1px solid var(--rule); border-radius: var(--r-box);
    padding: 20px 22px; width: 100%; max-width: 520px;
    max-height: calc(100vh - 40px); overflow: auto;
  }
  .dialog h2 { font-size: 16px; color: var(--ink); margin: 0 0 8px; }
  .dialog p { margin: 0 0 4px; color: var(--ink-3); font-size: 13px; }
  .dialog .err { color: var(--bad); min-height: 17px; font-size: 12.5px; margin-top: 8px; }
  .dialog .acts { display: flex; gap: 8px; justify-content: flex-end; margin-top: 18px; }
  .kv { display: flex; gap: 10px; padding: 7px 0; border-bottom: 1px solid var(--rule); font-size: 13px; }
  .kv:last-of-type { border-bottom: 0; }
  .kv b { color: var(--ink); font-weight: 600; min-width: 86px; }
  .now { font: 12.5px ui-monospace, monospace; color: var(--ink); word-break: break-all; min-height: 18px; }
  .spin {
    display: inline-block; width: 13px; height: 13px; vertical-align: -2px; margin-right: 7px;
    border: 2px solid var(--rule); border-top-color: var(--accent); border-radius: 50%;
    animation: spin .7s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) {
    .spin { animation-duration: 2.4s; }
    button:active:not(:disabled) { transform: none; }
  }

  .toast {
    position: fixed; left: 50%; bottom: 18px; transform: translateX(-50%); z-index: 50;
    background: var(--ink); color: var(--bg); padding: 8px 13px; border-radius: var(--r-ctl);
    font-size: 13px; opacity: 0; transition: opacity .18s; pointer-events: none;
  }
  .toast.show { opacity: 1; }
</style>
</head>
<body>
<header>
  <div class="bar-top">
    <h1>opencc</h1>
    <span id="summary"></span>
    <span class="spacer"></span>
    <span class="field-inline">
      <span title="The port the proxy listens on when you run opencc. Editing it here changes that setting; it starts nothing.">Proxy port</span>
      <input type="number" id="port" style="width:84px" min="1" max="65535">
    </span>
    <button id="streaming"></button>
    <button id="refresh" title="Re-read the record from disk">Refresh</button>
    <button id="testnew" title="Send one request to every model with no record yet">Test new</button>
    <button id="reset" class="danger" title="Forget every result and start over">Reset record</button>
    <button class="primary" id="add">Add provider</button>
  </div>
  <p class="sub" id="where"></p>
  <div class="cover" id="cover"></div>
  <p class="banner hide" id="banner"></p>
</header>

<main>
  <div id="list"></div>
</main>

<div class="toast" id="toast"></div>
<div class="scrim" id="scrim" role="dialog" aria-modal="true"><div class="dialog" id="dialog"></div></div>

<script>
let state = { providers: [], port: "3000", streaming: true };
let records = {};
let cooling = {};
let kinds = ["tools", "image", "document"];
let coverageFromServer = {};
const expanded = new Set();

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const attr = (s) => esc(s).replace(/'/g, "&#39;");
const keyOf = (baseUrl, model) => baseUrl + "|" + model;

let toastTimer;
function toast(msg) {
  $("toast").textContent = msg;
  $("toast").classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("toast").classList.remove("show"), 2000);
}

// --- dialogs --------------------------------------------------------------
let closeDialog = null;

function openDialog(html, { onClose } = {}) {
  $("dialog").innerHTML = html;
  $("scrim").classList.add("show");
  closeDialog = () => {
    $("scrim").classList.remove("show");
    $("dialog").innerHTML = "";
    closeDialog = null;
    if (onClose) onClose();
  };
  const first = $("dialog").querySelector("input, button");
  if (first) first.focus();
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && closeDialog) closeDialog();
});
$("scrim").addEventListener("mousedown", (e) => {
  if (e.target === $("scrim") && closeDialog) closeDialog();
});

function showWorking(title, note, { bar = false } = {}) {
  openDialog(
    '<h2><span class="spin"></span>' + esc(title) + "</h2><p>" + esc(note) + "</p>" +
    (bar ? '<div class="bar"><i id="barFill"></i></div><p class="sub" id="count">Starting</p>' : "") +
    '<p class="now" id="now"></p>',
  );
}

function showResult(title, pairs, note) {
  openDialog(
    "<h2>" + esc(title) + "</h2>" +
    (note ? "<p>" + esc(note) + "</p>" : "") +
    '<div style="margin-top:10px">' +
      pairs.map((p) => '<div class="kv"><b>' + esc(p[0]) + "</b><span>" + esc(p[1]) + "</span></div>").join("") +
    "</div>" +
    '<div class="acts"><button class="primary" data-dlg="close">Close</button></div>',
  );
}

function ask(title, body, confirmLabel) {
  return new Promise((resolve) => {
    let answered = false;
    openDialog(
      "<h2>" + esc(title) + "</h2><p>" + esc(body) + "</p>" +
      '<div class="acts">' +
        '<button data-dlg="close">Cancel</button>' +
        '<button class="primary danger" data-dlg="yes">' + esc(confirmLabel) + "</button>" +
      "</div>",
      { onClose: () => { if (!answered) resolve(false); } },
    );
    $("dialog").querySelector('[data-dlg="yes"]').addEventListener("click", () => {
      answered = true;
      resolve(true);
      if (closeDialog) closeDialog();
    });
  });
}

// --- api ------------------------------------------------------------------
async function api(path, opts) {
  const res = await fetch(path, opts);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.status);
  return res.json();
}

async function loadRecords() {
  try {
    const out = await api("/api/stats");
    kinds = out.kinds || kinds;
    cooling = out.cooling || {};
    coverageFromServer = out.coverage || {};
    records = {};
    for (const row of out.rows) {
      const k = keyOf(row.baseUrl, row.model);
      (records[k] || (records[k] = {}))[row.kind] = row;
    }
  } catch {
    records = {};
    cooling = {};
    coverageFromServer = {};
  }
}

async function load() {
  state = await api("/api/state");
  await loadRecords();
  renderAll();
}

// Two kinds of save. A structural change redraws the list because the list is
// what changed. Typing in a field does not: redrawing threw away focus,
// scroll position and anything half-typed in the next field.
async function save({ redraw = true } = {}) {
  const payload = {
    providers: state.providers.map((p) => ({
      name: p.name, baseUrl: p.baseUrl, apiKey: p.apiKey,
      models: p.models, disabled: p.disabled, disabledModels: p.disabledModels || [],
    })),
    port: state.port,
    streaming: state.streaming,
  };

  const before = state.providers.length;
  state = await api("/api/state", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
  });

  if (state.providers.length < before) {
    renderAll();
    toast("A provider needs a base URL and at least one model, so it was not kept");
    return;
  }

  if (redraw) renderAll();
  else renderHeader();

  await testNewModels();
}

// Any model nobody has sent a tool request to yet gets one now, rather than
// waiting for the next time the proxy starts. The results go into the shared
// log, so a proxy already running starts using them without a restart.
async function testNewModels(kind = "tools") {
  let pending;
  try {
    pending = await api("/api/warmup/pending?kind=" + kind);
  } catch {
    return;
  }
  if (!pending.total) return;

  const what = { tools: "tool calling", image: "images", document: "PDFs" }[kind];
  showWorking(
    "Testing " + pending.total + " model" + (pending.total === 1 ? "" : "s") + " for " + what,
    "One small request each. A slow backend can take a moment.",
    { bar: true },
  );

  const poll = setInterval(async () => {
    try {
      const p = await (await fetch("/api/warmup/progress")).json();
      if (!p || !p.total || !$("barFill")) return;
      $("barFill").style.width = Math.round((p.done / p.total) * 100) + "%";
      $("count").textContent = p.done + " of " + p.total + " done";
      $("now").textContent = p.current || "";
    } catch {
      // The dialog is cosmetic; a dropped poll should not surface an error.
    }
  }, 400);

  try {
    const out = await api("/api/warmup", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind }),
    });
    const ok = out.results.filter((r) => r.status >= 200 && r.status < 300);
    const failed = out.results.filter((r) => !(r.status >= 200 && r.status < 300));

    clearInterval(poll);
    if (closeDialog) closeDialog();
    await loadRecords();
    renderAll();

    if (failed.length === 0) {
      toast(ok.length + " of " + out.results.length + " answered");
    } else {
      showResult(
        ok.length + " of " + out.results.length + " answered",
        failed.map((r) => [r.model, (r.status === 0 ? "no answer" : r.status) + "  " + (r.error || "")]),
        "These cannot do it. They stay in the list for everything else.",
      );
    }
  } catch (err) {
    clearInterval(poll);
    if (closeDialog) closeDialog();
    toast("Could not test: " + err.message);
  }
}

// What Claude Code asks for, and what your models can actually do.
//
// A model row shows one model. This shows the set: Claude Code sends plain
// text, tool calls and sometimes images, and if nothing in the pot can serve
// one of those, every request of that kind fails no matter how many models
// you have. That is not visible anywhere else on the page.
const NEEDS = [
  { kind: "tools", label: "Tool calling", why: "reading and editing files" },
  { kind: "image", label: "Images", why: "screenshots you paste" },
  { kind: "document", label: "PDFs", why: "PDFs you attach" },
];

function renderCoverage() {
  $("cover").innerHTML = NEEDS.map((need) => {
    const c = { ...need, ...(coverageFromServer[need.kind] ?? { can: 0, cannot: 0, untried: 0 }) };
    const cls = c.can > 0 ? "good" : c.untried > 0 ? "unk" : "none";
    const count = c.can > 0
      ? c.can + (c.can === 1 ? " model" : " models")
      : c.untried > 0 ? "not tested" : "none";

    const note = c.can > 0
      ? c.can + " of your models can do this"
      : c.untried > 0
        ? "No model has been asked for this yet"
        : "Nothing can do this. Requests needing it will fail.";

    const button = c.untried > 0
      ? '<button data-act="cover" data-kind="' + c.kind + '">Test ' + c.untried + '</button>'
      : "";

    return '<span class="cap ' + cls + '" title="' + attr(c.label + ": " + note + ". Needed for " + c.why + ".") + '">' +
      "<b>" + c.label + "</b>" +
      '<span class="n">' + count + "</span>" +
      button +
    "</span>";
  }).join("");
}

// --- rendering ------------------------------------------------------------
function renderHeader() {
  const total = state.providers.length;
  const off = state.providers.filter((p) => p.disabled).length;
  const models = state.providers.reduce((n, p) => n + p.models.length, 0);
  const parked = state.providers.reduce((n, p) => n + (p.disabledModels || []).length, 0);

  $("port").value = state.port;
  $("streaming").textContent = "Streaming: " + (state.streaming ? "on" : "off");
  $("summary").textContent = total
    ? total + " providers" + (off ? ", " + off + " off" : "") + " · " +
      (models - parked) + " models in rotation" + (parked ? " (" + parked + " parked)" : "")
    : "nothing configured";

  $("where").textContent =
    "Which model answers a request is worked out from what each one has done before, drawn fresh every time, " +
    "so load spreads instead of landing on one model. This panel is on localhost:" + (location.port || "80") +
    " and only edits settings; the proxy listens on " + state.port + " when you run opencc.";

  const banner = $("banner");
  if (total && total - off === 0) {
    banner.textContent = "Every provider is switched off, so nothing can be routed. Turn one back on below.";
    banner.classList.remove("hide");
  } else {
    banner.classList.add("hide");
  }
}

// One cell per kind of request, which is where a model's abilities now show
// up: a model that cannot call tools collects failures under "tools" and
// keeps its record under "text", and the router reads exactly this.
function kindCells(baseUrl, model) {
  const rec = records[keyOf(baseUrl, model)] || {};

  return '<span class="kinds">' + kinds.map((kind) => {
    const row = rec[kind];
    if (!row || row.ok + row.fail === 0) {
      return '<span class="k none" title="No ' + kind + ' request has gone to this model yet">' + kind + " -</span>";
    }
    const total = row.ok + row.fail;
    const pct = Math.round((row.ok / total) * 100);
    const cls = pct >= 60 ? "good" : pct >= 20 ? "mid" : "poor";
    const seen = Object.entries(row.statuses || {})
      .map((e) => (e[0] === "0" ? "no answer" : e[0]) + " x" + e[1]).join(", ");
    return '<span class="k ' + cls + '" title="' + attr(kind + ": " + row.ok + " of " + total + " answered. " + seen) + '">' +
      kind + " " + pct + "%</span>";
  }).join("") + "</span>";
}

function modelRow(p, index, model, position) {
  const off = (p.disabledModels || []).includes(model);
  const waitMs = cooling[keyOf(p.baseUrl, model)];

  return '<div class="m" data-off="' + (off ? 1 : 0) + '">' +
    "<code>" + esc(model) + "</code>" +
    (off ? '<span class="chip no">parked</span>' : "") +
    (waitMs ? '<span class="chip wait" title="Rate limited or down. It goes to the back of the queue until this runs out.">' +
      Math.ceil(waitMs / 1000) + "s</span>" : "") +
    kindCells(p.baseUrl, model) +
    '<span class="acts">' +
      '<button class="icon" data-act="moff" data-i="' + index + '" data-m="' + attr(model) + '" ' +
        'title="' + (off ? "Put this model back in the pot" : "Keep it listed but never call it") + '">' +
        (off ? "Unpark" : "Park") + "</button>" +
      '<button class="icon" data-act="test" data-i="' + index + '" data-m="' + attr(model) + '" ' +
        'title="Send one real request. The result counts toward the record.">Test</button>' +
      '<button class="icon danger" data-act="mdel" data-i="' + index + '" data-pos="' + position + '">Remove</button>' +
    "</span>" +
  "</div>";
}

function providerCard(p, i) {
  const parked = (p.disabledModels || []).length;

  return '<details class="prov" data-i="' + i + '" data-off="' + (p.disabled ? 1 : 0) + '"' + (expanded.has(i) ? " open" : "") + ">" +
    "<summary>" +
      '<span class="caret">▶</span>' +
      '<span class="head-name">' + esc(p.name || p.label) + "</span>" +
      '<span class="head-url">' + esc(p.baseUrl) + "</span>" +
      '<span class="chip flat">' + p.models.length + " models" + (parked ? ", " + parked + " parked" : "") + "</span>" +
      (p.disabled ? '<span class="chip no">off</span>' : "") +
      '<span class="spacer"></span>' +
      '<button class="icon" data-act="toggle" data-i="' + i + '">' + (p.disabled ? "Turn on" : "Turn off") + "</button>" +
      '<button class="icon danger" data-act="del" data-i="' + i + '">Delete</button>' +
    "</summary>" +
    '<div class="body">' +
      '<div class="two">' +
        "<div><label>Name <span class=\\"hint\\">optional</span></label>" +
          '<input type="text" data-f="name" data-i="' + i + '" value="' + attr(p.name) + '" placeholder="' + attr(p.label) + '"></div>' +
        "<div><label>Base URL</label>" +
          '<input type="text" data-f="baseUrl" data-i="' + i + '" value="' + attr(p.baseUrl) + '"></div>' +
        "<div><label>API key <span class=\\"hint\\">blank if the backend needs none</span></label>" +
          '<input type="password" data-f="apiKey" data-i="' + i + '" value="' + attr(p.apiKey) + '"></div>' +
      "</div>" +

      "<label>Add a model</label>" +
      '<div class="addbar">' +
        '<input type="text" list="cat' + i + '" data-pick="' + i + '" placeholder="type or pick a model name">' +
        '<datalist id="cat' + i + '"></datalist>' +
        '<button data-act="madd" data-i="' + i + '">Add</button>' +
      "</div>" +

      '<label>Models <span class="hint">order here means nothing; the record decides</span></label>' +
      '<div class="mlist">' +
        (p.models.length
          ? p.models.map((m, pos) => modelRow(p, i, m, pos)).join("")
          : '<div class="m empty-list">none yet, so this provider gets skipped</div>') +
      "</div>" +
    "</div>" +
  "</details>";
}

function renderAll() {
  renderHeader();
  renderCoverage();
  if (!state.providers.length) {
    $("list").innerHTML = '<div class="nothing">No providers yet. Use <b>Add provider</b> above to set one up.</div>';
    return;
  }
  $("list").innerHTML = state.providers.map(providerCard).join("");
}

// --- catalogue ------------------------------------------------------------
// Fetched when a provider is first expanded rather than for all of them up
// front: it is a network call per provider and most stay collapsed.
const catalogues = {};
async function fillCatalogue(i) {
  const list = $("cat" + i);
  if (!list || list.dataset.done) return;
  list.dataset.done = "1";
  if (!catalogues[i]) {
    try {
      catalogues[i] = (await api("/api/catalogue?index=" + i)).models || [];
    } catch {
      catalogues[i] = [];
    }
  }
  list.innerHTML = catalogues[i].map((m) => '<option value="' + attr(m) + '"></option>').join("");
}

document.addEventListener("toggle", (e) => {
  const card = e.target.closest(".prov");
  if (!card) return;
  const i = Number(card.dataset.i);
  if (card.open) {
    expanded.add(i);
    fillCatalogue(i);
  } else {
    expanded.delete(i);
  }
}, true);

// --- field edits ----------------------------------------------------------
document.addEventListener("change", async (e) => {
  const field = e.target.dataset.f;
  if (field) {
    const i = Number(e.target.dataset.i);
    state.providers[i][field] = e.target.value;

    // The collapsed summary repeats the name and the URL, so keep those two
    // in step by hand. Redrawing the card instead is what used to throw away
    // whatever was being typed in the next field.
    const card = document.querySelector('.prov[data-i="' + i + '"]');
    if (card && field === "name") {
      card.querySelector(".head-name").textContent = e.target.value || state.providers[i].label || "";
    }
    if (card && field === "baseUrl") card.querySelector(".head-url").textContent = e.target.value;

    await save({ redraw: false });
    toast("Saved");
    return;
  }
  if (e.target.id === "port") {
    state.port = e.target.value || "3000";
    await save({ redraw: false });
    toast("Saved");
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  const i = e.target.dataset.pick;
  if (i === undefined) return;
  e.preventDefault();
  document.querySelector('button[data-act="madd"][data-i="' + i + '"]').click();
});

// --- add provider ---------------------------------------------------------
// A form, not a blank row appended to the list. The old version pushed an
// empty provider and saved on the first blur, and a provider with no URL and
// no models is not routable, so the server dropped it and the row vanished
// mid-edit. Nothing is written here until there is something worth writing.
function addProviderDialog() {
  openDialog(
    "<h2>Add provider</h2>" +
    "<p>Nothing is saved until this form is complete.</p>" +
    '<label>Name <span class="hint">optional, for the logs</span></label>' +
    '<input type="text" id="np-name" placeholder="z.ai glm flash">' +
    "<label>Base URL</label>" +
    '<input type="text" id="np-url" placeholder="https://openrouter.ai/api/v1">' +
    '<label>API key <span class="hint">blank if the backend needs none</span></label>' +
    '<input type="password" id="np-key">' +
    '<label>Models <span class="hint">comma separated</span></label>' +
    '<input type="text" id="np-models" placeholder="gpt-oss:120b, gpt-oss:20b">' +
    '<p class="err" id="np-err"></p>' +
    '<div class="acts">' +
      '<button data-dlg="close">Cancel</button>' +
      '<button class="primary" id="np-save">Add provider</button>' +
    "</div>",
  );

  $("np-save").addEventListener("click", async () => {
    const url = $("np-url").value.trim().replace(/\\/+$/, "");
    const models = [...new Set($("np-models").value.split(",").map((m) => m.trim()).filter(Boolean))];

    if (!url) { $("np-err").textContent = "A base URL is required."; $("np-url").focus(); return; }
    if (!/^https?:\\/\\//.test(url)) { $("np-err").textContent = "The base URL needs to start with http:// or https://"; $("np-url").focus(); return; }
    if (!models.length) { $("np-err").textContent = "At least one model is required, or there is nothing to route to."; $("np-models").focus(); return; }

    $("np-save").disabled = true;
    $("np-err").textContent = "";
    state.providers.push({
      name: $("np-name").value.trim(),
      baseUrl: url,
      apiKey: $("np-key").value,
      models,
      disabled: false,
      disabledModels: [],
    });
    try {
      expanded.add(state.providers.length - 1);
      await save();
      if (closeDialog) closeDialog();
      toast("Added " + models.length + " model(s)");
      document.querySelector('.prov[data-i="' + (state.providers.length - 1) + '"]')
        ?.scrollIntoView({ block: "center", behavior: "smooth" });
    } catch (err) {
      state.providers.pop();
      $("np-save").disabled = false;
      $("np-err").textContent = "Could not save: " + err.message;
    }
  });
}

// --- clicks ---------------------------------------------------------------
document.addEventListener("click", async (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;

  if (btn.dataset.dlg === "close") { if (closeDialog) closeDialog(); return; }

  // Buttons live inside <summary>, whose default action is to fold the card.
  if (btn.closest("summary")) e.preventDefault();

  const i = Number(btn.dataset.i);
  const act = btn.dataset.act;

  if (btn.id === "add") { addProviderDialog(); return; }
  if (btn.id === "streaming") { state.streaming = !state.streaming; await save({ redraw: false }); renderHeader(); return; }
  if (btn.id === "refresh") { await loadRecords(); renderAll(); toast("Record refreshed"); return; }

  if (act === "cover") {
    await testNewModels(btn.dataset.kind);
    return;
  }

  if (btn.id === "testnew") {
    const pending = await api("/api/warmup/pending");
    if (!pending.total) { toast("Every model has been tried already"); return; }
    await testNewModels();
    return;
  }

  if (btn.id === "reset") {
    const seen = Object.values(records).reduce(
      (n, kinds) => n + Object.values(kinds).reduce((m, row) => m + row.ok + row.fail, 0), 0,
    );
    if (!seen) { toast("Nothing on record yet"); return; }
    if (!await ask(
      "Forget all " + seen + " results?",
      "Every model goes back to untried, so routing is even odds until it learns again. " +
      "The next time you start opencc it warms up, which fills most of it back in. " +
      "The old record is kept as stats.jsonl.previous.",
      "Reset it",
    )) return;

    const out = await api("/api/stats/reset", { method: "POST" });
    await loadRecords();
    renderAll();
    toast(out.moved ? "Reset. The old record is in stats.jsonl.previous" : "Reset");
    return;
  }

  if (act === "toggle") { state.providers[i].disabled = !state.providers[i].disabled; await save(); return; }

  if (act === "del") {
    const p = state.providers[i];
    if (!await ask(
      "Delete " + (p.name || p.label) + "?",
      "Its API key goes with it. Turn it off instead to keep the key and the model list.",
      "Delete it",
    )) return;
    state.providers.splice(i, 1);
    expanded.clear();
    await save();
    return;
  }

  if (act === "moff") {
    const model = btn.dataset.m;
    const p = state.providers[i];
    const parked = p.disabledModels || [];
    p.disabledModels = parked.includes(model) ? parked.filter((m) => m !== model) : [...parked, model];
    await save();
    return;
  }

  if (act === "madd") {
    const input = document.querySelector('[data-pick="' + i + '"]');
    const model = (input.value || "").trim();
    if (!model) { toast("Type or pick a model name first"); input.focus(); return; }
    if (state.providers[i].models.includes(model)) { toast(model + " is already listed"); return; }
    state.providers[i].models.push(model);
    await save();
    toast("Added " + model);
    return;
  }

  if (act === "mdel") {
    const p = state.providers[i];
    if (p.models.length === 1) {
      toast("A provider needs at least one model. Delete or turn off the provider instead.");
      return;
    }
    const [gone] = p.models.splice(Number(btn.dataset.pos), 1);
    if (p.disabledModels) p.disabledModels = p.disabledModels.filter((m) => m !== gone);
    await save();
    return;
  }

  if (act === "test") {
    const model = btn.dataset.m;
    showWorking("Testing " + model, 'Sending one real "Hi" through this provider. The result counts toward its record.');
    if ($("now")) $("now").textContent = model;
    try {
      const r = await api("/api/test", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ index: i, model }),
      });
      if (closeDialog) closeDialog();
      await loadRecords();
      renderAll();
      showResult(model, [["Result", r.ok ? "OK, the provider answered" : "Failed"]].concat(r.ok ? [] : [["Error", r.error]]));
    } catch (err) {
      if (closeDialog) closeDialog();
      showResult("Test failed", [["Error", err.message]]);
    }
  }
});

load().catch((err) => {
  $("list").innerHTML = '<div class="nothing">Could not load the config: ' + esc(err.message) + "</div>";
});
</script>
</body>
</html>`;
