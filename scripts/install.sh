#!/bin/sh
# Everything ramen-agents needs on this Mac, checked and installed in order. Safe to run again: each step
# says "ok" when it is already done and changes nothing then. One line per step; a step that needs you stops with the one
# command to run, and you run this again after it.
#
#   sh scripts/install.sh            # then: sh scripts/setup.sh (your family, a few questions)
#
# What it does, in order:
#   1. macOS with the Xcode command line tools and Homebrew (it stops and says how, if one is missing)
#   2. Python 3.11+ and Node.js 20+ (installed with Homebrew when missing)
#   3. the engine: a clone at ~/Projects/bot (the `engine` branch), its Python environment, the agents' browser
#   4. this folder: the private keys folder, the board's three keys, the state link, the commit hook, search settings
#   5. the keyless search engine (SearXNG) in ~/.local/opt/searxng
#   6. the dashboard: its packages and a build
# It never asks for a key, never signs in to anything, never starts a paid plan and never edits a tracked file.
# The model keys are yours to add (sh scripts/add-key.sh <provider>); sh scripts/setup.sh asks the rest.
set -eu
. "$(dirname "$0")/read-only-guard.sh"     # the copy on the main branch is for reading: stop here

ok() { printf '  ok       %s\n' "$*"; }
did() { printf '  done     %s\n' "$*"; }
stop() { printf '  STOP     %s\n' "$*"; printf '\nFix the line above, then run sh scripts/install.sh again.\n'; exit 1; }

case "$(uname -s)" in
  Darwin) ;;
  *) echo "ramen-agents installs on macOS only for now (this is $(uname -s)). Linux and Windows (WSL) come later."; exit 1 ;;
esac

cd "$(dirname "$0")/.."
ROOT=$(pwd)
ENGINE="${RAMEN_ENGINE:-$HOME/Projects/bot}"
ENGINE_REPO="${RAMEN_ENGINE_REPO:-https://github.com/reBuzz-llc/ramen-agents}"
export PLAYWRIGHT_SKIP_BROWSER_GC=1 # never let Playwright clean up a browser another install uses
echo "ramen-agents install ($ROOT)"

echo "1. This Mac"
[ "$ROOT" = "$HOME/bots" ] && ok "this folder is ~/bots" || stop "this folder is $ROOT; the configs expect ~/bots: move it there (mv \"$ROOT\" ~/bots)"
xcode-select -p >/dev/null 2>&1 && ok "Xcode command line tools" || stop "the Xcode command line tools: run  xcode-select --install  and finish the window it opens"
if command -v brew >/dev/null 2>&1; then ok "Homebrew"; else
  for b in /opt/homebrew/bin/brew /usr/local/bin/brew; do [ -x "$b" ] && eval "$("$b" shellenv)"; done
  command -v brew >/dev/null 2>&1 && ok "Homebrew (not on PATH in this shell: add  eval \"\$($(command -v brew) shellenv)\"  to ~/.zprofile)" \
    || stop "Homebrew: run  /bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\"  (it asks for your password)"
fi

echo "2. Python and Node.js"
PY=""
for c in python3.13 python3.12 python3.11 python3; do
  p=$(command -v "$c" 2>/dev/null || true)
  [ -n "$p" ] && "$p" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)' 2>/dev/null && { PY=$p; break; }
done
if [ -z "$PY" ]; then
  brew install python@3.12 >/dev/null && PY=$(brew --prefix python@3.12)/bin/python3.12 && did "Python 3.12 (Homebrew)"
else ok "Python $("$PY" -c 'import platform; print(platform.python_version())') ($PY)"; fi
if command -v node >/dev/null 2>&1 && node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)'; then ok "Node.js $(node --version)"
else brew install node >/dev/null && did "Node.js $(node --version) (Homebrew)"; fi

echo "3. The engine ($ENGINE)"
if [ -d "$ENGINE/.git" ]; then ok "the engine's clone"
else mkdir -p "$(dirname "$ENGINE")" && git clone -q -b engine -o starter "$ENGINE_REPO" "$ENGINE" && did "cloned the engine (branch engine)"; fi
[ -x "$ENGINE/.venv/bin/python" ] || { "$PY" -m venv "$ENGINE/.venv" && did "the engine's Python environment"; }
"$ENGINE/.venv/bin/pip" install -q --disable-pip-version-check -e "$ENGINE[dev]" && ok "the engine's packages"
if ls "$HOME/Library/Caches/ms-playwright" 2>/dev/null | grep -q '^chromium'; then ok "the agents' browser (Chromium)"
else "$ENGINE/.venv/bin/playwright" install chromium >/dev/null && did "the agents' browser (Chromium)"; fi

echo "4. This folder"
mkdir -p common-data/keys common-data/shared-state common-data/logs common-data/botBox/routed common-data/configs the-ceo/raw webapp/logs
chmod 700 common-data/keys
ok "folders (common-data/keys is private: only you can read it)"
for k in portal-engine portal-validator portal-dashboard; do
  f="common-data/keys/$k.key"
  if [ -s "$f" ]; then ok "the board's key $k"
  else (umask 077 && openssl rand -base64 33 | tr -d '/+=\n' > "$f") && did "the board's key $k (made here, never leaves this Mac)"; fi
done
if [ -L "$HOME/.config/explorer" ]; then ok "state link (~/.config/explorer)"
elif [ -e "$HOME/.config/explorer" ]; then stop "~/.config/explorer exists and is not a link: move its files into common-data/shared-state, remove it, run again"
else mkdir -p "$HOME/.config" && ln -s "$ROOT/common-data/shared-state" "$HOME/.config/explorer" && did "state link (~/.config/explorer -> common-data/shared-state)"; fi
if [ -d .git ]; then git config core.hooksPath .githooks && ok "commit hook (a staged key or database is refused)"; fi
SX="$HOME/.local/etc/searxng/settings.yml"
if [ -e "$SX" ]; then ok "search settings ($SX)"
else
  mkdir -p "$(dirname "$SX")" "$HOME/.local/var/searxng"
  sed "s|FILL-ME-GENERATED-BY-SETUP|$(openssl rand -hex 32)|" common-data/configs/searxng-settings.yml > "$SX" && chmod 600 "$SX" && did "search settings with a fresh secret"
fi

echo "5. Keyless search (SearXNG)"
SXD="$HOME/.local/opt/searxng"
if [ -d "$SXD/src/.git" ]; then ok "SearXNG's clone"; else git clone -q --depth 1 https://github.com/searxng/searxng "$SXD/src" && did "cloned SearXNG"; fi
[ -x "$SXD/venv/bin/python" ] || { "$PY" -m venv "$SXD/venv" && did "SearXNG's Python environment"; }
"$SXD/venv/bin/pip" install -q --disable-pip-version-check -r "$SXD/src/requirements.txt" && ok "SearXNG's packages"

echo "6. The dashboard"
if [ -d webapp/node_modules ] && [ webapp/node_modules/.package-lock.json -nt webapp/package-lock.json ]; then ok "the dashboard's packages"
else (cd webapp && npm ci --no-audit --no-fund --no-update-notifier --loglevel=error >/dev/null) && did "the dashboard's packages"; fi
if [ -f webapp/.next/BUILD_ID ] && [ -z "$(find webapp/app webapp/lib -newer webapp/.next/BUILD_ID -type f 2>/dev/null | head -1)" ]; then ok "the dashboard's build"
else (cd webapp && npm run build >"$ROOT/common-data/logs/dashboard-build.log" 2>&1) && did "the dashboard's build" || stop "the dashboard's build failed: see common-data/logs/dashboard-build.log"; fi

echo
echo
echo "Installed. Next: sh scripts/setup.sh   (your family: a few questions, a model key, then it starts)"
