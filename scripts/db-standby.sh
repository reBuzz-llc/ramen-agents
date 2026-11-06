#!/bin/bash
# Copies of the team portal's database (the `portal` branch). Every copy is the same checked swap: pg_dump of the
# schemas "public" (the tables) and "drizzle" (which migrations ran), restored into the target in ONE transaction that
# renames the old schemas aside, restores the dump and compares every table's row count with the dump's own; any error
# or any difference rolls it all back and the target is left as it was. Only then are the old schemas dropped.
#
#   sh ~/bots/scripts/db-standby.sh                        # nightly (launchd com.ramen-agents.db-standby, 02:30): primary -> standby
#   sh ~/bots/scripts/db-standby.sh --reverse --yes-overwrite-primary     # after a failover: standby -> primary
#   sh ~/bots/scripts/db-standby.sh --to-local [--dump FILE]              # local mode: the newest copy -> Postgres on this Mac
#                                                          #   from the primary if it answers, else the standby, else the saved dump; or FILE
#   sh ~/bots/scripts/db-standby.sh --from-local --yes-overwrite-primary  # leaving local mode: this Mac -> the primary
#   sh ~/bots/scripts/db-standby.sh --from-local --to-standby             # this Mac -> the standby (a rebuild loaded locally first)
#   add --dry-run to any of them: check the tools, the addresses and the plan; connect to nothing
#
# Addresses, one line each (the postgres:// connection string, the direct or session address: a dump needs a session),
# mode 600, read here only (nothing is written to ~/.pgpass):
#   common-data/keys/portal-primary.key   the database the portal uses (any Postgres: Neon, Supabase, your own)
#   common-data/keys/portal-standby.key   a second, free database on another provider: the nightly copy's target
#   common-data/keys/portal-local.key     Postgres on this Mac (scripts/portal-local-setup.sh writes it)
# After a failover, swap the two key files: the copy always runs primary -> standby.
# Each successful dump of the primary or the standby is also kept as common-data/backups/portal-latest.sql (mode 600,
# git-ignored): the last resort for --to-local when neither answers.
# Results, one JSON line each ({"at", "tables", "rows", "mb", "ok", "error", "from", "to", "db_mb"}: db_mb is the
# primary's size after the copy, for the dashboard's "Other free tiers") in common-data/shared-state/: db-standby.json
# (nightly), db-standby-reverse.json, portal-local-restore.json, db-from-local.json.
# Needs pg_dump and psql: Homebrew's postgresql@17 or libpq (both keg-only; looked for in /opt/homebrew/opt).
# The guide: docs/portal-database.md.
set -u

BOTS="${BOTS_DIR:-$HOME/bots}"
KEYS="$BOTS/common-data/keys"
PRIMARY_KEY="${PRIMARY_KEY:-$KEYS/portal-primary.key}"
STANDBY_KEY="${STANDBY_KEY:-$KEYS/portal-standby.key}"
LOCAL_KEY="${LOCAL_KEY:-$KEYS/portal-local.key}"
SAVED="${SAVED_DUMP:-$BOTS/common-data/backups/portal-latest.sql}"
SHARED="$BOTS/common-data/shared-state"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/db-standby.XXXXXX")"
trap 'rm -rf "${WORK:?}"' EXIT

DRY=0; MODE=standby; CONFIRMED=0; DUMP_IN=""; SHRINK=0; TO_STANDBY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY=1 ;;
    --reverse) MODE=reverse ;;
    --to-local) MODE=to-local ;;
    --from-local) MODE=from-local ;;
    --to-standby) TO_STANDBY=1 ;;
    --yes-overwrite-primary) CONFIRMED=1 ;;
    --yes-shrink) SHRINK=1 ;;
    --dump) shift; DUMP_IN="${1:-}" ;;
    *) echo "db-standby: unknown option $1" >&2; exit 2 ;;
  esac
  shift
done
case "$MODE" in
  standby) STATE="$SHARED/db-standby.json" ;;
  reverse) STATE="$SHARED/db-standby-reverse.json" ;;
  to-local) STATE="$SHARED/portal-local-restore.json" ;;
  from-local) STATE="$SHARED/db-from-local.json" ;;
esac

now() { date +"%Y-%m-%dT%H:%M:%S"; }
FROM_LABEL=""; TO_LABEL=""; DB_MB=""
# state <ok> <tables> <rows> <mb> <error>: one JSON line (python3 writes it safely)
state() {
  [ "$DRY" = 1 ] && { echo "would write $STATE: ok=$1 tables=$2 rows=$3 mb=$4 from=$FROM_LABEL to=$TO_LABEL error=$5"; return; }
  mkdir -p "$SHARED"
  /usr/bin/python3 - "$STATE" "$(now)" "$1" "$2" "$3" "$4" "$5" "$FROM_LABEL" "$TO_LABEL" "$DB_MB" <<'PY'
import json, sys, os
path, at, ok, tables, rows, mb, error, src, dst, db_mb = sys.argv[1:11]
tmp = path + ".tmp"
with open(tmp, "w") as f:
    json.dump({"at": at, "tables": int(tables or 0), "rows": int(rows or 0), "mb": float(mb or 0), "ok": ok == "1", "error": error,
               "from": src, "to": dst, "db_mb": float(db_mb) if db_mb else None}, f)
os.replace(tmp, path)
PY
}
PROBLEMS=""
# A real run stops at the first problem and says it in the state line; a dry run lists them all and writes nothing.
fail() {
  if [ "$DRY" = 1 ]; then PROBLEMS="$PROBLEMS\n  - $1"; return 0; fi
  echo "db-standby: $1" >&2; state 0 0 0 0 "$1"; exit 1
}
host_of() { sed -E 's#^[a-z]+://([^@/]*@)?([^:/?]+).*#\2#' <<<"$1"; }
is_local() { case "$(host_of "$1")" in 127.0.0.1|localhost|::1) return 0 ;; *) return 1 ;; esac; }
with_ssl() { if is_local "$1"; then echo "$1"; else case "$1" in *sslmode=*) echo "$1" ;; *\?*) echo "$1&sslmode=require" ;; *) echo "$1?sslmode=require" ;; esac; fi; }

# key_url <var> <file> <what>: sets <var> to the one-line postgres URL a key file holds (mode 600 enforced); leaves it
# empty and records the problem when not. (A function setting a variable, not $(...): a subshell could not stop the run.)
key_url() {
  local var="$1" f="$2" what="$3" u=""
  printf -v "$var" '%s' ""
  if [ ! -r "$f" ]; then fail "no $f ($what): one line, the connection string, chmod 600"; return 0; fi
  case "$(stat -f '%Lp' "$f")" in 600|400) ;; *) fail "$f must be mode 600 (chmod 600 $f): it holds a password"; return 0 ;; esac
  u="$(head -1 "$f" | tr -d '[:space:]')"
  case "$u" in postgres://*|postgresql://*) printf -v "$var" '%s' "$u" ;; *) fail "$f does not hold a postgres:// connection string" ;; esac
}
# reachable <url>: answers select 1 within ten seconds
reachable() { PGCONNECT_TIMEOUT=10 psql "$(with_ssl "$1")" --no-psqlrc -tAc "select 1" >/dev/null 2>&1; }

# --- the tools -----------------------------------------------------------------------------------------------------
for d in /opt/homebrew/opt/postgresql@17/bin /opt/homebrew/opt/libpq/bin /usr/local/opt/libpq/bin; do [ -x "$d/pg_dump" ] && PATH="$d:$PATH" && break; done
command -v pg_dump >/dev/null && command -v psql >/dev/null || fail "pg_dump and psql not found: brew install postgresql@17 (or libpq)"

# --- source and target by mode -------------------------------------------------------------------------------------
SRC=""; DST=""; FROM_FILE=""
case "$MODE" in
  standby)
    key_url SRC "$PRIMARY_KEY" "the primary"; FROM_LABEL="primary"
    key_url DST "$STANDBY_KEY" "the standby"; TO_LABEL="standby" ;;
  reverse)
    [ "$CONFIRMED" = 1 ] || fail "--reverse replaces the primary's tables with the standby's: add --yes-overwrite-primary"
    key_url SRC "$STANDBY_KEY" "the standby"; FROM_LABEL="standby"
    key_url DST "$PRIMARY_KEY" "the primary"; TO_LABEL="primary" ;;
  from-local)
    key_url SRC "$LOCAL_KEY" "the portal's database on this Mac"; FROM_LABEL="local"
    if [ "$TO_STANDBY" = 1 ]; then
      key_url DST "$STANDBY_KEY" "the standby"; TO_LABEL="standby"
    else
      [ "$CONFIRMED" = 1 ] || fail "--from-local replaces the primary's tables with this Mac's: add --yes-overwrite-primary (or --to-standby)"
      key_url DST "$PRIMARY_KEY" "the primary"; TO_LABEL="primary"
    fi ;;
  to-local)
    TO_LABEL="local"
    key_url DST "$LOCAL_KEY" "the portal's database on this Mac"
    if [ -n "$DUMP_IN" ]; then
      [ -r "$DUMP_IN" ] || fail "no dump file $DUMP_IN"
      FROM_FILE="$DUMP_IN"; FROM_LABEL="file $DUMP_IN"
    elif [ "$DRY" = 1 ]; then
      FROM_LABEL="the primary if it answers, else the standby ($([ -r "$STANDBY_KEY" ] && echo "key on file" || echo "no key")), else $SAVED ($([ -r "$SAVED" ] && echo "on file" || echo "none yet"))"
    else
      P=""; S=""
      [ -r "$PRIMARY_KEY" ] && key_url P "$PRIMARY_KEY" "the primary"
      if [ -n "$P" ] && reachable "$P"; then
        SRC="$P"; FROM_LABEL="primary"
      else
        [ -r "$STANDBY_KEY" ] && key_url S "$STANDBY_KEY" "the standby"
        if [ -n "$S" ] && reachable "$S"; then
          SRC="$S"; FROM_LABEL="standby"
        elif [ -r "$SAVED" ]; then
          FROM_FILE="$SAVED"; FROM_LABEL="saved dump $(stat -f '%Sm' -t '%Y-%m-%d %H:%M' "$SAVED")"
        else
          fail "nothing to copy from: the primary and the standby do not answer and there is no saved dump ($SAVED); give one with --dump FILE"
        fi
      fi
    fi
    [ -n "$DST" ] && ! is_local "$DST" && fail "$LOCAL_KEY must point at this Mac (127.0.0.1 or localhost), not $(host_of "$DST")" ;;
esac
[ -n "$SRC" ] && [ -n "$DST" ] && [ "$SRC" = "$DST" ] && fail "the source and the target are the same database: refusing"

echo "db-standby ($MODE): $(pg_dump --version 2>/dev/null | head -1 || echo 'no pg_dump'); from ${FROM_LABEL:-?}${SRC:+ ($(host_of "$SRC"))} to ${TO_LABEL:-?}${DST:+ ($(host_of "$DST"))}"
if [ "$DRY" = 1 ]; then
  if [ -n "$PROBLEMS" ]; then printf "dry run: not ready:%b\n" "$PROBLEMS"; exit 1; fi
  echo "dry run: would pg_dump --schema=public --schema=drizzle --no-owner --no-privileges --no-comments (or read the dump file),"
  echo "  restore it into the target in one transaction (public and drizzle renamed aside to standby_prev / drizzle_prev),"
  echo "  compare every table's rows with the dump's, commit, then drop the old schemas."
  state 1 0 0 0 ""
  exit 0
fi

# --- 1. the dump --------------------------------------------------------------------------------------------------------
DUMP="$WORK/portal.sql"
if [ -n "$FROM_FILE" ]; then
  cp "$FROM_FILE" "$DUMP" || fail "cannot read $FROM_FILE"
else
  pg_dump "$(with_ssl "$SRC")" --schema=public --schema=drizzle --no-owner --no-privileges --no-comments --format=plain --file="$DUMP" 2>"$WORK/dump.err" \
    || fail "pg_dump from $FROM_LABEL failed: $(tr '\n' ' ' <"$WORK/dump.err" | cut -c1-240)"
  if [ "$FROM_LABEL" = "primary" ] || [ "$FROM_LABEL" = "standby" ]; then   # the last resort for --to-local: the newest cloud dump, kept on this Mac
    mkdir -p "$(dirname "$SAVED")" && chmod 700 "$(dirname "$SAVED")"
    (umask 077 && cp "$DUMP" "$SAVED.tmp" && mv "$SAVED.tmp" "$SAVED")
  fi
fi
MB="$(/usr/bin/python3 -c "import os,sys; print(round(os.path.getsize(sys.argv[1]) / 1048576, 1))" "$DUMP")"

# The rows per table in the dump: the lines between "COPY <table> (...) FROM stdin;" and "\.".
awk '/^COPY [^ ]+ .* FROM stdin;$/ { t = $2; n[t] = 0; inside = 1; next } inside && /^\\\.$/ { inside = 0; next } inside { n[t]++ } END { for (t in n) print t "\t" n[t] }' "$DUMP" | sort >"$WORK/expect.tsv"
TABLES="$(wc -l <"$WORK/expect.tsv" | tr -d ' ')"
ROWS="$(awk -F'\t' '{ s += $2 } END { print s + 0 }' "$WORK/expect.tsv")"
[ "$TABLES" -gt 0 ] || fail "the dump has no tables ($FROM_LABEL answered, but nothing came)"

# A copy by hand never shrinks the target's leads unasked (a fresh, empty database copied over a full one is the
# classic mistake): the leads in the dump against the leads in the target. The nightly copy is exempt: leads deleted on
# the primary must leave the standby too.
if [ "$SHRINK" != 1 ] && [ "$MODE" != standby ]; then
  NEW_LEADS="$(awk -F'\t' '$1 == "public.leads" { print $2 }' "$WORK/expect.tsv")"
  OLD_LEADS="$(PGCONNECT_TIMEOUT=10 psql "$(with_ssl "$DST")" --no-psqlrc -tAc "select count(*) from public.leads" 2>/dev/null | tr -d '[:space:]')"
  if [ -n "$OLD_LEADS" ] && [ "${NEW_LEADS:-0}" -lt "$OLD_LEADS" ]; then
    fail "refused: $FROM_LABEL has ${NEW_LEADS:-0} leads, $TO_LABEL has $OLD_LEADS; nothing changed (--yes-shrink to copy anyway)"
  fi
fi

# pg_dump 17 writes "SET transaction_timeout", which an older server refuses; the schemas may already exist.
sed -E -i '' '/^SET transaction_timeout = /d; s/^CREATE SCHEMA (public|drizzle);$/CREATE SCHEMA IF NOT EXISTS \1;/' "$DUMP"

# --- 2. the restore, checked, in one transaction ---------------------------------------------------------------------
CHECK="$WORK/check.sql"
{
  echo "CREATE TEMP TABLE standby_expect (t text, n bigint);"
  while IFS="$(printf '\t')" read -r t n; do echo "INSERT INTO standby_expect VALUES ('$t', $n);"; done <"$WORK/expect.tsv"
  cat <<'SQL'
DO $$
DECLARE r record; got bigint; bad text := '';
BEGIN
  FOR r IN SELECT t, n FROM standby_expect LOOP
    EXECUTE format('SELECT count(*) FROM %s', r.t) INTO got;
    IF got <> r.n THEN bad := bad || format('%s: %s rows, the dump had %s; ', r.t, got, r.n); END IF;
  END LOOP;
  IF bad <> '' THEN RAISE EXCEPTION 'row counts differ: %', bad; END IF;
END $$;
SQL
} >"$CHECK"
cat >"$WORK/restore.sql" <<SQL
\set ON_ERROR_STOP on
DROP SCHEMA IF EXISTS standby_prev CASCADE;
DROP SCHEMA IF EXISTS drizzle_prev CASCADE;
DO \$\$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'public') THEN ALTER SCHEMA public RENAME TO standby_prev; END IF;
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'drizzle') THEN ALTER SCHEMA drizzle RENAME TO drizzle_prev; END IF;
END \$\$;
CREATE SCHEMA public;
\i $DUMP
\i $CHECK
SQL
psql "$(with_ssl "$DST")" --no-psqlrc --quiet --single-transaction -v ON_ERROR_STOP=1 -f "$WORK/restore.sql" >"$WORK/restore.out" 2>"$WORK/restore.err" \
  || fail "restore into $TO_LABEL failed, the target is as it was: $(grep -m1 -E 'ERROR|FATAL|error' "$WORK/restore.err" | cut -c1-240)"

# --- 3. the old copy goes ----------------------------------------------------------------------------------------------
psql "$(with_ssl "$DST")" --no-psqlrc --quiet -v ON_ERROR_STOP=1 -c "DROP SCHEMA IF EXISTS standby_prev CASCADE; DROP SCHEMA IF EXISTS drizzle_prev CASCADE;" >/dev/null 2>"$WORK/drop.err" \
  || echo "db-standby: the new copy is in; dropping the old schemas failed (they stay until the next copy): $(head -1 "$WORK/drop.err")" >&2

# --- 4. the primary's size (free plans cap it; the dashboard's "Other free tiers" reads it) ----------------------------
SIZE_ON=""
[ "$FROM_LABEL" = primary ] && SIZE_ON="$SRC"
[ "$TO_LABEL" = primary ] && SIZE_ON="$DST"
[ -n "$SIZE_ON" ] && DB_MB="$(PGCONNECT_TIMEOUT=10 psql "$(with_ssl "$SIZE_ON")" --no-psqlrc -tAc "select round(pg_database_size(current_database()) / 1048576.0, 1)" 2>/dev/null | tr -d '[:space:]')"

state 1 "$TABLES" "$ROWS" "$MB" ""
echo "db-standby ($MODE): copied $TABLES tables, $ROWS rows ($MB MB dump) from $FROM_LABEL to ${TO_LABEL:-?} at $(now)${DB_MB:+; the primary is $DB_MB MB}"
