"""Tests for scripts/web-shots.py's rules (creatorCC queue 41): the ring name with the address hash, one attempt per
address a day, and pages that land on a login, consent or captcha page discarded.
    ~/Projects/bot/.venv/bin/python -m unittest scripts/test_web_shots.py   (npm run test:web-shots)"""
import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("web_shots", Path(__file__).with_name("web-shots.py"))
ws = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ws)


class WebShots(unittest.TestCase):
    def test_name_carries_the_address_hash(self):
        self.assertEqual(ws.url_hash("https://florist.example/"), "0ac7d852")  # the same as the dashboard's urlHash
        self.assertEqual(ws.file_name("lead-gen", "2026-10-31T11:50:00", "https://florist.example/"), "lead-gen-20261031T115000-0ac7d852.png")

    def test_one_attempt_a_day(self):
        attempts = {"https://a.example/": {"at": "2026-10-31T09:00:00", "ok": False, "reason": "timeout"}, "https://b.example/": {"at": "2026-10-30T23:59:00", "ok": True}}
        self.assertTrue(ws.tried_today(attempts, "https://a.example/", "2026-10-31"), "failed today: not again today")
        self.assertFalse(ws.tried_today(attempts, "https://b.example/", "2026-10-31"), "yesterday's: may try again")
        self.assertFalse(ws.tried_today(attempts, "https://c.example/", "2026-10-31"))

    def test_login_consent_and_captcha_pages_are_discarded(self):
        self.assertIsNotNone(ws.discard_reason("https://shop.example/", "Sign in to your account"))
        self.assertIsNotNone(ws.discard_reason("https://shop.example/", "Just a moment..."))
        self.assertIsNotNone(ws.discard_reason("https://consent.example.com/ml?continue=x", "Before you continue"))
        self.assertIsNotNone(ws.discard_reason("https://shop.example/account/login", "Shop"))
        self.assertIsNone(ws.discard_reason("https://www.florist.example/about", "About the florist"))

    def test_a_blank_capture_is_not_kept(self):
        self.assertTrue(ws.blank(b"\x89PNG" + b"0" * 1600))
        self.assertFalse(ws.blank(b"\x89PNG" + b"0" * 20000))

    def test_first_and_third_party(self):
        self.assertEqual(ws.site("cdn.florist.example"), ws.site("www.florist.example"))
        self.assertNotEqual(ws.site("www.googletagmanager.com"), ws.site("www.florist.example"))


if __name__ == "__main__":
    unittest.main()
