"""Heartbeat rows for the outside world, and the in-process watchdog."""
from __future__ import annotations

import os
import sqlite3
import time
from collections import deque
from typing import Callable

from .config import WatchdogConfig
from .db import Database
from .memory import now_iso


class Heartbeat:
    def __init__(self, db: Database, cfg: WatchdogConfig, clock: Callable[[], float] = time.time):
        self.db = db
        self.cfg = cfg
        self.clock = clock
        self.started_at = clock()
        self.last_progress_at = clock()
        self.last_tick_at = 0.0
        self.model_failures = 0
        self.last_action: str | None = None
        self.recent_keys: deque[str] = deque(maxlen=max(4, 2 * cfg.repeat_threshold))

    def record_action(self, action_type: str, key: str, progress: bool) -> None:
        self.last_action = f"{action_type} {key}"[:200]
        self.recent_keys.append(key)
        if progress:
            self.last_progress_at = self.clock()

    def mark_progress(self) -> None:
        self.last_progress_at = self.clock()

    def record_model_failure(self) -> int:
        self.model_failures += 1
        return self.model_failures

    def reset_model_failures(self) -> None:
        self.model_failures = 0

    def repeated_key(self) -> str | None:
        """A key that appeared at least `repeat_threshold` times in the recent window, or None."""
        if not self.recent_keys:
            return None
        counts: dict[str, int] = {}
        for key in self.recent_keys:
            counts[key] = counts.get(key, 0) + 1
        key, count = max(counts.items(), key=lambda kv: kv[1])
        return key if count >= self.cfg.repeat_threshold else None

    def clear_recent(self) -> None:
        self.recent_keys.clear()

    def minutes_since_progress(self) -> float:
        return (self.clock() - self.last_progress_at) / 60.0

    def check(self) -> list[str]:
        problems: list[str] = []
        if self.minutes_since_progress() >= self.cfg.stall_minutes:
            problems.append("stalled")
        if self.repeated_key() is not None:
            problems.append("repeated_action")
        if self.model_failures >= self.cfg.max_model_failures:
            problems.append("model_failures")
        return problems

    def tick(
        self,
        cycle: int,
        status: str,
        current_url: str | None = None,
        current_question: str | None = None,
        next_planned: str | None = None,
        force: bool = False,
    ) -> bool:
        now = self.clock()
        if not force and now - self.last_tick_at < self.cfg.heartbeat_interval_seconds:
            return False
        self.last_tick_at = now
        self.db.insert(
            "INSERT INTO heartbeat(ts, cycle, status, current_url, current_question, last_action, last_progress_at, "
            "model_failures, next_planned, pid) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                now_iso(),
                cycle,
                status,
                current_url,
                current_question,
                self.last_action,
                time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime(self.last_progress_at)),
                self.model_failures,
                next_planned,
                os.getpid(),
            ),
        )
        self.db.execute("DELETE FROM heartbeat WHERE id < (SELECT MAX(id) FROM heartbeat) - 2000")
        return True

    @staticmethod
    def latest(db: Database) -> sqlite3.Row | None:
        return db.one("SELECT * FROM heartbeat ORDER BY id DESC LIMIT 1")
