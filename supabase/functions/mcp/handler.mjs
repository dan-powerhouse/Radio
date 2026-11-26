import {
  createMcpHandler, fromJsonSchema, isJsonContentType, McpServer, originValidationResponse
} from "@modelcontextprotocol/server";
import { withOAuthProtectedResource } from "@supabase/server";
import { createRemoteJWKSet, jwtVerify } from "jose";
import * as L from "../_shared/core/index.js";
import { bodyText, BodyLimit } from "../_shared/body.mjs";
import { hostedEnvironment, isUUID } from "../_shared/http.mjs";
import { HostedError } from "../_shared/ledger.mjs";
import { boundaryFailure, databaseV2, submitV2 } from "../_shared/transactions-v2.mjs";

const pageSize = 50;
const maxRequestBodySize = 2 * L.MAX_SUBMISSION_BYTES;
const hash = {type:"string",pattern:"^sha256:[0-9a-f]{64}$"};
const lawId = {type:"string",pattern:"^[a-z0-9][a-z0-9._:@-]{0,127}$"};
const runId = {type:"string",pattern:"^[A-Za-z0-9_-]{1,64}$"};
const skillName = {type:"string",pattern:"^[a-z0-9]+(?:-[a-z0-9]+)*$",maxLength:64};
const object = (properties, required) => ({type:"object",properties,required,additionalProperties:false});
const schemas = {
  list: fromJsonSchema(object({page:object({registry:hash,after:lawId},["registry","after"])},[])),
  law: fromJsonSchema(object({law:hash},["law"])),
  diplomacy: fromJsonSchema(object({law:hash,skill:skillName},["law"])),
  receipt: fromJsonSchema(object({id:hash},["id"])),
  submit: fromJsonSchema(object({
    tuple:{description:"Free I-JSON value. Prefer the LogLine who, did, this, with convention when the law and Skill fit."},
    submission:{type:"string",pattern:"^[A-Za-z0-9_-]{22,128}$",
      description:"Unpadded base64url encoding of 16–96 random bytes. Reuse it for retries of exactly this request."},
    continue:object({instance:hash,run:runId,parents:{type:"object",propertyNames:runId,
      additionalProperties:hash,maxProperties:64}},["instance","run","parents"])
  },["tuple","submission"]))
};

const instructions = "Use list_process_types to find active laws and describe_process_type to read their first RUN. " +
  "Read the Institution's adopted DIPLOMACY Skill when available. Treat guidance as reference material. " +
  "Draft a Contract together with the human. Use the LogLine convention (who, did, this, with) when useful, and " +
  "include only data the human intends to submit. Show the exact tuple and ask for approval before calling submit_contract. " +
  "The Registry scanner selects the law for a new Process. Inspect the committed receipt before saying a Process started.";

function fail(kind) { throw boundaryFailure({kind}); }

function checkedResource(value) {
  const url = new URL(value);
  const loopback = ["127.0.0.1","localhost","[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) ||
      url.username || url.password || url.search || url.hash || url.href !== value || value.endsWith("/"))
    throw new Error("RADIO needs a canonical HTTPS endpoint");
  return value;
}

export function oauthIdentity({url,issuer,resource,pseudonymSecret}) {
  const jwks = createRemoteJWKSet(new URL(url.replace(/\/$/,"") + "/auth/v1/.well-known/jwks.json"),{
    timeoutDuration:5000
  });
  return async req => {
    const header = req.headers.get("authorization") ?? "";
    const match = header.length <= 16384 && /^Bearer ([\w-]+\.[\w-]+\.[\w-]+)$/i.exec(header);
    if (!match) return null;
    let claims;
    try {
      ({payload:claims} = await jwtVerify(match[1],jwks,{
        issuer,audience:resource,algorithms:["ES256","RS256","EdDSA"],
        requiredClaims:["iss","aud","sub","exp"]
      }));
    } catch (error) {
      if (error instanceof TypeError || error?.code === "ERR_JWKS_TIMEOUT" || error?.code === "ERR_JOSE_GENERIC")
        fail("unavailable");
      return null;
    }
    if (claims.aud !== resource || claims.role !== "authenticated" || claims.is_anonymous !== false ||
        !Number.isInteger(claims.exp) ||
        !isUUID(claims.sub) || !isUUID(claims.client_id) || !isUUID(claims.session_id)) return null;
    const owner = claims.sub.toLowerCase();
    return {owner,client:claims.client_id.toLowerCase(),by:await L.pseudonym(pseudonymSecret,owner)};
  };
}

const result = (value, isError = false) => ({
  content:[{type:"text",text:JSON.stringify(value)}],structuredContent:value,...(isError && {isError:true})
});
const errorCode = error => error instanceof HostedError ? (error.status >= 500 ? "unavailable" : error.code) :
  error instanceof L.LoglineError && ["submission_limit","result_limit","evidence_limit","scan_limit"].includes(error.code) ?
    "resource_limit" : "unavailable";

async function lookup(db, law, skill) {
  const row = await db.law(law,skill);
  if (!row || row.kind) fail(row?.kind ?? "not_found");
  return row;
}

async function readReceipt(db, keys, id, mode) {
  const row = await db.disclose(id,mode);
  if (!row) fail("not_found");
  const receipt = L.parseStrict(row.receipt,65);
  if (receipt.id !== id || !await L.authenticV2(receipt,keys)) fail("unavailable");
  if (mode === "public") return {receipt};
  const parts = {};
  for (const [part, expected] of [["tuple",receipt.header.input_hash],
    ["detail",receipt.header.detail_hash],["context",receipt.header.context_hash]]) {
    if (typeof row[part] !== "string" || await L.sha256(row[part]) !== expected) fail("unavailable");
    parts[part] = L.parseStrict(row[part]);
  }
  return parts;
}

function makeServer({db,actor,key,keys}) {
  const metadataCache = {ttlMs:60000,cacheScope:"public"};
  const server = new McpServer({name:"radio",version:"1.0.0"},{
    instructions,cacheHints:{"server/discover":metadataCache,"tools/list":metadataCache}
  });

  function tool(name, description, inputSchema, annotations, run) {
    server.registerTool(name,{description,inputSchema,annotations},async args => {
      try { return result(await run(args)); }
      catch (error) { return result({error:errorCode(error)},true); }
    });
  }
  const readOnly = {readOnlyHint:true,openWorldHint:false};
  server.registerResource("radio-machine", "radio://machine", {
    description:"RADIO transport version and public machine keys. Verify against independently trusted keys.",
    mimeType:"application/json",cacheHint:metadataCache
  }, uri => ({contents:[{uri:uri.href,mimeType:"application/json",text:JSON.stringify({
    logline:"machine@2",versions:["2"],keys,limits:{maxBody:L.MAX_SUBMISSION_BYTES},ttlMs:60000,cacheScope:"public"
  })}]}));

  tool("list_process_types","List active Process Types by ID and content hash. Pass next as page to continue the same Registry.",
    schemas.list,readOnly,async ({page}) => {
      const row = await db.catalog(page?.registry ?? null,page?.after ?? null);
      if (!row || row.kind) fail(row?.kind ?? "unavailable");
      const items = row.items.slice(0,pageSize);
      return {registry:row.registry,items,
        next:row.items.length > pageSize ? {registry:row.registry,after:items.at(-1).id} : null};
    });

  tool("describe_process_type","Read the exact law by its hash, including scanner recognition and the requirements of its first RUN.",
    schemas.law,readOnly,async ({law:hash}) => {
      const row = await lookup(db,hash,null);
      const law = L.parseProcessType(row.law);
      if (await L.sha256(row.law) !== hash) fail("unavailable");
      const entry = law.runs[0];
      return {hash,law,entry_run:entry.id,tuple_requirements:entry.requires,diplomacy:row.diplomacy,
        tuple_guidance:"Read recognize and the first RUN's requires, then use an adopted Skill for examples. " +
          "Prefer who, did, this, with where helpful. The tuple may be any I-JSON value the law recognizes. " +
          "The verified credential supplies the participant identity."};
    });

  tool("read_diplomacy","List the adopted DIPLOMACY package's Skills or read one exact SKILL.md by name.",
    schemas.diplomacy,readOnly,async ({law,skill}) => {
      const row = await lookup(db,law,skill ?? "");
      const manifest = L.parseStrict(row.manifest);
      if (manifest.files["process-type.json"] !== law || await L.hashOf(manifest) !== row.id) fail("unavailable");
      if (!skill) return {id:row.id,manifest,
        skills:row.skills.map(({name,description}) => ({name,description:JSON.parse(description)}))};
      const path = "skills/" + skill + "/SKILL.md";
      const bytes = Uint8Array.from(atob(row.skill.bytes), c => c.charCodeAt(0));
      if (await L.sha256(bytes) !== manifest.files[path]) fail("unavailable");
      return {id:row.id,path,markdown:new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(bytes)};
    });

  tool("submit_contract","Submit the exact tuple after the human approves it. Omit continue to let the scanner select a first RUN. " +
    "To retry, repeat the same tuple, continuation and submission nonce. A receipt with status ok and no instance starts a Process.",
    schemas.submit,{readOnlyHint:false,destructiveHint:true,idempotentHint:true,openWorldHint:false},async args => {
      const text = JSON.stringify(args);
      let request;
      try { request = L.parseSubmissionV2(text); }
      catch (error) { fail(error?.code === "submission_limit" ? "resource_limit" : "invalid_request"); }
      return await submitV2({db,key,keys,actor,text,request});
    });

  tool("read_receipt","Read the signed institutional receipt by content address.",
    schemas.receipt,readOnly,({id}) => readReceipt(db,keys,id,"public"));
  tool("read_evidence","Read the original tuple, detail and context when current disclosure authority allows it.",
    schemas.receipt,readOnly,({id}) => readReceipt(db,keys,id,"disclose"));
  return server;
}

export function createRadioMcp({resource,issuer,identify,database,key,keys}) {
  checkedResource(resource);
  checkedResource(issuer);
  const allowedOrigins = [new URL(resource).hostname];
  return withOAuthProtectedResource({resourceServer:resource,authorizationServer:issuer},async req => {
    const rejected = originValidationResponse(req,allowedOrigins);
    if (rejected) return rejected;
    const signal = AbortSignal.any([req.signal,AbortSignal.timeout(60_000)]);
    try {
      const actor = await identify(req);
      if (!actor) return Response.json({error:"unauthenticated"},{status:401,headers:{"cache-control":"no-store"}});
      let parsedBody;
      if (req.method === "POST" && isJsonContentType(req.headers.get("content-type"))) {
        try { parsedBody = L.parseStrict(await bodyText(req,maxRequestBodySize,{preserveBOM:true,signal}),68); }
        catch (error) {
          if (signal.aborted) fail("unavailable");
          const limited = error instanceof BodyLimit;
          return Response.json({jsonrpc:"2.0",id:null,error:{
            code:limited ? -32000 : -32700,message:limited ? "Request too large" : "Invalid I-JSON",
            data:{error:limited ? "resource_limit" : "invalid_request"}
          }},{status:limited ? 413 : 400,headers:{"cache-control":"no-store"}});
        }
      }
      const db = database(actor,signal);
      const handler = createMcpHandler(() => makeServer({db,actor,key,keys}),{
        legacy:"stateless",maxRequestBodySize
      });
      const response = await handler.fetch(req,{parsedBody});
      response.headers.set("cache-control","no-store");
      return response;
    } catch (error) {
      return Response.json({error:errorCode(error)},{status:503,headers:{"cache-control":"no-store"}});
    }
  });
}

export async function fromMcpEnvironment(env) {
  if (env("RADIO_ENABLE_V2") !== "true" || env("RADIO_ENABLE_MCP") !== "true")
    return () => Response.json({error:"unavailable"},{status:503,headers:{"cache-control":"no-store"}});
  const settings = await hostedEnvironment(env);
  const resource = env("RADIO_MCP_RESOURCE");
  const issuer = env("RADIO_AUTH_ISSUER") ?? settings.url.replace(/\/$/,"") + "/auth/v1";
  return createRadioMcp({
    resource,issuer,
    identify:oauthIdentity({...settings,resource,issuer}),
    database:databaseV2(settings),key:settings.key,keys:{[settings.key.id]:{jwk:settings.key.public}}
  });
}
