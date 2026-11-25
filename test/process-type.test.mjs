import test from "node:test";
import assert from "node:assert/strict";
import { canonicalize, hashOf, parseProcessType, validateProcessType, validateRegistrySnapshot,
  ProcessTypeRegistry, MAX_LAW_BYTES, MAX_LAW_NODES } from "../dist/index.js";

const run = (id = "open", after = []) => ({
  id, after, requires: {}, steps: [], if_ok: "ok", if_doubt: "doubt", if_not: "not",
});
const law = (id = "blue@1") => ({
  logline: "process-type@1", id, issuer: "example",
  recognize: { and: [{ has: "did" }, { "==": [{ var: "did" }, "request"] }] },
  runs: [run()],
});
const invalid = (value) => assert.throws(() => validateProcessType(value), { code: "process_type_invalid" });
const publish = (r, value) => r.publish(JSON.stringify(value));

test("single RUN and nonlinear multi-RUN definitions use the existing expressions", () => {
  const v = law();
  assert.deepEqual(parseProcessType(JSON.stringify(v)), v);
  v.runs.push(run("left", ["open"]), run("right", ["open"]), run("join", ["left", "right"]));
  v.runs[3].steps.push({ id: "owner", check: { "==": [{ var: "$by" }, { var: "$parents.left.detail.grants.owner" }] }, if_not: "not", reason: "different owner" });
  v.runs[3].cites = { proof: { frequency: "proof@1", once: true } };
  v.runs[3].grants = { source: { var: "$cites.proof.id" }, root: { var: "$instance" } };
  validateProcessType(v);
  assert.equal(parseProcessType(canonicalize(v)).runs.length, 4);
});

test("unknown fields and legacy law/RUN features cannot enter publication", () => {
  for (const key of ["accepts", "on", "time", "script", "SKILL"]) {
    invalid({ ...law(), [key]: {} });
    const v = law(); v.runs[0][key] = {}; invalid(v);
  }
  invalid({ ...law(), logline: "process@1" });
  const v = law(); v.runs[0].limits = { ops: 10, extra: 1 }; invalid(v);
  for (const key of ["recognize", "issuer", "runs", "id"]) {
    const v = law(); delete v[key]; invalid(v);
  }
  invalid(law("_unaddressed"));
});

test("RUN graph requires a single entry, unique ids, and earlier parents", () => {
  for (const runs of [[], [run("open", ["open"])], [run(), run("next")],
    [run(), run("open", ["open"])], [run(), run("next", ["next"])],
    [run(), run("next", ["later"]), run("later", ["open"])],
    [run(), run("next", ["open", "open"])], [run("invalid.id")]]) invalid({ ...law(), runs });
  const runs = [run(), ...Array.from({ length: 63 }, (_, i) => run("r" + i, ["open"]))];
  validateProcessType({ ...law(), runs });
  invalid({ ...law(), runs: [...runs, run("too-many", ["open"])] });
});

test("all expression branches are statically checked, not only visited ones", () => {
  for (const e of [{ if: [true, true, { unknown: [] }] }, { if: [true, true, { "==": [1] }] },
    { var: ["did", "this"] }, { has: "" }, { var: { concat: ["d", "id"] } },
    { min: [] }, { not: [] }, { add_days: ["2026-01-01"] }, { constructor: [] },
    JSON.parse('{"__proto__":[]}'), { toString: [] }, { and: [], or: [] }]) invalid({ ...law(), recognize: e });
  for (const key of ["steps", "grants"]) {
    const v = law(), bad = { if: [true, 1, { unknown: 1 }] };
    v.runs[0][key] = key === "steps" ? [{ id: "x", check: bad, if_not: "not", reason: "bad" }] : { bad };
    invalid(v);
  }
});

test("recognition sees only tuple paths; RUNs see only declared institutional context", () => {
  for (const p of ["$by", "$when", "$instance", "$cites.proof.id", "$parents.open.id"]) invalid({ ...law(), recognize: { has: p } });
  for (const p of ["$clock", "$by.extra", "$parents.open.id", "$cites.proof.id", "$parents.open.header.x"]) {
    const v = law(); v.runs[0].grants = { x: { has: p } }; invalid(v);
  }
  const v = law(); v.recognize = { has: "__proto__.constructor" }; validateProcessType(v);
  v.runs[0].grants = { actor: { var: "$by" }, day: { var: "$today" } }; validateProcessType(v);
});

test("existing field constraints apply to each RUN", () => {
  for (const bad of [{ requires: { "with.x": "float" } }, { cites: { slot: { frequency: "x@1", once: "yes" } } },
    { steps: [{ id: "x", if_not: "ok", check: true, reason: "x" }] }, { if_ok: "" },
    { broadcast: ["secret"] }, { limits: { ops: 0 } }, { limits: { ops: 1_000_001 } }]) {
    const v = law(); Object.assign(v.runs[0], bad); invalid(v);
  }
});

test("strict publication rejects duplicate keys, unsafe integers, depth and breadth", () => {
  assert.throws(() => parseProcessType('{"logline":"process-type@1","logline":"process-type@1"}'), { code: "ijson" });
  assert.throws(() => parseProcessType('{"issuer":"\\q"}'), { code: "ijson" });
  invalid({ ...law(), recognize: 9007199254740992 });
  invalid({ ...law(), recognize: Array(MAX_LAW_NODES).fill(0) });
  let deep = true; for (let i = 0; i < 70; i++) deep = [deep];
  invalid({ ...law(), recognize: deep });
  assert.throws(() => parseProcessType(" ".repeat(MAX_LAW_BYTES + 1)), { code: "process_type_invalid" });
  invalid({ ...law(), recognize: new Array(2) });
});

test("publication is content-addressed, immutable and idempotent", async () => {
  const r = new ProcessTypeRegistry(), v = law();
  const a = await publish(r, v);
  assert.equal(a, await hashOf(v));
  assert.equal(await r.publish(canonicalize(v)), a);
  v.runs[0].if_ok = "changed";
  await assert.rejects(publish(r, v), { code: "process_exists" });
  const stored = r.law(a); stored.runs[0].if_ok = "tampered";
  assert.equal(r.law(a).runs[0].if_ok, "ok");
  assert.equal(r.law("missing"), null);
  assert.deepEqual((await r.snapshot()).snapshot.types, [a]);
});

test("amendment and retirement preserve historical laws and snapshots", async () => {
  const r = new ProcessTypeRegistry(500), a = await publish(r, law());
  const old = await r.snapshot();
  const b = await publish(r, law("blue@2"));
  r.retire("blue@1");
  const current = await r.snapshot();
  assert.notEqual(current.hash, old.hash);
  assert.deepEqual(current.snapshot.types, [b]);
  assert.equal(current.snapshot.scan_ops, 500);
  assert.equal(old.hash, await hashOf(old.snapshot));
  old.snapshot.types.length = 0;
  assert.deepEqual(r.snapshotByHash(old.hash).types, [a]);
  assert.equal(r.law(a).id, "blue@1");
  assert.equal(await publish(r, law()), a);
  assert.deepEqual((await r.snapshot()).snapshot.types, [b]); // no implicit reactivation
});

test("concurrent publications cannot bind different laws to one id", async () => {
  const r = new ProcessTypeRegistry(), v = law(), w = law();
  w.runs[0].if_ok = "different";
  const result = await Promise.allSettled([publish(r, v), publish(r, w)]);
  assert.equal(result.filter(x => x.status === "fulfilled").length, 1);
  assert.equal(result.find(x => x.status === "rejected").reason.code, "process_exists");
  assert.equal((await r.snapshot()).snapshot.types.length, 1);
});

test("snapshot capture is independent of later publication and order", async () => {
  const r = new ProcessTypeRegistry(), a = await publish(r, law());
  const pending = r.snapshot(), b = await publish(r, law("green@1"));
  assert.deepEqual((await pending).snapshot.types, [a]);
  const now = await r.snapshot();
  assert.deepEqual(now.snapshot.types, [a, b].sort());
  const reversed = new ProcessTypeRegistry();
  await publish(reversed, law("green@1")); await publish(reversed, law());
  assert.equal((await reversed.snapshot()).hash, now.hash);
  assert.equal((await new ProcessTypeRegistry().snapshot()).snapshot.types.length, 0);
});

test("snapshot shape rejects unknown fields, invalid budgets and unordered hashes", async () => {
  const r = new ProcessTypeRegistry();
  const a = await publish(r, law()), b = await publish(r, law("green@1"));
  const { snapshot } = await r.snapshot();
  validateRegistrySnapshot(snapshot);
  for (const v of [{ ...snapshot, scan_ops: 0 }, { ...snapshot, scan_ops: 1_000_001 },
    { ...snapshot, types: [a, a] }, { ...snapshot, types: [a, b].sort().reverse() },
    { ...snapshot, types: ["sha256:bad"] }, { ...snapshot, extra: true }])
    assert.throws(() => validateRegistrySnapshot(v), { code: "process_type_invalid" });
});
