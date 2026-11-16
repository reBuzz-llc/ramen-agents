"""Queue 572, the first run: the user's own answers live in the untracked common-data/local/family.toml, read on top of
the tracked files, so a card says {company} and a `git pull` never meets an edited file."""
from __future__ import annotations

from pathlib import Path

from explorer.target import Target
from explorer.team import load_team

from conftest import make_controller


def fleet(tmp_path: Path, target: str = "", family: str = "") -> Path:
    (tmp_path / "common-data" / "knowledge").mkdir(parents=True, exist_ok=True)
    (tmp_path / "common-data" / "local").mkdir(parents=True, exist_ok=True)
    if target:
        (tmp_path / "common-data" / "knowledge" / "target.toml").write_text(target)
    if family:
        (tmp_path / "common-data" / "local" / "family.toml").write_text(family)
    (tmp_path / "the-ceo").mkdir(exist_ok=True)
    return tmp_path / "the-ceo"


def test_generic_words_without_any_answer(tmp_path):
    t = Target.for_root(fleet(tmp_path))
    assert t.fill("{company} sells {sells} to {buyers} in {place}") == "the company sells its services to small businesses in its area"
    assert t.fill('{"type":"note"} {unknown}') == '{"type":"note"} {unknown}'      # other braces stay as written


def test_family_toml_wins_over_target_toml_and_fills_the_company(tmp_path):
    root = fleet(tmp_path, 'market = "Old Town"\nmarket_short = "OT"\nsegment = "cafes"\n',
                 '[company]\nname = "Acme Studio"\nsells = "websites"\nbuyers = "bakeries"\nplace = "Riverside"\nowner = "Sam"\n'
                 'signoff = "Regards,\\nSam -- Acme Studio"\n[target]\nmarket = "Riverside"\n')
    t = Target.for_root(root)
    assert t.values["market"] == "Riverside" and t.values["market_short"] == "Riverside" and t.values["market_slug"] == "riverside"
    assert t.values["segment"] == "cafes"                                         # a key family.toml does not set stays
    assert t.fill("{company} ({owner}) sells {sells} to {buyers} in {place}") == "Acme Studio (Sam) sells websites to bakeries in Riverside"
    assert t.fill("{signoff}") == "Regards,\nSam -- Acme Studio"


def test_a_changed_answer_is_picked_up(tmp_path):
    import os
    root = fleet(tmp_path, family='[company]\nname = "Acme"\n')
    t = Target.for_root(root)
    assert t.fill("{company}") == "Acme"
    f = tmp_path / "common-data" / "local" / "family.toml"
    f.write_text('[company]\nname = "Acme Two"\n')
    os.utime(f, (1, 1))
    assert t.refresh() and t.fill("{company}") == "Acme Two"


def test_the_team_comes_from_family_toml_when_it_has_one(tmp_path):
    fleet(tmp_path, family='[[team]]\nname = "Sam Lee"\nrole = "Sales"\ndetails = "calls and meetings"\n')
    team_file = tmp_path / "common-data" / "team.json"
    team_file.write_text('{"members": [{"name": "Someone Else"}]}')
    assert [m.name for m in load_team(team_file)] == ["Sam Lee"]
    (tmp_path / "common-data" / "local" / "family.toml").write_text('[company]\nname = "Acme"\n')
    assert [m.name for m in load_team(team_file)] == ["Someone Else"]               # no [[team]]: the team file


def test_the_persona_and_the_signoff_use_the_answers(cfg, tmp_path):
    root = tmp_path / "fleet" / "the-ceo"
    cfg.root = root
    cfg.ensure_dirs()
    fleet(tmp_path / "fleet", family='[company]\nname = "Acme Studio"\nowner = "Sam"\n')
    (root / "persona.md").write_text("You are the CEO of {company}.\n")
    cfg.agent.persona_file = "persona.md"
    cfg.leads.draft_signoff = ["Regards,", "{owner}", "-- {company}"]
    c = make_controller(cfg)
    assert "You are the CEO of Acme Studio." in c.system
    assert c._with_signoff("Hi,\n\nText.\n\nRegards,\nX").endswith("Regards,\nSam\n-- Acme Studio")


def test_own_domains_come_from_family_toml_too(tmp_path):
    from explorer.config import load_config
    root = fleet(tmp_path, family='[company]\nown_domains = ["acme.example", "Acme.example"]\n')
    (root / "config.toml").write_text('[handoff]\nown_domains = ["old.example"]\n')
    assert load_config(root / "config.toml").handoff.own_domains == ["old.example", "acme.example"]
