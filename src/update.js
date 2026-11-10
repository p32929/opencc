// Is there a newer opencc? Asked of npm once per start, in the background, and
// never in the way: no answer is the same as no news.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { UPDATE_PATH, GLOBAL_CONFIG_DIR } from "./paths.js";
import { fetch } from "./http.js"; // not the built-in one: see http.js

const REGISTRY = "https://registry.npmjs.org/opencc/latest";

// 5.1.0 is newer than 5.0.9, and 5.0.0 than 4.9.9: numbers, not text.
export function newer(latest, current) {
  const a = String(latest).split(".").map((x) => parseInt(x, 10) || 0);
  const b = String(current).split(".").map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
}

export const lastKnown = () => {
  try {
    return JSON.parse(readFileSync(UPDATE_PATH, "utf8"));
  } catch {
    return {};
  }
};

// Asks npm. Resolves to the latest version, or null. `fetchImpl` so a test
// need not reach the network.
export async function checkForUpdate({ fetchImpl = fetch, timeout = 5000 } = {}) {
  if (process.env.OPENCC_NO_UPDATE_CHECK) return null;
  try {
    const res = await fetchImpl(REGISTRY, { signal: AbortSignal.timeout(timeout) });
    if (!res.ok) return null;
    const { version } = await res.json();
    if (!version) return null;
    mkdirSync(GLOBAL_CONFIG_DIR, { recursive: true });
    writeFileSync(UPDATE_PATH, JSON.stringify({ latest: version, at: Date.now() }));
    return version;
  } catch {
    return null;
  }
}

// The newer version, if there is one: what the page and the terminal say.
export const updateFor = (current) => {
  const { latest } = lastKnown();
  return latest && newer(latest, current) ? latest : null;
};
