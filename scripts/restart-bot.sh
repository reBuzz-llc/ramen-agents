#!/bin/sh
# Restart one or more web bots the safe way: STOP file -> wait for the running instance to exit -> remove STOP ->
# start the launch agent. Never `launchctl kickstart -k`: that kills the supervisor while the bot still holds its pid
# lock, the next instance exits 3 within a second, and the supervisor took that for a crash of a fresh commit and
# rolled ~/Projects/bot back to an old commit.
# A loop that does not exit within 120 s (a page open in flight) gets SIGTERM, 15 s later SIGKILL (with its child
# processes, e.g. the browser). The script always removes the STOP it wrote (one left behind would keep the bot
# down: the loop exits on it and launchd does not relaunch it). A STOP that was
# there before the script ran is the owner's: that bot is refused and its files are left alone, as disable-bot.sh.
# For the whole restart it also keeps workspace/RESTARTING (removed at the end, whatever happened), so the dashboard
# shows the bot as restarting rather than stopped by the owner.
#   sh ~/bots/scripts/restart-bot.sh the-ceo lead-gen
#   sh ~/bots/scripts/restart-bot.sh --dry-run lead-gen     (says what it would do; touches nothing)
# RESTART_BOTS_DIR, RESTART_WAIT, RESTART_TERM_WAIT and RESTART_LAUNCHCTL exist so scripts/test-restart-bot.sh can
# run this against a fake bot.
set -u
uid="$(id -u)"
bots="${RESTART_BOTS_DIR:-$HOME/bots}"
wait_s="${RESTART_WAIT:-120}"
term_s="${RESTART_TERM_WAIT:-15}"
lctl="${RESTART_LAUNCHCTL:-launchctl}"
dry=no
[ "${1:-}" = "--dry-run" ] && { dry=yes; shift; }
[ $# -gt 0 ] || { echo "usage: restart-bot.sh [--dry-run] <slug>..." >&2; exit 2; }

loop_pids() { pgrep -f "bots/$1/config.toml run" 2>/dev/null; }
# Wait up to $2 s for slug $1's loop to exit; true when it is gone.
wait_gone() {
    i=0
    while [ "$i" -lt "$2" ] && loop_pids "$1" >/dev/null; do sleep 1; i=$((i + 1)); done
    ! loop_pids "$1" >/dev/null
}

status=0
for slug in "$@"; do
    ws="$bots/$slug/workspace"
    label="com.ramen-agents.bot.$slug"
    if [ ! -d "$ws" ]; then
        echo "$slug: no workspace at $ws, refused" >&2
        status=1
        continue
    fi
    if [ -f "$ws/STOP" ]; then
        echo "$slug: STOP file was already there (the owner's), refused; nothing changed" >&2
        status=1
        continue
    fi
    if [ "$dry" = yes ]; then
        pids="$(loop_pids "$slug" | tr '\n' ' ')"
        loop="no running loop"
        [ -n "$pids" ] && loop="loop pid(s) ${pids% }"
        echo "$slug: dry run: would write STOP, wait up to ${wait_s}s for $loop, then SIGTERM, ${term_s}s, SIGKILL if needed; remove STOP and PAUSE; start $label and restart com.ramen-agents.data.$slug"
        continue
    fi
    date +%Y-%m-%dT%H:%M:%S > "$ws/RESTARTING"
    touch "$ws/STOP"
    how="exited on STOP"
    if ! wait_gone "$slug" "$wait_s"; then
        how="still running after ${wait_s}s, SIGTERM"
        loop_pids "$slug" | xargs kill -TERM 2>/dev/null
        if ! wait_gone "$slug" "$term_s"; then
            how="$how, then SIGKILL after ${term_s}s"
            for pid in $(loop_pids "$slug"); do
                pkill -KILL -P "$pid" 2>/dev/null
                kill -KILL "$pid" 2>/dev/null
            done
            wait_gone "$slug" 5 || how="$how; STILL RUNNING"
        fi
    fi
    # The STOP is this script's own (an owner's was refused above): it never stays, whatever happened.
    rm -f "$ws/STOP" "$ws/PAUSE" "$ws/RESTARTING"
    case "$how" in
    *"STILL RUNNING")
        echo "$slug: $how; STOP removed, not started (look at it by hand)" >&2
        status=1
        continue
        ;;
    esac
    # the supervisor exits 0 on a STOP; launchd then needs a kickstart to run it again
    "$lctl" kickstart "gui/$uid/$label" 2>/dev/null || "$lctl" kickstart -k "gui/$uid/$label"
    # the data server (bot dashboard: owner chat + webapp data) runs the same engine code; restart it too
    "$lctl" kickstart -k "gui/$uid/com.ramen-agents.data.$slug" 2>/dev/null || true
    echo "$slug: $how; restarted (run loop + data server) at $(date +%H:%M:%S) on $(git -C "$HOME/Projects/bot" rev-parse --short HEAD)"
done
exit $status
