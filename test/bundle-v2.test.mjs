import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import * as L from "../dist/index.js";
const read=n=>JSON.parse(readFileSync(new URL("../"+n,import.meta.url),"utf8"));
const fixture=read("vectors/receipt-v2-contract.json"),outcomes=read("vectors/run-v2.json");
const key=await L.importMachineKey(read("vectors/test-key.json").jwk);
const base=fixture.cases[2].bundle,keys=base.keys;
const clone=structuredClone,when="2026-11-25T00:00:00Z",by=base.objects[base.head].header.by;
const verify=(b,k=keys)=>L.verifyBundleV2(JSON.stringify(b),k);
const expect=(v,a,r,t)=>assert.deepEqual([v.authenticity,v.replay,v.trajectory,v.valid],[a,r,t,a==="pass"&&r==="pass"&&t==="pass"],JSON.stringify(v));
const good=v=>expect(v,"pass","pass","pass");
async function resign(b,changes={}){
 const old=b.objects[b.head],h={...old.header,...changes},id=await L.hashOf(h);
 b.objects[id]={header:h,id,sig:{alg:"Ed25519",key:key.id,value:await L.signIdV2(key,id)}};
 b.head=id;return b;
}
async function addCAS(b,v){const h=await L.hashOf(v);b.objects[h]=v;return h}
const nonce=n=>Buffer.alloc(16,n).toString("base64url");
const req=(tuple,n,cont)=>JSON.stringify({tuple,submission:nonce(n),...(cont?{continue:cont}:{})});
const auth={by,canRead:()=>true};

test("strict bundle parser rejects ambiguous raw JSON and unknown fields",async()=>{
 const json=JSON.stringify(base),id="sha256:"+"a".repeat(64);
 for(const raw of [
   json.replace('"head":','"head":"'+base.head+'","head":'),
   json.replace('"head":','"\\u0068ead":"'+base.head+'","head":'),
   json.replace('"objects":{','"objects":{"'+id+'":9007199254740993,'),
   json.replace('"objects":{','"objects":{"'+id+'":"\\ud800",'),
   json.replace('"objects":{','"objects":{"'+id+'":0,"'+id+'":1,'),
   JSON.stringify({...base,extra:true}),JSON.stringify({...base,logline:"bundle@1"})
 ]) expect(await L.verifyBundleV2(raw,keys),"fail","not_checked","not_checked");
});
test("convenience keys are not the trust source",async()=>{
 const b=clone(base);b.keys={};good(await verify(b));
 const k=Object.keys(keys)[0];
 b.keys={[k]:{jwk:{...keys[k].jwk,extra:true}}};
 expect(await verify(b),"fail","not_checked","not_checked");
 b.keys={[k]:{jwk:{...keys[k].jwk,x:"A".repeat(42)+"B"}}};
 expect(await verify(b),"fail","not_checked","not_checked");
 const ring=clone(keys),promise=L.verifyBundleV2(JSON.stringify(base),ring);
 delete ring[k];good(await promise);
});
test("authentic but inconsistent law, RUN, registry, actor or projection fails replay",async()=>{
 const h=base.objects[base.head].header,root=base.objects[h.instance];
 const alternate=fixture.cases[1].bundle.objects[fixture.cases[1].receipt_id];
 for(const change of [
  {run:"open"},{by:"p:"+"b".repeat(64)},{public:{"tuple.did":"invented"}},
  {process:"other@1",frequency:"other@1"},{instance:alternate.id,prev:[alternate.id]},
  {status:"not",activated:true}
 ]){
   const b=clone(base);Object.assign(b.objects,fixture.cases[1].bundle.objects);
   await resign(b,change);
   assert(await L.authenticV2(b.objects[b.head],keys));
   expect(await verify(b),"pass","fail","fail");
 }
 const b=clone(base),registry_hash=await addCAS(b,{logline:"registry@1",types:[],scan_ops:100});
 await resign(b,{registry_hash});expect(await verify(b),"pass","fail","fail");
 const bad=clone(base);delete bad.objects[root.header.registry_hash];
 expect(await verify(bad),"pass","incomplete","incomplete");
});
test("signed context cannot invent causal roles, claims or request hash",async()=>{
 const h=base.objects[base.head].header,c=base.objects[h.context_hash];
 for(const patch of [
   {request_hash:"sha256:"+"a".repeat(64)},
   {resolved:{...c.resolved,parents:{open:"sha256:"+"a".repeat(64)}}},
   {spent:[{slot:"fabricated",id:h.instance}]},
   {completed:h.instance},
   {continue:{...c.continue,run:"open"}}
 ]){
   const b=clone(base),context_hash=await addCAS(b,{...c,...patch});
   await resign(b,{context_hash});expect(await verify(b),"pass","fail","fail");
 }
});
test("initial recognition needs every candidate law",async()=>{
 const c=outcomes.cases.find(x=>x.name==="indeterminate-partial-match"),r=c.expected.receipt,h=r.header;
 const b={logline:"bundle@2",head:r.id,keys,objects:{...outcomes.laws,...outcomes.snapshots,
  [r.id]:r,[h.input_hash]:c.request.tuple,[h.detail_hash]:c.expected.detail,[h.context_hash]:c.expected.context}};
 good(await verify(b));
 delete b.objects[b.objects[h.registry_hash].types.find(id=>id!==c.expected.detail.recognition.matches[0])];
 expect(await verify(b),"pass","incomplete","incomplete");
});
test("receipt address cannot be replaced by the full-envelope hash",async()=>{
 const b=clone(base),r=b.objects[b.head],root=b.objects[r.header.instance];
 b.objects[await L.hashOf(root)]=root;delete b.objects[root.id];
 expect(await verify(b),"pass","incomplete","incomplete");
 const c=clone(base);c.objects[root.header.detail_hash]=c.objects[r.header.detail_hash];
 expect(await verify(c),"pass","fail","fail");
});
test("extra objects do not change recorded unavailable evidence",async()=>{
 const c=outcomes.cases.find(x=>x.name==="denied-root"),r=c.expected.receipt,h=r.header;
 const b={logline:"bundle@2",head:r.id,keys,objects:{...base.objects,...outcomes.laws,...outcomes.snapshots,
   [r.id]:r,[h.input_hash]:c.request.tuple,[h.detail_hash]:c.expected.detail,[h.context_hash]:c.expected.context}};
 good(await verify(b));
 b.objects["sha256:"+"f".repeat(64)]=42;
 expect(await verify(b),"pass","pass","fail");
});
test("local export includes completion conflict evidence but not unrelated attempts",async()=>{
 const l=new L.ProcessLedger(key,{clock:()=>when,scanOps:100});
 const law=Object.values(base.objects).find(v=>v?.logline==="process-type@1");
 await l.publish(JSON.stringify(law));
 const a=await l.submitText(req({did:"request",with:{subject:"A"}},1),auth);
 const b=await l.submitText(req({did:"request",with:{subject:"B"}},2),auth);
 const cont={instance:a.receipt.id,run:"review",parents:{open:a.receipt.id}};
 const ok=await l.submitText(req({with:{score:80}},3,cont),auth);
 const completed=await l.submitText(req({with:{score:90}},4,cont),auth);
 const bundle=await l.bundle(completed.receipt.id);
 assert.equal(completed.context.completed,ok.receipt.id);
 assert(!completed.receipt.header.prev.includes(ok.receipt.id));
 assert(bundle.objects[ok.receipt.id]);
 assert(!Object.hasOwn(bundle.objects,b.receipt.id));
 good(await verify(bundle));
 delete bundle.objects[ok.receipt.id];
 expect(await verify(bundle),"pass","incomplete","incomplete");
 await assert.rejects(()=>l.bundle("sha256:"+"a".repeat(64)),e=>e.code==="evidence_invalid");
});
