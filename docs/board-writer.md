# Board Writer: a supervised core capability

Companion to `bot.md` and `explorer.md`. This defines **Board Writer**, the capability that lets a bot write to the
team's board: leads, tasks and package drafts. Everything in `bot.md` about the controller loop, memory and policy still
applies; this adds one action surface and the guardrails around it.

## The board

The starter dashboard serves the board from a local SQLite file at `http://127.0.0.1:3000`. The hosted portal answers
the same paths, so moving from one to the other is a change of `[leads] portal_url`. The agents use one key,
`common-data/keys/portal-engine.key`, sent as `Authorization: Bearer <key>`.

| What | Calls |
|---|---|
| Leads | `GET /v1/boards/leads/rows?since=<rev>&limit=500&fields=all` (ETag, 304), `POST /v1/boards/leads/rows`, `GET`/`PATCH /v1/rows/{id}` |
| Tasks | `GET`/`POST /v1/boards/tasks/rows`, `GET`/`PATCH /v1/tasks/{id}` |
| Packages | `POST /v1/assets/packages/drafts` (a bot hands a draft over; only a person publishes), `GET /v1/assets/packages/drafts` |

A cell a person set is the person's: the board refuses a bot's write to it, and the bot is told. A lead's status,
result and sent-by, and a task's status, assignees and checklist, are the team's cells.

## Settings

- `[leads]`: `enabled`, `portal_url`, `portal_key_file` (the one board address and key), and the lead limits.
- `[tasks]`: `enabled`, `max_per_episode`, `max_per_day`, `min_details_chars`, `nudge_after_episodes`, `team_file`,
  `default_project`.
- `[packages]`: `enabled`, `signoff`, `format_version`, `republish_own`, `republish_days`, `email_allowed_figures`,
  `email_price_rule`, `email_required_phrases`, `email_format_note`.

Your own values go in the untracked overlays, never in a tracked file: `common-data/configs/local.toml` for every member,
`<member>/config.local.toml` for one. They are read after the tracked config, the member's own last. An unknown section
or key in any of them stops the bot at load and names the file.

## When the board is down

The dashboard not running (connection refused), a timeout, a 402 or a 5xx raises one flag for the Mac,
`common-data/shared-state/board-down.json`. While it is up the board is tried once a minute and every other call is
refused at once with a plain reason ("is the dashboard running?"). A refused write is not done and not counted: the bot
is told and can do it again. A member whose work is the board (the Writer, the Enricher) rests from the first failure
and wakes when the board answers.

## Guardrails

Grounding, dedup, read-back and rate rules are the same for every bot that writes: the policy layer (`policy.py`)
decides before the write, the controller reads each write back and only a confirmed write counts.
