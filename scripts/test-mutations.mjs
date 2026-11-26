import { boundaryHardeningConformance } from "../test/boundary-hardening-conformance.mjs";
// A small deterministic fault-injection gate, not a statistical mutation score.
// Mutates compiled JS in isolated temporary copies, NEVER the working tree.
// Each mutant must be rejected by its specific named test, not just crash.
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { kernelConformance, receiptEvidenceConformance } from "../test/kernel-conformance.mjs";
import { continuityConformance } from "../test/continuity-conformance.mjs";
import { bundleV2Conformance } from "../test/bundle-v2-conformance.mjs";
import { atomicConformance } from "../test/atomic-conformance.mjs";
import { processLedgerConformance } from "../test/process-ledger-conformance.mjs";
import { runV2Conformance, runV2OutcomeConformance } from "../test/run-v2-conformance.mjs";
import { scannerConformance } from "../test/scanner-conformance.mjs";
const root = fileURLToPath(new URL("..", import.meta.url));
const load = name => JSON.parse(readFileSync(join(root, "vectors", name + ".json"), "utf8"));
const fixtures = { expressions: load("expressions"), strict: load("strict-json"), processTypes: load("process-types") };
const receipts = load("receipts");
const recognition = load("recognition");
const runV2Fixture = load("run-v2"), receiptV2Fixture = load("receipt-v2-contract"), testKey = load("test-key");
const run = async (L, includeLedger=false) => [...await kernelConformance(L, fixtures), ...await receiptEvidenceConformance(L, receipts), ...await scannerConformance(L, recognition), ...await runV2Conformance(L,receiptV2Fixture,testKey), ...await runV2OutcomeConformance(L,runV2Fixture,testKey), ...(includeLedger ? await processLedgerConformance(L,receiptV2Fixture,runV2Fixture,testKey) : [])];
const baselineLibrary=await import("../dist/index.js");
const baseline = [...await run(baselineLibrary,true),...await atomicConformance(baselineLibrary,testKey),...await bundleV2Conformance(baselineLibrary,receiptV2Fixture,runV2Fixture,receipts,testKey),...await continuityConformance(baselineLibrary,testKey)];
assert.deepEqual(baseline.filter(x => !x.ok), [], "clean baseline must pass");
const mutations = [
  ["inherited operator", "expr.js", "Object.prototype.hasOwnProperty.call(LAZY, op)", "op in LAZY", "expr/inherited-op-constructor"],
  ["inherited path", "expr.js", "!Object.prototype.hasOwnProperty.call(cur, k)", "!(k in cur)", "expr/has-inherited"],
  ["coercive equality", "expr.js", ": a === b;", ": a == b;", "expr/eq-no-coercion"],
  ["coercive conjunction", "expr.js", "if (evaluate(x, s, b, d + 1) !== true)", "if (!evaluate(x, s, b, d + 1))", "expr/and-no-coercion"],
  ["unbounded operations", "expr.js", "if (--budget.left < 0)", "if (false)", "expr/exhausted-budget"],
  ["missing var arity", "expr.js", 'arity(1, "var", args);', "/* no arity */", "expr/var-extra-argument"],
  ["duplicate key accepted", "strict.js", "if (Object.prototype.hasOwnProperty.call(o, k))", "if (false)", "strict/duplicate-escape"],
  ["unsafe exponent accepted", "strict.js", "Number.isInteger(n) && !Number.isSafeInteger(n)", "!m[2] && !m[3] && !Number.isSafeInteger(n)", "strict/unsafe-exp"],
  ["dead branches unchecked", "process-type.js", "args.forEach((x, i) => expression(x, allowed, path + \".\" + op + \".\" + i, depth + 1));", "/* skip static recursion */", "type/unknown-dead-branch"],
  ["scanner reads authority", "process-type.js", 'expression(law.recognize, p => !p.startsWith("$"), "recognize");', 'expression(law.recognize, p => true, "recognize");', "type/machine-recognition"],
  ["duplicate publication rebound", "process-type.js", "if (previous !== hash)", "if (false)", "registry/4/publish"],
  ["retired law resurrected", "process-type.js", "return hash; // idempotent, including after retirement", "this.#active.add(hash); return hash;", "registry/10/snapshot"],
  ["historical law discarded", "process-type.js", "this.#active.delete(hash);", "this.#active.delete(hash); this.#laws.delete(hash);", "registry/11/historical-law"],
  ["snapshot depends on publication order", "process-type.js", "[...this.#active].sort()", "[...this.#active]", "registry/15/snapshot"],
  ["signature check bypassed", "verify.js", "await verifyId(k.jwk, r.id, r.sig.value)", "true", "evidence/signature-bit-change"],
  ["scanner returns first match", "scanner.js", "matches.push(hash);", "{ matches.push(hash); break; }", "scan/later-match-not-skipped"],
  ["scanner promotes partial match", "scanner.js", "if (diagnostics.length)", "if (diagnostics.length && matches.length === 0)", "scan/partial-match-not-authority"],
  ["scanner ignores non-boolean predicate", "scanner.js", 'else if (recognized !== false)', 'else if (false)', "scan/error-before-match"],
  ["scanner does not charge candidate", "scanner.js", "budget.left--; // charge even a literal predicate", "/* no candidate charge */", "scan/literal-true"],
  ["scanner resets shared budget", "scanner.js", "budget.left--; // charge even a literal predicate", "budget.left = snapshot.scan_ops - 1;", "scan/shared-operator-budget"],
  ["scanner ignores predicate errors", "scanner.js", "diagnostics.push({ law_hash: hash, code: err.code });", "/* swallow predicate errors */", "scan/match-plus-error"],
  ["scanner skips registry address verification", "scanner.js", "if (await hashOf(snapshot) !== registryHash)", "if (false)", "scan/wrong-snapshot-hash"],
  ["scanner skips law address verification", "scanner.js", "if (await hashOf(law) !== hash)", "if (false)", "scan/valid-law-wrong-address"],
  ["scanner permits active id collision", "scanner.js", "if (ids.has(law.id))", "if (false)", "scan/duplicate-active-id"],
  ["scanner accepts unordered registry", "process-type.js", "h <= previous", "false", "scan/reversed-hashes"],

  ["v2 checks accept truthy values", "run-v2.js", "evaluate(s.check, scope, budget) === true ?", "evaluate(s.check, scope, budget) ?", "run-v2/truthy-not-ok"],
  ["v2 doubt outranks not", "run-v2.js", 'findings.some(f => f.result === "not") ? "not" : findings.some(f => f.result === "doubt") ? "doubt" : "ok"', 'findings.some(f => f.result === "doubt") ? "doubt" : findings.some(f => f.result === "not") ? "not" : "ok"', "run-v2/not-precedes-doubt"],
  ["v2 grants evaluated after rejection", "run-v2.js", "else if (run.grants) {", "if (run.grants) {", "run-v2/not-precedes-doubt"],
  ["v2 trusts tuple actor", "run-v2.js", "by, instance, parents, cites } };", "by: tuple.who, instance, parents, cites } };", "run-v2/attested-not-tuple-identity"],
  ["v2 accepts foreign parent instance", "run-v2.js", "e.header.run !== role || effectiveInstance(e) !== instance", "e.header.run !== role", "run-v2/cross-instance-parent"],
  ["v2 uses current registry for continuation", "run-v2.js", "registry = root.header.registry_hash;", "registry = registryHash;", "run-v2/retired-law-continuation"],
  ["v2 skips completion observation", "run-v2.js", "if (conflict !== null)", "if (false)", "run-v2/completed-before-requires"],
  ["v2 ignores spent claims", "run-v2.js", "if (consumed)", "if (false)", "run-v2/spent-citation"],
  ["v2 confuses once slots", "run-v2.js", "await spent(lawHash, slot, id)", 'await spent(lawHash, "one", id)', "run-v2/once-slot-scope"],
  ["v2 wrong signature domain", "keys.js", 'SIGNING_DOMAIN_V2 = "logline-receipt-v2:"', 'SIGNING_DOMAIN_V2 = "logline-receipt-v1:"', "run-v2/entry-A"],

  ["ledger forgets completed RUN", "process-ledger.js", "this.#success.set(prepared.success, entry.receipt.id);", "void 0;", "instance/completed-before-requires"],
  ["ledger forgets submission key", "process-ledger.js", "this.#submissions.set(submissionKey, { requestHash: entry.context.request_hash, id: entry.receipt.id });", "void 0;", "instance/retry-after-retirement"],
  ["ledger retirement lost", "process-ledger.js", "this.#registry.retire(id);", "void 0;", "instance/no-match"],
  ["ledger skips receipt persistence", "process-ledger.js", 'await this.#write({ kind: "receipt-v2", entry, admission_snapshot: s.snapshot });', "void 0;", "instance/restart-history"],
  ["ledger forgets consumption", "process-ledger.js", "this.#consumed.add(k);", "void 0;", "instance/once-scope-after-restart"],

  ["atomic removes writer serialization", "process-ledger.js", "this.#tail.then(async () => {", "Promise.resolve().then(async () => {", "atomic/concurrent-retry"],
  ["atomic publishes before sink acknowledgement", "process-ledger.js", 'await this.#write({ kind: "receipt-v2", entry, admission_snapshot: s.snapshot });\n            this.#adoptEntry(entry, submissionKey, prepared);', 'this.#adoptEntry(entry, submissionKey, prepared);\n            await this.#write({ kind: "receipt-v2", entry, admission_snapshot: s.snapshot });', "atomic/not-visible-before-ack"],
  ["atomic continues after ambiguous sink error", "process-ledger.js", "if (this.#failed)", "if (false)", "atomic/failed-write-no-phantom"],
  ["atomic exposes recovery prefix", "process-ledger.js", "if (this.#restoring)", "if (false)", "atomic/recovery-visibility"],

  ["bundle trusts its own keys", "bundle-v2.js", "keys = parseStrict(canonicalize(trustedKeys));", "keys = b.keys;", "bundle-v2/untrusted-convenience-keys"],
  ["bundle accepts signed wrong decision", "bundle-v2.js", "if (again.id !== id || !same(again.header, h) || !same(again.detail, detail) || !same(again.context, c))", "if (false)", "bundle-v2/signed-wrong-projection"],
  ["bundle omits recursive verification", "bundle-v2.js", "await walk(dep);", "void dep;", "bundle-v2/missing-parent-tuple"],
  ["bundle treats extra objects as admitted", "bundle-v2.js", "resolved.has(ref) || ref === c.completed ? read(ref) : null", "Object.hasOwn(b.objects, ref) ? read(ref) : null", "bundle-v2/outcome/denied-root"],
  ["bundle ignores conflicting claims", "bundle-v2.js", "if (set.has(k)) {", "if (false) {", "bundle-v2/conflicting-success-closure"],

  ["continuity omits historical catch-up", "process-ledger.js", "if (afterSeq !== undefined)", "if (false)", "continuity/replacement-catchup"],
  ["continuity ignores live cursor", "process-ledger.js", "entry.seq > l.after && tuned(l.tuning, entry.receipt.header)", "tuned(l.tuning, entry.receipt.header)", "continuity/future-cursor-no-rewind"],
  ["continuity ignores history tuning", "process-ledger.js", "if (tuned(tuning, e.receipt.header))", "if (true)", "continuity/filtered-gap"],

  ["I-JSON accepts BMP noncharacters", "strict.js", "(h >= 0xfdd0 && h <= 0xfdef) || h >= 0xfffe", "false", "hardening/unicode-noncharacters"],
  ["I-JSON accepts supplementary noncharacters", "strict.js", "(l & 0x3ff) >= 0x3fe && ((h - 0xd800) & 0x3f) === 0x3f", "false", "hardening/unicode-noncharacters"],
  ["add_days accepts expanded years", "expr.js", "!(t >= FIRST_DAY && t <= LAST_DAY)", "!Number.isFinite(t)", "hardening/four-digit-calendar"],
  ["concat omits preflight", "expr.js", "if (bytes > space)", "if (false)", "hardening/concat-before-allocation"],
  ["array omits preflight", "expr.js", "size += inspect(value, budget, MAX_EVAL_VALUE_BYTES - size);", "size++;", "hardening/array-before-serialization"],
  ["scanner resets work per law", "scanner.js", "budget.left--; // charge even a literal predicate", "budget.left--; budget.work = MAX_EVAL_WORK;", "hardening/shared-scanner-work"],
  ["RUN omits work bounds", "run-v2.js", "work: MAX_EVAL_WORK", "work: null", "hardening/run-amplification-is-doubt"],
  ["public receipt limit omits one byte", "run-v2.js", "MAX_PUBLIC_RECEIPT_BYTES, tooLarge, 65", "MAX_PUBLIC_RECEIPT_BYTES + 1, tooLarge, 65", "hardening/signed-receipt-byte-limit"],

];
let failed = 0;
for (const [name, file, from, to, killer] of mutations) {
  const dir = mkdtempSync(join(tmpdir(), "radio-mutant-"));
  try {
    writeFileSync(join(dir, "package.json"), '{"type":"module"}');
    cpSync(join(root, "dist"), join(dir, "dist"), { recursive: true });
    const target = join(dir, "dist", file), source = readFileSync(target, "utf8");
    if (source.split(from).length !== 2) throw Error("mutation anchor missing or ambiguous: " + file);
    writeFileSync(target, source.replace(from, to));
    const library=await import(pathToFileURL(join(dir, "dist/index.js")).href);
    const results = killer.startsWith("hardening/") ? await boundaryHardeningConformance(library,testKey,killer) : killer.startsWith("continuity/") ? await continuityConformance(library,testKey) : killer.startsWith("bundle-v2/") ? await bundleV2Conformance(library,receiptV2Fixture,runV2Fixture,receipts,testKey) : killer.startsWith("atomic/") ? await atomicConformance(library,testKey,killer) : await run(library,file === "process-ledger.js");
    const observed = results.find(r => r.name === killer);
    if (!observed || observed.ok) {
      console.error("SURVIVED", name, "expected killer", killer); failed++;
    } else {
      console.log("DETECTED", name, "by", killer);
    }
  } catch (err) {
    // Invalid mutant/runner failure is NOT counted as detected.
    console.error("INVALID", name, err.message); failed++;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
console.log("Targeted mutations: " + (mutations.length - failed) + "/" + mutations.length + " detected by expected cases");
process.exitCode = failed ? 1 : 0;
