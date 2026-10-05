#!/bin/sh
# One-time local setup for a fresh clone. Safe to run again: it never overwrites a file that exists.
#   sh scripts/setup.sh
# It creates the folders git does not carry (keys, state, logs), links the engine's default state folder to
# common-data/shared-state, switches on the key-leak commit hook, and puts the local search tool's settings in place
# with a fresh secret. It installs no software and starts nothing: SETUP.md lists those steps.
set -eu
cd "$(dirname "$0")/.."
ROOT=$(pwd)
[ "$ROOT" = "$HOME/bots" ] || echo "WARNING: this folder is $ROOT. The configs expect the fleet at $HOME/bots; move it there." >&2

mkdir -p common-data/keys common-data/shared-state common-data/logs common-data/botBox/routed the-ceo/raw webapp/logs
chmod 700 common-data/keys
echo "folders ready (common-data/keys is private)"

if [ -L "$HOME/.config/explorer" ]; then
  echo "state link present: ~/.config/explorer -> $(readlink "$HOME/.config/explorer")"
elif [ -e "$HOME/.config/explorer" ]; then
  echo "NOTE: ~/.config/explorer exists and is not a link; the dashboard reads common-data/shared-state. Move its files there and link it by hand."
else
  mkdir -p "$HOME/.config"
  ln -s "$ROOT/common-data/shared-state" "$HOME/.config/explorer"
  echo "linked ~/.config/explorer -> common-data/shared-state"
fi

if [ -d .git ]; then
  git config core.hooksPath .githooks
  echo "commit hook on: a staged key or database is refused"
fi

SX="$HOME/.local/etc/searxng/settings.yml"
if [ -e "$SX" ]; then
  echo "search settings present: $SX (left alone)"
else
  mkdir -p "$(dirname "$SX")" "$HOME/.local/var/searxng"
  secret=$(openssl rand -hex 32)
  sed "s|FILL-ME-GENERATED-BY-SETUP|$secret|" common-data/configs/searxng-settings.yml > "$SX"
  chmod 600 "$SX"
  echo "search settings written with a fresh secret: $SX"
fi

echo
echo "Next: sh scripts/check-setup.sh   (what is still to fill in)"
