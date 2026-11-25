import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as L from '../dist/index.js';
import { createHandler, auth } from '../supabase/functions/_shared/http.mjs';
const origin = 'https://radio.example.invalid';
const law = JSON.parse(readFileSync(new URL('../processes/course.lesson@1.json', import.meta.url)));
const tuple = {this: law.id, did:'complete', with:{course:'logline-101', lesson:1, score:90}};
const owner = '11111111-1111-4111-8111-111111111111';
async function fixture() {
  const {key} = await L.generateMachineKey(), keys = {[key.id]:{jwk:key.public}};
  const objects = new Map([[await L.hashOf(law), L.canonicalize(law)]]), rows = new Map(), idem = new Map(), calls=[];
  const db = {process:async id=>id===law.id?law:null, citation:async id=>rows.get(id)??null, spent:async()=>[], commit:async p=>{
    if(idem.has(p.cache_key))return {kind:'replayed',id:idem.get(p.cache_key)};
    const r={receipt:JSON.parse(p.receipt),detail:JSON.parse(p.detail)};
    rows.set(p.id,r); idem.set(p.cache_key,p.id); objects.set(p.input_hash,p.tuple);objects.set(p.detail_hash,p.detail);
    return {kind:'committed',id:p.id};
  }, publish:async p=>({id:p.id,hash:await L.hashOf(p)})};
  const identify=auth({url:origin,publishableKey:'sb_publishable_test',pseudonymSecret:new Uint8Array(32),fetcher:async(url,init)=>{
    assert.equal(url,origin+'/auth/v1/user');
    const token=init.headers.authorization;
    return token==='Bearer fresh'||token==='Bearer admin'?Response.json({id:owner,app_metadata:{logline_admin:token==='Bearer admin'}}):new Response('{}',{status:401});
  }});
  const fetcher=async(url,init={})=>{
    url=new URL(url);assert.equal(url.origin,origin); calls.push({url,init});
    if(url.pathname.startsWith('/functions/v1/'))return createHandler({action:url.pathname.split('/').at(-1),db,key,keys,identify})(new Request(url,init));
    if(url.pathname==='/auth/v1/.well-known/oauth-authorization-server')return Response.json({issuer:origin+'/auth/v1'});
    const eq=k=>url.searchParams.get(k)?.slice(3);
    if(url.pathname==='/rest/v1/processes')return Response.json(eq('id')===law.id?[{hash:await L.hashOf(law)}]:[]);
    if(url.pathname==='/rest/v1/receipts')return Response.json(rows.has(eq('id'))?[{receipt:L.canonicalize(rows.get(eq('id')).receipt)}]:[]);
    if(url.pathname==='/rest/v1/objects'){
      const hash=eq('hash'),body=objects.get(hash);
      return Response.json(body!==undefined&&(hash===await L.hashOf(law)||init.headers.authorization==='Bearer fresh')?[{body}]:[]);
    }
    throw new Error('unexpected path '+url);
  };
  return {key,keys,objects,rows,calls,fetcher,client:(accessToken)=>L.hostedClient({url:origin,publishableKey:'sb_publishable_test',keys,accessToken,fetcher})};
}
test('native issuer discovery, direct submit, public receipt, RLS evidence and offline replay',async()=>{
  const x=await fixture(), c=x.client(()=> 'fresh');
  assert.equal((await c.oauthMetadata()).issuer,origin+'/auth/v1');
  assert.equal(x.calls[0].init.headers,undefined);
  const r=await c.submit(tuple);assert.equal(r.receipt.header.status,'ok');
  assert.equal(r.receipt.header.by,await L.pseudonym(new Uint8Array(32),owner));
  const publicClient=x.client();assert.deepEqual(await publicClient.receipt(r.receipt.id),r.receipt);
  assert.equal(await publicClient.object(r.receipt.header.input_hash),null);
  const process=await c.process(law.id), input=await c.object(r.receipt.header.input_hash), citation=await c.citation(r.receipt.id);
  assert.equal((await L.verify(r.receipt,x.keys,{tuple:input.value,process,detail:citation.detail})).checks.find(x=>x.code==='replay').result,'pass');
  assert.ok(x.calls.every(({url})=>url.pathname.startsWith('/auth/v1/')||url.pathname.startsWith('/rest/v1/')||url.pathname.startsWith('/functions/v1/')));
  assert.ok(x.calls.filter(({url})=>url.pathname==='/rest/v1/receipts'||url.pathname==='/rest/v1/processes').every(({init})=>!init.headers.authorization));
});
test('fresh token per call; no anonymous fallback on invalid bearer; admin publish',async()=>{
  const x=await fixture();let token='expired';const c=x.client(()=>token);
  await assert.rejects(c.submit(tuple),e=>e.status===401);
  token='fresh';assert.equal((await c.submit(tuple)).receipt.header.status,'ok');
  await assert.rejects(c.publish(law),e=>e.status===403);
  token='admin';assert.equal((await c.publish(law)).hash,await L.hashOf(law));
});
test('direct client rejects forged receipt, altered CAS, unsafe origins and secret keys',async()=>{
  const x=await fixture(), c=x.client(()=> 'fresh'),r=await c.submit(tuple);
  x.objects.set(r.receipt.header.input_hash,'null');await assert.rejects(c.object(r.receipt.header.input_hash),e=>e.code==='integrity');
  x.rows.get(r.receipt.id).receipt.sig.value='bad';await assert.rejects(c.receipt(r.receipt.id),e=>e.code==='integrity');
  for(const opts of [{url:'http://example.com'},{publishableKey:'sb_secret_bad'},{publishableKey:'a.'+btoa('{"role":"service_role"}')+'.b'}])assert.throws(()=>L.hostedClient({url:origin,publishableKey:'sb_publishable_test',keys:x.keys,...opts}));
});
