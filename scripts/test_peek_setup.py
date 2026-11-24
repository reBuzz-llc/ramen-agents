"""python3 -m unittest scripts/test_peek_setup.py -- `sh scripts/peek.sh setup` and `back` (935 stage 4): the yes typed at
the prompt after the dry run's counts, nothing else answers it; the rows read back from Peek before the board's address
changes; and one command back. Peek's API is a small server here; npm, node, launchctl, curl and the launch-agent and
restart scripts are stand-ins that write down how they were called."""
from __future__ import annotations

import json
import os
import pty
import select
import shutil
import stat
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import peek_setup as ps  # noqa: E402
import test_move_to_peek as tm  # noqa: E402

KEY = "dashboard-read-key-for-tests"


class Fake(BaseHTTPRequestHandler):
    """Peek's list routes: the leads and tasks it holds, and its rate and package lists."""
    holds: dict = {"leads": [], "tasks": [], "rates": 0, "packages": 0}
    seen_auth: list = []

    def do_GET(self) -> None:  # noqa: N802
        Fake.seen_auth.append(self.headers.get("Authorization", ""))
        path = self.path.split("?")[0]
        if path.startswith("/v1/boards/"):
            board = path.split("/")[3]
            body = {board: [{"id": i} for i in Fake.holds[board]], "next": 1, "more": False}
        elif path.startswith("/v1/assets/"):
            name = path.split("/")[3]
            body = {name: [{"line": "x"}] * Fake.holds[name]}
        else:
            self.send_response(404); self.end_headers(); return
        data = json.dumps(body).encode()
        self.send_response(200); self.send_header("content-type", "application/json"); self.end_headers(); self.wfile.write(data)

    def log_message(self, *a) -> None:  # quiet
        pass


STUBS = {
    "launchctl": 'echo "launchctl $*" >> "$LOG"',
    "lsof": "exit 1",
    "sleep": "exit 0",
    "openssl": "echo 00ff",
    "npm": 'echo "npm $*" >> "$LOG"; if [ "$1 $2" = "run build" ]; then mkdir -p .next && echo b > .next/BUILD_ID; fi',
    "curl": 'for a in "$@"; do case "$a" in */api/health) exit 0;; esac; done; exit 1',
    "node": 'echo "node $*" >> "$LOG"',
}


class Setup(unittest.TestCase):
    def setUp(self) -> None:
        self.t = tempfile.TemporaryDirectory()
        t = Path(self.t.name)
        self.bots, self.bin, self.log = t / "bots", t / "bin", t / "calls.log"
        (self.bots / "scripts").mkdir(parents=True)
        for f in ("peek.sh", "peek_setup.py", "move_to_peek.py"):
            shutil.copy(HERE / f, self.bots / "scripts" / f)
        for name, body in {"install-launchd.sh": 'echo "install-launchd $*" >> "$LOG"', "restart-bot.sh": 'echo "restart $*" >> "$LOG"'}.items():
            (self.bots / "scripts" / name).write_text(f"#!/bin/sh\n{body}\n")
        self.bin.mkdir()
        for name, body in STUBS.items():
            f = self.bin / name
            f.write_text(f"#!/bin/sh\n{body}\n")
            f.chmod(f.stat().st_mode | stat.S_IEXEC)
        cd = self.bots / "common-data"
        for d in ("keys", "configs", "logs", "local"):
            (cd / d).mkdir(parents=True)
        (cd / "keys" / "portal-dashboard.key").write_text(KEY + "\n")
        self.toml = cd / "configs" / "local.toml"
        self.toml.write_text('[agent]\nname = "x"\n')
        (cd / "local" / "members.txt").write_text("lead-gen\n")
        tm.board(cd)  # the dashboard's local board with 2 leads, 1 task, 1 rate, 1 package
        (self.bots / "agent.plist").write_text("<plist/>")  # what install-launchd.sh writes
        self.portal = t / "portal"
        subprocess.run(["git", "init", "-q", str(self.portal)], check=True)
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Fake)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.port = self.server.server_address[1]
        Fake.seen_auth = []
        ids = {"leads": ["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002"], "tasks": ["00000000-0000-4000-8000-000000000003"]}
        Fake.holds = {**ids, "rates": 1, "packages": 1}

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.t.cleanup()

    def env(self) -> dict:
        return {**os.environ, "PATH": f"{self.bin}:{os.environ['PATH']}", "PEEK_KEEP_PATH": "1", "LOG": str(self.log), "BOTS_DIR": str(self.bots),
                "PORTAL_DIR": str(self.portal), "PEEK_PORT": str(self.port), "PEEK_HEALTH_WAIT": "5", "PEEK_PLIST": str(self.bots / "agent.plist"), "HOME": self.t.name}

    def setup_with(self, answer: str) -> tuple[int, str]:
        """Run setup in a terminal, typing `answer` when it asks."""
        pid, fd = pty.fork()
        if pid == 0:
            os.execve("/bin/bash", ["bash", str(self.bots / "scripts" / "peek.sh"), "setup"], self.env())
        out, typed, end = b"", False, time.time() + 60
        while time.time() < end:
            r, _, _ = select.select([fd], [], [], 0.2)
            if r:
                try:
                    chunk = os.read(fd, 4096)
                except OSError:
                    break
                if not chunk:
                    break
                out += chunk
            if not typed and b"Type yes" in out:
                os.write(fd, (answer + "\n").encode()); typed = True
        _, status = os.waitpid(pid, 0)
        return os.waitstatus_to_exitcode(status), out.decode(errors="replace")

    def calls(self) -> str:
        return self.log.read_text() if self.log.exists() else ""

    def test_no_terminal_stops_before_anything(self) -> None:
        r = subprocess.run(["bash", str(self.bots / "scripts" / "peek.sh"), "setup"], env=self.env(), capture_output=True, text=True, stdin=subprocess.DEVNULL)
        self.assertEqual(r.returncode, 1)
        self.assertIn("type yes", r.stdout)
        self.assertEqual(self.calls(), "", "nothing ran")

    def test_anything_but_yes_moves_nothing(self) -> None:
        code, out = self.setup_with("y")
        self.assertEqual(code, 1, out)
        self.assertIn("to move  2 leads, 1 tasks, 1 rates, 1 packages", out)
        self.assertIn("nothing moved", out)
        loads = [l for l in self.calls().splitlines() if l.startswith("node scripts/rebuild-load.mjs")]
        self.assertEqual(len(loads), 1)
        self.assertIn("--dry-run", loads[0])
        self.assertIn("--keys-prefix portal", loads[0])
        self.assertEqual(self.toml.read_text(), '[agent]\nname = "x"\n', "the board's address unchanged")

    def test_yes_moves_reads_back_and_switches(self) -> None:
        code, out = self.setup_with("yes")
        self.assertEqual(code, 0, out)
        self.assertRegex(out, r"leads\s+moved\s+2\s+on Peek\s+2")
        self.assertIn(f'portal_url = "http://127.0.0.1:{self.port}"', self.toml.read_text())
        self.assertIn('[agent]\nname = "x"', self.toml.read_text(), "the rest kept")
        calls = self.calls()
        self.assertIn("install-launchd portal-local peek-jobs", calls)
        self.assertIn("restart lead-gen", calls)
        self.assertTrue(Fake.seen_auth and all(a == f"Bearer {KEY}" for a in Fake.seen_auth))
        self.assertNotIn(KEY, out, "the key is never printed")
        self.assertEqual(tm.sqlite3.connect(self.bots / "common-data" / "local-board.sqlite3").execute("select count(*) from rows").fetchone()[0], 5, "the local board as it was")

    def test_a_row_missing_on_peek_keeps_the_local_board(self) -> None:
        Fake.holds["leads"] = Fake.holds["leads"][:1]
        code, out = self.setup_with("yes")
        self.assertEqual(code, 1, out)
        self.assertIn("MISSING 1", out)
        self.assertIn("sh scripts/peek.sh back", out)
        self.assertNotIn("portal_url", self.toml.read_text())

    def test_back_is_one_command(self) -> None:
        self.toml.write_text('[leads]\nportal_url = "http://127.0.0.1:3100"\nfill_only = true\n')
        agents = Path(self.t.name) / "Library" / "LaunchAgents"
        agents.mkdir(parents=True)
        for l in ("portal-local", "peek-jobs"):
            (agents / f"com.ramen-agents.{l}.plist").write_text("<plist/>")
        r = subprocess.run(["bash", str(self.bots / "scripts" / "peek.sh"), "back"], env=self.env(), capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertEqual(self.toml.read_text(), "[leads]\nfill_only = true\n")
        self.assertEqual(list(agents.iterdir()), [])
        self.assertIn("launchctl bootout", self.calls())
        self.assertIn("Peek's data stays", r.stdout)


class Helpers(unittest.TestCase):
    def test_set_url(self) -> None:
        self.assertEqual(ps.set_url("", "http://p"), '[leads]\nportal_url = "http://p"\n')
        self.assertEqual(ps.set_url("[a]\nx = 1\n", "http://p"), '[a]\nx = 1\n\n[leads]\nportal_url = "http://p"\n')
        self.assertEqual(ps.set_url('[leads]\nportal_url = "old"\n[b]\n', "http://p"), '[leads]\nportal_url = "http://p"\n[b]\n')
        self.assertEqual(ps.set_url("[leads]\nfill_only = true\n", "http://p"), '[leads]\nportal_url = "http://p"\nfill_only = true\n')
        self.assertEqual(ps.set_url('[leads]\nportal_url = "x"\n[b]\nportal_url = "keep"\n', None), '[leads]\n[b]\nportal_url = "keep"\n', "only [leads]'s")

    def test_compare(self) -> None:
        want = {"leads": {"a", "b"}, "tasks": set(), "rates": 1, "packages": 0}
        rows, ok = ps.compare(want, {"leads": {"a", "b", "c"}, "tasks": set(), "rates": 1, "packages": 0})
        self.assertTrue(ok, "rows already on Peek do not count against the move")
        _, ok = ps.compare(want, {"leads": {"a"}, "tasks": set(), "rates": 1, "packages": 0})
        self.assertFalse(ok)
        _, ok = ps.compare(want, {"leads": {"a", "b"}, "tasks": set(), "rates": 2, "packages": 0})
        self.assertFalse(ok)

    def test_news_lists_only_what_is_new(self) -> None:
        with tempfile.TemporaryDirectory() as t:
            repo = Path(t)
            subprocess.run(["git", "init", "-q", str(repo)], check=True)
            (repo / "docs").mkdir()
            one = {"date": "2026-11-20", "kind": "feature", "line": "Samples page", "step": ""}
            two = {"date": "2026-11-25", "kind": "feature", "line": "Follow up page", "step": "restart Peek"}
            (repo / "docs" / "updates.json").write_text(json.dumps({"entries": [one]}))
            for c in (["add", "-A"], ["-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-q", "-m", "a"]):
                subprocess.run(["git", "-C", str(repo), *c], check=True)
            old = subprocess.run(["git", "-C", str(repo), "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
            (repo / "docs" / "updates.json").write_text(json.dumps({"entries": [two, one]}))
            self.assertEqual(ps.news(repo, old), ["2026-11-25 Follow up page (restart Peek)"])
            self.assertEqual(ps.news(Path(t) / "none", old), [], "a Peek with no such file says nothing")

    def test_local_rows(self) -> None:
        with tempfile.TemporaryDirectory() as t:
            self.assertEqual(ps.local_rows(Path(t) / "none.sqlite3"), 0)
            self.assertEqual(ps.local_rows(tm.board(Path(t))), 5)


if __name__ == "__main__":
    unittest.main()
