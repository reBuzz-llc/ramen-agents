"""Every agent folder the starter ships is on the family card, by full name and handle, and every persona names the whole family."""
from __future__ import annotations

import tomllib
from pathlib import Path

import pytest

import family

ROOT = Path(__file__).resolve().parents[2]
CARD = (ROOT / "common-data" / "family.md").read_text(encoding="utf-8")
HANDLES = {name: handle for name, (handle, _) in family._FALLBACK.items()}


def _folders() -> list[Path]:
    return sorted(p.parent for p in ROOT.glob("*/persona.md") if (p.parent / "config.toml").is_file())


def _name(folder: Path) -> str:
    return tomllib.loads((folder / "config.toml").read_text(encoding="utf-8"))["agent"]["name"]


def test_the_starter_ships_the_six_folders():
    assert [p.name for p in _folders()] == ["lead-gen", "package-designer", "research-analyst", "scout", "the-ceo", "validator"]


@pytest.mark.parametrize("folder", _folders(), ids=lambda p: p.name)
def test_each_agent_folder_is_on_the_family_card(folder):
    name = _name(folder)
    assert name in CARD
    assert f"{HANDLES[name]} = {name}" in " ".join(CARD.split())


def test_the_card_counts_five_agents_and_a_validator():
    assert "five AI agents" in CARD and "a Validator that checks their work" in " ".join(CARD.split())


@pytest.mark.parametrize("folder", _folders(), ids=lambda p: p.name)
def test_each_persona_names_the_whole_family(folder):
    text = (folder / "persona.md").read_text(encoding="utf-8")
    for handle in HANDLES.values():
        assert handle in text, f"{folder.name} leaves out {handle}"
