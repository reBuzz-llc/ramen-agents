"""The board is down: the dashboard is not running (its local board answers at [leads] portal_url, 127.0.0.1:3000 by
default), or the hosted portal answers 402 or 5xx.

One flag for the Mac, common-data/shared-state/board-down.json: the first unreachable, 402 or 5xx answer raises it; while
it is up every board client on the Mac makes one probe per PROBE_SECONDS and refuses the rest at once, without a request;
the first real answer takes it down. A write refused this way is not done and not counted: the member is told in plain
words and can do it again once the board is back, so nothing is recorded as written that never landed. Members whose
work is the board rest from the first failure until the next probe, waking when it is back."""
from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Any

from .board import BoardError

PROBE_SECONDS = 60.0           # one probe a minute: a local dashboard is usually just not started yet
PAUSE_SECONDS = 0.0            # members whose work is the board rest at the first failure: a local dashboard that
                               # does not answer is not started yet, not a blip (a fresh family started before it)


class BoardDown(BoardError):
    """A board call refused without a request: the board is down and the next probe is not due."""


def flag_path() -> Path:
    from .common.keys import keys_dir
    return keys_dir().parent / "shared-state" / "board-down.json"


def is_outage(status: int) -> bool:
    return status == 402 or status >= 500


def read(path: Path | None = None) -> dict[str, Any]:
    try:
        data = json.loads((path or flag_path()).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) and data.get("since") else {}


def _write(path: Path, data: dict[str, Any]) -> None:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_name(f"{path.name}.{os.getpid()}.tmp")
        tmp.write_text(json.dumps(data), encoding="utf-8")
        tmp.replace(path)
    except OSError:
        pass


def message(flag: dict[str, Any], now: float | None = None) -> str:
    since = time.strftime("%H:%M", time.localtime(float(flag.get("since") or 0)))
    url = str(flag.get("url") or "the board")
    nxt = max(0, int((float(flag.get("probe_at") or 0) + PROBE_SECONDS - (now or time.time()))))
    return (f"the team's board is down: {url} has not answered since {since} ({flag.get('why') or 'no answer'}); is the "
            f"dashboard running? The engine tries it again every minute (next in about {nxt} s). Nothing was written; "
            "this is not a wrong name or a missing row")


def held(path: Path | None = None, now: float | None = None) -> bool:
    """The flag is up and the next probe is not due: a call now would be refused without a request."""
    flag = read(path)
    return bool(flag) and (time.time() if now is None else now) - float(flag.get("probe_at") or 0) < PROBE_SECONDS


def gate(path: Path | None = None, now: float | None = None) -> None:
    """Before a board request: raise BoardDown while the flag is up and the next probe is not due; when it is due,
    claim it (so the Mac's other processes wait for this one) and let the request go."""
    path = path or flag_path()
    flag = read(path)
    if not flag:
        return
    now = time.time() if now is None else now
    if now - float(flag.get("probe_at") or 0) < PROBE_SECONDS:
        raise BoardDown(message(flag, now))
    flag["probe_at"] = now
    _write(path, flag)


def failed(why: str, path: Path | None = None, now: float | None = None, url: str = "") -> None:
    path = path or flag_path()
    now = time.time() if now is None else now
    flag = read(path) or {"since": now}
    flag.update(probe_at=now, why=why[:120], **({"url": url} if url else {}))
    _write(path, flag)


def answered(path: Path | None = None) -> bool:
    """The board answered: the flag comes down. True when it was up."""
    path = path or flag_path()
    if not path.exists():
        return False
    try:
        path.unlink()
    except OSError:
        return False
    return True


def down_for(path: Path | None = None, now: float | None = None) -> float:
    """Seconds the board has been down (0 when it is up)."""
    flag = read(path)
    return max(0.0, (time.time() if now is None else now) - float(flag["since"])) if flag else 0.0
