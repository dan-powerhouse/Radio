#!/usr/bin/env bash
# Fresh disposable PostgreSQL service only. Never use an existing hosted DB.
set -euo pipefail
: "${LOGLINE_TEST_DATABASE_URL:?Missing disposable test database URL}"
[[ "${LOGLINE_DISPOSABLE_DB:-}" == yes ]] || exit 2
# Reject all targets other than loopback and the fixed CI database name.
node --input-type=module <<'JS'
const u = new URL(process.env.LOGLINE_TEST_DATABASE_URL);
if (!['postgres:', 'postgresql:'].includes(u.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname) || u.pathname !== '/radio_ci' || u.search || u.hash)
  throw Error('Only a disposable local radio_ci database may be initialized');
JS
psql "$LOGLINE_TEST_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f test/postgres-auth-fixture.sql
cli() { ./node_modules/.bin/supabase "$@"; }
cli db push --remote="$LOGLINE_TEST_DATABASE_URL" --dry-run --skip-vault
cli db push --remote="$LOGLINE_TEST_DATABASE_URL" --skip-vault --yes
cli migration list --remote="$LOGLINE_TEST_DATABASE_URL"
npm run test:postgres
# Running push again must be a no-op.
cli db push --remote="$LOGLINE_TEST_DATABASE_URL" --skip-vault --yes
