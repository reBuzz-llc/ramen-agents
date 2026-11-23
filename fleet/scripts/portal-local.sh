#!/bin/bash
# The team portal in local mode: the app on 127.0.0.1:3100, its database on this Mac, reached by the team through the
# tunnel (scripts/portal-tunnel.sh). launchd: com.ramen-agents.portal-local (installed only by name:
# sh scripts/install-launchd.sh portal-local). Needs a build first:
#   cd ~/Projects/portal && npm run build
# Settings come from common-data/keys/portal-local.env (scripts/portal-local-setup.sh). Next.js also reads the checkout's
# .env.local (the cloud addresses, the hosted sign-in), but never over a variable already set: so the local file's values
# are exported first, and the hosted sign-in's are set empty (local mode signs in with codes). The development sign-in
# stays off (next start is a production server, and TEAMS_DEV_LOGIN is cleared too). docs/portal-database.md
set -eu
ENVF="${PORTAL_LOCAL_ENV:-$HOME/bots/common-data/keys/portal-local.env}"
PORTAL="${PORTAL_DIR:-$HOME/Projects/portal}"
PORT="${PORTAL_LOCAL_PORT:-3100}"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

[ -r "$ENVF" ] || { echo "portal-local: no $ENVF: run scripts/portal-local-setup.sh"; exit 1; }
cd "$PORTAL"
[ -f .next/BUILD_ID ] || { echo "portal-local: no build in $PORTAL: run npm run build there"; exit 1; }
set -a
. "$ENVF"
set +a
export NEON_AUTH_BASE_URL="" NEON_AUTH_JWKS_URL="" NEON_AUTH_COOKIE_SECRET="" TEAMS_DEV_LOGIN="" NODE_ENV=production
node scripts/migrate.mjs
exec ./node_modules/.bin/next start -p "$PORT" -H 127.0.0.1
