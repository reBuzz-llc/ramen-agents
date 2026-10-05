#!/usr/bin/env python3
"""Lead Gen's daily candidates: real small businesses of the current target market, from open data.

Lead Gen's keyless web search kept returning news and directory pages (1 lead from 659 actions); the owner's rule for it
is "get data from gov sites". This writes, once a day, up to `rows_per_day` businesses that have a website and an
address inside the market, trades that fit the packages first, never repeating one, to

    common-data/botBox/routed/lead-gen/candidates-<market>-YYYY-MM-DD.md

(one of Lead Gen's corpus folders: its `corpus` search finds the file, and the engine offers the next unvisited ones in
every prompt). One business per line. They are CANDIDATES: Lead Gen opens each website and records only what the site
itself states.

No place is written in this code:
  - the market is `market` in common-data/knowledge/target.toml;
  - its data source (endpoint, columns, ZIP-to-area map, trade order) is in common-data/knowledge/candidate-feeds.toml.
A market with no feed there is a no-op with a logged reason.

Read-only on the open-data API; writes only that folder and its own state file. Stdlib, plus certifi when present.

    ~/Projects/bot/.venv/bin/python ~/bots/scripts/candidates-feed.py [--dry-run] [--force] [--rows N]
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import ssl
import sys
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


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--dry-run", action="store_true", help="print the slice; write nothing")
    ap.add_argument("--force", action="store_true", help="write today's slice even if it already exists")
    ap.add_argument("--rows", type=int, default=None)
    args = ap.parse_args(argv)

    target = tomllib.loads(TARGET.read_text(encoding="utf-8"))
    market = str(target.get("market", "")).strip()
    market_slug = str(target.get("market_slug", "")).strip() or slug(market)
    feeds = tomllib.loads(FEEDS.read_text(encoding="utf-8")).get("feeds", {})
    feed = feeds.get(market)
    if not market or not feed:
        print(f"no candidates feed for market {market!r} in {FEEDS.name} (feeds: {', '.join(feeds) or 'none'}); nothing to do")
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

    records = fetch_all(feed)
    areas: dict[str, str] = feed.get("areas", {})
    width = len(next(iter(areas), "")) or 0
    order = feed.get("sector_order", {}).get("order", [])
    rank = {s: i for i, s in enumerate(order)}
    fresh = []
    hosts: set[str] = set()
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

    lines = []
    for _, _rid, r, site, area in pick:
        owner = " ".join(clean(r.get(f)) for f in feed.get("owner_fields", []) if clean(r.get(f)))
        lines.append(
            f"- {first(r, feed['name_fields'])} | {area} | {first(r, feed['industry_fields'])} | {site}"
            + (f" | owner on public record: {owner}" if owner else "")
        )
    text = (
        f"# Small business candidates: {market} ({today})\n\n"
        f"{len(lines)} businesses in {market}, each with its own website, from {feed['source']} (open data). These are "
        "CANDIDATES, not leads: open the website, look for the problem we can fix and the published business email, and "
        "record only what the site states. The owner name is the public record's, a hint to confirm on the site, never a "
        "value to copy. Format: name | area | industry | website | owner on public record.\n\n" + "\n".join(lines) + "\n"
    )
    print(f"{market}: {len(records)} records with a website; {len(fresh)} not yet sent; writing {len(pick)}")
    if args.dry_run:
        print(text[:3000])
        return 0

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    today_file.write_text(text, encoding="utf-8")
    for f in sorted(OUT_DIR.glob(f"candidates-{market_slug}-*.md"))[:-KEEP_FILES]:
        f.unlink()
    state[market] = {
        "emitted": sorted(emitted | {rid for _, rid, *_ in pick}),
        "last_run": dt.datetime.now().isoformat(timespec="seconds"),
        "last_file": today_file.name,
        "remaining": len(fresh) - len(pick),
    }
    STATE.parent.mkdir(parents=True, exist_ok=True)
    tmp = STATE.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, indent=1), encoding="utf-8")
    tmp.replace(STATE)
    print(f"wrote {today_file} ({len(pick)} rows); {state[market]['remaining']} left for later days")
    return 0


if __name__ == "__main__":
    sys.exit(main())
