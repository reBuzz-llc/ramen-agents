"""the desktop agent, the blog-post publish action, the interest action and
messaging.route_only_peers are gone; an old config naming them still loads, and none of them is offered."""
from explorer import prompts
from explorer.actions import ALL_TYPES
from explorer.config import load_config


def test_an_old_config_with_the_retired_sections_keys_and_actions_still_loads(tmp_path):
    p = tmp_path / "config.toml"
    p.write_text('[agent]\nname = "Old Bot"\nmode = "fake"\n\n[policy]\ndisabled_actions = ["ask", "interest", "publish", "hotkey"]\n'
                 '\n[messaging]\nroute_only_peers = ["Someone"]\n\n[publish]\nenabled = false\n\n[desktop]\nenabled = false\nbackend = "mac"\n',
                 encoding="utf-8")
    cfg = load_config(p)
    assert cfg.agent.name == "Old Bot" and cfg.policy.disabled_actions == ["ask", "interest", "publish", "hotkey"]
    assert not hasattr(cfg, "desktop") and not hasattr(cfg, "publish") and not hasattr(cfg.messaging, "route_only_peers")
    assert not {"interest", "publish", "app", "look", "click", "type", "hotkey"} & set(ALL_TYPES)
    s = prompts.system_prompt("Lead Gen", "b")
    assert "- interest: " not in s and "- publish: " not in s and "`publish`" not in s and "- hotkey: " not in s


def test_an_old_tor_readers_keys_are_read_and_ignored(tmp_path):
    """Tor is gone; an old config's tor_proxy, onion_directory_file, plain_only and
    scout.kind still load, and backend "tor" is refused with the choices left."""
    import pytest
    p = tmp_path / "config.toml"
    p.write_text('[agent]\nname = "Old"\nmode = "fake"\n\n[browser]\ntor_proxy = "socks5h://127.0.0.1:9050"\n'
                 'onion_directory_file = "workspace/onion_directory.json"\n\n[messaging]\nplain_only = true\n\n[scout]\nkind = "agent"\n',
                 encoding="utf-8")
    cfg = load_config(p)
    assert not hasattr(cfg.browser, "tor_proxy") and not hasattr(cfg.messaging, "plain_only") and not hasattr(cfg.scout, "kind")
    q = tmp_path / "tor.toml"
    q.write_text('[agent]\nname = "Old"\nmode = "web"\n\n[browser]\nbackend = "tor"\n', encoding="utf-8")
    with pytest.raises(ValueError, match="'light' or 'chromium'"):
        load_config(q)
