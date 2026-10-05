"""Keeping the Leads board filled in, and acting on what the team deletes (owner, 2026-09-25, evening rule).

Two jobs, both driven from the sweep because Lead Gen cannot read the board itself -- it writes rows, it does not
enumerate them:

* **Blanks are work.** Every row with an empty cell the bot could fill (founder, location, size, industry,
  evidence) becomes a short work list for Lead Gen (the full list in its own files). Once in a blue moon the same
  gaps go to The CEO, by column counts, so the provider can assign more hands.
* **A deleted cell means the value was wrong.** When the marketing team empties a cell that was filled, that is
  them saying "not this". The sweep sees the value go from something to nothing and reports it to The CEO, who
  assigns a family member to find the correct value (owner: "valB catches it, talks to ceoA, ceoA assigns someone
  to update the cell"). Until The CEO's assignee has had time (ASSIGN_HOURS), the cell is not on Lead Gen's own
  list and raises no defect -- nobody refills it on reflex. A bot never blanks a cell itself (update_lead skips
  empty fields), so filled -> empty is the team's doing. (Until this evening a deletion meant "useless, never
  refill"; the owner changed the rule.)
"""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable

# The cells Lead Gen can research and fill once it has the website. "Business email" is deliberately absent: a
# wrong address is worse than none, and LD09 already checks the ones that are there.
FILLABLE = ("Founded by", "Location", "Company size", "Industry", "Evidence")
# Every column the team can empty. "Found by" was left out at first, and the owner's first test on 2026-09-25 was
# to clear exactly that column on all 21 rows -- unseen. Nothing is left out now.
WATCHED = FILLABLE + ("Pain point", "How we can help", "Business email", "Source pages", "Found by", "Stage", "Found on")
# The same column emptied on this many rows in one look is said so to The CEO: a column decision, not cells.
COLUMN_CLEAR_AT = 3
# How long a deleted cell waits for The CEO's assignee before it rejoins Lead Gen's own list.
ASSIGN_HOURS = 72.0


@dataclass
class Deletion:
    page_id: str
    business: str
    column: str
    was: str

    @property
    def key(self) -> str:
        return f"{self.page_id}|{self.column}"


@dataclass
class Upkeep:
    deletions: list[Deletion] = field(default_factory=list)          # cells the team emptied since the last sweep
    work: list[tuple[str, str, list[str]]] = field(default_factory=list)  # (business, website, missing columns)
    snapshot: dict[str, dict[str, str]] = field(default_factory=dict)
    column_clears: list[str] = field(default_factory=list)            # columns emptied across rows in one look


def cells_of(lead) -> dict[str, str]:
    """The watched columns of one row, as plain strings."""
    by_column = {
        "Founded by": lead.founded_by, "Location": lead.location, "Company size": lead.company_size,
        "Industry": lead.industry, "Evidence": lead.evidence, "Pain point": lead.pain_point,
        "How we can help": lead.how_we_help, "Business email": lead.email, "Source pages": lead.source_pages,
        "Found by": lead.found_by, "Stage": lead.stage, "Found on": lead.found_on or "",
    }
    return {c: (by_column.get(c) or "").strip() for c in WATCHED}


def examine(leads: list, previous: dict[str, dict[str, str]], pending: dict[str, dict],
            unwanted_columns: Iterable[str] = ()) -> Upkeep:
    """Compare this sweep's rows with the last one: what the team deleted, and what is still worth filling.
    `pending` = deleted cells still waiting for The CEO's assignee: not on Lead Gen's own list."""
    out = Upkeep()
    unwanted = set(unwanted_columns)
    for ld in leads:
        now = cells_of(ld)
        out.snapshot[ld.page_id] = now
        before = previous.get(ld.page_id) or {}
        for column, value in now.items():
            was = (before.get(column) or "").strip()
            if was and not value:
                out.deletions.append(Deletion(ld.page_id, ld.business, column, was))
        missing = [c for c in FILLABLE if not now.get(c) and c not in unwanted and f"{ld.page_id}|{c}" not in pending]
        if missing and ld.website.strip():
            out.work.append((ld.business, ld.website, missing))
    per_column: dict[str, int] = {}
    for d in out.deletions:
        per_column[d.column] = per_column.get(d.column, 0) + 1
    out.column_clears = sorted(c for c, n in per_column.items() if n >= COLUMN_CLEAR_AT)
    return out


def deletion_report(deletions: list[Deletion], column_clears: Iterable[str] = (), lead_bot: str = "Lead Gen", paused: bool = False) -> str:
    """What The CEO is told when the team empties cells: the value was wrong, assign someone to get the right one."""
    from collections import Counter
    clears = list(column_clears)
    by_col = Counter(d.column for d in deletions)
    cols = ", ".join(f"{c} {n}" for c, n in by_col.most_common())
    lines = [f"{d.business}: {d.column} (was \"{d.was[:40]}\")" for d in deletions if d.column not in clears][:5]
    more = len([d for d in deletions if d.column not in clears]) - len(lines)
    head = f"Leads board: the marketing team deleted {len(deletions)} cell(s) ({cols}). A deleted cell means the value was wrong, not that the column is unwanted. "
    body = ""
    if lines:
        body += "Cells: " + "; ".join(lines) + (f" and {more} more" if more > 0 else "") + ". "
    if clears:
        body += (f"Whole column(s) emptied at once: {', '.join(clears)} -- decide whether the column is wanted; if it is, "
                 "the values need finding again. ")
    tail = (f"Assign a family member by message -- usually {lead_bot} -- naming the business, the column and what to look for "
            "(website first, then a search); they fill it with update_lead and reply 'done: ...'. Reply with the assignment.")
    if paused:
        tail = (f"{lead_bot} is on new leads, not cell upkeep (owner, 2026-09-28). If the right value matters, ask Scout by message "
                "to research it with source URLs, or leave it for the marketing team. Reply with the assignment.")
    return (head + body + tail)[:900]


import os
import sys
import tempfile

# Where the full work list goes (Lead Gen's own files). Tests must never write the real one: under pytest, without an
# explicit VALIDATOR_UPKEEP_FILE, it goes to a temp file.
UPKEEP_FILE = Path(os.environ.get("VALIDATOR_UPKEEP_FILE") or (
    Path(tempfile.gettempdir()) / "validator-upkeep-list-test.md" if "pytest" in sys.modules
    else Path.home() / "bots" / "common-data" / "botBox" / "routed" / "lead-gen" / "upkeep-list.md"))


def work_message(work: list[tuple[str, str, list[str]]], total_rows: int) -> str:
    """The rows with blanks, as work Lead Gen can act on with update_lead. The FULL list goes to a file in Lead Gen's own
    files (botBox/routed/lead-gen/, which its `corpus` search covers) because an inbox message is capped at 900 chars:
    28 rows did not fit on 2026-09-25, Lead Gen saw a stub and asked for the list. The message stays short and points
    at the file."""
    lines = [f"- {name} ({site}): {', '.join(missing)}" for name, site, missing in work]
    try:
        UPKEEP_FILE.parent.mkdir(parents=True, exist_ok=True)
        UPKEEP_FILE.write_text(
            "# Leads board upkeep list\n\n"
            f"Written by the Validator. {len(work)} of {total_rows} rows have empty cells. For each business: open its website "
            "first, then search it by name, and fill only what a page states with update_lead (exact business name). Founded by = "
            "the founder's name; Location = City, State, Country; Company size = locations and/or staff; Industry = the trade in a "
            "few words; Evidence = a page on their own site showing the problem. An empty cell is honest; a guess is not.\n\n"
            + "\n".join(lines) + "\n", encoding="utf-8")
        where = ("First: " + "; ".join(l[2:] for l in lines[:2]) + ". The full list is in your own files as upkeep-list.md "
                 "(search your files for 'upkeep list').")
    except OSError:
        where = "First rows: " + "; ".join(l[2:] for l in lines[:4]) + "."
    return (
        f"Leads board upkeep: {len(work)} of {total_rows} rows have cells you can fill (Founded by, Location, Company size, "
        f"Industry, Evidence -- never the email). {where} Open each business's website first, then a search, and fill only "
        "what a page states with update_lead. Leave a cell empty rather than guess. When a batch is filled, reply to me with "
        "one message: done: <business>: <cells>; ...; could not find: <business>: <cells>."
    )[:900]


def provider_message(work: list[tuple[str, str, list[str]]], total_rows: int, owner_bot_name: str = "Lead Gen", paused: bool = False) -> str:
    """The same gaps, for The CEO (the provider and rule maker): counts by column, so it can assign family to-dos.
    Owner, 2026-09-25: "send ceoA the issue so that it can assign other family todo"."""
    from collections import Counter
    by_col = Counter(col for _, _, missing in work for col in missing)
    cols = ", ".join(f"{col} {n}" for col, n in by_col.most_common())
    if paused:
        return (f"Leads board: {len(work)} of {total_rows} rows have empty cells ({cols}). {owner_bot_name} is on new leads, not "
                "these cells (owner, 2026-09-28). If a gap matters for outreach, assign Scout by message to research named rows "
                "with source URLs. Reply 'noted' or with the assignment.")[:900]
    return (
        f"Leads board: {len(work)} of {total_rows} rows have empty cells ({cols}). {owner_bot_name} has the row-by-row list "
        "in its own files (upkeep-list.md) and fills what a page states with update_lead; a cell the marketing team "
        "deleted stays empty. If the gaps need more hands -- a founder search, a location check -- assign it: name the "
        "family member and the rows. Reply 'noted' or with the assignment."
    )[:900]


BOARD_FILE = Path(os.environ.get("VALIDATOR_BOARD_FILE") or (
    Path(tempfile.gettempdir()) / "validator-leads-board-test.md" if "pytest" in sys.modules
    else Path.home() / "bots" / "common-data" / "botBox" / "routed" / "lead-gen" / "leads-board.md"))


def write_board_file(leads: list) -> int:
    """Every row on the Leads board (business, website, stage), for Lead Gen's own files: it cannot read the board,
    and on 2026-09-25 it tried to list Main Street Hardware fourteen times in one day, refused each time as already listed.
    Before a `lead`, it searches its files for "leads board"."""
    rows = sorted(((ld.business.strip(), ld.website.strip(), (ld.stage or "").strip()) for ld in leads if ld.business.strip()),
                  key=lambda r: r[0].lower())
    try:
        BOARD_FILE.parent.mkdir(parents=True, exist_ok=True)
        BOARD_FILE.write_text(
            "# Leads board -- every business already listed\n\n"
            f"Written by the Validator each sweep; {len(rows)} rows. A business on this list is never listed again with `lead` "
            "(the board dedupes by website domain, and a repeat is refused). Search here before you list; fill blanks with "
            "update_lead from upkeep-list.md instead.\n\n"
            + "\n".join(f"- {b} -- {w}" + (f" ({st})" if st else "") for b, w, st in rows) + "\n", encoding="utf-8")
    except OSError:
        return 0
    return len(rows)
