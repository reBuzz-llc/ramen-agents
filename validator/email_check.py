"""Is the Business email on a lead row actually published by that business?

The Leads board's rows come from two places: Lead Gen, whose policy makes it read the address off a page of the
business's own site before it may list one, and the owner's imported list, which has no such grounding. On
2026-09-24 the owner said the imported rows looked hallucinated, and they were: of fourteen checked, ten claimed
addresses that appear nowhere on the company's site. Tasty Tacos publishes info@eattastytacos-example.com; the row
claimed franchise@tastytacos-example.com at "high" confidence. Others were sourced from a rate-limited PDF or a
login-walled LinkedIn page, so nobody had read them either.

This module fetches the pages the row itself points at (its website, evidence and source pages, plus the usual
contact and franchise paths) and looks for the exact address. Read-only, rate-limited, and cached: a verdict is
kept so a row is fetched once, not on every sweep. "Not found" means not found on the pages we could read -- an
address behind JavaScript or an image can be real -- so the flag says that rather than calling it a fake.
"""
from __future__ import annotations

import concurrent.futures as cf
import datetime as dt
import re
from dataclasses import dataclass
from typing import Callable, Iterable

PATHS = ("", "/contact", "/contact-us", "/contacts", "/franchise", "/franchising", "/franchise-opportunities",
         "/own-a-franchise", "/about", "/about-us")
UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/120.0 Safari/537.36"}
EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
TIMEOUT = 12.0
_CFEMAIL = re.compile(r'data-cfemail="([0-9a-f]+)"', re.I)


def visible_text(html: str) -> str:
    """The page as a reader would see its addresses: Cloudflare's email protection decoded (the scheme that hid
    Calm Studios' info@ from a raw fetch on 2026-09-25), entities like &#64; unescaped, all lower-case."""
    import html as _html

    def decode(m: "re.Match[str]") -> str:
        raw = bytes.fromhex(m.group(1))
        return "".join(chr(b ^ raw[0]) for b in raw[1:])

    return _html.unescape(_CFEMAIL.sub(lambda m: " " + decode(m) + " ", html)).lower()


@dataclass
class EmailVerdict:
    status: str          # published | not_found | unreachable | skipped
    where: str = ""      # the page it was found on, or what was read instead
    others: tuple[str, ...] = ()   # addresses the site does publish, when the claimed one is absent

    @property
    def ok(self) -> bool:
        return self.status in ("published", "skipped", "unreachable")


def pages_for(website: str, extra: Iterable[str] = ()) -> list[str]:
    """The pages worth reading for this business: the ones the row names, then the usual contact paths."""
    seen: list[str] = []
    for url in extra:
        url = (url or "").strip()
        if url.startswith(("http://", "https://")) and url not in seen:
            seen.append(url)
    site = (website or "").strip().rstrip("/")
    if site.startswith(("http://", "https://")):
        for path in PATHS:
            url = site + path
            if url not in seen:
                seen.append(url)
    return seen[:12]


def verify(email: str, website: str, extra: Iterable[str] = (), *, get: Callable | None = None) -> EmailVerdict:
    """Look for `email` on the business's own pages. `get(url) -> (status_code, text)` is injectable for tests."""
    email = (email or "").strip().lower()
    if not email or "@" not in email:
        return EmailVerdict("skipped", "no address to check")
    urls = pages_for(website, extra)
    if not urls:
        return EmailVerdict("skipped", "no website to read")
    fetch = get or _httpx_get
    found_elsewhere: set[str] = set()
    read = 0
    for url in urls:
        try:
            status, text = fetch(url)
        except Exception:  # noqa: BLE001 - an unreachable page is not the row's fault
            continue
        if status >= 400 or not text:
            continue
        read += 1
        low = visible_text(text)
        if email in low:
            return EmailVerdict("published", url)
        for other in EMAIL_RE.findall(low):
            if not other.endswith((".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg")) and "sentry" not in other:
                found_elsewhere.add(other)
    if not read:
        return EmailVerdict("unreachable", "none of its pages could be read from this Mac")
    return EmailVerdict("not_found", f"{read} page(s) read", tuple(sorted(found_elsewhere)[:3]))


def verify_many(rows: list[tuple[str, str, str, tuple[str, ...]]], *, workers: int = 6,
                get: Callable | None = None) -> dict[str, EmailVerdict]:
    """[(key, email, website, extra_urls)] -> {key: verdict}, a few sites at a time."""
    def one(row):
        key, email, website, extra = row
        return key, verify(email, website, extra, get=get)

    with cf.ThreadPoolExecutor(max(1, workers)) as ex:
        return dict(ex.map(one, rows))


def _httpx_get(url: str) -> tuple[int, str]:
    import httpx

    r = httpx.get(url, headers=UA, timeout=TIMEOUT, follow_redirects=True)
    return r.status_code, r.text


def stale(checked_at: str, days: float, now: dt.datetime | None = None) -> bool:
    """A verdict older than `days` is checked again (a site adds or drops an address)."""
    try:
        age = (now or dt.datetime.now()) - dt.datetime.fromisoformat(checked_at)
    except (TypeError, ValueError):
        return True
    return age.total_seconds() >= days * 86400
