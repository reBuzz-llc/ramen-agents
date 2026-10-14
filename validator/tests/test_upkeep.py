"""The Leads board upkeep loop: blanks become work for Lead Gen; a deleted cell goes to The CEO to assign."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from leads_upkeep import BOARD_FILE, FILLABLE, cells_of, deletion_report, examine, provider_message, work_message, write_board_file  # noqa: E402
from sources import LeadRow  # noqa: E402


def row(pid="a" * 32, **over) -> LeadRow:
    base = dict(page_id=pid, url="https://www.notion.so/x", business="Main Street Hardware", website="https://www.mainstreethardwarespf.com",
                email="info@mainstreethardwarespf.com", location="Northside, NY, USA", industry="Hardware store", company_size="",
                pain_point="Site copyright 2016, no online store.", how_we_help="Website Care Basic",
                evidence="https://www.mainstreethardwarespf.com/contact", stage="New", status="Ready to Send Email", found_on="2026-09-24", source_pages="",
                found_by="Lead Gen", created="2026-09-24T10:00:00.000Z", edited="", founded_by="")
    base.update(over)
    return LeadRow(**base)


def test_blank_cells_become_work_and_deleted_cells_wait_for_the_ceo():
    first = examine([row()], previous={}, pending={})
    assert first.deletions == []                       # nothing to compare with on the first look
    assert first.work == [("Main Street Hardware", "https://www.mainstreethardwarespf.com", ["Contact person", "Company size"])]
    # The bot fills the founder; then the team empties Location: the value was wrong.
    later = examine([row(founded_by="Joe Romano", location="")], previous=first.snapshot, pending={})
    assert [(d.column, d.was) for d in later.deletions] == [("Location", "Northside, NY, USA")]
    # While The CEO's assignee has the cell, it is not on Lead Gen's own list; afterwards it is ordinary work again.
    pending = {d.key: {"was": d.was, "at": "2026-09-25T22:00:00"} for d in later.deletions}
    again = examine([row(founded_by="Joe Romano", location="")], previous=later.snapshot, pending=pending)
    assert again.deletions == [] and again.work == [("Main Street Hardware", "https://www.mainstreethardwarespf.com", ["Company size"])]
    expired = examine([row(founded_by="Joe Romano", location="")], previous=later.snapshot, pending={})
    assert expired.work == [("Main Street Hardware", "https://www.mainstreethardwarespf.com", ["Location", "Company size"])]


def test_a_row_without_a_website_is_not_work():
    assert examine([row(website="")], previous={}, pending={}).work == []


def test_messages_read_as_instructions():
    up = examine([row(founded_by="Joe Romano", location="")], previous={row().page_id: cells_of(row())}, pending={})
    text = deletion_report(up.deletions)
    assert text.startswith("Leads board: the marketing team deleted 1 cell(s) (Location 1)")
    assert "Main Street Hardware: Location" in text and "value was wrong" in text and "Assign a family member" in text and len(text) <= 900
    work = work_message(up.work, 47)
    assert work.startswith("Leads board upkeep: 1 of 47 rows") and "mainstreethardwarespf.com" in work and "update_lead" in work
    gaps = provider_message(up.work, 47)
    assert gaps.startswith("Leads board: 1 of 47 rows have empty cells (Location 1, Company size 1)") and "assign" in gaps
    assert "Business email" not in FILLABLE            # a wrong address is worse than none; LD09 checks the ones there


def test_a_column_emptied_across_rows_is_said_so_to_the_ceo():
    """The owner cleared 'How we can help' on all 28 rows (2026-09-25 22:29): The CEO decides about the column,
    the cells are not silently dropped and not silently refilled."""
    rows = [row(pid=f"{i:032x}", how_we_help="Starter Plus") for i in range(4)]
    first = examine(rows, previous={}, pending={})
    later = examine([row(pid=f"{i:032x}", how_we_help="") for i in range(4)], previous=first.snapshot, pending={})
    assert len(later.deletions) == 4 and later.column_clears == ["How can I help"]
    text = deletion_report(later.deletions, later.column_clears)
    assert "Whole column(s) emptied at once: How can I help" in text and "decide whether the column is wanted" in text


def test_the_board_file_lists_every_business_once():
    n = write_board_file([row(), row(pid="b" * 32, business="Sunny Deli", website="https://sunnydeli-example.com", stage="")])
    text = BOARD_FILE.read_text()
    assert n == 2 and "- Main Street Hardware -- https://www.mainstreethardwarespf.com (Ready to Send Email)" in text and "- Sunny Deli -- https://sunnydeli-example.com" in text
    assert "never listed again" in text
