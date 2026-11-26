// Independently signed fixtures are executed through the reference commit boundary.
// Expected receipt bytes come from the pre-existing fixtures, not the ledger.
const stable = v => {
  if(Array.isArray(v))return "["+v.map(stable).join(",")+"]";
  if(v!==null&&typeof v==="object")return "{"+Object.keys(v).sort().map(k=>JSON.stringify(k)+":"+stable(v[k])).join(",")+"}";
  return JSON.stringify(v);
};
export async function processLedgerConformance(L,receiptV2,outcomes,testKey) {
  const results=[],records=[];
  const key=await L.importMachineKey(testKey.jwk);
  const first=receiptV2.cases[0],objects=first.bundle.objects;
  const law=Object.values(objects).find(v=>v?.logline==="process-type@1");
  const when=objects[first.receipt_id].header.when;
  const by=objects[first.receipt_id].header.by;
  const ledger=new L.ProcessLedger(key,{scanOps:100,clock:()=>when,sink:r=>{records.push(structuredClone(r))}});
  await ledger.publish(JSON.stringify(law));
  const eq=(name,observed,want)=>results.push({name:"instance/"+name,ok:stable(observed)===stable(want),msg:JSON.stringify({observed,want})});
  const submit=async (l,req,actor,exclude=[])=>l.submitText(JSON.stringify(req),{by:actor,canRead:r=>!exclude.includes(r.id)});
  const resultOf=f=>{
    const r=f.bundle.objects[f.receipt_id];
    return {receipt:r,detail:f.bundle.objects[r.header.detail_hash],context:f.bundle.objects[r.header.context_hash]};
  };
  const observe=async(name,action,want)=>{
    let observed;
    try{observed=await action()}catch(e){observed={error:e?.code??e?.name}}
    eq(name,observed,want);
  };
  for(const f of receiptV2.cases.slice(0,2))
    await observe(f.name,()=>submit(ledger,f.request,by),{...resultOf(f),replayed:false});
  await ledger.retire(law.id);
  const selected=["no-match","cross-instance-parent","unknown-run","denied-root","actor-not-inherited"];
  for(const name of selected){
    const c=outcomes.cases.find(c=>c.name===name);
    const {submission_key,...want}=c.expected;
    await observe(name,()=>submit(ledger,c.request,c.by,c.read_exclude),{...want,replayed:false});
  }
  const review=receiptV2.cases[2];
  await observe(review.name,()=>submit(ledger,review.request,by),{...resultOf(review),replayed:false});
  const completed=outcomes.cases.find(c=>c.name==="completed-before-requires");
  const {submission_key,...want}=completed.expected;
  await observe(completed.name,()=>submit(ledger,completed.request,completed.by),{...want,replayed:false});
  // Neither replay nor a nonce collision can create a second committed object.
  await observe("retry-after-retirement",()=>submit(ledger,first.request,by),{...resultOf(first),replayed:true});
  await observe("nonce-conflict",()=>submit(ledger,{...first.request,tuple:{changed:true}},by),{error:"submission_conflict"});
  const restored=new L.ProcessLedger(key,{scanOps:100,clock:()=>"2026-11-27T00:00:00Z"});
  try{
    await restored.restore(records);
    await observe("restart-retry",()=>submit(restored,review.request,by),{...resultOf(review),replayed:true});
    eq("restart-history",restored.history().map(r=>r.id),[
      ...receiptV2.cases.slice(0,2).map(f=>f.receipt_id),
      ...selected.map(n=>outcomes.cases.find(c=>c.name===n).expected.receipt.id),
      review.receipt_id,completed.expected.receipt.id]);
  }catch(e){
    eq("restart-retry",{error:e?.code??e?.name},{...resultOf(review),replayed:true});
    eq("restart-history",{error:e?.code??e?.name},"complete committed history");
  }
  // One legal choice, two mutually exclusive successors, across recovery.
  const step=(id,after,cites)=>({id,after,requires:{},steps:[],if_ok:"ok",if_not:"not",if_doubt:"doubt",...(cites?{cites}:{})});
  const slot={choice:{frequency:"choice@1",once:true,status:["ok"]}};
  const choice={logline:"process-type@1",id:"choice@1",issuer:"Example",recognize:true,
    runs:[step("open",[]),step("accept",["open"],slot),step("decline",["open"],slot)]};
  const log=[],choices=new L.ProcessLedger(key,{scanOps:100,clock:()=>when,sink:r=>log.push(structuredClone(r))});
  const nonce=n=>"A".repeat(21)+["A","Q","g","w"][n]; // canonical 16 bytes, test-only
  try{
    await choices.publish(JSON.stringify(choice));
    const root=await submit(choices,{tuple:null,submission:nonce(0)},by);
    const id=root.receipt.id;
    const req=(run,n)=>({tuple:{cites:{choice:id}},submission:nonce(n),continue:{instance:id,run,parents:{open:id}}});
    const accept=await submit(choices,req("accept",1),by);
    eq("choice-first-success",accept.receipt.header.status,"ok");
    const resumed=new L.ProcessLedger(key,{scanOps:100,clock:()=>when});
    await resumed.restore(log);
    const decline=await submit(resumed,req("decline",2),by);
    eq("once-scope-after-restart",{status:decline.receipt.header.status,reason:decline.detail.reason,spent:decline.context.spent},
      {status:"registered",reason:"citation_spent",spent:[{slot:"choice",id}]});
  }catch(e){
    eq("once-scope-after-restart",{error:e?.code??e?.name},"registered spent choice");
  }
  return results;
}
