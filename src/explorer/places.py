"""The local Overture Maps snapshot (scripts/places_snapshot.py) as a lookup: a business's map link (owner, 2026-10-10:
Lead Gen fills "google map location"). A link is given only for ONE confident match by name (and city when known) or by website domain; the
coordinates are Overture's, so the link is open data, never a guess."""
from __future__ import annotations

import re
import sqlite3
from pathlib import Path

MAP_LINK = re.compile(r"^https?://(www\.)?(google\.[a-z.]+/maps|maps\.google\.[a-z.]+|maps\.app\.goo\.gl|goo\.gl/maps)", re.I)


def _norm(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (text or "").lower()).strip()


_STORE_PAGE = re.compile(r"/(locations?|stores?|pages|branches?)/")
_SEVERAL = re.compile(r"(\d+)\s*\+?\s*(?:locations?|stores?|shops?|outlets?|restaurants?|units?|studios?|clinics?|offices?|branches)", re.I)
_STOP = {"the", "and", "inc", "llc", "co", "nyc", "new", "york", "of", "restaurant", "cafe", "bar", "shop", "store", "kitchen"}


def is_chain(industry: str = "", size: str = "") -> bool:
    """A franchise or a business with several locations: one store's pin would misplace the row (creatorCC 2b, 2026-10-28)."""
    if re.search(r"franchis", industry or "", re.I) or re.search(r"multiple locations|several locations|franchis", size or "", re.I):
        return True
    return any(int(n) >= 2 for n in _SEVERAL.findall(size or ""))


def _words(text: str) -> set[str]:
    return {w for w in _norm(text).split() if len(w) >= 3 and w not in _STOP}


def find_place(name: str, location: str, db_path: Path | str, website: str = "", region: str = "NY",
               industry: str = "", size: str = "") -> dict | None:
    """The ONE place in the snapshot that is this business, or None. Two ways to match, both at confidence >= 0.8, in
    `region` (the snapshot's box reaches into NJ), never a store page:
    1. the same name: when the business has a website, the place's must be on the same domain (a same-name place
       elsewhere is the usual trap: Balthazar Bakery matched an Englewood NJ bakery, 2026-10-10); with none, the city
       in `location` must agree; a name found at more than one place anywhere is a chain;
    2. the same website domain (creatorCC 2b, 2026-10-28: most empty rows match this way, few by name): the two
       names share a word.
    A domain found at more than one place anywhere is a chain, whichever way the name matched.
    A franchise or a business with several locations (Industry, Company size) gets no link at all."""
    path = Path(db_path).expanduser()
    if not path.is_file() or not _norm(name) or is_chain(industry, size):
        return None
    site = _domain(website)
    try:
        con = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=5)
        try:
            by_name = con.execute("SELECT name, locality, lat, lon, confidence, website, region, address FROM places WHERE name_norm = ? "
                                  "AND lat IS NOT NULL AND confidence >= 0.8 LIMIT 12", (_norm(name),)).fetchall()
            # a chain: the same name at more than one place anywhere in the snapshot. One store's address would misplace
            # a franchisor row (Hot Chicken Takeover, Teriyaki Madness, Poplar Toast; 2026-10-10)
            everywhere = con.execute("SELECT count(*) FROM places WHERE name_norm = ?", (_norm(name),)).fetchone()[0]
            by_site = []
            if site and "." in site:
                by_site = con.execute("SELECT name, locality, lat, lon, confidence, website, region, address FROM places "
                                      "WHERE website LIKE ? LIMIT 50", (f"%{site}%",)).fetchall()
        finally:
            con.close()
    except sqlite3.Error:
        return None

    def keep(rows):
        rows = [r for r in rows if not region or (r[6] or "").strip().upper() == region.upper()]
        return [r for r in rows if not _STORE_PAGE.search((r[5] or "").lower())]  # a store page = a chain

    same = [r for r in by_site if _domain(r[5] or "") and _same_site(_domain(r[5] or ""), site)]
    if len(same) > 1:
        return None                     # every place on the domain counts, any region, store pages too: a chain
    rows = keep(by_name) if everywhere == 1 else []
    if site:
        rows = [r for r in rows if _domain(r[5] or "") and _same_site(_domain(r[5] or ""), site)]
    else:
        city = _norm((location or "").split(",")[0])
        rows = [r for r in rows if city and (_norm(r[1] or "") == city or city in _norm(r[1] or ""))]
    if len(rows) != 1 and same:
        rows = [r for r in keep(same) if r[2] is not None and (r[4] or 0) >= 0.8 and _words(r[0]) & _words(name)]
    if len(rows) != 1:
        return None
    r = rows[0]
    return {"name": r[0], "locality": r[1], "lat": r[2], "lon": r[3], "website": r[5], "region": r[6], "address": r[7]}


def _domain(url: str) -> str:
    host = re.sub(r"^https?://", "", (url or "").strip().lower()).split("/")[0].split(":")[0]
    return host[4:] if host.startswith("www.") else host


def _same_site(a: str, b: str) -> bool:
    return bool(a and b) and (a == b or a.endswith("." + b) or b.endswith("." + a))


def map_link(name: str, location: str, db_path: Path | str, website: str = "", industry: str = "", size: str = "") -> str | None:
    """https://www.google.com/maps/search/?api=1&query=<lat>,<lon> for the one place that is this business (find_place)."""
    place = find_place(name, location, db_path, website, industry=industry, size=size)
    if not place:
        return None
    return f"https://www.google.com/maps/search/?api=1&query={place['lat']:.6f},{place['lon']:.6f}"
