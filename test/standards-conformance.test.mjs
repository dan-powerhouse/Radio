import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as L from "../dist/index.js";
import { standardsConformance } from "./standards-conformance.mjs";

const fixture = JSON.parse(readFileSync(new URL("../vectors/standards.json", import.meta.url), "utf8"));
for (const r of await standardsConformance(L, fixture)) test(r.name, () => assert.ok(r.ok, r.msg));
