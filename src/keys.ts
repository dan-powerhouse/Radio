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
export const SIGNING_DOMAIN_V2 = "logline-receipt-v2:";

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

async function signDomain(key: MachineKey, id: string, domain: string): Promise<string> {
  return b64url(await crypto.subtle.sign(ALG, key.private, utf8(domain + id)));
}

async function verifyDomain(jwk: PublicJwk, id: string, sig: string, domain: string): Promise<boolean> {
  try {
    const pub = await crypto.subtle.importKey("jwk", { kty: "OKP", crv: "Ed25519", x: jwk.x }, ALG, false, ["verify"]);
    const raw = unb64url(sig);
    return raw.length === 64 && (await crypto.subtle.verify(ALG, pub, raw, utf8(domain + id)));
  } catch { return false; }
}

export const signId = (key: MachineKey, id: string) => signDomain(key,id,SIGNING_DOMAIN);
export const verifyId = (jwk: PublicJwk, id: string, sig: string) => verifyDomain(jwk,id,sig,SIGNING_DOMAIN);
export const signIdV2 = (key: MachineKey, id: string) => signDomain(key,id,SIGNING_DOMAIN_V2);
export const verifyIdV2 = (jwk: PublicJwk, id: string, sig: string) => verifyDomain(jwk,id,sig,SIGNING_DOMAIN_V2);
