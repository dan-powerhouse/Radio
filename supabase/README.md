# Supabase-native LogLine — hosted preview

**Preview, not a deployment.** Supabase is the primary hosted architecture. The optional HTTP server remains a local executable reference, not a hosted dependency. The original SQL draft was reported as never applied; the current migration replaced that draft in place. No remote project is selected or modified. Do not deploy the preview as a production substitute.

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

## Contract boundaries not yet approved

- Root-only `submit` preview returns `{receipt, detail, replayed}`; unlike the local response it has **no** synchronous reactions. The entrypoints refuse to start unless `LOGLINE_ENABLE_PREVIEW=true`. There is no deployed route or production contract change for hosted choreography.
- The outbox is durable but there is no dispatcher or `react` worker yet. The pair uniqueness constraint is reserved. The target design puts community reactions outside the machine (SPEC §15). Reassess whether the outbox and pair uniqueness remain necessary; do not implement a community reaction worker by default. Any retained internal reactions require a specified response shape, publication snapshot, ordering, halt reporting and atomic budget.
- Sequence allocation is not transaction commit ordering. A hosted `seq > cursor` history/reconnect contract cannot be promised until this is solved. No hosted history or bundle API, key discovery gateway, MCP endpoint, rate limiter, applied OAuth authorization-server configuration, client-supplied citation bundle wire format or anchoring is provided here. Client-supplied citations must not bypass authoritative consumption or existence checks. The internal adapter can accept a trusted citation store, not untrusted wire input.
- The existing evaluator allows laws to read cited details and broadcast selected fields. Admins must review laws for disclosure; RLS prevents direct private-object access but does not itself constrain semantic disclosure by a published law. JWT-based RLS admin claims can remain valid until refresh; Auth user lookup for publication uses current account metadata. Key rotation and revocation policy remain open.

## Local verification

```sh
npm run build
npm run test:node
npm run stage:edge
```

`stage:edge` copies the compiled runtime-neutral core into `_shared/core`. Generated code is ignored in git; there is only one evaluator source. The `hosted.test.mjs` test double tests actual evaluator and adapter behavior but is NOT proof of SQL concurrency, RLS, PostgREST or Deno runtime compatibility.

For a **disposable local Supabase database only**, after applying the migration using the local tooling, run:

```sh
LOGLINE_DISPOSABLE_DB=yes LOGLINE_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npm run test:postgres
```

This integration runner makes real concurrent psql requests, creates an isolated randomly named test law and checks RLS and transactional invariants. Test data persists; use a throwaway DB. This runner was syntax-checked but not executed in the provided environment (no psql, Postgres or Supabase CLI). It is not a full Supabase end-to-end test.

For a future approved local Edge test, set secrets using local tooling: `LOGLINE_ENABLE_PREVIEW=true`, `LOGLINE_MACHINE_JWK` (private Ed25519 JWK), `LOGLINE_PSEUDONYM_SECRET` (at least 32 random bytes in unpadded base64url), `SUPABASE_URL`, a service key (`LOGLINE_SERVICE_KEY` or `SUPABASE_SERVICE_ROLE_KEY`), and a publishable key (`LOGLINE_PUBLISHABLE_KEY` or `SUPABASE_ANON_KEY`). Never use the vector test key. If testing anonymous calls or modern signing keys, the gateway's legacy JWT check must be disabled for those functions and the function's own bearer validation retained. No project-specific config or secrets are included. Check platform limits and plan availability before deployment.

`test/direct.test.mjs` exercises the direct client against the real request handler and evaluator using a transport/database double. It does not establish real OAuth, RLS or gateway behavior.
