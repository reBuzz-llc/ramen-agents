#!/bin/sh
# Copy the live launch agents into the repo so they are versioned with the configs they run.
. "$(dirname "$0")/read-only-guard.sh"     # the copy on the main branch is for reading: stop here
set -eu
cd "$(dirname "$0")/.."
cp "$HOME"/Library/LaunchAgents/com.ramen-agents.*.plist launchd/
git status --short launchd/
