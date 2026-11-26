import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import * as L from "../dist/index.js";
import {continuityConformance} from "./continuity-conformance.mjs";
const key=JSON.parse(readFileSync(new URL("../vectors/test-key.json",import.meta.url),"utf8"));
for(const r of await continuityConformance(L,key))test(r.name,()=>assert.ok(r.ok,r.msg));
