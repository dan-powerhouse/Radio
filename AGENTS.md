# Working on RADIO

RADIO is a Third Layer application: a universal protocol for the formation of verifiable trajectories. Read [VISION.md](VISION.md) and [SPEC.md](SPEC.md) in full before changing semantics. Read [README.md](README.md) for the executable baseline and [supabase/README.md](supabase/README.md) for hosted setup and limitations. Inspect the repository tree and relevant source/tests rather than assuming an earlier conversation or handoff is authoritative.

## Authority and continuity

- `VISION.md` explains why; `SPEC.md` is the only technical contract. Sections 1–14 preserve v1; §15 states target requirements and open decisions, not an implemented wire format. Source/tests describe what runs today. If they disagree, report the conflict; do not silently rewrite the contract.
- Continue from the current checkpoint. Preserve working code, fixtures and tests; do not restart or broaden the scope without direction. Work in substantial verified increments toward §15.7; use [ROADMAP.md](ROADMAP.md) for the proposed granular PR sequence and acceptance gates. The roadmap is not a second spec.
- The architect owns semantic decisions and approval of publication, merge, remote changes and deployment. No remote write without explicit approval. Do not choose a Supabase project or use production credentials implicitly.
- Discuss in Portuguese when the user does; code, specs and repo documentation are in English. Be precise about what was read, changed, tested and not tested. A blocked runtime or a missing credential is not a successful test. Preserve commitments and leave an executable checkpoint.

## Engineering invariants

- One runtime-neutral TypeScript evaluator, no duplicate rule engine in SQL, no unnecessary dependencies. Use WebCrypto and strict I-JSON/JCS. Keep laws content-addressed and immutable. One receipt format; receipts, not a shadow object store, constitute internal effects.
- Translation of intent is outside the machine. Free input and deterministic activation are separate. Never infer caller identity or authority from tuple fields; preserve pseudonyms, privacy by default and the machine/OAuth key distinction.
- Stateless hosted requests; Supabase-native Auth, persistence and Realtime. Treat the contracts, mechanisms, vectors, conformance suite and CI gates as the rigid core; choose native infrastructure for the elastic substrate. For each invariant, identify the smallest native enforcement mechanism and test it at its actual boundary. Keep `server/` as local reference, not a second product or hosted dependency. Do not build provider abstractions or external orchestration into the machine.
- State required for uniqueness must be enforced transactionally. Preserve idempotency, once consumption, and causal verification. A signature is not proof of external facts or ledger completeness; a receipt is not a substitute for a protected external executor.
- Spec before code for semantic changes. Version incompatible changes explicitly, preserve historical vectors, and add new vectors for the new version. Do not change tests to make a broken implementation pass. Avoid speculative scope (HSM, blockchain, enterprise frameworks, multi-region) in the current milestone.
- Preserve the domain vocabulary: Process Type, RUN, scanner, receipt, trajectory, frequency, tuning, `registered`, continuity. Process Type JSON remains independent of agent-facing Skill instructions; the package contract is open.

## Commands and validation

```sh
npm run build
npm test
npm run test:mutations
npm run example
```

`npm test` runs Node, Bun and browser conformance in sequence. If a runtime is unavailable, report it and run the remaining stages separately where possible. `npm run vectors` regenerates goldens only for an explicitly justified semantic change; do not overwrite compatibility evidence. `npm run stage:edge` builds and stages the same evaluator for Edge Functions. `npm run test:postgres` requires an explicitly designated disposable database (see hosted README). Never run it against production. Report exact results, including skipped, failing or blocked checks. Do not treat test doubles as proof of the real service. Run targeted mutations for parser, evaluator, publication and verification changes; a runner error or missing mutant anchor is a failed gate, not a detected regression. Keep legacy golden bytes pinned, separate independent expected values from generated goldens, and report cross-runtime conformance, real integration and simulated contract tests separately. Use pinned development tools from the lockfile.

Keep the documentation small: update the relevant canonical section, not a new competing handoff or phase-specific specification. Use version control for history.

CI/CD is a cross-cutting acceptance gate. Preserve the pinned Actions, tool lockfile, disposable PostgreSQL service, and exact-commit artifact verification. Run the two CI jobs for PRs and main; do not declare remote status checks or deployment successful without the actual results. Never expose deployment credentials to pull requests, change the staging write gate without approval, deploy from an unapproved branch, force/repair migration history automatically, or enable the preview flag implicitly. Staging/production are not substitutes for the local reference; see the hosted README.
