// Opt-in, actual PostgreSQL contract test. Requires a DISPOSABLE local Supabase
// DB with 0001_radio.sql already applied (or stock PostgreSQL with the test-only
// auth fixture). Never runs against a remote URL.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import * as L from "../dist/index.js";
import { submitRoot } from "../supabase/functions/_shared/ledger.mjs";
import { url, q, j, sql, scalar } from "./postgres-harness.mjs";
const db = {
  process: id => scalar(`select coalesce((select o.body from public.processes p join public.objects o on o.hash=p.hash where p.id=${q(id)}),'null');`),
  citation: id => scalar(`select coalesce((select jsonb_build_object('receipt',r.receipt::jsonb,'detail',o.body::jsonb)::text from public.receipts r join public.receipt_access a on a.receipt_id=r.id join public.objects o on o.hash=a.detail_hash where r.id=${q(id)}),'null');`),
  spent: (law,claims) => scalar(`select to_json(public.logline_spent(${q(law)},${j(claims)}));`),
  commit: p => scalar(`select public.logline_commit(${j(p)});`),
};
const {key}=await L.generateMachineKey(), keys = {[key.id]:{jwk:key.public}}, owner=randomUUID(), other=randomUUID();
const by=await L.pseudonym(crypto.getRandomValues(new Uint8Array(32)),owner);
const law = JSON.parse(readFileSync(new URL("../processes/course.lesson@1.json", import.meta.url)));
law.id="integration."+randomUUID()+"@1";law.cites.previous.frequency=law.id;
const hash=await L.hashOf(law);
await sql(`select public.logline_publish(${q(law.id)},${q(hash)},${q(L.canonicalize(law))});`);
const when="2026-11-25T12:00:00Z", tuple=(n,score,prev)=>({did:"complete",this:law.id,with:{course:"logline-101",lesson:n,score},...(prev?{cites:{previous:prev}}:{})});
const submit=t=>submitRoot({db,key,keys,tuple:t,owner,by,when});
const roots=await Promise.all(Array.from({length:8},()=>submit(tuple(1,90))));
assert.equal(roots.filter(r=>!r.replayed).length,1);assert.equal(new Set(roots.map(r=>r.receipt.id)).size,1);
const root=roots[0].receipt.id;
const bad=await submit(tuple(2,10,root));assert.equal(bad.receipt.header.status,"not");
// Force both requests to reach the real transaction with a stale, unspent
// observation. A Promise.all alone does not prove the conflicting window ran.
let release;
const gate = new Promise(resolve => { release = resolve; });
let arrived = 0;
const commits = [];
const racing = { ...db, commit: async p => {
  if (++arrived <= 2) {
    assert.deepEqual(p.spent, []);
    assert.equal(p.status, "ok");
    if (arrived === 2) release();
    let timer;
    try { await Promise.race([gate, new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error("both real transactions did not reach the race barrier")), 10000);
    })]); } finally { clearTimeout(timer); }
  }
  const result = await db.commit(p);
  commits.push({ payload: p, result });
  return result;
}};
const racingSubmit = t => submitRoot({db:racing,key,keys,tuple:t,owner,by,when});
const forks=await Promise.all([racingSubmit(tuple(2,91,root)),racingSubmit(tuple(2,92,root))]);
assert.equal(arrived, 3, "two original commits plus one reevaluation");
assert.equal(commits.filter(c => c.result.kind === "retry").length, 1);
const rolledBack = commits.find(c => c.result.kind === "retry").payload;
assert.equal(await scalar(`select count(*) from public.receipts where id=${q(rolledBack.id)};`), 0);
assert.equal(await scalar(`select count(*) from public.outbox where receipt_id=${q(rolledBack.id)};`), 0);
assert.deepEqual(forks.map(r=>r.receipt.header.status).sort(),["ok","registered"]);
assert.match(forks.find(r=>r.receipt.header.status==="registered").detail.unmet.join(),/already been used/);
assert.equal(await scalar(`select count(*) from public.consumptions where process_id=${q(law.id)};`),1);
assert.equal(await scalar(`select count(*) from public.outbox o join public.receipts r on r.id=o.receipt_id where r.frequency=${q(law.id)};`),4);
const detail=roots[0].receipt.header.detail_hash;
assert.equal(await scalar(`select count(*) from public.objects where hash=${q(detail)};`,"anon"),0);
assert.equal(await scalar(`select count(*) from public.objects where hash=${q(detail)};`,"authenticated",{sub:owner,role:"authenticated"}),1);
assert.equal(await scalar(`select count(*) from public.objects where hash=${q(detail)};`,"authenticated",{sub:other,role:"authenticated",user_metadata:{logline_admin:true}}),0);
assert.equal(await scalar(`select count(*) from public.objects where hash=${q(detail)};`,"authenticated",{sub:other,role:"authenticated",app_metadata:{logline_admin:true}}),1);
assert.equal(await scalar(`select count(*) from public.receipts where id=${q(root)};`,"anon"),1);
await assert.rejects(sql(`select public.logline_commit('{}'::jsonb);`,"authenticated",{sub:owner}),/permission denied/);
await assert.rejects(sql(`update public.receipts set status='not' where id=${q(root)};`),/permission denied|immutable/);
// Inject a failure after CAS writes, receipt and outbox insert, but before the
// access row is written. The real SQL transaction must roll everything back.
const counts = async () => scalar(`select json_build_array(
  (select count(*) from public.objects), (select count(*) from public.receipts),
  (select count(*) from public.receipt_access), (select count(*) from public.submissions),
  (select count(*) from public.consumptions), (select count(*) from public.outbox));`);
const before = await counts();
const winner = forks.find(r => r.receipt.header.status === "ok");
const next = {...tuple(3,94,winner.receipt.id), fault_probe:randomUUID()};
let failedPayload;
const fault = {...db, commit: async p => {
  failedPayload = p;
  return db.commit({...p, owner:"not-a-uuid"});
}};
await assert.rejects(submitRoot({db:fault,key,keys,tuple:next,owner,by,when}), /invalid input syntax for type uuid/);
assert.ok(failedPayload);
assert.equal(failedPayload.status,"ok");
assert.deepEqual(await counts(),before,"no phantom CAS, receipt, access, submission, claim or outbox row");
assert.equal(await scalar(`select count(*) from public.objects where hash=${q(failedPayload.input_hash)};`),0);
assert.equal(await scalar(`select count(*) from public.submissions where cache_key=${q(failedPayload.cache_key)};`),0);
const recovered = await submit(next);
assert.equal(recovered.replayed,false);
assert.equal(recovered.receipt.id,failedPayload.id,"same deterministic decision after rollback");
assert.equal(recovered.receipt.header.status,"ok");
assert.equal(await scalar(`select count(*) from public.consumptions where process_id=${q(law.id)};`),2);
assert.equal(await scalar(`select count(*) from public.outbox o join public.receipts r on r.id=o.receipt_id where r.frequency=${q(law.id)};`),5);

// CAS collision and failed amendment must not change or leave orphan law bytes.
const canonicalLaw=L.canonicalize(law);
await assert.rejects(sql(`select public.logline_put(${q(hash)},'different bytes');`),/CAS address collision/);
assert.equal(await sql(`select body from public.objects where hash=${q(hash)};`),canonicalLaw);
const amended={...law,issuer:randomUUID()}, amendedHash=await L.hashOf(amended);
await assert.rejects(sql(`select public.logline_publish(${q(law.id)},${q(amendedHash)},${q(L.canonicalize(amended))});`),/duplicate key/);
assert.equal(await scalar(`select count(*) from public.objects where hash=${q(amendedHash)};`),0);
assert.equal(await sql(`select hash from public.processes where id=${q(law.id)};`),hash);
console.log("PostgreSQL integration: concurrent idempotency, forced once race, transactional rollback/retry, CAS collision, rejected amendment, outbox, RLS, immutable receipt and RPC authorization passed.");

// A transaction snapshot can fence a closed window even when sequence
// allocation order differs from commit order. This probe owns its own table.
const probe = "public.radio_history_probe_" + randomUUID().replaceAll("-", "");
const asPostgres = statement => sql(statement, "postgres");
await asPostgres(`CREATE TABLE ${probe} (position bigint GENERATED ALWAYS AS IDENTITY, writer xid8 NOT NULL DEFAULT pg_current_xact_id());`);
const late = spawn("psql", ["-X","-qAt","-v","ON_ERROR_STOP=1",url.href], {stdio:["pipe","pipe","pipe"]});
let output = "", errors = "";
late.stdout.on("data", chunk => { output += chunk; });
late.stderr.on("data", chunk => { errors += chunk; });
const lateDone = new Promise((resolve,reject) => {
  late.on("error",reject);
  late.on("close", code => code === 0 ? resolve() : reject(Error(errors || "history writer stopped")));
});
lateDone.catch(() => {});
async function waitForPosition() {
  let timer;
  const timerDone = new Promise((_,reject) => {
    timer = setTimeout(() => reject(Error("history writer did not reach its barrier")),5000);
  });
  try {
    await Promise.race([lateDone.then(() => {throw Error("history writer closed before commit");}),timerDone,
      new Promise(resolve => {
        if (output.includes("1\n")) return resolve();
        late.stdout.on("data", function ready() {
          if (!output.includes("1\n")) return;
          late.stdout.off("data",ready);
          resolve();
        });
      })]);
  } finally {clearTimeout(timer);}
}
try {
  late.stdin.write(`BEGIN; INSERT INTO ${probe} DEFAULT VALUES RETURNING position;\n`);
  await waitForPosition();
  assert.equal(await asPostgres(`INSERT INTO ${probe} DEFAULT VALUES RETURNING position;`), "2");
  const window = JSON.parse(await asPostgres(`SELECT json_build_object(
    'snapshot', pg_current_snapshot()::text,
    'positions', (SELECT json_agg(position ORDER BY position) FROM ${probe}));`));
  assert.deepEqual(window.positions,[2], "first window excludes the uncommitted earlier position");

  late.stdin.end("COMMIT;\n");
  await lateDone;
  await asPostgres(`BEGIN; INSERT INTO ${probe} DEFAULT VALUES; ROLLBACK;`);
  const old = q(window.snapshot) + "::pg_snapshot";
  const positions = async predicate => JSON.parse(await asPostgres(`SELECT coalesce(
    json_agg(position ORDER BY position),'[]') FROM ${probe} WHERE ${predicate};`));
  assert.deepEqual(await positions("position > 2"),[], "a sequence watermark loses the late commit");
  assert.deepEqual(await positions(`pg_visible_in_snapshot(writer, ${old})`),[2], "old window remains closed");
  assert.deepEqual(await positions(`pg_visible_in_snapshot(writer, pg_current_snapshot())
    AND NOT pg_visible_in_snapshot(writer, ${old})`),[1], "next window recovers late commit and excludes rollback");
  console.log("PostgreSQL history probe: forced late commit recovered by snapshot visibility; sequence watermark skipped it.");
} finally {
  late.stdin.destroy();
  await lateDone.catch(() => {});
  await asPostgres(`DROP TABLE ${probe};`);
}
