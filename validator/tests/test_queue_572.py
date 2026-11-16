"""Queue 572 (owner, 2026-11-16: "remove notion from all location and repos"): the starter's Validator reads leads, tasks
and packages from the dashboard's local board with no Notion key; its own values sit in an untracked overlay; setup-check
asks for the board's keys, never a Notion one."""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import httpx

import portal_leads
import validator
from sources import team_members

HERE = Path(__file__).resolve().parents[1]


class Board:
    def __init__(self, drafts_route: bool = True):
        self.drafts_route = drafts_route

    def handler(self, req: httpx.Request) -> httpx.Response:
        if req.url.path == "/v1/boards/tasks/rows":
            return httpx.Response(200, json={"tasks": [
                {"id": "aaaaaaaa-bbbb-cccc-dddd-eeeeffff0000", "title": "Draft ten outreach messages for bakeries", "status": "Not started",
                 "priority": "P3", "assignees": ["Alex Stone"], "due": "2026-12-01", "details": "### Why\nBecause.\n### Done when\n- [ ] ten drafts\n- [ ] sent to Alex",
                 "created_at": "2026-11-16T10:00:00", "updated_at": "2026-11-16T10:00:00"},
                {"id": "gone", "title": "Old", "archived": True}], "next": 2, "more": False})
        if req.url.path == "/v1/assets/packages":
            return httpx.Response(200, json={"packages": [
                {"id": "p1", "name": "Starter Website", "price": "$990", "offer": "Hi [Name], ...", "buyer": "a shop with no site",
                 "deliverables": ["a one-page site"], "status": "published", "updated_at": "2026-11-10T00:00:00"},
                {"id": "d1", "name": "MVP Launch Starter", "price": "$6,500 fixed", "offer": "Ship it\n\nHi [Name], ...", "status": "draft"}]})
        if req.url.path == "/v1/assets/packages/drafts" and self.drafts_route:
            return httpx.Response(200, json={"drafts": [{"id": "d1", "sources": ["https://a.example/pricing"], "why": "fits pre-seed founders"}]})
        return httpx.Response(404, json={"error": {"code": "not_found", "message": "no route"}})


def _reader(board: Board) -> portal_leads.PortalLeads:
    return portal_leads.PortalLeads({}, "http://board.test", token="t", cache=None,
                                    http=httpx.Client(base_url="http://board.test", transport=httpx.MockTransport(board.handler)))


def test_tasks_come_from_the_board_with_their_checklist():
    tasks = _reader(Board()).tasks()
    assert len(tasks) == 1
    t = tasks[0]
    assert t.page_id == "aaaaaaaabbbbccccddddeeeeffff0000" and t.url == "http://board.test/tasks/aaaaaaaa-bbbb-cccc-dddd-eeeeffff0000"
    assert t.title.startswith("Draft ten") and t.priority == "P3" and t.due == "2026-12-01" and t.assignee_ids == ["alex stone"]
    assert ("heading_3", "Done when", False) in t.blocks and ("to_do", "ten drafts", False) in t.blocks
    assert _reader(Board()).tasks(edited_after="2026-11-17T00:00:00Z") == []


def test_packages_come_from_the_board_with_the_drafts_sources_and_reasons():
    toggles = {p.block_id: p for p in _reader(Board()).package_toggles()}
    assert toggles["p1"].title == "Starter Website — $990" and toggles["p1"].extra["Who it is for"] == "a shop with no site"
    assert toggles["d1"].sources == ["https://a.example/pricing"] and toggles["d1"].conclusion == "fits pre-seed founders"
    assert toggles["d1"].email.startswith("Ship it") and toggles["d1"].page_url == "http://board.test/packages"
    assert {p.block_id for p in _reader(Board(drafts_route=False)).package_toggles()} == {"p1", "d1"}   # no drafts route: still read


def test_the_team_is_matched_by_id_name_or_email(tmp_path):
    f = tmp_path / "team.json"
    f.write_text(json.dumps({"members": [{"id": "u1", "name": "Alex Stone", "email": "alex@shop.example"}, {"name": ""}]}))
    assert team_members(f) == {"u1": "Alex Stone", "alex stone": "Alex Stone", "alex@shop.example": "Alex Stone"}


def test_the_validators_own_overlay_wins_key_by_key(tmp_path, monkeypatch):
    (tmp_path / "config.toml").write_text('[validator]\nrun_every_hours = 6\nown_domains = ["a.example"]\n[validator.offers]\nx = 1\ny = 2\n')
    monkeypatch.setattr(validator, "HERE", tmp_path)
    assert validator.load_settings()["run_every_hours"] == 6
    (tmp_path / "config.local.toml").write_text('[validator]\nown_domains = ["mine.example"]\n[validator.offers]\ny = 3\n')
    s = validator.load_settings()
    assert s["own_domains"] == ["mine.example"] and s["run_every_hours"] == 6 and s["offers"] == {"x": 1, "y": 3}
    assert "notion_api_version" not in s and "task_data_source_id" not in s


def test_the_task_bar_comes_from_the_bots_tasks_section_and_its_overlay(tmp_path, monkeypatch):
    (tmp_path / "the-ceo").mkdir()
    (tmp_path / "the-ceo" / "config.toml").write_text("[tasks]\nmin_details_chars = 250\n")
    monkeypatch.setattr(validator, "BOTS", tmp_path)
    assert validator.min_details_for("the-ceo") == 250
    (tmp_path / "the-ceo" / "config.local.toml").write_text("[tasks]\nmin_details_chars = 400\n")
    assert validator.min_details_for("the-ceo") == 400


def test_nothing_in_the_validator_or_setup_check_needs_notion():
    for p in list(HERE.glob("*.py")) + [HERE.parent / "scripts" / "setup-check.py", HERE.parent / "scripts" / "check-setup.sh",
                                       HERE.parent / "scripts" / "check-keys.sh"]:
        text = p.read_text(encoding="utf-8").lower()
        assert "api.notion.com" not in text and "notion.key" not in text and "notion_api_version" not in text, p
    for cfg in ("validator/config.toml", "the-ceo/config.toml", "lead-gen/config.toml", "common-data/configs/common.toml"):
        text = (HERE.parent / cfg).read_text(encoding="utf-8")
        assert "[notion]" not in text and "database_id" not in text and "data_source_id" not in text, cfg


def test_setup_check_wants_the_board_keys_and_defaults_to_the_local_board(tmp_path, monkeypatch):
    spec = importlib.util.spec_from_file_location("setup_check_572", HERE.parent / "scripts" / "setup-check.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    monkeypatch.setattr(mod, "ROOT", tmp_path)
    assert mod.portal_url() == "http://127.0.0.1:3000"
    (tmp_path / "common-data" / "configs").mkdir(parents=True)
    (tmp_path / "common-data" / "configs" / "local.toml").write_text('[leads]\nportal_url = "https://hosted.example/"\n')
    assert mod.portal_url() == "https://hosted.example"
    assert [k for k, _, _ in mod.PORTAL_KEYS] == ["portal-engine", "portal-validator", "portal-dashboard"]


# ---- the first-run answers: common-data/local/family.toml --------------------------------------------------------

def test_the_rule_cards_and_settings_take_the_first_run_answers(tmp_path, monkeypatch):
    import checks
    (tmp_path / "target.toml").write_text('market = "Old Town"\nmarket_short = "OT"\nsegment = "cafes"\n')
    (tmp_path / "family.toml").write_text('[company]\nname = "Acme Studio"\nowner = "Sam"\nsignoff = "Regards,\\nSam"\n'
                                          'own_domains = ["acme.example"]\n[target]\nmarket = "Riverside"\n')
    monkeypatch.setattr(checks, "TARGET", tmp_path / "target.toml")
    monkeypatch.setattr(checks, "LOCAL", tmp_path / "family.toml")
    t = checks.target()
    assert t["market"] == "Riverside" and t["market_short"] == "Riverside" and t["segment"] == "cafes" and t["company"] == "Acme Studio"
    assert checks.fill("{owner} at {company} in {market}; {unknown}") == "Sam at Acme Studio in Riverside; {unknown}"
    assert checks.family()["company"]["own_domains"] == ["acme.example"]


def test_the_team_comes_from_family_toml_when_it_has_one(tmp_path):
    (tmp_path / "local").mkdir()
    (tmp_path / "team.json").write_text(json.dumps({"members": [{"name": "Someone Else"}]}))
    (tmp_path / "local" / "family.toml").write_text('[[team]]\nname = "Sam Lee"\nemail = "sam@acme.example"\n')
    assert team_members(tmp_path / "team.json") == {"sam lee": "Sam Lee", "sam@acme.example": "Sam Lee"}


def test_no_fill_me_is_left_in_the_cards_and_configs():
    for d in ("the-ceo", "lead-gen", "package-designer", "research-analyst", "scout", "validator"):
        for p in (HERE.parent / d).glob("*"):
            if p.suffix in (".md", ".toml"):
                assert "FILL-ME" not in p.read_text(encoding="utf-8"), p


def test_setup_check_wants_the_first_run_answers_not_fill_me_markers(tmp_path, monkeypatch):
    spec = importlib.util.spec_from_file_location("setup_check_572b", HERE.parent / "scripts" / "setup-check.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    monkeypatch.setattr(mod, "ROOT", tmp_path)
    assert "family.toml" in mod.family_missing()[0]
    (tmp_path / "common-data" / "local").mkdir(parents=True)
    f = tmp_path / "common-data" / "local" / "family.toml"
    f.write_text('[company]\nname = "Acme"\n')
    assert mod.family_missing() == ["[company] sells", "[company] buyers", "[target] market"]
    f.write_text('[company]\nname = "Acme"\nsells = "sites"\nbuyers = "cafes"\n[target]\nmarket = "Riverside"\n')
    assert mod.family_missing() == []
    assert not hasattr(mod, "fill_me")


def test_the_gate_reads_the_first_run_steer_before_steers_md(tmp_path, monkeypatch):
    import checks
    import gate
    monkeypatch.setattr(checks, "LOCAL", tmp_path / "family.toml")
    (tmp_path / "family.toml").write_text('steer = "Bakeries first this month."\n')
    assert gate.newest_steer() == "Bakeries first this month."
    (tmp_path / "family.toml").write_text('[company]\nname = "Acme"\n')
    assert gate.newest_steer() != "Bakeries first this month."           # unset: steers.md's newest section, as before
