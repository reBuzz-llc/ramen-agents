#!/bin/sh
# Supervisor for the explorer: runs `bot run` and hands its exit to launchd. launchd runs this (wrapped in caffeinate)
# instead of `bot` directly.
#
#   exit 0                -> STOP file or cycle cap; stay down (launchd does not restart a clean exit)
#   exit 3                -> another instance still holds the pid lock; wait and start again
#   any other exit        -> exit with the bot's code so launchd restarts it
#
# It never changes the checkout. The self-upgrade this script used to roll back is gone: a leftover
# workspace/dev/upgrade_commit from an old install is ignored, and the journal says so once.
set -u
# EXPLORER_HOME / EXPLORER_BOT exist so the tests can point this at a throwaway repo and a fake bot.
HERE="${EXPLORER_HOME:-$(cd "$(dirname "$0")/.." && pwd)}"
# The copy of the code on the main branch is for reading: nothing runs from it.
# A clean exit, so launchd does not start it again.
if [ -f "$HERE/READ-ONLY-COPY.md" ]; then
    echo "$HERE is a read-only copy of the code: the supervisor does not run from it. Install from the engine branch." >&2
    exit 0
fi
BOT="${EXPLORER_BOT:-$HERE/.venv/bin/bot}"
# One supervisor per bot: the launch agent says which config and workspace this instance is for.
# Without them (the original single-bot layout) the config and workspace live next to the code.
CFG="${EXPLORER_CONFIG:-$HERE/config.toml}"
WS="${EXPLORER_WORKSPACE:-$HERE/workspace}"
DEV="$WS/dev"
JOURNAL_DIR="$WS/journal"
mkdir -p "$JOURNAL_DIR"

journal() {
    day="$(date +%Y-%m-%d)"
    file="$JOURNAL_DIR/$day.md"
    [ -f "$file" ] || printf '# %s\n\n' "$day" > "$file"
    printf '## %s Supervisor\n\n%s\n\n' "$(date +%H:%M)" "$1" >> "$file"
}

if [ -f "$DEV/upgrade_commit" ] && [ ! -e "$DEV/upgrade_commit.ignored" ]; then
    journal "A self-upgrade file from an older version is in $DEV. Self-upgrade is gone, so it is ignored and nothing is rolled back."
    : > "$DEV/upgrade_commit.ignored"
fi

while true; do
    started="$(date +%s)"
    "$BOT" --config "$CFG" run --quiet
    code=$?
    elapsed=$(( $(date +%s) - started ))

    # Never spin: a bot that exits within seconds of starting waits before its next start. launchd's
    # throttle only applies once this script itself exits.
    if [ "$elapsed" -lt 30 ]; then
        sleep "${EXPLORER_RESTART_BACKOFF:-10}"
    fi
    if [ "$code" -eq 0 ]; then
        exit 0
    fi
    # Exit 3: the bot found another instance holding its pid lock -- the previous one is still exiting after a
    # restart (launchctl kickstart -k). Wait and try again.
    if [ "$code" -eq 3 ]; then
        journal "Another instance still held the pid lock; waiting ${EXPLORER_RESTART_BACKOFF:-10}s and starting again."
        sleep "${EXPLORER_RESTART_BACKOFF:-10}"
        continue
    fi
    # A crash or a signal (launchd, the owner, a restart): launchd restarts it with its usual throttle.
    exit "$code"
done
