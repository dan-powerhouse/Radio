import { Header } from "./receipt.js";
import { hex, utf8 } from "./bytes.js";

/**
 * A listener's tuning. Every given field must match (AND); a list matches any of
 * its entries (OR). A frequency ending in ".*" matches that prefix.
 */
export interface Tuning {
  frequency?: string | string[];
  status?: string | string[];
  by?: string | string[];
  process_hash?: string | string[];
  activated?: boolean;
}
const list = <T>(v: T | T[] | undefined) => (v === undefined ? undefined : Array.isArray(v) ? v : [v]);
const freqMatch = (pattern: string, f: string) => pattern.endsWith(".*") ? f.startsWith(pattern.slice(0, -1)) : pattern === f;

export function tuned(t: Tuning, h: Pick<Header, "frequency" | "status" | "by" | "process_hash" | "activated">): boolean {
  const f = list(t.frequency), s = list(t.status), b = list(t.by), p = list(t.process_hash);
  return (!f || f.some((x) => freqMatch(x, h.frequency))) &&
    (!s || s.includes(h.status)) &&
    (!b || (h.by !== null && b.includes(h.by))) &&
    (!p || (h.process_hash !== null && p.includes(h.process_hash))) &&
    (t.activated === undefined || t.activated === h.activated);
}

/**
 * On-air identity: HMAC-SHA256(deployment secret, account id). People can find
 * their own receipts; nobody without the secret can link a pseudonym to an account.
 */
export async function pseudonym(secret: Uint8Array<ArrayBuffer>, accountId: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", secret, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return "p:" + hex(await crypto.subtle.sign("HMAC", k, utf8(accountId)));
}
