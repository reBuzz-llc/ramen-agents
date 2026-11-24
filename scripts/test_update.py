"""sh scripts/update.sh on a stale clone, against a starter remote made here: an update keeps the person's key, family.toml,
a config edit and a card edit in effect; --check changes nothing; a setup check that finds something new missing ends in
exit 2, and --rollback returns both folders to the heads the update started from. No network, no install, no key printed."""
from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
SCRIPTS = ("update.sh", "update_steps.py", "migrate_local.py", "read-only-guard.sh", "setup-check.py")
PERSONA_A = "You are the CEO's agent.\nYour company: FILL-ME.\nline three\nline four\nline five\nKeep it short.\n"
PERSONA_B = PERSONA_A.replace("Keep it short.", "Keep it short and plain.")
ENTRY_A = {"date": "2026-11-20", "kind": "feature", "line": "The Leads board imports a CSV.", "step": ""}
ENTRY_B = {"date": "2026-11-23", "kind": "removed", "line": "The old Notion settings are gone.", "step": "sh scripts/update.sh"}
KEY = "zai-made-up-key-for-the-test"


def git(cwd: Path, *a: str) -> str:
    env = {**os.environ, "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@example.com", "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@example.com"}
    return subprocess.run(["git", *a], cwd=cwd, check=True, capture_output=True, text=True, env=env).stdout.strip()


def _write(root: Path, files: dict[str, str]) -> None:
    for rel, text in files.items():
        (root / rel).parent.mkdir(parents=True, exist_ok=True)
        (root / rel).write_text(text, encoding="utf-8")


@pytest.fixture()
def world(tmp_path, monkeypatch):
    return _make(tmp_path, monkeypatch)


def _make(tmp_path, monkeypatch, steps_in_a: bool = True):
    home = tmp_path / "home"
    home.mkdir()
    monkeypatch.setenv("HOME", str(home))
    bare = tmp_path / "starter.git"
    git(tmp_path, "init", "-q", "--bare", str(bare))
    # the starter's fleet branch: two versions, A (what the person took) and B (the update)
    src = tmp_path / "src-fleet"
    src.mkdir()
    git(src, "init", "-q", "-b", "fleet")
    for name in SCRIPTS:
        (src / "scripts").mkdir(exist_ok=True)
        shutil.copy(HERE / name, src / "scripts" / name)
    _write(src, {".gitignore": "common-data/local/\ncommon-data/configs/local.toml\n*/config.local.toml\ncommon-data/keys/\n",
                 "common-data/configs/common.toml": "[messaging]\nmax_per_day = 12\n",
                 "the-ceo/config.toml": 'extends = "../common-data/configs/common.toml"\n[agent]\nname = "The CEO"\nbio = "FILL-ME"\n',
                 "the-ceo/persona.md": PERSONA_A,
                 "docs/updates.json": json.dumps({"schema": 1, "entries": [ENTRY_A]}, indent=1)})
    if not steps_in_a:                       # an old checkout: version A has no update_steps.py yet
        (src / "scripts" / "update_steps.py").unlink()
    git(src, "add", "-A")
    git(src, "commit", "-qm", "version A")
    a = git(src, "rev-parse", "--short", "HEAD")
    _write(src, {"the-ceo/persona.md": PERSONA_B, "common-data/configs/common.toml": "[messaging]\nmax_per_day = 14\n",
                 "docs/updates.json": json.dumps({"schema": 1, "entries": [ENTRY_B, ENTRY_A]}, indent=1)})
    if not steps_in_a:
        shutil.copy(HERE / "update_steps.py", src / "scripts" / "update_steps.py")
        git(src, "add", "-A")
    git(src, "commit", "-qam", "version B")
    b = git(src, "rev-parse", "--short", "HEAD")
    git(src, "push", "-q", str(bare), "fleet")
    # the engine branch: two commits
    esrc = tmp_path / "src-engine"
    esrc.mkdir()
    git(esrc, "init", "-q", "-b", "engine")
    _write(esrc, {"README.md": "engine 1\n"})
    git(esrc, "add", "-A")
    git(esrc, "commit", "-qm", "engine 1")
    e1 = git(esrc, "rev-parse", "--short", "HEAD")
    _write(esrc, {"README.md": "engine 2\n"})
    git(esrc, "commit", "-qam", "engine 2")
    e2 = git(esrc, "rev-parse", "--short", "HEAD")
    git(esrc, "push", "-q", str(bare), "engine")
    # the person's stale clones, at A and engine 1, with their own key, answers, a config edit and a card edit
    bots, engine = tmp_path / "bots", tmp_path / "bot"
    git(tmp_path, "clone", "-q", "-b", "fleet", "-o", "starter", str(bare), str(bots))
    git(bots, "reset", "-q", "--hard", a)
    git(tmp_path, "clone", "-q", "-b", "engine", "-o", "starter", str(bare), str(engine))
    git(engine, "reset", "-q", "--hard", e1)
    _write(bots, {"common-data/keys/zai.key": KEY + "\n", "common-data/local/family.toml": '[company]\nname = "Cobalt Web"\n',
                  "the-ceo/config.toml": 'extends = "../common-data/configs/common.toml"\n[agent]\nname = "The CEO"\nbio = "We build sites."\n',
                  "the-ceo/persona.md": PERSONA_A.replace("Your company: FILL-ME.", "Your company: Cobalt Web, Springfield.")})
    env = {**os.environ, "HOME": str(home), "RAMEN_ENGINE": str(engine), "RAMEN_UPDATE_NO_INSTALL": "1", "RAMEN_UPDATE_ANY_OS": "1",
           "RAMEN_UPDATE_CHECK": "true"}
    return {"bots": bots, "engine": engine, "a": a, "b": b, "e1": e1, "e2": e2, "env": env}


def update(w, *args: str, check: str | None = None) -> subprocess.CompletedProcess:
    env = dict(w["env"], **({"RAMEN_UPDATE_CHECK": check} if check else {}))
    return subprocess.run(["sh", "scripts/update.sh", *args], cwd=w["bots"], capture_output=True, text=True, env=env)


def snapshot(root: Path) -> dict[str, str]:
    return {str(p.relative_to(root)): p.read_text(encoding="utf-8", errors="replace") for p in root.rglob("*") if p.is_file() and ".git" not in p.parts}


def kept_in_effect(w) -> None:
    bots = w["bots"]
    assert (bots / "common-data/keys/zai.key").read_text() == KEY + "\n"
    assert 'name = "Cobalt Web"' in (bots / "common-data/local/family.toml").read_text()
    assert "We build sites." in (bots / "the-ceo/config.local.toml").read_text()            # the config edit, in its overlay
    assert "Your company: Cobalt Web, Springfield." in (bots / "the-ceo/persona.md").read_text()   # the card edit, re-applied


def test_an_update_keeps_the_key_the_answers_a_config_edit_and_a_card_edit(world):
    r = update(world)
    assert r.returncode == 0, r.stdout + r.stderr
    bots = world["bots"]
    assert git(bots, "rev-parse", "--short", "HEAD") == world["b"] and git(world["engine"], "rev-parse", "--short", "HEAD") == world["e2"]
    kept_in_effect(world)
    assert "Keep it short and plain." in (bots / "the-ceo/persona.md").read_text()         # and the starter's own change
    assert "re-applied your edit to the-ceo/persona.md" in r.stdout
    assert "The old Notion settings are gone." in r.stdout and "The Leads board imports a CSV." not in r.stdout   # only what is new
    last = json.loads((bots / "common-data/local/last-update.json").read_text())
    assert last["result"] == "ok" and last["fleet"] == {"before": world["a"], "after": world["b"]}
    assert last["engine"] == {"before": world["e1"], "after": world["e2"]}
    assert last["reapplied"] == ["the-ceo/persona.md"] and last["set_aside"] == [] and last["new_missing"] == []
    assert KEY not in r.stdout + r.stderr


def test_an_edit_that_no_longer_applies_is_kept_and_named(world):
    (world["bots"] / "the-ceo/persona.md").write_text(PERSONA_A.replace("Keep it short.", "Keep it very short."))   # the line B changes
    r = update(world)
    assert r.returncode == 0, r.stdout + r.stderr
    assert "could not re-apply your edit to the-ceo/persona.md: kept in common-data/local/before-update/the-ceo/persona.md" in r.stdout
    assert "Keep it very short." in (world["bots"] / "common-data/local/before-update/the-ceo/persona.md").read_text()
    last = json.loads((world["bots"] / "common-data/local/last-update.json").read_text())
    assert last["set_aside"] == ["the-ceo/persona.md"] and last["reapplied"] == []


def test_check_changes_nothing(world):
    bots = world["bots"]
    before, ebefore = snapshot(bots), snapshot(world["engine"])
    heads = (git(bots, "rev-parse", "HEAD"), git(world["engine"], "rev-parse", "HEAD"))
    r = update(world, "--check")
    assert r.returncode == 0, r.stdout + r.stderr
    assert snapshot(bots) == before and snapshot(world["engine"]) == ebefore
    assert (git(bots, "rev-parse", "HEAD"), git(world["engine"], "rev-parse", "HEAD")) == heads
    assert "1 new commit(s)" in r.stdout and "The old Notion settings are gone." in r.stdout and "the-ceo/persona.md" in r.stdout
    assert not (bots / "common-data/local/last-update.json").exists()


def test_a_failing_check_is_named_and_the_rollback_restores_the_heads(world):
    bots = world["bots"]
    failing = f'if [ "$(git rev-parse --short HEAD)" = "{world["b"]}" ]; then printf "Still missing (1):\\n  - the dashboard is not built\\n"; fi'
    r = update(world, check=failing)
    assert r.returncode == 2, r.stdout + r.stderr
    assert "missing since this update:" in r.stdout and "the dashboard is not built" in r.stdout and "--rollback" in r.stdout
    last = json.loads((bots / "common-data/local/last-update.json").read_text())
    assert last["result"] == "failed" and last["new_missing"] == ["the dashboard is not built"]
    r = update(world, "--rollback")
    assert r.returncode == 0, r.stdout + r.stderr
    assert git(bots, "rev-parse", "--short", "HEAD") == world["a"] and git(world["engine"], "rev-parse", "--short", "HEAD") == world["e1"]
    kept_in_effect(world)
    assert "Keep it short.\n" in (bots / "the-ceo/persona.md").read_text()                   # version A's text again
    assert json.loads((bots / "common-data/local/last-update.json").read_text())["result"] == "rolled-back"
    assert "can't open file" not in r.stderr + r.stdout and "done" in r.stdout
    r = update(world, "--rollback")                                                         # a second rollback goes nowhere
    assert r.returncode == 0 and git(bots, "rev-parse", "--short", "HEAD") == world["a"]


def test_the_old_check_name_gives_the_one_answer():
    text = (HERE / "check-setup.sh").read_text()
    assert "exec python3 scripts/setup-check.py" in text and "for k in" not in text


def test_an_old_checkout_takes_its_first_update_from_a_pipe_and_can_roll_it_back(tmp_path, monkeypatch):
    w = _make(tmp_path, monkeypatch, steps_in_a=False)
    bots = w["bots"]
    git(bots, "fetch", "-q", "starter")
    new = git(bots, "show", "starter/fleet:scripts/update.sh")
    r = subprocess.run(["sh", "-s"], input=new + "\n", cwd=bots, capture_output=True, text=True, env=dict(w["env"], RAMEN_FLEET=str(bots)))
    assert r.returncode == 0, r.stdout + r.stderr
    assert git(bots, "rev-parse", "--short", "HEAD") == w["b"]
    kept_in_effect(w)
    r = update(w, "--rollback")
    assert r.returncode == 0, r.stdout + r.stderr
    assert git(bots, "rev-parse", "--short", "HEAD") == w["a"] and not (bots / "scripts/update_steps.py").exists()
    kept_in_effect(w)
    assert json.loads((bots / "common-data/local/last-update.json").read_text())["result"] == "rolled-back"
