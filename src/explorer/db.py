"""SQLite storage. The schema lives here; domain logic lives in memory.py."""
from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Any, Iterable

SCHEMA = """
CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY,
    created_at TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    tags TEXT NOT NULL DEFAULT '',
    source_url TEXT,
    episode_id INTEGER
);
CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
    title, body, tags, content='notes', content_rowid='id'
);
CREATE TRIGGER IF NOT EXISTS notes_ai AFTER INSERT ON notes BEGIN
    INSERT INTO notes_fts(rowid, title, body, tags) VALUES (new.id, new.title, new.body, new.tags);
END;
CREATE TRIGGER IF NOT EXISTS notes_ad AFTER DELETE ON notes BEGIN
    INSERT INTO notes_fts(notes_fts, rowid, title, body, tags) VALUES ('delete', old.id, old.title, old.body, old.tags);
END;
CREATE TRIGGER IF NOT EXISTS notes_au AFTER UPDATE ON notes BEGIN
    INSERT INTO notes_fts(notes_fts, rowid, title, body, tags) VALUES ('delete', old.id, old.title, old.body, old.tags);
    INSERT INTO notes_fts(rowid, title, body, tags) VALUES (new.id, new.title, new.body, new.tags);
END;
CREATE TABLE IF NOT EXISTS questions (
    id INTEGER PRIMARY KEY,
    created_at TEXT NOT NULL,
    question TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    answered_at TEXT,
    answer_note_id INTEGER,
    times_pursued INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS interests (
    topic TEXT PRIMARY KEY,
    weight REAL NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS visits (
    id INTEGER PRIMARY KEY,
    visited_at TEXT NOT NULL,
    url TEXT NOT NULL,
    domain TEXT NOT NULL,
    title TEXT,
    ok INTEGER NOT NULL,
    error TEXT
);
CREATE INDEX IF NOT EXISTS visits_url ON visits(url);
CREATE INDEX IF NOT EXISTS visits_time ON visits(visited_at);
CREATE TABLE IF NOT EXISTS episodes (
    id INTEGER PRIMARY KEY,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    question_id INTEGER,
    summary TEXT,
    actions INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'open'
);
CREATE TABLE IF NOT EXISTS actions (
    id INTEGER PRIMARY KEY,
    ts TEXT NOT NULL,
    cycle INTEGER NOT NULL,
    episode_id INTEGER,
    action_type TEXT NOT NULL,
    payload TEXT NOT NULL,
    thought TEXT,
    verdict TEXT NOT NULL,
    result TEXT,
    progress INTEGER NOT NULL DEFAULT 0
);
-- The policy counts actions per episode and per type every cycle (memory.count_actions, count_says,
-- count_refused_actions, count_actions_today); without these each count scans the whole table.
CREATE INDEX IF NOT EXISTS actions_episode_type ON actions(episode_id, action_type);
CREATE INDEX IF NOT EXISTS actions_type_ts ON actions(action_type, ts);
CREATE TABLE IF NOT EXISTS heartbeat (
    id INTEGER PRIMARY KEY,
    ts TEXT NOT NULL,
    cycle INTEGER NOT NULL,
    status TEXT NOT NULL,
    current_url TEXT,
    current_question TEXT,
    last_action TEXT,
    last_progress_at TEXT,
    model_failures INTEGER NOT NULL DEFAULT 0,
    next_planned TEXT,
    pid INTEGER
);
CREATE TABLE IF NOT EXISTS summaries (
    id INTEGER PRIMARY KEY,
    created_at TEXT NOT NULL,
    kind TEXT NOT NULL,
    episode_id INTEGER,
    body TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS state (
    key TEXT PRIMARY KEY,
    value TEXT
);
CREATE TABLE IF NOT EXISTS chat (
    id INTEGER PRIMARY KEY,
    ts TEXT NOT NULL,
    role TEXT NOT NULL,
    text TEXT NOT NULL,
    seen INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS chat_unseen ON chat(role, seen);
CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY,
    created_at TEXT NOT NULL,
    episode_id INTEGER,
    title TEXT NOT NULL,
    details TEXT NOT NULL,
    assignee TEXT,
    priority TEXT,
    due TEXT,
    url TEXT
);
CREATE TABLE IF NOT EXISTS leads (
    id INTEGER PRIMARY KEY,
    created_at TEXT NOT NULL,
    episode_id INTEGER,
    name TEXT NOT NULL,
    website TEXT NOT NULL,
    domain TEXT NOT NULL,
    email TEXT,
    how_we_help TEXT,
    url TEXT,
    page_id TEXT
);
"""


class Database:
    def __init__(self, path: str | Path):
        self.path = str(path)
        in_memory = self.path == ":memory:"
        if not in_memory:
            Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(self.path, isolation_level=None, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        if not in_memory:
            self.conn.execute("PRAGMA journal_mode=WAL")
        self.conn.execute("PRAGMA synchronous=NORMAL")
        self.conn.executescript(SCHEMA)

    def execute(self, sql: str, params: Iterable[Any] = ()) -> sqlite3.Cursor:
        return self.conn.execute(sql, tuple(params))

    def insert(self, sql: str, params: Iterable[Any] = ()) -> int:
        cur = self.conn.execute(sql, tuple(params))
        return int(cur.lastrowid or 0)

    def query(self, sql: str, params: Iterable[Any] = ()) -> list[sqlite3.Row]:
        return self.conn.execute(sql, tuple(params)).fetchall()

    def one(self, sql: str, params: Iterable[Any] = ()) -> sqlite3.Row | None:
        return self.conn.execute(sql, tuple(params)).fetchone()

    def scalar(self, sql: str, params: Iterable[Any] = (), default: Any = None) -> Any:
        row = self.one(sql, params)
        if row is None or row[0] is None:
            return default
        return row[0]

    def get_state(self, key: str, default: str | None = None) -> str | None:
        row = self.one("SELECT value FROM state WHERE key = ?", (key,))
        return row["value"] if row else default

    def set_state(self, key: str, value: str) -> None:
        self.conn.execute(
            "INSERT INTO state(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, value),
        )

    def backup(self, dest: str | Path) -> None:
        Path(dest).parent.mkdir(parents=True, exist_ok=True)
        target = sqlite3.connect(str(dest))
        try:
            self.conn.backup(target)
        finally:
            target.close()

    def close(self) -> None:
        self.conn.close()
