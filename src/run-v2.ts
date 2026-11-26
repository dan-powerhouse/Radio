import { LoglineError } from "./errors.js";
import { canonicalize } from "./jcs.js";
import { hashOf, HASH_RE } from "./hash.js";
import { parseStrict } from "./strict.js";
import { b64url, unb64url, utf8 } from "./bytes.js";
import { evaluate, lookup, Budget } from "./expr.js";
import { DEFAULT_OPS, FREQUENCY_RE, UNADDRESSED } from "./process.js";
import { ProcessType, RunDefinition, RegistrySnapshot, parseProcessType, validateRegistrySnapshot } from "./process-type.js";
import { scan, ScanResult, MAX_SCAN_INPUT_BYTES, MAX_SCAN_SNAPSHOT_BYTES } from "./scanner.js";
import { KeyRing, MachineKey, keyId, PublicJwk, signIdV2, verifyIdV2 } from "./keys.js";
import { Detail, Finding, Receipt, Status, WHEN_RE, typeOk, freqMatch } from "./receipt.js";
import { verify } from "./verify.js";

// Local admission bound; not a universal protocol limit.
export const MAX_SUBMISSION_BYTES = 131_072;
export const MAX_RESULT_PART_BYTES = 1_048_576;
export interface Continuation { instance: string; run: string; parents: Record<string, string> }
export interface SubmissionV2 { tuple: unknown; submission: string; continue?: Continuation }
export type ReasonCode =
  | "recognition_none" | "recognition_ambiguous" | "recognition_indeterminate"
  | "continuation_unavailable" | "run_unavailable" | "parents_unmet" | "run_completed"
  | "requires_unmet" | "cites_unmet" | "citation_spent" | "check_not" | "check_doubt" | "grants_doubt";
export interface DetailV2 extends Omit<Detail, "logline"> {
  logline: "detail@2"; reason: ReasonCode | null; recognition: ScanResult | null;
}
export interface HeaderV2 {
  logline: "receipt@2"; frequency: string; status: Status; activated: boolean;
  process: string | null; process_hash: string | null; registry_hash: string;
  run: string | null; instance: string | null; input_hash: string; context_hash: string; detail_hash: string;
  when: string; by: string; prev: string[]; public: Record<string, unknown>;
}
export interface ReceiptV2 { header: HeaderV2; id: string; sig: Receipt["sig"] }
export interface SpentClaim { slot: string; id: string }
export interface ContextV1 {
  logline: "context@1"; submission: string; request_hash: string; continue: Continuation | null;
  spent: SpentClaim[]; completed: string | null;
  resolved: { root: string | null; parents: Record<string,string>; cites: Record<string,string> };
}
export interface RunV2Result {
  header: HeaderV2; id: string; detail: DetailV2; context: ContextV1; submission_key: string;
}
/**
 * TRUSTED adapter boundary, never the transport body. A single admitted
 * observation set belongs to one logical machine and one attempt. The host
 * authenticates/authorizes the actor and evidence access before invoking.
 * read(null) means unavailable (including denied); a malformed returned object
 * is corruption, not a legal refusal. Exceptions are infrastructure failures.
 * completed/spent observe authoritative claims, not caller assertions.
 * The future commit boundary must validate them atomically and retry on races.
 */
export interface RunV2Options {
  when: string; by: string; registryHash: string;
  laws: ReadonlyMap<string,string>; snapshots: ReadonlyMap<string,string>; keys: KeyRing;
  read(id: string): Promise<{receipt: Receipt | ReceiptV2; detail: Detail | DetailV2} | null>;
  completed(instance: string, run: string): Promise<string | null>;
  spent(lawHash: string, slot: string, id: string): Promise<boolean>;
}
type Evidence = { id: string; header: Receipt["header"] | HeaderV2; detail: Detail | DetailV2 };
const obj = (v: unknown): v is Record<string,unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o,k);
const sorted = <T>(o: Record<string,T>) => Object.keys(o).sort().map(k => [k,o[k]] as const);
const dict = <T>(): Record<string,T> => Object.create(null);
const keysAre = (o: Record<string,unknown>, keys: string[]) =>
  Object.keys(o).length === keys.length && keys.every(k => own(o,k));
const address = (v: unknown): v is string => typeof v === "string" && v.length === 71 && HASH_RE.test(v);
const runId = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(v);
const frequency = (v: unknown): v is string => typeof v === "string" && FREQUENCY_RE.test(v);
const fail = (code: string, msg: string): never => { throw new LoglineError(code,msg); };
const corrupt = (msg: string): never => fail("evidence_invalid",msg);
const validWhen = (v: unknown): v is string => typeof v === "string" && WHEN_RE.test(v) &&
  Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v.slice(0,-1)+".000Z";
const validBy = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 256;
const canonicalBinary = (v: unknown, min: number, max: number): v is string => {
  if (typeof v !== "string" || v.length > Math.ceil(max*4/3)) return false;
  try { const b = unb64url(v); return b.length >= min && b.length <= max && b64url(b) === v; }
  catch { return false; }
};
const validSet = (v: unknown): v is string[] => Array.isArray(v) &&
  v.every((h,i) => address(h) && (i === 0 || v[i-1] < h));
const stableReason = new Set<ReasonCode>(["recognition_none","recognition_ambiguous","recognition_indeterminate",
  "continuation_unavailable","run_unavailable","parents_unmet","run_completed","requires_unmet",
  "cites_unmet","citation_spent","check_not","check_doubt","grants_doubt"]);
const byteLength = (s: string) => utf8(s).length;
function copyJSON<T>(v: T, depth = 64): T { return parseStrict(canonicalize(v),depth) as T; }
function resultPart<T>(v: T): T {
  const json = canonicalize(v);
  if (byteLength(json) > MAX_RESULT_PART_BYTES) return fail("result_limit","result part byte limit");
  try { return parseStrict(json) as T; }
  catch { return fail("result_limit","result part outside I-JSON bounds"); }
}

/** Strict transport parsing. No identity, law, time or observations in the request. */
export function parseSubmissionV2(text: string): SubmissionV2 {
  if (typeof text !== "string" || byteLength(text) > MAX_SUBMISSION_BYTES)
    fail("submission_limit","submission byte limit");
  // Envelope nesting adds one level to the free tuple. Check the tuple itself below.
  const v = parseStrict(text,65);
  if (!obj(v) || !keysAre(v,own(v,"continue") ? ["tuple","submission","continue"] : ["tuple","submission"]) ||
      !canonicalBinary(v.submission,16,96)) return fail("submission_invalid","invalid submission envelope");
  const tuple = canonicalize(v.tuple);
  if (byteLength(tuple) > MAX_SCAN_INPUT_BYTES) fail("submission_limit","tuple byte limit");
  parseStrict(tuple);
  if (own(v,"continue")) {
    const c = v.continue;
    if (!obj(c) || !keysAre(c,["instance","run","parents"]) || !address(c.instance) || !runId(c.run) ||
        !obj(c.parents) || Object.keys(c.parents).length > 64 ||
        Object.entries(c.parents).some(([k,id]) => !runId(k) || !address(id)))
      fail("submission_invalid","invalid continuation envelope");
  }
  return v as unknown as SubmissionV2;
}

/** Receipt@2 authenticity only, not replay, authorization or ledger completeness. */
export async function authenticV2(value: unknown, keys: KeyRing): Promise<boolean> {
  try {
    const r = copyJSON(value,65), trusted = copyJSON(keys);
    if (!obj(r) || !keysAre(r,["header","id","sig"]) || !address(r.id) || !obj(r.sig) ||
        !keysAre(r.sig,["alg","key","value"]) || r.sig.alg !== "Ed25519" || !address(r.sig.key) ||
        !canonicalBinary(r.sig.value,64,64) || !obj(r.header)) return false;
    const h = r.header;
    if (!keysAre(h,["logline","frequency","status","activated","process","process_hash","registry_hash",
      "run","instance","input_hash","context_hash","detail_hash","when","by","prev","public"]) ||
      h.logline !== "receipt@2" || !["registered","ok","not","doubt"].includes(h.status as string) ||
      h.activated !== (h.status !== "registered") || !validWhen(h.when) || !validBy(h.by) ||
      !address(h.registry_hash) || !address(h.input_hash) || !address(h.context_hash) || !address(h.detail_hash) ||
      !validSet(h.prev) || h.prev.includes(r.id) || !obj(h.public) ||
      Object.keys(h.public).some(k => !/^(detail|tuple)\.[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*$/.test(k))) return false;
    if (h.process === null) {
      if (h.frequency !== UNADDRESSED || h.status !== "registered" || h.process_hash !== null ||
          h.run !== null || h.instance !== null || h.prev.length || Object.keys(h.public).length) return false;
    } else {
      if (!frequency(h.process) || h.frequency !== h.process || !address(h.process_hash) ||
          (h.instance !== null && (!address(h.instance) || !h.prev.includes(h.instance))) ||
          (!runId(h.run) && !(h.run === null && h.status === "registered" && address(h.instance)))) return false;
    }
    if (await hashOf(h) !== r.id || !own(trusted,r.sig.key)) return false;
    const k = trusted[r.sig.key];
    if (!k || !obj(k.jwk) || !keysAre(k.jwk,["kty","crv","x"]) ||
        k.jwk.kty !== "OKP" || k.jwk.crv !== "Ed25519" || !canonicalBinary(k.jwk.x,32,32) ||
        await keyId(k.jwk as unknown as PublicJwk) !== r.sig.key ||
        (k.not_before !== undefined && (!validWhen(k.not_before) || h.when < k.not_before)) ||
        (k.not_after !== undefined && (!validWhen(k.not_after) || h.when > k.not_after))) return false;
    return verifyIdV2(k.jwk,r.id,r.sig.value);
  } catch { return false; }
}
function recognitionOk(scan: unknown, h: HeaderV2, reason: ReasonCode | null): boolean {
  if (scan === null) return h.instance !== null || (h.frequency === UNADDRESSED && reason === "continuation_unavailable");
  if (!obj(scan) || !keysAre(scan,["outcome","matches","selected","diagnostics","ops_used"]) ||
      !validSet(scan.matches) || !Array.isArray(scan.diagnostics) || !Number.isInteger(scan.ops_used) ||
      (scan.ops_used as number) < 0 || (scan.ops_used as number) > 1_000_000 || h.instance !== null) return false;
  const diagnostics = scan.diagnostics, matched = scan.matches;
  const codes = ["recognize_non_boolean","eval_syntax","eval_operator","eval_type","eval_missing","eval_range","eval_budget","eval_depth"];
  if (!diagnostics.every(d => obj(d) && keysAre(d,["law_hash","code"]) && address(d.law_hash) && codes.includes(d.code as string))) return false;
  if (!validSet(diagnostics.map(d=>d.law_hash)) || diagnostics.some(d=>matched.includes(d.law_hash))) return false;
  if (scan.outcome === "unique") return scan.matches.length === 1 && diagnostics.length === 0 &&
    scan.selected === scan.matches[0] && h.process_hash === scan.selected && h.run !== null;
  return h.frequency === UNADDRESSED && h.status === "registered" && scan.selected === null &&
    reason === "recognition_"+scan.outcome &&
    (scan.outcome === "none" ? scan.matches.length === 0 && diagnostics.length === 0 :
      scan.outcome === "ambiguous" ? scan.matches.length >= 2 && diagnostics.length === 0 :
      scan.outcome === "indeterminate" && diagnostics.length > 0);
}
function detailOk(d: Detail | DetailV2, h: Evidence["header"]): boolean {
  if (!obj(d) || !keysAre(d,h.logline === "receipt@2"
    ? ["logline","consequence","findings","unmet","grants","reason","recognition"]
    : ["logline","consequence","findings","unmet","grants"])) return false;
  if (d.logline !== (h.logline === "receipt@2" ? "detail@2" : "detail@1") ||
      typeof d.consequence !== "string" || !Array.isArray(d.findings) ||
      (d.unmet !== null && (!Array.isArray(d.unmet) || !d.unmet.every(x => typeof x === "string"))) ||
      (d.grants !== null && !obj(d.grants))) return false;
  if (!["registered","ok","not","doubt"].includes(h.status) || !(frequency(h.frequency) || h.frequency === UNADDRESSED)) return false;
  if (d.logline === "detail@2" && h.logline === "receipt@2") {
    if (h.status === "ok" ? d.reason !== null : !stableReason.has(d.reason as ReasonCode)) return false;
    if (h.status === "registered" ? !d.unmet?.length || d.findings.length !== 0 || d.grants !== null
        : d.unmet !== null || (h.status !== "ok" && d.grants !== null)) return false;
    if (!d.findings.every(f => {
      if (!obj(f) || typeof f.step !== "string" || !/^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*$/.test(f.step)) return false;
      if (f.result === "ok") return keysAre(f,["step","result"]);
      if (f.result !== "not" && f.result !== "doubt") return false;
      return typeof f.reason === "string" && (own(f,"error")
        ? f.result === "doubt" && typeof f.error === "string" && keysAre(f,["step","result","reason","error"])
        : keysAre(f,["step","result","reason"]));
    })) return false;
    const actual = d.findings.some(f=>f.result==="not") ? "not" : d.findings.some(f=>f.result==="doubt") ? "doubt" : "ok";
    if (h.status !== "registered" && actual !== h.status) return false;
    if (h.status === "not" && d.reason !== "check_not") return false;
    if (h.status === "doubt" && d.reason !== "check_doubt" && d.reason !== "grants_doubt") return false;
    if (h.status === "registered" && d.reason?.startsWith("check_")) return false;
    if (h.status === "registered" && d.reason === "grants_doubt") return false;
    if (h.process !== null && h.run === null && d.reason !== "run_unavailable") return false;
    if (!recognitionOk(d.recognition,h,d.reason)) return false;
  }
  return true;
}
const effectiveInstance = (e: Evidence) => e.header.logline === "receipt@2" && e.header.status === "ok" ? e.header.instance ?? e.id : null;
const evalCode = (e: unknown): string => {
  if (e instanceof LoglineError && e.code.startsWith("eval_")) return e.code;
  // A computed grant must itself be I-JSON, not merely a JS value.
  if (e instanceof LoglineError && (e.code === "ijson" || e.code === "jcs_number")) return "eval_range";
  if (e instanceof LoglineError && (e.code === "jcs_string" || e.code === "jcs_type")) return "eval_type";
  throw e; // do not sign an infrastructure error as a legal decision
};

/** Deterministic tentative result. Does not reserve keys, persist, publish or broadcast. */
export async function runV2(text: string, options: RunV2Options): Promise<RunV2Result> {
  const request = parseSubmissionV2(text), tuple = request.tuple, continuation = request.continue ?? null;
  const {when,by,registryHash} = options;
  if (!validWhen(when) || !validBy(by)) fail("admission_invalid","invalid attested time or identity");
  try { canonicalize(by); } catch { fail("admission_invalid","invalid attested identity"); }
  // Capture content and trust inputs before asynchronous resolution.
  const laws = new Map(options.laws), snapshots = new Map(options.snapshots), keys = copyJSON(options.keys);
  const read = options.read.bind(options), completed = options.completed.bind(options), spent = options.spent.bind(options);
  const evidence = new Map<string,Evidence | null>();
  async function get(id: string): Promise<Evidence | null> {
    if (evidence.has(id)) return evidence.get(id)!;
    const received = await read(id);
    if (received === null) { evidence.set(id,null); return null; }
    const {receipt,detail} = copyJSON(received,66);
    if (!receipt || receipt.id !== id || !receipt.header || !detail) return corrupt("receipt lookup mismatch");
    let ok: boolean;
    if (receipt.header.logline === "receipt@2") ok = await authenticV2(receipt,keys);
    else if (receipt.header.logline === "receipt@1") ok = address(receipt.sig?.key) && own(keys,receipt.sig.key) && (await verify(receipt,keys,{detail:detail as Detail})).valid;
    else ok = false;
    if (!ok || !detailOk(detail,receipt.header) || await hashOf(detail) !== receipt.header.detail_hash)
      return corrupt("invalid authoritative receipt or detail");
    const found = {id,header:receipt.header,detail};
    evidence.set(id,found);
    return found;
  }
  async function snapshot(hash: string): Promise<{snapshot: RegistrySnapshot; json: string}> {
    const json = snapshots.get(hash);
    if (!address(hash) || json === undefined || byteLength(json) > MAX_SCAN_SNAPSHOT_BYTES)
      return corrupt("missing or oversized authoritative snapshot");
    const v = parseStrict(json);
    validateRegistrySnapshot(v);
    if (await hashOf(v) !== hash) return corrupt("snapshot address mismatch");
    return {snapshot:v,json};
  }
  async function lawAt(hash: string): Promise<ProcessType> {
    const json = laws.get(hash);
    if (json === undefined) return corrupt("missing authoritative law");
    const law = parseProcessType(json);
    if (await hashOf(law) !== hash) return corrupt("law address mismatch");
    return law;
  }
  const current = await snapshot(registryHash);
  let registry = registryHash, lawHash: string | null = null, law: ProcessType | null = null,
    run: RunDefinition | null = null, instance: string | null = null, recognition: ScanResult | null = null;
  const parents = dict<Evidence>(), cites = dict<Evidence>();
  const context: ContextV1 = {
    logline:"context@1", submission:request.submission,
    request_hash:await hashOf({tuple,continue:continuation}), continue:continuation,
    spent:[], completed:null, resolved:{root:null,parents:dict(),cites:dict()}
  };
  let reason: ReasonCode | null = null, gaps: string[] = [];
  const register = (code: ReasonCode, unmet: string[]) => { reason = code; gaps = unmet; };
  if (continuation === null) {
    recognition = await scan(canonicalize(tuple),registryHash,current.json,laws);
    if (recognition.outcome !== "unique") {
      const code = ("recognition_"+recognition.outcome) as ReasonCode;
      register(code,[code]);
    } else {
      lawHash = recognition.selected;
      law = await lawAt(lawHash);
      run = law.runs[0];
    }
  } else {
    const root = await get(continuation.instance);
    if (!root || root.header.logline !== "receipt@2" || root.header.status !== "ok" ||
        root.header.instance !== null || !root.header.process_hash) {
      register("continuation_unavailable",["continuation"]);
    } else {
      const rootLaw = await lawAt(root.header.process_hash);
      const original = await snapshot(root.header.registry_hash);
      if (rootLaw.id !== root.header.process || !original.snapshot.types.includes(root.header.process_hash))
        return corrupt("root law or registry mismatch");
      if (root.header.run !== rootLaw.runs[0].id) return corrupt("root is not an entry RUN");
      law = rootLaw; lawHash = root.header.process_hash; registry = root.header.registry_hash;
      instance = root.id; context.resolved.root = root.id;
      run = law.runs.find(r => r.id === continuation.run && r.after.length > 0) ?? null;
      if (!run) register("run_unavailable",["run"]);
      else if (!keysAre(continuation.parents,run.after)) register("parents_unmet",["parents"]);
      else {
        const unmet: string[] = [];
        for (const role of [...run.after].sort()) {
          const e = await get(continuation.parents[role]);
          if (!e || e.header.logline !== "receipt@2" || e.header.status !== "ok" ||
              e.header.process_hash !== lawHash || e.header.registry_hash !== registry ||
              e.header.run !== role || effectiveInstance(e) !== instance) unmet.push("parents."+role);
          else { parents[role] = e; context.resolved.parents[role] = e.id; }
        }
        if (unmet.length) register("parents_unmet",unmet);
        else {
          const conflict = await completed(instance,run.id);
          if (conflict !== null) {
            if (!address(conflict)) return corrupt("invalid completion observation");
            const e = await get(conflict);
            if (!e || e.header.logline !== "receipt@2" || e.header.status !== "ok" ||
                e.header.process_hash !== lawHash || e.header.registry_hash !== registry ||
                e.header.run !== run.id || effectiveInstance(e) !== instance) return corrupt("invalid completion evidence");
            context.completed = conflict; register("run_completed",["run"]);
          }
        }
      }
    }
  }
  if (run && reason === null) {
    const unmet = sorted(run.requires).filter(([path,t]) => !typeOk(lookup(tuple,path),t)).map(([path]) => path);
    if (unmet.length) register("requires_unmet",unmet);
  }
  if (run && reason === null) {
    const given = lookup(tuple,"cites"), unmet: string[] = [];
    for (const [slot,rule] of sorted(run.cites ?? {})) {
      const path = "cites."+slot;
      if (given !== undefined && !obj(given)) { unmet.push(path); continue; }
      const id = obj(given) && own(given,slot) ? given[slot] : undefined;
      if (id === undefined && rule.optional) continue;
      if (!address(id)) { unmet.push(path); continue; }
      const e = await get(id);
      if (!e || !freqMatch(rule.frequency,e.header.frequency) || (rule.status && !rule.status.includes(e.header.status))) {
        unmet.push(path); continue;
      }
      cites[slot] = e; context.resolved.cites[slot] = id;
    }
    if (unmet.length) register("cites_unmet",unmet);
    else {
      for (const [slot,rule] of sorted(run.cites ?? {})) if (rule.once && own(cites,slot)) {
        const id = cites[slot].id, consumed = await spent(lawHash!,slot,id);
        if (typeof consumed !== "boolean") return corrupt("invalid once observation");
        if (consumed) context.spent.push({slot,id});
      }
      if (context.spent.length) register("citation_spent",context.spent.map(c => "cites."+c.slot));
    }
  }

  let status: Status = "registered", findings: Finding[] = [], grants: Record<string,unknown> | null = null;
  const activated = reason === null && run !== null;
  if (activated && run) {
    const scope = {tuple,machine:{when,today:when.slice(0,10),by,instance,parents,cites}};
    const budget: Budget = {left:run.limits?.ops ?? DEFAULT_OPS};
    findings = run.steps.map(s => {
      try {
        return evaluate(s.check,scope,budget) === true ? {step:s.id,result:"ok"} :
          {step:s.id,result:s.if_not,reason:s.reason};
      } catch (e) { return {step:s.id,result:"doubt",reason:s.reason,error:evalCode(e)}; }
    });
    status = findings.some(f => f.result === "not") ? "not" : findings.some(f => f.result === "doubt") ? "doubt" : "ok";
    if (status === "not") reason = "check_not";
    else if (status === "doubt") reason = "check_doubt";
    else if (run.grants) {
      try {
        const computed = dict<unknown>();
        for (const [k,e] of sorted(run.grants)) computed[k] = evaluate(e,scope,budget);
        grants = copyJSON(computed,63);
      } catch (e) {
        grants = null; status = "doubt"; reason = "grants_doubt";
        findings.push({step:"grants",result:"doubt",reason:"The grants could not be computed.",error:evalCode(e)});
      }
    }
  }
  const consequence = status === "registered" ? "Recorded. The RUN did not activate." : run!["if_"+status as "if_ok"|"if_not"|"if_doubt"];
  const detail: DetailV2 = resultPart({logline:"detail@2",consequence,findings,unmet:activated?null:gaps,grants,reason,recognition});
  const pub = dict<unknown>();
  for (const path of run?.broadcast ?? []) {
    const [part,...rest] = path.split(".");
    const value = lookup(part === "detail" ? detail : tuple,rest.join("."));
    if (value !== undefined) pub[path] = value;
  }
  const prev = [...new Set([...(instance?[instance]:[]),...Object.values(parents).map(e=>e.id),...Object.values(cites).map(e=>e.id)])].sort();
  const checkedContext = resultPart(context);
  const header: HeaderV2 = resultPart({logline:"receipt@2",frequency:law?.id ?? UNADDRESSED,status,activated,
    process:law?.id ?? null,process_hash:lawHash,registry_hash:registry,run:run?.id ?? null,instance,
    input_hash:await hashOf(tuple),context_hash:await hashOf(checkedContext),detail_hash:await hashOf(detail),
    when,by,prev,public:pub});
  return {header,detail,context:checkedContext,id:await hashOf(header),submission_key:await hashOf({by,submission:request.submission})};
}

/** Signed candidate only. The host must atomically commit it before acknowledgement or broadcast. */
export async function issueV2(key: MachineKey, text: string, options: RunV2Options) {
  const captured = {id:key.id,public:copyJSON(key.public),private:key.private};
  const {header,id,...result} = await runV2(text,options);
  if (await keyId(captured.public) !== captured.id) fail("key_invalid","machine key identity mismatch");
  const receipt: ReceiptV2 = {header,id,sig:{alg:"Ed25519",key:captured.id,value:await signIdV2(captured,id)}};
  return {receipt,...result};
}
