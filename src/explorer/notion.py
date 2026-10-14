"""Creating tasks (and task boards) in Notion. Only active when [notion] is enabled and configured.

This is the CEO persona's output skill: one page per task in the owner's task board. The shape
follows the owner's own guide (`notionGuide.md` in the bot folder): the canonical board has
`Task` (title), `Status` (status: Not started -> In progress -> Blocker -> In Review -> QA -> Done
-> Archived), `Priority` (select, P0-P6), `Assign` (people, exactly one people property),
`Dead Line` (date), `Projects` (relation), `ID` (unique_id), `Blocker` (rich_text) and
`Files & media` (files).

The client reads the board's schema once and only sets properties that exist there with a
compatible type, so an older board with drifted names still works. A people property is filled
by resolving a display name against the workspace's users; an unresolved name leaves the task
unassigned and says so, rather than guessing.

Never raises out of the loop: NotionError carries a plain-language reason that reaches the model
as the action's failure text.
"""
from __future__ import annotations

import datetime as dt
import logging
import re
from typing import Any

import httpx

from .config import NotionConfig
from .team import Member, find_member

_CHUNK = 1800  # Notion caps a rich_text item at 2000 characters
_HEADING = re.compile(r"^(#{1,3})\s+(.+)$")
_TODO = re.compile(r"^[-*]\s+\[([ xX]?)\]\s+(.+)$")
_BULLET = re.compile(r"^[-*•]\s+(.+)$")
_NUMBERED = re.compile(r"^\d+[.)]\s+(.+)$")
_DONE_HEADING = re.compile(r"done when|acceptance|definition of done|checklist|done looks like", re.I)

PRIORITY_PATTERN = re.compile(r"^P[0-6]$")
STATUS_OPTIONS = ["Not started", "In progress", "Blocker", "In Review", "QA", "Done", "Archived"]
# The columns a lead row fills (controller._execute_lead). Kept here so `bot check` can say which of them the
# configured board actually has; tests/test_leads.py asserts the two stay in step.
# Columns only a person writes (owner, 2026-10-06): what came of the outreach. No bot write ever carries them.
HUMAN_ONLY_COLUMNS = frozenset({"result", "result date", "reviewed by"})  # Reviewed by: the owner's people column (2026-10-10)


def _without_human_columns(fields: dict[str, str]) -> dict[str, str]:
    return {k: v for k, v in (fields or {}).items() if str(k).strip().lower() not in HUMAN_ONLY_COLUMNS}


LEAD_COLUMNS = ("Website", "Business email", "Location", "Industry", "Company size", "Pain point",
                "How can I help", "Evidence", "Source pages")  # 2026-10-10: the owner removed Stage and Found on (Created time covers it); no "Found by": the owner emptied it (2026-09-25)
PRIORITY_OPTIONS = ["P0", "P1", "P2", "P3", "P4", "P5", "P6"]


class NotionError(RuntimeError):
    pass


def valid_date(text: str | None) -> bool:
    if not text:
        return True
    try:
        dt.date.fromisoformat(text.strip())
        return True
    except ValueError:
        return False


def valid_priority(text: str | None) -> bool:
    return bool(text) and PRIORITY_PATTERN.match(text.strip().upper()) is not None



_PAGE_ID = re.compile(r"([0-9a-f]{32})(?=[/?#]|$)", re.I)


def page_id_from_url(url: str) -> str | None:
    """The page id in a Notion URL (…-afcd97e11026987aa90908803ded3dc0?v=…), as the dashed uuid the API takes."""
    m = _PAGE_ID.search((url or "").split("#")[0])
    if not m:
        return None
    h = m.group(1).lower()
    return f"{h[:8]}-{h[8:12]}-{h[12:16]}-{h[16:20]}-{h[20:]}"


class NotionClient:
    BASE = "https://api.notion.com"

    def __init__(
        self,
        cfg: NotionConfig,
        api_key: str,
        logger: logging.Logger | None = None,
        transport: httpx.BaseTransport | None = None,
    ):
        self.cfg = cfg
        self.logger = logger or logging.getLogger("explorer.notion")
        self.client = httpx.Client(
            base_url=self.BASE,
            timeout=httpx.Timeout(cfg.timeout_seconds, connect=10.0),
            headers={
                "Authorization": f"Bearer {api_key}",
                "Notion-Version": cfg.api_version,
                "Content-Type": "application/json",
            },
            transport=transport,
        )
        self._schema: dict[str, str] | None = None
        self._users: dict[str, str] | None = None
        self.last_warnings: list[str] = []
        # From API version 2025-09-03 a database is a container of data sources; the schema and the
        # rows live on the data source, and `database_id` in config names the data source. Older
        # versions refuse multi-source databases outright (the guide's §9 trap).
        self.new_api = cfg.api_version >= "2025-09-03"

    # ---- schema and users ----------------------------------------------------

    @property
    def _container_path(self) -> str:
        kind = "data_sources" if self.new_api else "databases"
        return f"/v1/{kind}/{self.cfg.database_id}"

    def _parent(self) -> dict[str, str]:
        if self.new_api:
            return {"type": "data_source_id", "data_source_id": self.cfg.database_id}
        return {"database_id": self.cfg.database_id}

    def schema(self) -> dict[str, str]:
        """Property name -> property type for the configured board. Cached for the process."""
        if self._schema is None:
            resp = self._request("GET", self._container_path)
            props = resp.get("properties") or {}
            self._schema = {name: str(spec.get("type", "")) for name, spec in props.items() if isinstance(spec, dict)}
        return self._schema

    def update_properties(self, changes: dict[str, Any]) -> dict[str, str]:
        """Rename properties or change their options, e.g. {"Task name": {"name": "Task"}} or
        {"Priority": {"select": {"options": [{"name": "P0"}, ...]}}}. Returns the new schema."""
        self._request("PATCH", self._container_path, json={"properties": changes})
        self._schema = None
        return self.schema()

    def title_property(self) -> str | None:
        schema = self.schema()
        if self.cfg.title_property and schema.get(self.cfg.title_property) == "title":
            return self.cfg.title_property
        return next((name for name, kind in schema.items() if kind == "title"), None)

    def users(self) -> dict[str, str]:
        """Workspace people, display name (lower-cased) -> user id. Cached for the process."""
        if self._users is None:
            found: dict[str, str] = {}
            cursor: str | None = None
            for _ in range(20):
                params = {"page_size": 100, **({"start_cursor": cursor} if cursor else {})}
                data = self._request("GET", "/v1/users", params=params)
                for row in data.get("results", []):
                    if isinstance(row, dict) and row.get("type") == "person" and row.get("name"):
                        found[str(row["name"]).strip().lower()] = str(row["id"])
                cursor = data.get("next_cursor") if data.get("has_more") else None
                if not cursor:
                    break
            self._users = found
        return self._users

    def set_team(self, team: list[Member]) -> None:
        """The owner's team list (team.py): its Notion ids are used before any workspace lookup."""
        self.team = list(team)

    def resolve_user(self, name: str) -> str | None:
        """A user id for a display name: a team member by name or email first, else an exact workspace
        match, else a single unambiguous partial match."""
        wanted = name.strip().lower()
        if not wanted:
            return None
        member = find_member(getattr(self, "team", []), wanted)
        if member is not None:
            return member.notion_id
        users = self.users()
        if wanted in users:
            return users[wanted]
        partial = [uid for full, uid in users.items() if wanted in full or full in wanted]
        return partial[0] if len(partial) == 1 else None

    # ---- tasks ---------------------------------------------------------------

    def create_task(
        self,
        title: str,
        details: str,
        assignee: str | None = None,
        priority: str = "P3",
        due: str | None = None,
    ) -> str:
        """Create one row on the board. Returns the page URL; self.last_warnings says what was skipped."""
        self.last_warnings = []
        schema = self.schema()
        title_prop = self.title_property()
        if title_prop is None:
            raise NotionError("the board has no title property; is database_id a database, not a page?")
        if not valid_priority(priority):
            raise NotionError("priority must be P0 to P6")
        if not valid_date(due):
            raise NotionError("due must be a date like 2026-09-30")
        properties: dict[str, Any] = {title_prop: {"title": [{"text": {"content": title.strip()[:200]}}]}}
        self._set_choice(properties, schema, self.cfg.status_property, self.cfg.status_value)
        self._set_choice(properties, schema, self.cfg.priority_property, priority.strip().upper())
        if assignee and assignee.strip():
            self._set_assignee(properties, schema, assignee.strip())
        if due and due.strip() and schema.get(self.cfg.due_property) == "date":
            properties[self.cfg.due_property] = {"date": {"start": due.strip()}}
        if self.cfg.default_project_id.strip() and schema.get(self.cfg.project_property) == "relation":
            properties[self.cfg.project_property] = {"relation": [{"id": self.cfg.default_project_id.strip()}]}
        body = {
            "parent": self._parent(),
            "properties": properties,
            "children": self._blocks(details),
        }
        data = self._request("POST", "/v1/pages", json=body)
        url = str(data.get("url") or "")
        self.logger.info("notion task created: %s %s", title.strip()[:60], url)
        return url

    def update_task(
        self,
        page_id: str,
        assignee: str | None = None,
        priority: str | None = None,
        due: str | None = None,
        details_append: str | None = None,
    ) -> None:
        """Change a task page the bot created: assignee / priority / Dead Line properties, and optionally append
        Markdown (rendered as blocks) to its body. Only the given fields change."""
        self.last_warnings = []
        if priority is not None and not valid_priority(priority):
            raise NotionError("priority must be P0 to P6")
        if due is not None and not valid_date(due):
            raise NotionError("due must be a date like 2026-09-30")
        schema = self.schema()
        properties: dict[str, Any] = {}
        if priority and priority.strip():
            self._set_choice(properties, schema, self.cfg.priority_property, priority.strip().upper())
        if assignee and assignee.strip():
            self._set_assignee(properties, schema, assignee.strip())
        if due and due.strip() and schema.get(self.cfg.due_property) == "date":
            properties[self.cfg.due_property] = {"date": {"start": due.strip()}}
        pid = page_id.strip()
        if properties:
            self._request("PATCH", f"/v1/pages/{pid}", json={"properties": properties})
        if details_append and details_append.strip():
            self._request("PATCH", f"/v1/blocks/{pid}/children", json={"children": self._blocks(details_append)})
        self.logger.info("notion task updated: %s (%s)", pid, ", ".join(k for k in ("assignee", "priority", "due", "details") if locals().get(k if k != "details" else "details_append")))

    def create_row(self, title: str, fields: dict[str, str]) -> str:
        """One row on the configured board from plain strings, typed by the board's schema: url / email / date /
        select / rich_text / number columns take the string as-is; unknown columns are skipped with a warning.
        Returns the page URL."""
        fields = _without_human_columns(fields)
        self.last_warnings = []
        schema = self.schema()
        title_prop = self.title_property()
        if title_prop is None:
            raise NotionError("the board has no title property; is database_id a data source, not a page?")
        props: dict[str, Any] = {title_prop: {"title": [{"text": {"content": title.strip()[:200]}}]}}
        props.update(self._typed_props(schema, fields))
        data = self._request("POST", "/v1/pages", json={"parent": self._parent(), "properties": props})
        return str(data.get("url") or "")

    @staticmethod
    def _plain_fields(page: dict[str, Any]) -> dict[str, str]:
        fields: dict[str, str] = {}
        for name, prop in (page.get("properties") or {}).items():
            kind = prop.get("type")
            if kind in ("url", "email", "number", "phone_number"):
                fields[name] = str(prop.get(kind) or "")
            elif kind in ("rich_text", "title"):
                fields[name] = "".join(str(t.get("plain_text", "")) for t in (prop.get(kind) or []))
            elif kind in ("select", "status"):
                fields[name] = str((prop.get(kind) or {}).get("name", ""))
            elif kind == "date":
                fields[name] = str(((prop.get("date") or {}).get("start")) or "")
            elif kind == "people":
                fields[name] = ", ".join(str(p.get("name", "")) for p in (prop.get("people") or []))
            elif kind == "multi_select":
                fields[name] = ", ".join(str(o.get("name", "")) for o in (prop.get("multi_select") or []))
        return fields

    def _query_best_first(self, filters: list[dict[str, Any]], limit: int, score_column: str) -> list[dict[str, Any]]:
        """Pages matching `filters`, the highest `score_column` first and unscored pages last (oldest first); plain
        oldest-first when the board has no such number column. Two queries, because Notion's own sort puts empty
        numbers wherever it likes and the second page of 100 would hide the scored rows."""
        limit = max(1, min(100, limit))
        by_age = [{"timestamp": "created_time", "direction": "ascending"}]
        scored = score_column.strip() and self.schema().get(score_column.strip()) == "number"
        if not scored:
            return list((self._request("POST", f"{self._container_path}/query",
                                       json={"filter": {"and": filters} if len(filters) > 1 else filters[0], "sorts": by_age,
                                             "page_size": limit})).get("results") or [])
        col = score_column.strip()
        pages = list((self._request("POST", f"{self._container_path}/query",
                                    json={"filter": {"and": filters + [{"property": col, "number": {"is_not_empty": True}}]},
                                          "sorts": [{"property": col, "direction": "descending"}] + by_age, "page_size": limit})).get("results") or [])
        if len(pages) < limit:
            pages += list((self._request("POST", f"{self._container_path}/query",
                                         json={"filter": {"and": filters + [{"property": col, "number": {"is_empty": True}}]}, "sorts": by_age,
                                               "page_size": limit - len(pages)})).get("results") or [])
        return pages

    def read_page(self, page_id: str) -> dict[str, Any] | None:
        """Read-back after a write (owner, 2026-09-26): {"archived": bool, "fields": {...}} for a page, None when Notion says
        it does not exist. Raises NotionError on other failures (the caller fails open)."""
        try:
            page = self._request("GET", f"/v1/pages/{page_id}")
        except NotionError as exc:
            if "not found" in str(exc):
                return None
            raise
        return {"archived": bool(page.get("archived")), "fields": self._plain_fields(page)}

    def page_text(self, page_id: str, limit_blocks: int = 400) -> str:
        """The plain text of a page's body (nested blocks included), for comparing two tasks' contents."""
        out: list[str] = []

        def walk(bid: str) -> None:
            cursor = None
            while len(out) < limit_blocks:
                data = self._request("GET", f"/v1/blocks/{bid}/children", params={"page_size": 100, **({"start_cursor": cursor} if cursor else {})})
                for b in data.get("results") or []:
                    t = b.get("type", "")
                    out.append("".join(x.get("plain_text", "") for x in (b.get(t) or {}).get("rich_text") or []))
                    if b.get("has_children"):
                        walk(b["id"])
                cursor = data.get("next_cursor")
                if not data.get("has_more"):
                    return

        walk(page_id)
        return "\n".join(out)

    def set_status(self, page_id: str, status: str) -> None:
        schema = self.schema()
        props: dict[str, Any] = {}
        self._set_choice(props, schema, self.cfg.status_property, status)
        if props:
            self._request("PATCH", f"/v1/pages/{page_id}", json={"properties": props})

    def read_block(self, block_id: str) -> dict[str, Any] | None:
        """{"archived": bool, "type": str} for a block (a package toggle), None when it does not exist."""
        try:
            block = self._request("GET", f"/v1/blocks/{block_id}")
        except NotionError as exc:
            if "not found" in str(exc):
                return None
            raise
        return {"archived": bool(block.get("archived")), "type": str(block.get("type", ""))}

    def find_row(self, title: str) -> dict[str, Any] | None:
        """The board row whose title equals `title` (case-insensitive on Notion's side): {"page_id", "url", "fields"}
        with url/email/rich_text columns as plain strings, or None. For update_lead on rows this bot did not list."""
        title_prop = self.title_property()
        if title_prop is None:
            return None
        data = self._request("POST", f"{self._container_path}/query",
                             json={"filter": {"property": title_prop, "title": {"equals": title.strip()[:200]}}, "page_size": 1})
        for page in data.get("results") or []:
            fields: dict[str, str] = {}
            for name, prop in (page.get("properties") or {}).items():
                kind = prop.get("type")
                if kind in ("url", "email", "number", "phone_number"):
                    fields[name] = str(prop.get(kind) or "")
                elif kind in ("rich_text", "title"):
                    fields[name] = "".join(str(t.get("plain_text", "")) for t in (prop.get(kind) or []))
                elif kind == "select":
                    fields[name] = str((prop.get("select") or {}).get("name", ""))
            return {"page_id": str(page.get("id", "")), "url": str(page.get("url", "")), "fields": fields}
        return None

    def replace_section(self, page_id: str, heading: str, text: str) -> None:
        """The page body's section under a heading_3 `heading`, replaced by `text` (one paragraph per line, so line
        breaks survive). An older copy of the section is removed first; the new one goes at the end of the page."""
        blocks = self._request("GET", f"/v1/blocks/{page_id}/children", params={"page_size": 100}).get("results") or []
        doomed, inside = [], False
        for b in blocks:
            if b.get("type", "").startswith("heading_"):
                title = "".join(t.get("plain_text", "") for t in (b.get(b["type"]) or {}).get("rich_text", []))
                inside = title.strip().lower() == heading.strip().lower()
                if inside:
                    doomed.append(b["id"])
                continue
            if inside:
                doomed.append(b["id"])
        for bid in doomed:
            self._request("DELETE", f"/v1/blocks/{bid}")
        children = [{"object": "block", "type": "heading_3", "heading_3": {"rich_text": [{"type": "text", "text": {"content": heading}}]}}]
        for line in (text or "").splitlines():
            children.append({"object": "block", "type": "paragraph",
                             "paragraph": {"rich_text": [{"type": "text", "text": {"content": line[:1900]}}] if line.strip() else []}})
        self._request("PATCH", f"/v1/blocks/{page_id}/children", json={"children": children[:100]})

    def rows_drafted(self, draft_column: str, status_column: str, limit: int,
                     not_reviewed: tuple[str, ...] = (), score_column: str = "") -> list[dict[str, Any]]:
        """Rows with a draft in `draft_column` that is not a "skip:" and whose `status_column` is empty or one of
        `not_reviewed` (e.g. "WhatsApp Verified": checked, but the email not reviewed yet), best `score_column` first."""
        kind = self.schema().get(status_column)
        filters: list[dict[str, Any]] = [{"property": draft_column, "rich_text": {"is_not_empty": True}}]
        if kind in ("select", "status"):
            either = [{"property": status_column, kind: {"is_empty": True}}]
            either += [{"property": status_column, kind: {"equals": v}} for v in not_reviewed]
            filters.append(either[0] if len(either) == 1 else {"or": either})
        title_prop = self.title_property()
        out = []
        for page in self._query_best_first(filters, limit, score_column):
            fields = self._plain_fields(page)
            if fields.get(draft_column, "").strip().lower().startswith("skip:"):
                continue
            out.append({"page_id": str(page.get("id", "")), "url": str(page.get("url", "")),
                        "title": fields.get(title_prop or "", ""), "fields": fields})
        return out

    def rows_waiting(self, empty_column: str, stage_property: str, stage_value: str, limit: int, score_column: str = "") -> list[dict[str, Any]]:
        """Rows whose `stage_property` is `stage_value` and whose `empty_column` is empty, best `score_column` first
        (oldest first among the unscored): [{"page_id", "url", "title", "fields"}]. The Outreach Writer's work list."""
        schema = self.schema()
        kind = schema.get(stage_property)
        filters: list[dict[str, Any]] = [{"property": empty_column, "rich_text": {"is_empty": True}}]
        if stage_value and kind in ("select", "status"):  # "" = any stage (owner, 2026-10-09: fill every empty cell)
            filters.append({"property": stage_property, kind: {"equals": stage_value}})
        title_prop = self.title_property()
        out = []
        for page in self._query_best_first(filters, limit, score_column):
            fields = self._plain_fields(page)
            out.append({"page_id": str(page.get("id", "")), "url": str(page.get("url", "")),
                        "title": fields.get(title_prop or "", ""), "fields": fields})
        return out

    def update_row(self, page_id: str, fields: dict[str, str]) -> None:
        """Change columns of a row the bot created (update_lead): the same schema typing as create_row; only the
        given, non-empty fields change."""
        fields = _without_human_columns(fields)
        self.last_warnings = []
        props = self._typed_props(self.schema(), fields)
        if not props:
            raise NotionError("nothing to update: no known column with a value")
        self._request("PATCH", f"/v1/pages/{page_id.strip()}", json={"properties": props})
        self.logger.info("notion row updated: %s (%s)", page_id.strip(), ", ".join(props))

    def _typed_props(self, schema: dict[str, str], fields: dict[str, str]) -> dict[str, Any]:
        props: dict[str, Any] = {}
        for name, value in fields.items():
            value = str(value or "").strip()
            kind = schema.get(name)
            if not value:
                continue
            if kind is None:
                self.last_warnings.append(f"the board has no '{name}' column; skipped")
            elif kind == "url":
                props[name] = {"url": value[:2000]}
            elif kind == "email":
                props[name] = {"email": value[:200]}
            elif kind == "date":
                props[name] = {"date": {"start": value[:10]}}
            elif kind in ("select", "status"):
                props[name] = {kind: {"name": value[:100]}}
            elif kind == "multi_select":
                props[name] = {"multi_select": [{"name": v.strip()[:100]} for v in value.split(",") if v.strip()]}
            elif kind == "number":
                try:
                    props[name] = {"number": float(value.replace(",", ""))}
                except ValueError:
                    self.last_warnings.append(f"'{name}' is a number column; skipped '{value[:30]}'")
            elif kind == "rich_text":
                props[name] = {"rich_text": [{"text": {"content": value[:_CHUNK]}}]}
            else:
                self.last_warnings.append(f"'{name}' is a {kind} column the bot cannot fill; skipped")
        return props

    def delete_block(self, block_id: str) -> None:
        """Remove a block (e.g. a package toggle being replaced by a fuller one)."""
        self._request("DELETE", f"/v1/blocks/{block_id.strip()}")

    def _set_assignee(self, props: dict[str, Any], schema: dict[str, str], name: str) -> None:
        kind = schema.get(self.cfg.assignee_property)
        if kind == "people":
            uid = self.resolve_user(name)
            if uid is None:
                self.last_warnings.append(f"no workspace user matches '{name}'; left unassigned")
                return
            props[self.cfg.assignee_property] = {"people": [{"id": uid}]}
        elif kind == "rich_text":
            props[self.cfg.assignee_property] = {"rich_text": [{"text": {"content": name[:200]}}]}
        elif kind in ("select", "status"):
            props[self.cfg.assignee_property] = {kind: {"name": name[:100]}}
        else:
            self.last_warnings.append(f"the board has no '{self.cfg.assignee_property}' property; left unassigned")

    # ---- boards --------------------------------------------------------------

    def create_board(
        self, parent_page_id: str, name: str, id_prefix: str, registry_id: str | None = None
    ) -> tuple[str, str, list[str]]:
        """A new task board under a page the integration can see, to the owner's canonical spec.

        Returns (database_id, url, follow-ups). Notion's API cannot create a `status` property, so
        the Status column is the one thing the owner adds by hand; that is the first follow-up.
        `unique_id` and the Projects relation are attempted and dropped with a follow-up if the API
        refuses them (the registry must be shared with the integration for the relation to work).
        """
        base: dict[str, Any] = {
            "Task": {"title": {}},
            "Priority": {"select": {"options": [{"name": p} for p in PRIORITY_OPTIONS]}},
            "Assign": {"people": {}},
            "Dead Line": {"date": {}},
            "Blocker": {"rich_text": {}},
            "Files & media": {"files": {}},
        }
        optional: list[tuple[str, dict[str, Any], str]] = [
            ("ID", {"unique_id": {"prefix": id_prefix.strip().upper()[:10]}}, "add an ID property (type ID, prefix " + id_prefix.upper() + ")"),
        ]
        if registry_id:
            optional.append(
                ("Projects", {"relation": {"database_id": registry_id, "single_property": {}}},
                 "add a Projects relation to the project registry (share the registry with the integration first)"),
            )
        followups = [
            "add a Status property (type Status) with options: " + ", ".join(STATUS_OPTIONS)
            + " (the API cannot create status properties)",
        ]
        props = dict(base)
        for key, spec, note in optional:
            props[key] = spec

        def body_for(properties: dict[str, Any]) -> dict[str, Any]:
            common = {
                "parent": {"type": "page_id", "page_id": parent_page_id},
                "title": [{"type": "text", "text": {"content": name.strip()[:100]}}],
            }
            if self.new_api:
                return {**common, "initial_data_source": {"properties": properties}}
            return {**common, "properties": properties}

        try:
            data = self._request("POST", "/v1/databases", json=body_for(props))
        except NotionError:
            # The API refused something optional (an ID column, or a relation to an unshared
            # registry). Create the board with the base properties only and say what was left out.
            data = self._request("POST", "/v1/databases", json=body_for(dict(base)))
            followups.extend(note for _, _, note in optional)
        board_id = str(data.get("id", ""))
        if self.new_api:
            sources = data.get("data_sources") or []
            if sources and isinstance(sources[0], dict):
                board_id = str(sources[0].get("id", board_id))  # tasks are created on the data source
        return board_id, str(data.get("url", "")), followups

    def columns_available(self, wanted: "tuple[str, ...]") -> tuple[bool, str]:
        """For `bot check` on a board this bot writes plain rows to (the Leads board): can we reach it under the
        configured api_version, and do the columns it fills exist? A 404 here is the failure that otherwise only
        shows up when a row is written and lost -- most often a data source id addressed under the old API
        version, which cannot see data sources at all (owner's Leads board, 2026-09-24)."""
        try:
            schema = self.schema()
        except NotionError as exc:
            hint = ""
            if "not found" in str(exc) and not self.new_api:
                hint = (f" -- api_version is {self.cfg.api_version}, which cannot address a data source id; "
                        "set api_version = \"2025-09-03\" if that id came from a multi-source database")
            return False, f"Notion board {self.cfg.database_id}: {exc}{hint}"
        title = self.title_property()
        if title is None:
            return False, f"Notion board {self.cfg.database_id} is reachable but has no title column"
        missing = [c for c in wanted if c not in schema]
        text = f"Notion board reachable ({len(schema)} columns, title '{title}', api {self.cfg.api_version})"
        if missing:
            return True, text + "; NOT on the board, so they are skipped: " + ", ".join(missing)
        return True, text + f"; all {len(wanted)} columns this bot fills exist"

    def available(self) -> tuple[bool, str]:
        """For `bot check`: can we reach the board, and which task fields will be filled."""
        try:
            schema = self.schema()
        except NotionError as exc:
            return False, f"Notion: {exc}"
        title = self.title_property()
        if title is None:
            return False, "Notion board reachable but it has no title property (is database_id a database?)"
        mapped = []
        for label, name in (
            ("status", self.cfg.status_property), ("assign", self.cfg.assignee_property),
            ("priority", self.cfg.priority_property), ("deadline", self.cfg.due_property),
        ):
            kind = schema.get(name)
            mapped.append(f"{label}={name}({kind})" if kind else f"{label}: no '{name}' property, skipped")
        people = [n for n, k in schema.items() if k == "people"]
        if len(people) > 1:
            mapped.append(f"WARNING {len(people)} people properties ({', '.join(people)}); the guide wants exactly one")
        if schema.get(self.cfg.project_property) == "relation":
            mapped.append(
                f"projects={self.cfg.project_property}(relation)"
                + (" -> default project set" if self.cfg.default_project_id.strip() else " but no default_project_id: tasks will not be linked")
            )
        return True, f"Notion board reachable; title property '{title}'; " + "; ".join(mapped)

    # ---- helpers -------------------------------------------------------------

    @staticmethod
    def _set_choice(props: dict[str, Any], schema: dict[str, str], name: str, value: str) -> None:
        kind = schema.get(name)
        if kind == "status":
            props[name] = {"status": {"name": value}}
        elif kind == "select":
            props[name] = {"select": {"name": value}}

    @staticmethod
    def _label(text: str) -> dict[str, Any]:
        """A bold one-line paragraph used as a section label inside a toggle."""
        return {"object": "block", "type": "paragraph",
                "paragraph": {"rich_text": [{"type": "text", "text": {"content": text[:_CHUNK]}, "annotations": {"bold": True}}]}}

    @staticmethod
    def _bullet(text: str, link: str | None = None) -> dict[str, Any]:
        rt: dict[str, Any] = {"type": "text", "text": {"content": text[:_CHUNK]}}
        if link:
            rt["text"]["link"] = {"url": link}
        return {"object": "block", "type": "bulleted_list_item", "bulleted_list_item": {"rich_text": [rt]}}

    def append_package_toggle(
        self, page_id: str, title: str, email: str, sources: list[str], company: list[tuple[str, str]], conclusion: str,
        *, audience: str = "", price: str = "", timeline: str = "", deliverables: list[str] | tuple[str, ...] = (), rationale: str = "",
        created: str = "", updated: str = "",
    ) -> str:
        """Append one collapsible toggle to a page in the owner's headed layout: a date line first ("Created
        2026-09-22 · Updated 2026-09-24", owner's ask 2026-09-24), then Who it is for / Price and timeline /
        What is included / Why this price / Ready-to-send email / Sources (the pages read, then the reference company's
        facts as "Label: value" bullets). Returns the page URL; self.last_toggle_id holds the new block's id."""
        def heading(t: str) -> dict[str, Any]:
            return {"object": "block", "type": "heading_3", "heading_3": {"rich_text": [{"type": "text", "text": {"content": t}}]}}

        kids: list[dict[str, Any]] = []
        if created.strip():
            stamp = f"Created {created.strip()[:10]}"
            if updated.strip() and updated.strip()[:10] != created.strip()[:10]:
                stamp += f" · Updated {updated.strip()[:10]}"
            kids.append({"object": "block", "type": "paragraph", "paragraph": {"rich_text": [
                {"type": "text", "text": {"content": stamp}, "annotations": {"italic": True}}]}})
        if audience.strip():
            kids += [heading("Who it is for"), *self._paragraphs(audience)]
        if price.strip() or timeline.strip():
            kids += [heading("Price and timeline"), *self._paragraphs(". ".join(x.strip().rstrip(".") for x in (price, timeline) if x.strip()) + ".")]
        items = [str(d).strip() for d in deliverables if str(d).strip()]
        if items:
            kids += [heading("What is included"), *[self._bullet(d) for d in items[:12]]]
        why = (rationale or conclusion).strip()
        if why:
            kids += [heading("Why this price"), *self._paragraphs(why)]
        kids.append(heading("Ready-to-send email"))
        for para in [p for p in email.strip().split("\n\n") if p.strip()] or [email.strip()]:
            kids += self._paragraphs(para)
        srcs = [x.strip() for x in (sources or []) if x.strip()]
        facts = [(k, str(v).strip()) for k, v in (company or []) if str(v).strip()]
        if srcs or facts:
            kids.append(heading("Sources"))
            kids += [self._bullet(x, link=x if x.startswith("http") else None) for x in srcs[:10]]
            kids += [self._bullet(f"{label}: {val}", link=(val if label.lower() == "website" and val.startswith("http") else None))
                     for label, val in facts]
        toggle = {"object": "block", "type": "toggle",
                  "toggle": {"rich_text": [{"type": "text", "text": {"content": title.strip()[:200] or "Package"}}], "children": kids[:100]}}
        data = self._request("PATCH", f"/v1/blocks/{page_id.strip()}/children", json={"children": [toggle]})
        results = data.get("results") or []
        self.last_toggle_id = str(results[0].get("id", "")) if results and isinstance(results[0], dict) else ""
        return f"https://www.notion.so/{page_id.replace('-', '')}"

    @classmethod
    def _blocks(cls, text: str) -> list[dict[str, Any]]:
        """A task's details as real Notion blocks: `#`/`##`/`###` lines become headings, `1.` lines a numbered
        list, `- ` lines bullets -- except under a "Done when" / acceptance heading (or written `- [ ]`), where
        each item is a to-do checkbox so the owner can tick them off. Other text becomes paragraphs, split on
        blank lines. Plain prose with no markup renders exactly as _paragraphs did."""
        blocks: list[dict[str, Any]] = []
        checklist = False
        para: list[str] = []

        def flush() -> None:
            if para:
                blocks.extend(cls._paragraphs(" ".join(para)))
                para.clear()

        def rich(t: str) -> list[dict[str, Any]]:
            return [{"type": "text", "text": {"content": t[:_CHUNK]}}]

        for raw in text.strip().splitlines():
            line = raw.strip()
            if not line:
                flush(); continue
            m = _HEADING.match(line)
            if m:
                flush()
                checklist = bool(_DONE_HEADING.search(m.group(2)))
                level = "heading_2" if len(m.group(1)) <= 2 else "heading_3"
                blocks.append({"object": "block", "type": level, level: {"rich_text": rich(m.group(2).strip())}})
                continue
            m = _TODO.match(line)
            if m or (checklist and _BULLET.match(line)):
                flush()
                item = (m.group(2) if m else _BULLET.match(line).group(1)).strip()
                blocks.append({"object": "block", "type": "to_do", "to_do": {"rich_text": rich(item), "checked": bool(m and m.group(1).strip())}})
                continue
            m = _NUMBERED.match(line)
            if m:
                flush()
                blocks.append({"object": "block", "type": "numbered_list_item", "numbered_list_item": {"rich_text": rich(m.group(1).strip())}})
                continue
            m = _BULLET.match(line)
            if m:
                flush()
                blocks.append({"object": "block", "type": "bulleted_list_item", "bulleted_list_item": {"rich_text": rich(m.group(1).strip())}})
                continue
            para.append(line)
        flush()
        return blocks[:100]  # Notion appends at most 100 children per request

    @staticmethod
    def _paragraphs(text: str) -> list[dict[str, Any]]:
        text = text.strip()
        if not text:
            return []
        chunks = [text[i : i + _CHUNK] for i in range(0, len(text), _CHUNK)][:20]
        return [
            {"object": "block", "type": "paragraph", "paragraph": {"rich_text": [{"text": {"content": chunk}}]}}
            for chunk in chunks
        ]

    def _request(self, method: str, path: str, json: dict[str, Any] | None = None, params: dict[str, Any] | None = None) -> dict[str, Any]:
        try:
            resp = self.client.request(method, path, json=json, params=params)
        except httpx.HTTPError as exc:
            raise NotionError(f"Notion unreachable: {type(exc).__name__}") from exc
        if resp.status_code in (401, 403):
            detail = ""
            try:
                body = resp.json()
                detail = f"{body.get('code', '')} {str(body.get('message', ''))[:200]}".strip()
            except ValueError:
                pass
            raise NotionError(f"Notion refused ({resp.status_code}) -- the integration token or the page's access: {detail or 'no detail'}")
        if resp.status_code == 404:
            raise NotionError("not found: check the id and share the page or database with the integration")
        if resp.status_code == 429:
            raise NotionError("Notion is rate-limiting requests (429); try again later")
        if resp.status_code >= 400:
            message = ""
            try:
                message = str(resp.json().get("message", ""))[:300]
            except ValueError:
                pass
            raise NotionError(f"Notion answered {resp.status_code}: {message or resp.text[:200]}")
        try:
            data = resp.json()
        except ValueError as exc:
            raise NotionError("Notion returned an unreadable reply") from exc
        return data if isinstance(data, dict) else {}


class FakeNotion:
    """Offline stand-in: remembers what would have been created and hands back fake URLs."""

    def __init__(self) -> None:
        self.tasks: list[dict[str, Any]] = []
        self.toggles: list[dict[str, Any]] = []
        self.last_warnings: list[str] = []
        self.updates: list[dict[str, Any]] = []
        self.deleted: list[str] = []
        self.rows: list[dict[str, Any]] = []
        self.last_toggle_id = ""
        self.gone: set[str] = set()  # ids a test declares missing, so read-back fails

    def append_package_toggle(self, page_id: str, title: str, email: str, sources, company, conclusion: str, **fields) -> str:
        self.toggles.append({"page_id": page_id, "title": title, "email": email, "sources": list(sources or []),
                             "company": list(company or []), "conclusion": conclusion, **{k: v for k, v in fields.items() if v}})
        self.last_toggle_id = f"toggle-{len(self.toggles)}"
        return f"https://notion.fake/page-{page_id}"

    def create_row(self, title: str, fields: dict[str, str]) -> str:
        fields = _without_human_columns(fields)
        self.rows.append({"title": title, **{k: str(v) for k, v in fields.items() if str(v or "").strip()}})
        return f"https://notion.fake/{len(self.rows):032x}/row-{len(self.rows)}"

    def replace_section(self, page_id: str, heading: str, text: str) -> None:
        self.rows[int(page_id, 16) - 1].setdefault("_sections", {})[heading] = text

    @staticmethod
    def _best_first(out: list[dict[str, Any]], score_column: str) -> list[dict[str, Any]]:
        def score(r: dict[str, Any]) -> float:
            try:
                return -float(str(r["fields"].get(score_column, "") or "").strip())
            except ValueError:
                return 1.0  # unscored rows last, in their own order
        return sorted(out, key=score) if score_column else out

    def rows_drafted(self, draft_column: str, status_column: str, limit: int,
                     not_reviewed: tuple[str, ...] = (), score_column: str = "") -> list[dict[str, Any]]:
        out = []
        for i, row in enumerate(self.rows):
            d = str(row.get(draft_column, "")).strip()
            st = str(row.get(status_column, "")).strip()
            if d and not d.lower().startswith("skip:") and (not st or st in not_reviewed):
                out.append({"page_id": f"{i + 1:032x}", "url": f"https://notion.fake/{i + 1:032x}/row-{i + 1}",
                            "title": str(row.get("title", "")), "fields": {k: v for k, v in row.items() if k != "title"}})
        return self._best_first(out, score_column)[:limit]

    def rows_waiting(self, empty_column: str, stage_property: str, stage_value: str, limit: int, score_column: str = "") -> list[dict[str, Any]]:
        out = []
        for i, row in enumerate(self.rows):
            if (not stage_value or str(row.get(stage_property, stage_value)) == stage_value) and not str(row.get(empty_column, "")).strip():
                out.append({"page_id": f"{i + 1:032x}", "url": f"https://notion.fake/{i + 1:032x}/row-{i + 1}",
                            "title": str(row.get("title", "")), "fields": {k: v for k, v in row.items() if k != "title"}})
        return self._best_first(out, score_column)[:limit]

    def find_row(self, title: str) -> dict[str, Any] | None:
        for i, row in enumerate(self.rows):
            if str(row.get("title", "")).strip().lower() == title.strip().lower():
                return {"page_id": f"{i + 1:032x}", "url": f"https://notion.fake/{i + 1:032x}/row-{i + 1}",
                        "fields": {k: v for k, v in row.items() if k != "title"}}
        return None

    def update_row(self, page_id: str, fields: dict[str, str]) -> None:
        fields = _without_human_columns(fields)
        changes = {k: str(v) for k, v in fields.items() if str(v or "").strip()}
        self.updates.append({"page_id": page_id, **changes})
        # Mirror onto the stored row (create_row's URL carries the row index as a 32-hex id).
        try:
            index = int(page_id.replace("-", ""), 16) - 1
            if 0 <= index < len(self.rows):
                self.rows[index].update(changes)
        except ValueError:
            pass

    def update_task(self, page_id: str, assignee=None, priority=None, due=None, details_append=None) -> None:
        if priority is not None and not valid_priority(priority):
            raise NotionError("priority must be P0 to P6")
        if due is not None and not valid_date(due):
            raise NotionError("due must be a date like 2026-09-30")
        self.updates.append({"page_id": page_id, "assignee": assignee, "priority": priority, "due": due, "details_append": details_append})

    def delete_block(self, block_id: str) -> None:
        self.deleted.append(block_id)

    def _task_index(self, page_id: str) -> int:
        try:
            return int(page_id.replace("-", ""), 16) - 1
        except ValueError:
            return -1

    def page_text(self, page_id: str, limit_blocks: int = 400) -> str:
        i = self._task_index(page_id)
        if not 0 <= i < len(self.tasks):
            return ""
        extra = "\n".join(str(u.get("details_append") or "") for u in self.updates if u.get("page_id") == page_id)
        return str(self.tasks[i].get("details", "")) + "\n" + extra

    def set_status(self, page_id: str, status: str) -> None:
        i = self._task_index(page_id)
        if 0 <= i < len(self.tasks):
            self.tasks[i]["Status"] = status

    def create_task(self, title: str, details: str, assignee: str | None = None, priority: str = "P3", due: str | None = None) -> str:
        if not valid_priority(priority):
            raise NotionError("priority must be P0 to P6")
        if not valid_date(due):
            raise NotionError("due must be a date like 2026-09-30")
        self.tasks.append({"title": title, "details": details, "assignee": assignee, "priority": priority, "due": due, "Status": "Not started"})
        return f"https://notion.fake/{len(self.tasks):032x}/task-{len(self.tasks)}"

    def read_page(self, page_id: str) -> dict[str, Any] | None:
        """Rows and tasks are addressed by their 32-hex index id (see create_row / create_task)."""
        if page_id.replace("-", "") in {g.replace("-", "") for g in self.gone}:
            return None
        try:
            index = int(page_id.replace("-", ""), 16) - 1
        except ValueError:
            return None
        for store in (self.rows, self.tasks):
            if 0 <= index < len(store):
                return {"archived": False, "fields": {k: str(v) for k, v in store[index].items() if k != "title" and v is not None}}
        return None

    def read_block(self, block_id: str) -> dict[str, Any] | None:
        if block_id in self.gone or block_id in self.deleted:
            return None
        return {"archived": False, "type": "toggle"} if block_id.startswith("toggle-") else None

    def available(self) -> tuple[bool, str]:
        return True, "fake Notion"
