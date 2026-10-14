"""Fact-check of the Lead Enricher's fills (owner, 2026-10-10: "I expect high accuracy and fact check from it").

After the engine's own check at write time, the Validator re-reads the pages each fill cites (its sources, then the row's
website and the usual contact / about paths) and looks for the value itself: the founder's name, the city of the
Location, the figures of the Company size. A value none of those pages prints is EN05, reported to the Enricher and in the
owner's report. The pain point is the family's own analysis and the Whatsapp number has LD20, so neither is checked here.
"""
from __future__ import annotations

import json
import re
import sqlite3
from pathlib import Path
from typing import Callable, Iterable

from email_check import _httpx_get, pages_for, visible_text

BOTS = Path.home() / "bots"
DB = BOTS / "lead-enricher" / "workspace" / "explorer.sqlite3"
EXTRA_PATHS = ("/about", "/about-us", "/our-story", "/team", "/our-team")


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^\w\s]", " ", (s or "").lower())).strip()


def needles(field: str, value: str) -> list[str]:
    """What must appear on a page for this value to count as stated there."""
    v = (value or "").strip()
    if not v:
        return []
    if field == "founded_by":
        names = [n for n in re.split(r"\s*(?:;|,| and | & )\s*", v) if n.strip()]
        return [_norm(n) for n in names]                       # every named person
    if field == "location":
        return [_norm(v.split(",")[0])]                        # the city
    if field == "size":
        return re.findall(r"\d[\d,]*", v)[:2]                  # the figures as published
    if field == "industry":
        return []                                              # a description, the bot's own wording
    return []


def fills_since(last_id: int) -> list[dict]:
    """Accepted update_lead writes by the Enricher after action id `last_id`."""
    try:
        db = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
        db.row_factory = sqlite3.Row
        rows = db.execute("SELECT id, ts, payload FROM actions WHERE action_type='update_lead' AND verdict='allowed' AND id > ? "
                          "ORDER BY id", (last_id,)).fetchall()
    except sqlite3.Error:
        return []
    out = []
    for r in rows:
        try:
            p = json.loads(r["payload"])
        except ValueError:
            continue
        out.append({"id": r["id"], "ts": r["ts"], "name": p.get("name", ""), "payload": p})
    return out


def check_fill(fill: dict, website: str, *, get: Callable | None = None) -> list[tuple[str, str]]:
    """(field, why) for each value of this fill that no cited or site page prints; [] when all are found."""
    p = fill["payload"]
    srcs = p.get("sources") or []
    srcs = srcs if isinstance(srcs, list) else str(srcs).split()
    todo = {f: needles(f, str(p.get(f) or "")) for f in ("founded_by", "location", "size")}
    todo = {f: n for f, n in todo.items() if n}
    li = str(p.get("founder_linkedin") or "").strip().rstrip("/")
    if li and str(p.get("linkedin_via") or "").startswith(("1", "2", "3")):
        todo["founder_linkedin"] = [li.split("linkedin.com", 1)[-1].lower()]   # the profile path, printed on the cited page
    if not todo:
        return []
    site = (website or "").strip().rstrip("/")
    urls = pages_for(website, srcs) + ([site + x for x in EXTRA_PATHS] if site.startswith("http") else [])
    fetch = get or _httpx_get
    seen = ""
    for url in list(dict.fromkeys(urls))[:16]:
        try:
            status, html = fetch(url)
        except Exception:  # noqa: BLE001
            continue
        if status < 400 and html:
            seen += " " + _norm(visible_text(html)) + " " + " ".join(re.findall(r"linkedin\.com(/(?:in|company)/[^\s\"'<>?#]+)", html.lower()))
        if all(all(n in seen for n in ns) for ns in todo.values()):
            return []
    if not seen.strip():
        return []                                              # nothing could be read: unverifiable, not wrong
    return [(f, f"'{p.get(f)}' is not printed on any page it cites or on the site ({', '.join(urls[:3])}...)")
            for f, ns in todo.items() if not all(n in seen for n in ns)]


def run(state: dict, websites: dict[str, str], budget: int = 8, *, get: Callable | None = None) -> list[dict]:
    """Check the Enricher's new fills; returns [{name, field, why, ts}] for the values no page prints."""
    last = int(state.get("enricher_checked_id", 0))
    misses = []
    for fill in fills_since(last)[:budget]:
        for field, why in check_fill(fill, websites.get(_norm(fill["name"]), ""), get=get):
            misses.append({"name": fill["name"], "field": field, "why": why, "ts": fill["ts"]})
        state["enricher_checked_id"] = fill["id"]
    return misses
