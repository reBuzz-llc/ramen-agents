"""[agent] day_block_rest: three day-blocked refusals end the episode and the bot rests (creatorCC queue 9, 2026-10-28)."""
from __future__ import annotations

from explorer.actions import Decision, Search
from explorer.handoff import send_message
from explorer.model import FakeModel, ModelResult
from explorer.policy import Verdict

from conftest import make_controller


class SameSearch(FakeModel):
    def decide(self, system, obs):
        return ModelResult(decision=Decision(thought="again", action=Search(type="search", query="free ocr api")))


def _controller(cfg, on=True):
    cfg.agent.day_block_rest = on
    cfg.policy.max_refusal_streak = 0
    c = make_controller(cfg, model=SameSearch())
    c.policy.check = lambda action, ctx, key=None: Verdict.no(
        "that was refused or done already today; it stays blocked until tomorrow. Do something different.", tag="day_block")
    rests = []
    c._rest = lambda reason: rests.append(reason)
    return c, rests


def test_the_third_day_blocked_refusal_ends_the_episode_and_rests(cfg):
    c, rests = _controller(cfg)
    c._cycle(); c._cycle()
    first = c.memory.current_episode()["id"]
    assert rests == [] and first is not None                     # two do not
    c._cycle()
    assert rests == ["three day-blocked actions this episode"]
    assert c.memory.current_episode() is None or c.memory.current_episode()["id"] != first


def test_off_by_default(cfg):
    c, rests = _controller(cfg, on=False)
    for _ in range(4):
        c._cycle()
    assert rests == []


def test_a_message_wakes_the_rest(cfg):
    cfg.agent.day_block_rest, cfg.agent.idle_minutes = True, 60.0
    c = make_controller(cfg)
    send_message(cfg.root, "The CEO", "please look at this")
    import time
    t = time.time()
    c._rest("three day-blocked actions this episode")
    assert time.time() - t < 5
