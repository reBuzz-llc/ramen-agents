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
# /v1/models answers 200 to ANY key on Ollama Cloud and Speka; only a chat call proves the key
call ollama-cloud https://ollama.com/v1/chat/completions   "Authorization: Bearer $(<$K/ollama-cloud.key)" "$(printf $chat gpt-oss:120b)"
call speka        https://speka.me/v1/chat/completions    "Authorization: Bearer $(<$K/speka.key)" "$(printf $chat openai/gpt-oss-20b)"
call groq         https://api.groq.com/openai/v1/models    "Authorization: Bearer $(<$K/groq.key)"
printf '%-14s %s  %s\n' notion "$(curl -s -o /dev/null -w '%{http_code}' -m 25 -H "Authorization: Bearer $(<$K/notion.key)" -H 'Notion-Version: 2025-09-03' https://api.notion.com/v1/users/me)" "(2xx = ok)"
