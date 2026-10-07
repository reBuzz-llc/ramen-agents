#!/usr/bin/env python3
"""Lead Gen's daily candidates: real small businesses of the current target market, from open data (owner, 2026-09-29).

Lead Gen's keyless web search kept returning news and directory pages (1 lead from 659 actions); the owner's rule for it
is "get data from gov sites". This writes, once a day, up to `rows_per_day` businesses that have a website and an
address inside the market, trades that fit the packages first, never repeating one, to

    common-data/botBox/routed/lead-gen/candidates-<market>-YYYY-MM-DD.md

(one of Lead Gen's corpus folders: its `corpus` search finds the file, and the engine offers the next unvisited ones in
every prompt). One business per line. They are CANDIDATES: Lead Gen opens each website and records only what the site
itself states.

No place is written in this code (owner, 2026-09-30: "It should be said in task and goals, not in code"):
  - the market is `market` in common-data/knowledge/target.toml;
  - its open-data source (endpoint, columns, ZIP-to-area map, trade order) is in common-data/knowledge/candidate-feeds.toml;
  - FreeSerp's business-site index ([sources.freeserp] there) adds sites for any market, one search per trade x area.
A market with neither is a no-op with a logged reason.

Read-only on the open-data API; writes only that folder and its own state file. Stdlib, plus certifi when present.

    ~/Projects/bot/.venv/bin/python ~/bots/scripts/candidates-feed.py [--dry-run] [--force] [--rows N]
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import sqlite3
import ssl
import sys
import time
import tomllib
import unicodedata
import urllib.parse
import urllib.request
from pathlib import Path

BOTS = Path.home() / "bots"
TARGET = BOTS / "common-data" / "knowledge" / "target.toml"
FEEDS = BOTS / "common-data" / "knowledge" / "candidate-feeds.toml"
OUT_DIR = BOTS / "common-data" / "botBox" / "routed" / "lead-gen"
STATE = BOTS / "common-data" / "shared-state" / "candidates-feed.json"
KEEP_FILES = 7
PAGE = 5000


def slug(text: str) -> str:
    """The market as a file-name part, the engine's rule for candidates_glob: accents folded ("São Paulo" -> "sao-paulo"),
    lower-cased, every run of other characters one "-". target.toml's `market_slug`, when set, wins over this."""
    folded = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", folded.lower()).strip("-") or "market"


def _tls() -> ssl.SSLContext:
    """python.org's Python ships without the system CA store; use certifi when it is there (the bots' venv has it)."""
    try:
        import certifi

        return ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        return ssl.create_default_context()


def fetch_all(feed: dict) -> list[dict]:
    where = f"{feed['website_field']} IS NOT NULL"
    prefixes = list(feed.get("areas", {}))
    if prefixes:
        where += " AND (" + " OR ".join(f"starts_with({feed['zip_field']},'{p}')" for p in prefixes) + ")"
    rows: list[dict] = []
    for offset in range(0, 50 * PAGE, PAGE):
        q = urllib.parse.urlencode({"$where": where, "$order": feed["id_field"], "$limit": PAGE, "$offset": offset})
        with urllib.request.urlopen(f"{feed['url']}?{q}", timeout=60, context=_tls()) as r:  # noqa: S310 - configured https host
            page = json.load(r)
        rows += page
        if len(page) < PAGE:
            break
    return rows


def website(raw: str) -> str | None:
    w = (raw or "").strip().rstrip("/")
    if not w or " " in w or "." not in w or "@" in w:
        return None
    if not w.lower().startswith(("http://", "https://")):
        w = "https://" + w.lstrip("/")
    return w


def clean(text: object) -> str:
    return " ".join(str(text or "").replace("|", "/").split())


def first(r: dict, fields: list[str]) -> str:
    return next((clean(r.get(f)) for f in fields if clean(r.get(f))), "")


GUIDE = re.compile(r"\b(guide|directory|directories|listings?|magazine|blog|news|reviews? site|best of|top \d+|marketplace)\b", re.I)


def freeserp_candidates(src: dict, target: dict, seen_hosts: set[str], done: set[str], limit: int) -> list[dict]:
    """Small business homepages for the market from FreeSerp's sites index: one search per trade x area (target.toml),
    keeping live, real sites whose title or summary names an area or the market, under the Domain Rating ceiling, not
    sent before and not already in today's open-data rows. Light use: one pass a day, a pause between queries."""
    market = str(target.get("market", "")).strip()
    trades = [t.strip() for t in re.split(r",| and ", str(target.get("trades", ""))) if t.strip()] or [str(target.get("segment", "business"))]
    areas = [a.strip() for a in str(target.get("areas", "")).split(",") if a.strip()] or [market]
    places = [p.lower() for p in [*areas, market, str(target.get("market_short", ""))] if p]
    # An even share per trade x area, so the first trade does not take the whole day's quota.
    per_combo = max(2, -(-limit // (len(trades) * len(areas))))
    out: list[dict] = []
    for trade in trades:
        for area in areas:
            if len(out) >= limit:
                return out
            taken = 0
            q = urllib.parse.urlencode({"q": f"{trade} {area}", "index": "sites", "size": int(src.get("per_query", 50))})
            try:
                with urllib.request.urlopen(f"{src['url']}?{q}", timeout=60, context=_tls()) as r:  # noqa: S310 - configured https host
                    rows = json.load(r).get("results", [])
            except (OSError, ValueError) as exc:
                print(f"freeserp: {trade} {area}: {exc}")
                rows = []
            time.sleep(float(src.get("pause_seconds", 0.5)))
            for x in rows:
                host = str(x.get("domain", "")).lower().removeprefix("www.")
                text = f"{x.get('title', '')} {x.get('ai_summary', '')}".lower()
                if not host or host in seen_hosts or host in done or x.get("real_site") != 1 or x.get("http_status") != 200:
                    continue
                if int(x.get("dr") or 0) > int(src.get("max_dr", 40)) or not any(pl in text for pl in places):
                    continue
                # Guides, directories and press list businesses; they are not one.
                if GUIDE.search(text):
                    continue
                # The trade must show on the site ("salons" finding an accountant is the index's guess, not a lead).
                stem = re.sub(r"(ies|es|s)$", "", trade.split()[0].lower())
                if stem and stem not in text:
                    continue
                seen_hosts.add(host)
                taken += 1
                out.append({"host": host, "name": clean(x.get("title")) or host, "area": area, "trade": trade, "url": x.get("url") or f"https://{host}", "summary": clean(x.get("ai_summary"))[:160]})
                if len(out) >= limit:
                    return out
                if taken >= per_combo:
                    break
    return out


def lead_gen_hosts() -> set[str]:
    """Every site Lead Gen has already opened: a candidate it has seen is not news."""
    try:
        con = sqlite3.connect(f"file:{BOTS / 'lead-gen' / 'workspace' / 'explorer.sqlite3'}?mode=ro", uri=True, timeout=5)
        try:
            return {str(d).lower().removeprefix("www.") for (d,) in con.execute("SELECT DISTINCT domain FROM visits") if d}
        finally:
            con.close()
    except sqlite3.Error:
        return set()


def overture_candidates(src: dict, target: dict, zip_areas: dict[str, str], seen_hosts: set[str], done: set[str], limit: int) -> list[dict]:
    """Open places from the local Overture Maps snapshot (scripts/places_snapshot.py, weekly): open, a website, confidence at
    least min_confidence, inside the target's areas by ZIP, not a chain (a website shared by several places), not a kind
    of place that is not a business (min list in [sources.overture] exclude), not sent before, not opened by Lead Gen."""
    db = Path(str(src.get("db", ""))).expanduser()
    if not db.is_file():
        print(f"overture: no snapshot at {db}")
        return []
    want = {a.strip().lower() for a in str(target.get("areas", "")).split(",") if a.strip()}
    width = len(next(iter(zip_areas), "")) or 3
    exclude = [str(x).lower() for x in src.get("exclude", [])]
    con = sqlite3.connect(f"file:{db}?mode=ro", uri=True, timeout=10)
    try:
        rows = con.execute(
            "SELECT id, name, category, website, postcode FROM places WHERE status = 'open' AND website IS NOT NULL "
            "AND website != '' AND confidence >= ? ORDER BY confidence DESC, id",
            (float(src.get("min_confidence", 0.8)),),
        ).fetchall()
        # A name on many places is a chain even when each branch has its own address (Petco, a State Farm agent).
        chains = {n for (n,) in con.execute("SELECT name_norm FROM places GROUP BY name_norm HAVING COUNT(*) > ?",
                                             (int(src.get("max_places_per_name", 2)),)) if n}
        norm = dict(con.execute("SELECT id, name_norm FROM places WHERE status = 'open' AND website IS NOT NULL"))
        # ...and so is a brand whose branches carry a suffix ("Nudie Jeans Bedford", "Barry's East 64th").
        stem = lambda n: " ".join(str(n or "").split()[:2])  # noqa: E731
        stems: dict[str, int] = {}
        for (n,) in con.execute("SELECT name_norm FROM places"):
            if n and len(str(n).split()) > 2:
                stems[stem(n)] = stems.get(stem(n), 0) + 1
    finally:
        con.close()
    by_host: dict[str, list] = {}
    for pid, name, category, site, postcode in rows:
        url = website(site or "")
        if not url:
            continue
        host = urllib.parse.urlparse(url).netloc.lower().removeprefix("www.")
        by_host.setdefault(host, []).append((pid, name, category or "", url, str(postcode or "")))
    max_places = int(src.get("max_places_per_site", 2))
    skip = seen_hosts | done | lead_gen_hosts()
    out: list[dict] = []
    for host, places in by_host.items():
        if len(places) > max_places or host in skip:
            continue  # a chain's site, or already sent or opened
        pid, name, category, url, postcode = places[0]
        n = norm.get(pid)
        if n in chains or stems.get(stem(n), 0) > int(src.get("max_places_per_name", 2)):
            continue
        if urllib.parse.urlparse(url).path.strip("/").count("/") >= 1:
            continue  # a branch page deep inside a brand's site, not a business's own site
        url = urllib.parse.urlunparse(urllib.parse.urlparse(url)._replace(query="", fragment=""))
        area = zip_areas.get(postcode[:width], "")
        trade = category.replace("_", " ")
        if not area or (want and area.lower() not in want) or any(x in category.lower() for x in exclude):
            continue
        out.append({"host": host, "name": clean(name), "area": area, "trade": trade, "url": url})
        if len(out) >= limit:
            break
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--dry-run", action="store_true", help="print the slice; write nothing")
    ap.add_argument("--force", action="store_true", help="write today's slice even if it already exists")
    ap.add_argument("--rows", type=int, default=None)
    args = ap.parse_args(argv)

    target = tomllib.loads(TARGET.read_text(encoding="utf-8"))
    market = str(target.get("market", "")).strip()
    market_slug = str(target.get("market_slug", "")).strip() or slug(market)
    conf = tomllib.loads(FEEDS.read_text(encoding="utf-8"))
    feed = conf.get("feeds", {}).get(market)
    fs = conf.get("sources", {}).get("freeserp", {})
    ov = conf.get("sources", {}).get("overture", {})
    if not market or (not feed and not fs.get("enabled") and not ov.get("enabled")):
        print(f"no candidates source for market {market!r} in {FEEDS.name}; nothing to do")
        return 0

    today = dt.date.today().isoformat()
    today_file = OUT_DIR / f"candidates-{market_slug}-{today}.md"
    # launchd runs this at login and hourly as well as at 06:30 (the Mac is often off or asleep then): a day's slice
    # is written once, and every later run that day is a no-op.
    if today_file.exists() and not args.force and not args.dry_run:
        print(f"{today_file.name} already written; nothing to do")
        return 0

    try:
        state = json.loads(STATE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        state = {}
    mine = state.get(market, {})
    emitted: set[str] = set(mine.get("emitted", []))
    fs_done: set[str] = set(mine.get("freeserp_emitted", []))
    ov_done: set[str] = set(mine.get("overture_emitted", []))
    hosts: set[str] = set()
    sections: list[str] = []

    # 1. The market's own open-data feed, when it has one.
    pick: list = []
    fresh: list = []
    if feed:
        records = fetch_all(feed)
        areas: dict[str, str] = feed.get("areas", {})
        width = len(next(iter(areas), "")) or 0
        order = feed.get("sector_order", {}).get("order", [])
        rank = {s: i for i, s in enumerate(order)}
        for r in records:
            rid = str(r.get(feed["id_field"], ""))
            site = website(r.get(feed["website_field"], ""))
            area = areas.get(str(r.get(feed.get("zip_field", ""), ""))[:width]) if areas else market
            if not rid or rid in emitted or not site or not area:
                continue
            host = urllib.parse.urlparse(site).netloc.lower().removeprefix("www.")
            if host in hosts:
                continue
            hosts.add(host)
            fresh.append((rank.get(r.get(feed.get("sector_field", ""), ""), len(rank)), rid, r, site, area))
        fresh.sort(key=lambda x: (x[0], x[1]))
        pick = fresh[: args.rows or int(feed.get("rows_per_day", 150))]
        hosts = {urllib.parse.urlparse(site).netloc.lower().removeprefix("www.") for _, _, _, site, _ in pick}
        lines = []
        for _, _rid, r, site, area in pick:
            owner = " ".join(clean(r.get(f)) for f in feed.get("owner_fields", []) if clean(r.get(f)))
            lines.append(
                f"- {first(r, feed['name_fields'])} | {area} | {first(r, feed['industry_fields'])} | {site}"
                + (f" | owner on public record: {owner}" if owner else "")
            )
        if lines:
            sections.append(
                f"## From {feed['source']} (open data)\n\nFormat: name | area | industry | website | owner on public record. "
                "The owner name is the public record's, a hint to confirm on the site, never a value to copy.\n\n" + "\n".join(lines)
            )
        print(f"{market}: open data {len(records)} with a website; {len(fresh)} not yet sent; writing {len(pick)}")

    # 2. FreeSerp's business-site index, for any market.
    found: list[dict] = []
    if fs.get("enabled"):
        found = freeserp_candidates(fs, target, hosts, fs_done, int(fs.get("rows_per_day", 100)))
        if found:
            sections.append(
                "## From FreeSerp's index of business websites\n\nFormat: site title | area | trade searched | website | "
                "index summary. The summary is the index's, written when it last visited the site: a hint where to look "
                "(an empty or dated page, no ordering), never a value to copy.\n\n"
                + "\n".join(f"- {c['name']} | {c['area']} | {c['trade']} | {c['url']}" + (f" | {c['summary']}" if c["summary"] else "") for c in found)
            )
        print(f"{market}: freeserp {len(found)} new sites")

    # 3. Overture Maps' open places (a local weekly snapshot), for a market that has one.
    places: list[dict] = []
    if ov.get("enabled") and (not ov.get("market") or ov.get("market") == market):
        places = overture_candidates(ov, target, (feed or {}).get("areas", {}), hosts | {c["host"] for c in found}, ov_done, int(ov.get("rows_per_day", 100)))
        if places:
            sections.append(
                "## From Overture Maps (open places data)\n\nFormat: name | area | kind of place | website. The map's "
                "own details (phone, email, category) are a hint where to look, never a value to copy.\n\n"
                + "\n".join(f"- {c['name']} | {c['area']} | {c['trade']} | {c['url']}" for c in places)
            )
        print(f"{market}: overture {len(places)} new sites")

    total = len(pick) + len(found) + len(places)
    text = (
        f"# Small business candidates: {market} ({today})\n\n"
        f"{total} businesses in {market}, each with its own website. These are CANDIDATES, not leads: open the website, "
        "look for the problem we can fix and the published business email, and record only what the site states.\n\n"
        + "\n\n".join(sections) + "\n"
    )
    if args.dry_run:
        print(text[:4000])
        return 0
    if not total:
        print("nothing new to write today")
        return 0

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    today_file.write_text(text, encoding="utf-8")
    for f in sorted(OUT_DIR.glob(f"candidates-{market_slug}-*.md"))[:-KEEP_FILES]:
        f.unlink()
    state[market] = {
        "emitted": sorted(emitted | {rid for _, rid, *_ in pick}),
        "freeserp_emitted": sorted(fs_done | {c["host"] for c in found}),
        "overture_emitted": sorted(ov_done | {c["host"] for c in places}),
        "last_run": dt.datetime.now().isoformat(timespec="seconds"),
        "last_file": today_file.name,
        "remaining": len(fresh) - len(pick),
    }
    STATE.parent.mkdir(parents=True, exist_ok=True)
    tmp = STATE.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, indent=1), encoding="utf-8")
    tmp.replace(STATE)
    print(f"wrote {today_file} ({len(pick)} open data + {len(found)} freeserp + {len(places)} overture)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
