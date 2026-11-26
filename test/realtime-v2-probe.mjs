// Native Supabase Realtime socket test. Each socket keeps explicit JWTs so the
// server, independently of any SDK refresh or disconnect, must enforce leases.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { sql, q } from "./postgres-harness.mjs";
import { authenticV2, tuned } from "../dist/index.js";

const topic = "radio:v2:receipts";
const channel = "realtime:" + topic;
const admin = statement => sql(statement,"postgres");
const epoch = () => Math.floor(Date.now()/1000);

async function waitFor(pred, description, timeout = 8000) {
  const deadline = Date.now()+timeout;
  while (Date.now() < deadline) {
    const result = pred();
    if (result) return result;
    await delay(25);
  }
  throw Error("Timed out waiting for " + description);
}

export async function probeRealtime({issuer,principal,keys,mint,commit,readReceipt}) {
  const endpoint = new URL(process.env.RADIO_TEST_REALTIME_URL);
  if (endpoint.protocol !== "ws:" || !["127.0.0.1","localhost","[::1]"].includes(endpoint.hostname))
    throw Error("Use a disposable loopback Realtime endpoint");
  endpoint.searchParams.set("vsn","2.0.0");
  const sockets = [];
  let ref = 0;
  async function open(token) {
    const url = new URL(endpoint);
    url.searchParams.set("apikey",token);
    const socket = new WebSocket(url);
    socket.binaryType = "arraybuffer";
    const messages = [];
    socket.addEventListener("message",ev => {
      if (typeof ev.data === "string") messages.push(JSON.parse(ev.data));
      else {
        // Realtime protocol 2.0 can frame JSON Broadcast messages as binary.
        const bytes = Buffer.from(ev.data);
        const [kind,topicSize,eventSize,metaSize,encoding] = bytes;
        assert.equal(kind,4);
        assert.equal(encoding,1);
        const eventStart = 5+topicSize;
        const eventEnd = eventStart+eventSize;
        messages.push([null,null,bytes.toString("utf8",5,eventStart),"broadcast",{
          event:bytes.toString("utf8",eventStart,eventEnd),
          payload:JSON.parse(bytes.toString("utf8",eventEnd+metaSize))
        }]);
      }
    });
    sockets.push(socket);
    await waitFor(() => socket.readyState === WebSocket.OPEN,"an open WebSocket");
    const joinRef = String(++ref);
    const send = (event,payload) => {
      const request = event === "phx_join" ? joinRef : String(++ref);
      socket.send(JSON.stringify([joinRef,request,channel,event,payload]));
      return request;
    };
    const reply = request => waitFor(() => messages.find(x=>x[1]===request&&x[3]==="phx_reply"),
      "the Realtime reply").then(x=>x[4].status);
    const sendJoin = send("phx_join",{access_token:token,config:{
      private:true,broadcast:{ack:true,self:false},presence:{enabled:false},postgres_changes:[]
    }});
    const joined = await reply(sendJoin);
    const signals = () => messages.filter(x=>x[3]==="broadcast"&&x[4]?.event==="receipt").map(x=>x[4].payload);
    return {
      joined,send,reply,signals,
      waitSignal: id => waitFor(()=>signals().find(signal=>signal.id===id),"the committed receipt signal"),
      waitClosed: () => waitFor(()=>socket.readyState>=WebSocket.CLOSING||
        messages.find(x=>x[3]==="phx_close"||x[3]==="phx_error"),"the server closing the lease",12000)
    };
  }

  const reader = randomUUID();
  const expires = epoch()+10;
  const excluded = randomUUID();
  try {
    await admin("insert into radio_v2.broadcast_settings(issuer) values (" + q(issuer) +
      ") on conflict (singleton) do update set issuer=excluded.issuer;");
    await admin("insert into radio_v2.authority(principal,pseudonym,active,permissions,mandates) values (" +
      q(reader)+","+q("test-"+reader)+",true,array['read_public'],'{\"direct\":[\"read_public\"]}');");
    const [writerListener,readerListener,refreshListener,denied] = await Promise.all([
      open(mint(principal,epoch()+120)),open(mint(reader,expires)),
      open(mint(reader,epoch()+120)),open(mint(excluded,epoch()+120))
    ]);
    for (const participant of [writerListener,readerListener,refreshListener])
      assert.equal(participant.joined,"ok");
    assert.equal(denied.joined,"error");

    const receipt = await commit("broadcast");
    assert.deepEqual(await writerListener.waitSignal(receipt.id),{id:receipt.id});
    assert.deepEqual(await readerListener.waitSignal(receipt.id),{id:receipt.id});
    const resolved = await readReceipt(receipt.id);
    assert.deepEqual(resolved,{status:200,body:{receipt}});
    assert.equal(await authenticV2(resolved.body.receipt,keys),true);
    assert.equal(tuned({frequency:receipt.header.frequency,status:"ok",activated:true},receipt.header),true);
    assert.equal(tuned({frequency:"_unaddressed"},receipt.header),false);

    const rolledBack = "sha256:"+"a".repeat(64);
    await admin("begin; insert into radio_v2.receipts select "+q(rolledBack)+",receipt from radio_v2.receipts where id="+
      q(receipt.id)+"; rollback;");
    const forged = "sha256:"+"b".repeat(64);
    const sendRequest = writerListener.send("broadcast",{event:"receipt",type:"broadcast",payload:{id:forged}});
    assert.equal(await writerListener.reply(sendRequest),"error");

    await admin("update radio_v2.authority set active=false where principal="+q(reader)+";");
    refreshListener.send("access_token",{access_token:mint(reader,epoch()+120)});
    await refreshListener.waitClosed();
    await readerListener.waitClosed();

    const after = await commit("after revocation");
    assert.deepEqual(await writerListener.waitSignal(after.id),{id:after.id});
    assert.deepEqual(denied.signals(),[]);
    assert.ok(!writerListener.signals().some(signal=>[rolledBack,forged].includes(signal.id)));
    for (const revoked of [readerListener,refreshListener])
      assert.ok(!revoked.signals().some(signal=>signal.id===after.id));
    console.log("Native Realtime: committed private receipt IDs, two listeners, verified lookup, denied send/join, rollback, refresh and expiry revocation passed.");
  } finally {
    for (const socket of sockets) socket.close();
    await admin("delete from radio_v2.broadcast_settings;");
  }
}
