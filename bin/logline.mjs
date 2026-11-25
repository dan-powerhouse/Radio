#!/usr/bin/env node
// logline verify-bundle <bundle.json> [--keys keys.json]
// Verifies a receipt and its whole trajectory offline. Without --keys it uses the
// keys inside the bundle and says so: compare the key id with the machine's published one.
import { readFileSync } from "node:fs";
import * as L from "../dist/index.js";

const [cmd, file, ...rest] = process.argv.slice(2);
if (cmd !== "verify-bundle" || !file) { console.error("usage: logline verify-bundle <bundle.json> [--keys keys.json]"); process.exit(2); }
const bundle = JSON.parse(readFileSync(file, "utf8"));
const ki = rest.indexOf("--keys");
const keys = ki >= 0 ? JSON.parse(readFileSync(rest[ki + 1], "utf8")).keys : bundle.keys;
if (ki < 0) console.log(`! keys taken from the bundle itself: ${Object.keys(keys).join(", ")}\n  Check this against the issuer's /.well-known/logline.json, or pass --keys.`);
const v = await L.verifyBundle(bundle, keys);
for (const e of v.entries) {
  const failed = e.verdict.checks.filter((c) => c.result !== "pass");
  const h = bundle.entries.find((x) => x.receipt.id === e.id).receipt.header;
  console.log(`${failed.length ? "✗" : "✓"} ${h.frequency.padEnd(34)} ${h.status.padEnd(10)} ${e.id.slice(0, 19)}…${failed.map((c) => `  [${c.code}: ${c.note}]`).join("")}`);
}
console.log(v.valid ? `\nVALID: ${v.entries.length} receipts, every one re-run by hash.` : "\nINVALID");
process.exit(v.valid ? 0 : 1);
