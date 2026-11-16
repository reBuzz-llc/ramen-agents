#!/usr/bin/env python3
"""Write common-data/local/family.toml from the first-run answers (queue 572; sh scripts/setup.sh calls it).

    NAME=... SELLS=... BUYERS=... PLACE=... [SEGMENT TRADES OWNER DOMAINS TEAMMATE STEER] python3 family_answers.py <file>

The file is git-ignored and mode 600. Standard library only. The keys are the ones the engine and the Validator read:
[company] name, sells, buyers, place, owner, signoff, own_domains; [target] market, market_short, segment, trades, areas;
[[team]] name, role, details; steer.
"""
from __future__ import annotations

import json
import os
import sys


def q(s: str) -> str:
    """A TOML basic string: a JSON string is one."""
    return json.dumps(s, ensure_ascii=False)


def domains(raw: str) -> list[str]:
    out = []
    for x in raw.split(","):
        d = x.strip().lower()
        for p in ("https://", "http://", "www."):
            d = d[len(p):] if d.startswith(p) else d
        d = d.split("/")[0]
        if d and d not in out:
            out.append(d)
    return out


def render(e: dict[str, str]) -> str:
    g = lambda k, d="": (e.get(k) or d).strip()  # noqa: E731
    name, place = g("NAME"), g("PLACE")
    owner = g("OWNER") or name
    lines = [
        "# Your family's answers (sh scripts/setup.sh, or the dashboard's first-run page). Not in git: yours to keep and edit.",
        # a top-level key comes before the first table, or TOML puts it inside that table
        *([f"steer = {q(g('STEER'))}", ""] if g("STEER") else []),
        "[company]",
        f"name = {q(name)}",
        f"sells = {q(g('SELLS'))}",
        f"buyers = {q(g('BUYERS'))}",
        f"place = {q(place)}",
        f"owner = {q(owner)}",
        f"signoff = {q(f'Regards,{chr(10)}{owner}{chr(10)}-- {name}')}",
        f"own_domains = {json.dumps(domains(g('DOMAINS')))}",
        "",
        "[target]",
        f"market = {q(place)}",
        f"market_short = {q(place.split(',')[0].strip())}",
        f"segment = {q(g('SEGMENT', 'small businesses'))}",
        f"trades = {q(g('TRADES') or g('BUYERS'))}",
        "",
        "[[team]]",
        f"name = {q(g('TEAMMATE') or owner)}",
        'role = "sends the first emails and answers replies"',
        'details = "Tasks about sending, replies and meetings go to this person."',
    ]
    return "\n".join(lines) + "\n"


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(__doc__)
        return 2
    missing = [k for k in ("NAME", "SELLS", "BUYERS", "PLACE") if not os.environ.get(k, "").strip()]
    if missing:
        print("needed: " + ", ".join(missing))
        return 1
    path = argv[1]
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(render(dict(os.environ)))
    os.chmod(path, 0o600)
    print(f"\nsaved: {path} (not in git)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
