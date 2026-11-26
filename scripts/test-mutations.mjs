// A small deterministic fault-injection gate, not a statistical mutation score.
// Mutates compiled JS in isolated temporary copies, NEVER the working tree.
// Each mutant must be rejected by its specific named test, not just crash.
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { kernelConformance, receiptEvidenceConformance } from "../test/kernel-conformance.mjs";
const root = fileURLToPath(new URL("..", import.meta.url));
const load = name => JSON.parse(readFileSync(join(root, "vectors", name + ".json"), "utf8"));
const fixtures = { expressions: load("expressions"), strict: load("strict-json"), processTypes: load("process-types") };
const receipts = load("receipts");
const run = async L => [...await kernelConformance(L, fixtures), ...await receiptEvidenceConformance(L, receipts)];
const baseline = await run(await import("../dist/index.js"));
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
    const results = await run(await import(pathToFileURL(join(dir, "dist/index.js")).href));
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
