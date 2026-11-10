// The HTTP/1.1 client every request to a provider goes through (http.js),
// against a real server on this machine.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import zlib from "node:zlib";
import { fetch } from "./http.js";

async function serve(t, handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  return `http://127.0.0.1:${server.address().port}`;
}

test("a POST goes out with its body and comes back as a Response", async (t) => {
  const base = await serve(t, (req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      res.writeHead(201, { "content-type": "application/json", "x-seen": req.headers.authorization });
      res.end(JSON.stringify({ got: JSON.parse(body), len: req.headers["content-length"] }));
    });
  });
  const res = await fetch(`${base}/a`, { method: "POST", headers: { authorization: "Bearer k", "content-type": "application/json" }, body: JSON.stringify({ x: 1 }) });
  assert.equal(res.status, 201);
  assert.equal(res.ok, true);
  assert.equal(res.headers.get("x-seen"), "Bearer k");
  assert.deepEqual(await res.json(), { got: { x: 1 }, len: "7" });
});

test("a compressed answer is read, and an error status is passed on", async (t) => {
  const base = await serve(t, (req, res) => {
    if (req.url === "/gz") {
      res.writeHead(200, { "content-encoding": "gzip" });
      return res.end(zlib.gzipSync("zipped words"));
    }
    res.writeHead(429, { "retry-after": "7" });
    res.end("slow down");
  });
  assert.equal(await (await fetch(`${base}/gz`)).text(), "zipped words");
  const busy = await fetch(`${base}/busy`);
  assert.equal(busy.status, 429);
  assert.equal(busy.headers.get("retry-after"), "7");
  assert.equal(await busy.text(), "slow down");
});

test("a stream arrives piece by piece, not all at the end", async (t) => {
  const base = await serve(t, (req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write("data: one\n\n");
    setTimeout(() => { res.write("data: two\n\n"); res.end(); }, 150);
  });
  const res = await fetch(base);
  const reader = res.body.getReader();
  const t0 = Date.now();
  const first = new TextDecoder().decode((await reader.read()).value);
  assert.match(first, /one/);
  assert.ok(Date.now() - t0 < 120, "the first piece did not wait for the last");
  assert.match(new TextDecoder().decode((await reader.read()).value), /two/);
});

test("a redirect is followed, and a key is not handed to another site", async (t) => {
  const other = await serve(t, (req, res) => res.end(`other saw ${req.headers.authorization ?? "no key"}`));
  const base = await serve(t, (req, res) => {
    if (req.url === "/same") return res.end(`same saw ${req.headers.authorization}`);
    res.writeHead(302, { location: req.url === "/in" ? "/same" : `${other}/x` });
    res.end();
  });
  const headers = { authorization: "Bearer k" };
  assert.equal(await (await fetch(`${base}/in`, { headers })).text(), "same saw Bearer k");
  assert.equal(await (await fetch(`${base}/out`, { headers })).text(), "other saw no key");
});

test("a request that is stopped takes its connection with it", async (t) => {
  let closed = false;
  const base = await serve(t, (req, res) => {
    res.writeHead(200);
    res.write("started");
    res.on("close", () => (closed = true));
  });
  const stop = new AbortController();
  const res = await fetch(base, { signal: stop.signal });
  const reader = res.body.getReader();
  await reader.read();
  stop.abort(new Error("enough"));
  await assert.rejects(reader.read(), /enough/);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(closed, true, "the server saw the connection go");
  await assert.rejects(fetch(base, { signal: AbortSignal.timeout(30) }).then((r) => r.text()), (e) => e.name === "TimeoutError");
});

test("a server that cannot be reached is a 'fetch failed' with the code in cause", async () => {
  await assert.rejects(fetch("http://127.0.0.1:1/"), (e) => e instanceof TypeError && e.message === "fetch failed" && e.cause?.code === "ECONNREFUSED");
});
