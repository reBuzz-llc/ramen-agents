

def test_a_home_relative_path_works_for_any_user_name(tmp_path, monkeypatch):
    """The starter fleet's configs say "~/bots/..."; they must load on a Mac whose user is not this one."""
    from explorer.config import load_config

    home = tmp_path / "home" / "someone"
    (home / "bots" / "common-data").mkdir(parents=True)
    monkeypatch.setenv("HOME", str(home))
    shared = home / "bots" / "common-data" / "shared.toml"
    shared.write_text('[policy]\ndenylist_file = "~/bots/common-data/denylist.txt"\n')
    bot = home / "bots" / "lead-gen"
    bot.mkdir()
    (bot / "config.toml").write_text(
        'extends = "../common-data/shared.toml"\n[agent]\nname = "Lead Gen"\n'
        '[messaging]\nenabled = true\n[[messaging.peers]]\nname = "The CEO"\nfolder = "~/bots/the-ceo"\n')
    cfg = load_config(bot / "config.toml")
    assert cfg.policy.denylist_file == f"{home}/bots/common-data/denylist.txt"
    assert cfg.messaging.folder_for("The CEO") == f"{home}/bots/the-ceo"
    assert cfg.policy.write_gate_model_cache.startswith("~/")  # a default: expanded where it is opened
