// The admin panel's single page. Kept as one string so opencc stays
// dependency-free and there's nothing to build.
//
// Two pages, answering two different questions.
//
//   Providers    what is on offer. Every model each backend serves,
//                searchable across all of them, tick what you want.
//   Your models  what is in the pot, as one table sortable by any column.
//
// What a model can do is read from models.dev: context window, price, tool
// calling, images. Nothing here probes for it. Which model answers a given
// request is a separate question, decided by what each one has actually done,
// and the Record column is that number.
const DARK = `
    --bg: #0c0e12; --side: #10131a; --panel: #151922; --panel-2: #1b202a;
    --rule: #262d39; --rule-2: #323a48; --hover: #1d2330;
    --ink: #e7eaef; --ink-2: #aeb7c4; --ink-3: #7d8799;
    --accent: #4d7dee; --accent-soft: rgba(77, 125, 238, .14); --accent-ink: #fff;
    --ok: #6fd3a5; --ok-bg: rgba(111, 211, 165, .13);
    --warn: #e4b261; --warn-bg: rgba(228, 178, 97, .13);
    --bad: #f08c8c; --bad-bg: rgba(240, 140, 140, .13);
    color-scheme: dark;`;

export const page = () => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>opencc</title>
<script>
  // Before first paint, so a dark page never flashes white.
  try {
    var t = localStorage.getItem("opencc-theme");
    if (t === "light" || t === "dark") document.documentElement.dataset.theme = t;
  } catch (e) {}
</script>
<style>
  :root {
    --bg: #f7f8fa; --side: #fbfbfc; --panel: #fff; --panel-2: #f4f6f8;
    --rule: #e4e7ec; --rule-2: #d3d8e0; --hover: #f0f2f5;
    --ink: #161a21; --ink-2: #4b5563; --ink-3: #7b8595;
    --accent: #2b5fd9; --accent-soft: #e9effc; --accent-ink: #fff;
    --ok: #0f6b45; --ok-bg: #e4f2eb;
    --warn: #8a5806; --warn-bg: #f9f0de;
    --bad: #9b2c2c; --bad-bg: #f8e8e8;
    --r: 8px; --r-s: 5px;
    --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    color-scheme: light;
  }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { ${DARK} } }
  :root[data-theme="dark"] { ${DARK} }

  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--ink-2);
    font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, sans-serif;
  }
  code, .mono { font-family: var(--mono); }
  a { color: var(--accent); }

  /* --- frame ------------------------------------------------------------ */
  .app { display: grid; grid-template-columns: 216px minmax(0, 1fr); min-height: 100vh; }
  aside {
    background: var(--side); border-right: 1px solid var(--rule);
    padding: 16px 12px; position: sticky; top: 0; height: 100vh;
    display: flex; flex-direction: column; gap: 4px; overflow-y: auto;
  }
  .brand { display: flex; align-items: baseline; gap: 7px; padding: 0 8px 14px; }
  .brand b { font-size: 16px; color: var(--ink); letter-spacing: -.01em; }
  .brand small { font: 11px var(--mono); color: var(--ink-3); }
  nav a {
    display: flex; align-items: center; gap: 9px; padding: 8px 9px;
    border-radius: var(--r-s); color: var(--ink-2); text-decoration: none; font-size: 13.5px;
  }
  nav a:hover { background: var(--hover); color: var(--ink); }
  nav a.on { background: var(--accent-soft); color: var(--accent); font-weight: 600; }
  nav a .n { margin-left: auto; font: 11px var(--mono); color: var(--ink-3); }
  nav a.on .n { color: var(--accent); }
  .side-foot { margin-top: auto; padding-top: 14px; border-top: 1px solid var(--rule); display: grid; gap: 8px; }
  .side-foot label { display: block; font-size: 10.5px; text-transform: uppercase; letter-spacing: .06em; color: var(--ink-3); margin-bottom: 4px; }
  .side-foot .row { display: flex; gap: 6px; }
  .side-foot .row button { flex: 1; }

  main { padding: 22px 24px 60px; min-width: 0; }
  @media (max-width: 760px) {
    .app { grid-template-columns: minmax(0, 1fr); }
    aside { position: static; height: auto; }
    nav { display: flex; flex-wrap: wrap; gap: 4px; }
    main { padding: 16px 14px 48px; }
  }
  .page { display: none; }
  .page.on { display: block; animation: in .16s ease-out; }
  @keyframes in { from { opacity: 0; transform: translateY(3px); } }
  @media (prefers-reduced-motion: reduce) { .page.on { animation: none; } }

  .head { display: flex; align-items: flex-start; gap: 14px; flex-wrap: wrap; margin-bottom: 16px; }
  .head h1 { font-size: 19px; color: var(--ink); margin: 0 0 3px; letter-spacing: -.015em; }
  .head .lead { margin: 0; color: var(--ink-3); font-size: 13px; max-width: 72ch; }
  .head .acts { margin-left: auto; display: flex; gap: 7px; flex-wrap: wrap; }

  /* --- controls --------------------------------------------------------- */
  input[type=text], input[type=password], input[type=number], input[type=search], select {
    width: 100%; padding: 7px 9px; border: 1px solid var(--rule-2);
    border-radius: var(--r-s); background: var(--panel); color: var(--ink);
    font: 13px var(--mono);
  }
  select { font-family: inherit; }
  input::placeholder { color: var(--ink-3); }
  input:focus-visible, button:focus-visible, select:focus-visible, a:focus-visible {
    outline: 2px solid var(--accent); outline-offset: 1px;
  }
  input[type=checkbox] { width: 15px; height: 15px; margin: 0; accent-color: var(--accent); cursor: pointer; flex: none; }
  button {
    font: 500 12.5px/1 ui-sans-serif, system-ui, sans-serif; cursor: pointer;
    background: var(--panel); color: var(--ink); border: 1px solid var(--rule-2);
    border-radius: var(--r-s); padding: 7px 10px; white-space: nowrap;
  }
  button:hover:not(:disabled) { background: var(--hover); }
  button:active:not(:disabled) { transform: translateY(1px); }
  button:disabled { opacity: .45; cursor: default; }
  button.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); }
  button.danger { color: var(--bad); }
  button.ghost { border-color: transparent; background: transparent; color: var(--ink-2); }
  button.ghost:hover:not(:disabled) { background: var(--hover); color: var(--ink); }
  button.sm { padding: 4px 7px; font-size: 11.5px; }
  .fld label { display: block; font-size: 10.5px; text-transform: uppercase; letter-spacing: .06em; color: var(--ink-3); margin: 13px 0 4px; }
  .fld label .hint { text-transform: none; letter-spacing: 0; }

  .tag {
    font: 600 10px/1 var(--mono); text-transform: uppercase; letter-spacing: .04em;
    padding: 3px 5px; border-radius: 3px; background: var(--panel-2); color: var(--ink-3); white-space: nowrap;
  }
  .tag.ok { background: var(--ok-bg); color: var(--ok); }
  .tag.bad { background: var(--bad-bg); color: var(--bad); }
  .tag.warn { background: var(--warn-bg); color: var(--warn); }
  .tag.acc { background: var(--accent-soft); color: var(--accent); }
  .muted { color: var(--ink-3); }
  .meta { font: 11px var(--mono); color: var(--ink-3); white-space: nowrap; }

  /* --- providers page --------------------------------------------------- */
  .card { background: var(--panel); border: 1px solid var(--rule); border-radius: var(--r); overflow: hidden; }
  .cat-top {
    display: flex; align-items: center; gap: 9px; padding: 10px 13px;
    border-bottom: 1px solid var(--rule); flex-wrap: wrap;
  }
  .cat-top input[type=search] { flex: 1; min-width: 150px; font-family: inherit; }
  .cat-top select, .cat-top button { flex: none; width: auto; }
  .chk { display: flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--ink-2); cursor: pointer; white-space: nowrap; }

  .prov { border-bottom: 1px solid var(--rule); }
  .prov:last-child { border-bottom: 0; }
  .prov-h {
    display: flex; align-items: center; gap: 9px; padding: 9px 13px;
    background: var(--panel-2); cursor: pointer; flex-wrap: wrap;
  }
  .prov-h:hover { background: var(--hover); }
  .prov.off .prov-h .nm { color: var(--ink-3); text-decoration: line-through; }
  /* 28px square. It was 9x15, which is below any sane hit target, and the
     glyph swaps rather than rotating so the global button:active transform
     has nothing to fight with. */
  .prov-h .fold {
    border: 0; background: none; color: var(--ink-3);
    width: 28px; height: 28px; padding: 0; flex: none;
    display: grid; place-items: center; font-size: 11px; border-radius: var(--r-s);
  }
  .prov-h .fold:hover { background: var(--rule); color: var(--ink); }
  .prov.shut .rows, .prov.shut .note { display: none; }
  .prov-h .who { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; overflow: hidden; }
  .prov-h .nm { font-weight: 600; font-size: 14px; color: var(--ink); white-space: nowrap; }
  .prov-h .url { font: 11px var(--mono); color: var(--ink-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .by-name { display: flex; gap: 5px; flex: none; }
  .by-name input { width: 148px; font-size: 12px; padding: 5px 7px; }

  .rows { max-height: 62vh; overflow: auto; }
  .mrow {
    display: flex; align-items: center; gap: 9px; padding: 6px 13px 6px 30px;
    border-top: 1px solid var(--rule); font-size: 13px;
  }
  .mrow:hover { background: var(--hover); }
  .mrow.taken { background: var(--accent-soft); }
  .mrow .id { flex: 1; min-width: 0; font-family: var(--mono); font-size: 12.5px; color: var(--ink); cursor: pointer; word-break: break-all; }
  .mrow.taken .id { font-weight: 600; }
  .note { padding: 10px 13px 12px 30px; font-size: 12.5px; color: var(--ink-3); border-top: 1px solid var(--rule); }
  .note.err { color: var(--bad); }

  .picks {
    display: flex; align-items: center; gap: 9px; padding: 9px 13px; flex-wrap: wrap;
    border-top: 1px solid var(--accent); background: var(--accent-soft); font-size: 13px;
  }
  .picks .n { font-weight: 600; color: var(--ink); margin-right: auto; }

  /* --- your models table ------------------------------------------------ */
  .mt-top { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; margin-bottom: 10px; min-height: 30px; }
  .mt-top .sorts { margin-right: auto; font-size: 12.5px; color: var(--ink-3); display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .chip { display: inline-flex; align-items: center; gap: 5px; background: var(--panel); border: 1px solid var(--rule-2); border-radius: 99px; padding: 3px 5px 3px 9px; font-size: 11.5px; color: var(--ink-2); }
  .chip button { border: 0; background: none; padding: 0 2px; color: var(--ink-3); font-size: 12px; }

  .mt-wrap { overflow-x: auto; background: var(--panel); border: 1px solid var(--rule); border-radius: var(--r); }
  table.mt { border-collapse: collapse; width: 100%; font-size: 13px; }
  table.mt th, table.mt td { padding: 7px 9px; text-align: left; border-bottom: 1px solid var(--rule); white-space: nowrap; }
  table.mt thead th { background: var(--panel-2); position: sticky; top: 0; z-index: 1; font-weight: 600; font-size: 11.5px; color: var(--ink-3); text-transform: uppercase; letter-spacing: .05em; }
  table.mt thead th button { border: 0; background: none; padding: 2px 0; color: inherit; font: inherit; text-transform: inherit; letter-spacing: inherit; }
  table.mt thead th button:hover { color: var(--ink); background: none; }
  table.mt thead th button.on { color: var(--accent); }
  table.mt tbody tr:last-child td { border-bottom: 0; }
  table.mt tbody tr:hover { background: var(--hover); }
  table.mt tr.picked { background: var(--accent-soft); }
  table.mt tr.dim td { opacity: .45; }
  table.mt td.m { font-family: var(--mono); font-size: 12.5px; color: var(--ink); max-width: 320px; overflow: hidden; text-overflow: ellipsis; }
  table.mt td.num, table.mt th.num { text-align: right; font-family: var(--mono); font-size: 12px; }
  .yes { color: var(--ok); font-weight: 700; }
  .no { color: var(--ink-3); }
  .acts { display: flex; gap: 4px; align-items: center; }
  .empty { padding: 40px; text-align: center; color: var(--ink-3); }

  /* --- requests --------------------------------------------------------- */
  .seg { display: flex; border: 1px solid var(--rule-2); border-radius: var(--r-s); overflow: hidden; }
  .seg button { border: 0; border-radius: 0; padding: 6px 11px; }
  .seg button + button { border-left: 1px solid var(--rule-2); }
  .seg button.on { background: var(--accent); color: var(--accent-ink); }
  .reqs { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.15fr); }
  @media (max-width: 900px) { .reqs { grid-template-columns: minmax(0, 1fr); } }
  .req-list { max-height: 440px; overflow: auto; border-right: 1px solid var(--rule); }
  @media (max-width: 900px) { .req-list { border-right: 0; border-bottom: 1px solid var(--rule); max-height: 240px; } }
  .req { display: flex; align-items: center; gap: 8px; width: 100%; text-align: left; padding: 8px 13px; border: 0; border-bottom: 1px solid var(--rule); border-radius: 0; background: none; font-size: 12.5px; }
  .req:hover { background: var(--hover); }
  .req.on { background: var(--accent-soft); box-shadow: inset 2px 0 0 var(--accent); }
  .req .when { font: 11.5px var(--mono); color: var(--ink-3); flex: none; }
  .req .who { color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0; }
  .dot { width: 7px; height: 7px; border-radius: 50%; flex: none; background: var(--ink-3); }
  .dot.ok { background: var(--ok); } .dot.bad { background: var(--bad); }
  .req-detail { padding: 13px; overflow: auto; max-height: 440px; font-size: 12.5px; }
  .kv { display: flex; gap: 10px; padding: 6px 0; border-bottom: 1px solid var(--rule); }
  .kv b { color: var(--ink); font-weight: 600; min-width: 92px; flex: none; }
  .kv span { word-break: break-word; }
  .walk { margin: 10px 0 0; padding: 0; list-style: none; }
  .walk li { padding: 7px 0; border-bottom: 1px solid var(--rule); font: 12px var(--mono); }
  .walk li:last-child { border-bottom: 0; }
  .walk .err { color: var(--bad); white-space: pre-wrap; word-break: break-word; margin-top: 3px; }

  /* --- dialog / toast --------------------------------------------------- */
  .scrim { position: fixed; inset: 0; background: rgba(0,0,0,.45); z-index: 40; display: none; align-items: center; justify-content: center; padding: 20px; }
  .scrim.show { display: flex; }
  .dialog { background: var(--panel); border: 1px solid var(--rule); border-radius: var(--r); padding: 18px 20px; width: 100%; max-width: 520px; max-height: calc(100vh - 40px); overflow: auto; }
  .dialog.wide { max-width: 760px; }
  .dialog h2 { font-size: 16px; color: var(--ink); margin: 0 0 6px; }
  .dialog p { margin: 0 0 4px; color: var(--ink-3); font-size: 13px; }
  .dialog .err { color: var(--bad); min-height: 17px; font-size: 12.5px; margin-top: 8px; }
  .dialog .btns { display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; flex-wrap: wrap; }
  .dialog .btns .left { margin-right: auto; }
  pre.dump { background: var(--panel-2); border: 1px solid var(--rule); border-radius: var(--r-s); padding: 9px; font: 11.5px/1.5 var(--mono); max-height: 230px; overflow: auto; white-space: pre-wrap; word-break: break-word; margin: 5px 0 0; color: var(--ink-2); }
  .spin { display: inline-block; width: 12px; height: 12px; vertical-align: -1px; margin-right: 6px; border: 2px solid var(--rule-2); border-top-color: var(--accent); border-radius: 50%; animation: spin .7s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .spin { animation-duration: 2.4s; } }
  .toast { position: fixed; left: 50%; bottom: 18px; transform: translateX(-50%); z-index: 50; background: var(--ink); color: var(--bg); padding: 9px 14px; border-radius: var(--r-s); font-size: 13px; opacity: 0; transition: opacity .18s; pointer-events: none; max-width: 80vw; }
  .toast.show { opacity: 1; }
  .toast.bad { background: var(--bad); color: #fff; }
</style>
</head>
<body>
<div class="app">
  <aside>
    <div class="brand"><b>opencc</b><small id="ver"></small></div>
    <nav id="nav">
      <a href="#providers" data-page="providers">Providers <span class="n" id="n-prov"></span></a>
      <a href="#models" data-page="models">Your models <span class="n" id="n-models"></span></a>
      <a href="#requests" data-page="requests">Requests <span class="n" id="n-reqs"></span></a>
    </nav>
    <div class="side-foot">
      <div>
        <label for="port">Proxy port</label>
        <input type="number" id="port" min="1" max="65535">
      </div>
      <div class="row">
        <button id="streaming"></button>
        <button id="theme" title="Light or dark"></button>
      </div>
      <button id="catalog"></button>
      <button id="reset" class="danger" title="Forget every result and start over">Reset record</button>
    </div>
  </aside>

  <main>
    <section class="page" id="page-providers">
      <div class="head">
        <div>
          <h1>Providers</h1>
          <p class="lead">Every model your backends serve. Click one to put it in the pot, or tick
            several. Context, price and abilities come from models.dev.</p>
        </div>
        <div class="acts"><button class="primary" id="add-prov">Add a provider</button></div>
      </div>
      <div class="card">
        <div class="cat-top">
          <input type="checkbox" id="pick-all" title="Select every model shown">
          <input type="search" id="q" placeholder="Search every model">
          <label class="chk"><input type="checkbox" id="free"> Free only</label>
          <select id="sort" aria-label="Sort models">
            <option value="name">Sort by name</option>
            <option value="price">Sort by price</option>
            <option value="context">Sort by context</option>
          </select>
          <button id="fold-all">Collapse all</button>
        </div>
        <div id="plist"></div>
        <div class="picks" id="picks" hidden></div>
      </div>
    </section>

    <section class="page" id="page-models">
      <div class="head">
        <div>
          <h1>Your models</h1>
          <p class="lead">Everything opencc can route to. Order here means nothing: which one answers
            a request is drawn from the Record column, fresh every time, so load spreads over what works.</p>
        </div>
        <div class="acts"><button class="primary" id="go-prov">Add models</button></div>
      </div>
      <div class="mt-top" id="mt-top"></div>
      <div id="mt"></div>
    </section>

    <section class="page" id="page-requests">
      <div class="head">
        <div>
          <h1>Requests</h1>
          <p class="lead">What the proxy actually served: which models were tried, what each
            answered, and which one replied.</p>
        </div>
        <div class="acts">
          <div class="seg" id="reqfilter">
            <button data-f="all" class="on">All</button>
            <button data-f="failed">Failed</button>
            <button data-f="fallback" title="Served, but not by the first model tried">Fallbacks</button>
          </div>
          <button id="reqclear" class="danger">Clear</button>
        </div>
      </div>
      <div class="card reqs">
        <div class="req-list" id="reqlist"></div>
        <div class="req-detail" id="reqdetail"></div>
      </div>
    </section>
  </main>
</div>

<div class="scrim" id="scrim" role="dialog" aria-modal="true"><div class="dialog" id="dialog"></div></div>
<div class="toast" id="toast" role="status"></div>

<script>
"use strict";
var $ = function (id) { return document.getElementById(id); };

// Tiny DOM builder. Everything goes through it rather than innerHTML, so a
// model name with an angle bracket in it cannot break the page.
function h(tag, props) {
  var el = document.createElement(tag);
  props = props || {};
  for (var k in props) {
    var v = props[k];
    if (v === null || v === undefined || v === false) continue;
    if (k.slice(0, 2) === "on") el.addEventListener(k.slice(2), v);
    else if (k in el) el[k] = v;
    else el.setAttribute(k, v);
  }
  add(el, Array.prototype.slice.call(arguments, 2));
  return el;
}
function add(el, kids) {
  for (var i = 0; i < kids.length; i++) {
    var k = kids[i];
    if (k === null || k === undefined || k === false) continue;
    if (Array.isArray(k)) add(el, k);
    else el.append(k);
  }
}
function put(el) { el.replaceChildren(); add(el, Array.prototype.slice.call(arguments, 1)); return el; }

// --- state ----------------------------------------------------------------
var S = { providers: [], port: "3000", streaming: true, version: "" };
var REC = {};        // "baseUrl|model" -> { kind: {ok, fail, statuses} }
var COOL = {};
var CAT = {};        // "baseUrl|model" -> models.dev facts, for configured models
var CATINFO = { size: 0, age: null };
var LISTS = {};      // provider index -> { models, error, loading }
var REQS = [];
var reqFilter = "all";
var reqPicked = null;

var PICKED = new Set();   // "i|model" ticked in the catalogue
var MINE = new Set();     // "i|model" ticked in the table
var SHUT = new Set();     // collapsed providers
var SORT = [];
var query = "";
var freeOnly = false;
var catSort = "name";
var lastRow = null;

var key = function (baseUrl, model) { return baseUrl + "|" + model; };
var pk = function (i, model) { return i + "|" + model; };
var unpk = function (k) {
  var at = k.indexOf("|");
  return { i: Number(k.slice(0, at)), model: k.slice(at + 1) };
};

// --- small helpers --------------------------------------------------------
var toastTimer;
function toast(msg, bad) {
  var t = $("toast");
  t.textContent = msg;
  t.className = "toast show" + (bad ? " bad" : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { t.className = "toast"; }, bad ? 6000 : 2400);
}

function kTok(n) {
  if (!n) return "-";
  if (n >= 1000000) return (Math.round(n / 100000) / 10) + "M";
  if (n >= 1000) return Math.round(n / 1000) + "k";
  return String(n);
}
function usd(x) {
  if (x === null || x === undefined) return "-";
  if (x === 0) return "free";
  if (x < 0.01) return "$" + x.toFixed(4);
  if (x < 1) return "$" + x.toFixed(3).replace(/0$/, "");
  return "$" + x.toFixed(2);
}
function ago(at) {
  var s = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (s < 60) return s + "s ago";
  if (s < 3600) return Math.round(s / 60) + "m ago";
  if (s < 86400) return Math.round(s / 3600) + "h ago";
  return new Date(at).toLocaleDateString();
}
function byName(a, b) {
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

// What this model has actually done, across every kind of request. This is
// the number routing is drawn from, so it is the one column that is about
// opencc rather than about models.dev.
function recOf(baseUrl, model) {
  var r = REC[key(baseUrl, model)] || {};
  var ok = 0, fail = 0;
  for (var k in r) { ok += r[k].ok; fail += r[k].fail; }
  return { ok: ok, fail: fail, total: ok + fail, pct: ok + fail ? Math.round((ok / (ok + fail)) * 100) : null };
}
function facts(baseUrl, model) { return CAT[key(baseUrl, model)] || null; }
var isFree = function (d) { return Boolean(d) && d.input === 0 && d.output === 0; };
var costOf = function (d) { return d && d.input !== undefined ? d.input + (d.output || 0) : Infinity; };

// --- api ------------------------------------------------------------------
async function api(path, opts) {
  var res = await fetch(path, opts);
  if (!res.ok) {
    var body = await res.json().catch(function () { return {}; });
    throw new Error(body.error || ("HTTP " + res.status));
  }
  return res.json();
}
function post(path, body) {
  return api(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
}

// --- dialogs --------------------------------------------------------------
var closeDialog = null;
function openDialog(nodes, opts) {
  put($("dialog"), nodes);
  $("dialog").className = "dialog" + (opts && opts.wide ? " wide" : "");
  $("scrim").classList.add("show");
  closeDialog = function () {
    $("scrim").classList.remove("show");
    $("dialog").replaceChildren();
    closeDialog = null;
    if (opts && opts.onClose) opts.onClose();
  };
  var first = $("dialog").querySelector("input, button");
  if (first) first.focus();
}
document.addEventListener("keydown", function (e) { if (e.key === "Escape" && closeDialog) closeDialog(); });
$("scrim").addEventListener("mousedown", function (e) { if (e.target === $("scrim") && closeDialog) closeDialog(); });

function ask(title, body, yes) {
  return new Promise(function (resolve) {
    var done = false;
    openDialog([
      h("h2", {}, title),
      h("p", {}, body),
      h("div", { className: "btns" },
        h("button", { onclick: function () { if (closeDialog) closeDialog(); } }, "Cancel"),
        h("button", { className: "primary danger", onclick: function () {
          done = true; resolve(true); if (closeDialog) closeDialog();
        } }, yes)),
    ], { onClose: function () { if (!done) resolve(false); } });
  });
}

// --- loading --------------------------------------------------------------
async function loadState() { S = await api("/api/state"); }

async function loadRecord() {
  try {
    var out = await api("/api/stats");
    COOL = out.cooling || {};
    REC = {};
    out.rows.forEach(function (row) {
      var k = key(row.baseUrl, row.model);
      (REC[k] || (REC[k] = {}))[row.kind] = row;
    });
  } catch (e) { REC = {}; COOL = {}; }
}

async function loadCatalog() {
  try {
    var out = await api("/api/catalog");
    CAT = out.known || {};
    CATINFO = { size: out.size || 0, age: out.age };
  } catch (e) { CAT = {}; CATINFO = { size: 0, age: null }; }
  drawCatalogButton();
}

async function loadRequests() {
  try { REQS = (await api("/api/requests")).items || []; } catch (e) { REQS = []; }
  drawRequests();
}

// A provider's own model list. Fetched once and kept, because it is a network
// round trip per provider and the Providers page wants all of them at once to
// search across.
async function loadList(i, fresh) {
  if (LISTS[i] && !fresh) return LISTS[i];
  LISTS[i] = { models: (LISTS[i] && LISTS[i].models) || [], loading: true, error: "" };
  drawProviders();
  try {
    var out = await api("/api/catalogue?index=" + i);
    LISTS[i] = { models: out.models || [], loading: false, error: out.error || "" };
  } catch (e) {
    LISTS[i] = { models: [], loading: false, error: e.message };
  }
  drawProviders();
  return LISTS[i];
}

async function save(providers) {
  var list = providers || S.providers;
  var payload = {
    providers: list.map(function (p) {
      return {
        name: p.name, baseUrl: p.baseUrl, apiKey: p.apiKey,
        models: p.models, disabled: p.disabled, disabledModels: p.disabledModels || [],
      };
    }),
    port: S.port,
    streaming: S.streaming,
  };
  var before = list.length;
  S = await post("/api/state", payload);
  if (S.providers.length < before) toast("A provider needs a base URL and at least one model, so it was not kept", true);
  drawAll();
}

// --- pages ----------------------------------------------------------------
// In nav order, and the first is where you land: picking models is the thing
// you came to do, and "Your models" is empty until you have.
var PAGES = ["providers", "models", "requests"];
function current() {
  var want = location.hash.slice(1);
  return PAGES.indexOf(want) >= 0 ? want : PAGES[0];
}
function showPage() {
  var now = current();
  PAGES.forEach(function (p) { $("page-" + p).classList.toggle("on", p === now); });
  Array.prototype.forEach.call(document.querySelectorAll("nav a"), function (a) {
    a.classList.toggle("on", a.dataset.page === now);
  });
  if (now === "providers") {
    S.providers.forEach(function (p, i) { if (!LISTS[i]) loadList(i); });
  }
}
window.addEventListener("hashchange", showPage);

// --- sidebar --------------------------------------------------------------
function currentTheme() {
  return document.documentElement.dataset.theme ||
    (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
}
function drawTheme() { $("theme").textContent = currentTheme() === "dark" ? "Light" : "Dark"; }
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", drawTheme);

function drawCatalogButton() {
  var total = 0, known = 0;
  S.providers.forEach(function (p) {
    (p.models || []).forEach(function (m) {
      total++;
      if (facts(p.baseUrl, m)) known++;
    });
  });
  var b = $("catalog");
  b.textContent = CATINFO.size ? "models.dev " + known + "/" + total : "models.dev -";
  b.title = CATINFO.size
    ? "models.dev knows " + known + " of your " + total + " models: context window, price, tool calling and images. " +
      CATINFO.size.toLocaleString() + " models on file, fetched " +
      (CATINFO.age === null ? "just now" : ago(Date.now() - CATINFO.age)) +
      ", cached a day. Click to fetch it again."
    : "models.dev could not be reached, so nothing is known about what your models can do. Click to try again.";
}

function drawSidebar() {
  $("ver").textContent = S.version || "";
  if (document.activeElement !== $("port")) $("port").value = S.port;
  $("streaming").textContent = "Streaming " + (S.streaming ? "on" : "off");
  $("streaming").title = S.streaming
    ? "Replies stream through as they are written. Click to switch off."
    : "Replies are read in full upstream and re-streamed. Click to switch on.";
  var live = S.providers.filter(function (p) { return !p.disabled; });
  var models = live.reduce(function (n, p) {
    return n + p.models.filter(function (m) { return (p.disabledModels || []).indexOf(m) < 0; }).length;
  }, 0);
  $("n-models").textContent = models || "";
  $("n-prov").textContent = S.providers.length || "";
  $("n-reqs").textContent = REQS.length || "";
  drawTheme();
  drawCatalogButton();
}

// --- providers page -------------------------------------------------------
function abilityTags(d) {
  if (!d) return null;
  return [
    d.context ? h("span", { className: "meta", title: "Context window models.dev publishes: " + d.context.toLocaleString() + " tokens" }, kTok(d.context) + " ctx") : null,
    d.input !== undefined ? h("span", { className: "meta", title: "Price per million tokens, in / out" }, usd(d.input) + " / " + usd(d.output)) : null,
    d.tools === false ? h("span", { className: "tag", title: "models.dev says this model does not call tools" }, "no tools") : null,
    d.vision ? h("span", { className: "tag", title: "models.dev says this model reads images" }, "vision") : null,
  ];
}

function matches(id, d) {
  if (query && id.toLowerCase().indexOf(query.toLowerCase()) < 0) return false;
  if (freeOnly && !isFree(d)) return false;
  return true;
}

// Every name this provider has: the ones it lists, plus any in your config it
// does not. A local server that swapped builds, or a name typed by hand,
// belongs on screen, or taking it out would mean editing the file.
function namesFor(p, i) {
  var list = LISTS[i] || { models: [] };
  var listed = list.models.map(function (m) { return m.id; });
  var extra = p.models.filter(function (m) { return listed.indexOf(m) < 0; });
  return { listed: listed, all: listed.concat(extra) };
}

function shownKeys() {
  var out = [];
  S.providers.forEach(function (p, i) {
    namesFor(p, i).all.forEach(function (id) {
      if (matches(id, facts(p.baseUrl, id))) out.push(pk(i, id));
    });
  });
  return out;
}

function drawProviders() {
  var sections = S.providers.map(function (p, i) {
    var list = LISTS[i] || { models: [], loading: true, error: "" };
    var names = namesFor(p, i);
    var rows = names.all.filter(function (id) { return matches(id, facts(p.baseUrl, id)); });

    rows.sort(function (a, b) {
      var da = facts(p.baseUrl, a), db = facts(p.baseUrl, b);
      if (catSort === "price") return (costOf(da) - costOf(db)) || byName(a, b);
      if (catSort === "context") return ((db && db.context ? db.context : 0) - (da && da.context ? da.context : 0)) || byName(a, b);
      return byName(a, b);
    });

    if ((query || freeOnly) && !rows.length) return null;

    var shut = SHUT.has(i);
    var ticked = rows.filter(function (id) { return PICKED.has(pk(i, id)); });
    var fold = function () {
      if (SHUT.has(i)) SHUT.delete(i); else SHUT.add(i);
      drawProviders();
    };

    return h("div", { className: "prov" + (p.disabled ? " off" : "") + (shut ? " shut" : "") },
      h("div", { className: "prov-h", onclick: function (e) {
        // Everything interactive in the header handles its own click; the
        // rest of the strip folds.
        if (e.target.closest("button, input, label, form")) return;
        fold();
      } },
        // It used to have no handler of its own, so the guard above threw
        // away every click on it: the one control that looks like it folds
        // was the one place that did not.
        h("button", {
          className: "fold", type: "button",
          "aria-expanded": shut ? "false" : "true",
          "aria-label": (shut ? "Expand " : "Collapse ") + (p.name || p.label),
          title: shut ? "Expand" : "Collapse",
          onclick: fold,
        }, shut ? "\\u25b8" : "\\u25be"),
        rows.length ? h("input", {
          type: "checkbox",
          checked: ticked.length > 0 && ticked.length === rows.length,
          title: "Select all of this provider's models shown",
          onchange: function (e) {
            rows.forEach(function (id) {
              if (e.target.checked) PICKED.add(pk(i, id)); else PICKED.delete(pk(i, id));
            });
            drawProviders();
          },
        }) : null,
        h("div", { className: "who" },
          h("span", { className: "nm" }, p.name || p.label),
          p.disabled ? h("span", { className: "tag" }, "off") : null,
          list.loading ? h("span", { className: "tag" }, "loading")
            : list.error ? h("span", { className: "tag bad", title: "This backend would not list its models: " + list.error }, "no list")
            : h("span", { className: "tag" }, names.listed.length + " listed"),
          h("span", { className: "tag acc" }, p.models.length + " in pot"),
          h("span", { className: "url", title: p.baseUrl }, p.baseUrl)),
        h("form", { className: "by-name", onsubmit: function (e) {
          e.preventDefault();
          var box = e.target.elements.name;
          var id = box.value.trim();
          if (!id) return;
          if (p.models.indexOf(id) >= 0) { toast(id + " is already in the pot"); return; }
          box.value = "";
          addModels([{ i: i, model: id }]);
        } },
          h("input", { type: "text", name: "name", placeholder: "model name",
            title: "Add a model by its exact name, including one this provider does not list" }),
          h("button", { className: "sm" }, "Add")),
        h("button", { className: "sm", title: "Ask this provider for its model list again",
          onclick: function () { loadList(i, true); } }, "Refresh"),
        h("button", { className: "sm", onclick: function () { providerForm(i); } }, "Edit")),

      rows.length ? h("div", { className: "rows" }, rows.map(function (id) {
        var d = facts(p.baseUrl, id);
        var have = p.models.indexOf(id) >= 0;
        return h("div", { className: "mrow" + (have ? " taken" : "") },
          h("input", {
            type: "checkbox", checked: PICKED.has(pk(i, id)), "aria-label": "Select " + id,
            onchange: function (e) {
              if (e.target.checked) PICKED.add(pk(i, id)); else PICKED.delete(pk(i, id));
              drawPicks();
            },
          }),
          h("span", { className: "id",
            title: have ? "In the pot. Click to take it out." : "Click to put it in the pot.",
            onclick: function () {
              if (have) removeModels([{ i: i, model: id }]); else addModels([{ i: i, model: id }]);
            } }, id),
          isFree(d) ? h("span", { className: "tag ok", title: "models.dev lists this model at $0" }, "free") : null,
          // Only when there is a list to be absent from. A provider that
          // would not list anything makes every model "not listed", which is
          // noise about the provider dressed up as news about the model.
          names.listed.length && names.listed.indexOf(id) < 0
            ? h("span", { className: "tag warn", title: "This provider does not list this name. It may have been typed by hand, or the backend may have changed what it serves." }, "not listed")
            : null,
          abilityTags(d),
          have ? h("button", { className: "sm", onclick: function () { testOne(i, id); } }, "Test") : null);
      })) : null,

      list.error ? h("div", { className: "note err" },
        "Could not list its models: " + list.error + " ",
        h("button", { className: "sm", onclick: function () { loadList(i, true); } }, "Try again"),
        h("div", { className: "muted", style: "margin-top:4px" }, "You can still add one by name above.")) : null,
      !list.loading && !list.error && !names.all.length
        ? h("div", { className: "note" }, "This provider listed no models. Add one by name above.") : null);
  }).filter(Boolean);

  put($("plist"), sections.length ? sections : h("div", { className: "empty" },
    !S.providers.length ? "No providers yet. Use Add a provider."
      : freeOnly && !query ? "No provider lists a model at $0. A provider whose list has no prices cannot say."
      : "Nothing matches."));

  var shown = shownKeys();
  var on = shown.filter(function (k) { return PICKED.has(k); });
  $("pick-all").checked = on.length > 0 && on.length === shown.length;
  $("pick-all").indeterminate = on.length > 0 && on.length < shown.length;
  $("pick-all").disabled = !shown.length;
  $("fold-all").textContent = S.providers.length && SHUT.size >= S.providers.length ? "Expand all" : "Collapse all";
  drawPicks();
}

function drawPicks() {
  var all = [];
  PICKED.forEach(function (k) {
    var t = unpk(k);
    if (S.providers[t.i]) all.push(t);
  });
  var toAdd = all.filter(function (t) { return S.providers[t.i].models.indexOf(t.model) < 0; });
  var toTake = all.filter(function (t) { return S.providers[t.i].models.indexOf(t.model) >= 0; });

  $("picks").hidden = !all.length;
  if (!all.length) return;
  put($("picks"),
    h("span", { className: "n" }, all.length + " selected"),
    h("button", { className: "sm ghost", onclick: function () { PICKED.clear(); drawProviders(); } }, "Clear"),
    toTake.length ? h("button", { className: "sm", onclick: function () { testMany(toTake); } }, "Test " + toTake.length) : null,
    toTake.length ? h("button", { className: "sm danger", onclick: function () { removeModels(toTake); } }, "Take " + toTake.length + " out") : null,
    toAdd.length ? h("button", { className: "sm primary", onclick: function () { addModels(toAdd); } }, "Add " + toAdd.length + " to the pot") : null);
}

function copyProviders() {
  return S.providers.map(function (p) {
    return Object.assign({}, p, { models: p.models.slice(), disabledModels: (p.disabledModels || []).slice() });
  });
}

async function addModels(items) {
  var next = copyProviders();
  var n = 0;
  items.forEach(function (t) {
    if (next[t.i] && next[t.i].models.indexOf(t.model) < 0) { next[t.i].models.push(t.model); n++; }
  });
  if (!n) return;
  PICKED.clear();
  await save(next);
  toast(n === 1 ? items[0].model + " added" : n + " models added");
}

async function removeModels(items) {
  var next = copyProviders();
  var n = 0;
  items.forEach(function (t) {
    var p = next[t.i];
    if (!p) return;
    var at = p.models.indexOf(t.model);
    if (at < 0) return;
    p.models.splice(at, 1);
    p.disabledModels = p.disabledModels.filter(function (m) { return m !== t.model; });
    n++;
  });
  if (!n) return;

  // A provider with no models left is not routable, and the server drops it
  // along with its key. Saying so beats watching a row vanish.
  var emptied = next.filter(function (p) { return p.models.length === 0; });
  if (emptied.length) {
    var ok = await ask(
      "Take the last model out of " + (emptied[0].name || emptied[0].baseUrl) + "?",
      "A provider with no models cannot be routed to, so it is dropped along with its API key. Switch it off instead to keep both.",
      "Take it out");
    if (!ok) return;
  }
  PICKED.clear();
  MINE.clear();
  await save(next);
  toast(n === 1 ? items[0].model + " taken out" : n + " models taken out");
}

// --- your models table ----------------------------------------------------
var COLS = {
  model: { label: "Model", how: "text", get: function (t) { return t.model; } },
  provider: { label: "Provider", how: "text", get: function (t) { return t.name; } },
  context: { label: "Context", num: true, get: function (t) { var d = facts(t.baseUrl, t.model); return d && d.context ? d.context : 0; } },
  tools: { label: "Tools", get: function (t) { var d = facts(t.baseUrl, t.model); return d ? (d.tools ? 1 : 0) : -1; } },
  images: { label: "Images", get: function (t) { var d = facts(t.baseUrl, t.model); return d ? (d.vision ? 1 : 0) : -1; } },
  input: { label: "In $/M", num: true, how: "cheap", get: function (t) { var d = facts(t.baseUrl, t.model); return d && d.input !== undefined ? d.input : null; } },
  output: { label: "Out $/M", num: true, how: "cheap", get: function (t) { var d = facts(t.baseUrl, t.model); return d && d.output !== undefined ? d.output : null; } },
  record: { label: "Record", num: true, get: function (t) { var r = recOf(t.baseUrl, t.model); return r.pct === null ? -1 : r.pct; } },
  tried: { label: "Tried", num: true, get: function (t) { return recOf(t.baseUrl, t.model).total; } },
};

function rows() {
  var out = [];
  S.providers.forEach(function (p, i) {
    p.models.forEach(function (m) {
      out.push({
        i: i, name: p.name || p.label, baseUrl: p.baseUrl, model: m,
        off: p.disabled, parked: (p.disabledModels || []).indexOf(m) >= 0,
      });
    });
  });
  return out;
}

function sortRows(list) {
  if (!SORT.length) return list;
  var withAt = list.map(function (t, n) { return { t: t, n: n }; });
  withAt.sort(function (a, b) {
    for (var i = 0; i < SORT.length; i++) {
      var s = SORT[i];
      var x = COLS[s.key].get(a.t), y = COLS[s.key].get(b.t);
      if (x === y) continue;
      // Unknown sorts last either way: a missing price is not a cheap one.
      if (x === null) return 1;
      if (y === null) return -1;
      var r = typeof x === "string" ? byName(x, y) : x - y;
      if (r) return s.dir === "up" ? r : -r;
    }
    return a.n - b.n;
  });
  return withAt.map(function (x) { return x.t; });
}

var firstDir = function (k) { return COLS[k].how ? "up" : "down"; };
function clickSort(k) {
  var at = null;
  SORT.forEach(function (s) { if (s.key === k) at = s; });
  if (!at) SORT = SORT.concat([{ key: k, dir: firstDir(k) }]);
  else if (at.dir === firstDir(k)) at.dir = at.dir === "up" ? "down" : "up";
  else SORT = SORT.filter(function (s) { return s !== at; });
  try { localStorage.setItem("opencc-sort", JSON.stringify(SORT)); } catch (e) {}
  drawMine();
}

function yesNo(v) {
  if (v === -1) return h("span", { className: "no", title: "models.dev does not list this model" }, "?");
  return v ? h("span", { className: "yes" }, "\\u2713") : h("span", { className: "no" }, "-");
}

function drawMine() {
  var list = rows();
  var view = sortRows(list);

  MINE.forEach(function (k) {
    var t = unpk(k);
    if (!S.providers[t.i] || S.providers[t.i].models.indexOf(t.model) < 0) MINE.delete(k);
  });

  var picked = view.filter(function (t) { return MINE.has(pk(t.i, t.model)); });
  var allOn = view.length > 0 && picked.length === view.length;

  put($("mt-top"),
    h("div", { className: "sorts" }, SORT.length
      ? [h("span", {}, "Sorted by"), SORT.map(function (s, n) {
          return h("span", { className: "chip" },
            (n + 1) + ". " + COLS[s.key].label + " " + (s.dir === "up" ? "\\u2191" : "\\u2193"),
            h("button", { type: "button", "aria-label": "Stop sorting by " + COLS[s.key].label,
              onclick: function () { SORT = SORT.filter(function (x) { return x !== s; }); drawMine(); } }, "\\u2715"));
        })]
      : (list.length > 1 ? "Click a column to sort. Sorting changes nothing about routing." : "")),
    picked.length ? h("button", { className: "sm", onclick: function () { testMany(picked); } }, "Test " + picked.length) : null,
    picked.length ? h("button", { className: "sm danger", onclick: function () { removeModels(picked); } }, "Take " + picked.length + " out") : null,
    picked.length ? h("button", { className: "sm ghost", onclick: function () { MINE.clear(); drawMine(); } }, "Clear") : null,
    SORT.length ? h("button", { className: "sm", onclick: function () { SORT = []; drawMine(); } }, "Clear sort") : null,
    list.length ? h("button", { className: "sm", title: "Ask models.dev again for context, price and abilities", onclick: refreshCatalog }, "Refresh from models.dev") : null,
    list.length ? h("button", { className: "sm", onclick: function () { testMany(view); } }, "Test all") : null);

  if (!list.length) {
    put($("mt"), h("div", { className: "card" }, h("div", { className: "empty" },
      "Nothing in the pot yet. ", h("a", { href: "#providers" }, "Pick some models under Providers"), ".")));
    return;
  }

  var head = function (k) {
    var at = -1;
    SORT.forEach(function (s, n) { if (s.key === k) at = n; });
    return h("th", { className: COLS[k].num ? "num" : "" },
      h("button", { type: "button", className: at >= 0 ? "on" : "", onclick: function () { clickSort(k); } },
        COLS[k].label + (at >= 0
          ? " " + (SORT[at].dir === "up" ? "\\u2191" : "\\u2193") + (SORT.length > 1 ? at + 1 : "")
          : "")));
  };

  put($("mt"), h("div", { className: "mt-wrap" },
    h("table", { className: "mt" },
      h("thead", {}, h("tr", {},
        h("th", {}, h("input", {
          type: "checkbox", checked: allOn, indeterminate: picked.length > 0 && !allOn,
          "aria-label": "Select all",
          onchange: function () {
            if (allOn) MINE.clear();
            else view.forEach(function (t) { MINE.add(pk(t.i, t.model)); });
            lastRow = null;
            drawMine();
          },
        })),
        head("model"), head("provider"), head("context"), head("tools"), head("images"),
        head("input"), head("output"), head("record"), head("tried"),
        h("th", {}, ""))),
      h("tbody", {}, view.map(function (t, n) {
        var d = facts(t.baseUrl, t.model);
        var r = recOf(t.baseUrl, t.model);
        var wait = COOL[key(t.baseUrl, t.model)];
        var on = MINE.has(pk(t.i, t.model));
        return h("tr", {
          className: (on ? "picked " : "") + (t.off || t.parked ? "dim" : ""),
          title: t.off ? t.name + " is switched off, so this model is skipped"
            : t.parked ? "Parked: listed but never called" : "",
        },
          h("td", {}, h("input", {
            type: "checkbox", checked: on, "aria-label": "Select " + t.model,
            onclick: function (e) {
              e.preventDefault();
              var want = !MINE.has(pk(t.i, t.model));
              var from = e.shiftKey && lastRow !== null ? Math.min(lastRow, n) : n;
              var to = e.shiftKey && lastRow !== null ? Math.max(lastRow, n) : n;
              for (var k = from; k <= to; k++) {
                var q = pk(view[k].i, view[k].model);
                if (want) MINE.add(q); else MINE.delete(q);
              }
              lastRow = n;
              drawMine();
            },
          })),
          h("td", { className: "m", title: t.model }, t.model),
          h("td", {}, t.name,
            t.off ? h("span", { className: "tag", style: "margin-left:6px" }, "off") : null,
            t.parked ? h("span", { className: "tag", style: "margin-left:6px" }, "parked") : null),
          h("td", { className: "num", title: d && d.context ? d.context.toLocaleString() + " tokens" : "models.dev does not list this model" }, kTok(d && d.context)),
          h("td", {}, yesNo(COLS.tools.get(t))),
          h("td", {}, yesNo(COLS.images.get(t))),
          h("td", { className: "num" }, d && d.input !== undefined ? usd(d.input) : "-"),
          h("td", { className: "num" }, d && d.output !== undefined ? usd(d.output) : "-"),
          h("td", { className: "num", title: r.total ? r.ok + " of " + r.total + " requests answered" : "Nothing has been sent to this model yet" },
            r.pct === null ? h("span", { className: "no" }, "-") : (r.pct + "%")),
          h("td", { className: "num" }, r.total || "-"),
          h("td", {}, h("div", { className: "acts" },
            wait ? h("span", { className: "tag warn", title: "Rate limited or down. It goes to the back of the queue until this runs out." }, Math.ceil(wait / 1000) + "s") : null,
            h("button", { className: "sm", title: t.parked ? "Put it back in the pot" : "Keep it listed but never call it",
              onclick: function () { park(t); } }, t.parked ? "Unpark" : "Park"),
            h("button", { className: "sm", title: "Send one real request and record the result",
              onclick: function () { testOne(t.i, t.model); } }, "Test"),
            h("button", { className: "sm danger", "aria-label": "Remove " + t.model,
              onclick: function () { removeModels([t]); } }, "\\u2715"))));
      })))));
}

async function park(t) {
  var next = copyProviders();
  var off = next[t.i].disabledModels;
  var at = off.indexOf(t.model);
  if (at >= 0) off.splice(at, 1); else off.push(t.model);
  await save(next);
}

// --- testing --------------------------------------------------------------
// Not a capability check. One real request, recorded like any other, so the
// Record column has something in it before Claude Code sends the first one.
// What a model can do is models.dev's answer, not this one's.
async function testOne(i, model) {
  openDialog([
    h("h2", {}, h("span", { className: "spin" }), "Testing " + model),
    h("p", {}, "Sending one real request through this provider."),
  ]);
  try {
    var r = await post("/api/test", { index: i, model: model });
    if (closeDialog) closeDialog();
    await loadRecord();
    drawAll();
    showTest(model, r);
  } catch (e) {
    if (closeDialog) closeDialog();
    toast("Test failed: " + e.message, true);
  }
}

function showTest(model, r) {
  openDialog([
    h("h2", {}, model),
    h("div", {},
      h("div", { className: "kv" }, h("b", {}, "Result"), h("span", {}, r.ok ? "Answered" : "Failed")),
      r.status ? h("div", { className: "kv" }, h("b", {}, "Status"), h("span", {}, String(r.status))) : null,
      r.ms !== undefined && r.ms !== null ? h("div", { className: "kv" }, h("b", {}, "Took"), h("span", {}, (r.ms / 1000).toFixed(1) + "s")) : null,
      r.error ? h("div", { className: "kv" }, h("b", {}, "Error"), h("span", {}, r.error)) : null),
    r.sent ? [h("p", { style: "margin-top:12px" }, "Sent"), h("pre", { className: "dump" }, r.sent)] : null,
    r.got ? [h("p", { style: "margin-top:12px" }, "Received"), h("pre", { className: "dump" }, r.got)] : null,
    h("div", { className: "btns" },
      h("button", { className: "primary", onclick: function () { if (closeDialog) closeDialog(); } }, "Close")),
  ], { wide: true });
}

// One at a time, so a single key is not hit with a dozen requests at once and
// made to answer with rate limits that say nothing about the models.
async function testMany(items) {
  var done = 0, ok = 0;
  var bad = [];
  var stop = false;
  openDialog([
    h("h2", {}, h("span", { className: "spin" }), "Testing " + items.length + " models"),
    h("p", { id: "tm-now" }, "One real request each, one at a time."),
    h("div", { className: "btns" }, h("button", { onclick: function () { stop = true; } }, "Stop")),
  ]);

  for (var n = 0; n < items.length; n++) {
    if (stop) break;
    var t = items[n];
    var p = S.providers[t.i];
    if (!p) continue;
    if ($("tm-now")) $("tm-now").textContent = (done + 1) + " of " + items.length + ": " + (p.name || p.label) + " " + t.model;
    try {
      var r = await post("/api/test", { index: t.i, model: t.model });
      if (r.ok) ok++;
      else bad.push([t.model, (r.status || "no answer") + " " + (r.error || "")]);
    } catch (e) {
      bad.push([t.model, e.message]);
    }
    done++;
  }

  if (closeDialog) closeDialog();
  await loadRecord();
  drawAll();
  if (!bad.length) { toast(ok + " of " + done + " answered"); return; }
  openDialog([
    h("h2", {}, ok + " of " + done + " answered"),
    h("p", {}, "These did not. They stay in the pot; routing simply learns to avoid them."),
    h("div", {}, bad.map(function (b) {
      return h("div", { className: "kv" }, h("b", {}, b[0]), h("span", {}, b[1]));
    })),
    h("div", { className: "btns" },
      h("button", { className: "primary", onclick: function () { if (closeDialog) closeDialog(); } }, "Close")),
  ], { wide: true });
}

// --- provider form --------------------------------------------------------
function providerForm(i) {
  var p = i === undefined ? null : S.providers[i];
  var name = h("input", { type: "text", value: p ? p.name : "", placeholder: p ? p.label : "openrouter" });
  var url = h("input", { type: "text", value: p ? p.baseUrl : "", placeholder: "https://openrouter.ai/api/v1" });
  var apiKey = h("input", { type: "password", value: p ? p.apiKey : "" });
  var models = h("input", { type: "text", placeholder: "gpt-oss:120b, gpt-oss:20b" });
  var err = h("p", { className: "err" });

  var fields = [
    h("div", { className: "fld" }, h("label", {}, "Name ", h("span", { className: "hint" }, "optional")), name),
    h("div", { className: "fld" }, h("label", {}, "Base URL"), url),
    h("div", { className: "fld" }, h("label", {}, "API key ", h("span", { className: "hint" }, "blank if the backend needs none")), apiKey),
  ];
  if (!p) {
    fields.push(h("div", { className: "fld" },
      h("label", {}, "Models ", h("span", { className: "hint" }, "comma separated; you can pick more from its list afterwards")),
      models));
  }

  openDialog([
    h("h2", {}, p ? "Edit " + (p.name || p.label) : "Add a provider"),
    h("p", {}, p ? "Its address, key and whether opencc uses it." : "Nothing is saved until this is complete."),
    fields,
    err,
    h("div", { className: "btns" },
      p ? h("button", { className: "danger left", onclick: async function () {
        var ok = await ask("Delete " + (p.name || p.label) + "?",
          "Its API key goes with it. Switch it off instead to keep the key and the model list.", "Delete it");
        if (!ok) return;
        var next = copyProviders();
        next.splice(i, 1);
        LISTS = {};
        PICKED.clear();
        await save(next);
        toast("Deleted");
      } }, "Delete") : null,
      p ? h("button", { onclick: async function () {
        var next = copyProviders();
        next[i].disabled = !next[i].disabled;
        var nowOn = !next[i].disabled;
        if (closeDialog) closeDialog();
        await save(next);
        toast(nowOn ? "Switched on" : "Switched off: its models are skipped");
      } }, p.disabled ? "Switch on" : "Switch off") : null,
      h("button", { onclick: function () { if (closeDialog) closeDialog(); } }, "Cancel"),
      h("button", { className: "primary", onclick: async function () {
        var u = url.value.trim().replace(/\\/+$/, "");
        if (!u) { err.textContent = "A base URL is required."; url.focus(); return; }
        if (!/^https?:\\/\\//.test(u)) {
          err.textContent = "The base URL needs to start with http:// or https://";
          url.focus();
          return;
        }

        var next = copyProviders();
        if (p) {
          next[i].name = name.value.trim();
          next[i].baseUrl = u;
          next[i].apiKey = apiKey.value;
        } else {
          var ms = models.value.split(",").map(function (m) { return m.trim(); }).filter(Boolean);
          ms = ms.filter(function (m, k) { return ms.indexOf(m) === k; });
          if (!ms.length) {
            err.textContent = "At least one model is required, or there is nothing to route to.";
            models.focus();
            return;
          }
          next.push({ name: name.value.trim(), baseUrl: u, apiKey: apiKey.value, models: ms, disabled: false, disabledModels: [] });
        }
        try {
          if (closeDialog) closeDialog();
          LISTS = {};
          await save(next);
          toast(p ? "Saved" : "Provider added");
          if (!p) { location.hash = "#providers"; showPage(); }
        } catch (e2) {
          err.textContent = "Could not save: " + e2.message;
        }
      } }, p ? "Save" : "Add provider")),
  ]);
}

// --- requests -------------------------------------------------------------
var FILTERS = {
  all: function () { return true; },
  failed: function (r) { return !r.ok; },
  fallback: function (r) { return r.fallback; },
};

function drawRequests() {
  $("n-reqs").textContent = REQS.length || "";
  var shown = REQS.filter(FILTERS[reqFilter]);
  // The open request can fall off the end as older ones are pruned.
  if (reqPicked !== null && !REQS.some(function (r) { return r.at === reqPicked; })) reqPicked = null;

  if (!shown.length) {
    put($("reqlist"), h("div", { className: "empty" },
      REQS.length ? "No request matches this filter." : "Nothing yet. Requests appear here as Claude Code makes them."));
    drawDetail();
    return;
  }

  put($("reqlist"), shown.map(function (r) {
    return h("button", { className: "req" + (r.at === reqPicked ? " on" : ""),
      onclick: function () { reqPicked = r.at; drawRequests(); } },
      h("span", { className: "dot " + (r.ok ? (r.fallback ? "" : "ok") : "bad"),
        title: r.ok ? (r.fallback ? "Served, but not by the first model tried" : "Served") : "Failed" }),
      h("span", { className: "when" }, ago(r.at)),
      h("span", { className: "who" }, r.ok ? r.served
        : (r.status || "failed") + " after " + r.attempts.length + (r.attempts.length === 1 ? " try" : " tries")),
      h("span", { className: "when" }, r.kind));
  }));
  drawDetail();
}

function drawDetail() {
  var r = null;
  REQS.forEach(function (x) { if (x.at === reqPicked) r = x; });
  if (!r) {
    put($("reqdetail"), h("p", { className: "muted" }, "Pick a request to see every model it tried."));
    return;
  }

  var kb = Math.round(r.chars / 1024);
  var about = [
    ["When", new Date(r.at).toLocaleTimeString() + " (" + ago(r.at) + ")"],
    ["Asked for", r.model],
    ["Needed", r.kind],
    ["Size", r.chars.toLocaleString() + " chars" + (kb ? " (~" + kb + "kB)" : "") + ", " + r.tools + " tools"],
    ["Streaming", r.stream ? "yes" : "no"],
    ["Took", r.ms ? (r.ms / 1000).toFixed(1) + "s" : "-"],
    ["Result", r.ok ? "served by " + r.served : "failed"],
  ];

  put($("reqdetail"),
    about.map(function (f) { return h("div", { className: "kv" }, h("b", {}, f[0]), h("span", {}, f[1])); }),
    h("ul", { className: "walk" }, r.attempts.length
      ? r.attempts.map(function (a, n) {
          return h("li", {},
            (n + 1) + ". " + a.provider + " / " + a.model + " -> " + (a.status === 0 ? "no answer" : a.status) +
            (a.ms ? " in " + (a.ms / 1000).toFixed(1) + "s" : "") +
            (a.verdict && a.verdict !== "ok" ? " (" + a.verdict + ")" : ""),
            a.error ? h("div", { className: "err" }, a.error) : null);
        })
      : h("li", {}, "No model was tried.")),
    r.error && !r.ok ? h("div", { className: "walk" }, h("div", { className: "err" }, r.error)) : null);
}

// --- live updates ---------------------------------------------------------
// The proxy and this panel are one process, so a served request is pushed
// here. The event only says that something happened; what it means is worked
// out by refetching, which keeps one copy of that rule rather than two.
function listen() {
  var src;
  try { src = new EventSource("/api/events"); } catch (e) { return; }
  src.addEventListener("message", async function (e) {
    var what;
    try { what = JSON.parse(e.data).what; } catch (e2) { return; }
    if (what === "request" || what === "requests-cleared") {
      await Promise.all([loadRequests(), loadRecord()]);
      drawAll();
    }
  });
}

async function refreshCatalog() {
  var b = $("catalog");
  b.disabled = true;
  b.textContent = "fetching...";
  try {
    var out = await post("/api/catalog/refresh");
    await loadCatalog();
    drawAll();
    toast(out.error ? "models.dev: " + out.error : "models.dev: " + out.size.toLocaleString() + " models", Boolean(out.error));
  } catch (e) {
    toast("Could not reach models.dev: " + e.message, true);
  } finally {
    b.disabled = false;
    drawCatalogButton();
  }
}

// --- wiring ---------------------------------------------------------------
function drawAll() { drawSidebar(); drawMine(); drawProviders(); drawRequests(); showPage(); }

$("theme").addEventListener("click", function () {
  var next = currentTheme() === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem("opencc-theme", next); } catch (e) {}
  drawTheme();
});
$("streaming").addEventListener("click", async function () {
  S.streaming = !S.streaming;
  await save();
  toast("Streaming " + (S.streaming ? "on" : "off"));
});
$("port").addEventListener("change", async function () {
  S.port = $("port").value || "3000";
  await save();
  toast("Saved. The proxy uses it next time you start opencc.");
});
$("catalog").addEventListener("click", refreshCatalog);
$("add-prov").addEventListener("click", function () { providerForm(); });
$("go-prov").addEventListener("click", function () { location.hash = "#providers"; showPage(); });
$("q").addEventListener("input", function (e) { query = e.target.value; drawProviders(); });
$("free").addEventListener("change", function (e) { freeOnly = e.target.checked; drawProviders(); });
$("sort").addEventListener("change", function (e) { catSort = e.target.value; drawProviders(); });
$("fold-all").addEventListener("click", function () {
  if (SHUT.size >= S.providers.length) SHUT.clear();
  else S.providers.forEach(function (p, i) { SHUT.add(i); });
  drawProviders();
});
$("pick-all").addEventListener("change", function (e) {
  shownKeys().forEach(function (k) { if (e.target.checked) PICKED.add(k); else PICKED.delete(k); });
  drawProviders();
});
$("reqfilter").addEventListener("click", function (e) {
  var b = e.target.closest("button");
  if (!b) return;
  reqFilter = b.dataset.f;
  Array.prototype.forEach.call($("reqfilter").children, function (x) { x.classList.toggle("on", x === b); });
  drawRequests();
});
$("reqclear").addEventListener("click", async function () {
  if (!REQS.length) { toast("Nothing logged yet"); return; }
  var ok = await ask("Clear all " + REQS.length + " logged requests?",
    "This only empties the log. Nothing the models have learned is touched, and routing is unchanged.", "Clear it");
  if (!ok) return;
  await post("/api/requests/clear");
  reqPicked = null;
  await loadRequests();
  toast("Cleared");
});
$("reset").addEventListener("click", async function () {
  var seen = 0;
  for (var k in REC) for (var j in REC[k]) seen += REC[k][j].ok + REC[k][j].fail;
  if (!seen) { toast("Nothing on record yet"); return; }
  var ok = await ask("Forget all " + seen + " results?",
    "Every model goes back to untried, so routing is even odds until it learns again. " +
    "The old record is kept as stats.jsonl.previous.", "Reset it");
  if (!ok) return;
  var out = await post("/api/stats/reset");
  await loadRecord();
  drawAll();
  toast(out.moved ? "Reset. The old record is in stats.jsonl.previous" : "Reset");
});

try {
  var savedSort = JSON.parse(localStorage.getItem("opencc-sort"));
  if (Array.isArray(savedSort)) SORT = savedSort.filter(function (x) { return x && COLS[x.key]; });
} catch (e) {}

(async function () {
  try {
    await loadState();
  } catch (e) {
    put($("mt"), h("div", { className: "card" }, h("div", { className: "empty" }, "Could not load the config: " + e.message)));
    return;
  }
  drawAll();
  await Promise.all([loadRecord(), loadCatalog(), loadRequests()]);
  drawAll();
  listen();
})();
</script>
</body>
</html>`;
