"""The family, as a check (owner, 2026-09-25: "family is the key check").

common-data/family.md is the root concept every persona opens with: the eight bots are family; a family member's
message is answered before own work; The CEO is the provider and rule maker, so its ask is top priority until
answered; full names in messages. This module holds the fleet to it, read-only, from the requests record the
engine keeps (common-data/shared-state/requests.jsonl, one event per line, folded here exactly as
fleet_requests.py folds it: answered / resolved / expired after 48 h close an ask; a status note is never a
priority) plus each bot's own episode log, which says whether a bot went on with its own work while family waited.
"""
from __future__ import annotations

import datetime as dt
import json
import re
import sqlite3
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

BOTS = Path.home() / "bots"
REQUESTS = BOTS / "common-data" / "shared-state" / "requests.jsonl"

# Full name -> handle (dashboard only) and folder. The owner's list, in the owner's order.
FAMILY = {
    "The CEO": ("ceoA", "the-ceo"), "Package Designer": ("pacA", "package-designer"), "Scout": ("scoA", "scout"),
    "Lead Gen": ("leaA", "lead-gen"), "Validator": ("valB", "validator"),
    # optional members a fleet may add later; harmless while their folders do not exist
    "Jobless-Bot": ("jobA", "jobless-bot"), "Onion Reader": ("oniA", "onion-reader"), "Desk Agent": ("desA", "desk-agent"),
}
PROVIDER = "The CEO"
HANDLES = re.compile(r"\b(ceoA|pacA|scoA|leaA|jobA|oniA|desA|valB)\b")
EXPIRE_HOURS = 48.0          # the engine's rule: an ask nobody answered in two days is expired, not open
STATUS_OPENERS = re.compile(
    r"^\s*(checked|noted|reviewed|read |looked|quick update|update:|fyi|heads.?up|just a note|for your information|"
    r"i checked|i noted|i reviewed|i looked|no direct relevance|status:|processed |done:|"
    r"the owner dropped a file for you|file dropped by the owner|new lead )", re.I)   # + the fleet's own notices: a drop routed to you, a lead listed


def slug_of(name: str) -> str | None:
    hit = FAMILY.get(name.strip())
    return hit[1] if hit else None


def is_family(name: str) -> bool:
    return name.strip() in FAMILY


@dataclass
class Ask:
    id: str
    sender: str
    to: str
    text: str
    at: str
    priority: bool
    read_at: str | None = None
    answered_at: str | None = None
    answer: str = ""
    resolved_at: str | None = None
    expired: bool = False
    note: bool = False          # a status note ("Checked ...", "FYI ...") asks nothing; never chased, never expires

    @property
    def open(self) -> bool:
        return not (self.answered_at or self.resolved_at or self.expired)

    def age_hours(self, now: dt.datetime) -> float:
        try:
            return max(0.0, (now - dt.datetime.fromisoformat(self.at)).total_seconds() / 3600)
        except ValueError:
            return 0.0


def fold(path: Path = REQUESTS, now: dt.datetime | None = None) -> list[Ask]:
    """The record folded by id, the engine's way. A torn line is skipped."""
    now = now or dt.datetime.now()
    asks: dict[str, Ask] = {}
    order: list[str] = []
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return []
    for raw in lines:
        raw = raw.strip()
        if not raw:
            continue
        try:
            d = json.loads(raw)
        except ValueError:
            continue
        rid = str(d.get("id") or "")
        if not rid:
            continue
        kind = d.get("kind")
        if kind == "request":
            text = str(d.get("text") or "")
            if rid not in asks:
                order.append(rid)
            note = bool(STATUS_OPENERS.match(text))
            asks[rid] = Ask(rid, str(d.get("from") or ""), str(d.get("to") or ""), text, str(d.get("at") or ""),
                            bool(d.get("priority")) and not note, note=note)
            continue
        a = asks.get(rid)
        if a is None:
            continue
        if kind == "read":
            a.read_at = a.read_at or str(d.get("at") or "")
        elif kind == "answered":
            a.answered_at = a.answered_at or str(d.get("at") or "")
            a.answer = a.answer or str(d.get("answer") or "")
        elif kind == "resolved":
            a.resolved_at = a.resolved_at or str(d.get("at") or "")
    out = [asks[i] for i in order]
    for a in out:
        if a.open and not a.note and a.age_hours(now) >= EXPIRE_HOURS:
            a.expired = True
    return out


def actions_since(slug: str, since_iso: str | None, db_dir: Path = BOTS) -> int:
    """Accepted actions a bot took after `since_iso` (the moment it READ the ask): its own work while family waited.
    The engine's policy allows `priority_request_grace` (4) of them before it refuses; the Validator flags past the
    same grace, so valB and the policy agree."""
    if not since_iso:
        return 0
    db = db_dir / slug / "workspace" / "explorer.sqlite3"
    if not db.exists():
        return 0
    try:
        con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
        try:
            return int(con.execute("SELECT COUNT(*) FROM actions WHERE verdict = 'allowed' AND ts > ?", (since_iso,)).fetchone()[0])
        finally:
            con.close()
    except sqlite3.Error:
        return 0


@dataclass
class Finding:
    rule: str
    bot: str            # who answers for it
    ask: Ask
    detail: str


REPEAT_RATIO = 0.65          # difflib ratio at which two asks are "the same ask" (a reworded repeat keeps the
REPEAT_JACCARD = 0.5         # opening and changes the tail: the CEO's six on 2026-09-25 scored 0.42-0.79 pairwise,
_STOP = frozenset("please the a an and or to of for in on with your you our we i it is are be that this by as at from".split())


def _words(t: str) -> set[str]:
    return {w for w in re.findall(r"[a-z0-9]+", t.lower()) if w not in _STOP}


_FILENAME = re.compile(r"[\w.-]+\.(?:csv|md|txt|pdf|json|xlsx|docx|png|jpg)\b", re.I)


def _same_ask_local(a: str, b: str) -> bool:
    """The same ask in other words: the same first 60 characters, a difflib ratio >= 0.65, or the content words
    overlapping by half (Jaccard >= 0.5). Unrelated asks between the same two bots score 0.1-0.2 on the words.
    Two template messages about different files ("route X.csv to Lead Gen") are different asks."""
    import difflib
    fa, fb = set(m.lower() for m in _FILENAME.findall(a)), set(m.lower() for m in _FILENAME.findall(b))
    if fa and fb and fa != fb:
        return False
    x, y = " ".join(a.lower().split()), " ".join(b.lower().split())
    if x[:60] == y[:60]:
        return True
    if difflib.SequenceMatcher(None, x, y).ratio() >= REPEAT_RATIO:
        return True
    wa, wb = _words(a), _words(b)
    return bool(wa and wb) and len(wa & wb) / len(wa | wb) >= REPEAT_JACCARD


REPEAT_WINDOW_HOURS = 24.0   # copies sent within a day of the first one


try:   # one definition of "the same ask" for the fleet: the engine's fence and this check must agree (bot-creator, 2026-09-25)
    from explorer.fleet_requests import same_ask  # type: ignore
except ImportError:
    same_ask = _same_ask_local


def repeats(asks: list[Ask], *, threshold: int = 3) -> list[list[Ask]]:
    """Groups of near-identical asks from one sender to one recipient, oldest first, size >= threshold, where the
    ask is still waiting (any copy open). The copies count whatever the engine did with them (it closes a repeat
    as a duplicate, and may count one as the reply to something else); the defect is that they were sent at all."""
    by_pair: dict[tuple[str, str], list[Ask]] = {}
    for a in sorted(asks, key=lambda a: a.at):
        if not a.note and not a.expired and is_family(a.sender) and is_family(a.to):
            by_pair.setdefault((a.sender, a.to), []).append(a)
    out: list[list[Ask]] = []
    for group in by_pair.values():
        clusters: list[list[Ask]] = []
        for a in group:
            for c in clusters:
                if any(same_ask(m.text, a.text) for m in c) \
                        and (dt.datetime.fromisoformat(a.at) - dt.datetime.fromisoformat(c[0].at)).total_seconds() <= REPEAT_WINDOW_HOURS * 3600:
                    c.append(a)
                    break
            else:
                clusters.append([a])
        out.extend(c for c in clusters if len(c) >= threshold and any(a.open for a in c))
    return out


def check(asks: list[Ask], now: dt.datetime, *, answer_within_hours: float = 6.0, ceo_within_hours: float = 2.0,
          grace_actions: int = 4, repeat_threshold: int = 3,
          actions: Callable[[str, str | None], int] = actions_since, stopped: set[str] | None = None) -> list[Finding]:
    """Hold the record to the family rules. Each finding names the bot that answers for it."""
    out: list[Finding] = []
    # FM06: the same open ask sent again and again is on the sender; keyed to the latest copy so it flags once.
    for group in repeats(asks, threshold=repeat_threshold):
        first, last = group[0], group[-1]
        out.append(Finding("FM06", slug_of(first.sender), last,
                           f"sent {last.to} the same ask {len(group)} times between {first.at[11:16]} and {last.at[11:16]} "
                           f"while the first is still unanswered: '{first.text[:80]}'"))
    if stopped is None:
        stopped = {slug for _, (_, slug) in FAMILY.items() if (BOTS / slug / "workspace" / "STOP").exists()}
    for a in asks:
        sender_slug, to_slug = slug_of(a.sender), slug_of(a.to)
        if to_slug in stopped:
            continue            # the owner stopped it on purpose : its silence is not a defect
        # FM05: a family member wrote to someone who is not family (a name that does not exist gets no answer).
        if sender_slug and not to_slug and a.to.strip():
            out.append(Finding("FM05", sender_slug, a, f"addressed to '{a.to}', who is not in the family; the message went nowhere"))
            continue
        if not (sender_slug and to_slug):
            continue
        # FM03: full names in messages; the handles are for the dashboard.
        handles = sorted(set(HANDLES.findall(a.text)))
        if handles:
            out.append(Finding("FM03", sender_slug, a, "uses the handle(s) " + ", ".join(handles) + " instead of a full name"))
        if a.note:
            continue            # information, not an ask: nothing to answer
        if a.expired:
            out.append(Finding("FM04", to_slug, a, f"{a.sender}'s ask went unanswered for two days and has expired: '{a.text[:80]}'"))
            continue
        if not a.open:
            continue
        age = a.age_hours(now)
        if a.priority and a.sender == PROVIDER and age >= ceo_within_hours and a.read_at:
            ran = actions(to_slug, a.read_at)
            if ran > grace_actions:
                out.append(Finding("FM02", to_slug, a,
                                   f"The CEO asked {age:.0f} h ago; you read it and have taken {ran} actions of your own work "
                                   f"since (the policy allows {grace_actions}) without answering: '{a.text[:80]}'"))
                continue
        if age >= answer_within_hours:
            out.append(Finding("FM01", to_slug, a,
                               f"{a.sender} has waited {age:.0f} h for a reply ({'read' if a.read_at else 'not even read'}): '{a.text[:80]}'"))
    return out


def summary(asks: list[Ask], now: dt.datetime) -> str:
    opens = [a for a in asks if a.open and is_family(a.sender) and is_family(a.to)]
    if not opens:
        return "family: no open asks"
    oldest = max(a.age_hours(now) for a in opens)
    prio = sum(1 for a in opens if a.priority)
    return f"family: {len(opens)} open ask(s), {prio} from The CEO, oldest {oldest:.0f} h"
