#!/bin/sh
# Render the launch-agent templates in ~/bots/launchd for THIS Mac and load them.
#   sh scripts/install-launchd.sh                 # everything, plus a data server per bot folder
#   sh scripts/install-launchd.sh --dry-run       # show what would be written, change nothing
#   sh scripts/install-launchd.sh searxng ollama  # only the named ones (the part after "com.ramen-agents.")
# Safe to run again: an agent that is already loaded is replaced. Bots' run loops are installed separately with
#   ~/Projects/bot/.venv/bin/bot --config ~/bots/<bot>/config.toml install
set -eu
cd "$(dirname "$0")/.."
ROOT=$(pwd)
DEST="$HOME/Library/LaunchAgents"
UID_N=$(id -u)
DRY=0
ONLY=""
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY=1 ;;
    *) ONLY="$ONLY $arg" ;;
  esac
done
NODE=$(command -v node 2>/dev/null || echo /usr/local/bin/node)
[ "$ROOT" = "$HOME/bots" ] || echo "note: this folder is $ROOT; the configs expect the fleet at $HOME/bots" >&2

wanted() {  # $1 = short name, e.g. "searxng" or "data.lead-gen"
  [ -z "$ONLY" ] && return 0
  for w in $ONLY; do [ "$w" = "$1" ] && return 0; done
  return 1
}

render() {  # $1 = template, $2 = label, $3 = slug (may be empty)
  out="$DEST/$2.plist"
  if [ "$DRY" = 1 ]; then echo "would write $out"; return 0; fi
  mkdir -p "$DEST" "$ROOT/common-data/logs" "$ROOT/common-data/shared-state" "$ROOT/webapp/logs"
  sed -e "s|__HOME__|$HOME|g" -e "s|__NODE__|$NODE|g" -e "s|__SLUG__|$3|g" "$1" > "$out"
  plutil -lint "$out" >/dev/null
  launchctl bootout "gui/$UID_N/$2" 2>/dev/null || true
  launchctl bootstrap "gui/$UID_N" "$out" && echo "loaded $2"
}

for tpl in launchd/com.ramen-agents.*.plist.template; do
  base=$(basename "$tpl" .plist.template)
  [ "$base" = "com.ramen-agents.data.SLUG" ] && continue
  short=${base#com.ramen-agents.}
  wanted "$short" && render "$tpl" "$base" ""
done

# One data server per bot folder that has a config with a [dashboard] port and is a browsing bot.
for cfg in */config.toml; do
  slug=$(dirname "$cfg")
  grep -q "not_a_bot_run_agent" "$cfg" && continue
  grep -q "^\[dashboard\]" "$cfg" || continue
  if wanted "data.$slug"; then
    [ "$DRY" = 1 ] || mkdir -p "$ROOT/$slug/workspace/logs"
    render launchd/com.ramen-agents.data.SLUG.plist.template "com.ramen-agents.data.$slug" "$slug"
  fi
done
