#!/usr/bin/env python3
"""Save Lead Gen's test set: a few real business sites as offline snapshots (owner, 2026-10-06, queue item E2).

For each business: its home page and its contact page (the first link whose text or address says contact/about), as
the engine's light browser sees them (url, title, text, links), in common-data/testset/lead-gen/<slug>/pages.json, plus
labels.json with the PROPOSED right answers taken from the Leads board -- the Validator checks and corrects them
(queue item V2); a label is trusted only once it says "checked_by". One trap site (E4) is written by hand.

    ~/Projects/bot/.venv/bin/python ~/bots/scripts/testset_snapshot.py <leads.json> [--count 19]
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

from explorer.light_browser import LightBrowser

ROOT = Path.home() / "bots" / "common-data" / "testset" / "lead-gen"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36"


def slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:48]


def page_dict(p) -> dict:
    return {"url": p.url, "title": p.title, "text": p.text[:40000], "links": [{"number": l.number, "text": l.text, "url": l.url} for l in p.links[:80]]}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("leads", type=Path, help="a JSON list of Leads board rows: name, website, email, location, industry, pain")
    ap.add_argument("--count", type=int, default=19)
    args = ap.parse_args()
    rows = json.loads(args.leads.read_text())
    browser = LightBrowser(UA, chromium=lambda: None)
    saved = 0
    for row in rows:
        if saved >= args.count:
            break
        if not row.get("website", "").startswith("http") or not row.get("email"):
            continue
        if (ROOT / slug(row["name"]) / "pages.json").exists():
            saved += 1; continue
        try:
            home = browser.open(row["website"])
        except Exception as exc:  # a site that needs a full browser is skipped: the test set stays light
            print("skip (needs a full browser):", row["name"], type(exc).__name__); continue
        if not home.ok or len(home.text) < 200:
            print("skip (home unreadable):", row["name"]); continue
        pages = [page_dict(home)]
        contact = next((l for l in home.links if re.search(r"contact|about", (l.text + " " + l.url).lower())), None)
        if contact:
            try:
                c = browser.open(contact.url)
            except Exception:
                c = None
            if c is not None and c.ok:
                pages.append(page_dict(c))
        d = ROOT / slug(row["name"])
        d.mkdir(parents=True, exist_ok=True)
        (d / "pages.json").write_text(json.dumps(pages, ensure_ascii=False, indent=1))
        on_site = row["email"].lower() in " ".join(p["text"].lower() for p in pages)
        (d / "labels.json").write_text(json.dumps({
            "name": row["name"], "website": row["website"],
            "email": row["email"] if on_site else "", "email_on_snapshot": on_site,
            "location": row.get("location", ""), "industry": row.get("industry", ""), "company_size": row.get("size", ""),
            "pain_point_hint": row.get("pain", "")[:200], "trap": False,
            "status": "proposed from the Leads board", "checked_by": "",
        }, ensure_ascii=False, indent=1))
        saved += 1
        print("saved", d.name, "| pages", len(pages), "| email on the snapshot:", on_site)
    print(saved, "sites saved")
    return 0


if __name__ == "__main__":
    sys.exit(main())
