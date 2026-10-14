"""The local Overture Maps snapshot (scripts/places_snapshot.py) as a lookup: a business's map link (owner, 2026-10-10:
Lead Gen fills "google map location"). A link is given only for ONE confident match by name (and city when known); the
coordinates are Overture's, so the link is open data, never a guess."""
from __future__ import annotations

import re
import sqlite3
from pathlib import Path

MAP_LINK = re.compile(r"^https?://(www\.)?(google\.[a-z.]+/maps|maps\.google\.[a-z.]+|maps\.app\.goo\.gl|goo\.gl/maps)", re.I)


def _norm(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (text or "").lower()).strip()


def find_place(name: str, location: str, db_path: Path | str, website: str = "", region: str = "NY") -> dict | None:
    """The ONE place in the snapshot that is this business, or None. A match needs the same name; when the business has a
    website, the place's website must be on the same domain (a same-name place elsewhere is the usual trap: Balthazar
    Bakery matched an Englewood NJ bakery, 2026-10-10); when it has none, the city in `location` must agree. The place's
    own region must be `region` (the snapshot's box reaches into NJ)."""
    path = Path(db_path).expanduser()
    if not path.is_file() or not _norm(name):
        return None
    try:
        con = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=5)
        try:
            rows = con.execute("SELECT name, locality, lat, lon, confidence, website, region, address FROM places WHERE name_norm = ? "
                               "AND lat IS NOT NULL AND confidence >= 0.8 LIMIT 12", (_norm(name),)).fetchall()
            # a chain: the same name at more than one place anywhere in the snapshot. One store's address would misplace
            # a franchisor row (Hot Chicken Takeover, Teriyaki Madness, Poplar Toast; 2026-10-10)
            everywhere = con.execute("SELECT count(*) FROM places WHERE name_norm = ?", (_norm(name),)).fetchone()[0]
        finally:
            con.close()
    except sqlite3.Error:
        return None
    if everywhere != 1:
        return None
    rows = [r for r in rows if not region or (r[6] or "").strip().upper() == region.upper()]
    rows = [r for r in rows if not re.search(r"/(locations?|stores?|pages|branches?)/", (r[5] or "").lower())]  # a store page = a chain
    site = _domain(website)
    if site:
        rows = [r for r in rows if _domain(r[5] or "") and _same_site(_domain(r[5] or ""), site)]
    else:
        city = _norm((location or "").split(",")[0])
        if not city:
            return None
        rows = [r for r in rows if _norm(r[1] or "") == city or city in _norm(r[1] or "")]
    if len(rows) != 1:
        return None
    r = rows[0]
    return {"name": r[0], "locality": r[1], "lat": r[2], "lon": r[3], "website": r[5], "region": r[6], "address": r[7]}


def _domain(url: str) -> str:
    host = re.sub(r"^https?://", "", (url or "").strip().lower()).split("/")[0].split(":")[0]
    return host[4:] if host.startswith("www.") else host


def _same_site(a: str, b: str) -> bool:
    return bool(a and b) and (a == b or a.endswith("." + b) or b.endswith("." + a))


def map_link(name: str, location: str, db_path: Path | str, website: str = "") -> str | None:
    """https://www.google.com/maps/search/?api=1&query=<lat>,<lon> for the one place that is this business (find_place)."""
    place = find_place(name, location, db_path, website)
    if not place:
        return None
    return f"https://www.google.com/maps/search/?api=1&query={place['lat']:.6f},{place['lon']:.6f}"
