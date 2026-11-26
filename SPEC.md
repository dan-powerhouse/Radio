# LogLine Receipt v1

Status: **draft for freeze**. Normative keywords: MUST, MUST NOT, SHOULD, MAY.

A *machine* takes a free JSON *tuple*, runs it on a published JSON *process*, and returns one thing: a signed *receipt*. Anyone holding the receipt and the machine's published key can check that the receipt is authentic. Anyone who also holds the tuple and the process (fetched by hash) can re-run the decision and get byte-identical output.

## 0. Scope and version status

This is the single technical specification for RADIO, the universal protocol for the formation of verifiable trajectories. [VISION.md](VISION.md) explains the purpose. Sections 1–14 retain the existing LogLine Receipt v1 contract (`process@1` and reference HTTP). Section 15 describes the agreed target architecture and unresolved design requirements; it is **not** a new wire format or a claim of implementation. Do not apply target semantics to v1 receipts or laws. The hosted adapter is a gated v1 preview, not a deployed or conformance-tested service.

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
  - unescaped control characters and malformed escapes in strings;
  - integers outside ±(2^53−1), including integer-valued parsed numbers written with a decimal point or exponent;
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

Operator lookup and value lookup MUST use own properties, not inherited host-language properties. In particular, var and has each take exactly one argument; extra arguments are not ignored.

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
   - every `requires` path is present with its type (paths in ascending UTF-16 code-unit order, as in JCS)
   - every citation resolves (§9; slots in ascending UTF-16 code-unit order)
3. **Not activated** gives status `registered`. No step runs, `findings` is empty and `grants` is null.
4. **Activated:** each step is evaluated in order against the same budget.
   - The result is exactly `true`: the finding is `ok`.
   - Any other value: the finding is the step's `if_not`, with its `reason`.
   - An error: the finding is `doubt`, with `reason` and `error` (the error code and message). The machine never turns an undecidable step into `ok`, and never silently into `not`.
5. **Status** is `not` if any finding is `not`. Otherwise it is `doubt` if any finding is `doubt`. Otherwise it is `ok`.
6. **Grants** are evaluated only when the status is `ok`, in ascending UTF-16 code-unit order of grant names. If a grant raises an error, the status becomes `doubt`, `grants` becomes null, and a finding `{step: "grants", result: "doubt", ...}` is appended.
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

A machine publishes its key ring at `/.well-known/logline.json` as `{ "keys": { "<key id>": { "jwk": {...}, "not_before": "...", "not_after": "..." } } }`. The document MAY carry other fields; the reference HTTP server adds `limits`, `versions`, `ttlMs` and `cacheScope`. The changing ledger head is a separate `GET /head` resource. Rotation is itself a receipt on frequency `logline.keys`, signed by the outgoing key *(M2)*.

## 12. Conformance

`vectors/jcs.json` contains canonicalization cases transcribed from RFC 8785 and worked by hand. `vectors/receipts.json` contains receipt goldens signed by `vectors/test-key.json`, a key published on purpose for testing that must never be trusted. An implementation conforms when it reproduces every header, detail, id and signature byte for byte, and verifies each receipt with every check passing.

## 13. Open items before freeze

- The fixed `registered` consequence text: should it be part of the spec or of the process?
- Should a reaction be able to carry `with` facts, derived deterministically from the trigger, or is citing the trigger always enough?
- Key rotation receipt format *(M2)*.
- Encryption envelope for private objects and erasure by key deletion *(M5)*.
- Trajectories across machines. A citation currently resolves only against one key ring, so citing another operator's receipts needs a ring with several issuers *(v2: federation)*.

## 14. Reference HTTP transport

Each request may carry `LogLine-Version: 1`; omission means `1` for compatibility. Unsupported versions return HTTP 400 with `error: "version"`, `supported` and `requested`. There is no session handshake. Discovery is cacheable for 60 seconds and does not include the head. Public receipt and process resources addressed by hash may be cached for one year as immutable; private detail and bundle responses MUST NOT be stored in shared caches (the reference sends `private, no-store`). Mutable history and head, errors, and submissions are `no-store`. The local server retains synchronous choreography and resumable SSE.

## 15. RADIO target architecture — approved kernel contract, staged implementation

### 15.1 Formation model

RADIO forms verifiable trajectories. A free I-JSON expression is submitted through an independent MCP or API request. A human or LLM translator, including MAP where applicable, can turn natural language into that expression. The machine does not interpret natural language. Authenticated identity is derived from the verified credential, not from `who` or any other claimed tuple field. Supabase OAuth is the hosted identity authority; it is distinct from the machine's receipt-signing authority.

A published **Process Type** is an immutable, content-addressed JSON law. It specifies recognition conditions, interpretation and requirements for tuple fields, and one or more RUNs with their functions expressed in JSON. The machine's deterministic **scanner** recognizes applicable published types. The first RUN of a recognized and eligible type can constitute an instance; subsequent RUNs advance that instance subject to the type's published conditions and ancestry. A valid expression that activates no type is recorded rather than discarded. Malformed I-JSON is not an expression (§2). Each executed RUN produces a signed receipt; a registration without activation must also have a receipt. The recognition and registration contract is approved in §15.8; the RUN and receipt contract is approved in §15.9.

The **receipt** is the constituted digital object, not a secondary log for effects internal to the protocol. Its content address, law reference, input, authenticated attribution, result and relevant ancestry support independent verification given the necessary evidence and trusted keys. The versioned envelope for type, instance, RUN and registry recognition is specified in §15.9. A trajectory is the causal composition of receipts; state is a projection under a published law, not a competing authoritative mutable object. Consumption restrictions and shared uniqueness must be checked at the authoritative transaction boundary. A trajectory need not be linear unless its law requires this.

### 15.2 Communication and continuity

The hosted input path is stateless MCP or API. No correctness property depends on a protocol session or warm application worker. Version and necessary context travel with each request; explicit references replace hidden conversational state. Discovery should separate cacheable metadata and immutable definitions from mutable history. The exact MCP wire profile must be checked against the applicable version before implementation.

The hosted output path is Supabase Realtime WebSocket. Committed public signed headers are broadcast on their frequencies; participants tune, verify, interpret, and independently choose whether and when to submit again. Private evidence is not broadcast by default. Each participant may operate arbitrary private listening, recording and orchestration infrastructure. RADIO does not orchestrate those participants or guarantee their reactions. Durable history and catch-up must support continuity when an observer disconnects or is replaced; the live transport is not itself a durable replay contract.

A participant's disappearance, model replacement or runtime restart must not erase previously constituted commitments or their causal history. This property does not guarantee performance of the commitment. Legacy `process@1.on` is reference behavior (§10.1); it is not the target mechanism for external community choreography. Whether any deterministic internal RUN advancement is needed is an open type-level design question, not a reason to introduce a global workflow worker.

### 15.3 Hosted authority and persistence

One logical RADIO provides a common reference for a community. Use the same runtime-neutral evaluator in the reference, browser, CLI and ephemeral hosted functions. The target hosted path consists of Supabase Auth, stateless Edge Functions, Postgres/CAS, transactional uniqueness, and Realtime. The optional local HTTP/SSE server remains executable reference infrastructure and is not in the production request path. No parallel evaluator in SQL, custom OAuth broker or resident application server. The static consent surface and precise client-specific delegation are still outstanding.

The account identifier stays private; the machine attests a pseudonym derived from verified identity. Publication requires authority; an amendment creates a new content address. Private evidence access must be checked independently of the public header. Published laws must be reviewed for disclosure through their output fields. Machine keys and OAuth keys remain separate. The operator controlling the signing key can issue receipts; individual receipt verification is not proof of the completeness or global consistency of the ledger. For an external effect, the protected executor must enforce the exact authorization, with replay protection and recoverable commit semantics. A receipt of authorization is not proof of execution.

Community and authority scope must be explicit before multi-community operation. The same code base may serve a single community or a larger hosted service; no cross-community access or consumption guarantee is implied by this goal. Physical scaling and cost require measurement.

### 15.4 DIPLOMACY and Agent Skills interoperability — adopted conceptual direction

Agent Skills (https://agentskills.io/specification) define an agent-facing directory with a `SKILL.md` containing YAML metadata (`name`, `description` required) and Markdown instructions; other resources are optional. A RADIO Process Type is a machine-facing JSON law, not a Markdown instruction set. A skill may explain translation, discovery, valid submissions, listening and continuation for one or more laws. It cannot grant authority, alter recognition, or provide executable semantics merely by asserting them.

The adopted conceptual direction is [DIPLOMACY](DIPLOMACY.md): a portable package with one canonical Process Type and one or more participant-facing Agent Skills. The package is not the law or a Process instance. Its proposed minimum layout is described in the founding article; [GLOSSARY.md](GLOSSARY.md) records the vocabulary. ZIP transport and revisions of instructions do not define law identity. The law's hash follows the canonical JSON rule; instructions are non-authoritative unless a future law explicitly binds supporting content. A machine must not execute arbitrary Skill scripts or interpret instructions to determine the legal result. The exact manifest, component digest/binding, archive safety profile and validation rules remain open for review before the protocol freeze. The machine continues to work with canonical law JSON alone.

### 15.5 Compatibility and verification checkpoint

The existing `process@1` evaluator selects by `tuple.this`, evaluates a single law and supports legacy `on` reactions. The current hosted preview uses root-only writes and a reserved internal outbox; no reaction worker is implemented. The target scanner is implemented in PR-04; multi-RUN semantics are not implemented. Version incompatible changes explicitly before coding; retain v1 vectors and do not reinterpret historical signatures.

Before this checkpoint, an unfrozen v1 ordering defect was corrected: `requires`, `cites` and `grants` are evaluated in UTF-16 key order. The `registered-free-form` golden changed; receipts affected by the earlier ordering may not replay with the current evaluator. No migration of historical receipts was performed. This is a known compatibility boundary, not a claim that all past v1 receipts replay.

The external alumni fixture (`examples/alumni.external.logline-101@1.json`) has no `on` and demonstrates the external-listener design using the local reference. Tests demonstrate two listeners seeing the same signed receipt, independent submission, catch-up after restart, once-consumption and offline replay. They do not demonstrate hosted OAuth, MCP, RLS, Deno or WebSocket conformance.

### 15.6 Open decisions before a new normative version

- Recognition and registry semantics are approved in §15.8. The Process Type and RUN schema, instance identity and receipt encoding are specified in §15.9.
- Instance and RUN identities and receipt binding; successor eligibility, causal dependencies, retries and transactional consumption scope (§15.9; implementation pending).
- The DIPLOMACY conceptual direction is adopted; exact manifest, package identity, component integrity, safe archive profile and association between instructions and immutable law versions are not frozen. MAP wire contract has not been supplied.
- Root-only response shape and removal or retention of reserved outbox/reaction jobs; any automatic internal RUN advancement must be explicitly specified.
- Hosted history recovery under concurrent commits, client-specific authorization and revocation, trust and community scope, citation bundle input and protection against fabricated or spent citations.
- Key rotation, external anchors (including the suggested Merkle anchor; no approved design), private evidence erasure and federation (§13). The actual Supabase project and deployment must be approved.

### 15.7 Engineering sequence and acceptance

1. Specify scanner and multi-RUN semantics, including all open recognition/instantiation decisions; implement in the single evaluator and reference machine with new positive, negative and adversarial vectors. Preserve the existing v1 contract.
2. Prove object constitution, multiple independent instances, trajectory composition and continuation after runtime replacement. Test that retries and once claims do not duplicate instances or effects.
3. Carry these semantics into the hosted transaction adapter; reassess the existing outbox without building a universal reaction worker. Verify actual Postgres concurrency and RLS; resolve history catch-up without missing late commits. Keep the preview gate closed until validated.
4. Implement stateless MCP discovery/submission, native OAuth consent and delegated scope, and Realtime listening and recovery. The ordinary API shares the RUN boundary. Test actual infrastructure with explicit approval.
5. Demonstrate the vertical path: natural language -> translated tuple -> OAuth/MCP -> scanner -> RUN -> receipt -> listener -> new input. Independently verify the trajectory, including interruptions, retries, refusals and conflicting consumption. External effects require their own protected executor, which is not implied by this test.

PATT native Transformer state, trusted execution and metered resource enforcement are separate experiments, not prerequisites for RADIO or proven by a working RADIO ledger.

### 15.8 PR-01 — Process Type and scanner contract

Status: **approved 2026-11-25; Process Type validation and local reference publication implemented in PR-03; scanner implemented in PR-04**. This is the target recognition contract, normative for the next protocol version when it is frozen. It does not change §§1–14 or freeze a receipt envelope. PR-02 completes the remaining semantics.

#### 15.8.1 Law and publication

A new law uses `logline: "process-type@1"`, distinct from `process@1`. Its proposed top-level fields are `logline`, `id`, `issuer`, `recognize`, and `runs`. `id` is a versioned frequency following the existing identifier rules (§4); `_unaddressed` is reserved. `issuer` is descriptive, not an authentication claim. `recognize` is one expression in the existing JSON expression language (§5); `runs` is a non-empty ordered array of RUN definitions, with the first entry defining instantiation. The RUN body, identifiers, entry and successor eligibility are defined in §15.9. Unknown fields are rejected, rather than treated as executable extensions. Skills are not part of the law or scanner.

The law address is `hash(law)` (§2), including all RUN definitions. Reordering object keys does not change its identity; reordering the RUN array does. Publication is an authenticated, authorized operation; a previously published id cannot be rebound to different bytes or a different hash. An amendment has a new id and content address. A repeated publication of identical canonical content is idempotent. A law removed from the active recognition set remains retrievable for historical verification. No arbitrary code, network access or natural-language interpretation participates in recognition.

#### 15.8.2 Registry snapshot

Recognition uses an explicit immutable snapshot of the active Process Type laws for one logical machine. The proposed CAS object is `{"logline":"registry@1","types":["sha256:..."],"scan_ops":1000000}`. `types` contains unique law hashes in ascending UTF-16 code-unit order; it may be empty. There are no legacy `process@1` laws in this snapshot. All referenced laws must exist and validate before a snapshot can become active; active ids must be unique. `scan_ops` is an integer from 1 to 1,000,000 inclusive, a proposed versioned recognition budget, not a CPU-time guarantee.

A publication or retirement changes the active snapshot atomically, never the previous snapshot. The machine selects the authoritative snapshot at admission; the caller cannot choose an obsolete snapshot to gain authority. A scan and its resulting decision use that exact snapshot, even if publication occurs concurrently. Retries and subsequent RUNs must preserve the applicable law and context under the PR-02 contract. The signed receipt will bind the snapshot hash for a new recognition decision. Replay receives the snapshot and its referenced laws, checks their hashes and repeats recognition. A hash and receipt signature establish the evidence used by the issuer, not that the snapshot was globally complete or was the latest possible publication at the time.

#### 15.8.3 Recognition is not activation

The scanner is a pure function of the admitted I-JSON tuple and the immutable snapshot with its laws. It does not read the clock, identity, citations, grants, private state, network, or `tuple.this` as a privileged selector. The tuple's fields (including `this` and `who`) have no universal routing or authority meaning. A law can test them if its definition explicitly says so. An authenticated caller and a recognized type are necessary inputs to activation, not sufficient authorization.

Evaluate each `recognize` expression against the tuple alone using the existing evaluator and §5 equality, laziness and own-property lookup. `var` and `has` take one literal non-empty tuple path; machine paths beginning `$` are forbidden in recognition. The predicate must return a boolean; only `true` is a match. The author can guard absent fields with `has` and lazy `and`/`if`. All operators and arities must be statically valid (including branches not visited); inherited JavaScript properties are not operators. Runtime errors, including missing values or non-boolean results, are not silently converted to `false`. They mark the scan indeterminate. A malformed law or unavailable/hash-mismatched snapshot object is an infrastructure/contract failure, not a no-match verdict.

Evaluate all candidates in snapshot order, without an early exit on the first match. Charge one unit per candidate and one per expression operator application, from the single shared `scan_ops` budget. Existing expression depth limits apply. Admission must also bound input and definition bytes and expression breadth; those operational limits are to be published and measured before hosted use. The logical operation count alone does not bound wall time, allocation or the cost of comparing large values. If recognition exhausts its budget, no partial candidate list may authorize an effect. Future indexing may skip a law only when it can establish the same result (including error behavior) under this reference contract; optimization is not a different recognition semantics.

#### 15.8.4 Disposition

| Complete scanner outcome | Disposition |
|---|---|
| No match | One `registered` receipt on `_unaddressed`; no RUN or instance. |
| Exactly one match | Attempt the type's eligible entry RUN under PR-02. Recognition alone consumes nothing and grants nothing. If activation is unmet, one `registered` receipt on that type's frequency, no instance. |
| More than one match | One `registered` receipt on `_unaddressed` with an ambiguity reason and sorted matching law hashes in private detail; no implicit priority, no RUN or instance. The participant may clarify the tuple and submit again. |
| Predicate error or exhausted scan budget | One `registered` receipt on `_unaddressed` with the indeterminate reason; no RUN or instance, even if a candidate already matched. |
| Malformed I-JSON or failed admission | A stable transport/protocol error; no tuple receipt. An unavailable or corrupt registry fails the request rather than falsely asserting recognition. |

For each admitted initial tuple, at most one root receipt is constituted under this single-winner contract, subject to successful durable commit. It binds the tuple hash and recognition snapshot, with the selected law if any, and attested caller attribution. Private diagnostic details are hash-bound, not automatically broadcast. The exact error strings, receipt encoding and idempotency key are PR-02 work. `registered` does not confer an effect or authorize external action. No automatic community reaction follows from registration or execution: listeners decide what to submit next. Continuation of an existing instance is explicitly reserved for PR-02; the initial scanner must not accidentally instantiate a new process from a continuation input.

#### 15.8.5 Acceptance cases (expected, not executed target tests)

Use two illustrative recognition predicates, with RUN bodies omitted: Blue recognizes `{"and":[{"has":"did"},{"==":[{"var":"did"},"request"]}]}`; Green recognizes `{"and":[{"has":"with.green"},{"==":[{"var":"with.green"},true]}]}`. Both are guarded and inspect only tuple fields. Assume a sufficient budget and a valid snapshot containing both.

| Input or change | Expected recognition / disposition |
|---|---|
| `null`, `[]`, or `{"did":"other"}` | No match; one registered receipt. |
| `{"did":"request"}` | Blue only; attempt its entry RUN, whose activation may still fail. |
| `{"did":"other","with":{"green":true}}` | Green only. |
| `{"did":"request","with":{"green":true}}` | Both; one ambiguous registration, no effect. |
| `{"this":"green@1","did":"request"}` | Blue only; `this` cannot override recognition. |
| `{"who":"admin","did":"request"}` | Blue only; claimed identity confers no permission. |
| `{"did":"request","did":"other"}` as raw bytes | Invalid I-JSON; no receipt. |
| Reorder object keys in law or tuple | Same content hash and recognition outcome. |
| Reverse registry hash order | Not a valid canonical registry snapshot; no silent alternate order. |
| Remove Green from a new snapshot | Former overlap becomes Blue only for new admissions; old evidence replays as overlap. |
| Add an unguarded predicate that errors on missing data | Indeterminate, not a partial Blue success. |
| Exhaust budget after evaluating Blue | Indeterminate; no RUN. |
| Supply a different law under the same hash | Integrity failure; no false registration verdict. |

Approved decisions: single-winner ambiguity (rather than fan-out), `_unaddressed` registration frequency, fail-closed indeterminate handling, immutable snapshot selection and the recognition budget profile. PR-02 must finish the RUN/instance and receipt contract before implementation begins.

### 15.9 PR-02 — RUN, instance and receipt contract

Status: **approved to proceed and merged as GitHub #4; RUN execution and receipt@2 not implemented**. This completes the kernel contract for the next version without changing `process@1`, `receipt@1`, or historical v1 vectors. It uses the approved recognition semantics in §15.8. The first RUN constitutes the instance; there is no authoritative mutable process object, scheduler or internal reaction loop.

#### 15.9.1 Law and RUN definitions

The `process-type@1` law in §15.8.1 contains `runs`, an ordered non-empty array of up to 64 RUNs. The first entry is the only entry RUN. The order fixes law identity, not a mandatory linear execution order. Each RUN has the following fields (unknown fields rejected):

| Field | Contract |
|---|---|
| `id` | Required unique name matching `^[A-Za-z0-9_-]{1,64}$`. |
| `requires` | Required map of tuple paths to field types (§4); may be empty. |
| `after` | Required list of unique predecessor RUN ids. Empty for entry; non-empty for successors. References earlier array entries only. |
| `cites` | Optional map of named receipt requirements (§9), maximum 16 slots, as refined below. |
| `steps` | Required ordered checks with stable step ids, `check`, `if_not`, `reason` (§4). May be empty. |
| `grants` | Optional map of named result expressions (§6); the result object is the receipt's constituted content, not a separate entity. |
| `if_ok`, `if_doubt`, `if_not` | Required consequence strings, as in §4. |
| `broadcast` | Optional approved `detail.*`/`tuple.*` paths (§6); private by default. |
| `limits` | Optional `ops`, default 10,000, max 1,000,000 for evaluation. |

`accepts`, `on` and `time` are not RUN fields: recognition is §15.8; participants react externally; retries use an explicit submission key below. The same expression evaluator implements recognition and RUN checks. All expressions must be structurally valid at publication, including unvisited branches. RUNs may read tuple paths and only `$when`, `$today`, `$by`, `$instance`, `$parents.<run-id>.id/header/detail`, `$cites.<slot>.id/header/detail`; no host state, arbitrary code, or network. `$instance` is null for entry and the root receipt id for continuation. `$parents` is empty for entry. All paths and values are own JSON properties. Static validation must reject reserved or unknown machine roots; dynamic missing paths use the existing evaluator's error semantics. Resource/byte admission limits must be enforced in addition to operation counts. The existing evaluator's expression and ordering semantics remain authoritative, with version-specific fixes explicitly documented and tested.

This is a finite acyclic law graph, not a workflow executor. A RUN may have multiple parents or multiple eligible successors; each RUN may successfully constitute its result at most once per instance. Repetition is expressed by a new instance or a new trajectory linked through citations. No automatic transition follows a successful RUN. A participant must submit an independent next input. This is a deliberately small proposed v1 profile for Process Types, not a claim that all possible workflows are acyclic.

#### 15.9.2 Submission and continuity

A request carries `tuple` (any I-JSON value), `submission` (caller-generated, unpredictable 128-bit-or-longer base64url nonce, at most 128 characters), and optionally `continue: {instance, run, parents}`. These are transport fields, not reserved meanings of the free LogLine tuple. `parents` is a map from predecessor RUN id to receipt id. The version is explicit at the transport boundary. Unknown request fields or malformed envelopes are protocol errors, not accepted expressions. Authentication is mandatory for target submissions; `by` is derived from the authenticated principal. The local test adapter may supply a verified test identity but never infer it from the tuple. Delegation remains subject to §15.6 and §15.7.

- An initial request has no `continue`. The machine captures the current immutable registry snapshot, scans (§15.8), and attempts the unique matched law's first RUN, if any. The participant does not choose the initial law through the transport.
- A continuation request never enters the initial scanner. It identifies the root receipt by content address, the RUN by id, and its exact causal parents. The root must be an authentic `receipt@2`, an `ok` entry RUN of the same logical machine, with its original law and registry evidence available. Load that exact law, even if it is no longer active for new instances. Retirement is not revocation of existing obligations; applicable authorization/revocation checks remain mandatory. The successor must exist, must not be the entry RUN, and `parents` must have exactly the keys in `after`. Each parent must be an authentic `ok` receipt of the same law, instance and specified RUN. The entry receipt's effective instance id is its own receipt id. No guessed latest parent, session state, implicit actor continuity or fallback to the scanner is permitted.
- The machine checks that the current actor is allowed to participate; previous receipts can express authority but prior authorship is not automatically inherited. A law may require equality to a previous `by`, or explicitly authorize a different actor, through its checks and citations. Credentials, visibility of a receipt and authorization to use its private detail are distinct. The host must authorize evidence access before evaluating or disclosing it; trusted machine-internal verification may resolve private evidence without exposing it to the caller.
- Missing/incorrect parents, unavailable citations, already completed RUN or spent claim prevent activation and produce `registered` with an explanation when safe. Missing root, wrong law/RUN or unauthorized access cannot instantiate an alternative process. Unauthorized/missing private evidence must use indistinguishable diagnostics where needed to avoid an existence oracle. A corrupt authoritative object or unavailable registry infrastructure is a request failure, not a fabricated refusal. A continuation request that cannot resolve a trustworthy law uses `_unaddressed` and null selected law/RUN in the receipt, with the requested context hash committed. A well-formed continuation whose known law refuses activation is registered on its law's frequency.

#### 15.9.3 Evaluation, constitution and uniqueness

A single admitted submission constitutes at most one root receipt; the result can be `registered`, `not`, `doubt` or `ok`. Recognition and causal eligibility come before RUN evaluation. Evaluate `requires` and `cites` deterministically in UTF-16 key order, with no implicit `who`, `did`, or `this` routing. If activation fails, no step runs, `findings` is empty, and `grants` is null. For activated RUNs retain §6 finding precedence (`not` before `doubt`, else `ok`), grant evaluation only on `ok`, and error handling. A non-ok receipt is evidence of a submission/attempt, not a successful constituted effect. Only an `ok` entry RUN forms an instance. An `ok` successor constitutes one result object in that instance; its success is not overwritten by a subsequent attempt.

The instance id is the id of the successful entry receipt. The entry receipt header has `instance: null`; its effective instance identity is computed after hashing. This avoids circular hashing and a second instance-id allocation mechanism. Non-ok entry receipts have no instance. Later receipts bind the root id; no authoritative mutable instance record is required. The type's projection may be calculated from the set of successful RUN receipts and their causal edges. An index is a constraint or acceleration, not an alternate state truth.

For an admitted request, reserve or recover the idempotency key `hash({by, submission})`, scoped to the logical machine. Bind it to `request_hash = hash({tuple, continue: continuation-or-null})`. A retry of the same key and request returns the original receipt, even after registry, clock, law or state changes. A reused key with different request hash fails `submission_conflict`; it never executes. New attempts, including after `registered`, `not`, or `doubt`, require a new nonce. Changing a nonce intentionally requests a new attempt; identical initial input with a different nonce may create another instance. The nonce is not authority and must not be derived from the caller's identity or stored as an access token.

For successors, success claims are unique by `(instance, run)`; the ledger, not the evaluator, enforces that uniqueness atomically with the receipt commit. A race loser re-evaluates against the committed success claim and registers the already-completed RUN, rather than emitting a second `ok`. The `once` citation rule retains the v1 scope concept but uses `(law_hash, slot, cited_receipt_id)` within the logical machine, across all RUNs of that law; shared slot names deliberately share a consumption scope. A later amendment is a distinct law and does not by itself prevent the same receipt being consumed there. Types requiring wider conservation must use a single authoritative consuming law, or await an explicit cross-law consumption contract; do not claim global money-like uniqueness. Optional citation slots may be omitted; an explicitly supplied bad citation is unmet. Each resolved citation must be authentic, match the requested id, pass frequency/status constraints, and have matching detail. No caller can supply `spent` or assert a successful parent on the authority's behalf. A claim is committed only on `ok`; unsuccessful attempts consume nothing. A submission claim, all CAS objects, receipt, success claims and once claims commit together. On failure nothing is broadcast. If a conflicting claim appears, discard tentative output and re-evaluate with updated authoritative observations under the original admitted request, law and time. A response is not delivered as committed until persistence succeeds.

#### 15.9.4 Versioned receipt and replay evidence

Retain the outer envelope `{header,id,sig}` and Ed25519 key identities (§7.3). The target header is `receipt@2` and the signature domain is UTF-8 `logline-receipt-v2:` plus `id`. Old signatures remain v1; dispatch strictly by version, not by trying both domains. Proposed required fields:

```json
{
  "logline": "receipt@2",
  "frequency": "blue@1",
  "status": "ok",
  "activated": true,
  "process": "blue@1",
  "process_hash": "sha256:...",
  "registry_hash": "sha256:...",
  "run": "open",
  "instance": null,
  "input_hash": "sha256:...",
  "context_hash": "sha256:...",
  "detail_hash": "sha256:...",
  "when": "2026-11-25T00:00:00Z",
  "by": "p:...",
  "prev": [],
  "public": {}
}
```

The example hashes and pseudonym are placeholders, not a signed vector. `process`, `process_hash`, `run`, and `instance` are nullable as required by disposition; initial registration without a unique match has null law and RUN. `registry_hash` always commits to the admission snapshot for initial recognition, or the root's snapshot for a resolved continuation; for an unresolved continuation it commits to the current admission snapshot. A verifier must validate field relationships and exact header shape, not only a signature. The `id` is `hash(header)`. `prev` is the sorted unique union of actually resolved causal root, parents and citations (no arbitrary caller-supplied previous ids); no self-reference. Failed/unresolved references remain in the hash-bound context, not authenticated causal edges. Key windows, identity rules and privacy remain §11 and §15.1–3. No `depth` because the target machine does not react; no public `spent` or internal account UUID.

`detail@2` has the v1 consequence, findings, unmet and grants fields plus a stable `reason` code (null on `ok`) and `recognition` (initial scan outcome with matching hashes and diagnostics, null for continuation). The exact private `context@1` CAS object contains `submission`, `request_hash`, `continue` (null or the exact request), `spent` (sorted unique pairs `{slot,id}` under the selected law), `completed` (null or the conflicting successful receipt id), and `resolved` (root/parent/citation ids actually resolved, by role). It binds all relevant ledger observations and the explicit request without publishing them. For every reference that influences replay, a bundle must distinguish available authentic objects from authoritative negative observations; replay uses exactly the recorded availability and conflict observations and rejects mismatches, rather than accepting any extra object as if present at admission. Negative observations are machine attestations, not mathematical proof of global absence. Failure reason codes and exact diagnostic ordering must be frozen with the conformance vectors in PR-05; they cannot depend on database messages or host exceptions. Reject unknown fields in the new version and canonicalize all maps/sets as specified. Public data is exclusively the law-declared projection plus header fields; the detail and context remain private subject to authorization.

A `bundle@2` includes a head receipt id, `keys` (convenience only), and a map `objects` from content hash to canonical JSON object containing the receipt headers, signed envelopes, tuples, details, contexts, registry snapshots and all laws and causal evidence necessary for replay. Signed receipt envelopes are addressed in the bundle by `receipt.id` (hash of header), all other objects by hash of their full content; verify this typed distinction and reject collisions or duplicate keys. Historical v1 ancestors may be included under their unchanged versioned rules. Full verification must use an independently trusted key ring, resolve every causal ancestor, validate all required evidence hashes, reject cycles, and replay recognition (entry only), activation and RUN using the signed time, identity and recorded context. Return separate authenticity, replay and trajectory completeness verdicts. Missing evidence may permit an authenticity-only verdict but never a successful full replay claim. An offline bundle does not prove ledger-wide completeness, current authorization, absence of alternative issued receipts or actual external effects. For resource consumption and success exclusivity, trust the authoritative transaction boundary or additional independent evidence of consistency. Receipt verification does not confer permission to retrieve private CAS objects.

#### 15.9.5 Worked trajectory and acceptance (not executed target tests)

Illustrative law `blue@1`: recognition is the Blue predicate from §15.8.5, with entry RUN `open` requiring `with.subject: string`, granting `subject` and authenticated `owner`; successor RUN `review` has `after:["open"]`, requires `with.score: integer`, checks `score >= 70`, and explicitly checks `$by == $parents.open.detail.grants.owner` for this example, propagating the authenticated owner in its grants; successor RUN `finish` has `after:["review"]` and checks `$by == $parents.review.detail.grants.owner`. It may read or propagate only the verified evidence declared by the contract. The following symbolic receipts are not real hashes:

| Submission | Expected result |
|---|---|
| Alice opens subject A with nonce N1 | `ok` receipt A1; A1 is the instance id. |
| Alice opens subject B with nonce N2 | `ok` receipt B1, distinct instance. |
| Retry N1 after registry amendment | Returns byte-identical A1; no new instance. |
| Reuse N1 with a different tuple | `submission_conflict`; no receipt. |
| Alice reviews A1 with parent B1 | `registered`; cross-instance parent forbidden. |
| Bob reviews A1 with valid parent A1 | `not` under this example's authority check; no success claim. |
| Alice reviews A1, score 50 | `not`; no success claim. |
| Alice reviews A1, score 80, new nonce | `ok` receipt A2; root A1 and parent A1 in `prev` once. |
| Two competing eligible reviews of B1 | Exactly one `ok` for B1/review; other `registered`. |
| Alice finishes A1 citing A2 | `ok` receipt A3; `prev` includes A1 and A2. |
| Retry successful finish, same key | Original A3; no repeat effect. |
| New finish nonce after A3 | `registered`; no second successful finish. |
| Amend or retire Blue before continuation | A1 continues under its exact original law, subject to valid authorization. |
| Replace listener/runtime and replay A3 bundle | Same decisions from signed history and original law; no session dependency. |
| Tamper with root, law, registry, parent, context or grant | Full verification fails. |

For non-linear acceptance, a separate law has `open`, parallel eligible `left` and `right`, and `join` with `after:["left","right"]`. Either branch can arrive first; `join` cannot activate until both authentic same-instance successes are provided. An unsuccessful branch can be attempted again with a new submission nonce. A receipt from another law or instance cannot substitute a required parent. A separate once-citation case must verify slot-specific conflict, rollback and no cross-slot false positives.

Accepted initial profile: one successful receipt per `(instance, RUN)`, finite DAG in the first Process Type profile, continuation transport separate from free tuple, root receipt as instance id, explicit submission nonce, law-scoped once consumption, and the versioned envelope/context/bundle contract. These are the initial implementation contract. Code PRs must not implement a different contract silently. No external executor, PATT, orchestration worker, new service or arbitrary code language is introduced.


### 15.10 PR-03 — Reference publication profile

The runtime-neutral reference library exposes `parseProcessType(text)`, `validateProcessType(value)`, `validateRegistrySnapshot(value)` and `ProcessTypeRegistry`. They implement the law structure and reference publication portion of §§15.8–15.9 only. Scanner, RUN evaluation, receipt@2, durable persistence, and hosted authorization are separate gates.

- The publication boundary accepts strict JSON text, bounded at 65,536 UTF-8 bytes both before parsing and in canonical form, at most 16,384 JSON value nodes, and at most 64 JSON nesting levels. These are initial reference admission limits, not measured hosted capacity. Integer JSON values outside the safe integer range are rejected. Invalid law structure uses `process_type_invalid` with a field path; strict encoding errors retain their encoding error.
- Static expression validation traverses every branch, rejects nonoperators and invalid arities, and permits only literal nonempty paths for `var` and `has`. Recognition cannot read machine paths. RUN machine paths refer to the declared direct predecessors and citation slots, and the four scalar machine roots in §15.9.1. Missing actual values are still a runtime question. Static validity does not prove a predicate returns a boolean or a RUN will succeed.
- A local registry is owned by a trusted caller, not directly exposed to an untrusted network client. Publication of the same id and canonical content returns the original hash, including after retirement; it does not implicitly reactivate a retired law. Different content under a published id fails with `process_exists`. Amendment uses a new id. Retirement removes the law from subsequent captures but keeps it retrievable by hash. Retirement of an unknown id fails with `process_missing`.
- Snapshot capture takes the current active hash set synchronously, sorts it, then hashes the immutable copy; a later publication or retirement cannot affect a captured snapshot. Captured snapshots remain retrievable by hash for the lifetime of the reference registry. Returned law/snapshot values are defensive copies. Snapshot shape validation does not itself prove the integrity or availability of all laws; PR-04 validates each referenced law before scanning. The reference registry is memory-only; historical durability and authorization are M2/M3 work.
- No scanner is invoked and no receipt, instance, resource effect or participant reaction is produced by publishing a type. No SQL evaluation, Skill-script execution or new hosted service is introduced.

### 15.11 PR-04 — Reference recognition profile

The runtime-neutral reference exposes scan(tupleJson, registryHash, registryJson, lawJsonByHash). The caller supplies authoritative admission evidence or historical replay evidence; the scanner verifies shape, canonical hash, availability and unique active law identifiers before evaluating any predicate. The map is captured before asynchronous hashing. Unreferenced objects do not participate. A valid hash establishes content identity, not the caller's authority or the freshness/completeness of the registry. The scanner neither admits an authenticated request nor executes a RUN.

The reference result contains outcome (none, unique, ambiguous, or indeterminate), matches (hashes of predicates that returned exactly true, in registry order), selected (the unique selected hash, otherwise null), diagnostics (law_hash/code pairs in registry order), and ops_used (consumed logical units, capped at scan_ops). Even if matches contains one or more hashes, indeterminate never selects a law. A non-boolean predicate records recognize_non_boolean; an expression error records its stable eval_* code. Continue through predicate errors until all candidates are evaluated or the shared budget is exhausted. Charge one unit per candidate plus one per expression operator. Exhaustion before or during a candidate records eval_budget for that candidate and stops the scan; a fully evaluated scan that uses exactly the budget is not exhausted. These are reference diagnostics; PR-05 binds the final receipt representation and reason codes.

Malformed input uses ijson; missing referenced law evidence uses scan_registry_missing; malformed, mismatched or contradictory registry evidence uses scan_registry_invalid. These are request failures, not recognition outcomes. Initial local admission bounds are 65,536 UTF-8 tuple bytes, 524,288 snapshot bytes, 4,096 referenced laws and 16,777,216 total referenced law bytes, with the existing per-law limits in §15.10. Exceeding a reference scan admission bound fails with scan_limit; an invalid or oversized law is invalid registry evidence. These local resource bounds are provisional implementation parameters for review before the protocol freeze, not hosted capacity promises or universal semantic maxima. They do not alter the meaning of scan_ops. The logical budget is not a CPU-time guarantee.

The portable recognition vectors specify independently calculated addresses, expected dispositions and hand-counted logical costs. Cross-runtime checks, historical snapshot tests, byte-limit checks and targeted mutation tests are part of the acceptance evidence. No receipt, instance, publication, effect or participant reaction is produced by scanning.

### 15.12 Coordinated machine-readable contract review (PR-05–08)

Status: **review checkpoint, not a frozen contract or implementation of RUN/receipt@2**. The single [structural schema](contracts/radio.schema.json) uses JSON Schema 2020-12 named definitions for the existing Process Type/RUN, registry and scanner evidence, free tuple, submission and continuation, request/key hash inputs, receipt@2, detail@2, context@1, key ring and bundle@2. The schema root intentionally rejects unqualified validation; select the named definition. It is a projection of §§15.8–15.11 for coordinated review, not a competing normative specification. Do not apply it to historical v1 objects. The exact resolved-observation subshape (root/parents/cites), known-law unknown-RUN disposition and primary reason code vocabulary are **review proposals**, not approved encodings. The review-only DecisionParts definition composes the existing header, detail and context for cross-part structural checks; it is not an additional wire object or authoritative record. Exact diagnostic strings and replay algorithms remain to be completed before runtime implementation relies on them. No invented DIPLOMACY manifest, MAP, delegation, history, transport-version wrapper or MCP wire contract is included.

Structural validation is not admission, recognition, execution, authority, replay or a commit guarantee. Strict I-JSON parsing must precede validation; canonical UTF-16 ordering, UTF-16 string limits, decoded base64url verification and entropy requirements, resource bounds, calendar validity, graph identity and path scope, hash/signature verification, cross-object references, authenticity and authoritative negative observations require the existing semantic checks or their approved target implementations. Canonical unpadded base64url shape is constrained in the schema (including unused trailing bits); unpredictable submission generation cannot be validated from a string. The schema cannot establish uniqueness across commits or prove missing evidence. In particular arbitrary tuple data must not be interpreted as an envelope just because it resembles one; expected types follow the verified reference and address domain. The runtime retains one TypeScript evaluator, with no schema engine in its execution path.

The contract tests compile every definition with a separately pinned development-only JSON Schema validator, check historical independent Process Type/recognition expectations without rewriting them, and exercise structural negatives and explicit semantic limits. The new non-frozen [receipt contract fixture](vectors/receipt-v2-contract.json) contains two independent successful entries and one successful continuation; expected decisions are manually specified, addresses and Ed25519 signatures produced independently of RADIO using Python on an ASCII/small-integer JSON subset. The tests verify address relationships and the v2 signature domain with a separate cryptographic API, including rejection under v1. These fixtures are **not** proof that the target runtime evaluates or verifies receipts. PR-05 must implement and test positive, negative, doubt and registered results with stable reason codes; PR-06–08 must implement continuity, atomic claims and complete replay. Close the remaining machine-facing boundary contracts as a coherent set in Cycle I before freeze, without introducing unapproved semantics.

#### 15.12.1 Review of the decision boundary (approval pending)

The following narrow resolution proposals close ambiguities in §15.9 without introducing a new RUN primitive or changing historical v1. The schema remains a review projection; ReasonCodeDraft is intentionally not yet a closed enum in the base DetailV2 definition. The architect must approve these choices before the evaluator issues v2 receipts.

| Disposition | Header and evidence | Proposed primary reason |
|---|---|---|
| Initial no match / overlap / indeterminate | _unaddressed; null process, law hash, RUN and instance; current snapshot; scan evidence; no causal edges or claims | recognition_none / recognition_ambiguous / recognition_indeterminate |
| Continuation cannot resolve an accessible authentic entry and its trustworthy law | _unaddressed; null process, law hash, RUN and instance; current snapshot; no scan, no inferred edges or claims | continuation_unavailable |
| Entry and law resolved but requested RUN is absent or is the entry RUN | Known frequency and law hash; run: null; root instance and its original snapshot; only resolved root as causal predecessor; no scan, no RUN evaluation | run_unavailable |
| Known successor lacks eligible parents | Known law, RUN, root instance and original snapshot; no evaluation | parents_unmet |
| Known successor has an existing success claim | Same bindings; record conflicting receipt in context.completed; no evaluation | run_completed |
| Required tuple fields missing or wrong type | Known law and RUN; no evaluation | requires_unmet |
| Required or explicitly supplied citation unusable | Known law and RUN; no evaluation; avoid distinguishing denied and absent evidence | cites_unmet |
| A relevant once claim is already spent | Known law and RUN; record relevant observed pairs; no evaluation | citation_spent |
| Activated check outcome not / doubt | Exact findings, no grants; not takes precedence over doubt | check_not / check_doubt |
| All checks ok but grant evaluation fails | Appended grants doubt finding, no grants | grants_doubt |
| Activated success | Status ok, null reason, null unmet, only successful findings; grants object or null according to law | null |

Proposed deterministic priority: recognition or root resolution first; then RUN existence/eligibility; then parent validation; then existing success claim; then required fields, citation eligibility and once claims; then evaluation and grants. Record a primary reason once; if reporting multiple activation gaps within a phase, use ascending UTF-16 field/role order. Do not disclose whether inaccessible evidence exists. A malformed envelope, failed admission, corrupt authoritative evidence or infrastructure failure is a request failure, not one of these registered dispositions. Error details for v2 should use stable evaluator codes rather than host exception messages or raw private values. Exact fixed diagnostic text and all error ordering require acceptance vectors before freeze.

Proposed meaning of context observations: resolved.root is the authentic, accessible entry used to resolve the original law; resolved.parents contains only authentic eligible same-instance predecessor receipts; resolved.cites contains authentic accessible citations satisfying slot frequency/status/detail constraints before the independent once check. A resolved citation that is already spent is still a real referenced object, not a successful consumption. Failed or inaccessible references are not causal edges. Use generic unmet diagnostics for unusable references and treat recorded absence as an attestation, not a lookup against every object subsequently included in the bundle. Only relevant spent pairs and a relevant completed claim may be recorded. A completed conflict receipt is evidence needed for replay, not automatically a parent or a member of prev. Replay must verify the referenced conflict and its scope; context does not prove that a competing receipt is absent globally. Do not add a second state object, inferred latest offer or alternate machine authority.

Remaining cross-object checks include exact header frequency/law identity, selected hash equality, hash of every part, effective instance and RUN identity, exact predecessor sets and resolved ids, observed once/completion scope, signature and trusted key window, canonical order, resource bounds and replay of the law-declared public projection. They are not expressible as portable JSON Schema equality assertions and remain semantic conformance requirements. In particular different RUN ids are not automatically mutually exclusive; the existing shared once-slot mechanism can express exclusivity only when the competing movements cite the same eligible receipt under the same law. Repetition beyond the finite DAG requires composed trajectories, not an implicit loop.
