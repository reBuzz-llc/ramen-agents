"""The fleet folder on the main branch is a copy for reading. With READ-ONLY-COPY.md beside scripts/, the four scripts
that install, start or update refuse before they change directory or touch anything, and name the right clone command."""
from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
SCRIPTS = ("install.sh", "setup.sh", "update.sh", "install-launchd.sh", "enable-bot.sh", "disable-bot.sh", "restart-bot.sh", "sync-launchd.sh",
           "portal-local-setup.sh", "webapp/scripts/deploy.sh", "webapp/scripts/remote-access.sh")


@pytest.mark.parametrize("name", SCRIPTS)
def test_the_copy_refuses_before_it_does_anything(tmp_path, name):
    root = tmp_path / "ramen-agents" / "fleet"
    (root / "scripts").mkdir(parents=True)
    (root / "READ-ONLY-COPY.md").write_text("A copy for reading.\n")
    source = HERE.parent / name if "/" in name else HERE / name
    target = root / name if "/" in name else root / "scripts" / name
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy(source, target)
    shutil.copy(HERE / "read-only-guard.sh", root / "scripts" / "read-only-guard.sh")
    home = tmp_path / "home"
    (home / "bots").mkdir(parents=True)                 # update.sh would otherwise fall through to ~/bots
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    log = tmp_path / "called.log"
    for tool in ("launchctl", "git", "brew", "npm", "open"):
        stub = bin_dir / tool
        stub.write_text(f'#!/bin/sh\necho {tool} "$@" >> "{log}"\n')
        stub.chmod(0o755)
    before = sorted(p.name for p in root.iterdir())
    r = subprocess.run(["/bin/sh", str(target), "some-bot"], cwd=tmp_path, capture_output=True, text=True, timeout=20,
                       env={**os.environ, "HOME": str(home), "PATH": f"{bin_dir}:/usr/bin:/bin"})
    assert r.returncode == 1
    assert "read-only copy" in r.stderr and "git clone -b fleet -o starter" in r.stderr
    assert not log.exists() and sorted(p.name for p in root.iterdir()) == before and list((home / "bots").iterdir()) == []


@pytest.mark.parametrize("name", SCRIPTS)
def test_the_guard_is_the_first_command(name):
    text = (HERE.parent / name if "/" in name else HERE / name).read_text()
    first = next(line for line in text.splitlines()[1:] if line.strip() and not line.startswith("#") and not line.startswith("set "))
    assert first.startswith('. "$(dirname "$0")/') and "read-only-guard.sh" in first


def test_outside_the_copy_the_guard_lets_a_script_run(tmp_path):
    root = tmp_path / "bots" / "scripts"
    root.mkdir(parents=True)
    shutil.copy(HERE / "read-only-guard.sh", root / "read-only-guard.sh")
    (root / "x.sh").write_text('#!/bin/sh\n. "$(dirname "$0")/read-only-guard.sh"\necho ran\n')
    r = subprocess.run(["/bin/sh", str(root / "x.sh")], capture_output=True, text=True, timeout=10)
    assert r.returncode == 0 and r.stdout.strip() == "ran"
