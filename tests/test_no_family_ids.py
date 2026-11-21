"""The public starter carries nothing of the family's own (the Python twin of the dashboard's
no-family-ids test): every tracked file of this repository is scanned for a Notion link, a 32-hex id that is not an
obvious placeholder, a Supabase project ref, and a tailnet name; the family's own names are checked from the maintainers' private list, never written here. A placeholder reads
as one: a run of one character, few distinct characters, or an id starting 0123 / 1234 / abcd / dead / 0000."""
from __future__ import annotations

import os
import re
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SELF = "tests/test_no_family_ids.py"
PATTERNS = [
    ("a Notion link", re.compile(r"\b(?:www\.)?notion\.(?:so|site)/|app\.notion\.com/", re.I)),
    ("a Supabase project ref", re.compile(r"\b(?!<)[a-z]{20}\.supabase\.(?:co|com)\b")),
    ("a tailnet name", re.compile(r"\btail[0-9a-f]{6}\.ts\.net\b", re.I)),
]
HEX = re.compile(r"\b[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}\b", re.I)
SKIP = re.compile(r"\.(png|jpe?g|gif|ico|pdf|woff2?|ttf|sqlite3?)$|(^|/)package-lock\.json$")


def placeholder(v: str) -> bool:
    h = v.replace("-", "").lower()
    return len(set(h)) <= 4 or re.search(r"(.)\1{5}", h) is not None or re.match(r"^(0123|1234|abcd|dead|0000)", h) is not None


def test_no_id_link_or_name_of_the_familys_own_in_any_tracked_file():
    files = subprocess.run(["git", "ls-files"], cwd=ROOT, capture_output=True, text=True, check=True).stdout.split("\n")
    found = []
    for f in filter(None, files):
        if f == SELF or SKIP.search(f):
            continue
        try:
            text = (ROOT / f).read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        for i, line in enumerate(text.split("\n"), 1):
            found += [f"{f}:{i}: {what}" for what, rx in PATTERNS if rx.search(line)]
            found += [f"{f}:{i}: an id {m.group(0)[:8]}…" for m in HEX.finditer(line) if not placeholder(m.group(0))]
    assert found == []


NAMES_HEADER = "# own names the public tests refuse"


def own_names() -> list[str]:
    """The names in the private list's section. The list stays outside this repository, so without it the check is skipped."""
    where = os.environ.get("RAMEN_PRIVATE_WORDS", "")
    if not where or not Path(where).is_file():
        pytest.skip("RAMEN_PRIVATE_WORDS is not set: the check of the maintainers' private names needs their list")
    lines = Path(where).read_text(encoding="utf-8").splitlines()
    at = [i for i, line in enumerate(lines) if line.startswith(NAMES_HEADER)]
    assert at, f"the private list has no section starting {NAMES_HEADER!r}"
    names = []
    for line in lines[at[0] + 1:]:
        if line.startswith("#"):
            break
        if line.strip():
            names.append(line.strip())
    assert names, "the private list's names section is empty"
    return names


def test_no_tracked_file_or_path_holds_a_private_name():
    rx = re.compile("(?<![A-Za-z0-9])(?:" + "|".join(re.escape(n) for n in own_names()) + ")(?![A-Za-z0-9])", re.I)
    files = subprocess.run(["git", "ls-files"], cwd=ROOT, capture_output=True, text=True, check=True).stdout.split("\n")
    found = []
    for f in filter(None, files):
        if rx.search(f):
            found.append(f"{f}: its path")       # the name itself is never printed
        if SKIP.search(f):
            continue
        try:
            text = (ROOT / f).read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        found += [f"{f}:{i}: a private name" for i, line in enumerate(text.split("\n"), 1) if rx.search(line)]
    assert found == []


def test_the_placeholder_rule():
    assert placeholder("01234567-89ab-cdef-0123-456789abcdef") and placeholder("a" * 32) and placeholder("00000000-0000-0000-0000-000000000001")
    made_up = "-".join(("7b3e9f21", "48ac", "4d5e", "9a1b", "c2f60e8d4b97"))   # built from parts: no id of anyone's
    assert not placeholder(made_up)
