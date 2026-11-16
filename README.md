# Fleet starter

A blank copy of a working bot fleet: the configuration, cards, rules, dashboard and scripts for a small family of
autonomous web bots on one Mac, with every project-specific detail removed. Your own details are a few answers to
`sh scripts/setup.sh`, kept out of git.

This is the `fleet` branch of the starter. The `engine` branch is the `bot` program, cloned to `~/Projects/bot`;
this one is what the engine runs, cloned to `~/bots`. Both start with no history and no data:
no leads, notes, packages, finds, memories or logs. Everything a bot learns from here on is the new project's own.

## The family

| Bot | Folder | What it does |
|---|---|---|
| The CEO | `the-ceo/` | Decides what the family works on; writes tasks for the human team and publishes packages to the Packages board |
| Lead Gen | `lead-gen/` | Finds businesses with a published business email and lists them on the Leads board |
| Package Designer | `package-designer/` | Researches what comparable companies charge and hands The CEO service packages |
| Research Analyst | `research-analyst/` | Answers one research question at a time from public pages, with sources |
| Scout | `scout/` | Finds free, card-free tools and watches the terms of the providers the family uses |
| Validator | `validator/` | Checks what the others write against the owner's rules, before and after it reaches a board |

Research Analyst and Scout are off by default; `sh scripts/setup.sh` asks whether to start them ([docs/your-family.md](docs/your-family.md)). Each bot folder
holds a `config.toml` (settings) and a `persona.md` (its instruction card). Shared settings and the handbook are under
`common-data/`. The dashboard is `webapp/`, and it serves the local board: Leads, Tasks and Packages in one file on
this Mac, with pages to sort, filter and edit them.

## What is blank

- **Who you are and who you work for:** your company, what you sell, who buys it, where, and your team. Every card
  reads them from `common-data/local/family.toml`, which `sh scripts/setup.sh` writes and git ignores.
- **Your settings:** a value of your own goes in `common-data/configs/local.toml` or `<member>/config.local.toml`
  (git-ignored; it wins over the tracked file), so updating never meets an edit of yours.
- **Keys:** none are included, and none are ever committed (`common-data/keys/` is private and ignored, and a commit
  hook refuses anything shaped like a key). `sh scripts/add-key.sh <provider>` adds one.

`sh scripts/check-setup.sh` lists what is still missing.

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
  writes are its own folder, the shared folder and the boards on this Mac.
- **No optional members:** the Tor reader, the desktop agent and the publishing bot are not included.
- **No history:** no plans, archives, reports, finds or leads from the original project.

## Start here

On a Mac (macOS only for now):

```sh
git clone -b fleet -o starter https://github.com/reBuzz-llc/ramen-agents ~/bots && cd ~/bots
sh scripts/install.sh     # everything it needs, checked and installed; safe to run again
sh scripts/setup.sh       # a few questions and one free model key, then the family starts
```

[SETUP.md](SETUP.md) says what each step does. Working with an AI coding agent? Point it at [AGENTS.md](AGENTS.md).
Optional: [reach it from your phone](docs/remote-access.md), [a hosted team portal](docs/advanced.md).

## Updating

```sh
sh scripts/update.sh
```

It takes the newest version from the starter for both folders, moves any edit you made to a tracked file into the
git-ignored overlays first (it says what it moved), then reinstalls and restarts. Coming from a setup that used Notion:
the Notion settings are moved or dropped by name; your leads are not copied, so export them from Notion as CSV and use
Import CSV on the Leads page.

## Day to day

- Dashboard: http://127.0.0.1:3000. The office world: each agent at its desk with a big screen showing what it is doing, its output against its daily goal (`common-data/daily-goals.json`), which model answered and how much the rules let through. Click one to pause, stop or start it; Stop takes an optional reason that shows on its mat. The bulletin board holds your decisions and The CEO's proposals; the List view has the **Allowance** panel, how much of every free tier is used and left today. Also: the Work plan page with each bot's refusal rate, Settings › Reports, and a red line at the top when something needs you. What every part shows: [docs/dashboard.md](docs/dashboard.md).
- Keeping the family healthy on free tiers (resting, repeat limits, provider health, the dashboard checks): [docs/staying-healthy.md](docs/staying-healthy.md).
- Restart a bot after changing its config or card: `sh scripts/restart-bot.sh <slug>`. It refuses a bot you stopped (a STOP file, or Stop as your last action on the dashboard), and says so when launchd does not have the bot instead of claiming it restarted. Never `launchctl kickstart -k` on a bot.
- Stopped a bot for good (it has a STOP file)? `sh scripts/disable-bot.sh <slug>` unloads its launchd jobs and marks them disabled, so launchd stops relaunching it every 30 s and a reboot does not load it again. `sh scripts/enable-bot.sh <slug>` undoes that and leaves the STOP file; `restart-bot.sh` is still what runs the bot.
- A day's review: `~/Projects/bot/.venv/bin/python scripts/review.py --date YYYY-MM-DD`.
- Your boards: http://127.0.0.1:3000/boards (Export CSV on each page).
- Push both repositories to your own remotes: `sh scripts/push-all.sh`.

Runs on macOS only: the bots are kept alive by launch agents.
