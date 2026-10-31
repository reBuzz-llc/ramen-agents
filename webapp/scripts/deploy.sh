#!/bin/sh
# Rebuild and restart the dashboard without taking it down (2026-10-05: a build that failed on a typo left it down,
# and every rebuild removed the live .next before the new one existed).
#
#   1. type-check and lint;
#   2. build into .next-staging while the live dashboard keeps serving .next;
#   3. start the staged build on a spare port and check a few pages;
#   4. swap: .next -> .next-previous, .next-staging -> .next, restart the launch agent;
#   5. check the live dashboard; if it does not answer, swap back and restart again.
# Any failure before step 4 leaves the live dashboard exactly as it was.
#
#   sh ~/bots/webapp/scripts/deploy.sh        (or: npm run deploy)
set -eu
cd "$(dirname "$0")/.."
LABEL="gui/$(id -u)/com.ramen-agents.bot-dashboard"
PROBE_PORT=3099
PAGES="/ /work-plan /settings/providers /settings/reports /api/board"

say() { printf '%s\n' "deploy: $*"; }
fail() { say "FAILED: $* (the live dashboard was not touched)"; exit 1; }

say "type-check and lint"
npx tsc --noEmit -p . || fail "type errors"
npx eslint app lib >/dev/null || fail "lint errors (run: npx eslint app lib)"

say "build into .next-staging"
rm -rf .next-staging
NEXT_DIST_DIR=.next-staging npx next build >/tmp/dashboard-build.log 2>&1 || { tail -20 /tmp/dashboard-build.log; fail "build"; }

say "check the staged build on port $PROBE_PORT"
NEXT_DIST_DIR=.next-staging npx next start -H 127.0.0.1 -p "$PROBE_PORT" >/tmp/dashboard-probe.log 2>&1 &
PROBE=$!
ok=1
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
  curl -s -o /dev/null "http://127.0.0.1:$PROBE_PORT/api/bots" && break
  sleep 1
done
for p in $PAGES; do
  code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PROBE_PORT$p")
  [ "$code" = 200 ] || { say "$p answered $code"; ok=0; }
done
kill "$PROBE" 2>/dev/null || true
pkill -f "next start -H 127.0.0.1 -p $PROBE_PORT" 2>/dev/null || true
[ "$ok" = 1 ] || fail "the staged build did not serve every page"

say "swap in the new build and restart"
rm -rf .next-previous
[ -d .next ] && mv .next .next-previous
mv .next-staging .next
launchctl kickstart -k "$LABEL"

live=0
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
  sleep 1
  [ "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/api/bots)" = 200 ] && { live=1; break; }
done
if [ "$live" = 1 ]; then
  say "live and answering; the previous build is kept in .next-previous"
else
  say "the new build did not come up: rolling back"
  rm -rf .next-failed
  mv .next .next-failed
  [ -d .next-previous ] && mv .next-previous .next
  launchctl kickstart -k "$LABEL"
  fail "rolled back to the previous build (the failed one is in .next-failed)"
fi
