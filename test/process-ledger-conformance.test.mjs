import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import * as L from "../dist/index.js";
import {processLedgerConformance} from "./process-ledger-conformance.mjs";
const read=name=>JSON.parse(readFileSync(new URL("../vectors/"+name+".json",import.meta.url),"utf8"));
for(const r of await processLedgerConformance(L,read("receipt-v2-contract"),read("run-v2"),read("test-key")))
  test(r.name,()=>assert.ok(r.ok,r.msg));
