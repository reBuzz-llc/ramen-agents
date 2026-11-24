#!/bin/sh
# Add one key, safely: it says where you make the key yourself, reads it without showing it, saves it as one line in
# common-data/keys/<provider>.key (only you can read it), then tests it with one free read (its models list or its
# account, never a call that could bill). Never prints a key.
#
#   sh scripts/add-key.sh zai           # any provider in common-data/providers.json that takes a key
#   sh scripts/add-key.sh --list        # every name it takes
#
# The list is common-data/providers.json, the one the dashboard's Settings -> Providers page reads too. One model key is
# enough to start (Z.ai, Groq or OpenRouter). A provider the owner found unusable, or the maintainers set aside, shows its
# reason first and asks before it takes a key; one that is not free says so and asks. Gemini goes only through this script:
# it shows Google's terms and asks first.
set -eu
case "$(uname -s)" in Darwin) ;; *) echo "ramen-agents runs on macOS only for now (this is $(uname -s))."; exit 1 ;; esac
cd "$(dirname "$0")/.."
name="${1:-}"
if [ -z "$name" ]; then
  echo "Which provider? sh scripts/add-key.sh zai   (or groq, openrouter; every name: sh scripts/add-key.sh --list)"; exit 2
fi
if [ "$name" = "--list" ]; then python3 scripts/setup-check.py --key-names; exit 0; fi
case "$name" in *[!a-z0-9-]*) echo "unknown provider: $name"; exit 2 ;; esac
if ! info=$(python3 scripts/setup-check.py --key-info "$name"); then
  echo "unknown provider, or one that takes no key: $name (every name: sh scripts/add-key.sh --list)"; exit 2
fi
US=$(printf '\037')
IFS="$US" read -r who where free card mark mark_by mark_date mark_note testable hint <<INFO
$info
INFO
ask() {   # a question with no answer, or no terminal to answer it, is a no
  ans=""
  if [ -t 0 ]; then printf "%s [y/N] " "$1"; IFS= read -r ans || ans=""; fi
  case "$ans" in y|Y|yes|Yes) return 0 ;; *) return 1 ;; esac
}
case "$mark" in
  unusable|rejected)
    if [ "$mark" = unusable ]; then echo "$who is marked unusable (by the $mark_by, $mark_date): $mark_note"
    else echo "$who was set aside by the maintainers ($mark_date): $mark_note"; fi
    ask "Add a $name key anyway?" || { echo "No key saved."; exit 0; } ;;
esac
if [ "$free" != yes ]; then
  echo "$who needs a card or payment: ${card:-its free use is not stated}"
  ask "Go on and add a $name key?" || { echo "No key saved."; exit 0; }
fi
if [ "$name" = gemini ]; then
  # Google's own words, so the choice is made with them in front of you. No answer means no.
  echo "Google's terms for the free Gemini tier (https://ai.google.dev/gemini-api/terms) say:"
  echo '  "human reviewers may read, annotate, and process your API input and output."'
  echo '  "Do not submit sensitive, confidential, or personal information to the Unpaid Services."'
  echo "The agents hide a lead's email, phone and known contact name before each call. A name not yet on a row, or an"
  echo "address written out in words, can still go through. Calls that look for new contacts never go to Gemini."
  ans=""
  if [ -t 0 ]; then printf "Use Gemini for calls that carry lead data? [y/N] "; IFS= read -r ans || ans=""; fi
  case "$ans" in
    y|Y|yes|Yes) ;;
    *) python3 scripts/gemini_choice.py close || true
       echo "Gemini stays off for lead data, and no key was saved. Z.ai, Groq and OpenRouter work without this choice."
       exit 0 ;;
  esac
fi
mkdir -p common-data/keys && chmod 700 common-data/keys
f="common-data/keys/$name.key"
echo "Make the $who key yourself, at: ${where:-its own site}"
[ -n "$card" ] && echo "  $card"
[ -s "$f" ] && echo "(a $name key is already on file; a new one replaces it)"
if [ -t 0 ]; then
  # Ctrl-C at the prompt: the terminal gets its echo back, and nothing is saved
  trap 'stty echo; echo; exit 130' INT TERM
  stty -echo      # before the prompt, so a key pasted the moment it shows is never echoed
  printf "Paste the key (it is not shown) and press Return: "
  IFS= read -r key || key=""; stty echo; echo
  trap - INT TERM
else
  IFS= read -r key || key=""
fi
key=$(printf '%s' "$key" | tr -d ' \t\r\n')
[ -n "$key" ] || { echo "Nothing pasted: no key saved."; exit 1; }
(umask 077 && printf '%s\n' "$key" > "$f")
chmod 600 "$f"
echo "saved: $f (only you can read it; never in git)"
if [ "$name" = gemini ]; then
  if python3 scripts/gemini_choice.py open; then echo "Gemini may now take masked calls with lead data (common-data/configs/local.toml)."
  else echo "The key is saved, but Gemini stays closed to lead data: the choice could not be written."; fi
fi
[ -n "$hint" ] && echo "$hint"
if [ "$testable" != yes ]; then echo "test: saved, not tested ($who has no free read to test a key with)"; exit 0; fi
# the engine's Python carries certifi; a python.org Python without its certificates installed fails every HTTPS test
PY="${RAMEN_ENGINE:-$HOME/Projects/bot}/.venv/bin/python"
[ -x "$PY" ] || PY=python3
CA=$("$PY" -c 'import certifi; print(certifi.where())' 2>/dev/null || true)
res=$(SSL_CERT_FILE="${CA:-${SSL_CERT_FILE:-}}" "$PY" scripts/setup-check.py --test-key "$name" 2>/dev/null || true)
echo "test: ${res:-not run (python3 scripts/setup-check.py --probe tests every key)}"
