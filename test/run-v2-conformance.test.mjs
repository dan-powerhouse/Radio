import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as L from "../dist/index.js";
import { runV2Conformance, runV2OutcomeConformance } from "./run-v2-conformance.mjs";
const read = name => JSON.parse(readFileSync(new URL("../vectors/"+name+".json",import.meta.url),"utf8"));
const results = [...await runV2Conformance(L, read("receipt-v2-contract"), read("test-key")), ...await runV2OutcomeConformance(L,read("run-v2"),read("test-key"))];
for (const r of results) test(r.name, () => assert.ok(r.ok,r.msg));
