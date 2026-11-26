// The durable ledger: one append-only file of hash-chained lines, plus the
// machine's secrets. Node only; the library supplies versioned reference ledgers.
//
//   <dir>/ledger.jsonl       one JCS line per record: {"n":1,"prev":null|"sha256:…","rec":{…}}
//   <dir>/machine-key.json   the Ed25519 private JWK (mode 0600)
//   <dir>/secret.key         the pseudonym secret, 32 bytes hex (mode 0600)
//   <dir>/accounts.json      sha256(token) -> { account, admin }
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import * as L from "../dist/index.js";

const LOG = "ledger.jsonl";

function readSecretFile(file, make) {
  if (!fs.existsSync(file)) fs.writeFileSync(file, make(), { mode: 0o600, flag: "wx" });
  return fs.readFileSync(file, "utf8");
}

/** Read the log, check the chain, and drop a torn last line left by a crash mid-write. */
export async function readLog(file) {
  if (!fs.existsSync(file)) return { records: [], head: { n: 0, hash: null }, repaired: false };
  let text = fs.readFileSync(file, "utf8");
  let repaired = false;
  if (text.length && !text.endsWith("\n")) {
    // Only the last line can be torn, and only by a crash: it was never acknowledged.
    const cut = text.lastIndexOf("\n") + 1;
    text = text.slice(0, cut);
    fs.truncateSync(file, Buffer.byteLength(text));
    repaired = true;
  }
  const records = [];
  let prev = null, n = 0;
  for (const line of text.split("\n")) {
    if (!line) continue;
    n++;
    let obj;
    try { obj = JSON.parse(line); } catch { throw new L.LoglineError("log_corrupt", `line ${n} is not JSON`); }
    if (L.canonicalize(obj) !== line) throw new L.LoglineError("log_corrupt", `line ${n} is not in canonical form`);
    if (obj.n !== n) throw new L.LoglineError("log_corrupt", `line ${n} says it is line ${obj.n}`);
    if (obj.prev !== prev) throw new L.LoglineError("log_corrupt", `line ${n} does not chain to line ${n - 1}`);
    prev = await L.sha256(line);
    records.push(obj.rec);
  }
  return { records, head: { n, hash: prev }, repaired };
}

export class Accounts {
  constructor(file) { this.file = file; this.stamp = null; this.map = {}; this.reload(); }
  /** Accounts can be added while the server runs (by the CLI): re-read the file when it changes. */
  reload() {
    let st;
    try { st = fs.statSync(this.file); } catch { this.map = {}; this.stamp = null; return; }
    const stamp = `${st.mtimeMs}:${st.size}:${st.ino}`;
    if (stamp !== this.stamp) { this.map = JSON.parse(fs.readFileSync(this.file, "utf8")); this.stamp = stamp; }
  }
  static tokenHash(token) { return "sha256:" + crypto.createHash("sha256").update(token).digest("hex"); }
  find(token) { if (!token) return null; this.reload(); return Object.hasOwn(this.map, Accounts.tokenHash(token)) ? this.map[Accounts.tokenHash(token)] : null; }
  add(account, { admin = false } = {}) {
    if (!/^[A-Za-z0-9._@-]{1,128}$/.test(account)) throw new Error("account names use letters, digits and . _ @ - (up to 128)");
    this.reload();
    const token = "llt_" + crypto.randomBytes(24).toString("base64url");
    this.map[Accounts.tokenHash(token)] = { account, admin };
    fs.writeFileSync(this.file + ".tmp", JSON.stringify(this.map, null, 2) + "\n", { mode: 0o600 });
    fs.renameSync(this.file + ".tmp", this.file);
    return token;
  }
}

/**
 * Open (or create) a machine in `dir`. Every record is written and fsynced
 * before the ledger acts on it, so an acknowledged receipt survives a crash.
 */
async function openReference(dir, opts, target) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const keyFile = path.join(dir, "machine-key.json");
  if (!fs.existsSync(keyFile)) {
    if (target && fs.existsSync(path.join(dir, LOG)) && fs.statSync(path.join(dir, LOG)).size > 0)
      throw new L.LoglineError("key_invalid", "existing target log requires its original machine key");
    const { privateJwk } = await L.generateMachineKey();
    fs.writeFileSync(keyFile, JSON.stringify(privateJwk) + "\n", { mode: 0o600, flag: "wx" });
  }
  const key = await L.importMachineKey(JSON.parse(fs.readFileSync(keyFile, "utf8")));
  if (target && fs.existsSync(path.join(dir, LOG)) && fs.statSync(path.join(dir, LOG)).size > 0 && !fs.existsSync(path.join(dir, "secret.key")))
    throw new L.LoglineError("key_invalid", "existing target log requires its original identity secret");
  const secret = Buffer.from(readSecretFile(path.join(dir, "secret.key"), () => crypto.randomBytes(32).toString("hex") + "\n").trim(), "hex");
  if (secret.length !== 32) throw new Error("secret.key must hold 32 bytes as hex");

  const file = path.join(dir, LOG);
  const { records, head, repaired } = await readLog(file);
  const state = { head, broken: null };
  let fd = null, closed = false;
  const sink = async (rec) => {
    if (closed) throw new L.LoglineError("unavailable", "reference log is closed");
    if (state.broken) throw new L.LoglineError("unavailable", "the ledger stopped accepting writes after a storage error");
    const line = L.canonicalize({ n: state.head.n + 1, prev: state.head.hash, rec });
    const nextHash = await L.sha256(line);
    if (closed) throw new L.LoglineError("unavailable", "reference log is closed");
    try {
      fd ??= fs.openSync(file, "a", 0o600);
      fs.writeFileSync(fd, line + "\n"); // Write the entire record, including short writes.
      fs.fsyncSync(fd);
    } catch (e) {
      state.broken = e;
      throw new L.LoglineError("unavailable", "storage error; the ledger stopped accepting writes");
    }
    state.head = { n: state.head.n + 1, hash: nextHash };
  };
  // Historical v1 and target v2 have explicit reference record formats.
  // Do not silently reinterpret a v1 log as v2 (or vice versa).
  const storedBudget = target ? records.find(r => r.kind === "receipt-v2")?.admission_snapshot?.scan_ops : undefined;
  const ledger = target
    ? new L.ProcessLedger(key, { sink, clock: opts.clock, scanOps: opts.scanOps ?? storedBudget })
    : new L.MemoryLedger(key, { sink, clock: opts.clock, maxDepth: opts.maxDepth, maxReactions: opts.maxReactions });
  await ledger.restore(records, { replay: !!opts.replay });

  return {
    dir, ledger, repaired, version: target ? "2" : "1",
    accounts: new Accounts(path.join(dir, "accounts.json")),
    pseudonym: (account) => L.pseudonym(new Uint8Array(secret), account),
    head: () => ({ ...state.head }),
    broken: () => state.broken !== null,
    close: () => { closed = true; if (fd !== null) { fs.closeSync(fd); fd = null; } },
  };
}

// Local reference adapters only; neither is a production application server.
export const openMachine = (dir, opts = {}) => openReference(dir, opts, false);
export const openProcessMachine = (dir, opts = {}) => openReference(dir, opts, true);
