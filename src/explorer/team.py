"""The owner's team: the people a bot may assign Notion tasks to.

Edited in the dashboard (Persona page > Team, webapp/lib/team.ts) and shared by every bot with the
Notion skill, so it lives in common-data/team.json next to the keys, not in one bot's folder. Each
member was picked from the Notion workspace's users, so `notion_id` is a real user id the API
accepts in a people property; the role and details are the owner's words about who does what,
shown to the model so it can pick the right person. One member may be the default: a task the
model leaves unassigned goes to them, so every task has an owner.

    {"version": 1, "members": [{"notionId": "...", "name": "Alex", "email": "alex@...",
                                "role": "Regional representative", "details": "...", "default": true}]}

Read-only here; the bot never writes it. A missing or broken file is an empty team, which keeps
the old behaviour (assignee names resolved against the workspace, unknown ones left blank).
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from .common.keys import keys_dir

MAX_MEMBERS = 40


def default_team_file() -> str:
    return str(keys_dir().parent / "team.json")


@dataclass(frozen=True)
class Member:
    notion_id: str
    name: str
    email: str = ""
    role: str = ""
    details: str = ""
    default: bool = False

    def matches(self, text: str) -> bool:
        """The owner's or the model's name for this person: full name, email, or an unambiguous
        first name ("Alex" for "Alex Stone")."""
        t = text.strip().lower()
        if not t:
            return False
        name = self.name.strip().lower()
        return t == name or (bool(self.email) and t == self.email.lower()) or t == name.split(" ")[0]


def load_team(path: str | Path) -> list[Member]:
    try:
        data = json.loads(Path(path).expanduser().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    rows = data.get("members") if isinstance(data, dict) else None
    out: list[Member] = []
    for row in rows if isinstance(rows, list) else []:
        if not isinstance(row, dict):
            continue
        nid = str(row.get("notionId") or "").strip()
        name = str(row.get("name") or "").strip()
        if not nid or not name:
            continue
        out.append(
            Member(
                notion_id=nid,
                name=name[:120],
                email=str(row.get("email") or "").strip()[:200],
                role=str(row.get("role") or "").strip()[:200],
                details=str(row.get("details") or "").strip()[:1500],
                default=bool(row.get("default")),
            )
        )
        if len(out) >= MAX_MEMBERS:
            break
    return out


def find_member(team: list[Member], text: str | None) -> Member | None:
    """The one member `text` names, or None when nobody or more than one does."""
    if not text or not text.strip():
        return None
    hits = [m for m in team if m.matches(text)]
    if len(hits) == 1:
        return hits[0]
    exact = [m for m in hits if m.name.strip().lower() == text.strip().lower()]
    return exact[0] if len(exact) == 1 else None


def default_member(team: list[Member]) -> Member | None:
    """Who an unassigned task goes to: the member marked default, else the only member, else nobody."""
    marked = [m for m in team if m.default]
    if marked:
        return marked[0]
    return team[0] if len(team) == 1 else None


def team_block(team: list[Member], assign: bool = True) -> str:
    """The prompt section that tells the model who it may assign tasks to -- or, with assign=False, who the team is while
    the owner does the assigning (owner, 2026-10-14)."""
    if not team:
        return ""
    if not assign:
        lines = ["", "## Team (the owner's list)", "Leave assignee null on every task: the owner assigns. Write the brief for whoever fits."]
        lines += [f"- {m.name}: " + (" -- ".join(b for b in (m.role, m.details) if b) or "no details given") for m in team]
        return "\n".join(lines) + "\n"
    lines = [
        "",
        "## Team (the owner's list; every task is assigned to exactly one of these people)",
        "Assign each task to the best fit below, by name. Their role and details say who does what.",
    ]
    fallback = default_member(team)
    for m in team:
        bits = [m.role] if m.role else []
        if m.details:
            bits.append(m.details)
        tag = " (default: tasks that fit nobody else go here)" if fallback is not None and m is fallback else ""
        lines.append(f"- {m.name}{tag}: " + (" -- ".join(bits) if bits else "no details given"))
    if fallback is None:
        lines.append("If a task truly fits none of them, leave assignee null and say in the details who should own it.")
    return "\n".join(lines) + "\n"
