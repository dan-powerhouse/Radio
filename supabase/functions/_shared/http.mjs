import * as L from "./core/index.js";
import { HostedError, submitRoot } from "./ledger.mjs";
import { database } from "./postgrest.mjs";

const headers = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "logline-version": "1", vary: "LogLine-Version", "access-control-allow-origin": "*", "access-control-expose-headers": "LogLine-Version" };
const response = (status, body) => new Response(JSON.stringify(body), { status, headers });
export async function readTuple(req, max = 65536) {
  const reader = req.body?.getReader();
  if (!reader) throw new HostedError(400, "ijson", "expected a JSON body");
  let size = 0, text = "";
  const decoder = new TextDecoder("utf-8", { fatal: true });
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) throw new HostedError(413, "too_large", `the body is over ${max} bytes`);
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } catch (e) {
    await reader.cancel().catch(() => {});
    if (e instanceof HostedError) throw e;
    throw new HostedError(400, "ijson", "the body is not valid UTF-8");
  } finally { reader.releaseLock(); }
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

// Validate bearer tokens at Supabase Auth, never trust decoded client claims.
export function auth({ url, publishableKey, pseudonymSecret, fetcher = fetch }) {
  return async req => {
    const authorization = req.headers.get("authorization");
    if (authorization === null) return null;
    if (!/^Bearer \S+$/.test(authorization)) throw new HostedError(401, "token", "expected a bearer token");
    const r = await fetcher(url.replace(/\/$/, "") + "/auth/v1/user", { headers: { apikey: publishableKey, authorization } });
    if (r.status === 401 || r.status === 403 || r.status === 400) throw new HostedError(401, "token", "invalid bearer token");
    if (!r.ok) throw new HostedError(503, "auth", "identity provider unavailable");
    const u = await r.json();
    if (typeof u.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(u.id)) throw new HostedError(401, "token", "no verified account");
    return { owner: u.id, by: await L.pseudonym(pseudonymSecret, u.id), admin: u.app_metadata?.logline_admin === true };
  };
}

export async function fromEnvironment(action, env) {
  const required = name => { const value = env(name); if (!value) throw new Error(`missing ${name}`); return value; };
  if (env("LOGLINE_ENABLE_PREVIEW") !== "true") throw new Error("hosted root preview is disabled; see supabase/README.md");
  const url = required("SUPABASE_URL");
  const serviceKey = env("LOGLINE_SERVICE_KEY") ?? required("SUPABASE_SERVICE_ROLE_KEY");
  const publishableKey = env("LOGLINE_PUBLISHABLE_KEY") ?? required("SUPABASE_ANON_KEY");
  const key = await L.importMachineKey(JSON.parse(required("LOGLINE_MACHINE_JWK")));
  const pseudonymSecret = L.unb64url(required("LOGLINE_PSEUDONYM_SECRET"));
  if (pseudonymSecret.length < 32) throw new Error("pseudonym secret must be at least 32 bytes");
  const keys = { [key.id]: { jwk: key.public } };
  return createHandler({ action, db: database({ url, serviceKey }), key, keys, identify: auth({ url, publishableKey, pseudonymSecret }) });
}
