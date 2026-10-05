from explorer.browser import FakeBrowser, build_links, clean_text, unwrap_redirect

from conftest import FAKE_WEB


def test_fake_browser_opens_index_and_resolves_links():
    browser = FakeBrowser(FAKE_WEB)
    page = browser.open("fake://index.html")
    assert page.ok
    assert page.title == "The Small Web Reading Room"
    assert "reading room" in page.text.lower()
    urls = {link.url for link in page.links}
    assert "fake://tides.html" in urls
    assert all(url.startswith("fake://") for url in urls)
    assert page.links[0].number == 1


def test_fake_browser_history_and_errors():
    browser = FakeBrowser(FAKE_WEB)
    browser.open("fake://index.html")
    tides = browser.open("fake://tides.html")
    assert browser.current() is tides
    back = browser.back()
    assert back is not None and back.url == "fake://index.html"
    assert browser.back() is None
    missing = browser.open("fake://nope.html")
    assert not missing.ok and missing.error
    outside = browser.open("fake://../../etc/passwd")
    assert not outside.ok
    wrong = browser.open("https://example.com/")
    assert not wrong.ok


def test_fake_search_finds_pages():
    browser = FakeBrowser(FAKE_WEB)
    page = browser.search("Fresnel")
    assert page.ok
    assert any(link.url == "fake://lighthouses.html" for link in page.links)
    empty = browser.search("zzzzqqq")
    assert empty.ok and not empty.links


def test_injection_page_is_just_text():
    browser = FakeBrowser(FAKE_WEB)
    page = browser.open("fake://cables.html")
    assert "SYSTEM NOTICE" in page.text
    assert any(link.url == "fake://login.html" for link in page.links)


def test_link_helpers():
    assert unwrap_redirect("https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa&rut=1") == "https://example.com/a"
    links = build_links([("a", "https://x.org/1"), ("b", "https://x.org/1"), ("c", "mailto:x@y"), ("", "https://x.org/2")], 10, {"https"})
    assert [l.url for l in links] == ["https://x.org/1", "https://x.org/2"]
    assert links[1].text == "(no text)"
    assert clean_text("a  b\n\n\n c \n") == "a b\n\nc"


def test_registered_domain_and_renumber():
    from explorer.browser import Link, registered_domain, renumber

    assert registered_domain("search.brave.com") == "brave.com"
    assert registered_domain("example.org:8080") == "example.org"
    assert registered_domain("localhost") == "localhost"
    links = renumber([Link(5, "a", "https://a.org/"), Link(9, "b", "https://b.org/")])
    assert [(l.number, l.url) for l in links] == [(1, "https://a.org/"), (2, "https://b.org/")]


def test_bot_check_pages_are_recognised():
    from explorer.browser import PageView, looks_like_bot_check

    challenge = PageView(
        url="https://search.brave.com/search?q=x",
        title="Brave Search",
        text="Verifying you're not a bot. Quick check before you continue searching. Verify. Switch to traditional CAPTCHA.",
    )
    assert looks_like_bot_check(challenge)
    article = PageView(url="https://en.wikipedia.org/wiki/Moss", title="Moss - Wikipedia", text="Mosses are small plants. " * 200)
    assert not looks_like_bot_check(article)
    failed = PageView(url="https://x.test/", title="", text="", ok=False, error="timeout")
    assert not looks_like_bot_check(failed)


def test_backoff_reason_tells_a_rate_limit_from_a_bot_check_from_an_ordinary_failure():
    from explorer.browser import PageView, backoff_reason, error_page, rate_limit_error

    assert backoff_reason(error_page("https://s.test/", rate_limit_error(429))) == "rate limit"
    assert backoff_reason(error_page("https://s.test/", rate_limit_error(503))) == "rate limit"
    assert backoff_reason(error_page("https://s.test/", "the site asked for a human check (bot verification page)")) == "bot check"
    # A missing page or a timeout is not a reason to stop searching altogether.
    assert backoff_reason(error_page("https://s.test/", "the page does not exist (HTTP 404)")) is None
    assert backoff_reason(error_page("https://s.test/", "TimeoutError: took too long")) is None
    assert backoff_reason(PageView(url="https://s.test/", title="Fine", text="content")) is None


def test_rate_limit_statuses_are_not_reported_as_a_missing_page():
    """A 429 read as 'the page does not exist', which told the model to try another wording."""
    from explorer.browser import rate_limit_error

    for status in (429, 503):
        message = rate_limit_error(status)
        assert "rate-limiting" in message and str(status) in message
        assert "does not exist" not in message


def test_mailto_addresses_become_page_text():
    """A business that publishes its email only as a mailto: link still has it 'on the page' (Lead Gen grounds a lead's
    email on the opened page's text; Mia's Bakery's bakery@ was invisible to the extractor, 2026-09-23)."""
    from explorer.browser import TextExtractor

    x = TextExtractor(lambda h: h)
    x.feed('<html><body><p>Visit us in Northside.</p><a href="mailto:bakery@miasnorthside.com?subject=hi">Email us</a>'
           '<a href="https://miasnorthside.com/menu">Menu</a></body></html>')
    text = x.text()
    assert "Visit us in Northside." in text and "Email us" in text
    assert "Email addresses linked on this page: bakery@miasnorthside.com" in text
    assert [href for _, href in x.links] == ["https://miasnorthside.com/menu"]  # mailto is not a followable link
