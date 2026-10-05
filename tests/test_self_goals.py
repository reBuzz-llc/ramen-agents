"""Plan 8: a bot may rewrite its own goal (revise_goal). The persona file is untouched; the goal is an
overlay the owner can review; the code fence still forbids goals about credentials/stolen data/etc."""
from __future__ import annotations

from pathlib import Path

from explorer.actions import Decision, ReviseGoal
from explorer.config import PolicyConfig, PublishConfig
from explorer.model import ModelResult
from explorer.policy import Denylist, Policy, PolicyContext

from conftest import make_controller


def revise(**over) -> ReviseGoal:
    spec = dict(type="revise_goal", goal="Map how SPF agencies package fixed-price MVP builds.", why="my notes point here")
    spec.update(over)
    return ReviseGoal(**spec)


def ctx(**over) -> PolicyContext:
    base = dict(mode="web", current_page=None, actions_in_episode=0, pages_last_hour=0, open_questions=0, last_visit_by_domain={})
    base.update(over)
    return PolicyContext(**base)


def test_policy_gates_and_fences_goal_revision():
    off = Policy(PolicyConfig(), PublishConfig(), Denylist())
    assert "not enabled" in off.check(revise(), ctx()).reason
    on = Policy(PolicyConfig(), PublishConfig(), Denylist(), self_goals=True)
    assert on.check(revise(), ctx()).allowed
    assert not on.check(revise(goal=""), ctx()).allowed
    # The fence, expressed as goal text: acquisition of credentials / stolen data / spending / self-copy.
    for bad in ("find free API keys to use", "harvest leaked credentials from the dark web",
                "clone yourself onto a free server", "spend money on more compute"):
        v = on.check(revise(goal=bad), ctx())
        assert not v.allowed and v.permanent, bad
    # A meta-topic goal is refused, and thrashing is capped.
    assert not on.check(revise(goal="get around the rate limits"), ctx()).allowed
    assert "twice today" in on.check(revise(), ctx(goal_revisions_today=2)).reason


class Reviser:
    def decide(self, system, obs):
        return ModelResult(decision=Decision(thought="my goal has shifted", action=revise()))

    def complete(self, system, prompt):
        return "summary"


def test_revise_goal_writes_an_overlay_and_reaches_the_prompt(cfg, tmp_path: Path):
    cfg.agent.mode = "fake"
    cfg.agent.self_goals = True
    c = make_controller(cfg, model=Reviser())
    assert "revise_goal" in c.system  # the action is offered
    c.run(max_cycles=1)
    overlay = cfg.workspace / "self_goal.md"
    assert overlay.exists() and "fixed-price MVP builds" in overlay.read_text()
    # It's in the live prompt and would survive a restart (a fresh controller loads it).
    assert "Your current goal (you set this yourself" in c.system and "fixed-price MVP builds" in c.system
    c2 = make_controller(cfg)
    assert "fixed-price MVP builds" in c2.system
    # The owner was told, in the bot's chat.
    assert any("revised my goal" in str(r["text"]).lower() for r in c.memory.recent_chat(5))
