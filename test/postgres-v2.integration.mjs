// Real PostgreSQL, frozen evaluator, service-only RPCs. The adapter here only
// marshals already verified test identities and captures evaluator observations.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once as firstEvent } from "node:events";
import { createInterface } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";
import * as L from "../dist/index.js";
import { url, q, j, sql, scalar } from "./postgres-harness.mjs";

const admin = statement => sql(statement, "postgres");
const rpcSQL = (name,args) => `select coalesce(public.radio_v2_${name}(${args.join(",")}),'null'::jsonb);`;
const rpc = (name,args,role) => scalar(rpcSQL(name,args),role);
const {key} = await L.generateMachineKey(), keys = {[key.id]:{jwk:key.public}};
const owner = randomUUID(), outsider = randomUUID(), reader = randomUUID(), alternate = randomUUID();
const by = "pseudonym-" + randomUUID();
const outsiderBy = "pseudonym-" + randomUUID();
const who = (principal = owner, client = null) => [q(principal),q(client)];
const permissions = ["publish","retire","submit","disclose","use_evidence","read_public"];
const mandates = {direct:permissions,[reader]:["read_public"],[alternate]:["submit","disclose","use_evidence"]};
await admin(`insert into radio_v2.authority(principal,pseudonym,permissions,mandates,active)
  values (${q(owner)},${q(by)},array[${permissions.map(q)}],${j(mandates)},true),
         (${q(outsider)},${q(outsiderBy)},array['read_public','use_evidence','disclose'],
          '{"direct":["read_public","use_evidence","disclose","submit"]}',true);`);

const lawId = "postgres-v2." + randomUUID();
const run = (id,after,extra={}) => ({id,after,requires:{},steps:[],if_ok:"ok",if_not:"not",if_doubt:"doubt",...extra});
const law = {
  logline:"process-type@1",id:lawId,issuer:"Integration",
  recognize:{and:[{has:"kind"},{"==":[{var:"kind"},"native"]}]},
  runs:[run("open",[],{broadcast:["tuple.value"]}),
    run("review",["open"]),run("consume",["open"],{cites:{source:{frequency:lawId,once:true}}})]
};
const lawBytes=L.canonicalize(law), lawHash=await L.sha256(lawBytes);
const publish = (bytes=lawBytes,hash=lawHash,identity=who()) => rpc("publish",[...identity,q(lawId),q(hash),q(bytes)]);
let nonce = 0;
const request = (tuple,cont) => ({tuple,submission:Buffer.alloc(16,++nonce).toString("base64url"),
  ...(cont?{continue:cont}:{})});
const reqHash = r => L.hashOf({tuple:r.tuple,continue:r.continue??null});
const admit = async (r, identity=who()) => rpc("admit",[...identity,q(r.submission),q(await reqHash(r))]);
const read = (id,mode,identity=who()) => rpc("read",[...identity,q(id),q(mode)]);

async function evaluate(r, admission, identity=who()) {
  const snapshots=new Map(),laws=new Map(),reads={},once=[];
  let completed;
  const completionEvidence=new Map();
  async function load(hash) {
    const loaded=await rpc("registry",[...identity,q(hash),"true"]);
    assert.ok(loaded,"admitted Registry must remain readable");
    snapshots.set(loaded.hash,loaded.snapshot);
    for(const [id,bytes] of Object.entries(loaded.laws))laws.set(id,bytes);
  }
  // The admission snapshot and the root's snapshot are independently pinned.
  await load(admission.registry);
  if (r.continue) {
    const root=await read(r.continue.instance,"use",identity);
    if(root) {
      const {registry_hash}=L.parseStrict(root.receipt).header;
      if(!snapshots.has(registry_hash))await load(registry_hash);
    }
  }
  const issued=await L.issueV2(key,L.canonicalize(r),{
    by:admission.by,when:admission.when,registryHash:admission.registry,keys,laws,snapshots,
    read:async id=>{
      const result = completionEvidence.get(id) ?? await read(id,"use",identity);
      reads[id] = result !== null;
      return result ? {receipt:L.parseStrict(result.receipt),detail:L.parseStrict(result.detail)} : null;
    },
    completed:async (id,role)=>{
      const result=await rpc("observe",[...identity,q(id),q(role),"NULL"]);
      if(result)completionEvidence.set(result.id,result);
      completed=result?.id??null;
      return completed;
    },
    spent:async (hash,slot,id)=>{
      const spent=await rpc("observe",[...identity,q(hash),q(slot),q(id)]);
      assert.equal(typeof spent,"boolean");
      once.push({slot,cited:id,spent});
      return spent;
    }
  });
  const {receipt,detail,context}=issued, h=receipt.header;
  return {issued, payload:{
    id:receipt.id,key:receipt.sig.key,signature:receipt.sig.value,header:L.canonicalize(h),
    by:h.by,registry:h.registry_hash,admission_registry:admission.registry,revision:admission.revision,
    law:h.process_hash,run:h.run,instance:h.instance,status:h.status,
    submission:r.submission,request_hash:context.request_hash,
    tuple:L.canonicalize(r.tuple),tuple_hash:h.input_hash,detail:L.canonicalize(detail),detail_hash:h.detail_hash,
    context:L.canonicalize(context),context_hash:h.context_hash,prev:h.prev,reads,once,
    ...(completed!==undefined?{completed}:{})
  }};
}
const commit = (candidate,identity=who()) => rpc("commit",[...identity,j(candidate.payload)]);
const counts = () => scalar(`select json_build_array((select count(*) from radio_v2.objects),
  (select count(*) from radio_v2.receipts),(select count(*) from radio_v2.decisions),
  (select count(*) from radio_v2.successful_runs),(select count(*) from radio_v2.consumptions));`);
const candidate = async (r,identity=who()) => evaluate(r,await admit(r,identity),identity);
const topic = "radio:v2:receipts", issuer = "http://127.0.0.1/auth/v1";
const signalRows = id => scalar(`select coalesce(jsonb_agg(jsonb_build_object(
  'payload',payload,'event',event,'private',private,'extension',extension)), '[]'::jsonb)
  from realtime.messages where topic=${q(topic)} and payload->>'id'=${q(id)};`);
const save = async r => {
  const c=await candidate(r);
  assert.equal((await commit(c)).kind,"committed");
  return c.payload.id;
};
const continueAt = (instance,run) => ({instance,run,parents:{open:instance}});
const entry = value => request({kind:"native",value});

await admin(`insert into radio_v2.broadcast_settings(issuer) values (${q(issuer)}) on conflict (singleton) do update set issuer=excluded.issuer;`);
const initial=await rpc("registry",[...who(),"NULL","false"]);
const initialLaws=L.parseStrict(initial.snapshot).types;
const denied = await publish(lawBytes,lawHash,who(owner,reader));
assert.equal(denied.kind,"forbidden");
assert.equal((await admit(entry("client restriction"),who(outsider))).kind,"forbidden");
const overlong = "x".repeat(65537);
assert.equal((await publish(overlong,await L.sha256(overlong))).kind,"resource_limit");

async function fullRegistry(count, padded) {
  const template=L.canonicalize({...law,id:"capacity-law",recognize:padded?"payload":false});
  const idPrefix="capacity-"+randomUUID()+".";
  // Seed a full snapshot in a rollback-only fixture. Exercise the next
  // publication through the RPC without building thousands of snapshots.
  const pgResult=await sql(`begin;
    create temporary table capacity_laws on commit drop as
    select id,body,radio_v2.digest(body) as hash
    from (
      select id,${padded
        ? "replace(whole.body, 'payload', repeat('x',65543-octet_length(whole.body)))"
        : "whole.body"} as body
      from (
        select replace(${q(template)},'"capacity-law"','"' || id || '"') as body,id
        from (select ${q(idPrefix)} || n as id from generate_series(1,${count}) n) ids
      ) whole
    ) prepared;
    insert into radio_v2.objects(hash,body) select hash,body from capacity_laws;
    insert into radio_v2.laws select id,hash from capacity_laws;
    update radio_v2.registry_head set hash=radio_v2.save_registry(
       array(select hash from capacity_laws order by hash),1000000);
    ${rpcSQL("publish",[...who(),q(lawId),q(lawHash),q(lawBytes)])}
    rollback;`);
  assert.equal(JSON.parse(pgResult).kind,"resource_limit");
  assert.equal(await scalar(`select count(*) from radio_v2.laws where id=${q(lawId)};`),0);
}
await fullRegistry(4096,false);
await fullRegistry(256,true);

const publications = await Promise.all([publish(),publish()]);
assert.deepEqual(publications.map(p=>p.kind).sort(),["committed","replayed"]);
const registry = publications[0].registry;
assert.equal(registry,await L.hashOf({logline:"registry@1",scan_ops:1000000,types:[...initialLaws,lawHash].sort()}));
const reordered=await Promise.all(["a","b"].map(async suffix=>{
  const descriptor=L.canonicalize({...law,id:lawId+"."+suffix,recognize:false});
  return rpc("publish",[...who(),q(lawId+"."+suffix),q(await L.sha256(descriptor)),q(descriptor)]);
}));
assert.ok(reordered.every(p=>p.kind==="committed"));
const head=await rpc("registry",[...who(),"NULL","false"]);
assert.equal(await L.sha256(head.snapshot),head.hash);
assert.equal(L.parseStrict(head.snapshot).types.length,initialLaws.length+3);
assert.deepEqual(Object.keys((await rpc("registry",[...who(),q(registry),"false"])).laws).sort(),
  [...initialLaws,lawHash].sort());

// Freeze the admitted immutable snapshot before further publications.
const scalarRequest=entry("nul\u0000🛰\n");
const firstAdmission=await admit(scalarRequest);
const laterLaw=L.canonicalize({...law,id:lawId+".later",recognize:false});
assert.equal((await rpc("publish",[...who(),q(lawId+".later"),q(await L.sha256(laterLaw)),q(laterLaw)])).kind,"committed");
const first=await evaluate(scalarRequest,firstAdmission);
const same=[...await Promise.all([commit(first),commit(first,who(owner,alternate))])];
assert.deepEqual(same.map(x=>x.kind).sort(),["committed","replayed"]);
assert.equal(first.payload.registry, firstAdmission.registry);
const firstId=first.payload.id;
const expectedSignal = id => [{payload:{id},event:"receipt",private:true,extension:"broadcast"}];
assert.deepEqual(await signalRows(firstId),expectedSignal(firstId));
const recovery=await admit(scalarRequest,who(owner,alternate));
assert.equal(recovery.kind,"replayed");
assert.equal(recovery.result.receipt,L.canonicalize(first.issued.receipt));
assert.deepEqual(L.parseStrict((await read(firstId,"disclose")).tuple),scalarRequest.tuple);
assert.ok(!(await read(firstId,"public",who(outsider))).receipt.includes(owner));
assert.equal(await read(firstId,"disclose",who(outsider)),null);
assert.equal(await read(firstId,"use",who(outsider)),null);
assert.equal(await read("sha256:"+"0".repeat(64),"use",who(outsider)),null);
assert.equal((await admit({...scalarRequest,tuple:"different"})).kind,"submission_conflict");
assert.equal((await admit(scalarRequest,who(owner,reader))).kind,"forbidden");

const issued = Math.floor(Date.now()/1000);
const claims = {sub:owner,iss:issuer,aud:"authenticated",role:"authenticated",is_anonymous:false,
  session_id:randomUUID(),iat:issued-10,exp:issued+60};
const readSignal = "select count(*) from realtime.messages where payload->>'id'=" + q(firstId) + ";";
const setTopic = "set realtime.topic=" + q(topic) + ";";
assert.equal(await scalar(setTopic+readSignal,"authenticated",claims),1);
assert.equal(await scalar(readSignal,"authenticated",claims),0);
for (const denied of [{...claims,iss:"https://other.invalid"},{...claims,exp:issued-1},{...claims,exp:issued+301},
  {...claims,client_id:reader},{...claims,is_anonymous:true},{...claims,sub:randomUUID()}])
  assert.equal(await scalar(setTopic+readSignal,"authenticated",denied),0);
assert.equal(await scalar(setTopic+readSignal,"anon"),0);
await admin("create policy test_shared_realtime_read on realtime.messages for select to authenticated using (true);");
await admin("create policy test_shared_realtime_send on realtime.messages for insert to authenticated with check (true);");
try {
  assert.equal(await scalar(readSignal,"authenticated",claims),0);
  await admin(`update radio_v2.authority set active=false where principal=${q(owner)};`);
  try { assert.equal(await scalar(setTopic+readSignal,"authenticated",claims),0); }
  finally { await admin(`update radio_v2.authority set active=true where principal=${q(owner)};`); }
  await assert.rejects(sql(`insert into realtime.messages(id,topic,event,payload,private,extension)
    values(gen_random_uuid(),${q(topic)},'receipt',${j({id:firstId})},true,'broadcast');`,
    "authenticated",claims),/row-level security/);
} finally {
  await admin("drop policy test_shared_realtime_read on realtime.messages; drop policy test_shared_realtime_send on realtime.messages;");
}

// Explicit resource authority permits use and disclosure independently.
await admin(`update radio_v2.authority set evidence=${j({[firstId]:["use_evidence"]})} where principal=${q(outsider)};`);
assert.ok((await read(firstId,"use",who(outsider))).detail);
assert.equal(await read(firstId,"disclose",who(outsider)),null);

// Test RLS separately from GRANT by temporarily granting SELECT in a
// transaction. Neither anonymous nor authenticated roles can see target rows.
for(const role of ["anon","authenticated"]) {
  await assert.rejects(sql(rpcSQL("commit",[...who(),"'{}'"]),role,{sub:owner}),/permission denied/);
  const hidden=await admin(`begin; grant usage on schema radio_v2 to ${role};
    grant select on radio_v2.receipts,radio_v2.objects,radio_v2.decisions to ${role};
    set role ${role}; set request.jwt.claims=${q(JSON.stringify({sub:owner,app_metadata:{logline_admin:true}}))};
    select json_build_array((select count(*) from radio_v2.receipts),
      (select count(*) from radio_v2.objects),(select count(*) from radio_v2.decisions)); rollback;`);
  assert.deepEqual(JSON.parse(hidden),[0,0,0]);
}

// The fixture creates an open PostgreSQL transaction and waits until the
// competitor is blocked on a real lock before releasing the first commit.
async function race(firstCandidate,secondCandidate) {
  const session=spawn("psql",["-X","-qAt","-v","ON_ERROR_STOP=1",url.href],{stdio:["pipe","pipe","pipe"]});
  let stderr="";
  session.stderr.on("data",chunk=>stderr+=chunk);
  const lines=createInterface({input:session.stdout});
  const done=firstEvent(session,"close").then(([code])=>{if(code!==0)throw Error(stderr || "writer failed");});
  done.catch(()=>{});
  const app="radio-race-"+randomUUID();
  let competing;
  try {
    const timer=AbortSignal.timeout(5000);
    const pending=firstEvent(lines,"line",{signal:timer});
    session.stdin.write(`begin; set role service_role; ${rpcSQL("commit",[...who(),j(firstCandidate.payload)])}\n`);
    assert.equal(JSON.parse((await pending)[0]).kind,"committed");
    assert.equal(await read(firstCandidate.payload.id,"public"),null,"tentative receipt visible before commit");
    assert.deepEqual(await signalRows(firstCandidate.payload.id),[]);
    const statement=rpcSQL("commit",[...who(),j(secondCandidate.payload)]);
    competing=sql(statement,"service_role",{},app).then(JSON.parse);
    competing.catch(()=>{});
    let blocked=false;
    for(let i=0;i<40&&!blocked;i++) {
      blocked=(await admin(`select exists(select from pg_stat_activity
        where application_name=${q(app)} and wait_event_type='Lock');`))==="t";
      if(!blocked)await delay(25);
    }
    assert.ok(blocked,"expected contender to wait on a PostgreSQL lock");
    session.stdin.end("commit;\n");
    await done;
    return await competing;
  } finally {
    session.stdin.destroy();
    lines.close();
    await done.catch(()=>{});
    await competing?.catch(()=>{});
  }
}

const runA=request("first",continueAt(firstId,"review")), runB=request("second",continueAt(firstId,"review"));
const runAdmission=await admit(runB);
const runWinner=await candidate(runA), runLoser=await evaluate(runB,runAdmission);
assert.equal(runWinner.payload.status,"ok");
assert.equal(runLoser.payload.status,"ok");
assert.equal((await race(runWinner,runLoser)).kind,"retry");
assert.equal(await read(runLoser.payload.id,"public"),null);
assert.deepEqual(await signalRows(runLoser.payload.id),[]);
const conflict=await evaluate(runB,runAdmission);
assert.equal(conflict.issued.detail.reason,"run_completed");
assert.equal(conflict.issued.context.completed,runWinner.payload.id);
assert.equal((await commit(conflict)).kind,"committed");
assert.deepEqual(await signalRows(conflict.payload.id),expectedSignal(conflict.payload.id));

const left=await save(entry("left")), right=await save(entry("right")), source=await save(entry("source"));
const a=request({cites:{source}},continueAt(left,"consume"));
const b=request({cites:{source}},continueAt(right,"consume"));
const admittedB=await admit(b);
const winner=await candidate(a), loser=await evaluate(b,admittedB);
assert.equal(winner.payload.once[0].spent,false);
assert.equal(loser.payload.once[0].spent,false);
assert.equal((await race(winner,loser)).kind,"retry");
assert.equal(await read(loser.payload.id,"public"),null);
const spent=await evaluate(b,admittedB);
assert.equal(spent.issued.detail.reason,"citation_spent");
assert.equal((await commit(spent)).kind,"committed");

// Any CAS mismatch aborts the entire constitution, including earlier inserts.
const bad=await candidate(entry("unwritten"));
const before=await counts();
const corrupt={payload:{...bad.payload,context:bad.payload.context+" "}};
await assert.rejects(commit(corrupt),/check constraint|CAS address collision/);
assert.deepEqual(await counts(),before);
const fault = "force_failure_" + randomUUID().replaceAll("-","");
await admin(`create function radio_v2.${fault}() returns trigger language plpgsql set search_path='' as
  $$ begin raise exception 'forced failure after receipt insert'; end $$;
  create trigger ${fault} before insert on radio_v2.decisions
  for each row when (new.receipt_id = ${q(bad.payload.id)}) execute function radio_v2.${fault}();`);
try {
  await assert.rejects(commit(bad),/forced failure after receipt insert/);
  assert.deepEqual(await counts(),before);
  assert.equal(await read(bad.payload.id,"public"),null);
  assert.deepEqual(await signalRows(bad.payload.id),[]);
} finally {
  await admin(`drop trigger ${fault} on radio_v2.decisions; drop function radio_v2.${fault}();`);
}
assert.equal((await commit(bad)).kind,"committed");
assert.deepEqual(await signalRows(bad.payload.id),expectedSignal(bad.payload.id));
await assert.rejects(sql(`update radio_v2.objects set body='rewrite' where hash=${q(bad.payload.tuple_hash)};`),/permission denied/);
await assert.rejects(admin(`update radio_v2.objects set body='rewrite' where hash=${q(bad.payload.tuple_hash)};`),/immutable/);

// Recheck absence as well as positive observations. The registered
// candidate saw a missing root, and must retry once that root commits.
const newRoot = await candidate(entry("late root"));
const waiting = request(null,continueAt(newRoot.payload.id,"review"));
const waitingAdmission = await admit(waiting);
const stale = await evaluate(waiting,waitingAdmission);
assert.equal(stale.issued.detail.reason,"continuation_unavailable");
assert.equal(stale.payload.reads[newRoot.payload.id],false);
assert.equal((await race(newRoot,stale)).kind,"retry");
const found = await evaluate(waiting,waitingAdmission);
assert.equal(found.payload.status,"ok");
assert.equal((await commit(found)).kind,"committed");

// Revocation after evaluation precedes any candidate or replay disclosure.
const revoked=await candidate(entry("revoked"),who(owner,alternate));
await admin(`update radio_v2.authority set mandates=mandates-${q(alternate)} where principal=${q(owner)};`);
assert.equal((await commit(revoked,who(owner,alternate))).kind,"forbidden");
assert.equal((await admit(scalarRequest,who(owner,alternate))).kind,"forbidden");
assert.equal(await read(revoked.payload.id,"public"),null);
assert.deepEqual(await signalRows(revoked.payload.id),[]);

// Retirement changes admission only. Existing instances keep the original law.
const retired=await publish(null,null);
assert.equal(retired.kind,"committed");
const amendment=L.canonicalize({...law,issuer:"Different"});
assert.equal((await publish(amendment,await L.sha256(amendment))).kind,"publication_conflict");
const afterRetirement=await candidate(request(null,continueAt(right,"review")));
assert.equal(afterRetirement.payload.status,"ok");
assert.notEqual(afterRetirement.payload.admission_registry,afterRetirement.payload.registry);
assert.equal((await commit(afterRetirement)).kind,"committed");
assert.equal((await candidate(entry("new admission"))).issued.detail.reason,"recognition_none");
for (const suffix of ["a","b","later"]) {
  assert.equal((await rpc("publish",[...who(),q(lawId+"."+suffix),"NULL","NULL"])).kind,"committed");
}

await admin("delete from radio_v2.broadcast_settings;");
const silent = await save(entry("broadcast disabled"));
assert.deepEqual(await signalRows(silent),[]);
assert.ok((await read(silent,"public")).receipt);
console.log("PostgreSQL v2: Registry, JCS bytes, submission/RUN/once races, atomic Broadcast enqueue and rollback, current authority and RLS passed.");
