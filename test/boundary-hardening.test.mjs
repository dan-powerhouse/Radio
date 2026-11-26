import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as L from "../dist/index.js";
import { canonicalBytes } from "../dist/jcs.js";
import { RegistryEvidence } from "../dist/scanner.js";
import { boundaryHardeningConformance, law, run } from "./boundary-hardening-conformance.mjs";

const key = JSON.parse(readFileSync(new URL("../vectors/test-key.json",import.meta.url), "utf8"));
for (const r of await boundaryHardeningConformance(L, key)) test(r.name, () => assert.ok(r.ok, r.msg));

test("publication count limit holds under concurrent attempts and retirement preserves history", async () => {
  const registry = new L.ProcessTypeRegistry();
  const text = i => L.canonicalize(law({id:"capacity-" + i, recognize:false}));
  await Promise.all(Array.from({length:4095}, (_,i) => registry.publish(text(i))));
  const contenders = await Promise.allSettled([registry.publish(text(4095)), registry.publish(text(4096))]);
  assert.equal(contenders.filter(x => x.status === "fulfilled").length, 1);
  const loser = contenders.findIndex(x => x.status === "rejected");
  assert.equal(contenders[loser].reason.code, "scan_limit");
  const old = await registry.snapshot();
  assert.equal(old.snapshot.types.length, 4096);
  const evidence = new Map(old.snapshot.types.map(h => [h,L.canonicalize(registry.law(h))]));
  assert.equal((await L.scan("null",old.hash,L.canonicalize(old.snapshot),evidence)).outcome,"none");
  const retiredHash = registry.hashForId("capacity-0");
  registry.retire("capacity-0");
  await registry.publish(text(4095 + loser));
  assert.equal(await registry.publish(text(0)), retiredHash);
  assert.ok(registry.law(retiredHash));
  assert.ok(registry.snapshotByHash(old.hash).types.includes(retiredHash));
  assert.ok(!(await registry.snapshot()).snapshot.types.includes(retiredHash));
});

test("aggregate law byte limit is checked before the durable publication sink", async () => {
  let writes = 0;
  const ledger = new L.ProcessLedger(await L.importMachineKey(key.jwk), {sink:() => writes++});
  const text = i => {
    const candidate = law({id:"capacity-" + i, recognize:{"==":["",false]}});
    candidate.recognize["=="][0] = "x".repeat(65_536 - Buffer.byteLength(L.canonicalize(candidate)));
    return L.canonicalize(candidate);
  };
  for (let i = 0; i < 256; i++) {
    const json = text(i);
    assert.equal(Buffer.byteLength(json), 65_536);
    await ledger.publish(json);
  }
  await assert.rejects(ledger.publish(text(256)), {code:"scan_limit"});
  assert.equal(writes, 256);
  await ledger.retire("capacity-0");
  await ledger.publish(text(256));
  assert.equal(writes, 258);
});

test("registry evidence is read once across different snapshots and repeated decisions", async () => {
  const json = L.canonicalize(law()), lawHash = await L.sha256(json);
  const snapshots = new Map();
  for (const scan_ops of [10, 20]) {
    const text = L.canonicalize({logline:"registry@1", types:[lawHash], scan_ops});
    snapshots.set(await L.sha256(text), text);
  }
  let lawReads = 0, snapshotReads = 0;
  const evidence = new RegistryEvidence(id => {snapshotReads++; return snapshots.get(id);},
    () => {lawReads++; return json;});
  for (const id of snapshots.keys()) {
    await evidence.recognize(null,id);
    await evidence.recognize({},id);
  }
  assert.equal(lawReads,1);
  assert.equal(snapshotReads,2);
});

test("authoritative oversized evidence fails before copying into the RUN", async () => {
  const snapshot = L.canonicalize({logline:"registry@1", types:[], scan_ops:10});
  const registryHash = await L.sha256(snapshot);
  const instance = "sha256:" + "0".repeat(64);
  const huge = "x".repeat(1_000_000);
  await assert.rejects(L.runV2(JSON.stringify({tuple:null,submission:"AAAAAAAAAAAAAAAAAAAAAA",
    continue:{instance,run:"next",parents:{}}}),{
    when:"2026-11-26T00:00:00Z",by:"boundary",registryHash,laws:new Map(),snapshots:new Map([[registryHash,snapshot]]),keys:{},
    read:async () => ({receipt:{},detail:{first:huge,second:huge}}), completed:async () => null, spent:async () => false
  }), {code:"evidence_limit"});
});

test("canonical size preflight agrees with actual UTF-8 for escaped values and keys", () => {
  const alphabet = ["a","é","€","😀","\u0000","\n","\t","\v","\r",'"',"\\"];
  const overflow = () => { throw Error("size limit"); };
  for (const a of alphabet) for (const b of alphabet) {
    const value = {[a]:[a+b,"",false,0,1e-10,null,{"sorted":b}]};
    const exact = Buffer.byteLength(L.canonicalize(value));
    assert.equal(canonicalBytes(value,exact,overflow),exact);
    assert.throws(() => canonicalBytes(value,exact-1,overflow),/size limit/);
  }
});

test("per-RUN evidence allowance covers the sum of distinct authoritative receipts", async () => {
  const persisted = [];
  const ledger = new L.ProcessLedger(await L.importMachineKey(key.jwk), {
    clock: () => "2026-11-26T00:00:00Z", sink: record => persisted.push(record.kind)
  });
  const access = {by:"boundary",canRead:()=>true};
  let nonce = 0;
  const submit = tuple => ledger.submitText(JSON.stringify({
    tuple, submission:Buffer.alloc(16,++nonce).toString("base64url")
  }),access);
  const source = "evidence-source@1";
  const recognizes = kind => ({"==":[{var:"kind"},kind]});
  await ledger.publish(L.canonicalize(law({
    id:source,recognize:recognizes("source"),runs:[run({
      grants:Object.fromEntries(Array.from({length:16},(_,i) => ["field"+i,{var:"large"}]))
    })]
  })));
  const ids = [];
  for (let i=0; i<9; i++) ids.push((await submit({kind:"source",large:"x".repeat(60_000)})).receipt.id);
  for (const count of [8,9]) {
    const kind = "consumer-"+count;
    const cites = Object.fromEntries(ids.slice(0,count).map((id,i) => ["item"+i,id]));
    await ledger.publish(L.canonicalize(law({id:kind,recognize:recognizes(kind),runs:[run({
      cites:Object.fromEntries(Object.keys(cites).map(slot => [slot,{frequency:source}]))
    })]})));
    const request = {kind,cites};
    if (count === 8) assert.equal((await submit(request)).receipt.header.status,"ok");
    else {
      const before = persisted.length;
      await assert.rejects(submit(request),{code:"evidence_limit"});
      assert.equal(persisted.length,before);
      assert.equal(ledger.length,10);
    }
  }
});

test("portable continuation still requires the complete signed registry", async () => {
  const ledger = new L.ProcessLedger(await L.importMachineKey(key.jwk), {
    clock: () => "2026-11-26T00:00:00Z"
  });
  await ledger.publish(L.canonicalize(law({runs:[run(),run({id:"next",after:["open"]})]})));
  const unrelated = await ledger.publish(L.canonicalize(law({id:"another-law",recognize:false})));
  const access = {by:"boundary",canRead:()=>true};
  const entry = await ledger.submitText(JSON.stringify({tuple:null,submission:"AAAAAAAAAAAAAAAAAAAAAA"}),access);
  const root = entry.receipt.id;
  const step = await ledger.submitText(JSON.stringify({tuple:null,submission:"AQEBAQEBAQEBAQEBAQEBAQ",
    continue:{instance:root,run:"next",parents:{open:root}}}),access);
  const bundle = await ledger.bundle(step.receipt.id);
  assert.equal((await L.verifyBundleV2(L.canonicalize(bundle),ledger.keys)).valid,true);
  delete bundle.objects[unrelated];
  const verdict = await L.verifyBundleV2(L.canonicalize(bundle),ledger.keys);
  assert.equal(verdict.authenticity,"pass");
  assert.equal(verdict.replay,"incomplete");
  assert.ok(verdict.issues.some(issue => issue.code === "missing_object" && issue.id === unrelated));
});
