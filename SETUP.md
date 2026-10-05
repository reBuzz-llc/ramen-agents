# Setup on a new Mac

Each step says what to run and how to tell it worked. Run `sh scripts/check-setup.sh` at any point to see what is left.

## 1. The engine

```sh
git clone -b engine -o starter https://github.com/reBuzz-llc/Starter-Setup ~/Projects/bot   # the folder must be ~/Projects/bot
cd ~/Projects/bot
python3 -m venv .venv                      # Python 3.11 or newer
.venv/bin/pip install -e ".[dev]"
.venv/bin/playwright install chromium
.venv/bin/pytest -q                        # every test passes
```

## 2. This repository

```sh
git clone -b fleet -o starter https://github.com/reBuzz-llc/Starter-Setup ~/bots   # the folder must be ~/bots
cd ~/bots
sh scripts/setup.sh                        # folders, state link, commit hook, search settings
```

## 3. The local model (last resort when no provider answers)

Install Ollama so that `~/.local/opt/ollama/ollama` exists (or edit `launchd/com.rebuzz.ollama.plist.template` to
where yours is; skip that agent if the Ollama app already runs its own server), then:

```sh
ollama pull qwen2.5:7b
```

## 4. The local search tool (SearXNG)

```sh
git clone https://github.com/searxng/searxng ~/.local/opt/searxng/src
python3 -m venv ~/.local/opt/searxng/venv
~/.local/opt/searxng/venv/bin/pip install -r ~/.local/opt/searxng/src/requirements.txt
```

Its settings were written by `setup.sh` to `~/.local/etc/searxng/settings.yml`. It is started in step 9. If searches
later return nothing, update the clone (`git pull`, reinstall the requirements) and test each engine with
`http://127.0.0.1:8888/search?q=test&format=json&engines=<name>`.

## 5. Keys (your step, never a bot's)

Create a free, card-free account with each provider you want and save its key as one line in
`common-data/keys/<name>.key`:

| File | For |
|---|---|
| `zai.key`, `gemini.key`, `groq.key`, `speka.key`, `mistral.key`, `openrouter.key`, `ollama-cloud.key` | model providers; any subset works, more means more fallbacks |
| `notion.key` | a Notion internal integration, shared with the boards and pages below |
| `quickemailverification.key`, `sniffmail.key` | optional: Lead Gen checks an email before listing it |

Then `sh scripts/check-keys.sh` makes one cheap call per key. Never paste a key into a chat or a commit.

## 6. Notion

1. Create an empty Notion page, share it with your integration, then create the task board under it:
   `~/Projects/bot/.venv/bin/bot --config ~/bots/the-ceo/config.toml notion-board --parent <page URL> --name "Tasks" --prefix CEO --set-config`
   (`--set-config` writes the board's id into The CEO's config and switches it on).
2. Create a page for packages and a Leads board (columns: Business, Website, Business email, Location, Industry,
   Company size, Founded by, Pain point, How we can help, Evidence, Stage, Found on, Source pages, Email check).
3. Share all three with your integration.
4. Paste the ids where `check-setup.sh` shows `FILL-ME` in `the-ceo/config.toml`, `lead-gen/config.toml` and
   `validator/config.toml`, and set `enabled = true` in the `[notion]` and `[leads]` sections.

## 7. Fill in the blanks

Work through `grep -rn FILL-ME --include='*.md' --include='*.toml' --include='*.json' .` in this order:

1. `common-data/knowledge/target.toml`: the market. Every card follows it.
2. `common-data/knowledge/steers.md`: your direction, in your words.
3. `the-ceo/persona.md`, then the other cards: who the company is, what it sells, who the people are.
4. `common-data/team.json`: the people tasks may go to.
5. The configs: contact address, your own domains, the pitch sign-off, starting interests.
6. Owner material the bots should read (rates, case studies, a "What we have" page): drop text files in `the-ceo/raw/`.
7. Optional: `common-data/knowledge/candidate-feeds.toml`, a public business register for your market.

Keep a card to about 400 to 700 words: who, the goal, what it produces, colleagues, off limits. Detail goes in
`common-data/knowledge/handbook.md`. Before telling a bot it may do something, make sure a rule does not refuse it.

## 8. The dashboard

```sh
cd ~/bots/webapp && npm ci && npm run build
```

## 9. Start

```sh
cd ~/bots
sh scripts/check-setup.sh                  # should end with "Ready"
sh scripts/install-launchd.sh              # search, local model, dashboard, Validator, data servers, checks
for b in the-ceo lead-gen package-designer scout; do
  ~/Projects/bot/.venv/bin/bot --config ~/bots/$b/config.toml check
  ~/Projects/bot/.venv/bin/bot --config ~/bots/$b/config.toml install
done
```

Open http://127.0.0.1:3000. Start with one bot, watch its first day on the Work plan page (refusal rate under 20% is
healthy), then start the next. To stop a bot use the dashboard's Stop; the others are told and plan around it.

## 10. Your own git remotes

The clones above name the starter `starter`, not `origin`, so nothing of yours can be pushed back into it by
accident. Once the cards and configs are yours, give each folder its own private repository:

```sh
cd ~/bots && git remote add origin <your private fleet repository> && git push -u origin fleet
cd ~/Projects/bot && git remote add origin <your private engine repository> && git push -u origin engine
```

`sh scripts/push-all.sh` then pushes both. To take a later improvement from the starter: `git fetch starter`, then
merge or cherry-pick what you want.

Not in git, so back them up yourself: `common-data/keys/`, each bot's `workspace/` (its memory) and `the-ceo/raw/`.
