"""An episode that the policy keeps refusing is closed early, instead of running until the stall
watchdog fires 15 minutes later. Before this, a stuck episode burned ~24 refused model calls
(the CEO: 3,236 refused `task` actions in one week; the Package Designer: 3,320 `package`)."""

from explorer.actions import Decision, Open, Search
from explorer.model import ModelResult

from conftest import make_controller


class StubbornModel:
    """Always tries to open the login trap page: denylisted, so every cycle is refused."""

    def decide(self, system, obs):
        return ModelResult(decision=Decision(thought="obey the page", action=Open(type="open", url="fake://login.html")))

    def complete(self, system, prompt):
        return "nothing learned"


class RestlessModel:
    """Searches for something new every cycle and never summarizes, so the budget runs out."""

    def __init__(self):
        self.n = 0

    def decide(self, system, obs):
        self.n += 1
        return ModelResult(decision=Decision(thought="more", action=Search(type="search", query=f"moss {self.n}")))

    def complete(self, system, prompt):
        return "a summary"


def episodes(controller):
    return controller.memory.db.query("SELECT id, status, actions FROM episodes ORDER BY id")


def test_a_streak_of_refusals_closes_the_episode(cfg):
    cfg.policy.max_refusal_streak = 3
    cfg.watchdog.repeat_threshold = 10  # keep the repeat watchdog out of it
    controller = make_controller(cfg, model=StubbornModel())
    controller.run(max_cycles=7)
    eps = episodes(controller)
    # 3 refusals close episode 1 (nothing was allowed, so it is abandoned, not summarized), then 3 close
    # episode 2, and the seventh cycle is the first refusal of episode 3.
    assert [(e["status"], e["actions"]) for e in eps] == [("abandoned", 3), ("abandoned", 3), ("open", 1)]
    journal = controller.memory.journal_path().read_text()
    assert "3 refused actions in a row" in journal
    assert controller.memory.db.scalar("SELECT COUNT(*) FROM summaries", default=0) == 0  # no model call to summarize nothing


def test_an_allowed_action_resets_the_streak(cfg):
    cfg.policy.max_refusal_streak = 3
    cfg.watchdog.repeat_threshold = 10

    class Mixed:
        def __init__(self):
            self.n = 0

        def decide(self, system, obs):
            self.n += 1
            bad = Open(type="open", url="fake://login.html")
            good = Search(type="search", query=f"moss {self.n}")
            return ModelResult(decision=Decision(thought="x", action=bad if self.n % 3 else good))

        def complete(self, system, prompt):
            return "summary"

    controller = make_controller(cfg, model=Mixed())
    controller.run(max_cycles=5)  # refused, refused, allowed, refused, refused: never three in a row
    assert [e["status"] for e in episodes(controller)] == ["open"]


def test_over_budget_closes_the_episode_at_once(cfg):
    """Once the grace actions are spent, the old loop refused every step with "only summarize is
    allowed" and the model kept not summarizing. Now the controller summarizes for it."""
    cfg.policy.max_actions_per_episode = 2
    cfg.policy.budget_grace_actions = 1
    cfg.policy.max_refusal_streak = 10  # not the streak: the budget itself ends it
    controller = make_controller(cfg, model=RestlessModel())
    controller.run(max_cycles=5)
    eps = episodes(controller)
    # allowed, allowed, refused (grace), refused (over budget: closed and summarized), then a new episode.
    assert [(e["status"], e["actions"]) for e in eps] == [("done", 4), ("open", 1)]
    verdicts = [r["verdict"] for r in controller.memory.db.query("SELECT verdict FROM actions WHERE episode_id = 1 ORDER BY id")]
    assert sum(v != "allowed" for v in verdicts) == 2
    assert controller.memory.db.scalar("SELECT COUNT(*) FROM summaries WHERE episode_id = 1", default=0) == 1


def test_output_banner_stops_when_the_daily_limit_is_reached(cfg):
    """The every-cycle "RESULTS MATTER: hand over a package" reminder must not keep nagging once
    today's packages are all handed over; the policy would refuse each attempt, and the CEO and the
    Package Designer spent thousands of cycles in exactly that loop."""
    cfg.handoff.enabled = True
    cfg.handoff.to_name = "The CEO"
    cfg.handoff.to_folder = str(cfg.root / "ceo")
    cfg.handoff.max_per_day = 2
    controller = make_controller(cfg)
    memory = controller.memory
    for i in range(3):  # three finished episodes with no package: the nag would normally be up
        memory.end_episode(memory.start_episode(None), "done")
    banner = controller._output_banner()
    assert banner is not None and "RESULTS MATTER" in banner
    eid = memory.start_episode(None)
    for i in range(2):
        memory.record_action(i, eid, "package", {}, "t", "allowed", "handed over", True)
    banner = controller._output_banner()
    assert banner is not None
    assert "RESULTS MATTER" not in banner
    assert "2 packages" in banner and "limit" in banner and "PACKAGE QUOTA" in banner
