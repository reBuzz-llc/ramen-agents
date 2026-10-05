# Notion Writer — a supervised core capability

Companion to `bot.md` and `explorer.md`. This document defines **Notion Writer**, the capability
that lets a bot publish curated work to the owner's Notion workspace. It is written to be a
first-class, supervised feature: future bots that need to reach Notion inherit these rules rather
than reinventing them. Everything in `bot.md` about the controller loop, memory, and policy still
applies; this document adds one action surface and the guardrails around it.

## Why this is a core feature, not a one-off

One bot writes to Notion directly today — **The CEO** (`personas/ceo.md`), which holds a `[notion]`
section (an integration token, the task board, and the packages page). **Package Designer**
(`personas/package-designer.md`) is part of the same feature but has no Notion access of its own: it
researches and hands packages to the CEO, who publishes them with `publish_package`. Both carry the
`notion_writer` tag because both shape what lands on Notion, and the owner will create more such bots.
The value of a shared capability is that the **Policy layer** (`policy.py`) and the **Agent
Controller** (`controller.py`) enforce the same grounding, dedup, and rate rules wherever a bot does
reach Notion, so a new bot gets safe access by adding config, not by copying code. Notion Writer
therefore sits alongside Task Manager and Memory as a supervised controller capability rather than a
persona detail.

## Bots opt in with the notion_writer tag

A bot declares its part in the capability with a `notion_writer` tag in its config. The tag is
surfaced in `bot list` and the daily review so the owner can see at a glance which bots shape what
goes on Notion. The tag is a descriptive marker, not the access gate: what actually lets a bot write
is a `[notion]` section (token + board/page id) in its config, and every write is validated by the
**Policy layer** before the controller calls the Notion client (`notion.py`). A bot with the tag but
no `[notion]` section — like Package Designer — contributes content that another bot publishes, and
never touches Notion itself.

| Concept | Bound to |
|---|---|
| Notion Writer | controller.py, policy.py, notion.py |
| notion_writer tag | config.py, bot list |
| Package page | publish_package, append_package_toggle |
| Task board | task action, Dead Line, Assign |

## Two write surfaces

Notion Writer exposes exactly two actions, both validated by the **Policy layer**:

1. **task** — writes a task card to the CEO's Notion board. Every task must set a **Dead Line** (a
   date) and an **Assign** (a person), and must meet a minimum-detail bar (`min_details_chars`) so
   the board holds few, richly described tasks instead of many thin ones. See `notion.py`
   `resolve_user` and the board schema.
2. **publish_package** — appends a marketing toggle to the owner's **Package page** via
   `append_package_toggle` (`notion.py`). Each toggle is one offer: an email pitch, links to the
   source data, a short **source company** history (founded, employees, valuation, location,
   website), and a conclusion. Package Designer produces packages; the CEO publishes them, so the
   package page doubles as reference/training data the CEO reads back through its corpus engine.

## Precision: big LLMs write the Notion payload

Notion is owner-facing, so its text must be precise. Notion Writer runs under `remote_for = "writing"`:
the local model decides *whether* to act, and a larger remote model (Groq, then Gemini) writes the
actual action fields for the two Notion actions listed in `fallback.WRITING_TYPES`. When no remote
budget is available the controller falls back to a thin local draft rather than skipping the write.
Bigger models here mean fuller, better-grounded task briefs and package toggles.

## Supervisory rules (inherited by every notion_writer bot)

- **Ground everything.** A bot writes only what it actually read. Source-company figures that were
  not found stay blank; the **Policy layer** rejects a package whose `source_company.website` is not
  a real http(s) link. No invented valuations or employee counts.
- **No re-versioning churn.** `package_base` collapses versioned names so a bot cannot republish the
  same offer as v2, v3. One distinct service per package.
- **Deadlines are mandatory.** A task with no Dead Line is refused, not softened.
- **Rate limits.** Tasks are capped per day (`max_tasks_per_day`); publish_package is one per
  episode and deduped against `published_package_names`.
- **The fence still binds.** Notion Writer cannot create accounts, log in, spend money, or carry
  data off the machine. It writes to the owner's existing workspace with the owner's integration
  token; it never signs up for one.

## Definition of Done for Notion Writer

- The capability is gated by the `notion_writer` tag and visible in `bot list`.
- Both write surfaces (task, publish_package) validate in the **Policy layer** before any call to
  `notion.py`.
- Package toggles and task briefs are written by the remote writing model when budget allows.
- Every write is grounded, deadlined where applicable, deduped, and inside the fence.
- A new bot gains Notion access by adding the tag and a page/board id — no new code.
