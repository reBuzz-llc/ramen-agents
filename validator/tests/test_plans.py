"""PL01/PL02: a ticked step has an accepted write behind it."""
from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import plans  # noqa: E402


def test_ticks_are_held_to_the_record(tmp_path):
    db = tmp_path / "explorer.sqlite3"
    con = sqlite3.connect(db)
    con.execute("CREATE TABLE actions (id INTEGER PRIMARY KEY, ts TEXT, action_type TEXT, verdict TEXT)")
    con.executemany("INSERT INTO actions VALUES (?,?,?,?)", [
        (1, "2026-09-26T18:41:00", "message", "allowed"),
        (2, "2026-09-26T18:42:00", "update_lead", "failed: Notion did not show it back"),
        (3, "2026-09-26T18:43:00", "search", "allowed"),
    ]); con.commit(); con.close()
    plan = {"task": "Confirm the goal", "started": "2026-09-26T18:40:41", "status": "done", "steps": [
        {"text": "message The CEO", "done": True, "done_at": "2026-09-26T18:41:05", "by_action": 1},
        {"text": "fix a lead", "done": True, "done_at": "2026-09-26T18:42:05", "by_action": 2},
        {"text": "research", "done": True, "done_at": "2026-09-26T18:43:05", "by_action": 3},
        {"text": "invented", "done": True, "done_at": "2026-09-26T18:44:00", "by_action": None},
        {"text": "tell the owner", "done": False},
    ]}
    found = plans.check("the-ceo", plan, db)
    pl01 = [f.detail for f in found if f.rule == "PL01"]
    assert len(pl01) == 3 and "failed" in pl01[0] and "search" in pl01[1] and "no action on record" in pl01[2]
    assert [f.rule for f in found if f.rule == "PL02"] == ["PL02"]
