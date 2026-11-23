"""Gemini takes lead data only after the person's own yes, and the answer changes nothing else in the local config."""
from __future__ import annotations

import importlib.util
import os
import shutil
import subprocess
import tomllib
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("gemini_choice", HERE / "gemini_choice.py")
gc = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gc)
WEB = '[model]\nprovider_chain = ["zai", "gemini"]\npersonal_closed = ["gemini"]\n'


@pytest.fixture
def root(tmp_path):
    (tmp_path / "common-data" / "configs").mkdir(parents=True)
    (tmp_path / "common-data" / "configs" / "web-bots.toml").write_text(WEB)
    return tmp_path


def local(root) -> Path:
    return root / "common-data" / "configs" / "local.toml"


def test_the_shipped_default_is_closed():
    data = tomllib.loads((HERE.parent / "common-data" / "configs" / "web-bots.toml").read_text())
    assert "gemini" in data["model"]["personal_closed"] and "gemini" not in data["model"]["new_names_open"]


def test_yes_opens_it_in_the_local_file(root):
    gc.choose(root, True)
    assert tomllib.loads(local(root).read_text())["model"]["personal_closed"] == []


def test_no_with_nothing_written_stays_as_the_default(root):
    gc.choose(root, False)
    assert not local(root).exists()


def test_no_after_a_yes_closes_it_again(root):
    gc.choose(root, True)
    gc.choose(root, False)
    assert tomllib.loads(local(root).read_text())["model"]["personal_closed"] == ["gemini"]


def test_the_rest_of_the_file_is_kept(root):
    local(root).write_text('# mine\n[leads]\nportal_url = "http://x"\n\n[model]\nprovider_first = ["groq"]\n\n[quiet]\napps = ["Game"]\n')
    gc.choose(root, True)
    data = tomllib.loads(local(root).read_text())
    assert data["leads"]["portal_url"] == "http://x" and data["model"]["provider_first"] == ["groq"] and data["quiet"]["apps"] == ["Game"]
    assert data["model"]["personal_closed"] == [] and local(root).read_text().startswith("# mine")


def test_another_closed_provider_stays_closed(root):
    local(root).write_text('[model]\npersonal_closed = ["gemini", "other"]\n')
    gc.choose(root, True)
    assert tomllib.loads(local(root).read_text())["model"]["personal_closed"] == ["other"]


def test_a_list_it_cannot_read_is_left_alone(root):
    text = '[model]\npersonal_closed = [\n  "gemini",\n]\n'
    local(root).write_text(text)
    with pytest.raises(ValueError):
        gc.choose(root, True)
    assert local(root).read_text() == text


def _add_key(root: Path, stdin: str) -> subprocess.CompletedProcess:
    (root / "scripts").mkdir(exist_ok=True)
    for f in ("add-key.sh", "gemini_choice.py"):
        shutil.copy(HERE / f, root / "scripts" / f)
    return subprocess.run(["sh", "scripts/add-key.sh", "gemini"], cwd=root, input=stdin, text=True, capture_output=True,
                          env={**os.environ, "HOME": str(root)})


def test_with_no_answer_no_key_is_saved_and_the_terms_were_shown(root):
    res = _add_key(root, "a-pasted-key\n")
    assert res.returncode == 0 and not (root / "common-data" / "keys" / "gemini.key").exists()
    assert "Do not submit sensitive, confidential, or personal information to the Unpaid Services." in res.stdout
    assert "https://ai.google.dev/gemini-api/terms" in res.stdout and "a-pasted-key" not in res.stdout + res.stderr


def _at_a_terminal(root: Path, answers: list[str]) -> str:
    """add-key.sh in a real terminal, answering each question once it is shown."""
    import pty
    import select
    import time
    (root / "scripts").mkdir(exist_ok=True)
    for f in ("add-key.sh", "gemini_choice.py"):
        shutil.copy(HERE / f, root / "scripts" / f)
    pid, fd = pty.fork()
    if pid == 0:
        os.chdir(root)
        os.environ["HOME"] = str(root)
        os.execvp("sh", ["sh", "scripts/add-key.sh", "gemini"])
    out, end, left = "", time.time() + 20, list(answers)
    while time.time() < end:
        if select.select([fd], [], [], 0.2)[0]:
            try:
                chunk = os.read(fd, 4096).decode(errors="replace")
            except OSError:
                break
            if not chunk:
                break
            out += chunk
        if left and out.rstrip().endswith(("[y/N]", "press Return:")):
            os.write(fd, (left.pop(0) + "\n").encode())
            out += "\n"
    os.waitpid(pid, 0)
    return out


def test_yes_at_a_terminal_saves_the_key_and_opens_it(root):
    out = _at_a_terminal(root, ["y", "a-pasted-key"])
    key = root / "common-data" / "keys" / "gemini.key"
    assert key.read_text().strip() == "a-pasted-key" and oct(key.stat().st_mode)[-3:] == "600"
    assert tomllib.loads(local(root).read_text())["model"]["personal_closed"] == [] and "a-pasted-key" not in out


def test_enter_at_a_terminal_means_no(root):
    out = _at_a_terminal(root, [""])
    assert not (root / "common-data" / "keys" / "gemini.key").exists() and not local(root).exists() and "no key was saved" in out
