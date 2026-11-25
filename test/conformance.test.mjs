import { readFileSync } from "node:fs";
import * as L from "../dist/index.js";
import { conformance } from "./conformance.mjs";
const load = (f) => JSON.parse(readFileSync(new URL("../vectors/" + f, import.meta.url), "utf8"));
const results = await conformance(L, load("jcs.json"), load("receipts.json"));
const runtime = typeof Bun !== "undefined" ? "bun" : "node";
const { test, expect } = typeof Bun !== "undefined" ? await import("bun:test") : { test: (await import("node:test")).test, expect: null };
const assert = (await import("node:assert")).default;
test(`${runtime}: ${results.length} conformance vectors`, () => {
  const bad = results.filter((r) => !r.ok);
  assert.deepEqual(bad, [], bad.map((r) => r.name + " " + r.msg).join("\n"));
});
