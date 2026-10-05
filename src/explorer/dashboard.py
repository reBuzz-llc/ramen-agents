"""A local page to watch the explorer and talk with it: `bot dashboard`.

It reads the same database, log, and screenshot the agent writes. Its only writes are chat messages and
the PAUSE/STOP flag files, and those require the token the page was served with, so a web page the agent
happens to visit cannot drive it.
"""
from __future__ import annotations

import datetime as dt
import json
import logging
import os
import secrets
import socketserver
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

from .config import Config
from .control import PidLock, pause_requested, stop_requested
from .db import Database
from .heartbeat import Heartbeat
from .memory import Memory
from .model import Model

PAGE_FILE = Path(__file__).with_name("dashboard.html")
CHAT_ACTIONS = 10  # actions a chat reply sees on record
CHAT_REQUESTS = 8  # requests to or from this bot a chat reply sees on record
MAX_BODY = 64 * 1024

CHAT_SYSTEM = """You are {name}. {bio}
You are chatting with your owner, the person who runs you, through your dashboard. Answer in the first person,
briefly and honestly, in plain prose. Draw on the notes, questions, interests and journal you are given; when
you do not know something, say so instead of inventing it. No JSON, no headings, no bullet points.
Only what is on record happened: an action counts as done only when "What you actually did" lists it as done,
and you asked someone only when "Who you asked" lists it. Anything else you have not done: say you will try, or
that you cannot, never that it is done. Name only the people listed under "People", the owner, and people your
notes or journal name; never make up a colleague, an email address, a chat channel or a tool. Your earlier
replies in the conversation may be wrong; where they disagree with the record, the record is right, so say so."""

CHAT_PROMPT = """## What you actually did (your action log, oldest first)
{actions}

## Who you asked, and who asked you (the fleet's requests record)
{requests}

## People
{people}

## What you remember
Interests: {interests}
Open questions: {questions}
Notes that may be relevant:
{notes}
Latest journal entry:
{journal}

## The conversation so far (your past replies are not a record; they may be wrong)
{history}

Owner: {message}
{name}:"""

HELP_TEXT = (
    "Commands: /ask <question> gives me a question to pursue; /interest <topic> [delta] nudges an interest "
    "(delta from -1 to 1, default 0.3); /pause, /resume and /stop control the running agent; /help shows this. "
    "Anything else is a message: I answer here, and the running agent also sees it on its next cycle."
)


def _iso(ts: float) -> str:
    return dt.datetime.fromtimestamp(ts).replace(microsecond=0).isoformat()


def _clip(value: Any, limit: int = 600) -> Any:
    if isinstance(value, str) and len(value) > limit:
        return value[:limit] + "…"
    return value


class _NoLocalModel:
    """Stands in for the local fallback while a game runs: answers nothing, loads nothing."""

    def decide(self, system: str, obs: Any) -> Any:  # pragma: no cover - chat only completes
        raise RuntimeError("no local model while a game is running")

    def complete(self, system: str, prompt: str) -> str:
        return ""


class DashboardApp:
    """Everything the HTTP handler needs, behind two locks: one for SQLite, one for the model."""

    def __init__(self, cfg: Config, model: Model, logger: logging.Logger | None = None, quiet: Any | None = None):
        self.cfg = cfg
        self.model = model
        self.logger = logger or logging.getLogger("explorer.dashboard")
        # While a game runs, chat never wakes the local model (the GPU is the game's); remote
        # providers may still answer. None = no detector (tests, or quiet mode off).
        self.quiet = quiet
        self.token = secrets.token_urlsafe(24)
        self.db = Database(cfg.db_path)
        self.memory = Memory(self.db, cfg.workspace)
        self._db_lock = threading.Lock()
        self._model_lock = threading.Lock()
        self.page_html = PAGE_FILE.read_text(encoding="utf-8")

    # ---- token file ----------------------------------------------------------

    def write_token(self) -> Path:
        path = self.cfg.dashboard_token_file
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(self.token, encoding="utf-8")
        os.chmod(path, 0o600)
        return path

    def remove_token(self) -> None:
        try:
            self.cfg.dashboard_token_file.unlink()
        except FileNotFoundError:
            pass

    # ---- reads ---------------------------------------------------------------

    def page(self) -> str:
        return self.page_html.replace("__TOKEN__", self.token).replace("__NAME__", self.cfg.agent.name)

    def state(self) -> dict[str, Any]:
        cfg = self.cfg
        with self._db_lock:
            hb = Heartbeat.latest(self.db)
            counts = self.memory.counts()
            ep = self.memory.current_episode()
            pages_last_hour = self.memory.pages_last_hour()
        running = PidLock.is_locked(cfg.pid_file)
        pid = PidLock.read_pid(cfg.pid_file) if running else None
        flags = [name for name, on in (("PAUSE", pause_requested(cfg)), ("STOP", stop_requested(cfg))) if on]
        heartbeat: dict[str, Any] | None = None
        age: int | None = None
        stale = False
        if hb is not None:
            heartbeat = dict(hb)
            age = int((dt.datetime.now() - dt.datetime.fromisoformat(hb["ts"])).total_seconds())
            stale = running and age > 3 * cfg.watchdog.heartbeat_interval_seconds + 60
        shot = cfg.screenshot_dir / "current.png"
        shot_at = _iso(shot.stat().st_mtime) if shot.exists() else None
        return {
            "agent": {
                "name": cfg.agent.name, "mode": cfg.agent.mode, "model": f"{cfg.model.provider}/{cfg.model.name}",
                "browser": cfg.browser.backend,
            },
            "running": running,
            "pid": pid,
            "flags": flags,
            "heartbeat": heartbeat,
            "heartbeat_age": age,
            "stale": stale,
            "counts": counts,
            "episode": {"id": ep["id"], "actions": ep["actions"], "question_id": ep["question_id"]} if ep else None,
            "budget": cfg.policy.max_actions_per_episode,
            "pages_last_hour": pages_last_hour,
            "pages_per_hour": cfg.policy.pages_per_hour,
            "screenshot_at": shot_at,
            "now": _iso(dt.datetime.now().timestamp()),
        }

    def events(self, n: int = 60) -> list[dict[str, Any]]:
        path = self.cfg.log_path
        if not path.exists():
            return []
        # Read only the tail of the file; the log can grow to megabytes.
        with path.open("rb") as fh:
            fh.seek(0, os.SEEK_END)
            size = fh.tell()
            fh.seek(max(0, size - 256 * 1024))
            chunk = fh.read().decode("utf-8", errors="replace")
        lines = chunk.splitlines()
        if size > 256 * 1024 and lines:
            lines = lines[1:]  # the first line is probably cut in half
        out: list[dict[str, Any]] = []
        for line in lines[-n:]:
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue
            if not isinstance(entry, dict):
                continue
            out.append({k: _clip(v) for k, v in entry.items()})
        return out

    def notes(self, limit: int = 40) -> list[dict[str, Any]]:
        with self._db_lock:
            rows = self.memory.recent_notes(limit)
        return [dict(r) for r in rows]

    def questions(self) -> dict[str, list[dict[str, Any]]]:
        with self._db_lock:
            rows = self.db.query("SELECT * FROM questions ORDER BY id DESC LIMIT 60")
        items = [dict(r) for r in rows]
        return {
            "open": [q for q in items if q["status"] == "open"],
            "answered": [q for q in items if q["status"] != "open"],
        }

    def interests(self) -> list[dict[str, Any]]:
        with self._db_lock:
            rows = self.memory.interests(30)
        return [{"topic": t, "weight": w} for t, w in rows]

    def journal(self) -> dict[str, Any]:
        with self._db_lock:
            path = self.memory.journal_path()
        text = path.read_text(encoding="utf-8") if path.exists() else ""
        return {"path": str(path), "text": text}

    def chat(self, limit: int = 60) -> list[dict[str, Any]]:
        with self._db_lock:
            rows = self.memory.recent_chat(limit)
        return [dict(r) for r in rows]

    # ---- writes --------------------------------------------------------------

    def control(self, op: str) -> dict[str, Any]:
        cfg = self.cfg
        cfg.workspace.mkdir(parents=True, exist_ok=True)
        if op == "pause":
            cfg.pause_file.touch()
            note = "paused: the agent finishes its current action and waits"
        elif op == "resume":
            for path in (cfg.pause_file, cfg.stop_file):
                if path.exists():
                    path.unlink()
            note = "resumed: PAUSE and STOP cleared"
        elif op == "stop":
            cfg.stop_file.touch()
            note = "stop requested: the agent exits within a second and stays down until resumed"
        else:
            return {"error": f"unknown op {op!r}"}
        self.logger.info("control: %s", op)
        return {"ok": True, "note": note}

    def chat_message(self, text: str) -> dict[str, Any]:
        text = text.strip()[:2000]
        if not text:
            return {"error": "empty message"}
        if text.startswith("/"):
            with self._db_lock:
                self.memory.add_chat("owner", text, seen=True)  # commands are not for the model
                reply = self._command(text)
                self.memory.add_chat("system", reply, seen=True)
            return {"reply": reply, "kind": "command"}
        with self._db_lock:
            self.memory.add_chat("owner", text)  # left unseen: the running agent reads it next cycle
            system, prompt = self._build_prompt(text)
        game = self.quiet.game_reason() if self.quiet is not None else ""
        with self._model_lock:
            if game:
                reply = self._remote_only_reply(system, prompt)
            else:
                reply = (self.model.complete(system, prompt) or "").strip()
        if not reply and game:
            reply = (
                f"({game}, so I am not using the local model; the game has the GPU. Your message is saved "
                "and I will see it when I resume.)"
            )
        if not reply:
            reply = "(I could not reach the model just now. Try again in a moment.)"
        with self._db_lock:
            self.memory.add_chat("bot", reply, seen=True)
        return {"reply": reply, "kind": "model"}

    def _remote_only_reply(self, system: str, prompt: str) -> str:
        """Ask the remote providers of a FallbackModel, never its local fallback. "" when there are
        none, or none answered: the caller then says why instead of loading the local model."""
        primaries = getattr(self.model, "primaries", None)
        if not primaries:
            return ""
        from .common.fallback import FallbackModel

        remote_only = FallbackModel(
            primaries, _NoLocalModel(), self.logger, ledger=getattr(self.model, "ledger", None)
        )
        return (remote_only.complete(system, prompt) or "").strip()

    def _command(self, text: str) -> str:
        parts = text.split(maxsplit=1)
        cmd = parts[0].lower()
        arg = parts[1].strip() if len(parts) > 1 else ""
        if cmd == "/help":
            return HELP_TEXT
        if cmd == "/ask":
            if not arg:
                return "Usage: /ask <question>"
            qid = self.memory.add_question(arg)
            self.memory.write_markdown_mirrors()
            return f"Added question #{qid}: {arg}"
        if cmd == "/interest":
            if not arg:
                return "Usage: /interest <topic> [delta]"
            words = arg.rsplit(maxsplit=1)
            delta = 0.3
            topic = arg
            if len(words) == 2:
                try:
                    delta = float(words[1])
                    topic = words[0]
                except ValueError:
                    pass
            delta = max(-1.0, min(1.0, delta))
            weight = self.memory.adjust_interest(topic, delta)
            self.memory.write_markdown_mirrors()
            return f"Interest '{topic.strip().lower()}' is now {weight:.2f}"
        if cmd in ("/pause", "/resume", "/stop"):
            result = self.control(cmd[1:])
            return str(result.get("note") or result.get("error"))
        return f"Unknown command {cmd}. {HELP_TEXT}"

    def _build_prompt(self, message: str) -> tuple[str, str]:
        cfg = self.cfg
        interests = ", ".join(f"{t} ({w:.1f})" for t, w in self.memory.interests(8)) or "(none yet)"
        questions = "; ".join(f"#{r['id']} {r['question']}" for r in self.memory.open_questions(8)) or "(none)"
        rows = self.memory.search_notes(message, 5) or self.memory.recent_notes(5)
        notes = "\n".join(f"- {r['title']}: {r['body'][:300]}" for r in rows) or "- (no notes yet)"
        path = self.memory.journal_path()
        journal = path.read_text(encoding="utf-8")[-1500:].strip() if path.exists() else "(nothing today)"
        history_rows = [r for r in self.memory.recent_chat(12) if r["role"] in ("owner", "bot")]
        history = "\n".join(
            f"{'Owner' if r['role'] == 'owner' else cfg.agent.name}: {r['text'][:500]}" for r in history_rows
        ) or "(this is the first message)"
        from .target import Target

        target = Target.for_root(cfg.root)
        system = CHAT_SYSTEM.format(name=cfg.agent.name, bio=target.fill(cfg.agent.bio))
        prompt = CHAT_PROMPT.format(
            actions=self._actions_on_record(), requests=self._requests_on_record(), people=self._people(),
            interests=interests, questions=questions, notes=notes, journal=journal, history=history,
            message=message, name=cfg.agent.name,
        )
        return system, prompt


    # ---- the record a chat reply is held to (owner, 2026-09-25: the CEO's chat invented an engineer "Sam", a
    # Slack channel and a Notion token it never made; it had nothing on record to check itself against) ----------

    def _actions_on_record(self, limit: int = CHAT_ACTIONS) -> str:
        """The last actions from the actions table: only "allowed" ones happened; a refused or failed one did not."""
        lines = []
        for r in self.memory.recent_actions(limit):
            verdict = str(r["verdict"] or "")
            done = verdict == "allowed"
            what = str(r["result"] or "").strip()[:120] if done else f"({verdict[:80]})"
            lines.append(f"- {r['ts']} {r['action_type']}: {'done' if done else 'NOT done'} {what}".rstrip())
        return "\n".join(lines) or "- (nothing yet)"

    def _requests_on_record(self, limit: int = CHAT_REQUESTS) -> str:
        """This bot's side of requests.jsonl: what it asked of whom (and whether they answered), and what it was asked."""
        from .fleet_requests import RequestLog

        me = self.cfg.agent.name.strip().lower()
        try:
            rows = RequestLog(self.cfg.messaging.requests_path(self.cfg.root)).all()
        except OSError:
            rows = []
        mine = [r for r in rows if me in (r.sender.strip().lower(), r.to.strip().lower())][-limit:]
        lines = []
        for r in mine:
            state = (
                f"answered {r.answered_at}: {r.answer[:100]}" if r.answered_at
                else f"carried out {r.resolved_at}" if r.resolved_at
                else "expired, never answered" if r.expired
                else "still open"
            )
            who = f"you asked {r.to}" if r.sender.strip().lower() == me else f"{r.sender} asked you"
            lines.append(f"- {r.sent_at} {who}: {r.text[:100]!r} ({state})")
        return "\n".join(lines) or "- (no requests on record)"

    def _people(self) -> str:
        from .team import load_team

        team = load_team(self.cfg.notion.team_file)
        lines = [f"- {m.name}" + (f": {m.role}" if m.role else "") + " (team)" for m in team]
        lines += [f"- {n} (a bot in the fleet)" for n in self.cfg.messaging.peer_names]
        return "\n".join(lines) or "- (no team or fleet on record)"


class DashboardHandler(BaseHTTPRequestHandler):
    app: DashboardApp  # set on a subclass by make_server
    server_version = "explorer-dashboard/0.1"

    def log_message(self, format: str, *args: Any) -> None:  # noqa: A002 - stdlib signature
        return None  # quiet; the page polls every few seconds

    # ---- helpers -------------------------------------------------------------

    def _send(self, status: int, body: bytes, content_type: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def _json(self, obj: Any, status: int = 200) -> None:
        self._send(status, json.dumps(obj, ensure_ascii=False, default=str).encode("utf-8"), "application/json; charset=utf-8")

    def _authorized(self) -> bool:
        token = self.headers.get("X-Token") or ""
        if not secrets.compare_digest(token, self.app.token):
            return False
        origin = self.headers.get("Origin")
        if origin:
            host = self.headers.get("Host") or ""
            if origin.rstrip("/") != f"http://{host}":
                return False
        return True

    def _read_json(self) -> dict[str, Any] | None:
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            return None
        if length <= 0 or length > MAX_BODY:
            return None
        try:
            data = json.loads(self.rfile.read(length).decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            return None
        return data if isinstance(data, dict) else None

    # ---- routes --------------------------------------------------------------

    def do_GET(self) -> None:  # noqa: N802 - stdlib name
        url = urlparse(self.path)
        path = url.path
        query = parse_qs(url.query)
        app = self.app
        # Bound to loopback, reads are open: only this Mac can reach them. Bound anywhere else, the
        # notes, journal and chat are the owner's private record, so reads need the token too.
        if path != "/" and getattr(app, "reads_need_token", False) and not self._authorized():
            self._json({"error": "unauthorized"}, 401)
            return
        try:
            if path == "/":
                self._send(200, app.page().encode("utf-8"), "text/html; charset=utf-8")
            elif path == "/api/state":
                self._json(app.state())
            elif path == "/api/events":
                n = max(1, min(500, int(query.get("n", ["60"])[0] or 60)))
                self._json(app.events(n))
            elif path == "/api/notes":
                self._json(app.notes())
            elif path == "/api/questions":
                self._json(app.questions())
            elif path == "/api/interests":
                self._json(app.interests())
            elif path == "/api/journal":
                self._json(app.journal())
            elif path == "/api/chat":
                self._json(app.chat())
            elif path == "/screenshot.png":
                shot = app.cfg.screenshot_dir / "current.png"
                if shot.exists():
                    self._send(200, shot.read_bytes(), "image/png")
                else:
                    self._json({"error": "no screenshot yet"}, 404)
            else:
                self._json({"error": "not found"}, 404)
        except Exception as exc:  # noqa: BLE001 - report, never crash the server thread
            app.logger.exception("GET %s failed", path)
            self._json({"error": f"{type(exc).__name__}: {exc}"}, 500)

    def do_POST(self) -> None:  # noqa: N802 - stdlib name
        path = urlparse(self.path).path
        app = self.app
        if not self._authorized():
            self._json({"error": "forbidden"}, 403)
            return
        body = self._read_json()
        if body is None:
            self._json({"error": "expected a small JSON object"}, 400)
            return
        try:
            if path == "/api/chat":
                result = app.chat_message(str(body.get("text", "")))
            elif path == "/api/control":
                result = app.control(str(body.get("op", "")))
            else:
                self._json({"error": "not found"}, 404)
                return
        except Exception as exc:  # noqa: BLE001
            app.logger.exception("POST %s failed", path)
            self._json({"error": f"{type(exc).__name__}: {exc}"}, 500)
            return
        self._json(result, 400 if "error" in result else 200)


class DashboardServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def server_bind(self) -> None:
        # HTTPServer.server_bind does a reverse DNS lookup of the bind address, which takes 35 s on some
        # Macs. We know our own name; skip it.
        socketserver.TCPServer.server_bind(self)
        host, port = self.server_address[:2]
        self.server_name = str(host)
        self.server_port = int(port)


LOOPBACK_HOSTS = ("127.0.0.1", "localhost", "::1")


def make_server(app: DashboardApp, host: str, port: int) -> DashboardServer:
    """Bind the server (port 0 picks a free one). Call serve_forever() on the result.
    Off loopback, every read needs the token as well (see do_GET)."""
    app.reads_need_token = host not in LOOPBACK_HOSTS
    handler = type("BoundDashboardHandler", (DashboardHandler,), {"app": app})
    return DashboardServer((host, port), handler)
