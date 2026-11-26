import * as L from "./core/index.js";
import * as limits from "./core/profile.js";
import { HostedError } from "./ledger.mjs";
import { BodyLimit, bodyText } from "./body.mjs";
import { postgrest } from "./postgrest.mjs";

const address = value => typeof value === "string" && value.length === 71 && L.HASH_RE.test(value);
const encoder = new TextEncoder();
const bytes = value => encoder.encode(value).byteLength;
const unavailable = () => new HostedError(503, "unavailable", "the transaction could not be confirmed");
const resourceLimit = () => new HostedError(413, "resource_limit", "request exceeds resource limits");
const wireLimit = size => 2 * size + 4096;
const resultLimit = wireLimit(2 * limits.MAX_RESULT_PART_BYTES + limits.MAX_PUBLIC_RECEIPT_BYTES);
const registryLimit = wireLimit(limits.MAX_SCAN_SNAPSHOT_BYTES + limits.MAX_SCAN_LAW_BYTES) +
  limits.MAX_SCAN_LAWS * 80;
const maxAttempts = 4;

class TransactionError extends Error {
  constructor(ambiguous) {
    super("the database RPC failed");
    this.ambiguous = ambiguous;
  }
}

export function databaseV2(options) {
  const send = postgrest(options);
  return (actor, signal) => {
    async function call(name, fields, limit = resultLimit) {
      let response, value;
      try {
        response = await send("rpc/radio_v2_" + name, { p_principal: actor.owner, p_client: null, ...fields }, signal);
        const text = await bodyText(response, response.ok ? limit : 8192,{signal});
        value = text ? JSON.parse(text) : null;
      } catch (error) {
        if (error instanceof BodyLimit && response?.ok && name !== "commit") throw resourceLimit();
        throw new TransactionError(true);
      }
      if (!response.ok) {
        const retry = value?.code === "40001" || value?.code === "40P01";
        if (retry && name === "commit") return {kind:"retry"};
        throw new TransactionError(response.status >= 500);
      }
      return value;
    }
    return {
      admit: (submission, hash) => call("admit", {p_submission:submission,p_request_hash:hash}),
      registry: (hash, selection) => call("registry_inputs", {p_hash:hash,p_selection:selection},
        selection === "all" ? registryLimit : wireLimit(limits.MAX_SCAN_SNAPSHOT_BYTES + (selection ? L.MAX_LAW_BYTES : 0))),
      read: (id, remaining) => call("read", {p_id:id,p_mode:"use"}, wireLimit(remaining)),
      completed: (instance, run, remaining) => call("observe", {p_key:instance,p_role:run,p_cited:null}, wireLimit(remaining)),
      spent: (law, slot, cited) => call("observe", {p_key:law,p_role:slot,p_cited:cited}, 4096),
      commit: p => call("commit", {p}),
      publish: (id, hash, body) => call("publish", {p_id:id,p_hash:hash,p_body:body}, 4096)
    };
  };
}

function boundaryFailure(result) {
  switch (result?.kind) {
    case "forbidden": return new HostedError(403, "forbidden", "current authority denies the request");
    case "submission_conflict": return new HostedError(409, "submission_conflict", "submission is bound to different input");
    case "publication_conflict": return new HostedError(409, "invalid_request", "law identifier is bound to other bytes");
    case "invalid_request": return new HostedError(400, "invalid_request", "invalid request");
    case "not_found": return new HostedError(404, "not_found", "resource unavailable");
    case "resource_limit": return resourceLimit();
    default: return unavailable();
  }
}

export async function publishV2(db, law) {
  const body = L.canonicalize(law), hash = await L.sha256(body);
  const result = await db.publish(law.id, hash, body);
  if (!["committed","replayed"].includes(result?.kind)) throw boundaryFailure(result);
  if (result.hash !== hash || !address(result.registry)) throw unavailable();
  return {status:result.kind === "committed" ? 201 : 200, body:{id:law.id,hash,registry:result.registry}};
}

async function replay(result, request, hash, actor, keys) {
  const data = result.result;
  try {
    const receipt = L.parseStrict(data.receipt,65);
    const detail = L.parseStrict(data.detail);
    const context = L.parseStrict(data.context);
    if (receipt.id !== result.id || receipt.header.by !== actor.by ||
        receipt.header.input_hash !== await L.hashOf(request.tuple) ||
        context.submission !== request.submission || context.request_hash !== hash ||
        L.canonicalize(context.continue) !== L.canonicalize(request.continue ?? null) ||
        await L.sha256(data.detail) !== receipt.header.detail_hash ||
        await L.sha256(data.context) !== receipt.header.context_hash ||
        L.canonicalize(receipt) !== data.receipt || L.canonicalize(detail) !== data.detail ||
        L.canonicalize(context) !== data.context || !await L.authenticV2(receipt,keys)) throw unavailable();
    return {receipt,detail,context,replayed:true};
  } catch { throw unavailable(); }
}

function admitted(value, actor) {
  if (value?.kind !== "admitted") throw boundaryFailure(value);
  if (value.by !== actor.by || !address(value.registry) || typeof value.when !== "string" ||
      typeof value.revision !== "string" || !/^[1-9]\d{0,18}$/.test(value.revision)) throw unavailable();
  return value;
}

async function candidate(db, key, keys, text, tuple, continuation, nonce, admission) {
  const snapshots = new Map(), laws = new Map(), evidence = new Map();
  const reads = Object.create(null), once = [];
  let completed, remaining = limits.MAX_EVIDENCE_BYTES;
  const allowance = () => Math.min(remaining, limits.MAX_EVIDENCE_PAIR_BYTES);
  function cache(id, raw) {
    if (raw === null) { evidence.set(id,null); return null; }
    if (typeof raw.receipt !== "string" || typeof raw.detail !== "string") throw unavailable();
    const size = bytes(raw.receipt) + bytes(raw.detail) + 22;
    if (size > allowance()) throw resourceLimit();
    const receipt = L.parseStrict(raw.receipt,65), detail = L.parseStrict(raw.detail);
    if (receipt?.id !== id) throw unavailable();
    evidence.set(id, {receipt,detail});
    remaining -= size;
    return evidence.get(id);
  }
  const get = async id => evidence.has(id) ? evidence.get(id) : cache(id, await db.read(id,allowance()));
  async function load(hash, selection) {
    const result = await db.registry(hash,selection);
    if (result?.hash !== hash || typeof result.snapshot !== "string" ||
        !result.laws || typeof result.laws !== "object" || Array.isArray(result.laws)) throw unavailable();
    snapshots.set(hash,result.snapshot);
    for (const [id, body] of Object.entries(result.laws)) laws.set(id,body);
  }

  await load(admission.registry, continuation ? "" : "all");
  if (continuation) {
    const root = await get(continuation.instance);
    const h = root?.receipt.header;
    // The evaluator captures these immutable maps before its first await.
    if (h?.logline === "receipt@2" && h.status === "ok" && h.instance === null &&
        address(h.registry_hash) && address(h.process_hash)) await load(h.registry_hash,h.process_hash);
  }
  const {receipt,detail,context} = await L.issueV2(key,text,{
    by:admission.by,when:admission.when,registryHash:admission.registry,keys,laws,snapshots,
    read: async id => {
      const found = await get(id);
      reads[id] = found !== null;
      return found;
    },
    completed: async (instance,run) => {
      const found = await db.completed(instance,run,allowance());
      completed = found === null ? null : found.id;
      if (found !== null) {
        if (!address(completed)) throw unavailable();
        if (!evidence.has(completed)) cache(completed,found);
      }
      return completed;
    },
    spent: async (law,slot,cited) => {
      const spent = await db.spent(law,slot,cited);
      if (typeof spent !== "boolean") throw unavailable();
      once.push({slot,cited,spent});
      return spent;
    }
  });
  const h = receipt.header, canonical = L.canonicalize;
  return {
    result:{receipt,detail,context,replayed:false},
    payload:{
      id:receipt.id,key:receipt.sig.key,signature:receipt.sig.value,header:canonical(h),
      by:h.by,registry:h.registry_hash,admission_registry:admission.registry,revision:admission.revision,
      law:h.process_hash,run:h.run,instance:h.instance,status:h.status,prev:h.prev,
      submission:nonce,request_hash:context.request_hash,reads,once,
      tuple:canonical(tuple),tuple_hash:h.input_hash,detail:canonical(detail),detail_hash:h.detail_hash,
      context:canonical(context),context_hash:h.context_hash,
      ...(completed !== undefined ? {completed} : {})
    }
  };
}

export async function submitV2({db,key,keys,actor,text,request}) {
  const {submission,tuple,continue:continuation} = request;
  const hash = await L.hashOf({tuple,continue:continuation ?? null});
  const admit = () => db.admit(submission,hash);
  let available = await admit();
  if (available?.kind === "replayed") return replay(available,request,hash,actor,keys);
  const original = admitted(available,actor);
  let revision = original.revision;
  for (let attempt=0; attempt<maxAttempts; attempt++) {
    const {result,payload} = await candidate(db,key,keys,text,tuple,continuation,submission,{...original,revision});
    let disposition;
    try { disposition = await db.commit(payload); }
    catch (error) {
      if (!(error instanceof TransactionError) || !error.ambiguous) throw error;
    }
    if (disposition?.kind === "committed" && disposition.id === result.receipt.id) return result;
    if (disposition?.kind === "replayed") return replay(disposition,request,hash,actor,keys);
    if (["forbidden","submission_conflict","invalid_request","resource_limit","not_found"].includes(disposition?.kind))
      throw boundaryFailure(disposition);
    // Recovery must consult the authoritative nonce before a new evaluation.
    // Re-admission checks current policy, while the original time and Registry
    // are retained for every tentative decision in this invocation.
    available = await admit();
    if (available?.kind === "replayed") return replay(available,request,hash,actor,keys);
    revision = admitted(available,actor).revision;
  }
  throw unavailable();
}
