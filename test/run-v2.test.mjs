import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import * as L from "../dist/index.js";
const read = name => JSON.parse(readFileSync(new URL("../"+name,import.meta.url),"utf8"));
const vectors=read("vectors/run-v2.json"), positive=read("vectors/receipt-v2-contract.json");
const key=await L.importMachineKey(read("vectors/test-key.json").jwk);
const laws=new Map(Object.entries(vectors.laws).map(([k,v])=>[k,JSON.stringify(v)]));
const snapshots=new Map(Object.entries(vectors.snapshots).map(([k,v])=>[k,JSON.stringify(v)]));
const fixture=name=>vectors.cases.find(c=>c.name===name);
const h=ch=>"sha256:"+ch.repeat(64);
const opts=(c,override={})=>({
  by:c.by,when:c.when,registryHash:c.registry,laws:new Map(laws),snapshots:new Map(snapshots),
  keys:structuredClone(vectors.keys),
  read:async id=>c.read_exclude.includes(id)?null:structuredClone(vectors.evidence[id]??null),
  completed:async()=>c.observed_completed,
  spent:async(_law,slot,id)=>c.observed_spent.some(x=>x.slot===slot&&x.id===id),...override
});
const issue=(c,override={},request=c.request)=>L.issueV2(key,JSON.stringify(request),opts(c,override));
const code=x=>e=>e instanceof L.LoglineError&&e.code===x;
const root=positive.cases[0].receipt_id;
const rootRecord=vectors.evidence[root];
const entry=fixture("free-scalar");
const continuation=fixture("retired-law-continuation");
const citation=fixture("legacy-citation");
const legacyId=citation.request.tuple.cites.proof;
const nonce=entry.request.submission;

test("every actual outcome satisfies the approved machine-readable parts and authenticity",async()=>{
  const schema=read("contracts/radio.schema.json");
  const ajv=new Ajv2020({strict:true,strictTypes:false,strictRequired:false,strictTuples:false,ownProperties:true});
  ajv.addSchema(schema);
  for(const c of vectors.cases){
    const r=await issue(c),header=r.receipt.header;
    for(const [name,value] of [["ReceiptV2",r.receipt],["DecisionParts",{header,detail:r.detail,context:r.context}],["Submission",c.request]]){
      const validate=ajv.getSchema(schema.$id+"#/$defs/"+name);
      assert(validate(value),c.name+" "+name+" "+JSON.stringify(validate.errors));
    }
    assert(await L.authenticV2(r.receipt,vectors.keys),c.name);
    assert.equal(await L.hashOf(r.detail),header.detail_hash);
    assert.equal(await L.hashOf(r.context),header.context_hash);
    assert.equal(await L.hashOf(c.request.tuple),header.input_hash);
  }
});
test("strict envelope parsing precedes every read and claim observation",async()=>{
  let calls=0;
  const o=opts(entry,{read:async()=>{calls++;throw Error("unexpected read")},completed:async()=>{calls++;return null},spent:async()=>{calls++;return false}});
  for(const input of [
    '{"tuple":null,"tuple":1,"submission":"'+nonce+'"}',
    '{"tuple":9007199254740993,"submission":"'+nonce+'"}',
    '{"tuple":"\\ud800","submission":"'+nonce+'"}',
    JSON.stringify({tuple:null,submission:nonce,by:"forged"}),
    JSON.stringify({tuple:null,submission:nonce,registry_hash:entry.registry}),
    JSON.stringify({tuple:null,submission:nonce,spent:[]}),
    JSON.stringify({tuple:null,submission:nonce,continue:null}),
    JSON.stringify({tuple:null,submission:nonce,continue:{instance:h("a"),run:"review",parents:{open:"bad"}}}),
    JSON.stringify({tuple:null,submission:"A".repeat(21)+"B"}),
    JSON.stringify({tuple:null,submission:"A".repeat(25)}),
    JSON.stringify({tuple:null,submission:nonce+"="}),
    JSON.stringify({tuple:"a".repeat(L.MAX_SCAN_INPUT_BYTES),submission:nonce}),
    " ".repeat(L.MAX_SUBMISSION_BYTES+1)
  ]) await assert.rejects(()=>L.runV2(input,o),e=>["ijson","submission_invalid","submission_limit"].includes(e.code),input.slice(0,100));
  assert.equal(calls,0);
});
test("calendar and authenticated identity are required, never inferred",async()=>{
  for(const patch of [{when:"2026-02-30T00:00:00Z"},{when:"2026-11-25T00:00:00.001Z"},{by:""},{by:null},{by:"\ud800"}])
    await assert.rejects(()=>issue(entry,patch),code("admission_invalid"));
});
test("exact byte and nesting admission boundaries",()=>{
  const max="a".repeat(L.MAX_SCAN_INPUT_BYTES-2);
  assert.equal(L.parseSubmissionV2(JSON.stringify({tuple:max,submission:nonce})).tuple.length,max.length);
  assert.throws(()=>L.parseSubmissionV2(JSON.stringify({tuple:max+"a",submission:nonce})),code("submission_limit"));
  let v=null;for(let i=0;i<64;i++)v=[v];
  assert(L.parseSubmissionV2(JSON.stringify({tuple:v,submission:nonce})));
  assert.throws(()=>L.parseSubmissionV2(JSON.stringify({tuple:[v],submission:nonce})),code("ijson"));
});
test("v2 signature domain is distinct; unknown fields and mutated signature fail",async()=>{
  const r=structuredClone(rootRecord.receipt);
  assert(await L.authenticV2(r,vectors.keys));
  assert(!(await L.verifyId(key.public,r.id,r.sig.value)));
  assert(await L.verifyIdV2(key.public,r.id,r.sig.value));
  assert(!(await L.authenticV2(vectors.evidence[legacyId].receipt,vectors.keys)));
  const sign=async header=>{const id=await L.hashOf(header);return {header,id,sig:{alg:"Ed25519",key:key.id,value:await L.signIdV2(key,id)}}};
  for(const header of [
    {...r.header,status:"registered",activated:true},
    {...r.header,depth:0},
    {...r.header,process_hash:null},
    {...r.header,frequency:"other@1"},
    {...r.header,when:"2026-02-30T00:00:00Z"},
    {...r.header,prev:[h("b"),h("a")]},
    {...r.header,prev:[h("a"),h("a")]},
    {...r.header,public:{account_uuid:"private"}},
    {...r.header,instance:h("a"),prev:[]},
  ]) assert(!(await L.authenticV2(await sign(header),vectors.keys)),JSON.stringify(header));
  const bad=structuredClone(r);bad.sig.value=(bad.sig.value[0]==="A"?"B":"A")+bad.sig.value.slice(1);
  assert(!(await L.authenticV2(bad,vectors.keys)));
  bad.sig.value=await L.signId(key,r.id);
  assert(!(await L.authenticV2(bad,vectors.keys)));
  assert(!(await L.authenticV2(r,{})));
  assert(!(await L.authenticV2(r,{[key.id]:{jwk:key.public,not_before:"2026-11-26T00:00:00Z"}})));
  assert(!(await L.authenticV2(r,{[key.id]:{jwk:key.public,not_after:"2026-11-24T00:00:00Z"}})));
  const alias=h("a"),wrong={...r,sig:{...r.sig,key:alias}};
  assert(!(await L.authenticV2(wrong,{[alias]:{jwk:key.public}})));
});
test("authoritative read mismatch, corrupted detail and signature are request failures",async()=>{
  for(const corrupt of [
    {...rootRecord,receipt:{...rootRecord.receipt,id:h("a")}},
    {...rootRecord,detail:{...rootRecord.detail,consequence:"tampered"}},
    {...rootRecord,receipt:{...rootRecord.receipt,sig:{...rootRecord.receipt.sig,value:"A".repeat(86)}}}
  ]) await assert.rejects(()=>issue(continuation,{read:async()=>corrupt}),code("evidence_invalid"));
  // Even a valid machine signature cannot make contradictory detail admissible.
  const detail={...rootRecord.detail,reason:"check_not"};
  const header={...rootRecord.receipt.header,detail_hash:await L.hashOf(detail)};
  const id=await L.hashOf(header),r={header,id,sig:{alg:"Ed25519",key:key.id,value:await L.signIdV2(key,id)}};
  assert(await L.authenticV2(r,vectors.keys)); // header-only authenticity is deliberately weaker
  const request={...continuation.request,continue:{...continuation.request.continue,instance:id,parents:{open:id}}};
  await assert.rejects(()=>issue(continuation,{read:async()=>({receipt:r,detail})},request),code("evidence_invalid"));
});
test("failure of authoritative infrastructure is not a signed registration",async()=>{
  await assert.rejects(()=>issue(continuation,{read:async()=>{throw Error("backend unavailable")}}),/backend unavailable/);
  await assert.rejects(()=>issue(continuation,{completed:async()=>{throw Error("claim read failed")}}),/claim read failed/);
  await assert.rejects(()=>issue(citation,{spent:async()=>{throw Error("claim read failed")}}),/claim read failed/);
  await assert.rejects(()=>issue(continuation,{laws:new Map()}),code("evidence_invalid"));
  await assert.rejects(()=>issue(continuation,{snapshots:new Map([[continuation.registry,snapshots.get(continuation.registry)]])}),code("evidence_invalid"));
  await assert.rejects(()=>issue(entry,{snapshots:new Map()}),code("evidence_invalid"));
});
test("caller cannot choose a law by tuple; captured law and trust evidence survive mutation",async()=>{
  const c=fixture("attested-not-tuple-identity"),o=opts(c);
  const p=L.issueV2(key,JSON.stringify(c.request),o);
  o.laws.clear();o.snapshots.clear();delete o.keys[key.id];o.by="forged";o.when="2028-01-01T00:00:00Z";
  assert.equal(L.canonicalize(await p),L.canonicalize(c.expected));
  const ring=structuredClone(vectors.keys),auth=L.authenticV2(rootRecord.receipt,ring);
  delete ring[key.id];assert(await auth);
});
test("same observation is read once even for root, parent and multiple citation roles",async()=>{
  let count=0;
  const read=async id=>{count++;return vectors.evidence[id]??null};
  await issue(continuation,{read});assert.equal(count,1);
  count=0;await issue(fixture("once-slot-scope"),{read});assert.equal(count,1);
});
test("authoritative claim observations are scoped; failure phases do not consult later claims",async()=>{
  const c=fixture("once-slot-scope"),seen=[];
  const result=await issue(c,{spent:async(...args)=>{seen.push(args);return args[1]==="two"}});
  assert.deepEqual(seen,["one","two"].map(slot=>[c.expected.receipt.header.process_hash,slot,legacyId]));
  assert.deepEqual(result.context.spent,[{slot:"two",id:legacyId}]);
  assert.deepEqual(result.receipt.header.prev,[legacyId]);
  let calls=0;
  await issue(fixture("cross-instance-parent"),{completed:async()=>{calls++;return null},spent:async()=>{calls++;return false}});
  await issue(fixture("optional-explicitly-invalid"),{spent:async()=>{calls++;return false}});
  await issue(fixture("requires-order"),{read:async()=>{calls++;return null},spent:async()=>{calls++;return false}});
  assert.equal(calls,0);
  await assert.rejects(()=>issue(continuation,{completed:async()=>root}),code("evidence_invalid"));
});
test("missing and denied evidence are indistinguishable for the exact same request",async()=>{
  const c=fixture("denied-root");
  const a=await issue(c,{read:async()=>null});
  const b=await issue(c,{read:async id=>id===root?null:vectors.evidence[id]??null});
  assert.equal(L.canonicalize(a),L.canonicalize(b));
  assert.deepEqual(a.receipt.header.prev,[]);
  assert.equal(a.context.resolved.root,null);
});
test("same admitted evidence and nonce yields same candidate, not a commit guarantee",async()=>{
  const a=await issue(entry),b=await issue(entry);
  assert.deepEqual(a,b);
  const c=await issue(entry,{}, {...entry.request,submission:"B".repeat(20)+"AQ"});
  assert.notEqual(a.receipt.id,c.receipt.id);
  assert.notEqual(a.submission_key,c.submission_key);
  assert.equal(a.context.request_hash,c.context.request_hash);
  const d=await issue(entry,{}, {...entry.request,tuple:43});
  assert.equal(a.submission_key,d.submission_key);
  assert.notEqual(a.context.request_hash,d.context.request_hash);
  // Enforcing the conflict is the ledger's job, not a hidden evaluator cache.
});
test("unsafe computed grants are doubt, not malformed signed output",async()=>{
  const r={id:"open",after:[],requires:{},steps:[],if_ok:"ok",if_not:"not",if_doubt:"doubt",
    grants:{unsafe:{"+":[Number.MAX_SAFE_INTEGER,1]}}};
  const law={logline:"process-type@1",id:"unsafe@1",issuer:"Example",recognize:true,runs:[r]};
  const lh=await L.hashOf(law),s={logline:"registry@1",types:[lh],scan_ops:100},rh=await L.hashOf(s);
  const out=await issue(entry,{registryHash:rh,laws:new Map([[lh,JSON.stringify(law)]]),snapshots:new Map([[rh,JSON.stringify(s)]])});
  assert.equal(out.receipt.header.status,"doubt");
  assert.equal(out.detail.reason,"grants_doubt");
  assert.equal(out.detail.findings[0].error,"eval_range");
  assert.equal(out.detail.grants,null);
});
