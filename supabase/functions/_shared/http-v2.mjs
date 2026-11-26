import * as L from "./core/index.js";
import { bodyText, BodyLimit } from "./body.mjs";
import { hostedEnvironment, isUUID, verifiedUser } from "./http.mjs";
import { HostedError } from "./ledger.mjs";
import { databaseV2, publishV2, readReceiptV2, submitV2 } from "./transactions-v2.mjs";

const requestTimeoutMs = 60_000;
const headers = {
  "content-type":"application/json; charset=utf-8", "cache-control":"no-store", "logline-version":"2",
  vary:"LogLine-Version", "access-control-allow-origin":"*", "access-control-expose-headers":"LogLine-Version"
};
export const v2Response = (status,body) => new Response(JSON.stringify(body),{status,headers});

export function directIdentity(options) {
  const issuer = options.issuer ?? options.url.replace(/\/$/,"") + "/auth/v1";
  return async (request,signal) => {
    const bearer = request.headers.get("authorization") ?? "";
    const token = /^Bearer ([\w.-]+)$/.exec(bearer);
    if (!token || bearer.length > 16384) throw new HostedError(401,"unauthenticated","invalid bearer");
    const user = await verifiedUser(options,bearer,signal);
    // Only inspect claims from the identical token accepted by Supabase Auth.
    let claims;
    try {
      const parts = token[1].split(".");
      if (parts.length !== 3 || !parts.every(Boolean)) throw Error("bad token");
      claims = L.parseStrict(new TextDecoder("utf-8",{fatal:true}).decode(L.unb64url(parts[1])));
    } catch { throw new HostedError(401,"unauthenticated","invalid bearer"); }
    if (claims?.sub !== user.id || claims.iss !== issuer || claims.aud !== "authenticated" ||
        claims.role !== "authenticated" || !Number.isInteger(claims.exp) || claims.exp <= Date.now()/1000)
      throw new HostedError(401,"unauthenticated","invalid verified claims");
    // OAuth mandates need the provider/resource binding tests in PR-12/13.
    if (Object.hasOwn(claims,"client_id") || claims.is_anonymous === true || user.is_anonymous === true)
      throw new HostedError(403,"forbidden","direct sessions only");
    if (!isUUID(claims.session_id)) throw new HostedError(401,"unauthenticated","invalid direct session");
    return {owner:user.id,by:await L.pseudonym(options.pseudonymSecret,user.id)};
  };
}

export function createV2Handler({action,database,key,keys,identify}) {
  const method = action === "receipt" ? "GET" : "POST";
  return async req => {
    if (req.method === "OPTIONS") return new Response(null,{status:204,headers:{
      ...headers,"access-control-allow-methods":method,
      "access-control-allow-headers":"authorization, apikey, content-type, logline-version"
    }});
    if (req.headers.get("logline-version") !== "2") return v2Response(400,{error:"unsupported_version"});
    if (req.method !== method) return v2Response(405,{error:"invalid_request"});
    const signal = AbortSignal.any([req.signal,AbortSignal.timeout(requestTimeoutMs)]);
    try {
      const actor = await identify(req,signal);
      const db = database(actor,signal);
      if (action === "receipt") {
        const params = new URL(req.url).searchParams;
        if (params.size !== 1) return v2Response(400,{error:"invalid_request"});
        return v2Response(200,await readReceiptV2(db,keys,params.get("id")));
      }
      const limit = action === "publish" ? L.MAX_LAW_BYTES : L.MAX_SUBMISSION_BYTES;
      let text, input;
      try {
        text = await bodyText(req,limit,{preserveBOM:true,signal});
        input = action === "publish" ? L.parseProcessType(text) : L.parseSubmissionV2(text);
      } catch (error) {
        if (signal.aborted) return v2Response(503,{error:"unavailable"});
        if (error instanceof BodyLimit || error?.code === "submission_limit")
          return v2Response(413,{error:"resource_limit"});
        return v2Response(400,{error:"invalid_request"});
      }
      if (action === "publish") {
        const result = await publishV2(db,input);
        return v2Response(result.status,result.body);
      }
      const result = await submitV2({db,key,keys,actor,text,request:input});
      return v2Response(result.replayed ? 200 : 201,result);
    } catch (error) {
      if (error instanceof HostedError) {
        if (error.status === 401) return v2Response(401,{error:"unauthenticated"});
        if (error.status >= 500) return v2Response(503,{error:"unavailable"});
        return v2Response(error.status,{error:error.code});
      }
      if (error instanceof L.LoglineError) {
        if (["submission_limit","result_limit","evidence_limit","scan_limit"].includes(error.code))
          return v2Response(413,{error:"resource_limit"});
      }
      return v2Response(503,{error:"unavailable"});
    }
  };
}

export async function fromEnvironmentV2(action,env) {
  if (env("RADIO_ENABLE_V2") !== "true") throw Error("RADIO v2 is disabled");
  const settings = await hostedEnvironment(env);
  const {key} = settings;
  return createV2Handler({
    action,key,keys:{[key.id]:{jwk:key.public}},
    database:databaseV2(settings),identify:directIdentity({...settings,issuer:env("RADIO_AUTH_ISSUER")})
  });
}
