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
  - lone surrogates and Unicode noncharacters (U+FDD0–U+FDEF and the last two code points of each plane);
  - unescaped control characters and malformed escapes in strings;
  - integers outside ±(2^53−1), including integer-valued parsed numbers written with a decimal point or exponent;
  - nesting deeper than 64;
  - trailing characters.

  Nothing is recorded for bytes that fail to parse, because there is no tuple to record.

## 3. Tuple

A tuple is any JSON value. Its fields are free: the machine never rejects a tuple for its shape. Conventionally it is a sentence: `who`, `did`, `this` (the frequency it is addressed to), `with` (the facts).

A public tuple hash permits offline guessing of low-entropy private data. Where the application law permits an object with a top-level `salt`, use at least 128 random bits (base64url) and keep the salt private. This technique does not apply uniformly to arbitrary JSON tuples, including scalars. The current hash is an integrity address. Randomized commitments would require a versioned change.

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
| `add_days` | date, integer | A date in years 0000–9999. Crossing either boundary raises `eval_range`. |

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

The sole standing application server in the target architecture is the native identity authority. The Institution preserves continuity through durable laws, receipts and their evidence, not a resident process or suspended workflow. Scanner, RUN evaluation, signing and submission handling are request-scoped; no instance requires an open session, worker affinity or a dedicated process. Managed persistence and communication services may remain active; the single-server principle is logical, not a physical deployment count or an assertion of zero idle infrastructure cost. The identity server authenticates participation; authorization and machine signing remain distinct boundaries. See VISION, The Institution as a Living Server.

The account identifier stays private; the machine attests a pseudonym derived from verified identity. Publication requires authority; an amendment creates a new content address. Private evidence access must be checked independently of the public header. Published laws must be reviewed for disclosure through their output fields. Machine keys and OAuth keys remain separate. The operator controlling the signing key can issue receipts; individual receipt verification is not proof of the completeness or global consistency of the ledger. For an external effect, the protected executor must enforce the exact authorization, with replay protection and recoverable commit semantics. A receipt of authorization is not proof of execution.

Community and authority scope must be explicit before multi-community operation. The same code base may serve a single community or a larger hosted service; no cross-community access or consumption guarantee is implied by this goal. Physical scaling and cost require measurement.

### 15.4 DIPLOMACY and Agent Skills interoperability — adopted conceptual direction

Agent Skills (https://agentskills.io/specification) define an agent-facing directory with a `SKILL.md` containing YAML metadata (`name`, `description` required) and Markdown instructions; other resources are optional. A RADIO Process Type is a machine-facing JSON law, not a Markdown instruction set. A skill may explain translation, discovery, valid submissions, listening and continuation for one or more laws. It cannot grant authority, alter recognition, or provide executable semantics merely by asserting them.

The adopted conceptual direction is [DIPLOMACY](DIPLOMACY.md): a portable package with one canonical Process Type and one or more participant-facing Agent Skills. The package is not the law or a Process instance. Its proposed minimum layout is described in the founding article; [GLOSSARY.md](GLOSSARY.md) records the vocabulary. ZIP transport and revisions of instructions do not define law identity. The law's hash follows the canonical JSON rule; instructions are non-authoritative unless a future law explicitly binds supporting content. A machine must not execute arbitrary Skill scripts or interpret instructions to determine the legal result. The exact manifest, component digest/binding, archive safety profile and validation rules remain open for review before the protocol freeze. The machine continues to work with canonical law JSON alone.

### 15.5 Compatibility and verification checkpoint

The existing `process@1` evaluator selects by `tuple.this`, evaluates a single law and supports legacy `on` reactions. The current hosted preview uses root-only writes and a reserved internal outbox; no reaction worker is implemented. The target scanner is implemented in PR-04; PR-05–09 implement the local v2 evaluation, instance, atomicity, verification and continuity reference. Native hosted target materialization remains pending. Version incompatible changes explicitly before coding; retain v1 vectors and do not reinterpret historical signatures.

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

Status: **approved to proceed and merged as GitHub #4; PR-05 reference evaluation and tentative receipt@2 signing and PR-06 local instance persistence merged; PR-07 atomic claim/retry acceptance and PR-08 full portable verification pending**. This completes the kernel contract for the next version without changing `process@1`, `receipt@1`, or historical v1 vectors. It uses the approved recognition semantics in §15.8. The first RUN constitutes the instance; there is no authoritative mutable process object, scheduler or internal reaction loop.

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

`detail@2` has the v1 consequence, findings, unmet and grants fields plus a stable `reason` code (null on `ok`) and `recognition` (initial scan outcome with matching hashes and diagnostics, null for continuation). The exact private `context@1` CAS object contains `submission`, `request_hash`, `continue` (null or the exact request), `spent` (sorted unique pairs `{slot,id}` under the selected law), `completed` (null or the conflicting successful receipt id), and `resolved` (root/parent/citation ids actually resolved, by role). It binds all relevant ledger observations and the explicit request without publishing them. For every reference that influences replay, a bundle must distinguish available authentic objects from authoritative negative observations; replay uses exactly the recorded availability and conflict observations and rejects mismatches, rather than accepting any extra object as if present at admission. Negative observations are machine attestations, not mathematical proof of global absence. Primary reason codes and disposition priority are approved in §15.12.1; exact diagnostic text and ordering must be verified with the conformance vectors in PR-05; they cannot depend on database messages or host exceptions. Reject unknown fields in the new version and canonicalize all maps/sets as specified. Public data is exclusively the law-declared projection plus header fields; the detail and context remain private subject to authorization.

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

Status: **architect-approved decision boundary and structural contract checkpoint (2026-11-26); not a frozen RADIO 1.0 release or implementation of RUN/receipt@2**. The single [structural schema](contracts/radio.schema.json) uses JSON Schema 2020-12 named definitions for the existing Process Type/RUN, registry and scanner evidence, free tuple, submission and continuation, request/key hash inputs, receipt@2, detail@2, context@1, key ring and bundle@2. The schema root intentionally rejects unqualified validation; select the named definition. It is a projection of §§15.8–15.12 for coordinated review, not a competing normative specification. Do not apply it to historical v1 objects. The resolved-observation subshape (root/parents/cites), known-law unknown-RUN disposition and primary reason code vocabulary are architect-approved in §15.12.1. The review-only DecisionParts definition composes the existing header, detail and context for cross-part structural checks; it is not an additional wire object or authoritative record. Exact diagnostic strings and replay algorithms remain to be completed before runtime implementation relies on them. No invented DIPLOMACY manifest, MAP, delegation, history, transport-version wrapper or MCP wire contract is included.

Structural validation is not admission, recognition, execution, authority, replay or a commit guarantee. Strict I-JSON parsing must precede validation; canonical UTF-16 ordering, UTF-16 string limits, decoded base64url verification and entropy requirements, resource bounds, calendar validity, graph identity and path scope, hash/signature verification, cross-object references, authenticity and authoritative negative observations require the existing semantic checks or their approved target implementations. Canonical unpadded base64url shape is constrained in the schema (including unused trailing bits); unpredictable submission generation cannot be validated from a string. The schema cannot establish uniqueness across commits or prove missing evidence. In particular arbitrary tuple data must not be interpreted as an envelope just because it resembles one; expected types follow the verified reference and address domain. The runtime retains one TypeScript evaluator, with no schema engine in its execution path.

The contract tests compile every definition with a separately pinned development-only JSON Schema validator, check historical independent Process Type/recognition expectations without rewriting them, and exercise structural negatives and explicit semantic limits. The new non-frozen [receipt contract fixture](vectors/receipt-v2-contract.json) contains two independent successful entries and one successful continuation; expected decisions are manually specified, addresses and Ed25519 signatures produced independently of RADIO using Python on an ASCII/small-integer JSON subset. The tests verify address relationships and the v2 signature domain with a separate cryptographic API, including rejection under v1. These fixtures are **not** proof that the target runtime evaluates or verifies receipts. PR-05 reference evaluation and tentative signing now implement the four dispositions with fixed diagnostics (see §15.13); PR-06–08 must integrate durable instance formation, atomic claims and complete replay. Close the remaining machine-facing boundary contracts as a coherent set in Cycle I before freeze, without introducing unapproved semantics.

#### 15.12.1 Decision boundary (architect-approved 2026-11-26)

The following approved resolutions close ambiguities in §15.9 without introducing a new RUN primitive or changing historical v1. ReasonCode is a closed enum in DetailV2; DecisionParts constrains the reason by disposition. The overall protocol freeze and executable acceptance gates remain pending.

| Disposition | Header and evidence | Primary reason |
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

Deterministic priority: recognition or root resolution first; then RUN existence/eligibility; then parent validation; then existing success claim; then required fields, citation eligibility and once claims; then evaluation and grants. Record a primary reason once; if reporting multiple activation gaps within a phase, use ascending UTF-16 field/role order. Do not disclose whether inaccessible evidence exists. A malformed envelope, failed admission, corrupt authoritative evidence or infrastructure failure is a request failure, not one of these registered dispositions. Error details for v2 should use stable evaluator codes rather than host exception messages or raw private values. Exact fixed diagnostic text and all error ordering require acceptance vectors before freeze.

Meaning of context observations: resolved.root is the authentic, accessible entry used to resolve the original law; resolved.parents contains only authentic eligible same-instance predecessor receipts; resolved.cites contains authentic accessible citations satisfying slot frequency/status/detail constraints before the independent once check. A resolved citation that is already spent is still a real referenced object, not a successful consumption. Failed or inaccessible references are not causal edges. Use generic unmet diagnostics for unusable references and treat recorded absence as an attestation, not a lookup against every object subsequently included in the bundle. Only relevant spent pairs and a relevant completed claim may be recorded. A completed conflict receipt is evidence needed for replay, not automatically a parent or a member of prev. Replay must verify the referenced conflict and its scope; context does not prove that a competing receipt is absent globally. Do not add a second state object, inferred latest offer or alternate machine authority.

Remaining cross-object checks include exact header frequency/law identity, selected hash equality, hash of every part, effective instance and RUN identity, exact predecessor sets and resolved ids, observed once/completion scope, signature and trusted key window, canonical order, resource bounds and replay of the law-declared public projection. They are not expressible as portable JSON Schema equality assertions and remain semantic conformance requirements. In particular different RUN ids are not automatically mutually exclusive; the existing shared once-slot mechanism can express exclusivity only when the competing movements cite the same eligible receipt under the same law. Repetition beyond the finite DAG requires composed trajectories, not an implicit loop.

### 15.13 PR-05 — Request-scoped reference RUN evaluation

The runtime-neutral reference exposes parseSubmissionV2(text), runV2(text, options), issueV2(key, text, options), and authenticV2(receipt, trustedKeys). The first parses the transport body; the second computes a deterministic tentative decision; the third signs a candidate in the v2 domain; the fourth checks the exact versioned public envelope, content address, trusted key thumbprint/window and signature. Authenticity is not evidence replay. None of these functions commits, acknowledges, broadcasts, creates an authoritative instance or enforces transactional uniqueness. No v2 hosted route is enabled. PR-06 connects this request-scoped mechanism to the reference ledger (§15.14); PR-07 strengthens and verifies the atomic claim/retry boundary; PR-08 completes independent evidence verification.

RunV2Options is a trusted local adapter interface, not a participant-controlled wire contract. The host supplies the attested time and actor, authoritative current snapshot hash, content-addressed law and snapshot evidence, independently trusted machine keys, authorized receipt/detail resolution, and observed completion and once claims. It must enforce admission, evidence access and participation authority before exposing any result. Capture maps, identity and keys before asynchronous evaluation. Resolve a referenced receipt once per attempt. A null read is unavailable (including inaccessible); an inconsistent authoritative object, missing immutable law/snapshot referenced by a trusted entry, or a failed infrastructure operation is a request failure. A returned authoritative receipt must have the requested address, appropriate versioned signature and hash-bound detail; eligibility is checked independently. An observed completed claim must itself resolve to an authentic successful receipt of the same law, instance and RUN. The observed once claim is scoped by law hash, slot and cited id. Neither observation is a proof of global absence or of a successful atomic commit.

The fixed v2 diagnostic profile is intentionally compact. A registered result uses the consequence "Recorded. The RUN did not activate." Its unmet list contains the primary recognition code for an initial scan failure, "continuation" for unavailable entry resolution, "run" for an unavailable or completed RUN, "parents" for a mismatched parent-role set, otherwise the sorted unmet parent roles (parents.<role>), required tuple paths or citation roles (cites.<slot>), according to the approved phase priority. Report only the first failing phase; no evaluation or later claim query on unmet activation. For an activated result use the law's consequence and ordered findings, with stable evaluator codes instead of host exception messages; a grant error appends the grants doubt finding with reason "The grants could not be computed." Unknown infrastructure errors propagate. A computed non-I-JSON grant becomes doubt (eval_range for unsafe numeric/depth results, eval_type for invalid JSON type/string); do not sign malformed evidence. Explicitly supplied malformed citation containers are unmet even for optional slots; unrelated tuple fields remain free. A cited historical v1 receipt retains its v1 signature rules. A resolved spent citation remains in prev and context.resolved.cites; a completed claim is context evidence, not an implicit causal edge.

Provisional local resource profile: submission envelope at most 131,072 UTF-8 bytes, canonical tuple at most 65,536 bytes, free tuple nesting at most 64, continuation parent map at most 64 entries, canonical 16–96-byte unpadded base64url nonce, attested nonempty by at most 256 UTF-16 code units and real UTC calendar timestamp at second resolution. Computed parts must be I-JSON. See §15.18.6 for the hardened evaluation, evidence and signed receipt limits.

The original three independently signed receipt-v2-contract fixtures remain unchanged. The new run-v2 vectors contain 28 further manually specified, independently signed outcomes covering recognition, all primary reason codes, strict truth, stable check/grant errors, free scalar input, identity, historical law continuation, incompatible parents, conflict observations, historical/v2 citations and scoped consumption. Node, Bun and Chromium execute the same vectors against actual evaluation and signature issuance; separate tests exercise admission, tampered evidence, trust windows, result structure, capture before await and observation ordering. Targeted mutations verify these tests detect violations. This is executable evidence for pure evaluation and candidate signing, not durable v2 execution, final offline replay or Supabase service integration.

### 15.14 PR-06 — Reference instance formation and recovery

ProcessLedger is the target-version local reference integration of runV2/issueV2, not another evaluator or a production server. The historical MemoryLedger and its record format remain available. The first successful receipt's own id identifies its instance; successors use explicit root and parent receipt ids. There is no separate mutable Process record or automatic progression. The reference supports immutable publication, retirement, independent instances, multi-parent continuation and recorded failures. An authorized participant can continue an instance after its law is retired because the original law and registry snapshot are retained.

The local record sink receives a complete publication, retirement or receipt-v2 record. A receipt record contains its sequence, signed receipt, detail, context, tuple and captured admission snapshot. This is local storage scaffolding, not a new normative wire object or bundle format. With a durable sink, the record is acknowledged before indexes become visible or the public receipt is delivered to listeners. In-memory operation alone is not durable. A single reference writer serializes publication, retirement, submissions and commit. Submission, completion and once indexes are derived from committed receipts, not separate authorities. Retry recovers the original result by the attested actor and submission nonce; changed request hash is a conflict; an inaccessible cached result is not returned. Failed activation does not consume a claim. An ambiguous sink error stops writes until recovery; listener failure does not undo a commit.

The Node-only openProcessMachine adapter reuses the existing hash-chained append log and fsync path; it does not start an HTTP server. It opens a target-format directory, not an implicit migration of a historical v1 log. Recovery validates signatures, publication and admission snapshot history and re-evaluates every committed v2 decision against the prior prefix using the signed observations of authorized availability and derived claim indexes. It does not rerun historical authorization against current policy. The original machine key and identity secret are required for a nonempty target log; the scan budget is recovered from the first receipt when not supplied, and a conflicting budget fails replay. Recovery of a torn final line is the existing reference behavior. This reference assumes exclusive ownership of the directory by one writer, a trusted sink and trusted host authorization; it is not a multiprocess lock, distributed transaction or externally anchored ledger. Power-loss guarantees across filesystem metadata and OS/hardware failures are not established by these tests. An explicitly authorized v1 citation is supported by the pure evaluator, but mixed-version persistent log import is not implemented in this increment. The target reference does not expose a participant-facing authorization API; the host must authenticate, authorize evidence use and protect all private entry, detail and context access. PR-07 exercises the reference concurrency, failure boundaries and retry claims in §15.15; PR-08 verifies portable bundles independently of the authoritative local prefix (§15.16).

The instance conformance harness runs the existing independently signed receipt fixtures through actual reference commits and recovery on Node, Bun and Chromium; no prior expected result is rewritten. It also checks scoped consumption after restart and refusal of alternative successors. Local integration tests exercise a real file, independent roots, nonlinear branches, denied evidence, retirement, cached retries, corruption and write failures. These are evidence of local reference behavior, not live Supabase, distributed concurrency or full portable replay.

### 15.15 PR-07 — Atomic uniqueness and retry acceptance

The logical commit unit is one complete submission record (receipt, all hash-bound evidence, submission identity, and any successful RUN/once claims). No observer may see a tentative receipt or any claim derived from it. The local reference serializes writes; admission for evaluation (including the attested clock and active registry snapshot) occurs inside that serialized boundary, after the retry lookup. Request bytes and attested actor are captured before queuing. A queued competing request therefore evaluates against the already committed prefix. A retry does not re-evaluate, allocate a fresh time or emit another notification. Publication and retirement share the same serialization boundary. The local reference does not need an optimistic retry engine, and the protocol does not require global serialization of the native implementation.

An alternative materialization may evaluate more than one candidate against the same observation. A signed candidate is not a committed receipt. If a commit conflicts, discard the tentative output; a same-key/same-request conflict returns the recorded result, a changed request hash fails, and a success/once conflict requires re-evaluation using updated authoritative observations under the original admitted request, law and time, as specified in §15.9.3. Never retry a different intent or reinterpret it under an amended law. Claim uniqueness and evidence persistence must hold in one transaction; an unsuccessful decision has no successful claims. A storage exception may mean no durable write or a durable write with a lost acknowledgement. The reference stops accepting writes after either exception; recover the actual committed prefix before retrying. If the record exists, return the identical committed result; otherwise evaluate a new attempt for that uncommitted request. No notification is sent for an unacknowledged write on that writer. Recovery restores history and indexes without re-emitting historical events. Public reference readers cannot observe a partially reconstructed prefix before its validation completes; failed recovery exposes no recovered entries.

The PR-07 portable acceptance scenarios run the actual reference ledger with controlled concurrent submissions and blocked commit acknowledgements. They cover same-nonce retries and conflicting payloads, independent actors, simultaneous success claims, competing movements sharing a once slot, failed activation, retirement ordering, failure before the write, and recovery visibility. A separate scenario forces two successful tentative evaluations from identical unspent observations and checks the losing result after the authoritative claim is observed, preserving its admitted clock, law, request hash and submission key. This tests the evaluator's conflict re-evaluation contract; it is not a native database commit or proof of an optimistic adapter. Local tests inject a lost acknowledgement after a complete record is accepted, and replace a real Node writer killed before evaluation or after fsync but before the submit response. Recovery returns the exact recorded receipt and prevents the competing claim. These tests establish the reference behavior under those conditions, not power-loss durability, cross-process concurrent writers, distributed atomicity or a real Supabase service.

The native acceptance gate must reproduce these semantic outcomes using PostgreSQL constraints and atomic transactions, with forced overlapping observations at commit, rollback of every touched object/index and notification record, and fresh Edge invocations that do not depend on process memory. Do not change the reference expectations to fit a storage-specific implementation. No new wire object, provider abstraction or native implementation is introduced by this gate.

### 15.16 PR-08 — Portable trajectory verification

The target reference exports a bundle@2 using the existing signed receipts and content addresses. ProcessLedger.bundle(id) is a trusted local export: it gathers the head, causal predecessors, the completion-conflict receipt when recorded, every corresponding detail, tuple and context, and all laws of each bound registry snapshot. It does not include unrelated attempts or implicitly authorize disclosure. The host must authorize every private object before exposing a bundle. No new authoritative object, mutable projection or public route is introduced. Receipt envelopes are indexed by hash(header); all other referenced objects, including a free tuple resembling a receipt envelope, use hash(the full object). A duplicate address with different content or use of the same address in incompatible address domains is rejected. Keys in a bundle are public convenience metadata, not a trust source.

verifyBundleV2(text, trustedKeys) accepts raw JSON and independently supplied trusted keys. Strict parsing rejects duplicate names, unsafe integer encodings, invalid strings and unknown bundle fields; referenced objects are checked by their expected address domain and version. The provisional verdict interface separates authenticity of the head, decision replay of the head, and recursive trajectory verification. Each is pass, fail, incomplete (a required object is absent), or not_checked. The overall valid flag requires all three to pass; a missing object never establishes full replay. A head may replay even though an ancestor lacks its own tuple or law, in which case trajectory verification is incomplete. A head can be authentic and semantically wrong. Checked ids identify replayed decisions, not a claim of ledger-wide completeness.

Replay uses the same normative deterministic evaluator, but no issuing ledger, storage API, private signing key, current clock, current registry or current authorization policy. It reconstructs the submitted tuple and explicit continuation from the signed context, uses the signed identity and time, and compares the entire reproduced header, detail, context and id. Initial recognition needs all candidate laws in the signed registry, even those that did not match. For a resolved continuation, the bound historical registry is sufficient; the current registry at that later submission is not committed by its header and is not used to reinterpret its law. Only the recorded resolved roles and completion observation are available to the replay; extra objects never turn denied or unavailable evidence into an admitted fact. The recorded spent pairs are machine attestations scoped to the law, slot and citation; context@1 does not identify the consuming receipt, so replay cannot independently prove the existence or global uniqueness of an unprovided consumption. A completed claim does identify a receipt, which must be included and replayed, even though it is not necessarily a causal predecessor.

The verifier follows the supplied causal and completion-evidence closure, checks address integrity and versioned signatures, detects cycles and conflicting v2 submission, successful RUN and once claims within that closure, and replays every reachable decision. Extra objects are checked for address integrity but are not asserted to be trusted, admitted, causally relevant or replayed. Closure consistency does not prove that another contradictory receipt was never issued outside the supplied evidence. Historical v1 envelopes use the v1 signature/replay path; available historical references are constrained to the recorded predecessor set. A v1 decision whose unavailable/invalid citation observations cannot be reproduced from its historical evidence does not receive full verification. The unchanged historical v1 API and vectors remain available. Mixed-version verification does not imply mixed-version persistent import. Verification is independent of the issuing runtime and storage, not a second implementation of the semantic evaluator; independently produced signed vectors continue to supply the external expected values.

Provisional local verification resource profile: bundle JSON at most 32 MiB, at most 32,768 object addresses and 4,096 reachable receipts, with the existing per-object parsing bounds. This is not a universal wire maximum or a measured hosted resource guarantee. The portable checks include all 31 independent signed v2 decisions (including historical v1 citation evidence), wrong signatures/trust windows, missing and tampered evidence, attested negative observations, signed inconsistent outputs, conflict evidence and contradictory successful candidates within the closure. The small trajectory example demonstrates two distinct histories with the same nonauthoritative course-completion projection. No claim of external effect, global completeness, current authorization or native Supabase conformance is made.

### 15.17 PR-09 — Local continuity demonstration

The existing optional Node HTTP/SSE reference supports an explicit target mode (openProcessMachine, or logline-server serve --target with a separate data directory). It remains a test and demonstration adapter, not a second hosted backend or an alternative identity authority. Historical mode and its v1 endpoint defaults remain available. Target mode uses the same ProcessLedger, RUN evaluator, record sink, CAS export and portable verifier. Its local version marker (LogLine-Version: 2, machine@2 discovery) and route shapes are a demonstration profile, not the final transport/discovery contract; PR-09A reviews the normative boundary together with the other interfaces.

In target mode a submission is an authenticated submission envelope; the adapter attests the actor from its existing local token and pseudonym mechanism, never from the tuple. The existing local owner/admin access policy is reused for publication, evidence use and disclosure. Cross-participant review in the demonstration uses a separately authenticated privileged reviewer. This is not a normative institution role, delegation model, OAuth implementation or proof of native identity. A participant with no authorized access to a root cannot continue it merely by hearing its public receipt. Bundle export authorizes every reachable receipt, including completion-conflict evidence, before returning the bundle. The response and private evidence remain subject to host policy; final disclosure and delegation rules belong to PR-09A.

History pages and SSE use the local committed receipt sequence (not file-record offsets, timestamps or a global protocol sequence). Filtering preserves sequence numbers, so gaps do not imply lost receipts. Explicit after or Last-Event-ID resumes exclusively after that cursor; the header takes precedence, zero requests catch-up from the beginning, omission subscribes live only. For this reference a cursor ahead of history does not rewind. Capture/replay and live subscription registration occur within one synchronous turn, with notifications only after acknowledged commit. Retries and restore do not rebroadcast old receipts. The stream carries only sequence and public signed receipt; private detail, tuple and context require an independent authorized request. Slow/disconnected listeners recover by cursor/history; streams and cursors are observer infrastructure, not authoritative institutional state. Local sequence is not a normative cross-community cursor or a promise of exactly-once network delivery; the receiver deduplicates by receipt id. No reaction worker or implicit next RUN is enabled.

The executable continuity acceptance uses a real local CLI server process and two independently authenticated participants. Both receive the same signed entry receipt through SSE; the reviewer explicitly submits a successor. The machine process is stopped, replaced using its durable directory, and a separate reader process catches up by the saved cursor. A fresh connection continues delivery while the reviewer submits the next RUN in the original instance. The issuing process is then shut down and the existing verify-bundle CLI verifies the raw v2 bundle with independently supplied public keys; the v2 CLI refuses to trust bundle-supplied keys alone. The test also checks unauthorized submission, publication and evidence access, scoped retry/conflict, no implicit reactions, public/private separation and the stability of machine keys and pseudonyms. Portable observer checks run across Node, Bun and Chromium, and the actual HTTP/CLI integration runs locally on Node and Bun test runners. This establishes continuity of the reference under replacement, not native OAuth, Realtime/WebSocket delivery, RLS, distributed writers or production conformance. Those remain explicit acceptance gates.

### 15.18 PR-09A — Coordinated boundary review (proposal, not yet approved)

This section is one coordinated review of §15.6, §15.9 and the M3–M5 acceptance gates. It is proposed for architect approval; it does not override the approved kernel or silently freeze a new wire contract. The existing named JSON Schema definitions remain unchanged. New named definitions marked PR-09A in contracts/radio.schema.json describe candidate external data shapes; the schema is not a permission engine. The local v1 and v2 reference transport profiles remain executable as documented. The 1.0 release number is distinct from receipt, package, transport and MCP protocol versions.

#### 15.18.1 Institution, identity and authority

Proposed initial scope: one logical machine serving one Institution, with one authoritative publication, commit, authorization and receipt trust boundary. The identity authority authenticates the principal; a client acts only within its admitted mandate. The machine attests a stable pseudonym for the verified principal within this machine, independent of OAuth client, token refresh, worker and request. Credentials, raw account IDs, client IDs, grant internals and signing secrets are not public receipt fields. Do not add an account, agent, mandate or Institution table to the semantic kernel merely to name these distinctions.

Every protected operation must independently validate credentials (including issuer, subject, intended resource/audience, expiry and client binding where applicable), admission to this Institution and the currently applicable permission. Effective authority is the intersection of principal authority, client mandate and resource/operation permission; default deny. Absence of a client identifier is not an administrator bypass: a direct user session needs an explicitly admitted direct-session policy. A valid user token, a role in a Skill, a claim inside a tuple, a public receipt, OAuth scope text or possession of a content hash is not sufficient permission. An admin using a read-only client cannot publish. A client with broad requested scope cannot expand the principal's authority. A delegated client acts as the authenticated principal for by; a separate actor requires its own admitted identity. No generic delegation chain, impersonation or on-behalf-of-principal field is introduced in 1.0. The host may retain protected authorization/audit evidence; the current signed context binds decision observations, not a portable proof that the OAuth grant was valid.

Separate permission to publish/retire law or distribute package, submit, listen/read public receipts, use a particular receipt/detail as formal evidence, and disclose private evidence/bundles. These are logical permissions, not a prescribed role table, token format or scope vocabulary. Publication reviews the law's potential disclosure through public fields, findings, consequences, grants and derived private results, including cited details. Access to a result is not necessarily access to all its source evidence. If a law is authorized to use protected input, it must not become a general read oracle. A publisher must establish that the allowed derived result may be disclosed to its intended audience. Evidence-use authorization is checked by the authoritative resolver; direct raw-object disclosure is independently checked. For roots and citations, unauthorized and absent remain indistinguishable as required by §15.12.1. Failed authentication, invalid admission and denied operation are request failures, not institutional registered outcomes.

Proposed visibility profile: discovery/public machine keys may be anonymous. The public signed header is the common institutional radio payload; "public" in receipt terminology means no private parts, not a universal permission to retrieve it. Default hosted visibility is authorized participants of that Institution; an explicitly approved open institution may expose exactly the same public law/header/history/radio surface anonymously. One visibility decision governs all these access paths; tuning cannot broaden it. Do not expose the hosted preview as an implicit anonymous policy. Private tuple, detail and context require explicit permission, and a complete bundle requires authorization for every private constituent, including completion-conflict evidence. Do not return partial private bundle content as a successful full export. The local owner/admin and open-read demo is not the normative hosted policy.

#### 15.18.2 Freshness and revocation

For newly admitted protected requests consult current authoritative grants; a cached credential's validity does not imply that its operation remains allowed. Proposed write rule: a grant withdrawn before the authoritative commit prevents that write, even if evaluation began earlier. Commit must recheck the authority or an equivalent transaction-bound authorization revision. Do not reclassify this as a RUN refusal. A retry first requires current operation and result-disclosure authority, and only then may return the old response. Never leak an old private result to a newly unauthorized client; keep the idempotency and conflict binding by principal, not by client. A request from another independently allowed client of the same principal can recover the same receipt. Changed permission must not cause a second successful effect for the same submission.

A protected live subscription is a bounded authorization lease, not permanent permission. Its maximum lifetime/freshness bound must be declared and tested for the deployed profile, cannot exceed the credential's validity, and is not silently extended by traffic. Renewal/reconnect checks current authorization. After grant revocation, no newly authorized operation or renewed lease is allowed; an already admitted live lease can deliver only until its declared deadline, unless terminated earlier. After the deadline stop protected delivery. No promise of instantaneous revocation of already delivered data, or of retroactive erasure. The physical enforcement mechanism and measured numeric live bound are a Cycle II release gate; if it cannot be enforced, do not expose the protected channel. Current-grant authorization for writes is not replaced by this lease rule. Retain a private record of the admitted principal, client or direct-session policy, protected grant revision, resource, operation and authoritative commit outcome under the Institution’s audit and retention policy. Do not store bearer tokens in the audit record. No resident custom authorization server or token cache is required.

#### 15.18.3 Stateless request, result, discovery and evidence

Proposed target request is the existing Submission; reject extra caller-controlled observations, authority and citation-bundle fields. Resolve citations from the authoritative local evidence boundary only, with the approved hashes, roles, trust and consumption checks. Import of a caller-supplied foreign bundle for execution is outside 1.0; offline verification of supplied evidence remains supported. Do not infer permission from an independently valid signature.

Use the existing local v2 root-only result as the candidate SubmitResult: receipt, detail, context, replayed. No reactions, no halted flag, no automatic RUN advancement. The caller must be allowed to receive the derived private result/context under the admission policy; do not use submission to bypass the disclosure rule. The approved signed parts are unchanged. A committed reply is one root receipt even for registered/not/doubt. Same key and request, when still authorized, returns the identical signed objects with replayed true; a different request hash fails. No tentative receipt, raw backend exception or private data may be presented as a committed result. Reserve the authoritative claims and all evidence in one transaction, recheck authority there, and use §15.15 conflict semantics. For ambiguous acknowledgement recover actual commit before returning or retrying. No reaction worker; remove unused preview reaction/outbox structures only in reviewed native migrations. A durable notification representation, if needed to provide atomic committed-only delivery, is infrastructure rather than a reaction job.

PrivateEvidence is the existing detail, tuple, context response; header-only receipt read and full BundleV2 remain distinct. The proposed Discovery shape reuses local machine@2, supported transport version ["2"], public key ring, advertised maxBody, ttlMs no greater than 60000, cacheScope public. Discovery excludes mutable head, active snapshot, cursor, permissions, credentials and private data. The current registry and historical laws are separate authorized reads. A version mismatch rejects before evaluation. Discovery and bundle keys are convenient public material, never bootstrap trust by themselves. Trust is pinned independently to the intended Institution; receipt signing is not OAuth signing. The VerificationVerdict candidate exposes the existing three independent verdicts, checked IDs and issue codes; valid means all three passed, not global completeness, present authority or external truth.

BoundaryFailure is a proposed stable transport-level error vocabulary, separate from the approved DetailV2 reason codes: invalid_request, unauthenticated, forbidden, not_found, unsupported_version, submission_conflict, cursor_invalid, cursor_expired, resource_limit, unavailable. Do not distinguish denied/absent private evidence where that distinction would disclose existence. The adapter maps native or local errors to those categories without exposing host messages; exact HTTP status / MCP protocol error mapping is reviewed with the actual transport in Cycle II. Request-scoped identity, submission, law discovery and evidence reads have identical meanings through API or MCP. No MCP session state, server-side conversational memory, required natural-language translator or implicit orchestration. Published MCP transport revision and client interoperability must be verified in PR-17, not invented here. MAP is excluded until its actual contract is supplied.

#### 15.18.4 Radio and closed-window history

Proposed logical event payload is the committed signed receipt (ReceiptNotice); transport metadata is not part of its identity. All subscribers within the same visibility policy receive the same object. Tuning applies AND across fields and OR within a value list, using the existing frequency-prefix, status, by, process_hash and activated predicates. Omission means no filter; lists are nonempty and unique in the candidate canonical transport shape. by=me is a client/adapter shorthand resolved to the authenticated pseudonym, not a semantic actor. _unaddressed may be selected explicitly. Do not broadcast private evidence or raw account IDs. Verify signatures independently before acting. A committed event is a hint to a durable receipt, never permission to act; duplicate and out-of-order delivery are permitted.

History must have a recoverable, bounded window of authorized committed receipts, not a best-effort realtime replay. A physical sequence allocated before commit is not a completion frontier. Proposed HistoryRequest has optional tuning, optional opaque after cursor and page limit (1–1000, default 100). HistoryPage contains items (public receipts), next and checkpoint; exactly one of next/checkpoint is non-null. A next cursor continues the same finite window; a completed-window checkpoint is issued only after exhausting it, including an empty matching window. Resuming from that checkpoint covers subsequent closed committed windows without skipping late commits. Stable pagination needs a deterministic order within a closed window, but receipt identity and causal order are independent of physical sequence. A later commit that allocated a smaller position must occur in a subsequent recoverable window if not already included. Rollback creates no receipt or required event. Do not advance a completed checkpoint from a live notification or a partial page.

The native candidate is database-originated Broadcast for low-latency delivery and PostgreSQL for durable history. The acceptance test forces a transaction with an earlier allocated position to commit after the first window closes and verifies recovery from its completed checkpoint. Realtime replay and retention do not define the institutional history.

Cursors are opaque, integrity-protected and bound to the logical machine, authorized visibility scope, normalized tuning and caller/client where protected. They are not credentials or causal evidence. With changed visibility or tuning, restart authorized history rather than reuse a cursor that could omit newly visible records; return cursor_invalid for incompatible scope or malformed cursor, cursor_expired for an unavailable retained window. On expiry explicitly recover the currently retained authorized history; do not report false completeness. The guarantee is the retained committed receipt set under stable authorized visibility, not every private object or every historical access policy. No global chronology or exact-once delivery claim. The participant owns checkpoint, verified-ID deduplication and private orchestration, can replace its listener, and may overlap live notifications with catch-up. Initial recovery from no checkpoint covers retained authorized history. Live reconnect starts a new independent request. The disposable PostgreSQL probe exercises transaction snapshot visibility with a late commit and a rollback. PR-15 must still prove bounded cursors, stable paging, authorization and operational cost for the chosen native mechanism. Choose the smallest native transaction/window mechanism that satisfies those tests; do not impose the local SSE sequence as a hosted storage design.

#### 15.18.5 DIPLOMACY minimal package

Proposed manifest uses only logline: "diplomacy@1" and files, a map from relative file path to SHA-256 address. The package id is hashOf(manifest) using existing JCS; the archive is only transport. No self-referential id, duplicate law hash field, signatures embedded in the manifest, institution binding, role permission or mutable package state. Exactly one root diplomacy.json, one root process-type.json, one or more skills/<name>/SKILL.md, and optional files within each named Skill directory. The manifest lists every regular file except itself, including process-type.json; unlisted or missing file is invalid. The law file must be the exact UTF-8 JCS of a valid Process Type (no BOM, trailing newline or other spelling); its file digest is therefore the existing law hash. Other file digests are SHA-256 of their exact uncompressed bytes, not interpreted Markdown, YAML or JSON. The manifest itself is strict I-JSON; its own formatting does not affect its canonical package identity. Any instruction change changes package identity but not necessarily law identity. Package integrity and publisher/adoption authority are separate checks. An Institution may adopt a package referring to a law that it has separately authorized; the package cannot authorize law publication by itself.

Use the existing Agent Skills specification (https://agentskills.io/specification, reviewed 2026-11-26): required YAML name and description, matching directory name, supported optional metadata and resource files. Do not invent a Skill dialect. Validate that every listed Skill directory contains its own valid SKILL.md, that names satisfy the standard, and that file paths cannot escape its directory. Package discovery derives law and Skill metadata from validated contents; no redundant normative description in the manifest. Scripts may be carried as resources; the RADIO machine never executes them. Participant runtime trust, sandboxing and permissions are independent. A Skill's tools or mandate description never grants RADIO authority.

Provisional safe archive review profile: single-disk ZIP, stored or deflate entries, no encryption, symbolic/hard links, special entries or alternate path aliases. Reject malformed or ambiguous local/central header names, overlapping entries, duplicate names, absolute or drive paths, backslashes, NUL/control characters, dot segments, case-fold collisions (including directories), file-directory conflicts and reserved platform names. Paths use conservative ASCII relative segments (as projected in DiplomacyPath); reject a segment ending in dot, and portable reserved device names regardless of extension. Explicit directory records, if present, must be unique prefixes of listed regular files; ignore directory metadata, not unsafe names. No arbitrary archive extraction. Validate actual decompressed sizes and digests before adopting/publishing; do not trust size declarations. Proposed resource bounds for review: archive at most 8 MiB, actual uncompressed files plus manifest at most 8 MiB, each Skill file at most 2 MiB, manifest at most 64 KiB, at most 256 listed regular files, paths at most 512 ASCII bytes, law's existing 64 KiB bound, and Skill frontmatter at most 65,536 UTF-16 code units. Compression method, order, archive timestamps and optional valid directory records do not affect package identity. ZIP64 and multidisk are excluded in this profile. Reject unsupported features instead of partial extraction. The reference archive validator runs outside the evaluator. PR-19 covers distribution and agent interoperability.

#### 15.18.6 Explicit exclusions and outstanding acceptance

Proposed 1.0 excludes cross-institution/federated execution and cross-law/global consumption, automatic reactions, external-effect fulfillment, standardized key rotation receipts or automatic trust transfer, anchoring/Merkle logs, private erasure/encryption protocols, and MAP wire compatibility. Existing trust windows and independent key provisioning apply; keep previously trusted verification keys for retained evidence, use separately approved operator procedures for key changes, and do not imply a standard rotation protocol. Backup/recovery, retention, secret storage and legal/privacy obligations are operational requirements, not proven by offline replay. The selected hosted project, actual deployment and production authorization remain separate approvals. No automatic Supabase write or new provider abstraction.

The hardened draft reference profile applies to new v2 decisions and replay under that profile. It preserves historical v1 receipt encoding and the existing signed fixtures. The historical v1 evaluator keeps its original logical budget; the shared strict parser and four-digit calendar check enforce the encoding and date requirements in §§2 and 5. A pre-freeze v2 artifact outside the new profile may still pass authenticity without passing replay under the hardened profile. A formally supported alternate historical evaluation profile would need explicit versioning.

- Publication and scanner share a ceiling of 4,096 active laws and 16 MiB of aggregate active law bytes (canonical UTF-8 at publication). Scanner checks the supplied law text limits as well. A rejected publication must precede any durable write. Retirement releases active capacity while preserving historical laws.
- Scanner and RUN each have a shared 4,194,304-unit work budget in addition to logical operations. Each visited expression node costs one unit, path resolution costs the path length in UTF-16 units, and inspected value size costs canonical UTF-8 bytes (including JSON syntax and escapes). Each constructed intermediate array or concat result may occupy at most 65,536 canonical bytes. Bounds are checked incrementally before serializing/composing oversized values. Exhaustion raises `eval_budget`; an intermediate value exceeding the size bound raises `eval_range`. Existing scanner diagnostics and RUN outcomes apply to evaluator failures.
- Canonical DetailV2 and ContextV1 each have a limit of 1 MiB. The complete canonical signed ReceiptV2 has a limit of 240 KiB (245,760 bytes), reserving space for transport framing within a 256 KiB payload. Check its exact size with the fixed-width signature envelope before signing. Oversize or unencodable results fail the request (`result_limit`) before any receipt, claim, or notification is committed. A deployed profile must verify its complete serialized notice, including framing, at the native transport boundary.
- A single evidence response (receipt and detail together) may occupy at most 1 MiB + 240 KiB + 64 bytes, and a RUN may inspect at most 8 MiB of canonical evidence responses over distinct addresses. The evaluator applies these limits before copying or hashing the evidence. Native resolvers must bound the bytes they fetch and decode as well. Bundle verification reuses validated laws and snapshots for the lifetime of a single verification. Its v2 replay allowance is 256 Mi work units, charged for request and resolved evidence bytes and evaluator work. The trusted key ring is bounded at 1 MiB in the reference v2 evaluator.

Reference limits are candidates for freeze and require separate hosted capacity measurements. Do not silently narrow the tuple type to fit JSONB or native product limits. The actual Deno/Edge, PostgreSQL, RLS, OAuth and Realtime checks remain Cycle II gates, with the same rigid expected semantics. Local reference tests and modeled expectations do not demonstrate those native boundaries.

Read-only materialization check (2026-11-26): the native [OAuth token/RLS guidance](https://supabase.com/docs/guides/auth/oauth-server/token-security) distinguishes OIDC scopes from resource permissions and documents client_id in access JWTs. The target policy therefore uses verified claims plus current authoritative grants, not OAuth scope text or stale account metadata. Do not require a new custom audience claim when the native issuer uses its configured audience; validate the actual issuer/audience/resource binding. [Realtime authorization](https://supabase.com/docs/guides/realtime/authorization) documents cached channel policies, authorization refresh on new JWTs and disconnection on token expiry; the protected lease must be proven at that boundary rather than promise instantaneous revocation. The [July 14 Realtime schema change](https://supabase.com/changelog/realtime-schema-locked-down-against-modification) prohibits adding objects to the managed schema; use supported native RLS/notification mechanisms. No hosted access or project changes were performed. This is a compatibility review, not a native implementation or a claim of tested service enforcement.

Native MCP conformance requires a real OAuth flow against the intended resource and a separately admitted resource. Test that a token issued for another resource fails even with the same issuer, subject and OAuth client. A generic Auth audience or client identifier alone is insufficient evidence of resource binding.

The M6 recovery boundary comprises identity mapping and pseudonym secret, laws and registry snapshots, receipts and private evidence, current signing material and historical public keys, and DIPLOMACY packages. Verify a restore into a separate environment, including package bytes when the database backup excludes Storage objects. Revoke compromised issuance authority, establish a new trusted key, and retain historical verification keys and the applicable trust windows.

The single schema adds the proposed SubmitResult, PrivateEvidence, ReceiptNotice, Tuning, HistoryCursor/Request/Page, MachineDiscovery, BoundaryFailure, SkillName, DiplomacyPath/Manifest and VerificationVerdict shapes, and a ReferenceLimitsV2 definition for the draft reference profile. Existing definitions are unchanged. vectors/boundary-review.json supplies independent package identities for the reference ZIP tests and separate scenarios for native acceptance. Native authorization, end-to-end recoverable history and interoperability with agents still require tests. Approval of this proposal is required before marking §15.6 resolved or declaring PR-09A complete. The founding DIPLOMACY article is preserved verbatim.
