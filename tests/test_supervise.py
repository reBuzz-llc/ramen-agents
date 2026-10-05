"""scripts/supervise.sh against a throwaway repo and a fake bot whose exit codes come from a file."""
from __future__ import annotations

import os
import subprocess
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
SCRIPT = REPO / "scripts" / "supervise.sh"


def git(repo: Path, *args: str) -> str:
    return subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True, text=True).stdout.strip()


@pytest.fixture
def home(tmp_path: Path) -> Path:
    """A fake explorer home: a git repo with two commits, workspace dirs, and a scripted fake bot."""
    home = tmp_path / "home"
    home.mkdir()
    subprocess.run(["git", "init", "-q", "-b", "main", str(home)], check=True)
    git(home, "config", "user.email", "t@example.com")
    git(home, "config", "user.name", "T")
    (home / "config.toml").write_text("")
    (home / "v.txt").write_text("1\n")
    git(home, "add", "-A")
    git(home, "commit", "-q", "-m", "one")
    (home / "workspace" / "dev").mkdir(parents=True)
    (home / "workspace" / "journal").mkdir(parents=True)
    # The fake bot and its state live OUTSIDE the repo, so a `git reset --hard` rollback cannot
    # delete them (and `git add -A` in a test cannot sweep them into a commit).
    side = home.parent / "fakebot"
    side.mkdir()
    fake_bot = side / "fakebot.sh"
    fake_bot.write_text(
        "#!/bin/sh\n"
        "# pops the first line of exit_codes.txt and exits with it; records each run with the repo HEAD\n"
        "d=\"$(dirname \"$0\")\"\n"
        "f=\"$d/exit_codes.txt\"\n"
        "code=$(head -n 1 \"$f\")\n"
        "tail -n +2 \"$f\" > \"$f.tmp\" && mv \"$f.tmp\" \"$f\"\n"
        "echo \"run $code $(git -C \"$EXPLORER_HOME\" rev-parse HEAD)\" >> \"$d/runs.log\"\n"
        "exit \"${code:-0}\"\n"
    )
    fake_bot.chmod(0o755)
    return home


def side_dir(home: Path) -> Path:
    return home.parent / "fakebot"


def run_supervisor(
    home: Path, codes: list[int], window: int = 600, max_rollbacks: int = 3, backoff: int = 0
) -> subprocess.CompletedProcess:
    (side_dir(home) / "exit_codes.txt").write_text("".join(f"{c}\n" for c in codes))
    env = {
        **os.environ,
        "EXPLORER_HOME": str(home),
        "EXPLORER_BOT": str(side_dir(home) / "fakebot.sh"),
        "EXPLORER_ROLLBACK_WINDOW": str(window),
        "EXPLORER_MAX_ROLLBACKS": str(max_rollbacks),
        "EXPLORER_RESTART_BACKOFF": str(backoff),  # the fake bot exits at once; no waiting in tests
    }
    return subprocess.run(["/bin/sh", str(SCRIPT)], env=env, capture_output=True, text=True, timeout=60)


def runs(home: Path) -> list[str]:
    path = side_dir(home) / "runs.log"
    return path.read_text().splitlines() if path.exists() else []


def journal_text(home: Path) -> str:
    files = list((home / "workspace" / "journal").glob("*.md"))
    return "\n".join(f.read_text() for f in files)


def test_a_bot_that_exits_at_once_waits_before_its_next_start(home):
    import time

    started = time.monotonic()
    run_supervisor(home, [75, 0], backoff=1)
    assert time.monotonic() - started >= 1.0  # one restart, one backoff pause
    assert len(runs(home)) == 2


def test_clean_exit_stays_down(home):
    proc = run_supervisor(home, [0])
    assert proc.returncode == 0
    assert len(runs(home)) == 1


def test_exit_75_restarts_immediately(home):
    proc = run_supervisor(home, [75, 75, 0])
    assert proc.returncode == 0
    assert len(runs(home)) == 3
    assert journal_text(home).count("asked to be restarted") == 2


def test_ordinary_crash_on_a_proven_version_is_left_to_launchd(home):
    # No last_good yet, so this crash is not an upgrade gone wrong: exit with the bot's code.
    proc = run_supervisor(home, [1])
    assert proc.returncode == 1
    assert len(runs(home)) == 1
    assert not (home / "workspace" / "STOP").exists()


def test_crash_on_a_fresh_commit_rolls_back_to_last_good(home):
    good = git(home, "rev-parse", "HEAD")
    (home / "v.txt").write_text("2\n")
    git(home, "add", "-A")
    git(home, "commit", "-q", "-m", "two (the bot's merge)")
    bad = git(home, "rev-parse", "HEAD")
    (home / "workspace" / "dev" / "last_good").write_text(good + "\n")
    (home / "workspace" / "dev" / "upgrade_commit").write_text(bad + "\n")  # the bot's own merge
    proc = run_supervisor(home, [1, 0])  # crash on the new commit, then a clean run on the rolled-back one
    assert proc.returncode == 0
    lines = runs(home)
    assert lines[0].endswith(bad)
    assert lines[1].endswith(good)
    assert git(home, "rev-parse", "HEAD") == good
    assert (home / "v.txt").read_text() == "1\n"
    text = journal_text(home)
    assert "Rolled back" in text and "rollback 1 of 3" in text
    assert (home / "workspace" / "dev" / "rollback_count").read_text().strip() == "1"


def test_too_many_rollbacks_leaves_a_stop_file(home):
    good = git(home, "rev-parse", "HEAD")
    (home / "workspace" / "dev" / "last_good").write_text(good + "\n")
    (home / "workspace" / "dev" / "rollback_count").write_text("2\n")
    (home / "v.txt").write_text("3\n")
    git(home, "add", "-A")
    git(home, "commit", "-q", "-m", "three")
    (home / "workspace" / "dev" / "upgrade_commit").write_text(git(home, "rev-parse", "HEAD") + "\n")
    proc = run_supervisor(home, [2], max_rollbacks=3)
    assert proc.returncode == 0
    assert (home / "workspace" / "STOP").exists()
    assert "Rolled back 3 times" in journal_text(home)
    assert git(home, "rev-parse", "HEAD") == good


def test_a_held_pid_lock_is_not_a_crash_and_never_rolls_back(home):
    """Exit 3 (another instance still holds the pid lock, e.g. right after a `kickstart -k`) waits and retries on the
    same commit; the checkout is not reset and the rollback count does not move."""
    good = git(home, "rev-parse", "HEAD")
    (home / "v.txt").write_text("2\n")
    git(home, "add", "-A")
    git(home, "commit", "-q", "-m", "two (fresh, unproven)")
    fresh = git(home, "rev-parse", "HEAD")
    (home / "workspace" / "dev" / "last_good").write_text(good + "\n")
    proc = run_supervisor(home, [3, 0])  # lock held once, then a clean run -- both on the fresh commit
    assert proc.returncode == 0
    lines = runs(home)
    assert len(lines) == 2 and all(line.endswith(fresh) for line in lines)
    assert git(home, "rev-parse", "HEAD") == fresh and (home / "v.txt").read_text() == "2\n"
    assert "pid lock" in journal_text(home) and "Rolled back" not in journal_text(home)
    assert not (home / "workspace" / "dev" / "rollback_count").exists()


def test_a_signal_kill_is_not_a_crash_either(home):
    good = git(home, "rev-parse", "HEAD")
    (home / "v.txt").write_text("2\n")
    git(home, "add", "-A")
    git(home, "commit", "-q", "-m", "two")
    fresh = git(home, "rev-parse", "HEAD")
    (home / "workspace" / "dev" / "last_good").write_text(good + "\n")
    proc = run_supervisor(home, [143])  # SIGTERM from launchd
    assert proc.returncode == 143
    assert git(home, "rev-parse", "HEAD") == fresh
    assert "Rolled back" not in journal_text(home)


def test_an_operator_commit_is_never_rolled_back(home):
    """A crash on a commit the bot did not make itself (no upgrade marker) is an ordinary crash: launchd restarts it."""
    good = git(home, "rev-parse", "HEAD")
    (home / "v.txt").write_text("2\n")
    git(home, "add", "-A")
    git(home, "commit", "-q", "-m", "two (an operator's commit)")
    ours = git(home, "rev-parse", "HEAD")
    (home / "workspace" / "dev" / "last_good").write_text(good + "\n")
    proc = run_supervisor(home, [1])
    assert proc.returncode == 1
    assert git(home, "rev-parse", "HEAD") == ours and (home / "v.txt").read_text() == "2\n"
    assert "Rolled back" not in journal_text(home)
