"""The quickstart commands (2026-10-14): `bot new --fake` makes a bot that runs with no key and no network, and
`bot demo` runs it and prints its steps and journal entry."""
from __future__ import annotations

from pathlib import Path

from explorer.cli import main
from explorer.config import load_config


def test_new_fake_writes_a_bot_that_needs_no_key(tmp_path: Path, capsys):
    assert main(["new", "My Explorer", "--fake", "--dir", str(tmp_path)]) == 0
    folder = tmp_path / "my-explorer"
    cfg = load_config(folder / "config.toml")
    assert cfg.agent.mode == "fake"
    assert cfg.model.provider == "fake" and cfg.model.provider_chain == []
    assert Path(cfg.browser.fake_web_dir).is_absolute() and (Path(cfg.browser.fake_web_dir) / "index.html").exists()
    assert (folder / "persona.md").read_text().startswith("<!-- Fake mode")
    assert "demo" in capsys.readouterr().out


def test_demo_runs_a_session_end_to_end(tmp_path: Path, capsys):
    main(["new", "My Explorer", "--fake", "--dir", str(tmp_path)])
    capsys.readouterr()
    config = tmp_path / "my-explorer" / "config.toml"
    assert main(["--config", str(config), "demo"]) == 0
    out = capsys.readouterr().out
    steps = [line for line in out.splitlines() if line.startswith("step ")]
    assert len([s for s in steps if s.endswith("allowed") or "-> allowed" in s]) >= 3
    assert any("summarize -> allowed" in s for s in steps)  # one whole session
    assert "journal (" in out
    journals = list((tmp_path / "my-explorer" / "workspace" / "journal").glob("*.md"))
    assert journals and "Episode 1" in journals[0].read_text()


def test_demo_ignores_a_real_model_in_the_config(tmp_path: Path, capsys):
    """Whatever the config names, the demo uses the fake model and fake web: it never reaches a provider."""
    main(["new", "My Explorer", "--fake", "--dir", str(tmp_path)])
    config = tmp_path / "my-explorer" / "config.toml"
    config.write_text(config.read_text().replace('provider = "fake"', 'provider = "ollama"'))
    capsys.readouterr()
    assert main(["--config", str(config), "demo", "--steps", "3"]) == 0
    assert capsys.readouterr().out.count("step ") == 3


def test_label_prefix_comes_from_env_then_file_then_default(tmp_path, monkeypatch):
    """The owner's family keeps its launchd labels under a prefix the engine no longer hard-codes (2026-10-14)."""
    from explorer import fleet

    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.delenv("BOT_LABEL_PREFIX", raising=False)
    assert fleet._label_prefix() == "com.ramen-agents.bot."
    (tmp_path / ".config" / "ramen-agents").mkdir(parents=True)
    (tmp_path / ".config" / "ramen-agents" / "label-prefix").write_text("com.example.bot")
    assert fleet._label_prefix() == "com.example.bot."
    monkeypatch.setenv("BOT_LABEL_PREFIX", "com.other.bot.")
    assert fleet._label_prefix() == "com.other.bot."
