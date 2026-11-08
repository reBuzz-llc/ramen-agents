"""The Leads board on the team portal for the Validator: rows as NotionReader gives them, one shared copy of the board with
since/ETag deltas, the Validator's writes read back, the false-WhatsApp clean-up there."""
from __future__ import annotations

import datetime as dt
import json

import httpx

import portal_leads
import whatsapp_false


class Portal:
    def __init__(self):
        self.leads = {"a1": {"id": "a1", "business": "Corner Bakery", "website": "https://cornerbakery.example", "package": "Starter Website",
                             "updated_at": "2026-11-08T10:00:00", "created_at": "2026-11-01", "whatsapp": "https://wa.me/15550100",
                             "whatsapp_status": "False Whatsapp Number", "archived": False, "rev": 1}}
        self.rev, self.calls = 1, []

    def handler(self, req):
        self.calls.append((req.method, dict(req.url.params), req.headers.get("if-none-match")))
        etag = f'W/"{self.rev}"'
        if req.method == "GET":
            if req.headers.get("if-none-match") == etag:
                return httpx.Response(304)
            since = int(req.url.params["since"])
            return httpx.Response(200, json={"leads": [l for l in self.leads.values() if l["rev"] > since], "next": self.rev, "more": False},
                                  headers={"etag": etag})
        body = json.loads(req.content)
        lead = self.leads[req.url.path.rsplit("/", 1)[-1]]
        self.rev += 1
        lead.update(body["fields"], rev=self.rev)
        return httpx.Response(200, json={"lead": lead, "written": list(body["fields"]), "refused": []})


def _p(portal, cache, today="2026-11-08"):
    return portal_leads.PortalLeads({}, "http://portal.test", token="t", http=httpx.Client(base_url="http://portal.test", transport=httpx.MockTransport(portal.handler)),
                                    cache=cache, today=today)


def test_rows_options_and_a_read_back_write(tmp_path):
    portal = Portal()
    p = _p(portal, tmp_path / "c.json")
    rows = p.leads()
    assert rows[0].business == "Corner Bakery" and rows[0].how_we_help == "Starter Website" and rows[0].status == "False Whatsapp Number"
    assert p.leads(edited_after="2026-11-09T00:00:00Z") == []
    assert p.select_options() == ["Starter Website"]
    assert p.write("a1", {"Lead score": 7}) == {"written": ["lead_score"], "refused": [], "differs": []}
    assert portal_leads.writer(p)("a1", {"Site health": "ok"}) is True


def test_the_shared_copy_then_a_304(tmp_path):
    portal = Portal()
    cache = tmp_path / "portal-leads-cache.json"
    _p(portal, cache).leads()
    assert portal.calls[-1][1]["since"] == "0" and portal.calls[-1][1]["fields"] == "all"
    _p(portal, cache).leads()
    assert portal.calls[-1][1]["since"] == "1" and portal.calls[-1][2] == 'W/"1"'
    assert json.loads(cache.read_text())["full_day"] == "2026-11-08"


def test_false_whatsapp_cleared_on_the_portal(tmp_path, monkeypatch):
    monkeypatch.setattr(whatsapp_false, "FALSE_FILE", tmp_path / "false.json")
    portal = Portal()
    done = whatsapp_false.clear_false_portal(_p(portal, None), now=dt.datetime(2026, 11, 8, 12))
    assert done == [{"business": "Corner Bakery", "page_id": "a1", "number": "15550100"}]
    assert portal.leads["a1"]["whatsapp"] is None and portal.leads["a1"]["whatsapp_status"] is None
    assert "15550100" in json.loads((tmp_path / "false.json").read_text())


def test_portal_url_from_common_toml(tmp_path):
    f = tmp_path / "common.toml"
    f.write_text("[leads]\nportal_url = \"https://portal.example.com/\"\n")
    assert portal_leads.portal_url(f) == "https://portal.example.com"
    f.write_text("# [leads]\n# portal_url = \"x\"\n")
    assert portal_leads.portal_url(f) == ""
