import * as L from "./core/index.js";
import { HostedError } from "./ledger.mjs";

export function database({ url, serviceKey, fetcher = fetch }) {
  const rest = url.replace(/\/$/, "") + "/rest/v1/";
  async function call(path, body) {
    const headers = { apikey: serviceKey, "content-type": "application/json" };
    // Legacy JWT-based service_role keys need Authorization; new secret keys do not.
    if (!serviceKey.startsWith("sb_secret_")) headers.authorization = `Bearer ${serviceKey}`;
    const r = await fetcher(rest + path, { headers, ...(body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }) });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      if (e.code === "23505" && path === "rpc/logline_publish") throw new HostedError(409, "process_exists", "a process is already published on that frequency");
      throw new HostedError(503, "storage", "the ledger could not complete the operation; retry");
    }
    const text = await r.text();
    return text ? JSON.parse(text) : null;
  }
  async function one(table, column, value, select) {
    const q = new URLSearchParams({ [column]: `eq.${value}`, select, limit: "1" });
    return (await call(`${table}?${q}`))[0] ?? null;
  }
  async function object(hash) {
    const row = await one("objects", "hash", hash, "body");
    if (!row || await L.sha256(row.body) !== hash) throw new HostedError(503, "integrity", "CAS object missing or altered");
    const value = JSON.parse(row.body);
    if (L.canonicalize(value) !== row.body) throw new HostedError(503, "integrity", "noncanonical CAS object");
    return value;
  }
  return {
    async process(id) {
      const row = await one("processes", "id", id, "hash");
      if (!row) return null;
      const process = await object(row.hash);
      if (process.id !== id) throw new HostedError(503, "integrity", "process address mismatch");
      return process;
    },
    async citation(id) {
      const row = await one("receipts", "id", id, "receipt");
      if (!row) return null;
      const receipt = JSON.parse(row.receipt);
      if (L.canonicalize(receipt) !== row.receipt) throw new HostedError(503, "integrity", "noncanonical receipt");
      if (receipt.id !== id) throw new HostedError(503, "integrity", "receipt address mismatch");
      return { receipt, detail: await object(receipt.header.detail_hash) };
    },
    spent: (process, claims) => claims.length ? call("rpc/logline_spent", { p_process: process, p_claims: claims }) : Promise.resolve([]),
    commit: p => call("rpc/logline_commit", { p }),
    async publish(process) {
      L.validateProcess(process);
      const hash = await L.hashOf(process);
      await call("rpc/logline_publish", { p_id: process.id, p_hash: hash, p_body: L.canonicalize(process) });
      return { id: process.id, hash };
    },
  };
}
