// PR-09A review-only structural contract and independent content-address checks.
// Actual archive validation and native history probes have separate tests.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import Ajv2020 from "ajv/dist/2020.js";
import * as L from "../dist/index.js";
import * as limits from "../dist/profile.js";
import { openProcessMachine } from "../server/store.mjs";
import { createServer } from "../server/http.mjs";
const read = name => JSON.parse(readFileSync(new URL("../" + name, import.meta.url), "utf8"));
const schema = read("contracts/radio.schema.json"), review = read("vectors/boundary-review.json");
const ajv = new Ajv2020({strict:true,strictTypes:false,strictTuples:false,strictRequired:false,ownProperties:true});
ajv.addSchema(schema);
function check(name,value,expected=true){
 const validate=ajv.getSchema(schema.$id+"#/$defs/"+name);
 assert.equal(validate(value),expected,name+": "+JSON.stringify(validate.errors));
}
const first=read("vectors/receipt-v2-contract.json").cases[0];
const receipt=first.bundle.objects[first.receipt_id], h=receipt.header;
const detail=first.bundle.objects[h.detail_hash], context=first.bundle.objects[h.context_hash];
const tuple=first.request.tuple, result={receipt,detail,context,replayed:false};
const evidence={detail,context,tuple};
const cursor="opaque-checkpoint", next="opaque-page-token";
const hash=bytes=>"sha256:"+createHash("sha256").update(bytes).digest("hex");
const clone=structuredClone;
const cases=[
 ["root-only result","SubmitResult",result,true],
 ["retry result","SubmitResult",{...result,replayed:true},true],
 ["result excludes reactions","SubmitResult",{...result,reactions:[]},false],
 ["result excludes legacy halt flag","SubmitResult",{...result,halted:false},false],
 ["result requires context","SubmitResult",{receipt,detail,replayed:false},false],
 ["result not array of receipts","SubmitResult",[result],false],
 ["private evidence","PrivateEvidence",evidence,true],
 ["private evidence requires tuple","PrivateEvidence",{detail,context},false],
 ["private evidence free scalar","PrivateEvidence",{...evidence,tuple:17},true],
 ["notice public envelope only","ReceiptNotice",receipt,true],
 ["notice excludes private parts","ReceiptNotice",{...receipt,detail},false],
 ["notice excludes account metadata","ReceiptNotice",{...receipt,account:"private"},false],
 ["tuning omitted predicates","Tuning",{},true],
 ["tuning conjunction and alternatives","Tuning",{frequency:["blue@1","course.*"],status:["ok","not"],activated:true,by:h.by,process_hash:h.process_hash},true],
 ["tuning unaddressed","Tuning",{frequency:"_unaddressed"},true],
 ["tuning unknown property","Tuning",{detail:"secret"},false],
 ["tuning invalid wildcard","Tuning",{frequency:"*"},false],
 ["tuning invalid status","Tuning",{status:"success"},false],
 ["tuning duplicate alternatives","Tuning",{status:["ok","ok"]},false],
 ["tuning empty alternatives","Tuning",{frequency:[]},false],
 ["tuning no coercion","Tuning",{activated:"true"},false],
 ["history initial","HistoryRequest",{},true],
 ["history continuation","HistoryRequest",{after:cursor,limit:1,tuning:{status:"ok"}},true],
 ["history zero limit","HistoryRequest",{limit:0},false],
 ["history excessive limit","HistoryRequest",{limit:1001},false],
 ["history opaque cursor not sequence","HistoryRequest",{after:12},false],
 ["history nonempty cursor","HistoryRequest",{after:""},false],
 ["history no assumed time selector","HistoryRequest",{when:h.when},false],
 ["history intermediate page","HistoryPage",{items:[receipt],next,checkpoint:null},true],
 ["history terminal page","HistoryPage",{items:[receipt],next:null,checkpoint:cursor},true],
 ["history empty terminal checkpoint","HistoryPage",{items:[],next:null,checkpoint:cursor},true],
 ["history no early completed checkpoint","HistoryPage",{items:[receipt],next,checkpoint:cursor},false],
 ["history requires completion or continuation","HistoryPage",{items:[receipt],next:null,checkpoint:null},false],
 ["history no empty nonterminal page","HistoryPage",{items:[],next,checkpoint:null},false],
 ["history no private result","HistoryPage",{items:[result],next:null,checkpoint:cursor},false],
 ["discovery local shape","MachineDiscovery",{logline:"machine@2",versions:["2"],keys:first.bundle.keys,limits:{maxBody:131072},ttlMs:60000,cacheScope:"public"},true],
 ["discovery no mutable head","MachineDiscovery",{logline:"machine@2",versions:["2"],keys:first.bundle.keys,limits:{maxBody:131072},ttlMs:60000,cacheScope:"public",head:receipt.id},false],
 ["discovery no permission claims","MachineDiscovery",{logline:"machine@2",versions:["2"],keys:first.bundle.keys,limits:{maxBody:131072},ttlMs:60000,cacheScope:"public",admin:true},false],
 ["discovery version mismatch","MachineDiscovery",{logline:"machine@2",versions:["1.0"],keys:first.bundle.keys,limits:{maxBody:131072},ttlMs:60000,cacheScope:"public"},false],
 ["discovery bound cache lifetime","MachineDiscovery",{logline:"machine@2",versions:["2"],keys:first.bundle.keys,limits:{maxBody:131072},ttlMs:60001,cacheScope:"public"},false],
 ["stable request failure","BoundaryFailure",{error:"submission_conflict"},true],
 ["no raw host error","BoundaryFailure",{error:"unavailable",message:"private host error"},false],
 ["institutional reason not transport error","BoundaryFailure",{error:"parents_unmet"},false],
 ["valid skill name","SkillName","counterparty-review",true],
 ["invalid repeated hyphen","SkillName","counter--party",false],
 ["invalid case","SkillName","Counterparty",false],
 ["skill main file","DiplomacyPath","skills/proposer/SKILL.md",true],
 ["skill reference file","DiplomacyPath","skills/proposer/references/Guide.md",true],
 ["law file","DiplomacyPath","process-type.json",true],
 ["no manifest self-digest","DiplomacyPath","diplomacy.json",false],
 ["no extra root file","DiplomacyPath","README.md",false],
 ["no path traversal","DiplomacyPath","skills/proposer/../SKILL.md",false],
 ["no absolute path","DiplomacyPath","/skills/proposer/SKILL.md",false],
 ["no backslash","DiplomacyPath","skills/proposer\\SKILL.md",false],
 ["no hidden segment","DiplomacyPath","skills/proposer/.hidden",false],
 ["no trailing newline","DiplomacyPath","skills/proposer/SKILL.md\n",false],
 ["no too-long skill name","DiplomacyPath","skills/"+"a".repeat(65)+"/SKILL.md",false],
 ["package manifest","DiplomacyManifest",review.package.manifest,true],
 ["package guidance revision","DiplomacyManifest",review.guidance_revision.manifest,true],
 ["package no self-reference","DiplomacyManifest",{...review.package.manifest,id:review.package.package_id},false],
 ["package missing law","DiplomacyManifest",{logline:"diplomacy@1",files:{"skills/a/SKILL.md":h.input_hash,"skills/b/SKILL.md":h.input_hash}},false],
 ["package requires a Skill","DiplomacyManifest",{logline:"diplomacy@1",files:{"process-type.json":h.process_hash,"skills/a/references/Guide.md":h.input_hash}},false],
 ["package no root authority","DiplomacyManifest",{...review.package.manifest,permissions:["publish"]},false],
 ["package file digest strict","DiplomacyManifest",{logline:"diplomacy@1",files:{"process-type.json":h.process_hash,"skills/a/SKILL.md":"fake"}},false]
];
for(const [label,name,value,expected] of cases)test("boundary review: "+label,()=>check(name,value,expected));

test("candidate machine-readable limits match the v2 reference runtime",()=>{
 check("ReferenceLimitsV2",{
   active_laws: limits.MAX_SCAN_LAWS,
   active_law_bytes: limits.MAX_SCAN_LAW_BYTES,
   eval_work: limits.MAX_EVAL_WORK,
   intermediate_value_bytes: limits.MAX_EVAL_VALUE_BYTES,
   result_part_bytes: limits.MAX_RESULT_PART_BYTES,
   public_receipt_bytes: limits.MAX_PUBLIC_RECEIPT_BYTES,
   evidence_bytes: limits.MAX_EVIDENCE_BYTES,
   evidence_pair_bytes: limits.MAX_EVIDENCE_PAIR_BYTES
 });
});

test("boundary review: original signed fixture fits existing decision assembly",()=>{
 check("DecisionParts",{header:receipt.header,detail,context});
 check("Submission",first.request);
 check("BundleV2",first.bundle);
 assert.equal(receipt.id,first.receipt_id);
});
test("boundary review: independent package byte digests, canonical identity and unchanged law",async()=>{
 for(const f of [review.package,review.guidance_revision]){
  check("DiplomacyManifest",f.manifest);
  assert.deepEqual(Object.keys(f.files).sort(),Object.keys(f.manifest.files).sort());
  for(const [path,contents] of Object.entries(f.files)){
   assert.equal(hash(Buffer.from(contents,"utf8")),f.manifest.files[path]);
   assert.equal(await L.sha256(contents),f.manifest.files[path]);
  }
  const law=L.parseProcessType(f.files["process-type.json"]);
  assert.equal(L.canonicalize(law),f.files["process-type.json"]);
  assert.equal(await L.hashOf(law),f.law_hash);
  // Independent canonicalization for the restricted ASCII fixture, not a
  // general second JCS implementation or archive validator.
  const sorted=Object.fromEntries(Object.entries(f.manifest.files).sort(([a],[b])=>a<b?-1:a>b?1:0));
  assert.equal(hash(JSON.stringify({files:sorted,logline:"diplomacy@1"})),f.package_id);
  assert.equal(await L.hashOf(f.manifest),f.package_id);
  assert.equal(await L.hashOf({files:Object.fromEntries(Object.entries(sorted).reverse()),logline:"diplomacy@1"}),f.package_id);
 }
 assert.notEqual(review.package.package_id,review.guidance_revision.package_id);
 assert.equal(review.package.law_hash,review.guidance_revision.law_hash);
});
test("boundary review: structural schema alone cannot prove digest integrity or safe archive names",()=>{
 const f=review.package;
 const wrong=clone(f.manifest);
 wrong.files["skills/participant/SKILL.md"]=h.input_hash;
 check("DiplomacyManifest",wrong);
 assert.notEqual(hash(f.files["skills/participant/SKILL.md"]),wrong.files["skills/participant/SKILL.md"]);
 const collision=clone(f.manifest);
 collision.files["skills/participant/skill.md"]=h.input_hash;
 check("DiplomacyManifest",collision); // case collision needs semantic/archive validation
 assert.notEqual(new Set(Object.keys(collision.files).map(x=>x.toLowerCase())).size,Object.keys(collision.files).length);
});
test("boundary review: verifier verdict separates authenticity, replay and trajectory",async()=>{
 const good=await L.verifyBundleV2(JSON.stringify(first.bundle),first.bundle.keys);
 check("VerificationVerdict",good);assert.equal(good.valid,true);
 check("VerificationVerdict",{...good,valid:false},false);
 const missing=clone(first.bundle);delete missing.objects[h.input_hash];
 const bad=await L.verifyBundleV2(JSON.stringify(missing),first.bundle.keys);
 check("VerificationVerdict",bad);assert.equal(bad.authenticity,"pass");assert.equal(bad.valid,false);
 check("VerificationVerdict",{...bad,valid:true},false);
});
test("boundary review: actual local HTTP response, discovery and authorized evidence fit candidate shapes",{timeout:15000},async()=>{
 const dir=mkdtempSync(join(tmpdir(),"radio-boundary-"));let m,server;
 try{
  m=await openProcessMachine(dir,{scanOps:100,clock:()=>h.when});
  const token=m.accounts.add("reviewer",{admin:true}),other=m.accounts.add("observer");
  server=createServer(m);
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  const base="http://127.0.0.1:"+server.address().port;
  async function call(path,credential,body){
   const r=await fetch(base+path,{method:body===undefined?"GET":"POST",headers:{"logline-version":"2",...(credential?{authorization:"Bearer "+credential}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(5000)});
   return {status:r.status,json:await r.json()};
  }
  const discovery=await call("/.well-known/logline.json");assert.equal(discovery.status,200);check("MachineDiscovery",discovery.json);
  const law=first.bundle.objects[h.process_hash];
  assert.equal((await call("/processes",token,law)).status,201);
  const events=[];
  const stop=m.ledger.listen({},r=>events.push(r));
  const r=await call("/submit",token,first.request);assert.equal(r.status,201);check("SubmitResult",r.json);
  assert.equal(r.json.receipt.header.status,"ok");
  assert.equal(events.length,1);check("ReceiptNotice",events[0]);assert.deepEqual(events[0],r.json.receipt);
  const retry=await call("/submit",token,first.request);assert.equal(retry.status,200);check("SubmitResult",retry.json);
  assert.equal(retry.json.replayed,true);assert.deepEqual(retry.json.receipt,r.json.receipt);assert.equal(events.length,1);
  const path="/receipts/"+r.json.receipt.id;
  const d=await call(path+"/detail",token);assert.equal(d.status,200);check("PrivateEvidence",d.json);
  assert.equal((await call(path+"/detail",other)).status,403);
  const b=await call(path+"/bundle",token);assert.equal(b.status,200);check("BundleV2",b.json);
  assert.equal((await call(path+"/bundle",other)).status,403);
  const verdict=await L.verifyBundleV2(JSON.stringify(b.json),discovery.json.keys);check("VerificationVerdict",verdict);assert.equal(verdict.valid,true);
  stop();
 }finally{await server?.shutdown();m?.close();rmSync(dir,{recursive:true,force:true})}
});
