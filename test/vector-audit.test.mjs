// Independent native-crypto audit of the historical receipt fixtures.
// No import of RADIO. Expected statuses are reviewed against the examples in SPEC.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { createHash, createPublicKey, createPrivateKey, sign, verify } from "node:crypto";
const bytes = name => readFileSync(new URL("../vectors/" + name, import.meta.url));
const digest = x => createHash("sha256").update(x).digest("hex");
const hash = x => "sha256:" + digest(x);
const fixture = JSON.parse(bytes("receipts.json"));
const priv = JSON.parse(bytes("test-key.json")).jwk;
const pub = createPublicKey({ key: fixture.public_jwk, format: "jwk" });
const secret = createPrivateKey({ key: priv, format: "jwk" });
const statuses = {
  ok: "ok", not: "not", doubt: "doubt", "registered-free-form": "registered",
  "registered-no-process": "registered", "budget-exhausted": "doubt", "prev-sorted-deduped": "ok",
  "cite-lesson1": "ok", "cite-lesson2-cites-lesson1": "ok", "cite-someone-elses": "not",
  "cite-spent": "registered", "cite-missing": "registered",
};
test("historical vector files are pinned byte for byte", () => {
  // An intentional protocol change must use a new version, or review this pin explicitly.
  const pins = {
    "jcs.json": "a51a0fb2dbefa2db3c6ef3b5a1c48f20b67ec141a0f6c8a075e2c9bc8f7cd7cf",
    "receipts.json": "998970293c928d51e8103615d9e54bdf7e9351c95ae5cfe6a655d8409fe9c7fc",
    "test-key.json": "bd69db85943a8b2617c2f58fb6c4726bc97fb25f876679aa76846263710ac50a",
  };
  for (const [file, expected] of Object.entries(pins)) assert.equal(digest(bytes(file)), expected, file);
});
test("versioned corpus pins every reviewed vector independently of the runtime", () => {
  const corpus = JSON.parse(bytes("corpus.json"));
  assert.equal(corpus.logline, "radio-conformance@1");
  const names = readdirSync(new URL("../vectors/", import.meta.url))
    .filter(name => name.endsWith(".json") && name !== "corpus.json").sort();
  assert.deepEqual(Object.keys(corpus.files).sort(), names);
  for (const name of names) assert.equal(digest(bytes(name)), corpus.files[name], name);
});
test("independent SHA-256, Ed25519 signatures, and reviewed outcome of every historical receipt", () => {
  const { crv, kty, x } = fixture.public_jwk;
  assert.equal(hash(JSON.stringify({ crv, kty, x })), fixture.key_id);
  assert.deepEqual(Object.keys(statuses).sort(), fixture.cases.map(c => c.name).sort());
  for (const c of fixture.cases) {
    const { header_jcs, detail_jcs, id, signature } = c.expected;
    const header = JSON.parse(header_jcs), detail = JSON.parse(detail_jcs);
    const message = Buffer.from("logline-receipt-v1:" + id);
    assert.equal(hash(header_jcs), id, c.name);
    assert.equal(hash(detail_jcs), header.detail_hash, c.name);
    assert.equal(header.status, statuses[c.name], c.name);
    assert.equal(detail.logline, "detail@1", c.name);
    if (header.status !== "ok") assert.equal(detail.grants, null, c.name);
    const sig = Buffer.from(signature, "base64url");
    assert.equal(sig.length, 64, c.name);
    assert.equal(verify(null, message, pub, sig), true, c.name);
    assert.equal(sign(null, message, secret).toString("base64url"), signature, c.name);
    // The same signature cannot authenticate another domain or a modified ID.
    assert.equal(verify(null, Buffer.from("logline-receipt-v2:" + id), pub, sig), false, c.name);
    assert.equal(verify(null, Buffer.concat([message, Buffer.from("!")]), pub, sig), false, c.name);
  }
});

test("new law and registry goldens have independently consistent content addresses", () => {
  const types = JSON.parse(bytes("process-types.json"));
  for (const c of types.cases) {
    if (!Object.hasOwn(c.expected, "canonical")) continue;
    assert.deepEqual(JSON.parse(c.expected.canonical), JSON.parse(c.input_json), c.name);
    assert.equal(hash(c.expected.canonical), c.expected.hash, c.name);
  }
  for (const s of types.registry.steps) {
    if (s.op !== "snapshot") continue;
    const { logline, scan_ops, types } = s.expected.snapshot;
    // These fixed ASCII keys are listed in canonical order by hand.
    assert.deepEqual(types, [...new Set(types)].sort());
    assert.equal(hash(JSON.stringify({ logline, scan_ops, types })), s.expected.hash);
  }
});

test("native crypto independently authenticates each reviewed v2 receipt and its evidence addresses", () => {
  const entries = JSON.parse(bytes("receipt-v2-contract.json")).cases.map(c => {
    const receipt = c.bundle.objects[c.receipt_id], h = receipt.header;
    assert.equal(c.receipt_id, receipt.id, c.name);
    return {name:c.name, request:c.request, receipt, detail:c.bundle.objects[h.detail_hash],
      context:c.bundle.objects[h.context_hash], keys:c.bundle.keys, submissionKey:c.submission_key};
  });
  const outcomes = JSON.parse(bytes("run-v2.json"));
  for (const {name,request,expected} of outcomes.cases) {
    entries.push({name,request,receipt:expected.receipt,detail:expected.detail,context:expected.context,
      keys:outcomes.keys,submissionKey:expected.submission_key});
  }

  // The fixture oracle covers named members and dense JSON arrays. Refuse
  // numeric object member names, whose enumeration order differs from JCS.
  const fixtureJSON = value => JSON.stringify(value, (_,v) => {
    if (v === null || typeof v !== "object" || Array.isArray(v)) return v;
    const names = Object.keys(v).sort();
    assert.ok(names.every(name => !/^\d+$/.test(name)));
    return Object.fromEntries(names.map(name => [name,v[name]]));
  });
  assert.equal(entries.length,31);
  for (const {name,request,receipt,detail,context,keys,submissionKey} of entries) {
    const {header:h,id,sig} = receipt;
    const {jwk} = keys[sig.key];
    assert.equal(hash(fixtureJSON(jwk)),sig.key,name);
    assert.equal(hash(fixtureJSON(h)),id,name);
    assert.equal(hash(fixtureJSON(detail)),h.detail_hash,name);
    assert.equal(hash(fixtureJSON(context)),h.context_hash,name);
    assert.equal(hash(fixtureJSON(request.tuple)),h.input_hash,name);
    assert.equal(hash(fixtureJSON({tuple:request.tuple,continue:request.continue??null})),context.request_hash,name);
    assert.equal(hash(fixtureJSON({by:h.by,submission:request.submission})),submissionKey,name);
    const key = createPublicKey({key:jwk,format:"jwk"});
    const signature = Buffer.from(sig.value,"base64url");
    assert.equal(verify(null,Buffer.from("logline-receipt-v2:"+id),key,signature),true,name);
    assert.equal(verify(null,Buffer.from("logline-receipt-v1:"+id),key,signature),false,name);
  }
});
