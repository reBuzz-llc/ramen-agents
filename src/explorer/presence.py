"""Is the owner using the Mac right now? Used by quiet mode to keep out of their way.

No pyobjc and no permissions: `ioreg` reports how long since the last keyboard or mouse input,
`lsappinfo` names the frontmost app, and `ps` lists running programs. All three work from a
launchd job in the user's GUI session. Every probe is best effort and returns None or [] when it
cannot tell, and the detector treats "cannot tell" as "not gaming" for that signal.
"""
from __future__ import annotations

import re
import subprocess
from typing import Callable, Iterable

from .config import QuietConfig

# Absolute paths: a launchd job's PATH (the bot plist sets ~/.local/bin:/usr/local/bin:/usr/bin:/bin) has
# no /usr/sbin, so a bare `ioreg` was never found under launchd and idle time always read as unknown.
IOREG = "/usr/sbin/ioreg"
LSAPPINFO = "/usr/bin/lsappinfo"
PS = "/bin/ps"


def _run(argv: list[str], timeout: float = 5.0) -> str:
    try:
        return subprocess.run(argv, capture_output=True, text=True, timeout=timeout, check=False).stdout
    except (OSError, subprocess.SubprocessError):
        return ""


def hid_idle_seconds() -> float | None:
    """Seconds since the last keyboard or mouse event, from the HID system. None when unreadable."""
    match = re.search(r'"HIDIdleTime"\s*=\s*(\d+)', _run([IOREG, "-c", "IOHIDSystem", "-d", "4"]))
    return int(match.group(1)) / 1e9 if match else None


def frontmost_app() -> str | None:
    """The display name of the app in front, e.g. 'Steam'. None when there is no GUI session."""
    asn = _run([LSAPPINFO, "front"]).strip()
    if not asn:
        return None
    match = re.search(r'"LSDisplayName"="([^"]*)"', _run([LSAPPINFO, "info", "-only", "name", asn]))
    return match.group(1) if match else None


def running_process_names(names: Iterable[str]) -> list[str]:
    """Which of `names` (case-insensitive substrings of an executable path) are running."""
    wanted = [n for n in names if n.strip()]
    if not wanted:
        return []
    listing = _run([PS, "-ax", "-o", "comm="]).lower()
    return [n for n in wanted if n.lower() in listing]


class QuietDetector:
    """Decides whether the agent should be quiet, from the three probes above (injectable for tests)."""

    def __init__(
        self,
        cfg: QuietConfig,
        idle_fn: Callable[[], float | None] = hid_idle_seconds,
        front_fn: Callable[[], str | None] = frontmost_app,
        procs_fn: Callable[[Iterable[str]], list[str]] = running_process_names,
    ):
        self.cfg = cfg
        self.idle_fn = idle_fn
        self.front_fn = front_fn
        self.procs_fn = procs_fn

    def game_reason(self) -> str:
        """Why a game counts as running (a listed app in front, a listed process), or "".

        Narrower than check(): the dashboard's chat uses it, and typing into the chat is owner
        activity, so idle time must not count there, only a game competing for the GPU."""
        if not self.cfg.enabled:
            return ""
        front = self.front_fn()
        if front and front.strip().lower() in {a.strip().lower() for a in self.cfg.apps}:
            return f"{front} is in front"
        games = self.procs_fn(self.cfg.processes)
        if games:
            return f"{games[0]} is running"
        return ""

    def check(self) -> tuple[bool, str]:
        """(quiet, reason). The reason is a short phrase for the log and the journal."""
        if not self.cfg.enabled:
            return False, ""
        game = self.game_reason()
        if game:
            return True, game
        if self.cfg.when_owner_active:
            idle = self.idle_fn()
            if idle is not None and idle < self.cfg.idle_seconds:
                return True, f"the owner used the Mac {int(idle)}s ago"
        return False, ""

    def describe(self) -> str:
        """One line for `bot check`."""
        idle = self.idle_fn()
        front = self.front_fn()
        games = self.procs_fn(self.cfg.processes)
        quiet, reason = self.check()
        idle_text = "unknown" if idle is None else f"{int(idle)}s"
        verdict = f"quiet ({reason})" if quiet else "free to work"
        return f"idle {idle_text}, front app {front or 'unknown'}, games running {games or 'none'} -> {verdict}"
