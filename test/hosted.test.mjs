import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import * as L from "../dist/index.js";
import { submitRoot } from "../supabase/functions/_shared/ledger.mjs";
import { createHandler, auth } from "../supabase/functions/_shared/http.mjs";
import { database } from "../supabase/functions/_shared/postgrest.mjs";
const process = JSON.parse(readFileSync(new URL("../processes/course.lesson@1.json", import.meta.url)));
const when = "2026-11-25T10:00:00Z", owner = "11111111-1111-4111-8111-111111111111", by = "p:ana";
const lesson = (n, score, previous) => ({ did: "complete", this: process.id, with: { course: "logline-101", lesson: n, score }, ...(previous ? { cites: { previous } } : {}) });

// A transaction-contract test double, deliberately NOT a PostgreSQL test.
// It commits all effects synchronously or returns retry; each adapter call is
// asynchronous so Promise.all exercises the optimistic retry path.
function durable() {
  const rows = new Map(), idem = new Map(), used = new Set(), outbox = new Set();
  const laws = new Map([[process.id, JSON.parse(L.canonicalize(process))]]);
  const claimKey = (law, c) => L.canonicalize([law, c.slot, c.cited_id]);
  const db = {
    process: async id => laws.get(id) ?? null,
    citation: async id => rows.get(id) ?? null,
    spent: async (law, claims) => [...new Set(claims.filter(c => used.has(claimKey(law, c))).map(c => c.cited_id))].sort(),
    commit: async p => {
      if (idem.has(p.cache_key)) return { kind: "replayed", id: idem.get(p.cache_key) };
      const keys = p.claims.map(c => claimKey(p.process_id, c));
      if (p.status === "ok" && keys.some(k => used.has(k))) return { kind: "retry" };
      if (p.status === "ok") for (const k of keys) used.add(k);
      rows.set(p.id, { receipt: JSON.parse(p.receipt), detail: JSON.parse(p.detail), tuple: JSON.parse(p.tuple), owner: p.owner });
      idem.set(p.cache_key, p.id); outbox.add(p.id);
      return { kind: "committed", id: p.id };
    },
    publish: async p => { L.validateProcess(p); laws.set(p.id, p); return { id: p.id, hash: await L.hashOf(p) }; },
  };
  return { db, rows, idem, used, outbox };
}
async function setup() {
  const { key } = await L.generateMachineKey(), keys = { [key.id]: { jwk: key.public } };
  const d = durable();
  return { ...d, key, keys, submit: (tuple, more = {}) => submitRoot({ db: d.db, key, keys, tuple, when, owner, by, ...more }) };
}

test("hosted root matches reference receipt bytes through CAS", async () => {
  const h = await setup(), m = new L.MemoryLedger(h.key, () => when);
  await m.publish(process);
  for (const t of [null, ["free", "\u0000"], { this: process.id }, lesson(1, 10), lesson(1, 90)]) {
    const local = await m.submit(t, { by });
    const remote = await h.submit(t);
    assert.deepEqual(remote, { receipt: local.receipt, detail: local.detail, replayed: local.replayed });
    assert.equal(h.rows.get(remote.receipt.id).owner, owner);
  }
});

test("independent requests replay the committed receipt, once conflict reruns the evaluator", async () => {
  const h = await setup();
  const first = await h.submit(lesson(1, 90));
  const identical = await Promise.all(Array.from({length: 12}, () => h.submit(lesson(2, 90, first.receipt.id))));
  assert.equal(identical.filter(r => !r.replayed).length, 1);
  assert.equal(new Set(identical.map(r => r.receipt.id)).size, 1);
  const prev = identical[0].receipt.id;
  const forks = await Promise.all([h.submit(lesson(3, 91, prev)), h.submit(lesson(3, 92, prev))]);
  assert.deepEqual(forks.map(r => r.receipt.header.status).sort(), ["ok", "registered"]);
  assert.match(forks.find(r => r.receipt.header.status === "registered").detail.unmet.join(), /already been used/);
  assert.equal(h.used.size, 2); assert.equal(h.rows.size, 4); assert.equal(h.outbox.size, 4);
  for (const r of forks) assert.equal(await L.inauthentic(r.receipt, h.keys), null);
});

test("rejected course attempt never consumes; forged identity is only tuple data", async () => {
  const h = await setup(), root = await h.submit(lesson(1, 90));
  const fail = await h.submit(lesson(2, 5, root.receipt.id));
  assert.equal(fail.receipt.header.status, "not"); assert.equal(h.used.size, 0);
  const bob = await h.submit({ ...lesson(2, 90, root.receipt.id), by, who: "ana" }, { by: "p:bob", owner: null });
  assert.equal(bob.receipt.header.by, "p:bob"); assert.equal(bob.receipt.header.status, "not");
  assert.equal((await h.submit(lesson(2, 90, root.receipt.id))).receipt.header.status, "ok");
});

test("a storage failure or corrupt replay never returns an uncommitted signed receipt", async () => {
  const h = await setup();
  const t = lesson(1, 90), initial = await h.submit(t);
  h.rows.get(initial.receipt.id).detail.consequence = "tampered";
  await assert.rejects(h.submit(t), /could not be verified/);
  h.db.commit = async () => { throw new Error("network failed"); };
  await assert.rejects(h.submit(lesson(1, 99)), /network failed/);
  h.db.commit = async () => ({kind:"retry"});
  await assert.rejects(h.submit(lesson(1, 98)), /changed repeatedly/);
});

test("Edge request contract: strict JSON, version, owner attestation, admin-only publication", async () => {
  const h = await setup();
  const identify = async req => req.headers.has("authorization") ? { owner, by, admin: req.headers.get("authorization") === "Bearer admin" } : null;
  const submit = createHandler({ action: "submit", ...h, identify });
  const publish = createHandler({ action: "publish", ...h, identify });
  const req = (body, headers = {}) => new Request("https://test.invalid/submit", { method: "POST", body, headers });
  assert.equal((await submit(req('{"x":1,"x":2}'))).status, 400);
  assert.equal((await submit(req(' '.repeat(65537)))).status, 413);
  assert.equal((await submit(req('{}', {"logline-version":"bad"}))).status, 400);
  assert.equal((await publish(req(JSON.stringify(process)))).status, 401);
  assert.equal((await publish(req(JSON.stringify(process), {authorization:"Bearer user"}))).status, 403);
  assert.equal((await publish(req(JSON.stringify({...process, id:"course.lesson@2"}), {authorization:"Bearer admin"}))).status, 201);
  const r = await submit(req(JSON.stringify({...lesson(1,90), by:"fake"}), {authorization:"Bearer user"}));
  assert.equal(r.status, 201); assert.equal((await r.json()).receipt.header.by, by);
  assert.equal(r.headers.get("cache-control"), "no-store");
});

test("auth validates remotely and ignores user-controlled admin claims", async () => {
  const identify = auth({ url:"https://test.invalid", publishableKey:"public", pseudonymSecret:new Uint8Array(32), fetcher:async (url, init) => {
    assert.equal(url, "https://test.invalid/auth/v1/user");
    assert.equal(init.headers.apikey, "public");
    if (init.headers.authorization === "Bearer bad") return new Response("{}", {status:401});
    return Response.json({ id:owner, user_metadata:{logline_admin:true}, app_metadata:{} });
  }});
  const req = token => new Request("https://test.invalid", {headers: token ? {authorization:token} : {}});
  assert.equal(await identify(req()), null);
  await assert.rejects(identify(req("Bearer bad")), /invalid bearer/);
  await assert.rejects(identify(req("Basic abc")), /expected a bearer/);
  const who = await identify(req("Bearer good"));
  assert.equal(who.admin, false); assert.equal(who.owner, owner);
  assert.equal(who.by, await L.pseudonym(new Uint8Array(32), owner));
});

test("PostgREST adapter stores canonical text including NUL escape and detects alteration", async () => {
  const body = L.canonicalize({...process, issuer:"a\u0000b"}), hash = await L.sha256(body);
  let altered = false;
  const db = database({url:"https://test.invalid",serviceKey:"sb_secret_test",fetcher:async (url, init) => {
    assert.equal(init.headers.authorization, undefined);
    assert.equal(init.headers.apikey,"sb_secret_test");
    if (url.includes("/processes?")) return Response.json([{hash}]);
    return Response.json([{body: altered ? "{}" : body}]);
  }});
  assert.equal((await db.process(process.id)).issuer,"a\u0000b");
  altered = true; await assert.rejects(db.process(process.id), /CAS object missing or altered/);
});
