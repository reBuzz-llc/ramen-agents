"""Quiet mode: the agent stops working while the owner uses the Mac, and frees the GPU and memory."""
from __future__ import annotations

from pathlib import Path

from explorer.browser import FakeBrowser
from explorer.config import QuietConfig
from explorer.model import FakeModel
from explorer.presence import QuietDetector

from conftest import FAKE_WEB, make_controller


def detector(cfg: QuietConfig | None = None, idle=None, front=None, procs=None) -> QuietDetector:
    return QuietDetector(
        cfg or QuietConfig(),
        idle_fn=lambda: idle,
        front_fn=lambda: front,
        procs_fn=lambda names: procs or [],
    )


def test_disabled_is_never_quiet():
    quiet, _ = detector(QuietConfig(enabled=False), idle=0.0, front="Steam", procs=["steam_osx"]).check()
    assert not quiet


def test_owner_activity_means_quiet_until_idle_long_enough():
    cfg = QuietConfig(idle_seconds=180)
    assert detector(cfg, idle=5.0).check() == (True, "the owner used the Mac 5s ago")
    assert detector(cfg, idle=179.9).check()[0]
    assert detector(cfg, idle=180.0).check() == (False, "")
    assert detector(cfg, idle=None).check() == (False, "")  # cannot tell: not a reason to stop
    cfg.when_owner_active = False
    assert not detector(cfg, idle=0.0).check()[0]


def test_a_listed_app_in_front_or_process_running_means_quiet():
    cfg = QuietConfig(apps=["Steam"], processes=["steam_osx"], when_owner_active=False)
    assert detector(cfg, front="steam").check() == (True, "steam is in front")  # case-insensitive
    assert detector(cfg, front="Code").check() == (False, "")
    assert detector(cfg, procs=["steam_osx"]).check() == (True, "steam_osx is running")


def test_describe_is_one_readable_line():
    line = detector(QuietConfig(), idle=42.0, front="Code").describe()
    assert "idle 42s" in line and "front app Code" in line and "quiet" in line


class ScriptedDetector:
    """Quiet for the first `quiet_checks` checks, then free."""

    def __init__(self, quiet_checks: int):
        self.remaining = quiet_checks
        self.checks = 0

    def check(self):
        self.checks += 1
        if self.remaining > 0:
            self.remaining -= 1
            return True, "the owner used the Mac 3s ago"
        return False, ""


class CountingBrowser(FakeBrowser):
    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        self.resets = 0

    def reset(self):
        self.resets += 1
        super().reset()


def test_controller_holds_while_quiet_and_frees_resources(cfg):
    cfg.quiet.enabled = True
    cfg.quiet.check_interval_seconds = 0
    model = FakeModel()
    browser = CountingBrowser(FAKE_WEB)
    controller = make_controller(cfg, model=model, browser=browser, quiet=ScriptedDetector(quiet_checks=3))
    controller.run(max_cycles=2)

    assert model.calls == 2  # the three quiet checks cost no model calls
    assert getattr(model, "unloads", 0) == 1  # asked once, on the way in, not on every check
    assert browser.resets == 1
    statuses = [r["status"] for r in controller.memory.db.query("SELECT status FROM heartbeat ORDER BY id")]
    assert "quiet" in statuses
    journal = controller.memory.journal_path().read_text()
    assert "Going quiet: the owner used the Mac 3s ago" in journal
    assert "free again" in journal
    assert controller.quiet_since is None


def test_leaving_quiet_counts_as_progress_for_the_stall_watchdog(cfg):
    cfg.quiet.enabled = True
    cfg.quiet.check_interval_seconds = 0
    controller = make_controller(cfg, quiet=ScriptedDetector(quiet_checks=1))
    controller.heartbeat.last_progress_at = 0.0  # looks stalled for hours
    controller.run(max_cycles=1)
    assert controller.heartbeat.minutes_since_progress() < 1


def test_quiet_off_in_config_means_no_detector(cfg):
    cfg.quiet.enabled = False
    controller = make_controller(cfg, quiet=ScriptedDetector(quiet_checks=99))
    assert controller.quiet is None
    controller.run(max_cycles=1)
    assert controller.cycle_no == 1


def test_probes_use_absolute_paths_so_they_work_under_launchd(monkeypatch):
    """launchd's PATH has no /usr/sbin: a bare `ioreg` silently read idle time as unknown."""
    from explorer import presence

    seen: list[list[str]] = []

    def fake_run(argv, timeout=5.0):
        seen.append(argv)
        return '"HIDIdleTime" = 5000000000' if argv[0].endswith("ioreg") else ""

    monkeypatch.setattr(presence, "_run", fake_run)
    monkeypatch.setenv("PATH", "/usr/bin:/bin")
    assert presence.hid_idle_seconds() == 5.0
    presence.frontmost_app()
    presence.running_process_names(["steam_osx"])
    assert [a[0] for a in seen] == ["/usr/sbin/ioreg", "/usr/bin/lsappinfo", "/bin/ps"]
    assert all(Path(a[0]).is_absolute() for a in seen)
