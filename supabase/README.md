# RADIO on Supabase

The [RADIO Protocol 1.0 contract](../SPEC.md#1518-pr-09a--approved-coordinated-boundary-contract) governs Cycle II. The [roadmap](../ROADMAP.md#m3--the-substrate) sets the delivery gates. This document records materialization choices and the evidence available for each boundary. Target v2 and the preserved v1 preview have separate schemas and interfaces.

## Native Materialization Matrix

| Milestone and contract | Existing reference | Native capacity | Remaining target work |
| --- | --- | --- | --- |
| M3 · Identity and stateless admission (§15.18.1–2) | Attested actor and HMAC pseudonym. The v1 preview authenticates an account. | Auth provides users, linked identities, MFA, OAuth, consent APIs, Code + PKCE, tokens and JWKS. | Configure Auth and a minimal consent surface. Verify issuer, subject, client and intended resource in PR-11–13. Persist the pseudonym binding and prove revocation with actual clients. |
| M3 · Effective authority and private evidence (§15.18.1–3) | Reference resolves use and disclosure separately. PR-10 intersects an active principal, the verified client or explicit direct mandate, and receipt access. | PostgreSQL grants, RLS, row locks and a protected audit record. | PR-13 connects the admitted client and resource to Auth, proofs of current authority and the approved visibility policy. Test resource binding and direct Data API access before exposing participant routes. |
| M3 · Immutable law and Registry (§15.8, §15.10) | Process Type validator, strict I-JSON, JCS, scanner and immutable admission snapshots. PR-10 persists bounded snapshots and their active pointer. | PostgreSQL unique keys, digest, transaction and row lock. | The PR-11 adapter publishes with the existing validator and supplies the admitted snapshot to the scanner. It reads one historical law for a successor. |
| M3 · CAS and atomic constitution (§15.9, §15.14–15) | Frozen evaluator and receipt creation. PR-10 adds CAS and authoritative submission, RUN and once claims. | PostgreSQL unique constraints, FKs, transaction and keyed locks. | The PR-11 adapter marshals observed reads and recovers ambiguous acknowledgments by nonce. Retry preserves the admitted time and Registry. |
| M3 · Bounded ephemeral execution (§15.13, §15.18.6) | Scanner, RUN and signing are runtime-neutral TypeScript. | Edge Functions, WebCrypto and Edge Secrets. | Stage the existing code. Measure worker CPU, memory and bounded evidence reads at the frozen limits. Evaluate native middleware by responsibility. |
| M4 · Committed radio and tuning (§15.18.4) | Reference receipts and tuning. The preview's Realtime publication is v1 only. | Database-originated Broadcast and private channels with Realtime Authorization. | PR-14 verifies emission after commit, payload size with framing and the maximum authorization lease against a noncooperative listener. |
| M4 · Durable history (§15.18.4) | Reference recovery and a PostgreSQL late-commit snapshot probe. | PostgreSQL MVCC or another demonstrably closed commit window. Realtime Broadcast Replay can help recent recovery. | PR-15 chooses a cursor design and proves stable pages, late-commit coverage, reconnect and immutable checkpoints under concurrent writes. |
| M5 · Direct API and MCP (§15.18.3) | The MCP function exposes v2 law discovery, submission and evidence through the official SDK. Submit uses the existing v2 transaction adapter. | Data API, Edge Functions, Auth OAuth and stateless MCP 2026-07-28. | Verify native consent, resource binding and interoperability with actual hosted clients before activation. |
| M5 · DIPLOMACY (§15.18.5) | The archive validator can produce an operator adoption statement for the MCP catalog. The function serves manifest and verified Skill text. | PostgreSQL adoption records and candidate Storage distribution with access policies. | PR-19 covers archive distribution, protected download lifetime and hosted agent interoperability. |
| M6 · Capacity and institutional recovery (§15.18.6) | Signed trajectories, replay and local replacement tests. | PostgreSQL backups/PITR, managed logs and metrics. Storage object bytes need a separate backup. | PR-20–22 measure contention, fan-out and cost. Restore Auth mappings, mandates, pseudonym and signing continuity, all CAS, receipts, claims and DIPLOMACY bytes in isolation. |

Use RLS and explicit grants for exposure, and add indexes against measured access patterns. Queues, Cron, GraphQL, search and read replicas remain options for demonstrated operational needs. Keep authority and commit confirmation on the authoritative database. Keep OAuth issuance with Auth, Broadcast with Realtime and deterministic evaluation in the existing kernel.

[Data API grants](https://supabase.com/docs/guides/api/securing-your-api) · [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security) · [OAuth token security](https://supabase.com/docs/guides/auth/oauth-server/token-security) · [Edge limits](https://supabase.com/docs/guides/functions/limits) · [Database Broadcast](https://supabase.com/docs/guides/realtime/broadcast) · [Realtime Authorization](https://supabase.com/docs/guides/realtime/authorization) · [Database backups](https://supabase.com/docs/guides/platform/backups)

### PR-10 transaction checkpoint

The additive `radio_v2` migration stores canonical text, validates content hashes in PostgreSQL and assembles the fixed Registry and receipt envelopes around already evaluated bytes. The trusted adapter validates Process Type and I-JSON, supplies signed bytes and their typed projections, and captures every evaluator observation. SQL verifies content addresses and transaction invariants. Each private decision binds the receipt to its principal, client, authority revision and evidence. Successful RUN and once claims are immutable.

- `radio_v2_publish` serializes changes to the Registry pointer. It is idempotent for already published bytes, including retired laws. A null body requests retirement.
- `radio_v2_admit` authorizes submission and result disclosure before recovery. A new admission returns the immutable Registry address, attested time, pseudonym and policy revision. `radio_v2_registry`, `radio_v2_read` and `radio_v2_observe` provide scoped inputs and observations for the adapter.
- `radio_v2_commit` rechecks the same authority and observations, including absent evidence and claims. It returns `committed`, `replayed`, `submission_conflict`, `retry` or an admission/resource failure. The PR-11 adapter maps these internal outcomes to the transport contract. The [SQL integration harness](../test/postgres-v2.integration.mjs) demonstrates the payload binding.

Only the trusted `service_role` can call these RPCs. The private tables have RLS and no participant grants. Operator-owned permission maps default to deny. They store arrays of operation names keyed by the verified OAuth client UUID or the explicit `direct` policy. Receipt resource grants use the receipt address as key. The Edge boundary will verify Supabase identity and OAuth resource claims and derive the stable HMAC pseudonym. PostgreSQL locks membership and grants during the commit. Public receipt storage contains the signed bytes and their ID. PR-14 will establish committed-only delivery. Existing v1 preview laws and receipts remain in their own schema. Any authorized historical v1 evidence integration needs an explicit materialization decision.

The SQL tests run real PostgreSQL transactions with the frozen evaluator, a test identity fixture and overlapping writers.

### PR-11 ephemeral Publish and Submit

The Publish and Submit function entrypoints accept `LogLine-Version: 2` when `RADIO_ENABLE_V2=true`. Publish accepts raw Process Type JSON. Submit accepts the existing Submission envelope and returns the root-only SubmitResult. A fresh commit returns HTTP 201 and an authorized replay returns 200. Failures return the stable BoundaryFailure shape. The preview has its own `LOGLINE_ENABLE_PREVIEW` flag and v1 dispatch. Provision the machine JWK, pseudonym secret, service key, publishable key and Supabase URL only in the approved environment.

This checkpoint accepts verified direct Auth sessions. The function validates the exact bearer against the project's Auth user endpoint and checks subject, issuer, authenticated audience, role, expiry and session ID. Set `RADIO_AUTH_ISSUER` to the exact Auth issuer when it differs from the Supabase URL plus `/auth/v1`. SQL enforces an explicitly admitted direct mandate and current disclosure authority. OAuth client tokens are gated until PR-12/13 establish client and resource binding. The Auth checks use neither user metadata nor app metadata for institutional grants.

The adapter bounds request and RPC response bytes. It uses one full Registry read for entry recognition and narrow snapshot/law reads for continuations. Each invocation allows up to four candidate commits within a 60-second request deadline. Read and commit observations are refreshed after a conflict. The original admission time and Registry stay fixed. An ambiguous response triggers an authorized nonce lookup that waits for the submission lock. Replayed bytes are checked against the request, content hashes and machine signature before disclosure.

The integration harness exercises the Edge entrypoints with real Supabase Edge Runtime, PostgREST and PostgreSQL. It verifies committed bytes against the frozen reference, forces a native once conflict, truncates a committed response, replaces the worker and tests revocation and resource failures. Its Auth endpoint is a fixture. A complete hosted Auth and gateway test remains a separate acceptance gate.

### Stateless MCP

The `mcp` function uses `@modelcontextprotocol/server@2.4.0` for Streamable HTTP and MCP 2026-07-28. The SDK's stateless 2025 compatibility path uses the same tools and authority checks. Both paths work across worker replacements. Fixed tool and machine metadata can be cached for 60 seconds. Law catalog, Skill and receipt reads check current authority at request time.

In the MCP client, list the active Process Types, describe a law by hash and read its adopted DIPLOMACY Skills. Use the law's `recognize` and first RUN's `requires` with the Skill's examples. Draft the Contract with the human and ask them to approve the exact tuple before invoking `submit_contract`. LogLine's `who`, `did`, `this` and `with` are a preferred writing convention. The submission accepts any valid I-JSON tuple and derives identity from the OAuth token. Omit `continue` for scanner recognition and pass `continue` explicitly for an existing Process. Supply a fresh base64url nonce for a new submission and reuse it for a retry. A committed receipt with `status: "ok"` and `instance: null` is the first successful RUN of a new Process.

For an approved Supabase project:

1. Apply the v2 migrations and stage the evaluator with `npm run stage:edge`. Configure the native OAuth server, asymmetric signing and the [Supabase OAuth Consent UI](https://supabase.com/library/docs/nextjs/oauth-consent). Register approved clients dedicated to this MCP resource. If a connector registers dynamically, approve its assigned client ID and configure step 3 before testing consent and token issuance for it. OAuth registration and consent do not admit a principal to the Institution.
2. Set `RADIO_MCP_RESOURCE` to the external `https://<project-ref>.supabase.co/functions/v1/mcp` URL, or its canonical custom-domain URL. Set `RADIO_AUTH_ISSUER` to the actual native Auth issuer. Provision the machine and adapter secrets from the v2 setup. The gateway lets OAuth discovery reach this function, and the function verifies each bearer using the project's JWKS.
3. Set each dedicated client's OAuth audience in the operator-owned `radio_v2.oauth_resources(client, resource)` table and enable the native Custom Access Token Hook `public.radio_v2_oauth_audience`. If the project already uses a hook, compose this assignment there. The token must carry the exact MCP resource in its signed `aud` claim and a native `client_id`. Grant each principal an explicit mandate for that client in `radio_v2.authority`. Read-only clients can receive `read_public`. Submitting also needs `submit` and `disclose`, and formal citations use their own `use_evidence` policy. To revoke a client's institutional access, remove or reduce its mandate.
4. Publish the intended Process Types. To adopt a package for a law already published, run `node bin/diplomacy.mjs PACKAGE.zip --mcp-sql > adoption.sql` after the build and apply the generated statement with the operator role. This validates the ZIP and updates the law's selected DIPLOMACY revision. Each Skill read verifies the exact Markdown bytes against the manifest. Keep the original archive for distribution and recovery.
5. On a disposable hosted project, deploy `mcp` and enable `RADIO_ENABLE_V2=true` and `RADIO_ENABLE_MCP=true`. Install the connector using the exact resource URL in ChatGPT or Claude. Test native authorization code and refresh, correct and wrong resources, and revoked mandates before operational exposure. A generic `aud: authenticated` credential is rejected. Verify that the issuer binds the grant to the intended resource, including an authorization attempt for another resource, before admitting clients.

`npm run test:mcp` uses the same disposable database and PostgREST prerequisites as `test:edge`, plus Deno and ZIP. The official npm client exercises the staged Edge handler and an asymmetric Auth/JWKS fixture locally. This covers the adapter's token checks and PostgreSQL authority. Hosted OAuth grants, refresh and connector registration require the hosted gate above.

## Preserved v1 hosted preview

The original migration and functions remain the v1 preview. The optional HTTP server is a local executable reference. The preview is kept for regression testing.

## No application server on the path

```text
Browser / agent / application
  |-- OAuth discovery, login, consent, token --> Supabase Auth
  |-- POST tuple + access token -------------> Edge submit
  |                                              | evaluate + sign
  |                                              v
  |-- public receipt / process / CAS reads ---> PostgREST / Postgres
  |-- private CAS reads (user JWT + RLS) -----> PostgREST / Postgres
  |-- subscribe ----------------------------> Supabase Realtime
  `-- verify / replay ----------------------> local TypeScript library
```

The only persistent **application-facing identity authority** is Supabase Auth. Postgres and Realtime are managed data services, and Edge Functions execute on demand; no correctness property may depend on a warm worker. There is no separate LogLine process, custom OAuth server, reverse proxy, or `llt_` token in this path. The auth issuer key and machine receipt-signing key remain distinct: the former authenticates callers, the latter attests decisions.

### Native OAuth setup (not applied)

1. Enable OAuth 2.1 Server in the chosen project's Auth settings and configure asymmetric JWT signing, approved redirect URLs and Authorization Path. The issuer is the project's Auth URL; use its native discovery endpoint `/auth/v1/.well-known/oauth-authorization-server`.
2. Host the authorization UI as a static browser application at the configured Site URL + Authorization Path. Supabase redirects with `authorization_id`; the UI authenticates the user, calls `supabase.auth.oauth.getAuthorizationDetails`, and invokes the SDK's approve or deny methods after an explicit decision. No custom server is needed for this UI, but it is required and is not included in this checkpoint.
3. Register OAuth clients (dynamic registration only if approved). The client handles authorization code + PKCE, token exchange, and refresh directly with the issuer. It passes the access token to `hostedClient`, which obtains a fresh token per protected request and does not store or refresh it.
4. Provision the independent LogLine public machine key ring through trusted application configuration. Do not infer trust from a receipt carrying its own key. The client verifies signed receipts and CAS addresses locally; no custom key discovery daemon is required. A key publication/rotation mechanism remains open.
5. Before exposing OAuth clients, define client-specific authorization (including `client_id`, audience, and admin privileges). The existing hosted handler verifies a bearer against `/auth/v1/user` and enforces account-level authorization only. RLS currently grants access by account; OAuth clients acting for that account inherit those rights. This is not a completed delegated-scope model. Keep the preview gate closed until those policies and the real platform integration are validated.

The direct client uses the native Supabase URLs, never `server/http.mjs`. It takes only a publishable API key (or legacy anon key), an independently trusted machine key ring, and an optional access-token supplier. The service key and signing secret stay in Edge Functions. All requests are independent. Public receipt and process reads omit user credentials. Private evidence goes through RLS. There is no custom history cursor guarantee yet; native Realtime is not a durable replay service.

References (checked 2026-11-25): [OAuth server](https://supabase.com/docs/guides/auth/oauth-server), [setup and consent](https://supabase.com/docs/guides/auth/oauth-server/getting-started), [OAuth flows](https://supabase.com/docs/guides/auth/oauth-server/oauth-flows), [Edge authorization](https://supabase.com/docs/guides/functions/auth-headers), [MCP on Edge Functions](https://supabase.com/docs/guides/ai-tools/byo-mcp). The target requires a stateless MCP adapter as another ephemeral handler in Supabase. It is not implemented here, and the native LogLine client works without it.

## Boundary

`submitRoot` is a request-scoped adapter, not a new evaluator. It looks up the immutable law, obtains spent citations, calls the existing `issue`, then requests one atomic SQL commit. The commit either returns the new receipt ID, returns a previous ID for the same cache key, or requests re-evaluation after a once/publication conflict. A failed once claim rolls back the receipt, both CAS objects, the cache key, owner link and outbox event together. Only an acknowledged commit is returned. At most eight attempts per invocation, with a retryable 503 on contention.

`0001_radio.sql` stores canonical JSON as text so PostgreSQL JSONB's restrictions on characters such as U+0000 do not narrow the free tuple format. CAS objects have no owner field: access comes through the private receipt association, so identical bytes can belong to multiple users. The Realtime table has only public data and no account identifier. Clients cannot call the write RPCs. `service_role` is the trusted writer; the SQL does not reproduce process rules or verify the machine signature. The machine key holder can forge decisions; Postgres administrators can alter the database. There is no Merkle anchor yet.

`submit` and `publish` are Edge Function entrypoints. Requests use Supabase Auth's `/auth/v1/user` endpoint for bearer validation, `app_metadata.logline_admin === true` for publication and HMAC of the verified user UUID for `by`. No client claim in a tuple controls the receipt identity. The public CAS and receipt tables and private access policy are defined in the migration. Realtime publication is configured for receipt inserts; clients parse the canonical receipt string and verify signatures.

## Limits of the v1 preview

- Root-only `submit` preview returns `{receipt, detail, replayed}`; unlike the local response it has **no** synchronous reactions. The entrypoints refuse to start unless `LOGLINE_ENABLE_PREVIEW=true`. There is no deployed route or production contract change for hosted choreography.
- The outbox is durable but there is no dispatcher or `react` worker yet. The pair uniqueness constraint is reserved. The target design puts community reactions outside the machine (SPEC §15). Reassess whether the outbox and pair uniqueness remain necessary; do not implement a community reaction worker by default. Any retained internal reactions require a specified response shape, publication snapshot, ordering, halt reporting and atomic budget.
- Sequence allocation is not transaction commit ordering. A hosted `seq > cursor` history/reconnect contract cannot be promised until this is solved. No hosted history or bundle API, key discovery gateway, MCP endpoint, rate limiter, applied OAuth authorization-server configuration, client-supplied citation bundle wire format or anchoring is provided here. Client-supplied citations must not bypass authoritative consumption or existence checks. The internal adapter can accept a trusted citation store, not untrusted wire input.
- The existing evaluator allows laws to read cited details and broadcast selected fields. Admins must review laws for disclosure; RLS prevents direct private-object access but does not itself constrain semantic disclosure by a published law. JWT-based RLS admin claims can remain valid until refresh; Auth user lookup for publication uses current account metadata. Key rotation and revocation policy remain open.

## Cloud delivery contract

The minimal local config uses the CLI 3.x config.jsonc format and PostgreSQL 17, with implicit Data API grants disabled locally. The migrations declare explicit grants and RLS. Remote configuration is not pushed by this pipeline. No secret is included in a package.

CI runs on GitHub-hosted runners. It uses a pinned PostgreSQL 17 service image; the test-only Auth fixture is never packaged for deploy. The database test performs CLI dry-run, migration application, migration listing, real transaction/RLS tests and a second idempotent push. The test job cannot target a remote database. The kernel job packages only tracked Supabase sources plus the compiled tested core; the artifact contains the commit, manifest and archive digest. Both jobs must pass for staging.

For a future approved staging project, configure GitHub's staging environment, restricted to main with required reviewers, and configure both CI jobs as required checks on main. Keep environment-scoped variables SUPABASE_PROJECT_REF and SUPABASE_PUBLISHABLE_KEY, and secrets SUPABASE_ACCESS_TOKEN (least privilege for the staging project) and SUPABASE_DB_PASSWORD. Leave RADIO_STAGING_DEPLOY_APPROVED unset until M3 approves the hosted contract and explicitly authorizes writes. Provision the machine signing key and pseudonym secret separately; never use test keys or set LOGLINE_ENABLE_PREVIEW automatically.

Dispatch RADIO Staging on main with mode plan, the exact staging project ref and the exact commit SHA. Review the migration plan. Dispatch apply only after approval, with the same commit/ref and the enabled staging gate. The workflow re-runs the same CI, consumes the package from that run, and validates the archive and individual files before the pinned CLI runs. It lists migrations, dry-runs, applies without vault changes or force flags, deploys only submit/publish without pruning or overriding the JWT gateway policy, and checks public read/unauthenticated rejection as a transport smoke. An apply can partially succeed across DB and Functions; on error, stop, inspect the actual state, reconcile forward under review. No automated schema rollback, repair, reset, secret updates or production deployment. The smoke is not OAuth, authenticated write, Realtime, or semantic integration evidence.

The eventual production workflow must be authorized separately at M6 and promote the same reviewed release, with hosted integration evidence, recovery/backup and key management agreed. Do not attach automatic Supabase GitHub deployment to main in parallel with this pipeline.

## Local verification

```sh
npm run build
npm run test:node
npm run stage:edge
```

`stage:edge` copies the compiled runtime-neutral core into `_shared/core`. Generated code is ignored in git; there is only one evaluator source. The `hosted.test.mjs` test double tests actual evaluator and adapter behavior but is NOT proof of SQL concurrency, RLS, PostgREST or Deno runtime compatibility.

For a **disposable local Supabase database only**, after applying the migrations using the local tooling, run:

```sh
LOGLINE_DISPOSABLE_DB=yes LOGLINE_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npm run test:postgres
```

For a **fresh disposable stock PostgreSQL 17 database**, the test-only fixture below installs the minimal roles and claim-accessor functions needed by the migration. Never apply this fixture to an actual Supabase project. Use a local database URL and a fresh, isolated database/cluster; no production connections.

```sh
psql "$LOCAL_TEST_DB" -X -v ON_ERROR_STOP=1 -f test/postgres-auth-fixture.sql
psql "$LOCAL_TEST_DB" -X -v ON_ERROR_STOP=1 -1 \
  -f supabase/migrations/0001_radio.sql \
  -f supabase/migrations/20261126062956_radio_v2_transactions.sql \
  -f supabase/migrations/20261126064700_radio_v2_edge_inputs.sql \
  -f supabase/migrations/20261126103336_radio_v2_mcp.sql
LOGLINE_DISPOSABLE_DB=yes LOGLINE_TEST_DATABASE_URL="$LOCAL_TEST_DB" npm run test:postgres
```

The actual PostgreSQL tests force both once contenders to reach commit with the same unspent observation, assert the retry and no tentative receipt/outbox, inject a failure after receipt insertion, verify that every touched table rolls back, then retry successfully. CAS collision and rejected publication must leave no orphan bytes. The RLS and transactional checks run against PostgreSQL; the claim-accessor fixture does not validate Supabase Auth, OAuth, PostgREST, Edge execution or WebSocket delivery. Those remain separate M3/M4 gates.


This integration runner makes real concurrent psql requests, creates an isolated randomly named test law and checks RLS and transactional invariants. Test data persists; use a throwaway DB. The historical preview gate ran on PostgreSQL 16 and 17, and the v2 transaction gate targets PostgreSQL 17. The CI path applies the migrations through the pinned Supabase CLI and checks migration history. It is not a full Supabase end-to-end test.

For `npm run test:edge`, use that fresh loopback database with the migrations and fixture above. Add the disposable PostgREST connection role, using a local authentication configuration that permits that connection:

```sql
create role authenticator login noinherit;
grant anon, authenticated, service_role to authenticator;
```

Put PostgREST and Deno on PATH. The default runs the shared factory in standalone Deno. With the Supabase `edge-runtime` binary on PATH, set `RADIO_TEST_NATIVE_EDGE=yes` to run the real function entrypoints in fresh Edge workers.

```sh
RADIO_TEST_NATIVE_EDGE=yes LOGLINE_DISPOSABLE_DB=yes LOGLINE_TEST_DATABASE_URL="$LOCAL_TEST_DB" npm run test:edge
```

For a future approved local Edge test, set secrets using local tooling: `LOGLINE_ENABLE_PREVIEW=true`, `LOGLINE_MACHINE_JWK` (private Ed25519 JWK), `LOGLINE_PSEUDONYM_SECRET` (at least 32 random bytes in unpadded base64url), `SUPABASE_URL`, a service key (`LOGLINE_SERVICE_KEY` or `SUPABASE_SERVICE_ROLE_KEY`), and a publishable key (`LOGLINE_PUBLISHABLE_KEY` or `SUPABASE_ANON_KEY`). Never use the vector test key. If testing anonymous calls or modern signing keys, the gateway's legacy JWT check must be disabled for those functions and the function's own bearer validation retained. No project-specific config or secrets are included. Check platform limits and plan availability before deployment.

`test/direct.test.mjs` exercises the direct client against the real request handler and evaluator using a transport/database double. It does not establish real OAuth, RLS or gateway behavior.
