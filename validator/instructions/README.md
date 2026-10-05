# Format instructions, one file per bot

These are the owner's format instructions for each bot's outputs, gathered in one place so the
Validator can check past and future work against them. **The owner edits these files**; the
Validator re-reads them on every run, and any change makes its next run a full sweep of all past
data, so a new instruction is applied to everything already on Notion, not just new items.

## How a rule line works

```
- T04 — Dead Line is set. A task with no deadline slips; never leave it blank.
- T07 — The brief covers context, steps, specifics and what "done" looks like. [warn]
```

- A line that starts with `- ` followed by a rule id (`T04`, `PK02`, `PS03`, `PD01`, `SC05`) is a
  rule the Validator enforces with a built-in check keyed to that id. The text after the dash is what
  the responsible bot is told when the rule fails, so keep it a plain instruction.
- Delete the line (or change its id to one that has no check) and that rule is no longer enforced.
- `[warn]` at the end makes a rule a warning: it appears in the report but is not sent to the bot as
  a defect. Remove `[warn]` to make it a defect.
- Under `## Model-judged`, plain-English yes/no questions are put to the Validator's own judge chain
  (`[validator.model]` in `../config.toml`: the strongest free online model first, never the local
  model) for each item that passed the built-in checks and is new or changed since it was last judged.
  A "no" becomes a warning (`MJ01`, `MJ02`, ... by question number) in the report; it is never sent to a
  bot. Questions in `the-ceo.md` apply to task rows; questions in `package-designer.md` apply to the
  packages-page toggles. A daily token budget caps the pass. Old items are re-judged every `rejudge_every_days` (7) and whenever the questions change, a few per run, oldest first.
- Under `## Owner notes`, free text for humans; not checked.

## Built-in check ids

| Prefix | Checks | Bot |
|---|---|---|
| T01–T11 | rows on the Notion task board | The CEO (rows it created); owner otherwise |
| PK01–PK07 | the email wrapper of a toggle on the Notion packages page | The CEO |
| PS01–PS06 | the sources and company facts of a packages-page toggle | Package Designer |
| PD01–PD07 | package files handed over in `the-ceo/raw/packages/` | Package Designer |
| SC01–SC07 | provider records in `common-data/providers-found.md` | Scout |
| LD01–LD05 | rows on the Notion Leads board | Lead Gen |

A new kind of check needs a check function in `../checks.py`; a new *wording* of an existing rule
only needs this file.

## Where the rules came from

- The owner's Notion task-board conventions (properties, status vocabulary, priority scale, title quality).
- Each bot's `persona.md`: what it produces and how.
- The owner's direction: detail is the job; Notion is the human team's board; free tiers only.
- `~/Projects/bot/src/explorer/policy.py`: the code-enforced minimums (a package needs a price with a
  figure, two deliverables, opened sources; a task needs a title, details, a valid priority and date).

## Refuse before, or flag after

The write gate refuses only the fence and the owner's own rules: LD01, LD02, LD03, LD14, LD15, LD18, MG03 (personal data,
invented or wrong-business values, bouncing addresses, dropdown integrity), MG04 and PK14 (the owner's rules), MG01
(duplicate task). Every other rule is quality: the write goes through and the sweep reports it. The list is
`GATE_REFUSES` in validator/gate.py.
