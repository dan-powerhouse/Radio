// Portable contract scenarios. No generated receipt is used as an independent
// expected legal outcome: identities are compared only for binding/equality.
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r});return {promise,resolve}};
// Compare JSON values independently of the implementation's canonicalizer.
const stable=v=>Array.isArray(v)?"["+v.map(stable).join(",")+"]":v!==null&&typeof v==="object"?
  "{"+Object.keys(v).sort().map(k=>JSON.stringify(k)+":"+stable(v[k])).join(",")+"}":JSON.stringify(v);
const same=(a,b)=>stable(a)===stable(b);
const nonce=n=>{const hex=n.toString(16).padStart(4,"0");return "A".repeat(16)+hex+"AQ"};
// All test nonces are canonical 16-byte base64url (22 chars).
export async function atomicConformance(L,testKey,only){
  const group=(...names)=>!only||names.some(n=>"atomic/"+n===only);
  const results=[],key=await L.importMachineKey(testKey.jwk);
  const by="p:"+"a".repeat(64),other="p:"+"b".repeat(64),when="2026-11-25T00:00:00Z";
  const actor={by,canRead:()=>true},bob={by:other,canRead:()=>true};
  const check=(name,actual,expected)=>results.push({name:"atomic/"+name,ok:same(actual,expected),msg:JSON.stringify({actual,expected})});
  const step=(id,after,extra={})=>({id,after,requires:{},steps:[],if_ok:"ok",if_not:"not",if_doubt:"doubt",...extra});
  const slot={choice:{frequency:"choice@1",status:["ok"],once:true}};
  const law={logline:"process-type@1",id:"choice@1",issuer:"Example",recognize:true,runs:[
    step("open",[]),step("accept",["open"],{cites:slot,steps:[{id:"consent",check:{"==":[{"var":"consent"},true]},if_not:"not",reason:"Consent required"}]}),
    step("decline",["open"],{cites:slot}),step("review",["open"])]};
  const req=(tuple,n,cont)=>JSON.stringify({tuple,submission:nonce(n),...(cont?{continue:cont}:{})});
  const attempt=async(p)=>{try{return await p}catch(e){return {error:e?.code??e?.message}}};
  const setup=async(options={})=>{
    const records=[],events=[];
    let block=null;
    const ledger=new L.ProcessLedger(key,{scanOps:100,clock:()=>when,...options,sink:async r=>{
      if(block&&r.kind==="receipt-v2"){const b=block;block=null;b.enter.resolve(structuredClone(r));await b.release.promise}
      await options.sink?.(r);records.push(structuredClone(r))
    }});
    await ledger.publish(JSON.stringify(law));
    ledger.listen({},(r,seq)=>events.push({id:r.id,seq}));
    const pause=()=>{block={enter:deferred(),release:deferred()};return block};
    return {ledger,records,events,pause};
  };
  const continuation=(id,run)=>({instance:id,run,parents:{open:id}});
  const choice=(id,run,n,consent=true)=>req({consent,cites:{choice:id}},n,continuation(id,run));
  // Concurrent identical requests are physically held at the durable sink.
  if(group("not-visible-before-ack","concurrent-retry","concurrent-retry-bytes")){
    const competingWrite=deferred();
    const {ledger:l,records,events,pause}=await setup({sink:r=>{if(r.kind==="receipt-v2")competingWrite.resolve()}}),gate=pause();
    const text=req(null,1);
    const first=attempt(l.submitText(text,actor));
    // This checks actual absence while a signed candidate exists.
    const candidate=await gate.enter.promise;
    const pending=Array.from({length:7},()=>attempt(l.submitText(text,actor)));
    // Wait for a competing sink entry or a bounded observation interval.
    // A correct writer cannot enter the sink while the first is blocked.
    // The outcome assertions below do not depend on request duration.
    await Promise.race([competingWrite.promise,new Promise(resolve=>setTimeout(resolve,100))]);
    check("not-visible-before-ack",[l.length,l.entry(candidate.entry.receipt.id),events.length,records.length],[0,null,0,1]);
    gate.release.resolve();
    const all=await Promise.all([first,...pending]);
    check("concurrent-retry",[all.filter(r=>r.replayed===false).length,all.filter(r=>r.replayed===true).length,new Set(all.map(r=>r.receipt?.id)).size,l.length,events.length,records.length],[1,7,1,1,1,2]);
    check("concurrent-retry-bytes",all.every(r=>same(r.receipt,candidate.entry.receipt)&&same(r.detail,candidate.entry.detail)&&same(r.context,candidate.entry.context)),true);
  }
  // Same nonce + changed body must not enter the evaluator even concurrently.
  if(group("concurrent-key-conflict","actor-scoped-key")){
    const {ledger:l,events,pause}=await setup(),g=pause();
    const a=attempt(l.submitText(req(null,2),actor));await g.enter.promise;
    const b=attempt(l.submitText(req("different",2),actor));g.release.resolve();
    const [x,y]=await Promise.all([a,b]);
    check("concurrent-key-conflict",[x.receipt?.header.status,y.error,l.length,events.length],["ok","submission_conflict",1,1]);
    const z=await l.submitText(req(null,2),bob);
    check("actor-scoped-key",[z.replayed,z.receipt.id!==x.receipt.id,l.length],[false,true,2]);
  }
  // Distinct nonces competing for the same successful RUN.
  if(group("concurrent-run-claim")){
    const {ledger:l,events,pause}=await setup();
    const root=(await l.submitText(req(null,3),actor)).receipt.id;
    const g=pause(),a=attempt(l.submitText(req(null,4,continuation(root,"review")),actor));
    await g.enter.promise;
    const b=attempt(l.submitText(req(null,5,continuation(root,"review")),bob));g.release.resolve();
    const [x,y]=await Promise.all([a,b]);
    check("concurrent-run-claim",[x.receipt?.header.status,y.receipt?.header.status,y.detail?.reason,y.context?.completed===x.receipt?.id,l.length,events.length],["ok","registered","run_completed",true,3,3]);
  }
  // Same law + slot, different RUNs and identities. A prior refusal consumes nothing.
  if(group("failed-does-not-consume","concurrent-shared-slot","recovered-shared-slot")){
    const {ledger:l,records,events,pause}=await setup();
    const root=(await l.submitText(req(null,6),actor)).receipt.id;
    const refusal=await l.submitText(choice(root,"accept",7,false),actor);
    check("failed-does-not-consume",refusal.receipt.header.status,"not");
    const g=pause(),a=attempt(l.submitText(choice(root,"accept",8),actor));await g.enter.promise;
    const b=attempt(l.submitText(choice(root,"decline",9),bob));g.release.resolve();
    const [x,y]=await Promise.all([a,b]);
    check("concurrent-shared-slot",[x.receipt?.header.status,y.receipt?.header.status,y.detail?.reason,y.context?.spent,l.length,events.length],["ok","registered","citation_spent",[{slot:"choice",id:root}],4,4]);
    const restored=new L.ProcessLedger(key,{scanOps:100,clock:()=>when});await restored.restore(records);
    const again=await restored.submitText(choice(root,"decline",10),bob);
    check("recovered-shared-slot",[again.detail.reason,again.context.spent],["citation_spent",[{slot:"choice",id:root}]]);
  }
  // Known rejection before durable write; no tentative effect becomes visible.
  if(group("failed-write-no-phantom","failed-write-no-claim")){
    let reject=false;
    const {ledger:l,records,events}=await setup({sink:r=>{if(reject&&r.kind==="receipt-v2")throw Error("injected-before-write")}});
    const root=(await l.submitText(req(null,11),actor)).receipt.id;reject=true;
    const a=await attempt(l.submitText(choice(root,"accept",12),actor));
    const b=await attempt(l.submitText(choice(root,"decline",13),bob));
    check("failed-write-no-phantom",[a.error,b.error,l.length,events.length,records.length],["injected-before-write","unavailable",1,1,2]);
    const restored=new L.ProcessLedger(key,{scanOps:100,clock:()=>when});await restored.restore(records);
    const success=await restored.submitText(choice(root,"decline",13),bob);
    check("failed-write-no-claim",success.receipt.header.status,"ok");
  }
  // Publication is serialized with evaluation/commit, not an asynchronous
  // mutation of a request's already captured snapshot.
  if(group("publication-commit-order","retry-ignores-new-publication")){
    const {ledger:l,pause}=await setup(),g=pause();
    const a=attempt(l.submitText(req(null,14),actor));await g.enter.promise;
    const retired=l.retire(law.id),b=attempt(l.submitText(req(null,15),actor));g.release.resolve();
    const [x,,y]=await Promise.all([a,retired,b]);
    check("publication-commit-order",[x.receipt?.header.status,y.detail?.reason,x.receipt?.header.registry_hash!==y.receipt?.header.registry_hash],["ok","recognition_none",true]);
    const again=await l.submitText(req(null,14),actor);
    check("retry-ignores-new-publication",[again.replayed,same(again.receipt,x.receipt)],[true,true]);
  }
  // An optimistic materializer may produce two signed candidates from the
  // same observation. They are not commits. Force the conflicting observation
  // for the losing request without changing its admitted time or original law.
  if(group("two-tentative-candidates","conflict-reevaluation-binding","conflict-reevaluation-result")){
    const {ledger:l}=await setup();
    const root=(await l.submitText(req(null,16),actor)).receipt.id;
    const original=l.entry(root),rh=original.receipt.header.registry_hash,lh=original.receipt.header.process_hash;
    const opts={by,when,registryHash:rh,laws:new Map([[lh,JSON.stringify(law)]]),
      snapshots:new Map([[rh,JSON.stringify(l.snapshotByHash(rh))]]),keys:l.keys,
      read:async id=>id===root?{receipt:original.receipt,detail:original.detail}:null,
      completed:async()=>null,spent:async()=>false};
    const input=choice(root,"accept",17),otherInput=choice(root,"decline",18);
    const [a,b]=await Promise.all([L.issueV2(key,input,opts),L.issueV2(key,otherInput,{...opts,by:other})]);
    check("two-tentative-candidates",[a.receipt.header.status,b.receipt.header.status,l.length],["ok","ok",1]);
    const winner=await l.submitText(input,actor);
    const loser=await L.issueV2(key,otherInput,{...opts,by:other,spent:async (law,slot,id)=>law===lh&&slot==="choice"&&id===root});
    check("conflict-reevaluation-binding",[same(winner.receipt,a.receipt),loser.receipt.header.status,loser.detail.reason,
      loser.receipt.header.when,loser.receipt.header.process_hash,loser.context.request_hash,loser.submission_key,
      loser.receipt.id!==b.receipt.id],[true,"registered","citation_spent",when,lh,b.context.request_hash,b.submission_key,true]);
    const committed=await l.submitText(otherInput,bob);
    check("conflict-reevaluation-result",[same(committed.receipt,loser.receipt),l.length],[true,3]);
  }
  // A partially replayed prefix cannot be exposed as a validated institution.
  if(group("recovery-visibility")){
    const {ledger:l,records}=await setup();
    const root=(await l.submitText(req(null,19),actor)).receipt.id;
    await l.submitText(choice(root,"accept",20),actor);
    const restored=new L.ProcessLedger(key,{scanOps:100,clock:()=>when});
    const observed=[];
    function* replay(){
      yield records[0];yield records[1];
      for(const read of [()=>restored.length,()=>restored.entry(root),()=>restored.history(),()=>restored.trajectory(root)]){
        try{read();observed.push("visible")}catch(e){observed.push(e.code)}
      }
      yield records[2];
    }
    await restored.restore(replay());
    check("recovery-visibility",[observed,restored.length],[["unavailable","unavailable","unavailable","unavailable"],2]);
  }
  return results;
}
