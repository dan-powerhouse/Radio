// Opt-in, actual PostgreSQL contract test. Requires a DISPOSABLE local Supabase
// DB with 0001_radio.sql already applied. Never runs against a remote URL.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import * as L from "../dist/index.js";
import { submitRoot } from "../supabase/functions/_shared/ledger.mjs";
const url = new URL(process.env.LOGLINE_TEST_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres");
if (process.env.LOGLINE_DISPOSABLE_DB !== "yes" || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || !["postgresql:","postgres:"].includes(url.protocol)) throw Error("Set LOGLINE_DISPOSABLE_DB=yes with a disposable local Supabase database only");
const q = x => x === null ? "NULL" : "'" + String(x).replaceAll("'", "''") + "'";
const j = x => q(JSON.stringify(x)) + "::jsonb";
const sql = (statement, role = "service_role", claims = {}) => new Promise((resolve,reject) => {
  const p = spawn("psql", ["-X", "-qAt", "-v", "ON_ERROR_STOP=1", url.href], {stdio:["pipe","pipe","pipe"]});
  let out="", err="";p.stdout.on("data",x=>out+=x);p.stderr.on("data",x=>err+=x);p.on("error",reject);p.on("close",c=>c===0?resolve(out.trim()):reject(Error(err)));
  p.stdin.end(`SET standard_conforming_strings=on; SET ROLE ${role}; SET request.jwt.claims = ${q(JSON.stringify(claims))};\n${statement}\n`);
});
const scalar = async (s,role,claims) => JSON.parse(await sql(s,role,claims));
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
const forks=await Promise.all([submit(tuple(2,91,root)),submit(tuple(2,92,root))]);
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
console.log("PostgreSQL integration: concurrent idempotency, once, outbox, RLS, immutable receipt and RPC authorization passed.");
