import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,mkdtempSync,rmSync,appendFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import * as L from "../dist/index.js";
import {openProcessMachine} from "../server/store.mjs";
const fixtures=JSON.parse(readFileSync(new URL("../vectors/receipt-v2-contract.json",import.meta.url),"utf8")).cases;
const key=await L.importMachineKey(JSON.parse(readFileSync(new URL("../vectors/test-key.json",import.meta.url),"utf8")).jwk);
const objects=fixtures[0].bundle.objects;
const law=Object.values(objects).find(v=>v?.logline==="process-type@1");
const by=objects[fixtures[0].receipt_id].header.by;
const when="2026-11-25T00:00:00Z";
const auth={by,canRead:()=>true};
const nonce=n=>Buffer.alloc(16,n).toString("base64url");
const request=(tuple,n,cont)=>JSON.stringify({tuple,submission:nonce(n),...(cont?{continue:cont}:{})});
const submit=(l,tuple,n,cont,access=auth)=>l.submitText(request(tuple,n,cont),access);
const openTuple=subject=>({did:"request",with:{subject}});
const review=(root,parent=root)=>({instance:root,run:"review",parents:{open:parent}});
const isCode=code=>e=>e?.code===code;

test("independent signed entry and successor vectors through actual reference commit",async()=>{
 const records=[],l=new L.ProcessLedger(key,{scanOps:100,clock:()=>when,sink:r=>{records.push(structuredClone(r))}});
 await l.publish(JSON.stringify(law));
 for(const f of fixtures){
  const r=await l.submitText(JSON.stringify(f.request),auth);
  assert.deepEqual(r.receipt,f.bundle.objects[f.receipt_id]);
  assert.deepEqual(r.detail,f.bundle.objects[r.receipt.header.detail_hash]);
  assert.deepEqual(r.context,f.bundle.objects[r.receipt.header.context_hash]);
  assert.equal(r.replayed,false);
 }
 assert.equal(l.length,3);
 assert.equal(records.length,4);
 assert.deepEqual(l.trajectory(fixtures[2].receipt_id).map(h=>h.run),["open","review"]);
});
test("two instances, explicit parent roles and failed attempts; no implicit progression",async()=>{
 const l=new L.ProcessLedger(key,{clock:()=>when});
 await l.publish(JSON.stringify(law));
 const a=(await submit(l,openTuple("A"),1)).receipt.id,b=(await submit(l,openTuple("B"),2)).receipt.id;
 assert.notEqual(a,b);assert.equal(l.length,2);
 const cross=await submit(l,{with:{score:80}},3,review(a,b));
 assert.equal(cross.detail.reason,"parents_unmet");assert.equal(cross.receipt.header.instance,a);
 const fail=await submit(l,{with:{score:50}},4,review(a));
 assert.equal(fail.receipt.header.status,"not");
 const wrong=await submit(l,{with:{score:80}},5,{instance:a,run:"unknown",parents:{}});
 assert.equal(wrong.detail.reason,"run_unavailable");assert.equal(wrong.receipt.header.run,null);
 const ok=await submit(l,{with:{score:80}},6,review(a));assert.equal(ok.receipt.header.status,"ok");
 assert.equal((await submit(l,{with:{score:80}},7,review(b))).receipt.header.status,"ok");
 assert.equal(l.length,7);
});
test("restart preserves historical law, root, time, receipt, nonce and causal history",async()=>{
 const dir=mkdtempSync(join(tmpdir(),"radio-v2-"));let m;
 try{
  m=await openProcessMachine(dir,{scanOps:100,clock:()=>when});
  await m.ledger.publish(JSON.stringify(law));
  const a=await submit(m.ledger,openTuple("A"),1);
  const b=await submit(m.ledger,openTuple("B"),2);
  await m.ledger.retire(law.id);
  const original=a.receipt.header.registry_hash;
  m.close();m=await openProcessMachine(dir,{scanOps:100,clock:()=>"2026-11-27T00:00:00Z"});
  const retry=await submit(m.ledger,openTuple("A"),1);
  assert.equal(retry.replayed,true);assert.deepEqual(retry.receipt,a.receipt);
  await assert.rejects(()=>submit(m.ledger,openTuple("different"),1),isCode("submission_conflict"));
  const current=await submit(m.ledger,openTuple("C"),3);assert.equal(current.detail.reason,"recognition_none");
  const ok=await submit(m.ledger,{with:{score:80}},4,review(a.receipt.id));assert.equal(ok.receipt.header.status,"ok");
  assert.equal(ok.receipt.header.registry_hash,original);
  assert.equal(ok.receipt.header.instance,a.receipt.id);
  m.close();m=await openProcessMachine(dir,{scanOps:100,clock:()=>when});
  assert.equal(m.ledger.length,4);
  assert.deepEqual(m.ledger.entry(ok.receipt.id).receipt,ok.receipt);
  assert.equal(m.ledger.entry(b.receipt.id).receipt.id,b.receipt.id);
  assert.equal((await submit(m.ledger,{with:{score:80}},5,review(a.receipt.id))).detail.reason,"run_completed");
 }finally{m?.close();rmSync(dir,{recursive:true,force:true})}
});
test("multi-parent join is explicit and can advance independent branches in either order",async()=>{
 const step=(id,after)=>({id,after,requires:{},steps:[],if_ok:"ok",if_not:"not",if_doubt:"doubt"});
 const dag={logline:"process-type@1",id:"dag@1",issuer:"Example",recognize:true,runs:[step("open",[]),step("left",["open"]),step("right",["open"]),step("join",["left","right"])]};
 const l=new L.ProcessLedger(key,{clock:()=>when});await l.publish(JSON.stringify(dag));
 const a=(await submit(l,null,1)).receipt.id;
 const right=(await submit(l,null,2,{instance:a,run:"right",parents:{open:a}})).receipt.id;
 const missing=await submit(l,null,3,{instance:a,run:"join",parents:{right}});assert.equal(missing.detail.reason,"parents_unmet");
 const left=(await submit(l,null,4,{instance:a,run:"left",parents:{open:a}})).receipt.id;
 const j=await submit(l,null,5,{instance:a,run:"join",parents:{right,left}});
 assert.equal(j.receipt.header.status,"ok");
 assert.deepEqual(j.receipt.header.prev,[a,left,right].sort());
 assert.deepEqual(new Set(l.trajectory(j.receipt.id).map(h=>h.run)),new Set(["open","left","right","join"]));
 assert.equal(l.length,5);
});
test("unauthorized evidence is not admitted; private recorded observations survive restore",async()=>{
 const records=[],l=new L.ProcessLedger(key,{clock:()=>when,sink:r=>records.push(structuredClone(r))});
 await l.publish(JSON.stringify(law));const a=(await submit(l,openTuple("A"),1)).receipt.id;
 const denied=await submit(l,{with:{score:80}},2,review(a),{by,canRead:()=>false});
 assert.equal(denied.detail.reason,"continuation_unavailable");assert.deepEqual(denied.receipt.header.prev,[]);
 const restored=new L.ProcessLedger(key,{clock:()=>when});await restored.restore(records);
 assert.deepEqual(restored.entry(denied.receipt.id).receipt,denied.receipt);
 const ok=await submit(restored,{with:{score:80}},3,review(a));assert.equal(ok.receipt.header.status,"ok");
});
test("only acknowledged commits become visible; listener exceptions cannot undo them",async()=>{
 let fail=false;const events=[],records=[];
 const l=new L.ProcessLedger(key,{clock:()=>when,sink:r=>{if(fail)throw Error("disk failed");records.push(structuredClone(r));}});
 await l.publish(JSON.stringify(law));l.listen({},()=>{throw Error("observer failed")});l.listen({},r=>events.push(r.id));
 const ok=await submit(l,openTuple("A"),1);assert.equal(events.length,1);
 fail=true;await assert.rejects(()=>submit(l,openTuple("B"),2),/disk failed/);
 assert.equal(l.length,1);assert.deepEqual(events,[ok.receipt.id]);assert.equal(records.length,2);
});

test("durable publication is immutable and retirement does not resurrect a law",async()=>{
 const records=[],l=new L.ProcessLedger(key,{clock:()=>when,sink:r=>records.push(structuredClone(r))});
 const hash=await l.publish(JSON.stringify(law));
 assert.equal(await l.publish(JSON.stringify(law)),hash);assert.equal(records.length,1);
 await assert.rejects(()=>l.publish(JSON.stringify({...law,issuer:"Different"})),isCode("process_exists"));
 await l.retire(law.id);await l.retire(law.id);
 assert.equal(await l.publish(JSON.stringify(law)),hash);
 assert.equal(records.length,2);
 const r=await submit(l,openTuple("A"),1);assert.equal(r.detail.reason,"recognition_none");
 const restored=new L.ProcessLedger(key,{clock:()=>when});await restored.restore(records);
 assert.deepEqual(restored.law(hash),law);assert.equal((await submit(restored,openTuple("A"),2)).detail.reason,"recognition_none");
});
test("retry is scoped by verified actor, does not consult a new clock, respects access",async()=>{
 let ticks=0;const l=new L.ProcessLedger(key,{clock:()=>{ticks++;return when}});
 await l.publish(JSON.stringify(law));
 const a=await submit(l,openTuple("A"),1);
 const retry=await submit(l,openTuple("A"),1);
 assert.equal(retry.replayed,true);assert.equal(ticks,1);assert.deepEqual(retry.receipt,a.receipt);
 await assert.rejects(()=>submit(l,openTuple("A"),1,undefined,{by,canRead:()=>false}),isCode("admission_denied"));
 await assert.rejects(()=>submit(l,openTuple("B"),1),isCode("submission_conflict"));
 const other=await submit(l,openTuple("A"),1,undefined,{by:"p:"+"b".repeat(64),canRead:()=>true});
 assert.notEqual(other.receipt.id,a.receipt.id);assert.equal(ticks,2);
 await assert.rejects(()=>l.submitText('{"tuple":0}',auth),isCode("submission_invalid"));
});
test("failure to persist publication or receipt leaves no phantom authority and stops writer",async()=>{
 const l=new L.ProcessLedger(key,{sink:()=>{throw Error("disk failed")},clock:()=>when});
 await assert.rejects(()=>l.publish(JSON.stringify(law)),/disk failed/);
 assert.equal(l.law(await L.hashOf(law)),null);
 await assert.rejects(()=>submit(l,openTuple("A"),1),isCode("unavailable"));
 const k=new L.ProcessLedger(key,{clock:()=>when,sink:r=>{if(r.kind==="receipt-v2")throw Error("disk failed")}});
 await k.publish(JSON.stringify(law));
 await assert.rejects(()=>submit(k,openTuple("A"),1),/disk failed/);assert.equal(k.length,0);
 await assert.rejects(()=>submit(k,openTuple("A"),1),isCode("unavailable"));
});
test("corrupt committed prefix cannot restore an apparently healthy institution",async()=>{
 const records=[],l=new L.ProcessLedger(key,{clock:()=>when,sink:r=>records.push(structuredClone(r))});
 await l.publish(JSON.stringify(law));await submit(l,openTuple("A"),1);await submit(l,openTuple("B"),2);
 for(const change of [
  r=>{r[2].entry.tuple.with.subject="changed"},
  r=>{r[2].entry.context.submission=nonce(9)},
  r=>{r[2].admission_snapshot.scan_ops++},
  r=>{r[2].entry.seq=4},
  r=>{r.push(structuredClone(r[2]));r.at(-1).entry.seq=3},
  r=>{r[2].entry.receipt.sig.value="A".repeat(86)}
 ]){
  const bad=structuredClone(records);change(bad);
  const restore=new L.ProcessLedger(key,{clock:()=>when});
  await assert.rejects(()=>restore.restore(bad));
  assert.equal(restore.length,0);
  await assert.rejects(()=>submit(restore,openTuple("A"),3),isCode("unavailable"));
 }
});
test("actual file recovers torn suffix, infers stored scan budget and rejects changed history",async()=>{
 const dir=mkdtempSync(join(tmpdir(),"radio-v2-torn-"));let m;
 try{
  m=await openProcessMachine(dir,{scanOps:100,clock:()=>when});await m.ledger.publish(JSON.stringify(law));
  const a=await submit(m.ledger,openTuple("A"),1);m.close();
  appendFileSync(join(dir,"ledger.jsonl"),'{"n":3,"prev":');
  m=await openProcessMachine(dir,{clock:()=>when});assert.equal(m.repaired,true);assert.equal(m.ledger.length,1);
  assert.deepEqual(m.ledger.entry(a.receipt.id).receipt,a.receipt);
  const old=m.ledger;m.close();await assert.rejects(()=>submit(old,openTuple("B"),2),isCode("unavailable"));
  // A complete invalid record is not a torn suffix to repair.
  appendFileSync(join(dir,"ledger.jsonl"),"{}\n");
  await assert.rejects(()=>openProcessMachine(dir),isCode("log_corrupt"));
 }finally{m?.close();rmSync(dir,{recursive:true,force:true})}
});
test("a signing key mismatch cannot enter the durable reference",async()=>{
 const another=(await L.generateMachineKey()).key;
 const l=new L.ProcessLedger({...key,private:another.private},{clock:()=>when});
 await l.publish(JSON.stringify(law));
 await assert.rejects(()=>submit(l,openTuple("A"),1),isCode("key_invalid"));
 assert.equal(l.length,0);
});
test("scope once consumption by law and slot, failed decisions do not consume",async()=>{
 const step=(id,after,extra={})=>({id,after,requires:{},steps:[],if_ok:"ok",if_not:"not",if_doubt:"doubt",...extra});
 const slot={choice:{frequency:"choice@1",status:["ok"],once:true}};
 const choice={logline:"process-type@1",id:"choice@1",issuer:"Example",recognize:true,runs:[
  step("open",[]),step("accept",["open"],{cites:slot,steps:[{id:"consent",check:{"==":[{"var":"consent"},true]},if_not:"not",reason:"Consent required"}]}),
  step("decline",["open"],{cites:slot})]};
 const records=[],l=new L.ProcessLedger(key,{clock:()=>when,sink:r=>records.push(structuredClone(r))});
 const hash=await l.publish(JSON.stringify(choice)),a=(await submit(l,null,1)).receipt.id;
 const c=run=>({instance:a,run,parents:{open:a}});
 assert.equal((await submit(l,{consent:false,cites:{choice:a}},2,c("accept"))).receipt.header.status,"not");
 const accepted=await submit(l,{consent:true,cites:{choice:a}},3,c("accept"));assert.equal(accepted.receipt.header.status,"ok");
 const decline=await submit(l,{cites:{choice:a}},4,c("decline"));assert.equal(decline.detail.reason,"citation_spent");
 assert.deepEqual(decline.context.spent,[{slot:"choice",id:a}]);
 const restored=new L.ProcessLedger(key,{clock:()=>when});await restored.restore(records);
 assert.equal((await submit(restored,{cites:{choice:a}},5,c("decline"))).detail.reason,"citation_spent");
 assert.equal(restored.entry(accepted.receipt.id).receipt.header.process_hash,hash);
});
