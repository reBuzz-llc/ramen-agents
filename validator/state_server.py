#!/usr/bin/env python3
"""A tiny read-only data server so the fleet webapp (~/bots/webapp) can show the Validator like any other
bot. It answers the endpoints the webapp's proxy forwards (lib/bots.ts, app/api/bots/[slug]/[...path]),
in the same shapes the framework's `bot dashboard` uses, built from the Validator's own files:

    /api/state      online + last sweep (mode, when, counts), open flags, next run
    /api/events     the tail of workspace/logs/validator.log
    /api/notes      one "note" per open flag (title = item, body = rule + what was found)
    /api/questions  open = open defects/warnings, answered = flags resolved
    /api/interests  one row per bot with open flags (weight = share of open flags)
    /api/journal    workspace/latest-report.md

Binds 127.0.0.1 only (the webapp reads over loopback). Standard library only; no writes anywhere.
Run by launchd (com.rebuzz.validator-state, KeepAlive) or by hand:

    ~/Projects/bot/.venv/bin/python ~/bots/validator/state_server.py [--port 8793]
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import sys
import tomllib
from collections import Counter
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

HERE = Path(__file__).resolve().parent
WS = HERE / "workspace"
STATE = WS / "state.json"
FLAGS = WS / "flags.json"
SWEEP = WS / "sweep.json"          # written by validator.py at the start and end of each run
LOG = WS / "logs" / "validator.log"
REPORT = WS / "latest-report.md"
_LOG_LINE = re.compile(r"^(\S+ \S+) (\S+) (\w+) (.*)$")


def _load(path: Path, default: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default


def _settings() -> dict[str, Any]:
    try:
        data = tomllib.loads((HERE / "config.toml").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return {"name": (data.get("agent") or {}).get("name", "Validator"), "port": int((data.get("dashboard") or {}).get("port", 8793)),
            **(data.get("validator") or {})}


def _iso(ts: float) -> str:
    return dt.datetime.fromtimestamp(ts).isoformat(timespec="seconds")


def _age(iso: str | None) -> int | None:
    if not iso:
        return None
    try:
        return int((dt.datetime.now() - dt.datetime.fromisoformat(iso)).total_seconds())
    except ValueError:
        return None


def _next_run(last_run: str | None, interval: int = 7200) -> str | None:
    if not last_run:
        return None
    try:
        return (dt.datetime.fromisoformat(last_run) + dt.timedelta(seconds=interval)).isoformat(timespec="seconds")
    except ValueError:
        return None


class Data:
    """Everything is re-read per request: the files are small and change only when a sweep runs."""

    def __init__(self) -> None:
        self.s = _settings()

    def state(self) -> dict[str, Any]:
        st = _load(STATE, {})
        flags = _load(FLAGS, {})
        sweep = _load(SWEEP, {})
        open_flags = [r for r in flags.values() if r.get("status") == "open"]
        resolved = [r for r in flags.values() if r.get("status") == "resolved"]
        last = st.get("last_run")
        interval = int(float(self.s.get("run_every_hours", 2)) * 3600)
        sweeping = sweep.get("status") == "sweeping" and (_age(sweep.get("started")) or 0) < 1800
        last_summary = sweep.get("summary") or (f"last sweep {last}" if last else "no sweep yet")
        hb_ts = sweep.get("started") if sweeping else (sweep.get("finished") or last)
        heartbeat = {
            "id": int(st.get("runs", 0)),
            "ts": hb_ts or _iso(dt.datetime.now().timestamp()),
            "cycle": int(st.get("runs", 0)),
            "status": "running" if sweeping else "running",
            "current_url": str(REPORT) if REPORT.exists() else None,
            "current_question": f"{len(open_flags)} open flag(s)" if open_flags else None,
            "last_action": ("sweeping now" if sweeping else last_summary)[:200],
            "last_progress_at": last,
            "model_failures": 0,
            "next_planned": _next_run(last, interval),
            "pid": os.getpid(),
        }
        by_sev = Counter(r.get("severity") for r in open_flags)
        return {
            "agent": {"name": self.s.get("name", "Validator"), "mode": "validator",
                      "model": "rules" + (" + judge: " + ", ".join(p.get("model", "?") for p in (self.s.get("model") or {}).get("chain", [])[:2]) if (self.s.get("model") or {}).get("enabled") else ""), "browser": "none"},
            "running": True,
            "pid": os.getpid(),
            "flags": [],
            "heartbeat": heartbeat,
            "heartbeat_age": _age(hb_ts),
            "stale": False,
            "counts": {
                # The webapp's tiles are labelled Notes / Open questions / Answered / Pages visited / Episodes / Actions.
                "notes": len(open_flags),                       # open flags
                "open_questions": int(by_sev.get("error", 0)),  # open defects
                "answered_questions": len(resolved),            # resolved flags
                "interests": len(self._instruction_files()),
                "visits": int(sweep.get("checked_total", 0)),   # items checked in the last sweep
                "episodes": int(st.get("runs", 0)),             # sweeps run
                "actions": len(flags),                          # flags ever raised
            },
            "episode": None,
            "budget": 0,
            "pages_last_hour": 0,
            "pages_per_hour": 0,
            "screenshot_at": None,
            "now": _iso(dt.datetime.now().timestamp()),
            "validator": {
                "last_run": last, "last_full_sweep": st.get("last_full_sweep"), "next_run": _next_run(last, interval),
                "run_every_hours": interval / 3600,
                "sweeping": sweeping, "last_sweep": sweep, "open": len(open_flags), "open_defects": int(by_sev.get("error", 0)),
                "open_warnings": int(by_sev.get("warn", 0)), "resolved": len(resolved), "report": str(REPORT),
                "instructions": self._instruction_files(),
            },
        }

    @staticmethod
    def _instruction_files() -> list[str]:
        return sorted(p.name for p in (HERE / "instructions").glob("*.md") if p.name.lower() != "readme.md")

    def events(self, n: int = 60) -> list[dict[str, Any]]:
        if not LOG.exists():
            return []
        try:
            with LOG.open("rb") as fh:
                fh.seek(0, os.SEEK_END)
                size = fh.tell()
                fh.seek(max(0, size - 128 * 1024))
                lines = fh.read().decode("utf-8", errors="replace").splitlines()
        except OSError:
            return []
        out: list[dict[str, Any]] = []
        for line in lines[-n:]:
            m = _LOG_LINE.match(line)
            if not m:
                continue
            ts, logger, level, msg = m.groups()
            kind = "sweep" if "run done" in msg else "message" if msg.startswith("messaged") else "log"
            out.append({"ts": ts.replace(",", ".").replace(" ", "T"), "level": level, "msg": msg[:400], "kind": kind, "logger": logger})
        return out

    def notes(self, limit: int = 60) -> list[dict[str, Any]]:
        flags = _load(FLAGS, {})
        rows = [r for r in flags.values() if r.get("status") == "open"]
        rows.sort(key=lambda r: (r.get("severity") != "error", r.get("first_seen", "")), reverse=False)
        out = []
        for i, r in enumerate(rows[:limit], 1):
            tag = "defect" if r.get("severity") == "error" else "warning"
            out.append({
                "id": i, "created_at": r.get("first_seen", ""), "title": f"[{r.get('rule')}] {r.get('label', '')}",
                "body": f"{r.get('detail', '')}\n\nRule {r.get('rule')}: {r.get('text', '')}\n\nFor: {r.get('bot')}"
                        + (f"\nMessaged: {r['messaged_at']}" if r.get("messaged_at") else ""),
                "tags": f"{tag},{r.get('bot', '')},{r.get('kind', '')}", "source_url": r.get("url") or None, "episode_id": None,
            })
        return out

    def questions(self) -> dict[str, list[dict[str, Any]]]:
        flags = _load(FLAGS, {})
        items = sorted(flags.values(), key=lambda r: r.get("last_seen", ""), reverse=True)[:80]

        def q(i: int, r: dict[str, Any]) -> dict[str, Any]:
            return {"id": i, "created_at": r.get("first_seen", ""), "question": f"[{r.get('rule')}] {r.get('label', '')}: {r.get('detail', '')}",
                    "status": r.get("status", "open"), "answered_at": r.get("resolved_at"), "answer_note_id": None, "times_pursued": 1}

        return {"open": [q(i, r) for i, r in enumerate(items, 1) if r.get("status") == "open"],
                "answered": [q(i, r) for i, r in enumerate(items, 1) if r.get("status") == "resolved"]}

    def interests(self) -> list[dict[str, Any]]:
        flags = _load(FLAGS, {})
        by_bot = Counter(r.get("bot", "?") for r in flags.values() if r.get("status") == "open")
        total = sum(by_bot.values()) or 1
        return [{"topic": f"{bot}: {n} open", "weight": round(n / total, 2)} for bot, n in by_bot.most_common()]

    def journal(self) -> dict[str, Any]:
        text = REPORT.read_text(encoding="utf-8") if REPORT.exists() else "No sweep has run yet."
        return {"path": str(REPORT), "text": text}


class Handler(BaseHTTPRequestHandler):
    data = Data()

    def log_message(self, fmt: str, *args: Any) -> None:  # quiet
        pass

    def _json(self, payload: Any, status: int = 200) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        u = urlparse(self.path)
        d = self.data
        try:
            if u.path == "/api/state":
                self._json(d.state())
            elif u.path == "/api/events":
                n = parse_qs(u.query).get("n", ["60"])[0]
                self._json(d.events(int(n) if n.isdigit() else 60))
            elif u.path == "/api/notes":
                self._json(d.notes())
            elif u.path == "/api/questions":
                self._json(d.questions())
            elif u.path == "/api/interests":
                self._json(d.interests())
            elif u.path == "/api/journal":
                self._json(d.journal())
            elif u.path == "/":
                self._json({"name": d.s.get("name", "Validator"), "endpoints": ["/api/state", "/api/events", "/api/notes", "/api/questions", "/api/interests", "/api/journal"]})
            else:
                self._json({"error": "not found"}, HTTPStatus.NOT_FOUND)
        except Exception as exc:  # noqa: BLE001 - a bad file must not take the server down
            self._json({"error": f"{type(exc).__name__}: {exc}"}, HTTPStatus.INTERNAL_SERVER_ERROR)

    def do_POST(self) -> None:  # noqa: N802
        self._json({"error": "read-only"}, HTTPStatus.METHOD_NOT_ALLOWED)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Read-only data server for the Validator (fleet webapp).")
    ap.add_argument("--port", type=int, default=_settings().get("port", 8793))
    args = ap.parse_args(argv)
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    server.daemon_threads = True
    print(f"validator state server on http://127.0.0.1:{args.port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
