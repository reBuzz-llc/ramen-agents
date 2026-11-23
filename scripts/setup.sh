#!/bin/sh
# Your family, set up in a few questions. Run it after sh scripts/install.sh; run it again any time to
# change an answer (the current one is the default: press Return to keep it).
#
#   sh scripts/setup.sh                       # the questions, then it starts the family and opens the dashboard
#   sh scripts/setup.sh --answers <file>      # the same from a filled-in family.toml (an AI agent, a second Mac)
#   sh scripts/setup.sh --no-start            # write the answers only
#
# The answers go to common-data/local/family.toml, which git ignores: never a tracked file, so `git pull` (and
# sh scripts/update.sh) never meets your edits. The dashboard's first-run page asks the same and writes the same file.
# It asks for no key itself: if you have no model key yet, it runs sh scripts/add-key.sh for one (one is enough).
# The members chosen are started by installing their launch agents; the others stay off because nothing starts them.
set -eu
. "$(dirname "$0")/read-only-guard.sh"     # the copy on the main branch is for reading: stop here
case "$(uname -s)" in Darwin) ;; *) echo "ramen-agents runs on macOS only for now (this is $(uname -s))."; exit 1 ;; esac
cd "$(dirname "$0")/.."
ROOT=$(pwd)
ENGINE="${RAMEN_ENGINE:-$HOME/Projects/bot}"
PY="$ENGINE/.venv/bin/python"
[ -x "$PY" ] || { echo "The engine is not installed yet: run sh scripts/install.sh first."; exit 1; }
FAMILY="common-data/local/family.toml"
mkdir -p common-data/local
START=1
ANSWERS=""
while [ $# -gt 0 ]; do
  case "$1" in
    --no-start) START=0 ;;
    --answers) shift; ANSWERS="${1:-}" ;;
    *) echo "unknown option: $1"; exit 2 ;;
  esac
  shift
done

if [ -n "$ANSWERS" ]; then
  [ -r "$ANSWERS" ] || { echo "no such file: $ANSWERS"; exit 2; }
  "$PY" - "$ANSWERS" <<'PY' || exit 1
import sys, tomllib
d = tomllib.loads(open(sys.argv[1], encoding="utf-8").read())
miss = [k for k in ("name", "sells", "buyers") if not str(d.get("company", {}).get(k, "")).strip()] + ([] if str(d.get("target", {}).get("market", "")).strip() else ["target.market"])
if miss: sys.exit("the answers file needs: " + ", ".join(miss))
PY
  [ "$(cd "$(dirname "$ANSWERS")" && pwd)/$(basename "$ANSWERS")" = "$ROOT/$FAMILY" ] || cp "$ANSWERS" "$FAMILY"
  chmod 600 "$FAMILY"
  echo "answers in $FAMILY"
else
  echo "Your family -- a few questions. Press Return to keep the value in [brackets]."
  echo
  # the current answers, as defaults
  eval "$("$PY" - "$FAMILY" <<'PY'
import sys, tomllib, shlex
try:
    d = tomllib.loads(open(sys.argv[1], encoding="utf-8").read())
except OSError:
    d = {}
c, t = d.get("company", {}), d.get("target", {})
team = (d.get("team") or [{}])[0]
v = {"NAME": c.get("name", ""), "SELLS": c.get("sells", ""), "BUYERS": c.get("buyers", ""), "PLACE": c.get("place", t.get("market", "")),
     "OWNER": c.get("owner", ""), "DOMAINS": ", ".join(c.get("own_domains", [])), "TRADES": t.get("trades", ""),
     "SEGMENT": t.get("segment", "small businesses"), "TEAMMATE": team.get("name", ""), "STEER": d.get("steer", "")}
for k, x in v.items():
    print(f"CUR_{k}={shlex.quote(str(x))}")
PY
)"
  ask() { # $1 variable, $2 question, $3 current
    printf '%s' "$2${3:+ [$3]}: "
    IFS= read -r ans || ans=""
    [ -n "$ans" ] || ans="$3"
    eval "$1=\$ans"
  }
  ask NAME "Your company's name" "$CUR_NAME"
  ask SELLS "What you sell, in one line (e.g. websites and online booking for small shops)" "$CUR_SELLS"
  ask BUYERS "Who buys it (e.g. restaurants, salons and clinics)" "$CUR_BUYERS"
  ask PLACE "Where your customers are (a city, a region or a country)" "$CUR_PLACE"
  ask SEGMENT "What kind of businesses, in two or three words" "$CUR_SEGMENT"
  ask TRADES "Their trades, comma-separated (e.g. restaurants, shops, clinics)" "${CUR_TRADES:-$BUYERS}"
  ask OWNER "Your name, as first emails are signed" "$CUR_OWNER"
  ask DOMAINS "Your own website's domain(s), comma-separated (Enter for none)" "$CUR_DOMAINS"
  ask TEAMMATE "Who on your team sends the emails (a first name; Enter for you)" "${CUR_TEAMMATE:-$OWNER}"
  ask STEER "Your direction for the agents, in one sentence (Enter to skip)" "$CUR_STEER"
  for v in NAME SELLS BUYERS PLACE; do eval "x=\$$v"; [ -n "$x" ] || { echo "\"$v\" is needed: run sh scripts/setup.sh again."; exit 1; }; done
  NAME="$NAME" SELLS="$SELLS" BUYERS="$BUYERS" PLACE="$PLACE" SEGMENT="$SEGMENT" TRADES="$TRADES" OWNER="$OWNER" DOMAINS="$DOMAINS" TEAMMATE="$TEAMMATE" STEER="$STEER" \
    "$PY" "$ROOT/scripts/family_answers.py" "$FAMILY"
fi

echo
echo "Model keys: one is enough to start."
have=0
for k in gemini groq zai openrouter; do [ -s "common-data/keys/$k.key" ] && have=1; done
if [ "$have" = 1 ]; then echo "  ok       a model key is on file"
elif [ -t 0 ]; then
  printf "  No model key yet. Add a free Z.ai key now? [Y/n] "
  IFS= read -r a || a=""
  case "$a" in n|N) echo "  later: sh scripts/add-key.sh zai (or groq, openrouter, gemini)";; *) sh scripts/add-key.sh zai || true ;; esac
else echo "  missing  no model key: sh scripts/add-key.sh zai (or groq, openrouter, gemini)"; fi

MEMBERS="the-ceo lead-gen package-designer"
OPTIONAL="research-analyst scout"
if [ -s common-data/local/members.txt ] && [ -n "$ANSWERS" ]; then MEMBERS=$(tr '\n' ' ' < common-data/local/members.txt)
elif [ -t 0 ]; then
  echo
  echo "Members: The CEO, Lead Gen and the Package Designer start by default (docs/your-family.md says what each does)."
  for m in $OPTIONAL; do
    printf "  Also start %s? [y/N] " "$m"
    IFS= read -r a || a=""
    case "$a" in y|Y|yes) MEMBERS="$MEMBERS $m" ;; esac
  done
fi
printf '%s\n' $MEMBERS > common-data/local/members.txt

echo
echo "Reach it from your phone or another computer (optional): docs/remote-access.md. With Tailscale signed in here:"
echo "  sh webapp/scripts/remote-access.sh"

if [ "$START" = 0 ]; then echo; echo "Answers saved. Start later: sh scripts/setup.sh"; exit 0; fi
echo
echo "Starting: the dashboard, search, the Validator, then $MEMBERS"
sh scripts/install-launchd.sh >/dev/null && echo "  ok       the always-on services (launchd)"
for m in $MEMBERS; do
  if "$ENGINE/.venv/bin/bot" --config "$ROOT/$m/config.toml" check >/dev/null 2>&1; then
    "$ENGINE/.venv/bin/bot" --config "$ROOT/$m/config.toml" install >/dev/null && echo "  ok       $m started"
  else
    echo "  !!       $m did not pass its check: $ENGINE/.venv/bin/bot --config $ROOT/$m/config.toml check"
  fi
done
sleep 3
sh scripts/check-setup.sh >/dev/null 2>&1 && echo "  ok       setup check: ready" || echo "  note     setup check: sh scripts/check-setup.sh says what is left"
open "http://127.0.0.1:3000" 2>/dev/null || true
echo
echo "Your family is starting. The dashboard: http://127.0.0.1:3000 (watch the first day; stop a member with its Stop button)."
