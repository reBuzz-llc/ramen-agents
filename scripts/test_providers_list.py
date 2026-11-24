"""common-data/providers.json and docs/updates.json stay true to the scripts a person and their code agent run.

The provider list must agree with the places that name a key today: the model chain in web-bots.toml, the key script's
providers (add-key.sh) and the setup check's lists (setup-check.py). The updates file must stay one entry per line, so
`git diff HEAD starter/fleet -- docs/updates.json` shows exactly the new entries. Reads files only.
"""
from __future__ import annotations

import ast
import json
import re
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PROVIDERS = json.loads((ROOT / "common-data" / "providers.json").read_text(encoding="utf-8"))["providers"]
UPDATES_TEXT = (ROOT / "docs" / "updates.json").read_text(encoding="utf-8")
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _setup_check_lists() -> dict[str, list[str]]:
    tree = ast.parse((ROOT / "scripts" / "setup-check.py").read_text(encoding="utf-8"))
    out: dict[str, list[str]] = {}
    for node in tree.body:
        if isinstance(node, ast.Assign) and isinstance(node.targets[0], ast.Name) and node.targets[0].id in ("MODEL_KEYS", "OPTIONAL_KEYS"):
            out[node.targets[0].id] = [t[0] for t in ast.literal_eval(node.value)]
    return out


def _add_key_names() -> set[str]:
    text = (ROOT / "scripts" / "add-key.sh").read_text(encoding="utf-8")
    body = text.split('case "$name" in', 1)[1].split("esac", 1)[0]
    return {m for m in re.findall(r"^\s*([a-z][a-z0-9-]*)\)", body, re.M)}


def _web_bots() -> dict:
    return tomllib.loads((ROOT / "common-data" / "configs" / "web-bots.toml").read_text(encoding="utf-8"))["model"]


def _names(**match: str) -> set[str]:
    return {p["name"] for p in PROVIDERS if all(p[k] == v for k, v in match.items())}


def test_each_entry_is_complete():
    names = [p["name"] for p in PROVIDERS]
    assert len(names) == len(set(names))
    for p in PROVIDERS:
        assert p["use"] in ("model", "email-check", "search", "board"), p
        assert p["status"] in ("chain", "opt-in", "removed"), p
        assert p["key_file"] == f"{p['name']}.key", p
        assert isinstance(p["free"], bool), p
        assert p["add_key"] in ("", f"sh scripts/add-key.sh {p['name']}"), p
        assert DATE.match(p["added"]) and DATE.match(p["changed"]) and p["added"] <= p["changed"], p
        assert p["card"].strip(), p


def test_the_chain_is_the_config_chain_and_only_free():
    model = _web_bots()
    assert _names(status="chain") == set(model["provider_chain"])
    assert all(p["free"] for p in PROVIDERS if p["status"] == "chain")
    assert all(p["use"] == "model" for p in PROVIDERS if p["status"] == "chain")


def test_every_model_provider_in_the_config_is_listed():
    model = _web_bots()
    # Gemini has no [model.providers] table: it is read through gemini_api_key_file
    configured = set(model.get("providers", {})) | set(model["provider_chain"]) | {"gemini"}
    assert _names(use="model") == configured


def test_the_key_script_takes_exactly_the_listed_commands():
    assert {p["name"] for p in PROVIDERS if p["add_key"]} == _add_key_names()


def test_the_setup_check_names_the_same_keys():
    lists = _setup_check_lists()
    assert set(lists["MODEL_KEYS"]) == _names(status="chain")
    assert set(lists["OPTIONAL_KEYS"]) == _names(use="email-check")


def test_updates_are_one_entry_per_line_newest_first():
    entries = json.loads(UPDATES_TEXT)["entries"]
    lines = [ln for ln in UPDATES_TEXT.splitlines() if ln.strip().startswith('{"date"')]
    assert len(lines) == len(entries) > 0
    for ln, e in zip(lines, entries):
        assert json.loads(ln.strip().rstrip(",")) == e
        assert set(e) == {"date", "kind", "line", "step"}, e
        assert DATE.match(e["date"]), e
        assert e["kind"] in ("key", "provider", "feature", "removed", "your-step"), e
        assert e["line"].strip(), e
    dates = [e["date"] for e in entries]
    assert dates == sorted(dates, reverse=True)


def test_every_step_names_a_script_that_exists():
    for e in json.loads(UPDATES_TEXT)["entries"]:
        if not e["step"]:
            continue
        m = re.match(r"^sh (scripts/[\w.-]+\.sh)\b", e["step"]) or re.match(r"^python3 (scripts/[\w.-]+\.py)\b", e["step"])
        assert m and (ROOT / m.group(1)).is_file(), e
        if e["step"].startswith("sh scripts/add-key.sh "):
            assert e["step"].split()[-1] in _add_key_names(), e
