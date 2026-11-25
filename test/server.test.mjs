// The HTTP machine: durable ledger, restart, radio over SSE, privacy, limits.
import assert from "node:assert";
import { test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as L from "../dist/index.js";
import { openMachine } from "../server/store.mjs";
import { createServer } from "../server/http.mjs";

const load = (f) => JSON.parse(fs.readFileSync(new URL("../processes/" + f, import.meta.url), "utf8"));
const PROCESSES = ["course.lesson@1.json", "course.certificate.logline-101@1.json", "alumni.logline-101@1.json"];
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "logline-"));

async function boot(dir, opts = {}) {
  const m = await openMachine(dir);
  const server = createServer(m, opts);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, p, { token, body, headers = {} } = {}) => {
    const res = await fetch(base + p, { method, body: typeof body === "string" ? body : body === undefined ? undefined : JSON.stringify(body),
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers } });
    return { status: res.status, json: await res.json(), headers: res.headers };
  };
  const stop = async () => { await server.shutdown(); m.close(); };
  return { m, base, call, stop };
}
async function fresh(opts, processes = PROCESSES) {
  const dir = tmp();
  const pre = await openMachine(dir);
  const tokens = { root: pre.accounts.add("root", { admin: true }), ana: pre.accounts.add("ana"), bob: pre.accounts.add("bob") };
  pre.close();
  const s = await boot(dir, opts);
  for (const f of processes) assert.equal((await s.call("POST", "/processes", { token: tokens.root, body: load(f) })).status, 201);
  return { dir, tokens, ...s };
}
const lesson = (n, score, previous) => ({ who: "learner", did: "complete", this: "course.lesson@1",
  with: { course: "logline-101", lesson: n, score }, ...(previous ? { cites: { previous } } : {}) });
const certificate = (last) => ({ who: "learner", did: "certify", this: "course.certificate.logline-101@1", with: { course: "logline-101" }, cites: { last } });

async function course(s, token) {
  const ids = [];
  for (let n = 1; n <= 5; n++) {
    const r = await s.call("POST", "/submit", { token, body: lesson(n, 90, ids.at(-1)) });
    assert.equal(r.status, 201); assert.equal(r.json.receipt.header.status, "ok");
    ids.push(r.json.receipt.id);
  }
  return ids;
}

/** Tune in (resolves once the stream is open), then `.heard` resolves when `n` receipts arrive. */
async function radio(base, query, n, headers = {}) {
  const ctl = new AbortController();
  const res = await fetch(`${base}/radio?${query}`, { headers, signal: ctl.signal });
  assert.equal(res.headers.get("content-type"), "text/event-stream; charset=utf-8");
  const reader = res.body.getReader(), dec = new TextDecoder();
  const events = []; let buf = "";
  const ready = (async () => {
    while (events.length < n) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const block = buf.slice(0, i); buf = buf.slice(i + 2);
        const data = block.split("\n").find((l) => l.startsWith("data: "));
        if (data) events.push(JSON.parse(data.slice(6)));
      }
    }
    ctl.abort();
    return events;
  })().catch((e) => { if (e.name !== "AbortError") throw e; return events; });
  return { heard: ready };
}

test("a whole course over HTTP; the bundle verifies offline against the published keys", async () => {
  const s = await fresh();
  try {
    const ids = await course(s, s.tokens.ana);
    const cert = await s.call("POST", "/submit", { token: s.tokens.ana, body: certificate(ids[4]) });
    assert.equal(cert.json.receipt.header.status, "ok");
    assert.deepEqual(cert.json.reactions.map((r) => r.header.frequency), ["alumni.logline-101@1"]);
    const alumni = cert.json.reactions[0].id;
    const keys = (await s.call("GET", "/.well-known/logline.json")).json.keys;
    const bundle = (await s.call("GET", `/receipts/${alumni}/bundle`, { token: s.tokens.ana })).json;
    assert.equal(bundle.entries.length, 7);
    assert.equal((await L.verifyBundle(bundle, keys)).valid, true);
    // the public header is public; the detail and the bundle are the submitter's
    assert.equal((await s.call("GET", `/receipts/${alumni}`)).json.receipt.id, alumni);
    assert.equal((await s.call("GET", `/receipts/${alumni}/bundle`)).status, 401);
    assert.equal((await s.call("GET", `/receipts/${alumni}/bundle`, { token: s.tokens.bob })).status, 403);
    assert.equal((await s.call("GET", `/receipts/${ids[0]}/detail`, { token: s.tokens.bob })).status, 403);
    assert.equal((await s.call("GET", `/receipts/${ids[0]}/detail`, { token: s.tokens.root })).status, 200);
    const mine = (await s.call("GET", "/history?by=me", { token: s.tokens.ana })).json.items;
    assert.equal(mine.length, 7);
    assert.equal((await s.call("GET", "/history?by=me", { token: s.tokens.bob })).json.items.length, 0);
  } finally { await s.stop(); }
});

test("after a restart: same keys and head, retries replay, consumed citations stay consumed", async () => {
  const s = await fresh();
  const ids = await course(s, s.tokens.ana);
  const cert = await s.call("POST", "/submit", { token: s.tokens.ana, body: certificate(ids[4]) });
  const before = (await s.call("GET", "/head")).json;
  await s.stop();

  const t = await boot(s.dir);
  try {
    const after = (await t.call("GET", "/head")).json;
    assert.deepEqual(after, before);
    const again = await t.call("POST", "/submit", { token: s.tokens.ana, body: certificate(ids[4]) });
    assert.equal(again.status, 200);
    assert.equal(again.json.replayed, true);
    assert.equal(again.json.receipt.id, cert.json.receipt.id);
    assert.equal(again.json.reactions.length, 0);
    const fork = await t.call("POST", "/submit", { token: s.tokens.ana, body: lesson(2, 100, ids[0]) });
    assert.notEqual(fork.json.receipt.header.status, "ok");
    assert.match(fork.json.detail.unmet.join(" "), /already been used/);
    assert.equal((await t.call("GET", "/head")).json.n, before.n + 1);
  } finally { await t.stop(); }
});

test("the radio: tuned, live, and resumable with Last-Event-ID", async () => {
  const s = await fresh();
  try {
    const live = (await radio(s.base, "frequency=course.*&status=ok", 2)).heard;
    const a = await s.call("POST", "/submit", { token: s.tokens.ana, body: lesson(1, 90) });
    await s.call("POST", "/submit", { token: s.tokens.bob, body: lesson(1, 10) });           // not ok: not heard
    await s.call("POST", "/submit", { token: s.tokens.bob, body: { did: "hello", this: "x" } }); // other frequency
    const b = await s.call("POST", "/submit", { token: s.tokens.bob, body: lesson(1, 95) });
    const heard = await live;
    assert.deepEqual(heard.map((e) => e.receipt.id), [a.json.receipt.id, b.json.receipt.id]);
    for (const e of heard) assert.equal(await L.inauthentic(e.receipt, s.m.ledger.keys), null);
    // a late listener resumes after the first event and gets only what it missed
    const resumed = await (await radio(s.base, "frequency=course.*&status=ok", 1, { "last-event-id": String(heard[0].seq) })).heard;
    assert.equal(resumed[0].receipt.id, b.json.receipt.id);
    // by=me needs a token
    assert.equal((await s.call("GET", "/radio?by=me")).status, 401);
  } finally { await s.stop(); }
});

test("identical submissions racing each other decide once", async () => {
  const s = await fresh();
  try {
    const rs = await Promise.all(Array.from({ length: 8 }, () => s.call("POST", "/submit", { token: s.tokens.ana, body: lesson(1, 90) })));
    assert.deepEqual(rs.map((r) => r.status).sort(), [200, 200, 200, 200, 200, 200, 200, 201]);
    assert.equal(new Set(rs.map((r) => r.json.receipt.id)).size, 1);
  } finally { await s.stop(); }
});

test("a torn last line is dropped; any other change to the log refuses to start", async () => {
  const s = await fresh();
  await course(s, s.tokens.ana);
  await s.stop();
  const file = path.join(s.dir, "ledger.jsonl");
  const good = fs.readFileSync(file, "utf8");

  fs.writeFileSync(file, good + '{"n":9,"prev":"sha');                         // crash mid-write
  const m = await openMachine(s.dir);
  assert.equal(m.repaired, true); assert.equal(m.ledger.length, 5); m.close();
  assert.equal(fs.readFileSync(file, "utf8"), good);

  const lines = good.trim().split("\n");
  const edit = async (i, f) => {
    const ls = lines.map((l) => JSON.parse(l)); f(ls[i]);
    fs.writeFileSync(file, ls.map((l) => L.canonicalize(l)).join("\n") + "\n");
  };
  await edit(4, (l) => { l.rec.tuple.with.score = 100; });                    // edited in place: chain breaks
  await assert.rejects(openMachine(s.dir), /log_corrupt: line 6 does not chain/);

  // Even someone who re-chains the file cannot change what was decided.
  const ls = lines.map((l) => JSON.parse(l)); ls[4].rec.tuple.with.score = 100;
  let prev = null;
  const out = [];
  for (const l of ls) { l.prev = prev; const text = L.canonicalize(l); out.push(text); prev = await L.sha256(text); }
  fs.writeFileSync(file, out.join("\n") + "\n");
  await assert.rejects(openMachine(s.dir), /restore: record 5: tuple does not match input_hash/);

  fs.writeFileSync(file, lines.slice(0, 3).concat(lines.slice(4)).join("\n") + "\n"); // a line removed
  await assert.rejects(openMachine(s.dir), /log_corrupt/);
  fs.writeFileSync(file, good);
  (await openMachine(s.dir)).close();
});

test("publishing is for admins, laws are immutable, and limits answer with reasons", async () => {
  const s = await fresh({ ratePerMinute: 60, burst: 3, maxBody: 2048 });
  try {
    const p = { ...load("course.lesson@1.json"), id: "course.lesson@2" };
    assert.equal((await s.call("POST", "/processes", { body: p })).status, 401);
    assert.equal((await s.call("POST", "/processes", { token: s.tokens.ana, body: p })).status, 403);
    const pub = await s.call("POST", "/processes", { token: s.tokens.root, body: p });
    assert.equal(pub.status, 201);
    assert.deepEqual((await s.call("GET", `/processes/${pub.json.hash}`)).json, p);
    const dup = await s.call("POST", "/processes", { token: s.tokens.root, body: p });
    assert.equal(dup.status, 409); assert.equal(dup.json.error, "process_exists");

    assert.equal((await s.call("POST", "/submit", { token: s.tokens.bob, body: "x".repeat(4096) })).json.error, "too_large");
    assert.equal((await s.call("POST", "/submit", { token: s.tokens.bob, body: '{"a":1,"a":2}' })).json.error, "ijson");
    assert.equal((await s.call("POST", "/submit", { token: s.tokens.bob, body: "{}" })).json.receipt.header.status, "registered");
    const r = await s.call("POST", "/submit", { token: s.tokens.bob, body: "{}" });
    assert.equal(r.status, 429); assert.ok(Number(r.headers.get("retry-after")) >= 1);
    assert.equal((await s.call("POST", "/submit", { token: "llt_nobody", body: "{}" })).status, 401);
    assert.equal((await s.call("DELETE", "/submit")).status, 405);
    assert.equal((await s.call("GET", `/receipts/sha256:${"0".repeat(64)}`)).status, 404);
  } finally { await s.stop(); }
});

test("an account added while the server runs can submit at once", async () => {
  const s = await fresh();
  try {
    const token = (await openMachine(s.dir)).accounts.add("late");
    const me = await s.call("GET", "/me", { token });
    assert.equal(me.status, 200); assert.equal(me.json.account, "late");
    assert.equal(me.json.by, await s.m.pseudonym("late"));
  } finally { await s.stop(); }
});

test("discovery is stable, version travels with each request, only immutable public objects are cached", async () => {
  const s = await fresh();
  try {
    const before = await s.call("GET", "/.well-known/logline.json");
    const head = (await s.call("GET", "/head")).json;
    assert.equal(before.json.head, undefined);
    assert.deepEqual(before.json.versions, ["1"]);
    assert.equal(before.headers.get("cache-control"), "public, max-age=60");
    const bad = await s.call("POST", "/submit", { body: {}, headers: { "logline-version": "999" } });
    assert.equal(bad.status, 400);
    assert.deepEqual(bad.json, { error: "version", message: "unsupported LogLine-Version", supported: ["1"], requested: "999" });
    assert.equal((await s.call("GET", "/head")).json.n, head.n);
    const r = await s.call("POST", "/submit", { token: s.tokens.ana, body: lesson(1, 90), headers: { "logline-version": "1" } });
    assert.equal(r.status, 201);
    assert.equal(r.headers.get("logline-version"), "1");
    assert.deepEqual((await s.call("GET", "/.well-known/logline.json")).json, before.json);
    assert.equal((await s.call("GET", "/head")).json.n, head.n + 1);
    const uri = `/receipts/${r.json.receipt.id}`;
    assert.equal((await s.call("GET", uri)).headers.get("cache-control"), "public, max-age=31536000, immutable");
    assert.equal((await s.call("GET", `/processes/${r.json.receipt.header.process_hash}`)).headers.get("cache-control"), "public, max-age=31536000, immutable");
    assert.equal((await s.call("GET", uri + "/detail", { token: s.tokens.ana })).headers.get("cache-control"), "private, no-store");
    assert.equal((await s.call("GET", uri + "/detail", { token: s.tokens.bob })).headers.get("cache-control"), "no-store");
    assert.equal((await s.call("GET", "/head")).headers.get("cache-control"), "no-store");
    const catalog = (await s.call("GET", "/processes")).json.map(p => p.id);
    assert.deepEqual(catalog, [...catalog].sort());
  } finally { await s.stop(); }
});

// The new architecture: a participant listens and decides, not the machine.
// This fixture is a new immutable law, not a modification of the old alumni law.
const externalAlumni = JSON.parse(fs.readFileSync(new URL("../examples/alumni.external.logline-101@1.json", import.meta.url), "utf8"));
const externalTuple = id => ({ did: "enroll", this: externalAlumni.id, cites: { trigger: id } });
const externalSetup = async () => {
  const s = await fresh({}, PROCESSES.slice(0, 2));
  assert.equal((await s.call("POST", "/processes", { token: s.tokens.root, body: externalAlumni })).status, 201);
  return s;
};

test("independent listeners hear the same object; only an explicit new input extends the trajectory", { timeout: 15000 }, async () => {
  const s = await externalSetup();
  try {
    const keys = (await s.call("GET", "/.well-known/logline.json")).json.keys;
    const ids = await course(s, s.tokens.ana);
    const a = await radio(s.base, "frequency=course.certificate.*&status=ok", 1);
    const b = await radio(s.base, "frequency=course.certificate.*&status=ok", 1);
    const cert = await s.call("POST", "/submit", { token: s.tokens.ana, body: certificate(ids.at(-1)) });
    assert.equal(cert.status, 201);
    assert.equal(cert.json.receipt.header.status, "ok");
    assert.deepEqual(cert.json.reactions, []);
    const [heardA, heardB] = await Promise.all([a.heard, b.heard]);
    assert.deepEqual(heardA[0].receipt, cert.json.receipt);
    assert.deepEqual(heardB[0].receipt, heardA[0].receipt);
    assert.equal((await L.verify(heardB[0].receipt, keys)).valid, true);
    assert.equal((await s.call("GET", "/history")).json.items.length, 6);
    // The receiver needs neither the learner's private evidence nor credentials.
    assert.equal((await s.call("GET", `/receipts/${cert.json.receipt.id}/detail`, { token: s.tokens.bob })).status, 403);
    const result = await s.call("POST", "/submit", { token: s.tokens.bob, body: externalTuple(heardB[0].receipt.id) });
    assert.equal(result.status, 201);
    assert.equal(result.json.receipt.header.status, "ok");
    assert.deepEqual(result.json.receipt.header.prev, [cert.json.receipt.id]);
    assert.notEqual(result.json.receipt.header.by, cert.json.receipt.header.by);
    assert.equal(result.json.detail.grants.member, cert.json.receipt.header.by);
    assert.equal(result.json.receipt.header.depth, 0); // independently submitted, not a machine reaction
    assert.deepEqual(result.json.reactions, []);
    const bundle = (await s.call("GET", `/receipts/${result.json.receipt.id}/bundle`, { token: s.tokens.root })).json;
    assert.equal(bundle.entries.length, 7);
    assert.equal((await L.verifyBundle(bundle, keys)).valid, true);
    // An external workflow does not acquire blanket access to another person's private evidence.
    assert.equal((await s.call("GET", `/receipts/${result.json.receipt.id}/bundle`, { token: s.tokens.bob })).status, 403);
  } finally { await s.stop(); fs.rmSync(s.dir, { recursive: true, force: true }); }
});

test("continuity: an absent listener catches up after restart; competing listeners cannot consume a certificate twice", { timeout: 15000 }, async () => {
  const s = await externalSetup();
  let t;
  try {
    const keys = (await s.call("GET", "/.well-known/logline.json")).json.keys;
    const ids = await course(s, s.tokens.ana);
    const cursor = (await s.call("GET", "/history")).json.items.at(-1).seq;
    const cert = await s.call("POST", "/submit", { token: s.tokens.ana, body: certificate(ids.at(-1)) });
    assert.equal(cert.json.receipt.header.status, "ok");
    assert.deepEqual(cert.json.reactions, []);
    await s.stop();
    t = await boot(s.dir);
    const catchup = await (await radio(t.base, "frequency=course.certificate.*&status=ok", 1, { "last-event-id": String(cursor) })).heard;
    assert.equal(catchup[0].receipt.id, cert.json.receipt.id);
    assert.equal((await L.verify(catchup[0].receipt, keys)).valid, true);
    const tuple = externalTuple(catchup[0].receipt.id);
    const claims = await Promise.all([s.tokens.bob, s.tokens.root].map(token => t.call("POST", "/submit", { token, body: tuple })));
    assert.deepEqual(claims.map(x => x.json.receipt.header.status).sort(), ["ok", "registered"]);
    const winner = claims.find(x => x.json.receipt.header.status === "ok");
    const loser = claims.find(x => x.json.receipt.header.status === "registered");
    assert.match(loser.json.detail.unmet.join(" "), /already been used/);
    const again = await t.call("POST", "/submit", { token: winner === claims[0] ? s.tokens.bob : s.tokens.root, body: tuple });
    assert.equal(again.status, 200);
    assert.equal(again.json.receipt.id, winner.json.receipt.id);
    assert.equal((await t.call("GET", "/history?frequency=" + externalAlumni.id + "&status=ok")).json.items.length, 1);
  } finally { if (t) await t.stop(); else await s.stop(); fs.rmSync(s.dir, { recursive: true, force: true }); }
});
