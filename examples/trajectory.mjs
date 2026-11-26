// Two distinct histories, one projection. Verify without the issuing ledger.
import assert from "node:assert/strict";
import { ProcessLedger, generateMachineKey, canonicalize, verifyBundleV2 } from "../dist/index.js";
const {key}=await generateMachineKey();
const ledger=new ProcessLedger(key);
const law={logline:"process-type@1",id:"course@2",issuer:"Example school",recognize:{"==":[{var:"did"},"enroll"]},runs:[
  {id:"open",after:[],requires:{course:"string"},steps:[],grants:{course:{var:"course"},owner:{var:"$by"}},if_ok:"Enrolled",if_not:"Not enrolled",if_doubt:"Pending"},
  {id:"complete",after:["open"],requires:{score:"integer"},steps:[
    {id:"owner",check:{"==":[{var:"$by"},{var:"$parents.open.detail.grants.owner"}]},if_not:"not",reason:"Only the learner may complete"},
    {id:"passed",check:{">=":[{var:"score"},70]},if_not:"not",reason:"Score below threshold"}
  ],grants:{course:{var:"$parents.open.detail.grants.course"},completed:true},if_ok:"Course completed",if_not:"Not completed",if_doubt:"Pending"}
]};
await ledger.publish(JSON.stringify(law));
const access={by:"p:learner",canRead:()=>true};
const nonce=()=>Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64url");
const send=(tuple,continuation)=>ledger.submitText(JSON.stringify({tuple,submission:nonce(),...(continuation?{continue:continuation}:{})}),access);
const trustedKeys=ledger.keys;
const bundles=[];
for(const score of [80,95]){
  const entry=await send({did:"enroll",course:"RADIO"});
  const id=entry.receipt.id;
  const complete=await send({score},{instance:id,run:"complete",parents:{open:id}});
  assert.equal(complete.receipt.header.status,"ok");
  bundles.push(canonicalize(await ledger.bundle(complete.receipt.id)));
}
// Only portable JSON and independent trust are needed from here onward.
const projections=[],heads=[];
for(const text of bundles){
  const verdict=await verifyBundleV2(text,trustedKeys);
  assert(verdict.valid,JSON.stringify(verdict));
  const b=JSON.parse(text),h=b.objects[b.head].header,d=b.objects[h.detail_hash];
  heads.push(b.head);
  projections.push({course:d.grants.course,completed:d.grants.completed});
}
assert.notEqual(heads[0],heads[1]);
assert.deepEqual(projections[0],projections[1]);
console.log("Independent trajectory verification: VALID — distinct histories, same projection",JSON.stringify(projections[0]));
