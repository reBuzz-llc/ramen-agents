"""Rows the team marked "False Whatsapp Number" (owner, 2026-10-07: "find 'False Whatsapp Number' and clear the number
while updating status ... then send a msg to a family member to search for another number").

For each such row: the number goes on the ruled-out list (common-data/shared-state/whatsapp-false-numbers.json, which
the gate's LD20 reads, so no bot writes it back), the Whatsapp cell and the Status are cleared, both clears are recorded
as script clears (never mistaken for a team deletion), and Lead Gen is asked once, in one message, to look for another
number. This is the Validator's one write to the Leads board; everything else it does there stays read-only.
"""
from __future__ import annotations

import datetime as dt
import json
import re
from pathlib import Path

import httpx

BOTS = Path.home() / "bots"
SHARED = BOTS / "common-data" / "shared-state"
FALSE_FILE = SHARED / "whatsapp-false-numbers.json"
CLEARS_FILE = SHARED / "leads-script-clears.json"
KEY_FILE = BOTS / "common-data" / "keys" / "notion.key"
API = "https://api.notion.com/v1"
FALSE_STATUS = "False Whatsapp Number"


def ruled_out() -> dict[str, dict]:
    """digits -> {business, page_id, at}: numbers a person found are not on WhatsApp."""
    try:
        return json.loads(FALSE_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def digits_of(link: str) -> str:
    m = re.search(r"wa\.me/\+?(\d{7,15})", link or "")
    return m.group(1) if m else re.sub(r"\D", "", link or "")


def _rows(client: httpx.Client, data_source: str) -> list[dict]:
    rows, cur = [], None
    while True:
        body = {"page_size": 100, "filter": {"property": "Status", "select": {"equals": FALSE_STATUS}},
                **({"start_cursor": cur} if cur else {})}
        d = client.post(f"{API}/data_sources/{data_source}/query", json=body).json()
        rows += d.get("results", [])
        if not d.get("has_more"):
            return rows
        cur = d["next_cursor"]


def clear_false(data_source: str, *, now: dt.datetime, api_version: str = "2025-09-03", dry_run: bool = False) -> list[dict]:
    """Clear every False-Whatsapp row; returns [{business, page_id, number}] for the ones cleared (or that would be)."""
    key = KEY_FILE.read_text(encoding="utf-8").strip()
    client = httpx.Client(headers={"Authorization": f"Bearer {key}", "Notion-Version": api_version}, timeout=60)
    stamp = now.strftime("%Y-%m-%dT%H:%M:%S")
    false = ruled_out()
    try:
        clears = json.loads(CLEARS_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        clears = {}
    done: list[dict] = []
    for p in _rows(client, data_source):
        props = p.get("properties", {})
        business = "".join(t.get("plain_text", "") for t in (props.get("Business", {}).get("title") or []))
        link = (props.get("Whatsapp") or {}).get("url") or ""
        rec = {"business": business, "page_id": p["id"], "number": digits_of(link)}
        if dry_run:
            done.append(rec)
            continue
        if rec["number"]:
            false[rec["number"]] = {"business": business, "page_id": p["id"], "at": stamp}
            FALSE_FILE.write_text(json.dumps(false, indent=1, ensure_ascii=False), encoding="utf-8")
        why = f"Validator: the team marked {link or 'the number'} False Whatsapp Number; cleared for a new search"
        for col in ("Whatsapp", "Status"):
            clears[f"{p['id']}|{col}"] = {"at": stamp, "by": why}
        CLEARS_FILE.write_text(json.dumps(clears, indent=1, ensure_ascii=False), encoding="utf-8")
        r = client.patch(f"{API}/pages/{p['id']}", json={"properties": {"Whatsapp": {"url": None}, "Status": {"select": None}}})
        after = r.json().get("properties", {}) if r.status_code == 200 else {}
        if after and not (after.get("Whatsapp") or {}).get("url") and not (after.get("Status") or {}).get("select"):
            done.append(rec)
    return done


def ask_text(cleared: list[dict]) -> str:
    names = [c["business"] for c in cleared]
    shown = ", ".join(names[:25]) + (f" and {len(names) - 25} more" if len(names) > 25 else "")
    return (f"New work list from the team's WhatsApp check: {len(names)} Leads rows had a Whatsapp number that a person found "
            f"is not on WhatsApp, so I cleared it: {shown}. Please look for another number for each: a wa.me or "
            "api.whatsapp.com link, or a number the page labels WhatsApp, on the business's own site or a business "
            "listing (put that page in Source pages). A plain office phone is usually a landline, so prefer a mobile or a "
            "labelled one. The cleared numbers are ruled out and will be refused. If you find nothing, leave the cell empty.")
