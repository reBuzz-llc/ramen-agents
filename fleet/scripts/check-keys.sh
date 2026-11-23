#!/bin/zsh
# Smoke-test every key in common-data/keys with one cheap call per provider.
# Prints PROVIDER  HTTP  verdict. Run again after rotating a key.
K=~/bots/common-data/keys
call() { # name url header [json body]
  local name=$1 url=$2 hdr=$3 body=$4 code
  if [[ -n $body ]]; then
    code=$(curl -s -o /dev/null -w '%{http_code}' -m 25 -H "$hdr" -H 'Content-Type: application/json' -d "$body" "$url")
  else
    code=$(curl -s -o /dev/null -w '%{http_code}' -m 25 -H "$hdr" "$url")
  fi
  local v="FAIL"; [[ $code == 2* ]] && v="ok"; [[ $code == 401 || $code == 403 ]] && v="bad key"; [[ $code == 402 ]] && v="needs payment"; [[ $code == 429 ]] && v="ok (rate-limited)"
  printf '%-14s %s  %s\n' "$name" "$code" "$v"
}
chat='{"model":"%s","messages":[{"role":"user","content":"hi"}],"max_tokens":1}'
call zai          https://api.z.ai/api/paas/v4/chat/completions "Authorization: Bearer $(<$K/zai.key)" "$(printf $chat glm-4.5-flash)"
# Ollama Cloud and Speka are not called here: only a chat call proves their keys, and that spends paid usage
call groq         https://api.groq.com/openai/v1/models    "Authorization: Bearer $(<$K/groq.key)"
printf '%-14s %s  %s\n' board "$(curl -s -o /dev/null -w '%{http_code}' -m 10 -H "Authorization: Bearer $(<$K/portal-engine.key)" 'http://127.0.0.1:3000/v1/boards/leads/rows?since=0&limit=1')" "(200 = ok; 000 = the dashboard is not running)"
