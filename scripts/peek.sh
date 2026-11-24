#!/bin/bash
# Peek, the team's board, on this Mac (127.0.0.1:3100, sign-in off, its database and files in the checkout's .data/).
#
#   sh scripts/peek.sh run            # what the launch agent runs (com.ramen-agents.portal-local): npm run local
#   sh scripts/peek.sh update         # take Peek's newest version; update.sh runs it
#   sh scripts/peek.sh update --check # say what an update would bring; change nothing
#   sh scripts/peek.sh jobs           # the two daily jobs: stale tasks, and old sample copies and unused photos
#   sh scripts/peek.sh secret         # make the jobs' CRON_SECRET once (install.sh runs it); it is never printed
#   sh scripts/peek.sh setup          # make Peek your team's board (a new install, or a move from the local board)
#   sh scripts/peek.sh back           # back to the dashboard's local board; Peek's data is kept
#
# setup clones and builds Peek, starts it once so its database exists, and registers the agents' keys. When the
# dashboard's local board holds rows, it writes them as Peek's files, shows the dry run's counts, and moves them only
# when you type yes at the prompt (no flag or setting answers it; without a terminal it stops). After the load it reads
# the rows back from Peek and prints both counts; only when every row is there does [leads] portal_url point at Peek.
# The local board's file is never changed: `sh scripts/peek.sh back` returns to it.
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
PY="${PYTHON:-python3}"
PEEK_URL="http://127.0.0.1:$PORT"
restart_team() {  # the dashboard and every member, so each reads the board's address again
  launchctl kickstart -k "gui/$UID_N/com.ramen-agents.bot-dashboard" 2>/dev/null && say "ok" "the dashboard restarted" || say "note" "the dashboard is not a launch agent: start it as you usually do"
  if [ -s "$BOTS/common-data/local/members.txt" ]; then
    for m in $(cat "$BOTS/common-data/local/members.txt"); do
      sh "$BOTS/scripts/restart-bot.sh" "$m" >/dev/null 2>&1 && say "ok" "$m restarted" || say "!!" "$m: sh scripts/restart-bot.sh $m"
    done
  fi
}

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
  "$PY" "$BOTS/scripts/peek_setup.py" news --portal "$PORTAL" --old "$old" 2>/dev/null || true   # Peek's own release lines, when it keeps them
  ;;

setup)
  # the yes is typed here, by a person: nothing else answers it
  [ -t 0 ] || { say "STOP" "setup asks you to type yes: run it in Terminal: sh scripts/peek.sh setup"; exit 1; }
  cd "$BOTS"
  echo "1. Peek's checkout ($PORTAL)"
  if [ ! -d "$PORTAL/.git" ]; then
    from=$(git -C "$BOTS" remote get-url starter 2>/dev/null) || { say "STOP" "no remote named starter in $BOTS: git -C $BOTS remote -v"; exit 1; }
    git clone -q -o starter -b portal "$from" "$PORTAL" || { say "STOP" "could not clone Peek from $from"; exit 1; }
    say "ok" "cloned"
  else
    say "ok" "already here ($(short HEAD 2>/dev/null || echo "no commit yet"))"
  fi
  (cd "$PORTAL" && npm ci --no-audit --no-fund --loglevel=error >/dev/null && npm run build >"$BOTS/common-data/logs/peek-build.log" 2>&1) \
    || { say "STOP" "the build failed: common-data/logs/peek-build.log; nothing else changed"; exit 1; }
  say "ok" "built"
  sh "$BOTS/scripts/peek.sh" secret

  echo "2. Peek starts once (its database, its owner)"
  sh "$BOTS/scripts/install-launchd.sh" portal-local peek-jobs >/dev/null || { say "STOP" "the launch agents did not load"; exit 1; }
  healthy || { say "STOP" "Peek did not answer $HEALTH within $WAIT s: common-data/logs/portal-local.err; sh scripts/peek.sh back undoes the agents"; exit 1; }
  stop_peek

  echo "3. Your board"
  stamp=$(date +%Y%m%d-%H%M%S)
  out="$BOTS/common-data/local/move-$stamp"
  rows=$("$PY" "$BOTS/scripts/peek_setup.py" local-rows)
  "$PY" "$BOTS/scripts/move_to_peek.py" --out "$out" --stamp "$stamp" >/dev/null 2>&1 || mkdir -p "$out"
  load() { (cd "$PORTAL" && node scripts/rebuild-load.mjs --pglite .data/pglite --dir "$out" --stamp "$stamp" --keys-prefix portal "$@"); }
  if [ "$rows" -gt 0 ]; then
    load --dry-run || { start_peek || true; say "STOP" "the dry run failed: nothing moved, your board is still the local one"; exit 1; }
    "$PY" "$BOTS/scripts/peek_setup.py" expected --dir "$out" --stamp "$stamp"
    printf '  Type yes to move these rows to Peek (anything else stops; nothing changes): '
    read -r answer
    if [ "$answer" != yes ]; then start_peek || true; say "stop" "nothing moved; your board is still the local one"; exit 1; fi
  fi
  # the agents' keys go in either way (an empty move registers them); the rows only after the yes above
  load >/dev/null || { start_peek || true; say "STOP" "the load failed: your board is still the local one (portal_url unchanged); sh scripts/peek.sh back"; exit 1; }
  start_peek || { say "STOP" "Peek's launch agent is not installed, so Peek cannot start: your board is still the local one; sh scripts/install-launchd.sh portal-local, then setup again"; exit 1; }
  healthy || { say "STOP" "Peek did not start after the load: your board is still the local one; sh scripts/peek.sh back"; exit 1; }

  echo "4. Read back from Peek"
  "$PY" "$BOTS/scripts/peek_setup.py" readback --dir "$out" --stamp "$stamp" --url "$PEEK_URL" \
    || { say "STOP" "Peek does not hold everything that was moved: your board is still the local one (portal_url unchanged). To go back: sh scripts/peek.sh back"; exit 1; }

  echo "5. The team's board is Peek"
  "$PY" "$BOTS/scripts/peek_setup.py" set-url "$PEEK_URL"
  say "ok" "[leads] portal_url = $PEEK_URL (common-data/configs/local.toml)"
  restart_team
  say "done" "your board is Peek: $PEEK_URL. The local board's file is as it was; to go back: sh scripts/peek.sh back"
  ;;

back)
  cd "$BOTS"
  "$PY" "$BOTS/scripts/peek_setup.py" unset-url
  say "ok" "[leads] portal_url taken out: the board is the dashboard's local one again"
  for l in portal-local peek-jobs; do
    launchctl bootout "gui/$UID_N/com.ramen-agents.$l" 2>/dev/null || true
    rm -f "$HOME/Library/LaunchAgents/com.ramen-agents.$l.plist"
  done
  say "ok" "Peek's two launch agents removed"
  restart_team
  say "done" "back on the local board (http://127.0.0.1:3000/boards). Peek's data stays in $PORTAL/.data; what was written on Peek since the move is there, not on the local board"
  ;;

*)
  echo "usage: sh scripts/peek.sh run | update [--check] | jobs | secret | setup | back" >&2
  exit 2
  ;;
esac
