// Generates vectors/receipts.json. Run only when the spec changes on purpose:
// the output is committed and every implementation must reproduce it byte for byte.
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import * as L from "../dist/index.js";

const keyPath = new URL("../vectors/test-key.json", import.meta.url);
if (!existsSync(keyPath)) {
  const { privateJwk } = await L.generateMachineKey();
  writeFileSync(keyPath, JSON.stringify({ WARNING: "TEST VECTORS ONLY. Public on purpose. Never trust receipts signed by this key.", jwk: privateJwk }, null, 2) + "\n");
}
const key = await L.importMachineKey(JSON.parse(readFileSync(keyPath)).jwk);

const visa = {
  logline: "process@1",
  id: "visa.tourist@1",
  issuer: "Example Consulate (conformance fixture)",
  accepts: { did: "apply" },
  requires: {
    "with.passport.number": "string", "with.passport.expiry": "date",
    "with.travel.arrival": "date", "with.travel.stay_days": "integer",
    "with.travel.purpose": "string", "with.travel.return_ticket": "boolean",
    "with.means.funds_usd": "number", "with.history.previous_overstay": "boolean"
  },
  steps: [
    { id: "passport_validity", check: { ">=": [{ days_between: [{ var: "with.travel.arrival" }, { var: "with.passport.expiry" }] }, 180] }, if_not: "not", reason: "The passport must be valid for 180 days after arrival." },
    { id: "arrival_in_future", check: { ">=": [{ days_between: [{ var: "$today" }, { var: "with.travel.arrival" }] }, 1] }, if_not: "not", reason: "Arrival must be after the date of application." },
    { id: "stay_limit", check: { "<=": [{ var: "with.travel.stay_days" }, 90] }, if_not: "not", reason: "A tourist stay cannot exceed 90 days." },
    { id: "purpose", check: { in: [{ var: "with.travel.purpose" }, ["tourism", "family visit", "business meeting"]] }, if_not: "not", reason: "The purpose is not covered by a tourist visa." },
    { id: "sufficient_funds", check: { ">=": [{ var: "with.means.funds_usd" }, { "*": [{ var: "with.travel.stay_days" }, 80] }] }, if_not: "doubt", reason: "Funds are below 80 USD per day of stay." },
    { id: "return_ticket", check: { "==": [{ var: "with.travel.return_ticket" }, true] }, if_not: "doubt", reason: "No return ticket was declared." },
    { id: "no_previous_overstay", check: { "==": [{ var: "with.history.previous_overstay" }, false] }, if_not: "not", reason: "A previous overstay was declared." }
  ],
  grants: { entries: "single", valid_from: { var: "with.travel.arrival" }, valid_until: { add_days: [{ var: "with.travel.arrival" }, 90] }, max_stay_days: { var: "with.travel.stay_days" } },
  if_ok: "Entry permitted within the granted window.",
  if_doubt: "Referred to an officer. No entry permission yet.",
  if_not: "Refused. The findings state why.",
  broadcast: ["detail.grants.valid_until"],
  time: "day"
};
const t = (salt, w) => ({ who: "applicant", did: "apply", this: "visa.tourist@1", salt, with: w });
const ok = t("q3hGq1K0d5nR7xW2fYc8Aa", { passport: { number: "UT4829173", expiry: "2031-06-30" }, travel: { arrival: "2027-02-10", stay_days: 21, purpose: "tourism", return_ticket: true }, means: { funds_usd: 4200 }, history: { previous_overstay: false } });
const notT = t("Zp0bW1xR4yLk9cVt2mNs3Q", { passport: { number: "TK0917364", expiry: "2027-05-01" }, travel: { arrival: "2027-03-01", stay_days: 14, purpose: "business meeting", return_ticket: true }, means: { funds_usd: 6000 }, history: { previous_overstay: false } });
const doubtT = t("Hc7uYw2Gk1pQ0rTz5vBn8E", { passport: { number: "FR5531208", expiry: "2033-01-14" }, travel: { arrival: "2027-04-05", stay_days: 30, purpose: "family visit", return_ticket: false }, means: { funds_usd: 900 }, history: { previous_overstay: false } });
const freeForm = { who: "Marta Silva", did: "request", this: "visa.tourist@1", with: { passport: "UT1234567", trip: "two weeks in March", money: "enough" } };
let deep = 1; for (let i = 0; i < 25; i++) deep = { "+": [1, deep] }; // 25 operations, budget 20
const looping = { ...visa, id: "budget.demo@1", limits: { ops: 20 }, broadcast: [], steps: [
  { id: "expensive", check: { ">=": [deep, 0] }, if_not: "not", reason: "Expensive check." }] };
const budgetT = { ...ok, this: "budget.demo@1" };
const when = "2026-11-25T12:00:00Z";
const P1 = "sha256:" + "1".repeat(64), P2 = "sha256:" + "2".repeat(64);

const cases = [
  ["ok", visa, ok, { when, by: "p:demo-ana" }],
  ["not", visa, notT, { when, by: "p:demo-kenji" }],
  ["doubt", visa, doubtT, { when, by: "p:demo-lea" }],
  ["registered-free-form", visa, freeForm, { when, by: "p:demo-marta" }],
  ["registered-no-process", null, { did: "hello", this: "Not A Frequency!" }, { when }],
  ["budget-exhausted", looping, budgetT, { when }],
  ["prev-sorted-deduped", visa, ok, { when, prev: [P2, P1, P2] }]
];
// Trajectory: lesson 1 → lesson 2 (cites 1) → certificate-like spent case.
const lessonP = JSON.parse(readFileSync(new URL("../processes/course.lesson@1.json", import.meta.url)));
const keys = { [key.id]: { jwk: key.public } };
const store = new Map();
const S = { receipt: async (id) => store.get(id) ?? null };
const l1t = { who: "learner", did: "complete", this: "course.lesson@1", with: { course: "logline-101", lesson: 1, score: 88 } };
const l1 = await L.issue(key, lessonP, l1t, { when: "2026-11-25T10:00:00Z", by: "p:ana" });
store.set(l1.receipt.id, l1);
const l2t = { ...l1t, with: { ...l1t.with, lesson: 2, score: 91 }, cites: { previous: l1.receipt.id } };
const citeCases = [
  ["cite-lesson1", lessonP, l1t, { when: "2026-11-25T10:00:00Z", by: "p:ana" }, []],
  ["cite-lesson2-cites-lesson1", lessonP, l2t, { when: "2026-11-25T11:00:00Z", by: "p:ana" }, [l1]],
  ["cite-someone-elses", lessonP, l2t, { when: "2026-11-25T11:00:00Z", by: "p:bob" }, [l1]],
  ["cite-spent", lessonP, l2t, { when: "2026-11-25T12:00:00Z", by: "p:ana", spent: [l1.receipt.id] }, [l1]],
  ["cite-missing", lessonP, l2t, { when: "2026-11-25T11:00:00Z", by: "p:ana" }, []],
];
const out = { about: "Receipt goldens. Inputs: process, tuple, options. Signed with vectors/test-key.json.", key_id: key.id, public_jwk: key.public, cases: [] };
for (const [name, process, tuple, options] of cases) {
  const { receipt, detail } = await L.issue(key, process, tuple, options);
  out.cases.push({ name, process, tuple, options,
    expected: { header_jcs: L.canonicalize(receipt.header), id: receipt.id, detail_jcs: L.canonicalize(detail), signature: receipt.sig.value } });
}
for (const [name, process, tuple, options, cited] of citeCases) {
  const local = new Map(cited.map((c) => [c.receipt.id, c]));
  const { receipt, detail } = await L.issue(key, process, tuple, { ...options, keys, store: { receipt: async (id) => local.get(id) ?? null } });
  out.cases.push({ name, process, tuple, options, cited,
    expected: { header_jcs: L.canonicalize(receipt.header), id: receipt.id, detail_jcs: L.canonicalize(detail), signature: receipt.sig.value } });
}
writeFileSync(new URL("../vectors/receipts.json", import.meta.url), JSON.stringify(out, null, 2) + "\n");
console.log(out.cases.map(c => `${c.name}: ${JSON.parse(c.expected.header_jcs).status}`).join("\n"));
