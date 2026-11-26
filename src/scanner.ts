import { LoglineError } from "./errors.js";
import { evaluate, Budget } from "./expr.js";
import { hashOf, HASH_RE } from "./hash.js";
import { parseStrict } from "./strict.js";
import { MAX_LAW_BYTES, parseProcessType, ProcessType, RegistrySnapshot, validateRegistrySnapshot } from "./process-type.js";

import { MAX_EVAL_WORK, MAX_SCAN_INPUT_BYTES, MAX_SCAN_SNAPSHOT_BYTES, MAX_SCAN_LAWS, MAX_SCAN_LAW_BYTES } from "./profile.js";
export { MAX_SCAN_INPUT_BYTES, MAX_SCAN_SNAPSHOT_BYTES, MAX_SCAN_LAWS, MAX_SCAN_LAW_BYTES } from "./profile.js";
const bytes = (text: string) => new TextEncoder().encode(text).length;
const invalid = (message: string): never => {
  throw new LoglineError("scan_registry_invalid", message);
};
const limit = (message: string): never => {
  throw new LoglineError("scan_limit", message);
};
export type ScanDiagnostic = { law_hash: string; code: string };
type ScanEvidence = { matches: string[]; diagnostics: ScanDiagnostic[]; ops_used: number };
export type ScanResult = ScanEvidence & (
  | { outcome: "unique"; selected: string }
  | { outcome: "none" | "ambiguous" | "indeterminate"; selected: null }
);

/**
 * Recognition only. All inputs are immutable JSON text except the evidence map;
 * its referenced values are captured before the first await. The caller must
 * obtain the authoritative snapshot at admission (or from signed replay context).
 * This function verifies content integrity, NOT the authority/freshness of a
 * supplied snapshot. It cannot admit a request, execute a RUN or issue a receipt.
 */
export async function scan(tupleJson: string, registryHash: string, registryJson: string,
  lawJsonByHash: ReadonlyMap<string, string>): Promise<ScanResult> {
  if (tupleJson.length > MAX_SCAN_INPUT_BYTES || bytes(tupleJson) > MAX_SCAN_INPUT_BYTES) limit("tuple bytes");
  const tuple = parseStrict(tupleJson);
  const laws = new Map(lawJsonByHash);
  return new RegistryEvidence(() => registryJson, hash => laws.get(hash)).recognize(tuple, registryHash);
}

/** Private to a request or bundle verification. Readers provide immutable
 * text for that lifetime; both success and failure are memoized per address. */
export class RegistryEvidence {
  #snapshots = new Map<string, Promise<RegistrySnapshot>>();
  #texts = new Map<string, {text: string; size: number}>();
  #laws = new Map<string, Promise<ProcessType>>();
  #registries = new Map<string, Promise<[string, ProcessType][]>>();

  constructor(
    private readonly readSnapshot: (hash: string) => string | undefined,
    private readonly readLaw: (hash: string) => string | undefined,
  ) {}

  snapshot(hash: string): Promise<RegistrySnapshot> {
    let result = this.#snapshots.get(hash);
    if (!result) {
      result = this.#loadSnapshot(hash);
      this.#snapshots.set(hash, result);
    }
    return result;
  }

  async #loadSnapshot(registryHash: string): Promise<RegistrySnapshot> {
    const json = this.readSnapshot(registryHash);
    if (json === undefined) return invalid("missing registry snapshot");
    if (json.length > MAX_SCAN_SNAPSHOT_BYTES || bytes(json) > MAX_SCAN_SNAPSHOT_BYTES) limit("snapshot bytes");
    let snapshot: RegistrySnapshot;
    try {
      const value = parseStrict(json);
      validateRegistrySnapshot(value);
      snapshot = value;
    } catch (err) {
      if (!(err instanceof LoglineError)) throw err;
      return invalid("malformed registry snapshot");
    }
    if (!HASH_RE.test(registryHash)) invalid("malformed registry address");
    if (snapshot.types.length > MAX_SCAN_LAWS) limit("registry law count");
    if (await hashOf(snapshot) !== registryHash) invalid("registry address mismatch");
    return snapshot;
  }

  #lawText(hash: string): {text: string; size: number} {
    const cached = this.#texts.get(hash);
    if (cached) return cached;
    const text = this.readLaw(hash);
    if (text === undefined) throw new LoglineError("scan_registry_missing", "missing law " + hash);
    if (text.length > MAX_LAW_BYTES) invalid("oversized law " + hash);
    const size = bytes(text);
    if (size > MAX_LAW_BYTES) invalid("oversized law " + hash);
    const result = {text, size};
    this.#texts.set(hash, result);
    return result;
  }

  async #loadLaw(hash: string): Promise<ProcessType> {
    const {text} = this.#lawText(hash);
    let law: ProcessType;
    try { law = parseProcessType(text); }
    catch (err) {
      if (!(err instanceof LoglineError)) throw err;
      return invalid("invalid law " + hash);
    }
    if (await hashOf(law) !== hash) invalid("law address mismatch " + hash);
    return law;
  }

  law(hash: string): Promise<ProcessType> {
    let result = this.#laws.get(hash);
    if (!result) {
      result = this.#loadLaw(hash);
      this.#laws.set(hash, result);
    }
    return result;
  }

  async #loadRegistry(hash: string): Promise<[string, ProcessType][]> {
    const snapshot = await this.snapshot(hash);
    const laws: [string, ProcessType][] = [];
    let totalBytes = 0;
    const ids = new Set<string>();
    for (const hash of snapshot.types) {
      totalBytes += this.#lawText(hash).size;
      if (totalBytes > MAX_SCAN_LAW_BYTES) limit("total law bytes");
    }
    for (const hash of snapshot.types) {
      const law = await this.law(hash);
      if (ids.has(law.id)) invalid("duplicate active law id " + law.id);
      ids.add(law.id);
      laws.push([hash, law]);
    }
    return laws;
  }

  prepare(hash: string): Promise<[string, ProcessType][]> {
    let prepared = this.#registries.get(hash);
    if (!prepared) {
      prepared = this.#loadRegistry(hash);
      this.#registries.set(hash, prepared);
    }
    return prepared;
  }

  async recognize(tuple: unknown, hash: string, chargeReplay?: (work: number) => void): Promise<ScanResult> {
    const snapshot = await this.snapshot(hash);
    const laws = await this.prepare(hash);
    const budget: Budget = { left: snapshot.scan_ops, work: MAX_EVAL_WORK };
    const matches: string[] = [], diagnostics: ScanDiagnostic[] = [];
    for (const [hash, law] of laws) {
      if (budget.left === 0) {
        diagnostics.push({ law_hash: hash, code: "eval_budget" });
        break;
      }
      budget.left--; // charge even a literal predicate
      try {
        const recognized = evaluate(law.recognize, { tuple, machine: {} }, budget);
        if (recognized === true) matches.push(hash);
        else if (recognized !== false) diagnostics.push({ law_hash: hash, code: "recognize_non_boolean" });
      } catch (err) {
        if (!(err instanceof LoglineError) || !err.code.startsWith("eval_")) throw err;
        diagnostics.push({ law_hash: hash, code: err.code });
        if (err.code === "eval_budget") break;
      }
    }
    chargeReplay?.(MAX_EVAL_WORK - Math.max(0, budget.work!));
    const evidence = { matches, diagnostics, ops_used: snapshot.scan_ops - Math.max(0, budget.left) };
    if (diagnostics.length) return { outcome: "indeterminate", selected: null, ...evidence };
    if (matches.length === 1) return { outcome: "unique", selected: matches[0], ...evidence };
    return { outcome: matches.length === 0 ? "none" : "ambiguous", selected: null, ...evidence };
  }
}
