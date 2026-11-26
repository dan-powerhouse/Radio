import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import * as L from "../dist/index.js";
const f = JSON.parse(readFileSync(new URL("../vectors/recognition.json", import.meta.url), "utf8"));
const snapshot = name => f.snapshots[name];
const evidence = () => new Map(Object.entries(f.laws));
const scan = (name, tuple, laws = evidence()) => L.scan(tuple, snapshot(name).hash, snapshot(name).json, laws);
const lawId = hash => JSON.parse(f.laws[hash]).id;

test("scanner goldens have independent content addresses (no RADIO hashing)", () => {
  const h = bytes => "sha256:" + createHash("sha256").update(bytes).digest("hex");
  for (const [hash, text] of Object.entries(f.laws)) assert.equal(h(text), hash);
  for (const { hash, json } of Object.values(f.snapshots)) assert.equal(h(json), hash);
});

test("map insertion order and formatting do not affect a decision", async () => {
  const tuple = '{"did":"request","with":{"green":true}}';
  const expected = f.cases.find(c => c.name === "ambiguous").expected;
  const reversed = new Map([...evidence()].reverse());
  assert.deepEqual(await scan("colors", tuple, reversed), expected);
});

test("scanner captures all referenced evidence before its first asynchronous suspension", async () => {
  const laws = evidence();
  const pending = scan("colors", '{"did":"request","with":{"green":true}}', laws);
  laws.clear();
  assert.deepEqual(await pending, f.cases.find(c => c.name === "ambiguous").expected);
  await assert.rejects(scan("colors", '{}', laws), { code: "scan_registry_missing" });
});

test("registry retirement and amendment cannot change historical recognition", async () => {
  const registry = new L.ProcessTypeRegistry(20);
  const colors = JSON.parse(snapshot("colors").json).types;
  for (const hash of colors) assert.equal(await registry.publish(f.laws[hash]), hash);
  const old = await registry.snapshot();
  assert.equal(old.hash, snapshot("colors").hash);
  registry.retire("green@1");
  const current = await registry.snapshot();
  const tuple = '{"did":"request","with":{"green":true}}';
  const run = async s => L.scan(tuple, s.hash, L.canonicalize(s.snapshot),
    new Map(s.snapshot.types.map(h => [h, L.canonicalize(registry.law(h))])));
  assert.equal((await run(old)).outcome, "ambiguous");
  const next = await run(current);
  assert.equal(next.outcome, "unique");
  assert.equal(lawId(next.selected), "blue@1");
  assert.deepEqual(registry.snapshotByHash(old.hash), old.snapshot);
});

test("tuple UTF-8 admission bound is inclusive, before parsing", async () => {
  const exact = '"' + 'é'.repeat((L.MAX_SCAN_INPUT_BYTES - 2) / 2) + '"';
  assert.equal(Buffer.byteLength(exact), L.MAX_SCAN_INPUT_BYTES);
  assert.equal((await scan("empty", exact)).outcome, "none");
  await assert.rejects(scan("empty", exact + " "), { code: "scan_limit" });
  await assert.rejects(scan("empty", " ".repeat(L.MAX_SCAN_INPUT_BYTES + 1)), { code: "scan_limit" });
});

test("snapshot and law evidence bounds are checked independently of scan_ops", async () => {
  await assert.rejects(L.scan("null", snapshot("empty").hash,
    snapshot("empty").json + " ".repeat(L.MAX_SCAN_SNAPSHOT_BYTES), evidence()), { code: "scan_limit" });
  const types = Array.from({length:L.MAX_SCAN_LAWS+1},(_,i)=>"sha256:"+i.toString(16).padStart(64,"0"));
  const over = {logline:"registry@1",types,scan_ops:1};
  await assert.rejects(L.scan("null", await L.hashOf(over), L.canonicalize(over), new Map()), {code:"scan_limit"});
  const blue = JSON.parse(snapshot("blue").json).types[0], laws = evidence();
  laws.set(blue, laws.get(blue) + " ".repeat(L.MAX_LAW_BYTES));
  await assert.rejects(scan("blue","null",laws), {code:"scan_registry_invalid"});
  const count = Math.floor(L.MAX_SCAN_LAW_BYTES/L.MAX_LAW_BYTES)+1;
  const many = new Map(Array.from({length:count},(_,i)=>["sha256:"+i.toString(16).padStart(64,"0")," ".repeat(L.MAX_LAW_BYTES)]));
  const total = {logline:"registry@1",types:[...many.keys()],scan_ops:1};
  await assert.rejects(L.scan("null",await L.hashOf(total),L.canonicalize(total),many),{code:"scan_limit"});
});
