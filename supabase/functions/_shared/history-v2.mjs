import * as L from "./core/index.js";
import { isUUID } from "./http.mjs";
import { boundaryFailure } from "./transactions-v2.mjs";

export const maxHistoryRequestBytes = 65536;
const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
const invalid = kind => { throw boundaryFailure({kind}); };
const valid = {
  frequency: value => value === L.UNADDRESSED ||
    /^[a-z0-9][a-z0-9._:@-]{0,127}(?:\.\*)?(?![\s\S])/.test(value),
  status: value => ["registered","ok","not","doubt"].includes(value),
  by: value => [...value].length >= 1 && [...value].length <= 256,
  process_hash: value => value.length === 71 && L.HASH_RE.test(value)
};

function normalize(tuning, by) {
  if (!record(tuning)) invalid("invalid_request");
  const normalized = {};
  for (const [field,value] of Object.entries(tuning)) {
    if (field === "activated") {
      if (typeof value !== "boolean") invalid("invalid_request");
      normalized[field] = value;
      continue;
    }
    if (!Object.hasOwn(valid,field)) invalid("invalid_request");
    const list = Array.isArray(value) ? value : [value];
    if (!list.length || list.length > 32 || new Set(list).size !== list.length ||
        list.some(item => typeof item !== "string" || !valid[field](item))) invalid("invalid_request");
    normalized[field] = [...new Set(list.map(item => field === "by" && item === "me" ? by : item))].sort();
  }
  return normalized;
}

export async function historyV2(db, keys, actor, text) {
  let body;
  try { body = L.parseStrict(text); }
  catch { invalid("invalid_request"); }
  if (!record(body) || Object.keys(body).some(key => !["tuning","after","limit"].includes(key)))
    invalid("invalid_request");
  const {tuning:filter = {},after,limit = 100} = body;
  if (after !== undefined && !isUUID(after)) invalid("cursor_invalid");
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) invalid("invalid_request");
  const tuning = normalize(filter,actor.by);
  const scope = await L.hashOf({visibility:"institution",by:actor.by,tuning});
  const page = await db.history(scope,after ?? null,limit);
  if (page?.kind) invalid(page.kind);
  if (!page || !Array.isArray(page.items) || page.items.length > limit ||
      !((page.next === null && isUUID(page.checkpoint)) || (isUUID(page.next) && page.checkpoint === null)))
    invalid("unavailable");
  const items = [];
  for (const body of page.items) {
    const receipt = L.parseStrict(body,65);
    if (!await L.authenticV2(receipt,keys)) invalid("unavailable");
    if (L.tuned(tuning,receipt.header)) items.push(receipt);
  }
  return {items,next:page.next,checkpoint:page.checkpoint};
}
