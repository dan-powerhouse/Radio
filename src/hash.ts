import { canonicalize } from "./jcs.js";
import { hex, utf8 } from "./bytes.js";

export const HASH_RE = /^sha256:[0-9a-f]{64}$/;

/** sha256 of bytes (strings are UTF-8 encoded), written "sha256:<hex>". */
export async function sha256(data: string | Uint8Array<ArrayBuffer>): Promise<string> {
  const bytes = typeof data === "string" ? utf8(data) : data;
  return "sha256:" + hex(await crypto.subtle.digest("SHA-256", bytes));
}

/** The content address of a JSON value: sha256 of its JCS form. */
export const hashOf = (value: unknown) => sha256(canonicalize(value));
