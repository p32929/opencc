// The admin panel's single page. Kept as one string so opencc stays
// dependency-free and there's nothing to build.
//
// There is nothing here for priority and nothing for capabilities, because
// neither is something you set any more. Priority is read off what the
// models have actually done, which is the only thing deciding what gets
// called. Capabilities are read off models.dev where it knows the model, and
// off a real request where it does not — the page marks which is which,
// since one of the two has been checked and the other has not.
//
// What is left is the part opencc cannot work out for itself: which backends
// exist, what their keys are, and which models to put in the pot.
const DARK = `
      --bg: #0e1116; --panel: #151922; --panel-2: #1c222d;
      --rule: #272e3a; --ink: #e7eaef; --ink-2: #aeb7c4; --ink-3: #828d9c;
      --accent: #4d7dee; --accent-ink: #fff;
      --ok: #6fd3a5; --ok-bg: #12291f;
      --warn: #e4b261; --warn-bg: #2a2112;
      --bad: #f08c8c; --bad-bg: #2c1818;`;

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
  /* Dark twice over: once for the system setting, and once for the button in
     the header. The media query is held off when the button has explicitly
     asked for light, so a choice made here outlives the system flipping at
     sunset. */
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) { ${DARK} }
  }
  :root[data-theme="dark"] { ${DARK} }
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
  /* Published, not proven: deliberately quieter than a real result, because
     it is a weaker claim. */
  .k.pub { color: var(--ink-3); background: var(--panel-2); border: 1px dashed var(--rule); padding: 4px 5px; }
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

  /* --- what models.dev knows, shown beside the record ------------------ */
  .meta {
    display: flex; gap: 5px; flex: none; align-items: center;
    font: 11px/1 ui-monospace, monospace; color: var(--ink-3);
  }
  .meta span { white-space: nowrap; }

  /* --- the request log ------------------------------------------------- */
  .card {
    background: var(--panel); border: 1px solid var(--rule);
    border-radius: var(--r-box); margin-top: 16px;
  }
  .reqs-top {
    display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
    padding: 11px 13px; border-bottom: 1px solid var(--rule);
  }
  .reqs-top h2 { font-size: 14px; color: var(--ink); margin: 0; font-weight: 600; }
  .seg { display: flex; border: 1px solid var(--rule); border-radius: var(--r-ctl); overflow: hidden; }
  .seg button { border: 0; border-radius: 0; background: var(--panel); padding: 6px 11px; }
  .seg button + button { border-left: 1px solid var(--rule); }
  .seg button.on { background: var(--accent); color: var(--accent-ink); }
  #reqcount { font: 12px ui-monospace, monospace; color: var(--ink-3); }

  /* Two panes side by side, stacked once there is no room: the detail is
     long lines of error text, which is unreadable in a narrow column. */
  .reqs { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr); min-height: 150px; }
  @media (max-width: 860px) { .reqs { grid-template-columns: minmax(0, 1fr); } }
  .req-list { max-height: 420px; overflow: auto; border-right: 1px solid var(--rule); }
  @media (max-width: 860px) {
    .req-list { border-right: 0; border-bottom: 1px solid var(--rule); max-height: 260px; }
  }
  .req {
    display: flex; align-items: center; gap: 8px; width: 100%; text-align: left;
    padding: 8px 13px; border: 0; border-bottom: 1px solid var(--rule);
    border-radius: 0; background: transparent; font-size: 12.5px;
  }
  .req:hover { background: var(--panel-2); }
  .req.on { background: var(--panel-2); box-shadow: inset 2px 0 0 var(--accent); }
  .req .when { font: 11.5px ui-monospace, monospace; color: var(--ink-3); flex: none; }
  .req .who { color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0; }
  .dot { width: 7px; height: 7px; border-radius: 50%; flex: none; background: var(--ink-3); }
  .dot.ok { background: var(--ok); }
  .dot.bad { background: var(--bad); }
  .req-detail { padding: 13px; overflow: auto; max-height: 420px; font-size: 12.5px; }
  .req-detail .empty { color: var(--ink-3); }
  .walk { margin: 10px 0 0; padding: 0; list-style: none; }
  .walk li {
    padding: 7px 0; border-bottom: 1px solid var(--rule);
    font: 12px ui-monospace, monospace; color: var(--ink-2);
  }
  .walk li:last-child { border-bottom: 0; }
  .walk .err { color: var(--bad); white-space: pre-wrap; word-break: break-word; margin-top: 3px; }

  /* --- browsing a provider's catalogue --------------------------------- */
  .dialog.wide { max-width: 720px; }
  .cat-top { display: flex; gap: 8px; align-items: center; margin: 12px 0 8px; flex-wrap: wrap; }
  .cat-top input[type=text] { flex: 1; min-width: 180px; }
  .cat-list { border: 1px solid var(--rule); border-radius: var(--r-ctl); max-height: 46vh; overflow: auto; }
  .cat-row {
    display: flex; align-items: center; gap: 9px; padding: 7px 10px;
    border-bottom: 1px solid var(--rule);
  }
  .cat-row:last-child { border-bottom: 0; }
  .cat-row:hover { background: var(--panel-2); }
  .cat-row input { flex: none; margin: 0; }
  .cat-row label { margin: 0; text-transform: none; letter-spacing: 0; font-size: 12.5px;
    color: var(--ink); font-family: ui-monospace, monospace; flex: 1; min-width: 0;
    word-break: break-all; cursor: pointer; }
  .cat-row .meta { font-size: 11px; }
  .cat-row[data-have="1"] label { color: var(--ink-3); }
  .cat-none { padding: 14px; color: var(--ink-3); font-size: 12.5px; }

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
    <button id="theme" title="Switch between light and dark"></button>
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

  <!-- Every request the proxy served. The terminal says the same things, but
       only until it scrolls away, and the one question worth asking after a
       failure is which models were tried and what each of them said. -->
  <section class="card" id="reqs">
    <div class="reqs-top">
      <h2>Requests</h2>
      <div class="seg" id="reqfilter">
        <button data-f="all" class="on">All</button>
        <button data-f="failed">Failed</button>
        <button data-f="fallback" title="Served, but not by the first model tried">Fallbacks</button>
      </div>
      <span class="spacer"></span>
      <span id="reqcount"></span>
      <button id="reqclear" class="danger">Clear</button>
    </div>
    <div class="reqs">
      <div class="req-list" id="reqlist"></div>
      <div class="req-detail" id="reqdetail"><p class="empty">Pick a request to see every model it tried.</p></div>
    </div>
  </section>
</main>

<div class="toast" id="toast"></div>
<div class="scrim" id="scrim" role="dialog" aria-modal="true"><div class="dialog" id="dialog"></div></div>

<script>
let state = { providers: [], port: "3000", streaming: true };
let records = {};
let cooling = {};
let kinds = ["tools", "image", "document"];
let coverageFromServer = {};
// What models.dev says about the configured models, keyed the same way the
// record is. Empty when the catalogue could not be fetched, which is why
// everything that reads it treats a miss as "not known" rather than "no".
let catalogKnown = {};
let requests = [];
let reqFilter = "all";
// The timestamp of the open request, not its position: the list is newest
// first, so a request arriving while one is open would shift every index and
// the detail pane would silently start describing a different request.
let reqPicked = null;
const expanded = new Set();

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const attr = (s) => esc(s).replace(/'/g, "&#39;");
const keyOf = (baseUrl, model) => baseUrl + "|" + model;

// --- theme ----------------------------------------------------------------
// The system setting decides until the button is pressed; after that the
// choice is remembered in this browser. Nothing server-side: it is a
// preference of the screen you are looking at, not of the install.
function currentTheme() {
  return document.documentElement.dataset.theme ||
    (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
}

function paintTheme() {
  $("theme").textContent = currentTheme() === "dark" ? "Light" : "Dark";
}

try {
  const saved = localStorage.getItem("opencc-theme");
  if (saved === "dark" || saved === "light") document.documentElement.dataset.theme = saved;
} catch {
  // Private windows and blocked storage: the system setting still applies.
}

function flipTheme() {
  const next = currentTheme() === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem("opencc-theme", next); } catch {}
  paintTheme();
}

matchMedia("(prefers-color-scheme: dark)").addEventListener("change", paintTheme);

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
    // Only the catalogue browser is wide; left on, it would stretch the
    // next small dialog that opened.
    $("dialog").classList.remove("wide");
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

async function loadCatalog() {
  try {
    const out = await api("/api/catalog");
    catalogKnown = out.known || {};
  } catch {
    catalogKnown = {};
  }
}

async function loadRequests() {
  try {
    requests = (await api("/api/requests")).items || [];
  } catch {
    requests = [];
  }
  renderRequests();
}

async function load() {
  state = await api("/api/state");
  await loadRecords();
  renderAll();
  paintTheme();
  // After the first paint: neither is needed to draw the page, and the
  // catalogue is a network call that can take a moment on a cold cache.
  await Promise.all([loadCatalog().then(renderAll), loadRequests()]);
  listen();
}

// --- live updates ---------------------------------------------------------
// The proxy and this panel are the same process, so a served request can be
// pushed here instead of polled for. The event only says that something
// happened; what it means is worked out by refetching, which keeps one copy
// of that rule rather than two that drift.
function listen() {
  let source;
  try {
    source = new EventSource("/api/events");
  } catch {
    return; // no live updates; everything still works through Refresh
  }
  source.addEventListener("message", async (e) => {
    let what;
    try {
      what = JSON.parse(e.data).what;
    } catch {
      return;
    }
    if (what === "request" || what === "requests-cleared") {
      await loadRequests();
      // A served request changes the record it was drawn from, so the
      // per-model numbers above are stale the moment one lands.
      await loadRecords();
      renderAll();
    }
  });
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
    const c = { ...need, ...(coverageFromServer[need.kind] ?? { can: 0, cannot: 0, untried: 0, proven: 0 }) };
    const cls = c.can > 0 ? "good" : c.untried > 0 ? "unk" : "none";
    const count = c.can > 0
      ? c.can + (c.can === 1 ? " model" : " models")
      : c.untried > 0 ? "not tested" : "none";

    // Where the number comes from, because "models.dev says so" and "it did
    // it here" are not the same claim and only one of them is checked.
    const published = c.can - (c.proven ?? 0);
    const note = c.can > 0
      ? c.can + " of your models can do this — " +
        (published === 0 ? "all proven by a real request"
          : c.proven === 0 ? "all from models.dev, none tried here yet"
          : c.proven + " proven here, " + published + " published by models.dev")
      : c.untried > 0
        ? (need.kind === "document"
            ? "Nobody has asked. models.dev has no field for PDFs, so this one always has to be tested"
            : "Nobody has asked, and models.dev does not list these models")
        : "Nothing can do this. Requests needing it will fail.";

    // Only the models nothing can answer for. For PDFs that is always all of
    // them: there is no published field for whether a backend takes one.
    const button = c.untried > 0
      ? '<button data-act="cover" data-kind="' + c.kind + '" title="' + attr("Send one real request to the " +
          c.untried + " model(s) nothing has answered for yet") + '">Test ' + c.untried + "</button>"
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

// One cell per kind of request, which is where a model's abilities show up.
//
// A record always wins. Where there is none, models.dev's published answer
// is shown instead and marked as such: a tick here means "published", not
// "tried". The difference matters, because the catalogue describes a model
// and what is being configured is a backend that serves it — a gateway can
// strip tool calling from a model that has it.
function kindCells(baseUrl, model) {
  const rec = records[keyOf(baseUrl, model)] || {};

  return '<span class="kinds">' + kinds.map((kind) => {
    const row = rec[kind];
    if (!row || row.ok + row.fail === 0) {
      const doing = { tools: "call tools", image: "read images", document: "read PDFs" }[kind] ?? kind;
      const published = says(baseUrl, model, kind);
      if (published === true) {
        return '<span class="k pub" title="' + attr("models.dev says this model can " + doing +
          ". Nothing has asked this backend for it yet, so it is published rather than proven.") + '">' + kind + " ✓</span>";
      }
      if (published === false) {
        return '<span class="k pub" title="' + attr("models.dev says this model cannot " + doing +
          ". It stays in the rotation and still gets its turn; this is what is published, not a verdict.") + '">' + kind + " ✗</span>";
      }
      // models.dev has no field at all for PDFs, so that one is never its
      // silence about a model — it is silence about the whole question.
      return '<span class="k none" title="' + attr(kind === "document"
        ? "Nothing has sent this model a PDF. models.dev has no field for it either: whether a backend takes one is a property of the endpoint, not the model."
        : "Nothing has asked this model to " + doing + ", and models.dev does not list it") + '">' + kind + " -</span>";
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

// --- what models.dev knows ------------------------------------------------
// Shown next to the record, never in place of it. These are published facts
// about a model, and a provider can serve it under a different name, with a
// shorter window, or behind a gateway that strips tool calling — so a row
// with a green record and a grey "no tools" here means the record is right.
const money = (n) =>
  n === 0 ? "free" : n < 1 ? "$" + n.toFixed(2) : "$" + Math.round(n);

// The same question coverage asks on the server: what does models.dev say
// about this kind of request, or null when it cannot say. Documents are
// always null — no published field describes whether a backend takes a PDF.
function says(baseUrl, model, kind) {
  const info = catalogKnown[keyOf(baseUrl, model)];
  if (!info) return null;
  if (kind === "tools") return info.tools;
  if (kind === "image") return info.vision;
  return null;
}

function metaCells(baseUrl, model) {
  const info = catalogKnown[keyOf(baseUrl, model)];
  if (!info) return "";

  const bits = [];
  if (info.context) {
    const k = Math.round(info.context / 1000);
    bits.push([
      k >= 1000 ? (k / 1000) + "M ctx" : k + "k ctx",
      "Context window models.dev publishes for this model: " + info.context.toLocaleString() + " tokens",
    ]);
  }
  if (info.input !== undefined && info.output !== undefined) {
    bits.push([
      money(info.input) + " / " + money(info.output),
      "Price per million tokens in and out, as models.dev lists it",
    ]);
  }
  if (!info.tools) bits.push(["no tools", "models.dev does not list this model as calling tools"]);
  if (info.vision) bits.push(["vision", "models.dev lists this model as reading images"]);

  if (!bits.length) return "";
  return '<span class="meta">' +
    bits.map((b) => '<span title="' + attr(b[1]) + '">' + esc(b[0]) + "</span>").join("·") +
    "</span>";
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
    metaCells(p.baseUrl, model) +
    '<span class="acts">' +
      '<button class="icon" data-act="moff" data-i="' + index + '" data-m="' + attr(model) + '" ' +
        'title="' + (off ? "Put this model back in the pot" : "Keep it listed but never call it") + '">' +
        (off ? "Unpark" : "Park") + "</button>" +
      '<button class="icon" data-act="test" data-i="' + index + '" data-m="' + attr(model) + '" ' +
        'title="Send one real tool-calling request, the same probe the warm-up uses. The result counts toward the record.">Test</button>' +
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
        '<button data-act="browse" data-i="' + i + '" title="List everything this provider serves, and tick the ones you want">Browse</button>' +
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

// --- the request log ------------------------------------------------------
function ago(at) {
  const secs = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (secs < 60) return secs + "s ago";
  if (secs < 3600) return Math.round(secs / 60) + "m ago";
  if (secs < 86400) return Math.round(secs / 3600) + "h ago";
  return new Date(at).toLocaleDateString();
}

const FILTERS = {
  all: () => true,
  failed: (r) => !r.ok,
  fallback: (r) => r.fallback,
};

function renderRequests() {
  const shown = requests.filter(FILTERS[reqFilter]);
  const failed = requests.filter((r) => !r.ok).length;
  const fell = requests.filter((r) => r.fallback).length;

  $("reqcount").textContent = requests.length
    ? requests.length + " kept · " + failed + " failed · " + fell + " fell back"
    : "";

  // The open request can fall off the end as older ones are pruned.
  if (reqPicked !== null && !requests.some((r) => r.at === reqPicked)) reqPicked = null;

  if (!shown.length) {
    $("reqlist").innerHTML = '<p class="cat-none">' +
      (requests.length
        ? "No request matches this filter."
        : "Nothing yet. Requests appear here as Claude Code makes them.") + "</p>";
    renderDetail();
    return;
  }

  $("reqlist").innerHTML = shown.map((r) => {
    const dot = r.ok ? (r.fallback ? "" : "ok") : "bad";
    const who = r.ok ? r.served : (r.status || "failed") + " after " + r.attempts.length + " tr" + (r.attempts.length === 1 ? "y" : "ies");
    return '<button class="req' + (r.at === reqPicked ? " on" : "") + '" data-req="' + r.at + '">' +
      '<span class="dot ' + dot + '" title="' + attr(r.ok ? (r.fallback ? "Served, but not by the first model tried" : "Served") : "Failed") + '"></span>' +
      '<span class="when">' + esc(ago(r.at)) + "</span>" +
      '<span class="who">' + esc(who) + "</span>" +
      '<span class="when">' + esc(r.kind) + "</span>" +
    "</button>";
  }).join("");

  renderDetail();
}

function renderDetail() {
  const r = requests.find((x) => x.at === reqPicked);
  if (!r) {
    $("reqdetail").innerHTML = '<p class="empty">Pick a request to see every model it tried.</p>';
    return;
  }

  const kb = Math.round(r.chars / 1024);
  const facts = [
    ["When", new Date(r.at).toLocaleTimeString() + " (" + ago(r.at) + ")"],
    ["Asked for", r.model],
    ["Needed", r.kind],
    ["Size", r.chars.toLocaleString() + " chars" + (kb ? " (~" + kb + "kB)" : "") + ", " + r.tools + " tools"],
    ["Streaming", r.stream ? "yes" : "no"],
    ["Took", r.ms ? (r.ms / 1000).toFixed(1) + "s" : "-"],
    ["Result", r.ok ? "served by " + r.served : "failed"],
  ];

  $("reqdetail").innerHTML =
    facts.map((f) => '<div class="kv"><b>' + esc(f[0]) + "</b><span>" + esc(f[1]) + "</span></div>").join("") +
    '<ul class="walk">' +
      (r.attempts.length
        ? r.attempts.map((a, i) =>
            "<li>" + (i + 1) + ". " + esc(a.provider) + " / " + esc(a.model) +
            " &rarr; " + esc(a.status === 0 ? "no answer" : a.status) +
            (a.ms ? " in " + (a.ms / 1000).toFixed(1) + "s" : "") +
            (a.verdict && a.verdict !== "ok" ? " (" + esc(a.verdict) + ")" : "") +
            (a.error ? '<div class="err">' + esc(a.error) + "</div>" : "") +
            "</li>").join("")
        : "<li>No model was tried.</li>") +
    "</ul>" +
    (r.error && !r.ok ? '<div class="walk"><div class="err">' + esc(r.error) + "</div></div>" : "");
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
// Why it failed is cached alongside the result. Keeping only the models
// meant a provider that refused to list looked identical to one that served
// an empty list, and the browser below then skipped the fetch and showed
// "no models" with nothing to explain it.
const catalogues = {};

async function fetchCatalogue(i) {
  if (catalogues[i]) return catalogues[i];
  try {
    const out = await api("/api/catalogue?index=" + i);
    catalogues[i] = { models: out.models || [], error: out.error || "" };
  } catch (err) {
    catalogues[i] = { models: [], error: err.message };
  }
  return catalogues[i];
}

async function fillCatalogue(i) {
  const list = $("cat" + i);
  if (!list || list.dataset.done) return;
  list.dataset.done = "1";
  const { models } = await fetchCatalogue(i);
  if ($("cat" + i)) {
    $("cat" + i).innerHTML = models.map((m) => '<option value="' + attr(m.id) + '"></option>').join("");
  }
}

// --- browsing a provider's catalogue --------------------------------------
// The datalist above is fine when you know the name. This is for when you do
// not: the whole list, searchable, with what models.dev knows beside each
// one, and several added at once.
//
// Typing a name you half-remember is how a model ends up configured under a
// name the provider does not serve, which fails every request with a 404
// that looks like the provider being down.
async function browseDialog(i) {
  const p = state.providers[i];
  openDialog(
    '<h2>' + esc(p.name || p.label) + "</h2>" +
    "<p>Everything this provider lists. Ticked ones are already in your rotation.</p>" +
    '<div class="cat-top">' +
      '<input type="text" id="cat-q" placeholder="Search models" autocomplete="off">' +
      '<label style="margin:0;text-transform:none;letter-spacing:0;font-size:12.5px;color:var(--ink-2);display:flex;gap:6px;align-items:center">' +
        '<input type="checkbox" id="cat-free" style="width:auto"> Free only</label>' +
    "</div>" +
    '<div class="cat-list" id="cat-list"><p class="cat-none"><span class="spin"></span>Asking the provider…</p></div>' +
    '<p class="err" id="cat-err"></p>' +
    '<div class="acts">' +
      '<button data-dlg="close">Close</button>' +
      '<button class="primary" id="cat-add" disabled>Add selected</button>' +
    "</div>",
  );
  $("dialog").classList.add("wide");

  const { models, error } = await fetchCatalogue(i);
  if (!$("cat-list")) return; // the dialog was closed while we waited
  if (error) {
    $("cat-err").textContent = "This provider would not list its models: " + error +
      ". You can still add one by name in the box behind this dialog.";
  }

  const picked = new Set();

  const draw = () => {
    const q = $("cat-q").value.trim().toLowerCase();
    const freeOnly = $("cat-free").checked;
    const shown = models.filter((m) =>
      (!q || m.id.toLowerCase().includes(q)) && (!freeOnly || m.input === 0));

    $("cat-add").disabled = picked.size === 0;
    $("cat-add").textContent = picked.size ? "Add " + picked.size + " model" + (picked.size === 1 ? "" : "s") : "Add selected";

    if (!shown.length) {
      $("cat-list").innerHTML = '<p class="cat-none">' +
        (models.length ? "Nothing matches." : "This provider listed no models.") + "</p>";
      return;
    }

    $("cat-list").innerHTML = shown.map((m) => {
      const have = p.models.includes(m.id);
      const bits = [];
      if (m.context) bits.push(Math.round(m.context / 1000) + "k ctx");
      if (m.input !== undefined && m.output !== undefined) bits.push(money(m.input) + " / " + money(m.output));
      if (m.tools === false) bits.push("no tools");
      if (m.vision) bits.push("vision");
      return '<div class="cat-row" data-have="' + (have ? 1 : 0) + '">' +
        '<input type="checkbox" data-cat="' + attr(m.id) + '"' +
          (have ? " checked disabled" : picked.has(m.id) ? " checked" : "") + ">" +
        "<label>" + esc(m.id) + "</label>" +
        (bits.length ? '<span class="meta">' + esc(bits.join(" · ")) + "</span>" : "") +
      "</div>";
    }).join("");
  };

  $("cat-list").addEventListener("change", (e) => {
    const id = e.target.dataset.cat;
    if (!id) return;
    if (e.target.checked) picked.add(id);
    else picked.delete(id);
    $("cat-add").disabled = picked.size === 0;
    $("cat-add").textContent = picked.size ? "Add " + picked.size + " model" + (picked.size === 1 ? "" : "s") : "Add selected";
  });
  $("cat-q").addEventListener("input", draw);
  $("cat-free").addEventListener("change", draw);

  $("cat-add").addEventListener("click", async () => {
    const add = [...picked].filter((m) => !p.models.includes(m));
    if (!add.length) return;
    $("cat-add").disabled = true;
    p.models.push(...add);
    try {
      await save();
      if (closeDialog) closeDialog();
      toast("Added " + add.length + " model" + (add.length === 1 ? "" : "s"));
    } catch (err) {
      p.models = p.models.filter((m) => !add.includes(m));
      $("cat-add").disabled = false;
      $("cat-err").textContent = "Could not save: " + err.message;
    }
  });

  draw();
  $("cat-q").focus();
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
  if (btn.id === "theme") { flipTheme(); return; }
  if (btn.id === "streaming") { state.streaming = !state.streaming; await save({ redraw: false }); renderHeader(); return; }
  if (btn.id === "refresh") {
    await Promise.all([loadRecords(), loadCatalog(), loadRequests()]);
    renderAll();
    toast("Record refreshed");
    return;
  }

  if (act === "browse") { await browseDialog(i); return; }

  // --- the request log ---
  if (btn.dataset.f) {
    reqFilter = btn.dataset.f;
    for (const b of $("reqfilter").children) b.classList.toggle("on", b === btn);
    renderRequests();
    return;
  }

  if (btn.dataset.req !== undefined) {
    reqPicked = Number(btn.dataset.req);
    renderRequests();
    return;
  }

  if (btn.id === "reqclear") {
    if (!requests.length) { toast("Nothing logged yet"); return; }
    if (!await ask(
      "Clear all " + requests.length + " logged requests?",
      "This only empties the log. Nothing the models have learned is touched, and routing is unchanged.",
      "Clear it",
    )) return;
    await api("/api/requests/clear", { method: "POST" });
    reqPicked = null;
    await loadRequests();
    renderDetail();
    toast("Cleared");
    return;
  }

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
      showResult(model, [
        ["Result", r.ok
          ? (r.calledTool ? "Called the tool" : "Answered, but in prose — no tool call")
          : "Failed"],
      ].concat(r.ok ? [] : [["Error", r.error]]),
        r.ok && !r.calledTool
          ? "Claude Code reads and edits files with tool calls, so a model that answers in prose here is not much use to it."
          : undefined);
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
