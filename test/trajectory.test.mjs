// Trajectories: receipts as inputs to other runs, verified offline as a bundle.
import { readFileSync } from "node:fs";
import assert from "node:assert";
import { test } from "node:test";
import * as L from "../dist/index.js";

const load = (f) => JSON.parse(readFileSync(new URL("../processes/" + f, import.meta.url), "utf8"));
async function course() {
  const { key } = await L.generateMachineKey();
  let t = Date.parse("2026-11-25T09:00:00Z");
  const ledger = new L.MemoryLedger(key, () => new Date((t += 60_000)).toISOString().slice(0, 19) + "Z");
  await ledger.publish(load("course.lesson@1.json"));
  await ledger.publish(load("course.certificate.logline-101@1.json"));
  const lessons = [];
  let prev;
  for (let n = 1; n <= 5; n++) {
    const { receipt } = await ledger.submit({ did: "complete", this: "course.lesson@1", with: { course: "logline-101", lesson: n, score: 80 }, ...(prev ? { cites: { previous: prev } } : {}) }, { by: "p:ana" });
    assert.equal(receipt.header.status, "ok"); lessons.push(receipt); prev = receipt.id;
  }
  const { receipt: cert } = await ledger.submit({ did: "certify", this: "course.certificate.logline-101@1", with: { course: "logline-101" }, cites: { last: prev } }, { by: "p:ana" });
  return { key, ledger, lessons, cert };
}
const failedCodes = (r) => r.entries.flatMap((e) => e.verdict.checks.filter((c) => c.result === "fail").map((c) => c.code));

test("a five-lesson trajectory yields a certificate whose bundle verifies offline", async () => {
  const { ledger, cert } = await course();
  assert.equal(cert.header.status, "ok");
  const b = ledger.bundle(cert.id);
  assert.equal(b.entries.length, 6);
  const v = await L.verifyBundle(JSON.parse(JSON.stringify(b)), ledger.keys);
  assert.equal(v.valid, true);
});
test("skipping a lesson is refused", async () => {
  const { ledger, lessons } = await course();
  const { receipt, detail } = await ledger.submit({ did: "complete", this: "course.lesson@1", with: { course: "logline-101", lesson: 4, score: 99 }, cites: { previous: lessons[1].id } }, { by: "p:ana" });
  assert.equal(receipt.header.status, "registered"); // lesson 2 was already consumed by lesson 3
  assert.match(detail.unmet[0], /already been used/);
});
test("certificate before finishing is refused", async () => {
  const { ledger, lessons } = await course();
  const { receipt, detail } = await ledger.submit({ did: "certify", this: "course.certificate.logline-101@1", with: { course: "logline-101" }, cites: { last: lessons[3].id } }, { by: "p:ana" });
  assert.equal(receipt.header.status, "not");
  assert.deepEqual(detail.findings.filter((f) => f.result === "not").map((f) => f.step), ["all_lessons"]);
});
test("a second certificate from the same trajectory is refused", async () => {
  const { ledger, lessons, cert } = await course();
  // the identical request is the same submission: the existing certificate comes back
  const same = await ledger.submit({ did: "certify", this: "course.certificate.logline-101@1", with: { course: "logline-101" }, cites: { last: lessons[4].id } }, { by: "p:ana" });
  assert.equal(same.replayed, true); assert.equal(same.receipt.id, cert.id);
  // any other request citing the same last lesson finds it already consumed
  const other = await ledger.submit({ did: "certify", this: "course.certificate.logline-101@1", with: { course: "logline-101", name: "Ana" }, cites: { last: lessons[4].id } }, { by: "p:ana" });
  assert.equal(other.receipt.header.status, "registered");
  assert.match(other.detail.unmet[0], /already been used/);
});
test("a forged ancestor breaks the bundle at that ancestor", async () => {
  const { ledger, cert } = await course();
  const b = ledger.bundle(cert.id);
  b.entries[2].detail.grants.completed = 9; // rewrite history: lesson 3 claims 9 completed
  const v = await L.verifyBundle(b, ledger.keys);
  assert.equal(v.valid, false);
  // lesson 3 fails on its own detail; lesson 4, which cites it, can no longer be replayed; nothing else breaks
  const broken = v.entries.map((e, i) => [i, e.verdict.checks.filter((c) => c.result === "fail").map((c) => c.code)]).filter(([, c]) => c.length);
  assert.deepEqual(broken, [[2, ["detail", "replay"]], [3, ["replay"]]]);
});
test("a bundle missing an ancestor cannot be replayed", async () => {
  const { ledger, cert } = await course();
  const b = ledger.bundle(cert.id);
  b.entries.splice(3, 1);
  const v = await L.verifyBundle(b, ledger.keys);
  assert.equal(v.valid, false);
  assert.ok(failedCodes(v).includes("replay"));
});
test("a bundle verified against another machine's keys fails", async () => {
  const { ledger, cert } = await course();
  const other = (await L.generateMachineKey()).key;
  const v = await L.verifyBundle(ledger.bundle(cert.id), { [other.id]: { jwk: other.public } });
  assert.equal(v.valid, false);
});
test("receipts signed by another machine cannot be cited", async () => {
  const { ledger } = await course();
  const other = new L.MemoryLedger((await L.generateMachineKey()).key);
  await other.publish(load("course.lesson@1.json"));
  const { receipt: foreign } = await other.submit({ did: "complete", this: "course.lesson@1", with: { course: "logline-101", lesson: 1, score: 99 } }, { by: "p:ana" });
  const { receipt, detail } = await ledger.submit({ did: "complete", this: "course.lesson@1", with: { course: "logline-101", lesson: 2, score: 99 }, cites: { previous: foreign.id } }, { by: "p:ana" });
  assert.equal(receipt.header.status, "registered");
  assert.match(detail.unmet[0], /was not found/);
});
test("radio: a listener hears exactly its tuning, and late listeners catch up", async () => {
  const { ledger } = await course();
  const heard = [];
  ledger.listen({ frequency: "course.certificate.*", status: "ok" }, (r) => heard.push(r.id), 0);
  assert.equal(heard.length, 1);
  const all = []; ledger.listen({ by: "p:ana" }, (r) => all.push(r), 0);
  assert.equal(all.length, 6);
  for (const r of all) assert.equal((await L.verify(r, ledger.keys)).valid, true);
});
