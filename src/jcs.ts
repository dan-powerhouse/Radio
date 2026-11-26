import { jsonStringBytes } from "./bytes.js";
import { LoglineError } from "./errors.js";

/**
 * RFC 8785 JSON Canonicalization Scheme.
 * - object keys sorted by UTF-16 code units (JS default string order)
 * - numbers serialized as ECMAScript Number::toString (what JSON.stringify does), -0 as 0
 * - strings escaped as JSON.stringify does; lone surrogates are rejected
 * - anything that is not JSON (undefined, functions, NaN, Infinity, class instances) is rejected
 */
export function canonicalize(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) throw new LoglineError("jcs_number", "numbers must be finite");
      return Object.is(value, -0) ? "0" : JSON.stringify(value);
    case "string":
      return str(value);
    case "object": {
      if (Array.isArray(value)) return "[" + value.map(canonicalize).join(",") + "]";
      const proto = Object.getPrototypeOf(value);
      if (proto !== Object.prototype && proto !== null)
        throw new LoglineError("jcs_type", "only plain objects are JSON");
      const obj = value as Record<string, unknown>;
      const keys = Object.keys(obj).sort();
      return "{" + keys.map((k) => {
        if (obj[k] === undefined) throw new LoglineError("jcs_type", `undefined value at key ${JSON.stringify(k)}`);
        return str(k) + ":" + canonicalize(obj[k]);
      }).join(",") + "}";
    }
  }
  throw new LoglineError("jcs_type", `${typeof value} is not JSON`);
}

function str(s: string): string {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const d = s.charCodeAt(i + 1);
      if (!(d >= 0xdc00 && d <= 0xdfff)) throw new LoglineError("jcs_string", "lone surrogate");
      i++;
    } else if (c >= 0xdc00 && c <= 0xdfff) throw new LoglineError("jcs_string", "lone surrogate");
  }
  return JSON.stringify(s);
}

// Preflight an admitted JSON tree before allocating canonical text. Walk repeated
// references as separate occurrences, because JCS would serialize each one.
export function canonicalBytes(value: unknown, limit: number, overflow: () => never, maxDepth = 64): number {
  let bytes = 0;
  const add = (n: number) => {
    bytes += n;
    if (bytes > limit) overflow();
  };
  function visit(v: unknown, depth: number): void {
    if (depth > maxDepth) overflow();
    if (typeof v === "string") {
      add(jsonStringBytes(v, limit - bytes));
    } else if (Array.isArray(v)) {
      add(2 + Math.max(0, v.length - 1));
      for (const x of v) visit(x, depth + 1);
    } else if (v !== null && typeof v === "object") {
      add(2);
      let first = true;
      for (const k in v) {
        if (!Object.hasOwn(v,k)) continue;
        add(first ? 1 : 2);
        first = false;
        add(jsonStringBytes(k, limit - bytes));
        visit((v as Record<string, unknown>)[k], depth + 1);
      }
    } else {
      add(canonicalize(v).length);
    }
  }
  visit(value, 0);
  return bytes;
}
