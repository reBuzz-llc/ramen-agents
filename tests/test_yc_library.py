"""The yc engine: YC's library page parsed once, cached a day, searched locally."""
from __future__ import annotations

import html
import json
import os
from pathlib import Path

import httpx

from explorer.yc_library import LIBRARY_URL, YCLibrary, parse_library


def library_page(items: list[dict]) -> str:
    data = {"component": "ArticlesLibraryIndexPage", "props": {
        "featured": items[0], "carousels": [{"title": "Startup School", "articles": items}]}}
    return f'<html><body><div data-page="{html.escape(json.dumps(data))}"></div></body></html>'


ITEMS = [
    {"slug": "Ab-how-to-sell", "title": "How to Sell to Your First Customers", "series_name": "None", "author": "Y Combinator",
     "description": "Founder-led sales for B2B startups.", "content": "None",
     "transcript": "Early customers come from your network. Do sales yourself. Charge real money from day one; "
                   "pricing is a signal. Enterprise buyers need a champion and a clear ROI story."},
    {"slug": "Cd-hiring", "title": "Hiring Your First Engineers", "series_name": "Office Hours", "author": "",
     "description": "When to hire.", "content": "Hire slowly. Contractors and agencies can build a first version.",
     "transcript": None},
]


class Clock:
    def __init__(self, t=1_800_000_000.0):
        self.t = t

    def __call__(self):
        return self.t


def make(tmp_path: Path, pages: list, clock=None) -> tuple[YCLibrary, list]:
    calls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(str(request.url))
        assert "?" not in str(request.url)  # robots.txt forbids /library?*; never query YC's search
        status, body = pages.pop(0) if len(pages) > 1 else pages[0]
        return httpx.Response(status, text=body)

    lib = YCLibrary(tmp_path / "yc.json", client=httpx.Client(transport=httpx.MockTransport(handler)), clock=clock or Clock())
    return lib, calls


def test_parse_library_reads_the_embedded_items_once_each():
    items = parse_library(library_page(ITEMS))
    assert [i["slug"] for i in items] == ["Ab-how-to-sell", "Cd-hiring"]  # featured repeats item 1: kept once
    assert items[0]["url"] == "https://www.ycombinator.com/library/Ab-how-to-sell"
    assert "Charge real money" in items[0]["text"] and "None" not in items[0]["text"]
    assert items[1]["series"] == "Office Hours"
    assert parse_library("<html>no data</html>") == []


def test_search_answers_covered_questions_and_passes_loose_ones_on(tmp_path: Path):
    lib, calls = make(tmp_path, [(200, library_page(ITEMS))])
    page = lib.search("how to sell to first customers and set pricing")
    assert page.ok and page.links[0].url.endswith("/library/Ab-how-to-sell")
    assert "[1] How to Sell to Your First Customers" in page.text and "Charge real money" in page.text
    loose = lib.search("offshore agencies winning clients in springfield city")
    assert not loose.ok and "nothing in the YC library" in (loose.error or "")
    half = lib.search("hire zebras")  # half the words match, but no item shares two: not an answer
    assert not half.ok
    assert calls == [LIBRARY_URL]  # one download for both searches


def test_the_cache_lasts_a_day_and_survives_a_failed_refresh(tmp_path: Path):
    clock = Clock()
    lib, calls = make(tmp_path, [(200, library_page(ITEMS)), (503, "down")], clock)
    assert len(lib.items()) == 2 and len(calls) == 1
    os.utime(tmp_path / "yc.json", (clock.t, clock.t))
    other, other_calls = make(tmp_path, [(200, "unused")], clock)  # a second bot on the Mac
    assert len(other.items()) == 2 and other_calls == []
    clock.t += 25 * 3600  # a day later YC is down: the stale cache still answers
    assert len(lib.items()) == 2 and len(calls) == 2


def test_the_real_library_page_parses(tmp_path: Path):
    """Against a copy of the live page when one is around (saved by hand, not committed: 15 MB)."""
    saved = Path("/tmp/claude-501/yclib.html")
    if not saved.exists():
        return
    items = parse_library(saved.read_text(encoding="utf-8"))
    assert len(items) > 100 and all(i["url"].startswith("https://www.ycombinator.com/library/") for i in items)
