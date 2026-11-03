// Who may reach the panel. It edits your providers and holds routes to your
// keys, so it answers this machine as it always has, and other devices on your
// network only when you switch that on, and then only with its key.
//
// Whatever the client, a request must name this machine in its Host header
// (a web page that points its own name at 127.0.0.1 gets one that does not),
// and a request a web page made from elsewhere (an Origin that is not the
// panel's own) is refused.
import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { hostname, networkInterfaces } from "node:os";
import { PANEL_KEY_PATH, GLOBAL_CONFIG_DIR } from "./paths.js";

let key = null;
export function panelKey() {
  if (key) return key;
  try {
    key = readFileSync(PANEL_KEY_PATH, "utf8").trim();
  } catch {
    key = "";
  }
  if (!/^[a-f0-9]{32}$/.test(key)) {
    key = randomBytes(16).toString("hex");
    try {
      mkdirSync(GLOBAL_CONFIG_DIR, { recursive: true });
      writeFileSync(PANEL_KEY_PATH, key + "\n", { mode: 0o600 });
    } catch {
      // Kept in memory for this run.
    }
  }
  return key;
}
export const dropKeyCache = () => {
  key = null;
};

const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1"]);

// The addresses this machine answers to, from the network cards.
export function selfAddresses() {
  const out = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) if (!a.internal) out.push(a.address);
  }
  return out;
}

const bare = (host) => String(host ?? "").toLowerCase().replace(/:\d+$/, "").replace(/^\[|\]$/g, "");

export function isLoopbackAddress(addr) {
  const a = String(addr ?? "").replace(/^::ffff:/, "");
  return a === "::1" || a.startsWith("127.");
}

// A client address on a private network (or link-local): the only ones a
// device on your own network can have.
export function isPrivateAddress(addr) {
  const a = String(addr ?? "").replace(/^::ffff:/, "").toLowerCase();
  if (isLoopbackAddress(a)) return true;
  if (/^10\./.test(a) || /^192\.168\./.test(a) || /^169\.254\./.test(a)) return true;
  const m = /^172\.(\d+)\./.exec(a);
  if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return true;
  return /^f[cd][0-9a-f]{2}:/.test(a) || /^fe[89ab][0-9a-f]:/.test(a);
}

const cookieOf = (req, name) => {
  for (const part of String(req.headers.cookie ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return "";
};

const same = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};

// { ok: true } | { ok: true, cookie, redirect } | { ok: false, status, message }.
// remote: whether other devices are allowed (the setting).
export function authorize(req, url, { remote = false, hosts } = {}) {
  const names = hosts ?? new Set([...LOOPBACK, ...selfAddresses(), hostname().toLowerCase(), `${hostname().toLowerCase()}.local`]);
  const host = bare(req.headers.host);
  if (!names.has(host)) return { ok: false, status: 421, message: "This is not an address of this machine." };

  // A page on another site asking this one to act: its Origin is not ours.
  const origin = req.headers.origin;
  if (origin && origin !== "null") {
    let theirs = "";
    try { theirs = new URL(origin).host.toLowerCase(); } catch { /* refused below */ }
    if (theirs !== String(req.headers.host ?? "").toLowerCase()) return { ok: false, status: 403, message: "Refused: a request from another site." };
  } else if (origin === "null") {
    return { ok: false, status: 403, message: "Refused: a request from another site." };
  }

  const from = req.socket.remoteAddress;
  if (isLoopbackAddress(from) && LOOPBACK.has(host)) return { ok: true };

  if (!remote) {
    return { ok: false, status: 403, message: "The panel answers this machine only. Switch on \"Panel from other devices\" on this machine to open it from another." };
  }
  if (!isPrivateAddress(from)) return { ok: false, status: 403, message: "The panel answers devices on your own network only." };

  const offered = url.searchParams.get("t") || req.headers["x-opencc-key"] || cookieOf(req, "opencc_key");
  if (!offered || !same(offered, panelKey())) {
    return { ok: false, status: 401, message: "Open the link opencc printed on the machine it runs on: it has the key in it." };
  }
  if (url.searchParams.get("t") && req.method === "GET") {
    const clean = new URL(url);
    clean.searchParams.delete("t");
    return {
      ok: true,
      cookie: `opencc_key=${panelKey()}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000`,
      redirect: clean.pathname + clean.search,
    };
  }
  return { ok: true };
}

// The links for opening the panel: this machine, and from other devices.
export function panelLinks(port) {
  return {
    local: `http://localhost:${port}`,
    network: selfAddresses().filter((a) => !a.includes(":")).map((a) => `http://${a}:${port}/?t=${panelKey()}`),
  };
}
