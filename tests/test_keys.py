"""Keys: env first, then the key file; defaults live in the shared keys folder."""
from __future__ import annotations

from pathlib import Path

import pytest

from explorer.common.keys import key_file, keys_dir, load_key
from explorer.config import BrowserConfig, ModelConfig, NotionConfig, PublishConfig
from explorer.model import provider_config
from explorer.search import load_marginalia_api_key


def test_env_wins_over_the_file(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    f = tmp_path / "groq.key"
    f.write_text("from-file\n")
    monkeypatch.setenv("GROQ_API_KEY", " from-env ")
    assert load_key("GROQ_API_KEY", f) == "from-env"
    monkeypatch.delenv("GROQ_API_KEY")
    assert load_key("GROQ_API_KEY", f) == "from-file"


def test_missing_or_empty_file_gives_none(tmp_path: Path) -> None:
    empty = tmp_path / "empty.key"
    empty.write_text("  \n")
    assert load_key(None, empty) is None
    assert load_key(None, tmp_path / "nope.key") is None
    assert load_key(None, "") is None
    assert load_key(None, None) is None


def test_defaults_point_into_the_keys_folder(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("EXPLORER_KEYS_DIR", str(tmp_path))
    assert keys_dir() == tmp_path
    assert key_file("groq") == str(tmp_path / "groq.key")
    assert ModelConfig().gemini_api_key_file == str(tmp_path / "gemini.key")
    assert BrowserConfig().marginalia_api_key_file == str(tmp_path / "marginalia.key")
    assert PublishConfig().git_token_file == str(tmp_path / "github.key")
    assert NotionConfig().api_key_file == str(tmp_path / "notion.key")
    cfg = ModelConfig(providers={"cerebras": {"base_url": "https://x/v1", "model": "m"}})
    assert provider_config("cerebras", cfg).api_key_file == str(tmp_path / "cerebras.key")


def test_marginalia_falls_back_to_the_public_key(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("MARGINALIA_API_KEY", raising=False)
    monkeypatch.setenv("EXPLORER_KEYS_DIR", str(tmp_path))
    assert load_marginalia_api_key() == "public"
    (tmp_path / "marginalia.key").write_text("personal")
    assert load_marginalia_api_key() == "personal"
