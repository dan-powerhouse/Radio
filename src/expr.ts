import { LoglineError } from "./errors.js";
import { canonicalize } from "./jcs.js";

/**
 * The expression language. An expression is a JSON literal, an array of expressions,
 * or an object with exactly one key naming an operator.
 * Deterministic: no clock, no network, no randomness. Bounded: every operator
 * application costs one unit of the evaluation budget.
 */
export interface Budget { left: number }
export type Scope = { tuple: unknown; machine: Record<string, unknown> };

const DAY = 86400000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function toDate(v: unknown): number {
  if (typeof v !== "string" || !DATE_RE.test(v)) throw new LoglineError("eval_type", `not a date: ${short(v)}`);
  const t = Date.parse(v + "T00:00:00Z");
  if (Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== v)
    throw new LoglineError("eval_type", `not a calendar date: ${short(v)}`);
  return t;
}
export const isDate = (v: unknown) => { try { toDate(v); return true; } catch { return false; } };

function num(v: unknown): number {
  if (typeof v !== "number") throw new LoglineError("eval_type", `not a number: ${short(v)}`);
  return v;
}
function finite(v: number): number {
  if (!Number.isFinite(v)) throw new LoglineError("eval_range", "arithmetic overflowed");
  return v;
}
function short(v: unknown): string {
  let s: string;
  try { s = canonicalize(v); } catch { s = String(v); }
  return s.length > 60 ? s.slice(0, 57) + "..." : s;
}

export function lookup(root: unknown, path: string): unknown {
  let cur: unknown = root;
  for (const k of path.split(".")) {
    if (cur === null || typeof cur !== "object" || Array.isArray(cur)) return undefined;
    if (!Object.prototype.hasOwnProperty.call(cur, k)) return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

function resolve(path: unknown, scope: Scope): unknown {
  if (typeof path !== "string" || path === "") throw new LoglineError("eval_syntax", "var takes a non-empty path string");
  return path.startsWith("$")
    ? (Object.prototype.hasOwnProperty.call(scope.machine, path.slice(1)) ? scope.machine[path.slice(1)] : undefined)
    : lookup(scope.tuple, path);
}

const eq = (a: unknown, b: unknown) =>
  (a !== null && typeof a === "object") || (b !== null && typeof b === "object")
    ? canonicalize(a) === canonicalize(b) : a === b;

type Op = (args: unknown[], scope: Scope, b: Budget, d: number) => unknown;
const arity = (n: number, name: string, args: unknown[]) => {
  if (args.length !== n) throw new LoglineError("eval_syntax", `${name} takes ${n} argument(s)`);
};
// Lazy operators receive raw argument expressions; eager ones receive values.
const LAZY: Record<string, Op> = {
  and: (xs, s, b, d) => { for (const x of xs) if (evaluate(x, s, b, d + 1) !== true) return false; return true; },
  or: (xs, s, b, d) => { for (const x of xs) if (evaluate(x, s, b, d + 1) === true) return true; return false; },
  if: (xs, s, b, d) => { arity(3, "if", xs); return evaluate(xs[0], s, b, d + 1) === true ? evaluate(xs[1], s, b, d + 1) : evaluate(xs[2], s, b, d + 1); },
  var: ([p], s) => {
    const v = resolve(p, s);
    if (v === undefined) throw new LoglineError("eval_missing", `missing field ${String(p)}`);
    return v;
  },
  has: ([p], s) => resolve(p, s) !== undefined,
};
const EAGER: Record<string, (a: unknown[]) => unknown> = {
  "==": (a) => { arity(2, "==", a); return eq(a[0], a[1]); },
  "!=": (a) => { arity(2, "!=", a); return !eq(a[0], a[1]); },
  "<": (a) => { arity(2, "<", a); return num(a[0]) < num(a[1]); },
  "<=": (a) => { arity(2, "<=", a); return num(a[0]) <= num(a[1]); },
  ">": (a) => { arity(2, ">", a); return num(a[0]) > num(a[1]); },
  ">=": (a) => { arity(2, ">=", a); return num(a[0]) >= num(a[1]); },
  not: (a) => { arity(1, "not", a); return a[0] !== true; },
  in: (a) => { arity(2, "in", a); if (!Array.isArray(a[1])) throw new LoglineError("eval_type", "in needs a list"); return a[1].some((x) => eq(x, a[0])); },
  "+": (a) => finite(a.reduce<number>((s, x) => s + num(x), 0)),
  "-": (a) => { arity(2, "-", a); return finite(num(a[0]) - num(a[1])); },
  "*": (a) => finite(a.reduce<number>((s, x) => s * num(x), 1)),
  min: (a) => { if (!a.length) throw new LoglineError("eval_syntax", "min needs arguments"); return Math.min(...a.map(num)); },
  max: (a) => { if (!a.length) throw new LoglineError("eval_syntax", "max needs arguments"); return Math.max(...a.map(num)); },
  concat: (a) => a.map((x) => {
    if (typeof x === "string") return x;
    if (typeof x === "number" || typeof x === "boolean") return canonicalize(x);
    throw new LoglineError("eval_type", "concat takes strings, numbers or booleans");
  }).join(""),
  len: (a) => { arity(1, "len", a); if (typeof a[0] === "string" || Array.isArray(a[0])) return a[0].length; throw new LoglineError("eval_type", "len takes a string or list"); },
  days_between: (a) => { arity(2, "days_between", a); return Math.round((toDate(a[1]) - toDate(a[0])) / DAY); },
  add_days: (a) => {
    arity(2, "add_days", a);
    const n = num(a[1]);
    if (!Number.isInteger(n)) throw new LoglineError("eval_type", "add_days takes a whole number of days");
    const t = toDate(a[0]) + n * DAY;
    if (!Number.isFinite(t) || Math.abs(t) > 8.64e15) throw new LoglineError("eval_range", "date out of range");
    return new Date(t).toISOString().slice(0, 10);
  },
};
export const OPERATORS = [...Object.keys(LAZY), ...Object.keys(EAGER)].sort();

export function evaluate(e: unknown, scope: Scope, budget: Budget, depth = 0): unknown {
  if (depth > 64) throw new LoglineError("eval_depth", "expression nested deeper than 64");
  if (Array.isArray(e)) return e.map((x) => evaluate(x, scope, budget, depth + 1));
  if (e === null || typeof e !== "object") return e;
  const keys = Object.keys(e);
  if (keys.length !== 1) throw new LoglineError("eval_syntax", "an expression object has exactly one operator key");
  const op = keys[0];
  if (--budget.left < 0) throw new LoglineError("eval_budget", "operation budget exhausted");
  const raw = (e as Record<string, unknown>)[op];
  const args = Array.isArray(raw) ? raw : [raw];
  if (op in LAZY) return LAZY[op](args, scope, budget, depth);
  if (op in EAGER) return EAGER[op](args.map((x) => evaluate(x, scope, budget, depth + 1)));
  throw new LoglineError("eval_operator", `unknown operator ${JSON.stringify(op)}`);
}
