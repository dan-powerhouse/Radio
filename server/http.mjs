// Local HTTP for openMachine (historical v1) or openProcessMachine (explicit v2 reference). Node only.
//
//   GET  /.well-known/logline.json      published keys, limits (cacheable)
//   GET  /head                         current ledger head (not cacheable)
//   GET  /processes                     published processes {id, hash}
//   GET  /processes/:hash               a process (the law is public)
//   POST /processes                     publish a process            (admin)
//   POST /submit                        submit a tuple (I-JSON body) → receipt, detail, reactions, halted
//   GET  /receipts/:id                  the public header             {seq, receipt}
//   GET  /receipts/:id/detail           detail + tuple                (its submitter, or admin)
//   GET  /receipts/:id/bundle           receipt + trajectory, offline-verifiable (its submitter, or admin)
//   GET  /history?<tuning>&after=&limit=  past receipts, paged by seq
//   GET  /radio?<tuning>&after=         the radio as Server-Sent Events; resumes from Last-Event-ID
//   GET  /me                            who the bearer token is, and its on-air pseudonym
//
// <tuning>: frequency, status, by, process_hash (comma lists), activated=true|false; by=me is your pseudonym.
import http from "node:http";
import * as L from "../dist/index.js";

const IMMUTABLE = "public, max-age=31536000, immutable";
const DEFAULTS = { maxBody: 64 * 1024, ratePerMinute: 60, burst: 30, heartbeatMs: 15_000, maxBuffered: 1 << 20 };

class HttpError extends Error { constructor(status, code, message, headers = {}, extra = {}) { super(message); this.status = status; this.code = code; this.headers = headers; this.extra = extra; } }

/** Token bucket per caller (account, or IP when anonymous). */
function limiter({ ratePerMinute, burst }) {
  const buckets = new Map();
  return (who) => {
    const now = Date.now(), rate = ratePerMinute / 60_000;
    const b = buckets.get(who) ?? { tokens: burst, at: now };
    b.tokens = Math.min(burst, b.tokens + (now - b.at) * rate); b.at = now;
    buckets.set(who, b);
    if (b.tokens < 1) return Math.ceil((1 - b.tokens) / rate / 1000);
    b.tokens -= 1;
    if (buckets.size > 10_000) for (const [k, v] of buckets) if (v.tokens >= burst) buckets.delete(k);
    return 0;
  };
}

export function createServer(machine, options = {}) {
  const VERSION = machine.version ?? "1";
  const target = VERSION === "2";
  if (!["1","2"].includes(VERSION)) throw new Error("unsupported reference machine version");
  const o = { ...DEFAULTS, ...(target ? { maxBody: L.MAX_SUBMISSION_BYTES } : {}), ...options };
  const { ledger } = machine;
  const limit = limiter(o);
  let queue = Promise.resolve();
  /** Writes run one at a time: idempotency and consumption are check-then-act. */
  const serial = (fn) => { const p = queue.then(fn, fn); queue = p.catch(() => {}); return p; };
  const streams = new Set();

  async function caller(req) {
    const m = /^Bearer (\S+)$/.exec(req.headers.authorization ?? "");
    if (!m) { if (req.headers.authorization !== undefined) throw new HttpError(401, "token", "expected a bearer token"); return null; }
    const a = machine.accounts.find(m[1]);
    if (!a) throw new HttpError(401, "token", "unknown bearer token");
    return { ...a, by: await machine.pseudonym(a.account) };
  }

  async function body(req) {
    const chunks = []; let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > o.maxBody) throw new HttpError(413, "too_large", `the body is over ${o.maxBody} bytes`);
      chunks.push(c);
    }
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });
    try { return text.decode(Buffer.concat(chunks)); } catch { throw new HttpError(400, "ijson", "the body is not valid UTF-8"); }
  }

  function tuning(q, who) {
    const t = {};
    const list = (k) => { const v = q.get(k); if (v === null) return; const xs = v.split(",").filter(Boolean); if (xs.length > 32) throw new HttpError(400, "tuning", `${k}: at most 32 values`); return xs; };
    for (const k of ["frequency", "status", "process_hash"]) { const v = list(k); if (v) t[k] = v; }
    const by = list("by");
    if (by) t.by = by.map((b) => { if (b !== "me") return b; if (!who) throw new HttpError(401, "token", "by=me needs a bearer token"); return who.by; });
    const a = q.get("activated");
    if (a !== null) { if (a !== "true" && a !== "false") throw new HttpError(400, "tuning", "activated is true or false"); t.activated = a === "true"; }
    return t;
  }
  const seqParam = (v, name) => { if (v === null || v === "") return undefined; if (!/^\d{1,12}$/.test(v)) throw new HttpError(400, "tuning", `${name} is a sequence number`); return Number(v); };

  function mayRead(who, entries) {
    if (!who) throw new HttpError(401, "token", "private: sign in as the submitter");
    if (who.admin) return;
    if (entries.some((e) => e.receipt.header.by !== who.by)) throw new HttpError(403, "forbidden", "only the submitter (or an admin) may read this");
  }

  // Demonstration only: reuse the reference owner/admin policy. This is
  // not the target institution/delegation contract (PR-09A).
  const access = who => ({ by: who.by, canRead: r => who.admin || r.header.by === who.by });
  const machineTag = target ? "machine@2" : "machine@1";
  const routes = [
    ["GET", /^\/$/, () => ({ logline: machineTag, see: "/.well-known/logline.json" })],
    ["GET", /^\/\.well-known\/logline\.json$/, () => ({
      logline: machineTag,
      keys: ledger.keys,
      limits: target ? { maxBody: o.maxBody } : { maxDepth: ledger.maxDepth, maxReactions: ledger.maxReactions, maxBody: o.maxBody },
      versions: [VERSION],
      ttlMs: 60000,
      cacheScope: "public",
    })],
    ["GET", /^\/head$/, () => machine.head()],
    ["GET", /^\/me$/, async (req) => {
      const who = await caller(req);
      if (!who) throw new HttpError(401, "token", "no bearer token");
      return { account: who.account, admin: who.admin, by: who.by };
    }],
    ["GET", /^\/processes$/, async () => (await ledger.published()).map(({ id, hash }) => ({ id, hash })).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)],
    ["GET", /^\/processes\/(sha256:[0-9a-f]{64})$/, (req, m) => (target ? ledger.law(m[1]) : ledger.processByHash(m[1])) ?? notFound("no process has that hash")],
    ["POST", /^\/processes$/, async (req) => {
      const who = await caller(req);
      if (!who?.admin) throw new HttpError(who ? 403 : 401, "forbidden", "publishing a process needs an admin token");
      const text = await body(req), process = L.parseStrict(text);
      const hash = await serial(() => ledger.publish(target ? text : process));
      return [201, { id: process.id, hash }];
    }],
    ["POST", /^\/submit$/, async (req) => {
      const who = await caller(req);
      if (target && !who) throw new HttpError(401, "token", "target submission needs an authenticated participant");
      const text = await body(req);
      const r = await serial(() => ledger.submitText(text, target ? access(who) : { by: who?.by ?? null }));
      return [r.replayed ? 200 : 201, r];
    }],
    ["GET", /^\/receipts\/(sha256:[0-9a-f]{64})$/, (req, m) => {
      const e = ledger.entry(m[1]) ?? notFound("no receipt has that id");
      return { seq: e.seq, receipt: e.receipt };
    }],
    ["GET", /^\/receipts\/(sha256:[0-9a-f]{64})\/detail$/, async (req, m) => {
      const e = ledger.entry(m[1]) ?? notFound("no receipt has that id");
      mayRead(await caller(req), [e]);
      return target ? { detail: e.detail, tuple: e.tuple, context: e.context } : { detail: e.detail, tuple: e.tuple };
    }],
    ["GET", /^\/receipts\/(sha256:[0-9a-f]{64})\/bundle$/, async (req, m) => {
      if (!ledger.entry(m[1])) notFound("no receipt has that id");
      const who = await caller(req);
      if (target) {
        mayRead(who, [ledger.entry(m[1])]);
        return await ledger.bundle(m[1], access(who).canRead);
      }
      const b = ledger.bundle(m[1]);
      mayRead(who, b.entries);
      return b;
    }],
    ["GET", /^\/history$/, async (req, m, q) => {
      const who = await caller(req);
      const after = seqParam(q.get("after"), "after") ?? 0;
      const lim = Math.min(seqParam(q.get("limit"), "limit") ?? 100, 1000);
      if (target && lim < 1) throw new HttpError(400, "tuning", "limit must be positive");
      const items = ledger.page(tuning(q, who), after, lim);
      return { items, next: items.length === lim ? items[items.length - 1].seq : null };
    }],
    ["GET", /^\/radio$/, async (req, m, q, res) => {
      const who = await caller(req);
      const t = tuning(q, who);
      const after = seqParam(req.headers["last-event-id"] ?? null, "Last-Event-ID") ?? seqParam(q.get("after"), "after");
      res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no", "logline-version": VERSION, "vary": "LogLine-Version", ...cors });
      res.write(": tuned\n\n");
      const stream = { res, stop: null };
      let closed = false;
      const send = (receipt, seq) => {
        // A listener that can't keep up is dropped; it resumes with Last-Event-ID.
        if (closed) return;
        if (res.writableLength > o.maxBuffered) return close();
        res.write(`id: ${seq}\nevent: receipt\ndata: ${JSON.stringify({ seq, receipt })}\n\n`);
      };
      const beat = setInterval(() => { if (res.writableLength > o.maxBuffered) close(); else if (!closed) res.write(": ping\n\n"); }, o.heartbeatMs);
      const close = () => { if(closed)return; closed=true; clearInterval(beat); stream.stop?.(); streams.delete(stream); res.end(); };
      stream.close = close;
      streams.add(stream);
      res.on("close", close);
      try { stream.stop = ledger.listen(t, send, after); }
      catch(e) { close(); throw e; }
      if(closed)stream.stop(); // synchronous catch-up may hit backpressure before listen returns

      return undefined; // streaming: the handler owns the response
    }],
  ];
  const notFound = (msg) => { throw new HttpError(404, "not_found", msg); };
  const cors = { "access-control-allow-origin": "*", "access-control-expose-headers": "LogLine-Version, Retry-After" };

  const server = http.createServer(async (req, res) => {
    const send = (status, value, headers = {}) => {
      const text = JSON.stringify(value);
      res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "logline-version": VERSION, "vary": "LogLine-Version", ...cors, ...headers });
      res.end(text + "\n");
    };
    try {
      const url = new URL(req.url, "http://machine");
      if (req.method === "OPTIONS") {
        res.writeHead(204, { ...cors, "access-control-allow-methods": "GET, POST", "access-control-allow-headers": "authorization, content-type, last-event-id, logline-version", "access-control-max-age": "86400" });
        return res.end();
      }
      const requested = req.headers["logline-version"] ?? VERSION;
      if (requested !== VERSION) throw new HttpError(400, "version", "unsupported LogLine-Version", {}, { supported: [VERSION], requested });
      const matches = routes.filter(([, re]) => re.test(url.pathname));
      if (!matches.length) throw new HttpError(404, "not_found", "no such route");
      const route = matches.find(([method]) => method === req.method);
      if (!route) throw new HttpError(405, "method", `use ${matches.map(([m]) => m).join(" or ")}`, { allow: matches.map(([m]) => m).join(", ") });
      if (req.method === "POST") {
        if (machine.broken()) throw new HttpError(503, "unavailable", "the ledger stopped accepting writes after a storage error");
      }
      if (req.method === "POST" && url.pathname === "/submit") {
        const who = await caller(req);
        const wait = limit(who ? "a:" + who.account : "ip:" + req.socket.remoteAddress);
        if (wait) throw new HttpError(429, "rate_limited", `too many submissions; retry in ${wait}s`, { "retry-after": String(wait) });
      }
      const out = await route[2](req, url.pathname.match(route[1]), url.searchParams, res);
      if (out === undefined) return;
      const [status, value] = Array.isArray(out) && typeof out[0] === "number" ? out : [200, out];
      let cache = "no-store";
      if (req.method === "GET" && status === 200) {
        if (/^\/(processes|receipts)\/sha256:[0-9a-f]{64}$/.test(url.pathname)) cache = IMMUTABLE;
        else if (url.pathname === "/.well-known/logline.json") cache = "public, max-age=60";
        else if (/^\/receipts\/.*\/(detail|bundle)$/.test(url.pathname)) cache = "private, no-store";
      }
      send(status, value, { "cache-control": cache });
    } catch (e) {
      if (res.headersSent) { res.destroy(); return; }
      if (e instanceof HttpError) return send(e.status, { error: e.code, message: e.message, ...e.extra }, e.headers);
      if (e instanceof L.LoglineError) {
        const status = e.code === "unavailable" ? 503 : e.code === "process_exists" || e.code === "submission_conflict" ? 409 : e.code === "admission_denied" ? 403 : 400;
        return send(status, { error: e.code, message: e.message });
      }
      console.error(e);
      send(500, { error: "internal", message: "internal error" });
    }
  });
  server.on("close", () => { for (const s of [...streams]) s.close(); });
  /** Stop: end every radio stream so close() can finish. */
  server.shutdown = () => new Promise((resolve) => { for (const s of [...streams]) s.close(); server.close(() => resolve()); server.closeIdleConnections?.(); });
  return server;
}
