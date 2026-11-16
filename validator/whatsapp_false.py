"""Rows the team marked "False Whatsapp Number" (owner, 2026-10-07: "find 'False Whatsapp Number' and clear the number
while updating status ... then send a msg to a family member to search for another number").

For each such row: the number goes on the ruled-out list (common-data/shared-state/whatsapp-false-numbers.json, which
the gate's LD20 reads, so no bot writes it back), the Whatsapp cell and the Status are cleared, both clears are recorded
as script clears (never mistaken for a team deletion), and Lead Gen is asked once, in one message, to look for another
number. This is the Validator's one write to the Leads board; everything else it does there stays read-only.
"""
from __future__ import annotations

import datetime as dt
import json
import re
from pathlib import Path


BOTS = Path.home() / "bots"
SHARED = BOTS / "common-data" / "shared-state"
FALSE_FILE = SHARED / "whatsapp-false-numbers.json"
CLEARS_FILE = SHARED / "leads-script-clears.json"
FALSE_STATUS = "False Whatsapp Number"


def ruled_out() -> dict[str, dict]:
    """digits -> {business, page_id, at}: numbers a person found are not on WhatsApp."""
    try:
        return json.loads(FALSE_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def digits_of(link: str) -> str:
    m = re.search(r"wa\.me/\+?(\d{7,15})", link or "")
    return m.group(1) if m else re.sub(r"\D", "", link or "")


def clear_false_portal(portal, *, now: dt.datetime, dry_run: bool = False) -> list[dict]:
    """The same clean-up on the team portal: every row whose WhatsApp number the team marked false loses the number and
    the mark (as the Validator, read back); returns [{business, page_id, number}] for the ones cleared (or that would be)."""
    stamp = now.strftime("%Y-%m-%dT%H:%M:%S")
    false = ruled_out()
    done: list[dict] = []
    for l in portal.false_whatsapp():
        link = str(l.get("whatsapp") or "")
        rec = {"business": str(l.get("business") or ""), "page_id": str(l.get("id")), "number": digits_of(link)}
        if dry_run:
            done.append(rec)
            continue
        if rec["number"]:
            false[rec["number"]] = {"business": rec["business"], "page_id": rec["page_id"], "at": stamp}
            FALSE_FILE.write_text(json.dumps(false, indent=1, ensure_ascii=False), encoding="utf-8")
        try:
            got = portal.write(rec["page_id"], {"whatsapp": None, "whatsapp_status": None})
        except Exception:  # noqa: BLE001 - the row stays for the next run
            continue
        if not got["refused"] and not got["differs"]:
            done.append(rec)
    return done


def ask_text(cleared: list[dict]) -> str:
    names = [c["business"] for c in cleared]
    shown = ", ".join(names[:25]) + (f" and {len(names) - 25} more" if len(names) > 25 else "")
    return (f"New work list from the team's WhatsApp check: {len(names)} Leads rows had a Whatsapp number that a person found "
            f"is not on WhatsApp, so I cleared it: {shown}. Please look for another number for each: a wa.me or "
            "api.whatsapp.com link, or a number the page labels WhatsApp, on the business's own site or a business "
            "listing (put that page in Source pages). A plain office phone is usually a landline, so prefer a mobile or a "
            "labelled one. The cleared numbers are ruled out and will be refused. If you find nothing, leave the cell empty.")
