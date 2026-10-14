"""The Lead Enricher's work list (owner, 2026-10-10: another member that works with Lead Gen and the
Validator to keep looking for empty cells and fill them). Written by the Validator once a day with a full sweep to
common-data/botBox/routed/lead-enricher/empty-cells.md: rows on the Leads board with an empty Contact person, Location,
Company size or Industry, founder first, oldest first. A row offered rests for a week, so one it cannot fill does not come
back every day; a filled cell leaves the list because it is no longer empty; a cell the team deleted is The CEO's to assign.

Line shape: - <Business> | <Website, or the listing page for a business with no site> | missing: <columns> | pages: <urls>
"""
from __future__ import annotations

import datetime as dt
from pathlib import Path

from sources import LeadRow

BOTS = Path.home() / "bots"
LIST = BOTS / "common-data" / "botBox" / "routed" / "lead-enricher" / "empty-cells.md"
# owner, 2026-10-10: the Enricher fills every empty cell below, so Lead Gen never goes back to older rows ("lead enricher will
# only update empty cells so that leaA does not have to find all info or go back to older data")
COLUMNS = (("Contact person", "founded_by"), ("Pain point", "pain_point"), ("Whatsapp", "whatsapp"), ("Location", "location"),
           ("google map location", "map_url"), ("Company size", "company_size"), ("Industry", "industry"))
FILLS = {c for c, _ in COLUMNS}
PER_DAY = 25
REST_DAYS = 7


def build(leads: list[LeadRow], state: dict, now: dt.datetime) -> tuple[str, int]:
    offered: dict[str, str] = state.setdefault("enricher_offered", {})
    cutoff = (now - dt.timedelta(days=REST_DAYS)).isoformat(timespec="seconds")
    for pid in [p for p, at in offered.items() if at < cutoff]:
        offered.pop(pid)
    # a cell the team deleted comes first, with the old value ruled out (owner, 2026-10-10: deleted cells are the Validator's)
    deleted = {k: v for k, v in (state.get("deleted_cells") or {}).items() if v.get("to_enricher")}
    rows = []
    for ld in leads:
        if not ld.business.strip():
            continue
        gone = {k.split("|", 1)[1]: v.get("was", "") for k, v in deleted.items() if k.startswith(ld.page_id + "|")}
        if ld.page_id in offered and not gone:
            continue
        missing = []
        for col, attr in COLUMNS:
            if getattr(ld, attr).strip():
                continue
            was = gone.get(col) or (gone.get("Contact person") or gone.get("Founded by") if col == "Contact person" else "")
            missing.append(f"{col} (the team deleted '{was[:60]}': not that)" if was else col)
        if ld.founded_by.strip() and not ld.founder_linkedin.strip():
            missing.append("Founder LinkedIn (steps: 1 Own site, 2 Business listing, 3 Press article, 4 Search result naming the business)")
        if missing:
            rank = 0 if gone else 1 if any(m.startswith("Contact person") for m in missing) else 2
            rows.append((rank, ld.created, ld, missing))
    rows.sort(key=lambda r: (r[0], r[1]))
    lines = ["# Empty cells to fill (Validator, " + now.strftime("%Y-%m-%d") + ")", "",
             "Fill only what a page you open states, with update_lead (exact business name; founded_by, pain_point, whatsapp, location, map_url, "
             "size, industry). Cells the team deleted come first: their old value was wrong, never write it back. Then Contact person: the "
             "drafts greet that person. Pain point in three lines (Pain point: / They can try: / We propose:). Whatsapp only as a number a "
             "page prints. Nothing found = leave it empty. Never replace a filled cell.", ""]
    picked = rows[:PER_DAY]
    for _, _, ld, missing in picked:
        site = ld.website.strip() or ld.evidence.strip() or "(no page on record)"
        pages = " ".join(dict.fromkeys(u for u in (ld.evidence.strip(), *ld.source_pages.split()) if u.startswith("http")))[:300]
        lines.append(f"- {ld.business} | {site} | missing: {', '.join(missing)} | pages: {pages or '-'}")
        offered[ld.page_id] = now.isoformat(timespec="seconds")
    return "\n".join(lines) + "\n", len(picked)


def due(state: dict, now: dt.datetime) -> bool:
    return str(state.get("enricher_list_at", ""))[:10] != now.date().isoformat() or not LIST.exists()


def write(leads: list[LeadRow], state: dict, now: dt.datetime) -> int:
    text, n = build(leads, state, now)
    LIST.parent.mkdir(parents=True, exist_ok=True)
    LIST.write_text(text, encoding="utf-8")
    state["enricher_list_at"] = now.date().isoformat()
    return n
