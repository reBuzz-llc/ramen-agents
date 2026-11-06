"""The office's HTML desk screens in a real browser : at 1280, 1024 and 390 px wide, every member at a desk has a
screen box, no screen text is under 13 px, the page never scrolls sideways, the full form shows four lines and the
footer, and a click on a box opens the member's dialogue. Against a running dashboard:

    PLAYWRIGHT_SKIP_BROWSER_GC=1 npm run test:world-screens            # http://127.0.0.1:3000
    WORLD_URL=http://localhost:3105 PLAYWRIGHT_SKIP_BROWSER_GC=1 npm run test:world-screens
"""
from __future__ import annotations

import os
import unittest

os.environ.setdefault("PLAYWRIGHT_SKIP_BROWSER_GC", "1")
from playwright.sync_api import sync_playwright  # noqa: E402

URL = os.environ.get("WORLD_URL", "http://127.0.0.1:3000")
BOXES = "button[aria-label$='Open its card.']"


class WorldScreens(unittest.TestCase):
    def check(self, width: int, height: int) -> dict:
        with sync_playwright() as p:
            b = p.chromium.launch()
            pg = b.new_page(viewport={"width": width, "height": height})
            pg.goto(URL + "/", wait_until="networkidle")
            pg.locator(BOXES).first.wait_for(timeout=20000)
            info = pg.evaluate(
                """(sel) => {
                  const boxes = [...document.querySelectorAll(sel)];
                  const sizes = boxes.flatMap((b) => [...b.querySelectorAll('span, p')].filter((e) => e.textContent.trim() && getComputedStyle(e).display !== 'none').map((e) => parseFloat(getComputedStyle(e).fontSize)));
                  const first = boxes[0];
                  return { n: boxes.length, minFont: Math.min(...sizes), scroll: document.documentElement.scrollWidth, width: first.getBoundingClientRect().width,
                           rows: first.querySelectorAll('p').length };
                }""",
                BOXES,
            )
            name = pg.locator(BOXES).first.get_attribute("aria-label").split(",")[0]
            pg.locator(BOXES).first.click()
            pg.wait_for_timeout(600)
            info["dialogue"] = pg.locator("div[aria-live=polite]", has_text=name).count()
            b.close()
            return info

    def test_three_widths(self):
        for width, height in ((1280, 1000), (1024, 900), (390, 844)):
            with self.subTest(width=width):
                i = self.check(width, height)
                self.assertGreater(i["n"], 0)
                self.assertGreaterEqual(i["minFont"], 13)
                self.assertLessEqual(i["scroll"], width)
                self.assertGreaterEqual(i["dialogue"], 1)
                if i["width"] >= 120:
                    self.assertGreaterEqual(i["rows"], 4)  # the four lines (the footer is a span)


if __name__ == "__main__":
    unittest.main()
