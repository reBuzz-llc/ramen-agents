"""A bot config can pull shared settings from other files with a top-level `extends`."""
from __future__ import annotations

from pathlib import Path

import pytest

from explorer.config import load_config


def write(path: Path, text: str) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return path


def test_shared_values_apply_and_the_bot_wins(tmp_path: Path) -> None:
    write(tmp_path / "common" / "models.toml", '[model]\nprovider = "ollama"\nname = "shared-model"\ntemperature = 0.2\n')
    cfg_path = write(
        tmp_path / "bot" / "config.toml",
        'extends = "../common/models.toml"\n\n[agent]\nname = "Bot"\n\n[model]\ntemperature = 0.9\n',
    )
    cfg = load_config(cfg_path)
    assert cfg.agent.name == "Bot"
    assert cfg.model.provider == "ollama"
    assert cfg.model.name == "shared-model"
    assert cfg.model.temperature == 0.9  # the bot's own value wins
    assert cfg.root == (tmp_path / "bot").resolve()  # relative paths still resolve against the bot


def test_several_files_merge_in_order_and_nested_tables_merge(tmp_path: Path) -> None:
    write(tmp_path / "a.toml", '[model.providers.groq]\nbase_url = "https://a.example/v1"\nmodel = "m-a"\ncalls_per_day = 5\n')
    write(tmp_path / "b.toml", '[model.providers.groq]\nmodel = "m-b"\n')
    cfg_path = write(tmp_path / "bot" / "config.toml", 'extends = ["../a.toml", "../b.toml"]\n\n[model]\nprovider = "ollama"\n')
    groq = load_config(cfg_path).model.providers["groq"]
    assert groq == {"base_url": "https://a.example/v1", "model": "m-b", "calls_per_day": 5}


def test_arrays_replace_rather_than_append(tmp_path: Path) -> None:
    write(tmp_path / "shared.toml", '[quiet]\napps = ["Steam", "Epic Games Launcher"]\n')
    cfg_path = write(tmp_path / "bot" / "config.toml", 'extends = "../shared.toml"\n\n[quiet]\napps = ["Minecraft"]\n')
    assert load_config(cfg_path).quiet.apps == ["Minecraft"]


def test_a_shared_file_can_extend_another(tmp_path: Path) -> None:
    write(tmp_path / "base.toml", '[agent]\nmode = "web"\n')
    write(tmp_path / "web.toml", 'extends = "base.toml"\n\n[agent]\ncontact = "https://example.com"\n')
    cfg = load_config(write(tmp_path / "bot" / "config.toml", 'extends = "../web.toml"\n'))
    assert (cfg.agent.mode, cfg.agent.contact) == ("web", "https://example.com")


def test_unknown_keys_in_a_shared_file_are_still_rejected(tmp_path: Path) -> None:
    write(tmp_path / "shared.toml", "[model]\nno_such_key = 1\n")
    with pytest.raises(ValueError, match="unknown keys in \\[model\\]"):
        load_config(write(tmp_path / "bot" / "config.toml", 'extends = "../shared.toml"\n'))


def test_missing_file_and_loops_are_clear_errors(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="does not exist"):
        load_config(write(tmp_path / "bot" / "config.toml", 'extends = "../nope.toml"\n'))
    write(tmp_path / "x.toml", 'extends = "y.toml"\n')
    write(tmp_path / "y.toml", 'extends = "x.toml"\n')
    with pytest.raises(ValueError, match="extends loop"):
        load_config(write(tmp_path / "loop" / "config.toml", 'extends = "../x.toml"\n'))


def test_extends_must_be_paths(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="must be a path or a list of paths"):
        load_config(write(tmp_path / "bot" / "config.toml", "extends = 3\n"))


def test_agent_tags_load_and_default_empty(tmp_path: Path) -> None:
    # default: no tags
    cfg = load_config(write(tmp_path / "plain" / "config.toml", '[agent]\nname = "Plain"\n'))
    assert cfg.agent.tags == []
    # a notion_writer bot declares the marker
    tagged = load_config(write(tmp_path / "ceo" / "config.toml", '[agent]\nname = "The CEO"\ntags = ["notion_writer"]\n'))
    assert tagged.agent.tags == ["notion_writer"]
