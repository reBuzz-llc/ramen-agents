"""Memory: notes, questions, interests, visits, episodes, and the journal.

SQLite holds the structured state. Markdown mirrors under the workspace are for humans.
"""
from __future__ import annotations

import datetime as dt
import json
import re
import sqlite3
import time
from pathlib import Path
from typing import Any, Callable, Iterable
from urllib.parse import urlparse

from .db import Database


def now_iso() -> str:
    return dt.datetime.now().isoformat(timespec="seconds")


def domain_of(url: str) -> str:
    parsed = urlparse(url)
    if parsed.scheme == "fake":
        return "fake"
    return parsed.netloc.lower()


def fts_query(text: str) -> str:
    terms = [t.replace('"', "") for t in text.split()]
    return " ".join(f'"{t}"' for t in terms if t)


_STOPWORDS = frozenset(
    "a an the and or but of in on at to for from by with about into over after is are was were be been "
    "do does did what which who whom whose when where why how can could would should may might will "
    "some any these those this that there their they it its as if then than so such other others".split()
)


def question_words(text: str) -> frozenset[str]:
    """The content words of a question, for telling rephrasings of one question apart from new ones."""
    words = re.findall(r"[a-z0-9]+", text.lower())
    return frozenset(w for w in words if len(w) > 2 and w not in _STOPWORDS)


def _overlap(left: frozenset[str], right: frozenset[str]) -> float:
    if not left or not right:
        return 0.0
    return len(left & right) / min(len(left), len(right))


def questions_are_similar(a: str, b: str, threshold: float = 0.7) -> bool:
    """True when two questions share most of their content words, in any order.

    'What are examples of everyday objects and their innovative designs that utilize physics
    principles?' and 'Can you provide examples of everyday objects and their innovative designs that
    utilize physics principles?' are the same question twice."""
    return _overlap(question_words(a), question_words(b)) >= threshold


class Memory:
    def __init__(self, db: Database, workspace: Path | str):
        self.db = db
        self.workspace = Path(workspace)
        self._last_visit: dict[str, float] = {}
        self._load_recent_visits()

    # ---- notes -------------------------------------------------------------

    def add_note(
        self,
        title: str,
        body: str,
        tags: Iterable[str] = (),
        source_url: str | None = None,
        episode_id: int | None = None,
    ) -> int:
        clean_tags = ",".join(sorted({t.strip().lower() for t in tags if t and t.strip()}))
        return self.db.insert(
            "INSERT INTO notes(created_at, title, body, tags, source_url, episode_id) VALUES (?, ?, ?, ?, ?, ?)",
            (now_iso(), title.strip()[:200], body.strip()[:4000], clean_tags, source_url, episode_id),
        )

    def recent_notes(self, limit: int = 5) -> list[sqlite3.Row]:
        return self.db.query("SELECT * FROM notes ORDER BY id DESC LIMIT ?", (limit,))

    def notes_for_episode(self, episode_id: int) -> list[sqlite3.Row]:
        return self.db.query("SELECT * FROM notes WHERE episode_id = ? ORDER BY id", (episode_id,))

    def recent_note_titles(self, days: int = 7) -> set[str]:
        """Lower-cased note titles saved in the last `days`, so the same note is not re-saved every
        episode (the within-episode guard only covers one episode; small models re-derive the same
        conclusion each fresh episode). Mirrors recent_task_titles / recent_package_names."""
        cutoff = (dt.datetime.now() - dt.timedelta(days=days)).isoformat(timespec="seconds")
        rows = self.db.query("SELECT title FROM notes WHERE created_at >= ?", (cutoff,))
        return {str(r["title"]).strip().lower() for r in rows}

    def note_count(self) -> int:
        return int(self.db.scalar("SELECT COUNT(*) FROM notes", default=0))

    def search_notes(self, text: str, limit: int = 5) -> list[sqlite3.Row]:
        q = fts_query(text)
        if not q:
            return []
        return self.db.query(
            "SELECT n.* FROM notes_fts f JOIN notes n ON n.id = f.rowid WHERE notes_fts MATCH ? ORDER BY rank LIMIT ?",
            (q, limit),
        )

    # ---- questions ---------------------------------------------------------

    def add_question(self, question: str) -> int:
        return self.db.insert(
            "INSERT INTO questions(created_at, question) VALUES (?, ?)", (now_iso(), question.strip()[:500])
        )

    def question(self, qid: int | None) -> sqlite3.Row | None:
        if qid is None:
            return None
        return self.db.one("SELECT * FROM questions WHERE id = ?", (qid,))

    def open_question_texts(self) -> list[str]:
        return [r["question"] for r in self.db.query("SELECT question FROM questions WHERE status = 'open'")]

    def dedupe_open_questions(self) -> int:
        """Retire open questions that only rephrase an earlier open one, keeping the earliest of each.

        The ask-time check stops new duplicates, but a list that filled up before it existed stays full
        and the cap then refuses everything."""
        kept: list[frozenset[str]] = []
        retired = 0
        for row in self.db.query("SELECT id, question FROM questions WHERE status = 'open' ORDER BY id"):
            words = question_words(row["question"])
            if any(_overlap(words, seen) >= 0.7 for seen in kept):
                self.db.execute(
                    "UPDATE questions SET status = 'duplicate', answered_at = ? WHERE id = ?", (now_iso(), row["id"])
                )
                retired += 1
            else:
                kept.append(words)
        return retired

    def retire_stale_questions(self, after_pursuits: int) -> int:
        """Close open questions the agent has chased this often without ever answering one.

        Without this the open list fills with questions it cannot answer, and the cap then refuses
        every new question, which leaves it circling the same topic."""
        if after_pursuits <= 0:
            return 0
        cur = self.db.execute(
            "UPDATE questions SET status = 'stale', answered_at = ? WHERE status = 'open' AND times_pursued >= ?",
            (now_iso(), after_pursuits),
        )
        return int(cur.rowcount or 0)

    def purge_meta_topics(self, is_meta: Callable[[str], bool]) -> tuple[int, int]:
        """Retire open questions and drop interests that are about the agent's own tooling.

        The policy refuses new ones at ask time; this cleans up what got in before that rule
        existed, so an old list cannot keep steering every episode toward rate limits."""
        questions = 0
        for row in self.db.query("SELECT id, question FROM questions WHERE status = 'open'"):
            if is_meta(row["question"]):
                self.db.execute(
                    "UPDATE questions SET status = 'meta', answered_at = ? WHERE id = ?", (now_iso(), row["id"])
                )
                questions += 1
        interests = 0
        for row in self.db.query("SELECT topic FROM interests"):
            if is_meta(row["topic"]):
                self.db.execute("DELETE FROM interests WHERE topic = ?", (row["topic"],))
                interests += 1
        return questions, interests

    def open_questions(self, limit: int = 5) -> list[sqlite3.Row]:
        return self.db.query(
            "SELECT * FROM questions WHERE status = 'open' ORDER BY times_pursued ASC, id ASC LIMIT ?", (limit,)
        )

    def count_open_questions(self) -> int:
        return int(self.db.scalar("SELECT COUNT(*) FROM questions WHERE status = 'open'", default=0))

    def pick_question(self) -> sqlite3.Row | None:
        rows = self.open_questions(1)
        return rows[0] if rows else None

    def bump_pursued(self, qid: int) -> None:
        self.db.execute("UPDATE questions SET times_pursued = times_pursued + 1 WHERE id = ?", (qid,))

    def mark_answered(self, qid: int, note_id: int) -> bool:
        cur = self.db.execute(
            "UPDATE questions SET status = 'answered', answered_at = ?, answer_note_id = ? WHERE id = ? AND status = 'open'",
            (now_iso(), note_id, qid),
        )
        return cur.rowcount > 0

    # ---- interests ---------------------------------------------------------

    def seed_interests(self, topics: Iterable[str], weight: float = 0.6) -> int:
        if int(self.db.scalar("SELECT COUNT(*) FROM interests", default=0)) > 0:
            return 0
        added = 0
        for topic in topics:
            topic = topic.strip().lower()
            if topic:
                self.db.execute(
                    "INSERT OR IGNORE INTO interests(topic, weight, updated_at) VALUES (?, ?, ?)",
                    (topic, weight, now_iso()),
                )
                added += 1
        return added

    def adjust_interest(self, topic: str, delta: float) -> float:
        topic = topic.strip().lower()[:100]
        row = self.db.one("SELECT weight FROM interests WHERE topic = ?", (topic,))
        base = float(row["weight"]) if row else 0.5
        weight = max(0.0, min(1.0, base + delta))
        self.db.execute(
            "INSERT INTO interests(topic, weight, updated_at) VALUES (?, ?, ?) "
            "ON CONFLICT(topic) DO UPDATE SET weight = excluded.weight, updated_at = excluded.updated_at",
            (topic, weight, now_iso()),
        )
        return weight

    def interests(self, limit: int = 6) -> list[tuple[str, float]]:
        rows = self.db.query("SELECT topic, weight FROM interests ORDER BY weight DESC, topic ASC LIMIT ?", (limit,))
        return [(r["topic"], float(r["weight"])) for r in rows]

    # ---- visits ------------------------------------------------------------

    def record_visit(self, url: str, title: str, ok: bool, error: str | None = None) -> None:
        domain = domain_of(url)
        self.db.insert(
            "INSERT INTO visits(visited_at, url, domain, title, ok, error) VALUES (?, ?, ?, ?, ?, ?)",
            (now_iso(), url, domain, (title or "")[:300], 1 if ok else 0, error),
        )
        self._last_visit[domain] = time.time()

    PROGRESS_TYPES = ("lead", "update_lead", "note", "task", "update_task", "package", "publish_package", "message", "provider", "say")

    def working_minutes_since(self, since: str, gap_cap_minutes: float = 5.0) -> float:
        """Minutes this bot actually worked since `since`: the time between its actions, each gap capped at
        `gap_cap_minutes` so a night with the Mac off or a game's quiet hours do not count (the webapp's measure)."""
        import datetime as _dt

        rows = self.db.query("SELECT ts FROM actions WHERE ts >= ? ORDER BY id", (since,))
        total, prev = 0.0, None
        for r in rows:
            try:
                t = _dt.datetime.fromisoformat(str(r["ts"]))
            except ValueError:
                continue
            if prev is not None:
                total += min(max((t - prev).total_seconds() / 60.0, 0.0), gap_cap_minutes)
            prev = t
        return total

    def action_type_of(self, action_id: int | None) -> str:
        if action_id is None:
            return ""
        row = self.db.query("SELECT action_type FROM actions WHERE id = ?", (int(action_id),))
        return str(row[0]["action_type"]) if row else ""

    def latest_progress_action_id(self, since: str) -> int | None:
        """The newest accepted write (PROGRESS_TYPES) at or after `since`, for a plan step's by_action; None = none."""
        marks = ",".join("?" for _ in self.PROGRESS_TYPES)
        row = self.db.query(f"SELECT id FROM actions WHERE verdict = 'allowed' AND ts >= ? AND action_type IN ({marks}) ORDER BY id DESC LIMIT 1",
                            (since, *self.PROGRESS_TYPES))
        return int(row[0]["id"]) if row else None

    def domain_visits_without_progress(self, since: str) -> dict[str, int]:
        """Registrable domain -> visits since `since` (an episode's start) for domains with nothing written from them:
        no accepted lead, update_lead or note since the domain's first visit in that window. The policy's
        domain_no_progress_cap reads it."""
        from .browser import registered_domain  # local import: browser imports nothing from memory

        first: dict[str, str] = {}
        counts: dict[str, int] = {}
        for r in self.db.query("SELECT visited_at, domain FROM visits WHERE visited_at >= ? ORDER BY id", (since,)):
            dom = registered_domain(str(r["domain"] or ""))
            if not dom or dom == "fake" or "." not in dom:
                continue
            counts[dom] = counts.get(dom, 0) + 1
            first.setdefault(dom, str(r["visited_at"]))
        out: dict[str, int] = {}
        for dom, n in counts.items():
            wrote = self.db.scalar(
                "SELECT COUNT(*) FROM actions WHERE verdict = 'allowed' AND ts >= ? AND action_type IN ('lead', 'update_lead', 'note')",
                (first[dom],), default=0,
            )
            if not int(wrote or 0):
                out[dom] = n
        return out

    def visited(self, url: str) -> bool:
        return self.db.one("SELECT 1 FROM visits WHERE url = ? LIMIT 1", (url,)) is not None

    def visited_among(self, urls: Iterable[str]) -> set[str]:
        """Which of these URLs were ever visited: one indexed lookup per page of links, instead of
        loading the latest visits to test them against."""
        wanted = list(dict.fromkeys(u for u in urls if u))
        found: set[str] = set()
        for i in range(0, len(wanted), 500):  # SQLite's host-parameter limit is far above this
            chunk = wanted[i : i + 500]
            marks = ",".join("?" * len(chunk))
            found.update(r["url"] for r in self.db.query(f"SELECT DISTINCT url FROM visits WHERE url IN ({marks})", chunk))
        return found

    def visited_urls(self, limit: int = 500) -> set[str]:
        return {r["url"] for r in self.db.query("SELECT url FROM visits ORDER BY id DESC LIMIT ?", (limit,))}

    def pages_last_hour(self) -> int:
        cutoff = (dt.datetime.now() - dt.timedelta(hours=1)).isoformat(timespec="seconds")
        return int(self.db.scalar("SELECT COUNT(*) FROM visits WHERE visited_at >= ?", (cutoff,), default=0))

    def last_visit_by_domain(self) -> dict[str, float]:
        return dict(self._last_visit)

    def _load_recent_visits(self) -> None:
        cutoff = (dt.datetime.now() - dt.timedelta(hours=1)).isoformat(timespec="seconds")
        rows = self.db.query(
            "SELECT domain, MAX(visited_at) AS last FROM visits WHERE visited_at >= ? GROUP BY domain", (cutoff,)
        )
        for r in rows:
            try:
                self._last_visit[r["domain"]] = dt.datetime.fromisoformat(r["last"]).timestamp()
            except (TypeError, ValueError):
                continue

    def domain_counts(self, limit: int = 10) -> list[tuple[str, int]]:
        rows = self.db.query("SELECT domain, COUNT(*) AS n FROM visits GROUP BY domain ORDER BY n DESC LIMIT ?", (limit,))
        return [(r["domain"], int(r["n"])) for r in rows]

    # ---- episodes ----------------------------------------------------------

    def current_episode(self) -> sqlite3.Row | None:
        return self.db.one("SELECT * FROM episodes WHERE status = 'open' ORDER BY id DESC LIMIT 1")

    def episode(self, episode_id: int) -> sqlite3.Row | None:
        return self.db.one("SELECT * FROM episodes WHERE id = ?", (episode_id,))

    def start_episode(self, question_id: int | None = None) -> int:
        return self.db.insert("INSERT INTO episodes(started_at, question_id) VALUES (?, ?)", (now_iso(), question_id))

    def bump_episode_actions(self, episode_id: int) -> None:
        self.db.execute("UPDATE episodes SET actions = actions + 1 WHERE id = ?", (episode_id,))

    def end_episode(self, episode_id: int, summary: str | None, status: str = "done") -> None:
        self.db.execute(
            "UPDATE episodes SET ended_at = ?, summary = ?, status = ? WHERE id = ?",
            (now_iso(), summary, status, episode_id),
        )

    # ---- actions -----------------------------------------------------------

    def record_action(
        self,
        cycle: int,
        episode_id: int | None,
        action_type: str,
        payload: dict[str, Any],
        thought: str | None,
        verdict: str,
        result: str | None,
        progress: bool,
    ) -> int:
        return self.db.insert(
            "INSERT INTO actions(ts, cycle, episode_id, action_type, payload, thought, verdict, result, progress) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                now_iso(),
                cycle,
                episode_id,
                action_type,
                json.dumps(payload, ensure_ascii=False)[:4000],
                (thought or "")[:1000],
                verdict[:300],
                (result or "")[:1000],
                1 if progress else 0,
            ),
        )

    def recent_actions(self, limit: int = 6) -> list[sqlite3.Row]:
        rows = self.db.query("SELECT * FROM actions ORDER BY id DESC LIMIT ?", (limit,))
        return list(reversed(rows))

    def count_actions_since(self, ts: str) -> int:
        """Accepted actions of any type since this ISO timestamp (how long a priority request has waited, in actions)."""
        if not ts:
            return 0
        return int(self.db.scalar("SELECT COUNT(*) FROM actions WHERE verdict = 'allowed' AND ts >= ?", (ts,)) or 0)

    def count_actions_today(self, action_type: str) -> int:
        """Accepted actions of one type since local midnight (the daily publish cap)."""
        day = dt.date.today().isoformat()
        return int(
            self.db.scalar(
                "SELECT COUNT(*) FROM actions WHERE action_type = ? AND verdict = 'allowed' AND ts >= ?",
                (action_type, day),
                default=0,
            )
        )

    def count_refused_actions(self, episode_id: int, action_type: str) -> int:
        """Refused actions of one type in an episode (survives restarts)."""
        return int(
            self.db.scalar(
                "SELECT COUNT(*) FROM actions WHERE episode_id = ? AND action_type = ? AND verdict != 'allowed'",
                (episode_id, action_type),
                default=0,
            )
        )

    def episode_search_queries(self, episode_id: int) -> list[str]:
        """The queries this episode's accepted searches used, so a rephrasing of one is not run again."""
        out: list[str] = []
        for row in self.db.query("SELECT payload FROM actions WHERE episode_id = ? AND action_type = 'search' AND verdict = 'allowed' ORDER BY id", (episode_id,)):
            try:
                q = str(json.loads(row["payload"]).get("query", "")).strip()
            except (ValueError, AttributeError):
                continue
            if q:
                out.append(q)
        return out

    def count_actions(self, episode_id: int, action_type: str) -> int:
        """Accepted actions of one type in an episode (survives restarts, unlike in-memory counters)."""
        return int(
            self.db.scalar(
                "SELECT COUNT(*) FROM actions WHERE episode_id = ? AND action_type = ? AND verdict = 'allowed'",
                (episode_id, action_type),
                default=0,
            )
        )

    def count_says_today(self, to: str) -> int:
        """Accepted say actions addressed to 'owner' or 'partner' since local midnight (the daily say cap)."""
        assert to in ("owner", "partner")
        day = dt.date.today().isoformat()
        return int(
            self.db.scalar(
                "SELECT COUNT(*) FROM actions WHERE action_type = 'say' AND verdict = 'allowed' AND ts >= ? "
                "AND payload LIKE ?",
                (day, f'%"to": "{to}"%'),
                default=0,
            )
        )

    def count_says(self, episode_id: int, to: str) -> int:
        """Accepted say actions in an episode addressed to 'owner' or 'partner' (survives restarts).
        Separate from count_actions so a long AI-partner conversation never eats into the owner's
        say budget, or vice versa. `to` must be 'owner' or 'partner'; matches json.dumps' default
        ': ' separator, e.g. '"to": "partner"'."""
        assert to in ("owner", "partner")
        return int(
            self.db.scalar(
                "SELECT COUNT(*) FROM actions WHERE episode_id = ? AND action_type = 'say' AND verdict = 'allowed' "
                "AND payload LIKE ?",
                (episode_id, f'%"to": "{to}"%'),
                default=0,
            )
        )

    # ---- tasks (created in Notion) ------------------------------------------

    def add_task(
        self,
        episode_id: int | None,
        title: str,
        details: str,
        assignee: str | None,
        priority: str,
        due: str | None,
        url: str,
    ) -> int:
        return self.db.insert(
            "INSERT INTO tasks(created_at, episode_id, title, details, assignee, priority, due, url) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (now_iso(), episode_id, title.strip()[:200], details.strip()[:4000], assignee, priority, due, url),
        )

    def find_task(self, title: str) -> sqlite3.Row | None:
        """The newest task this bot created with that exact title (case-insensitive), or None."""
        rows = self.db.query("SELECT * FROM tasks WHERE lower(trim(title)) = ? ORDER BY id DESC LIMIT 1", (title.strip().lower(),))
        return rows[0] if rows else None

    def update_task_row(self, task_id: int, assignee: str | None, priority: str | None, due: str | None) -> None:
        """Mirror an update_task on the local copy, only the fields that changed."""
        sets, args = [], []
        for col, val in (("assignee", assignee), ("priority", priority), ("due", due)):
            if val is not None and str(val).strip():
                sets.append(f"{col} = ?"); args.append(str(val).strip())
        if sets:
            self.db.execute(f"UPDATE tasks SET {', '.join(sets)} WHERE id = ?", (*args, task_id))

    def recent_package_names_without_company(self, days: int = 30) -> set[str]:
        """Packages handed over recently whose source_company had no name -- the ones a fuller re-send may replace."""
        cutoff = (dt.datetime.now() - dt.timedelta(days=days)).isoformat(timespec="seconds")
        names: set[str] = set()
        for row in self.db.query(
            "SELECT payload FROM actions WHERE action_type = 'package' AND verdict = 'allowed' AND ts >= ?", (cutoff,)
        ):
            try:
                data = json.loads(row["payload"])
                if not str((data.get("source_company") or {}).get("name", "")).strip():
                    names.add(str(data.get("name", "")).strip().lower())
            except (ValueError, AttributeError):
                continue
        names.discard("")
        return names

    def add_lead(self, episode_id: int | None, name: str, website: str, domain: str, email: str, how_we_help: str, url: str, page_id: str) -> int:
        """Remember a Leads-board row this bot created, with its Notion page id, so it can fix it later (update_lead)."""
        return self.db.insert(
            "INSERT INTO leads(created_at, episode_id, name, website, domain, email, how_we_help, url, page_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (now_iso(), episode_id, name.strip()[:200], website.strip(), domain, email.strip(), how_we_help.strip(), url, page_id),
        )

    def find_lead(self, name: str) -> sqlite3.Row | None:
        """The newest lead this bot listed under that exact business name (case-insensitive), or None."""
        rows = self.db.query("SELECT * FROM leads WHERE lower(trim(name)) = ? ORDER BY id DESC LIMIT 1", (name.strip().lower(),))
        return rows[0] if rows else None

    def update_lead_row(self, lead_id: int, website: str | None, domain: str | None, email: str | None, how_we_help: str | None) -> None:
        """Mirror an update_lead on the local copy, only the fields that changed."""
        sets, args = [], []
        for col, val in (("website", website), ("domain", domain), ("email", email), ("how_we_help", how_we_help)):
            if val is not None and str(val).strip():
                sets.append(f"{col} = ?"); args.append(str(val).strip())
        if sets:
            self.db.execute(f"UPDATE leads SET {', '.join(sets)} WHERE id = ?", (*args, lead_id))

    def recent_lead_names(self, days: int = 90) -> dict[str, str]:
        """Business name (lower) -> site domain for the leads this bot listed recently: what update_lead may touch."""
        cutoff = (dt.datetime.now() - dt.timedelta(days=days)).isoformat(timespec="seconds")
        return {str(r["name"]).strip().lower(): str(r["domain"]) for r in self.db.query("SELECT name, domain FROM leads WHERE created_at >= ?", (cutoff,))}

    def recent_lead_domains(self, days: int = 90) -> set[str]:
        """Web domains of the businesses this bot listed as leads recently (the leads table, plus the accepted
        actions' payloads for rows written before the table existed)."""
        from .policy import url_domain  # local import: policy imports memory

        cutoff = (dt.datetime.now() - dt.timedelta(days=days)).isoformat(timespec="seconds")
        out: set[str] = {str(r["domain"]) for r in self.db.query("SELECT domain FROM leads WHERE created_at >= ?", (cutoff,))}
        for row in self.db.query("SELECT payload FROM actions WHERE action_type = 'lead' AND verdict = 'allowed' AND ts >= ?", (cutoff,)):
            try:
                out.add(url_domain(str(json.loads(row["payload"]).get("website", ""))))
            except (ValueError, AttributeError):
                continue
        out.discard("")
        return out

    def recent_tasks(self, limit: int = 10) -> list[sqlite3.Row]:
        return self.db.query("SELECT * FROM tasks ORDER BY id DESC LIMIT ?", (limit,))

    def count_tasks_for_episode(self, episode_id: int) -> int:
        return int(self.db.scalar("SELECT COUNT(*) FROM tasks WHERE episode_id = ?", (episode_id,), default=0))

    def count_tasks_today(self) -> int:
        day = dt.date.today().isoformat()
        return int(self.db.scalar("SELECT COUNT(*) FROM tasks WHERE created_at >= ?", (day,), default=0))

    def episodes_since_last_task(self) -> int:
        """Finished episodes after the last one that created a task (all of them when none has)."""
        return int(
            self.db.scalar(
                "SELECT COUNT(*) FROM episodes WHERE status != 'open' "
                "AND id > COALESCE((SELECT MAX(episode_id) FROM tasks), 0)",
                default=0,
            )
        )

    def episodes_since_last_output(self, action_type: str) -> int:
        """Finished episodes since the last one with an accepted action of this type (all when none).
        Generalises episodes_since_last_task to any output action (task, package, publish), so a bot
        whose job is to produce something can be told, every cycle, how long it has gone without."""
        return int(
            self.db.scalar(
                "SELECT COUNT(*) FROM episodes WHERE status != 'open' AND id > COALESCE("
                "(SELECT MAX(episode_id) FROM actions WHERE action_type = ? AND verdict = 'allowed'), 0)",
                (action_type,),
                default=0,
            )
        )

    def recent_package_names(self, days: int = 30) -> set[str]:
        """Lower-cased names of packages handed over recently (from the accepted actions' payloads)."""
        cutoff = (dt.datetime.now() - dt.timedelta(days=days)).isoformat(timespec="seconds")
        names: set[str] = set()
        for row in self.db.query(
            "SELECT payload FROM actions WHERE action_type = 'package' AND verdict = 'allowed' AND ts >= ?", (cutoff,)
        ):
            try:
                name = str(json.loads(row["payload"]).get("name", "")).strip().lower()
            except (ValueError, AttributeError):
                continue
            if name:
                names.add(name)
        return names

    def task_titles_today(self) -> set[str]:
        rows = self.db.query("SELECT title FROM tasks WHERE created_at >= ?", (dt.date.today().isoformat(),))
        return {str(r["title"]).strip().lower() for r in rows}

    def recent_task_titles(self, days: int = 30) -> set[str]:
        """Lower-cased titles created recently, so the same task is never created twice."""
        cutoff = (dt.datetime.now() - dt.timedelta(days=days)).isoformat(timespec="seconds")
        rows = self.db.query("SELECT title FROM tasks WHERE created_at >= ?", (cutoff,))
        return {str(r["title"]).strip().lower() for r in rows}

    # ---- summaries and journal --------------------------------------------

    def add_summary(self, kind: str, episode_id: int | None, body: str) -> int:
        return self.db.insert(
            "INSERT INTO summaries(created_at, kind, episode_id, body) VALUES (?, ?, ?, ?)",
            (now_iso(), kind, episode_id, body),
        )

    def recent_summaries(self, limit: int = 3) -> list[str]:
        """The bodies of the most recent episode journal entries, newest first (for reflection)."""
        rows = self.db.query("SELECT body FROM summaries ORDER BY id DESC LIMIT ?", (limit,))
        return [str(r["body"]) for r in rows]

    def journal_path(self, day: dt.date | None = None) -> Path:
        day = day or dt.date.today()
        return self.workspace / "journal" / f"{day.isoformat()}.md"

    def write_journal(self, text: str, heading: str | None = None) -> Path:
        path = self.journal_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        stamp = dt.datetime.now().strftime("%H:%M")
        head = f"## {stamp} {heading}".rstrip() if heading else f"## {stamp}"
        new_file = not path.exists()
        with path.open("a", encoding="utf-8") as fh:
            if new_file:
                fh.write(f"# {dt.date.today().isoformat()}\n\n")
            fh.write(f"{head}\n\n{text.strip()}\n\n")
        return path

    def write_markdown_mirrors(self) -> None:
        interests = self.db.query("SELECT topic, weight, updated_at FROM interests ORDER BY weight DESC, topic")
        lines = ["# Interests", "", "Mirror of the interests table, rewritten by the agent after each consolidation.", ""]
        lines += [f"- {r['topic']}: {float(r['weight']):.2f} (updated {r['updated_at']})" for r in interests] or [
            "(no entries yet)"
        ]
        (self.workspace / "interests.md").write_text("\n".join(lines) + "\n", encoding="utf-8")

        questions = self.db.query("SELECT * FROM questions ORDER BY id")
        open_rows = [r for r in questions if r["status"] == "open"]
        done_rows = [r for r in questions if r["status"] != "open"]
        lines = ["# Questions", "", "Mirror of the questions table, rewritten by the agent after each consolidation.", ""]
        lines += ["## Open", ""]
        lines += [f"- #{r['id']} {r['question']} (pursued {r['times_pursued']}x)" for r in open_rows] or ["(none)"]
        lines += ["", "## Answered", ""]
        lines += [f"- #{r['id']} {r['question']} (note {r['answer_note_id']})" for r in done_rows] or ["(none)"]
        (self.workspace / "questions.md").write_text("\n".join(lines) + "\n", encoding="utf-8")

    # ---- chat with the owner -------------------------------------------------

    def add_chat(self, role: str, text: str, seen: bool = False) -> int:
        """role is 'owner', 'bot', or 'system' (a reply produced by code, not the model)."""
        return self.db.insert(
            "INSERT INTO chat(ts, role, text, seen) VALUES (?, ?, ?, ?)",
            (now_iso(), role, text.strip()[:4000], 1 if seen else 0),
        )

    def recent_chat(self, limit: int = 40) -> list[sqlite3.Row]:
        rows = self.db.query("SELECT * FROM chat ORDER BY id DESC LIMIT ?", (limit,))
        return list(reversed(rows))

    def unseen_owner_messages(self, limit: int = 5) -> list[sqlite3.Row]:
        """Owner messages the running agent has not been shown yet."""
        return self.db.query(
            "SELECT * FROM chat WHERE role = 'owner' AND seen = 0 ORDER BY id LIMIT ?", (limit,)
        )

    def chat_reply_after(self, chat_id: int) -> str | None:
        """The dashboard's reply to owner chat row `chat_id` (the first bot row after it, before the owner's next line)."""
        row = self.db.query(
            "SELECT role, text FROM chat WHERE id > ? AND role IN ('owner', 'bot') ORDER BY id LIMIT 1", (chat_id,)
        )
        if row and row[0]["role"] == "bot":
            return str(row[0]["text"])
        return None

    def mark_chat_seen(self, ids: Iterable[int]) -> None:
        for cid in ids:
            self.db.execute("UPDATE chat SET seen = 1 WHERE id = ?", (cid,))

    # ---- stats -------------------------------------------------------------

    def counts(self) -> dict[str, int]:
        scalar = self.db.scalar
        return {
            "notes": self.note_count(),
            "open_questions": self.count_open_questions(),
            "answered_questions": int(scalar("SELECT COUNT(*) FROM questions WHERE status = 'answered'", default=0)),
            "interests": int(scalar("SELECT COUNT(*) FROM interests", default=0)),
            "visits": int(scalar("SELECT COUNT(*) FROM visits", default=0)),
            "episodes": int(scalar("SELECT COUNT(*) FROM episodes", default=0)),
            "actions": int(scalar("SELECT COUNT(*) FROM actions", default=0)),
        }
