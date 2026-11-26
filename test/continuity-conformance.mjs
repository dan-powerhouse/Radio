// Provider-independent observer scenarios over the reference's committed history.
// Expected sequence numbers and decisions are specified independently.
export async function continuityConformance(L,testKey){
 const results=[],key=await L.importMachineKey(testKey.jwk),records=[];
 const check=(name,actual,want)=>results.push({name:"continuity/"+name,ok:JSON.stringify(actual)===JSON.stringify(want),msg:JSON.stringify({actual,want})});
 const when="2026-11-25T00:00:00Z",actor={by:"p:"+"a".repeat(64),canRead:()=>true};
 const law={logline:"process-type@1",id:"radio.demo@1",issuer:"Example",recognize:{"==":[{var:"did"},"open"]},
   runs:[{id:"open",after:[],requires:{},steps:[],if_ok:"ok",if_not:"not",if_doubt:"doubt"}]};
 const l=new L.ProcessLedger(key,{clock:()=>when,scanOps:100,sink:r=>records.push(structuredClone(r))});
 await l.publish(JSON.stringify(law));
 const request=(i,did)=>JSON.stringify({tuple:{did},submission:"A".repeat(21)+["A","Q","g","w"][i]});
 const send=(i,did)=>l.submitText(request(i,did),actor);
 const t={frequency:"radio.*",status:"ok"},events=[];
 const stop=l.listen(t,(r,seq)=>events.push({receipt:r,seq}));
 const a=await send(0,"open"),b=await send(1,"unrelated");
 stop();const c=await send(2,"open");
 check("live-tuned-only",events.map(e=>e.seq),[1]);
 check("filtered-gap",l.page(t,0,100).map(e=>e.seq),[1,3]);
 check("pagination",[l.page(t,0,1).map(e=>e.seq),l.page(t,1,1).map(e=>e.seq),l.page(t,3,1).map(e=>e.seq)],[[1],[3],[]]);
 const restored=new L.ProcessLedger(key,{clock:()=>when,scanOps:100});
 await restored.restore(records);
 const heard=[];
 const unsub=restored.listen(t,(r,seq)=>heard.push({receipt:r,seq}),1);
 check("replacement-catchup",heard.map(e=>e.seq),[3]);
 const d=await restored.submitText(request(3,"open"),actor);
 const retry=await restored.submitText(request(3,"open"),actor);
 check("catchup-then-live",heard.map(e=>e.seq),[3,4]);
 check("retry-not-broadcast",[retry.replayed,heard.length,restored.length],[true,2,4]);
 check("same-committed-object",[heard[0]?.receipt.id===c.receipt.id,heard[1]?.receipt.id===d.receipt.id,heard.every(e=>!Object.hasOwn(e,"detail"))],[true,true,true]);
 unsub();
 const fromBeginning=[];
 const off=restored.listen({},(r,seq)=>fromBeginning.push(seq),0);off();
 check("explicit-zero-cursor",fromBeginning,[1,2,3,4]);
 const fresh=[];
 const un=restored.listen({},(r,seq)=>fresh.push(seq));un();
 check("omitted-cursor-live-only",fresh,[]);
 const future=[];
 const u=restored.listen({},(r,seq)=>future.push(seq),10);
 await restored.submitText(JSON.stringify({tuple:{did:"open"},submission:"B".repeat(20)+"AQ"}),actor);
 u();check("future-cursor-no-rewind",future,[]);
 check("restored-identity",restored.page({},0,100).slice(0,3).map(e=>e.receipt.id),[a.receipt.id,b.receipt.id,c.receipt.id]);
 return results;
}
