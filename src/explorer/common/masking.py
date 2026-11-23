"""One mask on every request that leaves for a remote model.

A lead's email, phone and contact name go out as tokens such as [EMAIL_1] and come back as
the real value before the reply is parsed or any check reads it. The map lives in memory for one call and is never logged
or stored. A token the reply left over, changed or invented makes the reply a failure, so nothing written carries it and
the chain asks the next provider.

What this does NOT hide, and the reports must say so: a person's name that is on no row yet (reading a new contact from a
page is the job, and model.new_names_open decides which providers may see it), an address spelled out in words, text inside an image,
a phone number outside the usual US forms unless a row holds it, and business names, which stay readable on purpose.
"""
from __future__ import annotations

import contextlib
import contextvars
import json
import logging
import re
import threading
import time
from collections.abc import Iterable, Iterator
from pathlib import Path
from typing import Any

RELOAD_SECONDS = 60.0

LEGEND = (
    "Some values are shown as tokens such as [EMAIL_1], [PHONE_1], [CONTACT_1] or [CONTACT_FIRST_1]. Each stands for a real value, "
    "hidden only in this message, and the real value is put back in your reply before anyone reads it. Use a token wherever you "
    "would use that value; copy it exactly; never change, spell out, guess or invent a token. When a draft's row has a contact "
    "token, greet that person with it, with that row's number: \"Hi [CONTACT_1],\" (it becomes the first name). [CONTACT_FIRST_n] is "
    "that person's first name. An email token's label says what it is: ROLE a shared address such as info@, OWN_DOMAIN on the "
    "business's own domain, FREE_MAIL a free mailbox, OTHER_DOMAIN any other domain."
)

_EMAIL = re.compile(r"(?<![\w.+-])[A-Za-z0-9][\w.+-]*@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}(?![\w-])")
_NOT_AN_ADDRESS = (".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".css", ".js")
_PHONE = re.compile(
    r"(?<![\w.-])(?:\+1[\s.-]?\d{3}[\s.-]?\d{3}[\s.-]?\d{4}|1-\d{3}-\d{3}-\d{4}|\(\d{3}\)\s?\d{3}[\s.-]\d{4}|\d{3}[.-]\d{3}[.-]\d{4})(?![\w-])"
)
_TEL = re.compile(r"(?i)(?<=tel:)\+?[\d().\s-]{7,20}\d")
_DIGITS = re.compile(r"(?<![\w.-])\+?\d[\d\s().-]{6,18}\d(?![\w-])")
_WORD = re.compile(r"[^\W\d_]+(?:['’.-][^\W\d_]+)*")
_TOKEN = re.compile(r"\[(?:EMAIL|PHONE|CONTACT|CONTACT_FIRST)_\d+(?:_[A-Z]+)*\]")
# anything that still looks like a token after the real ones are put back: a changed case, a space, lost brackets
_LOOSE = re.compile(
    r"(?i:\[\s*(?:email|phone|contact(?:[ _-]first)?)[ _-]*\d+(?:[ _-][a-z]+)*\s*\])"
    r"|\b(?:EMAIL|PHONE|CONTACT(?:_FIRST)?)_\d+\b"
)
# A work-list row's contact: the greeting is said on the row itself, or a writer leaves a token it was told to be careful with out
_ROW_CONTACT = re.compile(r"(?<=\| contact: )(\[CONTACT_\d+\])(?= \|)")
_GREETING = re.compile(r"(?i)\b(hi|hello|hey|dear)(\s+)\[CONTACT_(\d+)\]")

FREE_MAIL = frozenset({
    "gmail.com", "googlemail.com", "yahoo.com", "ymail.com", "hotmail.com", "outlook.com", "live.com", "msn.com", "aol.com",
    "icloud.com", "me.com", "mac.com", "proton.me", "protonmail.com", "gmx.com", "mail.com", "zoho.com", "verizon.net",
    "optonline.net", "comcast.net", "att.net", "sbcglobal.net", "bellsouth.net", "earthlink.net", "cox.net", "charter.net",
})
ROLE_BOXES = frozenset({
    "info", "contact", "hello", "hi", "sales", "support", "admin", "office", "team", "booking", "bookings", "reservations",
    "reserve", "orders", "order", "help", "service", "services", "mail", "enquiries", "inquiries", "inquiry", "billing",
    "careers", "jobs", "press", "marketing", "franchise", "franchising", "events", "catering", "manager", "customerservice",
})
# A cell that says who answers rather than who someone is
ROLE_WORDS = frozenset({
    "owner", "owners", "manager", "managers", "team", "staff", "info", "sales", "support", "customer", "customers", "service",
    "services", "front", "desk", "office", "admin", "administrator", "general", "reception", "receptionist", "founder",
    "cofounder", "ceo", "president", "director", "department", "management", "unknown", "none", "contact", "person", "family",
    "n/a", "na", "tbd", "hr", "marketing", "bookings", "reservations",
})
TITLES = frozenset({"dr", "mr", "mrs", "ms", "mx", "prof", "sir", "chef", "rev", "fr", "sr", "jr", "miss", "madam"})
# Real first names that are also everyday words: masked only where the text says it is the person
ORDINARY = frozenset({
    "best", "will", "mark", "grace", "hope", "joy", "faith", "may", "april", "june", "august", "rose", "art", "bill", "frank",
    "sunny", "summer", "autumn", "dawn", "sky", "star", "love", "angel", "major", "king", "prince", "duke", "earl", "chase",
    "hunter", "page", "penny", "ray", "rich", "rob", "sue", "pat", "don", "dean", "guy", "jack", "max", "miles", "wade", "bob",
    "thanks", "regards", "hello", "dear", "team", "lee", "long", "young", "white", "black", "brown", "green", "gray", "grey",
})
_NAMED_HERE = re.compile(r"(?i)(?:\b(?:hi|hello|hey|dear|contact|contact person|contact_person|owner|manager|name)\s*[:=,-]?\s*[\"']?)$")

_log = logging.getLogger("explorer")


class MaskFailed(ValueError):
    """The reply kept, changed or invented a token. Carries a count, never a value."""


# What a call may carry decides who may see it. Set where the call is made, never read from the text. "personal", anything unmarked: masked, and never to a provider in model.personal_closed. "new_names": a
# contact-finding member's decide turn, which reads a person's name on no row and so cannot be masked: unmasked, only the
# providers in model.new_names_open. "page": a sample page, which carries no person's name and the business's own phone and
# street word for word: unmasked, and it follows personal_closed. "own_text": our own words, any provider.
DATA_KINDS = ("personal", "new_names", "page", "own_text")
UNMASKED_KINDS = ("new_names", "page", "own_text")
_kind: contextvars.ContextVar[str] = contextvars.ContextVar("mask_kind", default="")


@contextlib.contextmanager
def call_kind(kind: str) -> Iterator[None]:
    """The data kind of the calls inside this block, where the prompt is built. Never read from the text."""
    if kind not in DATA_KINDS:
        raise ValueError(f"unknown data kind {kind!r}")
    mark = _kind.set(kind)
    try:
        yield
    finally:
        _kind.reset(mark)


def closed(cfg: Any, name: str) -> str:
    """Why this chain name may not take the current call, or "" when it may."""
    kind = _kind.get() or "personal"
    if kind == "own_text":
        return ""
    allowed = list(getattr(cfg, "new_names_open", []) or [])
    if kind == "new_names" or (allowed and not getattr(cfg, "mask_personal", True)):     # nothing hides the names on this call
        return "" if name in allowed else "closed to unmasked names"
    return "closed to personal data" if name in (getattr(cfg, "personal_closed", []) or []) else ""


def _words(text: str) -> tuple[str, ...]:
    return tuple(w.casefold().strip(".-'’") for w in _WORD.findall(text or ""))


def first_name(contact: str, business: str = "") -> str:
    """The first name when it can be told safely, else "": then a draft greets the business and names nobody."""
    parts = str(contact or "").split()
    if not parts or len(parts) > 4:
        return ""
    first = parts[0]
    bare = first.casefold().strip(".,")
    if first.endswith(".") or len(bare) < 2 or not first.replace("-", "").replace("'", "").replace("’", "").isalpha() or not first[0].isupper():
        return ""
    if bare in TITLES or bare in ROLE_WORDS or any(w in ROLE_WORDS for w in _words(contact)):
        return ""
    if bare in set(_words(business)):
        return ""
    return first


def _is_person(contact: str, business: str) -> bool:
    words = _words(contact)
    if not words or len(words) > 4 or any(w in ROLE_WORDS for w in words):
        return False
    if any(ch.isdigit() or ch in "@/&" for ch in contact):
        return False
    return not set(words) <= set(_words(business))


def _phone_keys(value: Any) -> set[str]:
    out = set()
    for piece in re.split(r"[,;/]| or ", str(value or "")):
        d = re.sub(r"\D", "", piece)
        if len(d) >= 10:
            out.add(d[1:] if len(d) == 11 and d.startswith("1") else d)
    return out


class Known:
    """What the lead rows hold, for finding it in a prompt. Rebuilt from the board cache when the file changes."""

    def __init__(self, rows: Iterable[dict] = ()) -> None:
        self.phones: set[str] = set()
        self.people: dict[tuple[str, ...], dict] = {}          # a full name's words -> its row's person
        self.business: dict[tuple[str, ...], list[dict]] = {}  # a business name's words -> the people on those rows
        self.lengths: list[int] = []
        self.biz_lengths: list[int] = []
        for row in rows:
            if isinstance(row, dict):
                self._add(row)
        self.lengths = sorted({len(k) for k in self.people}, reverse=True)
        self.biz_lengths = sorted({len(k) for k in self.business}, reverse=True)

    def _add(self, row: dict) -> None:
        self.phones |= _phone_keys(row.get("phone")) | _phone_keys(row.get("whatsapp"))
        business = str(row.get("business") or "").split(" | ")[0].strip()
        contact = str(row.get("contact_person") or "").strip()
        words = _words(business)
        person = None
        if contact and _is_person(contact, business):
            person = {"name": contact, "first": first_name(contact, business), "business": business, "words": _words(contact),
                      "domain": str(row.get("domain") or "").lower()}
            if len(person["words"]) >= 2:
                self.people.setdefault(person["words"], person)
        if words and len(words) <= 8:
            self.business.setdefault(words, [])
            self.business[words].append(person or {"name": "", "first": "", "business": business, "words": (),
                                                   "domain": str(row.get("domain") or "").lower()})


_known = Known()
_known_at = 0.0
_known_stamp = 0.0
_known_lock = threading.Lock()


def _cache_path() -> Path:
    from .keys import keys_dir
    return keys_dir().parent / "shared-state" / "portal-leads-cache.json"


def _load() -> Known:
    """The index, re-read at most once a minute and only when the file changed. A cache it cannot read keeps the last one."""
    global _known, _known_at, _known_stamp
    now = time.monotonic()
    if _known_at and now - _known_at < RELOAD_SECONDS:
        return _known
    with _known_lock:
        if _known_at and now - _known_at < RELOAD_SECONDS:
            return _known
        _known_at = now
        try:
            cache = _cache_path()
            stamp = cache.stat().st_mtime
            if stamp != _known_stamp:
                rows = (json.loads(cache.read_text(encoding="utf-8")).get("rows") or {}).values()
                _known, _known_stamp = Known(rows), stamp
        except (OSError, ValueError, AttributeError):
            _log.warning("the mask could not read the board cache; it keeps what it had and the pattern pass still runs")
    return _known


def board_readable() -> bool:
    """Whether the board copy behind the name mask can be read now (it may hold no rows yet). _load keeps going without it, as the
    pattern pass still hides addresses and numbers; a caller that must send nothing without the names asks this first."""
    try:
        return isinstance(json.loads(_cache_path().read_text(encoding="utf-8")).get("rows"), dict)
    except (OSError, ValueError, AttributeError):
        return False


def _set_known(rows: Iterable[dict]) -> None:
    """For tests: this index until the next call to it."""
    global _known, _known_at, _known_stamp
    _known, _known_at, _known_stamp = Known(rows), float("inf"), 0.0


def _reset_known() -> None:
    global _known, _known_at, _known_stamp
    _known, _known_at, _known_stamp = Known(), 0.0, 0.0


def email_label(address: str, own_domains: set[str]) -> str:
    box, _, domain = address.lower().partition("@")
    kind = "OWN_DOMAIN" if any(domain == d or domain.endswith("." + d) for d in own_domains if d) else (
        "FREE_MAIL" if domain in FREE_MAIL else "OTHER_DOMAIN")
    return f"ROLE_{kind}" if re.split(r"[.+_-]", box)[0] in ROLE_BOXES else kind


class Call:
    """One request's mask: the masked messages, and the way back for its reply."""

    def __init__(self, messages: list[dict[str, Any]], known: Known | None = None) -> None:
        self.known = known if known is not None else _load()
        self._tokens: dict[str, str] = {}     # kind + value -> token
        self._values: dict[str, str] = {}     # token -> value
        self._counts: dict[str, int] = {}
        self._people: dict[int, dict] = {}    # the number in [CONTACT_n] -> that person
        self._person_no: dict[str, int] = {}
        texts = [str(m.get("content") or "") for m in messages]
        self.literal = {t for x in texts for t in _TOKEN.findall(x)}     # already in the text before any masking
        self._taken = {(m.group(1), int(m.group(2))) for t in self.literal for m in [re.match(r"\[(EMAIL|PHONE|CONTACT_FIRST|CONTACT)_(\d+)", t)] if m}
        self.present = self._rows_in(texts)
        self.own = {p["domain"] for p in self.present if p.get("domain")}
        self.first = {}
        for p in self.present:
            if p.get("name") and p["words"]:
                key = (p["first"] or p["name"]).casefold() if len(p["words"]) == 1 or p["first"] else ""
                if key:
                    self.first.setdefault(key, p)
        out = [{**m, "content": self._mask(x)} if isinstance(m.get("content"), str) else m for m, x in zip(messages, texts)]
        if self._values:
            out = self._with_legend(out)
        self.messages = out

    @staticmethod
    def _with_legend(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
        for i, m in enumerate(messages):
            if m.get("role") == "system":
                return [*messages[:i], {**m, "content": f"{m['content']}\n\n{LEGEND}"}, *messages[i + 1:]]
        return [{"role": "system", "content": LEGEND}, *messages]

    def _rows_in(self, texts: list[str]) -> list[dict]:
        found: list[dict] = []
        for text in texts:
            hits = list(_WORD.finditer(text))
            words = [h.group().casefold().strip(".-'’") for h in hits]
            for i in range(len(words)):
                for n in self.known.biz_lengths:
                    key = tuple(words[i:i + n])
                    if len(key) == n and key in self.known.business:
                        if n > 1 or hits[i].group()[:1].isupper():    # one ordinary word in lower case is not the business
                            found.extend(self.known.business[key])
                        break
        seen, out = set(), []
        for p in found:
            if id(p) not in seen:
                seen.add(id(p))
                out.append(p)
        return out

    def _token(self, kind: str, value: str) -> str:
        key = f"{kind}|{value}"      # each spelling its own token: a value always comes back exactly as it was written
        if key not in self._tokens:
            head, _, label = kind.partition("|")
            n = self._counts.get(head, 0) + 1
            while (head, n) in self._taken:     # never the number of a token-shaped text already in the prompt
                n += 1
            self._counts[head] = n
            token = f"[{head}_{n}{'_' + label if label else ''}]"
            self._tokens[key], self._values[token] = token, value
            self._values[f"[{head}_{n}]"] = value      # the number alone is the same value: a model that drops the label loses nothing
        return self._tokens[key]

    def _person(self, p: dict, first: bool, written: str) -> str:
        # one number for a person's name and first name as the row spells them; another spelling (capitals) gets its own
        who = f"{p['name']}|{p['business']}" if written in (p["name"], p["first"]) else f"{written}|{p['business']}|{first}"
        if who not in self._person_no:
            n = max(self._people, default=0) + 1
            while ("CONTACT", n) in self._taken or ("CONTACT_FIRST", n) in self._taken:
                n += 1
            self._person_no[who] = n
            self._people[n] = p
        n = self._person_no[who]
        token = f"[CONTACT_{'FIRST_' if first else ''}{n}]"
        self._values[token] = written
        return token

    def _mask(self, text: str) -> str:
        spans: list[tuple[int, int, str]] = []
        for m in _EMAIL.finditer(text):
            if not m.group().lower().endswith(_NOT_AN_ADDRESS):
                spans.append((m.start(), m.end(), self._token(f"EMAIL|{email_label(m.group(), self.own)}", m.group())))
        for pattern in (_PHONE, _TEL):
            for m in pattern.finditer(text):
                spans.append((m.start(), m.end(), self._token("PHONE", m.group())))      # each written form its own token: it comes back as written
        for m in _DIGITS.finditer(text):
            if _phone_keys(m.group()) & self.known.phones:
                spans.append((m.start(), m.end(), self._token("PHONE", m.group())))      # each written form its own token: it comes back as written
        spans += self._name_spans(text)
        spans.sort(key=lambda s: (s[0], s[0] - s[1]))
        out, at = [], 0
        for start, end, token in spans:
            if start < at:
                continue
            out += [text[at:start], token]
            at = end
        out.append(text[at:])
        return _ROW_CONTACT.sub(r'\1 (greet: "Hi \1,")', "".join(out))

    def _name_spans(self, text: str) -> list[tuple[int, int, str]]:
        hits = list(_WORD.finditer(text))
        words = [h.group().casefold().strip(".-'’") for h in hits]
        guarded = [False] * len(hits)      # a business name stays readable, also when it holds a person's name
        for i in range(len(words)):
            for n in self.known.biz_lengths:
                if n > 1 and len(words[i:i + n]) == n and tuple(words[i:i + n]) in self.known.business:
                    for j in range(i, i + n):
                        guarded[j] = True
                    break
        out, i = [], 0
        while i < len(hits):
            step = 1
            for n in self.known.lengths:
                key = tuple(words[i:i + n])
                if len(key) == n and key in self.known.people and not any(guarded[i:i + n]) and all(h.group()[:1].isupper() for h in hits[i:i + n]):
                    out.append((hits[i].start(), hits[i + n - 1].end(), self._person(self.known.people[key], False, text[hits[i].start():hits[i + n - 1].end()])))
                    step = n
                    break
            else:
                p = self.first.get(words[i]) if not guarded[i] and hits[i].group()[:1].isupper() else None
                if p and (words[i] not in ORDINARY or _NAMED_HERE.search(text[max(0, hits[i].start() - 24):hits[i].start()])):
                    out.append((hits[i].start(), hits[i].end(), self._person(p, bool(p["first"]), hits[i].group())))
            i += step
        return out

    def restore(self, reply: str, json_text: bool | None = None) -> str:
        """The reply with the real values back. Raises MaskFailed if anything token-shaped is left."""
        if not reply or not (self._values or self.literal):
            return reply
        is_json = reply.lstrip()[:1] in "{[`" if json_text is None else json_text
        put = (lambda v: json.dumps(v, ensure_ascii=False)[1:-1]) if is_json else (lambda v: v)

        def greet(m: re.Match) -> str:
            p = self._people.get(int(m.group(3)))
            if not p or f"[CONTACT_{m.group(3)}]" not in self._values:
                return m.group()
            return f"{m.group(1)}{m.group(2)}{put(p['first'] or (p['business'] + ' team'))}"

        text = _GREETING.sub(greet, reply)
        text = _TOKEN.sub(lambda m: put(self._values[m.group()]) if m.group() in self._values else m.group(), text)
        left = [m.group() for m in _LOOSE.finditer(text) if m.group() not in self.literal]
        if left:
            raise MaskFailed(f"{len(left)} token(s) left or invented in the reply")
        return text

    @property
    def masked(self) -> int:
        return len(self._tokens) + len(self._person_no)


def begin(messages: list[dict[str, Any]], on: bool = True) -> Call | None:
    """The mask for one request, or None when it is switched off for this model or this call's kind runs unmasked."""
    return Call(messages) if on and _kind.get() not in UNMASKED_KINDS else None
