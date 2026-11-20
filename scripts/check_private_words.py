"""Does a file meant for the public hold anything private? (Used on the Claude Code team template, docs/claude-team/.)

Two kinds of check:
- built in, for anyone: a home-folder path (/Users/<name>/, /home/<name>/), an email address (other than a noreply or an
  example one), a phone number, and a time-zone offset other than +0000 written as +HHMM;
- your own words: one per line in a file that is NOT in this repo -- its path in the RAMEN_PRIVATE_WORDS environment
  variable, or ~/.config/ramen-agents/private-words.txt. Put there the names of your people and sessions, your clients,
  your place and anything else that must never be published. Matched case-insensitively as whole words; a line starting
  with # is a comment. Without the file only the built-in checks run (and it says so).

    python3 scripts/check_private_words.py docs/claude-team/CLAUDE.team.md [more files]

Exit 0 when clean, 1 with each hit printed as file:line: what.
"""
from __future__ import annotations

import os
import re
import sys
from pathlib import Path

DEFAULT_LIST = Path("~/.config/ramen-agents/private-words.txt").expanduser()
BUILT_IN = (
    ("a home-folder path", re.compile(r"/(?:Users|home)/(?!<)[A-Za-z0-9._-]+")),
    ("an email address", re.compile(r"(?i)\b[A-Z0-9._%+-]+@(?!(?:example\.(?:com|org|net)|users\.noreply\.github\.com)\b)[A-Z0-9.-]+\.[A-Z]{2,}\b")),
    ("a phone number", re.compile(r"(?<![\w/.-])\+?\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}(?![\w/-])")),
    ("a time-zone offset", re.compile(r"(?<![\d:])[+-](?!0000)(?:0\d|1[0-4])[0-5]\d\b(?=\s|$|[)\],;])")),
)


def private_words(path: Path | None = None) -> tuple[list[str], Path | None]:
    p = path or Path(os.environ.get("RAMEN_PRIVATE_WORDS") or DEFAULT_LIST).expanduser()
    if not p.is_file():
        return [], None
    words = [w.strip() for w in p.read_text(encoding="utf-8").splitlines() if w.strip() and not w.strip().startswith("#")]
    return words, p


def hits(text: str, words: list[str]) -> list[tuple[int, str]]:
    out = []
    pats = [(w, re.compile(r"(?i)(?<![A-Za-z0-9])" + re.escape(w) + r"(?![A-Za-z0-9])")) for w in words]
    for n, line in enumerate(text.splitlines(), 1):
        for what, pat in BUILT_IN:
            if pat.search(line):
                out.append((n, what))
        for w, pat in pats:
            if pat.search(line):
                out.append((n, "a word on your private list"))      # the word itself is never printed
    return out


def main(argv: list[str]) -> int:
    files = [Path(a) for a in argv] or [Path(__file__).resolve().parents[1] / "docs" / "claude-team" / "CLAUDE.team.md"]
    words, src = private_words()
    if src is None:
        print("no private word list (RAMEN_PRIVATE_WORDS or ~/.config/ramen-agents/private-words.txt): built-in checks only")
    bad = 0
    for f in files:
        for n, what in hits(f.read_text(encoding="utf-8"), words):
            print(f"{f}:{n}: {what}")
            bad += 1
    print("clean" if not bad else f"{bad} hit(s)")
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
