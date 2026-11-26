import assert from "node:assert/strict";
import { Client, StreamableHTTPClientTransport } from "npm:@modelcontextprotocol/client@2.4.0";
import * as L from "../dist/index.js";

const fixture=JSON.parse(Deno.env.get("RADIO_MCP_PROBE"));
const {phase,url,allowed,readOnly,noMandate,law,initial,by,markdown}=fixture;
const revision="2026-07-28";
const clientInfo={name:"radio-test-client",version:"1.0.0"};

async function use(token,mode,test) {
  const client=new Client(clientInfo,{versionNegotiation:{mode}});
  const transport=new StreamableHTTPClientTransport(new URL(url),{
    requestInit:{headers:{authorization:"Bearer "+token}}
  });
  try {
    await client.connect(transport);
    assert.equal(client.getServerVersion()?.name,"radio");
    assert.equal(transport.sessionId,undefined);
    if (mode !== "legacy") assert.equal(transport.protocolVersion,revision);
    await test(client,async (name,args) => {
      const result=await client.callTool({name,arguments:args});
      return result.structuredContent;
    });
  } finally { await client.close(); }
}

if (phase==="initial") {
  let receipt;
  await use(allowed,{pin:revision},async (client,call) => {
    const listing=await client.listTools();
    assert.ok(listing.tools.find(tool=>tool.name==="submit_contract").annotations.destructiveHint);
    assert.equal(listing.cacheScope,"public");
    const page=await call("list_process_types",{});
    const shown=await call("describe_process_type",{law});
    assert.ok(page.items.some(item=>item.hash===law));
    assert.equal(shown.entry_run,"open");
    assert.deepEqual(shown.tuple_requirements,shown.law.runs[0].requires);
    assert.equal(await L.hashOf(shown.law),law);
    assert.match(shown.tuple_guidance,/who, did, this, with/);
    const diplomacy=await call("read_diplomacy",{law});
    assert.equal(diplomacy.id,shown.diplomacy);
    assert.deepEqual(diplomacy.skills,[{name:"participant",description:"Draft an example Contract"}]);
    assert.equal((await call("read_diplomacy",{law,skill:"participant"})).markdown,markdown);
    const machine=JSON.parse((await client.readResource({uri:"radio://machine"})).contents[0].text);
    assert.deepEqual(machine.versions,["2"]);
    const first=await call("submit_contract",initial);
    receipt=first.receipt;
    assert.equal(receipt.header.status,"ok");
    assert.equal(receipt.header.run,"open");
    assert.equal(receipt.header.instance,null);
    assert.equal(receipt.header.by,by);
    assert.equal(receipt.header.process_hash,law);
    assert.equal(receipt.header.input_hash,await L.hashOf(initial.tuple));
    assert.equal(first.replayed,false);
    assert.equal(await L.authenticV2(receipt,machine.keys),true);
    assert.deepEqual((await call("read_receipt",{id:receipt.id})).receipt,receipt);
    assert.deepEqual((await call("read_evidence",{id:receipt.id})).tuple,initial.tuple);
    assert.deepEqual(await call("submit_contract",{...initial,tuple:null}),{error:"submission_conflict"});
    const scalar=await call("submit_contract",{tuple:["free",null,false],submission:L.b64url(crypto.getRandomValues(new Uint8Array(16)))});
    assert.equal(scalar.receipt.header.status,"registered");
  });
  await use(readOnly,"legacy",async (_,call) => {
    assert.equal((await call("describe_process_type",{law})).entry_run,"open");
    assert.deepEqual(await call("submit_contract",initial),{error:"forbidden"});
    assert.deepEqual(await call("read_evidence",{id:receipt.id}),{error:"not_found"});
  });
  await use(noMandate,{pin:revision},async (_,call) => {
    assert.deepEqual(await call("list_process_types",{}),{error:"forbidden"});
  });
  console.log(receipt.id);
} else {
  await use(allowed,{pin:revision},async (_,call) => {
    const response=await call("submit_contract",initial);
    if (phase==="revoked") assert.deepEqual(response,{error:"forbidden"});
    else {
      assert.equal(response.replayed,true);
      console.log(response.receipt.id);
    }
  });
}
