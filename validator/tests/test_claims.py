"""LD16: a 'done' is held to the bot's own record."""
from __future__ import annotations

import json
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import claims  # noqa: E402


def bot_db(tmp_path, slug, rows):
    ws = tmp_path / slug / "workspace"; ws.mkdir(parents=True)
    con = sqlite3.connect(ws / "explorer.sqlite3")
    con.execute("CREATE TABLE actions (ts TEXT, action_type TEXT, verdict TEXT, payload TEXT)")
    con.executemany("INSERT INTO actions VALUES (?,?,?,?)", rows); con.commit(); con.close()


def test_a_done_is_checked_against_accepted_writes(tmp_path):
    bot_db(tmp_path, "lead-gen", [
        ("2026-09-25T20:22:40", "update_lead", "rejected: email not on the site", json.dumps({"name": "Corner Chicken House"})),
        ("2026-09-25T22:58:00", "update_lead", "allowed", json.dumps({"name": "Sunny Deli", "location": "Detroit, Michigan, USA"})),
        ("2026-09-25T22:59:00", "note", "allowed", json.dumps({"title": "x"})),
    ])
    writes = claims.lead_writes("lead-gen", "2026-09-25T22:33:00", db_dir=tmp_path)
    assert writes == ["Sunny Deli"]                       # the rejected write and the note do not count
    names = ["Corner Chicken House", "Sunny Deli", "BurgerBox"]
    text = "Filled in Founded by, Location, Company size, Industry, and Evidence for Corner Chicken House and Sunny Deli on the Leads board."
    assert claims.is_claim(text) and claims.is_claim("done: Sunny Deli: Location") and not claims.is_claim("I'm ready to help with the upkeep")
    claimed, unverified = claims.check_claim(text, names, writes)
    assert claimed == ["Corner Chicken House", "Sunny Deli"] and unverified == ["Corner Chicken House"]
    assert claims.check_claim("done: all rows updated", names, []) == ([], ["(no business named, and no write on record)"])
    assert claims.check_claim("done: all rows updated", names, ["Sunny Deli"]) == ([], [])
