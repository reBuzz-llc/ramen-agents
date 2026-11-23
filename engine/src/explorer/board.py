"""The team's board, as the engine sees it: the errors, the shared helpers and an offline stand-in.

The board itself is the starter dashboard's local board (127.0.0.1:3000) or the hosted portal at the same address,
spoken to by portal_store.py: leads, tasks and package drafts. There is no Notion client
any more.
"""
from __future__ import annotations

import datetime as dt
import re
from typing import Any

PRIORITY_PATTERN = re.compile(r"^P[0-6]$")
STATUS_OPTIONS = ["Not started", "In progress", "Blocker", "In Review", "QA", "Done", "Archived"]
# The columns a lead row fills (controller._execute_lead); tests/test_leads.py asserts the two stay in step.
# Columns only a person writes (owner, 2026-10-06): what came of the outreach. No bot write ever carries them.
HUMAN_ONLY_COLUMNS = frozenset({"result", "result date", "reviewed by"})  # Reviewed by: the owner's people column (2026-10-10)


def _without_human_columns(fields: dict[str, str]) -> dict[str, str]:
    return {k: v for k, v in (fields or {}).items() if str(k).strip().lower() not in HUMAN_ONLY_COLUMNS}


LEAD_COLUMNS = ("Website", "Business email", "Location", "Industry", "Company size", "Pain point",
                "How can I help", "Evidence", "Source pages")  # 2026-10-10: the owner removed Stage and Found on (Created time covers it); no "Found by": the owner emptied it (2026-09-25)
PRIORITY_OPTIONS = ["P0", "P1", "P2", "P3", "P4", "P5", "P6"]


class BoardError(RuntimeError):
    """A board call that failed or was refused, in plain words the model reads as the action's failure text."""


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
    """The row or task id at the end of a board URL (<board>/tasks/<32 hex>), as the dashed uuid the API takes."""
    m = _PAGE_ID.search((url or "").split("#")[0])
    if not m:
        return None
    h = m.group(1).lower()
    return f"{h[:8]}-{h[8:12]}-{h[12:16]}-{h[16:20]}-{h[20:]}"


class FakeBoard:
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
        return f"https://board.fake/page-{page_id}"

    def create_row(self, title: str, fields: dict[str, str]) -> str:
        fields = _without_human_columns(fields)
        self.rows.append({"title": title, **{k: str(v) for k, v in fields.items() if str(v or "").strip()}})
        return f"https://board.fake/{len(self.rows):032x}/row-{len(self.rows)}"

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
                out.append({"page_id": f"{i + 1:032x}", "url": f"https://board.fake/{i + 1:032x}/row-{i + 1}",
                            "title": str(row.get("title", "")), "fields": {k: v for k, v in row.items() if k != "title"}})
        return self._best_first(out, score_column)[:limit]

    def rows_waiting(self, empty_column: str, stage_property: str, stage_value: str, limit: int, score_column: str = "") -> list[dict[str, Any]]:
        out = []
        for i, row in enumerate(self.rows):
            if (not stage_value or str(row.get(stage_property, stage_value)) == stage_value) and not str(row.get(empty_column, "")).strip():
                out.append({"page_id": f"{i + 1:032x}", "url": f"https://board.fake/{i + 1:032x}/row-{i + 1}",
                            "title": str(row.get("title", "")), "fields": {k: v for k, v in row.items() if k != "title"}})
        return self._best_first(out, score_column)[:limit]

    def find_row(self, title: str) -> dict[str, Any] | None:
        for i, row in enumerate(self.rows):
            if str(row.get("title", "")).strip().lower() == title.strip().lower():
                return {"page_id": f"{i + 1:032x}", "url": f"https://board.fake/{i + 1:032x}/row-{i + 1}",
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
            raise BoardError("priority must be P0 to P6")
        if due is not None and not valid_date(due):
            raise BoardError("due must be a date like 2026-09-30")
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
            raise BoardError("priority must be P0 to P6")
        if not valid_date(due):
            raise BoardError("due must be a date like 2026-09-30")
        self.tasks.append({"title": title, "details": details, "assignee": assignee, "priority": priority, "due": due, "Status": "Not started"})
        return f"https://board.fake/{len(self.tasks):032x}/task-{len(self.tasks)}"

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
        return True, "fake board"
