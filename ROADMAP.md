# RADIO — Kernel delivery roadmap

Delivery status as of 2026-11-26, reconciled with `main` at `6187545`. SPEC §15 defines the protocol. This roadmap tracks implementation, dependencies and acceptance. PR-xx identifies roadmap work. GitHub #xx identifies an actual pull request. [Vision](VISION.md) · [Specification](SPEC.md)

## Current checkpoint

| Milestone | Verified progress | Open gate |
|---|---|---|
| M0–M2 · Rigid core | RADIO Protocol 1.0 approved. The conformance corpus, executable reference and release review are in Git. The cookbook is generated from the protocol capability catalog. | Publish the release ref for the exact approved tree. |
| M3 · Substrate | PostgreSQL v2 transactions, CAS, Registry snapshots and ephemeral Edge Publish/Submit merged. Local native integration used PostgreSQL, PostgREST and Supabase Edge Runtime. | Qualify project configuration, native OAuth consent, resource binding and current authority. |
| M4 · Radio | Committed receipt IDs flow through private Broadcast. Two independent listeners verified lookup, rollback, unauthorized access and lease expiry on a local native Realtime instance. | Qualify the protected channel on the project, implement durable history and finish the direct participant client. |
| M5 · Interface | Stateless MCP discovery, submission and evidence merged. Local official-SDK tests verified the same RUN path and adopted DIPLOMACY guidance. | Exercise native OAuth through ChatGPT or Claude and qualify archive distribution. |
| M6 · Community | Local reference continuity, portable replay and worker replacement exercised. | Run the hosted golden path, measure capacity and restore the whole Institution. |

[GitHub #17](https://github.com/dan-powerhouse/Radio/pull/17) includes PR-10 and PR-11. [GitHub #18](https://github.com/dan-powerhouse/Radio/pull/18) includes the MCP implementation and DIPLOMACY catalog integration. [GitHub #19](https://github.com/dan-powerhouse/Radio/pull/19) includes committed Radio signals, executor equivalence and the generated cookbook.

Both main CI jobs passed at this checkpoint. The active main ruleset requires pull requests and blocks deletion and force pushes. Its required-check list is empty. The two checks to require are **Kernel and vectors** and **PostgreSQL migrations and transactions**. The approved 1.0 release ref also remains unpublished. The staging workflow has no recorded runs. [Main CI run](https://github.com/dan-powerhouse/Radio/actions/runs/45822718547) · [Active main rules](https://github.com/dan-powerhouse/Radio/rules) · [Staging workflow](https://github.com/dan-powerhouse/Radio/actions/workflows/staging.yml)

## Delivery boundary

Build the smallest common kernel for forming verifiable trajectories: free JSON -> deterministic recognition -> RUN -> signed object -> durable trajectory -> independent listener -> next JSON. Use one runtime-neutral TypeScript evaluator, one receipt family with explicit versions, and one logical machine per community. Supabase Auth is the native OAuth authority. PostgreSQL, Realtime and Edge Functions supply managed persistence, broadcast and initial request-scoped computation. Participants own their orchestration. The v1 local HTTP/SSE reference remains executable. No PATT implementation, financial product, general workflow manager, custom identity provider, arbitrary Skill-script execution, blockchain, microservice fleet or multi-region deployment is required.

Scale belongs to the elastic substrate; protocol identity belongs to the rigid core (contracts, specified mechanisms, vectors, conformance and CI gates). Supabase is the chosen native materialization at the intended scale. Prefer its existing capabilities to custom infrastructure; do not build alternative providers or a portability framework. Avoid global serialization where correctness does not require it; enforce shared uniqueness atomically. Independent communities remain possible; global multi-tenant operation is not claimed by the single-community release.

### Two delivery cycles

**Cycle I — Rigid core (M0–M2).** Complete the provider-independent semantic contract, executable reference, portable vectors, mechanism contracts and conformance gates. Freeze the first RADIO protocol release, 1.0, at the end of M2 after explicit review. This is a protocol release, not a hosted service release; it does not rename the existing versioned objects (process@1, process-type@1, receipt@1, receipt@2, etc.).

**Cycle II — Elastic substrate (M3–M6).** Materialize the frozen contract natively in Supabase, using the existing research matrix as an implementation aid, not normative law. No new hosted implementation or provider-specific optimization before the freeze. Preserve the working hosted preview, CI/CD configuration and existing PostgreSQL regression tests. Read-only research can inform contract decisions, but not silently define their meaning. Supabase-specific integration gates become mandatory in this cycle.

If materialization exposes an actual deficiency in the frozen contract, record it, review the correction, and version incompatible behavior with new vectors; never weaken an invariant or rewrite frozen expected results to accommodate infrastructure. The location of enforcement can change without changing the semantics.

## Working agreement

- Checked boxes record the stated deliverable and evidence. Open boxes record remaining acceptance work. In Cycle II, keep local native integration and acceptance on an approved hosted project explicit.
- Use one branch per PR, one reviewable purpose, tests alongside implementation, and a short PR description: intent, invariant, changed files, tests/results, compatibility, unresolved issues. Prefer subtracting code. No speculative framework or mandatory new dependency.
- For semantic changes, update the relevant part of SPEC in the same PR before implementation. Resolve explicit decisions with the architect first. Version incompatibilities and retain historical vectors; do not change tests just to pass. A failing baseline is investigated, not silently waived.
- Every code PR runs build and `npm test`; if a stage is blocked, run the remaining stages independently and report exact results. Add a targeted regression or conformance test for each new invariant. Infrastructure PRs require actual service tests, not only doubles. Never substitute a mock for an acceptance gate.
- No publish, merge, remote configuration or deployment without explicit approval. Disposable project selection is a decision, not implicit permission. No production credentials in fixtures, archives or logs.
- Work in order of dependencies. Complete Cycle I and obtain freeze approval before Cycle II implementation. For each rigid-core PR identify the invariant, mechanism contract, portable evidence and trust boundary; for each substrate PR map that invariant to the smallest actual native enforcement mechanism and test it at its real boundary. Keep the reference sufficient for conformance, not a second production backend. No separate document per PR.

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
- Staging uses an explicit main revision and the artifact produced by the same CI run. Plan mode previews migrations; apply requires approval of the staging project and hosted API (M3), scoped credentials and environment protection. M3/M4/M5 add actual Edge/PostgREST/Auth/Realtime/MCP integration checks after the 1.0 freeze; M6 adds the production promotion gate. A green reference CI is not authorization to deploy the v1 preview.
- No project creation, automatic production deployment, persistent self-hosted runner or additional application server. Release provenance is commit + package hashes within the trusted GitHub artifact channel, not an independent signature.

## M1 — The Machine

Exit: the rigid core has a pure executable reference and portable conformance evidence for recognition and RUN decisions, including registration without activation. It does not need a database, LLM or network. Define the evidence and execution boundaries required by native materialization, without building a second production backend.

### PR-03 — Process Type validation and immutable publication
- [x] Merged as GitHub #5; both GitHub CI jobs passed. Implemented: strict Process Type parser, static expression validation, local immutable publication and registry snapshots (SPEC §15.10). Runtime scanner and RUN evaluation are not included. Added independent portable vectors, historical pin/crypto audit, cross-runtime adversarial evidence checks and targeted mutations. Existing PostgreSQL v1 preview now has actual forced-race and rollback tests; hosted gates remain pending.
- Acceptance: valid single/multiple RUN definitions, rejected unknown or malformed fields, stable hash under key reordering, immutable publication and amendment, no execution of arbitrary code.

### PR-04 — Deterministic scanner
- [x] Merged as GitHub #6 after PR-03; both GitHub CI jobs passed. Implemented: pure recognition over the specified registry snapshot using the same expression machinery; no NLP, SQL rule engine or agent decision. 51 portable vectors, 6 additional reference tests and 10 targeted scanner mutations. DIPLOMACY and the glossary were included without changing the law.
- Acceptance: zero/one/multiple matches per approved contract; snapshot/version changes; deterministic ordering and bounded work; valid scalars/arrays/objects and adversarial keys. No hidden preference based on arrival order.

### PR-05 — RUN evaluator and signed result
- [x] Merged as GitHub #9. Coordinated machine-readable structural contract and decision boundary approved (2026-11-26), across PR-05–08, using the schema projection and independent evidence described in SPEC §15.12. Reference RUN evaluation and tentative v2 signing implemented (SPEC §15.13), including approved diagnostic priority, authorized evidence/claim observations and independent portable signed vectors. Remote CI passed on GitHub #9. PR-06 continued with ledger integration, PR-08 with portable replay and PR-11 with the hosted adapter.
- Acceptance: positive, negative, doubt and registered outcomes, no effects for unmet activation; machine-attested identity, immutable law, independent replay with exact evidence. Versioned vectors; retain v1 tests and vectors.

## M2 — The Trajectory

Exit: multiple process instances progress independently, with receipts as the objects, portable evidence of causal history and uniqueness after restart. Provider-independent boundary contracts are complete for the declared 1.0 scope. The rigid-core release has passed all required reference and CI gates and is explicitly approved for freeze. Native PostgreSQL/Edge materialization begins in M3, not as an M2 exit requirement.

### PR-06 — Instance formation and continuation
- [x] Merged as GitHub #10 and passed remote CI. Implemented the reference ProcessLedger and file-backed openProcessMachine, receipt-derived instances, explicit ancestry and nonlinear joins, immutable publication/retirement, recorded observation replay and local single-writer recovery (SPEC §15.14). PR-07 covered the concurrency and failure boundary.
- Acceptance: two instances of one law; cannot substitute one instance's receipts for another; retry and invalid successor cases. Nonlinear trajectories permitted only as specified.

### PR-07 — Atomic uniqueness and retry semantics
- [x] Merged as GitHub #11; remote CI passed. Reference acceptance implemented (SPEC §15.15): forced concurrent retries, success/once conflicts, blocked commit visibility, publication ordering, ambiguous acknowledgement and process replacement; guarded recovery visibility. Reference single-writer commit and independent conflict re-evaluation scenarios, no automatic reactions. PR-10/11 must reproduce the frozen outcomes with native PostgreSQL transactions and ephemeral Edge invocations after freeze.
- Acceptance: competing claims produce only permitted effects; failed activation consumes nothing; replay returns the same result; failed persistence emits nothing and creates no phantom claim.

### PR-08 — Portable trajectory and independent verification
- [x] Merged as GitHub #12; remote CI passed. Implemented (SPEC §15.16): bundle@2 export, strict portable verification with independent key trust, explicit authenticity/replay/closure verdicts, original registry and observed evidence, historical v1 citation verification, closure conflict detection, and a small course projection example. Preserve the private evidence boundary; no generic analytics or hosted route.
- Acceptance: offline reproduction, tampered/missing evidence refusal, swapped law/RUN/instance failure, equal projection with distinct histories, explicit limits of individual verification versus ledger completeness.

### PR-09 — Local continuity demonstration
- [x] Merged as GitHub #13; remote CI passed. Implemented (SPEC §15.17): explicit target mode on existing HTTP/SSE and CLI reference, committed history/catch-up, separately authenticated participants and privileged local reviewer, process and listener replacement, continued instance and offline CLI verification. Local transport and owner/admin policy are demonstration profiles, not the final native boundary contract; no alternate hosted backend or reaction worker.
- Acceptance: separate participants with different identities receive same signed header; independent next submission; restart machine and replace listener, recover history, continue same instance and verify offline. No reaction worker in the target path.

### PR-09A — Rigid boundary contracts and conformance

**Approved checkpoint:** GitHub #15 includes #14 and passed both remote CI jobs. SPEC §15.18 and the schema define the approved boundary contracts. The reference includes bounded evaluation and publication, signed-receipt size checks, and a DIPLOMACY ZIP validator. Native authorization, end-to-end closed-window history, and agent interoperability remain acceptance gates.

- [x] Merged and architect-approved 2026-11-26. Review the unresolved items in SPEC §15.6 and the interface-facing acceptance requirements of PR-13–19. Close the provider-independent semantics in the existing SPEC, not a new specification. Make explicit: admitted identity and delegation versus claimed input; publication and read authority; trust/key boundaries and privacy; authoritative commit and retry observations; committed-only notification, tuning, history completeness scope, reconnect and deduplication; stateless discovery/submission/evidence behavior. Define the guarantees and failure modes, not a particular SQL schema, OAuth product, WebSocket or MCP SDK implementation.
- Acceptance: normative behavior and portable contract scenarios for allowed/denied operations, revocation/freshness bounds within declared scope, spoofed identity, private evidence, failed commits, late arrivals and observer replacement, duplicate events and stateless retries. Exercise those mechanisms in the reference where applicable; distinguish simulated observations from real hosted evidence. Resolve or explicitly exclude every open semantic decision relevant to 1.0 (including cross-community, key rotation/erasure, external effects, the DIPLOMACY package contract and optional MAP contract). Review all machine-readable contracts together before freeze; keep implementation PR boundaries and shared definitions. No invented provider or UI.

### PR-09B — RADIO Protocol 1.0 freeze

- [x] GitHub #16 merged and architect-approved 2026-11-26 (SPEC §15.19). Review the complete SPEC for consistent normative terminology, version dispatch, bounded behavior, reason codes, evidence and explicit trust assumptions. Preserve the historical versions; the protocol release number is separate from object format versions. Curate a versioned conformance corpus with independently specified expectations, cryptographic/encoding fixtures, negative/adversarial cases, targeted mutations and complete trajectories. Retain historical vectors without modification.
- [x] Reproducible clean build, Node, Bun, Chromium and mutation checks, portable replay, reference concurrency/recovery and PostgreSQL regressions passed. The review head, CI, vector hashes and lockfile are recorded in SPEC §15.19.
- [ ] Publish the protocol release tag for the exact approved tree and verify required-check enforcement. The approved protocol and the hosted release have separate acceptance gates.

## M3 — The Substrate

Exit: the approved isolated Supabase materialization implements the frozen 1.0 contract with real transactional persistence, ephemeral execution, native identity, delegated authorization and privacy tests. Hosted staging writes remain gated until explicit project and hosted-contract approval; production remains separate. No native service is replaced by a custom equivalent.

### PR-10 — Hosted transaction schema and CAS
- [x] Merged in GitHub #17. Additive `radio_v2` migrations implement immutable CAS, bounded Registry snapshots and authoritative transactional admission/commit RPCs. Real PostgreSQL tests exercise concurrent submission, RUN and once claims, rollback, publication snapshots, direct SQL access and private evidence with test identities.
- [ ] Apply the migrations and verify the actual Data API grants and private evidence access on the approved project. The v1 outbox remains in the compatibility schema. Any cleanup takes a reviewed migration. [Transaction checkpoint](supabase/README.md#pr-10-transaction-checkpoint)

### PR-11 — Ephemeral publish and submit
- [x] Merged in GitHub #17. Versioned Publish/Submit reuse the staged TypeScript evaluator. Local native Edge, PostgREST and PostgreSQL tests verify reference parity, conflict re-evaluation, server-resolved citations, lost acknowledgement and cold worker replacement. The admitted time and Registry stay fixed across retries.
- [ ] Verify version dispatch, authenticated writes and receipt visibility through the project gateway. [Ephemeral Publish and Submit](supabase/README.md#pr-11-ephemeral-publish-and-submit)

### PR-12 — Native OAuth flow and consent
- [x] The MCP adapter includes protected-resource metadata, JWKS validation and a configurable native access-token hook for the signed audience. Local tests use a signed issuer fixture.
- [ ] Configure native Auth and the static login/consent surface on an approved project. Exercise consent and denial, authorization code + PKCE, callback binding, token expiry and refresh with a real client. Demonstrate that a grant for another resource cannot obtain a usable RADIO credential. Keep issuer and machine signing keys distinct.

### PR-13 — Delegation and access boundary
- [x] PostgreSQL enforces principal authority, direct or OAuth client mandates and resource permissions, with a private decision audit and authority revalidation at commit. The local adapter tests use verified fixture claims and include wrong resource, revoked authority and denied evidence.
- [ ] Test different native OAuth clients for the same principal, wrong issuer/audience, scope and revocation freshness, spoofed `who` and private evidence denial through the actual project. Declare the single-Institution visibility policy and operator trust before exposure.

## M4 — The Radio

Exit: a native Realtime WebSocket listener receives committed receipt IDs, verifies the resolved receipts and can recover after a disconnect without losing authorized history.

### PR-14 — Committed broadcast and tuning
- [x] Merged in GitHub #19. Database-originated private Broadcast carries only the committed receipt ID. Clients fetch it under current authority, verify the signature and tune the signed header locally. Local native Realtime tests covered two independent listeners, rollback, denied send/join, credential renewal and expiry on an uncooperative socket.
- [ ] Verify native direct-session leases, deployed receipt lookup and private channel policy on the approved project before activation. [Committed radio signals](supabase/README.md#committed-radio-signals)

### PR-15 — Durable history and reconnect contract
- [x] The local HTTP/SSE reference demonstrates catch-up and listener replacement. The PostgreSQL late-commit probe demonstrates the sequence allocation hazard.
- [ ] Choose an approved physical cursor and implement authorized closed windows, stable pagination and overlap with live signals. Sequence allocation alone is insufficient to close a window.
- Acceptance: forced out-of-order transaction commits, pagination with concurrent writes, disconnect/reconnect, duplicate delivery and listener replacement. Every accessible committed receipt recoverable under declared cursor contract; dedupe by receipt ID. No listener registry or per-agent workflow in machine.

### PR-16 — Direct participant client
- [x] The v2 receipt lookup and reference listener example resolve, verify and tune the committed ID independently of a local server.
- [ ] Deliver the maintained v2 participant client or thin adapter with PR-15 catch-up. Keep token ownership and listener checkpoints with the participant.
- Acceptance: independent clients with different local state can recover and submit via ordinary API; token refresh/reconnect tested; no hidden session; verify that API and machine share the same RUN boundary.

## M5 — The Interface

Exit: a real OAuth-authorized MCP client discovers types and submits free JSON to the same hosted RUN boundary. Each request remains independent across executor replacements.

### PR-17 — Stateless MCP profile and discovery
- [x] Merged in GitHub #18. The pinned SDK serves MCP 2026-07-28 and stateless 2025 compatibility, with cacheable fixed metadata, protected-resource metadata and authorized law discovery. The official SDK client exercised discovery and replay after local worker replacement.
- [ ] Prove the connector can discover and authorize the project resource through native OAuth. Check version handling, cache headers and rejected credentials in the deployed transport. [Stateless MCP](supabase/README.md#stateless-mcp)

### PR-18 — MCP submission and evidence
- [x] Merged in GitHub #18. MCP uses the shared v2 submission adapter for free I-JSON, with explicit continuation, authorized receipt/evidence reads and stable outcome diagnostics. Local tests exercise a signed RUN, replay and revocation.
- [ ] Verify the complete connector submission and continuation path, including citations, denial and independent receipt verification with native OAuth credentials. Hosted bundle export remains to be demonstrated with complete private evidence authorization.

### PR-19 — DIPLOMACY distribution / Agent Skills interoperability
- [x] The frozen archive format has a real ZIP validator. The CLI emits operator adoption SQL, and MCP serves the adopted manifest and verifies the Skill text against it. The evaluator uses the law JSON alone.
- [ ] Qualify archive distribution, protected access lifetime and recoverability. Demonstrate a hosted agent finding the exact law and using its Skill to draft a Contract with a human. Storage is a candidate for distribution. MAP integration requires a supplied contract.

## M6 — The Community

Exit: reproducible, tested single-community release candidate with real hosted path, independent clients and independently verified trajectory. No promise of global throughput or external effect security.

### PR-20 — Vertical golden path
- [ ] Depends on PR-09/13/16/18; PR-19 if adopted for the example. Use a small course/commitment example, one real LLM translation, real native OAuth, MCP, scanner, multiple RUNs, signed receipts, native WebSocket, independent listener submission and offline verification. Do not use manual JSON as evidence of the actual LLM path; deterministic fixtures remain appropriate for CI.
- Acceptance: unrecognized valid expression registered, instance created, distinct participant continuation, failed attempt explained, authorized retry, final object, independent verification, listener replacement. No hosted `server/` dependency and no automatic workflow worker.

### PR-21 — Kernel limits and contention
- [ ] Depends on PR-20. Consolidate incremental measurements from the native PRs: recognition cost versus published types, evaluation bounds, payload size, concurrent unrelated/conflicting commits, reconnect and fan-out. Record environment, workloads and observed latency/throughput/cost; agree resource limits based on measurements, not speculative target numbers. Treat these as substrate capacity profiles, not changes to protocol identity; rerun rigid-core conformance against any optimization.
- Acceptance: bounded scanner/RUN work, no correctness dependence on global application mutex or warm instance; report contention and bottlenecks. Test community isolation if multiple communities are enabled; otherwise explicitly limit release to one community. Optimize only measured bottlenecks.
- If measurements justify a dedicated execution profile, use the [worker qualification plan](supabase/README.md#execution-and-scaling) and [RUN replacement contract](SPEC.md#run-execution-and-replacement) before routing traffic to it.

### PR-22 — Conformance and release candidate
- [ ] Depends on PR-21. Run full Node/Bun/browser conformance plus real Postgres/RLS/Deno/OAuth/MCP/WebSocket integration and golden path. Document minimal provisioning, key trust and known limits. Restore a complete Institution in an isolated environment, including identity mappings, pseudonym continuity, historical laws and snapshots, receipts and private evidence, signing and verification material, and DIPLOMACY objects held outside the database. Review open SPEC decisions and either resolve or explicitly exclude them from supported scope.
- Acceptance: all required checks actually pass in the declared supported environments; no skipped mandatory integration gate; archived versioned vectors and reproducible clean setup. No production deploy or merge without approval. Do not label preview production until gates and release approval are satisfied.

## Deliberately deferred

- Global SaaS tenant routing, cross-community federation, multi-region and external anchoring (including Merkle), pending actual need and explicit design. Do not infer that independent projects share uniqueness or keys.
- Key rotation receipt format and private erasure design remain SPEC open items. Before any production release, explicitly resolve minimum operational key/revocation/recovery and privacy requirements or narrow the supported deployment; do not claim automatic rotation/erasure exists.
- Protected external executors, financial compliance, metered PATT computation, neural architectural research, universal object domain schemas and arbitrary participant workflows are separate work. A RADIO receipt alone does not establish external execution or truth.

## Remaining acceptance dependencies

1. Use an approved disposable Supabase project to qualify M3, starting with native OAuth and authority (PR-12/13). Use that boundary to verify stateless MCP through a real connector and qualify protected Broadcast before activation.
2. Evaluate the history cursor under concurrency in parallel with project setup (PR-15). Then finish the direct participant client and prove catch-up across disconnects and listener replacement (PR-16).
3. Complete package distribution and connector verification (PR-17–19). Carry the resulting evidence into the hosted golden path, capacity measurements and institutional restore (PR-20–22).
