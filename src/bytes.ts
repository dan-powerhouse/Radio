export const utf8 = (s: string) => new TextEncoder().encode(s) as Uint8Array<ArrayBuffer>;
export const hex = (b: ArrayBuffer | Uint8Array) =>
  [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
export function b64url(b: ArrayBuffer | Uint8Array): string {
  let s = "";
  for (const x of new Uint8Array(b)) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function unb64url(s: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new Error("not base64url");
  const p = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  return Uint8Array.from(atob(p), (c) => c.charCodeAt(0));
}

// Return the exact JSON string size, stopping as soon as the caller's limit is exceeded.
export function jsonStringBytes(s: string, limit = Infinity, quotes = true): number {
  let bytes = quotes ? 2 : 0;
  for (let i = 0; i < s.length && bytes <= limit; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x20) bytes += c === 8 || c === 9 || c === 10 || c === 12 || c === 13 ? 2 : 6;
    else if (c === 34 || c === 92) bytes += 2;
    else if (c < 0x80) bytes++;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff && s.charCodeAt(i + 1) >= 0xdc00 && s.charCodeAt(i + 1) <= 0xdfff) {
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  return bytes;
}
