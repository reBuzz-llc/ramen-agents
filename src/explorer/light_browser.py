"""The light browser: `browser.backend = "light"`, the default for clearnet bots.

Most of what the agent reads (Wikipedia, blogs, docs, small independent sites) is plain HTML, and a
headless Chromium spends hundreds of megabytes to show it. Here a page is first one HTTP GET, turned
into text and links by the same parser the fake and Tor browsers use. Chromium (browser.py) is
started only when that is not enough:

- the page is a JavaScript shell (almost no text, or it says JavaScript is required),
- the site refuses plain HTTP clients (401/403/406) or answers with an interstitial check page,
- the connection fails in a way a real browser may not (TLS or protocol errors).

A rate limit (429/503) is never retried in Chromium: the site said wait, and search.py's pause and
the policy's pacing depend on that answer arriving unchanged. Chromium is closed again after a run of
pages that did not need it, so a bot that met one script-heavy site does not keep it in memory all
evening. Only pages Chromium drew have a screenshot.
"""
from __future__ import annotations

from typing import Callable, Protocol
from urllib.parse import urljoin, urlparse

import httpx

from .browser import (
    _RATE_LIMIT_STATUSES,
    PageView,
    TextExtractor,
    build_links,
    clean_text,
    error_page,
    is_private_host,
    looks_like_bot_check,
    looks_like_missing_page,
    rate_limit_error,
)

TEXT_TYPES = ("text/html", "application/xhtml+xml", "text/plain", "text/markdown")
_PLAIN_TYPES = ("text/plain", "text/markdown")  # shown as they are, no HTML parsing
_REFUSED_STATUSES = (401, 403, 406)
# Shells that render everything with scripts leave little text behind. Below this many characters a page
# that ships <script> tags is handed to Chromium.
_THIN_TEXT_CHARS = 400
_NEEDS_JS_MARKERS = (
    "enable javascript",
    "javascript is required",
    "requires javascript",
    "javascript is disabled",
    "turn on javascript",
    "please enable js",
    "you need to enable javascript",
    "just a moment...",  # interstitial check pages that a real browser passes by running their script
)
# After this many pages in a row without Chromium, it is closed to give the memory back.
CHROMIUM_IDLE_PAGES = 8


class FallbackBrowser(Protocol):
    def open(self, url: str) -> PageView: ...
    def search(self, query: str) -> PageView: ...
    def screenshot(self, path) -> bool: ...  # type: ignore[no-untyped-def]
    def fetch_text(self, url: str) -> str | None: ...
    def close(self) -> None: ...


def needs_javascript(page: PageView, html: str) -> bool:
    """True when the plain fetch probably missed the content a browser would show."""
    head = f"{page.title} {page.text[:2000]}".lower()
    if len(page.text) < 3000 and any(marker in head for marker in _NEEDS_JS_MARKERS):
        return True
    return len(page.text) < _THIN_TEXT_CHARS and "<script" in html.lower()


class LightBrowser:
    def __init__(
        self,
        user_agent: str,
        chromium: Callable[[], FallbackBrowser],
        max_links: int = 40,
        timeout_seconds: float = 30.0,
        max_bytes: int = 2_000_000,
        allow_url: Callable[[str], str | None] | None = None,
        transport: httpx.BaseTransport | None = None,
        max_redirects: int = 5,
    ):
        self.user_agent = user_agent
        self._make_chromium = chromium  # started on first need, never at construction
        self.max_links = max_links
        self.timeout_seconds = timeout_seconds
        self.max_bytes = max_bytes
        # Checked on every redirect hop, so a page cannot bounce the bot somewhere the policy refuses.
        self.allow_url = allow_url
        self.transport = transport  # tests inject a MockTransport
        self.max_redirects = max_redirects
        self._client: httpx.Client | None = None
        self._chromium: FallbackBrowser | None = None
        self._pages_without_chromium = 0
        self._drawn = False  # whether the current page came from Chromium, so a screenshot is real
        self._history: list[PageView] = []
        self._current: PageView | None = None
        self.last_source = ""  # "text" or "chromium", for logs and tests

    # -- HTTP -------------------------------------------------------------------

    def _http(self) -> httpx.Client:
        if self._client is None:
            options: dict = {
                "timeout": httpx.Timeout(self.timeout_seconds, connect=min(self.timeout_seconds, 10.0)),
                "headers": {
                    "User-Agent": self.user_agent,
                    "Accept": "text/html, application/xhtml+xml, text/plain;q=0.8",
                    "Accept-Language": "en",
                },
                "follow_redirects": False,
            }
            if self.transport is not None:
                options["transport"] = self.transport
            self._client = httpx.Client(**options)
        return self._client

    def _fetch(self, url: str, check_redirects: bool = True) -> tuple[str, int, str, str]:
        """GET a text resource, following redirects by hand. Returns (final_url, status, content_type, body).
        Raises ValueError with a readable reason when the page is refused."""
        client = self._http()
        for hop in range(self.max_redirects + 1):
            parsed = urlparse(url)
            if parsed.scheme.lower() not in ("http", "https"):
                raise ValueError(f"redirected to a '{parsed.scheme}' address; only http and https are read")
            # Chromium's router refuses these for every request; the plain fetch does the same on every hop.
            if is_private_host(parsed.hostname or ""):
                raise ValueError("that address is on this machine or its network; this bot never reads those")
            if hop > 0 and check_redirects and self.allow_url is not None:
                reason = self.allow_url(url)
                if reason:
                    raise ValueError(f"the site redirected to a page this bot may not read ({reason})")
            with client.stream("GET", url) as response:
                if response.is_redirect and response.headers.get("location"):
                    url = urljoin(url, response.headers["location"])
                    continue
                status = response.status_code
                ctype = response.headers.get("content-type", "").split(";")[0].strip().lower()
                if status >= 400:
                    return str(response.url), status, ctype, ""
                if ctype and ctype not in TEXT_TYPES:
                    raise ValueError(f"not a text page ({ctype}); this bot only reads text")
                chunks: list[bytes] = []
                size = 0
                for chunk in response.iter_bytes():
                    chunks.append(chunk)
                    size += len(chunk)
                    if size >= self.max_bytes:
                        break
                body = b"".join(chunks)[: self.max_bytes]
                encoding = response.charset_encoding or "utf-8"
                try:
                    text = body.decode(encoding, errors="replace")
                except LookupError:
                    text = body.decode("utf-8", errors="replace")
                return str(response.url), status, ctype, text
        raise ValueError(f"too many redirects (more than {self.max_redirects})")

    def _to_page(self, url: str, ctype: str, body: str) -> PageView:
        if ctype in _PLAIN_TYPES:
            name = urlparse(url).path.rsplit("/", 1)[-1] or urlparse(url).netloc
            return PageView(url=url, title=name, text=clean_text(body))
        parser = TextExtractor(lambda href: urljoin(url, href))
        parser.feed(body)
        parser.close()
        return PageView(
            url=url,
            title=" ".join(parser.title.split()),
            text=parser.text(),
            links=build_links(parser.links, self.max_links, {"http", "https"}),
        )

    # -- Chromium ---------------------------------------------------------------

    def _browser(self) -> FallbackBrowser:
        if self._chromium is None:
            self._chromium = self._make_chromium()
        return self._chromium

    def _close_chromium(self) -> None:
        if self._chromium is not None:
            try:
                self._chromium.close()
            except Exception:  # noqa: BLE001
                pass
            self._chromium = None

    def _with_chromium(self, url: str) -> PageView:
        self._pages_without_chromium = 0
        self.last_source = "chromium"
        page = self._browser().open(url)
        self._drawn = True
        return page

    # -- Browser protocol ---------------------------------------------------------

    def open(self, url: str) -> PageView:
        page = self._open(url)
        self._push(page)
        return page

    def _open(self, url: str) -> PageView:
        self._drawn = False
        self.last_source = "text"
        try:
            final, status, ctype, body = self._fetch(url)
        except httpx.InvalidURL:  # a malformed address such as "host:host" (not a ValueError; crashed Lead Gen 2026-10-27)
            return self._plain(error_page(url, "that is not a valid web address; copy it exactly from the page's link list"))
        except ValueError as exc:
            return self._plain(error_page(url, str(exc)))
        except httpx.TimeoutException:
            return self._plain(error_page(url, "the site did not answer in time"))
        except httpx.ConnectError as exc:
            detail = str(exc).lower()
            if "ssl" in detail or "certificate" in detail or "tls" in detail:
                return self._with_chromium(url)
            return self._plain(error_page(url, "could not reach the site (no such host or connection refused)"))
        except httpx.HTTPError:
            return self._with_chromium(url)  # protocol quirks a real browser copes with
        if status in _RATE_LIMIT_STATUSES:
            return self._plain(error_page(final, rate_limit_error(status)))
        if status in _REFUSED_STATUSES:
            return self._with_chromium(final)
        if status >= 400:
            return self._plain(error_page(final, f"the page does not exist (HTTP {status})"))
        page = self._to_page(final, ctype, body)
        if ctype not in _PLAIN_TYPES and needs_javascript(page, body):
            return self._with_chromium(final)
        if looks_like_bot_check(page):
            return self._plain(error_page(final, "the site asked for a human check (bot verification page)"))
        if looks_like_missing_page(page):
            return self._plain(error_page(final, "that page does not exist; the site has no article under that name"))
        return self._plain(page)

    def _plain(self, page: PageView) -> PageView:
        """A page answered without Chromium; after enough of those, Chromium gives its memory back."""
        self._pages_without_chromium += 1
        if self._pages_without_chromium >= CHROMIUM_IDLE_PAGES:
            self._close_chromium()
        return page

    def search(self, query: str) -> PageView:
        """Only the `browser` search engine calls this: a results page drawn by Chromium."""
        page = self._browser().search(query)
        self._pages_without_chromium, self._drawn, self.last_source = 0, True, "chromium"
        self._push(page)
        return page

    def screenshot(self, path) -> bool:  # type: ignore[no-untyped-def]
        """A picture only of a page Chromium drew; a text page has nothing to show."""
        if not self._drawn or self._chromium is None:
            return False
        shot = getattr(self._chromium, "screenshot", None)
        return bool(shot(path)) if callable(shot) else False

    def back(self) -> PageView | None:
        if not self._history:
            return None
        self._current = self._history.pop()
        self._drawn = False  # the stored page is text; Chromium may be showing something else
        return self._current

    def current(self) -> PageView | None:
        return self._current

    def fetch_text(self, url: str) -> str | None:
        """Fetch robots.txt for the policy. None when unreachable, empty string on 4xx. A site that
        refuses plain clients is asked again through Chromium, so its robots.txt is still honoured."""
        try:
            _, status, _, body = self._fetch(url, check_redirects=False)
        except (ValueError, httpx.InvalidURL, httpx.TimeoutException):
            return None
        except httpx.ConnectError as exc:
            detail = str(exc).lower()
            if "ssl" in detail or "certificate" in detail or "tls" in detail:
                return self._browser().fetch_text(url)
            return None
        except httpx.HTTPError:
            return self._browser().fetch_text(url)
        if status in _REFUSED_STATUSES:
            return self._browser().fetch_text(url)
        return "" if status >= 400 else body

    def reset(self) -> None:
        self.close()
        self._history.clear()
        self._current = None

    def close(self) -> None:
        self._close_chromium()
        self._drawn = False
        self._pages_without_chromium = 0
        if self._client is not None:
            try:
                self._client.close()
            except Exception:  # noqa: BLE001
                pass
            self._client = None

    def _push(self, page: PageView) -> None:
        if self._current is not None:
            self._history.append(self._current)
            del self._history[:-50]
        self._current = page
