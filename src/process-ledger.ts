import { BundleV2, putBundleObject, MAX_BUNDLE_BYTES, MAX_BUNDLE_RECEIPTS } from "./bundle-v2.js";
import { utf8 } from "./bytes.js";
import { canonicalize } from "./jcs.js";
import { hashOf } from "./hash.js";
import { LoglineError } from "./errors.js";
import { KeyRing, MachineKey } from "./keys.js";
import { ProcessTypeRegistry, RegistrySnapshot, parseProcessType } from "./process-type.js";
import { MAX_OPS } from "./process.js";
import { tuned, Tuning } from "./radio.js";
import { ContextV1, DetailV2, HeaderV2, ReceiptV2, RunV2Options, SubmissionV2,
  authenticV2, issueV2, parseSubmissionV2, runV2 } from "./run-v2.js";

export interface ProcessEntry { seq: number; receipt: ReceiptV2; detail: DetailV2; context: ContextV1; tuple: unknown }
export type ProcessLedgerRecord =
  | { kind: "process-type"; law: string }
  | { kind: "retire-type"; id: string }
  | { kind: "receipt-v2"; entry: ProcessEntry; admission_snapshot: RegistrySnapshot };
export interface ProcessLedgerOptions {
  scanOps?: number;
  clock?: () => string;
  /** One complete record, durable before resolution. No partial commit. */
  sink?: (record: ProcessLedgerRecord) => void | Promise<void>;
}
export interface ProcessAccess {
  /** Trusted host attestation, NOT participant-controlled input. */
  by: string;
  /** Trusted authorization of evidence use (not necessarily disclosure). */
  canRead: (receipt: ReceiptV2) => boolean | Promise<boolean>;
}
export interface ProcessSubmitResult {
  receipt: ReceiptV2; detail: DetailV2; context: ContextV1; replayed: boolean;
}
const clone = <T>(v: T): T => structuredClone(v);
const same = (a: unknown, b: unknown) => canonicalize(a) === canonicalize(b);
const err = (code: string, text: string): never => { throw new LoglineError(code,text); };
const successKey = (instance: string, run: string) => canonicalize([instance,run]);
const onceKey = (law: string, slot: string, id: string) => canonicalize([law,slot,id]);
const exact = (o: unknown, names: string[]): boolean =>
  !!o && typeof o === "object" && !Array.isArray(o) &&
  Object.keys(o).length === names.length && names.every(k => Object.hasOwn(o,k));

/**
 * Target-version local reference, sharing the evaluator and record sink model
 * with the historical MemoryLedger. No network service or resident instance.
 * One serialized writer; indexes are reconstructed from committed receipts.
 * The host authenticates and authorizes every operation and protects private
 * entry/result/context reads. This class is not an API authorization layer.
 */
export class ProcessLedger {
  #registry: ProcessTypeRegistry;
  #scanOps: number;
  #laws = new Map<string,string>();
  #snapshots = new Map<string,string>();
  #entries: ProcessEntry[] = [];
  #byId = new Map<string,ProcessEntry>();
  #submissions = new Map<string,{requestHash:string;id:string}>();
  #success = new Map<string,string>();
  #consumed = new Set<string>();
  #listeners = new Set<{tuning:Tuning;fn:(r:ReceiptV2,seq:number)=>void;after:number}>();
  #tail: Promise<unknown> = Promise.resolve();
  #failed = false;
  #restoring = false;
  #used = false;
  #key: MachineKey;
  #keys: KeyRing;
  #clock: () => string;
  #sink?: ProcessLedgerOptions["sink"];
  constructor(key: MachineKey, opts: ProcessLedgerOptions = {}) {
    this.#key = {id:key.id,public:clone(key.public),private:key.private};
    this.#keys = {[key.id]:{jwk:clone(key.public)}};
    this.#scanOps = opts.scanOps ?? MAX_OPS;
    this.#registry = new ProcessTypeRegistry(this.#scanOps);
    this.#clock = opts.clock ?? (()=>new Date().toISOString().slice(0,19)+"Z");
    this.#sink = opts.sink;
  }
  get keys(): KeyRing { return clone(this.#keys); }
  #readable(): void {
    if (this.#restoring) err("unavailable","reference recovery is not yet validated");
  }
  get length(): number { this.#readable(); return this.#entries.length; }
  #serial<T>(fn:()=>Promise<T>): Promise<T> {
    const next = this.#tail.then(async()=>{
      if (this.#failed) return err("unavailable","reference ledger requires recovery");
      return fn();
    });
    this.#tail = next.catch(()=>{});
    return next;
  }
  async #write(record: ProcessLedgerRecord): Promise<void> {
    try { await this.#sink?.(clone(record)); }
    catch (e) {
      // An I/O error can be ambiguous. Never continue on an uncertain prefix.
      this.#failed = true; throw e;
    }
  }
  async #adoptLaw(text: string, persist: boolean): Promise<string> {
    const law = parseProcessType(text), json = canonicalize(law), hash = await hashOf(law);
    parseProcessType(json); // The bytes persisted must satisfy the same admission profile.
    const previous = this.#registry.hashForId(law.id);
    if (previous !== null) {
      if (previous !== hash) return err("process_exists","published id cannot be rebound");
      if (!persist) return err("restore","duplicate publication record");
      return hash;
    }
    if (persist) await this.#write({kind:"process-type",law:json});
    try {
      const adopted = await this.#registry.publish(json);
      if (adopted !== hash) return err("evidence_invalid","publication address mismatch");
      this.#laws.set(hash,json);
    } catch (e) { this.#failed = true; throw e; }
    return hash;
  }
  publish(text: string): Promise<string> {
    return this.#serial(async()=>{ this.#used=true; return this.#adoptLaw(text,true); });
  }
  retire(id: string): Promise<void> {
    return this.#serial(async()=>{
      this.#used=true;
      const hash = this.#registry.hashForId(id);
      if (hash === null) return err("process_missing","unknown published id");
      const {snapshot} = await this.#registry.snapshot();
      if (!snapshot.types.includes(hash)) return;
      await this.#write({kind:"retire-type",id});
      this.#registry.retire(id);
    });
  }
  law(hash: string) { this.#readable(); return this.#registry.law(hash); }
  snapshotByHash(hash: string) { this.#readable(); return this.#registry.snapshotByHash(hash); }
  entry(id: string): ProcessEntry | null { this.#readable(); const e=this.#byId.get(id); return e?clone(e):null; }
  /** Active laws only; historical laws remain retrievable by hash. */
  async published():Promise<{id:string;hash:string}[]>{
    this.#readable();
    const {snapshot}=await this.#registry.snapshot();
    return snapshot.types.map(hash=>({id:this.#registry.law(hash)!.id,hash}));
  }
  /** Local durable history, with a cursor independent of tuning. */
  page(tuning:Tuning={},afterSeq=0,limit=100):{seq:number;receipt:ReceiptV2}[]{
    this.#readable();
    if(!Number.isSafeInteger(afterSeq)||afterSeq<0||!Number.isSafeInteger(limit)||limit<1)
      return err("history_invalid","invalid history cursor or limit");
    const out:{seq:number;receipt:ReceiptV2}[]=[];
    for(let i=afterSeq;i<this.#entries.length&&out.length<limit;i++){
      const e=this.#entries[i];
      if(tuned(tuning,e.receipt.header))out.push({seq:e.seq,receipt:clone(e.receipt)});
    }
    return out;
  }
  history(tuning: Tuning = {}): ReceiptV2[] {
    this.#readable();
    return this.#entries.filter(e=>tuned(tuning,e.receipt.header)).map(e=>clone(e.receipt));
  }
  /** Causal ancestry, not a list of all attempts or an inferred current state. */
  trajectory(id: string): HeaderV2[] {
    this.#readable();
    const seen=new Set<string>(), stack=[id];
    while(stack.length){
      const x=stack.pop()!;
      if(seen.has(x)) continue;
      const e=this.#byId.get(x); if(!e) continue;
      seen.add(x); stack.push(...e.receipt.header.prev);
    }
    return this.#entries.filter(e=>seen.has(e.receipt.id)).map(e=>clone(e.receipt.header));
  }
  /** Trusted local export. The host must authorize disclosure of every object. */
  async bundle(id:string,canRead?:ProcessAccess["canRead"]):Promise<BundleV2>{
    this.#readable();
    const objects:Record<string,unknown>=Object.create(null),seen=new Set<string>(),pending=[id];
    while(pending.length){
      const ref=pending.pop()!;if(seen.has(ref))continue;
      if(seen.size>=MAX_BUNDLE_RECEIPTS)return err("bundle_limit","receipt limit");
      seen.add(ref);
      const e=this.entry(ref);if(!e)return err("evidence_invalid","missing bundle receipt");
      if(canRead&&(await canRead(clone(e.receipt)))!==true)return err("admission_denied","private evidence unavailable");
      const h=e.receipt.header,c=e.context;
      await putBundleObject(objects,ref,e.receipt,true);
      await putBundleObject(objects,h.input_hash,e.tuple);
      await putBundleObject(objects,h.detail_hash,e.detail);
      await putBundleObject(objects,h.context_hash,c);
      const snapshot=this.snapshotByHash(h.registry_hash);
      if(!snapshot)return err("evidence_invalid","missing bundle snapshot");
      await putBundleObject(objects,h.registry_hash,snapshot);
      for(const hash of snapshot.types){
        const law=this.law(hash);if(!law)return err("evidence_invalid","missing bundle law");
        await putBundleObject(objects,hash,law);
      }
      pending.push(...h.prev,...(c.completed?[c.completed]:[]));
    }
    const result:BundleV2={logline:"bundle@2",head:id,keys:this.keys,objects};
    if(utf8(canonicalize(result)).length>MAX_BUNDLE_BYTES)return err("bundle_limit","bundle byte limit");
    return result;
  }
  listen(tuning:Tuning,fn:(r:ReceiptV2,seq:number)=>void,afterSeq?:number):()=>void {
    this.#readable();
    if(afterSeq!==undefined&&(!Number.isSafeInteger(afterSeq)||afterSeq<0))
      return err("history_invalid","invalid history cursor");
    const l={tuning:clone(tuning),fn,after:afterSeq??this.#entries.length};
    // Register and replay within one synchronous turn; commits cannot interleave.
    this.#listeners.add(l);
    try{
      if(afterSeq!==undefined)for(const e of this.#entries)
        if(e.seq>l.after&&tuned(l.tuning,e.receipt.header)){
          l.after=e.seq;fn(clone(e.receipt),e.seq);
        }
    }catch(e){this.#listeners.delete(l);throw e;}
    return ()=>{this.#listeners.delete(l);};
  }
  async #capture() {
    const s=await this.#registry.snapshot();
    this.#snapshots.set(s.hash,canonicalize(s.snapshot));
    return s;
  }
  #options(by:string,when:string,registryHash:string,canRead:ProcessAccess["canRead"]): RunV2Options {
    const internal=new Set<string>();
    return {by,when,registryHash,laws:this.#laws,snapshots:this.#snapshots,keys:this.#keys,
      read:async id=>{
        const e=this.#byId.get(id);
        return e && (internal.has(id)||(await canRead(clone(e.receipt)))===true) ? clone({receipt:e.receipt,detail:e.detail}) : null;
      },
      completed:async (instance,run)=>{
        const id=this.#success.get(successKey(instance,run))??null;
        // Conflict evidence is machine-internal. Host must protect the private context.
        if(id)internal.add(id);
        return id;
      },
      spent:async (law,slot,id)=>this.#consumed.has(onceKey(law,slot,id))};
  }
  #claims(entry:ProcessEntry,submissionKey:string) {
    const {receipt:r,context:c}=entry,h=r.header;
    if(this.#byId.has(r.id)||this.#submissions.has(submissionKey))
      return err("evidence_invalid","duplicate committed receipt or submission");
    const claims:string[]=[];
    let success:string|null=null;
    if(h.status==="ok"){
      const law=h.process_hash&&this.#registry.law(h.process_hash);
      const run=law&&law.runs.find(x=>x.id===h.run);
      if(!h.process_hash||!run||!h.run)return err("evidence_invalid","successful receipt lacks its law or RUN");
      success=successKey(h.instance??r.id,h.run);
      if(this.#success.has(success))return err("evidence_invalid","duplicate successful RUN");
      for(const [slot,rule] of Object.entries(run.cites??{})){
        const id=Object.hasOwn(c.resolved.cites,slot)?c.resolved.cites[slot]:undefined;
        if(rule.once&&id!==undefined){
          const k=onceKey(h.process_hash,slot,id);
          if(this.#consumed.has(k))return err("evidence_invalid","duplicate once claim");
          claims.push(k);
        }
      }
    }
    return {claims,success};
  }
  #adoptEntry(entry:ProcessEntry,submissionKey:string,prepared:{claims:string[];success:string|null}):void {
    this.#entries.push(entry);this.#byId.set(entry.receipt.id,entry);
    this.#submissions.set(submissionKey,{requestHash:entry.context.request_hash,id:entry.receipt.id});
    if(prepared.success!==null)this.#success.set(prepared.success,entry.receipt.id);
    for(const k of prepared.claims)this.#consumed.add(k);
  }
  async submitText(text:string,access:ProcessAccess):Promise<ProcessSubmitResult>{
    // Admission data is captured before queuing. No identity from tuple.
    const request=parseSubmissionV2(text),by=access.by,canRead=access.canRead;
    if(typeof by!=="string"||!by.length||by.length>256||typeof canRead!=="function")
      return Promise.reject(new LoglineError("admission_invalid","trusted identity and evidence authorization required"));
    try { canonicalize(by); } catch { return err("admission_invalid","invalid attested identity"); }
    return this.#serial(async()=>{
      this.#used=true;
      const submissionKey=await hashOf({by,submission:request.submission});
      const requestHash=await hashOf({tuple:request.tuple,continue:request.continue??null});
      const seen=this.#submissions.get(submissionKey);
      if(seen){
        const e=this.#byId.get(seen.id)!;
        if((await canRead(clone(e.receipt)))!==true)return err("admission_denied","recorded result unavailable");
        if(seen.requestHash!==requestHash)return err("submission_conflict","submission key reused for a different request");
        return clone({receipt:e.receipt,detail:e.detail,context:e.context,replayed:true});
      }
      const when=this.#clock(),s=await this.#capture();
      const candidate=await issueV2(this.#key,text,this.#options(by,when,s.hash,canRead));
      if(candidate.submission_key!==submissionKey||candidate.context.request_hash!==requestHash)
        return err("evidence_invalid","submission binding mismatch");
      if(!await authenticV2(candidate.receipt,this.#keys))return err("key_invalid","candidate signature does not match machine trust");
      const entry:ProcessEntry={seq:this.length+1,receipt:candidate.receipt,detail:candidate.detail,
        context:candidate.context,tuple:request.tuple};
      const prepared=this.#claims(entry,submissionKey);
      await this.#write({kind:"receipt-v2",entry,admission_snapshot:s.snapshot});
      this.#adoptEntry(entry,submissionKey,prepared);
      for(const l of [...this.#listeners])if(entry.seq>l.after&&tuned(l.tuning,entry.receipt.header)){
        l.after=entry.seq;
        // Notification failure cannot turn an acknowledged durable commit into a failed submission.
        try{ Promise.resolve(l.fn(clone(entry.receipt),entry.seq)).catch(()=>{}); }catch{}
      }
      return clone({receipt:entry.receipt,detail:entry.detail,context:entry.context,replayed:false});
    });
  }
  /** Rebuild from a single trusted record prefix. Replay decisions, not caller-supplied indexes. */
  restore(records:Iterable<ProcessLedgerRecord>):Promise<void>{
    return this.#serial(async()=>{
      if(this.#used)return err("restore","restore requires an unused reference ledger");
      this.#used=true;
      this.#restoring=true;
      try{
        for(const raw of records){
          const rec=clone(raw);
          if(rec.kind==="process-type"){
            if(!exact(rec,["kind","law"])||typeof rec.law!=="string")return err("restore","invalid publication record");
            if(canonicalize(parseProcessType(rec.law))!==rec.law)return err("restore","noncanonical law record");
            await this.#adoptLaw(rec.law,false);continue;
          }
          if(rec.kind==="retire-type"){
            if(!exact(rec,["kind","id"])||typeof rec.id!=="string")return err("restore","invalid retirement record");
            const hash=this.#registry.hashForId(rec.id);
            const s=await this.#registry.snapshot();
            if(!hash||!s.snapshot.types.includes(hash))return err("restore","invalid retirement");
            this.#registry.retire(rec.id);continue;
          }
          if(rec.kind!=="receipt-v2"||!exact(rec,["kind","entry","admission_snapshot"]))
            return err("restore","unknown reference record");
          const e=rec.entry;
          if(!exact(e,["seq","receipt","detail","context","tuple"])||e.seq!==this.#entries.length+1||
             !await authenticV2(e.receipt,this.#keys))return err("restore","invalid committed receipt");
          const s=await this.#capture(),h=e.receipt.header,c=e.context;
          if(!same(s.snapshot,rec.admission_snapshot))return err("restore","admission snapshot does not match publication history");
          const request:SubmissionV2={tuple:e.tuple,submission:c.submission,...(c.continue===null?{}:{continue:c.continue})};
          const available=new Set([c.resolved.root,...Object.values(c.resolved.parents),...Object.values(c.resolved.cites)].filter(x=>x!==null));
          // Restore uses recorded authorized availability, not today's access policy.
          const replay=await runV2(canonicalize(request),this.#options(h.by,h.when,s.hash,r=>available.has(r.id)));
          if(replay.id!==e.receipt.id||!same(replay.header,h)||!same(replay.detail,e.detail)||!same(replay.context,c))
            return err("restore","committed decision does not replay");
          const prepared=this.#claims(e,replay.submission_key);
          this.#adoptEntry(e,replay.submission_key,prepared);
        }
      }catch(e){
        // A failed restore must not expose a partially recovered institution.
        this.#failed=true;
        this.#registry=new ProcessTypeRegistry(this.#scanOps);
        this.#laws.clear();this.#snapshots.clear();this.#entries=[];this.#byId.clear();
        this.#submissions.clear();this.#success.clear();this.#consumed.clear();
        throw e;
      }finally{this.#restoring=false;}
    });
  }
}
