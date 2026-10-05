#!/bin/sh
# Make the dashboard reachable from your own devices through Tailscale, and only from them.
# Run once, after installing Tailscale on this Mac and signing in:  sh ~/bots/webapp/scripts/remote-access.sh
# Undo:  tailscale serve reset
set -eu
TS=""
for c in /Applications/Tailscale.app/Contents/MacOS/Tailscale /opt/homebrew/bin/tailscale /usr/local/bin/tailscale; do
  [ -x "$c" ] && TS="$c" && break
done
[ -n "$TS" ] || { echo "Tailscale is not installed. Install it from https://tailscale.com/download/mac and sign in, then run this again."; exit 1; }
"$TS" status >/dev/null 2>&1 || { echo "Tailscale is installed but not signed in. Open the Tailscale app, sign in, then run this again."; exit 1; }

curl -s -o /dev/null -m 5 http://127.0.0.1:3000/api/bots || {
  echo "The dashboard is not answering on 127.0.0.1:3000. Start it: launchctl kickstart gui/$(id -u)/com.rebuzz.bot-dashboard"; exit 1; }

# HTTPS on this Mac's tailnet name, forwarded to the dashboard. --bg keeps it after this shell and across reboots.
# If HTTPS certificates are off for your tailnet, this prints a link to turn them on; open it and run again.
"$TS" serve --bg --https=443 http://127.0.0.1:3000

NAME=$("$TS" status --json | /usr/bin/python3 -c 'import json,sys; print(json.load(sys.stdin)["Self"]["DNSName"].rstrip("."))')
USER=$("$TS" status --json | /usr/bin/python3 -c 'import json,sys; s=json.load(sys.stdin); print(s["User"][str(s["Self"]["UserID"])]["LoginName"])')
echo
echo "Dashboard: https://$NAME/"
echo "Allowed: $USER (the account this Mac is signed in with). Other tailnet users get 'Not allowed'."
echo "To allow more logins, add DASHBOARD_ALLOWED_USERS=\"you@example.com,other@example.com\" to the"
echo "EnvironmentVariables of ~/Library/LaunchAgents/com.rebuzz.bot-dashboard.plist, then:"
echo "  launchctl bootout gui/$(id -u)/com.rebuzz.bot-dashboard; launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.rebuzz.bot-dashboard.plist"
