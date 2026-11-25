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
