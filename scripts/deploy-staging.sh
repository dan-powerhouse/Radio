#!/usr/bin/env bash
# Staging ONLY. No project selection, credential creation or secret mutation.
set -euo pipefail
mode="${1:-}"
package="${2:-release}"
case "$mode" in plan|apply) ;; *) echo "Expected plan or apply" >&2; exit 2;; esac
[[ "${GITHUB_REF:-}" == refs/heads/main ]] || { echo "Staging requires main" >&2; exit 2; }
[[ "${RADIO_STAGING_PROJECT_REF:-}" =~ ^[a-z]{20}$ ]] || { echo "Configure the approved staging project ref" >&2; exit 2; }
[[ "${RADIO_CONFIRM_PROJECT:-}" == "$RADIO_STAGING_PROJECT_REF" ]] || { echo "Explicit project confirmation mismatch" >&2; exit 2; }
[[ "${GITHUB_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || { echo "Missing commit identity" >&2; exit 2; }
[[ "${RADIO_CONFIRM_COMMIT:-}" == "$GITHUB_SHA" ]] || { echo "Explicit commit confirmation mismatch" >&2; exit 2; }
if [[ "$mode" == apply ]]; then
  [[ "${RADIO_STAGING_DEPLOY_APPROVED:-}" == true ]] || { echo "Staging writes are not approved (M3 gate)" >&2; exit 2; }
  : "${RADIO_STAGING_PUBLISHABLE_KEY:?Configure staging public API key for smoke test}"
fi
: "${SUPABASE_ACCESS_TOKEN:?Configure scoped staging CLI access token}"
: "${SUPABASE_DB_PASSWORD:?Configure staging database password}"
cli_path="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/node_modules/.bin/supabase"
package="$(cd "$package" && pwd)"
(cd "$package" && sha256sum -c radio-supabase.tar.gz.sha256)
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
tar -xzf "$package/radio-supabase.tar.gz" -C "$work"
cd "$work"
[[ "$(cat COMMIT)" == "$GITHUB_SHA" ]] || { echo "Artifact does not match tested commit" >&2; exit 2; }
find supabase -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum > manifest.actual
cmp -s SHA256SUMS manifest.actual || { echo "Artifact file manifest mismatch" >&2; exit 2; }
rm manifest.actual
sha256sum -c SHA256SUMS >/dev/null
cli() { "$cli_path" "$@"; }
target="--remote=$RADIO_STAGING_PROJECT_REF"
cli migration list "$target"
cli db push "$target" --dry-run --skip-vault
if [[ "$mode" == plan ]]; then
  echo "Plan only. No migration or function deployment requested."
  exit 0
fi
# Apply requires the explicit staging gate and revision/project confirmation. Review the plan before dispatching apply. Never force migration history or prune functions.
cli db push "$target" --skip-vault --yes
cli functions deploy submit publish receipt history mcp diplomacy "$target" --use-api --yes
cli migration list "$target"
# The packaged functions can be staged with their feature flags closed.
# No authenticated writes; failure after deployment is reported, not rolled back.
base="https://$RADIO_STAGING_PROJECT_REF.supabase.co"
for function in submit publish receipt history mcp diplomacy; do
  request=()
  if [[ "$function" != receipt && "$function" != diplomacy ]]; then request=(--data '{}'); fi
  status="$(curl --silent --show-error --max-time 30 -o smoke.json -w '%{http_code}' \
    -H 'Content-Type: application/json' -H 'LogLine-Version: 2' -H "apikey: $RADIO_STAGING_PUBLISHABLE_KEY" \
    "${request[@]}" "$base/functions/v1/$function")"
  if [[ "$status" == 503 ]] && node -e 'process.exit(JSON.parse(require("fs").readFileSync("smoke.json")).error === "unavailable" ? 0 : 1)'; then continue; fi
  [[ "$status" == 401 ]] || { echo "Unauthenticated $function expected 401 or disabled response, got $status" >&2; exit 1; }
done
echo "Staging transport smoke passed for $GITHUB_SHA; hosted integration gates remain separate."
