// The machine: choreography, loop limits, idempotency, strict input.
import assert from "node:assert";
import { test } from "node:test";
import * as L from "../dist/index.js";

const echo = (id, listensTo, status) => ({
  logline: "process@1", id, issuer: "test", on: { frequency: listensTo, ...(status ? { status } : {}) },
  accepts: { did: "react" }, requires: {}, cites: { trigger: { frequency: listensTo } },
  steps: [], if_ok: "ok", if_doubt: "doubt", if_not: "not", time: "none",
});
const start = { logline: "process@1", id: "start@1", issuer: "test", accepts: { did: "go" }, requires: {}, steps: [], if_ok: "ok", if_doubt: "doubt", if_not: "not", time: "none" };
async function machine(opts = {}) {
  let t = Date.parse("2026-11-25T09:00:00Z");
  return new L.MemoryLedger((await L.generateMachineKey()).key, { clock: () => new Date((t += 1000)).toISOString().slice(0, 19) + "Z", ...opts });
}

test("a reaction cites its trigger, inherits by, and sits one level deeper", async () => {
  const m = await machine();
  await m.publish(start); await m.publish(echo("echo@1", "start@1", ["ok"]));
  const r = await m.submit({ did: "go", this: "start@1" }, { by: "p:x" });
  assert.equal(r.reactions.length, 1);
  const h = r.reactions[0].header;
  assert.deepEqual([h.frequency, h.status, h.by, h.depth, h.prev], ["echo@1", "ok", "p:x", 1, [r.receipt.id]]);
  assert.equal((await L.verifyBundle(m.bundle(r.reactions[0].id), m.keys)).valid, true);
});
test("a ping-pong loop is halted by depth, and every receipt it made is valid", async () => {
  const m = await machine({ maxDepth: 5 });
  const rally = (id, on) => ({ ...echo(id, on), cites: { trigger: { frequency: "rally.*" } } });
  await m.publish({ ...start, id: "rally.start@1" });
  await m.publish(rally("rally.ping@1", ["rally.start@1", "rally.pong@1"]));
  await m.publish(rally("rally.pong@1", "rally.ping@1"));
  const r = await m.submit({ did: "go", this: "rally.start@1" });
  assert.deepEqual(r.reactions.map((x) => [x.header.frequency, x.header.depth]),
    [["rally.ping@1", 1], ["rally.pong@1", 2], ["rally.ping@1", 3], ["rally.pong@1", 4], ["rally.ping@1", 5]]);
  assert.deepEqual(r.halted.map((h) => [h.process, h.reason]), [["rally.pong@1", "depth"]]);
  for (const x of r.reactions) assert.equal((await L.verifyBundle(m.bundle(x.id), m.keys)).valid, true);
});
test("a fan-out storm is halted by the chain budget", async () => {
  const m = await machine({ maxDepth: 50, maxReactions: 10 });
  await m.publish({ ...start, id: "f.start@1" });
  for (const x of ["a", "b", "c"]) await m.publish(echo(`f.${x}@1`, "f.*")); // each hears all: 3, 9, 27, …
  const r = await m.submit({ did: "go", this: "f.start@1" });
  assert.ok(r.reactions.every((x) => x.header.status === "ok"));
  assert.equal(r.reactions.length, 10);
  assert.ok(r.halted.length > 0 && r.halted.every((h) => h.reason === "chain_budget"));
});
test("a process reacts to a given receipt at most once", async () => {
  const m = await machine();
  await m.publish(start); await m.publish(echo("self@1", "self@1")); await m.publish(echo("starter@1", "start@1"));
  const r = await m.submit({ did: "go", this: "start@1" });
  // self@1 hears its own receipts: a chain, never two reactions to the same trigger
  const triggers = r.reactions.filter((x) => x.header.frequency === "self@1").map((x) => x.header.prev[0]);
  assert.equal(new Set(triggers).size, triggers.length);
});
test("a reaction that does not activate is still on the record", async () => {
  const m = await machine();
  const picky = { ...echo("picky@1", "start@1"), requires: { "with.x": "number" } };
  await m.publish(start); await m.publish(picky);
  const r = await m.submit({ did: "go", this: "start@1" });
  assert.equal(r.reactions[0].header.status, "registered");
});
test("processes that react must declare cites.trigger", async () => {
  const m = await machine();
  const bad = { ...echo("bad@1", "start@1"), cites: {} };
  await assert.rejects(m.publish(bad), (e) => e.code === "process_invalid" && /cites\.trigger/.test(e.message));
});
test("idempotency: same submission, same by, same bucket returns the same receipt", async () => {
  const m = await machine();
  await m.publish({ ...start, time: "day" }); await m.publish(echo("echo@1", "start@1"));
  const a = await m.submit({ did: "go", this: "start@1", n: 1 }, { by: "p:x" });
  const b = await m.submit({ did: "go", this: "start@1", n: 1 }, { by: "p:x" });
  assert.equal(b.replayed, true); assert.equal(b.receipt.id, a.receipt.id); assert.equal(b.reactions.length, 0);
  const c = await m.submit({ did: "go", this: "start@1", n: 1 }, { by: "p:y" });
  assert.equal(c.replayed, false);
  const d = await m.submit({ did: "go", this: "start@1", n: 2 }, { by: "p:x" });
  assert.equal(d.replayed, false);
  assert.equal(m.history({ frequency: "echo@1" }).length, 3);
});
test("idempotency respects time: exact-time processes never replay", async () => {
  const m = await machine();
  await m.publish({ ...start, time: "exact" });
  const a = await m.submit({ did: "go", this: "start@1" }), b = await m.submit({ did: "go", this: "start@1" });
  assert.notEqual(a.receipt.id, b.receipt.id);
});
test("strict input: what JSON.parse would silently change is refused", () => {
  for (const [text, re] of [
    ['{"a":1,"a":2}', /duplicate key/],
    ['{"n":9007199254740993}', /rounded/],
    ['["\\ud800"]', /lone surrogate/],
    ['{"a":1} x', /trailing/],
    ['{"a":"\u0001"}', /control character/],
    ['[' .repeat(100) + ']'.repeat(100), /deeply/],
  ]) assert.throws(() => L.parseStrict(text), (e) => e.code === "ijson" && re.test(e.message), text);
  assert.deepEqual(L.parseStrict(' {"b":[1,2.5,-3e2,true,null],"a":"é\\n"} '), { b: [1, 2.5, -300, true, null], a: "é\n" });
  assert.equal(Object.getPrototypeOf(L.parseStrict('{"__proto__":{"x":1}}')), Object.prototype);
});
test("submitText refuses duplicate keys before anything is recorded", async () => {
  const m = await machine();
  await m.publish(start);
  await assert.rejects(m.submitText('{"did":"go","this":"start@1","did":"stop"}'), (e) => e.code === "ijson");
  assert.equal(m.history().length, 0);
  const r = await m.submitText('{"did":"go","this":"start@1"}');
  assert.equal(r.receipt.header.status, "ok");
});
