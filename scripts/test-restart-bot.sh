#!/bin/sh
# Tests restart-bot.sh against fake bots in a temp folder: a fake launchctl logs its calls, and a fake run loop is a
# shell whose command line carries "bots/<slug>/config.toml run". Short waits (2 s, then 2 s). No real bot is touched.
#   sh ~/bots/scripts/test-restart-bot.sh
set -u
here="$(cd "$(dirname "$0")" && pwd)"
tmp="$(mktemp -d)"
trap 'pkill -KILL -f "$tmp/bots/" 2>/dev/null; rm -rf "$tmp"' EXIT
export RESTART_BOTS_DIR="$tmp/bots" RESTART_WAIT=2 RESTART_TERM_WAIT=2 RESTART_LAUNCHCTL="$tmp/launchctl"
printf '#!/bin/sh\necho "$*" >> "%s/launchctl.log"\n' "$tmp" > "$tmp/launchctl"
chmod +x "$tmp/launchctl"
fails=0
check() { if eval "$2"; then echo "ok   $1"; else echo "FAIL $1"; fails=$((fails + 1)); fi; }
# fake <slug> <how>: stop = exits when STOP appears; term = ignores STOP, exits on SIGTERM; stuck = ignores both.
fake() {
    mkdir -p "$tmp/bots/$1/workspace"
    case "$2" in
    stop) body='while [ ! -f "$0/workspace/STOP" ]; do sleep 0.2; done' ;;
    term) body='trap "exit 0" TERM; while :; do sleep 0.2; done' ;;
    stuck) body='trap "" TERM; while :; do sleep 0.2; done' ;;
    none) return ;;
    esac
    sh -c "$body" "$tmp/bots/$1" --config "$tmp/bots/$1/config.toml" run --quiet &
    sleep 0.3
}
run() { out="$(sh "$here/restart-bot.sh" "$@" 2>&1)"; code=$?; echo "     > $out"; }
gone() { ! pgrep -f "bots/$1/config.toml run" >/dev/null; }

fake a stop; run a
check "exits on STOP: restarted"       'case "$out" in *"a: exited on STOP; restarted"*) true;; *) false;; esac && [ $code -eq 0 ]'
check "exits on STOP: STOP removed"    '[ ! -f "$tmp/bots/a/workspace/STOP" ]'
check "exits on STOP: RESTARTING gone"  '[ ! -f "$tmp/bots/a/workspace/RESTARTING" ]'
check "exits on STOP: kickstarted"     'grep -q "kickstart gui/.*/com.ramen-agents.bot.a" "$tmp/launchctl.log"'

fake b term; touch "$tmp/bots/b/workspace/PAUSE"; run b
check "SIGTERM: said so"               'case "$out" in *"b: still running after 2s, SIGTERM; restarted"*) true;; *) false;; esac'
check "SIGTERM: loop gone"             'gone b'
check "SIGTERM: STOP and PAUSE gone"   '[ ! -f "$tmp/bots/b/workspace/STOP" ] && [ ! -f "$tmp/bots/b/workspace/PAUSE" ]'

fake c stuck; run c
check "SIGKILL: said so"               'case "$out" in *"c: still running after 2s, SIGTERM, then SIGKILL after 2s; restarted"*) true;; *) false;; esac'
check "SIGKILL: loop gone"             'gone c'
check "SIGKILL: STOP removed"          '[ ! -f "$tmp/bots/c/workspace/STOP" ]'
check "SIGKILL: RESTARTING gone"        '[ ! -f "$tmp/bots/c/workspace/RESTARTING" ]'

fake g stop; ( sleep 0.1; [ -f "$tmp/bots/g/workspace/RESTARTING" ] && touch "$tmp/seen-restarting" ) & run g
check "RESTARTING while it runs"       '[ -f "$tmp/seen-restarting" ] && [ ! -f "$tmp/bots/g/workspace/RESTARTING" ]'

fake d none; touch "$tmp/bots/d/workspace/STOP"; : > "$tmp/launchctl.log"; run d
check "owner STOP: refused"            'case "$out" in *"d: STOP file was already there"*) true;; *) false;; esac && [ $code -eq 1 ]'
check "owner STOP: left alone"         '[ -f "$tmp/bots/d/workspace/STOP" ] && [ ! -f "$tmp/bots/d/workspace/RESTARTING" ]'
check "owner STOP: no launchctl"       '[ ! -s "$tmp/launchctl.log" ]'

fake e stuck; run --dry-run e
check "dry run: says what it would do" 'case "$out" in *"e: dry run: would write STOP"*"loop pid"*) true;; *) false;; esac'
check "dry run: no STOP, loop alive"   '[ ! -f "$tmp/bots/e/workspace/STOP" ] && ! gone e && [ ! -s "$tmp/launchctl.log" ]'

fake f none; run d f
check "two bots: one line each"        '[ "$(echo "$out" | wc -l | tr -d " ")" = 2 ] && [ $code -eq 1 ]'

echo "$fails failed"
[ $fails -eq 0 ]
