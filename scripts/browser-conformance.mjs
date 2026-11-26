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
const fixtures = { expressions: fixture("expressions"), strict: fixture("strict-json"), processTypes: fixture("process-types") };
// Playwright object serialization can alter own __proto__ keys. Pass JSON text
// and parse in the browser to preserve the exact adversarial input.
const groups = await page.evaluate(async (fixtureText) => {
  const [jcs, receipts, fixtures] = JSON.parse(fixtureText);
  const L = await import("/lib.js");
  const { conformance } = await import("/conformance.js");
  const { kernelConformance, receiptEvidenceConformance } = await import("/kernel-conformance.js");
  return { legacy: await conformance(L, jcs, receipts), kernel: await kernelConformance(L, fixtures), evidence: await receiptEvidenceConformance(L, receipts) };
}, JSON.stringify([jcs, receipts, fixtures]));
const ua = await page.evaluate(() => navigator.userAgent.match(/Chrome\/[\d.]+/)?.[0]);
await browser.close();
const results = Object.values(groups).flat();
const bad = results.filter((r) => !r.ok);
console.log(`chromium (${ua}): ${results.length - bad.length}/${results.length} conformance/evidence checks pass`);
for (const [name, group] of Object.entries(groups)) console.log(name + ": " + group.filter(r => r.ok).length + "/" + group.length);
for (const b of bad) console.log("FAIL", b.name, b.msg);
process.exit(bad.length ? 1 : 0);
