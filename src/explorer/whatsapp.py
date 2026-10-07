"""A business's WhatsApp link from a phone number a page states (owner, 2026-10-07: "even if a whats app number is
found (might have to test country codes on missing ones) then we should be able to convert them into wa.me link and
update the notion"). Nothing here asks WhatsApp anything -- that needs an account (the fence) -- so a link built from
a number says where the business can be reached IF it uses WhatsApp; the team finds out when they message."""
from __future__ import annotations

import re

_PHONE = re.compile(r"(?:wa\.me/|phone=)?\+?\d[\d\s().\-]{6,}\d")


def wa_link(number: str, default_cc: str = "1") -> str | None:
    """https://wa.me/<digits> for a number with a country code ("+44 20 ...", "0044 ...", an existing wa.me link) or a
    national number of the default country (10 digits, or 11 starting with it, for +1). None when the country is unclear."""
    raw = (number or "").strip()
    if not raw:
        return None
    m = re.search(r"(?:wa\.me/|phone=)(\d{8,15})", raw)
    if m:
        return f"https://wa.me/{m.group(1)}"
    digits = re.sub(r"\D", "", raw)
    if raw.startswith("+"):
        pass
    elif digits.startswith("00"):
        digits = digits[2:]
    elif default_cc == "1" and len(digits) == 11 and digits.startswith("1"):
        pass
    elif len(digits) == 10 and default_cc:
        digits = default_cc + digits
    else:
        return None
    return f"https://wa.me/{digits}" if 8 <= len(digits) <= 15 else None


def on_page(link: str, texts) -> bool:
    """The number behind `link` is printed on one of these page texts (its last ten digits, or all of a shorter one)."""
    want = re.sub(r"\D", "", link.rsplit("/", 1)[-1])
    tail = want[-10:]
    for t in texts:
        for found in _PHONE.findall(t or ""):
            d = re.sub(r"\D", "", found)
            if d and (d[-10:] == tail if len(tail) == 10 else d.endswith(tail)):
                return True
    return False


def page_with(link: str, pages: dict) -> str | None:
    """The URL of the first page (url -> text) that prints the number behind `link`, so the row can cite it."""
    for url, text in pages.items():
        if on_page(link, [text]):
            return url
    return None
