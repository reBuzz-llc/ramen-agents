"""The light browser: a plain fetch first, Chromium only when a page needs it.

No test touches the network or starts Chromium: pages come from an httpx.MockTransport and the Chromium
fallback is a recording stand-in.
"""
from __future__ import annotations

import logging
from pathlib import Path

import httpx
import pytest

from explorer.browser import Link, PageView
from explorer.config import Config, validate
from explorer.light_browser import CHROMIUM_IDLE_PAGES, LightBrowser, needs_javascript

from conftest import DENYLIST

ARTICLE = "<html><head><title>Fresnel lens</title></head><body><p>" + "A lens made of rings. " * 60 + \
    '</p><a href="/wiki/Lighthouse">Lighthouse</a><script>track()</script></body></html>'
SHELL = '<html><head><title>App</title></head><body><div id="root"></div><script src="/app.js"></script></body></html>'


class FakeChromium:
    def __init__(self, log: list[str]):
        self.log = log
        self.closed = False

    def open(self, url: str) -> PageView:
        self.log.append(f"open {url}")
        return PageView(url=url, title="drawn", text="rendered by chromium")

    def search(self, query: str) -> PageView:
        self.log.append(f"search {query}")
        return PageView(url="https://search.example/?q=" + query, title="results", text="[1] hit")

    def screenshot(self, path) -> bool:
        self.log.append("screenshot")
        Path(path).write_bytes(b"png")
        return True

    def fetch_text(self, url: str) -> str | None:
        self.log.append(f"robots {url}")
        return "User-agent: *\nDisallow: /private"

    def close(self) -> None:
        self.log.append("close")
        self.closed = True


def site(request: httpx.Request) -> httpx.Response:
    path = request.url.path
    html = {"content-type": "text/html; charset=utf-8"}
    if path == "/wiki/Fresnel":
        return httpx.Response(200, headers=html, text=ARTICLE)
    if path == "/app":
        return httpx.Response(200, headers=html, text=SHELL)
    if path == "/noscript":
        return httpx.Response(200, headers=html, text="<title>x</title><p>Please enable JavaScript to continue.</p>")
    if path == "/refused":
        return httpx.Response(403, headers=html, text="Forbidden")
    if path == "/busy":
        return httpx.Response(429, text="slow down")
    if path == "/gone":
        return httpx.Response(404, text="nope")
    if path == "/notes.md":
        return httpx.Response(200, headers={"content-type": "text/markdown; charset=utf-8"}, text="# Notes\n\nMoss grows <b>slowly</b>.")
    if path == "/pdf":
        return httpx.Response(200, headers={"content-type": "application/pdf"}, content=b"%PDF")
    if path == "/to-local":
        return httpx.Response(302, headers={"location": "http://127.0.0.1:8787/"})
    if path == "/to-denied":
        return httpx.Response(302, headers={"location": "https://shop.example/checkout"})
    if path == "/to-article":
        return httpx.Response(301, headers={"location": "/wiki/Fresnel"})
    if path == "/robots.txt":
        if request.url.host == "strict.example":
            return httpx.Response(403)
        return httpx.Response(200, headers={"content-type": "text/plain"}, text="User-agent: *\nAllow: /")
    if path == "/broken":
        raise httpx.RemoteProtocolError("server sent garbage", request=request)
    if path == "/nohost":
        raise httpx.ConnectError("[Errno 8] nodename nor servname provided", request=request)
    return httpx.Response(404)


@pytest.fixture
def tmp_png(tmp_path: Path) -> Path:
    return tmp_path / "shot.png"


def make(log: list[str] | None = None, handler=site, **kwargs) -> tuple[LightBrowser, list[str], list[FakeChromium]]:
    log = [] if log is None else log
    made: list[FakeChromium] = []

    def chromium() -> FakeChromium:
        made.append(FakeChromium(log))
        log.append("start")
        return made[-1]

    browser = LightBrowser("TestAgent/0.1", chromium, transport=httpx.MockTransport(handler), **kwargs)
    return browser, log, made


def test_a_plain_article_is_read_without_starting_chromium(tmp_png: Path):
    browser, log, _ = make()
    page = browser.open("https://en.wiki.example/wiki/Fresnel")
    assert page.ok and page.title == "Fresnel lens" and "A lens made of rings." in page.text
    assert page.links[0].url == "https://en.wiki.example/wiki/Lighthouse"
    assert "track()" not in page.text
    assert log == [] and browser.last_source == "text"
    assert browser.screenshot(tmp_png) is False  # nothing was drawn


@pytest.mark.parametrize("path", ["/app", "/noscript", "/refused", "/broken"])
def test_pages_a_plain_fetch_cannot_read_go_to_chromium(path: str, tmp_png: Path):
    browser, log, _ = make()
    page = browser.open(f"https://site.example{path}")
    assert page.ok and page.text == "rendered by chromium" and browser.last_source == "chromium"
    assert log == ["start", f"open https://site.example{path}"]
    assert browser.screenshot(tmp_png) is True


def test_a_rate_limit_is_never_retried_in_chromium():
    browser, log, _ = make()
    page = browser.open("https://site.example/busy")
    assert not page.ok and "rate-limiting" in (page.error or "")
    assert log == []


def test_missing_pages_unknown_hosts_and_non_text_stay_errors_without_chromium():
    browser, log, _ = make()
    assert "does not exist (HTTP 404)" in (browser.open("https://site.example/gone").error or "")
    assert "could not reach the site" in (browser.open("https://site.example/nohost").error or "")
    assert "not a text page" in (browser.open("https://site.example/pdf").error or "")
    notes = browser.open("https://site.example/notes.md")  # Markdown is text: shown as is, never sent to Chromium
    assert notes.ok and "Moss grows <b>slowly</b>." in notes.text and notes.title == "notes.md"
    assert log == []


def test_redirects_are_followed_but_checked_every_hop():
    denied = lambda url: "denylisted" if "checkout" in url else None  # noqa: E731
    browser, log, _ = make(allow_url=denied)
    page = browser.open("https://site.example/to-article")
    assert page.ok and page.url == "https://site.example/wiki/Fresnel"
    local = browser.open("https://site.example/to-local")
    assert not local.ok and "this machine" in (local.error or "")
    shop = browser.open("https://site.example/to-denied")
    assert not shop.ok and "denylisted" in (shop.error or "")
    assert not browser.open("http://localhost:11434/api/tags").ok  # never even asked
    assert log == []


def test_chromium_gives_its_memory_back_after_a_run_of_text_pages():
    browser, log, made = make()
    browser.open("https://site.example/app")
    for _ in range(CHROMIUM_IDLE_PAGES - 1):
        browser.open("https://site.example/wiki/Fresnel")
    assert not made[0].closed
    browser.open("https://site.example/wiki/Fresnel")
    assert made[0].closed and log[-1] == "close"
    browser.open("https://site.example/app")  # needed again: a fresh one starts
    assert len(made) == 2 and not made[1].closed


def test_back_returns_the_stored_page_and_search_is_drawn_by_chromium(tmp_png: Path):
    browser, log, _ = make()
    first = browser.open("https://site.example/wiki/Fresnel")
    results = browser.search("fresnel")
    assert results.title == "results" and browser.screenshot(tmp_png) is True
    assert browser.back() is first
    assert browser.screenshot(tmp_png) is False
    assert browser.back() is None


def test_robots_txt_is_fetched_plainly_and_through_chromium_only_when_refused():
    browser, log, _ = make()
    assert browser.fetch_text("https://site.example/robots.txt") == "User-agent: *\nAllow: /"
    assert log == []
    assert browser.fetch_text("https://strict.example/robots.txt") == "User-agent: *\nDisallow: /private"
    assert log == ["start", "robots https://strict.example/robots.txt"]
    assert browser.fetch_text("https://site.example/nohost") is None  # no Chromium for a host that is not there


def test_reset_closes_everything():
    browser, log, made = make()
    browser.open("https://site.example/app")
    browser.reset()
    assert made[0].closed and browser.current() is None and browser.back() is None


def test_needs_javascript_leaves_short_real_pages_alone():
    short = PageView(url="https://x.example/", title="Tiny", text="A short but complete page about moss.")
    assert not needs_javascript(short, "<p>A short but complete page about moss.</p>")
    assert needs_javascript(short, "<p>A short but complete page about moss.</p><script>app()</script>")
    long = PageView(url="https://x.example/", title="Essay", text="word " * 1000)
    assert not needs_javascript(long, "<script>analytics()</script>")


def test_light_is_the_default_backend_and_build_controller_wires_it(tmp_path: Path):
    from explorer.cli import build_controller

    cfg = Config(root=tmp_path)
    assert cfg.browser.backend == "light"
    cfg.agent.mode = "web"
    cfg.agent.contact = "https://owner.example.org"
    cfg.policy.denylist_file = str(DENYLIST)
    cfg.quiet.enabled = False
    cfg.ensure_dirs()
    validate(cfg)
    controller = build_controller(cfg, logging.getLogger("explorer.test"))
    try:
        assert isinstance(controller.browser, LightBrowser)
        assert controller.browser._chromium is None  # nothing heavy starts until a page needs it
        assert controller.searcher.engines == ["marginalia", "wikipedia", "hn"]
        assert controller.browser.allow_url("https://en.wikipedia.org/wiki/Moss") is None
        assert controller.browser.allow_url("http://192.168.1.1/") is not None
        assert "owner.example.org" in controller.browser.user_agent
    finally:
        controller.browser.close()


def test_a_text_page_removes_the_old_screenshot(cfg):
    from conftest import make_controller

    browser, _, _ = make()
    controller = make_controller(cfg, browser=browser)
    shot = cfg.screenshot_dir / "current.png"
    browser.open("https://site.example/app")
    controller._snapshot()
    assert shot.exists()
    browser.open("https://site.example/wiki/Fresnel")
    controller._snapshot()
    assert not shot.exists()


def test_the_model_is_told_which_engines_had_nothing(cfg):
    from explorer.actions import Search
    from explorer.model import Decision, ModelResult
    from explorer.search import Searcher, SearchPause, SearchSettings

    from conftest import make_controller

    class Asker:
        def decide(self, system, obs):
            return ModelResult(decision=Decision(thought="search", action=Search(type="search", query="moss")))

        def complete(self, system, prompt):
            return "summary"

    def run(engine: str, query: str) -> PageView:
        if engine == "marginalia":
            return PageView(url="https://small.example/", title="small", text="(no results)")
        return PageView(url="https://big.example/", title="big", text="[1] moss", links=[Link(1, "moss", "https://big.example/moss")])

    settings = SearchSettings(engines=["marginalia", "wikipedia"], pause_file=cfg.workspace / "pause.json")
    browser, _, _ = make()
    searcher = Searcher(browser, settings, SearchPause(settings.pause_file))
    searcher._run = run  # type: ignore[method-assign]
    controller = make_controller(cfg, model=Asker(), browser=browser, searcher=searcher)
    controller.run(max_cycles=1)
    row = controller.memory.db.query("SELECT result FROM actions ORDER BY id")[0]
    assert "(from wikipedia; marginalia had no results)" in row["result"]
