"""The team's board: the starter dashboard's local board ([leads] portal_url, http://127.0.0.1:3000 by default) or the
hosted portal at the same paths, so a move between them is a URL change (queue 572: the starter has no Notion).

Leads: GET /v1/boards/leads/rows?since=<rev>&limit=500&fields=all for the rows changed since a revision (with an ETag: a
reader that sends it back as If-None-Match gets 304 and no body), POST /v1/boards/leads/rows to add a row, PATCH
/v1/rows/{id} to change cells (a cell a person set is refused, and the answer says which), GET /v1/rows/{id} for one row.
Tasks: POST /v1/boards/tasks/rows, PATCH and GET /v1/tasks/{id}. Packages: POST /v1/assets/packages/drafts (a bot hands a
draft over; only a person publishes), GET /v1/assets/packages/drafts to read it back. Each writer has its own key
(common-data/keys/portal-engine.key for the agents), sent as "Authorization: Bearer <key>".

Every bot on the Mac shares one copy of the Leads board in common-data/shared-state/portal-leads-cache.json, under a lock:
one full pull a day for the whole Mac, then only the rows changed since the copy's revision, at most every
REFRESH_SECONDS. Rows reach the controller as {"page_id", "url", "title", "fields": {column: text}}.

Unreachable, 402 or 5xx is "board down" (board_down.py): one probe a minute for the Mac, the rest refused at once.
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

from . import board_down
from .board import HUMAN_ONLY_COLUMNS, BoardError, valid_date, valid_priority

# Board column (as the controller names it) -> portal field.
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


class _Portal:
    """One board client: the key, the board-down flag and the call every store makes."""

    def __init__(self, base_url: str, token: str, actor: str, logger: logging.Logger | None = None, *,
                 http: httpx.Client | None = None, down_flag: Path | None = None) -> None:
        self.base = base_url.rstrip("/")
        self.actor = actor
        self.logger = logger or logging.getLogger("explorer.portal_store")
        self.http = http or httpx.Client(base_url=self.base, timeout=30)
        self.headers = {"Authorization": f"Bearer {token}"}
        self.down_flag = down_flag      # the Mac's board-down flag (None: not shared, as in tests)
        self.last_warnings: list[str] = []
        self.bytes = 0

    def _call(self, method: str, path: str, **kw: Any) -> tuple[int, dict[str, Any], httpx.Headers]:
        if self.down_flag is not None:
            board_down.gate(self.down_flag)
        try:
            r = self.http.request(method, path, headers={**self.headers, **kw.pop("headers", {})}, **kw)
        except httpx.HTTPError as exc:
            if self.down_flag is not None:
                board_down.failed(type(exc).__name__, self.down_flag, url=self.base)
            raise BoardError(f"the board at {self.base} could not be reached ({type(exc).__name__}): is the dashboard running?") from exc
        self.bytes += len(r.content or b"")
        if self.down_flag is not None:
            if board_down.is_outage(r.status_code):
                board_down.failed(f"HTTP {r.status_code}", self.down_flag, url=self.base)
            elif board_down.answered(self.down_flag):
                self.logger.warning("board_back: %s answered HTTP %s; the board-down flag is down", self.base, r.status_code)
        try:
            data = r.json() if "json" in r.headers.get("content-type", "") else {}
        except ValueError:
            data = {}
        data = data if isinstance(data, dict) else {}
        if r.status_code in (401, 403):
            raise BoardError(f"the board refused the agents' key ({r.status_code})")
        if board_down.is_outage(r.status_code) or (r.status_code >= 400 and not data):
            raise BoardError(f"the board answered HTTP {r.status_code}")
        return r.status_code, data, r.headers

    @staticmethod
    def _refusal(data: dict[str, Any]) -> BoardError:
        err = data.get("error") or {}
        return BoardError(f"{err.get('code', 'refused')}: {err.get('message', '')}"[:300])


class PortalLeadStore(_Portal):
    REFRESH_SECONDS = 300.0

    def __init__(self, base_url: str, token: str, actor: str, logger: logging.Logger | None = None, *,
                 http: httpx.Client | None = None, cache: Path | None = None, today: str | None = None,
                 down_flag: Path | None = None) -> None:
        super().__init__(base_url, token, actor, logger, http=http, down_flag=down_flag)
        self._rows: dict[str, dict[str, Any]] = {}
        self._rev = 0
        self._etag = ""
        self._pulled = 0.0
        self.cache = cache          # None: no shared copy (tests, a store outside a fleet)
        self.today = today
        self.pulls = 0

    # ---- the API ---------------------------------------------------------------------------------------------------
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
        """A board row id from the id a bot recorded (with or without dashes)."""
        want = _hex(page_id)
        if not want:
            return None
        self.refresh()
        for rid, lead in self._rows.items():
            if _hex(rid) == want:
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
            raise BoardError(f"{err.get('code', 'refused')}: {err.get('message', '')}"[:300])
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
            raise BoardError(f"no lead {page_id} on the board")
        sent = self._to_portal(fields)
        if not sent:
            raise BoardError("nothing to update: no known column with a value")
        status, data, _ = self._call("PATCH", f"/v1/rows/{rid}", json={"actor": self.actor, "fields": sent})
        if status >= 400:
            err = data.get("error") or {}
            raise BoardError(f"{err.get('code', 'refused')}: {err.get('message', '')}"[:300])
        lead = data.get("lead") or {}
        self._keep(lead)
        written = [w for w in data.get("written") or []]
        people = self._note_refused(data)
        if people and not [w for w in written if w != "source_pages"]:
            raise BoardError(f"{PERSON_SET}: {', '.join(people)}; leave it as it is")
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


def _dashed(page_id: str) -> str:
    h = _hex(page_id)
    return f"{h[:8]}-{h[8:12]}-{h[12:16]}-{h[16:20]}-{h[20:]}" if len(h) == 32 else (page_id or "").strip()


class PortalBoard(_Portal):
    """The CEO's task board and the package drafts, on the same board as the leads (queue 572, in place of Notion).

    A bot's task starts "Not started" and unassigned: status, assignees, the checklist and archiving are the team's
    cells, so an assignee the model names is not written (the task's details may still name who it is for). A package is
    handed over as a draft; the same agent's draft of the same name is updated in place, and only a person publishes."""

    TASK_COLUMNS = {"title": "Task", "status": "Status", "priority": "Priority", "due": "Dead Line", "details": "Details",
                    "projects": "Projects", "blocker": "Blocker"}

    def __init__(self, base_url: str, token: str, actor: str, logger: logging.Logger | None = None, *,
                 http: httpx.Client | None = None, down_flag: Path | None = None, default_project: str = "") -> None:
        super().__init__(base_url, token, actor, logger, http=http, down_flag=down_flag)
        self.default_project = default_project.strip()
        self.last_toggle_id = ""
        self.team: list[Any] = []

    def set_team(self, team: list[Any]) -> None:
        self.team = list(team or [])

    def available(self) -> tuple[bool, str]:
        try:
            self._call("GET", "/v1/boards/tasks/rows", params={"since": 0, "limit": 1})
        except BoardError as exc:
            return False, str(exc)
        return True, f"the board at {self.base} answers"

    # ---- tasks -----------------------------------------------------------------------------------------------------
    def _task_url(self, task: dict[str, Any]) -> str:
        return f"{self.base}/tasks/{_hex(str(task.get('id', '')))}"

    def create_task(self, title: str, details: str, assignee: str | None = None, priority: str = "P3", due: str | None = None) -> str:
        self.last_warnings = []
        if not valid_priority(priority):
            raise BoardError("priority must be P0 to P6")
        if not valid_date(due):
            raise BoardError("due must be a date like 2026-09-30")
        fields: dict[str, Any] = {"title": title.strip()[:200], "priority": priority.strip().upper(), "details": details.strip()}
        if due and due.strip():
            fields["due"] = due.strip()
        if self.default_project:
            fields["projects"] = [self.default_project]
        if assignee and assignee.strip():
            self.last_warnings.append(f"assignee '{assignee.strip()[:60]}' not set: the team assigns tasks on the board")
        status, data, _ = self._call("POST", "/v1/boards/tasks/rows", json={"actor": self.actor, "fields": fields})
        if status >= 400:
            raise self._refusal(data)
        task = data.get("task") or {}
        self._note_task_refused(data)
        return self._task_url(task)

    def update_task(self, page_id: str, assignee=None, priority=None, due=None, details_append=None) -> None:
        self.last_warnings = []
        if priority is not None and not valid_priority(priority):
            raise BoardError("priority must be P0 to P6")
        if due is not None and not valid_date(due):
            raise BoardError("due must be a date like 2026-09-30")
        fields: dict[str, Any] = {}
        if priority:
            fields["priority"] = priority.strip().upper()
        if due:
            fields["due"] = due.strip()
        if assignee:
            self.last_warnings.append(f"assignee '{str(assignee)[:60]}' not set: the team assigns tasks on the board")
        body: dict[str, Any] = {"actor": self.actor, "fields": fields}
        if details_append and str(details_append).strip():
            body["details_append"] = str(details_append).strip()
        if not fields and "details_append" not in body:
            raise BoardError("nothing to update: give a priority, a due date or details to add")
        status, data, _ = self._call("PATCH", f"/v1/tasks/{_dashed(page_id)}", json=body)
        if status == 404:
            raise BoardError(f"no task {page_id} on the board")
        if status >= 400:
            raise self._refusal(data)
        self._note_task_refused(data)

    def _note_task_refused(self, data: dict[str, Any]) -> None:
        for r in data.get("refused") or []:
            self.last_warnings.append(f"{self.TASK_COLUMNS.get(str(r.get('field')), str(r.get('field')))}: {r.get('reason', 'refused')}; left as it is")

    def _task(self, page_id: str) -> dict[str, Any] | None:
        status, data, _ = self._call("GET", f"/v1/tasks/{_dashed(page_id)}")
        return None if status == 404 else (data.get("task") or None)

    def read_page(self, page_id: str) -> dict[str, Any] | None:
        task = self._task(page_id)
        if task is None:
            return None
        return {"archived": bool(task.get("archived")),
                "fields": {col: _text(task.get(key)) for key, col in self.TASK_COLUMNS.items()}}

    def page_text(self, page_id: str, limit_blocks: int = 400) -> str:
        task = self._task(page_id) or {}
        return _text(task.get("details"))

    def set_status(self, page_id: str, status: str) -> None:
        raise BoardError("a task's status is the team's cell on the board; say it in the details instead")

    # ---- packages --------------------------------------------------------------------------------------------------
    def append_package_toggle(self, page_id: str, title: str, email: str, sources, company, conclusion: str, *,
                              name: str = "", audience: str = "", price: str = "", timeline: str = "",
                              deliverables=(), rationale: str = "", created: str = "", updated: str = "", **_: Any) -> str:
        """Hand the package over as a draft on the board's Packages list (page_id is unused: kept for the caller)."""
        self.last_warnings = []
        facts = [f"{label}: {value}" for label, value in (company or []) if str(value).strip()]
        why = "\n\n".join(x for x in ((rationale or conclusion).strip(), (f"Timeline: {timeline.strip()}" if timeline.strip() else ""),
                                       ("Source company: " + "; ".join(facts)) if facts else "") if x)
        body = {"name": (name or title).strip()[:200], "price": price.strip(), "buyer": audience.strip(),
                "deliverables": [str(d).strip() for d in (deliverables or []) if str(d).strip()],
                "offer": "\n\n".join(x for x in (title.strip(), email.strip()) if x), "why": why,
                "sources": [str(u).strip() for u in (sources or []) if str(u).strip()], "by": self.actor}
        status, data, _ = self._call("POST", "/v1/assets/packages/drafts", json=body)
        if status >= 400:
            raise self._refusal(data)
        pkg = data.get("package") or data.get("draft") or {}
        self.last_toggle_id = str(pkg.get("id") or "")
        return f"{self.base}/packages"

    def delete_block(self, block_id: str) -> None:
        """A draft of the same name is updated in place, so there is nothing to remove first."""
        return None

    def read_block(self, block_id: str) -> dict[str, Any] | None:
        """The draft as the board holds it, or None when it is not there."""
        if not block_id:
            return None
        _, data, _ = self._call("GET", "/v1/assets/packages/drafts")
        for pkg in (data.get("drafts") or data.get("packages") or []):
            if isinstance(pkg, dict) and str(pkg.get("id")) == block_id:
                return {"archived": False, "type": "draft", "name": _text(pkg.get("name"))}
        return None
