"""Progress lines under The CEO's weekly key results (owner, 2026-10-14: The CEO reads okr-week.md in every
prompt; the owner writes the objective, the Validator measures it on the Leads board).

Each full sweep rewrites ONE line "   Progress (<timestamp>): ..." under each numbered key result and never touches the
owner's own text. Once the week in the heading is over, the file is archived as okr-<week start>.md beside it and a
template with empty key results is left for the owner to fill in.
"""
from __future__ import annotations

import datetime as dt
import json
import re
from pathlib import Path

BOTS = Path.home() / "bots"
FOLDER = BOTS / "common-data" / "botBox" / "routed" / "the-ceo"
OKR = FOLDER / "okr-week.md"
SIGNALS = BOTS / "validator" / "workspace" / "signals.json"
_KR = re.compile(r"^(\d+)\.\s+(.*\S)?\s*$")
_PROGRESS = re.compile(r"^\s+Progress \(")
_WEEK = re.compile(r"\((\d{4}-\d{2}-\d{2}) to (\d{4}-\d{2}-\d{2})\)")
REPLIED = {"replied", "meeting", "client"}


def _scores() -> dict[str, int]:
    try:
        cache = json.loads(SIGNALS.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return {k.replace("-", ""): v["written"]["score"] for k, v in cache.items() if (v.get("written") or {}).get("score") is not None}


def measures(leads: list, start: str) -> dict[int, str]:
    """KR number -> the measured line (KR1 sends, KR2 replies, KR3 replied rows complete)."""
    sent = [ld for ld in leads if ld.status.strip().lower() == "email sent"]
    sent_week = [ld for ld in sent if (ld.edited or "")[:10] >= start]
    replied = [ld for ld in leads if ld.result.strip().lower() in REPLIED]
    scores = _scores()
    complete = [ld for ld in replied if ld.founded_by.strip() and ld.contact_role.strip() and ld.page_id.replace("-", "") in scores]
    return {1: f"{len(sent_week)} rows marked Email Sent this week ({len(sent)} in total)",
            2: f"{len(replied)} rows at Replied, Meeting or Client",
            3: f"{len(complete)} of {len(replied)} replied rows have Contact person, Contact role and a Lead score"}


def _target(kr_text: str) -> str:
    m = re.search(r"\b(\d+)\b", kr_text or "")
    return f" -- target {m.group(1)}" if m else ""


def update(text: str, leads: list, now: dt.datetime) -> str:
    """The file with fresh progress lines under each non-empty key result; the owner's lines unchanged."""
    week = _WEEK.search(text)
    start = week.group(1) if week else (now.date() - dt.timedelta(days=now.weekday())).isoformat()
    got = measures(leads, start)
    out = []
    for line in text.splitlines():
        if _PROGRESS.match(line):
            continue                                      # replaced below, under its key result
        out.append(line)
        m = _KR.match(line)
        if m and m.group(2) and int(m.group(1)) in got:
            out.append(f"   Progress ({now:%Y-%m-%d %H:%M}): {got[int(m.group(1))]}{_target(m.group(2))}.")
    return "\n".join(out) + "\n"


def template(start: dt.date) -> str:
    return (f"# This week's objective ({start.isoformat()} to {(start + dt.timedelta(days=6)).isoformat()}) -- the owner fills this in\n\n"
            "Objective: \n\nKey results (what counts, measured on the Leads board):\n1. \n2. \n3. \n")


def run(leads: list, now: dt.datetime) -> str:
    """Archive a finished week, then refresh the progress lines. Returns what happened."""
    try:
        text = OKR.read_text(encoding="utf-8")
    except OSError:
        return "no okr-week.md"
    original = text
    week = _WEEK.search(text)
    note = ""
    if week and now.date() > dt.date.fromisoformat(week.group(2)):
        archive = FOLDER / f"okr-{week.group(1)}.md"
        if not archive.exists():
            archive.write_text(update(text, leads, now), encoding="utf-8")
        start = dt.date.fromisoformat(week.group(2)) + dt.timedelta(days=1)      # the owner's own week rhythm
        while start + dt.timedelta(days=6) < now.date():
            start += dt.timedelta(days=7)
        text = template(start)
        note = f"archived {archive.name}, new week's template left for the owner; "
    new = update(text, leads, now)
    if new != original:
        OKR.write_text(new, encoding="utf-8")
    return note + "progress lines refreshed"
