# RADIO on Supabase

The RADIO Protocol 1.0 contract governs Cycle II. PostgreSQL v2 transactions, Publish/Submit, stateless MCP and committed receipt signals are merged and have local native integration evidence. Hosted qualification and activation remain open. The preserved v1 preview uses separate schemas and interfaces. [Protocol contract](../SPEC.md#1518-pr-09a--approved-coordinated-boundary-contract) · [Delivery checkpoint](../ROADMAP.md#current-checkpoint)

## Native Materialization Matrix

| Milestone and contract | Merged implementation and evidence | Native capacity | Remaining acceptance work |
| --- | --- | --- | --- |
| M3 · Identity and stateless admission (§15.18.1–2) | Direct Auth validation, stable HMAC pseudonym and admission against an immutable Registry. MCP validates signed issuer, client and resource claims. | Auth users, OAuth, consent APIs, Code + PKCE, tokens and JWKS. | Configure native Auth and consent. Exercise issuance, refresh and resource binding with a real client. |
| M3 · Effective authority and private evidence (§15.18.1–3) | SQL intersects principal, direct or OAuth client mandate and resource access. It revalidates authority at commit and records a private audit. Local tests cover revocation and denied evidence. | PostgreSQL grants, RLS and row locks. | Test direct Data API access, multiple native clients for one principal and freshness on the project before exposure. |
| M3 · Immutable law and Registry (§15.8, §15.10) | Publish uses the shared strict parser, JCS and Process Type validator. SQL persists bounded snapshots and an active pointer. The scanner uses the admitted snapshot. | PostgreSQL unique keys, digest, transaction and row lock. | Verify publication and historical reads through the project gateway. |
| M3 · CAS and atomic constitution (§15.9, §15.14–15) | SQL persists CAS and enforces submission, RUN and once claims. The adapter refreshes observations on conflict and recovers a lost response by nonce. Local PostgreSQL and Edge tests exercise both. | PostgreSQL unique constraints, foreign keys, transactions and keyed locks. | Run write, authorization and recovery tests on the approved project. |
| M3 · Bounded ephemeral execution (§15.13, §15.18.6) | The shared scanner, RUN evaluator and signing code ran in the local Supabase Edge Runtime. | Edge Functions, WebCrypto and Edge Secrets. | Measure worker CPU, memory and evidence I/O at the frozen limits. |
| M4 · Committed radio and tuning (§15.18.4) | Native local Realtime tests verified private receipt ID signals, two listeners, rollback, denied join/send and lease expiry. Clients resolve and tune on the verified signed receipt. | Database-originated Broadcast and private channels with Realtime Authorization. | Qualify the protected socket lease, permissions and framing on the project before enabling the channel. |
| M4 · Durable history (§15.18.4) | Reference recovery and a PostgreSQL late-commit snapshot probe. | PostgreSQL MVCC or another demonstrably closed commit window. Realtime Broadcast Replay can help recent recovery. | PR-15 chooses a cursor design and proves stable pages, late-commit coverage, reconnect and immutable checkpoints under concurrent writes. |
| M5 · Direct API and MCP (§15.18.3) | The MCP function exposes v2 law discovery, submission and evidence through the official SDK. Submit uses the existing v2 transaction adapter. | Data API, Edge Functions, Auth OAuth and stateless MCP 2026-07-28. | Verify native consent, resource binding and interoperability with actual hosted clients before activation. |
| M5 · DIPLOMACY (§15.18.5) | The archive validator can produce an operator adoption statement for the MCP catalog. The function serves manifest and verified Skill text. | PostgreSQL adoption records and candidate Storage distribution with access policies. | PR-19 covers archive distribution, protected download lifetime and hosted agent interoperability. |
| M6 · Capacity and institutional recovery (§15.18.6) | Signed trajectories, replay and local replacement tests. | PostgreSQL backups/PITR, managed logs and metrics. Storage object bytes need a separate backup. | PR-20–22 measure contention, fan-out and cost. Restore Auth mappings, mandates, pseudonym and signing continuity, all CAS, receipts, claims and DIPLOMACY bytes in isolation. |

Use RLS and explicit grants for exposure, and add indexes against measured access patterns. Queues, Cron, GraphQL, search and read replicas remain options for demonstrated operational needs. Keep authority and commit confirmation on the authoritative database. Keep OAuth issuance with Auth, Broadcast with Realtime and deterministic evaluation in the existing kernel.

[Data API grants](https://supabase.com/docs/guides/api/securing-your-api) · [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security) · [OAuth token security](https://supabase.com/docs/guides/auth/oauth-server/token-security) · [Edge limits](https://supabase.com/docs/guides/functions/limits) · [Database Broadcast](https://supabase.com/docs/guides/realtime/broadcast) · [Realtime Authorization](https://supabase.com/docs/guides/realtime/authorization) · [Database backups](https://supabase.com/docs/guides/platform/backups)

## v2 request path

```text
Participant -> Supabase Auth                       identity and OAuth
Participant -> HTTP / MCP -> Edge Functions        verify, evaluate and sign
                              -> PostgreSQL        admission, authority, CAS, commit
                                   -> Realtime     protected committed receipt ID
Listener -> authorized HTTP / MCP receipt lookup   verify, tune and decide locally
```

Supabase Auth authenticates the participant. PostgreSQL enforces institutional authority. The machine signing key attests decisions independently of the issuer signing key. Supabase holds the managed services. Edge requests can run on a fresh worker, and the local HTTP server is optional reference infrastructure.

### PR-10 transaction checkpoint

The additive `radio_v2` migration stores canonical text, validates content hashes in PostgreSQL and assembles the fixed Registry and receipt envelopes around already evaluated bytes. The trusted adapter validates Process Type and I-JSON, supplies signed bytes and their typed projections, and captures every evaluator observation. SQL verifies content addresses and transaction invariants. Each private decision binds the receipt to its principal, client, authority revision and evidence. Successful RUN and once claims are immutable.

- `radio_v2_publish` serializes changes to the Registry pointer. It is idempotent for already published bytes, including retired laws. A null body requests retirement.
- `radio_v2_admit` authorizes submission and result disclosure before recovery. A new admission returns the immutable Registry address, attested time, pseudonym and policy revision. `radio_v2_registry`, `radio_v2_read` and `radio_v2_observe` provide scoped inputs and observations for the adapter.
- `radio_v2_commit` rechecks the same authority and observations, including absent evidence and claims. It returns `committed`, `replayed`, `submission_conflict`, `retry` or an admission/resource failure. The PR-11 adapter maps these internal outcomes to the transport contract. The [SQL integration harness](../test/postgres-v2.integration.mjs) demonstrates the payload binding.

Only the trusted `service_role` can call these RPCs. The private tables have RLS and no participant grants. Operator-owned permission maps default to deny. They store arrays of operation names keyed by the verified OAuth client UUID or the explicit `direct` policy. Receipt resource grants use the receipt address as key. The Edge adapter verifies caller identity, derives the stable HMAC pseudonym and passes the attested context to PostgreSQL. PostgreSQL locks membership and grants during commit. The receipt table preserves the signed bytes and their ID. Historical v1 laws and receipts use the compatibility schema. Admitting historical v1 evidence to v2 requires an explicit materialization decision.

The SQL tests run real PostgreSQL transactions with the frozen evaluator, a test identity fixture and overlapping writers.

### PR-11 ephemeral Publish and Submit

The Publish and Submit function entrypoints accept `LogLine-Version: 2` when `RADIO_ENABLE_V2=true`. Publish accepts raw Process Type JSON. Submit accepts the existing Submission envelope and returns the root-only SubmitResult. A fresh commit returns HTTP 201 and an authorized replay returns 200. Failures return the stable BoundaryFailure shape. The preview has its own `LOGLINE_ENABLE_PREVIEW` flag and v1 dispatch. Provision the machine JWK, pseudonym secret, service key, publishable key and Supabase URL only in the approved environment.

The direct HTTP routes accept verified direct Auth sessions. The adapter validates the bearer against the project's Auth user endpoint and checks subject, issuer, authenticated audience, role, expiry and session ID. Set `RADIO_AUTH_ISSUER` to the exact Auth issuer when it differs from the Supabase URL plus `/auth/v1`. SQL enforces an explicitly admitted direct mandate and current disclosure authority. Delegated OAuth clients use the MCP entrypoint with its own verified resource audience and client mandate. Institutional grants come from PostgreSQL.

The adapter bounds request and RPC response bytes. It uses one full Registry read for entry recognition and narrow snapshot/law reads for continuations. Each invocation allows up to four candidate commits within a 60-second request deadline. Read and commit observations are refreshed after a conflict. The original admission time and Registry stay fixed. An ambiguous response triggers an authorized nonce lookup that waits for the submission lock. Replayed bytes are checked against the request, content hashes and machine signature before disclosure.

The integration harness exercises the Edge entrypoints with real Supabase Edge Runtime, PostgREST and PostgreSQL. It verifies committed bytes against the frozen reference, forces a native once conflict, truncates a committed response, replaces the worker and tests revocation and resource failures. Its Auth endpoint is a fixture. A complete hosted Auth and gateway test remains a separate acceptance gate.

### Execution and scaling

Start with Supabase Edge Functions. They run the staged evaluator and the shared v2 submission adapter. Qualification of an optional dedicated worker pool belongs to [PR-21](../ROADMAP.md#pr-21--kernel-limits-and-contention). It follows the [RUN execution and replacement contract](../SPEC.md#run-execution-and-replacement).

| Deployment choice | Operational use |
| --- | --- |
| Edge Functions | Default for demand-driven capacity. Measure CPU, memory and latency against the declared workload and native limits. |
| Dedicated worker pool | Candidate for sustained load with demonstrated cost savings, or for a measured runtime capacity limit. Size and replace workers independently of Process instances. |

Measure the same workload in both profiles. Break out admission and Registry reads, scanner/RUN and signing, evidence I/O and commit. Include cold and warm requests, contention, retries, tail latency and total cost per committed submission, including idle capacity and operations. Check PostgreSQL saturation separately before moving compute. [Supabase Edge Function limits](https://supabase.com/docs/guides/functions/limits)

Keep the public Submission and MCP resource stable. Route each request to one trusted executor running the same evaluator artifact and submission adapter. Both profiles use the Institution's Supabase Auth configuration, pseudonym binding and machine signing identity, and the same authoritative PostgreSQL admission, evidence and commit RPCs. Reserve any bounded worker cache for verified immutable Process Types and Registry snapshots keyed by hash. Obtain the selected snapshot from admission and resolve current permissions, evidence availability and competing claims through the authoritative boundary.

Qualify a candidate pool in a disposable environment before serving traffic. Run the frozen corpus on the candidate runtime and compare the canonical decision parts and signed receipts with the Edge/reference path for fixed inputs and observations. Against one disposable PostgreSQL ledger, compose a trajectory across both executors and recover an exact receipt after a lost reply on the other executor. Force duplicate submissions and competing RUN or once claims across the two paths. Revoke a grant between evaluation and commit and verify rejection. Repeat from cold workers and throughout a switch back to Edge. Once qualified, shift traffic incrementally and roll back by routing new requests back to Edge. Use the same ledger and trust material throughout.

The local Deno and Supabase Edge Runtime harnesses provide baseline evidence for the shared adapter. The dedicated pool and its traffic routing are a deployment design awaiting implementation and qualification if selected.

### Stateless MCP

The `mcp` function uses `@modelcontextprotocol/server@2.4.0` for Streamable HTTP and MCP 2026-07-28. The SDK's stateless 2025 compatibility path uses the same tools and authority checks. Local tests verified replay after worker replacement. Fixed tool and machine metadata can be cached for 60 seconds. Law catalog, Skill and receipt reads check current authority at request time.

In the MCP client, list the active Process Types, describe a law by hash and read its adopted DIPLOMACY Skills. Use the law's `recognize` and first RUN's `requires` with the Skill's examples. Draft the Contract with the human and ask them to approve the exact tuple before invoking `submit_contract`. LogLine's `who`, `did`, `this` and `with` are a preferred writing convention. The submission accepts any valid I-JSON tuple and derives identity from the OAuth token. Omit `continue` for scanner recognition and pass `continue` explicitly for an existing Process. Supply a fresh base64url nonce for a new submission and reuse it for a retry. A committed receipt with `status: "ok"` and `instance: null` is the first successful RUN of a new Process.

For an approved Supabase project:

1. Apply the v2 migrations and stage the evaluator with `npm run stage:edge`. Configure the native OAuth server, asymmetric signing, approved redirect URLs and the Authorization Path for a static consent UI. The UI authenticates the user and passes their approve or deny decision to the SDK consent methods. Register approved clients dedicated to this MCP resource. For dynamic registration, approve the assigned client ID and configure step 3 before testing consent and token issuance. Self-signup creates an Auth identity. Institutional participation requires a separate authority grant. [Supabase OAuth consent UI](https://supabase.com/library/docs/nextjs/oauth-consent)
2. Set `RADIO_MCP_RESOURCE` to the external `https://<project-ref>.supabase.co/functions/v1/mcp` URL, or its canonical custom-domain URL. Set `RADIO_AUTH_ISSUER` to the actual native Auth issuer. Provision the machine and adapter secrets from the v2 setup. The gateway lets OAuth discovery reach this function, and the function verifies each bearer using the project's JWKS. Give participants an independently trusted machine verification key ring.
3. Set each dedicated client's OAuth audience in the operator-owned `radio_v2.oauth_resources(client, resource)` table and enable the native Custom Access Token Hook `public.radio_v2_oauth_audience`. If the project already uses a hook, compose this assignment there. The token must carry the exact MCP resource in its signed `aud` claim and a native `client_id`. Grant each principal an explicit mandate for that client in `radio_v2.authority`. Read-only clients can receive `read_public`. Submitting also needs `submit` and `disclose`, and formal citations use their own `use_evidence` policy. To revoke a client's institutional access, remove or reduce its mandate.
4. Publish the intended Process Types. To adopt a package for a law already published, run `node bin/diplomacy.mjs PACKAGE.zip --mcp-sql > adoption.sql` after the build and apply the generated statement with the operator role. This validates the ZIP and updates the law's selected DIPLOMACY revision. Each Skill read verifies the exact Markdown bytes against the manifest. Keep the original archive for distribution and recovery.
5. On a disposable hosted project, deploy `mcp` and enable `RADIO_ENABLE_V2=true` and `RADIO_ENABLE_MCP=true`. Install the connector using the exact resource URL in ChatGPT or Claude. Test native authorization code and refresh, correct and wrong resources, and revoked mandates before operational exposure. A generic `aud: authenticated` credential is rejected. Verify that the issuer binds the grant to the intended resource, including an authorization attempt for another resource, before admitting clients.

`npm run test:mcp` uses the same disposable database and PostgREST prerequisites as `test:edge`, plus Deno and ZIP. The official SDK client exercises discovery, adopted Skills, signed receipts, replay and revocation with an asymmetric Auth/JWKS fixture. Hosted native grants, refresh and connector registration require the hosted gate above. [Native OAuth setup](https://supabase.com/docs/guides/auth/oauth-server/getting-started) · [OAuth flows](https://supabase.com/docs/guides/auth/oauth-server/oauth-flows)

### Committed radio signals

The v2 Radio uses the private topic `radio:v2:receipts` and Broadcast event `receipt`. Its payload contains the committed receipt ID as `{"id":"sha256:…"}`. A PostgreSQL trigger inserts one native `realtime.messages` row in the receipt transaction. Insert failure aborts constitution, and rollback removes both rows. The live signal contains only the address, so the frozen receipt size and content fit independently of the Broadcast payload. Supabase owns transport retention and delivery. PostgreSQL remains the source for receipt retrieval and the PR-15 history contract. [Broadcast from the database](https://supabase.com/docs/guides/realtime/broadcast#broadcast-from-the-database)

Use the ordinary API `GET /functions/v1/receipt?id=<receipt-id>` with `LogLine-Version: 2` and the current direct Auth credential, or MCP `read_receipt` with its admitted OAuth credential. Both read the same `{receipt}` under current `read_public` authority. A failed read leaves the signal unresolved. Private evidence uses its separate permission.

Subscribe with the Supabase SDK and `config: {private: true}`. For each signal, use the announced ID in an authorized read. Verify that the returned ID matches and verify the signature with `authenticV2(receipt, pinnedKeys)`. Use `tuned(tuning, receipt.header)` on the verified header. Resolve `by: "me"` to your attested pseudonym before tuning. The client owns deduplication by verified ID, credential refresh and the decision to submit a new Contract.

```js
import { authenticV2, HASH_RE, tuned } from "@logline/receipt";

const channel = supabase.channel("radio:v2:receipts", {config:{private:true}});
channel.on("broadcast", {event:"receipt"}, async ({payload}) => {
  const id = payload?.id;
  if (typeof id !== "string" || !HASH_RE.test(id)) return;
  try {
    const {receipt} = await readReceipt(id);
    if (receipt.id !== id || !await authenticV2(receipt, pinnedKeys)) return;
    if (tuned(tuning, receipt.header) && !seen.has(id)) {
      seen.add(id);
      await onReceipt(receipt);
    }
  } catch (error) {
    onError(error);
  }
}).subscribe();
```

Supply the signed-in Supabase client, the authorized HTTP or MCP `readReceipt` function, independently pinned keys, and local `tuning`, `seen` and handlers in your application. Each listener resolves announcements independently. Include that read load when measuring fan-out in PR-21.

Local native Realtime tests covered the committed signal and authorized lookup, two listeners, rollback, denied send/join, token renewal and expiry after revocation. PR-15 still needs authorized durable history with closed-window cursors, and PR-16 needs a maintained v2 client with catch-up. [Local verification](#local-verification) · [Radio milestones](../ROADMAP.md#m4--the-radio)

The migration leaves the channel disabled. Qualify it on a disposable project before activating it. Disable Realtime public channel access and configure native Auth to issue direct-session access tokens of at most 300 seconds. The join policy checks the verified issuer, subject, direct session, anonymous flag, token lifetime and current `read_public` authority. Realtime must stop delivery at token expiry and recheck the policy for an in-band token update. Test both a non-cooperating listener that holds its old token and one that attempts to renew after revocation. Include two authorized listeners, an unauthorized listener, a rolled-back commit, and verification and current-authority lookup of the returned object. The activation row carries the exact issuer, matching `RADIO_AUTH_ISSUER`.

```sql
insert into radio_v2.broadcast_settings (issuer)
values ('https://<project-ref>.supabase.co/auth/v1');
```

In an approved deployment, stage the evaluator and deploy the v2-only `receipt` Edge Function with its existing v2 environment. The activation row enables the channel and signal emission. Remove it to stop new signals and admissions. The protected profile currently uses direct Auth sessions for Realtime. MCP OAuth clients can resolve receipt IDs through MCP under their own admitted mandate. [Realtime Authorization](https://supabase.com/docs/guides/realtime/authorization)

`npm run test:realtime` extends the Edge integration with native WebSocket delivery and revocation. Supply `RADIO_TEST_REALTIME_URL` for a disposable loopback Realtime server connected to the same local database and `RADIO_TEST_REALTIME_JWT_SECRET` for its test signing key. Use the actual Realtime migrations for this run. Stock PostgreSQL uses the separate fixture below to check transactional enqueue and RLS.

## Preserved v1 hosted preview

The original migration and functions remain the v1 preview. The optional HTTP server is a local executable reference. The preview is kept for regression testing.

### v1 transaction boundary

`submitRoot` is a request-scoped adapter, not a new evaluator. It looks up the immutable law, obtains spent citations, calls the existing `issue`, then requests one atomic SQL commit. The commit either returns the new receipt ID, returns a previous ID for the same cache key, or requests re-evaluation after a once/publication conflict. A failed once claim rolls back the receipt, both CAS objects, the cache key, owner link and outbox event together. Only an acknowledged commit is returned. At most eight attempts per invocation, with a retryable 503 on contention.

`0001_radio.sql` stores canonical JSON as text so PostgreSQL JSONB's restrictions on characters such as U+0000 do not narrow the free tuple format. CAS objects have no owner field: access comes through the private receipt association, so identical bytes can belong to multiple users. The Realtime table has only public data and no account identifier. Clients cannot call the write RPCs. `service_role` is the trusted writer; the SQL does not reproduce process rules or verify the machine signature. The machine key holder can forge decisions; Postgres administrators can alter the database. There is no Merkle anchor yet.

`submit` and `publish` are Edge Function entrypoints. Requests use Supabase Auth's `/auth/v1/user` endpoint for bearer validation, `app_metadata.logline_admin === true` for publication and HMAC of the verified user UUID for `by`. No client claim in a tuple controls the receipt identity. The public CAS and receipt tables and private access policy are defined in the migration. Realtime publication is configured for receipt inserts; clients parse the canonical receipt string and verify signatures.

### Limits of the v1 preview

- Root-only `submit` preview returns `{receipt, detail, replayed}`; unlike the local response it has **no** synchronous reactions. The entrypoints refuse to start unless `LOGLINE_ENABLE_PREVIEW=true`. There is no deployed route or production contract change for hosted choreography.
- The outbox is durable but there is no dispatcher or `react` worker yet. The pair uniqueness constraint is reserved. The target design puts community reactions outside the machine (SPEC §15). Reassess whether the outbox and pair uniqueness remain necessary; do not implement a community reaction worker by default. Any retained internal reactions require a specified response shape, publication snapshot, ordering, halt reporting and atomic budget.
- The v1 preview has account-level access and no delegated client mandates. It has no v1 MCP, history, bundle or key discovery route. The internal citation adapter accepts a trusted store. A client-supplied citation bundle is outside the v1 wire interface.
- The existing evaluator allows laws to read cited details and broadcast selected fields. Admins must review laws for disclosure; RLS prevents direct private-object access but does not itself constrain semantic disclosure by a published law. JWT-based RLS admin claims can remain valid until refresh; Auth user lookup for publication uses current account metadata. Key rotation and revocation policy remain open.

## Cloud delivery contract

The minimal local config uses the CLI 3.x config.jsonc format and PostgreSQL 17, with implicit Data API grants disabled locally. The migrations declare explicit grants and RLS. Remote configuration is not pushed by this pipeline. No secret is included in a package.

CI runs on GitHub-hosted runners. It uses a pinned PostgreSQL 17 service image; the test-only Auth fixture is never packaged for deploy. The database test performs CLI dry-run, migration application, migration listing, real transaction/RLS tests and a second idempotent push. The test job cannot target a remote database. The kernel job packages only tracked Supabase sources plus the compiled tested core; the artifact contains the commit, manifest and archive digest. Both jobs must pass for staging.

For a future approved staging project, configure GitHub's staging environment, restricted to main with required reviewers, and configure both CI jobs as required checks on main. Keep environment-scoped variables SUPABASE_PROJECT_REF and SUPABASE_PUBLISHABLE_KEY, and secrets SUPABASE_ACCESS_TOKEN (least privilege for the staging project) and SUPABASE_DB_PASSWORD. Leave RADIO_STAGING_DEPLOY_APPROVED unset until M3 approves the hosted contract and explicitly authorizes writes. Provision the machine signing key and pseudonym secret separately; never use test keys or set LOGLINE_ENABLE_PREVIEW automatically.

Dispatch RADIO Staging on main with mode plan, the exact staging project ref and the exact commit SHA. Review the migration plan. Dispatch apply only after approval, with the same commit/ref and the enabled staging gate. The workflow re-runs both CI jobs and verifies the package from that run. Apply pushes migrations and deploys `submit` and `publish`. Its smoke checks a v1 public read and unauthenticated rejection. Deploy `receipt` and `mcp`, configure Auth and secrets, and activate v2 features through their approved setup steps above. If apply fails partway, inspect database and function state and reconcile forward under review. [Staging workflow](../.github/workflows/staging.yml) · [Deployment script](../scripts/deploy-staging.sh)

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
psql "$LOCAL_TEST_DB" -X -v ON_ERROR_STOP=1 \
  -f test/postgres-auth-fixture.sql -f test/postgres-realtime-fixture.sql
psql "$LOCAL_TEST_DB" -X -v ON_ERROR_STOP=1 -1 \
  -f supabase/migrations/0001_radio.sql \
  -f supabase/migrations/20261126062956_radio_v2_transactions.sql \
  -f supabase/migrations/20261126064700_radio_v2_edge_inputs.sql \
  -f supabase/migrations/20261126103336_radio_v2_mcp.sql \
  -f supabase/migrations/20261126122327_radio_v2_realtime.sql
LOGLINE_DISPOSABLE_DB=yes LOGLINE_TEST_DATABASE_URL="$LOCAL_TEST_DB" npm run test:postgres
```

The PostgreSQL tests force both once contenders to reach commit with the same unspent observation, verify retry and rollback, and check that CAS collisions and rejected publication leave no orphan bytes. In stock PostgreSQL, the test fixtures supply Auth claim accessors and the Realtime message table. This verifies SQL grants, policies and atomic enqueuing. Use the Edge, MCP and Realtime harnesses below for runtime and socket behavior. Test data persists in the disposable database. The CI path also applies the migrations through the pinned Supabase CLI and checks migration history.

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
