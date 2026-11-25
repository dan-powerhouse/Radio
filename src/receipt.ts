import { LoglineError } from "./errors.js";
import { hashOf, HASH_RE } from "./hash.js";
import { canonicalize } from "./jcs.js";
import { evaluate, isDate, lookup, Budget } from "./expr.js";
import { Process, validateProcess, FREQUENCY_RE, UNADDRESSED, DEFAULT_OPS, FieldType } from "./process.js";
import { MachineKey, signId, KeyRing } from "./keys.js";
import { inauthentic } from "./authentic.js";

export type Status = "registered" | "ok" | "doubt" | "not";
export interface Finding { step: string; result: "ok" | "not" | "doubt"; reason?: string; error?: string }

/** Public part of a receipt. It is what goes on air, and what the receipt id commits to. */
export interface Header {
  logline: "receipt@1";
  frequency: string;
  status: Status;
  activated: boolean;
  process: string | null;
  process_hash: string | null;
  input_hash: string;
  detail_hash: string;
  when: string;
  by: string | null;      // submitter as attested by the machine (a pseudonym in production)
  prev: string[];         // receipt ids this one cites or was caused by, sorted, unique
  spent: string[];        // cited ids the ledger reported as already consumed (sorted); an input, recorded
  depth: number;          // 0: submitted by `by`; n > 0: a reaction, n links from a submission
  public: Record<string, unknown>; // the process's `broadcast` fields
}
/** Private part, stored by its hash. */
export interface Detail {
  logline: "detail@1";
  consequence: string;
  findings: Finding[];
  unmet: string[] | null;
  grants: Record<string, unknown> | null;
}
export interface Receipt { header: Header; id: string; sig: { alg: "Ed25519"; key: string; value: string } }
/** Content-addressed lookup of signed receipts and their details. */
export interface Store { receipt(id: string): Promise<{ receipt: Receipt; detail?: Detail } | null> }
export interface Cited { id: string; header: Header; detail: Detail }
export interface RunOptions {
  when: string;
  by?: string | null;
  prev?: string[];
  store?: Store;      // needed when the process cites receipts
  keys?: KeyRing;     // whose signatures a cited receipt must carry
  spent?: string[];   // ledger state: cited ids already consumed in a `once` slot of this process
  depth?: number;     // 0 for submissions; reactions carry their trigger's depth + 1
}
export const MAX_DEPTH = 64;

export const WHEN_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

// JCS commits to keys, not insertion order; every observable map traversal
// must use the same UTF-16 ordering as JCS.
const ordered = <T>(o: Record<string, T>): [string, T][] => Object.keys(o).sort().map(k => [k, o[k]]);

function typeOk(v: unknown, t: FieldType): boolean {
  switch (t) {
    case "date": return isDate(v);
    case "integer": return Number.isInteger(v);
    case "array": return Array.isArray(v);
    case "object": return isObj(v);
    default: return typeof v === t;
  }
}

/** Why a free tuple does not activate a process. Empty means it activates. */
export function activationGaps(process: Process, tuple: unknown): string[] {
  if (!isObj(tuple)) return ["the submission is not a JSON object"];
  const gaps: string[] = [];
  if (tuple.this !== process.id) gaps.push(`this is ${canonicalize(tuple.this ?? null)}; this process listens on "${process.id}"`);
  if (tuple.did !== process.accepts.did) gaps.push(`did is ${canonicalize(tuple.did ?? null)}; this process accepts "${process.accepts.did}"`);
  for (const [path, t] of ordered(process.requires)) {
    const v = lookup(tuple, path);
    if (v === undefined) gaps.push(`${path} is missing (${t})`);
    else if (!typeOk(v, t)) gaps.push(`${path} is not a ${t}`);
  }
  return gaps;
}

const freqMatch = (pattern: string, f: string) => pattern.endsWith(".*") ? f.startsWith(pattern.slice(0, -1)) : pattern === f;

/** Resolve and check the receipts a tuple cites. Every problem is an unmet activation condition. */
export async function resolveCites(process: Process, tuple: unknown, opts: RunOptions): Promise<{ gaps: string[]; cited: Record<string, Cited> }> {
  const gaps: string[] = [], cited: Record<string, Cited> = {};
  const given = isObj(tuple) && isObj(tuple.cites) ? tuple.cites : {};
  const spent = new Set(opts.spent ?? []);
  for (const [slot, rule] of ordered(process.cites ?? {})) {
    const id = given[slot];
    const at = `cites.${slot}`;
    if (id === undefined) { if (!rule.optional) gaps.push(`${at} is missing: cite a receipt on ${rule.frequency}`); continue; }
    if (typeof id !== "string" || !HASH_RE.test(id)) { gaps.push(`${at} is not a receipt id`); continue; }
    const found = opts.store ? await opts.store.receipt(id) : null;
    if (!found) { gaps.push(`${at}: receipt ${id} was not found`); continue; }
    const bad = await inauthentic(found.receipt, opts.keys ?? {});
    if (bad) { gaps.push(`${at}: receipt ${id} is not authentic: ${bad}`); continue; }
    const h = found.receipt.header;
    if (!found.detail || (await hashOf(found.detail)) !== h.detail_hash) { gaps.push(`${at}: the detail of ${id} is not available`); continue; }
    if (!freqMatch(rule.frequency, h.frequency)) { gaps.push(`${at}: receipt is on ${h.frequency}, not ${rule.frequency}`); continue; }
    if (rule.status && !rule.status.includes(h.status)) { gaps.push(`${at}: receipt status is ${h.status}, needs ${rule.status.join(" or ")}`); continue; }
    if (rule.once && spent.has(id)) { gaps.push(`${at}: receipt ${id} has already been used by this process`); continue; }
    cited[slot] = { id, header: h, detail: found.detail };
  }
  return { gaps, cited };
}

export const frequencyOf = (tuple: unknown) =>
  isObj(tuple) && typeof tuple.this === "string" && FREQUENCY_RE.test(tuple.this) && tuple.this !== UNADDRESSED ? tuple.this : UNADDRESSED;

function checkOptions(o: RunOptions) {
  if (typeof o.when !== "string" || !WHEN_RE.test(o.when) || Number.isNaN(Date.parse(o.when))) throw new LoglineError("run_when", "when must be YYYY-MM-DDTHH:MM:SSZ");
  if (o.by != null && (typeof o.by !== "string" || o.by.length > 256)) throw new LoglineError("run_by", "by must be a string up to 256 characters");
  if (o.depth !== undefined && (!Number.isInteger(o.depth) || o.depth < 0 || o.depth > MAX_DEPTH)) throw new LoglineError("run_depth", `depth must be an integer 0..${MAX_DEPTH}`);
  for (const p of [...(o.prev ?? []), ...(o.spent ?? [])]) if (typeof p !== "string" || !HASH_RE.test(p)) throw new LoglineError("run_prev", "prev and spent entries must be receipt ids");
}

/**
 * The machine: a pure function of (process, tuple, options) to (header, detail).
 * `process` is null when no process is published at the tuple's frequency; the
 * submission is then only registered.
 */
export async function run(process: Process | null, tuple: unknown, opts: RunOptions): Promise<{ header: Header; detail: Detail; id: string }> {
  checkOptions(opts);
  canonicalize(tuple); // must be JSON
  if (process) validateProcess(process);
  let gaps: string[], cited: Record<string, Cited> = {};
  if (process) {
    gaps = activationGaps(process, tuple);
    const r = await resolveCites(process, tuple, opts);
    gaps.push(...r.gaps); cited = r.cited;
  } else gaps = [`no process is published on frequency "${frequencyOf(tuple)}"`];
  const activated = gaps.length === 0;
  const scope = { tuple, machine: { today: opts.when.slice(0, 10), when: opts.when, by: opts.by ?? null, cites: cited } };
  const budget: Budget = { left: process?.limits?.ops ?? DEFAULT_OPS };
  let findings: Finding[] = [];
  let grants: Record<string, unknown> | null = null;
  let status: Status = "registered";

  if (process && activated) {
    findings = process.steps.map((s): Finding => {
      try {
        return evaluate(s.check, scope, budget) === true ? { step: s.id, result: "ok" } : { step: s.id, result: s.if_not, reason: s.reason };
      } catch (e) {
        // The machine could not decide this step: never "ok", never silently "not".
        return { step: s.id, result: "doubt", reason: s.reason, error: e instanceof LoglineError ? e.message : "internal" };
      }
    });
    status = findings.some((f) => f.result === "not") ? "not" : findings.some((f) => f.result === "doubt") ? "doubt" : "ok";
    if (status === "ok" && process.grants) {
      try {
        grants = {};
        for (const [k, e] of ordered(process.grants)) grants[k] = evaluate(e, scope, budget);
        canonicalize(grants);
      } catch (e) {
        grants = null;
        status = "doubt";
        findings.push({ step: "grants", result: "doubt", reason: "The grants could not be computed.", error: e instanceof LoglineError ? e.message : "internal" });
      }
    }
  }

  const consequence = status === "registered"
    ? "Recorded. The process did not run and nothing was decided. Meet the unmet conditions to activate it."
    : process![`if_${status}` as "if_ok"];
  const detail: Detail = { logline: "detail@1", consequence, findings, unmet: activated ? null : gaps, grants };
  const pub: Record<string, unknown> = {};
  for (const path of process?.broadcast ?? []) {
    const [root, ...rest] = path.split(".");
    const v = lookup(root === "detail" ? detail : tuple, rest.join("."));
    if (v !== undefined) pub[path] = v;
  }
  const header: Header = {
    logline: "receipt@1",
    frequency: frequencyOf(tuple),
    status, activated,
    process: process ? process.id : null,
    process_hash: process ? await hashOf(process) : null,
    input_hash: await hashOf(tuple),
    detail_hash: await hashOf(detail),
    when: opts.when,
    by: opts.by ?? null,
    prev: [...new Set([...(opts.prev ?? []), ...Object.values(cited).map((c) => c.id)])].sort(),
    spent: [...new Set(opts.spent ?? [])].sort(),
    depth: opts.depth ?? 0,
    public: pub,
  };
  return { header, detail, id: await hashOf(header) };
}

export async function issue(key: MachineKey, process: Process | null, tuple: unknown, opts: RunOptions) {
  const { header, detail, id } = await run(process, tuple, opts);
  const receipt: Receipt = { header, id, sig: { alg: "Ed25519", key: key.id, value: await signId(key, id) } };
  return { receipt, detail };
}

/**
 * Idempotency key: the same input, from the same submitter, at the same depth,
 * under the same law, in the same time bucket, is the same submission (SPEC §7.4).
 */
export async function cacheKey(process: Process | null, inputHash: string, when: string, by: string | null = null, depth = 0): Promise<string> {
  const time = process?.time ?? "day";
  const bucket = time === "exact" ? when : time === "none" ? "" : when.slice(0, 10);
  return hashOf({ process_hash: process ? await hashOf(process) : null, input_hash: inputHash, bucket, by, depth });
}
