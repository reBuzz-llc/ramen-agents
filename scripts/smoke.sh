#!/bin/sh
# Smoke check for a new setup (SETUP.md): the env file, the migrations, then the app started once and asked two
# questions: does the database answer (/api/health), and does the sign-in page load. It prints names, never values.
#
#   sh scripts/smoke.sh              # uses port 3105, so it does not clash with `npm run dev` on 3100
#   PORT=3200 sh scripts/smoke.sh
set -u
cd "$(dirname "$0")/.."
PORT=${PORT:-3105}
fail=0
ok() { echo "  ok       $1"; }
warn() { echo "  note     $1"; }
bad() { echo "  MISSING  $1"; fail=1; }

echo "Node and packages"
major=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
[ "$major" -ge 20 ] && ok "node $(node -v)" || bad "Node 20 or newer (found: $(node -v 2>/dev/null || echo none))"
[ -d node_modules ] || { echo "  installing packages (npm install)…"; npm install --silent >/dev/null 2>&1 || bad "npm install failed: run it yourself to see why"; }
[ "$fail" = 0 ] || exit 1

echo "Env file (.env.local)"
[ -f .env.local ] || { bad ".env.local: cp .env.example .env.local, then follow SETUP.md step 2"; exit 1; }
val() { grep -E "^$1=" .env.local | tail -1 | cut -d= -f2- | sed -E "s/^[\"'](.*)[\"']$/\1/"; }
[ -n "$(val TEAMS_ENCRYPTION_KEY)" ] && ok TEAMS_ENCRYPTION_KEY || bad "TEAMS_ENCRYPTION_KEY (openssl rand -base64 32)"
if [ -n "$(val DATABASE_URL)" ]; then
  ok DATABASE_URL
  [ -n "$(val DATABASE_URL_UNPOOLED)" ] && ok DATABASE_URL_UNPOOLED || warn "DATABASE_URL_UNPOOLED empty: migrations use DATABASE_URL (Neon's direct URL is better)"
else
  warn "DATABASE_URL empty: a local PGlite database in .data/ (fine for trying it out, not for a team)"
fi
if [ -n "$(val NEON_AUTH_BASE_URL)" ]; then
  ok NEON_AUTH_BASE_URL
  [ -n "$(val NEON_AUTH_JWKS_URL)" ] && ok NEON_AUTH_JWKS_URL || bad "NEON_AUTH_JWKS_URL (neon env pull)"
  [ -n "$(val NEON_AUTH_COOKIE_SECRET)" ] && ok NEON_AUTH_COOKIE_SECRET || bad "NEON_AUTH_COOKIE_SECRET (openssl rand -base64 32)"
elif [ "$(val TEAMS_DEV_LOGIN)" = "1" ]; then
  warn "no Neon Auth: only the development sign-in on this machine (TEAMS_DEV_LOGIN=1)"
else
  bad "NEON_AUTH_BASE_URL (neon deploy, then neon env pull), or TEAMS_DEV_LOGIN=1 to try it without sign-in"
fi
[ -n "$(val NEXT_PUBLIC_APP_URL)" ] && ok NEXT_PUBLIC_APP_URL || warn "NEXT_PUBLIC_APP_URL empty: invites link to a placeholder address until you set it"
[ "$fail" = 0 ] || exit 1

echo "Migrations"
npm run --silent migrate || { echo "  FAILED   migrations: see the message above"; exit 1; }

echo "The app (port $PORT)"
log=$(mktemp -t peek-smoke) || exit 1
npx next dev -p "$PORT" >"$log" 2>&1 &
pid=$!
trap 'kill $pid 2>/dev/null; wait $pid 2>/dev/null; rm -f "$log"' EXIT INT TERM
health=""
i=0
while [ $i -lt 90 ]; do
  health=$(curl -s -m 30 -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/api/health" 2>/dev/null)
  [ "$health" = 200 ] && break
  kill -0 $pid 2>/dev/null || break
  sleep 2; i=$((i + 1))
done
if [ "$health" = 200 ]; then ok "/api/health: the database answers"; else echo "  FAILED   /api/health ($health); the app's last lines:"; tail -15 "$log"; exit 1; fi
code=$(curl -s -m 60 -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/sign-in")
[ "$code" = 200 ] && ok "/sign-in loads" || { echo "  FAILED   /sign-in ($code)"; tail -15 "$log"; exit 1; }
echo "All good. Next: npm run dev, sign in at http://localhost:3100 (the first person becomes the owner), SETUP.md step 5."
