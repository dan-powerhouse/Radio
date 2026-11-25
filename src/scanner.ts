import { LoglineError } from "./errors.js";
import { evaluate, Budget } from "./expr.js";
import { hashOf, HASH_RE } from "./hash.js";
import { parseStrict } from "./strict.js";
import { MAX_LAW_BYTES, parseProcessType, ProcessType, RegistrySnapshot, validateRegistrySnapshot } from "./process-type.js";

// Reference admission profile, distinct from the versioned operation budget.
// These are not claims about cloud capacity or universal protocol maxima.
export const MAX_SCAN_INPUT_BYTES = 65_536;
export const MAX_SCAN_SNAPSHOT_BYTES = 524_288;
export const MAX_SCAN_LAWS = 4096;
export const MAX_SCAN_LAW_BYTES = 16_777_216;
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
  if (bytes(tupleJson) > MAX_SCAN_INPUT_BYTES) limit("tuple bytes");
  const tuple = parseStrict(tupleJson);
  if (bytes(registryJson) > MAX_SCAN_SNAPSHOT_BYTES) limit("snapshot bytes");
  let snapshot: RegistrySnapshot;
  try {
    const value = parseStrict(registryJson);
    validateRegistrySnapshot(value);
    snapshot = value;
  } catch (err) {
    if (!(err instanceof LoglineError)) throw err;
    return invalid("malformed registry snapshot");
  }
  if (!HASH_RE.test(registryHash)) invalid("malformed registry address");
  if (snapshot.types.length > MAX_SCAN_LAWS) limit("registry law count");
  const captured: [string, string][] = [];
  let totalBytes = 0;
  for (const hash of snapshot.types) {
    const text = lawJsonByHash.get(hash);
    if (text === undefined) throw new LoglineError("scan_registry_missing", "missing law " + hash);
    const size = bytes(text);
    if (size > MAX_LAW_BYTES) invalid("oversized law " + hash);
    totalBytes += size;
    if (totalBytes > MAX_SCAN_LAW_BYTES) limit("total law bytes");
    captured.push([hash, text]);
  }
  if (await hashOf(snapshot) !== registryHash) invalid("registry address mismatch");

  // Validate ALL referenced evidence before evaluating any predicate, even if
  // a later candidate would be beyond the logical recognition budget.
  const laws: [string, ProcessType][] = [];
  const ids = new Set<string>();
  for (const [hash, text] of captured) {
    let law: ProcessType;
    try { law = parseProcessType(text); }
    catch (err) {
      if (!(err instanceof LoglineError)) throw err;
      return invalid("invalid law " + hash);
    }
    if (await hashOf(law) !== hash) invalid("law address mismatch " + hash);
    if (ids.has(law.id)) invalid("duplicate active law id " + law.id);
    ids.add(law.id);
    laws.push([hash, law]);
  }

  const budget: Budget = { left: snapshot.scan_ops };
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
  const evidence = { matches, diagnostics, ops_used: snapshot.scan_ops - Math.max(0, budget.left) };
  if (diagnostics.length) return { outcome: "indeterminate", selected: null, ...evidence };
  if (matches.length === 1) return { outcome: "unique", selected: matches[0], ...evidence };
  return { outcome: matches.length === 0 ? "none" : "ambiguous", selected: null, ...evidence };
}
