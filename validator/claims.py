"""A report of finished work is held to the record (owner, 2026-09-25: "valB is supposed to keep all output in check").

Lead Gen told the Validator at 23:06 on 2026-09-25 that it had "filled in Founded by, Location, Company size, Industry
and Evidence for Corner Chicken House and Sunny Deli" -- its own episode log shows no accepted update_lead
that day. A "done" that the record does not show is an invented output like any other, and the loop (work list ->
fill -> done) only works if the reply is true. This module reads the bot's own sqlite (read-only) and says which of the
businesses a report names were really written.
"""
from __future__ import annotations

import json
import re
import sqlite3
from pathlib import Path

BOTS = Path.home() / "bots"
CLAIM = re.compile(r"^\s*(done:|filled|updated|i (have |'ve )?(filled|updated|added|fixed)|completed|added the)", re.I)


def is_claim(text: str) -> bool:
    """Does this message say work on the board is finished?"""
    return bool(CLAIM.match(text or ""))


def lead_writes(slug: str, since_iso: str, db_dir: Path = BOTS) -> list[str]:
    """Business names the bot really wrote to the Leads board (accepted lead / update_lead) after `since_iso`."""
    db = db_dir / slug / "workspace" / "explorer.sqlite3"
    if not db.exists():
        return []
    try:
        con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
        try:
            rows = con.execute("SELECT payload FROM actions WHERE verdict = 'allowed' AND ts > ? "
                               "AND action_type IN ('lead', 'update_lead')", (since_iso,)).fetchall()
        finally:
            con.close()
    except sqlite3.Error:
        return []
    names = []
    for (payload,) in rows:
        try:
            names.append(str(json.loads(payload).get("name", "")).strip())
        except (ValueError, AttributeError):
            continue
    return [n for n in names if n]


def check_claim(text: str, lead_names: list[str], writes: list[str]) -> tuple[list[str], list[str]]:
    """(businesses the report names, those with no write on record). A report naming nobody is judged on the total:
    no write at all since the list was sent means the whole report is unverified."""
    low = (text or "").lower()
    claimed = [n for n in lead_names if n and n.lower() in low]
    written = {w.lower() for w in writes}
    if claimed:
        return claimed, [n for n in claimed if n.lower() not in written]
    return [], ([] if writes else ["(no business named, and no write on record)"])


def stuck_businesses(slug: str, since_iso: str, *, refusals: int = 3, db_dir: Path = BOTS) -> dict[str, int]:
    """Businesses whose update_lead was refused `refusals`+ times since `since_iso` with no accepted write: the work
    list leaves them out for a while (Sunny Deli reopened every episode for two days, 2026-09-26/28)."""
    db = db_dir / slug / "workspace" / "explorer.sqlite3"
    if not db.exists():
        return {}
    try:
        con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
        try:
            rows = con.execute("SELECT verdict, payload FROM actions WHERE ts > ? AND action_type = 'update_lead'", (since_iso,)).fetchall()
        finally:
            con.close()
    except sqlite3.Error:
        return {}
    refused: dict[str, int] = {}
    ok: set[str] = set()
    for verdict, payload in rows:
        try:
            name = str(json.loads(payload).get("name", "")).strip()
        except (ValueError, AttributeError):
            continue
        if verdict == "allowed":
            ok.add(name)
        elif str(verdict).startswith(("rejected", "failed")):
            refused[name] = refused.get(name, 0) + 1
    return {n: c for n, c in refused.items() if c >= refusals and n not in ok}
