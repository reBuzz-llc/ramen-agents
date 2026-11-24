"""python3 -m unittest scripts/test_peek.py -- Peek on this Mac (935 stage 4): update with its back-up and undo, the two
daily jobs with the secret on curl's standard input, and the secret made once and never printed. npm, curl, launchctl,
lsof, sleep and openssl are stand-ins that write down how they were called."""
from __future__ import annotations

import os
import stat
import subprocess
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent / "peek.sh"
SECRET = "ab" * 32

STUBS = {
    "launchctl": 'echo "launchctl $*" >> "$LOG"',
    "lsof": "exit 1",
    "sleep": "exit 0",
    "openssl": f'echo {SECRET}',
    # npm: `run build` makes a build (or fails when BUILD_FAILS is set); `ci` is noted
    "npm": 'echo "npm $*" >> "$LOG"; if [ "$1 $2" = "run build" ]; then [ -z "${BUILD_FAILS:-}" ] || exit 1; mkdir -p .next && echo new > .next/BUILD_ID; fi',
    # curl: the health check answers as HEALTH says; a job call keeps its arguments and its standard input
    "curl": 'for a in "$@"; do case "$a" in */api/health) [ "${HEALTH:-ok}" = ok ]; exit $?;; */api/jobs/*) echo "argv: $*" >> "$LOG"; echo "stdin: $(cat)" >> "$LOG"; exit 0;; esac; done; exit 1',
}


def sh(*args: str, cwd: Path | None = None) -> str:
    return subprocess.run(args, cwd=cwd, check=True, capture_output=True, text=True).stdout


class Peek(unittest.TestCase):
    def setUp(self) -> None:
        self.t = tempfile.TemporaryDirectory()
        t = Path(self.t.name)
        self.bin, self.log = t / "bin", t / "calls.log"
        self.bin.mkdir()
        for name, body in STUBS.items():
            f = self.bin / name
            f.write_text(f"#!/bin/sh\n{body}\n")
            f.chmod(f.stat().st_mode | stat.S_IEXEC)
        # the starter's `portal` branch, and Peek's checkout cloned from it with the remote named `starter`
        up = t / "upstream"
        sh("git", "init", "-q", "-b", "portal", str(up))
        for k, v in (("user.email", "t@example.com"), ("user.name", "t")):
            sh("git", "-C", str(up), "config", k, v)
        (up / "package-lock.json").write_text("{}\n")
        (up / "app.txt").write_text("v1\n")
        sh("git", "-C", str(up), "add", "-A")
        sh("git", "-C", str(up), "commit", "-q", "-m", "v1")
        self.portal = t / "portal"
        sh("git", "clone", "-q", "-o", "starter", "-b", "portal", str(up), str(self.portal))
        (self.portal / ".next").mkdir()
        (self.portal / ".next" / "BUILD_ID").write_text("old\n")
        for d, f in (("pglite", "PG_VERSION"), ("files", "photo.webp")):
            (self.portal / ".data" / d).mkdir(parents=True)
            (self.portal / ".data" / d / f).write_text("before\n")
        self.up, self.backups = up, t / "backups"
        self.plist = t / "agent.plist"
        self.plist.write_text("<plist/>")

    def tearDown(self) -> None:
        self.t.cleanup()

    def run_peek(self, *args: str, **env: str) -> subprocess.CompletedProcess:
        e = {**os.environ, "PATH": f"{self.bin}:{os.environ['PATH']}", "PEEK_KEEP_PATH": "1", "LOG": str(self.log),
             "PORTAL_DIR": str(self.portal), "PEEK_BACKUPS": str(self.backups), "PEEK_PLIST": str(self.plist), "PEEK_HEALTH_WAIT": "5", **env}
        return subprocess.run(["bash", str(SCRIPT), *args], env=e, capture_output=True, text=True)

    def new_version(self, lock_changes: bool = False) -> None:
        (self.up / "app.txt").write_text("v2\n")
        if lock_changes:
            (self.up / "package-lock.json").write_text('{"v": 2}\n')
        sh("git", "-C", str(self.up), "commit", "-q", "-am", "v2")

    def head(self) -> str:
        return sh("git", "-C", str(self.portal), "rev-parse", "HEAD").strip()

    def test_current_changes_nothing(self) -> None:
        r = self.run_peek("update")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("Peek is current", r.stdout)
        self.assertFalse(self.backups.exists())

    def test_check_says_and_changes_nothing(self) -> None:
        self.new_version()
        before = self.head()
        r = self.run_peek("update", "--check")
        self.assertIn("would", r.stdout)
        self.assertEqual(self.head(), before)

    def test_update_backs_up_builds_and_keeps_three(self) -> None:
        for i in range(4):
            (self.backups / f"2026010{i}-000000").mkdir(parents=True)
        self.new_version(lock_changes=True)
        r = self.run_peek("update")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertEqual((self.portal / "app.txt").read_text(), "v2\n")
        self.assertEqual((self.portal / ".next" / "BUILD_ID").read_text(), "new\n")
        self.assertFalse((self.portal / ".next.prev").exists())
        calls = self.log.read_text()
        self.assertIn("npm ci", calls, "the lock file changed")
        self.assertLess(calls.index("launchctl bootout"), calls.index("npm run build"), "stopped before the build")
        kept = sorted(p.name for p in self.backups.iterdir())
        self.assertEqual(len(kept), 3)
        newest = self.backups / kept[-1]
        self.assertEqual((newest / "pglite" / "PG_VERSION").read_text(), "before\n")
        self.assertEqual((newest / "files" / "photo.webp").read_text(), "before\n")

    def test_no_npm_ci_when_the_lock_is_the_same(self) -> None:
        self.new_version()
        self.assertEqual(self.run_peek("update").returncode, 0)
        self.assertNotIn("npm ci", self.log.read_text())

    def test_a_failed_start_puts_everything_back(self) -> None:
        old = self.head()
        self.new_version()
        # the new version's start changes the data, then never answers
        # (only on the first start: the start after the undo must find the data put back)
        once = Path(self.t.name) / "started"
        (self.bin / "launchctl").write_text(f'#!/bin/sh\necho "launchctl $*" >> "$LOG"\ncase "$1" in bootstrap) [ -e "{once}" ] || {{ touch "{once}"; echo after > "{self.portal}/.data/pglite/PG_VERSION"; }};; esac\n')
        r = self.run_peek("update", HEALTH="down")
        self.assertEqual(r.returncode, 1)
        self.assertIn("did not answer", r.stdout)
        self.assertEqual(self.head(), old)
        self.assertEqual((self.portal / ".next" / "BUILD_ID").read_text(), "old\n", "the previous build is back")
        self.assertEqual((self.portal / ".data" / "pglite" / "PG_VERSION").read_text(), "before\n", "the data as it was")

    def test_a_failed_build_puts_everything_back(self) -> None:
        old = self.head()
        self.new_version()
        r = self.run_peek("update", BUILD_FAILS="1")
        self.assertEqual(r.returncode, 1)
        self.assertIn("the build failed", r.stdout)
        self.assertEqual(self.head(), old)
        self.assertEqual((self.portal / ".next" / "BUILD_ID").read_text(), "old\n")

    def last_launchctl(self) -> str:
        lines = [l for l in self.log.read_text().splitlines() if l.startswith("launchctl boot")] if self.log.exists() else []
        return lines[-1] if lines else ""

    def test_no_room_for_the_copy_stops_before_peek_stops(self) -> None:
        old = self.head()
        self.new_version()
        r = self.run_peek("update", PEEK_FREE_KB="1")
        self.assertEqual(r.returncode, 1)
        self.assertIn("not enough room for a copy of Peek's data", r.stdout)
        self.assertNotIn("launchctl bootout", self.log.read_text() if self.log.exists() else "", "Peek was never stopped")
        self.assertEqual(self.head(), old)

    def test_a_failed_copy_starts_peek_again_and_says_so(self) -> None:
        old = self.head()
        self.new_version()
        cp = self.bin / "cp"
        cp.write_text('#!/bin/sh\ncase "$*" in *backups*) exit 1;; esac\nexec /bin/cp "$@"\n')
        cp.chmod(0o755)
        r = self.run_peek("update")
        self.assertEqual(r.returncode, 1)
        self.assertIn("the copy of Peek's data failed", r.stdout)
        self.assertTrue(self.last_launchctl().startswith("launchctl bootstrap"), "Peek started again")
        self.assertEqual(self.head(), old, "nothing updated")
        self.assertEqual(list(self.backups.iterdir()), [], "the half copy is removed")

    def test_no_peek_here_is_skipped(self) -> None:
        r = self.run_peek("update", PORTAL_DIR=str(Path(self.t.name) / "none"))
        self.assertEqual(r.returncode, 0)
        self.assertIn("no Peek", r.stdout)

    def test_secret_made_once_never_printed_mode_600(self) -> None:
        r1 = self.run_peek("secret")
        r2 = self.run_peek("secret")
        env = self.portal / ".env.local"
        self.assertEqual(env.read_text(), f"CRON_SECRET={SECRET}\n", "made once")
        self.assertEqual(stat.S_IMODE(env.stat().st_mode), 0o600)
        for r in (r1, r2):
            self.assertNotIn(SECRET, r.stdout + r.stderr)

    def test_jobs_send_the_secret_on_stdin_only(self) -> None:
        self.run_peek("secret")
        r = self.run_peek("jobs")
        self.assertEqual(r.returncode, 0, r.stdout)
        calls = self.log.read_text()
        self.assertIn("/api/jobs/stale-tasks", calls)
        self.assertIn("/api/jobs/sample-cleanup", calls)
        for line in calls.splitlines():
            if line.startswith("argv:"):
                self.assertNotIn(SECRET, line, "never on a command line")
        self.assertIn(f'stdin: header = "Authorization: Bearer {SECRET}"', calls)
        self.assertNotIn(SECRET, r.stdout + r.stderr)

    def test_jobs_without_a_secret_stop(self) -> None:
        r = self.run_peek("jobs")
        self.assertEqual(r.returncode, 1)
        self.assertIn("no CRON_SECRET", r.stdout)


if __name__ == "__main__":
    unittest.main()
