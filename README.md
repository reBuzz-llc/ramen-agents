# Fleet starter

A blank copy of a working bot fleet: the configuration, cards, rules, dashboard and scripts for a small family of
autonomous web bots on one Mac, with every project-specific detail removed and marked `FILL-ME`.

This is the `fleet` branch of the starter. The `engine` branch is the `bot` program, cloned to `~/Projects/bot`;
this one is what the engine runs, cloned to `~/bots`. Both start with no history and no data:
no leads, notes, packages, finds, memories or logs. Everything a bot learns from here on is the new project's own.

## The family

| Bot | Folder | What it does |
|---|---|---|
| The CEO | `the-ceo/` | Decides what the family works on; writes tasks for the human team and publishes packages to Notion |
| Lead Gen | `lead-gen/` | Finds businesses with a published business email and lists them on a Notion Leads board |
| Package Designer | `package-designer/` | Researches what comparable companies charge and hands The CEO service packages |
| Scout | `scout/` | Finds free, card-free tools and watches the terms of the providers the family uses |
| Validator | `validator/` | Checks what the others write against the owner's rules, before and after it reaches Notion |

Each bot folder holds a `config.toml` (settings) and a `persona.md` (its instruction card). Shared settings, the
target market, the owner's steers and the handbook are under `common-data/`. The dashboard is `webapp/`.

## What is blank

- **Who you are:** company, people, products and proof on each card (`*/persona.md`).
- **Who you work for:** the market in `common-data/knowledge/target.toml` and the direction in `steers.md`.
- **Where the output goes:** Notion board and page ids in the configs; the team in `common-data/team.json`.
- **Keys:** none are included, and none are ever committed (`common-data/keys/` is ignored and a commit hook refuses
  anything shaped like a key).

`sh scripts/check-setup.sh` lists every marker still to fill and every key still missing.

## What is not blank

The rules of the house are kept, because they are what makes the fleet safe to leave running:

- **The fence**, enforced in code and not editable by any bot: no accounts, sign-ups or log-ins; no keys or
  credentials; no spending; no personal data beyond a business role address; no invented values.
- **Free tiers only.** The model chain lists free, card-free providers; a provider without a key is skipped.
- **Keyless search**, through a local search tool.
- **Three kinds of rule, kept apart:** the fence refuses; quality rules are flagged after the write by the Validator;
  repeat guards stop a bot doing the same thing twice. Every rule, and whether it refuses or flags, is in
  [docs/validator-rules.md](docs/validator-rules.md).
- **A stopped bot is the owner's decision**; the others are told who is running and plan around it.

## What is left out on purpose

- **No public site.** The original fleet publishes a blog of the bots' notes; none of it is here: no site, no build or
  publish script, no schedule, no content. Nothing in this starter writes to anywhere public. The only places a bot
  writes are its own folder, the shared folder and your Notion boards.
- **No optional members:** the Tor reader, the desktop agent and the publishing bot are not included.
- **No history:** no plans, archives, reports, finds or leads from the original project.

## Start here

Follow [SETUP.md](SETUP.md), top to bottom. It takes an afternoon the first time, most of it creating free provider
keys and two Notion boards.

## Day to day

- Dashboard: http://127.0.0.1:3000 (chat with a bot, stop and start bots, the Work plan page with each bot's refusal rate, the Family review page, a red line at the top when something needs you).
- Keeping the family healthy on free tiers (resting, repeat limits, provider health, the dashboard checks): [docs/staying-healthy.md](docs/staying-healthy.md).
- Restart a bot after changing its config or card: `sh scripts/restart-bot.sh <slug>`. Never `launchctl kickstart -k` on a bot.
- Stopped a bot for good (it has a STOP file)? `sh scripts/disable-bot.sh <slug>` unloads its launchd jobs and marks them disabled, so launchd stops relaunching it every 30 s and a reboot does not load it again. `sh scripts/enable-bot.sh <slug>` undoes that and leaves the STOP file; `restart-bot.sh` is still what runs the bot.
- A day's review: `~/Projects/bot/.venv/bin/python scripts/review.py --date YYYY-MM-DD`.
- Push both repositories: `sh scripts/push-all.sh`.

Runs on macOS only: the bots are kept alive by launch agents.
