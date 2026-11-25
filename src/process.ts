import { LoglineError } from "./errors.js";

export type FieldType = "string" | "number" | "integer" | "boolean" | "date" | "object" | "array";
export type Failure = "not" | "doubt";
export interface Step { id: string; check: unknown; if_not: Failure; reason: string }
export interface Process {
  logline: "process@1";
  id: string;                         // also the process's frequency
  issuer: string;
  accepts: { did: string };
  requires: Record<string, FieldType>; // activation conditions on the free tuple
  steps: Step[];
  grants?: Record<string, unknown>;    // evaluated only when every step is ok
  if_ok: string; if_doubt: string; if_not: string;
  broadcast?: string[];               // "detail.<path>" or "tuple.<path>": what goes on air
  time?: "none" | "day" | "exact";    // how the decision depends on `when` (cache bucket)
  limits?: { ops?: number };
}

export const FREQUENCY_RE = /^[a-z0-9][a-z0-9._:@-]{0,127}$/;
export const UNADDRESSED = "_unaddressed";
export const DEFAULT_OPS = 10_000;
export const MAX_OPS = 1_000_000;
const TYPES = new Set(["string", "number", "integer", "boolean", "date", "object", "array"]);
const PATH_RE = /^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*$/;

const fail = (path: string, msg: string): never => { throw new LoglineError("process_invalid", `${path}: ${msg}`); };
const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown, path: string, max = 2000) => { if (typeof v !== "string" || !v || v.length > max) fail(path, `must be a non-empty string up to ${max} characters`); };

/** Structural validation of a process. Throws LoglineError("process_invalid") naming the first problem. */
export function validateProcess(p: unknown): asserts p is Process {
  if (!isObj(p)) fail("$", "a process is a JSON object");
  const q = p as Record<string, unknown>;
  const known = new Set(["logline", "id", "issuer", "accepts", "requires", "steps", "grants", "if_ok", "if_doubt", "if_not", "broadcast", "time", "limits"]);
  for (const k of Object.keys(q)) if (!known.has(k)) fail(k, "unknown field");
  if (q.logline !== "process@1") fail("logline", 'must be "process@1"');
  if (typeof q.id !== "string" || !FREQUENCY_RE.test(q.id) || q.id === UNADDRESSED) fail("id", "must match " + FREQUENCY_RE);
  str(q.issuer, "issuer");
  if (!isObj(q.accepts)) fail("accepts", "must be an object"); else str(q.accepts.did, "accepts.did", 128);
  if (!isObj(q.requires)) fail("requires", "must be an object");
  for (const [path, t] of Object.entries(q.requires as object)) {
    if (!PATH_RE.test(path)) fail(`requires.${path}`, "bad field path");
    if (!TYPES.has(t as string)) fail(`requires.${path}`, `unknown type ${JSON.stringify(t)}`);
  }
  if (!Array.isArray(q.steps)) fail("steps", "must be a list");
  const ids = new Set<string>();
  (q.steps as unknown[]).forEach((s, i) => {
    if (!isObj(s)) fail(`steps[${i}]`, "must be an object");
    const st = s as Record<string, unknown>;
    for (const k of Object.keys(st)) if (!["id", "check", "if_not", "reason"].includes(k)) fail(`steps[${i}].${k}`, "unknown field");
    if (typeof st.id !== "string" || !PATH_RE.test(st.id)) fail(`steps[${i}].id`, "bad step id");
    if (ids.has(st.id as string)) fail(`steps[${i}].id`, "duplicate step id");
    ids.add(st.id as string);
    if (!("check" in st)) fail(`steps[${i}].check`, "missing");
    if (st.if_not !== "not" && st.if_not !== "doubt") fail(`steps[${i}].if_not`, 'must be "not" or "doubt"');
    str(st.reason, `steps[${i}].reason`);
  });
  if (q.grants !== undefined && !isObj(q.grants)) fail("grants", "must be an object");
  for (const k of ["if_ok", "if_doubt", "if_not"]) str(q[k], k);
  if (q.broadcast !== undefined) {
    if (!Array.isArray(q.broadcast)) fail("broadcast", "must be a list");
    for (const b of q.broadcast as unknown[])
      if (typeof b !== "string" || !/^(detail|tuple)\./.test(b) || !PATH_RE.test(b)) fail("broadcast", `bad path ${JSON.stringify(b)}`);
  }
  if (q.time !== undefined && !["none", "day", "exact"].includes(q.time as string)) fail("time", 'must be "none", "day" or "exact"');
  if (q.limits !== undefined) {
    if (!isObj(q.limits)) fail("limits", "must be an object");
    const ops = (q.limits as Record<string, unknown>).ops;
    if (ops !== undefined && (!Number.isInteger(ops) || (ops as number) < 1 || (ops as number) > MAX_OPS)) fail("limits.ops", `must be an integer 1..${MAX_OPS}`);
  }
}
