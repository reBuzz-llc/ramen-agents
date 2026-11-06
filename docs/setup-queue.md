# Setup queue

The setup as a list to work through in order, by hand or with an AI coding agent (Claude Code, Codex, Cursor and the
like). After every step, run:

```sh
python3 scripts/setup-check.py
```

It prints what is still missing, one line each, with where to get it, and exits 0 when nothing is. It changes nothing
and calls nothing on the internet (add `--probe` to test each key with one read-only request).

**Accounts and keys are always yours to make.** No agent, the ones in this repository or the one helping you set it
up, signs up for anything or creates a key. Every key below links to the page where you make it yourself.

## 1. The engine

- [ ] Clone the engine to `~/Projects/bot` (the folder name matters):
      `git clone -b engine -o starter https://github.com/reBuzz-llc/ramen-agents ~/Projects/bot`
- [ ] Make its Python environment (Python 3.11 or newer):
      `cd ~/Projects/bot && python3 -m venv .venv && .venv/bin/pip install -e ".[dev]"`
- [ ] Install the browser the agents read the web with: `.venv/bin/playwright install chromium`
- [ ] Check it: `.venv/bin/pytest -q` passes.

## 2. This repository

- [ ] Clone it to `~/bots`: `git clone -b fleet -o starter https://github.com/reBuzz-llc/ramen-agents ~/bots`
- [ ] Run `sh scripts/setup.sh` in `~/bots` (folders, the state link `~/.config/explorer`, the search settings).

## 3. Model keys (at least one)

Each key is one file, `common-data/keys/<name>.key`, holding only the key on one line. Then `chmod 600` it. The folder
is git-ignored. Any subset works; more keys mean more fallbacks. Limits and what we measured: `docs/free-tiers.md`.

- [ ] `zai.key`: Z.ai, https://z.ai (the flash models are free)
- [ ] `gemini.key`: Google AI Studio, https://aistudio.google.com/apikey
- [ ] `groq.key`: Groq, https://console.groq.com/keys
- [ ] `mistral.key`: Mistral, https://console.mistral.ai (activate the free plan in the console first)
- [ ] `openrouter.key`: OpenRouter, https://openrouter.ai/keys (free models only)
- [ ] `ollama-cloud.key`: Ollama Cloud, https://ollama.com/settings/keys
- [ ] `speka.key`: Speka, https://speka.me (optional)

## 4. The boards and the email check

- [ ] `notion.key`: a Notion internal integration's secret, https://www.notion.so/my-integrations
- [ ] Create the task board, the packages page and the Leads board, and share them with the integration
      (`SETUP.md` step 6; `scripts/create_leads_board.py` makes the Leads board).
- [ ] Optional: `quickemailverification.key` (https://quickemailverification.com) and `sniffmail.key`
      (https://sniffmail.io), so Lead Gen checks an email before listing it.

## 5. Your company, in your words

- [ ] Fill every `FILL-ME` marker (`setup-check.py` lists the files): the market in
      `common-data/knowledge/target.toml`, your direction in `common-data/knowledge/steers.md`, the agents' cards
      (`persona.md` in each folder), the people in `common-data/team.json`, the board ids in the configs.

## 6. Search and the local model

- [ ] SearXNG, the main search, on this Mac (`SETUP.md` step 4). Keyless.
- [ ] Optional: Ollama with `ollama pull qwen2.5:7b`, the last resort when no provider answers (`SETUP.md` step 3).

## 7. The dashboard

- [ ] Node.js 20 or newer, then `cd ~/bots/webapp && npm ci && npm run build`.

## 8. Always on (macOS)

- [ ] `sh scripts/install-launchd.sh`: search, the local model, the dashboard, the Validator and the checks start with
      the Mac and restart if they stop.
- [ ] The dashboard answers at http://127.0.0.1:3000.

## 9. Optional: the team portal

- [ ] The `portal` branch is a web app where people take leads and tasks and record what they sent. It needs a
      Postgres database (a free Neon project works). Its own `README.md` and `SETUP.md` explain it.
- [ ] Three keys, minted in the portal's checkout (each script writes its file in `common-data/keys/`, mode 600):
      `node --env-file=.env.local scripts/api-key.mjs engine board:read board:write` (the agents, `portal-engine.key`),
      `... api-key.mjs validator` (`portal-validator.key`) and `... api-key.mjs dashboard` (read only,
      `portal-dashboard.key`).
- [ ] Point the family at it in `common-data/configs/common.toml`: `[leads]` then `portal_url = "https://..."`. From
      then on the agents, the Validator and the dashboard read and write leads in the portal, not Notion; the
      dashboard keeps a cache and pulls only what changed. `python3 scripts/setup-check.py --probe` tests each key.
- [ ] Its database's safety net: a nightly standby copy to a second free database, local mode for an outage, and
      the dashboard's "Other free tiers" warnings. All in [portal-database.md](portal-database.md).

## 10. First run

- [ ] `python3 scripts/setup-check.py` prints `Nothing is missing.`
- [ ] Start one agent: `~/Projects/bot/.venv/bin/bot --config ~/bots/lead-gen/config.toml check`, then `... install`.
- [ ] **What "working" looks like:** within the hour the dashboard shows Lead Gen *working*, its screen lists the pages
      it opens and the searches it runs, and its first leads reach the Leads board. Fewer than 1 in 5 of its actions
      refused is healthy (the Work plan page shows the share). Watch it for a day, then start the next agent.
