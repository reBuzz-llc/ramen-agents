"""The text-only Tor browser, its onion directory, the allowlist, and the tor backend's wiring.

No test touches the network: pages come from an httpx.MockTransport that also records every request,
which is how "nothing but the page itself is ever fetched" is checked.
"""
import logging
from pathlib import Path

import httpx
import pytest

from explorer.actions import Follow, Open
from explorer.browser import Link, PageView, backoff_reason
from explorer.config import Config, PolicyConfig, PublishConfig, validate
from explorer.policy import Allowlist, Denylist, Policy, PolicyContext
from explorer.tor_browser import (
    ALLOWLIST_MARKER,
    DirectoryEntry,
    OnionDirectory,
    TorTextBrowser,
    is_onion_host,
    parse_rwos,
    write_allowlist,
)

from conftest import DENYLIST

BBC = "bbcnewsd73hkzno2ini43t4gblxvycyac5aw4gnv7t2rccijh7745uqd.onion"
DDG = "duckduckgogg42xjoc72x3sjasowoarfbgcmvfimaftt6twagswzczad.onion"
OTHER = "a" * 56 + ".onion"


class Site:
    """A fake web behind the mock transport: path -> (status, headers, body). Records requested URLs."""

    def __init__(self, pages: dict[str, tuple[int, dict[str, str], bytes]]):
        self.pages = pages
        self.requests: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        status, headers, body = self.pages.get(str(request.url), (404, {"content-type": "text/html"}, b"<title>404 Not Found</title>"))
        return httpx.Response(status, headers=headers, content=body)


def html(body: str, status: int = 200, **headers: str) -> tuple[int, dict[str, str], bytes]:
    return status, {"content-type": "text/html; charset=utf-8", **headers}, body.encode()


def make_browser(site: Site, directory: OnionDirectory | None = None, **kwargs) -> TorTextBrowser:
    return TorTextBrowser(
        "socks5h://127.0.0.1:9050", "TestAgent", directory or OnionDirectory(), transport=httpx.MockTransport(site), **kwargs
    )


ARTICLE = f"""<html><head><title>Onion News</title>
<link rel="stylesheet" href="/style.css"><script src="/app.js"></script></head>
<body><h1>Headline</h1><p>Tor was released in 2002.</p>
<img src="/photo.jpg"><video src="/clip.mp4"></video>
<a href="/story/2">Next story</a> <a href="http://{OTHER}/elsewhere">Elsewhere</a>
<script>document.write('ignored')</script></body></html>"""


def test_open_reads_text_and_links_and_fetches_nothing_else():
    site = Site({f"https://www.{BBC}/": html(ARTICLE)})
    browser = make_browser(site)
    page = browser.open(f"https://www.{BBC}/")
    assert page.ok and page.title == "Onion News"
    assert "Tor was released in 2002." in page.text and "ignored" not in page.text
    assert [l.url for l in page.links] == [f"https://www.{BBC}/story/2", f"http://{OTHER}/elsewhere"]
    # The stylesheet, scripts, image and video were never requested: one page, one request.
    assert [str(r.url) for r in site.requests] == [f"https://www.{BBC}/"]


def test_non_text_responses_are_refused():
    site = Site({
        f"http://{OTHER}/photo.jpg": (200, {"content-type": "image/jpeg"}, b"\xff\xd8binary"),
        f"http://{OTHER}/file.zip": (200, {"content-type": "application/zip"}, b"PK"),
        f"http://{OTHER}/notes.txt": (200, {"content-type": "text/plain"}, b"plain words\n\n\nhere"),
    })
    browser = make_browser(site)
    for name in ("photo.jpg", "file.zip"):
        page = browser.open(f"http://{OTHER}/{name}")
        assert not page.ok and "only reads text" in (page.error or "")
    text = browser.open(f"http://{OTHER}/notes.txt")
    assert text.ok and text.title == "notes.txt" and text.text == "plain words\n\nhere"


def test_large_pages_are_cut_off():
    body = "<title>Big</title><p>" + "word " * 50_000 + "</p>"
    site = Site({f"http://{OTHER}/big": html(body)})
    page = make_browser(site, max_bytes=20_000).open(f"http://{OTHER}/big")
    assert page.ok and len(page.text) < 20_000


def test_redirects_are_checked_against_the_rules():
    site = Site({
        f"http://{OTHER}/go-ok": html("", status=302, location=f"http://{OTHER}/landing"),
        f"http://{OTHER}/landing": html("<title>Landed</title><p>hello</p>"),
        f"http://{OTHER}/go-away": html("", status=301, location="https://clearnet.example/tracker"),
        f"http://{OTHER}/go-file": html("", status=302, location="file:///etc/passwd"),
    })
    allow = Allowlist([OTHER])
    browser = make_browser(site, allow_url=lambda url: None if allow.allows(httpx.URL(url).host) else "not listed")
    assert browser.open(f"http://{OTHER}/go-ok").title == "Landed"
    away = browser.open(f"http://{OTHER}/go-away")
    assert not away.ok and "may not read" in (away.error or "")
    assert "https://clearnet.example/tracker" not in [str(r.url) for r in site.requests]
    assert not browser.open(f"http://{OTHER}/go-file").ok


def test_status_errors_match_the_chromium_browser():
    site = Site({
        f"http://{OTHER}/busy": html("slow down", status=429),
        f"http://{OTHER}/down": html("unavailable", status=503),
    })
    browser = make_browser(site)
    assert backoff_reason(browser.open(f"http://{OTHER}/busy")) == "rate limit"
    assert backoff_reason(browser.open(f"http://{OTHER}/down")) == "rate limit"
    missing = browser.open(f"http://{OTHER}/nope")
    assert not missing.ok and "does not exist" in (missing.error or "")


def test_network_failures_become_error_pages():
    def broken(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused", request=request)

    def slow(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("timed out", request=request)

    down = TorTextBrowser("socks5h://127.0.0.1:9050", "T", OnionDirectory(), transport=httpx.MockTransport(broken))
    assert "is Tor running" in (down.open(f"http://{OTHER}/").error or "")
    assert down.fetch_text(f"http://{OTHER}/robots.txt") is None
    late = TorTextBrowser("socks5h://127.0.0.1:9050", "T", OnionDirectory(), transport=httpx.MockTransport(slow))
    assert "did not answer in time" in (late.open(f"http://{OTHER}/").error or "")


def test_cookies_are_never_sent_back():
    site = Site({
        f"http://{OTHER}/a": html("<title>A</title>", **{"set-cookie": "track=me; Path=/"}),
        f"http://{OTHER}/b": html("<title>B</title>"),
    })
    browser = make_browser(site)
    browser.open(f"http://{OTHER}/a")
    browser.open(f"http://{OTHER}/b")
    assert "cookie" not in site.requests[1].headers


def test_history_back_and_robots():
    site = Site({
        f"http://{OTHER}/1": html("<title>One</title>"),
        f"http://{OTHER}/2": html("<title>Two</title>"),
        f"http://{OTHER}/robots.txt": (200, {"content-type": "text/plain"}, b"User-agent: *\nDisallow: /private"),
    })
    browser = make_browser(site)
    assert browser.back() is None
    browser.open(f"http://{OTHER}/1")
    browser.open(f"http://{OTHER}/2")
    assert browser.current().title == "Two"
    assert browser.back().title == "One"
    assert "Disallow: /private" in (browser.fetch_text(f"http://{OTHER}/robots.txt") or "")
    assert browser.fetch_text(f"http://{OTHER}/missing.txt") == ""
    browser.reset()
    assert browser.current() is None and browser.back() is None


def test_search_uses_the_directory_and_pages_already_read():
    directory = OnionDirectory([
        DirectoryEntry("BBC News", f"https://www.{BBC}/", "News"),
        DirectoryEntry("DuckDuckGo", f"https://{DDG}/", "Search Engines"),
    ])
    site = Site({f"http://{OTHER}/tor-history": html("<title>History of Tor</title><p>The onion router began in 1995.</p>")})
    browser = make_browser(site, directory=directory)
    news = browser.search("world news")
    assert news.ok and [l.url for l in news.links] == [f"https://www.{BBC}/"]
    assert "Real-World Onion Sites" in news.text and news.url.startswith("http://onion-directory.invalid/")
    browser.open(f"http://{OTHER}/tor-history")
    router = browser.search("onion router history")
    assert f"http://{OTHER}/tor-history" in [l.url for l in router.links]
    nothing = browser.search("zzzz qqqq")
    assert "No results" in nothing.text and len(nothing.links) == 2  # falls back to listing the directory
    assert len(site.requests) == 1  # searching never touches the network


RWOS_SAMPLE = f"""# Real-World Onion Sites
## Legend/Key for Symbols
### [Not an entry](https://{OTHER}/)
## News
### [BBC](https://www.{BBC}/)
* link: [https://www.{BBC}/](https://www.{BBC}/)
* proof: [link](https://www.bbc.co.uk/news/technology-50150981)
### [Clearnet only](https://www.example.com/)
## Search Engines
### [DuckDuckGo](https://{DDG}/)
## SecureDrop
### [Some Newsroom](http://{"s" * 56}.onion/)
## Flaky Sites
### [Gone](http://{"f" * 56}.onion/)
"""


def test_parse_rwos_keeps_real_onion_entries_only():
    entries = parse_rwos(RWOS_SAMPLE)
    assert [(e.name, e.section) for e in entries] == [("BBC", "News"), ("DuckDuckGo", "Search Engines")]
    assert entries[0].proof == "https://www.bbc.co.uk/news/technology-50150981"
    assert is_onion_host(f"www.{BBC}") and not is_onion_host("example.onion") and not is_onion_host("bbc.co.uk")


def test_directory_round_trip_and_allowlist_file(tmp_path: Path):
    directory = OnionDirectory(parse_rwos(RWOS_SAMPLE), "sample", "2026-09-14T12:00:00")
    path = tmp_path / "dir.json"
    directory.save(path)
    loaded = OnionDirectory.load(path)
    assert len(loaded) == 2 and loaded.entries[0].url == f"https://www.{BBC}/"
    assert loaded.hosts() == sorted([BBC, DDG])  # www. is folded into the onion name

    allow_path = tmp_path / "allowed_hosts.txt"
    write_allowlist(allow_path, loaded.hosts())
    with allow_path.open("a", encoding="utf-8") as fh:
        fh.write(f"http://{OTHER}/some/page  # added by the owner\n")
    write_allowlist(allow_path, [BBC])  # a re-import drops DDG but keeps the owner's line
    text = allow_path.read_text(encoding="utf-8")
    assert ALLOWLIST_MARKER in text and DDG not in text
    allow = Allowlist.load(allow_path)
    assert allow.allows(f"www.{BBC}") and allow.allows(OTHER) and not allow.allows(DDG)
    assert not Allowlist.load(tmp_path / "missing.txt").allows(BBC)  # a missing file allows nothing


def ctx(page: PageView | None = None) -> PolicyContext:
    return PolicyContext(mode="web", current_page=page, actions_in_episode=0, pages_last_hour=0, open_questions=0, last_visit_by_domain={})


def test_policy_allowlist_refuses_unlisted_and_clearnet_sites():
    policy = Policy(PolicyConfig(respect_robots=False), PublishConfig(), Denylist.load(DENYLIST), allowlist=Allowlist([BBC]))
    assert policy.check(Open(type="open", url=f"https://www.{BBC}/news"), ctx()).allowed
    for url in (f"http://{OTHER}/", "https://en.wikipedia.org/wiki/Tor_(network)", "http://127.0.0.1:8787/"):
        verdict = policy.check(Open(type="open", url=url), ctx())
        assert not verdict.allowed
    page = PageView(url=f"https://www.{BBC}/", title="BBC", text="", links=[Link(1, "away", f"http://{OTHER}/")])
    refused = policy.check(Follow(type="follow", link=1), ctx(page))
    assert not refused.allowed and "allowlist" in refused.reason
    # The listed site's login pages are still denied: the allowlist narrows, it never overrides.
    assert not policy.check(Open(type="open", url=f"https://www.{BBC}/login"), ctx()).allowed
    # Without an allowlist nothing changes for the clearnet bots.
    open_policy = Policy(PolicyConfig(respect_robots=False), PublishConfig(), Denylist.load(DENYLIST))
    assert open_policy.check(Open(type="open", url="https://en.wikipedia.org/wiki/Tor_(network)"), ctx()).allowed


def tor_config(root: Path) -> Config:
    cfg = Config(root=root)
    cfg.agent.mode = "web"
    cfg.browser.backend = "tor"
    cfg.policy.allowlist_file = "workspace/allowed_hosts.txt"
    return cfg


def test_config_validation_guards_the_tor_backend(tmp_path: Path):
    validate(tor_config(tmp_path))
    bad = tor_config(tmp_path)
    bad.browser.tor_proxy = "socks5://127.0.0.1:9050"
    with pytest.raises(ValueError, match="socks5h"):
        validate(bad)
    no_list = tor_config(tmp_path)
    no_list.policy.allowlist_file = ""
    with pytest.raises(ValueError, match="allowlist_file"):
        validate(no_list)
    unknown = tor_config(tmp_path)
    unknown.browser.backend = "lynx"
    with pytest.raises(ValueError, match="backend"):
        validate(unknown)


def test_build_controller_wires_a_tor_only_bot(tmp_path: Path):
    from explorer.cli import build_controller

    cfg = tor_config(tmp_path)
    cfg.agent.contact = "https://owner.example.org"
    cfg.policy.denylist_file = str(DENYLIST)
    cfg.quiet.enabled = False
    cfg.ensure_dirs()
    OnionDirectory([DirectoryEntry("BBC", f"https://www.{BBC}/", "News")]).save(cfg.path(cfg.browser.onion_directory_file))
    write_allowlist(cfg.path(cfg.policy.allowlist_file), [BBC])
    controller = build_controller(cfg, logging.getLogger("explorer.test"))
    try:
        assert isinstance(controller.browser, TorTextBrowser)
        # Search never leaves Tor: the only engine is the local directory, with a pause file of its own.
        assert controller.searcher.engines == ["onion-directory"]
        assert controller.searcher.pause.path == cfg.workspace / "search_pause.json"
        assert controller.policy.allowlist is not None and controller.policy.allowlist.allows(f"www.{BBC}")
        # Redirect checks go through the real policy.
        assert controller.browser.allow_url(f"https://www.{BBC}/") is None
        assert controller.browser.allow_url("https://example.com/") is not None
        assert not hasattr(controller.browser, "screenshot")
        # The contact never travels over Tor, in the browser or in robots.txt requests.
        assert "example.org" not in controller.browser.user_agent
        assert controller.policy.robots is not None and "example.org" not in controller.policy.robots.user_agent
    finally:
        controller.browser.close()


def test_onion_directory_is_staged_for_review_and_only_accept_changes_what_the_bot_reads(tmp_path: Path, monkeypatch, capsys):
    import argparse

    from explorer import cli, tor_browser

    cfg = Config(root=tmp_path)
    cfg.browser.onion_directory_file = "workspace/onion_directory.json"
    cfg.policy.allowlist_file = "workspace/allowed_hosts.txt"
    live, allow, pending = cfg.path(cfg.browser.onion_directory_file), cfg.path(cfg.policy.allowlist_file), cli.pending_directory_path(cfg)

    def args(**over) -> argparse.Namespace:
        return argparse.Namespace(**{"source": "", "from_file": "", "accept": False, **over})

    # First import from a README the owner saved: staged, nothing live yet.
    readme = tmp_path / "rwos.md"
    readme.write_text(RWOS_SAMPLE, encoding="utf-8")
    assert cli.cmd_onion_directory(cfg, args(from_file=str(readme))) == 0
    out = capsys.readouterr().out
    assert pending.exists() and not live.exists() and not allow.exists()
    assert f"+ {BBC}  BBC [News]" in out and f"+ {DDG}  DuckDuckGo [Search Engines]" in out
    assert "--accept" in out

    assert cli.cmd_onion_directory(cfg, args(accept=True)) == 0
    assert not pending.exists() and len(OnionDirectory.load(live)) == 2
    assert Allowlist.load(allow).allows(BBC) and Allowlist.load(allow).allows(DDG)

    # Upstream changes (a new host appears, one disappears): the fetch shows the diff, the bot is unchanged.
    changed = RWOS_SAMPLE.replace(f"### [DuckDuckGo](https://{DDG}/)", f"### [New Site](https://{OTHER}/)")
    monkeypatch.setattr(tor_browser, "fetch_directory", lambda proxy, ua, source: OnionDirectory(parse_rwos(changed), source, "now"))
    assert cli.cmd_onion_directory(cfg, args()) == 0
    out = capsys.readouterr().out
    assert f"+ {OTHER}  New Site" in out and f"- {DDG}" in out and "1 added, 1 removed" in out
    assert Allowlist.load(allow).allows(DDG) and not Allowlist.load(allow).allows(OTHER)  # still the reviewed copy

    assert cli.cmd_onion_directory(cfg, args(accept=True)) == 0
    assert Allowlist.load(allow).allows(OTHER) and not Allowlist.load(allow).allows(DDG)
    assert cli.cmd_onion_directory(cfg, args(accept=True)) == 1  # nothing staged any more
