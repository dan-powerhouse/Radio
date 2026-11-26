// Intended for an explicitly approved disposable Supabase project.
// Starts a loopback OAuth client. Credentials and tokens stay out of logs.
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { once } from "node:events";
import { createInterface } from "node:readline/promises";

if (process.env.RADIO_HOSTED_DISPOSABLE !== "yes") throw Error("Select an approved disposable project");
const project = new URL(process.env.RADIO_HOSTED_ORIGIN);
const issuer = project.origin + "/auth/v1";
const client = process.env.RADIO_HOSTED_CLIENT;
const denialClient = process.env.RADIO_HOSTED_DENIAL_CLIENT;
const publishable = process.env.RADIO_HOSTED_PUBLISHABLE_KEY;
const clientId = value => /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value ?? "");
assert.equal(project.href,project.origin + "/");
assert.equal(project.protocol,"https:");
assert.equal(project.username + project.password,"");
assert.ok(clientId(client) && clientId(denialClient) && client !== denialClient);
assert.ok(publishable?.startsWith("sb_publishable_"));
const port = Number(process.env.RADIO_HOSTED_CALLBACK_PORT ?? 8789);
assert.ok(Number.isInteger(port) && port > 1023 && port < 65536);
const callback = `http://127.0.0.1:${port}/callback`;
const resource = project.origin + "/functions/v1/mcp";
const net = (url,options) => fetch(url,{...options,redirect:"error",signal:AbortSignal.timeout(15000)});
const metadata = await net(project.origin + "/.well-known/oauth-authorization-server/auth/v1");
assert.ok(metadata.ok,"native authorization server metadata is unavailable");
const oauth = await metadata.json();
assert.equal(oauth.issuer,issuer);
assert.equal(oauth.authorization_endpoint,issuer + "/oauth/authorize");
assert.equal(oauth.token_endpoint,issuer + "/oauth/token");

let transaction;
const server = createServer((req,res) => {
  const url = new URL(req.url,callback);
  if (req.method !== "GET" || url.pathname !== "/callback" || !transaction ||
      url.searchParams.get("state") !== transaction.state) {
    res.writeHead(400,{"cache-control":"no-store"});
    res.end("Unexpected callback");
    return;
  }
  res.writeHead(200,{"cache-control":"no-store","content-type":"text/plain"});
  res.end("Callback received. Return to the RADIO qualification terminal.");
  transaction.complete(url.searchParams);
});
const terminal = createInterface({input:process.stdin,output:process.stdout});
server.listen(port,"127.0.0.1");

async function authorize(message, clientId, target) {
  const verifier = randomBytes(32).toString("base64url");
  const state = randomBytes(24).toString("base64url");
  const url = new URL(oauth.authorization_endpoint);
  url.search = new URLSearchParams({client_id:clientId,redirect_uri:callback,state,response_type:"code",
    code_challenge_method:"S256",code_challenge:createHash("sha256").update(verifier).digest("base64url"),
    resource:target}).toString();
  let timer;
  try {
    const result = new Promise((resolve,reject) => {
      transaction = {state,complete:resolve};
      timer = setTimeout(() => reject(Error("No verified callback within the acceptance interval")),180_000);
    });
    console.log(message + "\n" + url.href);
    return {callback:await result,verifier};
  } finally {
    clearTimeout(timer);
    transaction = undefined;
  }
}
function exchange(fields) {
  return net(oauth.token_endpoint,{method:"POST",body:new URLSearchParams(fields)});
}
function codeFields(grant, clientId, verifier=grant.verifier) {
  const code = grant.callback.get("code");
  assert.ok(code,"the approved grant did not return an authorization code");
  return {grant_type:"authorization_code",client_id:clientId,redirect_uri:callback,code,code_verifier:verifier};
}
function discover(bearer) {
  return net(resource,{method:"POST",headers:{apikey:publishable,authorization:"Bearer " + bearer,
    "content-type":"application/json"},body:"{}"});
}
async function currentCatalog(bearer) {
  const {Client,StreamableHTTPClientTransport} = await import("npm:@modelcontextprotocol/client@2.4.0");
  const sdk = new Client({name:"radio-hosted-qualification",version:"1.0.0"},
    {versionNegotiation:{mode:{pin:"2026-07-28"}}});
  try {
    await sdk.connect(new StreamableHTTPClientTransport(new URL(resource),{
      requestInit:{headers:{apikey:publishable,authorization:"Bearer " + bearer}}
    }));
    const response = await sdk.callTool({name:"list_process_types",arguments:{}});
    assert.ok(response.structuredContent,"MCP did not return a structured result");
    return response.structuredContent;
  } finally {
    await sdk.close();
  }
}
function claims(access) {
  const value = JSON.parse(Buffer.from(access.split(".")[1],"base64url").toString("utf8"));
  assert.equal(value.iss,issuer);
  assert.equal(value.aud,resource);
  assert.equal(value.client_id,client);
  assert.ok(value.sub && value.exp > Date.now()/1000);
  return value;
}

try {
  await once(server,"listening");
  const denied = await authorize("Open this URL and choose Deny in the consent page.",denialClient,resource);
  assert.equal(denied.callback.get("error"),"access_denied");
  const grant = await authorize("Open this URL and authorize the read-only test client.",client,resource);
  assert.ok(!(await exchange(codeFields(grant,client,randomBytes(32).toString("base64url")))).ok,
    "native token exchange accepted an incorrect PKCE verifier");
  const valid = await authorize("Open this URL and complete the authorized PKCE flow.",client,resource);
  const issued = await exchange(codeFields(valid,client));
  assert.ok(issued.ok,"native token exchange rejected the approved PKCE flow");
  const initial = await issued.json();
  const identity = claims(initial.access_token);
  assert.ok(Array.isArray((await currentCatalog(initial.access_token)).items));
  const refreshed = await exchange({grant_type:"refresh_token",client_id:client,refresh_token:initial.refresh_token});
  assert.ok(refreshed.ok,"native Auth rejected refresh");
  const fresh = await refreshed.json();
  const refreshedIdentity = claims(fresh.access_token);
  assert.equal(refreshedIdentity.sub,identity.sub);
  assert.ok(Array.isArray((await currentCatalog(fresh.access_token)).items));

  const wrong = project.origin + "/functions/v1/another-resource";
  console.log("Try authorizing the same client with a different resource. An issuer-side rejection may occur before redirect.");
  let foreign;
  try { foreign = await authorize("Open the wrong-resource test and attempt to authorize it.",client,wrong); }
  catch { throw Error("Wrong-resource flow needs a recorded native denial before the callback to close this gate"); }
  if (foreign.callback.has("code")) {
    const foreignToken = await exchange(codeFields(foreign,client));
    if (foreignToken.ok) {
      const unbound = await foreignToken.json();
      assert.equal((await discover(unbound.access_token)).status,401,
        "grant for another resource obtained a credential accepted by RADIO");
    }
  } else assert.ok(foreign.callback.has("error"),"no evidence of wrong-resource denial");

  await terminal.question("Remove the test client's read_public mandate in the disposable project, then press Enter. ");
  assert.deepEqual(await currentCatalog(fresh.access_token),{error:"forbidden"});
  const expiry = refreshedIdentity.exp;
  const remaining = expiry * 1000 - Date.now();
  assert.ok(remaining <= 300_000,"set the test project's access-token lifetime to at most 300 seconds");
  if (remaining > 0) await new Promise(resolve=>setTimeout(resolve,remaining + 1000));
  assert.equal((await discover(fresh.access_token)).status,401);
  console.log("Hosted native OAuth denial, PKCE, resource binding, refresh, mandate revocation and expiry passed.");
} finally {
  terminal.close();
  server.close();
}
