**ramen-agents v0.2.0** is local-first: from an empty Mac to a running agent team in three commands, with no account
anywhere except the one free model key you choose. Notion is gone from every branch.

## Three commands

```sh
git clone -b fleet -o starter https://github.com/reBuzz-llc/ramen-agents ~/bots && cd ~/bots
sh scripts/install.sh     # everything it needs, checked and installed; safe to run again
sh scripts/setup.sh       # a few questions and one free model key, then the family starts
```

## What's new

- **The local board:** leads, tasks and packages live in one file on your Mac, served by the dashboard (`/boards`):
  sort, filter, edit in place, every change kept in the row's history, Import CSV and Export CSV. The agents and the
  Validator use the same board API the hosted portal has, so the portal stays an option (`docs/advanced.md`).
- **`install.sh`:** the Xcode command line tools and Homebrew checked (it stops with the one command when one is
  missing), Python and Node.js, the engine, keyless search and the dashboard, one line per step. Run it again and every
  step says `ok`.
- **`setup.sh` and the dashboard's first-run page:** your company, what you sell, who buys it and where, saved to
  `common-data/local/family.toml` (out of git); every agent's card reads them. `scripts/add-key.sh <provider>` says
  where a free key is made, reads it without showing it and tests it.
- **`update.sh`:** takes the newest version from the starter. An edit you made to a tracked file, committed or not, is
  moved first to the git-ignored files where your values live, and named, so the pull never meets a conflict. Your
  own settings go in `config.local.toml` and `common-data/configs/local.toml`.
- **`AGENTS.md`** on the `fleet` and `engine` branches: the setup for an AI coding agent, and what is never its to do.
- **Reach it from your phone (optional):** `docs/remote-access.md`, with Tailscale on your own account; the dashboard
  never goes on the internet.
- **Quiet mode** no longer pauses the agents when a game launcher is open; set your own apps under `[quiet]`.

## Coming from v0.1.0

```sh
cd ~/bots && git fetch starter && git show starter/fleet:scripts/update.sh | sh
```

Your Notion settings are moved or dropped by name and printed. Your leads are not copied: export the Notion Leads board
as CSV and use Import CSV on the dashboard's Leads page. `common-data/keys/notion.key` can then be deleted. A card you
had edited is kept in `common-data/local/before-update/`; your company facts now come from `sh scripts/setup.sh`.

macOS only for now: on Linux or Windows the scripts stop on their first line and say so.
