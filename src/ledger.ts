import { canonicalize } from "./jcs.js";
import { hashOf } from "./hash.js";
import { KeyRing, MachineKey } from "./keys.js";
import { Process, validateProcess } from "./process.js";
import { issue, frequencyOf, cacheKey, Receipt, Detail, Store, Header } from "./receipt.js";
import { parseStrict } from "./strict.js";
import { verify, Verdict } from "./verify.js";
import { tuned, Tuning } from "./radio.js";

export interface Entry { seq: number; receipt: Receipt; detail: Detail; tuple: unknown; process: Process | null }
export interface LedgerOptions {
  clock?: () => string;
  maxDepth?: number;      // longest chain of reactions after a submission
  maxReactions?: number;  // most receipts one submission may cause, in total
}
export interface Halted { trigger: string; process: string; reason: "depth" | "chain_budget" }
export interface SubmitResult {
  receipt: Receipt; detail: Detail;
  replayed: boolean;      // true: an identical submission already had this receipt; nothing new was issued
  reactions: Receipt[];   // receipts the radio caused, in the order they were issued
  halted: Halted[];       // reactions the machine refused to run, and why
}
export interface Bundle {
  logline: "bundle@1";
  head: string;
  keys: KeyRing;
  entries: { receipt: Receipt; detail: Detail; tuple: unknown; process: Process | null }[]; // ancestors first
}

/**
 * The reference machine: an append-only, content-addressed ledger in memory.
 * A hosted deployment does the same with Postgres + Realtime; behaviour must match.
 */
export class MemoryLedger implements Store {
  private entries: Entry[] = [];
  private byId = new Map<string, Entry>();
  private processes = new Map<string, Process>();
  private consumed = new Set<string>();  // canonical [processId, slot, citedId]
  private listeners = new Set<{ tuning: Tuning; fn: (r: Receipt) => void }>();
  private idempotent = new Map<string, string>();     // cacheKey -> receipt id
  private reacted = new Set<string>();                // canonical [trigger id, process id]
  readonly keys: KeyRing;
  private clock: () => string;
  readonly maxDepth: number;
  readonly maxReactions: number;

  constructor(private key: MachineKey, opts: LedgerOptions | (() => string) = {}) {
    const o = typeof opts === "function" ? { clock: opts } : opts;
    this.clock = o.clock ?? (() => new Date().toISOString().slice(0, 19) + "Z");
    this.maxDepth = o.maxDepth ?? 8;
    this.maxReactions = o.maxReactions ?? 64;
    this.keys = { [key.id]: { jwk: key.public } };
  }

  /** Publish a law on its frequency. One process per frequency; amending means publishing a new id. */
  async publish(process: Process): Promise<string> {
    validateProcess(process);
    if (this.processes.has(process.id)) throw new Error(`a process is already published on ${process.id}`);
    this.processes.set(process.id, structuredClone(process));
    return hashOf(process);
  }

  async receipt(id: string) {
    const e = this.byId.get(id);
    return e ? { receipt: e.receipt, detail: e.detail } : null;
  }

  /** Raw bytes from the network: parsed as I-JSON, then submitted. */
  async submitText(text: string, opts: { by?: string | null; when?: string } = {}): Promise<SubmitResult> {
    return this.submit(parseStrict(text), opts);
  }

  /**
   * Every submission gets a receipt. Then the radio runs: each process tuned to
   * the new receipt reacts once, with a tuple citing it as `trigger`, breadth
   * first, until nothing more reacts or a limit halts the chain.
   */
  async submit(tuple: unknown, opts: { by?: string | null; when?: string } = {}): Promise<SubmitResult> {
    canonicalize(tuple);
    const first = await this.issueOne(structuredClone(tuple), opts.by ?? null, 0, opts.when);
    const reactions: Receipt[] = [], halted: Halted[] = [];
    if (first.replayed) return { ...first, reactions, halted };
    const queue: Entry[] = [this.byId.get(first.receipt.id)!];
    while (queue.length) {
      const trigger = queue.shift()!;
      for (const p of this.processes.values()) {
        if (!p.on || !tuned({ frequency: p.on.frequency, status: p.on.status }, trigger.receipt.header)) continue;
        const pair = canonicalize([trigger.receipt.id, p.id]);
        if (this.reacted.has(pair)) continue;
        this.reacted.add(pair);
        const h = trigger.receipt.header;
        if (h.depth + 1 > this.maxDepth) { halted.push({ trigger: trigger.receipt.id, process: p.id, reason: "depth" }); continue; }
        if (reactions.length >= this.maxReactions) { halted.push({ trigger: trigger.receipt.id, process: p.id, reason: "chain_budget" }); continue; }
        const r = await this.issueOne({ did: p.accepts.did, this: p.id, cites: { trigger: trigger.receipt.id } }, h.by, h.depth + 1);
        reactions.push(r.receipt);
        if (!r.replayed) queue.push(this.byId.get(r.receipt.id)!);
      }
    }
    return { ...first, reactions, halted };
  }

  private async issueOne(tuple: unknown, by: string | null, depth: number, when?: string) {
    const process = this.processes.get(frequencyOf(tuple)) ?? null;
    when ??= this.clock();
    const idem = await cacheKey(process, await hashOf(tuple), when, by, depth);
    const seen = this.idempotent.get(idem);
    if (seen) { const e = this.byId.get(seen)!; return { receipt: structuredClone(e.receipt), detail: structuredClone(e.detail), replayed: true }; }
    const cites = tuple !== null && typeof tuple === "object" && !Array.isArray(tuple) ? (tuple as any).cites : undefined;
    const spent: string[] = [];
    for (const [slot, rule] of Object.entries(process?.cites ?? {})) {
      const id = cites?.[slot];
      if (rule.once && typeof id === "string" && this.consumed.has(canonicalize([process!.id, slot, id]))) spent.push(id);
    }
    const { receipt, detail } = await issue(this.key, process, tuple, { when, by, depth, store: this, keys: this.keys, spent });
    if (receipt.header.status === "ok")
      for (const [slot, rule] of Object.entries(process?.cites ?? {}))
        if (rule.once && typeof cites?.[slot] === "string") this.consumed.add(canonicalize([process!.id, slot, cites[slot]]));
    const entry: Entry = { seq: this.entries.length + 1, receipt, detail, tuple, process: process ? structuredClone(process) : null };
    this.entries.push(entry);
    this.byId.set(receipt.id, entry);
    this.idempotent.set(idem, receipt.id);
    for (const l of this.listeners) if (tuned(l.tuning, receipt.header)) l.fn(structuredClone(receipt));
    return { receipt: structuredClone(receipt), detail: structuredClone(detail), replayed: false };
  }

  /** The radio. Replays history after `afterSeq` (if given), then delivers live. Returns unsubscribe. */
  listen(tuning: Tuning, fn: (r: Receipt) => void, afterSeq?: number): () => void {
    if (afterSeq !== undefined) for (const e of this.entries) if (e.seq > afterSeq && tuned(tuning, e.receipt.header)) fn(structuredClone(e.receipt));
    const l = { tuning, fn };
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  history(tuning: Tuning = {}): Receipt[] {
    return this.entries.filter((e) => tuned(tuning, e.receipt.header)).map((e) => structuredClone(e.receipt));
  }

  /** The trajectory behind a receipt: it and every ancestor reachable through prev, ancestors first. */
  trajectory(id: string): Header[] {
    return this.walk(id).map((e) => structuredClone(e.receipt.header));
  }

  /** Everything needed to verify a receipt and its whole trajectory offline. */
  bundle(id: string): Bundle {
    return structuredClone({
      logline: "bundle@1", head: id, keys: this.keys,
      entries: this.walk(id).map(({ receipt, detail, tuple, process }) => ({ receipt, detail, tuple, process })),
    });
  }

  private walk(id: string): Entry[] {
    const seen = new Set<string>(), out: Entry[] = [];
    const visit = (x: string) => {
      if (seen.has(x)) return;
      seen.add(x);
      const e = this.byId.get(x);
      if (!e) return;
      for (const p of e.receipt.header.prev) visit(p);
      out.push(e);
    };
    visit(id);
    return out;
  }
}

/**
 * Verify a bundle without the ledger: every entry is re-run against the
 * others, by hash. `keys` should be the machine's published ring, not the
 * one inside the bundle.
 */
export async function verifyBundle(bundle: Bundle, keys: KeyRing): Promise<{ valid: boolean; head: string; entries: { id: string; status: string; verdict: Verdict }[] }> {
  const byId = new Map(bundle.entries.map((e) => [e.receipt.id, e]));
  const store: Store = { receipt: async (id) => { const e = byId.get(id); return e ? { receipt: e.receipt, detail: e.detail } : null; } };
  const entries = [];
  for (const e of bundle.entries) {
    const verdict = await verify(e.receipt, keys, { detail: e.detail, tuple: e.tuple, process: e.process, store });
    entries.push({ id: e.receipt.id, status: e.receipt.header.status, verdict });
  }
  const complete = entries.every((x) => x.verdict.checks.every((c) => c.result === "pass"));
  return { valid: byId.has(bundle.head) && complete, head: bundle.head, entries };
}
