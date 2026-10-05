"""Bots proposing new teammates: a bot that spots uncovered work suggests a new bot/role, appended to
a shared Markdown file the owner reviews (common-data/proposed-bots.md). The owner creates the bot with
`bot new` if it is worth it — a proposal is never auto-created. Mirrors scout.record_provider."""
from __future__ import annotations

import datetime as dt
from pathlib import Path

from .actions import ProposeTeammate

HEADER = "# New-bot ideas the fleet has proposed\n\nEach is a suggestion for the owner to weigh, never created automatically.\n"


def existing_roles(path: Path) -> set[str]:
    """Lower-cased role names already in the file, so the same one is not proposed twice."""
    if not path.exists():
        return set()
    out: set[str] = set()
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.startswith("## "):
            out.add(line[3:].split("(", 1)[0].strip().lower())
    return out


def record_proposed_teammate(path: Path, proposer: str, action: ProposeTeammate, now: dt.datetime | None = None) -> Path:
    now = now or dt.datetime.now()
    path = Path(path).expanduser()
    path.parent.mkdir(parents=True, exist_ok=True)
    head = "" if path.exists() else HEADER
    entry = (
        f"\n## {action.role.strip()} (proposed by {proposer} on {now.isoformat(timespec='minutes')})\n\n"
        f"- **Does:** {action.does.strip()}\n"
        f"- **Why the fleet needs it:** {action.why.strip()}\n"
    )
    with path.open("a", encoding="utf-8") as fh:
        fh.write(head + entry)
    return path
