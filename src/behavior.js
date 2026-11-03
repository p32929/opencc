// How the proxy treats a failing or slow model, and what it keeps. Every one
// has a default that is what opencc did before it was a setting, so nothing
// changes until you change it, and a default is never written to the file.
//
//   onFail      what a failure does: "failure" (default) moves on to the next
//               model at once, retrying a server error once; "retries" asks
//               the same model again first, up to `retries` times, when the
//               failure may go away by itself (a rate limit, an outage);
//               "any" moves on at once for everything, retrying nothing.
//   retries     how many tries "retries" gives one model (1 to 20)
//   replyStart  seconds a streamed reply may take to start before it counts
//               as a failure and the next model goes on (5 to 600)
//   keepTrying  when every model fails with something that may pass (a rate
//               limit, an outage), wait and go round again until the
//               deadline, instead of giving Claude Code the error
//   effort      reasoning_effort sent to models: "default" sends nothing,
//               "follow" maps Claude Code's thinking budget, or low, medium,
//               high
//   remote      answer the panel to other devices on your network, with its
//               key (off: this machine only)
//   fit         tilt the draw by public rankings (LMArena) as well as record
//   stay        keep a conversation on the model that answered it (the
//               provider's prompt cache holds)
//   logDetail   "summary" or "full": full also keeps every request and reply
//   logDays     how long full detail is kept
export const DEFAULTS = {
  onFail: "failure",
  retries: 2,
  replyStart: 60,
  keepTrying: false,
  effort: "default",
  remote: false,
  fit: false,
  stay: false,
  logDetail: "summary",
  logDays: 3,
};

const ENV = {
  onFail: "ON_FAIL", retries: "RETRIES", replyStart: "REPLY_START", keepTrying: "KEEP_TRYING", effort: "EFFORT",
  remote: "PANEL_REMOTE", fit: "BEST_FIT", stay: "STAY", logDetail: "LOG_DETAIL", logDays: "LOG_DAYS",
};

const ONFAIL = ["failure", "retries", "any"];
const EFFORTS = ["default", "follow", "low", "medium", "high"];
const DETAILS = ["summary", "full"];

const truthy = (v) => ["on", "true", "1", "yes"].includes(String(v ?? "").trim().toLowerCase());
const whole = (v, lo, hi, fallback) => {
  const text = String(v ?? "").trim();
  if (!text) return fallback;
  const n = Number(text);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : fallback;
};
const oneOf = (v, list, fallback) => (list.includes(String(v ?? "").trim().toLowerCase()) ? String(v).trim().toLowerCase() : fallback);

export function behaviorFromEnv(values = {}) {
  const v = (k) => values[ENV[k]];
  return {
    onFail: oneOf(v("onFail"), ONFAIL, DEFAULTS.onFail),
    retries: whole(v("retries"), 1, 20, DEFAULTS.retries),
    replyStart: whole(v("replyStart"), 5, 600, DEFAULTS.replyStart),
    effort: oneOf(v("effort"), EFFORTS, DEFAULTS.effort),
    keepTrying: truthy(v("keepTrying")),
    remote: truthy(v("remote")),
    fit: truthy(v("fit")),
    stay: truthy(v("stay")),
    logDetail: oneOf(v("logDetail"), DETAILS, DEFAULTS.logDetail),
    logDays: whole(v("logDays"), 1, 3650, DEFAULTS.logDays),
  };
}

// The lines for the file: only what differs from the default.
export function behaviorToEnv(b = {}) {
  const out = [];
  for (const [k, def] of Object.entries(DEFAULTS)) {
    if (b[k] === undefined || b[k] === def) continue;
    out.push(`${ENV[k]}=${typeof b[k] === "boolean" ? (b[k] ? "on" : "off") : b[k]}`);
  }
  return out;
}

// A change from the panel: what was sent, checked. Throws a sentence the page
// can show. Only the keys sent are changed.
export function changeBehavior(current, input = {}) {
  const next = { ...DEFAULTS, ...current };
  const bad = (m) => { throw new Error(m); };
  for (const k of Object.keys(input)) {
    if (!(k in DEFAULTS)) continue;
    const v = input[k];
    if (k === "onFail") ONFAIL.includes(v) ? (next.onFail = v) : bad(`if one fails: ${ONFAIL.join(", ")}`);
    else if (k === "effort") EFFORTS.includes(v) ? (next.effort = v) : bad(`effort: ${EFFORTS.join(", ")}`);
    else if (k === "logDetail") DETAILS.includes(v) ? (next.logDetail = v) : bad(`log detail: ${DETAILS.join(" or ")}`);
    else if (k === "fit" || k === "stay" || k === "keepTrying" || k === "remote") typeof v === "boolean" ? (next[k] = v) : bad(`${k}: on or off`);
    else {
      const range = { retries: [1, 20], replyStart: [5, 600], logDays: [1, 3650] }[k];
      Number.isInteger(v) && v >= range[0] && v <= range[1] ? (next[k] = v) : bad(`${k}: a whole number, ${range[0]} to ${range[1]}`);
    }
  }
  return next;
}

// Claude Code's thinking budget as a reasoning_effort, for effort "follow".
export function effortFor(setting, anthropicReq) {
  if (setting === "default" || !setting) return undefined;
  if (setting !== "follow") return setting;
  const t = anthropicReq?.thinking;
  if (!t || t.type === "disabled") return undefined;
  const budget = Number(t.budget_tokens);
  if (!(budget > 0)) return "medium";
  return budget <= 2048 ? "low" : budget <= 12000 ? "medium" : "high";
}
