import { hashOf, HASH_RE } from "./hash.js";
import { canonicalize } from "./jcs.js";
import { KeyRing, verifyId } from "./keys.js";
import { Process } from "./process.js";
import { run, Receipt, Detail, Store, WHEN_RE } from "./receipt.js";

export type CheckCode = "shape" | "id" | "key" | "key_window" | "signature" | "detail" | "input" | "process" | "replay";
export interface Check { code: CheckCode; result: "pass" | "fail" | "skipped"; note: string }
export interface Verdict { valid: boolean; checks: Check[] }
export interface Evidence { detail?: Detail; tuple?: unknown; process?: Process | null; store?: Store }

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * Verify a receipt without trusting the issuer. With only the receipt and the
 * published keys it proves the header is authentic. With the detail, tuple and
 * process (fetched by hash) it also re-runs the decision.
 * `valid` is true only if nothing failed and the header is authentic.
 */
export async function verify(receipt: unknown, keys: KeyRing, ev: Evidence = {}): Promise<Verdict> {
  const checks: Check[] = [];
  const add = (code: CheckCode, ok: boolean | null, note: string) => checks.push({ code, result: ok === null ? "skipped" : ok ? "pass" : "fail", note });
  const done = () => ({ valid: checks.every((c) => c.result !== "fail") && ["id", "key", "signature"].every((c) => checks.some((k) => k.code === c && k.result === "pass")), checks });

  const r = receipt as Receipt;
  const shapeOk = isObj(r) && isObj(r.header) && typeof r.id === "string" && HASH_RE.test(r.id) && isObj(r.sig) &&
    r.sig.alg === "Ed25519" && typeof r.sig.key === "string" && typeof r.sig.value === "string" &&
    r.header.logline === "receipt@1" && typeof r.header.when === "string" && WHEN_RE.test(r.header.when);
  add("shape", shapeOk, shapeOk ? "receipt@1 structure" : "not a receipt@1");
  if (!shapeOk) return done();
  try { canonicalize(r); } catch { add("shape", false, "not canonicalizable JSON"); return done(); }

  add("id", (await hashOf(r.header)) === r.id, "the id is the hash of the header");
  const k = keys[r.sig.key];
  add("key", !!k, k ? `signed by published key ${r.sig.key.slice(0, 19)}…` : "the signing key is not published");
  if (k) {
    const inWindow = (!k.not_before || r.header.when >= k.not_before) && (!k.not_after || r.header.when <= k.not_after);
    add("key_window", inWindow, inWindow ? "issued while the key was valid" : "issued outside the key's validity window");
    add("signature", await verifyId(k.jwk, r.id, r.sig.value), "Ed25519 signature over the id");
  } else add("signature", false, "no key to check against");

  if (ev.detail !== undefined) add("detail", (await safeHash(ev.detail)) === r.header.detail_hash, "the detail matches detail_hash");
  else add("detail", null, "detail not provided");
  if (ev.tuple !== undefined) add("input", (await safeHash(ev.tuple)) === r.header.input_hash, "the tuple matches input_hash");
  else add("input", null, "tuple not provided");
  if (ev.process !== undefined)
    add("process", ev.process === null ? r.header.process_hash === null : (await safeHash(ev.process)) === r.header.process_hash, "the process matches process_hash");
  else add("process", null, "process not provided");

  if (ev.tuple !== undefined && ev.process !== undefined) {
    let same = false;
    try {
      const again = await run(ev.process, ev.tuple, { when: r.header.when, by: r.header.by, prev: r.header.prev, spent: r.header.spent, depth: r.header.depth, store: ev.store, keys });
      same = canonicalize(again.header) === canonicalize(r.header) && again.id === r.id && (ev.detail === undefined || canonicalize(again.detail) === canonicalize(ev.detail));
    } catch { same = false; }
    add("replay", same, "running the tuple on the process again gives the same receipt");
  } else add("replay", null, "needs the tuple and the process");
  return done();
}

async function safeHash(v: unknown) { try { return await hashOf(v); } catch { return null; } }
