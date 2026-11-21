#!/bin/sh
# Add one key, safely: it says where to get the free key, reads it without showing it, saves it as one line
# in common-data/keys/<provider>.key (only you can read it), then tests it with one read-only call. Never prints a key.
#
#   sh scripts/add-key.sh gemini        # or: groq, zai, openrouter,
#                                       #     quickemailverification, sniffmail
# One model key is enough to start; more mean more fallbacks. The dashboard's Key providers page does the same.
set -eu
case "$(uname -s)" in Darwin) ;; *) echo "ramen-agents runs on macOS only for now (this is $(uname -s))."; exit 1 ;; esac
cd "$(dirname "$0")/.."
name="${1:-}"
free="free "
case "$name" in
  gemini) where="https://aistudio.google.com/apikey (Google AI Studio: Create API key; free; its page does not state whether a card is needed)" ;;
  groq) where="https://console.groq.com/keys (free; its page does not state whether a card is needed)" ;;
  zai) where="https://z.ai (API keys in your account; the free models)" ;;
  mistral) free=""; where="https://console.mistral.ai (only if you pay for it: its API needs billing; the key does nothing until you add mistral to provider_chain in common-data/configs/local.toml)" ;;
  openrouter) where="https://openrouter.ai/keys (only the free models are used)" ;;
  ollama-cloud) free=""; where="https://ollama.com/settings/keys (only if you pay for it: pay per token; the key does nothing until you add ollama-cloud to provider_chain in common-data/configs/local.toml)" ;;
  speka) free=""; where="https://speka.me (only if you pay for it: a $1 lifetime credit, then pay per token; the key does nothing until you add speka to provider_chain in common-data/configs/local.toml)" ;;
  quickemailverification) where="https://quickemailverification.com (optional: Lead Gen checks an email before listing it)" ;;
  sniffmail) where="https://sniffmail.io (optional: the backup email check)" ;;
  "") echo "Which provider? sh scripts/add-key.sh gemini   (or groq, zai, openrouter, quickemailverification, sniffmail)"; exit 2 ;;
  *) echo "unknown provider: $name (gemini, groq, zai, openrouter, quickemailverification, sniffmail)"; exit 2 ;;
esac
mkdir -p common-data/keys && chmod 700 common-data/keys
f="common-data/keys/$name.key"
echo "Get a ${free}$name key here: $where"
[ -s "$f" ] && echo "(a $name key is already on file; a new one replaces it)"
if [ -t 0 ]; then
  printf "Paste the key (it is not shown) and press Return: "
  # Ctrl-C at the prompt: the terminal gets its echo back, and nothing is saved
  trap 'stty echo; echo; exit 130' INT TERM
  stty -echo; IFS= read -r key || key=""; stty echo; echo
  trap - INT TERM
else
  IFS= read -r key || key=""
fi
key=$(printf '%s' "$key" | tr -d ' \t\r\n')
[ -n "$key" ] || { echo "Nothing pasted: no key saved."; exit 1; }
(umask 077 && printf '%s\n' "$key" > "$f")
chmod 600 "$f"
echo "saved: $f (only you can read it; never in git)"
case "$name" in quickemailverification|sniffmail) exit 0 ;; esac
# the engine's Python carries certifi; a python.org Python without its certificates installed fails every HTTPS test
PY="${RAMEN_ENGINE:-$HOME/Projects/bot}/.venv/bin/python"
[ -x "$PY" ] || PY=python3
CA=$("$PY" -c 'import certifi; print(certifi.where())' 2>/dev/null || true)
res=$(SSL_CERT_FILE="${CA:-${SSL_CERT_FILE:-}}" "$PY" scripts/setup-check.py --probe 2>/dev/null | grep -E "^ +(ok|!!|\?) +$name:" || true)
if [ -z "$res" ]; then echo "test: skipped (sh scripts/check-setup.sh tests every key)"
else echo "test:$res" | sed 's/^test: */test: /'; fi
