// Builds release/logline-receipt.zip: tracked files plus prebuilt dist/.
import { execSync } from "node:child_process";
const root = new URL("..", import.meta.url).pathname;
const sh = (c) => execSync(c, { cwd: root, stdio: "pipe" }).toString();
sh("npx tsc -p .");
sh("mkdir -p release && rm -f release/logline-receipt.zip");
const files = sh("git ls-files").trim().split("\n").concat(sh("ls dist/*.js dist/*.d.ts").trim().split("\n").filter((f) => !f.endsWith("browser.js")));
sh(`zip -q -X release/logline-receipt.zip ${files.map((f) => `'${f}'`).join(" ")}`);
console.log(`release/logline-receipt.zip  ${files.length} files  ${sh("git rev-parse --short HEAD").trim()}`);
