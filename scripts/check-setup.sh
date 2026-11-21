#!/bin/sh
# What is still missing before the bots can run. Changes nothing.
#   sh scripts/check-setup.sh
set -u
cd "$(dirname "$0")/.."
todo=0
say() { printf '%s\n' "$*"; }

say "== Your family (common-data/local/family.toml: what you sell, to whom, where)"
f=common-data/local/family.toml
if [ ! -s "$f" ]; then
  say "  missing  step 2: sh scripts/setup.sh (or the dashboard's first-run page)"; todo=1
else
  for k in name sells buyers; do
    awk -v k="$k" '/^\[/{t=$0} t=="[company]" && $1==k && $0 ~ /= *"[^"]+"/ {f=1} END{exit !f}' "$f" || { say "  missing  [company] $k"; todo=1; }
  done
  awk '/^\[/{t=$0} t=="[target]" && $1=="market" && $0 ~ /= *"[^"]+"/ {f=1} END{exit !f}' "$f" || { say "  missing  [target] market"; todo=1; }
  [ "$todo" = 0 ] && say "  ok"
fi

say "== Keys (common-data/keys/<name>.key); a model provider without a key is skipped"
for k in zai gemini groq openrouter quickemailverification sniffmail portal-engine portal-validator portal-dashboard; do
  if [ -s "common-data/keys/$k.key" ]; then say "  ok       $k"; else say "  missing  $k"; fi
done
have=0; for k in zai gemini groq openrouter; do [ -s "common-data/keys/$k.key" ] && have=1; done
[ "$have" = 1 ] || { say "  -> no model provider key yet: the bots would run on the local model only"; todo=1; }
[ -s common-data/keys/portal-engine.key ] || { say "  -> no board key: tasks, packages and leads cannot be written (sh scripts/install.sh writes it, step 1)"; todo=1; }

say "== The board (the dashboard's local board on 127.0.0.1:3000)"
if curl -s -o /dev/null -m 5 http://127.0.0.1:3000/; then say "  ok       the dashboard answers"; else say "  missing  the dashboard does not answer: start it (the members rest until it does)"; todo=1; fi

say "== Software"
[ -x "$HOME/Projects/bot/.venv/bin/bot" ] && say "  ok       engine (~/Projects/bot/.venv)" || { say "  missing  engine: clone it to ~/Projects/bot and install it (SETUP.md step 1)"; todo=1; }
command -v node >/dev/null 2>&1 && say "  ok       node $(node --version)" || say "  missing  node (only for the dashboard)"
curl -s -m 4 -o /dev/null http://127.0.0.1:11434/api/tags && say "  ok       local model server (Ollama) answers" || say "  off      local model server (Ollama) on 127.0.0.1:11434"
curl -s -m 4 -o /dev/null "http://127.0.0.1:8888/config" && say "  ok       local search (SearXNG) answers" || say "  off      local search (SearXNG) on 127.0.0.1:8888"
[ -L "$HOME/.config/explorer" ] && say "  ok       state link (~/.config/explorer)" || { say "  missing  state link: sh scripts/install.sh (step 1)"; todo=1; }

say
[ "$todo" = 0 ] && say "Ready: install the launch agents and start the bots (SETUP.md, last step)." || say "Not ready yet: see the lines above."
exit $todo
