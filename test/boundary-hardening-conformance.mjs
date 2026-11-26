export const run = (fields = {}) => ({
  id: "open", after: [], requires: {}, steps: [], if_ok: "ok", if_not: "not", if_doubt: "doubt", ...fields
});
export const law = (fields = {}) => ({
  logline: "process-type@1", id: "boundary@1", issuer: "Reference", recognize: true, runs: [run()], ...fields
});
const long = "x".repeat(60_000);
const amplify = {">": [{len: {concat: Array.from({length: 128}, () => ({var: "large"}))}}, 60_000]};
const compare = {"==": [{var: "large"}, {var: "large"}]};

export async function boundaryHardeningConformance(L, testKey, only) {
  const results = [];
  async function check(name, fn) {
    name = "hardening/" + name;
    if (only && name !== only) return;
    try { await fn(); results.push({name, ok: true}); }
    catch (e) { results.push({name, ok: false, msg: String(e)}); }
  }
  function expect(condition, message) {
    if (!condition) throw Error(message);
  }
  async function rejects(fn, code) {
    try { await fn(); }
    catch (e) { return expect(e.code === code, "expected " + code + ", got " + e.code); }
    throw Error("expected " + code);
  }
  const scope = {tuple: null, machine: {}};
  const evalDate = (d, n) => L.evaluate({add_days: [d, n]}, scope, {left: 10});
  await check("unicode-noncharacters", async () => {
    for (const cp of [0xfdd0, 0xfdef, 0xfffe, 0xffff, 0x1fffe, 0x1ffff, 0x10fffe, 0x10ffff]) {
      const value = String.fromCodePoint(cp);
      const escaped = value.split("").map(x => "\\u" + x.charCodeAt(0).toString(16)).join("");
      for (const input of [JSON.stringify(value), '"' + escaped + '"', '{"' + escaped + '":0}'])
        await rejects(() => L.parseStrict(input), "ijson");
    }
    const neighbors = "😀\uFDCF\uFDF0\uFFFD" + String.fromCodePoint(0x10fffd);
    expect(L.parseStrict(JSON.stringify(neighbors)) === neighbors, "valid Unicode rejected");
  });
  await check("four-digit-calendar", async () => {
    expect(evalDate("0000-01-02", -1) === "0000-01-01", "invalid lower boundary");
    expect(evalDate("9999-12-30", 1) === "9999-12-31", "invalid upper boundary");
    expect(evalDate("2000-02-28", 1) === "2000-02-29", "invalid leap day");
    await rejects(() => evalDate("9999-12-31", 1), "eval_range");
    await rejects(() => evalDate("0000-01-01", -1), "eval_range");
    await rejects(() => evalDate("2026-01-01", 1e20), "eval_range");
  });
  await check("concat-before-allocation", () => rejects(() => L.evaluate(amplify, {
    tuple: {large: long}, machine: {}
  }, {left: 10_000}), "eval_range"));
  await check("array-before-serialization", () => rejects(() => L.evaluate({len: [
    [{var:"large"}, {var:"large"}]
  ]}, {tuple: {large: long}, machine: {}}, {left: 10_000, work: 4_194_304}), "eval_range"));

  await check("shared-scanner-work", async () => {
    const registry = new L.ProcessTypeRegistry();
    const raw = [law({id:"work-1", recognize:{and:Array(20).fill(compare)}}),
      law({id:"work-2", recognize:{and:Array(20).fill(compare)}})].map(L.canonicalize);
    const hashes = await Promise.all(raw.map(text => registry.publish(text)));
    const {hash,snapshot} = await registry.snapshot();
    const result = await L.scan(JSON.stringify({large:{data:long}}), hash, L.canonicalize(snapshot),
      new Map(hashes.map((id,i) => [id,raw[i]])));
    expect(result.outcome === "indeterminate" && result.matches.length === 1 &&
      result.diagnostics[0]?.code === "eval_budget", "partial recognition promoted or work budget reset");
  });

  const ledger = async sink => new L.ProcessLedger(await L.importMachineKey(testKey.jwk), {
    clock: () => "2026-11-26T00:00:00Z", sink
  });
  const access = {by:"boundary-user", canRead:() => true};
  const request = (tuple, submission = "AAAAAAAAAAAAAAAAAAAAAA", continuation) => JSON.stringify({
    tuple, submission, ...(continuation ? {continue:continuation} : {})
  });
  await check("run-amplification-is-doubt", async () => {
    const l = await ledger();
    await l.publish(L.canonicalize(law({runs:[run({
      steps: [{id:"test",check:amplify,if_not:"not",reason:"bounded"}]
    })]})));
    const result = await l.submitText(request({large:long}),access);
    expect(result.receipt.header.status === "doubt" && result.detail.findings[0].error === "eval_range",
      "RUN accepted an oversized intermediate value");
  });
  await check("signed-receipt-byte-limit", async () => {
    const writes = [], notices = [];
    const l = await ledger(record => writes.push(record));
    const keys = ["a","b","c","d"];
    await l.publish(L.canonicalize(law({runs:[run({
      grants: Object.fromEntries(keys.map(k => [k,{var:"large"}])),
      broadcast: [...keys.map(k => "detail.grants." + k), "tuple.pad"]
    })]})));
    l.listen({}, receipt => notices.push(receipt.id));
    const size = receipt => new TextEncoder().encode(L.canonicalize(receipt)).length;
    const sample = await l.submitText(request({large:long,pad:""}),access);
    const space = 245_760 - size(sample.receipt);
    expect(space > 0, "sample does not fit");
    const nonce = "AQEBAQEBAQEBAQEBAQEBAQ";
    await rejects(() => l.submitText(request({large:long,pad:"é".repeat(Math.floor(space / 2)) +
      "x".repeat(space % 2 + 1)},nonce),access), "result_limit");
    expect(l.length === 1 && writes.length === 2 && notices.length === 1, "oversized candidate had effects");
    const exact = await l.submitText(request({large:long,pad:"é".repeat(Math.floor(space / 2)) +
      "x".repeat(space % 2)},nonce),access);
    expect(!exact.replayed && size(exact.receipt) === 245_760, "exact limit rejected or nonce reserved");
  });
  return results;
}
