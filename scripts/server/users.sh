#!/usr/bin/env bash
# Sync accounts administration (D1). Add --local to use the `wrangler dev` database.
#   users.sh stats                     accounts, stored data, database size
#   users.sh ls                        accounts by stored bytes (largest first)
#   users.sh block|unblock <email>     refuse / restore sync for an account
#   users.sh quota <email> <MB|default>  per-account storage quota
#   users.sh allow|disallow <email>    allowlist (only used when SIGNUP_MODE = "allowlist")
#   users.sh allowed                   list the allowlist
set -euo pipefail
cd "$(dirname "$0")/../.."

where=--remote
args=()
for a in "$@"; do [[ "$a" == --local ]] && where=--local || args+=("$a"); done
cmd="${args[0]:-}"
email="$(echo "${args[1]:-}" | tr '[:upper:]' '[:lower:]')"

sql() { npx wrangler d1 execute suckless-kanji "$where" --command "$1"; }
check_email() {
  [[ "$email" =~ ^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$ ]] || { echo "not an email: '$email'" >&2; exit 1; }
}

case "$cmd" in
  stats)
    sql "SELECT COUNT(*) AS accounts, SUM(blocked) AS blocked, ROUND(SUM(bytes) / 1e6, 2) AS stored_mb,
           (SELECT COUNT(*) FROM events) AS events FROM users"
    [[ "$where" == --remote ]] && npx wrangler d1 info suckless-kanji | grep -iE "size|tables" || true ;;
  ls)
    sql "SELECT email, ROUND(bytes / 1e6, 2) AS mb, ROUND(quota / 1e6) AS quota_mb, blocked, generation,
           date(created / 1000, 'unixepoch') AS since FROM users ORDER BY bytes DESC" ;;
  block)   check_email; sql "UPDATE users SET blocked = 1 WHERE email = '$email'"; echo "blocked $email" ;;
  unblock) check_email; sql "UPDATE users SET blocked = 0 WHERE email = '$email'"; echo "unblocked $email" ;;
  quota)
    check_email
    mb="${args[2]:-}"
    if [[ "$mb" == default ]]; then sql "UPDATE users SET quota = NULL WHERE email = '$email'"
    elif [[ "$mb" =~ ^[0-9]+$ ]]; then sql "UPDATE users SET quota = $((mb * 1000000)) WHERE email = '$email'"
    else echo "usage: users.sh quota <email> <MB|default>" >&2; exit 1; fi
    echo "quota for $email: $mb" ;;
  allow)    check_email; sql "INSERT OR IGNORE INTO allowlist (email) VALUES ('$email')"; echo "allowed $email" ;;
  disallow) check_email; sql "DELETE FROM allowlist WHERE email = '$email'"; echo "removed $email from the allowlist" ;;
  allowed)  sql "SELECT email FROM allowlist ORDER BY email" ;;
  *) sed -n '2,9p' "$0"; exit 1 ;;
esac
