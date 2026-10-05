"""The per-cycle counts use indexes, on new databases and on ones created before the indexes existed."""
from __future__ import annotations

import sqlite3
from pathlib import Path

from explorer.db import Database

COUNTS = [
    ("SELECT COUNT(*) FROM actions WHERE episode_id = ? AND action_type = ? AND verdict = 'allowed'", (1, "note"), "actions_episode_type"),
    ("SELECT COUNT(*) FROM actions WHERE action_type = ? AND verdict = 'allowed' AND ts >= ?", ("task", "2026-01-01"), "actions_type_ts"),
    ("SELECT * FROM chat WHERE role = 'owner' AND seen = 0 ORDER BY id LIMIT ?", (5,), "chat_unseen"),
]


def plans(db: Database) -> list[str]:
    return [" ".join(r[3] for r in db.query("EXPLAIN QUERY PLAN " + sql, params)) for sql, params, _ in COUNTS]


def test_new_database_counts_use_indexes(tmp_path: Path) -> None:
    db = Database(tmp_path / "new.sqlite3")
    for plan, (_, _, index) in zip(plans(db), COUNTS):
        assert index in plan, plan


def test_existing_database_gains_the_indexes_when_opened(tmp_path: Path) -> None:
    path = tmp_path / "old.sqlite3"
    Database(path).close()
    raw = sqlite3.connect(path)
    for _, _, index in COUNTS:
        raw.execute(f"DROP INDEX {index}")
    raw.commit()
    raw.close()
    db = Database(path)
    for plan, (_, _, index) in zip(plans(db), COUNTS):
        assert index in plan, plan
