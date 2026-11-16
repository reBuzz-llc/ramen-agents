"""The team's board for the Validator: the starter dashboard's local board, or the hosted portal at the same paths
(common.toml [leads] portal_url, http://127.0.0.1:3000 by default; queue 572: the starter has no Notion).

The Validator reads the leads from the Mac's one copy of the board -- common-data/shared-state/portal-leads-cache.json,
shared with the agents' lead stores (the engine's portal_store.py) under the same lock: one full pull a day for the whole
Mac, then only the rows changed since the copy's revision, with the ETag so an unchanged board costs no body -- the tasks
(GET /v1/boards/tasks/rows) and the packages with their drafts (GET /v1/assets/packages, /v1/assets/packages/drafts), and
writes its few cells (Tools on site, Site health, Lead score; a number the team marked false) with its own key,
common-data/keys/portal-validator.key, each write read back. Its own values may sit in common-data/configs/local.toml.
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

from sources import LeadRow, PackageToggle, TaskRow

BOTS = Path.home() / "bots"
COMMON = BOTS / "common-data" / "configs" / "common.toml"
LOCAL = BOTS / "common-data" / "configs" / "local.toml"     # the user's own values, untracked (queue 572)
DEFAULT_URL = "http://127.0.0.1:3000"
KEY = BOTS / "common-data" / "keys" / "portal-validator.key"
CACHE = BOTS / "common-data" / "shared-state" / "portal-leads-cache.json"
ACTOR = "validator"
FALSE_STATUS = "False Whatsapp Number"
# board column (as the checks name it) -> portal field (the engine's portal_store.PORTAL_FIELDS)
FIELDS = {"Business": "business", "Website": "website", "Business email": "business_email", "Email check": "email_check",
          "Location": "location", "Industry": "industry", "Company size": "size", "Contact person": "contact_person",
          "Contact role": "contact_role", "Founder LinkedIn": "founder_linkedin", "LinkedIn found via": "linkedin_via",
          "Whatsapp": "whatsapp", "google map location": "map_link", "Pain point": "pain_point", "How can I help": "package",
          "Evidence": "evidence", "Source pages": "source_pages", "Tools on site": "tools_on_site", "Site health": "site_health",
          "Lead score": "lead_score", "Draft email": "draft_email", "Draft Whatsapp msg": "draft_whatsapp", "Status": "status"}


def leads_settings(common: Path = COMMON, local: Path = LOCAL) -> dict[str, Any]:
    """common.toml's [leads], with common-data/configs/local.toml's [leads] on top (the user's own values win)."""
    out: dict[str, Any] = {}
    for p in (common, local):
        try:
            out.update(tomllib.loads(p.read_text(encoding="utf-8")).get("leads") or {})
        except (OSError, ValueError):
            pass
    return out


def portal_url(common: Path = COMMON, local: Path = LOCAL) -> str:
    """The board's address: [leads] portal_url, else the dashboard's local board."""
    return str(leads_settings(common, local).get("portal_url") or DEFAULT_URL).strip().rstrip("/")


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
        page_id=_hex(str(lead.get("id", ""))),
        url=f"{app}/leads/{lead.get('id', '')}", business=g("business"), website=g("website"), email=g("business_email"),
        location=g("location"), industry=g("industry"), company_size=g("size"), pain_point=g("pain_point"), how_we_help=g("package"),
        evidence=g("evidence"), stage="", found_on=None, source_pages=g("source_pages"), found_by=g("found_by"),
        created=g("created_at"), edited=g("updated_at"), founded_by=g("contact_person"), email_check=g("email_check"),
        result=g("result"), result_date=g("result_date"), draft_email=g("draft_email"), whatsapp=g("whatsapp"),
        draft_whatsapp=g("draft_whatsapp"), contact_role=g("contact_role"), founder_linkedin=g("founder_linkedin"),
        linkedin_via=g("linkedin_via"), map_url=g("map_link"), status=g("status") or g("whatsapp_status"))


class PortalLeads:
    """leads(), tasks(), package_toggles() and select_options() for the checks, write() for the Validator's cells."""

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
        """Cells by column name (or portal field), as actor "validator", read back: {"written", "refused", "differs"}."""
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

    # ---- tasks and packages (queue 572: in place of the Notion task board and packages page) ----------------------
    def _pages(self, path: str, key: str, **params: Any) -> list[dict]:
        out: list[dict] = []
        since = 0
        for _ in range(200):
            _, data, _ = self._get(path, since=since, limit=500, **params)
            out += [x for x in data.get(key) or [] if isinstance(x, dict)]
            if not data.get("more"):
                break
            since = int(data.get("next") or since)
        return out

    def tasks(self, edited_after: str | None = None) -> list[TaskRow]:
        """The task board's live tasks, as the checks read them; edited_after (ISO) keeps only the ones changed since."""
        rows = [t for t in self._pages("/v1/boards/tasks/rows", "tasks") if not t.get("archived")]
        if edited_after:
            rows = [t for t in rows if str(t.get("updated_at") or "") >= edited_after[:19]]
        return [task_row(t, self.app) for t in rows]

    def package_toggles(self) -> list[PackageToggle]:
        """Every package on the board (published, and the bots' drafts with their sources and reasons), as the PK checks
        read a package: the title with its price, the offer as the pitch, the reasons as the conclusion."""
        _, data, _ = self._get("/v1/assets/packages")
        pkgs = {str(p.get("id")): p for p in data.get("packages") or [] if isinstance(p, dict) and p.get("id")}
        try:
            _, d2, _ = self._get("/v1/assets/packages/drafts")
            for p in d2.get("drafts") or d2.get("packages") or []:
                if isinstance(p, dict) and p.get("id"):
                    pkgs[str(p["id"])] = {**pkgs.get(str(p["id"]), {}), **p}
        except RuntimeError:
            pass        # a board without the drafts route: the published list still checks
        return [package_toggle(p, self.app) for p in pkgs.values()]

    def false_whatsapp(self) -> list[dict]:
        """Rows whose number the team marked false (the whatsapp status, or the old combined Status)."""
        return [l for l in self.board() if FALSE_STATUS in (_text(l.get("whatsapp_status")), _text(l.get("status")))]


def reader_for(state: dict, _unused=None) -> "PortalLeads":
    """The board reader for this Mac (the local board unless [leads] portal_url says otherwise)."""
    return PortalLeads(state, portal_url())


def writer(portal: PortalLeads):
    """write(page_id, fields) -> True when every cell landed and read back the same, for signals.run."""
    def write(page_id: str, fields: dict[str, Any]) -> bool:
        try:
            got = portal.write(page_id, fields)
        except (RuntimeError, httpx.HTTPError):
            return False
        return not got["refused"] and not got["differs"]
    return write


def task_row(t: dict[str, Any], app: str) -> TaskRow:
    names = t.get("assignees") or []
    names = names if isinstance(names, list) else [names]
    projects = t.get("projects") or []
    return TaskRow(page_id=_hex(str(t.get("id", ""))), url=f"{app}/tasks/{t.get('id', '')}", title=_text(t.get("title")),
                   status=_text(t.get("status")), priority=_text(t.get("priority")), assignee_ids=[str(x).strip().lower() for x in names],
                   assignee_names=[str(x) for x in names], due=_text(t.get("due"))[:10] or None,
                   project_ids=[str(x) for x in (projects if isinstance(projects, list) else [projects])],
                   created=_text(t.get("created_at")), edited=_text(t.get("updated_at")), body=_text(t.get("details")),
                   uid=_text(t.get("uid") or t.get("number")), blocker=_text(t.get("blocker")),
                   blocks=_blocks(_text(t.get("details"))))


def _blocks(text: str) -> list[tuple[str, str, bool]]:
    """Markdown details as the (type, text, bold) blocks the task checks read: '### X' a heading, '- [ ] x' a to-do."""
    out: list[tuple[str, str, bool]] = []
    for line in (text or "").splitlines():
        t = line.strip()
        if not t:
            continue
        if m := re.match(r"^#{1,3}\s+(.+)$", t):
            out.append(("heading_3", m.group(1).strip(), False))
        elif m := re.match(r"^[-*]\s+\[[ xX]?\]\s+(.+)$", t):
            out.append(("to_do", m.group(1).strip(), False))
        elif m := re.match(r"^[-*•]\s+(.+)$", t):
            out.append(("bulleted_list_item", m.group(1).strip(), False))
        elif m := re.match(r"^\d+[.)]\s+(.+)$", t):
            out.append(("numbered_list_item", m.group(1).strip(), False))
        else:
            out.append(("paragraph", t, t.startswith("**") and t.endswith("**")))
    return out


def package_toggle(p: dict[str, Any], app: str) -> PackageToggle:
    name, price = _text(p.get("name")).strip(), _text(p.get("price")).strip()
    deliverables = p.get("deliverables") or []
    deliverables = deliverables if isinstance(deliverables, list) else [deliverables]
    extra = {k: v for k, v in (("Who it is for", _text(p.get("buyer"))), ("Price and timeline", price),
                                ("What is included", "\n".join(str(d) for d in deliverables)),
                                ("Created", f"Created {_text(p.get('created_at') or p.get('updated_at'))[:10]}"),
                                ("Status", _text(p.get("status")))) if v.strip()}
    return PackageToggle(block_id=str(p.get("id", "")), title=f"{name} — {price}" if price else name, email=_text(p.get("offer")),
                         sources=[str(u) for u in (p.get("sources") or []) if str(u).strip()], company={},
                         conclusion=_text(p.get("why")), page_url=f"{app}/packages", extra=extra)
