import { cpSync, rmSync } from "node:fs";
const dest = new URL("../supabase/functions/_shared/core/", import.meta.url);
rmSync(dest, { recursive: true, force: true });
cpSync(new URL("../dist/", import.meta.url), dest, { recursive: true, filter: f => !f.endsWith(".d.ts") && !f.endsWith("browser.js") });
