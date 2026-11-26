import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {spawnSync} from "node:child_process";
import * as L from "../dist/index.js";
import {openProcessMachine} from "../server/store.mjs";
const key=await L.importMachineKey(JSON.parse(readFileSync(new URL("../vectors/test-key.json",import.meta.url),"utf8")).jwk);
const when="2026-11-25T00:00:00Z",by="p:"+"a".repeat(64),other="p:"+"b".repeat(64);
const auth={by,canRead:()=>true},bob={by:other,canRead:()=>true};
const step=(id,after,cites)=>({id,after,requires:{},steps:[],if_ok:"ok",if_not:"not",if_doubt:"doubt",...(cites?{cites}:{})});
const slot={choice:{frequency:"choice@1",status:["ok"],once:true}};
const law={logline:"process-type@1",id:"choice@1",issuer:"Example",recognize:true,runs:[
  step("open",[]),step("accept",["open"],slot),step("decline",["open"],slot)]};
const request=(tuple,n,cont)=>JSON.stringify({tuple,submission:Buffer.alloc(16,n).toString("base64url"),...(cont?{continue:cont}:{})});
const choice=(id,run,n)=>request({cites:{choice:id}},n,{instance:id,run,parents:{open:id}});
const code=c=>e=>e?.code===c;
const clone=structuredClone;

test("ambiguous sink acknowledgement: durable winning record, no live visibility, recovery returns exact receipt",async()=>{
 const records=[],events=[];let ambiguous=false,captured;
 const ledger=new L.ProcessLedger(key,{scanOps:100,clock:()=>when,sink:r=>{
   records.push(clone(r)); // the model sink durably accepted the complete record
   if(ambiguous){captured=clone(r);throw Error("ack lost")}
 }});
 ledger.listen({},r=>events.push(r.id));
 await ledger.publish(JSON.stringify(law));
 const root=(await ledger.submitText(request(null,1),auth)).receipt.id;
 ambiguous=true;
 const text=choice(root,"accept",2);
 await assert.rejects(()=>ledger.submitText(text,auth),/ack lost/);
 assert.equal(ledger.length,1);assert.equal(ledger.entry(captured.entry.receipt.id),null);
 assert.deepEqual(events,[root]);
 await assert.rejects(()=>ledger.submitText(choice(root,"decline",3),bob),code("unavailable"));
 const resumed=new L.ProcessLedger(key,{scanOps:100,clock:()=>"2026-11-27T00:00:00Z"});
 const recoveredEvents=[];resumed.listen({},r=>recoveredEvents.push(r.id));
 await resumed.restore(records);assert.equal(resumed.length,2);
 assert.deepEqual(recoveredEvents,[]);
 const retry=await resumed.submitText(text,auth);
 assert.equal(retry.replayed,true);
 assert.deepEqual(retry.receipt,captured.entry.receipt);
 assert.deepEqual(retry.detail,captured.entry.detail);
 assert.deepEqual(retry.context,captured.entry.context);
 assert.deepEqual(recoveredEvents,[]);
 const loser=await resumed.submitText(choice(root,"decline",3),bob);
 assert.equal(loser.detail.reason,"citation_spent");
 assert.deepEqual(recoveredEvents,[loser.receipt.id]);
});

test("real process replacement: killed before evaluation and after fsync but before submit response", {timeout:30000}, async()=>{
 const dir=mkdtempSync(join(tmpdir(),"radio-atomic-crash-"));let m;
 const adapter=new URL("../server/store.mjs",import.meta.url).href;
 try{
   m=await openProcessMachine(dir,{scanOps:100,clock:()=>when});
   await m.ledger.publish(JSON.stringify(law));
   const root=(await m.ledger.submitText(request(null,1),auth)).receipt.id;
   const originalHead=m.head();m.close();
   const runChild=(text,phase)=>{
     const script=
       'import {openProcessMachine} from '+JSON.stringify(adapter)+';'+
       'import {writeSync} from "node:fs";'+
       'const [dir,text,phase,by,when]=process.argv.slice(1);'+
       'const m=await openProcessMachine(dir,{scanOps:100,clock:()=>when});'+
       'const kill=msg=>{writeSync(1,JSON.stringify(msg)+"\\n");process.kill(process.pid,"SIGKILL")};'+
       'if(phase==="after")m.ledger.listen({},(receipt,seq)=>kill({id:receipt.id,seq,head:m.head()}));'+
       'await m.ledger.submitText(text,{by,canRead:()=>{if(phase==="before")kill({before:true});return true}});'+
       'throw Error("child unexpectedly returned a response");';
     const r=spawnSync("node",["--input-type=module","-e",script,dir,text,phase,by,when],{encoding:"utf8",timeout:10000});
     assert.equal(r.error,undefined,r.stderr);
     assert.equal(r.signal,"SIGKILL",r.stderr);
     return JSON.parse(r.stdout.trim());
   };
   const text=choice(root,"accept",2);
   assert.deepEqual(runChild(text,"before"),{before:true});
   m=await openProcessMachine(dir,{clock:()=>when});
   assert.deepEqual(m.head(),originalHead);assert.equal(m.ledger.length,1);m.close();
   const committed=runChild(text,"after");assert.equal(committed.seq,2);
   m=await openProcessMachine(dir,{clock:()=>"2026-11-27T00:00:00Z"});
   assert.deepEqual(m.head(),committed.head);
   const old=m.ledger.entry(committed.id);
   assert(old);assert.equal(old.receipt.header.status,"ok");
   const retry=await m.ledger.submitText(text,auth);
   assert.equal(retry.replayed,true);assert.deepEqual(retry.receipt,old.receipt);
   assert.deepEqual(retry.detail,old.detail);assert.deepEqual(retry.context,old.context);
   const loser=await m.ledger.submitText(choice(root,"decline",3),bob);
   assert.equal(loser.detail.reason,"citation_spent");
   assert.equal(m.ledger.length,3);
 }finally{m?.close();rmSync(dir,{recursive:true,force:true})}
});

test("recovery exposes no partially reconstructed history until full validation",async()=>{
 const records=[],source=new L.ProcessLedger(key,{scanOps:100,clock:()=>when,sink:r=>records.push(clone(r))});
 const hash=await source.publish(JSON.stringify(law));
 const root=(await source.submitText(request(null,1),auth)).receipt.id;
 await source.submitText(choice(root,"accept",2),auth);
 const restored=new L.ProcessLedger(key,{scanOps:100,clock:()=>when});
 let checked=false;
 function* inspectPrefix(){
   yield records[0];yield records[1];
   // The restore iterator resumes after the first receipt has been replayed,
   // before the final record is verified. Public readers must not see it.
   for(const read of [()=>restored.length,()=>restored.entry(root),()=>restored.history(),()=>restored.trajectory(root),
     ()=>restored.law(hash),()=>restored.snapshotByHash(records[1].entry.receipt.header.registry_hash)])
     assert.throws(read,code("unavailable"));
   checked=true;yield records[2];
 }
 await restored.restore(inspectPrefix());
 assert(checked);assert.equal(restored.length,2);assert(restored.entry(root));
});

test("receipt and all derived claims are isolated from sink and listener mutation",async()=>{
 const ledger=new L.ProcessLedger(key,{scanOps:100,clock:()=>when,sink:r=>{
   if(r.kind==="receipt-v2"){r.entry.context.submission="corrupt";r.entry.receipt.header.status="not"}
 }});
 await ledger.publish(JSON.stringify(law));
 ledger.listen({},r=>{r.header.status="not";r.header.prev.push("bad")});
 const root=(await ledger.submitText(request(null,1),auth)).receipt.id;
 const r=await ledger.submitText(choice(root,"accept",2),auth);
 assert.equal(r.receipt.header.status,"ok");assert.deepEqual(r.receipt.header.prev,[root]);
 r.receipt.header.status="not";r.context.resolved.cites.choice="corrupt";
 const retry=await ledger.submitText(choice(root,"accept",2),auth);
 assert.equal(retry.replayed,true);assert.equal(retry.receipt.header.status,"ok");
 assert.equal(retry.context.resolved.cites.choice,root);
 assert.equal((await ledger.submitText(choice(root,"decline",3),bob)).detail.reason,"citation_spent");
});
