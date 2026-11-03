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

// What each provider's /v1/models returned: the names, and what the list
// says about them (context, price, owner), kept so the lists survive a
// reload and a restart. Asked for again when the list is switched on or off,
// when the provider's address or key changes, or when you press Refresh.
export const LISTS_PATH = join(GLOBAL_CONFIG_DIR, "model-lists.json");

// Where this used to be kept, keyed by address. Removed on start.
export const OLD_LISTS_PATH = join(GLOBAL_CONFIG_DIR, "catalogues.json");

// Where test results used to be kept. They are not any more: a result is
// what is true right now, and one from an hour ago sitting beside one from
// this second reads as a single set of numbers when it is two. The panel
// removes this on start so an older version's file does not linger.
export const TESTS_PATH = join(GLOBAL_CONFIG_DIR, "model-tests.json");

// What you have said about a model that models.dev gets wrong or does not
// know: its context window, and whether it calls tools, thinks, reads images
// and streams. Yours, so it is kept, and it is read above what models.dev
// says.
export const SETUP_PATH = join(GLOBAL_CONFIG_DIR, "model-setup.json");

// The page's own choices: sorts, folded providers, filters. Kept here rather
// than in the browser, whose storage belongs to an address, and the panel's
// address changes whenever its port does.
export const PREFS_PATH = join(GLOBAL_CONFIG_DIR, "settings-page.json");

// LMArena's public rankings (coding, web apps, vision…), fetched once a week
// and used to tilt the draw toward models people rate higher.
export const RANKINGS_PATH = join(GLOBAL_CONFIG_DIR, "rankings.json");

// What opencc has learned about how each provider's model behaves: parts of a
// request it refuses, the window it really takes. Learned by asking, kept for
// a day, then learned again if it still holds.
export const LEARNED_PATH = join(GLOBAL_CONFIG_DIR, "model-learned.json");

// Tokens and money spent per model.
export const USAGE_PATH = join(GLOBAL_CONFIG_DIR, "usage.json");

// The panel's key, for reaching it from another device.
export const PANEL_KEY_PATH = join(GLOBAL_CONFIG_DIR, "panel-key");

// The latest version npm has, asked once per start.
export const UPDATE_PATH = join(GLOBAL_CONFIG_DIR, "update-check.json");

// Full requests and replies, one file each, when the log is set to keep them.
export const DETAIL_DIR = join(GLOBAL_CONFIG_DIR, "request-detail");
