"""The agents' day and week on the portal's Family page (POST /v1/family/report), masked, only with a portal set."""
from __future__ import annotations

import datetime as dt
import json
import re
import sqlite3

import httpx

import family_report as fr

NOW = dt.datetime(2026, 11, 8, 16, 30)
PORTAL_REFUSES = [re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+"), re.compile(r"\+?\d[\d ()-]{8,}\d"),
                  re.compile(r"https?://|www\.|\b[a-z0-9-]+\.(com|net|org|co|us|biz|info|io|shop|store|nyc)\b", re.I)]


def _agent(root, slug, name, rows):
    (root / slug / "workspace").mkdir(parents=True)
    (root / slug / "config.toml").write_text(f'[agent]\nname = "{name}"\n')
    con = sqlite3.connect(root / slug / "workspace" / "explorer.sqlite3")
    con.execute("CREATE TABLE actions (id INTEGER PRIMARY KEY, ts TEXT, action_type TEXT, payload TEXT, verdict TEXT)")
    con.executemany("INSERT INTO actions (ts, action_type, payload, verdict) VALUES (?, ?, ?, ?)", rows)
    con.commit()
    con.close()


def _fleet(tmp_path):
    t = "2026-11-08T16:10:00"
    _agent(tmp_path, "lead-gen", "Lead Gen", [(t, "lead", json.dumps({"name": "A", "website": ""}), "allowed"),
                                              (t, "lead", json.dumps({"name": "B", "website": "https://b.example"}), "allowed"),
                                              (t, "search", "{}", "rejected: x")])
    _agent(tmp_path, "outreach-writer", "Outreach Writer", [(t, "update_lead", json.dumps({"name": "A", "draft_email": "Hi"}), "allowed")])
    (tmp_path / "validator").mkdir()
    (tmp_path / "validator" / "config.toml").write_text("[validator]\n")
    (tmp_path / "outreach-writer" / "workspace" / "STOP").write_text("")
    common = tmp_path / "common.toml"
    common.write_text('[leads]\nportal_url = "https://portal.example.com"\n[family]\nweek_url = "https://blog.example.com/family-week"\n')
    return common


def _client(seen, status=200):
    def h(req):
        seen.append((req.url.path, req.headers.get("authorization"), json.loads(req.content)))
        return httpx.Response(status, json={"report": {"id": 1}} if status < 400 else {"error": {"message": "lines[0] has a phone number"}})
    return httpx.Client(base_url="https://portal.example.com", transport=httpx.MockTransport(h))


def test_mask_passes_the_portals_check():
    for raw in ["mail a@b.example", "call +1 (555) 010-0199", "see https://x.example and shop.com", "Lead Gen: 3 actions, 0% refused", "imports: 2026-11-04 batch 2010"]:
        out = fr.mask(raw)
        assert not any(p.search(out) for p in PORTAL_REFUSES), out


def test_tick_morning_and_week_post_once(tmp_path, monkeypatch):
    common = _fleet(tmp_path)
    monkeypatch.setattr(fr, "KEY", tmp_path / "k")
    (tmp_path / "k").write_text("portal_test")
    weeks = tmp_path / "weeks.json"
    weeks.write_text(json.dumps([{"slug": "2026-11-01", "title": "Old", "summary": "s"}, {"slug": "2026-11-08", "title": "This week", "summary": "2 leads"}]))
    state, seen = {}, []
    assert fr.run(state, NOW, http=_client(seen), root=tmp_path, common=common, weeks=weeks) == "family report posted: tick, morning, week"
    tick = seen[0][2]
    assert seen[0][:2] == ("/v1/family/report", "Bearer portal_test")
    assert tick["today"] == {"leads_listed": 2, "no_site_share": 50, "drafts_landed": 1, "whatsapp_pitches": 0}
    assert [m["name"] for m in tick["members"]] == ["Lead Gen", "Outreach Writer"] and tick["members"][1]["state"] == "stopped"
    assert seen[1][2]["lines"][0] == "Lead Gen: 3 actions in the last 24 hours, 33% refused, 2 accepted outputs"
    assert seen[2][2]["week"]["url"] == "https://blog.example.com/family-week/2026-11-08"
    seen.clear()
    assert fr.run(state, NOW, http=_client(seen), root=tmp_path, common=common, weeks=weeks) == "family report posted: tick"


def test_no_portal_no_post_and_a_failure_is_one_line(tmp_path, monkeypatch):
    common = _fleet(tmp_path)
    monkeypatch.setattr(fr, "KEY", tmp_path / "k")
    (tmp_path / "k").write_text("t")
    off = tmp_path / "off.toml"
    off.write_text("# [leads]\n")
    assert fr.run({}, NOW, http=_client([]), root=tmp_path, common=off) == ""
    state = {"family_morning_posted": "2026-11-08"}
    try:
        fr.run(state, NOW, http=_client([], 400), root=tmp_path, common=common, weeks=tmp_path / "none.json")
        raise AssertionError("no error")
    except RuntimeError as exc:
        assert str(exc) == "family report: tick HTTP 400 lines[0] has a phone number"
