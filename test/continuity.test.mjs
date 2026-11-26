// Real local HTTP/SSE and process replacement. No hosted service is simulated.
import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,rmSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {spawn,spawnSync} from "node:child_process";
import {once} from "node:events";
import {fileURLToPath} from "node:url";
import * as L from "../dist/index.js";
import {openProcessMachine} from "../server/store.mjs";
import {createServer} from "../server/http.mjs";

const law={logline:"process-type@1",id:"course.trajectory@1",issuer:"Example school",recognize:{"==":[{var:"did"},"enroll"]},runs:[
  {id:"open",after:[],requires:{subject:"string"},steps:[],grants:{owner:{var:"$by"},subject:{var:"subject"}},
   if_ok:"Enrolled",if_not:"Refused",if_doubt:"Pending",broadcast:["detail.grants.subject"]},
  {id:"review",after:["open"],requires:{score:"integer"},steps:[
    {id:"independent",check:{"!=":[{var:"$by"},{var:"$parents.open.detail.grants.owner"}]},if_not:"not",reason:"A different reviewer is required"},
    {id:"score",check:{">=":[{var:"score"},70]},if_not:"not",reason:"Score too low"}
   ],grants:{reviewer:{var:"$by"}},if_ok:"Reviewed",if_not:"Refused",if_doubt:"Pending"},
  {id:"complete",after:["review"],requires:{},steps:[],grants:{completed:true},if_ok:"Complete",if_not:"Refused",if_doubt:"Pending",broadcast:["detail.grants.completed"]}
]};
const nonce=n=>Buffer.alloc(16,n).toString("base64url");
const req=(tuple,n,continuation)=>({tuple,submission:nonce(n),...(continuation?{continue:continuation}:{})});
const enroll=n=>req({did:"enroll",subject:"course-A",who:"claimed other identity"},n);
const review=(root,n,score=80)=>req({score},n,{instance:root,run:"review",parents:{open:root}});
const complete=(root,reviewId,n)=>req({},n,{instance:root,run:"complete",parents:{review:reviewId}});
const cli=fileURLToPath(new URL("../bin/logline-server.mjs",import.meta.url));
const verifier=fileURLToPath(new URL("../bin/logline.mjs",import.meta.url));
const headers=token=>token?{authorization:"Bearer "+token}:{};

async function call(base,path,{token,body,method=body===undefined?"GET":"POST",version="2"}={}){
  const r=await fetch(base+path,{method,headers:{...headers(token),"logline-version":version},body:body===undefined?undefined:typeof body==="string"?body:JSON.stringify(body),signal:AbortSignal.timeout(5000)});
  return {status:r.status,headers:r.headers,json:await r.json()};
}
async function boot(dir){
 const p=spawn("node",[cli,"serve","--target","--data",dir,"--port","0"],{stdio:["ignore","pipe","pipe"]});
 const exited=once(p,"exit");let out="",errors="";
 p.stderr.on("data",b=>{errors+=b.toString()});
 let timer;
 try{
  const base=await new Promise((resolve,reject)=>{
   timer=setTimeout(()=>reject(Error("startup timeout: "+errors)),8000);
   p.stdout.on("data",b=>{out+=b.toString();const m=/http:\/\/127\.0\.0\.1:\d+/.exec(out);if(m)resolve(m[0])});
   p.once("error",reject);p.once("exit",code=>reject(Error("server exit "+code+" "+errors)));
  });
  return {base,p,stop:async()=>{if(p.exitCode===null&&p.signalCode===null)p.kill("SIGTERM");await exited}};
 }catch(e){p.kill("SIGKILL");throw e}finally{clearTimeout(timer)}
}
// Each new listener has only the address, bearer token, and optional cursor.
async function tune(base,query,token,cursor){
 const ctl=new AbortController(),r=await fetch(base+"/radio?"+query,{
   headers:{...headers(token),"logline-version":"2",...(cursor===undefined?{}:{"last-event-id":String(cursor)})},
   signal:AbortSignal.any([ctl.signal,AbortSignal.timeout(12000)])
 });
 assert.equal(r.status,200);assert.match(r.headers.get("content-type"),/^text\/event-stream/);
 const reader=r.body.getReader(),decoder=new TextDecoder();let buf="";
 const next=async()=>{
   for(;;){
    const i=buf.indexOf("\n\n");
    if(i>=0){
      const block=buf.slice(0,i);buf=buf.slice(i+2);
      const data=block.split("\n").find(x=>x.startsWith("data: "));
      if(data){
        const event=JSON.parse(data.slice(6));
        assert.equal(block.split("\n").find(x=>x.startsWith("id: ")), "id: "+event.seq);
        return event;
      }
    }else{
      const r=await reader.read();assert(!r.done,"stream ended");buf+=decoder.decode(r.value,{stream:true});
    }
   }
 };
 return {next,close:()=>ctl.abort()};
}
async function fixture(){
 const dir=mkdtempSync(join(tmpdir(),"radio-continuity-"));
 const m=await openProcessMachine(dir,{scanOps:100});
 const tokens={ana:m.accounts.add("ana"),bob:m.accounts.add("bob",{admin:true}),observer:m.accounts.add("observer")};
 m.close();
 return {dir,tokens};
}
test("target continuity over actual HTTP/SSE, independent participants, replaced process and listener, offline CLI", {timeout:30000},async()=>{
 const {dir,tokens}=await fixture();let s,t,a,b,c;
 try{
  s=await boot(dir);
  const me=await call(s.base,"/me",{token:tokens.ana}),reviewer=await call(s.base,"/me",{token:tokens.bob});
  assert.notEqual(me.json.by,reviewer.json.by);
  const discovery=await call(s.base,"/.well-known/logline.json");
  assert.deepEqual(discovery.json.versions,["2"]);
  assert.equal(discovery.headers.get("logline-version"),"2");
  const trust=discovery.json.keys;
  assert.equal((await call(s.base,"/processes",{token:tokens.ana,body:law})).status,403);
  assert.equal((await call(s.base,"/processes",{token:tokens.bob,body:law})).status,201);
  assert.equal((await call(s.base,"/submit",{body:enroll(1)})).status,401);
  assert.equal((await call(s.base,"/submit",{token:tokens.ana,body:enroll(1),version:"1"})).status,400);
  a=await tune(s.base,"frequency=course.*&status=ok",tokens.ana);
  b=await tune(s.base,"frequency=course.*&status=ok",tokens.bob);
  const entry=await call(s.base,"/submit",{token:tokens.ana,body:enroll(1)});
  assert.equal(entry.status,201);
  const root=entry.json.receipt.id;
  assert.equal(entry.json.receipt.header.by,me.json.by);
  assert.notEqual(entry.json.receipt.header.by,enroll(1).tuple.who);
  const [ea,eb]=await Promise.all([a.next(),b.next()]);
  assert.deepEqual(ea,eb);assert.deepEqual(ea.receipt,entry.json.receipt);
  const publicReceipt=await call(s.base,"/receipts/"+root);assert.deepEqual(publicReceipt.json,ea);
  assert.deepEqual(Object.keys(ea).sort(),["receipt","seq"]);
  assert(await L.authenticV2(ea.receipt,trust));
  assert.equal((await call(s.base,"/history")).json.items.length,1,"no automatic reaction");
  assert.equal((await call(s.base,"/receipts/"+root+"/detail",{token:tokens.observer})).status,403);
  const denied=await call(s.base,"/submit",{token:tokens.observer,body:review(root,2)});
  assert.equal(denied.json.detail.reason,"continuation_unavailable");
  assert.deepEqual(denied.json.receipt.header.prev,[]);
  a.close();b.close();
  const independent=await call(s.base,"/submit",{token:tokens.bob,body:review(eb.receipt.id,3)});
  assert.equal(independent.status,201);assert.equal(independent.json.receipt.header.status,"ok");
  assert.equal(independent.json.receipt.header.by,reviewer.json.by);
  assert.equal(independent.json.receipt.header.instance,root);
  assert.deepEqual(independent.json.receipt.header.prev,[root]);
  const cursor=ea.seq;
  const oldPid=s.p.pid;await s.stop();s=null;
  t=await boot(dir);assert.notEqual(t.p.pid,oldPid);
  assert.deepEqual((await call(t.base,"/.well-known/logline.json")).json.keys,trust);
  assert.equal((await call(t.base,"/me",{token:tokens.bob})).json.by,reviewer.json.by);
  // An independent replacement process receives only endpoint, credential
  // and cursor. It never reads the issuing machine's disk or original reader.
  const readerScript = 'const [url,token,after]=process.argv.slice(1);'+
    'const r=await fetch(url+"/radio?frequency=course.*&status=ok&after=0",{headers:{authorization:"Bearer "+token,"logline-version":"2","last-event-id":after},signal:AbortSignal.timeout(5000)});'+
    'if(!r.ok)throw Error("HTTP "+r.status);const reader=r.body.getReader(),d=new TextDecoder();let buf="";'+
    'for(;;){const x=await reader.read();if(x.done)throw Error("stream ended");buf+=d.decode(x.value,{stream:true});'+
    'const m=/^data: (.+)$/m.exec(buf);if(m){console.log(m[1]);await reader.cancel();break}}';
  const replacement=spawnSync("node",["--input-type=module","-e",readerScript,t.base,tokens.bob,String(cursor)],{encoding:"utf8",timeout:8000});
  assert.equal(replacement.status,0,replacement.stderr);
  const caught=JSON.parse(replacement.stdout);
  assert.deepEqual(caught.receipt,independent.json.receipt);
  assert.equal(caught.seq,3);
  // The replacement's cursor is sufficient to reconnect for live delivery.
  c=await tune(t.base,"frequency=course.*&status=ok&after=0",tokens.bob,caught.seq);
  const hist=await call(t.base,"/history?frequency=course.*&status=ok&after="+cursor+"&limit=1");
  assert.deepEqual(hist.json.items,[caught]);
  assert.equal(hist.json.next,caught.seq);
  const next=await call(t.base,"/submit",{token:tokens.bob,body:complete(root,caught.receipt.id,4)});
  assert.equal(next.status,201);assert.equal(next.json.receipt.header.status,"ok");
  assert.equal(next.json.receipt.header.instance,root);
  const live=await c.next();assert.deepEqual(live.receipt,next.json.receipt);assert.equal(live.seq,4);
  c.close();
  const retry=await call(t.base,"/submit",{token:tokens.bob,body:complete(root,caught.receipt.id,4)});
  assert.equal(retry.status,200);assert.deepEqual(retry.json.receipt,next.json.receipt);
  assert.equal((await call(t.base,"/history")).json.items.length,4);
  assert.deepEqual((await call(t.base,"/history?by=me",{token:tokens.bob})).json.items.map(e=>e.seq),[3,4]);
  assert.equal((await call(t.base,"/history?limit=0")).status,400);
  const conflicted=await call(t.base,"/submit",{token:tokens.bob,body:review(root,3,90)});
  assert.equal(conflicted.status,409);assert.equal(conflicted.json.error,"submission_conflict");
  const id=next.json.receipt.id;
  assert.equal((await call(t.base,"/receipts/"+id+"/bundle",{token:tokens.ana})).status,403);
  const exported=await call(t.base,"/receipts/"+id+"/bundle",{token:tokens.bob});
  assert.equal(exported.status,200);assert.equal(exported.headers.get("cache-control"),"private, no-store");
  // Offline verification really occurs after the issuing process is stopped.
  await t.stop();t=null;
  const bundlePath=join(dir,"export.json"),keyPath=join(dir,"trust.json");
  writeFileSync(bundlePath,JSON.stringify(exported.json));writeFileSync(keyPath,JSON.stringify({keys:trust}));
  const run=spawnSync("node",[verifier,"verify-bundle",bundlePath,"--keys",keyPath],{encoding:"utf8",timeout:5000});
  assert.equal(run.status,0,run.stderr||run.stdout);
  const verdict=JSON.parse(run.stdout);assert.equal(verdict.valid,true);assert.equal(verdict.checked.length,3);
  assert.equal(spawnSync("node",[verifier,"verify-bundle",bundlePath],{encoding:"utf8",timeout:5000}).status,2);
 }finally{a?.close();b?.close();c?.close();await s?.stop();await t?.stop();rmSync(dir,{recursive:true,force:true})}
});
test("bundle export checks every ancestor's private access, not just head ownership",{timeout:15000},async()=>{
 const {dir,tokens}=await fixture();let m,server;
 try{
  // A different law permits the privileged reviewer to advance; the learner
  // cannot receive the reviewer's detail. The trusted local policy is strict.
  m=await openProcessMachine(dir,{scanOps:100});server=createServer(m);
  await new Promise(r=>server.listen(0,"127.0.0.1",r));
  const base="http://127.0.0.1:"+server.address().port;
  await call(base,"/processes",{token:tokens.bob,body:law});
  const a=await call(base,"/submit",{token:tokens.ana,body:enroll(1)});
  const r=await call(base,"/submit",{token:tokens.bob,body:review(a.json.receipt.id,2)});
  // Direct trusted ledger access for constructing an owner-head with a private
  // foreign ancestor, not a new public authorization policy.
  const by=(await call(base,"/me",{token:tokens.ana})).json.by;
  const head=await m.ledger.submitText(JSON.stringify(complete(a.json.receipt.id,r.json.receipt.id,3)),{by,canRead:()=>true});
  assert.equal(head.receipt.header.status,"ok");
  const denied=await call(base,"/receipts/"+head.receipt.id+"/bundle",{token:tokens.ana});
  assert.equal(denied.status,403);assert.equal(denied.json.objects,undefined);
  assert.equal((await call(base,"/receipts/"+head.receipt.id+"/detail",{token:tokens.ana})).status,200);
  assert.equal((await call(base,"/receipts/"+head.receipt.id+"/bundle",{token:tokens.bob})).status,200);
 }finally{await server?.shutdown();m?.close();rmSync(dir,{recursive:true,force:true})}
});
