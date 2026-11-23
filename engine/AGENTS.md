# For AI coding agents (Claude Code, Codex, Cursor and the like)

This is the `engine` branch of ramen-agents: the `bot` program (Python package `explorer`, in `src/explorer`) that every
member of a family runs. The installer clones it to `~/Projects/bot`; the family's folders, cards and dashboard are the
`fleet` branch in `~/bots`, which has its own AGENTS.md for setting a family up. macOS only for now.

## Run the tests

    cd ~/Projects/bot && PLAYWRIGHT_SKIP_BROWSER_GC=1 .venv/bin/python -m pytest -q tests

Every test must pass before a change is done, `tests/test_no_family_ids.py` included (no real ids, private links or
our own names in any tracked file). Set `PLAYWRIGHT_SKIP_BROWSER_GC=1` on every command that can start Playwright:
without it Playwright's clean-up can delete the browser every member uses.

## How a member is configured

- `<member>/config.toml` (tracked, with `extends` for the shared files), then `common-data/configs/local.toml`, then
  `<member>/config.local.toml`: the two local files are git-ignored and win. `config.py` reads them in that order.
- An unknown section or key in any of them stops the member at load and names the file: never add a key the
  dataclasses in `config.py` do not define, and never keep an old one "for later".
- Quiet mode pauses a member while the person uses the Mac. To pause it also while an app is in front or a process
  runs (a game, a video call), put `apps = ["..."]` / `processes = ["..."]` under `[quiet]` in
  `common-data/configs/local.toml`; both are empty by default.
- The person's own answers (company, what they sell, to whom, where, the sign-off, the team, the steer) are in
  `common-data/local/family.toml`. Cards, bios, seed interests and sign-offs say `{company}`, `{sells}`, `{buyers}`,
  `{place}`, `{owner}`, `{signoff}`, `{market}` ...; `target.py` fills them. Never write a person's value into a tracked
  file.

## The board

Leads, tasks and package drafts are on one board: the dashboard's local board at `[leads] portal_url`
(`http://127.0.0.1:3000` by default) or a hosted portal at the same paths, through `portal_store.py` with the agents'
key file. Every board error is a `board.BoardError`; a dashboard that is not running is "board down" (`board_down.py`):
members rest and wake when it answers, and a refused write is never recorded as done. There is no Notion client.

## What is never yours to do

- Never print, paste, log or commit a key; keys are files in `~/bots/common-data/keys/`, made by the person.
- No accounts, sign-ups, paid plans or card details, for the person or for a member. Free tiers only.
- No personal data in a prompt, a log or a commit; a member's fence (`policy.py`) is not to be loosened to make a test
  pass.
