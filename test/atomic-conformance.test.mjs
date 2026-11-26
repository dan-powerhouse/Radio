import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import * as L from "../dist/index.js";
import {atomicConformance} from "./atomic-conformance.mjs";
const fixture=JSON.parse(readFileSync(new URL("../vectors/test-key.json",import.meta.url),"utf8"));
for(const r of await atomicConformance(L,fixture))test(r.name,()=>assert.ok(r.ok,r.msg));
