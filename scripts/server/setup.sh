#!/usr/bin/env bash
# One-time production setup of the Cloudflare Worker. Run after `npx wrangler login`.
# Idempotent: creates the D1 database (and records its id in wrangler.toml) only once.
# Afterwards, set the Google client secret: npx wrangler secret put GOOGLE_CLIENT_SECRET
set -euo pipefail
cd "$(dirname "$0")/../.."

PLACEHOLDER=00000000-0000-0000-0000-000000000000
if grep -q "$PLACEHOLDER" wrangler.toml; then
  out=$(npx wrangler d1 create suckless-kanji 2>&1) || { echo "$out" >&2; exit 1; }
  id=$(echo "$out" | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)
  [[ -n "$id" ]] || { echo "could not find the database id in:" >&2; echo "$out" >&2; exit 1; }
  sed -i "s/$PLACEHOLDER/$id/" wrangler.toml
  echo "created D1 database $id (commit wrangler.toml)"
fi

npx wrangler d1 migrations apply suckless-kanji --remote
npx wrangler deploy

# Session signing key: random, never stored anywhere but Cloudflare.
if ! npx wrangler secret list 2>/dev/null | grep -q SESSION_SECRET; then
  head -c 32 /dev/urandom | base64 | tr -d '\n' | npx wrangler secret put SESSION_SECRET
fi
echo "done. Remaining: npx wrangler secret put GOOGLE_CLIENT_SECRET; scripts/server/allow.sh add <email>"
