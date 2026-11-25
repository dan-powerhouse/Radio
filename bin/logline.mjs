#!/usr/bin/env node
// logline verify-bundle <bundle.json|url> [--keys keys.json|url]
// Verifies a receipt and its whole trajectory offline. Without --keys it uses the
// keys inside the bundle and says so: compare the key id with the machine's published one.
// URLs are fetched; a bundle URL sends LOGLINE_TOKEN as a bearer token when it is set.
// For a bundle on https://host/receipts/<id>/bundle, --keys https://host is enough.
import { readFileSync } from "node:fs";
import * as L from "../dist/index.js";

const [cmd, file, ...rest] = process.argv.slice(2);
if (cmd !== "verify-bundle" || !file) { console.error("usage: logline verify-bundle <bundle.json> [--keys keys.json]"); process.exit(2); }
const isUrl = (s) => /^https?:\/\//.test(s);
async function get(where, auth) {
  if (!isUrl(where)) return JSON.parse(readFileSync(where, "utf8"));
  const res = await fetch(where, { headers: auth && process.env.LOGLINE_TOKEN ? { authorization: `Bearer ${process.env.LOGLINE_TOKEN}` } : {} });
  if (!res.ok) { console.error(`${where}: HTTP ${res.status} ${await res.text()}`); process.exit(2); }
  return res.json();
}
const bundle = await get(file, true);
const ki = rest.indexOf("--keys");
let keysAt = ki >= 0 ? rest[ki + 1] : null;
if (keysAt && isUrl(keysAt) && !keysAt.endsWith(".json")) keysAt = new URL("/.well-known/logline.json", keysAt).href;
const keys = keysAt ? (await get(keysAt, false)).keys : bundle.keys;
if (ki < 0) console.log(`! keys taken from the bundle itself: ${Object.keys(keys).join(", ")}\n  Check this against the issuer's /.well-known/logline.json, or pass --keys.`);
const v = await L.verifyBundle(bundle, keys);
for (const e of v.entries) {
  const failed = e.verdict.checks.filter((c) => c.result !== "pass");
  const h = bundle.entries.find((x) => x.receipt.id === e.id).receipt.header;
  console.log(`${failed.length ? "✗" : "✓"} ${h.frequency.padEnd(34)} ${h.status.padEnd(10)} ${e.id.slice(0, 19)}…${failed.map((c) => `  [${c.code}: ${c.note}]`).join("")}`);
}
console.log(v.valid ? `\nVALID: ${v.entries.length} receipts, every one re-run by hash.` : "\nINVALID");
process.exit(v.valid ? 0 : 1);
