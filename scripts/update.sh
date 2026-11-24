#!/bin/sh
# Take the starter's newest version on a Mac that is already set up. Safe to run again.
#
#   sh scripts/update.sh              # update this folder (~/bots) and the engine (~/Projects/bot)
#   sh scripts/update.sh --check      # fetch and show what an update would bring and set aside; change nothing
#   sh scripts/update.sh --rollback   # back to where the last update started, in both folders
#
# On a checkout from before this script existed (no scripts/update.sh yet), run the new one straight from the starter:
#   cd ~/bots && git fetch starter && git show starter/fleet:scripts/update.sh | sh
#
# 1. Lifts your own values out of the tracked files, once (scripts/migrate_local.py): config values into the git-ignored
#    overlays (common-data/configs/local.toml, <member>/config.local.toml), your market and team into
#    common-data/local/family.toml, and an edited card or page into common-data/local/before-update/ with its edit as a
#    patch; old Notion settings are moved or dropped, each one named. Then the tracked files match the repository again.
# 2. Pulls this folder and the engine, keeping anything uncommitted aside and back (autostash).
# 3. Applies your set-aside edits again on the new files (git apply); one that no longer applies stays in before-update/
#    and is named.
# 4. Reinstalls what changed (sh scripts/install.sh) and restarts the dashboard and the members.
# 5. Runs the setup check (python3 scripts/setup-check.py) before and after: anything missing after that was not missing
#    before is named, with the rollback.
# 6. Prints what changed (docs/updates.json's new entries, else the commit subjects) and writes
#    common-data/local/last-update.json: the heads it started from and ended on, and what was re-applied or set aside.
#
# Exit codes: 0 updated (or --check / --rollback done); 1 STOP, the line above says what to do; 2 updated, but the setup
# check still finds something missing that was not before, a minute after the restarts (sh scripts/update.sh --rollback undoes it).
# Your keys, family.toml, local.toml, config.local.toml files and data are git-ignored: no step here touches them.
set -eu
# the copy on the main branch is for reading: stop there (read from a pipe, the script has no folder and the check is not needed)
if [ -f "$(dirname "$0")/read-only-guard.sh" ]; then . "$(dirname "$0")/read-only-guard.sh"; fi
case "$(uname -s)" in Darwin) ;; *) [ "${RAMEN_UPDATE_ANY_OS:-0}" = 1 ] || { echo "ramen-agents runs on macOS only for now (this is $(uname -s))."; exit 1; } ;; esac
MODE=update
case "${1:-}" in
  "") ;;
  --check) MODE=check ;;
  --rollback) MODE=rollback ;;
  *) echo "usage: sh scripts/update.sh [--check | --rollback]"; exit 1 ;;
esac
# this folder: where the script lives, or ~/bots when it is read from a pipe (an old checkout's first update)
if [ -f "$(dirname "$0")/update.sh" ] && [ -d "$(dirname "$0")/../.git" ]; then cd "$(dirname "$0")/.."; else cd "${RAMEN_FLEET:-$HOME/bots}"; fi
ROOT=$(pwd)
ENGINE="${RAMEN_ENGINE:-$HOME/Projects/bot}"
NO_INSTALL="${RAMEN_UPDATE_NO_INSTALL:-0}"   # tests: skip the reinstall and the restarts
PY="$ENGINE/.venv/bin/python"; [ -x "$PY" ] || PY=python3
TMPD=$(mktemp -d "${TMPDIR:-/tmp}/ramen-update.XXXXXX"); trap 'rm -rf "$TMPD"' EXIT
export RAMEN_UPDATE_TMP="$TMPD" RAMEN_ROOT="$ROOT"
: > "$TMPD/reapplied.txt"; : > "$TMPD/set_aside.txt"; : > "$TMPD/new.txt"
STEPS="$ROOT/scripts/update_steps.py"       # replaced below by the version about to be pulled when that one is newer
steps() { "$PY" "$STEPS" "$@"; }
has_engine() { [ -d "$ENGINE/.git" ]; }
head_of() { git -C "$1" rev-parse --short HEAD; }
engine_head() { if has_engine; then head_of "$ENGINE"; fi; }
SET_ASIDE=common-data/local/before-update/last-set-aside.json   # the last update's edited cards and pages, with their patches

reinstall() {
  [ "$NO_INSTALL" = 1 ] && return 0
  sh scripts/install.sh | sed -n '/STOP/p;/done/p' || true
  launchctl kickstart -k "gui/$(id -u)/com.ramen-agents.bot-dashboard" 2>/dev/null && echo "  ok       the dashboard restarted" || echo "  note     the dashboard is not installed as a launch agent: sh scripts/setup.sh starts it"
  if [ -s common-data/local/members.txt ]; then
    for m in $(cat common-data/local/members.txt); do
      [ -f "$m/config.toml" ] || continue
      "$ENGINE/.venv/bin/bot" --config "$ROOT/$m/config.toml" check >/dev/null 2>&1 && "$ENGINE/.venv/bin/bot" --config "$ROOT/$m/config.toml" install >/dev/null 2>&1 \
        && echo "  ok       $m restarted" || echo "  !!       $m: $ENGINE/.venv/bin/bot --config $ROOT/$m/config.toml check"
    done
  fi
}

# ---- --rollback: both folders back to the heads the last update started from ---------------------------------------
back_to() {   # <folder> <head>: uncommitted work is stashed and put back on top; ignored files (keys, local values, data) are never touched
  dir=$1; to=$2
  [ -n "$to" ] || return 0
  if [ "$(head_of "$dir")" = "$to" ]; then echo "  ok       $dir is already at $to"; return 0; fi
  stashed=0
  if ! git -C "$dir" diff --quiet HEAD 2>/dev/null; then git -C "$dir" stash push -q -m "ramen-agents rollback" && stashed=1; fi
  git -C "$dir" reset -q --hard "$to" || { echo "  STOP     $dir could not go back to $to: git -C $dir status"; return 1; }
  if [ "$stashed" = 1 ] && ! git -C "$dir" stash pop -q 2>/dev/null; then
    git -C "$dir" checkout -q -- . 2>/dev/null || true
    echo "  note     your uncommitted changes in $dir did not fit the older version: they are kept in git -C $dir stash list"
  fi
  echo "  ok       $dir: back at $to"
}

if [ "$MODE" = rollback ]; then
  echo "ramen-agents rollback ($ROOT)"
  # the version you go back to may not have the helpers yet: keep a copy of today's for the steps after the reset
  [ -f "$STEPS" ] || { echo "  STOP     scripts/update_steps.py is missing: git -C $ROOT status"; exit 1; }
  cp "$STEPS" "$TMPD/update_steps.py"; STEPS="$TMPD/update_steps.py"
  heads=$(steps heads) || { echo "  STOP     no common-data/local/last-update.json: there is no update to go back from"; exit 1; }
  fb=${heads% *}; eb=${heads#* }
  [ -n "$fb" ] || { echo "  STOP     last-update.json names no starting point"; exit 1; }
  back_to "$ROOT" "$fb" || exit 1
  if has_engine && [ -n "$eb" ]; then back_to "$ENGINE" "$eb" || exit 1; fi
  if [ -s "$SET_ASIDE" ] && [ "$(tr -d ' \n' < "$SET_ASIDE")" != "[]" ] && git diff --quiet HEAD; then
    steps reapply "$SET_ASIDE"          # your set-aside edits were made against this version: they go on again
  fi
  reinstall
  steps record rolled-back "$(head_of "$ROOT")" "$(head_of "$ROOT")" "$(engine_head)" "$(engine_head)" "$TMPD/reapplied.txt" "$TMPD/set_aside.txt" "$TMPD/new.txt"
  echo "  done     both folders are where the last update started (common-data/local/last-update.json)"
  exit 0
fi

# ---- where updates come from: the remote named `starter` (also once you push to an `origin` of your own) -----------
if git remote | grep -qx starter; then FROM="starter fleet"; UP=starter/fleet; else FROM=""; UP=""; fi
git fetch -q ${FROM%% *} || { echo "  STOP     could not reach the starter (git fetch): are you online?"; exit 1; }
[ -n "$UP" ] || UP=$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null) || { echo "  STOP     no remote named starter and no upstream: git remote add starter https://github.com/reBuzz-llc/ramen-agents"; exit 1; }
EFROM=""; EUP=""
if has_engine; then
  if git -C "$ENGINE" remote | grep -qx starter; then EFROM="starter engine"; EUP=starter/engine; fi
  git -C "$ENGINE" fetch -q ${EFROM%% *} || { echo "  STOP     could not reach the starter for the engine (git -C $ENGINE fetch)"; exit 1; }
  [ -n "$EUP" ] || EUP=$(git -C "$ENGINE" rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null) || EUP=""
fi
# the newest helpers and migration (an old checkout may have none yet): from the version about to be pulled
if [ ! -f "$STEPS" ] || ! git diff --quiet HEAD "$UP" -- scripts/update_steps.py 2>/dev/null; then
  git show "$UP:scripts/update_steps.py" > "$TMPD/update_steps.py" 2>/dev/null && STEPS="$TMPD/update_steps.py"
fi
# the setup check as the new version words it, so "before" and "after" compare like with like
CHECK_NEW=""
git show "$UP:scripts/setup-check.py" > "$TMPD/setup-check.py" 2>/dev/null && CHECK_NEW="$TMPD/setup-check.py"
MIG="$ROOT/scripts/migrate_local.py"
if [ ! -f "$MIG" ] || ! git diff --quiet HEAD "$UP" -- scripts/migrate_local.py 2>/dev/null; then
  MIG="$TMPD/migrate_local.py"
  git show "$UP:scripts/migrate_local.py" > "$MIG"
fi
# against the starter's version you last took, so edits you committed (to a repository of your own) are lifted too
BASE=$(git merge-base HEAD "$UP" 2>/dev/null || echo HEAD)
before=$(head_of "$ROOT"); ebefore=$(engine_head)
eup_head() { if [ -n "$EUP" ]; then git -C "$ENGINE" rev-parse --short "$EUP"; fi; }

# ---- --check: what an update would bring; nothing is changed ---------------------------------------------------------
if [ "$MODE" = check ]; then
  echo "ramen-agents update --check ($ROOT): nothing is changed"
  echo "  this folder: $(git rev-list --count "HEAD..$UP") new commit(s) ($before -> $(git rev-parse --short "$UP"))"
  if [ -n "$EUP" ]; then echo "  the engine: $(git -C "$ENGINE" rev-list --count "HEAD..$EUP") new commit(s) ($ebefore -> $(eup_head))"; fi
  echo "What it brings"
  steps changes HEAD "$UP" "$ENGINE" "$ebefore" "$(eup_head)"
  echo "What it would lift or set aside (your values stay in effect)"
  RAMEN_BASE="$BASE" "$PY" "$MIG" --dry-run
  exit 0
fi

# ---- the update --------------------------------------------------------------------------------------------------
echo "ramen-agents update ($ROOT)"
steps missing $CHECK_NEW > "$TMPD/before.txt" 2>/dev/null || true
fail() {   # <line>: record the failure, say it, and offer the rollback when a folder already moved
  steps record failed "$before" "$(head_of "$ROOT")" "$ebefore" "$(engine_head)" "$TMPD/reapplied.txt" "$TMPD/set_aside.txt" "$TMPD/new.txt"
  echo "  STOP     $1"
  if [ "$(head_of "$ROOT")" != "$before" ] || [ "$(engine_head)" != "$ebefore" ]; then
    echo "           a folder already moved: sh scripts/update.sh --rollback returns both to where they were"
  fi
  exit 1
}

echo "1. Your own values, out of the tracked files"
mig=$(RAMEN_BASE="$BASE" "$PY" "$MIG") || fail "the migration of your values did not finish; nothing was pulled"
printf '%s\n' "$mig"
if [ -f common-data/local/before-update/set-aside.json ]; then cp common-data/local/before-update/set-aside.json "$SET_ASIDE"; fi

echo "2. The newest version"
# a fast-forward; with commits of your own, a merge (never a rebase: your pushed history stays as it is)
git pull -q --ff-only --autostash $FROM 2>/dev/null || git pull -q --no-rebase --no-edit --autostash $FROM || fail "the pull did not apply cleanly: git status says what; then run this again"
echo "  ok       this folder: $before -> $(head_of "$ROOT")"
if has_engine; then
  git -C "$ENGINE" pull -q --ff-only --autostash $EFROM 2>/dev/null || git -C "$ENGINE" pull -q --no-rebase --no-edit --autostash $EFROM || fail "the engine's pull did not apply: git -C $ENGINE status"
  echo "  ok       the engine: $ebefore -> $(head_of "$ENGINE")"
fi
# the new version's migration may know more (a renamed setting): once more, quietly
RAMEN_BASE="$(git merge-base HEAD "$UP" 2>/dev/null || echo HEAD)" "$PY" scripts/migrate_local.py >/dev/null || true

echo "3. Your edits, on the new files"
if [ -s "$SET_ASIDE" ] && [ "$(tr -d ' \n' < "$SET_ASIDE")" != "[]" ]; then
  steps reapply "$SET_ASIDE"
else
  echo "  ok       no edited card or page to put back"
fi

if [ "$NO_INSTALL" != 1 ]; then echo "4. Reinstall and restart"; reinstall; fi

echo "5. The setup check (python3 scripts/setup-check.py)"
steps missing > "$TMPD/after.txt" 2>/dev/null || true
steps new-missing "$TMPD/before.txt" "$TMPD/after.txt" > "$TMPD/new.txt"
# the dashboard, the search and the members were just restarted: a line counts as new only if it is still missing after
# they had time to come up (RAMEN_UPDATE_SETTLE seconds, 60 by default, asked again every 10)
settle="${RAMEN_UPDATE_SETTLE:-60}"
while [ -s "$TMPD/new.txt" ] && [ "$settle" -gt 0 ]; do
  [ "$settle" = "${RAMEN_UPDATE_SETTLE:-60}" ] && echo "  wait     something is missing since the update; asking again for up to ${RAMEN_UPDATE_SETTLE:-60} s while the services start"
  sleep 10; settle=$((settle - 10))
  steps missing > "$TMPD/after.txt" 2>/dev/null || true
  steps new-missing "$TMPD/before.txt" "$TMPD/after.txt" > "$TMPD/new.txt"
done
if [ -s "$TMPD/after.txt" ]; then sed 's/^/  missing  /' "$TMPD/after.txt"; else echo "  ok       nothing is missing"; fi
code=0
if [ -s "$TMPD/new.txt" ]; then
  code=2
  echo "  !!       missing since this update:"
  sed 's/^/             /' "$TMPD/new.txt"
  echo "           sh scripts/update.sh --rollback returns both folders to where they were ($before, ${ebefore:-no engine})"
fi
result=ok; [ "$code" = 0 ] || result=failed
steps record "$result" "$before" "$(head_of "$ROOT")" "$ebefore" "$(engine_head)" "$TMPD/reapplied.txt" "$TMPD/set_aside.txt" "$TMPD/new.txt"

echo "6. What changed"
steps changes "$before" "$(head_of "$ROOT")" "$ENGINE" "$ebefore" "$(engine_head)"
if [ -s common-data/keys/notion.key ] || printf '%s' "$mig" | grep -q -i notion; then
  echo "  note     Notion is no longer used: your leads, tasks and packages live on the dashboard's boards (http://127.0.0.1:3000/boards)."
  echo "           To bring old leads over: in Notion, export the Leads board as CSV (Markdown & CSV), then Boards -> Leads -> Import CSV."
  echo "           A filled cell is never overwritten; columns that match nothing are listed. common-data/keys/notion.key can be deleted."
fi
if git status --porcelain --untracked-files=no | grep -q .; then
  if [ -s "$TMPD/reapplied.txt" ]; then echo "  ok       your re-applied edits show in git status; the next update sets them aside and applies them again"
  else echo "  note     tracked files still differ: git status"; fi
else
  echo "  ok       git status is clean"
fi
echo "  done     common-data/local/last-update.json has the heads and what was kept"
exit $code
