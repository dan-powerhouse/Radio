// Fixed expected decisions and addresses. No code-generated expected outputs.
function same(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object" ||
      Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
  return ka.length === kb.length && ka.every((k, i) => k === kb[i] && same(a[k], b[k]));
}
export async function scannerConformance(L, fixture) {
  if (fixture.format !== "radio-recognition-vectors@1" || !fixture.cases.length ||
      new Set(fixture.cases.map(c => c.name)).size !== fixture.cases.length)
    throw Error("invalid recognition fixture");
  const results = [];
  for (const c of fixture.cases) {
    const snapshot = fixture.snapshots[c.snapshot];
    if (!snapshot) throw Error("unknown fixture snapshot");
    const laws = new Map(Object.entries(fixture.laws));
    for (const [key, value] of Object.entries(c.law_overrides ?? {}))
      if (value === null) laws.delete(key); else laws.set(key, value);
    let observed;
    try {
      observed = await L.scan(c.tuple_json, c.snapshot_hash ?? snapshot.hash,
        c.snapshot_json ?? snapshot.json, laws);
    } catch (err) { observed = { error: err?.code ?? err?.name }; }
    results.push({ name: "scan/" + c.name, ok: same(observed, c.expected),
      msg: JSON.stringify({ expected: c.expected, observed }) });
  }
  return results;
}
