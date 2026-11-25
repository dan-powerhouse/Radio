import { hashOf } from "./hash.js";
import { b64url, unb64url, utf8 } from "./bytes.js";
import { LoglineError } from "./errors.js";

export interface PublicJwk { kty: "OKP"; crv: "Ed25519"; x: string }
export interface PrivateJwk extends PublicJwk { d: string }
export interface MachineKey { id: string; public: PublicJwk; private: CryptoKey }
/** Published keys: key id -> public key, with an optional validity window (ISO timestamps, inclusive). */
export type KeyRing = Record<string, { jwk: PublicJwk; not_before?: string; not_after?: string }>;

const ALG = { name: "Ed25519" } as const;
export const SIGNING_DOMAIN = "logline-receipt-v1:";

/** Key id: sha256 over the JCS form of {crv, kty, x} (the RFC 7638 thumbprint input), as "sha256:<hex>". */
export const keyId = (jwk: PublicJwk) => hashOf({ crv: jwk.crv, kty: jwk.kty, x: jwk.x });

export async function generateMachineKey(): Promise<{ key: MachineKey; privateJwk: PrivateJwk }> {
  const pair = (await crypto.subtle.generateKey(ALG, true, ["sign", "verify"])) as CryptoKeyPair;
  const j = (await crypto.subtle.exportKey("jwk", pair.privateKey)) as JsonWebKey;
  const privateJwk: PrivateJwk = { kty: "OKP", crv: "Ed25519", x: j.x!, d: j.d! };
  return { key: await importMachineKey(privateJwk), privateJwk };
}

export async function importMachineKey(jwk: PrivateJwk): Promise<MachineKey> {
  if (jwk.kty !== "OKP" || jwk.crv !== "Ed25519" || unb64url(jwk.d).length !== 32 || unb64url(jwk.x).length !== 32)
    throw new LoglineError("key_invalid", "expected an Ed25519 private JWK");
  const priv = await crypto.subtle.importKey("jwk", { kty: "OKP", crv: "Ed25519", x: jwk.x, d: jwk.d }, ALG, false, ["sign"]);
  const pub: PublicJwk = { kty: "OKP", crv: "Ed25519", x: jwk.x };
  return { id: await keyId(pub), public: pub, private: priv };
}

export async function signId(key: MachineKey, id: string): Promise<string> {
  return b64url(await crypto.subtle.sign(ALG, key.private, utf8(SIGNING_DOMAIN + id)));
}

export async function verifyId(jwk: PublicJwk, id: string, sig: string): Promise<boolean> {
  try {
    const pub = await crypto.subtle.importKey("jwk", { kty: "OKP", crv: "Ed25519", x: jwk.x }, ALG, false, ["verify"]);
    const raw = unb64url(sig);
    return raw.length === 64 && (await crypto.subtle.verify(ALG, pub, raw, utf8(SIGNING_DOMAIN + id)));
  } catch { return false; }
}
