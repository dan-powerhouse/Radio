// Real Deno, PostgREST and disposable PostgreSQL. An HTTP fixture models the
// identity endpoint and coordinates reply loss and overlapping evaluations.
import assert from "node:assert/strict";
import { execFile, execFileSync, spawn } from "node:child_process";
import { createHmac, generateKeyPairSync, randomBytes, randomUUID, sign } from "node:crypto";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import * as L from "../dist/index.js";
import { url, q, j, sql, scalar } from "./postgres-harness.mjs";
import { diplomacyAdoptionSql, validateDiplomacy } from "../bin/diplomacy.mjs";

const admin = statement => sql(statement,"postgres");
const principal = randomUUID(), session = randomUUID(), secret = randomBytes(32);
const by = await L.pseudonym(secret,principal);
const {key,privateJwk} = await L.generateMachineKey(), keys = {[key.id]:{jwk:key.public}};
const jwtSecret = randomBytes(36).toString("base64url");
const b64 = value => Buffer.from(JSON.stringify(value)).toString("base64url");
function token(claims, secret = jwtSecret) {
  const data = b64({alg:"HS256",typ:"JWT"})+"."+b64(claims);
  return data+"."+createHmac("sha256",secret).update(data).digest("base64url");
}
const service = token({role:"service_role", exp:Math.floor(Date.now()/1000)+600});
const processes = new Set();
const nativeEdge = process.env.RADIO_TEST_NATIVE_EDGE === "yes";
const testMcp = process.env.RADIO_TEST_MCP === "yes";
const oauth = testMcp ? generateKeyPairSync("ec",{namedCurve:"P-256"}) : null;
const jwk = oauth && {...oauth.publicKey.export({format:"jwk"}),kid:"oauth-fixture",alg:"ES256"};
function oauthToken(claims) {
  const data = b64({alg:"ES256",kid:jwk.kid,typ:"JWT"})+"."+b64(claims);
  return data+"."+sign("sha256",Buffer.from(data),{key:oauth.privateKey,dsaEncoding:"ieee-p1363"}).toString("base64url");
}

function start(bin,args,env) {
  const process = spawn(bin,args,{env,stdio:["ignore","pipe","pipe"]});
  const state = { process, diagnostic:"" };
  state.done = once(process,"close");
  state.done.catch(error => { state.diagnostic = String(error); });
  process.stderr.on("data",chunk => { state.diagnostic += chunk; });
  processes.add(state);
  return state;
}
async function stop(state) {
  state.process.kill();
  await state.done.catch(()=>{});
  processes.delete(state);
}
async function listening(server) {
  server.listen(0,"127.0.0.1");
  await once(server,"listening");
  return server.address().port;
}
async function close(server) {
  await new Promise((resolve,reject) => server.close(error => error ? reject(error) : resolve()));
}

const reservation = createServer();
const restPort = await listening(reservation);
await close(reservation);
const rest = "http://127.0.0.1:"+restPort;

const restDb = new URL(url);
restDb.username = "authenticator";
restDb.password = "";
const restProcess = start("postgrest",[],{...process.env,
  PGRST_DB_URI:restDb.href, PGRST_DB_SCHEMAS:"public", PGRST_DB_ANON_ROLE:"anon",
  PGRST_SERVER_HOST:"127.0.0.1", PGRST_SERVER_PORT:String(restPort), PGRST_JWT_SECRET:jwtSecret
});

let lost, dropped = 0, race = null;
const audit = [], authenticated = new Set();
const gateway = createServer(async (req,res) => {
  try {
    if (jwk && req.url === "/auth/v1/.well-known/jwks.json") {
      res.writeHead(200,{"content-type":"application/json"});
      res.end(JSON.stringify({keys:[jwk]}));
      return;
    }
    if (req.url === "/auth/v1/user") {
      const valid = authenticated.has(req.headers.authorization);
      res.writeHead(valid?200:401,{"content-type":"application/json"});
      res.end(JSON.stringify(valid?{id:principal,app_metadata:{logline_admin:true}}:{error:"invalid token"}));
      return;
    }
    if (!req.url.startsWith("/rest/v1/rpc/")) {res.writeHead(404);res.end();return;}
    const chunks=[];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks), path = req.url.slice("/rest/v1".length);
    const payload = JSON.parse(body);
    const record = {name:path.split("/").at(-1),payload,outcome:null};
    audit.push(record);
    if (record.name === "radio_v2_commit" && race?.submissions.has(payload.p.submission) && race.arrived < 2) {
      if (++race.arrived === 2) race.release();
      await Promise.race([race.ready,delay(5000,undefined,{ref:false}).then(()=>{throw Error("race barrier timed out");})]);
    }
    const r = await fetch(rest+path,{method:"POST",headers:{
      authorization:req.headers.authorization,"content-type":"application/json"
    },body});
    const raw = await r.text();
    record.outcome = raw ? JSON.parse(raw) : null;
    if (record.name === "radio_v2_commit" && payload.p.submission === lost && record.outcome?.kind === "committed") {
      dropped++;
      // End a successful HTTP response before its announced length. This
      // loses the acknowledgment after headers and avoids an automatic
      // transport resend of a request whose response never began.
      res.writeHead(200,{"content-type":"application/json","content-length":Buffer.byteLength(raw),connection:"close"});
      res.end(raw.slice(0,5));
      return;
    }
    res.writeHead(r.status,{"content-type":"application/json"});
    res.end(raw);
  } catch {
    res.writeHead(500);
    res.end();
  }
});
try {
  const gatewayURL = "http://127.0.0.1:"+await listening(gateway);
  const mcpResource = gatewayURL+"/functions/v1/mcp";
  const fixtureClaims = {
    sub:principal, role:"authenticated", aud:"authenticated", iss:gatewayURL+"/auth/v1",
    session_id:session, is_anonymous:false, exp:Math.floor(Date.now()/1000)+600
  };
  const authorize = claims => {
    const auth = "Bearer "+token(claims);
    authenticated.add(auth);
    return auth;
  };
  const bearer=authorize(fixtureClaims);
  const automation = authorize({...fixtureClaims,client_id:randomUUID()});
  const wrongResource = authorize({...fixtureClaims,aud:"different-resource"});
  const env = {
    ...process.env,LOGLINE_ENABLE_PREVIEW:"false",RADIO_ENABLE_V2:"true",RADIO_AUTH_ISSUER:fixtureClaims.iss,
    SUPABASE_URL:gatewayURL,LOGLINE_SERVICE_KEY:service,LOGLINE_PUBLISHABLE_KEY:"test-public",
    RADIO_ENABLE_MCP:"true",RADIO_MCP_RESOURCE:mcpResource,
    LOGLINE_MACHINE_JWK:JSON.stringify(privateJwk),LOGLINE_PSEUDONYM_SECRET:L.b64url(secret)
  };
  async function worker(action) {
    if (nativeEdge) {
      const port = await listening(reservation);
      await close(reservation);
      const state = start("edge-runtime", ["start","--ip","127.0.0.1","--port",String(port),
        "--graceful-exit-timeout","0","--main-service",fileURLToPath(new URL("edge-v2-runtime/",import.meta.url))
      ],{...env,RADIO_TEST_FUNCTION_DIR:fileURLToPath(new URL("../supabase/functions/"+action,import.meta.url))});
      state.url="http://127.0.0.1:"+port;
      for(let n=0;n<40;n++) {
        if (state.process.exitCode !== null) break;
        try { if ((await fetch(state.url+"/ready")).ok) return state; } catch {}
        await delay(125);
      }
      throw Error(state.diagnostic || "Edge Runtime did not start");
    }
    const state=start("deno",["run","--allow-env","--allow-net=127.0.0.1",
      ...(action === "mcp" ? ["--allow-read="+fileURLToPath(new URL("../supabase/functions/",import.meta.url)),
        "--config",fileURLToPath(new URL("../supabase/functions/mcp/deno.json",import.meta.url))] : []),
      fileURLToPath(new URL("edge-v2-serve.ts",import.meta.url)),action],env);
    const lines=createInterface({input:state.process.stdout});
    try {
      const [line]=await Promise.race([once(lines,"line",{signal:AbortSignal.timeout(5000)}),
        state.done.then(()=>{throw Error(state.diagnostic);})]);
      assert.match(line,/^\d+$/);
      state.url="http://127.0.0.1:"+line;
      return state;
    } finally {lines.close();}
  }
  async function rpcReady() {
    for(let n=0;n<40;n++) {
      try { if((await fetch(rest+"/",{headers:{authorization:"Bearer "+service}})).ok) return; } catch {}
      await delay(125);
    }
    throw Error(restProcess.diagnostic || "PostgREST did not start");
  }
  await rpcReady();
  const nativeDenied = await fetch(rest+"/rpc/radio_v2_commit",{method:"POST",
    headers:{authorization:bearer,"content-type":"application/json"},
    body:JSON.stringify({p_principal:principal,p_client:null,p:{}})});
  assert.ok([401,403,404].includes(nativeDenied.status),"participant called service-only RPC");

  const perms=["publish","retire","submit","disclose","use_evidence","read_public","distribute_package"];
  await admin(`insert into radio_v2.authority(principal,pseudonym,active,permissions,mandates)
    values (${q(principal)},${q(by)},true,array[${perms.map(q)}],${j({direct:perms})});`);
  const publish=await worker("publish");
  let submit=await worker("submit");
  const receiptReader=await worker("receipt");
  const fetchReceipt = async (id, authorization=bearer, view) => {
    const target=new URL(receiptReader.url);
    target.searchParams.set("id",id);
    if (view) target.searchParams.set("view",view);
    const r=await fetch(target,{headers:{"logline-version":"2",authorization},signal:AbortSignal.timeout(15000)});
    return {status:r.status,body:await r.json()};
  };
  const send = async (target,input,{version="2",authorization=bearer}={}) => {
    const response=await fetch(target.url,{method:"POST",headers:{
      "logline-version":version,"content-type":"application/json",authorization
    },body:typeof input==="string"?input:JSON.stringify(input),signal:AbortSignal.timeout(15000)});
    return {status:response.status,version:response.headers.get("logline-version"),value:await response.json()};
  };
  assert.deepEqual((await send(submit,"{}",{version:"9"})).value,{error:"unsupported_version"});
  assert.deepEqual((await send(submit,"{}",{authorization:"Bearer invalid"})).value,{error:"unauthenticated"});
  assert.deepEqual((await send(submit,"{}",{authorization:wrongResource})).value,{error:"unauthenticated"});
  assert.deepEqual((await send(publish,"{}",{authorization:automation})).value,{error:"forbidden"});
  assert.deepEqual((await send(submit,'{"tuple":1,"tuple":2}')).value,{error:"invalid_request"});
  assert.deepEqual((await send(submit,"x".repeat(L.MAX_SUBMISSION_BYTES+1))).value,{error:"resource_limit"});
  assert.equal(audit.length,0,"invalid requests reached the privileged database");

  const id="edge-native."+randomUUID();
  const run=(id,after,extra={})=>({id,after,requires:{},steps:[],if_ok:"ok",if_not:"not",if_doubt:"doubt",...extra});
  const law={logline:"process-type@1",id,issuer:"Fixture",
    recognize:{and:[{has:"edgeLaw"},{"==":[{var:"edgeLaw"},id]}]},
    runs:[run("open",[],{broadcast:["tuple.value"]}),run("consume",["open"],{cites:{once:{frequency:id,once:true}}})]};
  const published=await send(publish,law);
  assert.equal(published.status,201);
  assert.equal(published.version,"2");
  assert.equal((await send(publish,law)).status,200);
  assert.equal((await send(publish,{...law,issuer:"Amended"})).status,409);
  const {hash,registry}=published.value;
  assert.equal(hash,await L.hashOf(law));

  const request = (tuple,continuation) => ({tuple,submission:L.b64url(randomBytes(16)),
    ...(continuation ? {continue:continuation} : {})});
  if (testMcp) {
    const client=randomUUID(), reader=randomUUID(), other=randomUUID();
    const readers=["read_public"], participant=["read_public","submit","disclose","use_evidence"];
    await admin(`insert into radio_v2.oauth_resources values (${q(client)},${q(mcpResource)}),
      (${q(reader)},${q(mcpResource)}),(${q(other)},${q(mcpResource)});
      update radio_v2.authority set mandates=${j({direct:perms,[client]:participant,[reader]:readers})}
      where principal=${q(principal)};`);
    const claims = {...fixtureClaims,is_anonymous:false,client_id:client};
    const bound=await scalar(`select public.radio_v2_oauth_audience(${j({claims})});`,"supabase_auth_admin");
    assert.deepEqual(bound.claims,{...claims,aud:mcpResource});
    assert.deepEqual(await scalar(`select public.radio_v2_oauth_audience(${j({claims:fixtureClaims})});`,
      "supabase_auth_admin"),{claims:fixtureClaims});
    await assert.rejects(sql(`select public.radio_v2_oauth_audience('{}');`,"authenticated"),/permission denied/);
    const directory=mkdtempSync(join(tmpdir(),"radio-mcp-fixture-"));
    const skillPath="skills/participant/SKILL.md";
    const markdown="---\nname: participant\ndescription: Draft an example Contract\n---\nAgree on the tuple with the human.\n";
    try {
      const files={"process-type.json":L.canonicalize(law),[skillPath]:markdown};
      const manifest={logline:"diplomacy@1",files:Object.fromEntries(await Promise.all(
        Object.entries(files).map(async ([path,value])=>[path,await L.sha256(value)])))};
      mkdirSync(join(directory,"skills/participant"),{recursive:true});
      for (const [path,value] of Object.entries({...files,"diplomacy.json":JSON.stringify(manifest)}))
        writeFileSync(join(directory,path),value);
      execFileSync("zip",["-q","-X","package.zip","diplomacy.json",...Object.keys(files)],{cwd:directory});
      const archive=readFileSync(join(directory,"package.zip"));
      const verified=await validateDiplomacy(archive);
      const adopt=await diplomacyAdoptionSql(archive,principal);
      await assert.rejects(sql(adopt,"authenticated"),/permission denied/);
      assert.deepEqual(await scalar(adopt),{kind:"committed",id:verified.id});
      assert.deepEqual(await scalar(adopt),{kind:"replayed",id:verified.id});
      const denied=adopt.replace(`'${principal}',null`,`'${principal}','${reader}'`);
      assert.deepEqual(await scalar(denied),{kind:"forbidden"});
      await assert.rejects(admin(`update radio_v2.package_archives set archive=archive where id=${q(verified.id)};`),/immutable/);
      const distributor=await worker("diplomacy");
      const resource=new URL(distributor.url);
      resource.searchParams.set("id",verified.id);
      const downloaded=await fetch(resource,{headers:{"logline-version":"2",authorization:bearer}});
      assert.equal(downloaded.status,200);
      assert.equal(downloaded.headers.get("radio-archive"),await L.sha256(archive));
      assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()),archive);
      assert.equal((await fetch(resource,{headers:{"logline-version":"2",authorization:"Bearer invalid"}})).status,401);
      await stop(distributor);
    } finally { rmSync(directory,{force:true,recursive:true}); }

    const mcp=await worker("mcp");
    const raw = (authorization, text = "{}") => fetch(mcp.url+"/functions/v1/mcp",{method:"POST",
      headers:{authorization,"content-type":"application/json"},body:text,signal:AbortSignal.timeout(15000)});
    const malformed=await raw("Bearer "+oauthToken(bound.claims),'{"jsonrpc":"2.0","jsonrpc":"2.0"}');
    assert.equal(malformed.status,400);
    assert.equal((await malformed.json()).error.data.error,"invalid_request");
    const tooBig=await raw("Bearer "+oauthToken(bound.claims)," ".repeat(2*L.MAX_SUBMISSION_BYTES+1));
    assert.equal(tooBig.status,413);
    for (const invalid of [claims,{...bound.claims,aud:mcpResource+"/other"},{...bound.claims,iss:mcpResource},
      {...bound.claims,client_id:undefined},{...bound.claims,is_anonymous:true},{...bound.claims,exp:1}]) {
      const rejected=await raw("Bearer "+oauthToken(invalid));
      assert.equal(rejected.status,401);
      assert.match(rejected.headers.get("www-authenticate"),/resource_metadata/);
    }
    const metadata=await fetch(mcp.url+"/functions/v1/mcp/oauth-protected-resource");
    assert.equal((await metadata.json()).resource,mcpResource);
    const initial=request(JSON.parse(JSON.stringify({who:"participant",did:"request",this:"participation",
      with:{evidence:"a\u0000b"},edgeLaw:id}).replace('"with":{','"with":{"__proto__":0,')));
    async function probe(target,phase) {
      const {stdout}=await promisify(execFile)("deno",["run","--node-modules-dir=none","--no-lock",
        "--allow-env=RADIO_MCP_PROBE","--allow-net=127.0.0.1",
        fileURLToPath(new URL("mcp-v2-client.mjs",import.meta.url))],{
        env:{...env,RADIO_MCP_PROBE:JSON.stringify({phase,url:target.url+"/functions/v1/mcp",
          allowed:oauthToken(bound.claims),readOnly:oauthToken({...bound.claims,client_id:reader}),
          noMandate:oauthToken({...bound.claims,client_id:other}),law:hash,markdown,initial,by})}
      });
      return stdout.trim();
    }
    const committed=await probe(mcp,"initial");
    await stop(mcp);
    const replacement=await worker("mcp");
    assert.equal(await probe(replacement,"replay"),committed);
    await admin(`update radio_v2.authority set mandates=mandates-${q(client)} where principal=${q(principal)};`);
    await probe(replacement,"revoked");
    await stop(replacement);
    assert.equal(await scalar(`select count(*) from radio_v2.decisions where client=${q(client)}
      and principal=${q(principal)} and submission=${q(initial.submission)};`),1);
    console.log("MCP 2026-07-28 and stateless 2025 compatibility, authorized DIPLOMACY, signed RUN, replay and revocation passed.");
  }
  const first=request({edgeLaw:id,value:"escaped\u0000🛰"});
  const entry=(await send(submit,first)).value;
  assert.equal(entry.receipt.header.status,"ok");
  assert.deepEqual(await fetchReceipt(entry.receipt.id),{status:200,body:{receipt:entry.receipt}});
  assert.deepEqual(await fetchReceipt(entry.receipt.id,bearer,"evidence"),{
    status:200,body:{tuple:first.tuple,detail:entry.detail,context:entry.context}
  });
  assert.deepEqual(await fetchReceipt(entry.receipt.id,"Bearer invalid"),
    {status:401,body:{error:"unauthenticated"}});
  assert.deepEqual(await fetchReceipt("invalid"),{status:400,body:{error:"invalid_request"}});
  if (process.env.RADIO_TEST_REALTIME === "yes") {
    const secret=process.env.RADIO_TEST_REALTIME_JWT_SECRET;
    if (!secret) throw Error("Configure the disposable Realtime JWT fixture");
    const {probeRealtime}=await import("./realtime-v2-probe.mjs");
    await probeRealtime({issuer:fixtureClaims.iss,principal,keys,readReceipt:fetchReceipt,
      mint:(sub,exp)=>token({...fixtureClaims,sub,exp,iat:Math.floor(Date.now()/1000),
        session_id:randomUUID(),is_anonymous:false},secret),
      commit:async value=>{
        const outcome=await send(submit,request({edgeLaw:id,value}));
        assert.equal(outcome.status,201);
        return outcome.value.receipt;
      }});
  }
  const selected=await scalar(`select public.radio_v2_registry(${q(principal)},null,${q(registry)},true);`);
  const expected=await L.issueV2(key,L.canonicalize(first),{
    by,when:entry.receipt.header.when,registryHash:registry,keys,
    snapshots:new Map([[registry,selected.snapshot]]),laws:new Map(Object.entries(selected.laws)),
    read:async()=>null,completed:async()=>null,spent:async()=>false
  });
  assert.deepEqual(entry,{receipt:expected.receipt,detail:expected.detail,context:expected.context,replayed:false});
  assert.deepEqual((await send(submit,{...first,tuple:null})).value,{error:"submission_conflict"});

  const second=(await send(submit,request({edgeLaw:id}))).value.receipt.id;
  const contender = root => request({cites:{once:entry.receipt.id}},{instance:root,run:"consume",parents:{open:root}});
  const a=contender(entry.receipt.id), b=contender(second);
  race={submissions:new Set([a.submission,b.submission]),arrived:0};
  race.ready=new Promise(resolve=>{race.release=resolve;});
  const outcomes=await Promise.all([send(submit,a),send(submit,b)]);
  assert.equal(race.arrived,2);
  assert.deepEqual(outcomes.map(r=>r.status),[201,201]);
  assert.deepEqual(outcomes.map(r=>r.value.receipt.header.status).sort(),["ok","registered"]);
  assert.equal(outcomes.find(r=>r.value.receipt.header.status==="registered").value.detail.reason,"citation_spent");
  const writes=audit.filter(r=>r.name==="radio_v2_commit"&&race.submissions.has(r.payload.p.submission));
  assert.equal(writes.length,3);
  const retry=writes.find(r=>r.outcome.kind==="retry").payload.p;
  const replacement=writes.find(r=>r.payload.p.submission===retry.submission&&r.outcome.kind==="committed").payload.p;
  assert.equal(retry.admission_registry,replacement.admission_registry);
  assert.equal(JSON.parse(retry.header).when,JSON.parse(replacement.header).when);
  assert.equal(await scalar(`select count(*) from radio_v2.receipts where id=${q(retry.id)};`),0);
  assert.ok(audit.some(r=>r.name==="radio_v2_registry_inputs"&&r.payload.p_selection===""));
  assert.ok(audit.some(r=>r.name==="radio_v2_registry_inputs"&&r.payload.p_selection===hash));

  const missing=request({edgeLaw:id});
  lost=missing.submission;
  const recovered=await send(submit,missing);
  assert.equal(dropped,1);
  assert.equal(recovered.status,200);
  assert.equal(recovered.value.replayed,true);
  assert.equal(audit.filter(r=>r.name==="radio_v2_commit"&&r.payload.p.submission===lost).length,1);
  assert.equal(audit.filter(r=>r.name==="radio_v2_admit"&&r.payload.p_submission===lost).length,2);
  await stop(submit);
  submit=await worker("submit");
  assert.deepEqual((await send(submit,missing)).value,recovered.value);
  const oversizedId = id+".large";
  const largeLaw = {...law,id:oversizedId,recognize:{and:[{has:"edgeLaw"},{"==":[{var:"edgeLaw"},oversizedId]}]},runs:[
    run("open",[],{
      grants:Object.fromEntries(["one","two","three","four","five"].map(n=>[n,{var:"value"}])),
      broadcast:["one","two","three","four","five"].map(n=>"detail.grants."+n)
    })
  ]};
  assert.equal((await send(publish,largeLaw)).status,201);
  const tooLarge=request({edgeLaw:oversizedId,value:"x".repeat(60000)});
  const rejected=await send(submit,tooLarge);
  assert.equal(rejected.status,413);
  assert.deepEqual(rejected.value,{error:"resource_limit"});
  assert.ok(!audit.some(r=>r.name==="radio_v2_commit"&&r.payload.p.submission===tooLarge.submission));

  const historyWorker=await worker("history");
  const firstPage=await send(historyWorker,{limit:1,tuning:{by:"me",frequency:id}});
  assert.equal(firstPage.status,200);
  assert.ok(firstPage.value.next);
  assert.equal(firstPage.value.checkpoint,null);
  assert.deepEqual((await send(historyWorker,{after:firstPage.value.next})).value,{error:"cursor_invalid"});
  const nextPage=await send(historyWorker,{after:firstPage.value.next,tuning:{frequency:[id],by:[by]}});
  assert.equal(nextPage.status,200);
  assert.ok(nextPage.value.checkpoint);
  assert.ok([...firstPage.value.items,...nextPage.value.items].some(item=>item.id===entry.receipt.id));
  assert.deepEqual((await send(historyWorker,{after:nextPage.value.checkpoint,tuning:{frequency:id,by:"me"}})).value.items,[]);
  const retire=async () => {
    const target=new URL(publish.url);
    target.searchParams.set("id",id);
    const response=await fetch(target,{method:"DELETE",headers:{"logline-version":"2",authorization:bearer}});
    return {status:response.status,body:await response.json()};
  };
  const retired=await retire();
  assert.equal(retired.status,200);
  assert.equal(retired.body.hash,hash);
  assert.deepEqual(await retire(),retired);
  assert.equal((await send(submit,request({edgeLaw:id}))).value.receipt.header.status,"registered");

  await admin(`update radio_v2.authority set mandates='{}' where principal=${q(principal)};`);
  assert.deepEqual((await send(submit,missing)).value,{error:"forbidden"});
  assert.deepEqual(await fetchReceipt(entry.receipt.id),{status:404,body:{error:"not_found"}});
  assert.deepEqual(await fetchReceipt(entry.receipt.id,bearer,"evidence"),{status:404,body:{error:"not_found"}});
  assert.deepEqual((await send(historyWorker,{after:nextPage.value.checkpoint})).value,{error:"forbidden"});
  assert.equal(await scalar(`select count(*) from radio_v2.decisions where principal=${q(principal)}
    and submission=${q(lost)};`),1);
  console.log((nativeEdge?"Supabase Edge Runtime":"Deno")+" + PostgREST + PostgreSQL v2: publication and retirement, reference parity, receipt and evidence reads, history, native contention, reply loss, replacement and revocation passed.");
} finally {
  await Promise.all([...processes].map(stop));
  if (gateway.listening) await close(gateway);
}
