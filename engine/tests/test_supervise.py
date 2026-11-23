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
    # The fake bot and its state live OUTSIDE the repo, so `git add -A` in a test cannot sweep them into a commit.
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


def run_supervisor(home: Path, codes: list[int], backoff: int = 0) -> subprocess.CompletedProcess:
    (side_dir(home) / "exit_codes.txt").write_text("".join(f"{c}\n" for c in codes))
    env = {
        **os.environ,
        "EXPLORER_HOME": str(home),
        "EXPLORER_BOT": str(side_dir(home) / "fakebot.sh"),
        "EXPLORER_RESTART_BACKOFF": str(backoff),  # the fake bot exits at once; no waiting in tests
    }
    return subprocess.run(["/bin/sh", str(SCRIPT)], env=env, capture_output=True, text=True, timeout=60)


def runs(home: Path) -> list[str]:
    path = side_dir(home) / "runs.log"
    return path.read_text().splitlines() if path.exists() else []


def journal_text(home: Path) -> str:
    files = list((home / "workspace" / "journal").glob("*.md"))
    return "\n".join(f.read_text() for f in files)


def _second_commit(home: Path) -> str:
    (home / "v.txt").write_text("2\n")
    git(home, "add", "-A")
    git(home, "commit", "-q", "-m", "two")
    return git(home, "rev-parse", "HEAD")


def test_a_bot_that_exits_at_once_waits_before_its_next_start(home):
    import time

    started = time.monotonic()
    run_supervisor(home, [3, 0], backoff=1)
    assert time.monotonic() - started >= 1.0
    assert len(runs(home)) == 2


def test_clean_exit_stays_down(home):
    proc = run_supervisor(home, [0])
    assert proc.returncode == 0
    assert len(runs(home)) == 1


@pytest.mark.parametrize("code", [1, 75, 143])
def test_a_crash_or_signal_goes_to_launchd(home, code):
    proc = run_supervisor(home, [code])
    assert proc.returncode == code
    assert len(runs(home)) == 1
    assert not (home / "workspace" / "STOP").exists()


def test_a_held_pid_lock_waits_and_starts_again(home):
    fresh = _second_commit(home)
    proc = run_supervisor(home, [3, 0])
    assert proc.returncode == 0
    lines = runs(home)
    assert len(lines) == 2 and all(line.endswith(fresh) for line in lines)
    assert "pid lock" in journal_text(home)


def test_a_leftover_upgrade_file_never_moves_the_checkout_and_is_noted_once(home):
    """The old rollback's exact conditions: a crash on the marked commit, with a different last_good."""
    good = git(home, "rev-parse", "HEAD")
    fresh = _second_commit(home)
    dev = home / "workspace" / "dev"
    (dev / "last_good").write_text(good + "\n")
    (dev / "upgrade_commit").write_text(fresh + "\n")
    for _ in range(2):
        proc = run_supervisor(home, [1])
        assert proc.returncode == 1
    assert git(home, "rev-parse", "HEAD") == fresh and (home / "v.txt").read_text() == "2\n"
    assert journal_text(home).count("is ignored and nothing is rolled back") == 1
    assert (dev / "upgrade_commit").read_text().strip() == fresh


def test_a_new_install_gets_no_dev_folder(tmp_path, home):
    (home / "workspace" / "dev").rmdir()
    assert run_supervisor(home, [0]).returncode == 0
    assert not (home / "workspace" / "dev").exists()
    assert "self-upgrade" not in journal_text(home)


def test_the_script_has_no_way_to_change_the_checkout():
    code = "\n".join(line for line in SCRIPT.read_text().splitlines() if not line.lstrip().startswith("#"))
    assert "git " not in code and "reset" not in code


def test_the_supervisor_refuses_a_read_only_copy(home):
    (home / "READ-ONLY-COPY.md").write_text("A copy for reading.\n")
    head = git(home, "rev-parse", "HEAD")
    proc = run_supervisor(home, [1])
    assert proc.returncode == 0 and "read-only copy" in proc.stderr
    assert not (home.parent / "fakebot" / "runs.log").exists() and git(home, "rev-parse", "HEAD") == head
