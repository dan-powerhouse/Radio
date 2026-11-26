import { LoglineError } from "./errors.js";
import { canonicalize } from "./jcs.js";
import { hashOf, HASH_RE } from "./hash.js";
import { parseStrict } from "./strict.js";
import { OPERATORS } from "./expr.js";
import { Process, validateProcess, MAX_OPS } from "./process.js";

export type RunDefinition = Omit<Process, "logline" | "issuer" | "accepts" | "on" | "time"> & {
  after: string[];
};
export interface ProcessType {
  logline: "process-type@1";
  id: string;
  issuer: string;
  recognize: unknown;
  runs: RunDefinition[];
}
export interface RegistrySnapshot {
  logline: "registry@1";
  types: string[];
  scan_ops: number;
}

// Reference admission profile, not a claim about hosted capacity.
export const MAX_LAW_BYTES = 65_536;
export const MAX_LAW_NODES = 16_384;
export const MAX_RUNS = 64;
const RUN_ID = /^[A-Za-z0-9_-]{1,64}$/;
const own = (v: object, k: string) => Object.prototype.hasOwnProperty.call(v, k);
const fail = (path: string, reason: string): never => {
  throw new LoglineError("process_type_invalid", path + ": " + reason);
};
function record(v: unknown, path: string): Record<string, unknown> {
  if (v === null || typeof v !== "object" || Array.isArray(v) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(v))) fail(path, "expected JSON object");
  return v as Record<string, unknown>;
}
function fields(o: Record<string, unknown>, required: string[], optional: string[], path: string) {
  for (const k of required) if (!own(o, k)) fail(path + "." + k, "missing");
  for (const k of Object.keys(o).sort()) if (!required.includes(k) && !optional.includes(k))
    fail(path + "." + k, "unknown field");
}

// Bound the object before canonicalization (including direct library calls).
function checkJSON(v: unknown) {
  let nodes = 0;
  function visit(x: unknown, depth: number) {
    if (++nodes > MAX_LAW_NODES || depth > 64) fail("$", "law complexity limit");
    if (x === null || typeof x === "string" || typeof x === "boolean") return;
    if (typeof x === "number") {
      if (!Number.isFinite(x) || (Number.isInteger(x) && !Number.isSafeInteger(x))) fail("$", "unsafe JSON number");
      return;
    }
    if (Array.isArray(x)) {
      if (x.length > MAX_LAW_NODES || Object.keys(x).length !== x.length) fail("$", "invalid JSON array");
      for (let i = 0; i < x.length; i++) {
        if (!own(x, String(i))) fail("$", "sparse JSON array");
        visit(x[i], depth + 1);
      }
      return;
    }
    const o = record(x, "$");
    for (const k of Object.keys(o)) visit(o[k], depth + 1);
  }
  visit(v, 0);
  if (new TextEncoder().encode(canonicalize(v)).length > MAX_LAW_BYTES) fail("$", "law byte limit");
}

// Syntax only: the original expression evaluator remains the sole runtime.
const ops = new Set(OPERATORS);
const unary = new Set(["not", "len"]);
const binary = new Set(["==", "!=", "<", "<=", ">", ">=", "-", "in", "days_between", "add_days"]);
type PathAllowed = (path: string) => boolean;
function expression(e: unknown, allowed: PathAllowed, path: string, depth = 0): void {
  if (depth > 64) fail(path, "expression depth");
  if (Array.isArray(e)) {
    e.forEach((x, i) => expression(x, allowed, path + "." + i, depth + 1));
    return;
  }
  if (e === null || typeof e !== "object") return;
  const o = record(e, path), keys = Object.keys(o);
  if (keys.length !== 1 || !ops.has(keys[0])) fail(path, "unknown or malformed operator");
  const op = keys[0], raw = o[op], args = Array.isArray(raw) ? raw : [raw];
  if (op === "var" || op === "has") {
    if (args.length !== 1 || typeof args[0] !== "string" || !args[0] || !allowed(args[0]))
      fail(path, "invalid or unavailable literal path");
    return;
  }
  if ((unary.has(op) && args.length !== 1) || (binary.has(op) && args.length !== 2) ||
      (op === "if" && args.length !== 3) || (["min", "max"].includes(op) && !args.length))
    fail(path, "invalid operator arity: " + op);
  args.forEach((x, i) => expression(x, allowed, path + "." + op + "." + i, depth + 1));
}

export function validateProcessType(value: unknown): asserts value is ProcessType {
  checkJSON(value);
  const law = record(value, "$");
  fields(law, ["logline", "id", "issuer", "recognize", "runs"], [], "$");
  if (law.logline !== "process-type@1") fail("logline", "expected process-type@1");
  expression(law.recognize, p => !p.startsWith("$"), "recognize");
  if (!Array.isArray(law.runs) || law.runs.length < 1 || law.runs.length > MAX_RUNS)
    fail("runs", "expected 1..64 RUNs");
  const ids = new Set<string>();
  for (const [i, value] of (law.runs as unknown[]).entries()) {
    const path = "runs." + i, run = record(value, path);
    fields(run, ["id", "requires", "after", "steps", "if_ok", "if_doubt", "if_not"],
      ["cites", "grants", "broadcast", "limits"], path);
    if (typeof run.id !== "string" || !RUN_ID.test(run.id) || ids.has(run.id)) fail(path + ".id", "invalid or duplicate RUN id");
    const after = run.after;
    if (!Array.isArray(after) || (i === 0 ? after.length !== 0 : after.length === 0) ||
        after.some(x => typeof x !== "string" || !ids.has(x)) || new Set(after).size !== after.length)
      fail(path + ".after", "expected unique earlier predecessors (empty only for entry)");
    const { id, after: _after, ...body } = run;
    // Reuse all v1 structural field rules, without installing or executing a v1 law.
    try {
      validateProcess({ ...body, logline: "process@1", id: law.id, issuer: law.issuer, accepts: { did: "_" } });
    } catch (err) {
      fail(path, err instanceof Error ? err.message : String(err));
    }
    if (own(run, "limits")) fields(record(run.limits, path + ".limits"), [], ["ops"], path + ".limits");
    const allowed: PathAllowed = p => {
      if (!p.startsWith("$")) return true;
      if (["$when", "$today", "$by", "$instance"].includes(p)) return true;
      const [root, name, part, ...tail] = p.split(".");
      if (root !== "$parents" && root !== "$cites") return false;
      if (!name || !["id", "header", "detail"].includes(part) || (part === "id" && tail.length)) return false;
      return tail.every(Boolean) && (root === "$parents"
        ? (after as string[]).includes(name)
        : own((run.cites ?? {}) as object, name));
    };
    for (const [j, step] of (run.steps as RunDefinition["steps"]).entries())
      expression(step.check, allowed, path + ".steps." + j + ".check");
    for (const [name, e] of Object.entries((run.grants ?? {}) as object))
      expression(e, allowed, path + ".grants." + name);
    ids.add(id as string);
  }
}

export function parseProcessType(text: string): ProcessType {
  if (new TextEncoder().encode(text).length > MAX_LAW_BYTES) fail("$", "law byte limit");
  let value: unknown;
  try { value = parseStrict(text); }
  catch (err) {
    if (err instanceof SyntaxError) throw new LoglineError("ijson", "invalid JSON string");
    throw err;
  }
  validateProcessType(value);
  return value;
}

export function validateRegistrySnapshot(v: unknown): asserts v is RegistrySnapshot {
  const o = record(v, "registry");
  fields(o, ["logline", "types", "scan_ops"], [], "registry");
  if (o.logline !== "registry@1" || !Number.isInteger(o.scan_ops) ||
      (o.scan_ops as number) < 1 || (o.scan_ops as number) > MAX_OPS ||
      !Array.isArray(o.types)) fail("registry", "invalid snapshot");
  let previous = "";
  for (const h of o.types as unknown[]) {
    if (typeof h !== "string" || !HASH_RE.test(h) || h <= previous) fail("registry.types", "expected sorted unique hashes");
    previous = h as string;
  }
}

/** Local reference registry. Caller is the trusted publication boundary;
 * hosted authentication/authorization and durable atomicity belong to M3. */
export class ProcessTypeRegistry {
  #ids = new Map<string, string>();
  #laws = new Map<string, ProcessType>();
  #active = new Set<string>();
  #snapshots = new Map<string, RegistrySnapshot>();
  #scanOps: number;

  constructor(scanOps = MAX_OPS) {
    validateRegistrySnapshot({ logline: "registry@1", types: [], scan_ops: scanOps });
    this.#scanOps = scanOps;
  }

  async publish(text: string): Promise<string> {
    const law = parseProcessType(text), hash = await hashOf(law);
    // Check after awaiting hash: concurrent callers cannot rebind an id.
    const previous = this.#ids.get(law.id);
    if (previous !== undefined) {
      if (previous !== hash) throw new LoglineError("process_exists", "published id cannot be rebound: " + law.id);
      return hash; // idempotent, including after retirement
    }
    this.#ids.set(law.id, hash);
    this.#laws.set(hash, law);
    this.#active.add(hash);
    return hash;
  }

  retire(id: string): void {
    const hash = this.#ids.get(id);
    if (!hash) throw new LoglineError("process_missing", "unknown published id: " + id);
    this.#active.delete(hash);
  }

  /** Includes retired laws: a published id is never rebound. */
  hashForId(id: string): string | null { return this.#ids.get(id) ?? null; }

  law(hash: string): ProcessType | null {
    const law = this.#laws.get(hash);
    return law ? structuredClone(law) : null;
  }

  async snapshot(): Promise<{ hash: string; snapshot: RegistrySnapshot }> {
    // Capture synchronously before hashing; publication may continue independently.
    const snapshot: RegistrySnapshot = { logline: "registry@1", types: [...this.#active].sort(), scan_ops: this.#scanOps };
    const hash = await hashOf(snapshot);
    this.#snapshots.set(hash, snapshot);
    return { hash, snapshot: structuredClone(snapshot) };
  }

  snapshotByHash(hash: string): RegistrySnapshot | null {
    const snapshot = this.#snapshots.get(hash);
    return snapshot ? structuredClone(snapshot) : null;
  }
}
