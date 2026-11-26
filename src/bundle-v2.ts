import { canonicalize } from "./jcs.js";
import { hashOf, HASH_RE } from "./hash.js";
import { parseStrict } from "./strict.js";
import { utf8, b64url, unb64url } from "./bytes.js";
import { LoglineError } from "./errors.js";
import { KeyRing, keyId } from "./keys.js";
import { Process, validateProcess } from "./process.js";
import { ProcessType, parseProcessType, validateRegistrySnapshot } from "./process-type.js";
import { Receipt, Detail, Store, WHEN_RE } from "./receipt.js";
import { verify } from "./verify.js";
import { ReceiptV2, DetailV2, ContextV1, SubmissionV2, authenticV2, runV2 } from "./run-v2.js";

/** Portable evidence, not a new authoritative object store. */
export interface BundleV2 {
  logline: "bundle@2"; head: string; keys: KeyRing; objects: Record<string,unknown>;
}
export type EvidenceVerdict = "pass" | "fail" | "incomplete" | "not_checked";
export interface BundleV2Verdict {
  valid: boolean;
  head: string | null;
  authenticity: EvidenceVerdict;
  replay: EvidenceVerdict;
  trajectory: EvidenceVerdict;
  checked: string[];
  issues: {code:string;id:string|null}[];
}
// Provisional local verification resource profile, not a wire-level maximum.
export const MAX_BUNDLE_BYTES = 32 * 1024 * 1024;
export const MAX_BUNDLE_OBJECTS = 32_768;
export const MAX_BUNDLE_RECEIPTS = 4_096;
const obj = (v:unknown):v is Record<string,unknown> => v!==null&&typeof v==="object"&&!Array.isArray(v);
const own = (v:object,k:string)=>Object.prototype.hasOwnProperty.call(v,k);
const exact=(v:unknown,fields:string[]):v is Record<string,unknown>=>obj(v)&&
  Object.keys(v).length===fields.length&&fields.every(k=>own(v,k));
const address=(v:unknown):v is string=>typeof v==="string"&&v.length===71&&HASH_RE.test(v);
const setOfIds=(v:unknown):v is string[]=>Array.isArray(v)&&v.every((x,i)=>address(x)&&(i===0||v[i-1]<x));
const same=(a:unknown,b:unknown)=>canonicalize(a)===canonicalize(b);
const validTime=(v:unknown):v is string=>typeof v==="string"&&WHEN_RE.test(v)&&
  Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v.slice(0,-1)+".000Z";
function publicEncoding(x:unknown):boolean{
  if(typeof x!=="string"||x.length!==43)return false;
  try{const raw=unb64url(x);return raw.length===32&&b64url(raw)===x;}catch{return false;}
}
type AnyReceipt=Receipt|ReceiptV2;
type AnyDetail=Detail|DetailV2;
class EvidenceError extends Error {
  constructor(readonly code:string,readonly id:string|null,readonly incomplete=false){super(code);}
}
const invalid=(code:string,id:string|null=null):never=>{throw new EvidenceError(code,id)};
const missing=(id:string):never=>{throw new EvidenceError("missing_object",id,true)};
const envelope=(v:unknown):v is AnyReceipt=>exact(v,["header","id","sig"])&&obj(v.header)&&obj(v.sig)&&
  (v.header.logline==="receipt@1"||v.header.logline==="receipt@2")&&address(v.id)&&
  exact(v.sig,["alg","key","value"])&&v.sig.alg==="Ed25519"&&address(v.sig.key)&&typeof v.sig.value==="string";

/**
 * Address by expected role, never by merely recognizing a receipt-like shape.
 * A free tuple can contain the exact fields of a signed envelope.
 * The full content hash and the receipt header hash are distinct domains.
 */
export async function putBundleObject(objects:Record<string,unknown>,id:string,value:unknown,receipt=false):Promise<void>{
  if(!address(id)|| (receipt ? !envelope(value)||value.id!==id||await hashOf(value.header)!==id : await hashOf(value)!==id))
    throw new LoglineError("bundle_invalid","object address mismatch");
  if(own(objects,id)&&!same(objects[id],value))throw new LoglineError("bundle_invalid","object address collision");
  if(!own(objects,id)&&Object.keys(objects).length>=MAX_BUNDLE_OBJECTS)throw new LoglineError("bundle_limit","object limit");
  objects[id]=structuredClone(value);
}

/**
 * Verify from raw JSON to detect duplicate keys and non-I-JSON input.
 * trustedKeys must arrive independently; bundle.keys never adds trust.
 * The head's authenticity and decision replay are distinct from recursive
 * closure verification. No verdict proves global ledger completeness.
 */
export async function verifyBundleV2(text:string,trustedKeys:KeyRing):Promise<BundleV2Verdict>{
  const v:BundleV2Verdict={valid:false,head:null,authenticity:"not_checked",replay:"not_checked",trajectory:"not_checked",checked:[],issues:[]};
  const report=(e:unknown,id:string|null=null):EvidenceVerdict=>{
    const issue=e instanceof EvidenceError?e:new EvidenceError("invalid_evidence",id);
    v.issues.push({code:issue.code,id:issue.id});
    return issue.incomplete?"incomplete":"fail";
  };
  let b:BundleV2,keys:KeyRing;
  try{
    if(typeof text!=="string"||utf8(text).length>MAX_BUNDLE_BYTES)invalid("bundle_limit");
    const raw=parseStrict(text,67);
    if(!exact(raw,["logline","head","keys","objects"])||raw.logline!=="bundle@2"||
      !address(raw.head)||!obj(raw.keys)||!obj(raw.objects))return invalid("bundle_shape");
    if(Object.keys(raw.objects).length>MAX_BUNDLE_OBJECTS)invalid("bundle_limit");
    if(Object.keys(raw.objects).some(k=>!address(k)))invalid("object_address");
    // Convenience keys must have the defined public shape, but are never used
    // in signature verification. Do not allow a private JWK in a bundle.
    for(const [id,k] of Object.entries(raw.keys)){
      if(!address(id)||!obj(k)||!own(k,"jwk")||Object.keys(k).some(x=>!["jwk","not_before","not_after"].includes(x))||
        !exact(k.jwk,["kty","crv","x"])||k.jwk.kty!=="OKP"||k.jwk.crv!=="Ed25519"||!publicEncoding(k.jwk.x)||
        (own(k,"not_before")&&!validTime(k.not_before))||(own(k,"not_after")&&!validTime(k.not_after)))
        invalid("bundle_keys");
    }
    b=raw as unknown as BundleV2;
    keys=parseStrict(canonicalize(trustedKeys)) as KeyRing;
    if(!obj(keys))invalid("trusted_keys");
    v.head=b.head;
  }catch(e){v.authenticity=report(e);return v;}
  const roles=new Map<string,"receipt"|"cas">(), receipts=new Map<string,AnyReceipt>(), cas=new Map<string,unknown>();
  function role(id:string,r:"receipt"|"cas"){
    if(!address(id))invalid("object_address",id);
    if(roles.has(id)&&roles.get(id)!==r)invalid("address_collision",id);
    roles.set(id,r);
    if(!own(b.objects,id))missing(id);
  }
  async function data(id:string):Promise<unknown>{
    role(id,"cas");
    if(cas.has(id))return cas.get(id);
    const x=b.objects[id];
    // Per-object depth limit matches free tuples and result parts.
    const json=canonicalize(x);
    parseStrict(json);
    if(await hashOf(x)!==id)invalid("object_hash",id);
    cas.set(id,x);return x;
  }
  async function receipt(id:string):Promise<AnyReceipt>{
    role(id,"receipt");
    const cached=receipts.get(id);if(cached)return cached;
    if(receipts.size>=MAX_BUNDLE_RECEIPTS)invalid("bundle_limit",id);
    const r=b.objects[id];
    if(!envelope(r)||r.id!==id||!own(keys,r.sig.key))return invalid("receipt_authenticity",id);
    if(r.header.logline==="receipt@2"){
      if(!await authenticV2(r,keys))invalid("receipt_authenticity",id);
    }else{
      // Dispatch strictly to the historical v1 verifier. Validate ancestry
      // shape for the portable closure, without altering historical signing.
      const k=keys[r.sig.key];
      if(!k||await keyId(k.jwk)!==r.sig.key||!(await verify(r,keys)).valid||
        !setOfIds(r.header.prev)||r.header.prev.includes(id)||
        !address(r.header.input_hash)||!address(r.header.detail_hash)||
        (r.header.process_hash!==null&&!address(r.header.process_hash)))invalid("receipt_authenticity",id);
    }
    receipts.set(id,r);return r;
  }
  async function read(id:string):Promise<{receipt:AnyReceipt;detail:AnyDetail}>{
    const r=await receipt(id),d=await data(r.header.detail_hash);
    if(!obj(d)||d.logline!==(r.header.logline==="receipt@2"?"detail@2":"detail@1"))return invalid("detail_shape",id);
    return {receipt:r,detail:d as unknown as AnyDetail};
  }

  // Verify the head before examining its private or causal evidence.
  try{await receipt(b.head);v.authenticity="pass";}
  catch(e){v.authenticity=report(e,b.head);return v;}

  type Claims={submission:string|null;success:string|null;once:string[]};
  type Replayed={deps:string[];claims:Claims};
  async function replayOne(id:string):Promise<Replayed>{
    const {receipt:r,detail}=await read(id),h=r.header;
    const tuple=await data(h.input_hash);
    if(h.logline==="receipt@1"){
      const law=h.process_hash===null?null:await data(h.process_hash);
      if(law!==null)validateProcess(law);
      const available=new Set(h.prev);
      // v1 recorded only its prev/spent observations. Extra bundle entries
      // must not silently convert an absent historical citation into a fact.
      for(const parent of h.prev)await read(parent);
      const store:Store={receipt:async ref=>{
        if(!available.has(ref))return null;
        const e=await read(ref);
        if(e.receipt.header.logline!=="receipt@1")return invalid("legacy_reference_version",ref);
        return {receipt:e.receipt as Receipt,detail:e.detail as Detail};
      }};
      const result=await verify(r,keys,{detail:detail as Detail,tuple,process:law as Process|null,store});
      if(!result.valid||!result.checks.every(c=>c.result==="pass"))invalid("decision_replay",id);
      return {deps:h.prev,claims:{submission:null,success:null,once:[]}};
    }
    const raw=await data(h.context_hash);
    if(!exact(raw,["logline","submission","request_hash","continue","spent","completed","resolved"])||
      raw.logline!=="context@1"||!address(raw.request_hash)||!exact(raw.resolved,["root","parents","cites"])||
      !obj(raw.resolved.parents)||!obj(raw.resolved.cites)||!Array.isArray(raw.spent)||
      (raw.resolved.root!==null&&!address(raw.resolved.root))||(raw.completed!==null&&!address(raw.completed))||
      !Object.values(raw.resolved.parents).every(address)||!Object.values(raw.resolved.cites).every(address)||
      !raw.spent.every(x=>exact(x,["slot","id"])&&typeof x.slot==="string"&&address(x.id)))
      return invalid("context_shape",id);
    const c=raw as unknown as ContextV1;
    const resolved=new Set<string>([...(c.resolved.root?[c.resolved.root]:[]),...Object.values(c.resolved.parents),...Object.values(c.resolved.cites)]);
    const deps=[...new Set([...resolved,...(c.completed?[c.completed]:[])])].sort();
    if(!same([...resolved].sort(),h.prev))invalid("causal_edges",id);
    for(const dep of deps)await read(dep); // distinguish absent evidence from an attested negative observation
    const laws=new Map<string,string>(),snapshots=new Map<string,string>(),parsed=new Map<string,ProcessType>();
    const snap=await data(h.registry_hash);validateRegistrySnapshot(snap);
    snapshots.set(h.registry_hash,canonicalize(snap));
    // For a resolved continuation the original snapshot is sufficient: the
    // current admission snapshot is not part of its signed disposition.
    for(const lawHash of snap.types){
      const value=await data(lawHash),json=canonicalize(value);
      parsed.set(lawHash,parseProcessType(json));laws.set(lawHash,json);
    }
    if(h.process_hash!==null&&!laws.has(h.process_hash))invalid("law_not_in_registry",id);
    const request:SubmissionV2={tuple,submission:c.submission,...(c.continue===null?{}:{continue:c.continue})};
    const again=await runV2(canonicalize(request),{
      when:h.when,by:h.by,registryHash:h.registry_hash,laws,snapshots,keys,
      read:async ref=>resolved.has(ref)||ref===c.completed?read(ref):null,
      completed:async()=>c.completed,
      spent:async(law,slot,ref)=>law===h.process_hash&&c.spent.some(p=>p.slot===slot&&p.id===ref)
    });
    if(again.id!==id||!same(again.header,h)||!same(again.detail,detail)||!same(again.context,c))
      invalid("decision_replay",id);
    const claims:Claims={submission:again.submission_key,success:null,once:[]};
    if(h.status==="ok"){
      const law=parsed.get(h.process_hash!)!,run=law.runs.find(x=>x.id===h.run)!;
      claims.success=canonicalize([h.instance??id,h.run]);
      for(const [slot,rule] of Object.entries(run.cites??{}))
        if(rule.once&&own(c.resolved.cites,slot))claims.once.push(canonicalize([h.process_hash,slot,c.resolved.cites[slot]]));
    }
    return {deps,claims};
  }

  const done=new Set<string>(),active=new Set<string>();
  const submissions=new Set<string>(),success=new Set<string>(),once=new Set<string>();
  let incomplete=false,failed=false;
  async function walk(id:string):Promise<void>{
    if(active.has(id)){failed=true;report(new EvidenceError("causal_cycle",id));return;}
    if(done.has(id))return;
    active.add(id);
    try{
      const result=await replayOne(id);
      if(id===b.head)v.replay="pass";
      for(const dep of result.deps)await walk(dep);
      const claim=(set:Set<string>,k:string|null,code:string)=>{
        if(k===null)return;
        if(set.has(k)){failed=true;report(new EvidenceError(code,id));}
        set.add(k);
      };
      claim(submissions,result.claims.submission,"conflicting_submission");
      claim(success,result.claims.success,"conflicting_run");
      for(const k of result.claims.once)claim(once,k,"conflicting_once");
      v.checked.push(id);
    }catch(e){
      const status=report(e,id);
      if(id===b.head)v.replay=status;
      if(status==="incomplete")incomplete=true;else failed=true;
    }finally{active.delete(id);done.add(id);}
  }
  await walk(b.head);
  // Extra objects never become available during replay. Still reject a
  // misaddressed object in the supplied CAS map. Unused receipt-addressed
  // envelopes are not asserted to be trusted or replayed.
  for(const [id,value] of Object.entries(b.objects)){
    if(roles.has(id))continue;
    try{
      if(await hashOf(value)===id)continue;
      if(envelope(value)&&value.id===id&&await hashOf(value.header)===id)continue;
      invalid("object_hash",id);
    }catch(e){failed=true;report(e,id);}
  }
  v.trajectory=failed?"fail":incomplete?"incomplete":"pass";
  v.valid=v.authenticity==="pass"&&v.replay==="pass"&&v.trajectory==="pass";
  return v;
}
