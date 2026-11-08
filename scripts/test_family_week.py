"""Tests for family_week.py: the week's numbers, sections left out when their agent is not installed, and masking (no
business, person or place)."""
import datetime as dt
import importlib.util
import json
import sqlite3
from pathlib import Path

spec = importlib.util.spec_from_file_location("fw", Path(__file__).with_name("family_week.py"))
fw = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fw)
START, END = dt.date(2026, 11, 2), dt.date(2026, 11, 8)


def agent(root: Path, slug: str, name: str, rows: list[tuple]):
    (root / slug / "workspace").mkdir(parents=True, exist_ok=True)
    (root / slug / "config.toml").write_text(f'[agent]\nname = "{name}"\n')
    con = sqlite3.connect(root / slug / "workspace" / "explorer.sqlite3")
    con.execute("CREATE TABLE actions (id INTEGER PRIMARY KEY, ts TEXT, action_type TEXT, payload TEXT, verdict TEXT)")
    con.executemany("INSERT INTO actions (ts, action_type, payload, verdict) VALUES (?, ?, ?, ?)", [(t, a, json.dumps(p), v) for t, a, p, v in rows])
    con.commit()
    con.close()


def test_week_is_monday_to_sunday():
    assert fw.week_of(dt.date(2026, 11, 8)) == (START, END)
    assert fw.week_of(dt.date(2026, 11, 4)) == (START, END)


def test_counts_and_missing_agents(tmp_path):
    agent(tmp_path, "lead-gen", "Lead Gen", [("2026-11-03T10:00:00", "lead", {"website": "https://a.example"}, "allowed"),
                                             ("2026-11-04T10:00:00", "lead", {"website": ""}, "allowed"),
                                             ("2026-11-04T11:00:00", "lead", {"website": ""}, "rejected: no source"),
                                             ("2026-10-27T10:00:00", "search", {}, "allowed"), ("2026-10-27T10:01:00", "search", {}, "rejected: x")])
    assert fw.leads(tmp_path, START, END) == {"listed": 2, "no_site": 1}
    assert fw.drafts(tmp_path, START, END) is None  # no Outreach Writer here
    assert fw.roles(tmp_path, START, END) is None
    assert fw.refused(tmp_path, START, END) == [{"name": "Lead Gen", "actions": 3, "share": 33, "last": 50}]
    (tmp_path / "validator").mkdir()
    (tmp_path / "validator/config.toml").write_text("[agent]\nnot_a_bot_run_agent = true\n")
    assert fw.members(tmp_path) == [("lead-gen", "Lead Gen")]


def test_a_missing_source_is_left_out_not_zero(tmp_path):
    post = fw.compose(START, END, {"leads": {"listed": 2, "no_site": 0}, "drafts": None, "roles": None, "refused": [], "drain": {"days": []},
                                   "providers": {"joined": [], "left": []}, "fixes": []}, fw.Masker({}))
    assert [s["heading"] for s in post["sections"]] == ["Leads"]
    assert post["sections"][0]["lines"] == ["We listed 2 new leads. Every one of them has a website of its own."]
    assert post["summary"] == "2 leads, on free tiers only."
    assert post["slug"] == "2026-11-08"


def test_masks_from_the_portal_cache_team_and_config(tmp_path):
    (tmp_path / "common-data/shared-state").mkdir(parents=True)
    (tmp_path / "common-data/configs").mkdir(parents=True)
    (tmp_path / "common-data/shared-state/portal-leads-cache.json").write_text(json.dumps({"leads": {"1": {"business": "Maple Street Bakery", "website": "https://www.maplebakery.example/"}}}))
    (tmp_path / "common-data/team.json").write_text(json.dumps({"members": [{"name": "Jane Roe"}, {"name": "FILL-ME: a person"}]}))
    (tmp_path / "common-data/configs/family-week.toml").write_text('places = ["Springfield"]\npeople = ["Sam Advisor"]\n[mask]\n"Project Falcon" = "an internal project"\n')
    m = fw.Masker(fw.mask_terms(tmp_path))
    out = m("Maple Street Bakery (maplebakery.example) in Springfield: Jane told Sam Advisor about Project Falcon; jane@x.example, +1 212 555 0100, https://x.example/a")
    for bad in ("Maple", "maplebakery", "Springfield", "Jane", "Sam Advisor", "Falcon", "jane@", "555", "https://"):
        assert bad not in out, bad
    assert "FILL-ME" not in json.dumps(fw.mask_terms(tmp_path))


def test_plain_words_from_commit_subjects():
    p = fw.plain('Fix: the bot no longer hangs (#12; "it hangs") in scripts/restart-bot.sh, upstream 2fbf60d')
    assert p.startswith("Fix: the bot no longer hangs") and "#12" not in p and "it hangs" not in p and "scripts/" not in p and "2fbf60d" not in p


def test_save_writes_json_and_markdown(tmp_path):
    (tmp_path / "common-data").mkdir()
    post = fw.compose(START, END, {"leads": {"listed": 4, "no_site": 1}, "drafts": {"emails": 3, "whatsapp": 2}, "roles": fw.Counter({"Founder": 2}),
                                   "refused": [{"name": "Lead Gen", "actions": 10, "share": 20, "last": None}], "drain": {"days": ["2026-11-05"], "calls": 100, "tokens": 2_500_000, "providers": 3},
                                   "providers": {"joined": ["groq"], "left": []}, "fixes": ["Lead Gen no longer opens a page twice"]}, fw.Masker({}))
    md = fw.save(post, tmp_path)
    assert json.loads((tmp_path / "common-data/family-weeks.json").read_text())[0]["slug"] == "2026-11-08"
    text = md.read_text()
    assert text.startswith("# This week in the family: 2 November to 8 November 2026")
    assert "- Lead Gen: 20% of 10 actions refused (not running last week)." in text
    assert "2.5 million tokens" in text and "Joined our chain: groq." in text
