import { homedir } from "node:os";
import { join } from "node:path";

// Used when opencc is installed globally and run from outside any project
// folder, where there's no local .env to read. `opencc init` writes here.
export const GLOBAL_CONFIG_DIR = join(homedir(), ".opencc");
export const GLOBAL_CONFIG_PATH = join(GLOBAL_CONFIG_DIR, ".env");

// Append-only, one JSON object per line. Newline-delimited rather than one
// JSON document because several opencc processes write it at once: an append
// is a single atomic write, where read-modify-write on a document would lose
// whichever update finished second.
export const STATS_PATH = join(GLOBAL_CONFIG_DIR, "stats.jsonl");

// What models.dev knows about each model: context window, price, and whether
// it calls tools or reads images. Derived and refetchable, so it sits beside
// the config rather than in it, and a stale copy is never fatal.
export const MODELS_DEV_PATH = join(GLOBAL_CONFIG_DIR, "models-dev.json");

// One line per request the proxy served, newest last. Summary only: which
// models were tried, what each answered, which one ended up replying. No
// bodies, no keys, so it stays small enough to keep around.
export const REQUESTS_PATH = join(GLOBAL_CONFIG_DIR, "requests.jsonl");

// What each provider's /v1/models returned, so the model lists survive a
// reload and a restart. Refetched on demand, not on every visit.
export const CATALOGUES_PATH = join(GLOBAL_CONFIG_DIR, "catalogues.json");

// Where test results used to be kept. They are not any more: a result is
// what is true right now, and one from an hour ago sitting beside one from
// this second reads as a single set of numbers when it is two. The panel
// removes this on start so an older version's file does not linger.
export const TESTS_PATH = join(GLOBAL_CONFIG_DIR, "model-tests.json");
