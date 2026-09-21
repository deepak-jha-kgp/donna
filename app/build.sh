#!/usr/bin/env bash
# Rebuild the app and publish its output as the bundle's app source.
#
# `apps/cos-app/source/` is a **prebuilt static site**, not a Vite project, and
# that is the whole reason a fresh pod is set up in seconds. The CLI picks an app
# tier by what it finds there: a `package.json` means "Vite" — npm install, npm
# build, and three required VITE_LEMMA_* env vars, none of which a fresh pod has.
# An `index.html` with no `package.json` means "static": uploaded as-is, no build,
# no env. The bundle ships the second one.
#
# Nothing pod-specific may be baked in. The host injects window.__LEMMA_CONFIG__
# at serve time, so the same bytes serve any pod on any server — but Vite inlines
# `import.meta.env.*` at build time from BOTH the process environment and any
# .env file on disk. `lemma pods export` carries `.env.local` out of a pod's app
# source, so that file arrives holding the pod id it was exported from. Hence the
# two defences below: the env files are moved aside for the build, and the output
# is refused if a uuid or an internal host survived anyway.
set -euo pipefail
cd "$(dirname "$0")"
OUT="../apps/cos-app/source"

STASH="$(mktemp -d)"
restore() { for f in "$STASH"/.env*; do [ -e "$f" ] && mv "$f" ./; done 2>/dev/null || true; rmdir "$STASH" 2>/dev/null || true; }
trap restore EXIT
for f in .env .env.local .env.production .env.production.local; do
  [ -e "$f" ] && mv "$f" "$STASH/"
done

[ -d node_modules ] || npm ci
env -u VITE_LEMMA_API_URL -u VITE_LEMMA_AUTH_URL -u VITE_LEMMA_POD_ID \
    -u VITE_LEMMA_APP_NAME -u VITE_LEMMA_APP_BASE_PATH \
    npm run build

rm -rf "$OUT"; mkdir -p "$OUT"
cp -R dist/. "$OUT"/

if grep -rqE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|asur\.work' "$OUT"; then
  echo "refusing: the build output contains a uuid or an internal host" >&2
  rm -rf "$OUT"
  exit 1
fi
echo "wrote $OUT"
