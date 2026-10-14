"""Daily refusal report per bot (2026-10-14: the family's guardrail scoreboard is the
refusal rate). Read-only on each bot's own explorer.sqlite3. Written once a day by the Validator's first
full sweep to common-data/shared-state/refusal-report.md: per bot, actions, refused share, accepted outputs, its top
refusal reasons, and loops -- the same action on the same target refused 10 or more times in the window.
"""
from __future__ import annotations

import datetime as dt
import json
import re
import sqlite3
from collections import Counter
from pathlib import Path

BOTS = Path.home() / "bots"
OUT = BOTS / "common-data" / "shared-state" / "refusal-report.md"
OUTPUTS = ("lead", "update_lead", "task", "update_task", "publish_package", "note", "message")
LOOP_MIN = 10


def _running(folder: Path) -> bool:
    ws = folder / "workspace"
    return (ws / "explorer.sqlite3").exists() and not (ws / "STOP").exists()


def _target(action_type: str, payload: str) -> str:
    try:
        p = json.loads(payload)
    except ValueError:
        return ""
    return str(p.get("name") or p.get("title") or p.get("url") or p.get("query") or p.get("to") or "")[:60]


def bot_stats(db_path: Path, since: str) -> dict:
    db = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    db.row_factory = sqlite3.Row
    rows = db.execute("SELECT action_type, payload, verdict FROM actions WHERE ts > ?", (since,)).fetchall()
    refused = [r for r in rows if str(r["verdict"]).startswith("rejected")]
    reasons = Counter(re.sub(r"'[^']{0,80}'", "'…'", str(r["verdict"]).removeprefix("rejected: "))[:90] for r in refused)
    loops = Counter((r["action_type"], _target(r["action_type"], r["payload"])) for r in refused)
    return {"actions": len(rows), "refused": len(refused),
            "outputs": sum(1 for r in rows if r["verdict"] == "allowed" and r["action_type"] in OUTPUTS),
            "reasons": reasons.most_common(3),
            "loops": [(a, t, n) for (a, t), n in loops.most_common(5) if n >= LOOP_MIN and t]}


def team_lines(leads: list, now: dt.datetime) -> list[str]:
    """What the team did on the board (2026-10-14: the team sends by hand; no send step is built)."""
    day = (now - dt.timedelta(days=1)).date().isoformat()
    sent = [ld for ld in leads if ld.status.strip().lower() == "email sent"]
    results = [ld for ld in leads if ld.result.strip()]
    recent = [ld for ld in results if ld.result_date[:10] >= day]
    return ["", "## The team's outreach", "",
            f"- Status 'Email Sent': {len(sent)} rows; Result filled: {len(results)} rows ({len(recent)} dated since {day})",
            f"- Drafts ready and unsent: {sum(1 for ld in leads if ld.draft_email.strip() and not ld.draft_email.lower().startswith('skip:') and ld not in sent)}"]


def build(now: dt.datetime, hours: int = 24, leads: list | None = None) -> str:
    since = (now - dt.timedelta(hours=hours)).isoformat(timespec="seconds")
    lines = [f"# Refusal report, {hours} h to {now:%Y-%m-%d %H:%M} (Validator)", "",
             "| Bot | Actions | Refused | Share | Accepted outputs |", "|---|---|---|---|---|"]
    detail = []
    for folder in sorted(p for p in BOTS.iterdir() if p.is_dir() and _running(p)):
        try:
            s = bot_stats(folder / "workspace" / "explorer.sqlite3", since)
        except sqlite3.Error:
            continue
        if not s["actions"]:
            continue
        share = round(100 * s["refused"] / s["actions"])
        lines.append(f"| {folder.name} | {s['actions']} | {s['refused']} | {share}% | {s['outputs']} |")
        detail.append(f"\n## {folder.name}\n")
        detail += [f"- {n} x {why}" for why, n in s["reasons"]]
        detail += [f"- LOOP: {a} on '{t}' refused {n} times" for a, t, n in s["loops"]]
    return "\n".join(lines + detail + (team_lines(leads, now) if leads is not None else [])) + "\n"


def due(state: dict, now: dt.datetime) -> bool:
    return str(state.get("refusal_report_at", ""))[:10] != now.date().isoformat()


def write(state: dict, now: dt.datetime, leads: list | None = None) -> Path:
    OUT.write_text(build(now, leads=leads), encoding="utf-8")
    state["refusal_report_at"] = now.isoformat(timespec="seconds")
    return OUT
