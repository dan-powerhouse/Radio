// Portable, runtime-neutral runner. Expected values live in committed fixtures,
// not in implementation-dependent generators. Every case is a separate verdict.
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
function same(a, b) {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && a.length !== b.length) return false;
  const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
  return ka.length === kb.length && ka.every((k, i) => k === kb[i] && own(b, k) && same(a[k], b[k]));
}
function checkFixture(fixture, format) {
  if (fixture.format !== format || !Array.isArray(fixture.cases) || fixture.cases.length === 0)
    throw Error("missing or wrong fixture: " + format);
  const names = fixture.cases.map(c => c.name);
  if (names.some(n => typeof n !== "string" || !n) || new Set(names).size !== names.length)
    throw Error("invalid or duplicate case names: " + format);
}
export async function kernelConformance(L, fixtures) {
  const { expressions, strict, processTypes } = fixtures;
  checkFixture(expressions, "radio-expression-vectors@1");
  checkFixture(strict, "radio-strict-json-vectors@1");
  checkFixture(processTypes, "radio-process-type-vectors@1");
  const results = [];
  async function verdict(name, expected, fn) {
    let observed;
    try { observed = await fn(); }
    catch (e) { observed = { error: e?.code ?? e?.name ?? "unknown" }; }
    results.push({ name, ok: same(observed, expected), msg: JSON.stringify({ expected, observed }) });
  }
  for (const c of expressions.cases) await verdict("expr/" + c.name, c.expected, () => {
    const budget = { left: c.budget };
    const value = L.evaluate(c.expression, { tuple: c.tuple, machine: c.machine }, budget);
    return { value, ...(own(c.expected, "remaining") ? { remaining: budget.left } : {}) };
  });
  for (const c of strict.cases) await verdict("strict/" + c.name, c.expected, () => ({ value: L.parseStrict(c.input_json) }));
  for (const c of processTypes.cases) await verdict("type/" + c.name, c.expected, async () => {
    const value = L.parseProcessType(c.input_json);
    return { canonical: L.canonicalize(value), hash: await L.hashOf(value) };
  });
  const scenario = processTypes.registry;
  if (!scenario || !Array.isArray(scenario.steps) || !scenario.steps.length) throw Error("missing registry scenario");
  const registry = new L.ProcessTypeRegistry(scenario.scan_ops);
  for (const [i, s] of scenario.steps.entries()) await verdict("registry/" + i + "/" + s.op, s.expected, async () => {
    switch (s.op) {
      case "publish": return { hash: await registry.publish(s.input_json) };
      case "retire": await registry.retire(s.id); return {};
      case "snapshot": return registry.snapshot();
      case "historical-law": return { canonical: L.canonicalize(registry.law(s.hash)) };
      case "historical-snapshot": return { snapshot: registry.snapshotByHash(s.hash) };
      default: throw Error("unknown fixture operation");
    }
  });
  return results;
}

// Cross-runtime adversarial verification uses existing frozen signed evidence.
// It is separate from golden vectors and never creates a new expected signature.
export async function receiptEvidenceConformance(L, receipts) {
  const sample = receipts.cases.find(c => c.name === "ok");
  const cited = receipts.cases.find(c => c.name === "cite-lesson2-cites-lesson1");
  if (!sample || !cited) throw Error("missing historical receipt evidence");
  const keys = { [receipts.key_id]: { jwk: receipts.public_jwk } };
  const fixture = c => ({
    receipt: { header: JSON.parse(c.expected.header_jcs), id: c.expected.id,
      sig: { alg: "Ed25519", key: receipts.key_id, value: c.expected.signature } },
    evidence: { tuple: structuredClone(c.tuple), process: structuredClone(c.process),
      detail: JSON.parse(c.expected.detail_jcs) },
  });
  const results = [];
  async function probe(name, expectedValid, expectedChecks, edit, c = sample) {
    const f = fixture(c);
    let v;
    try {
      const ring = edit(f, keys) ?? keys;
      v = await L.verify(f.receipt, ring, f.evidence);
      const checks = Object.fromEntries(v.checks.map(x => [x.code, x.result]));
      const ok = v.valid === expectedValid && Object.entries(expectedChecks).every(([k, x]) => checks[k] === x);
      results.push({ name: "evidence/" + name, ok, msg: JSON.stringify({ expectedValid, expectedChecks, observed: { valid: v.valid, checks } }) });
    } catch (err) {
      results.push({ name: "evidence/" + name, ok: false, msg: "unexpected exception: " + err });
    }
  }
  await probe("authenticity-only-is-not-replay", true, { signature: "pass", replay: "skipped", input: "skipped", detail: "skipped", process: "skipped" }, f => { f.evidence = {}; });
  await probe("complete", true, { id: "pass", signature: "pass", detail: "pass", input: "pass", process: "pass", replay: "pass" }, () => {});
  await probe("signature-bit-change", false, { signature: "fail" }, f => {
    const s = f.receipt.sig.value;
    f.receipt.sig.value = (s[0] === "A" ? "B" : "A") + s.slice(1);
    f.evidence = {};
  });
  await probe("changed-header", false, { id: "fail" }, f => { f.receipt.header.status = "not"; });
  await probe("untrusted-key", false, { key: "fail", signature: "fail" }, f => { f.evidence = {}; return {}; });
  await probe("changed-detail", false, { detail: "fail", replay: "fail" }, f => { f.evidence.detail.consequence += "!"; });
  await probe("changed-input", false, { input: "fail", replay: "fail" }, f => { f.evidence.tuple.who = "someone else"; });
  await probe("changed-law", false, { process: "fail", replay: "fail" }, f => { f.evidence.process.issuer += "!"; });
  await probe("missing-causal-evidence", false, { signature: "pass", replay: "fail" }, f => {
    f.evidence.store = { receipt: async () => null };
  }, cited);
  return results;
}
