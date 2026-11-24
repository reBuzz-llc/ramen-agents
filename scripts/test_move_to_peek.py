"""python3 -m unittest scripts/test_move_to_peek.py -- the local board's rows as Peek's rebuild files (935 stage 4)."""
from __future__ import annotations

import json
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import move_to_peek as m  # noqa: E402

SCHEMA = """CREATE TABLE rows (id TEXT PRIMARY KEY, board TEXT NOT NULL, rev INTEGER NOT NULL, created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0, cells TEXT NOT NULL DEFAULT '{}', last_by TEXT NOT NULL DEFAULT '{}',
 last_actor TEXT NOT NULL DEFAULT '');"""


def board(tmp: Path) -> Path:
    f = tmp / "local-board.sqlite3"
    con = sqlite3.connect(f)
    con.executescript(SCHEMA)
    add = lambda *v: con.execute("INSERT INTO rows VALUES (?,?,?,?,?,?,?,?,?)", v)  # noqa: E731
    add("00000000-0000-4000-8000-000000000001", "leads", 1, "2026-01-10T09:00:00Z", "2026-01-11T09:00:00Z", 0,
        json.dumps({"business": "Sunrise Bakery", "website": "https://sunrisebakery.example", "domain": "sunrisebakery.example", "city": "Springfield", "status": ["Email Sent", "Contacted"]}),
        json.dumps({"business": "bot", "website": "bot", "status": "person"}), "Sam")
    add("00000000-0000-4000-8000-000000000002", "leads", 2, "2026-01-12T09:00:00Z", "2026-01-12T09:00:00Z", 1, json.dumps({"business": "Corner Deli"}), "{}", "Lead Gen")
    add("00000000-0000-4000-8000-000000000003", "tasks", 3, "2026-01-12T08:00:00Z", "2026-01-12T08:30:00Z", 0, json.dumps({"title": "Check ten leads", "status": "Done"}), json.dumps({"title": "bot", "status": "person"}), "Sam")
    add("00000000-0000-4000-8000-000000000004", "rates", 4, "2026-01-12T08:00:00Z", "2026-01-12T08:00:00Z", 0, json.dumps({"line": "Starter Website", "price": "$500 one-time"}), "{}", "Owner")
    add("00000000-0000-4000-8000-000000000005", "packages", 5, "2026-01-12T08:00:00Z", "2026-01-12T08:00:00Z", 0, json.dumps({"name": "Starter Website", "price": "$500", "deliverables": ["one page"], "status": "draft", "by": "Package Designer"}), "{}", "Package Designer")
    con.commit()
    con.close()
    return f


class MoveToPeek(unittest.TestCase):
    def test_status_goes_where_peek_keeps_it(self) -> None:
        cells, by, missed = m.lead_cells({"status": ["WhatsApp Verified", "Ready to Send Email"], "email_status": "Email Sent"}, {"status": "person", "email_status": "bot"})
        self.assertEqual(cells, {"email_status": "Email Sent", "whatsapp_status": "WhatsApp Verified"}, "never over a value already there")
        self.assertEqual(by, {"email_status": "bot", "whatsapp_status": "person"})
        self.assertEqual(missed, [])
        cells, by, missed = m.lead_cells({"email_status": "Bounced"}, {"email_status": "person"})
        self.assertEqual((cells, by["result"]), ({"result": "Bounced"}, "person"), "a bounce is a result on Peek")
        cells, _, missed = m.lead_cells({"whatsapp_status": "Maybe", "status": "Email Sent"}, {})
        self.assertEqual((cells, missed), ({"email_status": "Email Sent"}, ["whatsapp_status: Maybe"]))

    def test_rows_cells_and_who_wrote_them(self) -> None:
        with tempfile.TemporaryDirectory() as t:
            tmp = Path(t)
            n = m.export(board(tmp), tmp / "out", "x")
            self.assertEqual(n, {"leads": 2, "tasks": 1, "assets": 2, "person cells": 2, "not placed": 1, "not placed values": ["status: Contacted"]})
            leads = [json.loads(x) for x in (tmp / "out" / "leads-rebuild-x.jsonl").read_text().splitlines()]
            self.assertEqual([l["id"][-1] for l in leads], ["1", "2"], "the board's own ids, kept")
            f = leads[0]["fields"]
            self.assertNotIn("domain", f, "derived cells are worked out again on Peek")
            self.assertNotIn("city", f)
            self.assertNotIn("status", f, "Peek's leads have no Status cell")
            self.assertEqual(f["email_status"], {"value": "Email Sent", "source": "the local board", "at": "2026-01-11T09:00:00Z", "by": "person"}, "moved with its writer")
            self.assertEqual(f["business"]["by"], "bot")
            self.assertTrue(leads[1]["archived"])
            self.assertEqual(leads[1]["fields"]["business"]["by"], "bot", "no record of who wrote it: an agent's")
            task = json.loads((tmp / "out" / "tasks-rebuild-x.jsonl").read_text())
            self.assertEqual(task["fields"]["status"]["by"], "person")

    def test_assets_as_peek_keeps_them(self) -> None:
        with tempfile.TemporaryDirectory() as t:
            tmp = Path(t)
            m.export(board(tmp), tmp / "out", "x")
            assets = [json.loads(x) for x in (tmp / "out" / "assets-rebuild-x.jsonl").read_text().splitlines()]
            self.assertEqual(assets[0], {"kind": "rate", "position": 0, "line": "Starter Website: $500 one-time", "source": "the local board"})
            self.assertEqual(assets[1]["kind"], "package")
            self.assertEqual(assets[1]["deliverables"], ["one page"])
            self.assertNotIn("by", assets[1], "the local board's review stamps are not Peek's package columns")
        self.assertEqual(m.rate_line({"line": "Care: $99/month", "price": "$99/month"}), "Care: $99/month")

    def test_the_board_is_only_read(self) -> None:
        with tempfile.TemporaryDirectory() as t:
            tmp = Path(t)
            f = board(tmp)
            before = f.read_bytes()
            m.export(f, tmp / "out", "x")
            self.assertEqual(f.read_bytes(), before)
            with self.assertRaises(SystemExit):
                m.export(tmp / "none.sqlite3", tmp / "out2", "x")


if __name__ == "__main__":
    unittest.main()
