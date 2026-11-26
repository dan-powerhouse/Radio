import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import * as L from "../dist/index.js";
import {bundleV2Conformance} from "./bundle-v2-conformance.mjs";
const read=name=>JSON.parse(readFileSync(new URL("../vectors/"+name+".json",import.meta.url),"utf8"));
for(const r of await bundleV2Conformance(L,read("receipt-v2-contract"),read("run-v2"),read("receipts"),read("test-key")))
 test(r.name,()=>assert.ok(r.ok,r.msg));
