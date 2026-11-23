"""Setup installs no local model server unless the person names it."""
from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent


def _dry(tmp_path: Path, *names: str) -> str:
    root = tmp_path / "bots"
    (root / "scripts").mkdir(parents=True)
    for f in ("install-launchd.sh", "read-only-guard.sh"):
        shutil.copy(HERE / f, root / "scripts" / f)
    shutil.copytree(HERE.parent / "launchd", root / "launchd")
    res = subprocess.run(["sh", "scripts/install-launchd.sh", "--dry-run", *names], cwd=root, capture_output=True, text=True,
                         env={**os.environ, "HOME": str(tmp_path)})
    assert res.returncode == 0, res.stderr
    return res.stdout + res.stderr


def test_a_plain_install_has_no_local_model_server(tmp_path):
    out = _dry(tmp_path)
    assert "searxng" in out and "ollama" not in out.lower()


def test_it_installs_when_named(tmp_path):
    assert "com.ramen-agents.ollama" in _dry(tmp_path, "ollama")
