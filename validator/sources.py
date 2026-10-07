"""Read-only readers for everything the Validator checks: the Notion task board, the Notion packages
page, the package files the Package Designer hands to The CEO, the Scout's provider report, the CEO's
own record of the tasks it created, and the owner's team list. Nothing in this module writes anywhere.

Runs with the bot code's venv (~/Projects/bot/.venv) for the Notion client; the file readers need
only the standard library.
"""
from __future__ import annotations

import datetime as dt
import json
import re
import sqlite3
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

BOTS = Path.home() / "bots"
_HEX32 = re.compile(r"([0-9a-f]{32})$")
_PAUSE = 0.34  # Notion allows ~3 requests a second


# ---- small helpers -----------------------------------------------------------

def page_id_of(text: str) -> str:
    """A Notion page/block id without dashes, from an id or a notion.so / app.notion.com URL."""
    s = text.strip().split("?")[0].rstrip("/").replace("-", "").lower()
    m = _HEX32.search(s)
    return m.group(1) if m else ""


def plain(rich: Any) -> str:
    return "".join(r.get("plain_text", "") for r in (rich or []) if isinstance(r, dict)).strip()


def domain(url: str) -> str:
    try:
        host = urlparse(url.strip()).netloc.lower()
    except ValueError:
        return ""
    return host.split("@")[-1].split(":")[0].removeprefix("www.")


_SEARCH_HOSTS = {
    "hn.algolia.com", "duckduckgo.com", "startpage.com", "mojeek.com", "search.brave.com",
    "bing.com", "127.0.0.1", "localhost", "searx.be", "search.marginalia.nu",
}


def is_search_results_url(url: str) -> bool:
    """A results page is where a bot looked, not what it read."""
    try:
        u = urlparse(url.strip())
    except ValueError:
        return False
    host, path, query = domain(url), u.path.rstrip("/"), u.query.lower()
    # The engine's own pseudo-URLs for a search it ran ("duckduckgo-mcp://search?q=", "searxng://search?q=").
    if u.scheme and u.scheme not in ("http", "https") and ("q=" in query or "search" in f"{u.netloc}{path}"):
        return True
    if host in _SEARCH_HOSTS:
        return True
    if host == "google.com" or host.startswith("google.") or host.endswith(".google.com"):
        return "search" in path or "q=" in query
    if host == "news.ycombinator.com":
        return path in ("", "/news", "/front", "/newest", "/best", "/ask", "/show")
    return "/search" in path and ("q=" in query or "query=" in query)


def norm_title(text: str) -> str:
    return " ".join(re.sub(r"[^a-z0-9 ]+", " ", text.lower()).split())


# ---- artefacts ------------------------------------------------------------------

@dataclass
class TaskRow:
    page_id: str
    url: str
    title: str
    status: str
    priority: str
    assignee_ids: list[str]
    assignee_names: list[str]
    due: str | None
    project_ids: list[str]
    created: str          # ISO, UTC
    edited: str
    body: str             # the page's text blocks, joined
    uid: str              # "CEO-56" or ""
    blocker: str = ""
    blocks: list[tuple[str, str, bool]] = field(default_factory=list)   # (type, text, bold) per top-level block

    @property
    def label(self) -> str:
        head = f"{self.uid} " if self.uid else ""
        return f"{head}\"{self.title[:70]}\"" if self.title else f"{head}(untitled row)"


@dataclass
class LeadRow:
    page_id: str
    url: str
    business: str
    website: str
    email: str
    location: str
    industry: str
    company_size: str
    pain_point: str
    how_we_help: str
    evidence: str
    stage: str
    found_on: str | None
    source_pages: str
    found_by: str
    created: str
    edited: str
    founded_by: str = ""     # the business's founder, the name outreach opens with (owner, 2026-09-24)
    email_check: str = ""    # the engine's deliverability verdict, e.g. "deliverable, checked 2026-10-02" (2026-10-02)
    result: str = ""         # the team's outreach result (set by a person; bots never write it): Emailed, Replied ...
    result_date: str = ""    # when the current Result was set
    draft_email: str = ""    # the Outreach Writer's first email for the team to send (owner, 2026-10-07)
    whatsapp: str = ""       # https://wa.me/<digits>, only from a link on the business's own site (owner, 2026-10-07)
    status: str = ""         # the team's Status: "Ready to Send Email", "WhatsApp Verified" (checked by hand) ...

    @property
    def label(self) -> str:
        return f"lead \"{self.business[:60]}\"" if self.business else "lead (untitled row)"


@dataclass
class PackageToggle:
    block_id: str
    title: str
    email: str
    sources: list[str]
    company: dict[str, str]   # label -> value, labels as written ("Company", "Website", ...)
    conclusion: str
    page_url: str
    extra: dict[str, str] = field(default_factory=dict)   # other headed sections (who it is for, price...)

    @property
    def label(self) -> str:
        return f"package \"{self.title[:70]}\""


@dataclass
class PackageFile:
    path: Path
    name: str
    price: str
    audience: str
    deliverables: list[str]
    rationale: str
    sources: list[str]
    company: dict[str, str]

    @property
    def key(self) -> str:
        return self.path.name

    @property
    def label(self) -> str:
        return f"package file {self.path.name}"


@dataclass
class ProviderRecord:
    name: str
    found: str
    endpoint: str
    free_terms: str
    models: str
    why: str
    sources: list[str] = field(default_factory=list)
    website: str = ""        # a tool (search, verification, MCP server) has a Website and no Endpoint

    @property
    def is_tool(self) -> bool:
        return not self.endpoint and bool(self.website)

    @property
    def key(self) -> str:
        return self.name.strip().lower()

    @property
    def label(self) -> str:
        return f"provider \"{self.name}\""


# ---- Notion ---------------------------------------------------------------------

class NotionReader:
    """Reads the task data source and the packages page through the bot code's NotionClient."""

    def __init__(self, api_version: str, api_key: str | None = None):
        from explorer.config import NotionConfig  # the bot code, on the venv's path
        from explorer.model import load_api_key
        from explorer.notion import NotionClient

        key = api_key or load_api_key("NOTION_API_KEY", NotionConfig().api_key_file)
        if not key:
            raise RuntimeError("no Notion token: expected ~/bots/common-data/keys/notion.key")
        cfg = NotionConfig(enabled=True, api_version=api_version)
        self.client = NotionClient(cfg, key)
        self.requests = 0

    def _req(self, method: str, path: str, **kw: Any) -> dict[str, Any]:
        if self.requests:
            time.sleep(_PAUSE)
        self.requests += 1
        return self.client._request(method, path, **kw)

    def _children(self, block_id: str) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        cursor: str | None = None
        for _ in range(20):
            params = {"page_size": 100, **({"start_cursor": cursor} if cursor else {})}
            data = self._req("GET", f"/v1/blocks/{block_id}/children", params=params)
            out += [b for b in data.get("results", []) if isinstance(b, dict)]
            cursor = data.get("next_cursor") if data.get("has_more") else None
            if not cursor:
                break
        return out

    @staticmethod
    def _block_text(b: dict[str, Any]) -> str:
        body = b.get(b.get("type", ""), {})
        return plain(body.get("rich_text", [])) if isinstance(body, dict) else ""

    def body_blocks(self, page_id: str) -> list[tuple[str, str, bool]]:
        """(type, text, bold) for each top-level block with text; to_do/heading types kept for checks."""
        out: list[tuple[str, str, bool]] = []
        for b in self._children(page_id):
            text = self._block_text(b)
            if not text:
                continue
            rich = (b.get(b.get("type", ""), {}) or {}).get("rich_text") or []
            bold = bool(rich) and all((r.get("annotations") or {}).get("bold") for r in rich if isinstance(r, dict))
            out.append((str(b.get("type", "")), text, bold))
        return out

    def body_text(self, page_id: str) -> str:
        return "\n".join(t for _, t, _ in self.body_blocks(page_id))

    def tasks(self, data_source_id: str, edited_after: str | None = None) -> list[TaskRow]:
        """Every row (or only rows edited on/after `edited_after`, ISO UTC), oldest first, with body text."""
        body: dict[str, Any] = {"page_size": 100, "sorts": [{"timestamp": "created_time", "direction": "ascending"}]}
        if edited_after:
            body["filter"] = {"timestamp": "last_edited_time", "last_edited_time": {"on_or_after": edited_after}}
        rows: list[TaskRow] = []
        cursor: str | None = None
        for _ in range(50):
            if cursor:
                body["start_cursor"] = cursor
            data = self._req("POST", f"/v1/data_sources/{data_source_id}/query", json=body)
            for r in data.get("results", []):
                if isinstance(r, dict) and r.get("object") == "page":
                    rows.append(self._task(r))
            cursor = data.get("next_cursor") if data.get("has_more") else None
            if not cursor:
                break
        return rows

    def _task(self, r: dict[str, Any]) -> TaskRow:
        props: dict[str, Any] = r.get("properties") or {}

        def of_type(kind: str, name: str) -> dict[str, Any]:
            p = props.get(name)
            if isinstance(p, dict) and p.get("type") == kind:
                return p
            return next((v for v in props.values() if isinstance(v, dict) and v.get("type") == kind), {})

        title = plain(of_type("title", "Task").get("title"))
        status = str((of_type("status", "Status").get("status") or {}).get("name") or "")
        priority = str((of_type("select", "Priority").get("select") or {}).get("name") or "")
        people = of_type("people", "Assign").get("people") or []
        due = (of_type("date", "Dead Line").get("date") or {}).get("start")
        projects = of_type("relation", "Projects").get("relation") or []
        uid = of_type("unique_id", "ID").get("unique_id") or {}
        uid_text = f"{uid.get('prefix')}-{uid.get('number')}" if uid.get("number") is not None else ""
        blocker = plain((props.get("Blocker") or {}).get("rich_text"))
        pid = page_id_of(str(r.get("id", "")))
        blocks = self.body_blocks(pid)
        return TaskRow(
            page_id=pid,
            url=str(r.get("url") or ""),
            title=title,
            status=status,
            priority=priority,
            assignee_ids=[page_id_of(str(p.get("id", ""))) for p in people if isinstance(p, dict)],
            assignee_names=[str(p.get("name") or "") for p in people if isinstance(p, dict)],
            due=str(due) if due else None,
            project_ids=[page_id_of(str(p.get("id", ""))) for p in projects if isinstance(p, dict)],
            created=str(r.get("created_time") or ""),
            edited=str(r.get("last_edited_time") or ""),
            body="\n".join(t for _, t, _ in blocks),
            uid=uid_text,
            blocker=blocker,
            blocks=blocks,
        )

    def select_options(self, data_source_id: str, prop: str) -> list[str]:
        data = self._req("GET", f"/v1/data_sources/{data_source_id}")
        spec = (data.get("properties") or {}).get(prop) or {}
        opts = (spec.get(spec.get("type", "")) or {}).get("options") or []
        return [str(o.get("name", "")) for o in opts if isinstance(o, dict) and o.get("name")]

    def leads(self, data_source_id: str, edited_after: str | None = None) -> list[LeadRow]:
        """Rows of the Leads board (all, or edited on/after `edited_after`), oldest first."""
        body: dict[str, Any] = {"page_size": 100, "sorts": [{"timestamp": "created_time", "direction": "ascending"}]}
        if edited_after:
            body["filter"] = {"timestamp": "last_edited_time", "last_edited_time": {"on_or_after": edited_after}}
        rows: list[LeadRow] = []
        cursor: str | None = None
        for _ in range(50):
            if cursor:
                body["start_cursor"] = cursor
            data = self._req("POST", f"/v1/data_sources/{data_source_id}/query", json=body)
            for r in data.get("results", []):
                if isinstance(r, dict) and r.get("object") == "page":
                    rows.append(self._lead(r))
            cursor = data.get("next_cursor") if data.get("has_more") else None
            if not cursor:
                break
        return rows

    @staticmethod
    def _lead(r: dict[str, Any]) -> LeadRow:
        props: dict[str, Any] = r.get("properties") or {}

        def val(name: str) -> str:
            p = props.get(name) or {}
            kind = p.get("type", "")
            v = p.get(kind)
            if kind in ("title", "rich_text"):
                return plain(v)
            if kind in ("url", "email", "phone_number"):
                return str(v or "")
            if kind in ("select", "status"):
                return str((v or {}).get("name") or "")
            if kind == "date":
                return str((v or {}).get("start") or "")
            return ""

        return LeadRow(
            page_id=page_id_of(str(r.get("id", ""))), url=str(r.get("url") or ""), business=val("Business"),
            website=val("Website"), email=val("Business email"), location=val("Location"), industry=val("Industry"),
            company_size=val("Company size"), pain_point=val("Pain point"), how_we_help=val("How we can help"),
            evidence=val("Evidence"), stage=val("Stage"), found_on=val("Found on") or None,
            source_pages=val("Source pages"), found_by=val("Found by"), founded_by=val("Founded by"), email_check=val("Email check"),
            result=val("Result"), result_date=val("Result date"), draft_email=val("Draft email"), whatsapp=val("Whatsapp"), status=val("Status"),
            created=str(r.get("created_time") or ""), edited=str(r.get("last_edited_time") or ""),
        )

    def package_toggles(self, page_id: str) -> list[PackageToggle]:
        """Each toggle on the packages page, split into sections (see parse_toggle_blocks)."""
        page_url = f"https://www.notion.so/{page_id.replace('-', '')}"
        out: list[PackageToggle] = []
        for tg in self._children(page_id):
            if tg.get("type") != "toggle":
                continue
            title = plain(tg.get("toggle", {}).get("rich_text"))
            out.append(parse_toggle_blocks(page_id_of(str(tg["id"])), title, self._children(str(tg["id"])), page_url))
        return out


# Section labels seen on the packages page: the CEO's publish_package writes bold paragraphs
# ("Email pitch" / "Sources & company" / "Conclusion"); the rebuilt page uses headings
# ("Who it is for" / "Price and timeline" / "What is included" / "Why this price" /
# "Ready-to-send email" / "Sources"). Both are read; unknown headings go to `extra`.
_DATE_LINE = re.compile(r"^(Created|Published|Updated)\b.*\d{4}-\d{2}-\d{2}", re.I)
_SECTION_OF = {
    "email pitch": "email", "ready-to-send email": "email", "email": "email", "pitch": "email",
    "sources & company": "sources", "sources and company": "sources", "sources": "sources",
    "source company": "sources", "company": "sources", "sources read": "sources",
    "conclusion": "conclusion", "why this price": "conclusion", "why this package and price": "conclusion",
    "rationale": "conclusion",
}


def parse_toggle_blocks(block_id: str, title: str, blocks: list[dict[str, Any]], page_url: str) -> PackageToggle:
    section = "email"          # text before any label is the pitch itself
    parts: dict[str, list[str]] = {"email": [], "conclusion": []}
    sources: list[str] = []
    company: dict[str, str] = {}
    extra: dict[str, str] = {}
    label = ""
    for b in blocks:
        kind = b.get("type", "")
        body = b.get(kind, {}) if isinstance(b.get(kind), dict) else {}
        rich = body.get("rich_text") or []
        text = plain(rich)
        if not text:
            continue
        bold = bool(rich) and all((r.get("annotations") or {}).get("bold") for r in rich if isinstance(r, dict))
        is_label = kind.startswith("heading") or (bold and kind == "paragraph" and len(text) <= 40)
        if is_label:
            label = text.strip().rstrip(":")
            section = _SECTION_OF.get(label.lower(), "extra")
            continue
        if section == "email" and not parts["email"] and not label and _DATE_LINE.match(text):
            extra["Created"] = text          # the toggle's date line sits above every heading
            continue
        if section == "sources":
            if text.startswith(("http://", "https://")):
                sources.append(text)
            elif ":" in text:
                k, v = text.split(":", 1)
                company[k.strip()] = v.strip()
        elif section == "extra":
            extra[label] = (extra.get(label, "") + "\n" + text).strip()
        else:
            parts[section].append(text)
    return PackageToggle(
        block_id=block_id, title=title, email="\n\n".join(parts["email"]), sources=sources, company=company,
        conclusion="\n\n".join(parts["conclusion"]), page_url=page_url, extra=extra,
    )


# ---- files -------------------------------------------------------------------------

def package_files(folder: Path) -> list[PackageFile]:
    """The Markdown packages handoff.py writes into the-ceo/raw/packages/."""
    out: list[PackageFile] = []
    for path in sorted(folder.glob("*.md")):
        try:
            text = path.read_text(encoding="utf-8")
        except OSError:
            continue
        if not text.lstrip().startswith("# Package:"):
            continue
        name = text.splitlines()[0].split(":", 1)[1].strip()
        fields = dict(re.findall(r"^- \*\*([A-Za-z ]+):\*\*\s*(.*)$", text, re.M))
        sections = _sections(text)
        bullets = lambda s: [ln[2:].strip() for ln in s.splitlines() if ln.startswith("- ")]  # noqa: E731
        deliverables = [d for d in bullets(sections.get("what the client gets", "")) if d and d != "(none listed)"]
        sources = [s for s in bullets(sections.get("sources read", "")) if s and s != "(none)"]
        company = {}
        for ln in sections.get("source company", "").splitlines():
            m = re.match(r"^- \*\*([A-Za-z ]+):\*\*\s*(.*)$", ln)
            if m:
                company[m.group(1)] = m.group(2).strip()
        out.append(PackageFile(
            path=path, name=name, price=fields.get("Price", ""), audience=fields.get("For", ""),
            deliverables=deliverables, rationale=sections.get("why this package and price", "").strip(),
            sources=sources, company=company,
        ))
    return out


def _sections(text: str) -> dict[str, str]:
    out: dict[str, str] = {}
    current = ""
    for ln in text.splitlines():
        if ln.startswith("## "):
            current = ln[3:].strip().lower()
            out[current] = ""
        elif current:
            out[current] += ln + "\n"
    return out


def providers(path: Path) -> list[ProviderRecord]:
    """The Scout's providers-found.md: one `## Name` section per provider."""
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return []
    # A record carrying a "**Declined...**" line is the owner's decision, not an open find: skipped, so any flag on it
    # resolves. The "# Declined" heading is NOT a cut-off: the Scout appends new finds at the end of the file, below it.
    out: list[ProviderRecord] = []
    for name, body in re.findall(r"^## (.+?)\n(.*?)(?=^## |^# |\Z)", text, re.M | re.S):
        if re.search(r"^\*\*Declined\b", body, re.M):
            continue
        fields = dict(re.findall(r"^- \*\*([A-Za-z ]+):\*\*\s*(.*)$", body, re.M))
        found = re.search(r"Found (\d{4}-\d{2}-\d{2})", body)
        srcs: list[str] = []
        in_sources = False
        why: list[str] = []
        for ln in body.splitlines():
            if ln.strip().lower().startswith("sources:"):
                in_sources = True
                continue
            if in_sources:
                if ln.startswith("- "):
                    srcs.append(ln[2:].strip())
                continue
            if ln.strip() and not ln.startswith(("- ", "Found ")):
                why.append(ln.strip())
        out.append(ProviderRecord(
            name=name.strip(), found=found.group(1) if found else "", endpoint=fields.get("Endpoint", ""),
            free_terms=fields.get("Free terms", ""), models=fields.get("Models", ""), why=" ".join(why), sources=srcs,
            website=fields.get("Website", ""),
        ))
    return out


def bot_task_page_ids(db_path: Path) -> set[str]:
    """Page ids of the Notion tasks a bot itself created (its tasks table), so a row it did not create
    is reported to the owner instead of blamed on the bot."""
    if not db_path.exists():
        return set()
    try:
        con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
        try:
            rows = con.execute("SELECT url FROM tasks WHERE url IS NOT NULL").fetchall()
        finally:
            con.close()
    except sqlite3.Error:
        return set()
    return {page_id_of(str(r[0])) for r in rows if r and r[0]}


def team_members(path: Path) -> dict[str, str]:
    """Notion user id (no dashes) -> display name from the owner's team list."""
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    out: dict[str, str] = {}
    for m in data.get("members", []) if isinstance(data, dict) else []:
        if isinstance(m, dict) and m.get("notionId"):
            out[page_id_of(str(m["notionId"]))] = str(m.get("name") or m.get("email") or "")
    return out


def utc_now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


@dataclass
class AgentEntry:
    name: str
    website: str
    what: str
    sources: list[str]

    @property
    def key(self) -> str:
        return "agent:" + self.name.strip().lower()


def agent_entries(path: Path) -> list[AgentEntry]:
    """The Onion Reader's AI-agents list: one '## Name' section per agent."""
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return []
    out = []
    for chunk in re.split(r"^## ", text, flags=re.M)[1:]:
        name = chunk.splitlines()[0].strip()
        web = re.search(r"\*\*Website:\*\*\s*(\S*)", chunk)
        what = re.search(r"\*\*What it does:\*\*\s*(.*)", chunk)
        src = chunk.split("Sources:", 1)[1] if "Sources:" in chunk else ""
        out.append(AgentEntry(name, web.group(1) if web else "", what.group(1).strip() if what else "",
                              re.findall(r"^-\s*(https?://\S+)", src, flags=re.M)))
    return out
