#!/bin/sh
# Unload a stopped bot from launchd, so launchd stops relaunching it every 30 s only to read "STOP file present" (a
# stopped bot can write tens of thousands of such lines, megabytes, in a few weeks). Only for a bot that already has a
# STOP file: the STOP file is the owner's decision, this makes launchd honour it. Unloads the run loop
# (com.ramen-agents.bot.<slug>), its data server (com.ramen-agents.data.<slug>) and its app (com.ramen-agents.<slug>-app)
# where present, and marks each disabled so a login or reboot does not load it again. The plists stay in ~/Library/LaunchAgents; enable-bot.sh undoes this.
#   sh scripts/disable-bot.sh my-bot other-bot
set -u
uid="$(id -u)"
[ $# -gt 0 ] || { echo "usage: disable-bot.sh <slug>..." >&2; exit 2; }
status=0
for slug in "$@"; do
    if [ ! -f "$HOME/bots/$slug/workspace/STOP" ]; then
        echo "$slug: no STOP file, refused (stop it with the owner's word first; restart-bot.sh is for running bots)" >&2
        status=1
        continue
    fi
    did=""
    for label in "com.ramen-agents.bot.$slug" "com.ramen-agents.data.$slug" "com.ramen-agents.$slug-app"; do
        loaded=no
        launchctl print "gui/$uid/$label" >/dev/null 2>&1 && loaded=yes
        [ -f "$HOME/Library/LaunchAgents/$label.plist" ] || [ "$loaded" = yes ] || continue
        [ "$loaded" = yes ] && launchctl bootout "gui/$uid/$label" 2>/dev/null
        launchctl disable "gui/$uid/$label"
        did="$did $label($( [ "$loaded" = yes ] && echo unloaded || echo "was not loaded" ), disabled)"
    done
    echo "$slug:${did:- nothing in launchd}"
done
exit $status
