import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { hostedClientV2 } from "../dist/index.js";

const corpus = JSON.parse(readFileSync(new URL("../vectors/run-v2.json",import.meta.url)));
const [early,late,live] = corpus.cases.slice(0,3).map(item => item.expected.receipt);
const check = item => ({receipt:item});
const json = (value,status=200) => Response.json(value,{status,headers:{"logline-version":"2"}});

test("v2 client verifies inputs, signed results and receipt identities on the authorized API", async () => {
  const fixtures=["free-scalar","retired-law-continuation"].map(name=>corpus.cases.find(item=>item.name===name));
  const {receipt}=fixtures[0].expected;
  let exchanged=0;
  const radio=hostedClientV2({url:"https://radio.example",publishableKey:"sb_publishable_fixture",keys:corpus.keys,
    accessToken:()=> "credential-" + ++exchanged,fetcher:async (url,request) => {
      assert.equal(request.headers.authorization,"Bearer credential-"+exchanged);
      assert.equal(request.headers["logline-version"],"2");
      if (url.pathname.endsWith("/submit")) {
        const input=JSON.parse(request.body);
        const fixture=fixtures.find(item=>item.request.submission===input.submission);
        assert.deepEqual(input,fixture.request);
        const {receipt,detail,context}=fixture.expected;
        return json({receipt,detail,context,replayed:false},201);
      }
      return json({receipt});
    }});
  for (const fixture of fixtures)
    assert.deepEqual((await radio.submit(fixture.request)).receipt,fixture.expected.receipt);
  assert.deepEqual(await radio.receipt(receipt.id),receipt);
  await assert.rejects(radio.receipt(early.id),error=>error.code==="integrity");
  assert.equal(exchanged,4);
});

test("listener merges live and durable reads, keeps a completed checkpoint, and resumes after replacement", async () => {
  let channel, saved=null, supplied=0, block, disconnected=false;
  const received=[], errors=[], tokens=[], seen=new Set();
  const firstPage=new Promise(resolve=>{ block=resolve; });
  const state={seen,receive:item=>{received.push(item.id);},onError:error=>{errors.push(error);},
    checkpoint:{load:()=>saved,save:value=>{saved=value;}}};
  const realtime={
    setAuth:token=>{tokens.push(token);},
    channel(name,options) {
      assert.equal(name,"radio:v2:receipts");
      assert.deepEqual(options,{config:{private:true}});
      channel={
        on(_,__,callback){this.signal=id=>callback({payload:{id}});return this;},
        subscribe(callback){callback("SUBSCRIBED");return this;},
        unsubscribe:async()=>{}
      };
      return channel;
    }
  };
  const receipts=new Map([early,late,live].map(item=>[item.id,item]));
  const radio=hostedClientV2({url:"https://radio.example",publishableKey:"key",keys:corpus.keys,
    accessToken:()=> "credential-" + ++supplied,fetcher:async (url,request) => {
      if (url.pathname.endsWith("/receipt")) return json(check(receipts.get(url.searchParams.get("id"))));
      switch (JSON.parse(request.body).after) {
        case undefined:
          await firstPage;
          return json({items:[early],next:"page-2",checkpoint:null});
        case "page-2": return json({items:[late],next:null,checkpoint:"one"});
        case "one": return disconnected ? json({items:[late,live],next:null,checkpoint:"two"}) :
          json({items:[],next:null,checkpoint:"one"});
        default: return json({items:[],next:null,checkpoint:"two"});
      }
    }});
  const original=await radio.listen(realtime,state);
  channel.signal(early.id);
  channel.signal(early.id);
  assert.equal(saved,null);
  block();
  // Wait for the join's initial catch-up and the next window it may overlap.
  await original.catchUp();
  assert.equal(received.filter(id=>id===early.id).length,1);
  assert.equal(received.filter(id=>id===late.id).length,1);
  await original.refresh();
  assert.equal(tokens.length,2);
  assert.notEqual(tokens[0],tokens[1]);
  await original.close();
  disconnected=true;
  const replacement=await radio.listen(realtime,state);
  await replacement.catchUp();
  assert.equal(saved,"two");
  assert.deepEqual(new Set(received),new Set(receipts.keys()));
  assert.equal(received.length,3);
  await replacement.close();
  assert.deepEqual(errors,[]);
});
