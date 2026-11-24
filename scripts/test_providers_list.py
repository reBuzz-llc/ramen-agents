"""common-data/providers.json is the one list of providers, and docs/updates.json stays one entry per line.

The Providers page, add-key.sh and setup-check.py all read providers.json; this checks that each entry is complete and
honest about who judged it (only the owner's tested verdicts are "unusable"; the maintainers' judgements on paper are
"rejected"; an unjudged entry carries what its own page says), that a key test is always a free read, that the chain is the
config's chain, and that the scripts read the file instead of a list of their own. The updates file must stay one entry
per line, so `git diff HEAD starter/fleet -- docs/updates.json` shows exactly the new entries. Reads files only.
"""
from __future__ import annotations

import json
import re
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PROVIDERS = json.loads((ROOT / "common-data" / "providers.json").read_text(encoding="utf-8"))["providers"]
UPDATES_TEXT = (ROOT / "docs" / "updates.json").read_text(encoding="utf-8")
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
AUTH = re.compile(r"^(bearer|x-api-key|header:[A-Za-z0-9-]{1,40}|query:[A-Za-z0-9_]{1,40})$")


def _web_bots() -> dict:
    return tomllib.loads((ROOT / "common-data" / "configs" / "web-bots.toml").read_text(encoding="utf-8"))["model"]


def _names(**match: object) -> set[str]:
    return {p["name"] for p in PROVIDERS if all(p[k] == v for k, v in match.items())}


def test_each_entry_is_complete():
    names = [p["name"] for p in PROVIDERS]
    assert len(names) == len(set(names))
    for p in PROVIDERS:
        assert re.match(r"^[a-z0-9][a-z0-9-]{1,40}$", p["name"]), p
        assert p["use"] in ("model", "email-check", "search", "tool", "board"), p
        assert p["status"] in ("chain", "opt-in", "removed"), p
        assert p["key_file"] == f"{p['name']}.key", p
        assert isinstance(p["free"], bool), p
        assert p["add_key"] in ("", f"sh scripts/add-key.sh {p['name']}"), p
        assert DATE.match(p["added"]) and DATE.match(p["changed"]) and p["added"] <= p["changed"], p
        assert p["where"] == "" or p["where"].startswith("https://"), p


def test_each_mark_says_who_judged_it_when_and_why():
    for p in PROVIDERS:
        mark = p["mark"]
        assert mark in (None, "usable", "unusable", "rejected"), p
        if mark is None:
            assert p["mark_by"] == "" and p["mark_date"] == "" and p["mark_note"] == "", p
            assert p["card"].strip() or p["status"] == "removed", f"{p['name']}: an unjudged entry carries what its page says"
            continue
        assert DATE.match(p["mark_date"]), p
        assert p["mark_by"] == {"unusable": "owner", "rejected": "maintainers"}.get(mark, p["mark_by"]), p
        assert p["mark_by"] in ("owner", "maintainers"), p
        if mark in ("unusable", "rejected"):
            assert p["mark_note"].strip(), f"{p['name']}: a provider marked {mark} ships with its reason"


def test_a_key_test_is_a_free_read_over_https_or_none():
    for p in PROVIDERS:
        t = p["test"]
        assert t["kind"] in ("models", "none"), p
        if t["kind"] == "models":
            assert t["url"].startswith("https://") and AUTH.match(t["auth"]), p
            assert not re.search(r"/(chat/)?completions|/generate|/search|/correct|/scrape", t["url"]), f"{p['name']}: a test never spends"


def test_the_chain_is_the_config_chain_free_and_usable():
    model = _web_bots()
    assert _names(status="chain") == set(model["provider_chain"])
    for p in PROVIDERS:
        if p["status"] == "chain":
            assert p["free"] and p["use"] == "model" and p["mark"] == "usable", p


def test_every_model_provider_in_the_config_is_listed():
    model = _web_bots()
    configured = set(model.get("providers", {})) | set(model["provider_chain"]) | {"gemini"}  # Gemini has no providers table
    assert configured <= _names(use="model")


def test_the_key_script_and_the_setup_check_read_this_file():
    for script in ("scripts/add-key.sh", "scripts/setup-check.py"):
        assert "providers.json" in (ROOT / script).read_text(encoding="utf-8"), f"{script} reads common-data/providers.json"


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
            assert e["step"].split()[-1] in _names(), e


def test_the_free_tiers_page_table_is_what_the_list_says():
    import subprocess
    import sys

    res = subprocess.run([sys.executable, str(ROOT / "scripts" / "providers_table.py"), "--check"], capture_output=True, text=True)
    assert res.returncode == 0, res.stdout
