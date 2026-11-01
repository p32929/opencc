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
  .filters {
    display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
    background: var(--panel); border: 1px solid var(--rule);
    border-radius: var(--r); padding: 9px 11px; margin-bottom: 10px;
  }
  .filters input[type=search] { flex: 1; min-width: 160px; font-family: inherit; }
  .filters select { width: auto; flex: none; }
  .filters .spacer { flex: 1; }

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
  /* --- the last test, per model --------------------------------------- */
  .try { display: flex; align-items: center; gap: 6px; white-space: nowrap; }
  .try .msg { font: 11.5px var(--mono); color: var(--ink-3); }
  .try.ok .msg { color: var(--ok); }
  .try.bad .msg { color: var(--bad); cursor: pointer; text-decoration: underline dotted; text-underline-offset: 2px; }
  .try.ok .msg { cursor: pointer; text-decoration: underline dotted; text-underline-offset: 2px; }
  .try.going .msg { color: var(--accent); }

  /* The run, in the page rather than over it: you can still read the table,
     and the rows fill in as results land. */
  #run:empty, #outcomes:empty { display: none; }
  .run {
    display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
    background: var(--panel); border: 1px solid var(--accent);
    border-radius: var(--r); padding: 10px 13px; margin-bottom: 10px; font-size: 13px;
  }
  .run .what { color: var(--ink); font-weight: 600; }
  .run .bar { flex: 1; min-width: 120px; height: 4px; background: var(--rule); border-radius: 99px; overflow: hidden; }
  .run .bar i { display: block; height: 100%; background: var(--accent); transition: width .2s; }
  .run .tally { font: 12px var(--mono); }
  .run .tally .g { color: var(--ok); }
  .run .tally .b { color: var(--bad); }

  .pills { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 10px; }
  .pill {
    display: inline-flex; align-items: center; border: 1px solid var(--rule-2);
    border-radius: 99px; overflow: hidden; background: var(--panel);
  }
  .pill button { border: 0; border-radius: 0; background: none; padding: 5px 10px; font-size: 12px; }
  .pill .n { font: 11px var(--mono); color: var(--ink-3); margin-left: 6px; }
  .pill.ok button { color: var(--ok); }
  .pill.bad button { color: var(--bad); }
  .pill.on { border-color: var(--accent); background: var(--accent-soft); }
  .pill .again { border-left: 1px solid var(--rule-2); padding: 5px 8px; color: var(--ink-3); }

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
  ol.rank { list-style: none; margin: 14px 0 0; padding: 0; }
  ol.rank li {
    display: flex; align-items: center; gap: 9px; padding: 8px 10px;
    border: 1px solid var(--rule); border-radius: var(--r-s); margin-bottom: 5px;
    background: var(--panel-2); cursor: grab;
  }
  ol.rank li.dragging { opacity: .4; }
  ol.rank .grip { color: var(--ink-3); font-size: 12px; letter-spacing: -2px; }
  ol.rank .n { font: 11px var(--mono); color: var(--ink-3); width: 24px; flex: none; }
  ol.rank .nm { color: var(--ink); font-weight: 600; font-size: 13px; }
  ol.rank .meta { margin-left: auto; }
  ol.rank .up { display: flex; gap: 3px; flex: none; }

  pre.dump { background: var(--panel-2); border: 1px solid var(--rule); border-radius: var(--r-s); padding: 9px; font: 11.5px/1.5 var(--mono); max-height: 230px; overflow: auto; white-space: pre-wrap; word-break: break-word; margin: 5px 0 0; color: var(--ink-2); }
  .spin { display: inline-block; width: 12px; height: 12px; vertical-align: -1px; margin-right: 6px; border: 2px solid var(--rule-2); border-top-color: var(--accent); border-radius: 50%; animation: spin .7s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .spin { animation-duration: 2.4s; } }
  /* Any network call at all. Indeterminate on purpose: there is no honest
     percentage to show for "a provider is thinking about it". */
  #bar {
    position: fixed; top: 0; left: 0; right: 0; height: 2px; z-index: 60;
    overflow: hidden; opacity: 0; transition: opacity .2s; pointer-events: none;
  }
  #bar.on { opacity: 1; }
  #bar i { position: absolute; top: 0; bottom: 0; width: 34%; background: var(--accent); animation: slide 1.1s ease-in-out infinite; }
  @keyframes slide { from { left: -34%; } to { left: 100%; } }
  @media (prefers-reduced-motion: reduce) {
    #bar i { animation: none; left: 0; width: 100%; opacity: .5; }
  }

  /* An area that is waiting, rather than one that is empty. The two look the
     same otherwise, and "nothing here" is a lie while it is still loading. */
  .loading { padding: 26px; text-align: center; color: var(--ink-3); font-size: 13px; }

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
      <div>
        <label for="ttl">Test timeout <span class="hint">seconds</span></label>
        <input type="number" id="ttl" min="1" max="300" step="1">
      </div>
      <div>
        <label for="lanes">Test lanes <span class="hint">per provider</span></label>
        <input type="number" id="lanes" min="1" max="16" step="1">
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
          <button id="rank">Provider ranking</button>
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
      <div class="filters" id="filters">
        <input type="search" id="f-q" placeholder="Search your models">
        <select id="f-prov" aria-label="Provider"><option value="">Any provider</option></select>
        <select id="f-works" aria-label="Test result">
          <option value="">Any result</option>
          <option value="works">Works</option>
          <option value="failed">Failed</option>
          <option value="untested">Not tested</option>
        </select>
        <!-- Each ability on its own, so they combine: tools yes and images no
             is a question you can actually ask. -->
        <select id="f-tools" aria-label="Tool calling">
          <option value="">Tools: any</option>
          <option value="yes">Calls tools</option>
          <option value="no">No tools</option>
        </select>
        <select id="f-thinking" aria-label="Thinking">
          <option value="">Thinking: any</option>
          <option value="yes">Thinks</option>
          <option value="no">No thinking</option>
        </select>
        <select id="f-images" aria-label="Images">
          <option value="">Images: any</option>
          <option value="yes">Reads images</option>
          <option value="no">No images</option>
        </select>
        <select id="f-count-of" aria-label="How many abilities">
          <option value="">Abilities: any</option>
          <option value="3">3 of 3</option>
          <option value="2">2 of 3</option>
          <option value="1">1 of 3</option>
          <option value="0">0 of 3</option>
        </select>
        <select id="f-ctx" aria-label="Context window">
          <option value="">Context: any</option>
          <option value="1000000">1M or more</option>
          <option value="256000">256k or more</option>
          <option value="128000">128k or more</option>
          <option value="32000">32k or more</option>
          <option value="0">under 32k</option>
        </select>
        <select id="f-price" aria-label="Price">
          <option value="">Price: any</option>
          <option value="free">Free</option>
          <option value="1">Under $1 / M in</option>
          <option value="5">Under $5 / M in</option>
          <option value="over">$5 / M in or more</option>
        </select>
        <select id="f-known" aria-label="Known to models.dev">
          <option value="">Known: any</option>
          <option value="yes">On models.dev</option>
          <option value="no">Not found</option>
        </select>
        <select id="f-state" aria-label="In rotation">
          <option value="">State: any</option>
          <option value="live">In rotation</option>
          <option value="parked">Parked</option>
          <option value="off">Provider off</option>
        </select>
        <span class="spacer"></span>
        <span id="f-count" class="meta"></span>
        <button id="f-clear" class="sm ghost" hidden>Clear filters</button>
      </div>
      <div class="mt-top" id="mt-top"></div>
      <div id="run"></div>
      <div id="outcomes"></div>
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

<div id="bar" role="progressbar" aria-label="Loading"><i></i></div>
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
var S = { providers: [], port: "3000", streaming: true, rank: [], testTimeout: 10, testLanes: 4, version: "" };
var REC = {};        // "baseUrl|model" -> { kind: {ok, fail, statuses} }
var COOL = {};
var CAT = {};        // "baseUrl|model" -> models.dev facts, for configured models
var CATINFO = { size: 0, age: null };
var LISTS = {};      // provider index -> { models, error, loading }
var REQS = [];
// Until the first load lands, an empty area means "not here yet", not
// "nothing to show". Saying the wrong one of those is how a slow panel looks
// like a broken one.
var ready = false;
var reqFilter = "all";
var reqPicked = null;

// The last test per model, keyed like everything else on this page.
// { going } while one is in flight, then { ok, status, ms, error, sent, got, at }.
var TRIES = {};
var running = null;       // the run in progress: { total, done, good, stop }

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

// Your provider ranking, best first, as a place per base URL. A provider you
// have not ranked sorts after every one you have, rather than jumping to the
// top just because it is new.
function places() {
  var m = new Map();
  (S.rank || []).forEach(function (url, i) { m.set(url, i); });
  return m;
}
function placeOfProvider(baseUrl) {
  var at = places().get(baseUrl);
  return at === undefined ? (S.rank || []).length + 1 : at;
}
var ranked = function () { return (S.rank || []).length > 1; };
var isFree = function (d) { return Boolean(d) && d.input === 0 && d.output === 0; };
var costOf = function (d) { return d && d.input !== undefined ? d.input + (d.output || 0) : Infinity; };

// --- api ------------------------------------------------------------------
// Every call on the page goes through here, which makes it the one place
// that has to know something is in flight. A counter rather than a flag:
// several of these overlap on load, and the first to finish must not clear
// the bar while the others are still going.
var busy = 0;
function paintBusy() {
  $("bar").classList.toggle("on", busy > 0);
}

async function api(path, opts) {
  busy += 1;
  paintBusy();
  try {
    var res = await fetch(path, opts);
    if (!res.ok) {
      var body = await res.json().catch(function () { return {}; });
      throw new Error(body.error || ("HTTP " + res.status));
    }
    return await res.json();
  } finally {
    busy -= 1;
    paintBusy();
  }
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
    var out = await api("/api/catalogue?index=" + i + (fresh ? "&fresh=1" : ""));
    LISTS[i] = { models: out.models || [], loading: false, error: out.error || "", at: out.at };
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
    rank: S.rank || [],
    testTimeout: S.testTimeout,
    testLanes: S.testLanes,
  };
  var before = list.length;
  S = await post("/api/state", payload);
  // The only thing that gets a provider dropped now is having no base URL:
  // there is nowhere to send a request.
  if (S.providers.length < before) toast("A provider needs a base URL, so it was not kept", true);
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
  if (document.activeElement !== $("ttl")) $("ttl").value = S.testTimeout;
  if (document.activeElement !== $("lanes")) $("lanes").value = S.testLanes;
  $("lanes").title = "How many of one provider's models are tested at once. " +
    "1 is HeartCode's pacing; 4 is about twice as fast on a nine-provider set. " +
    "A provider that answers 429 drops to one lane on its own.";
  $("ttl").title = "How long the Test button waits for a model to say hello. " +
    "The proxy's own timeout for real requests is separate and much longer.";
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
  // Keep each provider's own index: everything else on this page addresses
  // them by it, so the display order cannot be allowed to shift it.
  var withIndex = S.providers.map(function (p, i) { return { p: p, i: i }; });
  if (ranked()) {
    withIndex.sort(function (a, b) { return placeOfProvider(a.p.baseUrl) - placeOfProvider(b.p.baseUrl); });
  }

  var sections = withIndex.map(function (entry) {
    var p = entry.p;
    var i = entry.i;
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
          ranked() ? h("span", { className: "tag acc", title: "Your ranking: #" + (placeOfProvider(p.baseUrl) + 1) },
            "#" + (placeOfProvider(p.baseUrl) + 1)) : null,
          h("span", { className: "nm" }, p.name || p.label),
          p.disabled ? h("span", { className: "tag" }, "off") : null,
          list.loading ? h("span", { className: "tag" }, "loading")
            : list.error ? h("span", { className: "tag bad", title: "This backend would not list its models: " + list.error }, "no list")
            : h("span", { className: "tag", title: list.at ? "Asked " + ago(list.at) + ". It is kept, so leaving and coming back does not ask again — press Refresh for a new list." : "" },
                names.listed.length + " listed"),
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
        h("button", {
          className: "sm", disabled: list.loading,
          title: list.loading ? "Asking it now" : "Ask this provider for its model list again",
          onclick: function () { loadList(i, true); },
        }, list.loading ? "Asking…" : "Refresh"),
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
          have ? h("button", {
            className: "sm", disabled: Boolean(running),
            title: "Send one real request. The result shows under Works? on Your models.",
            onclick: function () { testMany([{ i: i, model: id }]); },
          }, "Test") : null);
      })) : null,

      list.loading && !rows.length
        ? h("div", { className: "loading" }, h("span", { className: "spin" }),
            "Asking " + (p.name || p.label) + " for its models")
        : null,
      list.error ? h("div", { className: "note err" },
        "Could not list its models: " + list.error + " ",
        h("button", { className: "sm", onclick: function () { loadList(i, true); } }, "Try again"),
        h("div", { className: "muted", style: "margin-top:4px" }, "You can still add one by name above.")) : null,
      !list.loading && !list.error && !names.all.length
        ? h("div", { className: "note" }, "This provider listed no models. Add one by name above.") : null);
  }).filter(Boolean);

  put($("plist"), sections.length ? sections
    : !ready ? h("div", { className: "loading" }, h("span", { className: "spin" }), "Loading providers")
    : h("div", { className: "empty" },
        !S.providers.length ? "No providers yet. Use Add a provider."
          : freeOnly && !query ? "No provider lists a model at $0. A provider whose list has no prices cannot say."
          : "Nothing matches."));

  var shown = shownKeys();
  var on = shown.filter(function (k) { return PICKED.has(k); });
  $("pick-all").checked = on.length > 0 && on.length === shown.length;
  $("pick-all").indeterminate = on.length > 0 && on.length < shown.length;
  $("pick-all").disabled = !shown.length;
  $("fold-all").textContent = S.providers.length && SHUT.size >= S.providers.length ? "Expand all" : "Collapse all";
  $("rank").textContent = ranked() ? "Ranking \\u2713" : "Provider ranking";
  $("rank").disabled = S.providers.length < 2;
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

  // No confirm for emptying a provider any more. It used to be dropped along
  // with its key, which was worth stopping for; now it stays, keeps its URL
  // and key, and simply has nothing in the pot until you pick something.
  PICKED.clear();
  MINE.clear();
  await save(next);
  toast(n === 1 ? items[0].model + " taken out" : n + " models taken out");
}

function drawFilters(total, shown) {
  var sel = $("f-prov");
  var want = S.providers.filter(function (p) { return p.models.length; });
  // Rebuilt only when the set changes, or picking one would reset itself on
  // every redraw.
  if (sel.options.length !== want.length + 1) {
    put(sel, h("option", { value: "" }, "Any provider"), want.map(function (p) {
      return h("option", { value: p.baseUrl }, (p.name || p.label) + " (" + p.models.length + ")");
    }));
  }
  if (sel.value !== FILTER.prov) sel.value = FILTER.prov;
  if ($("f-q").value !== FILTER.q && document.activeElement !== $("f-q")) $("f-q").value = FILTER.q;
  for (var key in CONTROLS) {
    if ($(CONTROLS[key]).value !== FILTER[key]) $(CONTROLS[key]).value = FILTER[key];
  }

  $("f-count").textContent = filtering() ? shown + " of " + total + " shown" : total + " models";
  $("f-clear").hidden = !filtering();
  $("filters").hidden = total === 0;
}

// Which control drives which part of the filter. One table, so adding a
// filter is one line here and one <select> rather than four places to keep
// in step.
var CONTROLS = {
  works: "f-works",
  tools: "f-tools",
  thinking: "f-thinking",
  images: "f-images",
  count: "f-count-of",
  ctx: "f-ctx",
  price: "f-price",
  known: "f-known",
  state: "f-state",
};

function clearFilters() {
  FILTER = Object.assign({}, BLANK_FILTER);
  $("f-q").value = "";
  keepFilter();
  drawMine();
}

// --- the last test, per model ---------------------------------------------
// What a test came to, in one word: works, its status code, empty, no answer
// or failed. Null while it runs, or before it has been tested.
function outcome(r) {
  if (!r || r.going) return null;
  if (r.ok) return "works";
  if (r.status) return String(r.status);
  if (/within/.test(r.error || "")) return "no answer";
  if (/not JSON|empty/i.test(r.error || "")) return "empty";
  return "failed";
}

var MEANS = {
  works: "it answered",
  400: "400: the provider would not take the request as sent",
  401: "401: the key was rejected",
  402: "402: no credit or quota left",
  403: "403: the key is not allowed this model",
  404: "404: no model of that name here",
  413: "413: the request was too large",
  429: "429: rate limited or out of quota for now",
  500: "500: the provider broke",
  502: "502: the provider could not reach the model",
  503: "503: the model or provider is unavailable now",
  504: "504: the provider timed out",
  empty: "it answered, but with nothing in it",
  "no answer": "nothing came back inside the test timeout, in the sidebar",
  failed: "it failed without a status: a lost connection, or a reply nothing could read",
};

// Where this row's abilities come from. models.dev knows the model, or it
// does not and there is nothing to go on but a real request.
function fromCell(t) {
  if (facts(t.baseUrl, t.model)) {
    return h("span", { className: "meta", title: "Context, price and abilities are models.dev's, for this model name" }, "models.dev");
  }
  return h("div", { className: "try" },
    h("span", { className: "msg", title: "models.dev does not list this name, so nothing is known about what it can do. Testing it still shows whether it answers." }, "not found"),
    h("button", { className: "sm", disabled: Boolean(running),
      title: "Fetch models.dev again and look for it", onclick: refreshCatalog }, "Retry"));
}

function worksCell(t) {
  var r = TRIES[pk(t.i, t.model)];
  var when = r && r.at ? " \\u00b7 tested " + new Date(r.at).toLocaleTimeString() : "";
  var secs = r && r.ms != null ? " \\u00b7 " + (r.ms / 1000).toFixed(1) + "s" : "";

  var cls = "", text = "not tested", about = "Send it one real request to see whether it answers at all";
  if (r && r.going) {
    cls = "going"; text = "testing\\u2026"; about = "Sending it one real request";
  } else if (r && r.ok) {
    cls = "ok"; text = "\\u2713 " + (r.ms / 1000).toFixed(1) + "s";
    about = "works" + secs + when + ". Click to see what was sent and what came back.";
  } else if (r) {
    cls = "bad"; text = "\\u2717 " + outcome(r);
    about = (MEANS[outcome(r)] || "it did not answer") + ". " + (r.error || "") + secs + when +
      ". Click to see what was sent and what came back.";
  }

  return h("div", { className: "try " + cls },
    h("span", {
      className: "msg", title: about,
      onclick: r && !r.going ? function () { showTest(t.model, r); } : null,
    }, text),
    h("button", {
      className: "sm", disabled: Boolean(r && r.going),
      title: "Send one real request and record the result",
      onclick: function () { testMany([t]); },
    }, "Test"));
}

// --- your models table ----------------------------------------------------
// Each column says which way it sorts first and what that means in words,
// so the chip above the table reads "Context: biggest first" rather than an
// arrow you have to decode.
//
// get() returns null for "there is no value here" — no price, never tested —
// and null always sorts last, whichever direction you asked for: an unknown
// price is not a cheap one. Where two nulls are not the same thing, missing()
// separates them.
var COLS = {
  model: { label: "Model", first: "up", words: ["A to Z", "Z to A"],
    get: function (t) { return t.model; } },

  provider: {
    label: "Provider", first: "up",
    words: ["best first", "worst first"],
    get: function (t) { return ranked() ? placeOfProvider(t.baseUrl) : t.name; },
  },

  context: { label: "Context", num: true, first: "down", words: ["smallest first", "biggest first"],
    get: function (t) { var d = facts(t.baseUrl, t.model); return d && d.context ? d.context : null; } },

  // How many of the three it can do. The quick read of a row.
  abilities: { label: "Abilities", num: true, first: "down", words: ["fewest first", "most first"],
    get: function (t) {
      var d = facts(t.baseUrl, t.model);
      if (!d) return null;
      return (d.tools ? 1 : 0) + (d.reasoning ? 1 : 0) + (d.vision ? 1 : 0);
    } },

  tools: { label: "Tools", first: "down", words: ["without first", "with first"],
    get: function (t) { var d = facts(t.baseUrl, t.model); return d ? (d.tools ? 1 : 0) : null; } },

  thinking: { label: "Thinking", first: "down", words: ["without first", "with first"],
    get: function (t) { var d = facts(t.baseUrl, t.model); return d ? (d.reasoning ? 1 : 0) : null; } },

  images: { label: "Images", first: "down", words: ["without first", "with first"],
    get: function (t) { var d = facts(t.baseUrl, t.model); return d ? (d.vision ? 1 : 0) : null; } },

  input: { label: "In $/M", num: true, first: "up", words: ["cheapest first", "priciest first"],
    get: function (t) { var d = facts(t.baseUrl, t.model); return d && d.input !== undefined ? d.input : null; } },

  output: { label: "Out $/M", num: true, first: "up", words: ["cheapest first", "priciest first"],
    get: function (t) { var d = facts(t.baseUrl, t.model); return d && d.output !== undefined ? d.output : null; } },

  record: { label: "Record", num: true, first: "down", words: ["worst first", "best first"],
    get: function (t) { var r = recOf(t.baseUrl, t.model); return r.pct === null ? null : r.pct; } },

  tried: { label: "Tried", num: true, first: "down", words: ["fewest first", "most first"],
    get: function (t) { return recOf(t.baseUrl, t.model).total || null; } },

  // How long its test took. Failed or not tested have no time and go at the
  // end either way, not tested before not working.
  // Where the four columns before it come from, which is the answer to "why
  // does this row say it cannot do tools" — models.dev was asked and said
  // so, or models.dev has never heard of this name.
  from: { label: "From", first: "up", words: ["known first", "unknown first"],
    get: function (t) { return facts(t.baseUrl, t.model) ? 0 : 1; } },

  works: {
    label: "Works?", first: "up", words: ["fastest first", "slowest first"],
    get: function (t) {
      var r = TRIES[pk(t.i, t.model)];
      return r && r.ok && !r.going ? (r.ms || 0) : null;
    },
    missing: function (t) {
      var r = TRIES[pk(t.i, t.model)];
      return !r || r.going ? 0 : 1;
    },
  },
};

// What the table is narrowed to. Everything that acts on "all" acts on what
// is shown instead, which is the point: narrow to the ones that failed and
// Take out, or to the ones that call tools and Test, without picking through
// a thousand rows by hand.
var BLANK_FILTER = {
  q: "", prov: "", works: "",
  tools: "", thinking: "", images: "",
  count: "", ctx: "", price: "", known: "", state: "",
};
var FILTER = Object.assign({}, BLANK_FILTER);
try {
  var savedFilter = JSON.parse(localStorage.getItem("opencc-filter"));
  if (savedFilter) {
    Object.keys(BLANK_FILTER).forEach(function (k) {
      if (typeof savedFilter[k] === "string") FILTER[k] = savedFilter[k];
    });
  }
} catch (e) {
  // Private window or blocked storage: start with no filters.
}

function keepFilter() {
  try { localStorage.setItem("opencc-filter", JSON.stringify(FILTER)); } catch (e) {}
}

var filtering = function () {
  return Object.keys(BLANK_FILTER).some(function (k) { return FILTER[k] !== BLANK_FILTER[k]; });
};

// Each ability on its own, so they combine. "Calls tools but cannot read
// images" is a real question and a single dropdown could not ask it.
//
// A model models.dev has never heard of is not a no: it has said nothing.
// So an ability filter of either kind leaves those out, and "Not found" is
// its own choice rather than something to infer from empty columns.
function can(d, key) {
  if (!d) return null;
  if (key === "tools") return Boolean(d.tools);
  if (key === "thinking") return Boolean(d.reasoning);
  return Boolean(d.vision);
}

function passes(t) {
  var d = facts(t.baseUrl, t.model);

  if (FILTER.prov && t.baseUrl !== FILTER.prov) return false;

  if (FILTER.q) {
    var q = FILTER.q.toLowerCase();
    if (t.model.toLowerCase().indexOf(q) < 0 && String(t.name).toLowerCase().indexOf(q) < 0) return false;
  }

  if (FILTER.works) {
    var r = TRIES[pk(t.i, t.model)];
    var state = !r || r.going ? "untested" : r.ok ? "works" : "failed";
    if (state !== FILTER.works) return false;
  }

  var abilities = ["tools", "thinking", "images"];
  for (var i = 0; i < abilities.length; i++) {
    var want = FILTER[abilities[i]];
    if (!want) continue;
    var has = can(d, abilities[i]);
    if (has === null) return false;
    if ((want === "yes") !== has) return false;
  }

  if (FILTER.count !== "") {
    if (!d) return false;
    var n = (d.tools ? 1 : 0) + (d.reasoning ? 1 : 0) + (d.vision ? 1 : 0);
    if (n !== Number(FILTER.count)) return false;
  }

  if (FILTER.ctx !== "") {
    if (!d || !d.context) return false;
    var least = Number(FILTER.ctx);
    if (least === 0 ? d.context >= 32000 : d.context < least) return false;
  }

  if (FILTER.price) {
    // An unknown price is not a cheap one, and it is certainly not free.
    if (!d || d.input === undefined) return false;
    if (FILTER.price === "free") {
      if (!(d.input === 0 && d.output === 0)) return false;
    } else if (FILTER.price === "over") {
      if (d.input < 5) return false;
    } else if (d.input >= Number(FILTER.price)) {
      return false;
    }
  }

  if (FILTER.known === "yes" && !d) return false;
  if (FILTER.known === "no" && d) return false;

  if (FILTER.state === "live" && (t.off || t.parked)) return false;
  if (FILTER.state === "parked" && !t.parked) return false;
  if (FILTER.state === "off" && !t.off) return false;

  return true;
}

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

  var cmp = function (a, b, s) {
    var col = COLS[s.key];
    var x = col.get(a), y = col.get(b);
    // Two nulls are not always the same thing: never tested and tested-and-
    // failed both have no time, and one belongs above the other.
    if (x == null && y == null) {
      return (col.missing ? col.missing(a) : 0) - (col.missing ? col.missing(b) : 0);
    }
    if (x === y) return 0;
    // Nothing sorts last whichever way you asked: an unknown price is not a
    // cheap one, and an untested model is not a fast one.
    if (x == null) return 1;
    if (y == null) return -1;
    var r = typeof x === "string" ? byName(x, y) : Number(x) - Number(y);
    return s.dir === "up" ? r : -r;
  };

  var withAt = list.map(function (t, n) { return { t: t, n: n }; });
  withAt.sort(function (a, b) {
    for (var i = 0; i < SORT.length; i++) {
      var r = cmp(a.t, b.t, SORT[i]);
      if (r) return r;
    }
    return a.n - b.n;   // whatever order it was already in
  });
  return withAt.map(function (x) { return x.t; });
}

// What a sort is doing, in words.
function dirText(key, dir) {
  return COLS[key].words[dir === "up" ? 0 : 1] +
    (key === "works" ? " (then not tested, then not working)" : "");
}

var firstDir = function (k) { return COLS[k].first; };
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
  var all = rows();
  var list = all.filter(passes);
  var view = sortRows(list);
  drawFilters(all.length, list.length);

  MINE.forEach(function (k) {
    var t = unpk(k);
    if (!S.providers[t.i] || S.providers[t.i].models.indexOf(t.model) < 0) MINE.delete(k);
  });

  var picked = view.filter(function (t) { return MINE.has(pk(t.i, t.model)); });
  var allOn = view.length > 0 && picked.length === view.length;

  put($("mt-top"),
    h("div", { className: "sorts" }, SORT.length
      ? [h("span", {}, "Sorted by"), SORT.map(function (s, n) {
          return h("span", { className: "chip", title: dirText(s.key, s.dir) },
            (n + 1) + ". " + COLS[s.key].label + ": " + dirText(s.key, s.dir),
            h("button", { type: "button", "aria-label": "Stop sorting by " + COLS[s.key].label,
              onclick: function () { SORT = SORT.filter(function (x) { return x !== s; }); drawMine(); } }, "\\u2715"));
        })]
      : (list.length > 1 ? "Click a column to sort. Sorting changes nothing about routing." : "")),
    picked.length ? h("button", { className: "sm", disabled: Boolean(running),
      onclick: function () { testMany(picked); } }, "Test " + picked.length) : null,
    picked.length ? h("button", { className: "sm danger", onclick: function () { removeModels(picked); } }, "Take " + picked.length + " out") : null,
    picked.length ? h("button", { className: "sm ghost", onclick: function () { MINE.clear(); drawMine(); } }, "Clear") : null,
    SORT.length ? h("button", { className: "sm", onclick: function () { SORT = []; drawMine(); } }, "Clear sort") : null,
    S.providers.length > 1 ? h("button", {
      className: "sm" + (ranked() ? " on" : ""),
      title: ranked()
        ? "You have ranked your providers. Click to change or clear it."
        : "Say which providers you would rather use. It tilts the draw; it does not override the record.",
      onclick: rankingDialog,
    }, ranked() ? "Ranking \\u2713" : "Provider ranking") : null,
    list.length ? h("button", { className: "sm", title: "Ask models.dev again for context, price and abilities", onclick: refreshCatalog }, "Refresh from models.dev") : null,
    list.length ? h("button", { className: "sm", disabled: Boolean(running),
      title: filtering() ? "Only the models these filters show" : "Every model in the pot",
      onclick: function () { testMany(view); } },
      filtering() ? "Test these " + view.length : "Test all") : null,

    // The list you are looking at, made into the list you keep. Narrow to
    // the ones that work, or that call tools, or that cost nothing, and this
    // throws the rest out of the pot in one go.
    filtering() && view.length && view.length < all.length
      ? h("button", { className: "sm primary", disabled: Boolean(running),
          title: "Take the " + (all.length - view.length) + " models these filters hide out of the pot",
          onclick: function () { keepOnly(view, all); } },
          "Keep only these " + view.length)
      : null);

  if (!list.length) {
    put($("outcomes"));
    put($("mt"), h("div", { className: "card" }, !ready
      ? h("div", { className: "loading" }, h("span", { className: "spin" }), "Loading your models")
      : all.length
        ? h("div", { className: "empty" }, "No model matches these filters. ",
            h("button", { className: "sm", onclick: clearFilters }, "Clear filters"))
        : h("div", { className: "empty" },
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

  drawOutcomes(view);

  put($("mt"), h("div", { className: "mt-wrap" },
    h("table", { className: "mt" },
      h("thead", {}, h("tr", {},
        h("th", {}, h("input", {
          type: "checkbox", checked: allOn, indeterminate: picked.length > 0 && !allOn,
          "aria-label": "Select all",
          title: filtering() ? "Select the models shown" : "Select all",
          onchange: function () {
            // What is shown, not what exists: with a filter on, "all" means
            // the rows you can see.
            if (allOn) view.forEach(function (t) { MINE.delete(pk(t.i, t.model)); });
            else view.forEach(function (t) { MINE.add(pk(t.i, t.model)); });
            lastRow = null;
            drawMine();
          },
        })),
        h("th", { className: "num", title: "Its place in the order shown" }, "#"),
        head("model"), head("provider"), head("context"), head("abilities"),
        head("tools"), head("thinking"), head("images"),
        head("input"), head("output"), head("from"),
        head("record"), head("tried"), head("works"),
        h("th", {}, ""))),
      h("tbody", {}, view.map(function (t, n) {
        var d = facts(t.baseUrl, t.model);
        var r = recOf(t.baseUrl, t.model);
        var wait = COOL[key(t.baseUrl, t.model)];
        var on = MINE.has(pk(t.i, t.model));
        return h("tr", {
          // So a finished test can replace one cell instead of redrawing the
          // whole table, which matters at 500 models.
          "data-key": pk(t.i, t.model),
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
          h("td", { className: "num muted" }, String(n + 1)),
          h("td", { className: "m", title: t.model }, t.model),
          h("td", {}, t.name,
            t.off ? h("span", { className: "tag", style: "margin-left:6px" }, "off") : null,
            t.parked ? h("span", { className: "tag", style: "margin-left:6px" }, "parked") : null),
          h("td", { className: "num", title: d && d.context ? d.context.toLocaleString() + " tokens" : "models.dev does not list this model" }, kTok(d && d.context)),
          h("td", { className: "num" }, d ? COLS.abilities.get(t) + " of 3" : h("span", { className: "no" }, "?")),
          h("td", {}, yesNo(COLS.tools.get(t))),
          h("td", {}, yesNo(COLS.thinking.get(t))),
          h("td", {}, yesNo(COLS.images.get(t))),
          h("td", { className: "num" }, d && d.input !== undefined ? usd(d.input) : "-"),
          h("td", { className: "num" }, d && d.output !== undefined ? usd(d.output) : "-"),
          h("td", {}, fromCell(t)),
          h("td", { className: "num", title: r.total ? r.ok + " of " + r.total + " requests answered" : "Nothing has been sent to this model yet" },
            r.pct === null ? h("span", { className: "no" }, "-") : (r.pct + "%")),
          h("td", { className: "num" }, r.total || "-"),
          h("td", {}, worksCell(t)),
          h("td", {}, h("div", { className: "acts" },
            wait ? h("span", { className: "tag warn", title: "Rate limited or down. It goes to the back of the queue until this runs out." }, Math.ceil(wait / 1000) + "s") : null,
            h("button", { className: "sm", title: t.parked ? "Put it back in the pot" : "Keep it listed but never call it",
              onclick: function () { park(t); } }, t.parked ? "Unpark" : "Park"),
            h("button", { className: "sm danger", "aria-label": "Remove " + t.model,
              onclick: function () { removeModels([t]); } }, "\\u2715"))));
      })))));
}

// Keep what is shown, drop the rest.
async function keepOnly(view, all) {
  var going = all.filter(function (t) {
    return !view.some(function (k) { return k.i === t.i && k.model === t.model; });
  });
  if (!going.length) return;

  var ok = await ask(
    "Keep only these " + view.length + " models?",
    going.length + " that these filters hide come out of the pot. Their providers and keys stay, " +
    "and you can put any of them back from Providers.",
    "Keep these " + view.length);
  if (!ok) return;

  await removeModels(going);
  clearFilters();
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
//
// Nothing opens over the table. A run marks its models as testing, fills the
// Works? column in as results land, and shows its progress in a strip above
// the table — so you can watch it, sort by it, and act on it while it runs.
// A run happens on the server, and this watches it.
//
// It used to run here, firing one request per model at the panel. A browser
// holds six connections to one origin on HTTP/1.1, so thirty-six "lanes"
// were six in flight and the rest queued: 54 models took 101s from the page
// against 8s for the same work driven from outside it. Asking the server to
// do the run removes that ceiling, and a closed tab no longer stops it.
async function testMany(items) {
  if (!items.length) return;
  if (running) { toast("A test run is going already", true); return; }

  // Shown as testing at once, so the table reacts to the click rather than
  // to the first result.
  items.forEach(function (t) { TRIES[pk(t.i, t.model)] = { going: true }; });
  drawMine();

  try {
    seenUpTo = Date.now() - 1000;
    var started = await post("/api/tests/start", {
      only: items.map(function (t) { return { index: t.i, model: t.model }; }),
    });
    running = started && started.running ? started : running;
    drawRun();
    watchRun();
  } catch (e) {
    items.forEach(function (t) { delete TRIES[pk(t.i, t.model)]; });
    drawMine();
    toast(e.message, true);
  }
}

// Only the cell that changed, so a run of 500 does not redraw the table 500
// times. The counts above it are worth a full redraw, but only once things
// have settled for a moment.
function paintCell(i, model) {
  var tr = document.querySelector('tr[data-key="' + cssEscape(pk(i, model)) + '"]');
  var cell = tr && tr.querySelector(".try");
  if (cell) cell.replaceWith(worksCell({ i: i, model: model }));
  else drawMine();
}

function cssEscape(v) {
  return window.CSS && CSS.escape ? CSS.escape(v) : String(v).replace(/["\\\\]/g, "\\\\$&");
}

// While a run is going, only the counts above the table are redrawn. The
// table itself is rebuilt row by row at a thousand-odd models, and doing
// that every time a lull let the timer fire is what made a long run feel
// like it had seized up. Each finished model already repaints its own cell.
var settleTimer = null;
function settleSoon() {
  clearTimeout(settleTimer);
  settleTimer = setTimeout(function () {
    if (running) {
      drawOutcomes(sortRows(rows()));
      return;
    }
    loadRecord().then(drawMine);
  }, 400);
}

// The server reports by base URL; the table is keyed by provider index.
function indexOfBaseUrl(baseUrl) {
  for (var i = 0; i < S.providers.length; i++) {
    if (S.providers[i].baseUrl === baseUrl) return i;
  }
  return -1;
}

function gotResult(key, result) {
  var at = key.lastIndexOf("|");
  var i = indexOfBaseUrl(key.slice(0, at));
  if (i < 0) return;
  var model = key.slice(at + 1);
  TRIES[pk(i, model)] = result;
  if (result.at > seenUpTo) seenUpTo = result.at;
  paintCell(i, model);
  settleSoon();
}

// The newest result this page has taken in, so a catch-up only asks for
// what it is missing.
var seenUpTo = 0;

// Everything the server already knows, so a reload during a run picks it up
// mid-flight instead of showing an empty column.
async function loadTests() {
  var out;
  try {
    out = await api("/api/tests");
  } catch (e) {
    return;
  }
  TRIES = {};
  Object.keys(out.results || {}).forEach(function (key) {
    var at = key.lastIndexOf("|");
    var i = indexOfBaseUrl(key.slice(0, at));
    if (i >= 0) TRIES[pk(i, key.slice(at + 1))] = out.results[key];
    if (out.results[key].at > seenUpTo) seenUpTo = out.results[key].at;
  });
  if (out.now) seenUpTo = Math.max(seenUpTo, 0);
  running = out.running ? out : null;
}

// While a run is going, ask every couple of seconds for whatever the stream
// did not deliver.
//
// The stream is the fast path and it is not reliable on its own: at a few
// hundred results a second it drops, and an EventSource that reconnects has
// no way to replay what it missed, so the page simply stopped moving while
// the run carried on. This makes it heal itself, and the since parameter
// keeps the answer to a handful of rows rather than the whole table.
var catchUpTimer = null;

function watchRun() {
  if (catchUpTimer) return;
  catchUpTimer = setInterval(async function () {
    if (!running) {
      clearInterval(catchUpTimer);
      catchUpTimer = null;
      return;
    }
    var out;
    try {
      out = await api("/api/tests?since=" + seenUpTo);
    } catch (e) {
      return;
    }
    Object.keys(out.results || {}).forEach(function (key) {
      gotResult(key, out.results[key]);
    });
    running = out.running ? out : null;
    drawRun();
    if (!running) {
      clearInterval(catchUpTimer);
      catchUpTimer = null;
      await loadRecord();
      drawMine();
    }
  }, 2000);
}

function drawRun() {
  if (!running) { put($("run")); return; }
  var pct = running.total ? Math.round((running.done / running.total) * 100) : 0;
  put($("run"), h("div", { className: "run" },
    h("span", { className: "spin" }),
    h("span", { className: "what" }, running.stop
      ? "Stopping"
      : "Testing " + running.total + (running.total === 1 ? " model" : " models") +
        (running.lanes > 1 ? " \\u00b7 " + running.lanes + " at a time per provider" : "")),
    h("span", { className: "bar" }, h("i", { style: "width:" + pct + "%" })),
    h("span", { className: "tally" },
      h("span", { className: "g" }, "\\u2713 " + running.good),
      " \\u00b7 ",
      h("span", { className: "b" }, "\\u2717 " + (running.done - running.good)),
      " \\u00b7 " + running.done + "/" + running.total),
    pausedNote(),
    h("button", { className: "sm", disabled: running.stopping,
      onclick: function () { post("/api/tests/stop").catch(function () {}); } }, "Stop")));
}

// A provider that said it is busy, and how long until it is asked again.
// Without this a run that has gone quiet looks stuck rather than patient.
function pausedNote() {
  if (!running || !running.paused) return null;
  var waiting = Object.keys(running.paused).map(function (name) {
    return name + " " + running.paused[name] + "s";
  });
  if (!waiting.length) return null;
  // RATE_TRIES lives on the server now, where the run does. Naming it here
  // threw on every call, and because the throw was inside the event handler
  // it killed the progress strip silently: the page held the right numbers
  // and never drew them.
  return h("span", { className: "tag warn", title: "It answered 429. Its models go back on the queue and are tried again after the pause." },
    "busy: " + waiting.join(", "));
}

// What the last run came to, grouped. Clicking a group selects those models,
// so "take out everything that 404s" is two clicks; the arrow tests them
// again, which is the other thing you want after a rate limit.
function drawOutcomes(view) {
  var groups = new Map();
  view.forEach(function (t) {
    var o = outcome(TRIES[pk(t.i, t.model)]);
    if (!o) return;
    if (!groups.has(o)) groups.set(o, []);
    groups.get(o).push(t);
  });

  if (!groups.size) { put($("outcomes")); return; }

  var sorted = [...groups].sort(function (a, b) {
    return (b[0] === "works") - (a[0] === "works") || b[1].length - a[1].length;
  });

  put($("outcomes"), h("div", { className: "pills" }, sorted.map(function (entry) {
    var what = entry[0];
    var models = entry[1];
    var on = models.every(function (t) { return MINE.has(pk(t.i, t.model)); });
    return h("span", { className: "pill " + (what === "works" ? "ok" : "bad") + (on ? " on" : "") },
      h("button", {
        type: "button",
        title: (MEANS[what] || what) + "\\n" + (on ? "Unselect" : "Select") + " these " + models.length,
        onclick: function () {
          models.forEach(function (t) {
            if (on) MINE.delete(pk(t.i, t.model)); else MINE.add(pk(t.i, t.model));
          });
          drawMine();
        },
      }, (what === "works" ? "\\u2713 works" : "\\u2717 " + what), h("span", { className: "n" }, String(models.length))),
      what === "works" ? null : h("button", {
        type: "button", className: "again", title: "Test these " + models.length + " again",
        disabled: Boolean(running),
        onclick: function () { testMany(models); },
      }, "\\u21bb"));
  })));
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

// --- provider ranking -----------------------------------------------------
// Drag the providers into the order you would rather use them.
//
// It is a preference, not a running order. opencc still picks from what each
// model has actually done; this only tilts the draw, enough to separate two
// models the record cannot tell apart and nowhere near enough to float one
// that keeps failing.
function rankingDialog() {
  var order = S.providers.slice().sort(function (a, b) {
    return placeOfProvider(a.baseUrl) - placeOfProvider(b.baseUrl) || byName(a.name || a.label, b.name || b.label);
  });

  var list = h("ol", { className: "rank" });
  var held = null;

  var draw = function () {
    put(list, order.map(function (p, i) {
      return h("li", { draggable: true, "data-url": p.baseUrl },
        h("span", { className: "grip", "aria-hidden": "true" }, "\\u22ee\\u22ee"),
        h("span", { className: "n" }, "#" + (i + 1)),
        h("span", { className: "nm" }, p.name || p.label),
        p.disabled ? h("span", { className: "tag" }, "off") : null,
        h("span", { className: "meta" }, p.models.length + " in pot"),
        h("span", { className: "up" },
          h("button", {
            className: "sm", type: "button", disabled: i === 0, "aria-label": "Move up",
            onclick: function () { order.splice(i - 1, 0, order.splice(i, 1)[0]); draw(); },
          }, "\\u2191"),
          h("button", {
            className: "sm", type: "button", disabled: i === order.length - 1, "aria-label": "Move down",
            onclick: function () { order.splice(i + 1, 0, order.splice(i, 1)[0]); draw(); },
          }, "\\u2193")));
    }));
  };

  // Dragging is the quick way; the arrows are the one that works with a
  // keyboard and on a touch screen.
  list.addEventListener("dragstart", function (e) {
    held = e.target.closest("li");
    if (held) held.classList.add("dragging");
  });
  list.addEventListener("dragend", function () {
    if (held) held.classList.remove("dragging");
    held = null;
    order = [].slice.call(list.children).map(function (li) {
      return S.providers.find(function (p) { return p.baseUrl === li.dataset.url; });
    }).filter(Boolean);
    draw();
  });
  list.addEventListener("dragover", function (e) {
    e.preventDefault();
    var over = e.target.closest("li");
    if (!held || !over || over === held) return;
    var box = over.getBoundingClientRect();
    list.insertBefore(held, e.clientY > box.top + box.height / 2 ? over.nextSibling : over);
  });

  draw();

  openDialog([
    h("h2", {}, "Provider ranking"),
    h("p", {}, "Drag into order, best first. This is a preference, not a running order: " +
      "which model answers is still drawn from the Record column, and ranking only " +
      "separates models the record cannot tell apart."),
    list,
    h("div", { className: "btns" },
      (S.rank || []).length
        ? h("button", { className: "left", onclick: async function () {
            S.rank = [];
            if (closeDialog) closeDialog();
            await save();
            toast("Ranking cleared: the record decides on its own");
          } }, "Clear ranking")
        : null,
      h("button", { onclick: function () { if (closeDialog) closeDialog(); } }, "Cancel"),
      h("button", { className: "primary", onclick: async function () {
        S.rank = order.map(function (p) { return p.baseUrl; });
        if (closeDialog) closeDialog();
        await save();
        toast("Ranking saved");
      } }, "Save ranking")),
  ]);
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
    put($("reqlist"), !ready
      ? h("div", { className: "loading" }, h("span", { className: "spin" }), "Loading")
      : h("div", { className: "empty" },
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
  src.addEventListener("message", function (e) {
    // Anything that throws in here used to kill every later update silently,
    // and the page sat on correct numbers it never drew. The catch-up poll
    // covers a dropped stream; this covers a bad render.
    handleEvent(e).catch(function (err) {
      toast("Live updates hit a problem: " + err.message, true);
    });
  });
}

async function handleEvent(e) {
  var msg;
  try { msg = JSON.parse(e.data); } catch (e2) { return; }
  var what = msg.what;
  {
    if (what === "tested") {
      gotResult(msg.key, msg.result);
      return;
    }
    if (what === "testrun") {
      var was = Boolean(running);
      running = msg.run && msg.run.running ? msg.run : null;
      drawRun();   // the strip only: a few nodes, not the table
      if (running) watchRun();
      // A run that has just ended: settle the counts and say how it went.
      if (was && !running) {
        await loadRecord();
        drawMine();
        if (msg.run && msg.run.over) {
          toast((msg.run.stopping ? "Stopped \\u00b7 " : "") +
            msg.run.good + " of " + msg.run.done + " answered",
            msg.run.good < msg.run.done);
        }
      }
      return;
    }
    if (what === "request" || what === "requests-cleared") {
      await Promise.all([loadRequests(), loadRecord()]);
      drawAll();
    }
  }
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
function drawAll() { drawSidebar(); drawRun(); drawMine(); drawProviders(); drawRequests(); showPage(); }

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
$("ttl").addEventListener("change", async function () {
  // Clamped here as well as on the server, so the box shows what was
  // actually kept rather than what was typed.
  var n = Math.min(300, Math.max(1, Math.round(Number($("ttl").value) || 10)));
  S.testTimeout = n;
  $("ttl").value = n;
  await save();
  toast("Tests give up after " + n + "s");
});
$("lanes").addEventListener("change", async function () {
  var n = Math.min(16, Math.max(1, Math.round(Number($("lanes").value) || 4)));
  S.testLanes = n;
  $("lanes").value = n;
  await save();
  toast(n === 1 ? "One model at a time per provider" : n + " at a time per provider");
});
$("catalog").addEventListener("click", refreshCatalog);
$("add-prov").addEventListener("click", function () { providerForm(); });
$("go-prov").addEventListener("click", function () { location.hash = "#providers"; showPage(); });
$("q").addEventListener("input", function (e) { query = e.target.value; drawProviders(); });
$("free").addEventListener("change", function (e) { freeOnly = e.target.checked; drawProviders(); });
$("sort").addEventListener("change", function (e) { catSort = e.target.value; drawProviders(); });
$("f-q").addEventListener("input", function (e) { FILTER.q = e.target.value; keepFilter(); drawMine(); });
$("f-prov").addEventListener("change", function (e) { FILTER.prov = e.target.value; keepFilter(); drawMine(); });
Object.keys(CONTROLS).forEach(function (key) {
  $(CONTROLS[key]).addEventListener("change", function (e) {
    FILTER[key] = e.target.value;
    keepFilter();
    drawMine();
  });
});
$("f-clear").addEventListener("click", clearFilters);

$("rank").addEventListener("click", rankingDialog);
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
  await Promise.all([loadRecord(), loadCatalog(), loadRequests(), loadTests()]);
  ready = true;
  drawAll();
  listen();
  if (running) watchRun();
})();
</script>
</body>
</html>`;
