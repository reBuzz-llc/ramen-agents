"""Browsers: a fake one over local HTML files, and a Playwright one over the real web.

Both return the same PageView shape, so the agent loop cannot tell them apart.
"""
from __future__ import annotations

import ipaddress
import time
from dataclasses import dataclass, field
from html.parser import HTMLParser
from pathlib import Path
from typing import Callable, Protocol
from urllib.parse import parse_qs, quote_plus, unquote, urljoin, urlparse


_BOT_CHECK_MARKERS = (
    "verifying you're not a bot",
    "verify you are human",
    "verify you're human",
    "are you a robot",
    "switch to traditional captcha",
    "unusual traffic from your",
    "checking your browser before",
    "complete the captcha",
)


def looks_like_bot_check(page: "PageView") -> bool:
    """A short page whose text is a bot-verification challenge. We never try to pass those; the agent
    treats the page as unreachable and, for searches, pauses searching for a while."""
    if not page.ok or len(page.text) > 3000:
        return False
    head = f"{page.title} {page.text[:1500]}".lower()
    return any(marker in head for marker in _BOT_CHECK_MARKERS)


# A site can tell us to back off with a status code instead of a challenge page. 429 is the explicit
# "too many requests"; 503 is what anti-bot front ends often answer with. Both mean wait, not "gone",
# so they must not be reported as a missing page: the model reads "does not exist" and immediately
# tries a slightly different query, which is how it burned three searches in 90 seconds.
_RATE_LIMIT_STATUSES = (429, 503)
_RATE_LIMIT_MARKER = "rate-limiting requests"


def rate_limit_error(status: int) -> str:
    return f"the site is {_RATE_LIMIT_MARKER} (HTTP {status})"


def backoff_reason(page: "PageView") -> str | None:
    """Why searching should pause for a while: 'rate limit', 'bot check', or None.

    One predicate shared by the browser and the controller, so the two cannot drift apart over the
    exact wording of an error string.
    """
    error = page.error or ""
    if _RATE_LIMIT_MARKER in error:
        return "rate limit"
    if "human check" in error:
        return "bot check"
    return None


_MISSING_PAGE_MARKERS = (
    "wikipedia does not have an article with this exact name",
    "does not have an article with this exact name",
    "the page you are looking for doesn't exist",
    "this page does not exist",
    "404 not found",
    "page not found",
    "we couldn't find that page",
    "the requested url was not found",
    "no article with this title",
)


def looks_like_missing_page(page: "PageView") -> bool:
    """A page that loaded but says the article is not there.

    Wikipedia answers a guessed title with a 'no article with this exact name' page: real HTML, a real
    title, and nothing to learn. The model reads the empty page and writes a note out of thin air, so
    the page has to count as unreachable rather than as content."""
    if not page.ok:
        return False
    head = f"{page.title} {page.text[:1500]}".lower()
    return any(marker in head for marker in _MISSING_PAGE_MARKERS)


def is_private_host(host: str) -> bool:
    """True for localhost, .local names, and literal private or loopback addresses. Names that need DNS
    are not resolved here; the policy layer keeps the agent from navigating to them, and this check keeps
    page scripts from reaching services on this machine by address."""
    host = (host or "").strip("[]").lower()
    if not host:
        return False
    if host == "localhost" or host.endswith((".localhost", ".local", ".internal")):
        return True
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return False
    return ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_unspecified


@dataclass
class Link:
    number: int
    text: str
    url: str


@dataclass
class PageView:
    url: str
    title: str
    text: str
    links: list[Link] = field(default_factory=list)
    fetched_at: float = field(default_factory=time.time)
    ok: bool = True
    error: str | None = None

    @property
    def domain(self) -> str:
        return urlparse(self.url).netloc.lower()


def error_page(url: str, error: str) -> PageView:
    return PageView(url=url, title="", text="", ok=False, error=error)


class Browser(Protocol):
    def open(self, url: str) -> PageView: ...
    def search(self, query: str) -> PageView: ...
    def back(self) -> PageView | None: ...
    def current(self) -> PageView | None: ...
    def reset(self) -> None: ...
    def close(self) -> None: ...


# ----------------------------------------------------------------------------
# Shared helpers

_BLOCK_TAGS = {
    "p", "div", "br", "li", "h1", "h2", "h3", "h4", "h5", "h6", "tr", "section", "article",
    "header", "footer", "nav", "ul", "ol", "table", "blockquote", "pre", "dd", "dt", "hr",
}
_SKIP_TAGS = {"script", "style", "noscript", "template", "svg"}


class TextExtractor(HTMLParser):
    """Turn HTML into readable text plus (text, href) link pairs. Stdlib only."""

    def __init__(self, resolve: Callable[[str], str]):
        super().__init__(convert_charrefs=True)
        self._resolve = resolve
        self.title = ""
        self._in_title = False
        self._skip = 0
        self._parts: list[str] = []
        self.links: list[tuple[str, str]] = []
        self._link_text: list[str] | None = None
        self._link_href: str | None = None
        # Addresses behind mailto: links. Businesses publish their email that way more often than as visible text,
        # so a lead's grounding ("the email appears on a page you opened") needs them in the page text.
        self.emails: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in _SKIP_TAGS:
            self._skip += 1
            return
        if tag == "title":
            self._in_title = True
        if tag in _BLOCK_TAGS:
            self._parts.append("\n")
        if tag == "a":
            href = dict(attrs).get("href")
            if href and href.lower().startswith("mailto:"):
                addr = href[7:].split("?", 1)[0].strip()
                if "@" in addr and addr not in self.emails:
                    self.emails.append(addr)
            if href and not href.startswith(("#", "javascript:", "mailto:")):
                self._link_href = self._resolve(href)
                self._link_text = []

    def handle_endtag(self, tag: str) -> None:
        if tag in _SKIP_TAGS:
            self._skip = max(0, self._skip - 1)
            return
        if tag == "title":
            self._in_title = False
        if tag in _BLOCK_TAGS:
            self._parts.append("\n")
        if tag == "a" and self._link_href is not None:
            text = " ".join("".join(self._link_text or []).split())
            self.links.append((text, self._link_href))
            self._link_href = None
            self._link_text = None

    def handle_data(self, data: str) -> None:
        if self._skip:
            return
        if self._in_title:
            self.title += data
            return
        self._parts.append(data)
        if self._link_text is not None:
            self._link_text.append(data)

    def text(self) -> str:
        body = clean_text("".join(self._parts))
        if self.emails:  # so "info@..." behind a mailto: link counts as published on the page
            body += "\n\nEmail addresses linked on this page: " + ", ".join(self.emails[:10])
        return body


def clean_text(raw: str) -> str:
    lines = [" ".join(line.split()) for line in raw.splitlines()]
    out: list[str] = []
    for line in lines:
        if line:
            out.append(line)
        elif out and out[-1] != "":
            out.append("")
    return "\n".join(out).strip()


def unwrap_redirect(url: str) -> str:
    """DuckDuckGo's HTML endpoint wraps results in a redirect; return the real target."""
    parsed = urlparse(url)
    if parsed.netloc.endswith("duckduckgo.com") and parsed.path.startswith("/l/"):
        target = parse_qs(parsed.query).get("uddg")
        if target:
            return unquote(target[0])
    return url


def registered_domain(host: str) -> str:
    """Last two labels of a host: search.brave.com -> brave.com."""
    labels = host.lower().split(":")[0].split(".")
    return ".".join(labels[-2:]) if len(labels) >= 2 else host.lower()


def renumber(links: list[Link]) -> list[Link]:
    return [Link(number=i + 1, text=link.text, url=link.url) for i, link in enumerate(links)]


def build_links(pairs: list[tuple[str, str]], max_links: int, schemes: set[str]) -> list[Link]:
    seen: set[str] = set()
    links: list[Link] = []
    for text, href in pairs:
        href = unwrap_redirect(href.strip())
        if urlparse(href).scheme not in schemes or href in seen:
            continue
        seen.add(href)
        links.append(Link(number=len(links) + 1, text=text[:120] or "(no text)", url=href))
        if len(links) >= max_links:
            break
    return links


# ----------------------------------------------------------------------------
# Fake browser: local HTML files addressed as fake://name.html

class FakeBrowser:
    SCHEME = "fake"

    def __init__(self, base_dir: Path | str, max_links: int = 40):
        self.base_dir = Path(base_dir).resolve()
        self.max_links = max_links
        self._history: list[PageView] = []
        self._current: PageView | None = None

    @staticmethod
    def _resolve(href: str) -> str:
        if "://" in href:
            return href
        return "fake://" + href.lstrip("./")

    @staticmethod
    def _name(url: str) -> str:
        parsed = urlparse(url)
        return (parsed.netloc + parsed.path).strip("/") or "index.html"

    def _load(self, url: str) -> PageView:
        parsed = urlparse(url)
        if parsed.scheme != self.SCHEME:
            return error_page(url, "the fake browser only opens fake:// pages")
        target = (self.base_dir / self._name(url)).resolve()
        if not str(target).startswith(str(self.base_dir)) or not target.is_file():
            return error_page(url, "page not found")
        parser = TextExtractor(self._resolve)
        parser.feed(target.read_text(encoding="utf-8"))
        return PageView(
            url=url,
            title=parser.title.strip(),
            text=parser.text(),
            links=build_links(parser.links, self.max_links, {self.SCHEME}),
        )

    def open(self, url: str) -> PageView:
        page = self._load(url)
        if self._current is not None:
            self._history.append(self._current)
        self._current = page
        return page

    def search(self, query: str) -> PageView:
        words = [w for w in query.lower().split() if w]
        hits: list[tuple[str, str]] = []
        for file in sorted(self.base_dir.glob("*.html")):
            body = file.read_text(encoding="utf-8")
            lowered = body.lower()
            if words and any(w in lowered for w in words):
                parser = TextExtractor(self._resolve)
                parser.feed(body)
                hits.append((parser.title.strip() or file.name, f"fake://{file.name}"))
        text = f"Results for: {query}\n" + ("\n".join(f"- {t}" for t, _ in hits) if hits else "No results.")
        page = PageView(
            url=f"fake://search?q={quote_plus(query)}",
            title=f"Search: {query}",
            text=text,
            links=build_links(hits, self.max_links, {self.SCHEME}),
        )
        if self._current is not None:
            self._history.append(self._current)
        self._current = page
        return page

    def back(self) -> PageView | None:
        if not self._history:
            return None
        self._current = self._history.pop()
        return self._current

    def current(self) -> PageView | None:
        return self._current

    def reset(self) -> None:
        self._history.clear()
        self._current = None

    def screenshot(self, path: Path | str) -> bool:
        """The fake browser has nothing to draw; the dashboard shows 'no picture' in fake mode."""
        return False

    def close(self) -> None:
        return None


# ----------------------------------------------------------------------------
# Playwright browser: real Chromium with its own empty profile

_EXTRACT_JS = r"""
() => {
    const links = [];
    for (const a of document.querySelectorAll('a[href]')) {
        const t = (a.innerText || a.getAttribute('aria-label') || a.getAttribute('title') || '')
            .trim().replace(/\s+/g, ' ');
        links.push([t.slice(0, 120), a.href]);
        if (links.length > 400) break;
    }
    const body = document.body ? document.body.innerText : '';
    return {title: document.title || '', text: body.slice(0, 200000), links};
}
"""


class PlaywrightBrowser:
    def __init__(
        self,
        user_data_dir: Path | str,
        user_agent: str,
        headless: bool = True,
        max_links: int = 40,
        search_url: str = "https://search.brave.com/search?q={query}&source=web",
        navigation_timeout_seconds: float = 30.0,
    ):
        self.user_data_dir = Path(user_data_dir)
        self.user_agent = user_agent
        self.headless = headless
        self.max_links = max_links
        self.search_url = search_url
        self.navigation_timeout_ms = int(navigation_timeout_seconds * 1000)
        self._pw = None
        self._context = None
        self._page = None
        self._current: PageView | None = None

    def _ensure(self) -> None:
        if self._page is not None:
            return
        from playwright.sync_api import sync_playwright

        self.user_data_dir.mkdir(parents=True, exist_ok=True)
        self._pw = sync_playwright().start()
        self._context = self._pw.chromium.launch_persistent_context(
            str(self.user_data_dir),
            headless=self.headless,
            user_agent=self.user_agent,
            viewport={"width": 1280, "height": 900},
            accept_downloads=False,
        )
        self._context.set_default_navigation_timeout(self.navigation_timeout_ms)
        self._context.set_default_timeout(15_000)
        self._context.route("**/*", self._route)
        self._page = self._context.pages[0] if self._context.pages else self._context.new_page()

    @staticmethod
    def _route(route) -> None:  # type: ignore[no-untyped-def]
        request = route.request
        # Page scripts must not reach this machine (the dashboard, Ollama, anything on the LAN).
        if is_private_host(urlparse(request.url).hostname or ""):
            route.abort()
        elif request.resource_type in ("image", "media", "font"):
            route.abort()
        else:
            route.continue_()

    def screenshot(self, path: Path | str) -> bool:
        """Save a picture of the current page for the dashboard. False when there is no page or it fails."""
        if self._page is None:
            return False
        try:
            self._page.wait_for_timeout(600)  # let script-rendered pages (search results) paint first
            self._page.screenshot(path=str(path), full_page=False, timeout=5_000)
            return True
        except Exception:  # noqa: BLE001 - a missing picture is never worth failing a cycle
            return False

    def _extract(self) -> PageView:
        assert self._page is not None
        data = self._page.evaluate(_EXTRACT_JS)
        pairs = [(str(t), str(h)) for t, h in data.get("links", [])]
        return PageView(
            url=self._page.url,
            title=str(data.get("title", "")).strip(),
            text=clean_text(str(data.get("text", ""))),
            links=build_links(pairs, self.max_links, {"http", "https"}),
        )

    def open(self, url: str) -> PageView:
        self._ensure()
        assert self._page is not None
        try:
            response = self._page.goto(url, wait_until="domcontentloaded")
            self._page.wait_for_timeout(800)
            status = response.status if response is not None else 0
            page = self._extract()
            if status in _RATE_LIMIT_STATUSES:
                page = error_page(page.url, rate_limit_error(status))
            elif status >= 400:
                page = error_page(page.url, f"the page does not exist (HTTP {status})")
            elif looks_like_bot_check(page):
                page = error_page(page.url, "the site asked for a human check (bot verification page)")
            elif looks_like_missing_page(page):
                page = error_page(page.url, "that page does not exist; the site has no article under that name")
        except Exception as exc:  # noqa: BLE001 - any browser failure becomes an error page
            page = error_page(url, f"{type(exc).__name__}: {str(exc).splitlines()[0][:200]}")
        self._current = page
        return page

    def search(self, query: str) -> PageView:
        page = self.open(self.search_url.format(query=quote_plus(query)))
        if page.ok:
            engine = registered_domain(urlparse(self.search_url).netloc)
            page.links = renumber(
                [link for link in page.links if registered_domain(urlparse(link.url).netloc) != engine]
            )
            self._current = page
        return page

    def back(self) -> PageView | None:
        self._ensure()
        assert self._page is not None
        try:
            response = self._page.go_back(wait_until="domcontentloaded")
            if response is None and self._page.url in ("about:blank", ""):
                return None
            self._page.wait_for_timeout(800)  # same settle as open(): script-rendered pages need it
            page = self._extract()
        except Exception:  # noqa: BLE001
            return None
        self._current = page
        return page

    def current(self) -> PageView | None:
        return self._current

    def fetch_text(self, url: str) -> str | None:
        """Fetch a small text resource (robots.txt) through the browser, so sites that block
        plain HTTP clients still answer. None when unreachable, empty string on 4xx."""
        self._ensure()
        assert self._context is not None
        page = None
        try:
            page = self._context.new_page()
            response = page.goto(url, wait_until="domcontentloaded", timeout=15_000)
            if response is None:
                return None
            if response.status >= 400:
                return ""
            return str(page.evaluate("() => document.body ? document.body.innerText : ''"))
        except Exception:  # noqa: BLE001
            return None
        finally:
            if page is not None:
                try:
                    page.close()
                except Exception:  # noqa: BLE001
                    pass

    def reset(self) -> None:
        self.close()
        self._current = None

    def close(self) -> None:
        try:
            if self._context is not None:
                self._context.close()
        except Exception:  # noqa: BLE001
            pass
        try:
            if self._pw is not None:
                self._pw.stop()
        except Exception:  # noqa: BLE001
            pass
        self._context = None
        self._page = None
        self._pw = None
