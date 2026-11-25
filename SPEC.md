# LogLine Receipt v1

Status: **draft for freeze**. Normative keywords: MUST, MUST NOT, SHOULD, MAY.

A *machine* takes a free JSON *tuple*, runs it on a published JSON *process*, and returns one thing: a signed *receipt*. Anyone holding the receipt and the machine's published key can check that the receipt is authentic. Anyone who also holds the tuple and the process (fetched by hash) can re-run the decision and get byte-identical output.

## 1. What a receipt proves, and what it does not

A valid receipt proves:

- this machine key issued it, at the stated `when`, and nothing in the header has changed since;
- which exact tuple (`input_hash`) and which exact law (`process_hash`) were involved;
- that running that tuple on that law at that `when` gives exactly this status, findings and grants.

It does **not** prove:

- that the facts in the tuple are true;
- that the machine's host was not compromised when it signed;
- that `by` is a person; it is the submitter as the machine authenticated it.

## 2. Encoding

- **Canonical JSON** is RFC 8785 (JCS). Every hash and every comparison in this spec uses the JCS form. Values that JCS cannot encode (non-finite numbers, lone surrogates, non-JSON types) MUST be rejected with `jcs_number`, `jcs_string` or `jcs_type`.
- **Hash** is `"sha256:" + lowercase hex(SHA-256(UTF-8(JCS(value))))`. The prefix lets a later version change the algorithm without ambiguity.
- **Binary** values (keys, signatures) are base64url without padding.
- Submitted bytes MUST be parsed as I-JSON (RFC 7493), refusing with `ijson` anything that ordinary JSON parsing would accept but silently change:
  - duplicate object keys;
  - lone surrogates;
  - control characters in strings;
  - integers outside ±(2^53−1);
  - nesting deeper than 64;
  - trailing characters.

  Nothing is recorded for bytes that fail to parse, because there is no tuple to record.

## 3. Tuple

A tuple is any JSON value. Its fields are free: the machine never rejects a tuple for its shape. Conventionally it is a sentence: `who`, `did`, `this` (the frequency it is addressed to), `with` (the facts).

A tuple carrying private facts SHOULD include a top-level `salt` of at least 128 random bits (base64url). Without one, the hash of a small tuple can be found by guessing.

## 4. Process (`process@1`)

| Field | Required | Meaning |
|---|---|---|
| `logline` | yes | `"process@1"` |
| `id` | yes | The process's name and the frequency it listens on. Matches `^[a-z0-9][a-z0-9._:@-]{0,127}$`. A version belongs in the id (`visa.tourist@1`). |
| `issuer` | yes | Who publishes this law. |
| `accepts.did` | yes | The verb that activates it. |
| `requires` | yes | Activation conditions: field path to type. The types are `string`, `number`, `integer`, `boolean`, `date` (`YYYY-MM-DD`, a real calendar date), `object` and `array`. |
| `cites` | no | Slot name to `{frequency, status?, optional?, once?}`: the receipts a tuple must cite, by id, under `tuple.cites.<slot>` (§9). At most 16 slots. |
| `on` | no | `{frequency, status?}`: the process **reacts** to receipts on air (§10.1). `frequency` is a pattern or a list of up to 16 patterns. Requires a `cites.trigger` slot. |
| `steps` | yes | An ordered list of `{id, check, if_not, reason}`. `check` is an expression, and `if_not` is `"not"` or `"doubt"`. Step ids are unique. |
| `grants` | no | Name to expression. Evaluated only when the status is `ok`. |
| `if_ok`, `if_doubt`, `if_not` | yes | The consequence text for each outcome, agreed when the law is published. |
| `broadcast` | no | Paths starting `detail.` or `tuple.` whose values go on air in `header.public`. Default: nothing. |
| `time` | no | `none`, `day` (default) or `exact`: how the decision depends on `when`. Used only for caching (§7.4). |
| `limits.ops` | no | Operation budget per evaluation. Default 10,000, maximum 1,000,000. |

Unknown fields MUST be rejected (`process_invalid`, naming the path). A process is identified by its hash. Changing one character makes it a different law.

## 5. Expressions

An expression is a JSON literal, an array of expressions (evaluated element by element), or an object with **exactly one** key naming an operator. Its argument is an array of expressions, or a single expression treated as a one-element array.

| Operator | Arguments | Result |
|---|---|---|
| `var` | path | The value at a dotted path in the tuple. Paths starting `$` read machine values: `$today` (the `YYYY-MM-DD` of `when`), `$when`, `$by`, and `$cites.<slot>.id`, `.header.…` and `.detail.…` for each resolved citation. A missing path is an `eval_missing` error. |
| `has` | path | `true` if the path exists. |
| `and`, `or` | any number | Evaluated left to right, stopping early. An operand counts as true only if it is exactly `true`. |
| `if` | cond, then, else | Lazy. |
| `not` | 1 | `true` unless the argument is exactly `true`. |
| `==`, `!=` | 2 | Strict equality. Objects and arrays are compared by their JCS form. |
| `<`, `<=`, `>`, `>=` | 2 numbers | |
| `+`, `*` | any number | Numbers only. The result must be finite. |
| `-` | 2 numbers | |
| `min`, `max` | 1 or more numbers | |
| `in` | value, list | Membership by `==`. |
| `concat` | strings, numbers or booleans | Numbers and booleans are written in JCS form. |
| `len` | string or list | The length in UTF-16 code units. |
| `days_between` | date, date | Whole days from the first date to the second. |
| `add_days` | date, integer | A date. |

**Determinism.** Evaluation reads no clock, network or randomness. Time enters only through `when`.

**Bounds.** Each operator application costs one unit of `limits.ops`. Exhaustion raises `eval_budget`. Nesting deeper than 64 raises `eval_depth`.

**Errors** are `eval_syntax`, `eval_operator`, `eval_type`, `eval_missing`, `eval_range`, `eval_budget` and `eval_depth`.

## 6. The machine

Input: a process or `null`, the tuple, and:

- `when` (`YYYY-MM-DDTHH:MM:SSZ`);
- `by` (a string or null, at most 256 characters);
- `prev` (receipt ids);
- `spent` (receipt ids the ledger reports as already consumed, §9);
- `depth` (0 for a submission; a reaction carries its trigger's depth + 1, at most 64);
- a content-addressed **store** of signed receipts and details, and the **key ring** that cited receipts must be signed by.

1. **Frequency.** The frequency is `tuple.this` if it is a valid frequency string. Otherwise it is `_unaddressed`.
2. **Activation.** With no process, the submission is unmet: `no process is published on frequency "<f>"`. Otherwise every condition below must hold. Each one that fails adds a human-readable entry to `unmet`.
   - `tuple.this == process.id`
   - `tuple.did == process.accepts.did`
   - every `requires` path is present with its type
   - every citation resolves (§9)
3. **Not activated** gives status `registered`. No step runs, `findings` is empty and `grants` is null.
4. **Activated:** each step is evaluated in order against the same budget.
   - The result is exactly `true`: the finding is `ok`.
   - Any other value: the finding is the step's `if_not`, with its `reason`.
   - An error: the finding is `doubt`, with `reason` and `error` (the error code and message). The machine never turns an undecidable step into `ok`, and never silently into `not`.
5. **Status** is `not` if any finding is `not`. Otherwise it is `doubt` if any finding is `doubt`. Otherwise it is `ok`.
6. **Grants** are evaluated only when the status is `ok`. If a grant raises an error, the status becomes `doubt`, `grants` becomes null, and a finding `{step: "grants", result: "doubt", ...}` is appended.
7. **Consequence** is the process's `if_<status>`. For `registered` it is the fixed text in the reference implementation.
8. **Broadcast:** each `broadcast` path that resolves is copied into `public` under its full path string.

## 7. Receipt

### 7.1 Detail (private, stored by hash)

```json
{ "logline": "detail@1", "consequence": "...", "findings": [{ "step": "...", "result": "ok|not|doubt", "reason": "...", "error": "..." }],
  "unmet": ["..."] | null, "grants": { } | null }
```

`reason` and `error` are omitted when they don't apply.

### 7.2 Header (public, what goes on air)

```json
{ "logline": "receipt@1", "frequency": "...", "status": "registered|ok|doubt|not", "activated": true,
  "process": "id" | null, "process_hash": "sha256:..." | null, "input_hash": "sha256:...",
  "detail_hash": "sha256:...", "when": "...", "by": "..." | null, "prev": ["sha256:..."], "spent": ["sha256:..."], "depth": 0, "public": { } }
```

`prev` is the union of the given `prev` and every resolved citation, sorted and without duplicates. `spent` is the input `spent`, sorted and without duplicates. The ledger's claim is recorded and signed, so a replay uses exactly what the machine saw. The **receipt id** is `hash(header)`. Because the header commits to `detail_hash`, the private detail is bound to the receipt without being published.

### 7.3 Signature

```json
{ "header": { }, "id": "sha256:...", "sig": { "alg": "Ed25519", "key": "<key id>", "value": "<base64url>" } }
```

The signed message is the UTF-8 bytes of `"logline-receipt-v1:" + id`. The **key id** is `hash({crv, kty, x})` of the public JWK, which is the RFC 7638 thumbprint input. Ed25519 is deterministic, so the conformance vectors pin signature bytes.

### 7.4 Idempotency

```
key = hash({ process_hash, input_hash, bucket, by, depth })
```

The bucket depends on the process's `time`:

| `time` | Bucket |
|---|---|
| `none` | `""` |
| `day` (the default) | the date of `when` |
| `exact` | `when` itself |

A ledger that has already issued a receipt under a key MUST return that receipt, marked as replayed, and MUST NOT issue another or run reactions again. A retried request therefore never decides twice and never consumes twice.

## 8. Verification

A verifier needs the receipt and the published key ring. The detail, tuple and process are optional. Every check is `pass`, `fail` or `skipped`:

| Code | Check |
|---|---|
| `shape` | The input is a `receipt@1` with a well-formed id, signature block and `when`. |
| `id` | `hash(header) == id` |
| `key` | `sig.key` is a published key. |
| `key_window` | `when` falls inside the key's `not_before`/`not_after` window. |
| `signature` | The Ed25519 signature is valid. |
| `detail` | `hash(detail) == detail_hash` |
| `input` | `hash(tuple) == input_hash` |
| `process` | `hash(process) == process_hash`, or `null == process_hash` when no process was given. |
| `replay` | Re-running gives an identical header, id and detail. The verifier supplies the same store for cited receipts and its own key ring. |

The receipt is **valid** when no check fails and `id`, `key` and `signature` pass. A listener holding only the header can therefore prove it is authentic. Proving that the decision is correct also needs the content.

## 9. Citations and trajectories

A receipt can be the input of another run. The tuple names it by id, and the machine fetches it by hash. Chaining runs this way gives a **trajectory**: a directed acyclic graph of receipts, linked through `prev`, in which each receipt carries the state the next one builds on (for example, `grants.completed`).

**Resolution.** For each slot in `process.cites`, the machine reads `tuple.cites.<slot>`. A slot is met only if every condition below holds; each failure is an unmet activation condition.

- The value is missing and the slot is `optional`: the slot is skipped. Missing and not optional: unmet.
- The value is a receipt id, and the store holds that receipt.
- The cited receipt is authentic under the key ring: its id is the hash of its header, its key is published and its signature is valid.
- Its detail is available and matches `detail_hash`.
- Its frequency matches the slot's `frequency` (exact, or a prefix ending `.*`).
- Its status is in the slot's `status`, when that is given.
- With `once`, its id is not in `spent`.

Each resolved citation is exposed to expressions as `$cites.<slot>` and added to `prev`.

**Consumption (`once`).** The ledger, not the pure function, keeps track of consumption.

- A cited id is consumed in `(process.id, slot)` only by a receipt of that process whose status is `ok`. A failed attempt consumes nothing, so it can be retried with the same citation.
- Before issuing a receipt, the ledger passes the consumed ids it finds as `spent`.
- `spent` is signed into the header, so the decision replays exactly.

This rule stops a trajectory from forking: the same lesson can't be continued twice.

**Bundles.** A bundle collects everything needed to verify a receipt and its whole trajectory offline:

```json
{ "logline": "bundle@1", "head": "<receipt id>", "keys": { }, "entries": [{ "receipt": { }, "detail": { }, "tuple": { }, "process": { } }] }
```

The entries are the head and every ancestor reachable through `prev` that the ledger holds, with ancestors first.

A bundle is **valid** when two things hold:

- it contains the head;
- every check (§8) of every entry passes, with citations resolved only from the bundle itself.

The keys inside a bundle are a convenience. A verifier SHOULD use the issuer's published key ring.

A forged ancestor fails its own `detail` or `id` check. The receipts that cite it then fail `replay`, so the damage is located exactly.

## 10. Radio

- Every receipt is broadcast as its signed header (§7.3) on its `frequency`. Nothing else goes on air: no tuple fields, and no detail beyond `public`.
- **Tuning** is a filter over header fields. Given fields combine with AND, and a list matches any of its entries. A frequency ending in `.*` matches that prefix. The fields are `frequency`, `status`, `by`, `process_hash` and `activated`.
- **On-air identity.** In production, `by` is `"p:" + hex(HMAC-SHA256(deployment_secret, account_id))`. A person can find their own receipts. Without the secret, nobody can link a pseudonym to an account.
- A late listener reads history from the ledger, then subscribes from the last id it saw.
- Listeners never need to trust the channel: they verify each header (§8).

### 10.1 Choreography

A process with `on` listens to the radio. When a receipt whose header matches `on` is issued, the ledger submits a reaction to that process:

```
{ "did": process.accepts.did, "this": process.id, "cites": { "trigger": <receipt id> } }
```

- **`by`** is the trigger's `by`, so the reaction is on behalf of the same submitter.
- **`depth`** is the trigger's depth plus 1.
- **The reaction is an ordinary run.** It must activate under the usual rules and is replayable like any other receipt. Reactions that don't activate are still recorded as `registered`.
- **Order.** The ledger processes reactions breadth first, in the order processes were published.

The ledger MUST enforce three limits, and MUST report every halted reaction with its reason to the submitter:

1. **At most once per pair.** A process reacts to a given receipt at most once.
2. **Depth.** No reaction beyond `maxDepth` (reference default 8), reason `depth`.
3. **Chain budget.** No more than `maxReactions` receipts caused by one submission (reference default 64), reason `chain_budget`.

Together these limits guarantee that every submission terminates, even when processes listen to each other in a loop.

## 11. Keys

A machine publishes its key ring at `/.well-known/logline.json` as `{ "keys": { "<key id>": { "jwk": {...}, "not_before": "...", "not_after": "..." } } }`. Rotation is itself a receipt on frequency `logline.keys`, signed by the outgoing key *(M2)*.

## 12. Conformance

`vectors/jcs.json` contains canonicalization cases transcribed from RFC 8785 and worked by hand. `vectors/receipts.json` contains receipt goldens signed by `vectors/test-key.json`, a key published on purpose for testing that must never be trusted. An implementation conforms when it reproduces every header, detail, id and signature byte for byte, and verifies each receipt with every check passing.

## 13. Open items before freeze

- The fixed `registered` consequence text: should it be part of the spec or of the process?
- Should a reaction be able to carry `with` facts, derived deterministically from the trigger, or is citing the trigger always enough?
- Key rotation receipt format *(M2)*.
- Encryption envelope for private objects and erasure by key deletion *(M5)*.
- Trajectories across machines. A citation currently resolves only against one key ring, so citing another operator's receipts needs a ring with several issuers *(v2: federation)*.
