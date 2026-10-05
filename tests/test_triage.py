"""A "desk triage" episode (agent.triage_every_episodes): every Nth episode the bot is shown all its
open threads and told to advance the most-ready one, so a many-front bot like the CEO juggles instead
of tunnelling. The single-thread output/room nudges step aside on a triage sitting."""
from __future__ import annotations

from pathlib import Path

from conftest import make_controller


def test_triage_episodes_show_a_breadth_banner_and_more_threads(cfg, tmp_path: Path):
    cfg.agent.mode = "fake"
    cfg.agent.triage_every_episodes = 4
    c = make_controller(cfg)
    for _ in range(15):  # several open threads to juggle
        c.memory.add_question("thread")

    # An episode whose id is a multiple of 4 is a review sitting; others are not.
    triage_ep = {"id": 8, "actions": 0, "question_id": None}
    normal_ep = {"id": 7, "actions": 0, "question_id": None}

    obs_t = c._observe(triage_ep)
    assert obs_t.triage and "REVIEW SITTING" in obs_t.triage
    assert obs_t.output_nudge is None and obs_t.room_nudge is None  # single-thread nudges step aside
    assert len(obs_t.open_questions) > 5  # more threads shown for the breadth pass

    obs_n = c._observe(normal_ep)
    assert obs_n.triage is None
    assert len(obs_n.open_questions) <= 5


def test_triage_off_by_default(cfg, tmp_path: Path):
    cfg.agent.mode = "fake"
    c = make_controller(cfg)  # triage_every_episodes defaults to 0
    obs = c._observe({"id": 8, "actions": 0, "question_id": None})
    assert obs.triage is None and obs.curiosity is None


def test_curiosity_sittings_drop_output_pressure_and_triage_wins_ties(cfg, tmp_path: Path):
    cfg.agent.mode = "fake"
    cfg.agent.curiosity_every_episodes = 3
    cfg.agent.triage_every_episodes = 4
    c = make_controller(cfg)
    for _ in range(5):
        c.memory.end_episode(c.memory.start_episode(), "done")  # build up "overdue on output"

    cur = c._observe({"id": 9, "actions": 0, "question_id": None})  # 9 % 3 == 0 -> curiosity
    assert cur.curiosity and "CURIOSITY SITTING" in cur.curiosity
    assert cur.triage is None and cur.output_nudge is None and cur.room_nudge is None

    both = c._observe({"id": 12, "actions": 0, "question_id": None})  # 12 divisible by 3 and 4 -> triage wins
    assert both.triage is not None and both.curiosity is None
