"""Queue 603 (the family's 595 a/c): the desktop agent, the blog-post publish action, the interest action and
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
