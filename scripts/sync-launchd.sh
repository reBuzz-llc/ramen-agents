#!/bin/sh
# Copy the live launch agents into the repo so they are versioned with the configs they run.
set -eu
cd "$(dirname "$0")/.."
cp "$HOME"/Library/LaunchAgents/com.ramen-agents.*.plist launchd/
git status --short launchd/
