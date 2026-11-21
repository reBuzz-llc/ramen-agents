"""717: the fleet folder on the main branch is a copy for reading. With READ-ONLY-COPY.md beside scripts/, the four scripts
that install, start or update refuse before they change directory or touch anything, and name the right clone command."""
from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
SCRIPTS = ("install.sh", "setup.sh", "update.sh", "install-launchd.sh")


@pytest.mark.parametrize("name", SCRIPTS)
def test_the_copy_refuses_before_it_does_anything(tmp_path, name):
    root = tmp_path / "ramen-agents" / "fleet"
    (root / "scripts").mkdir(parents=True)
    (root / "READ-ONLY-COPY.md").write_text("A copy for reading.\n")
    shutil.copy(HERE / name, root / "scripts" / name)
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
    r = subprocess.run(["/bin/sh", str(root / "scripts" / name)], cwd=tmp_path, capture_output=True, text=True, timeout=20,
                       env={**os.environ, "HOME": str(home), "PATH": f"{bin_dir}:/usr/bin:/bin"})
    assert r.returncode == 1
    assert "read-only copy" in r.stderr and "git clone -b fleet -o starter" in r.stderr
    assert not log.exists() and sorted(p.name for p in root.iterdir()) == before and list((home / "bots").iterdir()) == []


@pytest.mark.parametrize("name", SCRIPTS)
def test_the_guard_comes_before_any_change_of_folder(name):
    text = (HERE / name).read_text()
    guard = text.index("READ-ONLY-COPY.md")
    first_cd = min(i for i in (text.find("\ncd "), text.find("; then cd ")) if i >= 0)
    assert guard < first_cd
