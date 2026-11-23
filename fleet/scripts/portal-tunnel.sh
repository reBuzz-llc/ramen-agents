#!/bin/bash
# The team's way to the portal in local mode: a Cloudflare quick tunnel (free, no account) from a random
# https://<words>.trycloudflare.com to the portal on 127.0.0.1:3100. launchd: com.ramen-agents.portal-tunnel (KeepAlive;
# installed only by name: sh scripts/install-launchd.sh portal-tunnel). The address changes on every start, so each one
# is written to common-data/shared-state/portal-local.json {"url", "since", "port"} for you to pass on to the team. With
# a Cloudflare account, a named tunnel keeps one fixed address. Only the portal's port is exposed, never the database.
set -u
BOTS="${BOTS_DIR:-$HOME/bots}"
PORT="${PORTAL_LOCAL_PORT:-3100}"
STATE="$BOTS/common-data/shared-state/portal-local.json"
CF="${CLOUDFLARED:-/opt/homebrew/bin/cloudflared}"
[ -x "$CF" ] || { echo "portal-tunnel: no $CF: brew install cloudflared"; exit 1; }

# record <url>: the address and when it came up (python3 writes the JSON safely)
record() {
  mkdir -p "$(dirname "$STATE")"
  PORTAL_LOCAL_PORT="$PORT" /usr/bin/python3 - "$STATE" "$1" <<'PY'
import json, os, sys, datetime
path, url = sys.argv[1:3]
tmp = path + ".tmp"
with open(tmp, "w") as f:
    json.dump({"url": url, "since": datetime.datetime.now().isoformat(timespec="seconds"), "port": int(os.environ.get("PORTAL_LOCAL_PORT", "3100"))}, f)
os.replace(tmp, path)
PY
  echo "portal-tunnel: $1"
}

# cloudflared logs to stderr; the first trycloudflare address it prints is the tunnel's.
"$CF" tunnel --no-autoupdate --url "http://127.0.0.1:$PORT" 2>&1 | while IFS= read -r line; do
  echo "$line"
  url="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' <<<"$line" | head -1)"
  [ -n "$url" ] && record "$url"
done
