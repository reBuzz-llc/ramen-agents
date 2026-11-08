"""The Leads board on the team portal ([leads] portal_url): rows in the Notion shape the controller reads, one shared copy
of the board per Mac with since/ETag deltas, writes read back, a person's cell refused and named."""
from __future__ import annotations

import json
from pathlib import Path

import httpx
import pytest

from explorer.notion import NotionError
from explorer.portal_store import PortalLeadStore


class Portal:
    def __init__(self):
        self.leads = {"a1": {"id": "a1", "business": "Corner Bakery", "website": "https://cornerbakery.example", "domain": "cornerbakery.example",
                             "package": "Starter Website", "pain_point": "No online menu", "draft_email": None, "rev": 1, "archived": False}}
        self.rev = 1
        self.calls: list[tuple[str, str, dict]] = []

    def handler(self, req: httpx.Request) -> httpx.Response:
        self.calls.append((req.method, req.url.path, dict(req.url.params)))
        etag = f'W/"leads-{self.rev}"'
        if req.method == "GET" and req.url.path == "/v1/boards/leads/rows":
            if req.headers.get("if-none-match") == etag:
                return httpx.Response(304, headers={"etag": etag})
            since = int(req.url.params.get("since", 0))
            rows = [l for l in self.leads.values() if l["rev"] > since]
            return httpx.Response(200, json={"leads": rows, "next": self.rev, "more": False}, headers={"etag": etag})
        if req.method == "PATCH" and req.url.path.startswith("/v1/rows/"):
            body = json.loads(req.content)
            lead = self.leads[req.url.path.rsplit("/", 1)[-1]]
            refused = [{"field": "result", "reason": "human_only"}] if "result" in body["fields"] else []
            written = [k for k in body["fields"] if k != "result"]
            self.rev += 1
            lead.update({k: body["fields"][k] for k in written}, rev=self.rev)
            if "draft_email" in written and body["fields"]["draft_email"].startswith("odd"):
                lead["draft_email"] = "trimmed by the portal"
            return httpx.Response(200, json={"lead": lead, "written": written, "refused": refused})
        if req.method == "POST" and req.url.path == "/v1/boards/leads/rows":
            body = json.loads(req.content)
            self.rev += 1
            lead = {"id": "b2", **body["fields"], "rev": self.rev, "archived": False}
            self.leads["b2"] = lead
            return httpx.Response(201, json={"lead": lead})
        return httpx.Response(404, json={"error": {"code": "not_found"}})


def _store(portal, cache=None, today="2026-11-08"):
    return PortalLeadStore("http://portal.test", "k", "Lead Gen", http=httpx.Client(base_url="http://portal.test", transport=httpx.MockTransport(portal.handler)),
                           cache=cache, today=today)


def test_rows_in_the_notion_shape_and_writes_read_back():
    p = Portal()
    s = _store(p)
    row = s.find_row("corner bakery")
    assert row["fields"]["How can I help"] == "Starter Website" and row["url"] == "http://portal.test/leads/a1"
    assert s.has_domain("cornerbakery.example") and not s.has_domain("other.example")
    assert [r["title"] for r in s.rows_waiting("Draft email", "Stage", "", 5, require=("How can I help", "Pain point"))] == ["Corner Bakery"]
    s.update_row("a1", {"Draft email": "Hello", "Result": "Replied", "Status": "Email Sent"})
    assert "'Status' is the team's; not written" in s.last_warnings
    s.update_row("a1", {"Draft email": "odd draft"})
    assert s.last_warnings == ["Draft email reads back different on the portal"]
    url = s.create_row("Lake Gym", {"Website": "https://lakegym.example"})
    assert url == "http://portal.test/leads/b2"


def test_a_person_cell_alone_is_refused_and_named():
    p = Portal()
    s = _store(p)
    p.handler_orig = p.handler

    def only_person(req):
        if req.method == "PATCH":
            return httpx.Response(200, json={"lead": p.leads["a1"], "written": [], "refused": [{"field": "pain_point", "reason": "person_wins"}]})
        return p.handler_orig(req)
    s.http = httpx.Client(base_url="http://portal.test", transport=httpx.MockTransport(only_person))
    with pytest.raises(NotionError, match="a person set that cell: Pain point"):
        s.update_row("a1", {"Pain point": "y"})


def test_one_full_pull_a_day_then_deltas_and_a_304(tmp_path: Path):
    p = Portal()
    cache = tmp_path / "portal-leads-cache.json"
    first = _store(p, cache)
    first.refresh()
    assert p.calls[-1][2]["since"] == "0" and p.calls[-1][2]["fields"] == "all"
    saved = json.loads(cache.read_text())
    assert saved["full_day"] == "2026-11-08" and "a1" in saved["rows"] and saved["etag"] == 'W/"leads-1"'
    second = _store(p, cache)
    second.refresh()
    assert p.calls[-1][2]["since"] == "1"              # from the shared copy's rev, and the board had not changed: 304
    assert second.find_row("Corner Bakery") is not None
    third = _store(p, cache, today="2026-11-09")
    third.refresh()
    assert p.calls[-1][2]["since"] == "0"              # a new day: the Mac's one full pull
