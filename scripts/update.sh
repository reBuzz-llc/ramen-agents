#!/bin/sh
# Take the starter's newest version on a Mac that is already set up (queue 572). Safe to run again.
#
#   sh scripts/update.sh
#
# On a checkout from before this script existed (no scripts/update.sh yet), run the new one straight from the starter:
#   cd ~/bots && git fetch starter && git show starter/fleet:scripts/update.sh | sh
#
# 1. Lifts your own values out of the tracked files, once (scripts/migrate_local.py): config values into the git-ignored
#    overlays (common-data/configs/local.toml, <member>/config.local.toml), your market and team into
#    common-data/local/family.toml, any other edited file into common-data/local/before-update/; old Notion settings are
#    moved or dropped, each one named. Then the tracked files match the repository again.
# 2. Pulls this folder (~/bots) and the engine (~/Projects/bot), keeping anything uncommitted aside and back (autostash).
# 3. Reinstalls what changed (sh scripts/install.sh), restarts the dashboard and the members, runs the setup check.
# 4. Prints what changed.
set -eu
case "$(uname -s)" in Darwin) ;; *) echo "ramen-agents runs on macOS only for now (this is $(uname -s))."; exit 1 ;; esac
# this folder: where the script lives, or ~/bots when it is read from a pipe (an old checkout's first update)
if [ -f "$(dirname "$0")/update.sh" ] && [ -d "$(dirname "$0")/../.git" ]; then cd "$(dirname "$0")/.."; else cd "${RAMEN_FLEET:-$HOME/bots}"; fi
ROOT=$(pwd)
ENGINE="${RAMEN_ENGINE:-$HOME/Projects/bot}"
NO_INSTALL="${RAMEN_UPDATE_NO_INSTALL:-0}"   # tests: skip the reinstall and the restarts
PY="$ENGINE/.venv/bin/python"; [ -x "$PY" ] || PY=python3
echo "ramen-agents update ($ROOT)"

before=$(git rev-parse --short HEAD)
ebefore=$( [ -d "$ENGINE/.git" ] && git -C "$ENGINE" rev-parse --short HEAD || echo "")

# updates come from the starter (the remote named `starter`), also once you push to an `origin` of your own
if git remote | grep -qx starter; then FROM="starter fleet"; UP=starter/fleet; else FROM=""; UP=""; fi
git fetch -q ${FROM%% *} || { echo "  STOP     could not reach the starter (git fetch): are you online?"; exit 1; }
[ -n "$UP" ] || UP=$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null) || { echo "  STOP     no remote named starter and no upstream: git remote add starter https://github.com/reBuzz-llc/ramen-agents"; exit 1; }

echo "1. Your own values, out of the tracked files"
# the newest migration (an old checkout has none yet): from the version about to be pulled, run against this folder
MIG="$ROOT/scripts/migrate_local.py"
if ! git diff --quiet HEAD "$UP" -- scripts/migrate_local.py 2>/dev/null || [ ! -f "$MIG" ]; then
  MIG="${TMPDIR:-/tmp}/ramen-migrate-local.py"
  git show "$UP:scripts/migrate_local.py" > "$MIG"
fi
# against the starter's version you last took, so edits you committed (to a repository of your own) are lifted too
BASE=$(git merge-base HEAD "$UP" 2>/dev/null || echo HEAD)
mig=$(RAMEN_ROOT="$ROOT" RAMEN_BASE="$BASE" "$PY" "$MIG")
printf '%s\n' "$mig"

echo "2. The newest version"
# a fast-forward; with commits of your own, a merge (never a rebase: your pushed history stays as it is)
git pull -q --ff-only --autostash $FROM 2>/dev/null || git pull -q --no-rebase --no-edit --autostash $FROM || { echo "  STOP     the pull did not apply cleanly: git status says what; then run this again"; exit 1; }
echo "  ok       this folder: $before -> $(git rev-parse --short HEAD)"
if [ -d "$ENGINE/.git" ]; then
  EFROM=""; git -C "$ENGINE" remote | grep -qx starter && EFROM="starter engine"
  git -C "$ENGINE" pull -q --ff-only --autostash $EFROM 2>/dev/null || git -C "$ENGINE" pull -q --no-rebase --no-edit --autostash $EFROM || { echo "  STOP     the engine's pull did not apply: git -C $ENGINE status"; exit 1; }
  echo "  ok       the engine: $ebefore -> $(git -C "$ENGINE" rev-parse --short HEAD)"
fi
# the new version's migration may know more (a renamed setting): once more, quietly
RAMEN_ROOT="$ROOT" RAMEN_BASE="$(git merge-base HEAD "$UP" 2>/dev/null || echo HEAD)" "$PY" scripts/migrate_local.py >/dev/null

if [ "$NO_INSTALL" != 1 ]; then
  echo "3. Reinstall and restart"
  sh scripts/install.sh | sed -n '/STOP/p;/done/p' || true
  launchctl kickstart -k "gui/$(id -u)/com.ramen-agents.bot-dashboard" 2>/dev/null && echo "  ok       the dashboard restarted" || echo "  note     the dashboard is not installed as a launch agent: sh scripts/setup.sh starts it"
  if [ -s common-data/local/members.txt ]; then
    for m in $(cat common-data/local/members.txt); do
      [ -f "$m/config.toml" ] || continue
      "$ENGINE/.venv/bin/bot" --config "$ROOT/$m/config.toml" check >/dev/null 2>&1 && "$ENGINE/.venv/bin/bot" --config "$ROOT/$m/config.toml" install >/dev/null 2>&1 \
        && echo "  ok       $m restarted" || echo "  !!       $m: $ENGINE/.venv/bin/bot --config $ROOT/$m/config.toml check"
    done
  fi
  sh scripts/check-setup.sh >/dev/null 2>&1 && echo "  ok       setup check: ready" || echo "  note     setup check: sh scripts/check-setup.sh says what is left"
fi

echo "4. What changed"
git log --no-merges --format='  %h %s' "$before..HEAD" | cut -c1-140 | head -20
[ -n "$ebefore" ] && git -C "$ENGINE" log --no-merges --format='  engine %h %s' "$ebefore..HEAD" | cut -c1-140 | head -10
if [ -s common-data/keys/notion.key ] || printf '%s' "$mig" | grep -q -i notion; then
  echo "  note     Notion is no longer used: your leads, tasks and packages live on the dashboard's boards (http://127.0.0.1:3000/boards)."
  echo "           To bring old leads over: in Notion, export the Leads board as CSV (Markdown & CSV), then Boards -> Leads -> Import CSV."
  echo "           A filled cell is never overwritten; columns that match nothing are listed. common-data/keys/notion.key can be deleted."
fi
git status --porcelain --untracked-files=no | grep -q . && echo "  note     tracked files still differ: git status" || echo "  ok       git status is clean"
