#!/usr/bin/env bash
# Manage who may sign in to the sync server. Edits the D1 allowlist table directly.
#   scripts/server/allow.sh add <email>   allow an email
#   scripts/server/allow.sh rm <email>    remove it (its session stops working immediately)
#   scripts/server/allow.sh ls            list
# Add --local to act on the local `wrangler dev` database instead of production.
set -euo pipefail
cd "$(dirname "$0")/../.."

where=--remote
args=()
for a in "$@"; do [[ "$a" == --local ]] && where=--local || args+=("$a"); done
cmd="${args[0]:-}"
email="$(echo "${args[1]:-}" | tr '[:upper:]' '[:lower:]')"

sql() { npx wrangler d1 execute suckless-kanji "$where" --command "$1" "${@:2}"; }
check_email() {
  [[ "$email" =~ ^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$ ]] || { echo "not an email: '$email'" >&2; exit 1; }
}

case "$cmd" in
  add) check_email; sql "INSERT OR IGNORE INTO allowlist (email) VALUES ('$email')"; echo "allowed $email" ;;
  rm)  check_email; sql "DELETE FROM allowlist WHERE email = '$email'"; echo "removed $email" ;;
  ls)  sql "SELECT email FROM allowlist ORDER BY email" ;;
  *)   sed -n '2,7p' "$0"; exit 1 ;;
esac
