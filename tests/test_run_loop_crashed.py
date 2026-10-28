"""A run loop that dies logs one timed "run_loop_crashed" event before re-raising (creatorCC queue 11, 2026-10-28)."""
from __future__ import annotations

import logging

import pytest

from conftest import make_controller


class _Catch(logging.Handler):
    def __init__(self):
        super().__init__()
        self.events = []

    def emit(self, record):
        ev = getattr(record, "event", None)
        if isinstance(ev, dict):
            self.events.append(ev)


def _crashing(cfg, exc):
    c = make_controller(cfg)
    h = _Catch()
    c.logger.addHandler(h)
    c.logger.setLevel(logging.INFO)

    def boom():
        raise exc
    c._cycle = boom
    c._rest_if_idle = lambda: False
    return c, h


def test_an_uncaught_exception_is_logged_once_then_re_raised(cfg):
    c, h = _crashing(cfg, RuntimeError("database is locked\nsecond line"))
    try:
        with pytest.raises(RuntimeError, match="database is locked"):
            c.run(max_cycles=1)
    finally:
        c.logger.removeHandler(h)
    crashes = [e for e in h.events if e["kind"] == "run_loop_crashed"]
    assert crashes == [{"kind": "run_loop_crashed", "exception": "RuntimeError", "message": "database is locked"}]


def test_a_keyboard_interrupt_or_exit_is_not_a_crash(cfg):
    for exc in (KeyboardInterrupt(), SystemExit(3)):
        c, h = _crashing(cfg, exc)
        try:
            try:
                c.run(max_cycles=1)
            except SystemExit:
                pass
        finally:
            c.logger.removeHandler(h)
        assert not [e for e in h.events if e["kind"] == "run_loop_crashed"]
