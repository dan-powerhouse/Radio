import { hashOf, HASH_RE } from "./hash.js";
import { KeyRing, verifyId } from "./keys.js";

const isObj = (v: unknown): v is Record<string, any> => v !== null && typeof v === "object" && !Array.isArray(v);

/** Is this a header the machine really signed? Returns null if so, otherwise the reason. */
export async function inauthentic(r: unknown, keys: KeyRing): Promise<string | null> {
  if (!isObj(r) || !isObj(r.header) || typeof r.id !== "string" || !HASH_RE.test(r.id) || !isObj(r.sig)) return "not a receipt";
  let h: string;
  try { h = await hashOf(r.header); } catch { return "not canonical JSON"; }
  if (h !== r.id) return "its id is not the hash of its header";
  const k = keys[r.sig.key as string];
  if (!k) return "signed by an unpublished key";
  const when = r.header.when as string;
  if ((k.not_before && when < k.not_before) || (k.not_after && when > k.not_after)) return "issued outside its key's validity window";
  if (r.sig.alg !== "Ed25519" || typeof r.sig.value !== "string" || !(await verifyId(k.jwk, r.id, r.sig.value))) return "its signature is invalid";
  return null;
}
