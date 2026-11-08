"""The Leads board on the team portal ([leads] portal_url) instead of Notion.

The portal's board API (the `portal` branch): GET /v1/boards/leads/rows?since=<rev>&fields=all for the rows changed since a
revision (with an ETag: a reader that sends it back as If-None-Match gets 304 and no body when nothing changed), POST
/v1/boards/leads/rows to add a row, PATCH /v1/rows/{id} to change cells (a cell a person set is refused, and the answer
says which), GET /v1/rows/{id} for one row. Each writer has its own key (common-data/keys/portal-engine.key for the agents).

Every bot on the Mac shares one copy of the board in common-data/shared-state/portal-leads-cache.json, under a lock: one
full pull a day for the whole Mac, then only the rows changed since the copy's revision, at most every REFRESH_SECONDS.
Rows reach the controller in the Notion shape it already reads: {"page_id", "url", "title", "fields": {column: text}}.
Unset portal_url = the board stays on Notion.
"""
from __future__ import annotations

import datetime as dt
import fcntl
import json
import logging
import os
import re
import time
from pathlib import Path
from typing import Any

import httpx

from .notion import HUMAN_ONLY_COLUMNS, NotionError

# Notion column -> portal field.
PORTAL_FIELDS: dict[str, str] = {
    "Business": "business", "Website": "website", "Business email": "business_email", "Email check": "email_check",
    "Location": "location", "Industry": "industry", "Company size": "size", "Contact person": "contact_person",
    "Contact role": "contact_role", "Founder LinkedIn": "founder_linkedin", "LinkedIn found via": "linkedin_via",
    "Whatsapp": "whatsapp", "google map location": "map_link", "Pain point": "pain_point", "How can I help": "package",
    "Evidence": "evidence", "Source pages": "source_pages", "Tools on site": "tools_on_site", "Site health": "site_health",
    "Lead score": "lead_score", "Draft email": "draft_email", "Draft Whatsapp msg": "draft_whatsapp", "Status": "status",
    "Result": "result", "Result date": "result_date", "Sent by": "sent_by", "Phone": "phone",
}
COLUMNS = {v: k for k, v in PORTAL_FIELDS.items()}
TEAM_ONLY = ("status", "sent_by")     # the team's cells: an agent never writes them
PERSON_SET = "a person set that cell"


def _hex(s: str) -> str:
    return re.sub(r"[^0-9a-f]", "", (s or "").lower())


def _text(v: Any) -> str:
    if v is None:
        return ""
    if isinstance(v, list):
        return ", ".join(str(x) for x in v)
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v)


def shared_cache_path() -> Path:
    """The Mac's one copy of the board: common-data/shared-state/portal-leads-cache.json (the dashboard keeps its own,
    portal-leads-cache-dashboard.json, in another shape)."""
    from .common.keys import keys_dir
    return keys_dir().parent / "shared-state" / "portal-leads-cache.json"


class PortalLeadStore:
    REFRESH_SECONDS = 300.0

    def __init__(self, base_url: str, token: str, actor: str, logger: logging.Logger | None = None, *,
                 http: httpx.Client | None = None, cache: Path | None = None, today: str | None = None) -> None:
        self.base = base_url.rstrip("/")
        self.actor = actor
        self.logger = logger or logging.getLogger("explorer.portal_store")
        self.http = http or httpx.Client(base_url=self.base, timeout=30)
        self.headers = {"Authorization": f"Bearer {token}"}
        self.last_warnings: list[str] = []
        self._rows: dict[str, dict[str, Any]] = {}
        self._rev = 0
        self._etag = ""
        self._pulled = 0.0
        self.cache = cache          # None: no shared copy (tests, a store outside a fleet)
        self.today = today
        self.pulls = 0
        self.bytes = 0

    # ---- the API ---------------------------------------------------------------------------------------------------
    def _call(self, method: str, path: str, **kw: Any) -> tuple[int, dict[str, Any], httpx.Headers]:
        try:
            r = self.http.request(method, path, headers={**self.headers, **kw.pop("headers", {})}, **kw)
        except httpx.HTTPError as exc:
            raise NotionError(f"the portal could not be reached: {type(exc).__name__}") from exc
        self.bytes += len(r.content or b"")
        try:
            data = r.json() if "json" in r.headers.get("content-type", "") else {}
        except ValueError:
            data = {}
        data = data if isinstance(data, dict) else {}
        if r.status_code in (401, 403):
            raise NotionError(f"the portal refused the agents' key ({r.status_code})")
        if r.status_code >= 500 or (r.status_code >= 400 and not data):
            raise NotionError(f"the portal answered HTTP {r.status_code}")
        return r.status_code, data, r.headers

    def _pull_since(self) -> int:
        """The rows changed since the copy's revision; a 304 (the ETag matched) is nothing changed and costs no body."""
        n = 0
        for _ in range(200):
            extra = {"headers": {"If-None-Match": self._etag}} if self._etag and self._rev else {}
            status, data, headers = self._call("GET", "/v1/boards/leads/rows", params={"since": self._rev, "limit": 500, "fields": "all"}, **extra)
            if status == 304:
                break
            for lead in data.get("leads") or []:
                if isinstance(lead, dict) and lead.get("id"):
                    self._rows[str(lead["id"])] = lead
                    n += 1
            self._rev = int(data.get("next") or self._rev)
            self._etag = headers.get("etag", "") or ""
            if not data.get("more"):
                break
        self.pulls += 1
        return n

    def _refresh_shared(self) -> None:
        today = self.today or dt.date.today().isoformat()
        self.cache.parent.mkdir(parents=True, exist_ok=True)
        with open(self.cache.with_suffix(".lock"), "w") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            try:
                saved = json.loads(self.cache.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                saved = {}
            rows = saved.get("rows") if isinstance(saved, dict) and isinstance(saved.get("rows"), dict) else {}
            full = not rows or saved.get("full_day") != today
            if full:
                self._rows, self._rev, self._etag = {}, 0, ""
            elif int(saved.get("rev") or 0) > self._rev or not self._rows:
                self._rows, self._rev, self._etag = dict(rows), int(saved.get("rev") or 0), str(saved.get("etag") or "")
            got = self._pull_since()
            self.logger.info("portal pull: %s, %d rows changed, %d bytes so far", "whole board (the day's one)" if full else "changes", got, self.bytes)
            tmp = self.cache.with_name(f"{self.cache.name}.{os.getpid()}.tmp")
            tmp.write_text(json.dumps({"rev": self._rev, "etag": self._etag, "full_day": today if full else saved.get("full_day"),
                                       "rows": self._rows}), encoding="utf-8")
            tmp.replace(self.cache)

    def refresh(self, force: bool = False) -> None:
        if not force and self._rows and time.time() - self._pulled < self.REFRESH_SECONDS:
            return
        if self.cache is not None:
            self._refresh_shared()
        else:
            self._pull_since()
        self._pulled = time.time()

    # ---- shapes ----------------------------------------------------------------------------------------------------
    def _keep(self, lead: dict[str, Any]) -> None:
        if lead.get("id"):
            self._rows[str(lead["id"])] = lead

    def _fields(self, lead: dict[str, Any]) -> dict[str, str]:
        return {col: _text(lead.get(key)) for col, key in PORTAL_FIELDS.items()}

    def _row(self, lead: dict[str, Any]) -> dict[str, Any]:
        return {"page_id": str(lead["id"]), "url": f"{self.base}/leads/{lead['id']}", "title": _text(lead.get("business")),
                "fields": self._fields(lead)}

    def _to_portal(self, fields: dict[str, str]) -> dict[str, Any]:
        out: dict[str, Any] = {}
        for col, value in (fields or {}).items():
            if str(col).strip().lower() in HUMAN_ONLY_COLUMNS:
                continue
            key = PORTAL_FIELDS.get(col)
            if key is None:
                self.last_warnings.append(f"no field '{col}' on the board")
                continue
            if key in TEAM_ONLY:
                self.last_warnings.append(f"'{col}' is the team's; not written")
                continue
            out[key] = [x.strip() for x in str(value).split(",") if x.strip()] if key == "tools_on_site" else value
        return out

    def _resolve(self, page_id: str) -> str | None:
        """A portal row id from a portal id or the Notion page id a bot recorded before the move."""
        want = _hex(page_id)
        if not want:
            return None
        self.refresh()
        for rid, lead in self._rows.items():
            if _hex(rid) == want or _hex(str(lead.get("notion_page_id") or "")) == want:
                return rid
        return None

    def _live(self) -> list[dict[str, Any]]:
        self.refresh()
        return [l for l in self._rows.values() if not l.get("archived")]

    def _note_refused(self, data: dict[str, Any]) -> list[str]:
        people = []
        for r in data.get("refused") or []:
            col = COLUMNS.get(str(r.get("field")), str(r.get("field")))
            if r.get("reason") in ("person_wins", "human_only"):
                people.append(col)
                self.last_warnings.append(f"{PERSON_SET}: {col} left as it is")
            else:
                self.last_warnings.append(f"{col} already filled; left as it is")
        return people

    def _read_back(self, sent: dict[str, Any], lead: dict[str, Any], written: list[str]) -> None:
        """Each written cell as the portal now holds it: a cell that reads back different is a warning, never silent."""
        for key in written:
            if key in sent and key in lead and _text(lead.get(key)).strip() != _text(sent[key]).strip():
                self.last_warnings.append(f"{COLUMNS.get(key, key)} reads back different on the portal")

    # ---- the board calls the controller makes ----------------------------------------------------------------------
    def create_row(self, title: str, fields: dict[str, str]) -> str:
        self.last_warnings = []
        sent = {"business": title.strip()[:200], **self._to_portal(fields)}
        status, data, _ = self._call("POST", "/v1/boards/leads/rows", json={"actor": self.actor, "fields": sent})
        if status >= 400:
            err = data.get("error") or {}
            raise NotionError(f"{err.get('code', 'refused')}: {err.get('message', '')}"[:300])
        lead = data.get("lead") or {}
        self._keep(lead)
        self._note_refused(data)
        self._read_back(sent, lead, [k for k in sent if k in lead])
        return f"{self.base}/leads/{_hex(str(lead.get('id', '')))}"

    def find_row(self, title: str) -> dict[str, Any] | None:
        want = title.strip().lower()[:200]
        for lead in self._live():
            if _text(lead.get("business")).strip().lower() == want:
                return self._row(lead)
        return None

    def has_domain(self, domain: str) -> bool:
        d = domain.strip().lower()
        return bool(d) and any(d in str(l.get("domain") or "") or d in _text(l.get("website")).lower() for l in self._live())

    def read_page(self, page_id: str) -> dict[str, Any] | None:
        rid = self._resolve(page_id)
        if rid is None:
            return None
        status, data, _ = self._call("GET", f"/v1/rows/{rid}")
        if status == 404:
            return None
        lead = data.get("lead") or {}
        self._keep(lead)
        return {"archived": bool(lead.get("archived")), "fields": self._fields(lead)}

    def update_row(self, page_id: str, fields: dict[str, str]) -> None:
        self.last_warnings = []
        rid = self._resolve(page_id)
        if rid is None:
            raise NotionError(f"no lead {page_id} on the board")
        sent = self._to_portal(fields)
        if not sent:
            raise NotionError("nothing to update: no known column with a value")
        status, data, _ = self._call("PATCH", f"/v1/rows/{rid}", json={"actor": self.actor, "fields": sent})
        if status >= 400:
            err = data.get("error") or {}
            raise NotionError(f"{err.get('code', 'refused')}: {err.get('message', '')}"[:300])
        lead = data.get("lead") or {}
        self._keep(lead)
        written = [w for w in data.get("written") or []]
        people = self._note_refused(data)
        if people and not [w for w in written if w != "source_pages"]:
            raise NotionError(f"{PERSON_SET}: {', '.join(people)}; leave it as it is")
        self._read_back(sent, lead, written)

    def _best_first(self, leads: list[dict[str, Any]], limit: int, score_column: str) -> list[dict[str, Any]]:
        key = PORTAL_FIELDS.get(score_column.strip(), "") if score_column.strip() else ""
        scored = sorted([l for l in leads if key and isinstance(l.get(key), (int, float))], key=lambda l: (-float(l[key]), str(l.get("created_at"))))
        rest = sorted([l for l in leads if l not in scored], key=lambda l: str(l.get("created_at")))
        return [self._row(l) for l in (scored + rest)[: max(1, min(100, limit))]]

    def rows_waiting(self, empty_column: str, stage_property: str, stage_value: str, limit: int, score_column: str = "",
                     require: tuple[str, ...] | list[str] = ()) -> list[dict[str, Any]]:
        empty = PORTAL_FIELDS.get(empty_column, "")
        stage = PORTAL_FIELDS.get(stage_property, "")

        def at_stage(l: dict[str, Any]) -> bool:
            if not stage_value:
                return True
            have = l.get(stage)
            return stage_value in have if isinstance(have, list) else _text(have) == stage_value

        need = [PORTAL_FIELDS.get(c, "") for c in require if c.strip()]
        out = [l for l in self._live() if empty and not _text(l.get(empty)).strip() and at_stage(l)
               and all(k and _text(l.get(k)).strip() for k in need)]
        return self._best_first(out, limit, score_column)

    def rows_drafted(self, draft_column: str, status_column: str, limit: int, not_reviewed: tuple[str, ...] = (), score_column: str = "") -> list[dict[str, Any]]:
        draft = PORTAL_FIELDS.get(draft_column, "")
        status = PORTAL_FIELDS.get(status_column, "")
        out = []
        for l in self._live():
            text = _text(l.get(draft)).strip()
            if not text or text.lower().startswith("skip:"):
                continue
            have = l.get(status) or []
            have = have if isinstance(have, list) else [have]
            if not have or any(v in have for v in not_reviewed):
                out.append(l)
        return self._best_first(out, limit, score_column)

    def replace_section(self, page_id: str, heading: str, text: str) -> None:
        """The portal keeps the draft in its cell; there is no page body to copy it into."""
        return None
