"""Requests between bots, on record (owner, 2026-09-24: "a CEO request to any bot is the top priority and must be
visible somewhere in the webapp").

Every direct bot-to-bot message is an event in one shared JSONL file (common-data/shared-state/requests.jsonl):
``request`` when sent, ``read`` when the recipient's model has seen it, ``answered`` when the recipient messages the
sender back (the oldest open request from that sender is taken as answered), ``resolved`` when the controller carried
it out itself (a drop-folder route line). A request from a priority sender (The CEO) is flagged; the recipient shows
it at the top of its state every cycle until it is answered. The webapp folds the same file into its Requests panel.
Append-only under an advisory lock, like the chatroom."""
from __future__ import annotations

import datetime as dt
import json
import re
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterator


STATUS_OPENERS = re.compile(
    r"^\s*(checked|noted|reviewed|read |looked|quick update|update:|fyi|heads.?up|just a note|for your information|"
    r"i checked|i noted|i reviewed|i looked|no direct relevance|status:|processed |"
    r"the owner dropped a file for you|new lead |done:|blocked|resolved:|responded|replied|answered|reporting|report:|"
    r"here is |here's |update on |summary:|as requested|following up|exploring|i am still working|i'm still working|"
    r"still working on|working on |from [a-z ]{2,30}:)", re.I)  # notices and reports, never asks
EXPIRE_HOURS = 48  # an ask nobody answered in two days is expired, not open (the Desk Agent never answers bots)


OWNER = "Owner"
INSTRUCTION = re.compile(r"\?|\b(please|should|let'?s|lets |i want|i need|i expect|can you|could you|make |create|update|shift|focus|find|list|"
                         r"search|design|start|stop|change|from now on|do not|don'?t|never|always|prioriti[sz]e|target)\b", re.I)


# An owner chat line about how much the bot talks ("you are sending me too many msgs", "take rest, 1 msg a day"): a
# setting, not work. Recording it as an open ask made the PRIORITY banner push The CEO to keep replying (2026-09-26).
QUIET = re.compile(r"too many (msgs|messages)|take (a )?rest|fewer (msgs|messages)|\b(1|one) (msg|message)s? (a|per) day|"
                   r"stop (messaging|sending)|less (msgs|messages)|don'?t (message|msg) me", re.I)
PROMISE = re.compile(r"^\W*(i will|i'll|will |i am going to|i'm going to|let me|next,? i|i plan to|going to)", re.I)
OWNER_ASK_HOURS = 3  # an owner's chat ask the bot never reported on is over after this long; the owner has moved on


def is_promise(text: str) -> bool:
    """"I'll message Lead Gen..." is a promise, not a report: it closes nothing (the CEO promised at 21:02 and did nothing)."""
    t = (text or "").strip()
    return bool(PROMISE.match(t)) or bool(re.search(r"\b(i'?ll|i will|will)\b[^.]{0,60}\b(message|ask|send|update|create|do|start)\b", t[:160], re.I))


def is_quiet_instruction(text: str) -> bool:
    """"you are sending me too many msgs" / "1 msg a day": the owner wants less chat, so it opens no ask."""
    return bool(QUIET.search((text or "").strip()[:300]))


def is_instruction(text: str) -> bool:
    """An owner chat line that asks for something ("lets shift some of our focus ..."), as opposed to "ok" or "thanks"."""
    t = (text or "").strip()
    if len(t) < 12 or is_status_note(t):
        return False
    directive = re.compile(r"\b(please|should|let'?s|lets |i want|i need|i expect|can you|could you|make |create|update|shift|focus|"
                           r"find|list|search|design|start|stop|change|from now on|do not|don'?t|never|always|prioriti[sz]e|target)\b", re.I)
    if "?" in t and not directive.search(t):
        return False  # "what are you doing?" is a question for the chat, not work for the loop
    return bool(INSTRUCTION.search(t))


def passes_on(ask: str, message: str) -> bool:
    """A message to a colleague carries out the owner's ask when it shares two or more content words with it
    (The CEO posted the owner's SMB shift to the fleet at 17:59 and the ask stayed open, 2026-09-26)."""
    words = lambda s: {w for w in re.findall(r"[a-z0-9]+", (s or "").lower()) if len(w) > 2 and w not in _STOP}  # noqa: E731
    return len(words(ask) & words(message)) >= 2


_STOP = frozenset("please the a an and or to of for in on with your you our we i it is are be that this by as at from".split())


def same_ask(a: str, b: str) -> bool:
    """Two texts are the same ask when they share their opening, or are close as strings, or share most of their content
    words. Thresholds measured by the Validator on the CEO's five "shift to SMB leads" repeats (ratio 0.63-0.79, word
    Jaccard 0.35-0.71) against unrelated asks (Jaccard 0.10-0.20), 2026-09-25. Route lines and file notices that name
    different files are never the same ask."""
    import difflib

    x, y = " ".join((a or "").lower().split()), " ".join((b or "").lower().split())
    if not x or not y:
        return False
    template = re.compile(r"^(route |file dropped by the owner:)")  # one message shape, many files: never the same ask
    if template.match(x) or template.match(y) or is_status_note(x) or is_status_note(y):
        return x == y
    if x[:60] == y[:60]:
        return True
    if difflib.SequenceMatcher(None, x, y).ratio() >= 0.65:
        return True
    wx = {w for w in re.findall(r"[a-z0-9']+", x) if w not in _STOP}
    wy = {w for w in re.findall(r"[a-z0-9']+", y) if w not in _STOP}
    return bool(wx and wy) and len(wx & wy) / len(wx | wy) >= 0.5


# Progress reports that open like this ask nothing -- when they carry no question mark. 2026-10-07: 21 of the 38 open
# requests on the owner's Requests page were the Package Designer's reports to The CEO ("Handed The CEO ...", "Compared
# ...", "Could not find ...", "Will compare ...", "new package ...") sitting open for two days.
REPORT_OPENERS = re.compile(
    r"^\s*(handed|compared|updated|sent |proposed|ready to|will |could not|couldn't|did not find|found |i found|i've found|"
    r"i have found|i compared|i updated|i sent|i handed|new package |published|listed|finished|completed|started|"
    r"thanks|thank you|great work|well done|good work)", re.I)  # a thank-you held Lead Gen 30 actions as a "priority ask" (2026-10-05)


def is_status_note(text: str) -> bool:
    """A message that reports what the sender did ("Checked the Builtin jobs page, not relevant") asks nothing of
    the reader; it is information, never a request and never a priority (The CEO sent nine of them on 2026-09-25)."""
    return bool(STATUS_OPENERS.match(text or ""))


def is_notice(text: str) -> bool:
    """On the requests record only: a status note, or a progress report with no question in it. Kept apart from
    is_status_note, which also decides when a message is unsolicited (policy)."""
    t = text or ""
    if t.lower().startswith("could not:"):  # the engine's release of a stuck ask: a notice, however it quotes the ask
        return True
    return is_status_note(t) or ("?" not in t and bool(REPORT_OPENERS.match(t)))


@dataclass
class Request:
    id: str
    sender: str
    to: str
    text: str
    sent_at: str
    priority: bool = False
    read_at: str = ""
    answered_at: str = ""
    answer: str = ""
    resolved_at: str = ""

    expired: bool = False

    @property
    def open(self) -> bool:
        return not (self.answered_at or self.resolved_at or self.expired)


@dataclass
class RequestLog:
    path: Path
    priority_senders: list[str] = field(default_factory=lambda: ["The CEO"])
    now: "dt.datetime | None" = None

    def _now(self) -> str:
        return (self.now or dt.datetime.now()).isoformat(timespec="seconds")

    @contextmanager
    def _locked(self) -> Iterator[None]:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        lock = self.path.with_name(self.path.name + ".lock")
        fh = open(lock, "a", encoding="utf-8")  # noqa: SIM115
        try:
            try:
                import fcntl

                fcntl.flock(fh, fcntl.LOCK_EX)
            except (ImportError, OSError):
                pass
            yield
        finally:
            try:
                import fcntl

                fcntl.flock(fh, fcntl.LOCK_UN)
            except (ImportError, OSError):
                pass
            fh.close()

    def _append(self, event: dict) -> None:
        event.setdefault("at", self._now())
        with self._locked():
            with self.path.open("a", encoding="utf-8") as f:
                f.write(json.dumps(event, ensure_ascii=False) + "\n")

    # ----- writers ------------------------------------------------------------------------------------------------
    def record(self, id: str, sender: str, to: str, text: str) -> Request:
        """On record. A notice ("the owner dropped a file for you", "Responded to ...") is closed at once: it is
        information, never an ask, so it must not sit open on the owner's Requests page (five did, 2026-09-25)."""
        notice = is_notice(text)
        priority = sender.strip().lower() in {p.strip().lower() for p in self.priority_senders} and not notice
        self._append({"kind": "request", "id": id, "from": sender, "to": to, "text": text.strip()[:900], "priority": priority})
        if notice:
            self._append({"kind": "resolved", "id": id, "note": "a notice, not an ask"})
        return Request(id, sender, to, text.strip()[:900], self._now(), priority, resolved_at=self._now() if notice else "")

    def mark_read(self, ids: list[str]) -> None:
        for id in ids:
            self._append({"kind": "read", "id": id})

    def answer(self, requester: str, me: str, answer_text: str) -> Request | None:
        """`me` messaged `requester`: the oldest open request from them to me is answered by it -- unless the message is
        itself a notice ("new lead ...", "the owner dropped a file for you"), which answers nothing."""
        text = answer_text.strip()
        low = text.lower()
        if not low.startswith("done"):
            if re.match(r"^(new lead |the owner dropped a file for you|file dropped by the owner:|route )", low):
                return None  # an announcement answers nothing
            if "?" in text:
                return None  # a question back ("could you send the list?") is a clarification, not an answer (Lead Gen, 2026-09-25)
            if low.startswith(("please", "could you", "can you", "i need you to")):
                return None  # an ask is not an answer to their ask (the CEO's "Please shift ..." closed Lead Gen's 21:02 report)
        # A report-style reply ("Shifted focus to ...", "Responded to the question: ...") IS the answer when they have an
        # open ask of me. It closes that ask and any open repeat of it (the CEO asked the same thing twice, 2026-09-25).
        open_ = [r for r in self.open_for(me) if r.sender.strip().lower() == requester.strip().lower()]
        if not open_:
            return None
        r = open_[0]
        self._append({"kind": "answered", "id": r.id, "answer": text[:300]})
        for dup in open_[1:]:
            if same_ask(dup.text, r.text):
                self._append({"kind": "answered", "id": dup.id, "answer": "(same ask) " + text[:280]})
        return r

    def record_owner_instruction(self, id: str, to: str, text: str, replied: str | None = None) -> Request | None:
        """An owner chat line that asks for something becomes this bot's top request; the previous open owner
        instruction is superseded by it (the owner's latest word is the one that counts). Read at once.
        `replied` is the dashboard's chat answer to that line, if one exists: an owner QUESTION the chat already
        answered is no loop work, and a question never supersedes a standing order (2026-09-26: "what prompt should
        I send the dev agent?" replaced the three-month SMB order and sent The CEO chasing a "dev agent")."""
        if is_quiet_instruction(text):  # "send fewer messages" is answered by sending fewer, not by a reply
            for r in self.open_for(to):
                if r.sender == OWNER:
                    self.resolve(r.id, "the owner asked for quiet")
            return None
        if not is_instruction(text):
            return None
        question = "?" in text
        if question and replied and not is_promise(replied):
            return None
        if not question:
            for r in self.open_for(to):
                if r.sender == OWNER:
                    self.resolve(r.id, "superseded by the owner's next chat message")
        self._append({"kind": "request", "id": id, "from": OWNER, "to": to, "text": text.strip()[:900], "priority": True})
        self.mark_read([id])
        return Request(id, OWNER, to, text.strip()[:900], self._now(), True, read_at=self._now())

    def resolve(self, id: str, note: str) -> None:
        self._append({"kind": "resolved", "id": id, "note": note[:200]})

    # ----- readers ------------------------------------------------------------------------------------------------
    def all(self) -> list[Request]:
        if not self.path.is_file():
            return []
        by_id: dict[str, Request] = {}
        for line in self.path.read_text(encoding="utf-8", errors="replace").splitlines():
            try:
                e = json.loads(line)
            except ValueError:
                continue
            kind, id = e.get("kind"), str(e.get("id", ""))
            if kind == "request":
                by_id[id] = Request(id, str(e.get("from", "")), str(e.get("to", "")), str(e.get("text", "")),
                                    str(e.get("at", "")), bool(e.get("priority")))
            elif id in by_id:
                r = by_id[id]
                if kind == "read" and not r.read_at:
                    r.read_at = str(e.get("at", ""))
                elif kind == "answered":
                    r.answered_at, r.answer = str(e.get("at", "")), str(e.get("answer", ""))
                elif kind == "resolved":
                    r.resolved_at = str(e.get("at", ""))
        now = self.now or dt.datetime.now()
        cutoff = (now - dt.timedelta(hours=EXPIRE_HOURS)).isoformat(timespec="seconds")
        owner_cutoff = (now - dt.timedelta(hours=OWNER_ASK_HOURS)).isoformat(timespec="seconds")
        for r in by_id.values():
            if not (r.answered_at or r.resolved_at) and r.sent_at and (r.sent_at < cutoff or (r.sender == OWNER and r.sent_at < owner_cutoff)):
                r.expired = True
        return sorted(by_id.values(), key=lambda r: r.sent_at)

    def open_for(self, me: str) -> list[Request]:
        """Open requests addressed to `me`, priority ones first, oldest first. Priority is the READER's view: the sender
        recorded the row with its own priority_senders (The CEO's asks to Lead Gen came out priority=false because the
        CEO's own list names the Desk Agent), so the reader re-judges it against the list this log was built with."""
        mine = [r for r in self.all() if r.open and r.to.strip().lower() == me.strip().lower()]
        prio = {p.strip().lower() for p in self.priority_senders} | {OWNER.lower()}  # the owner outranks everyone
        for r in mine:
            if not r.priority and r.sender.strip().lower() in prio and not is_status_note(r.text):
                r.priority = True
        return sorted(mine, key=lambda r: (not r.priority, r.sent_at))
