"""Several bots, one codebase: bot folders, rendered launch agents, and the listing."""
from __future__ import annotations

import plistlib
from pathlib import Path

import pytest

from explorer import fleet
from explorer.config import load_config


@pytest.fixture(autouse=True)
def _default_label_prefix(monkeypatch):
    """The labels asserted below use the engine's default prefix, whatever this machine's
    ~/.config/ramen-agents/label-prefix or $BOT_LABEL_PREFIX says (2026-10-14)."""
    monkeypatch.setattr(fleet, "LABEL_PREFIX", "com.ramen-agents.bot.")


def test_slug_and_label():
    assert fleet.slug("Sample-Bot") == "sample-bot"
    assert fleet.slug("  The CEO!! ") == "the-ceo"
    assert fleet.label_for("Sample-Bot") == "com.ramen-agents.bot.sample-bot"


def test_render_plist_fills_every_token_and_is_valid(tmp_path: Path):
    text = fleet.render_plist(
        "com.ramen-agents.bot.test", Path("/code"), tmp_path / "config.toml", tmp_path / "workspace", tmp_path / "logs"
    )
    data = plistlib.loads(text.encode())
    assert data["Label"] == "com.ramen-agents.bot.test"
    assert data["ProgramArguments"][-1] == "/code/scripts/supervise.sh"
    env = data["EnvironmentVariables"]
    assert env["EXPLORER_HOME"] == "/code"
    assert env["EXPLORER_CONFIG"] == str(tmp_path / "config.toml")
    assert env["EXPLORER_WORKSPACE"] == str(tmp_path / "workspace")
    assert data["ProcessType"] == "Background" and data["Nice"] == 10
    assert data["KeepAlive"] == {"SuccessfulExit": False}
    assert "{{" not in text


def test_new_bot_makes_a_loadable_config_with_persona_and_denylist(tmp_path: Path):
    folder = fleet.new_bot("The CEO", tmp_path / "bots", persona="ceo", port=8790)
    assert folder == tmp_path / "bots" / "the-ceo"
    cfg = load_config(folder / "config.toml")
    assert cfg.agent.name == "The CEO"
    assert cfg.agent.mode == "web" and cfg.model.provider == "ollama"
    assert cfg.agent.persona_file == "persona.md" and (folder / "persona.md").read_text().startswith("You are the CEO")
    assert cfg.dashboard.port == 8790
    assert cfg.quiet.enabled
    assert cfg.path(cfg.policy.denylist_file).exists()
    assert (Path(cfg.browser.fake_web_dir) / "index.html").exists()
    assert cfg.tasks.enabled is True and cfg.leads.portal_url == "http://127.0.0.1:3000"   # the local board by default
    assert "running a small company" in cfg.agent.seed_interests
    assert cfg.workspace == folder / "workspace"

    explorer = fleet.new_bot("Sample-Bot", tmp_path / "bots", persona="explorer", port=8787)
    cfg2 = load_config(explorer / "config.toml")
    assert "[notion]" not in (explorer / "config.toml").read_text() and "[tasks]" not in (explorer / "config.toml").read_text()
    assert cfg2.agent.cycle_delay_seconds == 20

    with pytest.raises(FileExistsError):
        fleet.new_bot("The CEO", tmp_path / "bots", persona="ceo", port=8790)
    with pytest.raises(ValueError):
        fleet.new_bot("X", tmp_path / "bots", persona="pirate", port=1)


def test_installed_bots_reads_the_launch_agents(tmp_path: Path):
    agents = tmp_path / "LaunchAgents"
    agents.mkdir()
    for name, port in (("Sample-Bot", 8787), ("The CEO", 8788)):
        label = fleet.label_for(name)
        (agents / f"{label}.plist").write_text(
            fleet.render_plist(label, Path("/code"), tmp_path / name / "config.toml", tmp_path / name / "workspace", tmp_path / "logs")
        )
    (agents / "com.ramen-agents.ollama.plist").write_text("<plist version='1.0'><dict></dict></plist>")
    (agents / "com.ramen-agents.bot.broken.plist").write_text("not a plist")
    bots = fleet.installed_bots(agents)
    assert [b["label"] for b in bots] == ["com.ramen-agents.bot.sample-bot", "com.ramen-agents.bot.the-ceo"]
    assert bots[1]["config"] == str(tmp_path / "The CEO" / "config.toml")


def shared_layout(parent: Path) -> Path:
    """A ~/bots-style parent with common-data/configs like the owner's, but self-contained."""
    configs = parent / "common-data" / "configs"
    configs.mkdir(parents=True)
    denylist = parent / "common-data" / "denylist.txt"
    denylist.write_text("example.invalid\n")
    fake_web = fleet.CODE_ROOT / "workspace" / "fake_web"
    (configs / "common.toml").write_text(
        f'[agent]\nmode = "web"\npersona_file = "persona.md"\n\n[browser]\nfake_web_dir = "{fake_web}"\n\n'
        f'[policy]\ndenylist_file = "{denylist}"\n\n[quiet]\nenabled = true\n'
        # A shared file that would hand every bot a cloud model: the Tor bot must still stay local.
        '\n[model]\nprovider = "remote"\nprovider_chain = ["groq"]\n\n[model.providers.groq]\n'
        'base_url = "https://api.groq.com/openai/v1"\nmodel = "m"\n'
    )
    (configs / "web-bots.toml").write_text('extends = "common.toml"\n\n[agent]\ncontact = "https://example.com"\n')
    return parent


def test_new_bot_in_the_shared_layout_extends_instead_of_repeating(tmp_path: Path):
    parent = shared_layout(tmp_path / "bots")
    folder = fleet.new_bot("The CEO", parent, persona="ceo", port=8790)
    text = (folder / "config.toml").read_text()
    assert 'extends = "../common-data/configs/web-bots.toml"' in text
    for repeated in ("mode =", "persona_file =", "fake_web_dir =", "denylist_file =", "[quiet]", 'provider = "ollama"'):
        assert repeated not in text, repeated
    assert not (folder / "workspace" / "denylist.txt").exists()  # the shared denylist is used instead
    cfg = load_config(folder / "config.toml")
    assert cfg.agent.contact == "https://example.com" and cfg.model.provider == "remote"
    assert cfg.path(cfg.policy.denylist_file) == parent / "common-data" / "denylist.txt"
    assert cfg.leads.portal_key_file.endswith("/portal-engine.key")
    assert cfg.dashboard.port == 8790 and cfg.agent.name == "The CEO"


