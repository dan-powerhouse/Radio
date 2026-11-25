import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as L from "../dist/index.js";
import { kernelConformance, receiptEvidenceConformance } from "./kernel-conformance.mjs";
const load = name => JSON.parse(readFileSync(new URL("../vectors/" + name + ".json", import.meta.url), "utf8"));
const results = [...await kernelConformance(L, { expressions: load("expressions"), strict: load("strict-json"), processTypes: load("process-types") }), ...await receiptEvidenceConformance(L, load("receipts"))];
for (const r of results) test(r.name, () => assert.ok(r.ok, r.msg));
