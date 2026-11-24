"""add-key.sh and setup-check.py read their providers from common-data/providers.json (947).

add-key.sh runs in a temporary copy of the repository, with the key on stdin (no terminal: every question is a no), and
only for providers with no free read, so no test calls a provider. The key test itself is checked with the network
stubbed: a free read with the key in a header, never in a printed line.
"""
from __future__ import annotations

import importlib.util
import json
import os
import shutil
import subprocess
import sys
import urllib.error
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
KEY = "-".join(["made", "up", "z" * 26])  # built here, so no file holds a key-shaped string


@pytest.fixture()
def root(tmp_path: Path) -> Path:
    (tmp_path / "scripts").mkdir()
    for f in ("add-key.sh", "setup-check.py", "gemini_choice.py"):
        shutil.copy(HERE / f, tmp_path / "scripts" / f)
    (tmp_path / "common-data" / "configs").mkdir(parents=True)
    shutil.copy(HERE.parent / "common-data" / "providers.json", tmp_path / "common-data" / "providers.json")
    shutil.copy(HERE.parent / "common-data" / "configs" / "web-bots.toml", tmp_path / "common-data" / "configs" / "web-bots.toml")
    return tmp_path


def add_key(root: Path, name: str, stdin: str = KEY + "\n") -> subprocess.CompletedProcess:
    return subprocess.run(["sh", "scripts/add-key.sh", name], cwd=root, input=stdin, text=True, capture_output=True,
                          env={**os.environ, "HOME": str(root), "RAMEN_ENGINE": str(root / "no-engine")}, timeout=60)


def entry(name: str) -> dict:
    return next(p for p in json.loads((HERE.parent / "common-data" / "providers.json").read_text())["providers"] if p["name"] == name)


def test_a_usable_free_key_is_saved_private_and_never_shown(root):
    res = add_key(root, "sniffmail")
    f = root / "common-data" / "keys" / "sniffmail.key"
    assert res.returncode == 0, res.stdout + res.stderr
    assert f.read_text().strip() == KEY and oct(f.stat().st_mode & 0o777) == "0o600"
    assert "saved, not tested" in res.stdout and KEY not in res.stdout + res.stderr
    assert "Make the Sniffmail key yourself, at: https://sniffmail.io" in res.stdout


@pytest.mark.parametrize("name,said", [
    ("openai", "OpenAI is marked unusable (by the owner, 2026-11-18): Asks for a card."),
    ("cohere", "Cohere was set aside by the maintainers (2026-11-06): Asked for a card."),
])
def test_a_marked_provider_shows_its_reason_and_without_a_yes_saves_nothing(root, name, said):
    res = add_key(root, name)
    assert res.returncode == 0 and said in res.stdout and "No key saved." in res.stdout
    assert not (root / "common-data" / "keys" / f"{name}.key").exists()


def test_a_provider_that_is_not_free_says_so_and_without_a_yes_saves_nothing(root):
    assert entry("speka")["free"] is False and entry("speka")["mark"] == "usable"
    res = add_key(root, "speka")
    assert "needs a card or payment" in res.stdout and "No key saved." in res.stdout
    assert not (root / "common-data" / "keys" / "speka.key").exists()


@pytest.mark.parametrize("name", ["nope", "notion", "cloudflare-workers-ai", "../keys", "Zai"])
def test_an_unknown_name_or_one_that_takes_no_key_saves_nothing(root, name):
    res = add_key(root, name)
    assert res.returncode == 2 and not (root / "common-data" / "keys").exists()


def test_the_list_is_every_name_that_takes_a_key(root):
    res = add_key(root, "--list", "")
    names = set(res.stdout.strip().split(", "))
    want = {p["name"] for p in json.loads((root / "common-data" / "providers.json").read_text())["providers"] if p["add_key"]}
    assert res.returncode == 0 and names == want and "zai" in names and "notion" not in names


def test_with_nothing_pasted_the_lines_before_the_key_still_show_and_nothing_is_saved(root):
    res = add_key(root, "bytez", "")   # nothing pasted: the lines before the key still show
    assert "Make the Bytez key yourself" in res.stdout and res.returncode == 1


# ---- the key test, with the network stubbed --------------------------------------------------------------------------------

def setup_check(root: Path, monkeypatch):
    monkeypatch.setenv("RAMEN_ROOT", str(root))
    spec = importlib.util.spec_from_file_location("setup_check_947", root / "scripts" / "setup-check.py")
    mod = importlib.util.module_from_spec(spec)
    monkeypatch.setattr(sys, "argv", ["setup-check.py"])
    spec.loader.exec_module(mod)
    return mod


class Answer:
    status = 200

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def save(root: Path, name: str) -> None:
    keys = root / "common-data" / "keys"
    keys.mkdir(parents=True, exist_ok=True)
    (keys / f"{name}.key").write_text(KEY + "\n")
    os.chmod(keys / f"{name}.key", 0o600)


def test_a_key_test_is_the_entrys_free_read_with_the_key_in_a_header(root, monkeypatch):
    sc = setup_check(root, monkeypatch)
    save(root, "groq")
    seen = []
    monkeypatch.setattr(sc.urllib.request, "urlopen", lambda req, timeout=0: (seen.append(req), Answer())[1])
    line = sc.test_key_line("groq")
    assert line.startswith("  ok groq:") and KEY not in line
    req = seen[0]
    assert req.full_url == entry("groq")["test"]["url"] and KEY not in req.full_url
    assert req.get_header("Authorization") == f"Bearer {KEY}" and req.get_method() == "GET"


def test_a_query_key_goes_only_where_the_entry_says_and_a_refusal_reads_refused(root, monkeypatch):
    sc = setup_check(root, monkeypatch)
    save(root, "quickemailverification")

    def refuse(req, timeout=0):
        assert "apikey=" in req.full_url and entry("quickemailverification")["test"]["auth"] == "query:apikey"
        raise urllib.error.HTTPError(req.full_url, 401, "no", {}, None)
    monkeypatch.setattr(sc.urllib.request, "urlopen", refuse)
    line = sc.test_key_line("quickemailverification")
    assert "the key is refused (401)" in line and KEY not in line and "apikey" not in line


def test_no_free_read_means_saved_not_tested_and_no_call(root, monkeypatch):
    sc = setup_check(root, monkeypatch)
    save(root, "sniffmail")
    monkeypatch.setattr(sc.urllib.request, "urlopen", lambda *a, **k: pytest.fail("no call for a provider with no free read"))
    assert "saved, not tested" in sc.test_key_line("sniffmail")


def test_the_setup_checks_lists_come_from_the_file(root, monkeypatch):
    sc = setup_check(root, monkeypatch)
    chain = [p["name"] for p in json.loads((root / "common-data" / "providers.json").read_text())["providers"] if p["status"] == "chain"]
    assert [k[0] for k in sc.MODEL_KEYS] == chain
    optional = {k[0] for k in sc.OPTIONAL_KEYS}
    for p in json.loads((root / "common-data" / "providers.json").read_text())["providers"]:
        if p["name"] in optional:
            assert p["mark"] == "usable" and p["free"] and p["add_key"], p["name"]
        if p["mark"] in (None, "unusable", "rejected"):
            assert p["name"] not in optional, f"{p['name']} is never suggested"
    assert {"quickemailverification", "sniffmail", "tavily", "langsearch"} <= optional
    assert "dahl" not in optional, "a model provider the config cannot call is never suggested"
