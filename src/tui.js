// A tiny arrow-key menu and line prompt built on node:readline's keypress
// events. No dependencies — just raw mode plus a handful of ANSI codes.
import { emitKeypressEvents } from "node:readline";

const CSI = "\x1b[";
export const dim = (s) => `${CSI}2m${s}${CSI}22m`;
export const bold = (s) => `${CSI}1m${s}${CSI}22m`;
export const cyan = (s) => `${CSI}36m${s}${CSI}39m`;
export const red = (s) => `${CSI}31m${s}${CSI}39m`;
export const green = (s) => `${CSI}32m${s}${CSI}39m`;

const ANSI = /\x1b\[[0-9;]*m/g;

// Color is the only styling used, so a line's printed width is just its
// length with the escape sequences removed. Padding has to measure that way
// too, or a colored label throws every column after it out of line.
const visible = (s) => s.replace(ANSI, "").length;
const padVisible = (s, width) => s + " ".repeat(Math.max(0, width - visible(s)));

function fit(line, width) {
  const plain = line.replace(ANSI, "");
  if (plain.length <= width) return line;
  // Styling is dropped on the rare over-long line, rather than tracking
  // where each escape sequence lands inside the truncated text.
  return plain.slice(0, Math.max(0, width - 1)) + "…";
}

// Terminals don't restore themselves if we exit from inside a menu.
let cursorHidden = false;
process.on("exit", () => {
  if (cursorHidden) process.stdout.write(`${CSI}?25h`);
});

// Redraws in place by jumping back over the previous frame, so the screen
// doesn't flicker and whatever was on screen before the menu is preserved.
//
// The frame is shared across menus on purpose: moving between screens, or
// re-opening the same menu after a key changed something, should overwrite
// the list that's already on screen rather than print a second copy below it.
let frameRows = 0;

// Call before printing anything that isn't a frame — that output has to stay
// put, so the next frame starts fresh underneath it instead of eating it.
export function resetFrame() {
  frameRows = 0;
}

function draw(lines) {
  const width = (process.stdout.columns || 80) - 1;
  const out = lines.map((line) => fit(line, width));
  // 0J clears to the end of the screen, so a shorter frame leaves no tail
  // of the taller one behind it.
  process.stdout.write(
    (frameRows ? `${CSI}${frameRows}A` : "") + `${CSI}0J` + out.join("\n") + "\n",
  );
  frameRows = out.length;
}

function listenKeys(onKey) {
  const stdin = process.stdin;
  emitKeypressEvents(stdin);
  // setRawMode only exists on a real terminal; without it this still works
  // when keys are piped in (used by the tests).
  if (stdin.isTTY) stdin.setRawMode(true);
  stdin.resume();
  stdin.on("keypress", onKey);

  return () => {
    stdin.off("keypress", onKey);
    if (stdin.isTTY) stdin.setRawMode(false);
    stdin.pause();
  };
}

// items: [{ label, value, hint, separator, disabled }]
// shortcuts: { "d": "move-down", "space": "toggle", ... } — a keypress that
// matches resolves straight to that action id without moving the cursor there.
// Plain unmodified keys only: terminals disagree about shift+arrow (macOS
// Terminal.app sends the same sequence as a bare arrow), so anything built on
// modifiers silently does nothing for some users.
// Resolves with { id, index, item }: `id` is the matched shortcut, or the
// focused item's `id` when enter was pressed. Undefined if dismissed.
export async function menu({ title, subtitle, items, footer, index = 0, shortcuts = {} }) {
  const canPick = (i) => items[i] && !items[i].separator && !items[i].disabled;
  const labelWidth = Math.max(...items.map((it) => (it.separator ? 0 : visible(it.label))));

  let cursor = canPick(index) ? index : items.findIndex((_, i) => canPick(i));

  function step(delta) {
    for (let i = 1; i <= items.length; i++) {
      const next = (cursor + delta * i + items.length * items.length) % items.length;
      if (canPick(next)) return next;
    }
    return cursor;
  }

  function render() {
    const lines = [""];
    if (title) lines.push(bold(title));
    if (subtitle) lines.push(dim(subtitle));
    if (title || subtitle) lines.push("");

    items.forEach((item, i) => {
      if (item.separator) {
        lines.push(`  ${dim("─".repeat(Math.max(labelWidth + 2, 12)))}`);
        return;
      }
      const selected = i === cursor;
      const label = item.value || item.hint ? padVisible(item.label, labelWidth) : item.label;
      let line = `${selected ? cyan("❯") : " "} ${selected ? bold(label) : label}`;
      if (item.value) line += `  ${item.value}`;
      if (item.hint) line += `  ${dim(item.hint)}`;
      lines.push(item.disabled ? dim(line.replace(ANSI, "")) : line);
      // Detail lines sit under the row and aren't selectable — the cursor
      // still steps item to item.
      for (const extra of item.lines ?? []) lines.push(dim(`    ${extra}`));
    });

    lines.push("");
    lines.push(dim(footer ?? "↑↓ move · enter select · q back"));
    draw(lines);
  }

  process.stdout.write(`${CSI}?25l`);
  cursorHidden = true;
  render();

  return new Promise((resolve) => {
    const stop = listenKeys((_str, key) => {
      if (key.ctrl && key.name === "c") {
        stop();
        process.stdout.write(`${CSI}?25h`);
        cursorHidden = false;
        process.exit(130);
      }

      const finish = (value) => {
        stop();
        process.stdout.write(`${CSI}?25h`);
        cursorHidden = false;
        resolve(value);
      };

      // Shortcuts win over navigation, so a bare letter can't also be a
      // cursor key.
      const shortcut = shortcuts[key.name];
      if (shortcut) {
        finish({ id: shortcut, index: cursor, item: items[cursor] });
        return;
      }

      if (key.name === "up") {
        cursor = step(-1);
        render();
      } else if (key.name === "down") {
        cursor = step(1);
        render();
      } else if (key.name === "return") {
        finish({ id: items[cursor].id ?? cursor, index: cursor, item: items[cursor] });
      } else if (key.name === "escape" || key.name === "q") {
        finish(undefined);
      }
    });
  });
}

// An editable line of text, built on the same raw-mode keypresses as the
// menu rather than readline — readline swallows escape, which left no way to
// back out of a prompt once you were in one.
//
// Resolves with the trimmed text, or null if escape was pressed, so callers
// can tell "cleared it" from "changed my mind".
export async function prompt(label, value = "", hint = "", { keep = false } = {}) {
  // By default the prompt wipes itself when it's done and hands the screen
  // back exactly as it was, so editing one field doesn't push the menu down
  // the terminal. `keep` leaves it visible — wanted in the add wizard, where
  // seeing the answers you've already given is the point.
  const framePreservedRows = frameRows;
  let printed = 0;
  const say = (line) => {
    console.log(line);
    printed++;
  };

  resetFrame();
  say("");
  if (hint) say(dim(`  ${hint}`));
  say(dim(value ? "  enter keeps it · ctrl+u clears · esc cancels" : "  esc cancels"));

  const prefix = `  ${label}: `;
  let text = value;
  let caret = text.length;

  const paint = () => {
    process.stdout.write(`\r${CSI}0K${prefix}${text}`);
    const back = text.length - caret;
    if (back > 0) process.stdout.write(`${CSI}${back}D`);
  };

  process.stdout.write(`${CSI}?25h`);
  cursorHidden = false;
  paint();

  return new Promise((resolve) => {
    const stop = listenKeys((str, key) => {
      const done = (result) => {
        stop();
        if (keep) {
          process.stdout.write("\n");
        } else {
          // Clear the input line, step back over everything printed above it,
          // then clear to the end of the screen and put the frame counter
          // back so the next menu draw overwrites the menu already on screen.
          process.stdout.write(`\r${CSI}0K`);
          if (printed) process.stdout.write(`${CSI}${printed}A${CSI}0J`);
          frameRows = framePreservedRows;
        }
        resolve(result);
      };

      if (key.ctrl && key.name === "c") {
        stop();
        process.stdout.write("\n");
        process.exit(130);
      }
      if (key.name === "escape") return done(null);
      if (key.name === "return" || key.name === "enter") return done(text.trim());

      if (key.name === "backspace") {
        if (caret > 0) {
          text = text.slice(0, caret - 1) + text.slice(caret);
          caret--;
        }
      } else if (key.name === "delete") {
        text = text.slice(0, caret) + text.slice(caret + 1);
      } else if (key.name === "left") {
        if (caret > 0) caret--;
      } else if (key.name === "right") {
        if (caret < text.length) caret++;
      } else if (key.name === "home" || (key.ctrl && key.name === "a")) {
        caret = 0;
      } else if (key.name === "end" || (key.ctrl && key.name === "e")) {
        caret = text.length;
      } else if (key.ctrl && key.name === "u") {
        text = "";
        caret = 0;
      } else if (str && !key.ctrl && !key.meta) {
        // Printable input only — a paste can arrive as one multi-character
        // chunk, so filter rather than assuming a single key.
        const printable = [...str].filter((c) => c >= " " && c !== "\x7f").join("");
        if (!printable) return;
        text = text.slice(0, caret) + printable + text.slice(caret);
        caret += printable.length;
      } else {
        return;
      }

      paint();
    });
  });
}

// Shows an animated line while `task` runs, with elapsed seconds so a slow
// network call doesn't look like a hang. Clears itself when done, leaving the
// caller to print the final result line.
export async function withSpinner(label, task) {
  // Pass a function instead of a string when the text should change as the
  // task runs — it's re-read on every frame.
  const text = typeof label === "function" ? label : () => label;
  resetFrame();

  // Nothing to animate when output isn't a terminal (piped, or a log file).
  // The caller prints the finished line with this same label, so staying
  // quiet here keeps a captured log clean instead of doubling every entry.
  if (!process.stdout.isTTY) return task;

  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  const started = Date.now();
  let i = 0;

  const tick = () => {
    const secs = Math.round((Date.now() - started) / 1000);
    process.stdout.write(
      `\r${CSI}0K  ${cyan(frames[i++ % frames.length])} ${text()} ${dim(`${secs}s`)}`,
    );
  };

  process.stdout.write(`${CSI}?25l`);
  cursorHidden = true;
  tick();
  const timer = setInterval(tick, 80);

  try {
    return await task;
  } finally {
    clearInterval(timer);
    process.stdout.write(`\r${CSI}0K${CSI}?25h`);
    cursorHidden = false;
  }
}

export async function confirm(title, subtitle) {
  const choice = await menu({
    title,
    subtitle,
    items: [
      { id: "no", label: "No, keep it" },
      { id: "yes", label: "Yes" },
    ],
    footer: "↑↓ move · enter confirm · y yes · n/q cancel",
    shortcuts: { y: "yes", n: "no" },
  });
  return choice?.id === "yes";
}

export async function pause(message = "Press any key to continue") {
  resetFrame();
  console.log("");
  console.log(dim(`  ${message}`));
  await new Promise((resolve) => {
    const stop = listenKeys((_str, key) => {
      if (key.ctrl && key.name === "c") process.exit(130);
      stop();
      resolve();
    });
  });
}
