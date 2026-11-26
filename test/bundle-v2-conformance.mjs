// Expected decisions are independently signed fixtures from prior PRs.
export async function bundleV2Conformance(L,positive,outcomes,legacy,testKey){
 const results=[],keys=positive.cases[0].bundle.keys;
 const check=(name,actual,expected)=>results.push({name:"bundle-v2/"+name,ok:JSON.stringify(actual)===JSON.stringify(expected),msg:JSON.stringify({actual,expected})});
 const verdict=async(b,k=keys)=>{
   const v=await L.verifyBundleV2(JSON.stringify(b),k);
   return [v.authenticity,v.replay,v.trajectory,v.valid];
 };
 const good=["pass","pass","pass",true];
 for(const f of positive.cases)check(f.name,await verdict(f.bundle),good);
 const base=positive.cases[2].bundle,head=base.objects[base.head];
 const changed=fn=>{const b=structuredClone(base);fn(b);return b};
 check("untrusted-convenience-keys",await verdict(base,{}),["fail","not_checked","not_checked",false]);
 check("missing-head",await verdict(changed(b=>delete b.objects[b.head])),["incomplete","not_checked","not_checked",false]);
 check("missing-head-tuple",await verdict(changed(b=>delete b.objects[head.header.input_hash])),["pass","incomplete","incomplete",false]);
 check("missing-parent",await verdict(changed(b=>delete b.objects[head.header.instance])),["pass","incomplete","incomplete",false]);
 const root=base.objects[head.header.instance];
 check("missing-parent-tuple",await verdict(changed(b=>delete b.objects[root.header.input_hash])),["pass","pass","incomplete",false]);
 check("tampered-head",await verdict(changed(b=>b.objects[b.head].header.by="forged")),["fail","not_checked","not_checked",false]);
 check("tampered-detail",await verdict(changed(b=>b.objects[head.header.detail_hash].consequence="forged")),["pass","fail","fail",false]);
 check("tampered-context",await verdict(changed(b=>b.objects[head.header.context_hash].submission="forged")),["pass","fail","fail",false]);
 check("wrong-trust-window",await verdict(base,Object.fromEntries(Object.entries(keys).map(([k,v])=>[k,{...v,not_before:"2026-11-26T00:00:00Z"}]))),["fail","not_checked","not_checked",false]);
 // Assemble all independently signed outcomes, preserving their addresses.
 const all={};
 for(const f of positive.cases)Object.assign(all,f.bundle.objects);
 Object.assign(all,outcomes.laws,outcomes.snapshots);
 for(const [id,e] of Object.entries(outcomes.evidence)){all[id]=e.receipt;all[e.receipt.header.detail_hash]=e.detail}
 const old=legacy.cases.find(c=>c.name==="cite-lesson1"),oh=JSON.parse(old.expected.header_jcs);
 all[oh.input_hash]=old.tuple;all[oh.process_hash]=old.process;
 const key=await L.importMachineKey(testKey.jwk);
 for(const c of outcomes.cases){
   const r=c.expected.receipt,h=r.header;
   const objects={...all,[r.id]:r,[h.input_hash]:c.request.tuple,[h.context_hash]:c.expected.context,[h.detail_hash]:c.expected.detail};
   const b={logline:"bundle@2",head:r.id,keys,objects};
   check("outcome/"+c.name,await verdict(b),good);
 }
 // An object resembling a receipt is still a free tuple when addressed by
 // its full canonical hash. Do not infer its address domain from its shape.
 const l=new L.ProcessLedger(key,{clock:()=>head.header.when});
 const law={logline:"process-type@1",id:"free@1",issuer:"Example",recognize:true,runs:[{id:"open",after:[],requires:{},steps:[],if_ok:"ok",if_not:"not",if_doubt:"doubt"}]};
 await l.publish(JSON.stringify(law));
 const result=await l.submitText(JSON.stringify({tuple:head,submission:"A".repeat(22)}),{by:head.header.by,canRead:()=>true});
 const b=await l.bundle(result.receipt.id);
 check("envelope-shaped-free-tuple",await verdict(b),good);
 // Authentic but semantically changed output must not pass decision replay.
 const wrong=structuredClone(base),wrongHeader={...head.header,public:{"tuple.did":"invented"}};
 const wrongId=await L.hashOf(wrongHeader);
 wrong.objects[wrongId]={header:wrongHeader,id:wrongId,sig:{alg:"Ed25519",key:key.id,value:await L.signIdV2(key,wrongId)}};
 wrong.head=wrongId;
 check("signed-wrong-projection",await verdict(wrong),["pass","fail","fail",false]);
 // Two distinct histories can legitimately have the same projection.
 const a=positive.cases[0],second=positive.cases[1],blue=Object.values(a.bundle.objects).find(v=>v?.logline==="process-type@1");
 const ledger=new L.ProcessLedger(key,{scanOps:100,clock:()=>head.header.when});
 await ledger.publish(JSON.stringify(blue));
 const actor={by:head.header.by,canRead:()=>true};
 const aa=await ledger.submitText(JSON.stringify(a.request),actor),bb=await ledger.submitText(JSON.stringify(second.request),actor);
 const input=(root,submission)=>({tuple:{with:{score:80}},submission,continue:{instance:root,run:"review",parents:{open:root}}});
 const ar=await ledger.submitText(JSON.stringify(input(aa.receipt.id,"A".repeat(21)+"Q")),actor);
 const br=await ledger.submitText(JSON.stringify(input(bb.receipt.id,"A".repeat(21)+"g")),actor);
 const ab=await ledger.bundle(ar.receipt.id),ba=await ledger.bundle(br.receipt.id);
 const av=await verdict(ab),bv=await verdict(ba);
 const project=x=>x.receipt.header.status==="ok"&&x.receipt.header.run==="review"?{reviewed:true,owner:x.detail.grants.owner}:null;
 check("equal-projection-distinct-history",[av,bv,JSON.stringify(project(ar))===JSON.stringify(project(br)),ar.receipt.id!==br.receipt.id,aa.receipt.id!==bb.receipt.id],[good,good,true,true,true]);

 // A valid signature does not prove that the authoritative boundary committed
 // a candidate. Construct two successful candidates with one success scope,
 // then a separately signed head referencing both, not a legal ledger commit.
 const rootId=aa.receipt.id,rh=aa.receipt.header.registry_hash,lh=aa.receipt.header.process_hash;
 const obs={by:actor.by,when:head.header.when,registryHash:rh,laws:new Map([[lh,JSON.stringify(blue)]]),
   snapshots:new Map([[rh,JSON.stringify(ledger.snapshotByHash(rh))]]),keys,
   read:async id=>id===rootId?{receipt:aa.receipt,detail:aa.detail}:null,completed:async()=>null,spent:async()=>false};
 const ta=input(rootId,"A".repeat(21)+"Q"),tb=input(rootId,"A".repeat(21)+"w");
 const x=await L.issueV2(key,JSON.stringify(ta),obs),y=await L.issueV2(key,JSON.stringify(tb),obs);
 const combined=await ledger.bundle(rootId),objects=combined.objects;
 const insert=(result,tuple)=>{
   const r=result.receipt,h=r.header;
   objects[r.id]=r;objects[h.input_hash]=tuple;objects[h.detail_hash]=result.detail;objects[h.context_hash]=result.context;
 };
 insert(x,ta.tuple);insert(y,tb.tuple);
 const collect={logline:"process-type@1",id:"collect@1",issuer:"Example",recognize:true,runs:[
   {id:"open",after:[],requires:{},steps:[],if_ok:"ok",if_not:"not",if_doubt:"doubt",
    cites:{left:{frequency:blue.id,status:["ok"]},right:{frequency:blue.id,status:["ok"]}}}]};
 const ch=await L.hashOf(collect),snap={logline:"registry@1",types:[ch],scan_ops:100},reg=await L.hashOf(snap);
 objects[ch]=collect;objects[reg]=snap;
 const tuple={cites:{left:x.receipt.id,right:y.receipt.id}};
 const witness=await L.issueV2(key,JSON.stringify({tuple,submission:"B".repeat(20)+"AQ"}),{
   ...obs,registryHash:reg,laws:new Map([[ch,JSON.stringify(collect)]]),snapshots:new Map([[reg,JSON.stringify(snap)]]),
   read:async id=>id===x.receipt.id?{receipt:x.receipt,detail:x.detail}:id===y.receipt.id?{receipt:y.receipt,detail:y.detail}:null});
 insert(witness,tuple);combined.head=witness.receipt.id;
 const conflict=await L.verifyBundleV2(JSON.stringify(combined),keys);
 check("conflicting-success-closure",[conflict.authenticity,conflict.replay,conflict.trajectory,conflict.valid,conflict.issues.some(i=>i.code==="conflicting_run")],["pass","pass","fail",false,true]);
 // Outside the head's evidence closure, conflicting candidates are merely
 // extra objects. A portable verifier must not imply ledger-wide uniqueness.
 const onlyX={...combined,head:x.receipt.id};
 check("no-ledger-wide-uniqueness-claim",await verdict(onlyX),good);

 // The same nonce under one actor cannot bind two different admitted requests,
 // even when their entry instances are different.
 const entryRequest={tuple:{did:"request",with:{subject:"one"}},submission:"C".repeat(20)+"AQ"};
 const otherEntry={...entryRequest,tuple:{did:"request",with:{subject:"two"}}};
 const e1=await L.issueV2(key,JSON.stringify(entryRequest),obs),e2=await L.issueV2(key,JSON.stringify(otherEntry),obs);
 insert(e1,entryRequest.tuple);insert(e2,otherEntry.tuple);
 const et={cites:{left:e1.receipt.id,right:e2.receipt.id}};
 const ew=await L.issueV2(key,JSON.stringify({tuple:et,submission:"D".repeat(20)+"AQ"}),{
   ...obs,registryHash:reg,laws:new Map([[ch,JSON.stringify(collect)]]),snapshots:new Map([[reg,JSON.stringify(snap)]]),
   read:async id=>id===e1.receipt.id?{receipt:e1.receipt,detail:e1.detail}:id===e2.receipt.id?{receipt:e2.receipt,detail:e2.detail}:null});
 insert(ew,et);combined.head=ew.receipt.id;
 const duplicate=await L.verifyBundleV2(JSON.stringify(combined),keys);
 check("conflicting-submission-closure",[duplicate.authenticity,duplicate.replay,duplicate.trajectory,duplicate.valid,duplicate.issues.some(i=>i.code==="conflicting_submission")],["pass","pass","fail",false,true]);
 return results;
}
