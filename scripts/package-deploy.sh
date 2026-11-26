#!/usr/bin/env bash
# Package exactly the tracked Supabase sources and the compiled core tested by CI.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
git diff --exit-code HEAD -- .
sha="$(git rev-parse HEAD)"
test -f dist/index.js
# Do not rebuild here: CI already built and tested these bytes.
node scripts/stage-edge.mjs
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
git archive HEAD supabase/config.jsonc supabase/migrations supabase/functions supabase/consent supabase/README.md | tar -xf - -C "$work"
mkdir -p "$work/supabase/functions/_shared/core"
cp -a supabase/functions/_shared/core/. "$work/supabase/functions/_shared/core/"
diff -r --exclude='*.d.ts' --exclude=browser.js dist "$work/supabase/functions/_shared/core"
printf '%s\n' "$sha" > "$work/COMMIT"
(
  cd "$work"
  find supabase -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum > SHA256SUMS
  sha256sum -c SHA256SUMS >/dev/null
)
mkdir -p release
tar --sort=name --mtime=@0 --owner=0 --group=0 --numeric-owner -C "$work" -cf - COMMIT SHA256SUMS supabase | gzip -n > release/radio-supabase.tar.gz
(cd release && sha256sum radio-supabase.tar.gz > radio-supabase.tar.gz.sha256)
echo "Packaged commit $sha"
