# Peek board schema: what the board API must serve

*Written 2026-10-14.*

The Leads board and the task board as the agent family and the Validator use them today (Notion, 2026-10-14). ramen-agents
replaces Notion as the store; Notion becomes a mirror. Every column, who writes it, and how it is read is listed here, so the
board API can serve the engine (`explorer/notion.py`) and the Validator (`validator/`) without either changing behaviour.

**Writers:** person = the human team. LG = Lead Gen, EN = Lead Enricher, OW = Outreach Writer, CEO = The CEO,
VAL = the Validator, engine = filled by the engine itself at write time, sys = the store.
**Write rules:** *once* = set when the row is made, never changed by a bot. *fill-only* = a bot may write it only while it
is empty (the engine reads the row back and refuses otherwise). *append* = new lines are merged in, deduplicated, never
replaced. *human* = no bot ever writes it (the engine strips these from every write: Result, Result date, Reviewed by).

## Leads (one row per business)

| Column | Type | Written by | Rule |
|---|---|---|---|
| Business | title | LG | once; the row key for `find_row` |
| Website | url | LG | once (empty for a business with no website) |
| Business email | email | LG | once |
| Whatsapp | url (`https://wa.me/<digits>`) | LG, EN; VAL clears it | fill-only; VAL empties it when the team marks it False, and the number is then refused forever |
| Status | select: Ready to Send Email, Email Sent, WhatsApp Verified, Waiting response for WhatsApp verification, False Whatsapp Number | person | human, except VAL clearing a False row |
| How can I help | select (the tenant's package names) | CEO | a value outside the options is refused; a deleted value is The CEO's to refill |
| Draft email | rich_text | OW | fill-only (a redraft needs a Validator message naming the row) |
| Draft Whatsapp msg | rich_text | OW | fill-only, only on rows with a working Whatsapp |
| Evidence | url | LG | once |
| Contact person | rich_text | LG, EN | fill-only |
| Contact role | select: Founder, Owner, CEO / President, Principal / Partner, General Manager, Practice / Office Manager, Operations, Marketing, Franchise Development, Executive Director, Other | LG, EN | fill-only; exact option names |
| Email check | rich_text | engine | set when the lead is written ("deliverable, checked <date>") |
| Industry | rich_text | LG, EN | fill-only |
| Pain point | rich_text, three lines ("Pain point:", "They can try:", "We propose:") | EN (LG may leave it empty) | fill-only |
| Location | rich_text, "City, State, Country" | LG, EN | fill-only |
| google map location | url (Google Maps) | EN | fill-only |
| Result | select: Not contacted, Emailed, Replied, Meeting, Client, Not interested, Bounced | person | human |
| Result date | date | person | human |
| Reviewed by | people | person | human |
| Sent by | people | VAL | once; the person who last edited the row when Status became Email Sent, never a bot user, never overwritten |
| Source pages | rich_text, one URL a line | LG, EN | append |
| Company size | rich_text | LG, EN | fill-only |
| Founder LinkedIn | url (linkedin.com/in or /company) | EN | fill-only; a /in/ profile needs a Contact person |
| LinkedIn found via | select: 1 Own site, 2 Business listing, 3 Press article, 4 Search result | EN | written with Founder LinkedIn |
| Tools on site | multi_select (new names allowed) | VAL | replaced each re-read (every 14 days) |
| Site health | rich_text | VAL | replaced each re-read |
| Lead score | number 0-100 | VAL | replaced when it changes; the sort key of both work lists |
| ID | unique id, prefix LEAD | sys | once |
| Created time | created_time | sys | once |

**Page body:** under a heading "Draft email" and one "Draft Whatsapp msg", OW's text, one paragraph a line
(`replace_section`: the old section is removed, the new one goes at the end). The cell holds the same text and is the
canonical copy.

## Tasks (the team's work items; The CEO writes them, people work them)

| Column | Type | Written by | Rule |
|---|---|---|---|
| Task | title | CEO | once; duplicates refused (the same task in other words) |
| Status | status: Not started, In progress, In Review, QA, Blocker, Done, Not Fisible, Dublicate | person (CEO only on its own tasks, only when merging a duplicate into another: [notion] merge_status) | people close tasks; "Done" this week counts on the team's scoreboard |
| Priority | select: P0-P6, Medium | CEO | |
| Dead Line | date | CEO | |
| Assign | people | person | human since 2026-10-14 (The CEO is refused if it sets one) |
| Projects | relation (projects) | CEO | one configured project |
| Blocker | rich_text | person | |
| Files & media | files | person | |
| ID | unique id | sys | once |
| Created time | created_time | sys | once |

**Page body:** the task's details (at least 300 characters) written at creation; later updates *append* blocks
(`details_append`), never replace.

## Read patterns the API must support

- **`schema()`**: column name, type and options. The engine types every write from it and skips unknown columns.
- **`find_row(title)`**: title equals, case-insensitive, first match: `{id, url, fields}`. Used by every `update_lead`.
- **`read_page(id)`**: read-back after EVERY write, `{archived, fields}`. A write that does not read back is not counted as done.
- **`rows_waiting(empty_column, limit, score_column)`**: rows with that column empty, best score first. The writer's
  queue (Draft email empty) and the Enricher's. Ordering: two passes. First rows with a score, descending, then the
  oldest first; then unscored rows, oldest first. Empty numbers must never mix into the scored list.
- **`rows_drafted(draft_column, status_column, not_reviewed, score_column)`**: rows with a draft that is not "skip:",
  whose Status is empty or one of `not_reviewed`, best score first. The CEO's review list.
- **Full sweep (VAL)**: every row of both boards, page size 100 with a cursor, about 300 Leads rows today, every 6 hours.
- **Quick look (VAL, every 10 minutes)**: rows edited since a timestamp (`last_edited_time` after X).
- **Filtered queries (VAL)**: Status equals False Whatsapp Number; Status equals Email Sent AND Sent by is empty; Sent by
  is not empty; tasks edited since the week's start.
- **Row metadata**: `created_time`, `last_edited_time` and **`last_edited_by`** on every row, with the user's kind
  (person or bot). Sent by depends on it.
- **Users**: `GET user(id)` returning a name and a kind (person or bot).
- **Writes**: create row (title plus typed fields), update only the given non-empty fields, clear one field (VAL's False
  clean-up), `replace_section`, append blocks to a task body. Writes must be visible to the next read at once.

## Import from Notion

- Rows: one Peek row per Notion page; keep the Notion page id and `ID` (LEAD-n) as external ids, and keep
  `created_time` and `last_edited_*`.
- Selects and multi-selects: per-tenant option lists, the names kept exactly. "How can I help" becomes the tenant's
  package list.
- People columns (Sent by, Reviewed by, Assign): Notion user → Peek user by email (when the integration can read user
  emails), else by name. An unmatched person becomes an "unclaimed" user until they accept an invite. A bot integration
  user becomes the tenant's "agents" actor, never a person.
- Page bodies: the Draft sections are dropped (the cells are canonical); task bodies become the task's description (Markdown).
- Relations: Projects → Peek project ids (import the projects first).
- After import, the mirror writes Peek → Notion. During the switch the bots write to Peek only, so nothing is written twice.

Only board data crosses this API. Teams data (hours, pay, timesheets, screenshots) never reaches the bots or the
Validator.
