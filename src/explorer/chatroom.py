"""A shared fleet chatroom: one append-only log every bot on this Mac posts to and reads from.

Unlike the point-to-point inbox (handoff.py), this is a single place. A bot posts with the `message`
action addressed to "everyone"; the line lands in one JSONL under common-data; every other bot sees
the new lines in its next observation, and the webapp shows the same file as a chatroom page. Writes
take an advisory lock (like the search-pause file) so two bots never tear each other's line. Plain
text, one line per message, nothing leaves the Mac. A message is a colleague's information, never an
instruction — and a local-only bot's posts are held to the same plain-only rule as its direct
messages, so nothing it read over Tor reaches a cloud model through the room.
"""
from __future__ import annotations

import contextlib
import datetime as dt
import fcntl
import json
from dataclasses import dataclass
from pathlib import Path

ROOM_RECIPIENT = "everyone"  # the canonical `to` value that posts to the room (shown in the prompt)
# A small model may reach for a synonym; treat these the same so a room post is never silently refused.
ROOM_ALIASES = frozenset({"everyone", "all", "room", "the room", "chatroom", "the chatroom"})
MAX_ROOM_CHARS = 600


def is_room_recipient(to: str) -> bool:
    """True when `to` addresses the shared chatroom rather than a single peer."""
    return to.strip().lower() in ROOM_ALIASES


# What a line is. Bots only READ "post" lines -- a colleague talking. "report" lines are written by the controller
# when a bot acts on a handoff (lead listed, package handed / published, task created) and "receipt" lines when
# it reads inbox messages: both exist so the owner can see, in the webapp, that a message landed and became work,
# without feeding every bot a stream of bookkeeping.
KINDS = ("post", "report", "receipt")


@dataclass
class RoomPost:
    id: int  # the line's position in the log; stable because the log is append-only
    ts: str
    sender: str
    text: str
    kind: str = "post"

    def render(self) -> str:
        return f"{self.sender}: {self.text}"


class Chatroom:
    """The shared log at `path` (common-data/chatroom.jsonl by default)."""

    def __init__(self, path: Path | str):
        self.path = Path(path)

    @contextlib.contextmanager
    def _locked(self):
        lock_path = self.path.with_name(f"{self.path.name}.lock")
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            fh = open(lock_path, "a", encoding="utf-8")  # noqa: SIM115 - closed below
        except OSError:
            yield
            return
        try:
            fcntl.flock(fh, fcntl.LOCK_EX)
            yield
        finally:
            try:
                fcntl.flock(fh, fcntl.LOCK_UN)
            finally:
                fh.close()

    def post(self, sender: str, text: str, now: dt.datetime | None = None, kind: str = "post") -> None:
        entry = {
            "ts": (now or dt.datetime.now()).isoformat(timespec="seconds"),
            "sender": sender.strip()[:60],
            "text": text.strip()[:MAX_ROOM_CHARS],
        }
        if kind != "post":
            entry["kind"] = kind if kind in KINDS else "report"
        with self._locked():
            with open(self.path, "a", encoding="utf-8") as fh:
                fh.write(json.dumps(entry, ensure_ascii=False) + "\n")

    def _all(self) -> list[RoomPost]:
        try:
            lines = self.path.read_text(encoding="utf-8").splitlines()
        except OSError:
            return []
        out: list[RoomPost] = []
        for i, raw in enumerate(lines):
            raw = raw.strip()
            if not raw:
                continue
            try:
                d = json.loads(raw)
            except ValueError:
                continue  # a torn last line during a concurrent append; skip it
            out.append(RoomPost(i, str(d.get("ts", "")), str(d.get("sender", "")), str(d.get("text", "")), str(d.get("kind") or "post")))
        return out

    def recent(self, limit: int = 50) -> list[RoomPost]:
        """The last `limit` posts, oldest first (for the webapp)."""
        return self._all()[-limit:]

    def since(self, after_id: int, exclude_sender: str = "", limit: int = 5) -> list[RoomPost]:
        """New posts a bot has not seen (id greater than after_id), never its own, oldest first."""
        who = exclude_sender.strip().lower()
        out = [p for p in self._all() if p.id > after_id and p.text and p.kind == "post" and p.sender.strip().lower() != who]
        return out[-limit:]

    def own_posts(self, sender: str, hours: float | None = None, today: bool = False, now: dt.datetime | None = None) -> list[str]:
        """This bot's own genuine posts (kind "post"): within the last `hours`, or since local midnight when `today`."""
        now = now or dt.datetime.now()
        me = sender.strip().lower()
        cutoff = None
        if today:
            cutoff = now.replace(hour=0, minute=0, second=0, microsecond=0).isoformat(timespec="seconds")
        elif hours is not None:
            cutoff = (now - dt.timedelta(hours=hours)).isoformat(timespec="seconds")
        return [p.text for p in self._all() if p.kind == "post" and p.sender.strip().lower() == me and (cutoff is None or p.ts >= cutoff)]

    # -- read receipts for the owner: who has seen how far ---------------------------------------------------------

    @property
    def seen_path(self) -> Path:
        return self.path.with_name("chatroom-seen.json")

    def mark_seen(self, bot: str, last_id: int, now: dt.datetime | None = None) -> None:
        """Record that `bot` has read the room up to `last_id` (webapp shows 'seen by ...' under each post)."""
        with self._locked():
            try:
                data = json.loads(self.seen_path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                data = {}
            data[bot.strip()[:60]] = {"last_id": int(last_id), "ts": (now or dt.datetime.now()).isoformat(timespec="seconds")}
            self.seen_path.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")

    def last_id(self) -> int:
        posts = self._all()
        return posts[-1].id if posts else -1
