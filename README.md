# RADIO — LogLine Receipt

RADIO grew out of LogLine, a way for people and agents to express an event or intention by naming the entities, the action and its context. The machine evaluates the expression under the Institution's published Process Type and records the result in a signed receipt. Receipts can refer to earlier receipts, forming a trajectory that participants can verify with the appropriate evidence.

## Start with a LogLine

LogLine is the preferred authoring convention. A participant can use `who`, `did`, `this` and `with` as prompts when writing a Contract. The course example opens with a request to enroll.

```json
{
  "who": "learner:ana",
  "did": "enroll",
  "this": "course@2",
  "with": { "course": "RADIO" }
}
```

The example law recognizes `did: "enroll"` and reads `with.course`. The machine gets the actor from the authenticated request. A Skill can help the author identify the right entities and gather the references the law expects.

The Contract is the tuple inside the Submission. The protocol accepts any I-JSON value within its limits. In the same example, the completion RUN accepts `{"with":{"score":95}}` when the Submission supplies the required continuation and parents. Run both course examples with `npm run example` after installing the dependencies. [Executable v2 example](examples/trajectory.mjs)

RADIO Protocol 1.0 and its reference corpus were approved on 26 November 2026. The repository includes the historical v1 reference, the v2 reference and native Supabase materialization checkpoints. [Vision](VISION.md) · [Glossary](GLOSSARY.md) · [Specification](SPEC.md) · [Roadmap and review history](ROADMAP.md) · [Supabase setup and verification](supabase/README.md)

## Repository organization

The repository is the executable reference, the rigid protocol contract and conformance corpus, and the native Supabase materialization. Root documents have distinct roles; the npm library, full reference ZIP and hosted deployment archive have different delivery boundaries.

| Path | What |
|---|---|
| `VISION.md` | Purpose, architecture and principles |
| `SPEC.md` | Single technical contract: existing v1 and target requirements (§15) |
| `GLOSSARY.md` | Stable institutional and computational vocabulary |
| `DIPLOMACY.md` | Founding article; approved package contract in SPEC §15.18.5 |
| `bin/diplomacy.mjs` | Reference validator for DIPLOMACY ZIP (§15.18.5) |
| `contracts/` | Machine-readable structural projection of the single SPEC; not a second evaluator |
| `AGENTS.md` | Shared engineering instructions for coding agents |
| `ROADMAP.md` | Proposed milestones, PR dependencies and acceptance gates |
| `CLAUDE.md` | Imports the same instructions for Claude Code |
| `src/` | Reference library: TypeScript, no dependencies, WebCrypto only; the same code runs in Node, Bun and browsers |
| `src/process-type.ts` | Process Type validation, immutable reference publication and snapshot capture; no execution or hosted authorization |
| `src/scanner.ts` | Pure deterministic recognition, verified registry evidence and shared operation/work budgets; no authority or RUN execution |
| `src/run-v2.ts` | Request-scoped target RUN evaluation, authorized evidence observations and tentative receipt@2 signing; no commit or broadcast |
| `src/process-ledger.ts` | Target local reference: receipt-derived instances, publication/retirement, explicit continuation and recovery; trusted local adapter only |
| `src/ledger.ts` | Historical v1 reference machine: an append-only, content-addressed ledger with the radio, trajectories and bundles |
| `processes/` | Historical v1 example laws: a course of 5 lessons, a certificate, and an alumni register that reacts to certificates on its own |
| `examples/course.mjs` | The course run end to end, with a fork attempt, impersonation and offline verification |
| `bin/logline.mjs` | CLI: `logline verify-bundle <bundle.json\|url> [--keys keys.json\|url]` |
| `src/hosted.ts` | Direct Supabase client: native OAuth discovery, ephemeral writes, RLS reads and local verification |
| `server/` | Optional local HTTP reference: a durable, hash-chained ledger file. Not on the hosted request path |
| `bin/logline-server.mjs` | `logline-server serve`, `account`, `head` |
| `vectors/` | Frozen v1 goldens, independent portable vectors and v2 contract fixtures (not execution evidence) |
| `test/` | Conformance, integration and adversarial tests; reusable cross-runtime harnesses |
| `scripts/` | Build, staging, packaging and verification tools |
| `.github/workflows/` | CI and explicitly gated staging delivery |
| `supabase/` | Hosted target: Auth, transactional ledger, native radio and ephemeral functions; preview, not deployed |

```bash
npm ci            # pinned development tools and the CLI validator’s YAML parser
npx playwright install chromium
npm test          # build; Node, Bun and Chromium checks
npm run test:mutations  # targeted fault injection in isolated compiled copies
npm run example   # the course, start to certificate
```

`dist/` is prebuilt in the release zip, so `node examples/course.mjs` and `node bin/logline.mjs` work without a build.

Validate a DIPLOMACY archive after `npm ci` and `npm run build`:

```sh
node bin/diplomacy.mjs package.zip
```

The command verifies archive structure, manifest coverage and byte digests, exact canonical law bytes, and Agent Skills frontmatter. It prints the package id, law hash and Skill metadata. Package adoption remains a separate institutional decision.

## Cloud-first delivery

The GitHub-hosted RADIO CI workflow runs on pull requests targeting main or a RADIO review branch, and pushes to main. Required status-check enforcement in repository settings must be verified separately. Two CI jobs run the kernel, frozen and portable vectors, browser, targeted mutations, local reference demo, packaging checks, and real PostgreSQL 17 migrations/transactions. PostgreSQL uses a disposable stock database with test-only Auth claim accessors, not a live Supabase project. The jobs require no cloud credentials. The lockfile pins the compiler, browser tooling, independent JSON Schema validator, Supabase CLI and the YAML parser for the archive CLI.

A passing kernel job packages the exact tracked migration/function sources and tested compiled core, including the Git commit and SHA-256 manifest. Staging CD invokes the same CI on the explicitly confirmed main revision, waits for both jobs, downloads that run's artifact, checks the revision and manifest, and then uses Supabase CLI. Staging plan/apply are manual; apply is disabled until the hosted contract and project are approved. There is no automatic production deployment. See [hosted setup](supabase/README.md) for the staging gate and eventual production release.

## Evidence and conformance

Do not equate a green test count with a working hosted service.

| Layer | Evidence | Limitation |
|---|---|---|
| Versioned corpus | SHA-256 pins for all reviewed fixture files, the full RFC 8785 Appendix B and RFC 8032 §7.1 vectors across three runtimes, and an independent native-crypto audit of all 31 v2 receipts | Conformance of the reference and its fixtures within the reviewed scope |
| Historical vectors | 69 JCS/key/receipt checks across Node, Bun and Chromium; historical files pinned by SHA-256; native crypto independently audits receipt hashes, signatures and expected statuses | The original receipt goldens were generated by RADIO, so they preserve established behavior, not independent proof of all RUN semantics |
| New portable vectors | 48 expression, 23 strict JSON, 24 Process Type, 16 registry scenario and 51 scanner checks in all three runtimes | Covers only the implemented contract, not RUN execution or receipt@2 |
| Target RUN evaluation | 31 independently signed positive/negative/registered/doubt fixtures across Node, Bun and Chromium; local adversarial checks | Tentative receipt, not a durable v2 instance or verified complete trajectory |
| Target portable verification | Strict bundle@2 export and offline replay with independent trust, recursive causal and conflict evidence, mixed v1/v2 verification | Complete supplied closure only; not ledger-wide completeness, global uniqueness, current authorization or external effect |
| Target atomic acceptance | Forced concurrent reference submissions, blocked commit acknowledgement, conflict re-evaluation scenarios, actual process replacement and recovery | Single-writer reference and modeled optimistic observations; not native PostgreSQL v2 or physical power-loss proof |
| Target instance formation | Existing signed fixtures through reference commits/recovery in Node, Bun and Chromium; real local file integration and nonlinear joins | Single-writer local reference; not multiprocess/distributed atomicity or portable bundle verification |
| Machine-readable contracts | Node/Bun structural checks, cross-part consistency and independent signed v2 fixtures | Not target RUN evaluation, complete replay or authority |
| Adversarial verification | 9 cross-runtime probes of changed evidence, signatures, keys and missing replay context | A valid signature alone is not a successful replay |
| Reference behavior | Existing and new Node/Bun tests, including real local HTTP/SSE, restart, retries, corruption and publication boundaries | Hosted adapter tests with doubles are contract tests, not service integration |
| Targeted mutations | npm run test:mutations: each deliberate regression must fail its named test in an isolated copy | Selected faults, not exhaustive mutation coverage |
| Boundary hardening | Cross-runtime I-JSON, calendar, work and receipt-size regressions; real ZIPs, independent package IDs and malformed archive cases | Reference profile; native capacity, resource binding and agent interoperability require separate evidence |
| Actual PostgreSQL | npm run test:postgres: separate real transaction, concurrency, rollback, CAS and RLS tests | Requires an explicitly disposable DB; local claim fixture is not Supabase Auth, and SQL tests do not test OAuth, Edge, PostgREST or Realtime |

The new expected values are hand-derived from SPEC; Process Type and scanner canonical bytes and hashes were computed independently on an ASCII/simple-JSON subset with Python json/hashlib, and the native crypto audit checks their content addresses. The regular test command never generates or updates goldens. The historical generator is not an oracle and must not overwrite compatibility evidence during ordinary development.

The three runtimes used for the latest reference verification were Node 22.23.5, Bun 1.4.5 and Chromium 141 (Playwright 1.56.0); TypeScript 5.9.3 and Playwright are pinned development dependencies. See the hosted README for the PostgreSQL-only compatibility fixture and the outstanding hosted gates.

## The v1 reference example: a course as a trajectory

- `course.lesson@1`: each lesson **cites the previous lesson's receipt**. The rules check that it's the same learner, the same course and the next lesson, with a score of at least 70. The receipt's grants carry `completed`, which the next lesson builds on. A cited lesson can be consumed only once, so a trajectory can't fork. A failed attempt consumes nothing, so it can be retried.
- `course.certificate.logline-101@1` **cites the last lesson**. Its rules require 5 completed lessons by the same learner. The certificate's bundle holds the whole trajectory, and every receipt in it is re-run by hash when it's verified.
- `alumni.logline-101@1` **listens to the radio**. When a certificate comes out `ok`, it reacts with a receipt of its own that cites the certificate. Nobody submits anything.

An alternative law in `examples/alumni.external.logline-101@1.json` has no automatic reaction; an independent listener submits the next input. This is the target RADIO interaction model.

## The v1 reference machine

- **Choreography.** Processes with `on` react to receipts on air. Loops are stopped by three limits: one reaction per trigger and process, a maximum depth, and a budget per submission. Halted reactions are reported.
- **Idempotency.** The same submission from the same person in the same time window returns the receipt that already exists. A retry never decides twice and never consumes twice.
- **Strict input.** `submitText` parses I-JSON and refuses duplicate keys, lone surrogates and integers that would be silently rounded.

## Primary architecture: Supabase-native (hosted preview)

Supabase Auth provides standing OAuth 2.1 identity service. PostgreSQL holds the durable laws and trajectories, and Realtime supplies communication. Edge Functions evaluate and sign individual submissions in the initial deployment. Each request can run on a replacement executor using the same RUN contract. The OAuth consent surface can be a static browser application. [Hosted architecture](supabase/README.md) · [Execution and scaling](supabase/README.md#execution-and-scaling)

```js
import { hostedClient } from "@logline/receipt";
const radio = hostedClient({
  url: supabaseOrigin, publishableKey, keys: trustedMachineKeys,
  accessToken: () => currentOAuthAccessToken,
});
const result = await radio.submit(tuple);
const receipt = await radio.receipt(result.receipt.id);
```

This client does not acquire or refresh credentials itself; supply a current token from the native OAuth client. Public receipt reads are unauthenticated; private CAS reads use the caller’s token and RLS. It verifies returned signatures and content addresses without contacting the local server. Hosted root-only writes are still gated by `LOGLINE_ENABLE_PREVIEW`; asynchronous reactions are not implemented.

## Run the optional local reference machine

```bash
npm run build
node bin/logline-server.mjs account root --admin     # prints a bearer token, once
node bin/logline-server.mjs account ana
node bin/logline-server.mjs serve --port 8080 --publish processes
```

Everything lives in `./data` (or `--data DIR`): `ledger.jsonl`, the machine key and the pseudonym secret, both mode 0600. Back up the whole directory; losing the key means the machine can't restore its own ledger.

| Route | Who | What |
|---|---|---|
| `GET /.well-known/logline.json` | anyone | cacheable keys, limits and supported transport versions |
| `GET /head` | anyone | changing ledger head `{n, hash}` (no-store) |
| `GET /processes`, `GET /processes/:hash` | anyone | the published law, by content address |
| `POST /processes` | admin | publish a process; an id can't be republished (409), amend under a new id |
| `POST /submit` | anyone; a token sets `by` | I-JSON body → `{receipt, detail, replayed, reactions, halted}`; 201 new, 200 replayed |
| `GET /receipts/:id` | anyone | the signed public header and its `seq` |
| `GET /receipts/:id/detail`, `/bundle` | its submitter, or admin | the private parts; the bundle verifies offline |
| `GET /history?…&after=&limit=` | anyone | past receipts, paged by `seq` |
| `GET /radio?…` | anyone | Server-Sent Events, one `receipt` event per broadcast; resumes from `Last-Event-ID` |
| `GET /me` | token | your account and on-air pseudonym |

`LogLine-Version: 1` is accepted on each request (omission defaults to `1`). Unknown versions return 400 with `supported` and `requested`. Public hash-addressed resources are immutable; private details and bundles are never cached.

Tuning parameters are `frequency`, `status`, `by`, `process_hash` (comma lists; `course.*` patterns) and `activated`. `by=me` means your pseudonym.

```bash
curl -N 'http://localhost:8080/radio?frequency=course.*&status=ok'
curl -X POST -H "authorization: Bearer $TOKEN" localhost:8080/submit -d @tuple.json
LOGLINE_TOKEN=$TOKEN node bin/logline.mjs verify-bundle http://localhost:8080/receipts/$ID/bundle --keys http://localhost:8080
```

**What the server guarantees**

- **Durable before acknowledged.** Every record is appended and fsynced before the receipt is returned or broadcast. After a storage error the machine refuses writes (503) instead of continuing in memory.
- **The log can't be quietly edited.** Lines are hash-chained, and on start every receipt is re-checked: signature, detail, tuple and process by hash. The consumption, idempotency and reaction state is recomputed, never stored. A torn last line from a crash is dropped (it was never acknowledged); any other change refuses to start. `serve --replay` also re-runs every decision.
- **One decision per submission.** Writes are serialized, so identical requests racing each other produce one receipt.
- **Private by default.** On air: only the signed header. Tuples and details: only their submitter (by pseudonym) or an admin. Anonymous submissions get their detail in the response and nowhere else.
- **Limits answer with reasons.** Body size (413), submissions per caller (429 with `Retry-After`), strict I-JSON (400 `ijson`). A radio listener that can't keep up is disconnected and resumes from `Last-Event-ID`.

Not yet: key rotation, encrypted objects with erasure, an external anchor for the head, TLS (put it behind a reverse proxy). One process, one file: it is a single-writer machine.

## Target v2 local reference

The library's ProcessLedger invokes the same request-scoped evaluator and adopts a signed receipt only after its record sink acknowledges it. For a real local file, import openProcessMachine from server/store.mjs. Use a new directory for the target-format reference, not an existing v1 directory. It reuses the hash-chained file and fsync path without starting a server. A Process exists through the successful entry receipt and its causal continuations, not a running worker. The trusted adapter supplies an attested by and a canRead authorization callback for evidence; this is not an OAuth or participant-facing endpoint. Do not expose the private ledger methods to untrusted clients. Close a writer before opening another for the same directory. See SPEC §15.14 for recovery, storage limits and outstanding gates.

## Portable target trajectory

The course example uses `ProcessLedger.bundle(id)` to export private evidence. The caller must authorize access before exporting it. Supply `verifyBundleV2` with the raw JSON text and an independently trusted key ring. The verifier checks authenticity, decision replay and completeness of the required evidence for the supplied trajectory. [Portable verification contract](SPEC.md#1516-pr-08--portable-trajectory-verification)

## Local target continuity

Use the same local reference server and CLI with an explicit target data directory; do not point these commands at an existing v1 directory. This is not the hosted deployment.

```sh
npm run build
node bin/logline-server.mjs account --target --data ./data-v2 reviewer --admin
node bin/logline-server.mjs account --target --data ./data-v2 learner
node bin/logline-server.mjs serve --target --data ./data-v2
```

The existing POST /processes accepts a Process Type JSON law in target mode (admin token); POST /submit accepts the authenticated submission envelope. GET /radio and /history carry committed public receipts, with local sequence cursors. Private evidence stays behind owner/admin checks for this demonstration. See SPEC §15.17. For target bundle verification the CLI requires independently obtained keys (a trusted discovery document containing keys), for example:

```sh
node bin/logline.mjs verify-bundle bundle.json --keys trusted-discovery.json
```

The real process/reader replacement scenario runs in test/continuity.test.mjs. The historical server and CLI behavior remain available without --target.

## Hosted readiness

The Supabase-native path is the target, not yet the production implementation. See [supabase/README.md](supabase/README.md) for the transaction boundary and tests; [SPEC.md §15](SPEC.md#15-radio-target-architecture--approved-kernel-contract-staged-implementation) defines the target and unresolved contracts. The optional local server remains the executable reference, never a dependency of the hosted client.

## Use the library

```js
import { MemoryLedger, generateMachineKey, verifyBundle } from "@logline/receipt";
const ledger = new MemoryLedger((await generateMachineKey()).key);
await ledger.publish(process);
ledger.listen({ frequency: "course.*", status: "ok" }, (receipt) => { /* the radio */ });
const { receipt } = await ledger.submit(tuple, { by: pseudonym });
const verdict = await verifyBundle(ledger.bundle(receipt.id), publishedKeys);
```

MIT licensed.
