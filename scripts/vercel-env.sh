#!/bin/sh
# Copies the seven production variables from this Mac's .env.local to the clipboard, as NAME=value lines, so they can be
# pasted into Vercel (Project → Settings → Environment Variables → paste into the first Key field: Vercel splits a
# pasted .env block into rows). Prints the names only; the values never reach the terminal, a log or a repo.
# Development-only variables (TEAMS_DEV_LOGIN, NOTION_TOKEN_FILE, NOTION_*_DATA_SOURCE, PGLITE_DIR) are left out.
set -eu
cd "$(dirname "$0")/.."
[ -f .env.local ] || { echo "no .env.local here"; exit 1; }
NAMES="DATABASE_URL DATABASE_URL_UNPOOLED NEON_BRANCH NEON_AUTH_BASE_URL NEON_AUTH_JWKS_URL NEON_AUTH_COOKIE_SECRET TEAMS_ENCRYPTION_KEY"
out=""
missing=""
for n in $NAMES; do
  line=$(grep -E "^${n}=" .env.local | tail -1 || true)
  v=${line#*=}
  # Values in .env.local may be quoted ("postgresql://..."); Vercel would keep the quotes as part of the value.
  v=$(printf '%s' "$v" | sed -E "s/^[\"'](.*)[\"']$/\1/")
  line="${n}=${v}"
  if [ -z "$line" ] || [ -z "$v" ]; then missing="$missing $n"; continue; fi
  out="${out}${line}
"
done
printf "%s" "$out" | pbcopy
echo "Copied to the clipboard:"
for n in $NAMES; do case " $missing " in *" $n "*) echo "  MISSING  $n";; *) echo "  ok       $n";; esac; done
[ -z "$missing" ] || { echo "Fill the missing ones in .env.local first."; exit 1; }
