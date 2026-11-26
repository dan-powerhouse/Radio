const stable = v => {
  if (Array.isArray(v)) return "[" + v.map(stable).join(",") + "]";
  if (v !== null && typeof v === "object") return "{" + Object.keys(v).sort().map(k => JSON.stringify(k) + ":" + stable(v[k])).join(",") + "}";
  return JSON.stringify(v);
};
// Independent signed fixtures: no RADIO-produced expected receipts.
export async function runV2Conformance(L, fixture, keyFixture) {
  const key = await L.importMachineKey(keyFixture.jwk);
  const results = [];
  for (const f of fixture.cases) {
    const objects = f.bundle.objects, expected = objects[f.receipt_id], h = expected.header;
    const laws = new Map(Object.entries(objects).filter(([,v]) => v?.logline === "process-type@1").map(([k,v]) => [k, JSON.stringify(v)]));
    const snapshots = new Map(Object.entries(objects).filter(([,v]) => v?.logline === "registry@1").map(([k,v]) => [k, JSON.stringify(v)]));
    let observed;
    try {
      const result = await L.issueV2(key, JSON.stringify(f.request), {
        when: h.when, by: h.by, registryHash: h.registry_hash, laws, snapshots, keys: f.bundle.keys,
        read: async id => objects[id]?.header ? {receipt: objects[id], detail: objects[objects[id].header.detail_hash]} : null,
        completed: async () => null, spent: async () => false
      });
      observed = {receipt: result.receipt, detail: result.detail, context: result.context, submission_key: result.submission_key};
    } catch (err) { observed = {error: err?.code ?? err?.name}; }
    const want = {receipt: expected, detail: objects[h.detail_hash], context: objects[h.context_hash], submission_key: f.submission_key};
    results.push({name: "run-v2/" + f.name, ok: stable(observed) === stable(want), msg: JSON.stringify({want,observed})});
  }
  return results;
}

// Full independent output vectors, including the attested observation boundary.
export async function runV2OutcomeConformance(L, fixture, keyFixture) {
  if (fixture.format !== "radio-run-v2-vectors@1" || !fixture.cases.length ||
      new Set(fixture.cases.map(c=>c.name)).size !== fixture.cases.length) throw Error("invalid RUN fixture");
  const key = await L.importMachineKey(keyFixture.jwk);
  const laws = new Map(Object.entries(fixture.laws).map(([k,v])=>[k,JSON.stringify(v)]));
  const snapshots = new Map(Object.entries(fixture.snapshots).map(([k,v])=>[k,JSON.stringify(v)]));
  const results = [];
  for (const c of fixture.cases) {
    let observed;
    try {
      observed = await L.issueV2(key,JSON.stringify(c.request),{
        when:c.when,by:c.by,registryHash:c.registry,laws,snapshots,keys:fixture.keys,
        read:async id => c.read_exclude.includes(id) ? null : fixture.evidence[id] ?? null,
        completed:async () => c.observed_completed,
        spent:async (lawHash,slot,id) => c.observed_spent.some(p=>p.slot===slot && p.id===id)
      });
    } catch (err) { observed={error:err?.code ?? err?.name}; }
    results.push({name:"run-v2/"+c.name,ok:stable(observed)===stable(c.expected),
      msg:JSON.stringify({want:c.expected,observed})});
  }
  return results;
}
