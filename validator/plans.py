"""The bots' own checklists held to the record (PL01/PL02; owner's Work plan, 2026-09-26).

Each web bot keeps <bot>/workspace/plan.json: {task, source, done_when, steps: [{text, done, done_at, by_action}],
status, started, updated, note}. The engine ticks a step only after an accepted write and records that action's id in
by_action. The Validator reads the plan and the bot's own sqlite (read-only) and checks that every ticked step really
has a write behind it -- the same idea as LD16 for Lead Gen's "done" replies, for every bot.
"""
from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass
from pathlib import Path

PROGRESS_TYPES = {"lead", "update_lead", "note", "task", "update_task", "package", "publish_package", "message", "provider", "say"}


@dataclass
class StepFinding:
    rule: str
    bot: str
    key: str
    label: str
    detail: str


def load(path: Path) -> dict | None:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else None
    except (OSError, ValueError):
        return None


def action_of(db: Path, action_id) -> tuple[str, str, str] | None:
    """(ts, action_type, verdict) of one action, or None."""
    try:
        con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
        try:
            row = con.execute("SELECT ts, action_type, verdict FROM actions WHERE id = ?", (int(action_id),)).fetchone()
        finally:
            con.close()
    except (sqlite3.Error, ValueError, TypeError):
        return None
    return tuple(row) if row else None  # type: ignore[return-value]


def check(slug: str, plan: dict, db: Path) -> list[StepFinding]:
    out: list[StepFinding] = []
    task = str(plan.get("task") or "")[:70]
    started = str(plan.get("started") or "")
    steps = plan.get("steps") or []
    for i, st in enumerate(steps):
        if not isinstance(st, dict) or not st.get("done"):
            continue
        key = f"{slug}|{started}|{i}"
        label = f'{slug} plan "{task}" step {i + 1}'
        text = str(st.get("text") or "")[:80]
        act = action_of(db, st.get("by_action")) if st.get("by_action") is not None else None
        if act is None:
            out.append(StepFinding("PL01", slug, key, label, f"'{text}' is ticked with no action on record behind it"))
            continue
        ts, kind, verdict = act
        if verdict != "allowed" or kind not in PROGRESS_TYPES:
            out.append(StepFinding("PL01", slug, key, label,
                                   f"'{text}' is ticked by action #{st.get('by_action')} ({kind}, {str(verdict)[:60]}), not an accepted write"))
        elif st.get("done_at") and ts > str(st["done_at"]):
            out.append(StepFinding("PL01", slug, key, label, f"'{text}' was ticked at {st['done_at']} before its action ran ({ts})"))
    if str(plan.get("status") or "").lower() == "done":
        left = [str(s.get("text") or "")[:50] for s in steps if isinstance(s, dict) and not s.get("done")]
        if left:
            out.append(StepFinding("PL02", slug, f"{slug}|{started}|task", f'{slug} plan "{task}"',
                                   f"marked done with {len(left)} step(s) not done: " + "; ".join(left[:3])))
    return out
