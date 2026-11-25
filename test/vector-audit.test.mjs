// Independent native-crypto audit of the historical receipt fixtures.
// No import of RADIO. Expected statuses are reviewed against the examples in SPEC.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
