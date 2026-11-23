# Your family

The members, what each one does, and where your own values live so that updating never touches them.

## The members

| Member | Folder | Starts by default | What it does |
|---|---|---|---|
| The CEO | `the-ceo/` | yes | Decides what the family works on, writes tasks for your team on the Tasks board and publishes service packages to the Packages board |
| Lead Gen | `lead-gen/` | yes | Reads businesses' own websites and public listings in your market, spots a gap one of your packages fixes, and lists the business on the Leads board |
| Package Designer | `package-designer/` | yes | Researches what comparable companies offer and charge, and hands The CEO concrete packages |
| Research Analyst | `research-analyst/` | no | Answers one research question at a time from public pages, with sources |
| Scout | `scout/` | no | Finds free, card-free tools and data sources, and watches the terms of the providers the family uses |
| Validator | `validator/` | always on | Checks every write against your rules before it lands, and flags what is off afterwards |

`sh scripts/setup.sh` asks which of the optional members to start; the list is kept in
`common-data/local/members.txt`. A member that is not on it stays off because nothing starts it. To start one later,
run `sh scripts/setup.sh` again (the questions keep their answers), or by hand:
`~/Projects/bot/.venv/bin/bot --config ~/bots/scout/config.toml check`, then `... install`.

Stopping is the dashboard's Stop button: the member writes a STOP file and stays stopped (a reboot does not start it
again), and the others are told and plan around it. `sh scripts/restart-bot.sh <slug>` refuses a member you stopped.

## The boards

The family's output lives in one file on this Mac, `common-data/local-board.sqlite3`, served by the dashboard:

- **Leads** (`/boards/leads`): one row per business. Lead Gen lists them; your team owns Status, Result and the other
  people's columns, and no bot writes over a cell a person filled. Import an existing list with "Import CSV" on that
  page. Every column and who writes it: [leads-board.md](leads-board.md).
- **Tasks** (`/boards/tasks`): The CEO's tasks for your team.
- **Packages** (`/boards/packages`): the offers The CEO publishes, which Lead Gen and the drafts use by exact name.

The pages sort, filter and edit in place; every change is kept in the row's history. Nothing on them leaves the Mac.

## Where your values live

Nothing you write goes into a tracked file, so `git pull` (and `sh scripts/update.sh`) never meets an edit of yours:

| What | Where (all git-ignored) | Written by |
|---|---|---|
| Who you are, who you sell to, your team, your direction | `common-data/local/family.toml` | `sh scripts/setup.sh`, the dashboard's first-run page (`/setup`), the Work plan page's Target panel |
| A setting for every member | `common-data/configs/local.toml` | you |
| A setting for one member | `<member>/config.local.toml` | you |
| Keys | `common-data/keys/<provider>.key` | `sh scripts/add-key.sh <provider>` |
| Your own material (rates, case studies, a "What we have" page) | `the-ceo/raw/` | you: drop text files there |
| Which members start | `common-data/local/members.txt` | `sh scripts/setup.sh` |

`family.toml` has four parts. `[company]`: `name`, `sells`, `buyers`, `place`, `owner`, `signoff` (the full sign-off
of a first email, newlines included) and `own_domains`. `[target]`: `market`, `market_short`, `segment`, `trades`,
`areas`. `[[team]]`: one block per person (`name`, and optionally `email`, `role`, `details`). `steer`: your direction
in one sentence. The cards say `{company}`, `{sells}`, `{market}` and so on, and each member fills them from this file
on its next cycle.

An overlay holds only the keys you change, in the same tables as the tracked config, and its value wins:

```toml
# lead-gen/config.local.toml
[agent]
contact = "https://your-site.example"
```

An unknown key stops the member at start with its name, so a typo cannot pass unnoticed. `sh scripts/check-setup.sh`
says what is still missing.

## What stays the same for everyone

The rules that make the family safe to leave running are in the tracked files and are not yours to override: no
accounts, sign-ups or log-ins; no keys or credentials in anything a bot writes; no spending; no personal data beyond a
business role address; no invented values. Every rule, and whether it refuses or flags, is in
[validator-rules.md](validator-rules.md).
