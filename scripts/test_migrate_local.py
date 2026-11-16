"""update.sh's one-time lift (queue 572): a user's edits to tracked files move to the git-ignored overlays and family.toml,
the old Notion settings are moved or dropped by name, and git status is clean after."""
from __future__ import annotations

import importlib
import json
import subprocess
import sys
import tomllib
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))


def repo(tmp: Path) -> Path:
    r = tmp / "bots"
    for d in ("common-data/configs", "common-data/knowledge", "the-ceo", "validator", "common-data/keys"):
        (r / d).mkdir(parents=True, exist_ok=True)
    (r / "scripts").mkdir()
    (r / "common-data/configs/common.toml").write_text('[messaging]\nmax_per_day = 12\n[leads]\n# portal_url = "x"\n')
    (r / "the-ceo/config.toml").write_text('extends = "../common-data/configs/common.toml"\n[agent]\nname = "The CEO"\nbio = "FILL-ME"\n'
                                           '[notion]\nenabled = false\ndatabase_id = ""\nmax_tasks_per_day = 3\n[leads]\nenabled = false\n'
                                           '[[messaging.peers]]\nname = "Lead Gen"\nfolder = "~/bots/lead-gen"\n')
    (r / "validator/config.toml").write_text('[validator]\nown_domains = []\ntask_data_source_id = ""\n')
    (r / "common-data/knowledge/target.toml").write_text('market = "FILL-ME market"\nsegment = "FILL-ME segment"\n')
    (r / "common-data/team.json").write_text(json.dumps({"version": 1, "members": [{"name": "FILL-ME: a person"}]}))
    (r / "the-ceo/persona.md").write_text("You are the CEO's agent at FILL-ME company.\n")
    (r / ".gitignore").write_text("common-data/local/\ncommon-data/configs/local.toml\n*/config.local.toml\ncommon-data/keys/\n")
    run = lambda *a: subprocess.run(["git", *a], cwd=r, check=True, capture_output=True)  # noqa: E731
    run("init", "-q")
    run("-c", "user.email=t@example.com", "-c", "user.name=t", "add", "-A")
    run("-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-qm", "starter")
    return r


def test_edits_lift_to_the_overlays_and_git_is_clean(tmp_path, monkeypatch):
    r = repo(tmp_path)
    # the user's hand edits, a Notion setup among them
    (r / "common-data/configs/common.toml").write_text('[messaging]\nmax_per_day = 20\n[leads]\nportal_url = "https://my-portal.example"\n')
    (r / "the-ceo/config.toml").write_text('extends = "../common-data/configs/common.toml"\n[agent]\nname = "The CEO"\nbio = "We build sites."\n'
                                           '[notion]\nenabled = true\ndatabase_id = "0123456789abcdef0123456789abcdef"\nmax_tasks_per_day = 7\n'
                                           'default_project_id = "0123456789abcdef0123456789abcdef"\napi_version = "2025-09-03"\n[leads]\nenabled = true\n'
                                           'database_id = "abcdef0123456789abcdef0123456789"\n'
                                           '[[messaging.peers]]\nname = "Lead Gen"\nfolder = "~/bots/lead-gen"\n')
    (r / "validator/config.toml").write_text('[validator]\nown_domains = ["cobalt.example"]\ntask_data_source_id = "abc"\n')
    (r / "common-data/knowledge/target.toml").write_text('market = "Springfield, IL"\nsegment = "small businesses"\n')
    (r / "common-data/team.json").write_text(json.dumps({"version": 1, "members": [{"name": "Sam", "notionId": "x", "role": "sends"}]}))
    (r / "the-ceo/persona.md").write_text("You are the CEO's agent at Cobalt Web.\n")
    import migrate_local as m
    importlib.reload(m)
    monkeypatch.setattr(m, "ROOT", r)
    notes = m.migrate()
    text = "\n".join(notes)
    # git is clean: every tracked file is as the repository has it
    assert subprocess.run(["git", "status", "--porcelain", "--untracked-files=no"], cwd=r, capture_output=True, text=True).stdout == ""
    shared = tomllib.loads((r / "common-data/configs/local.toml").read_text())
    assert shared == {"messaging": {"max_per_day": 20}, "leads": {"portal_url": "https://my-portal.example"}}
    ceo = tomllib.loads((r / "the-ceo/config.local.toml").read_text())
    assert "notion" not in ceo
    assert ceo["agent"] == {"bio": "We build sites."}
    assert ceo["tasks"] == {"enabled": True, "max_per_day": 7}
    assert ceo["leads"] == {"enabled": True}
    assert "messaging" not in ceo  # the peers were not changed
    val = tomllib.loads((r / "validator/config.local.toml").read_text())
    assert val == {"validator": {"own_domains": ["cobalt.example"]}}
    fam = tomllib.loads((r / "common-data/local/family.toml").read_text())
    assert fam["target"] == {"market": "Springfield, IL", "segment": "small businesses"}
    assert fam["team"] == [{"name": "Sam", "role": "sends"}]
    assert (r / "common-data/local/before-update/the-ceo/persona.md").read_text().endswith("Cobalt Web.\n")
    # every Notion value is named, moved or dropped
    for word in ("max_tasks_per_day moved to [tasks] max_per_day", "enabled moved to [tasks] enabled", "default_project_id was a Notion id",
                 "api_version dropped", "database_id dropped", "[leads] database_id dropped", "task_data_source_id dropped"):
        assert word in text, word
    # a second run lifts nothing
    assert m.migrate() == []


def test_an_overlay_value_already_there_wins(tmp_path, monkeypatch):
    r = repo(tmp_path)
    (r / "the-ceo/config.local.toml").write_text('[agent]\nbio = "mine already"\n')
    (r / "the-ceo/config.toml").write_text((r / "the-ceo/config.toml").read_text().replace('bio = "FILL-ME"', 'bio = "from the tracked edit"'))
    import migrate_local as m
    importlib.reload(m)
    monkeypatch.setattr(m, "ROOT", r)
    m.migrate()
    assert tomllib.loads((r / "the-ceo/config.local.toml").read_text())["agent"]["bio"] == "mine already"
