"""The token pool is shared by the bots running right now (owner, 2026-10-02)."""
import os

from explorer.fleet_budget import active_share


def _bot(fleet, slug, weight=1.0, scope="active", stop=False, running=True):
    d = fleet / slug; (d / "workspace").mkdir(parents=True)
    (d / "config.toml").write_text(f'[agent]\nname = "{slug}"\n[model]\nbudget_scope = "{scope}"\nbudget_weight = {weight}\nfleet_token_budget = 8000000\n')
    if running:
        (d / "workspace" / "explorer.pid").write_text(str(os.getpid()))
    if stop:
        (d / "workspace" / "STOP").touch()
    return d


def test_running_bots_share_by_weight_and_a_stopped_bots_share_flows_to_the_rest(tmp_path):
    lead = _bot(tmp_path, "lead-gen", weight=2)
    _bot(tmp_path, "scout", weight=1)
    _bot(tmp_path, "package-designer", weight=1, stop=True)        # the owner stopped it
    _bot(tmp_path, "onion-reader", weight=1, running=False)        # not running
    _bot(tmp_path, "the-ceo", weight=0)                            # never paced, takes no share
    share, members = active_share(lead)
    assert members == ["lead-gen", "scout"] and abs(share - 2 / 3) < 1e-9
    (tmp_path / "package-designer" / "workspace" / "STOP").unlink()
    (tmp_path / "package-designer" / "workspace" / "explorer.pid").write_text(str(os.getpid()))
    share, members = active_share(lead)
    assert members == ["lead-gen", "package-designer", "scout"] and abs(share - 0.5) < 1e-9
    alone = _bot(tmp_path / "solo-fleet", "only-bot") if (tmp_path / "solo-fleet").mkdir() is None else None
    assert active_share(alone) == (1.0, ["only-bot"])
