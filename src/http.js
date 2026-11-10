// fetch, over node:http and node:https (HTTP/1.1) instead of Node's built-in fetch.
// The built-in one speaks HTTP/2 when a server offers it, and HTTP/2 puts every request to a host on
// one connection. When that connection dies without a word (the server or a router drops it, no FIN
// arrives), Node keeps it as open, every later request waits on it, and none is ever sent: a
// session whose providers all sit behind one proxy host had every model "not answering" for hours
// while the host answered curl at once. Here each request has a socket of its own (idle ones reused
// for a few seconds at most, Node's keep-alive agent), and a request that's stopped (Esc, a timeout)
// takes its socket with it, so a dead connection can't outlive the request that found it.
// Same shape as fetch: a standard Response, the signal's reason when stopped, a TypeError with
// cause (the code: ECONNREFUSED, ENOTFOUND…) when the server can't be reached.
import http from 'node:http'
import https from 'node:https'
import zlib from 'node:zlib'
import { Readable } from 'node:stream'

// each decoder flushing what it has as it comes (a streamed answer arrives piece by piece)
const Z = { flush: zlib.constants.Z_SYNC_FLUSH, finishFlush: zlib.constants.Z_SYNC_FLUSH }
const BR = { flush: zlib.constants.BROTLI_OPERATION_FLUSH, finishFlush: zlib.constants.BROTLI_OPERATION_FLUSH }
const DECODE = { gzip: () => zlib.createGunzip(Z), 'x-gzip': () => zlib.createGunzip(Z), deflate: () => zlib.createInflate(Z), br: () => zlib.createBrotliDecompress(BR), ...(zlib.createZstdDecompress && { zstd: () => zlib.createZstdDecompress() }) }
const ACCEPT = Object.keys(DECODE).filter((k) => k !== 'x-gzip').join(', ')
const NO_BODY = new Set([101, 103, 204, 205, 304])

// A test that stubs globalThis.fetch (opencc's own tests do) is still honoured: the replaced one is used.
const builtin = globalThis.fetch

export async function fetch(input, init = {}) {
  if (globalThis.fetch !== builtin) return globalThis.fetch(input, init)
  const { signal, redirect = 'follow' } = init
  // the body and headers as fetch would send them (a string, JSON, form data, URLSearchParams, a Blob…)
  const asked = new Request(input, { method: init.method, headers: init.headers, body: init.body, duplex: 'half' })
  let url = new URL(asked.url)
  let method = asked.method
  const headers = Object.fromEntries(asked.headers)
  headers['accept-encoding'] ??= ACCEPT
  let body = asked.body ? Buffer.from(await asked.arrayBuffer()) : null
  for (let hops = 0; ; hops++) {
    signal?.throwIfAborted()
    const res = await send(url, method, body ? { ...headers, 'content-length': String(body.length) } : headers, body, signal)
    const to = res.headers.location
    if (redirect === 'manual' || ![301, 302, 303, 307, 308].includes(res.statusCode) || !to) return respond(res, url, hops > 0, signal)
    res.resume() // a redirect's own body isn't read
    if (redirect === 'error') throw new TypeError('fetch failed', { cause: new Error(`redirected to ${to}`) })
    if (hops >= 20) throw new TypeError('fetch failed', { cause: new Error('too many redirects') })
    const next = new URL(to, url)
    // 303, and 301/302 after a POST: the next one is a GET, without the body (as fetch does)
    if (res.statusCode === 303 || ([301, 302].includes(res.statusCode) && method === 'POST')) {
      if (method !== 'HEAD') method = 'GET'
      body = null
      for (const h of ['content-type', 'content-length']) delete headers[h]
    }
    if (next.origin !== url.origin) delete headers.authorization // a key isn't handed to another site
    url = next
  }
}

// One request; resolves with the response once its headers are in.
function send(url, method, headers, body, signal) {
  return new Promise((resolve, reject) => {
    const req = (url.protocol === 'https:' ? https : http).request(url, { method, headers })
    const stop = () => req.destroy(signal.reason)
    signal?.addEventListener('abort', stop, { once: true })
    req.on('response', (res) => {
      // stopped later (while the body streams): the body ends with the reason, and the socket goes too
      res.once('close', () => signal?.removeEventListener('abort', stop))
      resolve(res)
    })
    req.on('error', (e) => {
      signal?.removeEventListener('abort', stop)
      reject(signal?.aborted ? signal.reason : new TypeError('fetch failed', { cause: e }))
    })
    req.end(body ?? undefined)
  })
}

function respond(res, url, redirected, signal) {
  const headers = new Headers()
  for (let i = 0; i < res.rawHeaders.length; i += 2) headers.append(res.rawHeaders[i], res.rawHeaders[i + 1])
  let body = null
  if (NO_BODY.has(res.statusCode) || res.req?.method === 'HEAD') res.resume()
  else {
    let stream = res
    const decode = DECODE[String(res.headers['content-encoding'] ?? '').trim().toLowerCase()]
    if (decode) {
      stream = decode()
      res.on('error', (e) => stream.destroy(e))
      res.pipe(stream)
    }
    stream.on('error', () => {}) // reported through the body (below), not as a crash
    // the body errors with the signal's reason when stopped (as fetch's does), else with a TypeError
    const reason = (e) => (signal?.aborted ? signal.reason : new TypeError('terminated', { cause: e }))
    const reader = Readable.toWeb(stream).getReader()
    body = new ReadableStream({
      pull: (c) => reader.read().then(({ done, value }) => (done ? c.close() : c.enqueue(new Uint8Array(value))), (e) => c.error(reason(e))),
      cancel: (why) => (res.destroy(), reader.cancel(why).catch(() => {})),
    })
  }
  const r = new Response(body, { status: res.statusCode, statusText: res.statusMessage, headers })
  Object.defineProperties(r, { url: { value: url.href }, redirected: { value: redirected } })
  return r
}
