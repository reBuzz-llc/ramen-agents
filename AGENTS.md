# For AI coding agents (Claude Code, Codex, Cursor and the like)

You are helping a person set up or run ramen-agents: a family of autonomous web agents on one Mac. This is the `fleet`
branch, cloned to `~/bots`. The `engine` branch (the `bot` program) is cloned to `~/Projects/bot` by the installer.
macOS only for now: on Linux or Windows, say so and stop.

## Get from an empty Mac to a running family

Run these in order, from `~/bots`, and read each one's output: every line says `ok`, `done`, or `STOP` with the one
thing to do.

1. `sh scripts/install.sh`: tools, the engine, search, the dashboard. Safe to run again. When it stops for the Xcode
   command line tools or Homebrew, those ask for the person's password or a click: hand over to them, then run it
   again.
2. Ask the person the setup questions (below), write their answers to `common-data/local/family.toml`, then
   `sh scripts/setup.sh --answers common-data/local/family.toml`. Without an agent, `sh scripts/setup.sh` asks the
   same questions itself.
3. A model key: the person makes it, in their own browser (see "What is never yours to do"). Then they run
   `sh scripts/add-key.sh gemini` themselves; it reads the key without showing it and tests it.
4. `python3 scripts/setup-check.py` says what is still missing, one line each, and exits 0 when nothing is. The
   dashboard is http://127.0.0.1:3000.

### The answers file

```toml
steer = "One sentence: who to work for first, and what to leave alone."   # optional; must come before [company]

[company]
name = "Cobalt Web"
sells = "websites and online booking for small shops"
buyers = "cafes, salons and clinics"
place = "Springfield, IL"
owner = "Sam"
signoff = "Regards,\nSam\n-- Cobalt Web"
own_domains = ["cobalt.example"]

[target]
market = "Springfield, IL"
segment = "small businesses"
trades = "cafes, salons, clinics"

[[team]]
name = "Sam"
role = "sends the first emails and answers replies"
```

`name`, `sells`, `buyers` and `market` are needed; ask for the rest and leave out what the person does not give. Use
only what they tell you: never invent a company detail, a person or a figure.

## Where things go

- **Never edit a tracked file to set a value.** The person's values go in git-ignored files, so `git pull` and
  `sh scripts/update.sh` never meet an edit: `common-data/local/family.toml` (who they are),
  `common-data/configs/local.toml` (a setting for every member), `<member>/config.local.toml` (one member). An
  overlay holds only the keys that change, in the same tables as the tracked config; an unknown key stops the member
  at start. `docs/your-family.md` lists every file.
- **Keys** are files in `common-data/keys/` (private, git-ignored), one key per file, written by
  `sh scripts/add-key.sh`. Never print, paste, log or commit a key, and never read one back to the person.
- **The boards** (Leads, Tasks, Packages) are `common-data/local-board.sqlite3`, served by the dashboard at `/boards`.
  Change rows through those pages or the board API, never with SQL.
- **Start, stop, restart:** the dashboard's Stop and Start, or `sh scripts/restart-bot.sh <slug>`. A member with a
  STOP file was stopped by the person: never start it without their word, and never `launchctl kickstart -k` a member.
- **Updating:** `sh scripts/update.sh`.

## What is never yours to do

The family runs inside a fence, and so does the agent helping set it up:

- No accounts, sign-ups or log-ins on the person's behalf, and no key made for them: they make their own, at the page
  `sh scripts/add-key.sh <provider>` names.
- No paid plan, card or trial. Every provider in the chain is a free tier; one without a key is skipped.
- Nothing published: no public site, no tunnel or port forward to the dashboard, no Tailscale Funnel. Reaching it
  from a phone is `docs/remote-access.md` (Tailscale, the person's own account and choice; `install.sh` never
  installs it).
- No personal data beyond what a business publishes as its contact, and no change to the rules in
  `docs/validator-rules.md` to make a refusal go away: a refusal is the fence working.

## Checking your work

- `python3 scripts/setup-check.py` (add `--probe` to test each key with one read-only call).
- Dashboard tests: `cd webapp && npm test`. Scripts: `~/Projects/bot/.venv/bin/python -m pytest -q scripts`.
- Any Playwright run sets `PLAYWRIGHT_SKIP_BROWSER_GC=1`, so it never removes the browser the agents use.
- The engine has its own `AGENTS.md` on its branch.
