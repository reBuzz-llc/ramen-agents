"""Plan 8: a bot prunes its own dead search engines from experience -- an engine that answers a lot
but never leads to a note gets dropped from that bot's rotation, and the drop is announced once."""
from __future__ import annotations

from pathlib import Path

from conftest import make_controller


def test_a_dead_engine_is_dropped_and_a_useful_one_is_kept(cfg, tmp_path: Path):
    cfg.agent.mode = "fake"
    cfg.browser.search_engines = ["hn", "wikipedia", "marginalia"]
    c = make_controller(cfg)
    engines = list(c.searcher.settings.usable_engines())
    assert len(engines) >= 2, "test needs at least two engines to prune one"
    dead, useful = engines[0], engines[1]

    # `useful` answers a few searches and each leads to a note; `dead` answers many, never noted.
    for _ in range(3):
        c._credit_engine_answered(useful)
        c._credit_engine_noted()
    for _ in range(10):
        c._credit_engine_answered(dead)  # sets _last_answer_engine to `dead`, but no note follows

    assert c._dead_engines() == {dead}
    c._apply_engine_tuning()
    assert dead in c.searcher.disabled and useful not in c.searcher.disabled
    assert dead not in c.searcher.engines and useful in c.searcher.engines
    # The drop is remembered so it is announced only once, and survives a restart via db state.
    assert dead in c._engines_dropped


def test_tuning_never_disables_every_engine(cfg):
    cfg.agent.mode = "fake"
    cfg.browser.search_engines = ["hn", "wikipedia", "marginalia"]
    c = make_controller(cfg)
    engines = list(c.searcher.settings.usable_engines())
    for e in engines:  # make every engine look dead
        for _ in range(10):
            c._credit_engine_answered(e)
    c._apply_engine_tuning()
    assert len(c.searcher.engines) >= 1, "a bot must always keep at least one engine"


def test_engine_stats_persist_across_a_restart(cfg, tmp_path: Path):
    cfg.agent.mode = "fake"
    cfg.browser.search_engines = ["hn", "wikipedia", "marginalia"]
    c = make_controller(cfg)
    engines = list(c.searcher.settings.usable_engines())
    for _ in range(10):
        c._credit_engine_answered(engines[0])
    # A fresh controller on the same workspace loads the counts and drops the engine on startup.
    c2 = make_controller(cfg)
    assert engines[0] in c2._engine_stats and c2._engine_stats[engines[0]]["answered"] >= 10
    assert engines[0] in c2.searcher.disabled
