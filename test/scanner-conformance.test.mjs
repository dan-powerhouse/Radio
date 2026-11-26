import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as L from "../dist/index.js";
import { scannerConformance } from "./scanner-conformance.mjs";
const fixture = JSON.parse(readFileSync(new URL("../vectors/recognition.json", import.meta.url), "utf8"));
const results = await scannerConformance(L, fixture);
for (const r of results) test(r.name, () => assert.ok(r.ok, r.msg));
