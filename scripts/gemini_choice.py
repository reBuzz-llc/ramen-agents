#!/usr/bin/env python3
"""Whether Gemini may take calls that carry lead data: the person's own answer in sh scripts/add-key.sh gemini.

Google's terms for the free tier say not to submit personal information, so Gemini is closed to lead data by default
(personal_closed in common-data/configs/web-bots.toml). This writes the answer to the git-ignored
common-data/configs/local.toml and changes nothing else in that file.

    python3 scripts/gemini_choice.py open|close
"""
from __future__ import annotations

import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LINE = re.compile(r"^\s*personal_closed\s*=")
ONE_LINE = re.compile(r"^\s*personal_closed\s*=\s*\[([^\]]*)\]\s*(?:#.*)?$")
HEADER = re.compile(r"^\s*\[")


def names(text: str) -> list[str] | None:
    """The list in a file's [model] table; None when it has none."""
    table = ""
    for line in text.splitlines():
        if HEADER.match(line):
            table = line.split("#", 1)[0].strip()
        elif table == "[model]" and LINE.match(line):
            found = ONE_LINE.match(line)
            if not found:
                raise ValueError("personal_closed is not on one line")
            return re.findall(r'"([^"]+)"', found.group(1))
    return None


def rewrite(text: str, wanted: list[str]) -> str:
    new = "personal_closed = [" + ", ".join(f'"{n}"' for n in wanted) + "]"
    lines, table, at = text.splitlines(), "", None
    for i, line in enumerate(lines):
        if HEADER.match(line):
            table = line.split("#", 1)[0].strip()
            if table == "[model]":
                at = i
        elif table == "[model]" and LINE.match(line):
            lines[i] = new
            return "\n".join(lines) + "\n"
    if at is None:
        return (text.rstrip("\n") + "\n\n" if text.strip() else "") + f"[model]\n{new}\n"
    lines.insert(at + 1, new)
    return "\n".join(lines) + "\n"


def choose(root: Path, open_it: bool) -> None:
    local = root / "common-data" / "configs" / "local.toml"
    text = local.read_text(encoding="utf-8") if local.exists() else ""
    current = names(text)
    base = current if current is not None else names((root / "common-data" / "configs" / "web-bots.toml").read_text(encoding="utf-8")) or []
    wanted = [n for n in base if n != "gemini"] if open_it else [*base, *([] if "gemini" in base else ["gemini"])]
    if wanted == base and current is None and not open_it:
        return                     # closed already, by the default: nothing to write
    out = rewrite(text, wanted)
    try:
        import tomllib
        tomllib.loads(out)
    except ImportError:
        pass
    local.parent.mkdir(parents=True, exist_ok=True)
    tmp = local.with_name(f"{local.name}.{os.getpid()}.tmp")
    tmp.write_text(out, encoding="utf-8")
    if local.exists():
        os.chmod(tmp, local.stat().st_mode & 0o777)
    tmp.replace(local)


if __name__ == "__main__":
    if len(sys.argv) != 2 or sys.argv[1] not in ("open", "close"):
        sys.exit("usage: python3 scripts/gemini_choice.py open|close")
    try:
        choose(ROOT, sys.argv[1] == "open")
    except (OSError, ValueError) as exc:
        sys.exit(f"could not save the choice in common-data/configs/local.toml: {exc}")
