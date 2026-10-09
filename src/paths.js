import { homedir } from "node:os";
import { join } from "node:path";

// Used when opencc is installed globally and run from outside any project
// folder, where there's no local .env to read. `opencc init` writes here.
export const GLOBAL_CONFIG_DIR = join(homedir(), ".opencc");
export const GLOBAL_CONFIG_PATH = join(GLOBAL_CONFIG_DIR, ".env");

// Capabilities are derived data with a cache, not settings you'd hand-write,
// so they live beside the config rather than inside it — which also keeps the
// .env readable by older versions.
export const CAPABILITIES_PATH = join(GLOBAL_CONFIG_DIR, "capabilities.json");
