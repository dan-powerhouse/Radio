# RADIO — Kernel delivery roadmap

Status: proposed engineering sequence, not a protocol specification or approved release. Baseline: `radio-organized.zip`, 2026-11-25. Read [VISION.md](VISION.md) and [SPEC.md](SPEC.md) first. SPEC §15 is the source of target requirements; this file owns only work order, dependencies and acceptance. Decisions below are gates, not decisions already taken. PR identifiers are roadmap identifiers, not GitHub PR numbers.

## Delivery boundary

Build the smallest common kernel for forming verifiable trajectories: free JSON -> deterministic recognition -> RUN -> signed object -> durable trajectory -> independent listener -> next JSON. One runtime-neutral TypeScript evaluator, one receipt family with explicit versions, one logical machine per community, no application daemon in the hosted path. Supabase Auth is the native OAuth authority; Postgres, Realtime and ephemeral Edge Functions supply managed persistence, broadcast and computation. Participants own their orchestration. The v1 local HTTP/SSE reference remains executable. No PATT implementation, financial product, general workflow manager, custom identity provider, arbitrary Skill-script execution, blockchain, microservice fleet or multi-region deployment is required.

Scale belongs to the elastic substrate; protocol identity belongs to the rigid core (contracts, specified mechanisms, vectors, conformance and CI gates). Supabase is the chosen native materialization at the intended scale. Prefer its existing capabilities to custom infrastructure; do not build alternative providers or a portability framework. Avoid global serialization where correctness does not require it; enforce shared uniqueness atomically. Independent communities remain possible; global multi-tenant operation is not claimed by the single-community release.

## Working agreement

- PRs below are proposed; existing code is a baseline, not evidence that any new PR is merged. PR-00 synchronized the already tested checkpoint and roadmap ([GitHub #2](https://github.com/dan-powerhouse/Radio/pull/2), merged). PR-01 is architect-approved in SPEC §15.8 ([GitHub #3](https://github.com/dan-powerhouse/Radio/pull/3), merged); PR-02 is merged as [GitHub #4](https://github.com/dan-powerhouse/Radio/pull/4); M0 is complete. Target runtime is being implemented in M1.
- Use one branch per PR, one reviewable purpose, tests alongside implementation, and a short PR description: intent, invariant, changed files, tests/results, compatibility, unresolved issues. Prefer subtracting code. No speculative framework or mandatory new dependency.
- For semantic changes, update the relevant part of SPEC in the same PR before implementation. Resolve explicit decisions with the architect first. Version incompatibilities and retain historical vectors; do not change tests just to pass. A failing baseline is investigated, not silently waived.
- Every code PR runs build and `npm test`; if a stage is blocked, run the remaining stages independently and report exact results. Add a targeted regression or conformance test for each new invariant. Infrastructure PRs require actual service tests, not only doubles. Never substitute a mock for an acceptance gate.
- No publish, merge, remote configuration or deployment without explicit approval. Disposable project selection is a decision, not implicit permission. No production credentials in fixtures, archives or logs.
- Work in order of dependencies, with two complementary kinds of work: rigid-core proof and native materialization. For every PR identify the invariant, its portable evidence, and, where applicable, the actual native enforcement boundary. Prepare native mappings as soon as their contracts are stable; merge only in dependency order and stop at failed gates. Keep the local reference sufficient for conformance, not a second production backend. No separate document per PR.

## Baseline inventory

| Area | Existing baseline | Gap |
|---|---|---|
| Encoding/crypto | `src/jcs.ts`, `strict.ts`, `hash.ts`, `keys.ts`, `authentic.ts` | Explicit compatibility with new envelope; known pre-checkpoint v1 ordering defect (SPEC §15.5) |
| Evaluation | `src/process.ts`, `expr.ts`, `receipt.ts`, `verify.ts` | v1 explicitly addressed single law; no target scanner/multi-RUN |
| Local reference | `src/ledger.ts`, `server/`, CLI | v1 synchronous `on`; target externally initiated continuation |
| Hosted preview | migration, `submit`, `publish`, shared ledger/PostgREST adapter; real disposable PostgreSQL 16/17 transaction and RLS tests | v1 only; target schema and real Supabase Auth/Edge/PostgREST/Realtime integration pending |
| Identity/client | `src/hosted.ts`, native OAuth discovery | real OAuth consent, scoped delegation and revocation |
| Radio | local SSE, hosted receipt publication configuration | actual WebSocket and gap-free catch-up |
| Examples/tests | course, external alumni fixture, frozen v1 vectors, portable Process Type/registry/expression/JSON vectors, cross-runtime tests and targeted mutations; CI/CD workflows prepared | scanner/RUN/trajectory vectors, first verified GitHub Actions run and hosted full path |

## M0 — The Contract

Exit: reviewed target semantic contract in the single SPEC; existing v1 behavior and compatibility boundary are explicit. No new runtime code in this milestone.

### PR-00 — Roadmap and baseline
- [x] Merged as GitHub #2: synchronized the previously developed baseline (including hosted preview and external-listener regression tests) and this roadmap. No new scanner/RUN semantics in this import.
- Acceptance: all existing source, tests and vectors unchanged; verify archive and baseline build/test results.

### PR-01 — Process Type and recognition contract
- [x] Architect-approved (2026-11-25) and merged as GitHub #3: canonical JSON law version, registry identity/publication/amendment, scanner input and deterministic bounded match contract in SPEC §15.8.
- Decision gate: overlapping matches (no implicit winner), no-match receipt cardinality/frequency, recognition versus activation, errors and total scanner budget, immutable registry snapshot used for replay, version separation from `process@1`.
- Acceptance: agreed examples for zero/one/multiple matches, malformed versus valid unmatched input, reordered JSON, publication changes and overlapping types. Expected outcomes specified before code.

### PR-02 — RUN, instance and receipt contract
- [x] Merged as GitHub #4 (approved to proceed), SPEC §15.9: one-or-more RUNs, first RUN constituting an instance, later RUN eligibility, causal references, object/result binding, versioned receipt and bundle.
- Decision gate: instance identity, successor selection and dependencies (not necessarily linear), retry semantics, scope of `once` and idempotency, response cardinality, signed context and proof of registry/spent claims; which status constitutes an instance or effect. No shadow authoritative state.
- Acceptance: agreed worked example from first input to at least two distinct instances, continuation, refusal, retry and replay. Historical v1 receipt interpretation preserved.

### Cross-cutting delivery gate (before PR-04)
- CI/CD is part of the existing PR-03 verification checkpoint, not a new kernel milestone. GitHub-hosted CI runs all current executable tests, verifies package identity and exercises the real PostgreSQL migration path on every PR and main push; required status checks must be enabled in repository settings before relying on enforcement.
- Staging uses an explicit main revision and the artifact produced by the same CI run. Plan mode previews migrations; apply requires approval of the staging project and hosted API (M3), scoped credentials and environment protection. M2/M3/M4/M5 add actual Edge/PostgREST/Auth/Realtime/MCP integration checks; M6 adds the production promotion gate. A green reference CI is not authorization to deploy the v1 preview.
- No project creation, automatic production deployment, persistent self-hosted runner or additional application server. Release provenance is commit + package hashes within the trusted GitHub artifact channel, not an independent signature.

## M1 — The Machine

Exit: the rigid core has a pure executable reference and portable conformance evidence for recognition and RUN decisions, including registration without activation. It does not need a database, LLM or network. Define the evidence and execution boundaries required by native materialization, without building a second production backend.

### PR-03 — Process Type validation and immutable publication
- [ ] Implemented on the PR-03 review branch: strict Process Type parser, static expression validation, local immutable publication and registry snapshots (SPEC §15.10). Review/merge pending. Runtime scanner and RUN evaluation are not included. Added independent portable vectors, historical pin/crypto audit, cross-runtime adversarial evidence checks and targeted mutations. Existing PostgreSQL v1 preview now has actual forced-race and rollback tests; hosted gates remain pending.
- Acceptance: valid single/multiple RUN definitions, rejected unknown or malformed fields, stable hash under key reordering, immutable publication and amendment, no execution of arbitrary code.

### PR-04 — Deterministic scanner
- [ ] Depends on PR-03. Pure recognition over the specified registry snapshot using the same expression machinery; no NLP, SQL rule engine or agent decision.
- Acceptance: zero/one/multiple matches per approved contract; snapshot/version changes; deterministic ordering and bounded work; valid scalars/arrays/objects and adversarial keys. No hidden preference based on arrival order.

### PR-05 — RUN evaluator and signed result
- [ ] Depends on PR-04. Reuse existing expression, citation, status, signing and verification primitives. Bind law, RUN, context and output according to SPEC, including registration without activation.
- Acceptance: positive, negative, doubt and registered outcomes, no effects for unmet activation; machine-attested identity, immutable law, independent replay with exact evidence. Versioned vectors; retain v1 tests and vectors.

## M2 — The Trajectory

Exit: multiple process instances progress independently, with receipts as the objects, portable evidence of causal history and uniqueness after restart. The same guarantees are materialized in native PostgreSQL transactions and ephemeral execution (PR-10/11). Real Edge/Postgres acceptance is required; use an explicitly approved isolated environment, not a production deployment. The local demonstration is evidence, not a second product.

### PR-06 — Instance formation and continuation
- [ ] Depends on PR-05. Connect first and successor RUNs to instance identity and eligibility in the reference ledger. Use explicit ancestry, not in-memory conversational state.
- Acceptance: two instances of one law; cannot substitute one instance's receipts for another; retry and invalid successor cases. Nonlinear trajectories permitted only as specified.

### PR-07 — Atomic uniqueness and retry semantics
- [ ] Depends on PR-06. Implement contract-scoped idempotency and once claims in the reference commit boundary; no automatic external reactions for target laws. Specify the native PostgreSQL uniqueness and transaction mapping alongside these invariants so PR-10 can be prepared immediately, without inventing a second authoritative state.
- Acceptance: competing claims produce only permitted effects; failed activation consumes nothing; replay returns the same result; failed persistence emits nothing and creates no phantom claim.

### PR-08 — Portable trajectory and independent verification
- [ ] Depends on PR-07. Extend bundles and verification for new versions, ancestry, registry context and objects using existing CAS. Keep public header/private evidence split. Support a small example projection (e.g. course completion), not a generic analytics subsystem.
- Acceptance: offline reproduction, tampered/missing evidence refusal, swapped law/RUN/instance failure, equal projection with distinct histories, explicit limits of individual verification versus ledger completeness.

### PR-09 — Local continuity demonstration
- [ ] Depends on PR-08. Minimally extend the existing external-listener demonstration and local HTTP/SSE reference to prove target continuity without removing legacy v1 behavior. Do not extend the reference into a separate hosted backend, or delay native schema/Edge preparation for local-only polish.
- Acceptance: separate participants with different identities receive same signed header; independent next submission; restart machine and replace listener, recover history, continue same instance and verify offline. No reaction worker in the target path.

### PR-10 — Hosted transaction schema and CAS
- [ ] Depends on PR-07/08; preparation starts once PR-07's transaction invariants are stable, merge after PR-09 proves reference continuity. Adapt existing migration/RPCs to the approved new semantic contract; verify migration history before editing or adding a migration. Make native constraints, transactions, CAS and RLS the enforcement boundary; retain only needed indexes. Decide and remove or retain reserved outbox/reaction_jobs with architect approval, no community reaction worker.
- Acceptance: real PostgreSQL concurrent idempotency/once/instance tests; rollback on conflict; immutable CAS; publication snapshot races; real RLS tests for direct access and private evidence; no UUID in broadcast rows. No evaluator in SQL.

### PR-11 — Ephemeral publish and submit
- [ ] Depends on PR-10. Reuse staged TypeScript evaluator in existing Edge Functions and commit adapter. Define root response and version compatibility. Re-evaluate on transactional conflict; bound retries. Decide citation bundle transport: retain server-resolved citations for initial path unless approved otherwise.
- Acceptance: actual Deno/Edge runtime against disposable Postgres; identical local/hosted results for fixed inputs/context; no warm-worker dependency; no duplicate effects across concurrent invocations; invalid/failed writes never broadcast.

## M3 — The Substrate

Exit: the approved disposable Supabase materialization has real native identity, delegated authorization and privacy tests on the transaction/execution foundation of M2. Hosted staging writes remain gated until explicit project and hosted-contract approval; production remains separate. No native service is replaced by a custom equivalent.

### PR-12 — Native OAuth flow and consent
- [ ] Depends on PR-00; prepare native configuration and OAuth interoperability in parallel with M1/M2, without remote changes until project approval; merge after PR-11. Verify current Supabase docs/config; use native OAuth code + PKCE, metadata and token lifecycle; minimal static consent/login surface, no application backend or separate accounts system.
- Acceptance: real approved test OAuth client can sign in, consent/deny, obtain and refresh token; invalid/expired credentials refused; machine key distinct from issuer key. Test callback and consent binding. No production deployment.

### PR-13 — Delegation and access boundary
- [ ] Depends on PR-11/12. Specify and enforce caller/client authorization, admin publication, community/authority scope, revocation and RLS, using verified identity not tuple claims. Keep initial deployment single-community unless architect approves otherwise.
- Acceptance: real client-specific positive/negative tests, wrong issuer/audience and unauthorized client, revoked access under declared freshness bound, spoofed `who`, private evidence denied to others, anonymous/public policy per SPEC. Document key provisioning and operator trust; do not invent a rotation protocol.

## M4 — The Radio

Exit: a real native Realtime WebSocket listener receives committed receipts, can disconnect, recover and continue without losing authorized history.

### PR-14 — Committed broadcast and tuning
- [ ] Depends on PR-11/13. Use native Supabase Realtime with existing frequency/status/identity filters as specified. Verify signature before acting; keep private details outside public payload.
- Acceptance: two independent authenticated/authorized listeners see the same committed object; no event for rolled-back commit; unauthorized subscription and private data leak tests; no bespoke WebSocket server.

### PR-15 — Durable history and reconnect contract
- [ ] Depends on PR-10/14. Resolve late commits, cursor semantics and live/catch-up overlap before implementing. Sequence allocation is not commit order; do not promise `seq > cursor` alone. Pick minimal correctness-preserving mechanism with architect approval.
- Acceptance: forced out-of-order transaction commits, pagination with concurrent writes, disconnect/reconnect, duplicate delivery and listener replacement. Every accessible committed receipt recoverable under declared cursor contract; dedupe by receipt ID. No listener registry or per-agent workflow in machine.

### PR-16 — Direct participant client
- [ ] Depends on PR-14/15. Extend existing `src/hosted.ts` (or a thin transport adapter where appropriate) for tuning, verified receipt reads and catch-up. Keep token ownership and local listener state with participant.
- Acceptance: independent clients with different local state can recover and submit via ordinary API; token refresh/reconnect tested; no hidden session; verify that API and machine share the same RUN boundary.

## M5 — The Interface

Exit: a real OAuth-authorized MCP client discovers types and submits free JSON to the same hosted RUN boundary, with independent requests. No resident application server.

### PR-17 — Stateless MCP profile and discovery
- [ ] Depends on PR-02/13. Verify published MCP revision (target inspiration 2026-07-28) and actual client interoperability before fixing the profile; specify metadata, discovery/cache, auth resource metadata, version errors, supported capabilities and explicit context. Discovery excludes mutable head. Implement minimal ephemeral MCP endpoint.
- Acceptance: protocol fixtures plus real compatible client discovery; repeat against fresh workers; stable ordering/cache keys; malformed/unsupported messages and credentials rejected. No invented MAP wire contract or required session state.

### PR-18 — MCP submission and evidence
- [ ] Depends on PR-17/16. Expose only the necessary discovery/read/submit capabilities; same handler and evaluator as API. Provide registered outcomes and actionable unmet conditions, immutable references, receipt/evidence reads under policy. Preserve free I-JSON input (transport validation is distinct from activation).
- Acceptance: real authenticated MCP client obtains the same receipt semantics as API, retries safely, follows citations and verifies a returned object; stateless continuation and unauthorized actions tested. No automatic orchestration tools.

### PR-19 — Process Type distribution / Agent Skills interoperability
- [ ] Depends on PR-03/17. Decision gate: approve optional standard `SKILL.md` + canonical JSON law, or narrower distribution format. A Skill is instruction, not authority; no ZIP loader or scripts in evaluator. Add a minimal example and discovery linkage after approval. MAP integration only to supplied contract; otherwise demonstrate translation without claiming MAP compliance.
- Acceptance: agent can locate exact law and learn how to form input; package/instruction edits cannot change law identity or authorize actions; machine works with law JSON alone. Optional wrapper not needed for RUN correctness.

## M6 — The Community

Exit: reproducible, tested single-community release candidate with real hosted path, independent clients and independently verified trajectory. No promise of global throughput or external effect security.

### PR-20 — Vertical golden path
- [ ] Depends on PR-09/13/16/18; PR-19 if adopted for the example. Use a small course/commitment example, one real LLM translation, real native OAuth, MCP, scanner, multiple RUNs, signed receipts, native WebSocket, independent listener submission and offline verification. Do not use manual JSON as evidence of the actual LLM path; deterministic fixtures remain appropriate for CI.
- Acceptance: unrecognized valid expression registered, instance created, distinct participant continuation, failed attempt explained, authorized retry, final object, independent verification, listener replacement. No hosted `server/` dependency and no automatic workflow worker.

### PR-21 — Kernel limits and contention
- [ ] Depends on PR-20. Consolidate incremental measurements from the native PRs: recognition cost versus published types, evaluation bounds, payload size, concurrent unrelated/conflicting commits, reconnect and fan-out. Record environment, workloads and observed latency/throughput/cost; agree resource limits based on measurements, not speculative target numbers. Treat these as substrate capacity profiles, not changes to protocol identity; rerun rigid-core conformance against any optimization.
- Acceptance: bounded scanner/RUN work, no correctness dependence on global application mutex or warm instance; report contention and bottlenecks. Test community isolation if multiple communities are enabled; otherwise explicitly limit release to one community. Optimize only measured bottlenecks.

### PR-22 — Conformance and release candidate
- [ ] Depends on PR-21. Run full Node/Bun/browser conformance plus real Postgres/RLS/Deno/OAuth/MCP/WebSocket integration and golden path. Document minimal provisioning, key trust, recovery and known limits. Review open SPEC decisions and either resolve or explicitly exclude them from supported scope.
- Acceptance: all required checks actually pass in the declared supported environments; no skipped mandatory integration gate; archived versioned vectors and reproducible clean setup. No production deploy or merge without approval. Do not label preview production until gates and release approval are satisfied.

## Deliberately deferred

- Global SaaS tenant routing, cross-community federation, multi-region and external anchoring (including Merkle), pending actual need and explicit design. Do not infer that independent projects share uniqueness or keys.
- Key rotation receipt format and private erasure design remain SPEC open items. Before any production release, explicitly resolve minimum operational key/revocation/recovery and privacy requirements or narrow the supported deployment; do not claim automatic rotation/erasure exists.
- Protected external executors, financial compliance, metered PATT computation, neural architectural research, universal object domain schemas and arbitrary participant workflows are separate work. A RADIO receipt alone does not establish external execution or truth.

## Suggested merge order

`00 -> 01 -> 02 -> 03 -> 04 -> 05 -> 06 -> 07 -> 08 -> 09 -> 10 -> 11 -> 12 -> 13 -> 14 -> 15 -> 16 -> 17 -> 18 -> 19 -> 20 -> 21 -> 22`

Workstreams overlap without renumbering or changing semantic dependencies: PR-10 native schema preparation starts after PR-07 stabilizes, alongside PR-08/09; PR-11 preparation follows the stable transaction contract. PR-12 native OAuth preparation, PR-17 protocol research and PR-19 format comparison may overlap earlier work; their implementation/merge gates still apply. The existing CI/CD gate ties both kinds of work to the same conformance evidence. Measure native limits as components become testable, not only in PR-21. PR-19 may close as an explicit documented decision not to adopt a wrapper. No estimated delivery dates without measured work. Next: review and merge PR-03 (GitHub #5), then implement PR-04 under the existing recognition contract. M0 is complete.
