"""Text-only browsing over Tor: `browser.backend = "tor"`.

No browser engine at all. Each page is one HTTP GET through Tor's SOCKS proxy (socks5h, so .onion names
and every other DNS lookup resolve inside Tor), and the HTML is turned into text and links by the same
parser the fake browser uses. Nothing a page refers to is ever requested: no images, scripts, styles,
fonts or media, so nothing but the page's own text can reach this Mac. Responses that are not HTML or
plain text are refused, bodies are capped, cookies are dropped after every request, and no screenshot
exists.

Search is local. Onion search engines forbid automated searching (Ahmia disallows /search/ in robots.txt
and puts a per-page token in its form), so `search` looks through a curated directory of legitimate
onion sites plus the pages this browser has already read. `bot onion-directory` builds that directory
from Real-World Onion Sites (github.com/alecmuffett/real-world-onion-sites, CC BY-SA), and writes the
bot's allowlist from the same entries.
"""
from __future__ import annotations

import datetime as dt
import json
import re
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Callable
from urllib.parse import quote_plus, urljoin, urlparse

import httpx

from .browser import (
    _RATE_LIMIT_STATUSES,
    PageView,
    TextExtractor,
    build_links,
    clean_text,
    error_page,
    looks_like_bot_check,
    looks_like_missing_page,
    rate_limit_error,
    registered_domain,
)

TEXT_TYPES = ("text/html", "application/xhtml+xml", "text/plain")
SEARCH_BASE = "http://onion-directory.invalid/search"  # .invalid never resolves; the page is built locally
RWOS_URL = "https://raw.githubusercontent.com/alecmuffett/real-world-onion-sites/master/README.md"
RWOS_CREDIT = "Real-World Onion Sites by Alec Muffett (github.com/alecmuffett/real-world-onion-sites), CC BY-SA"
ALLOWLIST_MARKER = "# --- your additions below this line are kept when the directory is re-imported ---"
_ONION_HOST = re.compile(r"(?:^|\.)[a-z2-7]{56}\.onion$")
_MAX_SEEN = 300


def tor_user_agent(agent_name: str) -> str:
    """The user agent for Tor traffic. Unlike Config.user_agent it never carries agent.contact: over Tor
    the contact (the owner's website or email) would tell every site who runs the bot."""
    name = re.sub(r"[^A-Za-z0-9]+", "", agent_name) or "Text"
    return f"Mozilla/5.0 (compatible; {name}Reader/0.1; text-only research agent)"


def is_onion_host(host: str) -> bool:
    return bool(_ONION_HOST.search((host or "").lower().split(":")[0]))


# ----------------------------------------------------------------------------
# The onion directory

@dataclass
class DirectoryEntry:
    name: str
    url: str
    section: str
    proof: str = ""

    @property
    def host(self) -> str:
        return (urlparse(self.url).hostname or "").lower()


# Sections of the list the bot never uses: SecureDrop instances are whistleblower drop boxes, not reading
# material, and "Flaky Sites" are the ones the list's own checker cannot reach.
_SKIP_SECTIONS = {"securedrop", "flaky sites", "legend/key for symbols", "regarding updates and suggestions"}
_SECTION = re.compile(r"^## (.+?)\s*$")
_ENTRY = re.compile(r"^### \[(.+?)\]\((https?://[^)\s]+)\)")
_PROOF = re.compile(r"^\* proof: \[link\]\((https?://[^)\s]+)\)")


def parse_rwos(markdown: str) -> list[DirectoryEntry]:
    """Entries from the Real-World Onion Sites README, skipping unusable sections and non-onion links."""
    entries: list[DirectoryEntry] = []
    section = ""
    seen: set[str] = set()
    for raw in markdown.splitlines():
        line = raw.strip()
        if m := _SECTION.match(line):
            section = m.group(1)
            continue
        if section.lower() in _SKIP_SECTIONS:
            continue
        if m := _ENTRY.match(line):
            entry = DirectoryEntry(name=m.group(1).strip(), url=m.group(2).strip(), section=section)
            if is_onion_host(entry.host) and entry.url not in seen:
                seen.add(entry.url)
                entries.append(entry)
            continue
        if (m := _PROOF.match(line)) and entries and not entries[-1].proof:
            entries[-1].proof = m.group(1)
    return entries


class OnionDirectory:
    def __init__(self, entries: list[DirectoryEntry] | None = None, source: str = "", fetched_at: str = ""):
        self.entries = list(entries or [])
        self.source = source
        self.fetched_at = fetched_at

    def __len__(self) -> int:
        return len(self.entries)

    @classmethod
    def load(cls, path: Path) -> "OnionDirectory":
        if not path.exists():
            return cls()
        data = json.loads(path.read_text(encoding="utf-8"))
        entries = [DirectoryEntry(**e) for e in data.get("entries", [])]
        return cls(entries, str(data.get("source", "")), str(data.get("fetched_at", "")))

    def save(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        data = {
            "source": self.source,
            "credit": RWOS_CREDIT,
            "fetched_at": self.fetched_at,
            "entries": [asdict(e) for e in self.entries],
        }
        path.write_text(json.dumps(data, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")

    def hosts(self) -> list[str]:
        """One allowlist line per site: the onion name itself, so its subdomains (www.) are covered."""
        return sorted({registered_domain(e.host) for e in self.entries if e.host})

    def sections(self) -> list[str]:
        return sorted({e.section for e in self.entries})


def write_allowlist(path: Path, hosts: list[str]) -> int:
    """Rewrite the generated part of the allowlist and keep whatever the owner added below the marker."""
    kept: list[str] = []
    if path.exists():
        lines = path.read_text(encoding="utf-8").splitlines()
        if ALLOWLIST_MARKER in lines:
            kept = lines[lines.index(ALLOWLIST_MARKER) + 1 :]
    head = [
        "# Sites this bot may read, one host per line. Subdomains of a listed host are allowed too.",
        f"# Generated by `bot onion-directory` from {RWOS_CREDIT}.",
        "",
        *hosts,
        "",
        ALLOWLIST_MARKER,
    ]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(head + kept).rstrip("\n") + "\n", encoding="utf-8")
    return len(hosts)


# ----------------------------------------------------------------------------
# The browser

class TorTextBrowser:
    def __init__(
        self,
        proxy: str,
        user_agent: str,
        directory: OnionDirectory,
        max_links: int = 40,
        timeout_seconds: float = 60.0,
        max_bytes: int = 2_000_000,
        allow_url: Callable[[str], str | None] | None = None,
        transport: httpx.BaseTransport | None = None,
        max_redirects: int = 5,
    ):
        self.proxy = proxy
        self.user_agent = user_agent
        self.directory = directory
        self.max_links = max_links
        self.timeout_seconds = timeout_seconds
        self.max_bytes = max_bytes
        # Checked on every redirect hop, so a listed site cannot bounce the bot somewhere it may not go.
        self.allow_url = allow_url
        self.transport = transport  # tests inject a MockTransport; real use goes through the proxy
        self.max_redirects = max_redirects
        self._client: httpx.Client | None = None
        self._history: list[PageView] = []
        self._current: PageView | None = None
        self._seen: dict[str, tuple[str, str]] = {}  # url -> (title, text head), for local search

    # -- HTTP -------------------------------------------------------------------

    def _http(self) -> httpx.Client:
        if self._client is None:
            options: dict = {
                "timeout": httpx.Timeout(self.timeout_seconds),
                "headers": {"User-Agent": self.user_agent, "Accept": "text/html, text/plain;q=0.8"},
                "follow_redirects": False,
                # Never read proxy settings from the environment: a NO_PROXY entry would send a request
                # around Tor.
                "trust_env": False,
            }
            if self.transport is not None:
                options["transport"] = self.transport
            else:
                options["proxy"] = self.proxy
            self._client = httpx.Client(**options)
        return self._client

    def _fetch(self, url: str, check_redirects: bool = True) -> tuple[str, int, str, str]:
        """GET a text resource, following redirects by hand. Returns (final_url, status, content_type, body).
        Raises ValueError with a readable reason when the page is refused."""
        client = self._http()
        for hop in range(self.max_redirects + 1):
            scheme = urlparse(url).scheme.lower()
            if scheme not in ("http", "https"):
                raise ValueError(f"redirected to a '{scheme}' address; only http and https exist here")
            if hop > 0 and check_redirects and self.allow_url is not None:
                reason = self.allow_url(url)
                if reason:
                    raise ValueError(f"the site redirected to a page this bot may not read ({reason})")
            try:
                with client.stream("GET", url) as response:
                    if response.is_redirect and response.headers.get("location"):
                        url = urljoin(url, response.headers["location"])
                        continue
                    status = response.status_code
                    ctype = response.headers.get("content-type", "").split(";")[0].strip().lower()
                    if status >= 400:
                        return str(response.url), status, ctype, ""
                    if ctype not in TEXT_TYPES:
                        raise ValueError(f"not a text page ({ctype or 'unknown type'}); this bot only reads text")
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
            finally:
                client.cookies.clear()  # no site gets to recognize the bot on its next visit
        raise ValueError(f"too many redirects (more than {self.max_redirects})")

    # -- Browser protocol ---------------------------------------------------------

    def open(self, url: str) -> PageView:
        try:
            final, status, ctype, body = self._fetch(url)
            if status in _RATE_LIMIT_STATUSES:
                page = error_page(final, rate_limit_error(status))
            elif status >= 400:
                page = error_page(final, f"the page does not exist (HTTP {status})")
            else:
                page = self._to_page(final, ctype, body)
                if looks_like_bot_check(page):
                    page = error_page(final, "the site asked for a human check (bot verification page)")
                elif looks_like_missing_page(page):
                    page = error_page(final, "that page does not exist; the site has no article under that name")
        except ValueError as exc:
            page = error_page(url, str(exc))
        except httpx.TimeoutException:
            page = error_page(url, "the site did not answer in time; onion sites are often slow or offline")
        except httpx.ProxyError as exc:
            page = error_page(url, f"Tor could not reach the site ({str(exc)[:120] or 'offline or unknown address'})")
        except httpx.HTTPError as exc:
            page = error_page(url, f"could not reach the site ({type(exc).__name__}); is Tor running?")
        if page.ok:
            self._remember(page)
        self._push(page)
        return page

    def _to_page(self, url: str, ctype: str, body: str) -> PageView:
        if ctype == "text/plain":
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

    def search(self, query: str) -> PageView:
        words = [w for w in re.findall(r"[a-z0-9]+", query.lower()) if len(w) > 1]

        def score(*fields: str) -> int:
            hay = " ".join(fields).lower()
            return sum(hay.count(w) for w in words)

        listed = sorted(
            ((score(e.name, e.section), e) for e in self.directory.entries),
            key=lambda pair: -pair[0],
        )
        dir_hits = [e for s, e in listed if s > 0][:20]
        read_hits = sorted(
            ((score(title, text), url, title) for url, (title, text) in self._seen.items()),
            key=lambda triple: -triple[0],
        )
        page_hits = [(url, title) for s, url, title in read_hits if s > 0][:10]

        lines = [f"Results for: {query}", ""]
        pairs: list[tuple[str, str]] = []
        if dir_hits:
            lines.append("From the onion directory:")
            for e in dir_hits:
                lines.append(f"- {e.name} ({e.section})")
                pairs.append((f"{e.name} ({e.section})", e.url))
        if page_hits:
            lines += ["", "From pages you have already read:"]
            for url, title in page_hits:
                lines.append(f"- {title or url}")
                pairs.append((title or url, url))
        if not pairs:
            lines.append("No results. This search only knows the onion directory and pages you have read.")
            lines.append("Sections you can browse: " + ", ".join(self.directory.sections()))
            for e in self.directory.entries[: self.max_links]:
                pairs.append((f"{e.name} ({e.section})", e.url))
        lines += ["", f"Directory: {RWOS_CREDIT}."]
        page = PageView(
            url=f"{SEARCH_BASE}?q={quote_plus(query)}",
            title=f"Onion directory search: {query}",
            text="\n".join(lines),
            links=build_links(pairs, self.max_links, {"http", "https"}),
        )
        self._push(page)
        return page

    def back(self) -> PageView | None:
        if not self._history:
            return None
        self._current = self._history.pop()
        return self._current

    def current(self) -> PageView | None:
        return self._current

    def fetch_text(self, url: str) -> str | None:
        """Fetch robots.txt for the policy. None when unreachable, empty string on 4xx."""
        try:
            _, status, _, body = self._fetch(url, check_redirects=False)
        except (ValueError, httpx.HTTPError):
            return None
        return "" if status >= 400 else body

    def available(self) -> tuple[bool, str]:
        """Is traffic really going through Tor? Asks the Tor Project's own checker."""
        try:
            response = self._http().get("https://check.torproject.org/api/ip")
            is_tor = bool(response.json().get("IsTor"))
        except Exception as exc:  # noqa: BLE001 - reported to the owner, never raised
            return False, f"tor proxy {self.proxy}: not usable ({type(exc).__name__}); is the Tor service running?"
        finally:
            if self._client is not None:
                self._client.cookies.clear()
        if not is_tor:
            return False, f"tor proxy {self.proxy}: answers, but traffic is NOT going through Tor"
        return True, f"tor proxy {self.proxy}: traffic goes through Tor"

    def reset(self) -> None:
        self.close()
        self._history.clear()
        self._current = None

    def close(self) -> None:
        if self._client is not None:
            try:
                self._client.close()
            except Exception:  # noqa: BLE001
                pass
            self._client = None

    # -- helpers ----------------------------------------------------------------

    def _push(self, page: PageView) -> None:
        if self._current is not None:
            self._history.append(self._current)
            del self._history[:-50]
        self._current = page

    def _remember(self, page: PageView) -> None:
        self._seen[page.url] = (page.title, page.text[:4000])
        while len(self._seen) > _MAX_SEEN:
            self._seen.pop(next(iter(self._seen)))


def fetch_directory(proxy: str, user_agent: str, source: str = RWOS_URL, timeout_seconds: float = 90.0) -> OnionDirectory:
    """Download and parse the Real-World Onion Sites list through Tor."""
    with httpx.Client(
        proxy=proxy, timeout=httpx.Timeout(timeout_seconds), headers={"User-Agent": user_agent},
        follow_redirects=True, trust_env=False,
    ) as client:
        response = client.get(source)
        response.raise_for_status()
    entries = parse_rwos(response.text)
    return OnionDirectory(entries, source, dt.datetime.now().replace(microsecond=0).isoformat())
