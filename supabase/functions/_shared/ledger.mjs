// Stateless hosted ledger adapter. The evaluator and signer are the same build
// used by the local server. No process-local state is required between requests.
import * as L from "./core/index.js";

export class HostedError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

export function onceClaims(process, tuple) {
  const cites = tuple && typeof tuple === "object" && !Array.isArray(tuple) ? tuple.cites : null;
  return Object.entries(process?.cites ?? {}).filter(([slot, rule]) => rule.once &&
    typeof cites?.[slot] === "string" && L.HASH_RE.test(cites[slot]))
    .map(([slot]) => ({ slot, cited_id: cites[slot] }));
}

// db is a durable transaction boundary, never a cache or a MemoryLedger.
// An optional citation store can be supplied by a trusted caller, but is not yet
// a public wire format. The database remains authoritative for consumption.
export async function submitRoot({ db, key, keys, tuple, owner = null, by = null, when, citations }) {
  when ??= new Date().toISOString().slice(0, 19) + "Z";
  const inputHash = await L.hashOf(tuple);
  const store = { receipt: async id => {
    const found = await citations?.receipt(id) ?? await db.citation(id);
    if (!found) return null;
    if (found.receipt?.id !== id) throw new HostedError(503, "integrity", "citation address mismatch");
    return found;
  }};
  for (let attempt = 0; attempt < 8; attempt++) {
    const process = await db.process(L.frequencyOf(tuple));
    const claims = onceClaims(process, tuple);
    const spent = await db.spent(process?.id ?? null, claims);
    const { receipt, detail } = await L.issue(key, process, tuple, { when, by, depth: 0, store, keys, spent });
    const h = receipt.header;
    const cache_key = await L.cacheKey(process, inputHash, when, by, 0);
    const result = await db.commit({
      id: receipt.id, cache_key, owner, frequency: h.frequency, status: h.status,
      by, process_id: h.process, process_hash: h.process_hash, activated: h.activated,
      input_hash: h.input_hash, detail_hash: h.detail_hash, spent: h.spent, claims,
      tuple: L.canonicalize(tuple), detail: L.canonicalize(detail), receipt: L.canonicalize(receipt),
    });
    if (result.kind === "retry") continue;
    if (result.kind === "committed" && result.id === receipt.id) return { receipt, detail, replayed: false };
    if (result.kind === "replayed") {
      const old = await db.citation(result.id);
      if (!old || old.receipt?.id !== result.id || !old.detail ||
          await L.inauthentic(old.receipt, keys) || await L.hashOf(old.detail) !== old.receipt.header.detail_hash ||
          old.receipt.header.by !== by || old.receipt.header.input_hash !== inputHash ||
          old.receipt.header.process_hash !== h.process_hash || old.receipt.header.depth !== 0 ||
          await L.cacheKey(process, inputHash, old.receipt.header.when, by, 0) !== cache_key) {
        throw new HostedError(503, "integrity", "the committed receipt could not be verified");
      }
      return { receipt: old.receipt, detail: old.detail, replayed: true };
    }
    throw new HostedError(503, "integrity", "unexpected commit result");
  }
  throw new HostedError(503, "contention", "the ledger changed repeatedly; retry the same submission");
}
