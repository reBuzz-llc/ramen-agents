"""Desk Agent blockers (owner, 2026-09-24: "the desk agent should talk with the Validator and figure its task
blockers out on its own").

The engine drops a message into this bot's inbox when a GUI step is refused for a cause outside the model's control:
    "blocker: <reason> | task: <owner's last chat message> | fix suggested to owner: <hint> | please verify ..."
The Validator verifies the cause against facts it can see on this Mac, answers the Desk Agent in its inbox
("From Validator: ..."), tells the owner in the chatroom and the report, re-checks open blockers every run, and
tells the Desk Agent to retry the moment the cause is cleared. A blocker still open after two hours is escalated to
the owner (rule DA01). Read-only on everything but the two inboxes.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import re
import sqlite3
import subprocess
import tomllib
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

BOTS = Path.home() / "bots"
DESK = BOTS / "desk-agent"
IOREG = "/usr/sbin/ioreg"


@dataclass
class Blocker:
    reason: str
    task: str
    fix: str = ""
    sender: str = "Desk Agent"

    @property
    def key(self) -> str:
        return hashlib.sha1(f"{self.reason.lower().strip()}|{self.task.lower().strip()}".encode()).hexdigest()[:12]


def parse_blocker(text: str) -> Blocker | None:
    """The engine's fixed shape: "blocker: R | task: T | fix suggested to owner: F | please verify ..."."""
    if not text.strip().lower().startswith("blocker:"):
        return None
    parts: dict[str, str] = {}
    for seg in text.split(" | "):
        if ":" in seg:
            k, v = seg.split(":", 1)
            parts[k.strip().lower()] = v.strip()
    reason = parts.get("blocker", "").strip()
    if not reason:
        return None
    return Blocker(reason, parts.get("task", ""), parts.get("fix suggested to owner") or parts.get("fix", ""))


def parse_resolved(text: str) -> list[str]:
    """The engine's all-clear: "resolved: <reason>[; <reason>] | a GUI step was allowed again" -> the reasons."""
    if not text.strip().lower().startswith("resolved:"):
        return []
    body = text.split(" | ", 1)[0].split(":", 1)[1]
    return [r.strip().lower() for r in body.split(";") if r.strip()]


@dataclass
class Verdict:
    status: str      # confirmed | cleared | not_confirmed | unverified
    detail: str
    fix: str = ""


# ---- facts on this Mac ------------------------------------------------------------

def desk_config() -> dict[str, Any]:
    try:
        return tomllib.loads((DESK / "config.toml").read_text(encoding="utf-8")).get("desktop") or {}
    except (OSError, ValueError):
        return {}


def accessibility_state(path: Path = DESK / "workspace" / "rebuzzbot_ax.txt") -> tuple[bool | None, str]:
    """(trusted, stamp) from the desk agent's marker file: "2026-09-24T10:30:14 accessibility_trusted=True"."""
    try:
        lines = [ln for ln in path.read_text(encoding="utf-8").splitlines() if ln.strip()]
    except OSError:
        return None, ""
    if not lines:
        return None, ""
    m = re.search(r"^(\S+)\s+accessibility_trusted=(True|False)", lines[-1])
    return (m.group(2) == "True", m.group(1)) if m else (None, lines[-1][:40])


def hid_idle_seconds() -> float | None:
    try:
        out = subprocess.run([IOREG, "-c", "IOHIDSystem", "-d", "4"], capture_output=True, text=True, timeout=5).stdout
    except (OSError, subprocess.SubprocessError):
        return None
    m = re.search(r'"HIDIdleTime"\s*=\s*(\d+)', out)
    return int(m.group(1)) / 1e9 if m else None


def frontmost_app() -> str | None:
    try:
        from explorer.presence import frontmost_app as _front
        return _front()
    except Exception:  # noqa: BLE001
        return None


def tokens_today() -> tuple[int, dict[str, int]]:
    try:
        from explorer.common.fallback import CallLedger
        usage = CallLedger().usage_today()
    except Exception:  # noqa: BLE001
        return 0, {}
    per_host = {h: sum(v[1] + v[2] for v in kinds.values()) for h, kinds in usage.items()}
    return sum(per_host.values()), per_host


def fleet_daily_budget() -> int:
    try:
        data = tomllib.loads((BOTS / "common-data" / "configs" / "web-bots.toml").read_text(encoding="utf-8"))
        return int((data.get("model") or {}).get("daily_token_budget", 0))
    except (OSError, ValueError):
        return 0


# ---- verification ------------------------------------------------------------------

def verify(b: Blocker, *, cfg: dict[str, Any] | None = None, facts: dict[str, Callable[[], Any]] | None = None) -> Verdict:
    """Check the claimed cause against what the Validator can see. `facts` lets tests inject the readers."""
    cfg = desk_config() if cfg is None else cfg
    f = {"ax": accessibility_state, "idle": hid_idle_seconds, "front": frontmost_app, "tokens": tokens_today, "budget": fleet_daily_budget}
    f.update(facts or {})
    r = b.reason.lower()
    if "accessib" in r or "trusted" in r:
        trusted, stamp = f["ax"]()
        if trusted is True:
            return Verdict("cleared", f"Accessibility is granted now (marker {stamp})", "retry the step")
        if trusted is False:
            return Verdict("confirmed", f"Accessibility is not granted (marker {stamp})",
                           "System Settings → Privacy & Security → Accessibility: enable the Desk Agent app, then restart the desk agent")
        return Verdict("unverified", "no accessibility marker file to check", "grant Accessibility to the Desk Agent app if it is missing")
    if "not allowed" in r or "allowed app" in r or "allowed_apps" in r or ("app" in r and "allow" in r):
        apps = [str(a) for a in cfg.get("allowed_apps") or []]
        return Verdict("confirmed", "allowed apps are: " + (", ".join(apps) or "(none)"),
                       "use one of the allowed apps, or ask the owner to add the app to [desktop] allowed_apps in desk-agent/config.toml")
    if "hotkey" in r:
        keys = [str(k) for k in cfg.get("allowed_hotkeys") or []]
        return Verdict("confirmed", "allowed hotkeys are: " + (", ".join(keys) or "(none)"),
                       "use an allowed hotkey or a click; the owner can extend [desktop] allowed_hotkeys")
    if "hours" in r or "outside" in r and "time" in r:
        return Verdict("confirmed", f"working hours are set to '{cfg.get('hours') or '(any)'}'", "wait for the working hours, or the owner changes [desktop] hours")
    if "not free" in r or "in use" in r or "owner is using" in r or "busy" in r or "idle" in r or "presence" in r:
        idle = f["idle"]()
        need = float(cfg.get("idle_minutes", 3)) * 60
        front = f["front"]()
        if idle is not None and idle >= need:
            return Verdict("cleared", f"the Mac has been idle {idle / 60:.0f} min (needs {need / 60:.0f}); frontmost app: {front or '?'}", "retry the step")
        return Verdict("confirmed", f"the owner used the Mac {idle:.0f} s ago; frontmost app: {front or '?'}" if idle is not None else "idle time unreadable",
                       f"leave the Mac untouched for {need / 60:.0f} minutes; the desk agent resumes on its own")
    if "model" in r or "online" in r or "provider" in r:
        total, per_host = f["tokens"]()
        budget = f["budget"]()
        detail = f"remote tokens today: {total:,}" + (f" of a {budget:,} fleet budget" if budget else "") + (
            " (" + ", ".join(f"{h} {n:,}" for h, n in sorted(per_host.items(), key=lambda x: -x[1])[:4]) + ")" if per_host else "")
        if budget and total >= budget:
            return Verdict("confirmed", detail + ": the shared budget is spent, so the chain paces or refuses", "wait for the daily budget to reset (midnight), or the owner adds a free provider key")
        return Verdict("not_confirmed", detail + ": budget not exhausted; a provider may be rate-limited or down", "check `bot providers` for a benched provider; retry in a few minutes")
    return Verdict("unverified", "no automatic check for this cause", b.fix or "owner to look")


def reply_text(b: Blocker, v: Verdict) -> str:
    head = f"Validator checked your blocker '{b.reason[:90]}'"
    if v.status == "cleared":
        return f"{head}: the cause is cleared. {v.detail}. Retry the step for '{b.task[:80]}' now."[:900]
    if v.status == "confirmed":
        return f"{head}: confirmed. {v.detail}. Fix: {v.fix}. Do not retry until it is cleared; I re-check every few minutes and will tell you."[:900]
    if v.status == "not_confirmed":
        return f"{head}: I could not confirm it. {v.detail}. Suggested: {v.fix}."[:900]
    return f"{head}: I cannot check that cause automatically. {v.detail}. The owner has been told; suggested fix: {v.fix}."[:900]


# ---- owner messages left unanswered (rule DA02) ---------------------------------------

def unanswered_owner_messages(db_path: Path = DESK / "workspace" / "explorer.sqlite3", *, within_minutes: int = 60,
                              now: dt.datetime | None = None) -> list[dict[str, Any]]:
    """Owner chat messages older than `within_minutes` with no bot/system reply after them."""
    if not db_path.exists():
        return []
    now = now or dt.datetime.now()
    try:
        con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
        try:
            rows = con.execute("SELECT id, ts, role, text FROM chat ORDER BY id").fetchall()
        finally:
            con.close()
    except sqlite3.Error:
        return []
    out: list[dict[str, Any]] = []
    pending: dict[str, Any] | None = None
    for rid, ts, role, text in rows:
        if role == "owner":
            pending = {"id": rid, "ts": ts, "text": str(text)[:120]}
        elif pending is not None and role in ("bot", "system"):
            pending = None
    if pending is not None:
        try:
            age = (now - dt.datetime.fromisoformat(str(pending["ts"]))).total_seconds() / 60
        except ValueError:
            age = 0
        if age >= within_minutes:
            pending["age_minutes"] = int(age)
            out.append(pending)
    return out
