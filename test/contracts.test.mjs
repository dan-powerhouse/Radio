import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import { parseProcessType, validateRegistrySnapshot } from "../dist/index.js";

const read = name => JSON.parse(readFileSync(new URL("../" + name, import.meta.url), "utf8"));
const schema = read("contracts/radio.schema.json");
// prefixItems intentionally describes entry plus an arbitrary number of successors.
const ajv = new Ajv2020({ strict: true, strictTypes: false, strictTuples: false, strictRequired: false, ownProperties: true });
ajv.addSchema(schema);
const validators = Object.fromEntries(Object.keys(schema.$defs).map(name => [
  name, ajv.getSchema(schema.$id + "#/$defs/" + name)
]));
function check(name, value, valid = true) {
  const fn = validators[name];
  assert.equal(fn(value), valid, name + ": " + JSON.stringify(fn.errors));
}
const h = char => "sha256:" + char.repeat(64);
const nonce = "AAAAAAAAAAAAAAAAAAAAAA"; // structural fixture only; never use as a real nonce.
const cont = { instance: h("a"), run: "review", parents: { open: h("a") } };
const registry = { logline: "registry@1", types: [h("b")], scan_ops: 100 };
const match = { outcome: "unique", matches: [h("b")], selected: h("b"), diagnostics: [], ops_used: 5 };
const entry = { logline: "receipt@2", frequency: "blue@1", status: "ok", activated: true,
  process: "blue@1", process_hash: h("b"), registry_hash: h("c"), run: "open", instance: null,
  input_hash: h("d"), context_hash: h("e"), detail_hash: h("f"), when: "2026-11-25T00:00:00Z",
  by: "p:" + "0".repeat(64), prev: [], public: {} };
const detail = { logline: "detail@2", consequence: "Opened", findings: [], unmet: null, grants: {},
  reason: null, recognition: match };
const context = { logline: "context@1", submission: nonce, request_hash: h("d"), continue: null,
  spent: [], completed: null, resolved: { root: null, parents: {}, cites: {} } };
const receipt = { header: entry, id: h("a"), sig: { alg: "Ed25519", key: h("1"), value: "A".repeat(86) } };
// Fixtures are structural examples, not authentic signed receipts or replay evidence.
test("contract: every named schema compiles, root rejects unqualified validation", () => {
  for (const [name, fn] of Object.entries(validators)) assert.equal(typeof fn, "function", name);
  assert.equal(ajv.getSchema(schema.$id)({}), false);
});
const laws = read("vectors/process-types.json");
const structuralFailures = new Set([
  "unknown-law-field", "legacy-law", "reserved-frequency", "empty-runs", "duplicate-parent", "second-entry",
  "unknown-dead-branch", "inherited-operator", "machine-recognition", "dynamic-path", "missing-path-argument",
  "budget-above-limit", "automatic-reaction-not-law"
]);
for (const c of laws.cases) {
  if (c.expected.hash) test("contract: existing valid law " + c.name, () => {
    check("ProcessType", JSON.parse(c.input_json));
    parseProcessType(c.input_json);
  });
  else if (structuralFailures.has(c.name)) test("contract: existing invalid shape " + c.name, () => {
    check("ProcessType", JSON.parse(c.input_json), false);
    assert.throws(() => parseProcessType(c.input_json));
  });
  else test("contract: semantic/raw-byte rejection remains outside schema " + c.name, () => {
    // These cases test DAG identity/role constraints or invalid raw I-JSON.
    assert.throws(() => parseProcessType(c.input_json));
  });
}
for (const [i, op] of laws.registry.steps.entries()) {
  if (op.expected.snapshot) test("contract: existing registry snapshot " + i, () => {
    check("Registry", op.expected.snapshot);
    validateRegistrySnapshot(op.expected.snapshot);
  });
}
const scans = read("vectors/recognition.json");
for (const c of scans.cases) if (c.expected.outcome) test("contract: existing scanner evidence " + c.name,
  () => check("Recognition", c.expected));

const variants = [
  ["free null tuple", "Submission", { tuple: null, submission: nonce }, true],
  ["free array tuple", "Submission", { tuple: [1, "x", false], submission: nonce }, true],
  ["free spoofed claim is data, not authority", "Submission", { tuple: { who: "admin", by: "other", this: "wrong@1" }, submission: nonce }, true],
  ["free own prototype key", "Submission", { tuple: JSON.parse('{"__proto__":1}'), submission: nonce }, true],
  ["continuation", "Submission", { tuple: { with: { score: 80 } }, submission: nonce, continue: cont }, true],
  ["missing nonce", "Submission", { tuple: {} }, false],
  ["short nonce", "Submission", { tuple: {}, submission: "x" }, false],
  ["padded nonce", "Submission", { tuple: {}, submission: nonce + "=" }, false],
  ["caller attests identity", "Submission", { tuple: {}, submission: nonce, by: "admin" }, false],
  ["caller supplies observed spent", "Submission", { tuple: {}, submission: nonce, spent: [] }, false],
  ["caller chooses law", "Submission", { tuple: {}, submission: nonce, process_hash: h("b") }, false],
  ["null continuation not omission", "Submission", { tuple: {}, submission: nonce, continue: null }, false],
  ["unknown continuation field", "Continuation", { ...cont, latest: true }, false],
  ["bad parent address", "Continuation", { ...cont, parents: { open: "A1" } }, false],
  ["bad run id", "Continuation", { ...cont, run: "review.next" }, false],
  ["request hash inputs", "RequestHashInput", { tuple: null, continue: null }, true],
  ["request hash excludes nonce", "RequestHashInput", { tuple: null, continue: null, submission: nonce }, false],
  ["key hash inputs", "SubmissionKeyInput", { by: entry.by, submission: nonce }, true],
  ["registry snapshot", "Registry", registry, true],
  ["duplicate law hash", "Registry", { ...registry, types: [h("b"), h("b")] }, false],
  ["invalid scan limit", "Registry", { ...registry, scan_ops: 0 }, false],
  ["unique match lacks selection", "Recognition", { ...match, selected: null }, false],
  ["ambiguous with one match", "Recognition", { ...match, outcome: "ambiguous", selected: null }, false],
  ["indeterminate with selected law", "Recognition", { ...match, outcome: "indeterminate", diagnostics: [{ law_hash: h("c"), code: "eval_budget" }] }, false],
  ["indeterminate lacks diagnostic", "Recognition", { ...match, outcome: "indeterminate", selected: null }, false],
  ["entry header", "HeaderV2", entry, true],
  ["successor header", "HeaderV2", { ...entry, run: "review", instance: h("a"), prev: [h("a")] }, true],
  ["registered matched", "HeaderV2", { ...entry, status: "registered", activated: false }, true],
  ["registered unmatched", "HeaderV2", { ...entry, status: "registered", activated: false, frequency: "_unaddressed", process: null, process_hash: null, run: null }, true],
  ["unmatched success", "HeaderV2", { ...entry, frequency: "_unaddressed", process: null, process_hash: null, run: null }, false],
  ["registered but activated", "HeaderV2", { ...entry, status: "registered" }, false],
  ["inactive success", "HeaderV2", { ...entry, activated: false }, false],
  ["unbound run", "HeaderV2", { ...entry, process_hash: null }, false],
  ["unknown public header claim", "HeaderV2", { ...entry, spent: [] }, false],
  ["legacy depth", "HeaderV2", { ...entry, depth: 0 }, false],
  ["duplicate predecessor", "HeaderV2", { ...entry, prev: [h("a"), h("a")] }, false],
  ["receipt envelope", "ReceiptV2", receipt, true],
  ["wrong signature algorithm", "ReceiptV2", { ...receipt, sig: { ...receipt.sig, alg: "HS256" } }, false],
  ["truncated signature", "ReceiptV2", { ...receipt, sig: { ...receipt.sig, value: "AA" } }, false],
  ["detail with scanner evidence", "DetailV2", detail, true],
  ["continuation detail", "DetailV2", { ...detail, recognition: null }, true],
  ["reason absent", "DetailV2", Object.fromEntries(Object.entries(detail).filter(([k]) => k !== "reason")), false],
  ["legacy detail version", "DetailV2", { ...detail, logline: "detail@1" }, false],
  ["context entry draft", "ContextV1", context, true],
  ["context successor draft", "ContextV1", { ...context, continue: cont, resolved: { root: h("a"), parents: { open: h("a") }, cites: {} } }, true],
  ["context duplicate spent pair", "ContextV1", { ...context, spent: [{ slot: "proof", id: h("a") }, { slot: "proof", id: h("a") }] }, false],
  ["context distinct slots", "ContextV1", { ...context, spent: [{ slot: "one", id: h("a") }, { slot: "two", id: h("a") }] }, true],
  ["context fabricated by field", "ContextV1", { ...context, by: "admin" }, false],
  ["bundle with scalar and receipt", "BundleV2", { logline: "bundle@2", head: h("a"), keys: {}, objects: { [h("a")]: receipt, [h("d")]: null } }, true],
  ["bundle arbitrary tuple may resemble envelope", "BundleV2", { logline: "bundle@2", head: h("a"), keys: {}, objects: { [h("d")]: { logline: "receipt@2", custom: true } } }, true],
  ["bundle malformed address", "BundleV2", { logline: "bundle@2", head: h("a"), keys: {}, objects: { wrong: {} } }, false],
  ["private key not public evidence", "KeyRing", { [h("a")]: { jwk: { kty: "OKP", crv: "Ed25519", x: "A".repeat(43), d: "secret" } } }, false]
];
for (const [name, definition, value, valid] of variants)
  test("contract: " + name, () => check(definition, value, valid));

// Structural validity MUST NOT be advertised as semantic acceptance.
test("contract: sorted order and reference binding require the semantic validator", () => {
  const wrong = { ...registry, types: [h("f"), h("a")] };
  check("Registry", wrong);
  assert.throws(() => validateRegistrySnapshot(wrong));
  check("Recognition", { ...match, selected: h("a") }); // replay must reject the swapped selection
  check("ReceiptV2", receipt); // fake address and fake signature, never a verified receipt
});

const fixtures = read("vectors/receipt-v2-contract.json");
const trustedJwk = read("vectors/test-key.json").jwk;
const publicJwk = { kty: trustedJwk.kty, crv: trustedJwk.crv, x: trustedJwk.x };
const { createHash, createPublicKey, verify: cryptoVerify } = await import("node:crypto");
// Independent ASCII/small-integer canonical subset, used only for this fixture.
function stable(value) {
  if (Array.isArray(value)) return "[" + value.map(stable).join(",") + "]";
  if (value !== null && typeof value === "object")
    return "{" + Object.keys(value).sort().map(k => JSON.stringify(k) + ":" + stable(value[k])).join(",") + "}";
  return JSON.stringify(value);
}
const hash = value => "sha256:" + createHash("sha256").update(stable(value)).digest("hex");
for (const f of fixtures.cases) test("contract: independent v2 signed fixture " + f.name, () => {
  check("Submission", f.request);
  check("BundleV2", f.bundle);
  const { objects, head, keys } = f.bundle;
  assert.equal(head, f.receipt_id);
  assert.deepEqual(keys, { [hash(publicJwk)]: { jwk: publicJwk } }); // independent trust, never import bundled keys as authority
  const pub = createPublicKey({ key: publicJwk, format: "jwk" });
  for (const [address, value] of Object.entries(objects)) {
    if (value?.header?.logline === "receipt@2") {
      check("ReceiptV2", value);
      const h = value.header;
      assert.equal(address, value.id);
      assert.equal(address, hash(h));
      assert.equal(value.sig.key, hash(publicJwk));
      const signature = Buffer.from(value.sig.value, "base64url");
      assert(cryptoVerify(null, Buffer.from("logline-receipt-v2:" + address), pub, signature));
      assert(!cryptoVerify(null, Buffer.from("logline-receipt-v1:" + address), pub, signature));
      check("ProcessType", objects[h.process_hash]);
      check("Registry", objects[h.registry_hash]);
      check("ContextV1", objects[h.context_hash]);
      check("DetailV2", objects[h.detail_hash]);
      assert(objects[h.registry_hash].types.includes(h.process_hash));
      assert.equal(objects[h.process_hash].id, h.process);
      assert.equal(h.frequency, h.process);
      const run = objects[h.process_hash].runs.find(r => r.id === h.run);
      assert(run);
      const context = objects[h.context_hash];
      assert.equal(context.request_hash, hash({tuple:objects[h.input_hash],continue:context.continue}));
      assert.deepEqual(Object.keys(context.resolved.parents).sort(), [...run.after].sort());
      if (h.instance !== null) {
        assert.equal(context.continue.instance, h.instance);
        assert.equal(context.resolved.root, h.instance);
        const root = objects[h.instance].header;
        assert.equal(root.instance, null);
        assert.equal(root.process_hash, h.process_hash);
        assert.equal(root.registry_hash, h.registry_hash);
        for (const [role,id] of Object.entries(context.resolved.parents)) {
          assert.equal(objects[id].header.run, role);
          assert.equal(objects[id].header.instance ?? id, h.instance);
          assert(h.prev.includes(id));
        }
      } else assert.equal(context.continue, null);
      for (const id of h.prev) assert(objects[id]);
    } else assert.equal(address, hash(value));
  }
  const h = objects[head].header;
  assert.equal(h.input_hash, hash(f.request.tuple));
  assert.equal(f.submission_key, hash({by:h.by,submission:f.request.submission}));
});

// Review regressions: these were accepted by the first projection.
test("contract: binary encodings have one canonical spelling", () => {
  for (const n of [23, 24, 26, 27, 28, 128]) {
    check("Nonce", "A".repeat(n));
  }
  for (const n of [21, 25, 29, 125, 129]) check("Nonce", "A".repeat(n), false);
  check("Nonce", "A".repeat(21) + "B", false); // nonzero unused bits
  check("Nonce", "A".repeat(22) + "B", false);
  check("Signature", { ...receipt.sig, value: "A".repeat(85) + "B" }, false);
  check("PublicKey", { ...publicJwk, x: "A".repeat(42) + "B" }, false);
});
test("contract: scanner diagnostics are closed to specified codes", () => {
  check("Diagnostic", { law_hash: h("b"), code: "eval_missing" });
  check("Diagnostic", { law_hash: h("b"), code: "recognize_non_boolean" });
  check("Diagnostic", { law_hash: h("b"), code: "database connection failed" }, false);
});
test("contract: public projection names are law paths, not arbitrary header keys", () => {
  check("HeaderV2", { ...entry, public: { "detail.grants.owner": "p:example", "tuple.did": "request" } });
  check("HeaderV2", { ...entry, public: { account_uuid: "private" } }, false);
});
test("contract: initial context cannot carry continuation observations", () => {
  check("ContextV1", { ...context, completed: h("a") }, false);
  check("ContextV1", { ...context, resolved: { ...context.resolved, root: h("a") } }, false);
  check("ContextV1", { ...context, resolved: { ...context.resolved, parents: { open: h("a") } } }, false);
});
test("contract: finding result and explanatory fields agree", () => {
  check("Finding", { step: "score", result: "ok", error: "eval_missing" }, false);
  check("Finding", { step: "score", result: "not" }, false);
  check("Finding", { step: "score", result: "doubt", reason: "Missing evidence" });
  check("Finding", { step: "score", result: "not", reason: "Rejected", error: "eval_missing" }, false);
});
test("contract: nonempty unmet implies no findings or grants", () => {
  check("DetailV2", { ...detail, unmet: [] }, false);
  check("DetailV2", { ...detail, unmet: ["Missing required evidence"], grants: {} }, false);
  check("DetailV2", { ...detail, unmet: ["Missing required evidence"], grants: null, findings: [{ step: "s", result: "ok" }] }, false);
});

const decision = { header: entry, detail, context };
const unmet = { ...detail, reason: "requires_unmet", unmet: ["with.subject"], grants: null };
const refused = { ...detail, recognition: null, grants: null, reason: "check_not",
  findings: [{ step: "owner", result: "not", reason: "Owner required" }] };
const continuationContext = { ...context, continue: cont, resolved: { root: h("a"), parents: { open: h("a") }, cites: {} } };
const continuationHeader = { ...entry, run: "review", instance: h("a"), prev: [h("a")] };
const noMatch = { outcome: "none", matches: [], selected: null, diagnostics: [], ops_used: 0 };
const unaddressed = { ...entry, status: "registered", activated: false, frequency: "_unaddressed",
  process: null, process_hash: null, run: null };
const parts = [
  ["successful entry", decision, true],
  ["successful successor", { header: continuationHeader, detail: { ...detail, recognition: null }, context: continuationContext }, true],
  ["registered with unmet", { header: { ...entry, status: "registered", activated: false }, detail: unmet, context }, true],
  ["registered without match", { header: unaddressed, detail: { ...unmet, recognition: noMatch, reason: "recognition_none" }, context }, true],
  ["refused successor", { header: { ...continuationHeader, status: "not" }, detail: refused, context: continuationContext }, true],
  ["doubt with error", { header: { ...continuationHeader, status: "doubt" }, detail: { ...refused, reason: "check_doubt", findings: [{ step: "score", result: "doubt", reason: "Score unavailable", error: "eval_missing" }] }, context: continuationContext }, true],
  ["success with failure reason", { ...decision, detail: { ...detail, reason: "check_not" } }, false],
  ["success with unmet", { ...decision, detail: unmet }, false],
  ["success with negative finding", { ...decision, detail: { ...detail, findings: [{ step: "owner", result: "not", reason: "Owner required" }] } }, false],
  ["registered with successful detail", { ...decision, header: { ...entry, status: "registered", activated: false } }, false],
  ["refused with grants", { header: { ...continuationHeader, status: "not" }, detail: { ...refused, grants: {} }, context: continuationContext }, false],
  ["not without negative finding", { header: { ...continuationHeader, status: "not" }, detail: { ...refused, findings: [] }, context: continuationContext }, false],
  ["doubt with higher priority not", { header: { ...continuationHeader, status: "doubt" }, detail: { ...refused, findings: [...refused.findings, { step: "score", result: "doubt", reason: "Unknown" }] }, context: continuationContext }, false],
  ["entry with successor instance", { ...decision, header: continuationHeader }, false],
  ["entry without recognition", { ...decision, detail: { ...detail, recognition: null } }, false],
  ["successor scanned again", { header: continuationHeader, detail, context: continuationContext }, false],
  ["no match but selected law", { header: { ...entry, status: "registered", activated: false }, detail: { ...unmet, recognition: noMatch }, context }, false],
  ["no match but consumed citation", { header: unaddressed, detail: { ...unmet, recognition: noMatch }, context: { ...context, spent: [{ slot: "proof", id: h("a") }] } }, false],
  ["no match but causal ancestor", { header: { ...unaddressed, prev: [h("a")] }, detail: { ...unmet, recognition: noMatch }, context }, false]
];
for (const [name, value, expected] of parts)
  test("contract assembly: " + name, () => check("DecisionParts", value, expected));
for (const f of fixtures.cases) test("contract assembly: signed fixture " + f.name, () => {
  const { objects, head } = f.bundle;
  const header = objects[head].header;
  check("DecisionParts", { header, detail: objects[header.detail_hash], context: objects[header.context_hash] });
});

test("contract: absolute end of identifiers and encodings", () => {
  for (const [name, value] of [
    ["Hash", h("a")], ["RunId", "open"], ["Frequency", "blue@1"],
    ["Nonce", nonce], ["When", entry.when], ["BroadcastPath", "tuple.did"]
  ]) {
    for (const ending of ["\n", "\r", "\r\n", "\u2028", "\u2029"]) check(name, value + ending, false);
  }
  check("RunExpression", { var: "$by\n" }, false);
  check("RunExpression", { var: "$parents.open.id\n" }, false);
  check("RunExpression", { var: "$parents.open.detail." }, false);
  check("RunExpression", { var: "$parents.open.detail.grants.owner" });
});
test("contract review: known law but unknown requested RUN", () => {
  const request = { ...cont, run: "unknown" };
  const c = { ...context, continue: request, resolved: { root: h("a"), parents: {}, cites: {} } };
  const header = { ...continuationHeader, status: "registered", activated: false, run: null };
  const d = { ...unmet, recognition: null, reason: "run_unavailable" };
  check("DecisionParts", { header, detail: d, context: c });
  check("DecisionParts", { header: { ...header, instance: null }, detail: d, context: c }, false);
  check("DecisionParts", { header: { ...header, run: null, status: "ok", activated: true }, detail: d, context: c }, false);
  check("DecisionParts", { header, detail: unmet, context }, false);
});
test("contract: unresolved continuation has no invented ancestry or claims", () => {
  const c = { ...context, continue: cont };
  const d = { ...unmet, recognition: null, reason: "continuation_unavailable" };
  check("DecisionParts", { header: unaddressed, detail: d, context: c });
  check("DecisionParts", { header: { ...unaddressed, instance: h("a") }, detail: d, context: c }, false);
  check("DecisionParts", { header: unaddressed, detail: d, context: { ...c, completed: h("a") } }, false);
  check("DecisionParts", { header: unaddressed, detail: d, context: continuationContext }, false);
});
test("contract review: primary reason codes do not contain host messages", () => {
  for (const value of ["recognition_ambiguous", "run_unavailable", "cites_unmet", "grants_doubt"])
    check("ReasonCodeDraft", value);
  check("ReasonCodeDraft", "relation receipts does not exist", false);
});
test("contract assembly: selection, root and conflicts constrain disposition", () => {
  check("DecisionParts", { header: unaddressed, detail: unmet, context }, false);
  check("DecisionParts", { header: continuationHeader, detail: { ...detail, recognition: null }, context: { ...context, continue: cont } }, false);
  check("DecisionParts", { header: { ...continuationHeader, instance: null }, detail: { ...detail, recognition: null }, context: continuationContext }, false);
  check("DecisionParts", { header: continuationHeader, detail: { ...detail, recognition: null }, context: { ...continuationContext, completed: h("b") } }, false);
  check("DecisionParts", { ...decision, context: { ...context, spent: [{ slot: "proof", id: h("a") }] } }, false);
});
