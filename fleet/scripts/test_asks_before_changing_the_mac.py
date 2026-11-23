"""Homebrew installs and launch agents wait for a person's yes at a terminal; with no terminal they do not happen by themselves."""
from __future__ import annotations

import os
import pty
import select
import shutil
import signal
import stat
import subprocess
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent


def _tool(folder: Path, name: str, body: str) -> None:
    p = folder / name
    p.write_text("#!/bin/sh\n" + body)
    p.chmod(p.stat().st_mode | stat.S_IEXEC)


def _home(tmp_path: Path) -> tuple[Path, Path, dict]:
    home, stub = tmp_path / "home", tmp_path / "stub"
    (home / "bots" / "scripts").mkdir(parents=True)
    stub.mkdir()
    for f in ("install.sh", "read-only-guard.sh"):
        shutil.copy(HERE / f, home / "bots" / "scripts" / f)
    _tool(stub, "brew", f'echo "brew $*" >> "{tmp_path}/calls"\nexit 1\n')
    _tool(stub, "xcode-select", "echo /Library/Developer\n")
    for name in ("python3", "python3.11", "python3.12", "python3.13", "node"):
        _tool(stub, name, "exit 1\n")
    env = {**os.environ, "HOME": str(home), "PATH": f"{stub}:/usr/bin:/bin"}
    return home, tmp_path / "calls", env


def _at_terminal(cwd: Path, env: dict, answer: str) -> str:
    pid, fd = pty.fork()
    if pid == 0:
        os.chdir(cwd)
        os.execvpe("sh", ["sh", "scripts/install.sh"], env)
    out, end, sent = "", time.time() + 15, False
    while time.time() < end:
        if select.select([fd], [], [], 0.2)[0]:
            try:
                chunk = os.read(fd, 4096).decode(errors="replace")
            except OSError:
                break
            if not chunk:
                break
            out += chunk
            if "STOP" in out and "again" in out:
                break
        if not sent and out.rstrip().endswith("[Y/n]"):
            os.write(fd, (answer + "\n").encode())
            sent = True
    try:
        os.kill(pid, signal.SIGKILL)      # never left waiting at its prompt
    except ProcessLookupError:
        pass
    os.waitpid(pid, 0)
    return out


def test_with_no_terminal_it_names_the_command_and_installs_nothing(tmp_path):
    home, calls, env = _home(tmp_path)
    r = subprocess.run(["sh", "scripts/install.sh"], cwd=home / "bots", env=env, capture_output=True, text=True, stdin=subprocess.DEVNULL)
    assert r.returncode == 1 and "brew install python@3.12" in r.stdout and not calls.exists()


def test_no_at_the_terminal_installs_nothing(tmp_path):
    home, calls, env = _home(tmp_path)
    out = _at_terminal(home / "bots", env, "n")
    assert "[Y/n]" in out and "when you are ready" in out and not calls.exists()


def test_yes_at_the_terminal_runs_brew(tmp_path):
    home, calls, env = _home(tmp_path)
    out = _at_terminal(home / "bots", env, "y")
    assert calls.read_text().strip() == "brew install python@3.12" and "brew install python@3.12 failed" in out      # a failed install stops here
