"""The CEO's hold on a family member (owner, 2026-10-07: "let ceoA have this access and also let him start those he
pause himself apart from me").

A hold is workspace/HOLD in the member's own folder: JSON {"by", "mode", "until", "step_seconds", "why", "at"}. Mode
"pause" idles the member's loop like the owner's PAUSE file; "slow" stretches its wait between steps to step_seconds.
Every hold ends by itself at `until` (24 hours at most), so a forgotten one never stalls the family. The owner's STOP
and PAUSE files are a different thing: a hold never creates, reads as, or removes them.
"""
from __future__ import annotations

import json
import time
from pathlib import Path

HOLD_FILE = "HOLD"
MODES = ("pause", "slow")


def hold_path(workspace: Path | str) -> Path:
    return Path(workspace).expanduser() / HOLD_FILE


def read_hold(workspace: Path | str, now: float | None = None) -> dict | None:
    """The hold on this workspace while it lasts, else None. An expired or unreadable hold file is removed."""
    path = hold_path(workspace)
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if data.get("mode") in MODES and float(data.get("until", 0)) > (time.time() if now is None else now):
            return data
    except (OSError, ValueError, TypeError, AttributeError):
        pass
    try:
        path.unlink()
    except OSError:
        pass
    return None


def write_hold(workspace: Path | str, by: str, mode: str, hours: float, why: str = "", step_seconds: int = 0,
               now: float | None = None) -> dict:
    t = time.time() if now is None else now
    data = {"by": by, "mode": mode, "until": t + hours * 3600, "step_seconds": int(step_seconds), "why": why.strip()[:300],
            "at": time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime(t))}
    path = hold_path(workspace)
    path.write_text(json.dumps(data), encoding="utf-8")
    return data


def clear_hold(workspace: Path | str) -> None:
    try:
        hold_path(workspace).unlink()
    except FileNotFoundError:
        pass


def until_text(hold: dict) -> str:
    return time.strftime("%H:%M", time.localtime(float(hold.get("until", 0))))
