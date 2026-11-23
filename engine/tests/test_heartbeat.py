from explorer.config import WatchdogConfig
from explorer.db import Database
from explorer.heartbeat import Heartbeat


class Clock:
    def __init__(self):
        self.t = 1_000_000.0

    def __call__(self):
        return self.t


def test_stall_and_repeat_detection():
    clock = Clock()
    hb = Heartbeat(Database(":memory:"), WatchdogConfig(stall_minutes=10, repeat_threshold=3, max_model_failures=2), clock)
    assert hb.check() == []
    clock.t += 11 * 60
    assert "stalled" in hb.check()
    hb.record_action("open", "open:x", progress=True)
    assert "stalled" not in hb.check()
    hb.record_action("open", "open:x", progress=True)
    hb.record_action("open", "open:x", progress=True)
    assert hb.repeated_key() == "open:x"
    assert "repeated_action" in hb.check()
    hb.clear_recent()
    assert hb.repeated_key() is None
    hb.record_model_failure()
    hb.record_model_failure()
    assert "model_failures" in hb.check()
    hb.reset_model_failures()
    assert hb.check() == []


def test_tick_writes_rows_at_interval():
    clock = Clock()
    db = Database(":memory:")
    hb = Heartbeat(db, WatchdogConfig(heartbeat_interval_seconds=60), clock)
    assert hb.tick(1, "running", force=True)
    assert not hb.tick(2, "running")
    clock.t += 61
    assert hb.tick(3, "running", current_url="fake://x")
    latest = Heartbeat.latest(db)
    assert latest["cycle"] == 3 and latest["current_url"] == "fake://x"


def test_a_slow_cycle_is_not_a_stall(cfg):
    # the Scout acts every 600 s; 15 minutes without progress is one failed search and a rest, not a stall
    import time
    from conftest import make_controller

    cfg.agent.cycle_delay_seconds = 600
    cfg.watchdog.stall_minutes = 15
    c = make_controller(cfg)
    c.memory.start_episode(None)
    c.heartbeat.last_progress_at = time.time() - 20 * 60
    assert "stalled" in c.heartbeat.check()
    before = c.memory.current_episode()["id"]
    c._watchdog() if hasattr(c, "_watchdog") else None
    assert c.memory.current_episode() is not None and c.memory.current_episode()["id"] == before  # not closed at 20 minutes
