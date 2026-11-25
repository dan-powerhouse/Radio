#!/usr/bin/env node
// logline-server serve   [--data DIR] [--port 8080] [--host 127.0.0.1] [--publish DIR] [--replay]
// logline-server account [--data DIR] NAME [--admin]     prints a new bearer token, once
// logline-server head    [--data DIR]                    checks the log offline and prints its head
import fs from "node:fs";
import path from "node:path";
import { openMachine, readLog } from "../server/store.mjs";
import { createServer } from "../server/http.mjs";
import * as L from "../dist/index.js";

const [cmd, ...argv] = process.argv.slice(2);
const flags = {}, args = [];
for (let i = 0; i < argv.length; i++) {
  if (!argv[i].startsWith("--")) { args.push(argv[i]); continue; }
  const k = argv[i].slice(2);
  flags[k] = ["admin", "replay"].includes(k) ? true : argv[++i];
}
const dir = path.resolve(flags.data ?? process.env.LOGLINE_DATA ?? "./data");
const usage = () => { console.error(fs.readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(1, 4).map((l) => l.slice(3)).join("\n")); process.exit(2); };

if (cmd === "account") {
  if (args.length !== 1) usage();
  const m = await openMachine(dir);
  const token = m.accounts.add(args[0], { admin: !!flags.admin });
  console.log(`account ${args[0]}${flags.admin ? " (admin)" : ""}, on air as ${await m.pseudonym(args[0])}`);
  console.log(`token (shown once, keep it secret): ${token}`);
} else if (cmd === "head") {
  const { head, records } = await readLog(path.join(dir, "ledger.jsonl"));
  console.log(JSON.stringify({ ...head, records: records.length }));
} else if (cmd === "serve") {
  const m = await openMachine(dir, { replay: !!flags.replay });
  if (m.repaired) console.warn("! dropped a torn last line left by a crash; it was never acknowledged");
  if (flags.publish) {
    const have = new Map(m.ledger.published().map((p) => [p.id, p.hash]));
    for (const f of fs.readdirSync(flags.publish).filter((f) => f.endsWith(".json")).sort()) {
      const p = L.parseStrict(fs.readFileSync(path.join(flags.publish, f), "utf8"));
      const h = await L.hashOf(p);
      if (!have.has(p.id)) console.log(`published ${p.id}  ${await m.ledger.publish(p)}`);
      else if (have.get(p.id) !== h) console.warn(`! ${f}: ${p.id} is already published with a different hash; amend it under a new id`);
    }
  }
  const server = createServer(m);
  const port = Number(flags.port ?? process.env.PORT ?? 8080), host = flags.host ?? process.env.HOST ?? "127.0.0.1";
  server.listen(port, host, () => {
    const keyId = Object.keys(m.ledger.keys)[0];
    console.log(`logline machine on http://${host}:${port}  data=${dir}  receipts=${m.ledger.length}  key=${keyId.slice(0, 23)}…`);
  });
  const stop = async () => { await server.shutdown(); m.close(); process.exit(0); };
  process.on("SIGINT", stop); process.on("SIGTERM", stop);
} else usage();
