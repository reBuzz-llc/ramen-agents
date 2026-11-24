#!/bin/bash
# Peek, the team's board, on this Mac (127.0.0.1:3100, sign-in off, its database and files in the checkout's .data/).
#
#   sh scripts/peek.sh run            # what the launch agent runs (com.ramen-agents.portal-local): npm run local
#   sh scripts/peek.sh update         # take Peek's newest version; update.sh runs it
#   sh scripts/peek.sh update --check # say what an update would bring; change nothing
#   sh scripts/peek.sh jobs           # the two daily jobs: stale tasks, and old sample copies and unused photos
#   sh scripts/peek.sh secret         # make the jobs' CRON_SECRET once (install.sh runs it); it is never printed
#
# Peek's checkout is PORTAL_DIR (default ~/Projects/portal), a clone of the starter's `portal` branch with the remote
# named `starter`. An update stops Peek (its database must be closed), copies .data/pglite and .data/files to
# common-data/peek/backups/<time>/ (the newest 3 are kept), pulls, runs npm ci when package-lock.json changed, builds,
# starts it again and waits for http://127.0.0.1:3100/api/health (up to PEEK_HEALTH_WAIT seconds, 60 by default). If any
# step fails, the previous version, its build and the copied data go back, Peek starts again, and the line says why.
# The secret goes to curl on its standard input (curl -K -), never on a command line another program could read.
set -eu

BOTS="${BOTS_DIR:-$HOME/bots}"
PORTAL="${PORTAL_DIR:-$HOME/Projects/portal}"
PORT="${PEEK_PORT:-3100}"
LABEL="com.ramen-agents.portal-local"
PLIST="${PEEK_PLIST:-$HOME/Library/LaunchAgents/$LABEL.plist}"
BACKUPS="${PEEK_BACKUPS:-$BOTS/common-data/peek/backups}"
KEEP=3
WAIT="${PEEK_HEALTH_WAIT:-60}"
HEALTH="http://127.0.0.1:$PORT/api/health"
[ -n "${PEEK_KEEP_PATH:-}" ] || export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"   # where node and npm live; the tests keep theirs
UID_N=$(id -u)

say() { printf '  %-8s %s\n' "$1" "$2"; }
short() { git -C "$PORTAL" rev-parse --short "$1"; }

stop_peek() {
  launchctl bootout "gui/$UID_N/$LABEL" 2>/dev/null || true
  # wait for the port to close, so the database is closed before it is copied
  n=0
  while [ "$n" -lt 20 ] && lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; do sleep 1; n=$((n + 1)); done
}
start_peek() {
  [ -f "$PLIST" ] || { say "note" "no launch agent at $PLIST: start Peek with sh scripts/peek.sh run"; return 1; }
  launchctl bootstrap "gui/$UID_N" "$PLIST" 2>/dev/null || launchctl kickstart -k "gui/$UID_N/$LABEL" 2>/dev/null || true
}
healthy() {
  n=0
  while [ "$n" -lt "$WAIT" ]; do
    curl -fsS -m 5 "$HEALTH" >/dev/null 2>&1 && return 0
    sleep 5; n=$((n + 5))
  done
  return 1
}

backup() {  # prints the folder the data went to
  dest="$BACKUPS/$(date +%Y%m%d-%H%M%S)"
  mkdir -p "$dest"
  for d in pglite files; do
    if [ -d "$PORTAL/.data/$d" ]; then cp -Rp "$PORTAL/.data/$d" "$dest/$d"; fi
  done
  echo "$dest"
}
prune() {  # the newest KEEP copies stay
  ls -1 "$BACKUPS" 2>/dev/null | sort -r | tail -n +$((KEEP + 1)) | while read -r old; do
    rm -rf "${BACKUPS:?}/${old:?}"
  done
}
restore_data() {  # $1 = a backup folder
  for d in pglite files; do
    if [ -d "$1/$d" ]; then
      rm -rf "${PORTAL:?}/.data/${d:?}"
      cp -Rp "$1/$d" "$PORTAL/.data/$d"
    fi
  done
}

cmd="${1:-}"
case "$cmd" in
run)
  cd "$PORTAL"
  [ -f .next/BUILD_ID ] || { echo "peek: no build in $PORTAL: sh $BOTS/scripts/peek.sh update"; exit 1; }
  exec npm run local
  ;;

secret)
  [ -d "$PORTAL" ] || { say "skip" "no Peek at $PORTAL"; exit 0; }
  f="$PORTAL/.env.local"
  [ -f "$f" ] || : > "$f"
  chmod 600 "$f"
  if grep -q '^CRON_SECRET=.' "$f"; then
    say "ok" "the daily jobs' secret is set"
  else
    # printf is the shell's own: the secret is on no program's command line
    printf 'CRON_SECRET=%s\n' "$(openssl rand -hex 32)" >> "$f"
    say "ok" "the daily jobs' secret is made (in $f, never printed)"
  fi
  ;;

jobs)
  f="$PORTAL/.env.local"
  secret=$(sed -n 's/^CRON_SECRET=//p' "$f" 2>/dev/null | head -1)
  [ -n "$secret" ] || { say "STOP" "no CRON_SECRET in $f: sh $BOTS/scripts/peek.sh secret, then restart Peek"; exit 1; }
  code=0
  for job in stale-tasks sample-cleanup; do
    if printf 'header = "Authorization: Bearer %s"\n' "$secret" | curl -fsS -m 300 -o /dev/null -K - "http://127.0.0.1:$PORT/api/jobs/$job"; then
      say "ok" "$job"
    else
      say "failed" "$job (is Peek running? curl $HEALTH)"; code=1
    fi
  done
  exit "$code"
  ;;

update)
  [ -d "$PORTAL/.git" ] || { say "skip" "no Peek at $PORTAL (the dashboard's own board is in use)"; exit 0; }
  git -C "$PORTAL" fetch -q starter portal || { say "STOP" "could not fetch Peek's newest version: git -C $PORTAL fetch starter portal"; exit 1; }
  old=$(git -C "$PORTAL" rev-parse HEAD)
  new=$(git -C "$PORTAL" rev-parse starter/portal)
  if [ "$old" = "$new" ] || git -C "$PORTAL" merge-base --is-ancestor "$new" "$old"; then
    say "ok" "Peek is current ($(short "$old"))"; exit 0
  fi
  if [ "${2:-}" = "--check" ]; then
    say "would" "update Peek $(short "$old") -> $(short "$new"): $(git -C "$PORTAL" rev-list --count "$old..$new") commit(s)"; exit 0
  fi
  need_ci=0
  git -C "$PORTAL" diff --quiet "$old" "$new" -- package-lock.json || need_ci=1
  stop_peek
  saved=$(backup)
  rm -rf "${PORTAL:?}/.next.prev"
  if [ -d "$PORTAL/.next" ]; then mv "$PORTAL/.next" "$PORTAL/.next.prev"; fi

  undo() {  # $1 = why: the previous version, its build and the copied data back, then Peek again
    stop_peek
    git -C "$PORTAL" reset -q --hard "$old"
    if [ "$need_ci" = 1 ]; then (cd "$PORTAL" && npm ci --silent >/dev/null 2>&1) || true; fi
    rm -rf "${PORTAL:?}/.next"
    if [ -d "$PORTAL/.next.prev" ]; then mv "$PORTAL/.next.prev" "$PORTAL/.next"; fi
    restore_data "$saved"
    start_peek || true
    say "STOP" "$1; Peek is back on $(short "$old") with its data as it was (a copy is in $saved)"
    exit 1
  }

  git -C "$PORTAL" merge -q --ff-only "$new" 2>/dev/null || undo "Peek's checkout has changes of its own, so the update did not apply (git -C $PORTAL status)"
  if [ "$need_ci" = 1 ]; then (cd "$PORTAL" && npm ci --silent >/dev/null 2>&1) || undo "npm ci failed in $PORTAL"; fi
  (cd "$PORTAL" && npm run build --silent >/dev/null 2>&1) || undo "the build failed (cd $PORTAL && npm run build says why)"
  start_peek || undo "Peek's launch agent could not start"
  healthy || undo "Peek did not answer $HEALTH within $WAIT s"
  rm -rf "${PORTAL:?}/.next.prev"
  prune
  say "ok" "Peek $(short "$old") -> $(short "$new"); data copied to $saved"
  ;;

*)
  echo "usage: sh scripts/peek.sh run | update [--check] | jobs | secret" >&2
  exit 2
  ;;
esac
