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
    display: flex; align-items: center; gap: 9px; padding: 0 13px 0 30px;
    border-top: 1px solid var(--rule); font-size: 13px;
    /* One height for every row: the long lists draw only what is in view, and
       that needs to know how tall a row is without drawing it. */
    height: 38px; box-sizing: border-box;
  }
  .mrow .id { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; word-break: normal; }
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
  /* One height for every row, for the same reason as the catalogue's. */
  table.mt tbody tr:not(.spacer) td { height: 38px; padding-top: 0; padding-bottom: 0; }
  table.mt tbody tr.spacer td { padding: 0; border: 0; }
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

  /* an on/off switch, in a provider's header */
  .sw { position: relative; display: inline-block; width: 30px; height: 17px; flex: none; margin: 0; cursor: pointer; }
  .sw input { position: absolute; opacity: 0; width: 100%; height: 100%; margin: 0; cursor: pointer; }
  .sw i { position: absolute; inset: 0; border-radius: 99px; background: var(--rule-2); transition: background .15s; }
  .sw i::after { content: ""; position: absolute; top: 2px; left: 2px; width: 13px; height: 13px; border-radius: 50%; background: #fff; transition: transform .15s; }
  .sw input:checked + i { background: var(--ok); }
  .sw input:checked + i::after { transform: translateX(13px); }
  .sw input:focus-visible + i { outline: 2px solid var(--accent); outline-offset: 2px; }
  @media (prefers-reduced-motion: reduce) { .sw i, .sw i::after { transition: none; } }

  /* a row that was asked about, so "already there" can be found */
  @keyframes flash { from { background: var(--warn-bg); box-shadow: inset 3px 0 0 var(--warn); } to { background: transparent; box-shadow: none; } }
  .mrow.flash { animation: flash 1.6s ease-out; }
  .mrow .add { font: 600 11px var(--mono); color: var(--accent); white-space: nowrap; }
  .mrow .can { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 46%; text-align: right; }
  .mrow .forget { border: 0; background: none; color: var(--ink-3); padding: 2px 6px; }
  .mrow .forget:hover { color: var(--bad); background: none; }
  .src { display: flex; align-items: center; gap: 6px; white-space: nowrap; }
  .src.warn .msg { color: var(--warn); font: 11.5px var(--mono); }

  /* the first start: what to do, and where you are */
  .steps { display: flex; gap: 10px; margin-bottom: 14px; flex-wrap: wrap; }
  .step { flex: 1; min-width: 190px; display: flex; gap: 10px; align-items: center; padding: 11px 13px;
    border: 1px solid var(--rule); border-radius: var(--r); background: var(--panel); font-size: 12.5px; color: var(--ink-3); }
  .step b { display: block; color: var(--ink-2); font-size: 13px; }
  .step .num { width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; flex: none;
    background: var(--panel-2); font: 600 11px var(--mono); }
  .step.now { border-color: var(--accent); } .step.now b { color: var(--ink); } .step.now .num { background: var(--accent); color: var(--accent-ink); }
  .step.done .num { background: var(--ok); color: #fff; }

  /* the presets in the add-a-provider form */
  .presets { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 6px; margin: 10px 0 4px; }
  .preset { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; text-align: left; padding: 8px 10px; }
  .preset span { color: var(--ink-3); font-weight: 400; font-size: 11px; }
  .preset.on { border-color: var(--accent); background: var(--accent-soft); }

  /* Hello to several: one row each */
  .hellos { display: grid; gap: 5px; margin-top: 10px; max-height: 46vh; overflow: auto; }
  .hellos button { display: flex; gap: 10px; align-items: baseline; text-align: left; width: 100%; padding: 7px 10px; white-space: normal; }
  .hellos .id { font-family: var(--mono); font-size: 12px; color: var(--ink); flex: none; }
  .hellos .said { color: var(--ink-3); font-size: 12px; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .hellos button.ok .said { color: var(--ok); } .hellos button.bad .said { color: var(--bad); }

  #lists-job:empty { display: none; }
  #lists-job .run { margin: 10px 13px; }

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
            several. What each provider's own list says it costs is shown beside it; what a
            model can do comes from models.dev, and from what you say about it.</p>
        </div>
        <div class="acts">
          <button id="go-models" hidden></button>
          <button class="primary" id="add-prov">Add a provider</button>
        </div>
      </div>
      <div id="steps"></div>
      <div class="card">
        <div class="cat-top">
          <input type="checkbox" id="pick-all" title="Select every model shown">
          <input type="search" id="q" placeholder="Search all models">
          <label class="chk" title="Only the models their provider lists at $0 (what its own list says: the price shown beside each)"><input type="checkbox" id="free"> Free only</label>
          <select id="sort" aria-label="Sort the models">
            <option value="name">Sort by name</option>
            <option value="price">Sort by price (free first)</option>
          </select>
          <button id="rank">Provider ranking</button>
          <button id="fold-all">Collapse all</button>
          <button id="dev-all" title="Ask models.dev what each listed model can do: tool calls, context, thinking, images">Get from models.dev</button>
        </div>
        <div id="lists-job"></div>
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

// --- long lists -----------------------------------------------------------
// A long list drawn a screenful at a time: every row the same height, only
// the rows in view (and a few more each side) in the page, the rest empty room
// of the right size, so thousands of models scroll smoothly. At fifteen
// hundred rows the page held 56,000 elements and a redraw took 140ms; this
// keeps it to a few dozen rows however long the list is.
//
// host: where the rows go (a tbody, or a div). o:
//   count     how many rows there are
//   row(i)    row i's element
//   height    one row's height in pixels
//   scroller  window, or the element that scrolls the host
//   tag       "tr" for a tbody (its spacers must be rows), else a div
//   cols      the table's column count, for the spacers
var WINDOWS = new Set();
var WINDOW_BUFFER = 8;

function windowed(host, o) {
  var w = { host: host, o: o, first: -1, last: -1, cache: new Map() };

  var spacer = function (px) {
    if (o.tag === "tr") {
      var td = h("td", { colSpan: o.cols || 1, style: "height:" + px + "px;padding:0;border:0" });
      return h("tr", { className: "spacer", "aria-hidden": "true" }, td);
    }
    return h("div", { className: "spacer", "aria-hidden": "true", style: "height:" + px + "px" });
  };

  w.draw = function (force) {
    if (!host.isConnected || !host.getClientRects().length) return;   // not on the page, or folded away

    var rel, view;
    if (o.scroller === window) {
      rel = host.getBoundingClientRect().top;
      view = innerHeight;
    } else {
      rel = host.getBoundingClientRect().top - o.scroller.getBoundingClientRect().top;
      view = o.scroller.clientHeight;
    }
    var first = Math.max(0, Math.floor(-rel / o.height) - WINDOW_BUFFER);
    var last = Math.min(o.count, Math.ceil((view - rel) / o.height) + WINDOW_BUFFER);
    if (!force && first === w.first && last === w.last) return;
    w.first = first;
    w.last = last;

    // Keep the rows still in range, so scrolling a little does not rebuild
    // the ones already there.
    var kept = new Map();
    var nodes = [];
    for (var i = first; i < last; i++) {
      var el = w.cache.get(i) || o.row(i);
      kept.set(i, el);
      nodes.push(el);
    }
    w.cache = kept;
    host.replaceChildren.apply(host, [spacer(first * o.height)].concat(nodes, [spacer((o.count - last) * o.height)]));
  };

  WINDOWS.add(w);
  return w;
}

var windowFrame = 0;
function drawWindows() {
  if (windowFrame) return;
  windowFrame = requestAnimationFrame(function () {
    windowFrame = 0;
    WINDOWS.forEach(function (w) {
      if (w.host.isConnected) w.draw(); else WINDOWS.delete(w);
    });
  });
}
// The page's scroll, or any list's: scroll does not bubble, but it can be
// caught on the way down.
addEventListener("scroll", drawWindows, { capture: true, passive: true });
addEventListener("resize", drawWindows);

// --- state ----------------------------------------------------------------
var S = { providers: [], port: "3000", streaming: true, rank: [], testTimeout: 10, testLanes: 4, version: "" };
var REC = {};        // "baseUrl|model" -> { kind: {ok, fail, statuses} }
var COOL = {};
var CAT = {};        // "baseUrl|model" -> what is known, for the models in your pot
var LISTKNOWN = {};  // the same, for every model a provider listed
var CATINFO = { size: 0, age: null };
var LISTS = {};      // provider name -> { models, details, error, loading, off, at }
// The lists loading now, for the progress strip: how many were asked for since
// none was loading, how many are back, how many could not be listed.
var listLoads = { total: 0, done: 0, failed: 0 };
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

// Everything below is keyed by provider NAME, which is unique and made of
// letters, digits, dashes and underscores, so it is safe before a "|". It was
// the provider's position in the list, which shifts when one is deleted.
var PICKED = new Set();   // "name|model" ticked in the catalogue
var MINE = new Set();     // "name|model" ticked in the table
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
  return { i: k.slice(0, at), model: k.slice(at + 1) };
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

// 1,050,000 showed as "1.1M" at one decimal, which reads as a number nobody
// publishes and made the column look made up. Two decimals, trailing zeros
// dropped: 1,050,000 is 1.05M, 1,048,576 is 1.05M, 1,000,000 is 1M. The
// exact figure is in the cell's tooltip either way.
function kTok(n) {
  if (!n) return "-";
  if (n >= 1000000) return Number((n / 1000000).toFixed(2)) + "M";
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
function facts(baseUrl, model) { return CAT[key(baseUrl, model)] || LISTKNOWN[key(baseUrl, model)] || null; }

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

// A provider's own model list, from the server, which keeps it: coming back
// does not ask every backend again. fresh asks again.
//
// Several at once are one job on the progress strip: how many were asked for,
// how many are back, how many could not be listed.
async function loadList(name, fresh) {
  if (LISTS[name] && !fresh && !LISTS[name].loading) return LISTS[name];
  if (LISTS[name] && LISTS[name].loading) return LISTS[name];

  LISTS[name] = { models: (LISTS[name] && LISTS[name].models) || [], details: (LISTS[name] && LISTS[name].details) || {}, loading: true, error: "" };
  if (listLoads.done >= listLoads.total) listLoads = { total: 0, done: 0, failed: 0 };
  listLoads.total += 1;
  drawProviders();

  try {
    var out = await post("/api/models", { name: name, fresh: Boolean(fresh) });
    var p = provOf(name);
    LISTS[name] = { models: out.models || [], details: out.details || {}, loading: false, error: "", off: Boolean(out.off), at: out.at };
    // What a list knew about each model, so a row can say what it can do.
    if (p) {
      (out.models || []).forEach(function (id) {
        var known = out.details && out.details[id] && out.details[id].known;
        if (known) LISTKNOWN[key(p.baseUrl, id)] = known; else delete LISTKNOWN[key(p.baseUrl, id)];
      });
    }
  } catch (e) {
    LISTS[name] = { models: [], details: {}, loading: false, error: e.message };
    listLoads.failed += 1;
  }
  listLoads.done += 1;
  drawProviders();
  return LISTS[name];
}

// What the page chooses for itself, kept on the server so it survives a new
// port: sorts, folds, filters.
function savePref(k, value) {
  return post("/api/prefs", { key: k, value: value }).catch(function (e) { toast("not kept: " + e.message, true); });
}

// A change to the settings that are not about a provider.
async function saveSettings(patch) {
  S = await post("/api/settings", patch);
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
    S.providers.forEach(function (p) { if (!LISTS[p.name]) loadList(p.name); });
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
      ", kept until you fetch it again. Click to fetch it again."
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

// What a provider's own list says about one model: name, window, owner, date,
// description, price, and what is known from models.dev and from you.
function detailOf(name, id) {
  var l = LISTS[name];
  return (l && l.details && l.details[id]) || null;
}
function listOf(name) {
  return LISTS[name] || { models: [], details: {}, loading: true, error: "" };
}

// What the provider's own list says it costs, which is not models.dev's: the
// same model costs differently at different providers. Free only and the
// price sort use this. A provider whose list carries no prices cannot say
// what is free, so Free only leaves its models out.
var isFreeListed = function (d) { return Boolean(d && d.price) && !d.price.input && !d.price.output; };
var costOfListed = function (d) { return d && d.price ? (d.price.input || 0) + (d.price.output || 0) : Infinity; };

function priceText(p) {
  if (!p) return "";
  if (!p.input && !p.output) return "free";
  var bits = [];
  if (p.input != null) bits.push((p.input ? usd(p.input) : "$0") + " in");
  if (p.output != null) bits.push((p.output ? usd(p.output) : "$0") + " out");
  return bits.join(" / ") + " per M";
}

// What a model can do, in a few words: what is known (models.dev's, or yours),
// and "not in models.dev" when nothing is.
function canText(d) {
  if (!d) return "";
  var k = d.known;
  if (!k) return "not in models.dev";
  return (k.tools ? "tool calls" : "no tool calls") +
    (k.context ? " · " + kTok(k.context) + " context" : "") +
    (k.reasoning ? " · thinks" : "") +
    (k.vision ? " · images" : "");
}

// The model's tooltip: its full name and everything its provider's list said.
function tipText(id, d) {
  var lines = [id];
  if (!d) return id;
  if (d.name) lines.push(d.name);
  if (d.owner) lines.push("by " + d.owner);
  if (d.created) lines.push("added " + new Date(d.created).toLocaleDateString());
  if (d.context) lines.push("context " + d.context.toLocaleString() + " tokens (its own list)");
  if (d.price) lines.push(priceText(d.price) + " (its own list)");
  if (d.description) lines.push("", d.description);
  return lines.join("\\n");
}

function provOf(name) {
  for (var n = 0; n < S.providers.length; n++) if (S.providers[n].name === name) return S.providers[n];
  return null;
}

function matches(name, id) {
  var d = detailOf(name, id);
  if (query && id.toLowerCase().indexOf(query.toLowerCase()) < 0) return false;
  if (freeOnly && !isFreeListed(d)) return false;
  return true;
}

// Every name this provider has, A to Z: what it lists, then yours it does not
// list — added by name, or in the pot from before its list changed. They
// belong on screen, or taking one out would mean editing the file.
function namesFor(p) {
  var listed = listOf(p.name).models;
  var have = {};
  listed.forEach(function (id) { have[id] = true; });
  var yours = [];
  p.added.concat(p.models).forEach(function (id) {
    if (!have[id] && yours.indexOf(id) < 0) yours.push(id);
  });
  return { listed: listed, set: have, yours: yours, all: listed.concat(yours) };
}

var SHOWN = {};   // provider name -> the models its section shows now

// Folds. Typing a search opens every provider until you fold one by hand, so
// the matches are visible; folding by hand starts from what is showing.
var searchOpen = false;
function isFolded(name) { return SHUT.has(name) && !(searchOpen && query.trim()); }
function settleFolds() {
  if (searchOpen && query.trim()) S.providers.forEach(function (p) { SHUT.delete(p.name); });
  searchOpen = false;
}
function keepFolds() { savePref("folded", Array.from(SHUT)); }
function allFolded() { return Boolean(S.providers.length) && S.providers.every(function (p) { return SHUT.has(p.name); }); }

function openForm() { providerForm(null); }

// The strip over the list while the providers are asked for their models.
// Updated in place, so nothing jumps while it counts.
function drawListsJob() {
  var el = $("lists-job");
  if (!el) return;
  if (listLoads.done >= listLoads.total) { put(el); return; }
  var pct = Math.round((100 * listLoads.done) / listLoads.total);
  put(el, h("div", { className: "run" },
    h("span", { className: "spin" }),
    h("span", { className: "what" }, "Loading model lists"),
    h("span", { className: "bar" }, h("i", { style: "width:" + pct + "%" })),
    h("span", { className: "tally" }, listLoads.done + " of " + listLoads.total),
    h("span", { className: "muted" }, listLoads.failed
      ? listLoads.failed + " couldn't be listed"
      : "from each provider, kept for next time")));
}

function stepsStrip() {
  var haveProviders = S.providers.length > 0;
  var haveModels = S.providers.some(function (p) { return p.models.length; });
  var steps = [
    ["Add a provider", "the service with your models", haveProviders ? "done" : "now"],
    ["Choose models", "click one, or tick several and add them", haveModels ? "done" : haveProviders ? "now" : ""],
    ["Start Claude Code", "opencc claude, in your project", haveModels ? "now" : ""],
  ];
  return h("div", { className: "steps" }, steps.map(function (s, n) {
    return h("div", { className: "step " + s[2] },
      h("span", { className: "num" }, s[2] === "done" ? "✓" : String(n + 1)),
      h("div", {}, h("b", {}, s[0]), s[1]));
  }));
}

// One model's row in a provider's section.
function catalogRow(p, id, names) {
  var d = detailOf(p.name, id);
  var have = p.models.indexOf(id) >= 0;
  var own = !names.set[id];
  var added = p.added.indexOf(id) >= 0;
  var text = [canText(d), priceText(d && d.price)].filter(Boolean).join(" · ");

  return h("div", { className: "mrow" + (have ? " taken" : ""), "data-model": id },
    h("input", {
      type: "checkbox", checked: PICKED.has(pk(p.name, id)), "aria-label": "Select " + id,
      onchange: function (e) {
        if (e.target.checked) PICKED.add(pk(p.name, id)); else PICKED.delete(pk(p.name, id));
        drawPicks();
      },
    }),
    h("span", {
      className: "id", title: tipText(id, d),
      onclick: function () {
        if (have) removeModels([{ i: p.name, model: id }], { confirmed: true });
        else addModels([{ i: p.name, model: id }]);
      },
    }, id),
    isFreeListed(d) ? h("span", { className: "tag ok", title: p.name + "'s own model list says $0" }, "free") : null,
    own
      ? h("span", { className: "tag", title: "Its list does not carry this name." }, "not in its list")
      : added ? h("span", { className: "tag" }, "added by you") : null,
    text ? h("span", { className: "meta can", title: tipText(id, d) }, text) : null,
    have
      ? h("span", { className: "tag acc", title: "In your pot. Click the name to take it out." }, "in pot")
      : h("span", { className: "add" }, "+ Add"),
    h("button", {
      className: "sm try", title: "Send " + id + " \\"Hello\\" and see what was sent and what came back",
      onclick: function () { hello(p.name, id); },
    }, "Test"),
    added ? h("button", {
      className: "forget", "aria-label": "Forget " + id, title: "Forget this model",
      onclick: function () { forgetAdded(p, id); },
    }, "✕") : null);
}

var ROW_H_CAT = 38;
var PENDING = [];   // windows made while drawing, to start once they are on the page

// A provider's models in a box that scrolls, drawn a screenful at a time.
function catalogRows(p, rows, names) {
  var box = h("div", { className: "rows" });
  var host = h("div", { className: "rows-host" });
  box.append(host);
  var w = windowed(host, {
    count: rows.length, height: ROW_H_CAT, scroller: box, tag: "div",
    row: function (i) { return catalogRow(p, rows[i], names); },
  });
  box._w = w;
  PENDING.push(w);
  return box;
}

// One provider's section: its header, then what it lists.
function providerSection(p) {
  var list = listOf(p.name);
  var names = namesFor(p);
  var rows = names.all.filter(function (id) { return matches(p.name, id); });

  rows.sort(function (a, b) {
    if (catSort === "price") {
      var diff = costOfListed(detailOf(p.name, a)) - costOfListed(detailOf(p.name, b));
      if (diff && isFinite(diff)) return diff;
      if (costOfListed(detailOf(p.name, a)) !== costOfListed(detailOf(p.name, b))) {
        return costOfListed(detailOf(p.name, a)) === Infinity ? 1 : -1;
      }
    }
    return byName(a, b);
  });

  // Searching shows only the providers with a match; Free only, the ones with
  // a free model.
  if ((query || freeOnly) && !rows.length) return null;
  SHOWN[p.name] = rows;

  var shut = isFolded(p.name);
  var ticked = rows.filter(function (id) { return PICKED.has(pk(p.name, id)); });
  var inPot = p.models.length;

  return h("div", { className: "prov" + (p.disabled ? " off" : "") + (shut ? " shut" : ""), "data-provider": p.name },
    h("div", { className: "prov-h", onclick: function (e) {
      // The header folds it, but not its buttons, switch and fields. The fold
      // arrow is one of those buttons and has its own handler: letting the
      // click bubble here as well toggled it twice, which is no change at all.
      if (e.target.closest("button, input, label, form, a")) return;
      toggleFold(p.name);
    } },
      h("button", {
        className: "fold", type: "button",
        "aria-expanded": shut ? "false" : "true",
        "aria-label": (shut ? "Expand " : "Collapse ") + p.name,
        title: shut ? "Expand" : "Collapse",
        onclick: function () { toggleFold(p.name); },
      }, shut ? "▸" : "▾"),
      rows.length ? h("input", {
        type: "checkbox", checked: ticked.length > 0 && ticked.length === rows.length,
        title: "Select all of " + p.name + "'s models shown (or none)",
        onchange: function (e) {
          rows.forEach(function (id) {
            if (e.target.checked) PICKED.add(pk(p.name, id)); else PICKED.delete(pk(p.name, id));
          });
          drawPicks();
        },
      }) : null,
      h("label", { className: "sw", title: p.disabled
        ? "Switched off: opencc skips " + p.name + "'s models. Switch it on."
        : "Switch " + p.name + " off: opencc skips its models (nothing is deleted)." },
        h("input", { type: "checkbox", checked: !p.disabled, "aria-label": p.name + " on",
          onchange: function (e) { setProviderOn(p.name, e.target.checked); } }),
        h("i")),
      h("div", { className: "who" },
        h("span", { className: "nm" }, p.name),
        p.disabled ? h("span", { className: "tag" }, "off") : null,
        list.off ? h("span", { className: "tag", title: "Its list is off, so it is never asked for its models. Add one by name." }, "list off")
          : list.loading ? h("span", { className: "tag" }, "loading…")
          : list.error ? h("span", { className: "tag bad", title: list.error }, "can't list its models")
          : h("span", { className: "tag", title: list.at ? "Asked " + ago(list.at) + ". It is kept, so coming back does not ask again. Refresh asks again." : "" },
              list.models.length + (list.models.length === 1 ? " model" : " models")),
        inPot ? h("span", { className: "tag acc" }, inPot + " in pot") : null,
        h("span", { className: "url", title: p.baseUrl + " · key " + (p.key || "none") }, p.baseUrl)),
      h("form", { className: "by-name", onsubmit: function (e) { e.preventDefault(); addByName(p, e.target.elements.name); } },
        h("input", { type: "text", name: "name", placeholder: "model name", "aria-label": "Add a model to " + p.name + " by its name",
          title: "A model's exact name: added to your pot, also one " + p.name + " does not list" }),
        h("button", { className: "sm" }, "Add")),
      p.list && !list.loading ? h("button", { className: "sm", title: "Ask " + p.name + " for its model list again",
        onclick: function () { loadList(p.name, true); } }, "Refresh") : null,
      h("button", { className: "sm", title: "Its address and key, its model list, delete it",
        onclick: function () { providerForm(p); } }, "Edit")),

    rows.length ? catalogRows(p, rows, names) : null,

    list.error ? h("div", { className: "note err" },
      "can't list its models: " + list.error + " ",
      h("button", { className: "sm", onclick: function () { loadList(p.name, true); } }, "Try again"),
      h("div", { className: "muted", style: "margin-top:4px" }, "Or add a model by its name, in the box above.")) : null,
    list.off && !rows.length ? h("div", { className: "note" }, "Its list is off: add a model by its name, in the box above.") : null,
    list.loading ? h("div", { className: "note" }, "Loading its models…") : null);
}

function toggleFold(name) {
  settleFolds();
  if (SHUT.has(name)) SHUT.delete(name); else SHUT.add(name);
  keepFolds();
  drawProviders();
}

// A model by its name, into your pot. One it already has is said and shown.
function addByName(p, box) {
  var id = box.value.trim();
  if (!id) return;
  if (p.models.indexOf(id) >= 0) { showRow(p.name, id, id + " is already in your pot"); return; }
  var names = namesFor(p);
  if (names.set[id] || p.added.indexOf(id) >= 0) { showRow(p.name, id, p.name + " already has " + id + ": click it to add it"); return; }
  box.value = "";
  addModels([{ i: p.name, model: id }]);
}

// Say it, scroll to the model, and flash its row, so "already there" can be
// found rather than just believed. The row may not be drawn — only the ones in
// view are — so it is scrolled to by position first.
function showRow(name, id, said) {
  toast(said);
  var section = document.querySelector('.prov[data-provider="' + cssEscape(name) + '"]');
  if (!section) return;
  if (section.classList.contains("shut")) {
    SHUT.delete(name);
    keepFolds();
    drawProviders();
    section = document.querySelector('.prov[data-provider="' + cssEscape(name) + '"]');
  }
  var box = section && section.querySelector(".rows");
  var at = SHOWN[name] ? SHOWN[name].indexOf(id) : -1;
  if (!box || at < 0) return;

  section.scrollIntoView({ block: "nearest", behavior: "smooth" });
  box.scrollTop = Math.max(0, at * ROW_H_CAT - box.clientHeight / 2);
  if (box._w) box._w.draw(true);

  var row = [].slice.call(box.querySelectorAll(".mrow")).filter(function (r) { return r.dataset.model === id; })[0];
  if (!row) return;
  row.classList.remove("flash");
  void row.offsetWidth;   // restart the animation
  row.classList.add("flash");
}

function drawProviders() {
  var haveModels = S.providers.some(function (p) { return p.models.length; });
  SHOWN = {};

  // Each section scrolls on its own. Drawing them again would put every one
  // back at its top, so a click deep in a long list threw you out of it.
  var scrolled = {};
  [].slice.call(document.querySelectorAll("#plist .prov")).forEach(function (sec) {
    var r = sec.querySelector(".rows");
    if (r) scrolled[sec.dataset.provider] = r.scrollTop;
  });

  PENDING = [];
  var sections = S.providers.map(providerSection).filter(Boolean);

  put($("steps"), haveModels ? null : stepsStrip());

  put($("plist"), sections.length ? sections
    : !ready ? h("div", { className: "loading" }, h("span", { className: "spin" }), "Loading providers")
    : h("div", { className: "empty" },
        !S.providers.length ? "No providers yet. Use Add a provider."
          : freeOnly && !query ? "None of your providers lists a model at $0. (A provider whose model list has no prices can't say what's free: Free only leaves those out.)"
          : "Nothing matches."));

  // Now they are on the page: start each window, then put each section back
  // where it was scrolled to.
  PENDING.forEach(function (w) { w.draw(true); });
  [].slice.call(document.querySelectorAll("#plist .prov")).forEach(function (sec) {
    var r = sec.querySelector(".rows");
    if (r && scrolled[sec.dataset.provider]) {
      r.scrollTop = scrolled[sec.dataset.provider];
      if (r._w) r._w.draw(true);
    }
  });
  PENDING = [];

  // Your pot, at the top: how many, and the way to its page.
  var n = S.providers.reduce(function (a, p) { return a + (p.disabled ? 0 : p.models.length); }, 0);
  $("go-models").hidden = !n;
  $("go-models").textContent = "Your models (" + n + ") →";

  var shownAll = shownKeys();
  var on = shownAll.filter(function (k) { return PICKED.has(k); });
  $("pick-all").checked = on.length > 0 && on.length === shownAll.length;
  $("pick-all").indeterminate = on.length > 0 && on.length < shownAll.length;
  $("pick-all").disabled = !shownAll.length;
  $("pick-all").title = $("pick-all").checked ? "Unselect every model shown"
    : "Select every model shown (" + shownAll.length + (query.trim() ? ": the matches" : "") + ")";
  $("fold-all").textContent = allFolded() ? "Expand all" : "Collapse all";

  var listed = S.providers.reduce(function (a, p) { return a + listOf(p.name).models.length; }, 0);
  $("q").placeholder = "Search " + (listed || "all") + " models…";
  $("rank").textContent = ranked() ? "Ranking ✓" : "Provider ranking";
  $("rank").disabled = S.providers.length < 2;
  drawListsJob();
  drawPicks();
}

function shownKeys() {
  var out = [];
  Object.keys(SHOWN).forEach(function (name) {
    SHOWN[name].forEach(function (id) { out.push(pk(name, id)); });
  });
  return out;
}

function drawPicks() {
  var all = [];
  PICKED.forEach(function (k) {
    var t = unpk(k);
    if (provOf(t.i)) all.push(t);
  });
  var toAdd = all.filter(function (t) { return provOf(t.i).models.indexOf(t.model) < 0; });
  var toTake = all.filter(function (t) { return provOf(t.i).models.indexOf(t.model) >= 0; });

  $("picks").hidden = !all.length;
  if (!all.length) return;
  put($("picks"),
    h("span", { className: "n" }, all.length + " selected"),
    h("button", { className: "sm ghost", onclick: function () { PICKED.clear(); drawProviders(); } }, "Clear"),
    h("button", { className: "sm", title: "Send each ticked model \\"Hello\\" and see which answer", onclick: function () { helloAll(all); } }, "Test " + all.length),
    toTake.length ? h("button", { className: "sm danger", onclick: function () { removeModels(toTake); } },
      "Remove " + toTake.length + " from your pot") : null,
    toAdd.length ? h("button", { className: "sm primary", onclick: function () { addModels(toAdd); } },
      "Add " + toAdd.length + " to your pot") : null);
}

// Pot changes are one request each, by provider name, applied on the server in
// one step. What comes back is the state, so the page always draws what is
// saved rather than what it hoped it saved.
async function applyState(path, body) {
  S = await post(path, body);
  drawAll();
  return S;
}

function toItems(list) {
  return list.map(function (t) { return { provider: t.i, model: t.model }; });
}

async function addModels(items) {
  PICKED.clear();
  var before = S.providers.reduce(function (a, p) { return a + p.models.length; }, 0);
  try {
    await applyState("/api/pot/add", { items: toItems(items) });
  } catch (e) { toast(e.message, true); return; }
  var after = S.providers.reduce(function (a, p) { return a + p.models.length; }, 0);
  var n = after - before;
  toast(n === 1 ? items[0].model + " added" : n + " models added: your pot has " + after);
}

// Out of the pot. Several at once ask first, as HeartCode does; one, clicked,
// does not.
async function removeModels(items, opts) {
  if (!(opts && opts.confirmed) && items.length > 1) {
    var ok = await ask(
      "Take " + items.length + " models out of your pot?",
      "They stay under their providers; you can add any of them back.",
      "Take " + items.length + " out");
    if (!ok) return;
  }
  PICKED.clear();
  MINE.clear();
  try {
    await applyState("/api/pot/remove", { items: toItems(items) });
  } catch (e) { toast(e.message, true); return; }
  toast(items.length === 1 ? items[0].model + " taken out" : items.length + " models taken out");
}

// A model added by name, forgotten. It leaves the pot too.
async function forgetAdded(p, id) {
  if (p.models.indexOf(id) >= 0 && !(await ask("Forget " + id + "?", "It leaves your pot too.", "Forget it"))) return;
  if (p.models.indexOf(id) >= 0) await applyState("/api/pot/remove", { items: [{ provider: p.name, model: id }] });
  await applyState("/api/provider/added", { name: p.name, model: id, remove: true });
  toast("forgot " + id);
}

async function forgetAllAdded(p) {
  var inPot = p.models.filter(function (m) { return p.added.indexOf(m) >= 0; });
  var ok = await ask("Forget the " + p.added.length + " model" + (p.added.length === 1 ? "" : "s") + " you added to " + p.name + "?",
    inPot.length ? inPot.length + " of them " + (inPot.length === 1 ? "is" : "are") + " in your pot and will leave it." : "They are only remembered here.",
    "Forget them");
  if (!ok) return;
  if (inPot.length) await applyState("/api/pot/remove", { items: inPot.map(function (m) { return { provider: p.name, model: m }; }) });
  await applyState("/api/provider/added", { name: p.name, all: true });
  toast(p.name + ": the models you added are forgotten");
}

async function setProviderOn(name, on) {
  try {
    await applyState("/api/provider/on", { name: name, on: on });
    toast(on ? name + " is on" : name + " is off: opencc skips its models");
  } catch (e) { toast(e.message, true); }
}

function drawFilters(total, shown) {
  var sel = $("f-prov");
  var want = S.providers.filter(function (p) { return p.models.length && !p.disabled; });
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

// Where this row's abilities come from: models.dev, you, or nobody. With
// nobody there is nothing to go on but a real request, so the cell offers to
// look again and to let you say what the model can do.
function fromCell(t) {
  var d = facts(t.baseUrl, t.model);
  var setup = h("button", { className: "sm", title: "Say what it can do: context window, tool calls, thinking, images, streaming",
    onclick: function () { setupDialog(t); } }, d ? "Edit" : "Set up");

  if (!d) {
    return h("div", { className: "src warn", title: "models.dev doesn't know it: Retry, or set up what it can do" },
      h("span", { className: "msg" }, "not found"),
      h("button", { className: "sm", title: "look it up in models.dev again", onclick: function () { lookUp(t); } }, "Retry"),
      setup);
  }
  return h("div", { className: "src" },
    h("span", { className: "meta", title: d.source === "you"
      ? "Set by you: it is read above what models.dev says"
      : "Context, price and abilities are models.dev's, for this model name" },
      d.source === "you" ? "set by you" : "models.dev"),
    setup);
}

function worksCell(t) {
  var r = TRIES[pk(t.i, t.model)];
  var when = r && r.at ? " \\u00b7 tested " + new Date(r.at).toLocaleTimeString() : "";
  var secs = r && r.ms != null ? " \\u00b7 " + (r.ms / 1000).toFixed(1) + "s" : "";

  var cls = "", text = "not tested", about = "Send it a short message to see that it really answers (your key, access to it, its name)";
  if (r && r.going) {
    cls = "going"; text = "testing\\u2026"; about = "Sending it a short message";
  } else if (r && r.ok) {
    cls = "ok"; text = "\\u2713 " + (r.ms / 1000).toFixed(1) + "s";
    about = "works: it answered '" + (r.reply || "") + "'" + secs + when;
  } else if (r) {
    cls = "bad"; text = "\\u2717 " + outcome(r);
    about = "doesn't work: " + (MEANS[outcome(r)] ? MEANS[outcome(r)] + ". " : "") + (r.error || "") + secs + when;
  }

  return h("div", { className: "try " + cls },
    h("span", { className: "msg", title: about }, text),
    h("button", {
      className: "sm", disabled: Boolean(r && r.going),
      title: "Send it a short message to see that it really answers",
      onclick: function () { tryOne(t); },
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
// Kept on the server, with the sort and the folds: the browser's storage
// belongs to an address, and the panel's address changes with its port.
function keepFilter() {
  savePref("filters", FILTER);
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

  return true;
}

// Your models as shown: none of a provider that is switched off. They stay in
// your pot, and come back when it is switched on; but nothing is tested,
// sorted or counted for a provider you have said to skip.
function rows() {
  var out = [];
  S.providers.forEach(function (p) {
    if (p.disabled) return;
    p.models.forEach(function (m) {
      out.push({
        i: p.name, name: p.name, baseUrl: p.baseUrl, model: m,
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
// A plain click sorts by that column and nothing else. Shift-click adds it
// under the ones already there, to break their ties.
//
// It used to always add. With Model sorted A to Z — and every model name is
// unique — clicking Context put it second, where there were no ties left for
// it to break, so the order did not move and the column looked broken.
function clickSort(k, addToIt) {
  var at = null;
  SORT.forEach(function (s) { if (s.key === k) at = s; });

  if (!addToIt && (!at || SORT.length > 1)) {
    // Not sorted by it, or sorted by it among others: make it the only one.
    SORT = [{ key: k, dir: at ? at.dir : firstDir(k) }];
  } else if (!at) {
    SORT = SORT.concat([{ key: k, dir: firstDir(k) }]);
  } else if (at.dir === firstDir(k)) {
    at.dir = at.dir === "up" ? "down" : "up";
  } else {
    SORT = SORT.filter(function (s) { return s !== at; });
  }

  savePref("sorts", SORT);
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
    var owner = provOf(t.i);
    if (!owner || owner.models.indexOf(t.model) < 0) MINE.delete(k);
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
    picked.length ? h("button", { className: "sm", title: "Tick the ones not ticked, untick the ones ticked",
      onclick: function () {
        view.forEach(function (t) {
          var k = pk(t.i, t.model);
          if (MINE.has(k)) MINE.delete(k); else MINE.add(k);
        });
        lastRow = null;
        drawMine();
      } }, "Invert selection") : null,
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
      h("button", {
        type: "button", className: at >= 0 ? "on" : "",
        title: "Sort by " + COLS[k].label.toLowerCase() + ": " + dirText(k, firstDir(k)) +
          ". Click again to reverse it. Shift-click to add it under the sort you have, to break its ties.",
        onclick: function (e) { clickSort(k, e.shiftKey); },
      },
        COLS[k].label + (at >= 0
          ? " " + (SORT[at].dir === "up" ? "\\u2191" : "\\u2193") + (SORT.length > 1 ? at + 1 : "")
          : "")));
  };

  drawOutcomes(view);

  var tbody = h("tbody", {});
  var win = windowed(tbody, {
    count: view.length, height: 38, scroller: window, tag: "tr", cols: 16,
    row: function (n) { return tableRow(view[n], n, view); },
  });

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
      tbody)));
  win.draw(true);
}

// One row of Your models. Built when it scrolls into view, so it reads the
// state as it is then.
function tableRow(t, n, view) {
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

  await removeModels(going, { confirmed: true });
  clearFilters();
}

async function park(t) {
  try {
    await applyState("/api/pot/park", { provider: t.i, model: t.model, parked: !t.parked });
  } catch (e) { toast(e.message, true); }
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
      only: items.map(function (t) { return { provider: t.i, model: t.model }; }),
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

// One model, on its own: it neither waits for a run nor stops one.
async function tryOne(t) {
  var k = pk(t.i, t.model);
  TRIES[k] = { going: true };
  paintCell(t.i, t.model);
  var r;
  try {
    r = await post("/api/try", { provider: t.i, model: t.model });
  } catch (e) {
    r = { ok: false, status: 0, error: e.message, at: Date.now() };
  }
  TRIES[k] = r;
  paintCell(t.i, t.model);
  settleSoon();
}

// A provider changed, so what its models said is stale: the server forgot,
// and so does the page.
function forgetTestsHere() {
  TRIES = {};
  drawMine();
}

// Only the cell that changed, so a run of 500 does not redraw the table 500
// times. The counts above it are worth a full redraw, but only once things
// have settled for a moment.
function paintCell(i, model) {
  var tr = document.querySelector('tr[data-key="' + cssEscape(pk(i, model)) + '"]');
  var cell = tr && tr.querySelector(".try");
  if (cell) cell.replaceWith(worksCell({ i: i, model: model }));
  // Not drawn: it is built fresh from the state when it scrolls into view.
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

// Results come keyed "name|model", which is how the table is keyed.
function gotResult(key, result) {
  var at = key.indexOf("|");
  TRIES[key] = result;
  if (result.at > seenUpTo) seenUpTo = result.at;
  paintCell(key.slice(0, at), key.slice(at + 1));
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
    TRIES[key] = out.results[key];
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
            if (closeDialog) closeDialog();
            await saveSettings({ rank: [] });
            toast("Ranking cleared: the record decides on its own");
          } }, "Clear ranking")
        : null,
      h("button", { onclick: function () { if (closeDialog) closeDialog(); } }, "Cancel"),
      h("button", { className: "primary", onclick: async function () {
        if (closeDialog) closeDialog();
        await saveSettings({ rank: order.map(function (p) { return p.baseUrl; }) });
        toast("Ranking saved");
      } }, "Save ranking")),
  ]);
}

// --- Hello ----------------------------------------------------------------
// Test on a model's row sends it "Hello" from the server and shows exactly
// what was sent (the key masked) and what came back. It is the check for "is
// the name right, does the key reach it", and it is separate from the Works?
// run on Your models, which is quick and records a result.

var helloOf = null;
var hellos = null;

function sendHello(name, model) {
  return post("/api/hello", { provider: name, model: model }).catch(function (e) { return { failed: e.message }; });
}

function helloSaid(r, n) {
  var g = r.received;
  if (r.failed) return "Not sent: " + r.failed;
  if (g.error) return "It didn't answer: " + g.error;
  if (!g.ok) return "The provider refused it (" + g.status + ").";
  if (r.reply) return "It answered: " + (r.reply.length > n ? r.reply.slice(0, n) + "…" : r.reply);
  return "It answered, but with no text in choices[0].message.content.";
}

var answered = function (r) { return Boolean(r && r.received && r.received.ok && r.reply); };

var asJson = function (x) { return typeof x === "string" ? x : JSON.stringify(x, null, 2); };

// had: an answer already had (from Test on the ticked ones): shown, not sent
// again. back: what to show again when this one is closed.
async function hello(name, model, had, back) {
  var me = { name: name, model: model };
  helloOf = me;

  var said = h("p", {}, "Sending \\"Hello\\"…");
  var status = h("span", { className: "tag" });
  var sent = h("pre", { className: "dump" });
  var got = h("pre", { className: "dump" });
  var again = h("button", { type: "button", disabled: true, onclick: function () { hello(name, model, null, back); } }, "Test again");

  openDialog([
    h("h2", {}, name + " · " + model),
    said,
    h("p", { style: "margin-top:12px" }, "Sent"), sent,
    h("p", { style: "margin-top:12px" }, "Received ", status), got,
    h("div", { className: "btns" }, again,
      h("button", { className: "primary", type: "button", onclick: function () { if (closeDialog) closeDialog(); } }, "Close")),
  ], { wide: true, onClose: function () {
    if (helloOf === me) helloOf = null;
    if (back) back();
  } });

  var r = had || await sendHello(name, model);
  if (helloOf !== me) return;   // another one asked meanwhile
  again.disabled = false;
  if (r.failed) { said.textContent = "Not sent: " + r.failed; return; }

  var s = r.sent, g = r.received;
  sent.textContent = s.method + " " + s.url + "\\n" +
    Object.keys(s.headers).map(function (k) { return k + ": " + s.headers[k]; }).join("\\n") + "\\n\\n" + asJson(s.body);
  got.textContent = g.error ? g.error
    : (g.type ? "content-type: " + g.type + "\\n\\n" : "") + (asJson(g.body) || "(empty)");
  status.textContent = g.error ? "no answer" : g.status + " · " + g.ms + " ms";
  status.className = "tag " + (g.ok ? "ok" : "bad");
  said.textContent = helloSaid(r, 200);
}

// Test on the ticked models: "Hello" to each, a provider's one after another
// (its rate limit) and the providers at once. Each row says what came back;
// clicked, it shows what was sent and received. Closing the dialog stops the
// ones not sent yet.
async function helloAll(list) {
  var run = (hellos = { list: list.map(function (t) { return { i: t.i, model: t.model, r: null }; }) });
  showHellos(run);

  var by = {};
  run.list.forEach(function (t) { (by[t.i] = by[t.i] || []).push(t); });
  await Promise.all(Object.keys(by).map(async function (name) {
    for (var n = 0; n < by[name].length; n++) {
      if (run !== hellos) return;
      var t = by[name][n];
      t.r = await sendHello(t.i, t.model);
      if (run.draw) run.draw();
    }
  }));
}

function showHellos(run) {
  var said = h("p", {});
  var listEl = h("div", { className: "hellos" });
  var ok = h("button", { type: "button", disabled: true, onclick: function () {
    PICKED.clear();
    run.list.forEach(function (t) { if (answered(t.r)) PICKED.add(pk(t.i, t.model)); });
    if (closeDialog) closeDialog();
    drawProviders();
  } }, "Tick the ones that answered");

  run.draw = function () {
    if (run !== hellos) return;
    var done = run.list.filter(function (t) { return t.r; });
    var good = done.filter(function (t) { return answered(t.r); }).length;
    said.textContent = done.length + " of " + run.list.length + " done" +
      (done.length ? " · " + good + " answered, " + (done.length - good) + " didn't" : "") +
      (done.length < run.list.length ? " · sending…" : "");
    ok.disabled = !good;
    put(listEl, run.list.map(function (t) {
      return h("button", {
        type: "button", className: !t.r ? "" : answered(t.r) ? "ok" : "bad", disabled: !t.r,
        title: t.r ? "see what was sent and what came back" : "not answered yet",
        onclick: function () { hello(t.i, t.model, t.r, function () { if (hellos === run) showHellos(run); }); },
      }, h("span", { className: "id" }, t.i + "/" + t.model),
         h("span", { className: "said" }, t.r ? helloSaid(t.r, 120) : "waiting…"));
    }));
  };

  openDialog([
    h("h2", {}, "Hello to " + run.list.length + " model" + (run.list.length === 1 ? "" : "s")),
    said, listEl,
    h("div", { className: "btns" }, ok,
      h("button", { className: "primary", type: "button", onclick: function () { if (closeDialog) closeDialog(); } }, "Close")),
  ], { wide: true, onClose: function () { if (hellos === run && !helloOf) hellos = null; } });
  run.draw();
}

// --- a model's setup ------------------------------------------------------
// Its context window and what it can do, saved above what models.dev says.
// For a model models.dev does not know, or to correct one it gets wrong for
// how you reach it: a gateway that strips tool calling, a local build with a
// smaller window.

function setupDialog(t, measuredTokens) {
  var p = provOf(t.i);
  if (!p) return;
  var d = facts(p.baseUrl, t.model);
  var set = (d && d.set) || {};

  var from = d
    ? (d.source === "you" ? "Set by you." : "From models.dev. Change anything that isn't right for how you reach it.")
    : "models.dev doesn't know this model, so nothing is known about what it can do. Say what it can here: it shows in the table and decides what is sent where.";

  var context = h("input", {
    type: "number", min: "512", step: "1", value: measuredTokens || set.context || "",
    placeholder: d && d.context ? d.context.toLocaleString() : "tokens",
  });
  var box = function (checked) { return h("input", { type: "checkbox", checked: checked }); };
  var tools = box(set.tools !== undefined ? set.tools : d ? d.tools !== false : true);
  var thinking = box(set.thinking !== undefined ? set.thinking : Boolean(d && d.reasoning));
  var images = box(set.images !== undefined ? set.images : Boolean(d && d.vision));
  var stream = box(set.stream !== false);
  var err = h("p", { className: "err" });

  var measure = h("button", { type: "button", onclick: async function () {
    var ok = await ask(
      "Measure " + t.model + "'s context window?",
      "opencc sends it one request of about 2.2 million tokens (4 MB). Servers refuse it with their limit in the error, and a refused request isn't charged. If a server does take that much, it's stopped at once, but that request may be charged.",
      "Measure it");
    if (!ok) { setupDialog(t, Number(context.value) || undefined); return; }
    setupDialog(t, Number(context.value) || undefined);
    var again = document.querySelector("#dialog button[data-measure]");
    if (again) { again.disabled = true; again.textContent = "measuring…"; }
    try {
      var r = await post("/api/measure", { provider: t.i, model: t.model });
      var tokens = r.measured.limit || r.measured.over;
      toast(r.measured.limit
        ? t.model + ": " + r.measured.limit.toLocaleString() + " tokens, said by the server"
        : t.model + " took over " + r.measured.over.toLocaleString() + " tokens");
      setupDialog(t, tokens);
    } catch (e) {
      toast(e.message, true);
      if (again) { again.disabled = false; again.textContent = "Measure"; }
    }
  } }, "Measure");
  measure.setAttribute("data-measure", "1");

  var row = function (label, el, hint) {
    return h("label", { className: "chk", style: "margin:10px 0 0;text-transform:none;letter-spacing:0;font-size:13px;color:var(--ink-2)" },
      el, " ", label, hint ? h("span", { className: "muted" }, " — " + hint) : null);
  };

  openDialog([
    h("h2", {}, t.model),
    h("p", {}, from),
    h("div", { className: "fld" },
      h("label", {}, "Context window ", h("span", { className: "hint" }, "tokens; empty: as found")),
      h("div", { style: "display:flex;gap:8px" }, context, measure)),
    row("Calls tools", tools, "reading and editing files"),
    row("Thinks", thinking),
    row("Reads images", images, "pasted screenshots"),
    row("Streams its replies", stream, "off if its streaming is unreliable"),
    err,
    h("div", { className: "btns" },
      d && d.source === "you" ? h("button", { className: "left", type: "button", onclick: async function () {
        try {
          await post("/api/model-setup/forget", { provider: t.i, model: t.model });
          await loadCatalog();
          if (closeDialog) closeDialog();
          drawAll();
          toast(t.model + ": back to what models.dev says");
        } catch (e) { err.textContent = e.message; }
      } }, "Back to models.dev") : null,
      h("button", { type: "button", onclick: function () { if (closeDialog) closeDialog(); } }, "Cancel"),
      h("button", { className: "primary", type: "button", onclick: async function () {
        var raw = context.value.trim();
        try {
          await post("/api/model-setup", {
            provider: t.i, model: t.model, context: raw ? Number(raw) : null,
            tools: tools.checked, thinking: thinking.checked, images: images.checked, stream: stream.checked,
          });
          await loadCatalog();
          if (closeDialog) closeDialog();
          drawAll();
          toast(t.model + ": saved");
        } catch (e) { err.textContent = e.message; }
      } }, "Save")),
  ]);
}

// models.dev again, for one model (its Retry): the list fetched anew, then
// whether it knows this one now.
async function lookUp(t) {
  var b = $("catalog");
  b.disabled = true;
  try {
    var out = await post("/api/catalog/refresh");
    await loadCatalog();
    drawAll();
    var p = provOf(t.i);
    var found = p && facts(p.baseUrl, t.model);
    toast(out.error ? "models.dev: " + out.error
      : found ? t.model + ": found in models.dev" : t.model + ": still not in models.dev", Boolean(out.error));
  } catch (e) {
    toast("Could not reach models.dev: " + e.message, true);
  } finally {
    b.disabled = false;
    drawCatalogButton();
  }
}

// --- provider form --------------------------------------------------------

// The services most people start with. A click fills the address and, when
// the name is empty or another preset's, the name too, then goes to the key.
var PRESETS = [
  ["openrouter", "OpenRouter", "https://openrouter.ai/api/v1", "hundreds of models"],
  ["groq", "Groq", "https://api.groq.com/openai/v1", "very fast"],
  ["openai", "OpenAI", "https://api.openai.com/v1", "GPT models"],
  ["gemini", "Gemini", "https://generativelanguage.googleapis.com/v1beta/openai", "Google"],
  ["mistral", "Mistral", "https://api.mistral.ai/v1", "Mistral, Codestral"],
  ["deepseek", "DeepSeek", "https://api.deepseek.com/v1", "DeepSeek models"],
  ["together", "Together", "https://api.together.xyz/v1", "open models"],
  ["ollama", "Ollama", "http://localhost:11434/v1", "on this machine"],
  ["lmstudio", "LM Studio", "http://localhost:1234/v1", "on this machine"],
];

// What a name will be saved as, shown as you type: lower case, letters,
// digits, dashes and underscores.
function cleanName(v) {
  return String(v || "").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
}

function providerForm(p) {
  var name = h("input", { type: "text", value: p ? p.name : "", placeholder: "openrouter", autocomplete: "off" });
  var url = h("input", { type: "text", value: p ? p.baseUrl : "", placeholder: "https://openrouter.ai/api/v1", autocomplete: "off" });
  // The key is never sent to the page. Empty means keep the one it has.
  var apiKey = h("input", {
    type: "password", value: "", autocomplete: "off",
    placeholder: p && p.key ? "empty: keep the key it has" : "paste it here (none for a server on this machine, like Ollama)",
  });
  var listOn = h("input", { type: "checkbox", checked: p ? p.list : true });
  var saved = h("p", { className: "muted", style: "margin:2px 0 0;font-size:12px" });
  var err = h("p", { className: "err" });
  var presets = h("div", { className: "presets" });

  var showName = function () {
    var c = cleanName(name.value);
    saved.textContent = c && c !== name.value.trim() ? "Saved as " + c : "";
  };
  name.addEventListener("input", showName);

  var drawPresets = function () {
    put(presets, PRESETS.map(function (x) {
      return h("button", {
        type: "button", className: "preset" + (url.value === x[2] ? " on" : ""),
        onclick: function () {
          var names = PRESETS.map(function (y) { return y[0]; });
          if (!p && (!name.value || names.indexOf(name.value) >= 0)) name.value = x[0];
          url.value = x[2];
          drawPresets();
          showName();
          apiKey.focus();
        },
      }, h("b", {}, x[1]), h("span", {}, x[3]));
    }));
  };
  url.addEventListener("input", drawPresets);
  if (!p) drawPresets();

  var save = async function () {
    var n = cleanName(name.value);
    if (!n) { err.textContent = "A name is needed."; name.focus(); return; }
    if (!url.value.trim()) { err.textContent = "An address is needed."; url.focus(); return; }
    err.textContent = "";
    try {
      var out = await post("/api/provider", {
        name: name.value, baseUrl: url.value, apiKey: apiKey.value.trim(),
        keepKey: Boolean(p && p.key && !apiKey.value.trim()), was: p ? p.name : undefined,
      });
      S = out;
      // Its list switch is its own request: it also asks for the list again.
      if (p && listOn.checked !== p.list) await applyState("/api/provider/list", { name: out.saved, on: listOn.checked });
      if (p) delete LISTS[p.name];
      delete LISTS[out.saved];
      if (closeDialog) closeDialog();
      forgetTestsHere();
      drawAll();
      loadList(out.saved, true);   // a new one, or a new address or key: its models, again
      toast(p ? "saved " + out.saved : "added " + out.saved + ": its models are loading");
      if (!p) { location.hash = "#providers"; showPage(); }
      var card = document.querySelector('.prov[data-provider="' + cssEscape(out.saved) + '"]');
      if (card) card.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (e) {
      err.textContent = e.message;
    }
  };

  var onEnter = function (e) { if (e.key === "Enter") { e.preventDefault(); save(); } };
  [name, url, apiKey].forEach(function (el) { el.addEventListener("keydown", onEnter); });

  var more = null;
  if (p) {
    more = h("div", { className: "fld" },
      h("label", { className: "chk", style: "margin-top:14px;text-transform:none;letter-spacing:0;font-size:13px;color:var(--ink-2)" }, listOn,
        " Ask it for its model list"),
      h("p", { className: "muted", style: "margin:2px 0 0;font-size:12px" },
        "Off for a provider with thousands of models, or none to list. Only the ones you add by name show."),
      p.added.length ? h("div", { style: "display:flex;gap:10px;align-items:center;margin-top:10px" },
        h("span", { className: "muted", style: "font-size:13px" },
          p.added.length + " model" + (p.added.length === 1 ? "" : "s") + " you added by name"),
        h("button", { className: "sm danger", type: "button",
          onclick: function () { if (closeDialog) closeDialog(); forgetAllAdded(p); } }, "Forget them")) : null);
  }

  openDialog([
    h("h2", {}, p ? "Edit " + p.name : "Add a provider"),
    p ? null : h("p", {}, "Pick a service, or type an address. Its models load once you add it."),
    p ? null : presets,
    h("div", { className: "fld" }, h("label", {}, "Name"), name, saved),
    h("div", { className: "fld" }, h("label", {}, "Address"), url),
    h("div", { className: "fld" },
      h("label", {}, "API key ", h("span", { className: "hint" }, p && p.key ? "(now " + p.key + ")" : "blank if the backend needs none")),
      apiKey),
    more,
    err,
    h("div", { className: "btns" },
      p ? h("button", { className: "danger left", type: "button", onclick: async function () {
        var ok = await ask("Delete the provider \\"" + p.name + "\\"?", "Its models leave your pot too, and its key goes with it.", "Delete it");
        if (!ok) return;
        try {
          await applyState("/api/provider/delete", { name: p.name });
          delete LISTS[p.name];
          forgetTestsHere();
          drawAll();
          toast("deleted " + p.name);
        } catch (e) { toast(e.message, true); }
      } }, "Delete") : null,
      h("button", { type: "button", onclick: function () { if (closeDialog) closeDialog(); } }, "Cancel"),
      h("button", { className: "primary", type: "button", onclick: save }, p ? "Save changes" : "Add provider")),
  ]);
  (p ? url : name).focus();
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
    if (what === "testsforgotten") {
      forgetTestsHere();
      return;
    }
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
  await saveSettings({ streaming: !S.streaming });
  toast("Streaming " + (S.streaming ? "on" : "off"));
});
$("port").addEventListener("change", async function () {
  await saveSettings({ port: $("port").value || "3000" });
  toast("Saved. The proxy uses it next time you start opencc.");
});
$("ttl").addEventListener("change", async function () {
  // Clamped here as well as on the server, so the box shows what was
  // actually kept rather than what was typed.
  var n = Math.min(300, Math.max(1, Math.round(Number($("ttl").value) || 10)));
  $("ttl").value = n;
  await saveSettings({ testTimeout: n });
  toast("Tests give up after " + n + "s");
});
$("lanes").addEventListener("change", async function () {
  var n = Math.min(16, Math.max(1, Math.round(Number($("lanes").value) || 4)));
  $("lanes").value = n;
  await saveSettings({ testLanes: n });
  toast(n === 1 ? "One model at a time per provider" : n + " at a time per provider");
});
$("catalog").addEventListener("click", refreshCatalog);
$("add-prov").addEventListener("click", function () { providerForm(); });
$("go-prov").addEventListener("click", function () { location.hash = "#providers"; showPage(); });
$("q").addEventListener("input", function (e) { query = e.target.value; searchOpen = true; drawProviders(); });
$("free").addEventListener("change", function (e) { freeOnly = e.target.checked; savePref("freeOnly", freeOnly); drawProviders(); });
$("sort").addEventListener("change", function (e) { catSort = e.target.value; savePref("catSort", catSort); drawProviders(); });
$("go-models").addEventListener("click", function () { location.hash = "#models"; showPage(); });
// models.dev fetched again, then every listed provider's models with it
$("dev-all").addEventListener("click", async function () {
  await refreshCatalog();
  S.providers.filter(function (p) { return p.list; }).forEach(function (p) { loadList(p.name, true); });
});
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
  settleFolds();
  if (allFolded()) SHUT.clear(); else S.providers.forEach(function (p) { SHUT.add(p.name); });
  keepFolds();
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

// What the page chose last time, from the server.
function applyPrefs() {
  var pr = S.prefs || {};
  if (Array.isArray(pr.sorts)) SORT = pr.sorts.filter(function (x) { return x && COLS[x.key]; });
  if (pr.filters) {
    Object.keys(BLANK_FILTER).forEach(function (k) {
      if (typeof pr.filters[k] === "string") FILTER[k] = pr.filters[k];
    });
  }
  if (Array.isArray(pr.folded)) pr.folded.forEach(function (n) { SHUT.add(n); });
  if (pr.catSort === "name" || pr.catSort === "price") { catSort = pr.catSort; $("sort").value = catSort; }
  if (typeof pr.freeOnly === "boolean") { freeOnly = pr.freeOnly; $("free").checked = freeOnly; }
}

(async function () {
  try {
    await loadState();
  } catch (e) {
    put($("mt"), h("div", { className: "card" }, h("div", { className: "empty" }, "Could not load the config: " + e.message)));
    return;
  }
  applyPrefs();
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
