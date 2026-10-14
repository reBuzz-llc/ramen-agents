"""Several bots, one codebase: bot folders, rendered launch agents, and the listing."""
from __future__ import annotations

import plistlib
from pathlib import Path

import pytest

from explorer import fleet
from explorer.config import load_config


@pytest.fixture(autouse=True)
def _default_label_prefix(monkeypatch):
    """The label prefix comes from $BOT_LABEL_PREFIX or ~/.config/ramen-agents/label-prefix on a real machine; these
    tests pin the default so they pass the same everywhere."""
    monkeypatch.setattr(fleet, "LABEL_PREFIX", "com.ramen-agents.bot.")


def test_slug_and_label():
    assert fleet.slug("Jobless-Bot") == "jobless-bot"
    assert fleet.slug("  The CEO!! ") == "the-ceo"
    assert fleet.label_for("Jobless-Bot") == "com.ramen-agents.bot.jobless-bot"


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
    assert cfg.notion.enabled is False and cfg.notion.database_id == ""
    assert "running a small company" in cfg.agent.seed_interests
    assert cfg.workspace == folder / "workspace"

    explorer = fleet.new_bot("Jobless-Bot", tmp_path / "bots", persona="explorer", port=8787)
    cfg2 = load_config(explorer / "config.toml")
    assert "[notion]" not in (explorer / "config.toml").read_text()
    assert cfg2.agent.cycle_delay_seconds == 20

    with pytest.raises(FileExistsError):
        fleet.new_bot("The CEO", tmp_path / "bots", persona="ceo", port=8790)
    with pytest.raises(ValueError):
        fleet.new_bot("X", tmp_path / "bots", persona="pirate", port=1)


def test_installed_bots_reads_the_launch_agents(tmp_path: Path):
    agents = tmp_path / "LaunchAgents"
    agents.mkdir()
    for name, port in (("Jobless-Bot", 8787), ("The CEO", 8788)):
        label = fleet.label_for(name)
        (agents / f"{label}.plist").write_text(
            fleet.render_plist(label, Path("/code"), tmp_path / name / "config.toml", tmp_path / name / "workspace", tmp_path / "logs")
        )
    (agents / "com.ramen-agents.ollama.plist").write_text("<plist version='1.0'><dict></dict></plist>")
    (agents / "com.ramen-agents.bot.broken.plist").write_text("not a plist")
    bots = fleet.installed_bots(agents)
    assert [b["label"] for b in bots] == ["com.ramen-agents.bot.jobless-bot", "com.ramen-agents.bot.the-ceo"]
    assert bots[1]["config"] == str(tmp_path / "The CEO" / "config.toml")


def test_researcher_persona_makes_a_tor_only_local_model_bot(tmp_path: Path):
    folder = fleet.new_bot("Onion Reader", tmp_path / "bots", persona="researcher", port=8789)
    cfg = load_config(folder / "config.toml")
    assert cfg.browser.backend == "tor" and cfg.browser.tor_proxy.startswith("socks5h://")
    assert cfg.model.provider == "ollama"  # onion page text never goes to a cloud provider
    assert cfg.policy.allowlist_file == "workspace/allowed_hosts.txt"
    assert cfg.policy.pages_per_hour == 30 and cfg.policy.per_domain_delay_seconds == 20
    assert cfg.browser.search_engines == []  # validate() forbids clearnet engines on the tor backend
    assert (folder / "persona.md").read_text().startswith("You study the Tor onion web")
    assert "onion-directory" in (folder / "config.toml").read_text()


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
    assert cfg.notion.api_key_file.endswith("/notion.key")
    assert cfg.dashboard.port == 8790 and cfg.agent.name == "The CEO"


def test_researcher_in_the_shared_layout_keeps_its_model_local(tmp_path: Path):
    parent = shared_layout(tmp_path / "bots")
    folder = fleet.new_bot("Onion Reader", parent, persona="researcher", port=8789)
    text = (folder / "config.toml").read_text()
    assert 'extends = "../common-data/configs/common.toml"' in text
    cfg = load_config(folder / "config.toml")
    assert cfg.model.provider == "ollama"  # written explicitly, so the shared remote chain never applies
    assert cfg.browser.backend == "tor" and cfg.policy.allowlist_file == "workspace/allowed_hosts.txt"
    assert not (folder / "workspace" / "denylist.txt").exists()
