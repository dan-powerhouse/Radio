// The first process: a course taken as a trajectory of receipts.
// Each lesson cites the previous lesson's receipt; the certificate cites the last.
// Run: npm run build && node examples/course.mjs [out-bundle.json]
import { readFileSync, writeFileSync } from "node:fs";
import * as L from "../dist/index.js";

const load = (f) => JSON.parse(readFileSync(new URL("../processes/" + f, import.meta.url), "utf8"));
const { key } = await L.generateMachineKey();
let t = Date.parse("2026-11-25T09:00:00Z");
const clock = () => new Date((t += 3600_000)).toISOString().slice(0, 19) + "Z";
const ledger = new L.MemoryLedger(key, clock);
await ledger.publish(load("course.lesson@1.json"));
await ledger.publish(load("course.certificate.logline-101@1.json"));
await ledger.publish(load("alumni.logline-101@1.json")); // reacts on its own to certificates

// The radio: a teacher listens to everything on course.*; Ana listens for herself.
ledger.listen({}, (r) =>
  console.log(`  📻 ${r.header.depth ? "↳ reaction " : ""}${r.header.frequency.padEnd(34)} ${r.header.status.padEnd(10)} by ${r.header.by}  ${r.id.slice(7, 19)}  public=${JSON.stringify(r.header.public)}`));

const ana = "p:ana", bob = "p:bob";
const lesson = (n, score, previous) => ({ who: "learner", did: "complete", this: "course.lesson@1",
  with: { course: "logline-101", lesson: n, score }, ...(previous ? { cites: { previous } } : {}) });
const say = (s) => console.log("\n" + s);
const show = ({ receipt, detail }) => {
  console.log(`  → ${receipt.header.status}: ${detail.consequence}`);
  for (const f of detail.findings.filter((f) => f.result !== "ok")) console.log(`     ✗ ${f.step}: ${f.reason}`);
  for (const u of detail.unmet ?? []) console.log(`     ∅ ${u}`);
  return receipt;
};

say("Ana completes lesson 1 (cites nothing).");
let last = show(await ledger.submit(lesson(1, 88), { by: ana }));
const lesson1 = last;
for (const [n, score] of [[2, 91], [3, 64], [3, 79], [4, 95], [5, 85]]) {
  say(`Ana submits lesson ${n}, score ${score}, citing ${last.id.slice(7, 19)}.`);
  const r = show(await ledger.submit(lesson(n, score, last.id), { by: ana }));
  if (r.header.status === "ok") last = r;
}

say("Ana tries to fork her trajectory: a second lesson 2 citing lesson 1 again.");
show(await ledger.submit(lesson(2, 100, lesson1.id), { by: ana }));

say("Bob tries to continue Ana's trajectory by citing her lesson 5.");
show(await ledger.submit(lesson(6, 99, last.id), { by: bob }));

say("Bob asks for a certificate citing Ana's lesson 5.");
show(await ledger.submit({ who: "learner", did: "certify", this: "course.certificate.logline-101@1", with: { course: "logline-101" }, cites: { last: last.id } }, { by: bob }));

say("Ana asks for her certificate, citing lesson 5. The alumni register hears it on the radio and reacts.");
const certTuple = { who: "learner", did: "certify", this: "course.certificate.logline-101@1", with: { course: "logline-101" }, cites: { last: last.id } };
const certResult = await ledger.submit(certTuple, { by: ana, when: "2026-11-25T23:00:00Z" });
const cert = show(certResult);
const alumni = certResult.reactions[0];

say("Ana's connection drops and her app resends the same request.");
const again = await ledger.submit(certTuple, { by: ana, when: "2026-11-25T23:00:00Z" });
console.log(`  → replayed=${again.replayed}: same receipt ${again.receipt.id === cert.id ? "returned" : "NOT returned"}, no new receipt, no second alumni enrollment.`);

say("Someone sends free-form text to the school.");
show(await ledger.submit({ did: "please", this: "course.lesson@1", with: "I finished everything, trust me" }, { by: "p:carol" }));

say("The trajectory behind Ana's alumni enrollment:");
for (const h of ledger.trajectory(alumni.id)) console.log(`  ${h.frequency.padEnd(34)} ${h.status.padEnd(4)} ${JSON.stringify(h.public)}  prev=${h.prev.map((p) => p.slice(7, 15)).join(",") || "∅"}`);

const bundle = ledger.bundle(alumni.id);
const v = await L.verifyBundle(bundle, ledger.keys);
say(`Offline verification of the bundle: ${v.valid ? "VALID" : "INVALID"} — ${v.entries.length} receipts re-run by hash.`);

const out = process.argv[2];
if (out) { writeFileSync(out, JSON.stringify(bundle, null, 2)); console.log(`  bundle written to ${out}`); }
