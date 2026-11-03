// What kind of failure an upstream answer is.

// An error that may go away by itself: a rate limit, a server error or
// overload, a timeout, no connection (no status). Anything else (a wrong
// model name, key or request) won't. A 403 that is a web page, not the API's
// own answer, comes from a gateway or proxy in front of it, often for a moment
// (seen: the same request working a second later): an outage too.
export const outage = ({ status, page } = {}) =>
  !status || [408, 409, 425, 429].includes(status) || status >= 500 || (status === 403 && Boolean(page));

// The model can't be used as it's set up (a wrong key, no access to it, no
// such model): waiting won't help, but another may work.
export const unusable = (e) => [401, 403, 404].includes(e.status) && !outage(e);

// A gateway answers with a web page: its title says what it is.
export const isPage = (body) => /^\s*</.test(String(body ?? ""));

// How long the provider asked to wait, in ms, from Retry-After (seconds or a
// date), or from the body (Gemini says it there: "retryDelay": "31s"). 0 when
// it said nothing.
export function retryAfterMs(headers, body = "") {
  const h = headers?.get?.("retry-after");
  if (h) {
    const secs = Number(h);
    if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
    const at = Date.parse(h);
    if (Number.isFinite(at)) return Math.max(0, at - Date.now());
  }
  const g = /"retryDelay":\s*"(\d+(?:\.\d+)?)s"/.exec(body)?.[1];
  return g ? Number(g) * 1000 : 0;
}
