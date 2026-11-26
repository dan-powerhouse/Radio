// Runs the same conformance vectors inside Chromium. WebCrypto needs a secure
// origin, so the bundle is served from a routed https origin, not about:blank.
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
const root = new URL("..", import.meta.url).pathname;
execSync(`bun build ${root}dist/index.js --outfile ${root}dist/browser.js --format esm --target browser`, { stdio: "ignore" });
const files = {
  "/lib.js": readFileSync(root + "dist/browser.js", "utf8"),
  "/conformance.js": readFileSync(root + "test/conformance.mjs", "utf8"),
  "/continuity-conformance.js": readFileSync(root + "test/continuity-conformance.mjs", "utf8"),
  "/bundle-v2-conformance.js": readFileSync(root + "test/bundle-v2-conformance.mjs", "utf8"),
  "/atomic-conformance.js": readFileSync(root + "test/atomic-conformance.mjs", "utf8"),
  "/process-ledger-conformance.js": readFileSync(root + "test/process-ledger-conformance.mjs", "utf8"),
  "/run-v2-conformance.js": readFileSync(root + "test/run-v2-conformance.mjs", "utf8"),
  "/scanner-conformance.js": readFileSync(root + "test/scanner-conformance.mjs", "utf8"),
  "/kernel-conformance.js": readFileSync(root + "test/kernel-conformance.mjs", "utf8"),
  "/": "<!doctype html><meta charset=utf-8><title>conformance</title>",
};
const browser = await chromium.launch();
const page = await browser.newPage();
await page.route("https://conformance.test/**", (r) => {
  const p = new URL(r.request().url()).pathname;
  r.fulfill({ status: files[p] ? 200 : 404, contentType: p.endsWith(".js") ? "text/javascript" : "text/html", body: files[p] ?? "" });
});
await page.goto("https://conformance.test/");
const jcs = JSON.parse(readFileSync(root + "vectors/jcs.json", "utf8"));
const receipts = JSON.parse(readFileSync(root + "vectors/receipts.json", "utf8"));
const fixture = name => JSON.parse(readFileSync(root + "vectors/" + name + ".json", "utf8"));
const fixtures = { expressions: fixture("expressions"), strict: fixture("strict-json"), processTypes: fixture("process-types"), recognition: fixture("recognition"), runV2: fixture("run-v2"), receiptV2: fixture("receipt-v2-contract"), testKey: fixture("test-key") };
// Playwright object serialization can alter own __proto__ keys. Pass JSON text
// and parse in the browser to preserve the exact adversarial input.
const groups = await page.evaluate(async (fixtureText) => {
  const [jcs, receipts, fixtures] = JSON.parse(fixtureText);
  const L = await import("/lib.js");
  const { conformance } = await import("/conformance.js");
  const { kernelConformance, receiptEvidenceConformance } = await import("/kernel-conformance.js");
  const { scannerConformance } = await import("/scanner-conformance.js");
  const { runV2Conformance, runV2OutcomeConformance } = await import("/run-v2-conformance.js");
  const { processLedgerConformance } = await import("/process-ledger-conformance.js");
  const { atomicConformance } = await import("/atomic-conformance.js");
  const { bundleV2Conformance } = await import("/bundle-v2-conformance.js");
  const { continuityConformance } = await import("/continuity-conformance.js");
  return { continuity: await continuityConformance(L, fixtures.testKey), bundlesV2: await bundleV2Conformance(L, fixtures.receiptV2, fixtures.runV2, receipts, fixtures.testKey), atomic: await atomicConformance(L, fixtures.testKey), instances: await processLedgerConformance(L, fixtures.receiptV2, fixtures.runV2, fixtures.testKey), runV2: [...await runV2Conformance(L, fixtures.receiptV2, fixtures.testKey), ...await runV2OutcomeConformance(L, fixtures.runV2, fixtures.testKey)], scanner: await scannerConformance(L, fixtures.recognition), legacy: await conformance(L, jcs, receipts), kernel: await kernelConformance(L, fixtures), evidence: await receiptEvidenceConformance(L, receipts) };
}, JSON.stringify([jcs, receipts, fixtures]));
const ua = await page.evaluate(() => navigator.userAgent.match(/Chrome\/[\d.]+/)?.[0]);
await browser.close();
const results = Object.values(groups).flat();
const bad = results.filter((r) => !r.ok);
console.log(`chromium (${ua}): ${results.length - bad.length}/${results.length} conformance/evidence checks pass`);
for (const [name, group] of Object.entries(groups)) console.log(name + ": " + group.filter(r => r.ok).length + "/" + group.length);
for (const b of bad) console.log("FAIL", b.name, b.msg);
process.exit(bad.length ? 1 : 0);
