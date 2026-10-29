#!/bin/sh
# Undo disable-bot.sh: mark the bot's launchd jobs enabled again and load their plists. It does NOT remove the STOP
# file, so the run loop starts and exits at once until someone runs restart-bot.sh: that stays the one way to run a
# bot (and the owner's word comes first for a bot the owner stopped).
#   sh scripts/enable-bot.sh my-bot
set -u
uid="$(id -u)"
[ $# -gt 0 ] || { echo "usage: enable-bot.sh <slug>..." >&2; exit 2; }
for slug in "$@"; do
    did=""
    for label in "com.ramen-agents.bot.$slug" "com.ramen-agents.data.$slug" "com.ramen-agents.$slug-app"; do
        plist="$HOME/Library/LaunchAgents/$label.plist"
        [ -f "$plist" ] || continue
        launchctl enable "gui/$uid/$label"
        if launchctl print "gui/$uid/$label" >/dev/null 2>&1; then
            did="$did $label(already loaded)"
        else
            launchctl bootstrap "gui/$uid" "$plist" && did="$did $label(loaded)" || did="$did $label(FAILED to load)"
        fi
    done
    stop=""
    [ -f "$HOME/bots/$slug/workspace/STOP" ] && stop=" — STOP file still there; restart-bot.sh runs it"
    echo "$slug:${did:- no plists found}$stop"
done
