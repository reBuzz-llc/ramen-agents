# Board API: Peek as the family's board store

*Written 2026-10-14 against
[peek-board-schema.md](peek-board-schema.md): the API serves exactly the operations listed there, no more.*

**Goal.** ramen-agents keeps the Leads and task boards in its own Postgres. The engine's board client
(`explorer/notion.py`) and the Validator read and write them over HTTP ("Live sync with my family"). Notion becomes an
optional mirror, filled by a one-time import. The bots behave exactly as they do today; only the store changes.

## Resources

- **Board**: two per tenant, `leads` and `tasks`, fixed kinds. Each has columns (name, type, options, write rule from
  the schema doc). Options are per tenant; "How can I help" is the tenant's package list.
- **Row**: `id` (Peek), `external` (Notion page id, `LEAD-n`), typed `cells`, and `meta`:
  - `created_time`, `last_edited_time`;
  - `last_edited_by {actor, kind: person | agent}`;
  - `archived`.
- **Section**: named text in a row's page body. A Leads row has "Draft email" and "Draft Whatsapp msg", each replaced
  whole. A task row has "details", append-only.
- **Actor**: a person (a Peek user) or an agent (one per API key, for example "Outreach Writer"). People cells and
  `GET user` answer `{id, name, kind}` only, never an email. An API key can never list users; it can only resolve ids
  it has already seen in a row.
- **Change**: one entry per write, with a per-tenant sequence number, row, board, actor and time, plus the changed
  cells *with their new values*. The UI and the mirror then need no refetch of 300 rows; `GET /v1/rows/{id}` stays the
  way to get a row's full state.

## Operations (the engine's board client → HTTP)

| Engine call | HTTP | Notes |
|---|---|---|
| `schema()` | `GET /v1/boards/{board}/schema` | columns, types, options, rule |
| `find_row(title)` | `GET /v1/boards/{board}/rows?title=` | case-insensitive equals, first match |
| `read_page(id)` | `GET /v1/rows/{id}` | `{archived, cells, meta}` |
| `create_row` | `POST /v1/boards/{board}/rows` | title plus typed cells; answers with the row as stored; `Idempotency-Key` header (see below) |
| `update_row` (with read-back) | `PATCH /v1/rows/{id}` | given non-empty cells only; answers with the row as stored |
| clear one cell (VAL only) | `PATCH /v1/rows/{id}` with `clear: [column]` | only Whatsapp, and only the Validator's key |
| `set_choice` | `PATCH /v1/rows/{id}` on one select/status cell | no separate endpoint; options are checked |
| `rows_waiting(empty_column, limit, score_column)` | `GET /v1/boards/{board}/waiting?empty=&score=&limit=` | see ordering |
| `rows_drafted(draft, status, not_reviewed, score)` | `GET /v1/boards/{board}/drafted?draft=&status=&not_reviewed=&score=` | drafts not starting "skip:"; Status empty or in `not_reviewed` |
| `replace_section` | `PUT /v1/rows/{id}/sections/{name}` | old section removed, new one at the end |
| `append_line` (task `details_append`) | `POST /v1/rows/{id}/sections/{name}/lines` | appended, never replaced |
| full sweep | `GET /v1/boards/{board}/rows?limit=100&cursor=` | stable cursor over `id` |
| quick look | `…/rows?edited_after=<ISO>` | |
| filtered queries | `…/rows?where=<column>:<eq\|empty\|not_empty>[:value]` (repeatable; AND) | serves exactly VAL's four queries |
| `user(id)` | `GET /v1/users/{id}` | `{name, kind}` |

- **Waiting order:** two passes, as the schema doc states. Scored rows come first, by score descending, then oldest
  first. Unscored rows follow, oldest first. Empty numbers never mix into the scored list.
- **Idempotency and duplicates:** `POST` rows takes an `Idempotency-Key` header. The same key from the same API key
  within 24 hours answers the first result again. Separately, the store refuses a second Leads row with the same
  website domain, or, with no website, the same title and city. The refusal is `duplicate_row {existing_id}`: the
  engine's `lead_key` logic, enforced where retries happen.
- **No delete:** there is no DELETE for API keys, ever. Archiving a row is a person's action in the app.
- **Read-back:** every write answers with the row as stored, from the same transaction, so the next read sees it at
  once. The engine keeps its separate `read_page` after a write; it stays cheap.

## Write rules, enforced by the store

The store enforces the fence-class rules, so a bug in one bot cannot break them. Quality rules (the three-part pain
point, the draft format) stay with the Validator, so the logic is not written twice:
- **human:** an agent key writing Result, Result date, Reviewed by or Assign gets `forbidden_column`.
- **once:** written only at create.
- **fill-only:** a non-empty cell gets `filled`, with the current value.
- **append:** lines are merged and deduplicated.
- **Options:** a value outside a select's options gets `not_an_option`; multi-select "Tools on site" may add names.
- **Whatsapp:** a number the team marked False gets `refused_value`, forever.
- **Sent by:** set only by the Validator's key, never over a filled cell.
- **LinkedIn privacy:** a `/in/` Founder LinkedIn needs a Contact person, already on the row or in the same write,
  else `needs_contact_person`.

Errors are JSON `{error: {code, message}}`, and the message is written for the bot's log. Besides the rule codes above:
`unauthorized` (no or bad key), `missing_scope`, `not_found`, `bad_query` (a filter outside the four the Validator
uses), `too_large`, `method_not_allowed` (any DELETE), `rate_limited`. The fixtures in `tests/contract/` are the
reference for every code. A failed query never reaches
a response; the detail goes to the server log only.

## Auth

- One API key per agent, made and revoked by the owner in Settings → Agents. A key is shown once and stored as SHA-256.
  **Create keys for my family** takes the roster (upload or paste `family-roster.toml`) and makes one key per member
  in one click. The keys are shown once and download as `peek-<slug>.key` files for `common-data/keys/`.
- The key fixes both the tenant and the actor, so a request cannot name another tenant, and `last_edited_by` tells
  the bots apart.
- Scopes: `board:read`, `board:write`, and `board:validate`. The last is Validator-only and covers clearing a cell and
  setting Sent by.
- The family finds the portal through one setting, `[leads] portal_url` in the fleet's `common-data/configs/common.toml`
  (unset: the Leads board stays on Notion). Each reader has its own key file, chmod 600 like the other keys:
  `common-data/keys/portal-engine.key` (the agents), `portal-validator.key` (the Validator) and `portal-dashboard.key`
  (the dashboard, read only).
- People use the app's own session. The API never accepts a session cookie, and the app pages never accept an API key.
- Only board data crosses this API. Hours, pay, timesheets, screenshots and people's emails never reach an agent key.

## Rate limits

- Per key: 5 requests a second sustained, bursts of 20. Writes: 2 a second.
- Per tenant: 50,000 requests a day, sized to stay inside Neon's free tier. Today's family uses far less: one sweep of
  about 300 rows every 6 hours, a quick look every 10 minutes, and the writes.
- Over a limit, the answer is `429` with `Retry-After`. The engine already backs off this way for Notion's 3 a second.
- Sizes: up to 100 rows a page, 2,000 characters a cell, 200 lines a section.

## Change feed (live UI and the mirror)

- `GET /v1/changes?after=<seq>` long-polls for up to 25 seconds and returns the changes after `seq`. Bots and the
  mirror use it.
- `GET /v1/changes/stream` serves the same entries as server-sent events for the app's pages, so My queue updates
  when an agent drafts a row. It resumes from `Last-Event-ID`.
- One open feed per key. Entries are kept for 30 days.

## Import from Notion (once) and the mirror

- **Import:** the owner starts it in Settings; it can't be started with an API key. It follows the schema doc's mapping:
  - Notion page id and `LEAD-n` become external ids, and the times are kept.
  - Options are copied exactly.
  - People are matched by email, else by name, else made "unclaimed". A bot user becomes the "agents" actor.
  - Draft sections are dropped, since the cells are canonical. Task bodies become "details".
  - Projects are imported first.

  The import can be re-run before the switch: it updates by external id and never duplicates.
- **Switch:** bots move from `notion` to `peek` in one config change, so nothing is written twice.
- **Mirror** (optional, Peek → Notion only): it reads the change feed and writes Notion at under 3 a second. A Notion
  failure never blocks a write to Peek.
- **After the switch, Notion is read-only for people too:** the mirror overwrites any edit made there. Settings says
  so next to the mirror switch, and the mirror's first write to a row adds a note: "mirrored from ramen-agents".

## Contract tests

- A JSON fixture set of request/response pairs, covering every operation and every error code above, is checked into
  `productive-peek/tests/contract/`.
- The same files are copied into macBot1's tests. The server is tested against them, and so is the engine's
  `PeekClient` (a fake server replaying them), so neither has to run the other.
- A change to the API is a change to the fixtures first.

## Review answers

1. The Validator's quick look keeps `edited_after`; the change feed serves the UI and the mirror.
2. One key per agent, made in one click from the roster (see Auth).
3. Yes, the store holds the `/in/` LinkedIn rule; it is a privacy rule.

**Build order:** the Notion picker and guide are done. Week-2 items (statements, deploy) come next. This API comes
after week 2: contract fixtures first, then schema and rows, rules, keys, the feed, the import, and the mirror last.
The engine spec (`PeekClient` as a board backend) follows when the build starts.

## Built, step one

What runs now, read against the design above. The engine and the Validator still use Notion; nothing in Notion changes.
- **Store:** `leads` (one column per field under their Neon names, `the fleet's common-data/leads-columns.md`; Notion's
  mixed Status is `email_status` and `whatsapp_status`; "Reviewed by" left out), `lead_cells` (every change and every
  refused attempt: old, new, actor kind and name, the key it came through, source URL), `api_keys` (SHA-256 only).
  `rev` rises on every change; readers follow it instead of a timestamp.
- **Rules in the store (lib/leads.ts):** person wins (a bot never replaces a cell a person changed last; refused and
  recorded), human only (email status, WhatsApp status, result, result date), fill only when the writer asks, one row
  per website domain (or name and city). The backfill's import key copies Notion as it is, past the rules.
- **Machine API** (Bearer key from the fleet's `common-data/keys/portal-<name>.key`, minted with `scripts/api-key.mjs`):
  - `GET /v1/boards/leads/rows?since=<rev>&limit=&email_status=&whatsapp_status=&city=&industry=&min_score=&has_draft=&has_role=`
    answers `{leads, next, more}`;
  - `POST /v1/boards/leads/rows` `{actor, fields, source_url?}` creates;
  - `POST /v1/boards/leads/batch` `{actor, writes: [{id | notion_page_id, fields, create?, fill_only?, source_url?}]}`, up to 100;
  - `GET` and `PATCH /v1/rows/{id}` (`{actor, fields, fill_only?, source_url?}`, answered with `written` and
    `refused` with reasons), `GET /v1/rows/{id}/history`, `DELETE` is 405;
  - `GET` and `PUT /api/leads/by-notion/{page_id}` for the backfill (`{actor, lead}`, an idempotent upsert; import key).
  A key always writes as a bot, named by `actor` (an engine key writes for many agents).
- **Flags**:
  `POST /v1/rows/{id}/flags` `{actor, rule, detail}` answers `{flag: {id, rule, detail, status, first_seen, resolved_at, actor}}`
  (one per rule: an open one keeps its id and takes the new detail, a resolved one reopens);
  `PATCH /v1/rows/{id}/flags/{flagId}` `{actor, resolved: true}` answers `{flag}`; `GET /v1/rows/{id}/flags` answers `{flags}`.
- **Phone**: `phone` is an ordinary cell next to `whatsapp`, written by bots and people under person wins
  (not a team-only field). Every write stores it in E.164 (`"+17188760861"`): a US number in any common shape gets `+1`,
  a number with a country code keeps it, an extension is dropped, and text that is not a number is kept as written.
  Rows answer it as `phone`; the board shows it as a tap-to-call link.
- **Lists:** `PUT /v1/lists/send-next` (board:write) keeps the Validator's send-next list as sent, for the Send next tab.
- **The one exception to the team's fields:** a key with `board:validate` may clear `whatsapp_status`, and only while it
  reads "False Whatsapp Number". Every other bot write to email status, WhatsApp status, result or result date is refused.
- **Board page:** `/leads`, the team's working board: filters (Mine, Corrected by the team, Has flags), a
  drawer to edit any cell as the signed-in person, one-click status steps, open flags as red strips, the history, and
  the Send next tab.
- **Not yet:** schema(), waiting/drafted work lists, sections, the change feed, rate limits, Settings → Agents keys,
  the mirror, and people editing (step three).
