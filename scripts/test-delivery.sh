#!/usr/bin/env bash
# Verify artifact packaging and fail-closed deploy guards without cloud credentials.
set -euo pipefail
root="$(git rev-parse --show-toplevel)"
cd "$root"
for script in scripts/{package-deploy,deploy-staging,test-postgres-ci,test-delivery}.sh; do bash -n "$script"; done
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
sha="$(git rev-parse HEAD)"
(cd release && sha256sum -c radio-supabase.tar.gz.sha256)
tar -xzf release/radio-supabase.tar.gz -C "$work"
[[ "$(cat "$work/COMMIT")" == "$sha" ]]
(cd "$work" && sha256sum -c SHA256SUMS >/dev/null)
test -f "$work/supabase/functions/_shared/core/index.js"
diff -r --exclude='*.d.ts' --exclude=browser.js dist "$work/supabase/functions/_shared/core"
test ! -e "$work/supabase/.temp"
test ! -e "$work/vectors/test-key.json"
test ! -e "$work/test"
# A stub aborts if any Supabase CLI command is invoked. These cases must
# reject before network access. No real credential is used.
mkdir -p "$work/guard/scripts" "$work/guard/node_modules/.bin"
cp scripts/deploy-staging.sh "$work/guard/scripts/"
printf '#!/bin/bash\necho "UNEXPECTED CLI INVOCATION" >&2\nexit 97\n' > "$work/guard/node_modules/.bin/supabase"
chmod +x "$work/guard/node_modules/.bin/supabase"
export GITHUB_REF=refs/heads/main GITHUB_SHA="$sha"
export RADIO_STAGING_PROJECT_REF=abcdefghijklmnopqrst RADIO_CONFIRM_PROJECT=abcdefghijklmnopqrst RADIO_CONFIRM_COMMIT="$sha"
export RADIO_STAGING_DEPLOY_APPROVED=false RADIO_STAGING_PUBLISHABLE_KEY=fixture SUPABASE_ACCESS_TOKEN=fixture SUPABASE_DB_PASSWORD=fixture
reject() {
  local expected="$1"; shift
  local output rc=0
  output="$("$@" 2>&1)" || rc=$?
  [[ "$rc" != 0 && "$output" == *"$expected"* && "$output" != *"UNEXPECTED CLI INVOCATION"* ]] || { printf '%s\n' "$output" >&2; exit 1; }
  printf 'Rejected: %s\n' "$expected"
}
reject "requires main" env GITHUB_REF=refs/heads/other bash "$work/guard/scripts/deploy-staging.sh" plan release
reject "project confirmation mismatch" env RADIO_CONFIRM_PROJECT=wrong bash "$work/guard/scripts/deploy-staging.sh" plan release
reject "commit confirmation mismatch" env RADIO_CONFIRM_COMMIT=wrong bash "$work/guard/scripts/deploy-staging.sh" plan release
reject "not approved" bash "$work/guard/scripts/deploy-staging.sh" apply release
reject "Configure scoped staging CLI access token" env SUPABASE_ACCESS_TOKEN= bash "$work/guard/scripts/deploy-staging.sh" plan release
reject "Only a disposable local" env LOGLINE_DISPOSABLE_DB=yes LOGLINE_TEST_DATABASE_URL=postgresql://user:fixture@example.invalid/radio_ci bash scripts/test-postgres-ci.sh
# Accidental corruption must fail at the outer digest; a repacked archive with
# unchanged inner evidence must fail at the manifest or commit check. These
# are integrity checks inside the trusted CI artifact channel, not signatures.
mkdir "$work/corrupt"
cp release/radio-supabase.tar.gz "$work/corrupt/"
printf 'altered\n' >> "$work/corrupt/radio-supabase.tar.gz"
cp release/radio-supabase.tar.gz.sha256 "$work/corrupt/"
reject "FAILED" bash "$work/guard/scripts/deploy-staging.sh" plan "$work/corrupt"
# Repack valid gzip with a changed inner file and new outer digest.
mkdir "$work/repack"
tar -xzf release/radio-supabase.tar.gz -C "$work/repack"
printf 'modified\n' >> "$work/repack/supabase/functions/_shared/core/index.js"
tar -czf "$work/corrupt/radio-supabase.tar.gz" -C "$work/repack" COMMIT SHA256SUMS supabase
(cd "$work/corrupt" && sha256sum radio-supabase.tar.gz > radio-supabase.tar.gz.sha256)
reject "Artifact file manifest mismatch" bash "$work/guard/scripts/deploy-staging.sh" plan "$work/corrupt"
printf '%040d\n' 0 > "$work/repack/COMMIT"
tar -czf "$work/corrupt/radio-supabase.tar.gz" -C "$work/repack" COMMIT SHA256SUMS supabase
(cd "$work/corrupt" && sha256sum radio-supabase.tar.gz > radio-supabase.tar.gz.sha256)
reject "Artifact does not match tested commit" bash "$work/guard/scripts/deploy-staging.sh" plan "$work/corrupt"
printf 'Delivery package and nine negative guards passed.\n'
