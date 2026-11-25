import { LoglineError } from "./errors.js";

/**
 * I-JSON (RFC 7493) parser for submitted bytes. Rejects what JSON.parse would
 * silently accept and change: duplicate keys (last one wins), lone surrogates,
 * and integers outside ±(2^53−1), which would be rounded before hashing.
 */
export function parseStrict(text: string, maxDepth = 64): unknown {
  let i = 0;
  const err = (m: string): never => { throw new LoglineError("ijson", `${m} at offset ${i}`); };
  const ws = () => { while (i < text.length && " \t\n\r".includes(text[i])) i++; };
  const value = (d: number): unknown => {
    if (d > maxDepth) err("nested too deeply");
    ws();
    const c = text[i];
    if (c === "{") {
      i++; const o: Record<string, unknown> = Object.create(null); ws();
      if (text[i] === "}") { i++; return { ...o }; }
      for (;;) {
        ws(); if (text[i] !== '"') err("expected a key");
        const k = string();
        if (Object.prototype.hasOwnProperty.call(o, k)) err(`duplicate key ${JSON.stringify(k)}`);
        ws(); if (text[i++] !== ":") err("expected :");
        o[k] = value(d + 1); ws();
        if (text[i] === ",") { i++; continue; }
        if (text[i] === "}") { i++; return { ...o }; }
        err("expected , or }");
      }
    }
    if (c === "[") {
      i++; const a: unknown[] = []; ws();
      if (text[i] === "]") { i++; return a; }
      for (;;) {
        a.push(value(d + 1)); ws();
        if (text[i] === ",") { i++; continue; }
        if (text[i] === "]") { i++; return a; }
        err("expected , or ]");
      }
    }
    if (c === '"') return string();
    for (const [lit, v] of [["true", true], ["false", false], ["null", null]] as const)
      if (text.startsWith(lit, i)) { i += lit.length; return v; }
    const m = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(i, i + 400));
    if (!m) err("unexpected character");
    i += m![0].length;
    const n = Number(m![0]);
    if (!Number.isFinite(n)) err("number out of range");
    if (Number.isInteger(n) && !Number.isSafeInteger(n)) err("integer outside ±(2^53−1) would be rounded");
    return n;
  };
  const string = (): string => {
    const start = i; i++;
    while (i < text.length && text[i] !== '"') {
      if (text[i] === "\\") i++;
      else if (text.charCodeAt(i) < 0x20) err("control character in string");
      i++;
    }
    if (text[i] !== '"') err("unterminated string");
    i++;
    let s: string;
    try { s = JSON.parse(text.slice(start, i)) as string; }
    catch { return err("invalid JSON string escape"); }
    for (let j = 0; j < s.length; j++) {
      const h = s.charCodeAt(j);
      if (h >= 0xd800 && h <= 0xdbff) { const l = s.charCodeAt(j + 1); if (!(l >= 0xdc00 && l <= 0xdfff)) err("lone surrogate"); j++; }
      else if (h >= 0xdc00 && h <= 0xdfff) err("lone surrogate");
    }
    return s;
  };
  const v = value(0); ws();
  if (i !== text.length) err("trailing characters");
  return v;
}
