#!/bin/bash
# The team portal's local mode, set up once: when the portal's cloud database is out (a free quota used up, a provider
# down), the portal runs on this Mac against Postgres on this Mac, and the team reaches it through a tunnel. This makes
# Postgres 17 on this Mac (Homebrew, listening on 127.0.0.1 only), a role and database "portal_local" with a random
# password, and two files, both mode 600:
#   common-data/keys/portal-local.key   one line: the database's URL (db-standby.sh --to-local / --from-local read it)
#   common-data/keys/portal-local.env   the portal's settings in local mode (scripts/portal-local.sh loads it): the
#                                       database, PEEK_LOCAL_MODE=1 (sign-in codes instead of the hosted sign-in), files
#                                       on this Mac, and the encryption key copied from the portal's .env.local (the
#                                       copied rows were encrypted with it)
# then the portal's own migrations on it. Safe to run again: an existing role, database or file is kept.
#
#   sh ~/bots/scripts/portal-local-setup.sh            # then: sh ~/bots/scripts/db-standby.sh --to-local
#   sh ~/bots/scripts/portal-local-setup.sh --dry-run  # say what it would do
# The portal's checkout: PORTAL_DIR (default ~/Projects/portal, a clone of the `portal` branch). docs/portal-database.md
set -eu

BOTS="${BOTS_DIR:-$HOME/bots}"
PORTAL="${PORTAL_DIR:-$HOME/Projects/portal}"
PG="${PG_BIN:-/opt/homebrew/opt/postgresql@17/bin}"
PORT="${PORTAL_LOCAL_PG_PORT:-5432}"
KEY="$BOTS/common-data/keys/portal-local.key"
ENVF="$BOTS/common-data/keys/portal-local.env"
FILES="$BOTS/common-data/portal-files"
# The admin connection goes over the local socket (/tmp, Homebrew's default), which trusts this Mac's own user; the
# portal_local role connects over TCP with its password (scram-sha-256).
ADMIN="${PORTAL_LOCAL_ADMIN_URL:-postgresql:///postgres?host=/tmp&port=$PORT}"
DRY=0; [ "${1:-}" = "--dry-run" ] && DRY=1
say() { echo "portal-local-setup: $*"; }
run() { if [ "$DRY" = 1 ]; then say "would run: $*"; else "$@"; fi; }

[ -x "$PG/psql" ] || { say "no $PG/psql: brew install postgresql@17"; exit 1; }
[ -d "$PORTAL" ] || { say "no portal checkout at $PORTAL: git clone -b portal https://github.com/reBuzz-llc/ramen-agents $PORTAL (or set PORTAL_DIR)"; exit 1; }
export PATH="$PG:$PATH"

# 1. the server: Homebrew's service (its data in $(brew --prefix)/var/postgresql@17), unless something already answers
if ! PGCONNECT_TIMEOUT=3 psql "$ADMIN" -tAc "select 1" >/dev/null 2>&1; then
  DATA="$(brew --prefix)/var/postgresql@17"
  [ -f "$DATA/PG_VERSION" ] || run initdb -D "$DATA" --auth-local=trust --auth-host=scram-sha-256 -U "$(whoami)"
  # this Mac only: never on a network address (the tunnel reaches the portal, not the database)
  if [ "$DRY" = 0 ] && ! grep -q "^listen_addresses = '127.0.0.1'" "$DATA/postgresql.conf"; then
    printf "\n# the portal's local mode: this Mac only\nlisten_addresses = '127.0.0.1'\nport = %s\n" "$PORT" >>"$DATA/postgresql.conf"
  fi
  run brew services start postgresql@17
  [ "$DRY" = 1 ] || for i in $(seq 1 20); do PGCONNECT_TIMEOUT=2 psql "$ADMIN" -tAc "select 1" >/dev/null 2>&1 && break; sleep 1; done
fi

# 2. the role and the database, with a password only the key file holds
if [ -r "$KEY" ]; then
  say "$KEY exists: keeping its role and password"
  URL="$(head -1 "$KEY" | tr -d '[:space:]')"
else
  PASS="$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 28)"
  URL="postgresql://portal_local:$PASS@127.0.0.1:$PORT/portal_local"
  if [ "$DRY" = 1 ]; then say "would create role and database portal_local and write $KEY (mode 600)"; else
    psql "$ADMIN" -v ON_ERROR_STOP=1 -qc "DO \$\$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'portal_local') THEN CREATE ROLE portal_local LOGIN; END IF; END \$\$;" -c "ALTER ROLE portal_local PASSWORD '$PASS';"
    psql "$ADMIN" -tAc "SELECT 1 FROM pg_database WHERE datname = 'portal_local'" | grep -q 1 || psql "$ADMIN" -v ON_ERROR_STOP=1 -qc "CREATE DATABASE portal_local OWNER portal_local"
    mkdir -p "$(dirname "$KEY")"
    (umask 077 && echo "$URL" >"$KEY")
  fi
fi

# 3. the portal's settings for local mode
if [ -r "$ENVF" ]; then say "$ENVF exists: kept"; elif [ "$DRY" = 1 ]; then say "would write $ENVF (mode 600)"; else
  ENC="$(grep -E '^TEAMS_ENCRYPTION_KEY=' "$PORTAL/.env.local" 2>/dev/null | tail -1 | cut -d= -f2- || true)"
  mkdir -p "$FILES" && chmod 700 "$FILES"
  (umask 077 && cat >"$ENVF" <<EOF
# The portal in local mode: loaded by scripts/portal-local.sh. Never on a hosting provider.
DATABASE_URL=$URL
DATABASE_URL_UNPOOLED=$URL
PEEK_LOCAL_MODE=1
FILES_DIR=$FILES
TEAMS_ENCRYPTION_KEY=$ENC
EOF
  )
  [ -n "$ENC" ] || say "warning: no TEAMS_ENCRYPTION_KEY in $PORTAL/.env.local; encrypted settings (the Notion token) will not open"
fi

# 4. the portal's migrations on it (the same script its hosted build runs)
if [ "$DRY" = 1 ]; then say "would run: node --env-file=$ENVF scripts/migrate.mjs (in $PORTAL)"; else
  (cd "$PORTAL" && node --env-file="$ENVF" scripts/migrate.mjs)
fi
say "done. Next: sh $BOTS/scripts/db-standby.sh --to-local, then sh $BOTS/scripts/install-launchd.sh portal-local portal-tunnel"
