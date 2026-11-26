import * as L from "./core/index.js";
import { HostedError, submitRoot } from "./ledger.mjs";
import { database } from "./postgrest.mjs";
import { BodyLimit, bodyText } from "./body.mjs";

const headers = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "logline-version": "1", vary: "LogLine-Version", "access-control-allow-origin": "*", "access-control-expose-headers": "LogLine-Version" };
const response = (status, body) => new Response(JSON.stringify(body), { status, headers });
export async function readTuple(req, max = 65536) {
  if (!req.body) throw new HostedError(400, "ijson", "expected a JSON body");
  let text;
  try { text = await bodyText(req, max); }
  catch (error) {
    if (error instanceof BodyLimit) throw new HostedError(413, "too_large", `the body is over ${max} bytes`);
    throw new HostedError(400, "ijson", "the body is not valid UTF-8");
  }
  return L.parseStrict(text);
}

export function createHandler({ action, db, key, keys, identify }) {
  return async req => {
    try {
      if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...headers, "access-control-allow-methods": "POST", "access-control-allow-headers": "authorization, apikey, content-type, logline-version" } });
      if (req.method !== "POST") return response(405, { error: "method", message: "use POST" });
      const requested = req.headers.get("logline-version") ?? "1";
      if (requested !== "1") return response(400, { error: "version", message: "unsupported LogLine-Version", supported: ["1"], requested });
      const who = await identify(req);
      if (action === "publish" && !who?.admin) throw new HostedError(who ? 403 : 401, "forbidden", "publishing a process needs an admin token");
      const tuple = await readTuple(req);
      if (action === "publish") return response(201, await db.publish(tuple));
      const r = await submitRoot({ db, key, keys, tuple, owner: who?.owner ?? null, by: who?.by ?? null });
      return response(r.replayed ? 200 : 201, r);
    } catch (e) {
      if (e instanceof HostedError) return response(e.status, { error: e.code, message: e.message });
      if (e instanceof L.LoglineError) return response(400, { error: e.code, message: e.message });
      console.error("LogLine request failed", e?.name ?? "Error");
      return response(503, { error: "unavailable", message: "the machine could not complete the request; retry" });
    }
  };
}

// Supabase Auth validates the exact bearer before an adapter uses its account.
export async function verifiedUser({ url, publishableKey, fetcher = fetch }, authorization, signal) {
  if (!/^Bearer \S+$/.test(authorization)) throw new HostedError(401, "token", "expected a bearer token");
  const r = await fetcher(url.replace(/\/$/, "") + "/auth/v1/user", {
    headers: { apikey: publishableKey, authorization }, signal
  });
  if ([400,401,403].includes(r.status)) throw new HostedError(401, "token", "invalid bearer token");
  if (!r.ok) throw new HostedError(503, "auth", "identity provider unavailable");
  const u = signal ? JSON.parse(await bodyText(r,1_048_576,{signal})) : await r.json();
  if (!isUUID(u.id)) throw new HostedError(401, "token", "no verified account");
  return u;
}

export const isUUID = value => typeof value === "string" && value.length === 36 &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export function auth(options) {
  return async req => {
    const authorization = req.headers.get("authorization");
    if (authorization === null) return null;
    const u = await verifiedUser(options, authorization);
    return { owner: u.id, by: await L.pseudonym(options.pseudonymSecret, u.id), admin: u.app_metadata?.logline_admin === true };
  };
}

export async function hostedEnvironment(env) {
  const required = name => { const value = env(name); if (!value) throw new Error(`missing ${name}`); return value; };
  const url = required("SUPABASE_URL");
  const serviceKey = env("LOGLINE_SERVICE_KEY") ?? required("SUPABASE_SERVICE_ROLE_KEY");
  const publishableKey = env("LOGLINE_PUBLISHABLE_KEY") ?? required("SUPABASE_ANON_KEY");
  const key = await L.importMachineKey(JSON.parse(required("LOGLINE_MACHINE_JWK")));
  const pseudonymSecret = L.unb64url(required("LOGLINE_PSEUDONYM_SECRET"));
  if (pseudonymSecret.length < 32) throw new Error("pseudonym secret must be at least 32 bytes");
  return {url,serviceKey,publishableKey,key,pseudonymSecret};
}

export async function fromEnvironment(action, env) {
  if (env("LOGLINE_ENABLE_PREVIEW") !== "true") throw new Error("hosted root preview is disabled; see supabase/README.md");
  const {url,serviceKey,publishableKey,key,pseudonymSecret} = await hostedEnvironment(env);
  const keys = { [key.id]: { jwk: key.public } };
  return createHandler({ action, db: database({ url, serviceKey }), key, keys, identify: auth({ url, publishableKey, pseudonymSecret }) });
}
