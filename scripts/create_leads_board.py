"""Create the Leads board in your Notion workspace, with the columns and options the family and the Validator expect.

    python3 scripts/create_leads_board.py --parent <page id or page URL> [--title Leads] [--dry-run]

It creates one database under the page you name (share that page with your Notion integration first) and prints its data
source id to paste into config. It refuses if the page already holds a database with that title, so running it twice
never makes a second board. The key is read from common-data/keys/notion.key. Nothing else in Notion is touched.

What each column is for and who writes it: docs/leads-board.md.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

API = "https://api.notion.com/v1"
VERSION = "2025-09-03"
ROOT = Path(__file__).resolve().parents[1]
KEY_FILE = ROOT / "common-data" / "keys" / "notion.key"


def _select(*names: str) -> dict:
    return {"select": {"options": [{"name": n} for n in names]}}


# The board as the family uses it. Order is the order Notion shows them in a new view.
PROPERTIES: dict[str, dict] = {
    "Business": {"title": {}},
    "Website": {"url": {}},
    "Business email": {"email": {}},
    "Whatsapp": {"url": {}},
    "Status": _select("Ready to Send Email", "Email Sent", "WhatsApp Verified", "Waiting response for WhatsApp verification",
                      "False Whatsapp Number"),
    "How can I help": {"select": {"options": []}},          # your own package names, added as The CEO uses them
    "Draft email": {"rich_text": {}},
    "Draft Whatsapp msg": {"rich_text": {}},
    "Evidence": {"url": {}},
    "Contact person": {"rich_text": {}},
    "Contact role": _select("Founder", "Owner", "CEO / President", "Principal / Partner", "General Manager",
                            "Practice / Office Manager", "Operations", "Marketing", "Franchise Development",
                            "Executive Director", "Other"),
    "Email check": {"rich_text": {}},
    "Industry": {"rich_text": {}},
    "Pain point": {"rich_text": {}},
    "Location": {"rich_text": {}},
    "google map location": {"url": {}},
    "Result": _select("Not contacted", "Emailed", "Replied", "Meeting", "Client", "Not interested", "Bounced"),
    "Result date": {"date": {}},
    "Reviewed by": {"people": {}},
    "Source pages": {"rich_text": {}},
    "Company size": {"rich_text": {}},
    "Founder LinkedIn": {"url": {}},
    "LinkedIn found via": _select("1 Own site", "2 Business listing", "3 Press article", "4 Search result"),
    "Tools on site": {"multi_select": {"options": []}},     # the Validator adds the tool names it finds
    "Site health": {"rich_text": {}},
    "Lead score": {"number": {"format": "number"}},
    "ID": {"unique_id": {"prefix": "LEAD"}},
    "Created time": {"created_time": {}},
}


def page_id(text: str) -> str:
    """A page id from an id or a Notion URL (the last 32 hex characters)."""
    hexes = re.findall(r"[0-9a-fA-F]{32}", text.replace("-", ""))
    if not hexes:
        sys.exit(f"not a Notion page id or URL: {text}")
    h = hexes[-1].lower()
    return f"{h[:8]}-{h[8:12]}-{h[12:16]}-{h[16:20]}-{h[20:]}"


def call(method: str, path: str, key: str, body: dict | None = None) -> dict:
    req = urllib.request.Request(API + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Authorization": f"Bearer {key}", "Notion-Version": VERSION,
                                          "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        sys.exit(f"Notion answered {e.code}: {e.read().decode()[:300]}")


def existing_board(parent: str, title: str, key: str) -> str | None:
    """The id of a database with this title directly under the page, if there is one."""
    cursor = None
    while True:
        page = call("GET", f"/blocks/{parent}/children?page_size=100" + (f"&start_cursor={cursor}" if cursor else ""), key)
        for block in page.get("results", []):
            if block.get("type") == "child_database" and block["child_database"].get("title", "").strip().lower() == title.lower():
                return block["id"]
        if not page.get("has_more"):
            return None
        cursor = page.get("next_cursor")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--parent", required=True, help="the Notion page (id or URL) to create the board under")
    ap.add_argument("--title", default="Leads")
    ap.add_argument("--dry-run", action="store_true", help="print the columns, create nothing")
    args = ap.parse_args()
    if args.dry_run:
        for name, prop in PROPERTIES.items():
            kind = next(iter(prop))
            opts = [o["name"] for o in prop[kind].get("options", [])] if isinstance(prop[kind], dict) else []
            print(f"{name}: {kind}" + (f" ({', '.join(opts)})" if opts else ""))
        return
    try:
        key = KEY_FILE.read_text(encoding="utf-8").strip()
    except OSError:
        sys.exit(f"no Notion key at {KEY_FILE} (create an internal integration, save its secret there, chmod 600)")
    parent = page_id(args.parent)
    found = existing_board(parent, args.title, key)
    if found:
        sys.exit(f"a database titled '{args.title}' already exists under that page ({found}); nothing created")
    db = call("POST", "/databases", key, {"parent": {"type": "page_id", "page_id": parent},
                                          "title": [{"type": "text", "text": {"content": args.title}}],
                                          "initial_data_source": {"properties": PROPERTIES}})
    sources = db.get("data_sources") or []
    if not sources:
        sys.exit(f"created database {db.get('id')} but Notion returned no data source id; open it in Notion and copy it")
    ds = sources[0]["id"]
    print(f"Created '{args.title}' ({db.get('url', db.get('id'))}).\n\nData source id: {ds}\n\nPaste it into:\n"
          f"  lead-gen/config.toml        [leads] database_id = \"{ds}\"   (and enabled = true)\n"
          f"  validator/config.toml       [validator] leads_data_source_id = \"{ds}\"\n"
          "and into any other bot that reads or writes the board ([leads] database_id).")


if __name__ == "__main__":
    main()
