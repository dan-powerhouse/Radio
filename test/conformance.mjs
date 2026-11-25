// Runtime-neutral conformance runner. Takes the library and the vectors; returns results.
export async function conformance(L, jcs, receipts) {
  const out = [];
  const rec = (name, ok, msg = "") => out.push({ name, ok, msg });
  for (const c of jcs.cases) {
    let got; try { got = L.canonicalize(JSON.parse(c.input_json)); } catch (e) { got = "THREW " + e.message; }
    rec("jcs/" + c.name, got === c.expected, got);
  }
  for (const c of jcs.reject) {
    let code = null; try { L.canonicalize(JSON.parse(c.input_json)); } catch (e) { code = e.code; }
    rec("jcs-reject/" + c.name, code === c.code, String(code));
  }
  const keys = { [receipts.key_id]: { jwk: receipts.public_jwk } };
  rec("key-id", (await L.keyId(receipts.public_jwk)) === receipts.key_id);
  for (const c of receipts.cases) {
    const cited = new Map((c.cited ?? []).map((x) => [x.receipt.id, x]));
    const store = { receipt: async (id) => cited.get(id) ?? null };
    const { header, detail, id } = await L.run(c.process, c.tuple, { ...c.options, keys, store });
    const e = c.expected;
    const cas = await L.run(JSON.parse(L.canonicalize(c.process)), JSON.parse(L.canonicalize(c.tuple)), { ...c.options, keys, store });
    rec(`receipt/${c.name}/cas-round-trip`, cas.id === id && L.canonicalize(cas.detail) === L.canonicalize(detail));
    rec(`receipt/${c.name}/header`, L.canonicalize(header) === e.header_jcs);
    rec(`receipt/${c.name}/detail`, L.canonicalize(detail) === e.detail_jcs);
    rec(`receipt/${c.name}/id`, id === e.id && (await L.sha256(e.header_jcs)) === e.id);
    const receipt = { header, id, sig: { alg: "Ed25519", key: receipts.key_id, value: e.signature } };
    const v = await L.verify(receipt, keys, { detail, tuple: c.tuple, process: c.process, store });
    rec(`receipt/${c.name}/verifies`, v.valid && v.checks.every((k) => k.result === "pass"), JSON.stringify(v.checks.filter((k) => k.result !== "pass")));
  }
  return out;
}
