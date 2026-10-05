"""Desk Agent blockers: parsing the engine's line, verifying causes against injected facts, the replies."""
from __future__ import annotations

import datetime as dt
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from blockers import Blocker, parse_blocker, parse_resolved, reply_text, unanswered_owner_messages, verify  # noqa: E402

LINE = "blocker: Accessibility is not granted to acmeBot.app | task: open Notes and draft the agenda | fix suggested to owner: grant Accessibility | please verify the cause and file it"


def test_parse_the_engines_line():
    b = parse_blocker(LINE)
    assert b and b.reason.startswith("Accessibility") and b.task == "open Notes and draft the agenda" and b.fix == "grant Accessibility"
    assert parse_blocker("hello, what do you check?") is None
    assert b.key == parse_blocker(LINE).key


def test_verify_accessibility_and_presence(tmp_path):
    cfg = {"allowed_apps": ["Safari", "Notes"], "idle_minutes": 3, "allowed_hotkeys": ["cmd+c"]}
    b = parse_blocker(LINE)
    v = verify(b, cfg=cfg, facts={"ax": lambda: (False, "2026-09-24T10:00:00")})
    assert v.status == "confirmed" and "not granted" in v.detail and "Accessibility" in v.fix
    v = verify(b, cfg=cfg, facts={"ax": lambda: (True, "2026-09-24T10:30:14")})
    assert v.status == "cleared" and "Retry the step" in reply_text(b, v)
    busy = Blocker("the Mac is not free: the owner is using it", "tidy the desktop")
    v = verify(busy, cfg=cfg, facts={"idle": lambda: 20.0, "front": lambda: "Safari"})
    assert v.status == "confirmed" and "20 s ago" in v.detail
    v = verify(busy, cfg=cfg, facts={"idle": lambda: 600.0, "front": lambda: "Finder"})
    assert v.status == "cleared"
    app = Blocker("app 'Terminal' is not allowed", "run a command")
    assert verify(app, cfg=cfg).status == "confirmed" and "Safari, Notes" in verify(app, cfg=cfg).detail
    model = Blocker("no online model is available", "draft")
    v = verify(model, cfg=cfg, facts={"tokens": lambda: (300000, {"api.groq.com": 300000}), "budget": lambda: 250000})
    assert v.status == "confirmed" and "budget is spent" in v.detail
    v = verify(model, cfg=cfg, facts={"tokens": lambda: (1000, {}), "budget": lambda: 250000})
    assert v.status == "not_confirmed"
    assert verify(Blocker("something odd", "x"), cfg=cfg).status == "unverified"


def test_unanswered_owner_messages(tmp_path):
    db = tmp_path / "explorer.sqlite3"
    con = sqlite3.connect(db)
    con.execute("CREATE TABLE chat (id INTEGER PRIMARY KEY, ts TEXT NOT NULL, role TEXT NOT NULL, text TEXT NOT NULL, seen INTEGER NOT NULL DEFAULT 0)")
    now = dt.datetime(2026, 9, 24, 12, 0)
    rows = [("2026-09-24T09:00:00", "owner", "open Notes"), ("2026-09-24T09:01:00", "bot", "on it"),
            ("2026-09-24T10:30:00", "owner", "now draft the agenda")]
    con.executemany("INSERT INTO chat(ts, role, text) VALUES (?, ?, ?)", rows); con.commit(); con.close()
    late = unanswered_owner_messages(db, within_minutes=60, now=now)
    assert [m["text"] for m in late] == ["now draft the agenda"] and late[0]["age_minutes"] == 90
    assert unanswered_owner_messages(db, within_minutes=120, now=now) == []


def test_parse_the_engines_resolved_line():
    assert parse_resolved("resolved: accessibility is not granted to acmebot.app; the mac is not free | a GUI step was allowed again") == \
        ["accessibility is not granted to acmebot.app", "the mac is not free"]
    assert parse_resolved("blocker: x | task: y") == []


# ---- LD09: is a lead's email really published by that business? -------------------------------------------

def test_email_verify_finds_reads_and_misses():
    """The check the owner's hallucinated list needed: Tasty Tacos publishes info@eattastytacos-example.com, while
    the imported row claimed franchise@tastytacos-example.com at 'high' confidence (2026-09-24)."""
    from email_check import pages_for, verify

    site = "https://tastytacos-example.com"
    pages = {site: "Tacos since 2002.", site + "/contact": "Email info@eattastytacos-example.com or call us."}
    get = lambda url: (200, pages[url]) if url in pages else (404, "")  # noqa: E731

    v = verify("franchise@tastytacos-example.com", site, get=get)
    assert v.status == "not_found" and not v.ok and "info@eattastytacos-example.com" in v.others
    v = verify("info@eattastytacos-example.com", site, get=get)
    assert v.status == "published" and v.ok and v.where.endswith("/contact")
    # An address the row points straight at is read first, before the guessed paths.
    assert pages_for(site, ["https://tastytacos-example.com/own-franchise"])[0] == "https://tastytacos-example.com/own-franchise"
    # Nothing to go on, and a site that cannot be read at all, are not the row's fault.
    assert verify("", site, get=get).status == "skipped"
    assert verify("a@b.com", "https://gone.example", get=lambda u: (_ for _ in ()).throw(OSError("dns"))).status == "unreachable"


def test_email_verdict_goes_stale():
    from email_check import stale
    import datetime as dt

    now = dt.datetime(2026, 9, 24, 12, 0)
    assert not stale("2026-09-20T12:00:00", 30, now)
    assert stale("2026-07-01T12:00:00", 30, now) and stale("", 30, now) and stale("rubbish", 30, now)


def test_cloudflare_protected_addresses_are_read():
    """Calm Studios' info@ sits behind data-cfemail; a raw search missed it (2026-09-25)."""
    from email_check import verify, visible_text
    # "info@calmstudios-example.yoga" XOR-encoded with key 0x5a, the way Cloudflare emits it.
    key = 0x5a
    enc = f"{key:02x}" + "".join(f"{ord(c) ^ key:02x}" for c in "info@calmstudios-example.yoga")
    page = f'<a href="/cdn-cgi/l/email-protection" data-cfemail="{enc}">[email protected]</a> &#64;'
    assert "info@calmstudios-example.yoga" in visible_text(page)
    v = verify("info@calmstudios-example.yoga", "https://www.calmstudios-example.yoga", get=lambda u: (200, page))
    assert v.status == "published"
