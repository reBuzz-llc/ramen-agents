"""The Leads board on the team portal for the Validator (common-data/configs/common.toml [leads] portal_url).

Unset portal_url = the board stays on Notion and nothing here runs. Set, the Validator reads the rows from the Mac's one
copy of the board -- common-data/shared-state/portal-leads-cache.json, shared with the agents' lead stores (the engine's
portal_store.py) under the same lock: one full pull a day for the whole Mac, then only the rows changed since the copy's
revision, with the ETag so an unchanged board costs no body -- and writes its few cells (Tools on site, Site health, Lead
score; a number the team marked false) with its own key, common-data/keys/portal-validator.key, each write read back.
"""
from __future__ import annotations

import datetime as dt
import fcntl
import json
import os
import re
import tomllib
from pathlib import Path
from typing import Any

import httpx

from sources import LeadRow

BOTS = Path.home() / "bots"
COMMON = BOTS / "common-data" / "configs" / "common.toml"
KEY = BOTS / "common-data" / "keys" / "portal-validator.key"
CACHE = BOTS / "common-data" / "shared-state" / "portal-leads-cache.json"
ACTOR = "validator"
FALSE_STATUS = "False Whatsapp Number"
# Notion column -> portal field (the engine's portal_store.PORTAL_FIELDS)
FIELDS = {"Business": "business", "Website": "website", "Business email": "business_email", "Email check": "email_check",
          "Location": "location", "Industry": "industry", "Company size": "size", "Contact person": "contact_person",
          "Contact role": "contact_role", "Founder LinkedIn": "founder_linkedin", "LinkedIn found via": "linkedin_via",
          "Whatsapp": "whatsapp", "google map location": "map_link", "Pain point": "pain_point", "How can I help": "package",
          "Evidence": "evidence", "Source pages": "source_pages", "Tools on site": "tools_on_site", "Site health": "site_health",
          "Lead score": "lead_score", "Draft email": "draft_email", "Draft Whatsapp msg": "draft_whatsapp", "Status": "status"}


def portal_url(common: Path = COMMON) -> str:
    try:
        return str((tomllib.loads(common.read_text(encoding="utf-8")).get("leads") or {}).get("portal_url") or "").strip().rstrip("/")
    except (OSError, ValueError):
        return ""


def _text(v: Any) -> str:
    if v is None:
        return ""
    if isinstance(v, list):
        return ", ".join(str(x) for x in v)
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v)


def _hex(s: str) -> str:
    return re.sub(r"[^0-9a-f]", "", (s or "").lower())


def to_row(lead: dict[str, Any], app: str) -> LeadRow:
    g = lambda k: _text(lead.get(k))   # noqa: E731
    return LeadRow(
        page_id=_hex(str(lead.get("notion_page_id") or "")) or _hex(str(lead.get("id", ""))),
        url=f"{app}/leads/{lead.get('id', '')}", business=g("business"), website=g("website"), email=g("business_email"),
        location=g("location"), industry=g("industry"), company_size=g("size"), pain_point=g("pain_point"), how_we_help=g("package"),
        evidence=g("evidence"), stage="", found_on=None, source_pages=g("source_pages"), found_by=g("found_by"),
        created=g("created_at"), edited=g("updated_at"), founded_by=g("contact_person"), email_check=g("email_check"),
        result=g("result"), result_date=g("result_date"), draft_email=g("draft_email"), whatsapp=g("whatsapp"),
        draft_whatsapp=g("draft_whatsapp"), contact_role=g("contact_role"), founder_linkedin=g("founder_linkedin"),
        linkedin_via=g("linkedin_via"), map_url=g("map_link"), status=g("status") or g("whatsapp_status"))


class PortalLeads:
    """leads() and select_options() as NotionReader answers them, write() for the Validator's cells."""

    def __init__(self, state: dict, url: str, token: str | None = None, http: httpx.Client | None = None,
                 cache: Path | None = CACHE, today: str | None = None) -> None:
        token = token or (KEY.read_text(encoding="utf-8").strip() if KEY.exists() else os.environ.get("PORTAL_VALIDATOR_KEY", ""))
        if not token:
            raise RuntimeError(f"no portal key for the Validator ({KEY})")
        self.state, self.app = state, url.rstrip("/")
        self.http = http or httpx.Client(base_url=self.app, timeout=30)
        self.headers = {"Authorization": f"Bearer {token}"}
        self.cache = cache
        self.today = today or dt.date.today().isoformat()
        self.requests = 0
        self._ids: dict[str, str] = {}
        self._rows: dict[str, dict] | None = None

    def _get(self, path: str, etag: str = "", **params: Any) -> tuple[int, dict, str]:
        self.requests += 1
        r = self.http.get(path, headers={**self.headers, **({"If-None-Match": etag} if etag else {})}, params=params)
        if r.status_code == 304:
            return 304, {}, etag
        if r.status_code >= 400 or "json" not in r.headers.get("content-type", ""):
            raise RuntimeError(f"the portal answered {path} with HTTP {r.status_code}")
        return r.status_code, r.json(), r.headers.get("etag", "") or ""

    def _fetch(self, rows: dict, rev: int, etag: str) -> tuple[int, str]:
        for _ in range(200):
            status, data, etag = self._get("/v1/boards/leads/rows", etag if rev else "", since=rev, limit=500, fields="all")
            if status == 304:
                break
            for l in data.get("leads") or []:
                if isinstance(l, dict) and l.get("id"):
                    rows[str(l["id"])] = l
            rev = int(data.get("next") or rev)
            if not data.get("more"):
                break
        return rev, etag

    def board(self) -> list[dict]:
        if self._rows is None:
            if self.cache is None:
                rows: dict = {}
                self._fetch(rows, 0, "")
            else:
                self.cache.parent.mkdir(parents=True, exist_ok=True)
                with open(self.cache.with_suffix(".lock"), "w") as lock:
                    fcntl.flock(lock, fcntl.LOCK_EX)
                    try:
                        saved = json.loads(self.cache.read_text(encoding="utf-8"))
                    except (OSError, ValueError):
                        saved = {}
                    rows = saved.get("rows") if isinstance(saved, dict) and isinstance(saved.get("rows"), dict) else {}
                    full = not rows or saved.get("full_day") != self.today
                    if full:
                        rows = {}
                    rev, etag = self._fetch(rows, 0 if full else int(saved.get("rev") or 0), "" if full else str(saved.get("etag") or ""))
                    tmp = self.cache.with_name(f"{self.cache.name}.{os.getpid()}.tmp")
                    tmp.write_text(json.dumps({"rev": rev, "etag": etag, "full_day": self.today if full else saved.get("full_day"), "rows": rows}), encoding="utf-8")
                    tmp.replace(self.cache)
            self._rows = rows
            for l in rows.values():
                self._ids[_hex(str(l.get("notion_page_id") or ""))] = str(l["id"])
                self._ids[_hex(str(l["id"]))] = str(l["id"])
        return [l for l in self._rows.values() if not l.get("archived")]

    def leads(self, data_source_id: str = "", edited_after: str | None = None) -> list[LeadRow]:
        rows = self.board()
        if edited_after:
            rows = [l for l in rows if str(l.get("updated_at") or "") >= edited_after[:19]]
        return [to_row(l, self.app) for l in sorted(rows, key=lambda l: str(l.get("created_at") or ""))]

    def select_options(self, data_source_id: str = "", column: str = "How can I help") -> list[str]:
        """The portal has no dropdown: the package names are the board's own values plus the last list kept in state."""
        names = set(self.state.get("lead_package_names") or [])
        if column == "How can I help":
            names |= {str(l["package"]).strip() for l in self.board() if l.get("package")}
        return sorted(n for n in names if n)

    def write(self, page_id: str, fields: dict[str, Any]) -> dict[str, list]:
        """Cells by Notion column name (or portal field), as actor "validator", read back: {"written", "refused", "differs"}."""
        self.board()
        rid = self._ids.get(_hex(page_id))
        if rid is None:
            raise RuntimeError(f"no lead {page_id} on the portal")
        sent = {FIELDS.get(k, k): v for k, v in fields.items()}
        r = self.http.patch(f"/v1/rows/{rid}", headers=self.headers, json={"actor": ACTOR, "fields": sent})
        data = r.json() if "json" in r.headers.get("content-type", "") else {}
        if r.status_code >= 400:
            raise RuntimeError(f"the portal refused the write: HTTP {r.status_code}")
        lead = data.get("lead") or {}
        written = list(data.get("written") or [])
        differs = [k for k in written if k in lead and _text(lead.get(k)).strip() != _text(sent.get(k)).strip()]
        return {"written": written, "refused": list(data.get("refused") or []), "differs": differs}

    def false_whatsapp(self) -> list[dict]:
        """Rows whose number the team marked false (the whatsapp status, or the old combined Status)."""
        return [l for l in self.board() if FALSE_STATUS in (_text(l.get("whatsapp_status")), _text(l.get("status")))]


def reader_for(state: dict, notion_reader):
    """The Leads reader for this Mac: PortalLeads when common.toml sets [leads] portal_url, else the NotionReader given."""
    url = portal_url()
    return PortalLeads(state, url) if url else notion_reader


def writer(portal: PortalLeads):
    """write(page_id, fields) -> True when every cell landed and read back the same, for signals.run."""
    def write(page_id: str, fields: dict[str, Any]) -> bool:
        try:
            got = portal.write(page_id, fields)
        except (RuntimeError, httpx.HTTPError):
            return False
        return not got["refused"] and not got["differs"]
    return write
