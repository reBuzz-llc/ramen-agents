#!/bin/sh
# Restart one or more web bots the safe way: STOP file -> wait for the running instance to exit -> remove STOP ->
# start the launch agent. Never `launchctl kickstart -k`: that kills the supervisor while the bot still holds its pid
# lock, the next instance exits 3 within a second, and the supervisor took that for a crash of a fresh commit and
# rolled ~/Projects/bot back to an old commit.
#   sh ~/bots/scripts/restart-bot.sh the-ceo lead-gen
set -u
uid="$(id -u)"
for slug in "$@"; do
    ws="$HOME/bots/$slug/workspace"
    label="com.rebuzz.bot.$slug"
    touch "$ws/STOP"
    i=0
    while [ $i -lt 45 ] && pgrep -f "bots/$slug/config.toml run" >/dev/null 2>&1; do sleep 1; i=$((i + 1)); done
    if pgrep -f "bots/$slug/config.toml run" >/dev/null 2>&1; then
        echo "$slug: still running after 45s; leaving STOP in place, not started" >&2
        continue
    fi
    rm -f "$ws/STOP" "$ws/PAUSE"
    # the supervisor exits 0 on a STOP; launchd then needs a kickstart to run it again
    launchctl kickstart "gui/$uid/$label" 2>/dev/null || launchctl kickstart -k "gui/$uid/$label"
    # the data server (bot dashboard: owner chat + webapp data) runs the same engine code; restart it too
    launchctl kickstart -k "gui/$uid/com.rebuzz.data.$slug" 2>/dev/null || true
    echo "$slug: restarted (run loop + data server) at $(date +%H:%M:%S) on $(git -C "$HOME/Projects/bot" rev-parse --short HEAD)"
done
