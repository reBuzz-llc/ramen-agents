#!/bin/sh
# Supervisor for the explorer: runs `bot run`, understands the self-upgrade exit code, and rolls
# back a new version that crashes soon after it starts. launchd runs this (wrapped in caffeinate)
# instead of `bot` directly. See docs/milestone-5-6-self-upgrade.md.
#
#   exit 75 from the bot  -> it merged a new version into main; restart immediately on it
#   exit 0                -> STOP file or cycle cap; stay down (launchd does not restart a clean exit)
#   any other exit        -> a crash. If it happened within ROLLBACK_WINDOW seconds of starting on a
#                            commit that is not the last known good one, reset main to last_good,
#                            write a journal line, and restart. After MAX_ROLLBACKS in a row, leave a
#                            STOP file and exit 0 so the owner has to look. Otherwise exit with the
#                            bot's code so launchd restarts it as before.
set -u
# EXPLORER_HOME / EXPLORER_BOT exist so the tests can point this at a throwaway repo and a fake bot.
HERE="${EXPLORER_HOME:-$(cd "$(dirname "$0")/.." && pwd)}"
BOT="${EXPLORER_BOT:-$HERE/.venv/bin/bot}"
# One supervisor per bot: the launch agent says which config and workspace this instance is for.
# Without them (the original single-bot layout) the config and workspace live next to the code.
CFG="${EXPLORER_CONFIG:-$HERE/config.toml}"
WS="${EXPLORER_WORKSPACE:-$HERE/workspace}"
DEV="$WS/dev"
JOURNAL_DIR="$WS/journal"
STOP_FILE="$WS/STOP"
ROLLBACK_WINDOW="${EXPLORER_ROLLBACK_WINDOW:-600}"
MAX_ROLLBACKS="${EXPLORER_MAX_ROLLBACKS:-3}"
mkdir -p "$DEV" "$JOURNAL_DIR"

journal() {
    day="$(date +%Y-%m-%d)"
    file="$JOURNAL_DIR/$day.md"
    [ -f "$file" ] || printf '# %s\n\n' "$day" > "$file"
    printf '## %s Supervisor\n\n%s\n\n' "$(date +%H:%M)" "$1" >> "$file"
}

head_commit() { git -C "$HERE" rev-parse HEAD 2>/dev/null || echo unknown; }

while true; do
    commit="$(head_commit)"
    started="$(date +%s)"
    "$BOT" --config "$CFG" run --quiet
    code=$?
    elapsed=$(( $(date +%s) - started ))
    last_good="$(cat "$DEV/last_good" 2>/dev/null || true)"

    # Never spin: a bot that exits within seconds of starting waits before its next start, whether
    # it asked for a restart (75) or was rolled back. launchd's throttle only applies once this
    # script itself exits.
    if [ "$elapsed" -lt 30 ]; then
        sleep "${EXPLORER_RESTART_BACKOFF:-10}"
    fi
    if [ "$code" -eq 75 ]; then
        head_commit > "$DEV/upgrade_commit"   # the one kind of commit a rollback may undo: the bot's own merge
        journal "The agent merged a new version ($(head_commit | cut -c1-8)) and asked to be restarted on it."
        continue
    fi
    if [ "$code" -eq 0 ]; then
        exit 0
    fi
    # Exit 3: the bot found another instance holding its pid lock -- the previous one is still exiting after a
    # restart (launchctl kickstart -k). That is not a crash of the code, so never a rollback: wait and try again.
    # (2026-09-25: two such restarts each rolled main back to an old commit while the bots kept running on it.)
    if [ "$code" -eq 3 ]; then
        journal "Another instance still held the pid lock; waiting ${EXPLORER_RESTART_BACKOFF:-10}s and starting again (no rollback)."
        sleep "${EXPLORER_RESTART_BACKOFF:-10}"
        continue
    fi
    # Killed by a signal (launchd, the owner, a restart): not a crash of the code either. Let launchd restart it.
    if [ "$code" -gt 128 ]; then
        exit "$code"
    fi

    # A crash. Was it the bot's own fresh, unproven merge? Commits the owner or an operator made are never rolled
    # back (2026-09-25: two operator commits were undone under the bots' feet); those crashes go to launchd as usual.
    upgrade_commit="$(cat "$DEV/upgrade_commit" 2>/dev/null || true)"
    if [ -n "$last_good" ] && [ "$last_good" != "$commit" ] && [ "$commit" = "$upgrade_commit" ] && [ "$elapsed" -lt "$ROLLBACK_WINDOW" ]; then
        n="$(cat "$DEV/rollback_count" 2>/dev/null || echo 0)"
        n=$((n + 1))
        echo "$n" > "$DEV/rollback_count"
        if git -C "$HERE" reset --hard "$last_good" >/dev/null 2>&1; then
            journal "Version $(echo "$commit" | cut -c1-8) crashed ${elapsed}s after starting (exit $code). Rolled back to $(echo "$last_good" | cut -c1-8) (rollback $n of $MAX_ROLLBACKS)."
        else
            journal "Version $(echo "$commit" | cut -c1-8) crashed (exit $code) and the rollback to $(echo "$last_good" | cut -c1-8) failed. Stopping."
            touch "$STOP_FILE"
            exit 0
        fi
        if [ "$n" -ge "$MAX_ROLLBACKS" ]; then
            journal "Rolled back $n times in a row. Leaving a STOP file so the owner can look."
            touch "$STOP_FILE"
            exit 0
        fi
        continue
    fi

    # An ordinary crash on a proven version: let launchd restart it with its usual throttle.
    if [ "$elapsed" -ge "$ROLLBACK_WINDOW" ]; then
        echo "$commit" > "$DEV/last_good"   # it ran long enough to count as good
        echo 0 > "$DEV/rollback_count"
    fi
    exit "$code"
done
