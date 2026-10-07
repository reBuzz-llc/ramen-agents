"""Web search with fallbacks, and a search pause shared by every bot on this Mac.

The `browser` engine searches with the bot's own browser: in fake mode the offline pages, on the web
the search page in `browser.search_url` drawn by Chromium (Brave by default). Brave served bot checks
after a few dozen searches an evening, so the default web chain is keyless APIs that answer bots on
purpose, in this order:

- `marginalia` (Marginalia Search: small independent websites. The shared `public` key is often
  over its per-minute quota; a free personal key comes from emailing the operator. Results are
  CC-BY-NC-SA, so a bot doing commercial work should leave it out of its engine list.)
- `wikipedia` (the MediaWiki search API: no key, no blocking at this rate)
- `hn` (Hacker News through Algolia: startups, agencies, founders, tools)

`browser` is opt-in for a web bot (`brave-web`, its old name, is still accepted in configs and in
the pause file); the owner pays for no search plan, so there is no Brave API engine.

- Engines are tried in order. When one answers with a rate limit or a bot check it is paused and
  the next one is tried; when an API engine answers "(no results)", the next one is tried without a
  pause.
  A result is a synthetic results page: a short text listing plus numbered links, so `follow`
  works exactly as with a real page.
- The pause is a JSON file outside any bot folder, so when one bot gets Brave rate-limited every
  bot on the machine leaves Brave alone until the pause ends. The policy only refuses `search`
  when every engine is paused.

Nothing here reads config.py directly; the controller passes SearchSettings built from whatever
keys exist, with defaults, so this works before any [search] section is added.
"""
from __future__ import annotations

import re
import json
import logging
import os
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable
from urllib.parse import quote, quote_plus

from .common.keys import key_file, load_key
import httpx

from .browser import Browser, Link, PageView, backoff_reason, error_page, rate_limit_error

WIKIPEDIA_API = "https://en.wikipedia.org/w/api.php"
MARGINALIA_API = "https://api2.marginalia-search.com/search"
HN_API = "https://hn.algolia.com/api/v1/search"
TAVILY_API = "https://api.tavily.com/search"
TAVILY_USAGE_FILE = Path.home() / "bots" / "common-data" / "shared-state" / "tavily-usage.json"
LANGSEARCH_API = "https://api.langsearch.com/v1/web-search"
FREESERP_API = "https://freeserp.ai/api.php"
PARALLEL_API = "https://api.parallel.ai/v1beta/search"
PARALLEL_USAGE_FILE = Path.home() / "bots" / "common-data" / "shared-state" / "parallel-usage.json"  # keyless, no signup; asks for a few requests a second and caching
LANGSEARCH_USAGE_FILE = Path.home() / "bots" / "common-data" / "shared-state" / "langsearch-usage.json"
DEFAULT_PAUSE_FILE = Path.home() / ".config" / "explorer" / "search_pause.json"
DEFAULT_WEB_ENGINES = ("searxng", "duckduckgo-mcp")  # general web search only: SearXNG (Google and others), then DuckDuckGo
BROWSER_ENGINE = "browser"  # the bot's own browser: the fake pages, or search_url in Chromium
ENGINE_ALIASES = {"brave-web": BROWSER_ENGINE, "files": "corpus"}  # old names still accepted in configs and pause files


def canonical_engine(name: str) -> str:
    return ENGINE_ALIASES.get(name, name)


NO_RESULTS = "(no results)"  # the last line of an API engine's results page that found nothing


@dataclass
class SearchSettings:
    engines: list[str] = field(default_factory=lambda: list(DEFAULT_WEB_ENGINES))
    marginalia_api_key: str = "public"
    pause_file: Path = DEFAULT_PAUSE_FILE
    rate_limit_minutes: float = 5.0  # how long an engine rests after a 429/503
    bot_check_minutes: float = 30.0  # how long after a challenge page
    # The browser engine (Brave in Chromium on the web) runs at most once per this many seconds across every bot on the Mac
    # (it rests in the shared pause file); the keyless engines answer in between. Brave started
    # serving bot checks at ~40 searches an evening, which is what this stays under. 0 = no rest.
    web_min_interval_seconds: float = 0.0
    user_agent: str = "Mozilla/5.0 (compatible; explorer curiosity agent)"
    # The API engines get a plain bot user agent. Wikimedia's policy (https://w.wiki/4wJS) answers
    # 403 to browser-like strings and to bots without a contact, so include one when configured.
    api_user_agent: str = ""
    # The local SearXNG meta-search (Google, Brave, DuckDuckGo, Startpage, Mojeek, Wikipedia) for the
    # `searxng` engine: a launch agent on this Mac, never a public instance.
    searxng_url: str = "http://127.0.0.1:8888"
    # The `tavily` engine (owner's key, 2026-10-02): a search API with 1,000 free credits a month. Put it AFTER searxng in
    # a bot's search_engines so it answers only when the free engines are throttled; the fleet-wide daily budget below
    # keeps the month from being spent in a day. No key = the engine reports itself unavailable and the next one answers.
    tavily_api_key: str = ""
    tavily_per_day: int = 30
    tavily_usage_file: Path = TAVILY_USAGE_FILE
    # The `langsearch` engine (owner's key and word, 2026-10-05: "backup when search fails"): a keyed web search API with a
    # free plan, no card. Put it right AFTER searxng: it runs only when the local search fails or comes back empty, within
    # the fleet-wide daily budget. The second exception to keyless search; no bot may name it itself.
    langsearch_api_key: str = ""
    langsearch_per_day: int = 100
    langsearch_usage_file: Path = LANGSEARCH_USAGE_FILE
    # The `parallel` engine (owner's key and word, 2026-10-05: "add as a second backup"): Parallel's search API, $5 of free
    # credit a month, no card. Listed after langsearch, so it runs only when every engine before it came back empty.
    parallel_api_key: str = ""
    parallel_per_day: int = 30
    parallel_usage_file: Path = PARALLEL_USAGE_FILE
    # The `duckduckgo-mcp` engine (owner, 2026-10-05: "add DuckDuckGo MCP for search"): the keyless DuckDuckGo MCP server,
    # run on this Mac over stdio for each search. Only its `search` tool is ever called.
    places_db: Path = Path.home() / "bots" / "common-data" / "places" / "nyc-places.sqlite"
    ddg_mcp_command: str = str(Path.home() / ".local" / "opt" / "ddg-mcp" / "venv" / "bin" / "duckduckgo-mcp-server")

    def __post_init__(self) -> None:
        self.engines = list(dict.fromkeys(canonical_engine(e) for e in self.engines))

    def usable_engines(self) -> list[str]:
        """The configured order. Every engine runs without a paid key."""
        return list(self.engines)


class SearchPause:
    """Per-engine 'do not use until' times, kept in a file every bot on this Mac reads and writes."""

    def __init__(self, path: Path, clock: Callable[[], float] = time.time):
        self.path = Path(path)
        self.clock = clock

    def _load(self) -> dict[str, float]:
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {}
        if not isinstance(data, dict):
            return {}
        out: dict[str, float] = {}
        for k, v in data.items():
            if isinstance(v, (int, float)):
                name = canonical_engine(str(k))  # a pause saved under an engine's old name still holds
                out[name] = max(out.get(name, 0.0), float(v))
        return out

    def _save(self, data: dict[str, float]) -> None:
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            # Per-process temp name: two bots pausing at once must not interleave into one file.
            tmp = self.path.with_name(f"{self.path.name}.{os.getpid()}.tmp")
            tmp.write_text(json.dumps(data), encoding="utf-8")
            os.replace(tmp, self.path)
        except OSError:
            pass  # a pause that fails to persist is still honoured in this process via the next read

    def _locked(self):
        """An advisory lock around read-modify-write, so one bot's pause cannot drop another's."""
        import contextlib
        import fcntl

        @contextlib.contextmanager
        def hold():
            lock_path = self.path.with_name(f"{self.path.name}.lock")
            try:
                self.path.parent.mkdir(parents=True, exist_ok=True)
                fh = open(lock_path, "a", encoding="utf-8")  # noqa: SIM115 - closed below
            except OSError:
                yield
                return
            try:
                fcntl.flock(fh, fcntl.LOCK_EX)
                yield
            finally:
                try:
                    fcntl.flock(fh, fcntl.LOCK_UN)
                finally:
                    fh.close()

        return hold()

    def paused_until(self, engine: str) -> float:
        return self._load().get(canonical_engine(engine), 0.0)

    def pause(self, engine: str, seconds: float) -> float:
        with self._locked():
            data = self._load()
            engine = canonical_engine(engine)
            until = max(data.get(engine, 0.0), self.clock() + seconds)
            data[engine] = until
            self._save({k: v for k, v in data.items() if v > self.clock()})
        return until

    def available(self, engines: list[str]) -> list[str]:
        now = self.clock()
        data = self._load()
        return [e for e in engines if data.get(canonical_engine(e), 0.0) <= now]

    def seconds_until_any(self, engines: list[str]) -> float:
        """0 when some engine can be used now; otherwise how long until the first one frees up."""
        if not engines:
            return 0.0
        now = self.clock()
        data = self._load()
        waits = [max(0.0, data.get(e, 0.0) - now) for e in engines]
        return min(waits)


@dataclass
class SearchOutcome:
    page: PageView
    engine: str  # the engine that produced the page, or "" when none could
    paused: list[tuple[str, str, float]] = field(default_factory=list)  # (engine, reason, minutes) paused this call
    empty: list[str] = field(default_factory=list)  # engines that answered this call with no results

    @property
    def fell_back(self) -> bool:
        return bool(self.paused) and bool(self.engine)


class Searcher:
    def __init__(
        self,
        browser: Browser,
        settings: SearchSettings,
        pause: SearchPause,
        logger: logging.Logger | None = None,
        client: httpx.Client | None = None,
        extra_engines: dict[str, Callable[[str], PageView]] | None = None,
    ):
        self.browser = browser
        self.settings = settings
        self.pause = pause
        self.logger = logger or logging.getLogger("explorer.search")
        self.client = client or httpx.Client(
            timeout=httpx.Timeout(20.0, connect=10.0),
            headers={"User-Agent": settings.api_user_agent or settings.user_agent},
        )
        self.extra_engines = extra_engines or {}
        # Engines a bot has learned are dead weight for it (they answer but never lead to a note); the
        # controller sets this from experience (Controller._apply_engine_tuning). Filtered out of every
        # search, but kept in settings so the tuning can be revisited or reset.
        self.disabled: set[str] = set()

    @property
    def engines(self) -> list[str]:
        return [e for e in self.settings.usable_engines() if e not in self.disabled]

    def search(self, query: str, only: str | None = None) -> SearchOutcome:
        outcome = SearchOutcome(page=error_page("", "no search engine is available"), engine="")
        if only:  # an engine the bot chose itself (policy allowed it): that engine or nothing, no fallback
            only = canonical_engine(only)
            if self.pause.paused_until(only) > self.pause.clock():
                outcome.page = error_page("", f"{only} is resting; use the normal search (leave engine out)")
                return outcome
            page = self._run(only, query)
            reason = backoff_reason(page) if not page.ok else None
            if reason is not None:
                minutes = self.settings.rate_limit_minutes if reason == "rate limit" else self.settings.bot_check_minutes
                self.pause.pause(only, minutes * 60)
                outcome.paused.append((only, reason, minutes))
            outcome.page, outcome.engine = page, (only if page.ok else "")
            return outcome
        engines = self.pause.available(self.engines)
        if not engines:
            wait = self.pause.seconds_until_any(self.engines)
            outcome.page = error_page("", f"every search engine is paused for {int(wait // 60) + 1} more minutes")
            return outcome
        empty: PageView | None = None
        for engine in engines:
            page = self._run(engine, query)
            if engine == BROWSER_ENGINE and self.settings.web_min_interval_seconds > 0:
                self.pause.pause(engine, self.settings.web_min_interval_seconds)
            reason = backoff_reason(page) if not page.ok else None
            if page.ok:
                if no_results(page) and engine != engines[-1]:
                    # A small index (Marginalia, HN) often has nothing on a topic the next engine covers.
                    outcome.empty.append(engine)
                    empty = empty or page
                    continue
                outcome.page, outcome.engine = page, engine
                return outcome
            if reason is None:
                # No answer but nothing to pause for (the corpus had no matching file, an API
                # answered 500): the next engine gets the query; the failure is kept in case all fail.
                outcome.page = page
                continue
            minutes = self.settings.rate_limit_minutes if reason == "rate limit" else self.settings.bot_check_minutes
            self.pause.pause(engine, minutes * 60)
            outcome.paused.append((engine, reason, minutes))
            self.logger.info("search engine %s paused for %.0f minutes (%s)", engine, minutes, reason)
            outcome.page = page  # the last real failure (with its URL and error) is what gets recorded
        if empty is not None:  # an empty results page beats a failure: the model learns the topic is thin
            outcome.page, outcome.engine = empty, outcome.empty[0]
        return outcome

    def _run(self, engine: str, query: str) -> PageView:
        try:
            if engine == BROWSER_ENGINE:
                return self.browser.search(query)
            if engine == "marginalia":
                return marginalia_search(self.client, query, self.settings.marginalia_api_key)
            if engine == "wikipedia":
                return wikipedia_search(self.client, query)
            if engine == "hn":
                return hn_search(self.client, query)
            if engine == "searxng":
                return searxng_search(self.client, query, self.settings.searxng_url)
            if engine == "duckduckgo-mcp":
                return duckduckgo_mcp_search(query, self.settings.ddg_mcp_command)
            if engine == "places":
                return places_search(query, self.settings.places_db)
            if engine == "parallel":
                return parallel_search(self.client, query, self.settings.parallel_api_key, self.settings.parallel_per_day,
                                       self.settings.parallel_usage_file)
            if engine in ("freeserp", "freeserp-sites"):
                return freeserp_search(self.client, query, "sites" if engine == "freeserp-sites" else "web")
            if engine == "langsearch":
                return langsearch_search(self.client, query, self.settings.langsearch_api_key, self.settings.langsearch_per_day,
                                         self.settings.langsearch_usage_file)
            if engine == "tavily":
                return tavily_search(self.client, query, self.settings.tavily_api_key, self.settings.tavily_per_day, self.settings.tavily_usage_file)
            if engine in self.extra_engines:
                return self.extra_engines[engine](query)
        except Exception as exc:  # noqa: BLE001 - one engine failing must not stop the others
            self.logger.debug("search engine %s failed: %s", engine, exc)
            return error_page("", f"{engine} failed: {type(exc).__name__}")
        return error_page("", f"unknown search engine {engine}")


# ---- engines ------------------------------------------------------------------------


_PLACE_STOP = frozenset("the and of nyc new york ny llc inc co corp ltd".split())


def places_search(query: str, db_path: Path, limit: int = 8) -> PageView:
    """New York City's places from Overture Maps' open data (local snapshot, scripts/places_snapshot.py): the listing
    facts for a business by name -- category, website (or none listed), phone, social pages, address, open or closed.
    A data record, not a web page: no listing means only that Overture has none."""
    import re as _re
    import sqlite3 as _sq

    url = f"places://nyc?q={quote_plus(query)}"
    if not Path(db_path).exists():
        return error_page(url, "the places snapshot is not built yet (scripts/places_snapshot.py)")
    words = [w for w in _re.sub(r"[^a-z0-9]+", " ", query.lower()).split() if w not in _PLACE_STOP and len(w) > 1][:5]
    if not words:
        return error_page(url, "give a business name to look up")
    con = _sq.connect(f"file:{db_path}?mode=ro", uri=True, timeout=5)
    try:
        where = " AND ".join("(' ' || name_norm || ' ') LIKE ?" for _ in words)
        rows = con.execute(f"SELECT name, category, website, phone, socials, address, locality, status, confidence FROM places "
                           f"WHERE {where} ORDER BY confidence DESC LIMIT ?", [f"% {w}%" for w in words] + [limit]).fetchall()
    finally:
        con.close()
    lines = [f"Overture Maps listings for '{query}' in New York City (open map data; a listing with no website or socials "
             "means none is listed there):"]
    links: list[Link] = []
    for n, (name, cat, web, phone, soc, addr, loc, status, conf) in enumerate(rows, start=1):
        facts = [str(cat or "").replace("_", " ") or "no category", f"{addr or ''}, {loc or ''}".strip(", "),
                 f"website: {web}" if web else "no website listed", f"phone: {phone}" if phone else "no phone listed",
                 ("social: " + ", ".join(str(soc).split()[:3])) if soc else "no social pages listed",
                 f"status: {status or 'unknown'}", f"confidence {float(conf or 0):.2f}"]
        lines.append(f"[{n}] {name} -- " + "; ".join(f for f in facts if f))
        links.append(Link(n, str(name)[:120], web or url))
    if not rows:
        lines.append(NO_RESULTS)
    return PageView(url=url, title=f"Places: {query}", text="\n".join(lines), links=links)


def _results_page(url: str, heading: str, rows: list[tuple[str, str, str]]) -> PageView:
    """A synthetic results page: numbered lines and matching numbered links."""
    lines = [heading]
    links: list[Link] = []
    for n, (title, link_url, snippet) in enumerate(rows, start=1):
        lines.append(f"[{n}] {title}" + (f": {snippet}" if snippet else ""))
        links.append(Link(n, title[:120], link_url))
    if not rows:
        lines.append(NO_RESULTS)
    return PageView(url=url, title=heading, text="\n".join(lines), links=links)


def wikipedia_search(client: httpx.Client, query: str, limit: int = 10) -> PageView:
    """MediaWiki search: titles and snippets, linking to the articles."""
    url = f"https://en.wikipedia.org/w/index.php?search={quote_plus(query)}"
    resp = client.get(
        WIKIPEDIA_API,
        params={"action": "query", "list": "search", "srsearch": query, "srlimit": limit, "format": "json", "utf8": 1},
    )
    if resp.status_code in (429, 503):
        return error_page(url, rate_limit_error(resp.status_code))
    if resp.status_code == 403 and "robot policy" in resp.text:
        return error_page(url, "Wikipedia refused this user agent (set agent.contact to a URL or email)")
    if resp.status_code >= 400:
        return error_page(url, f"the page does not exist (HTTP {resp.status_code})")
    data = resp.json()
    rows: list[tuple[str, str, str]] = []
    for hit in (data.get("query") or {}).get("search") or []:
        title = str(hit.get("title", "")).strip()
        if not title:
            continue
        snippet = _strip_tags(str(hit.get("snippet", "")))
        rows.append((title, "https://en.wikipedia.org/wiki/" + quote(title.replace(" ", "_")), snippet[:160]))
    return _results_page(url, f"Wikipedia search results for '{query}'", rows)


def hn_search(client: httpx.Client, query: str, limit: int = 10) -> PageView:
    """Hacker News through Algolia's public API: no key, no bot checks. Stories link to the article
    they discuss (or the HN thread when there is none), so `follow` lands on real pages. Best for
    startups, agencies, founders and tools; useless for physics or animals."""
    url = f"https://hn.algolia.com/?q={quote_plus(query)}"
    resp = client.get(HN_API, params={"query": query, "tags": "story", "hitsPerPage": limit})
    if resp.status_code in (429, 503):
        return error_page(url, rate_limit_error(resp.status_code))
    if resp.status_code >= 400:
        return error_page(url, f"the page does not exist (HTTP {resp.status_code})")
    data = resp.json()
    rows: list[tuple[str, str, str]] = []
    for hit in (data.get("hits") or [])[:limit]:
        title = str(hit.get("title") or "").strip()
        if not title:
            continue
        link = str(hit.get("url") or "").strip()
        if not link.startswith("http"):
            link = f"https://news.ycombinator.com/item?id={hit.get('objectID', '')}"
        snippet = f"{hit.get('points') or 0} points, {hit.get('num_comments') or 0} comments on Hacker News"
        rows.append((title, link, snippet))
    return _results_page(url, f"Hacker News results for '{query}'", rows)


def searxng_search(client: httpx.Client, query: str, base_url: str = "http://127.0.0.1:8888", limit: int = 10) -> PageView:
    """The local SearXNG instance: one JSON query, results from Google, Brave, DuckDuckGo and others.

    Those sites throttle this Mac's IP from time to time. SearXNG then lists them as unresponsive: when
    that leaves no results at all, it is a rate limit (the engine rests); when nothing matched, it is
    NO_RESULTS (the next engine answers, no rest). SearXNG not running raises, which the Searcher turns
    into a failed engine and passes on."""
    base = base_url.rstrip("/")
    url = f"{base}/search?q={quote_plus(query)}"
    resp = client.get(f"{base}/search", params={"q": query, "format": "json", "safesearch": 1})
    if resp.status_code in (429, 503):
        return error_page(url, rate_limit_error(resp.status_code))
    if resp.status_code == 403:
        return error_page(url, "SearXNG refused JSON output (enable json under search.formats in its settings.yml)")
    if resp.status_code >= 400:
        return error_page(url, f"the page does not exist (HTTP {resp.status_code})")
    data = resp.json()
    rows: list[tuple[str, str, str]] = []
    seen: set[str] = set()
    for hit in data.get("results") or []:
        title, link = str(hit.get("title") or "").strip(), str(hit.get("url") or "").strip()
        if not title or not link.startswith("http") or link in seen:
            continue
        seen.add(link)
        engines = ", ".join(hit.get("engines") or [])
        snippet = _strip_tags(str(hit.get("content") or ""))[:200]
        rows.append((title, link, f"{snippet} ({engines})" if engines else snippet))
        if len(rows) >= limit:
            break
    unresponsive = data.get("unresponsive_engines") or []
    if not rows and unresponsive:
        reasons = ", ".join(f"{e[0]}: {e[1]}" for e in unresponsive if isinstance(e, (list, tuple)) and len(e) >= 2)
        return error_page(url, f"{rate_limit_error(429)}; every search source was throttled ({reasons})")
    return _results_page(url, f"Web search results for '{query}'", rows)


def _tavily_spend(usage_file: Path, per_day: int) -> bool:
    """Count one call against the fleet's daily Tavily budget. False when today's budget is used up."""
    import datetime as _dt
    import json as _json

    day = _dt.date.today().isoformat()
    try:
        data = _json.loads(usage_file.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            data = {}
    except (OSError, ValueError):
        data = {}
    used = int(data.get(day, 0))
    if per_day > 0 and used >= per_day:
        return False
    try:
        usage_file.parent.mkdir(parents=True, exist_ok=True)
        usage_file.write_text(_json.dumps({day: used + 1}), encoding="utf-8")  # only today's count is kept
    except OSError:
        pass
    return True


def tavily_search(client: httpx.Client, query: str, api_key: str, per_day: int = 30, usage_file: Path = TAVILY_USAGE_FILE, limit: int = 8) -> PageView:
    """Tavily's search API, the backup for hours when every free engine is throttled. Without a key, or with today's
    budget used, it answers "not available" so the next engine runs; a 429 or a plan-limit status rests the engine."""
    url = f"tavily://search?q={quote_plus(query)}"
    if not api_key:
        return error_page(url, "tavily is not available (no key)")
    if not _tavily_spend(usage_file, per_day):
        return error_page(url, f"tavily is not available (today's budget of {per_day} searches is used)")
    resp = client.post(TAVILY_API, headers={"Authorization": "Bearer " + api_key},
                       json={"query": query[:380], "max_results": limit, "search_depth": "basic"})
    if resp.status_code in (429, 432, 433):
        return error_page(url, rate_limit_error(resp.status_code))
    if resp.status_code >= 400:
        return error_page(url, f"tavily refused the search (HTTP {resp.status_code})")
    rows: list[tuple[str, str, str]] = []
    seen: set[str] = set()
    for hit in resp.json().get("results") or []:
        title, link = str(hit.get("title") or "").strip(), str(hit.get("url") or "").strip()
        if not title or not link.startswith("http") or link in seen:
            continue
        seen.add(link)
        rows.append((title, link, _strip_tags(str(hit.get("content") or ""))[:200]))
    return _results_page(url, f"Web search results for '{query}' (tavily)", rows)


_DDG_ITEM = re.compile(r"^\s*\d+\.\s+(.+?)\n\s*URL:\s*(\S+)\s*\n(?:\s*Summary:\s*(.*))?", re.M)


def duckduckgo_mcp_search(query: str, command: str, limit: int = 10, timeout: float = 60.0) -> PageView:
    """DuckDuckGo through its MCP server (keyless, no account): one `search` tool call over stdio, its numbered text
    answer turned into a results page. The server is not installed, slow or blocked: "not available", the next engine
    runs. Nothing but `search` is called, so the server can only read DuckDuckGo's results."""
    import asyncio

    url = f"duckduckgo-mcp://search?q={quote_plus(query)}"
    cmd = Path(command).expanduser()
    if not cmd.exists():
        return error_page(url, "duckduckgo-mcp is not available (server not installed)")
    try:
        from mcp import ClientSession, StdioServerParameters
        from mcp.client.stdio import stdio_client
    except ImportError:
        return error_page(url, "duckduckgo-mcp is not available (MCP client library missing)")

    async def run() -> str:
        params = StdioServerParameters(command=str(cmd), args=[], env={"HOME": str(Path.home()), "PATH": "/usr/bin:/bin"})
        with open(os.devnull, "w") as quiet:  # the server's own log lines would flood the bot's error log
            async with stdio_client(params, errlog=quiet) as (read, write):
                async with ClientSession(read, write) as session:
                    await session.initialize()
                    result = await session.call_tool("search", {"query": query[:300], "max_results": limit})
                    return "\n".join(str(getattr(c, "text", "") or "") for c in result.content or [])

    try:
        text = asyncio.run(asyncio.wait_for(run(), timeout))
    except Exception as exc:  # noqa: BLE001 - a broken server is "not available", never a crash
        return error_page(url, f"duckduckgo-mcp failed ({type(exc).__name__})")
    low = text.lower()
    if "captcha" in low or "rate limit" in low or "too many requests" in low:
        return error_page(url, rate_limit_error(429))
    rows: list[tuple[str, str, str]] = []
    seen: set[str] = set()
    for m in _DDG_ITEM.finditer(text):
        title, link, summary = m.group(1).strip(), m.group(2).strip(), (m.group(3) or "").strip()
        if not link.startswith("http") or link in seen:
            continue
        seen.add(link)
        rows.append((title, link, _strip_tags(summary)[:200]))
    return _results_page(url, f"Web search results for '{query}' (duckduckgo-mcp)", rows)


def parallel_search(client: httpx.Client, query: str, api_key: str, per_day: int = 30,
                    usage_file: Path = PARALLEL_USAGE_FILE, limit: int = 8) -> PageView:
    """Parallel's search API, the family's second backup. Without a key, or with today's budget used, it answers "not
    available" so the next engine runs; a 429 or a used-up credit (402) rests the engine."""
    url = f"parallel://search?q={quote_plus(query)}"
    if not api_key:
        return error_page(url, "parallel is not available (no key)")
    if not _tavily_spend(usage_file, per_day):
        return error_page(url, f"parallel is not available (today's budget of {per_day} searches is used)")
    resp = client.post(PARALLEL_API, headers={"x-api-key": api_key}, json={"objective": query[:380], "max_results": limit}, timeout=60.0)
    if resp.status_code in (402, 429, 503):
        return error_page(url, rate_limit_error(429))
    if resp.status_code >= 400:
        return error_page(url, f"parallel refused the search (HTTP {resp.status_code})")
    try:
        hits = resp.json().get("results") or []
    except (ValueError, AttributeError):
        hits = []
    rows: list[tuple[str, str, str]] = []
    seen: set[str] = set()
    for h in hits:
        if not isinstance(h, dict):
            continue
        link, title = str(h.get("url") or "").strip(), str(h.get("title") or "").strip()
        if not link.startswith("http") or link in seen:
            continue
        seen.add(link)
        excerpt = h.get("excerpts") or h.get("snippet") or ""
        excerpt = " ".join(excerpt) if isinstance(excerpt, list) else str(excerpt)
        rows.append((title or link, link, _strip_tags(excerpt)[:200]))
    return _results_page(url, f"Web search results for '{query}' (parallel)", rows)


_FREESERP_CACHE: dict[tuple[str, str], tuple[float, PageView]] = {}


def freeserp_search(client: httpx.Client, query: str, index: str = "web", limit: int = 10) -> PageView:
    """FreeSerp (owner, 2026-10-05: "Everyone, as one more engine"): keyless and free. index="sites" is 20M business
    homepages with a summary each, answered in about half a second -- Lead Gen's first engine; index="web" is a
    3-billion-page web index, slower and noisier -- the other bots' backup after the local search. Results are kept an
    hour in this process, as the service asks callers to cache."""
    import time as _time

    url = f"freeserp://{index}?q={quote_plus(query)}"
    key = (index, query.strip().lower())
    hit = _FREESERP_CACHE.get(key)
    if hit and _time.time() - hit[0] < 3600:
        return hit[1]
    resp = client.get(FREESERP_API, params={"q": query[:300], "index": index, "limit": limit}, timeout=40.0)
    if resp.status_code in (429, 503):
        return error_page(url, rate_limit_error(resp.status_code))
    if resp.status_code >= 400:
        return error_page(url, f"freeserp refused the search (HTTP {resp.status_code})")
    try:
        data = resp.json()
        hits = data.get("results") or []
    except (ValueError, AttributeError):
        hits = []
    rows: list[tuple[str, str, str]] = []
    seen: set[str] = set()
    for h in hits:
        if not isinstance(h, dict):
            continue
        link = str(h.get("url") or "").strip()
        title = str(h.get("title") or link).strip()
        if not link.startswith("http") or link in seen:
            continue
        seen.add(link)
        rows.append((title, link, _strip_tags(str(h.get("ai_summary") or h.get("snippet") or h.get("description") or ""))[:200]))
    page = _results_page(url, f"Web search results for '{query}' (freeserp {index})", rows)
    if len(_FREESERP_CACHE) > 500:
        _FREESERP_CACHE.clear()
    _FREESERP_CACHE[key] = (_time.time(), page)
    return page


def langsearch_search(client: httpx.Client, query: str, api_key: str, per_day: int = 100,
                      usage_file: Path = LANGSEARCH_USAGE_FILE, limit: int = 8) -> PageView:
    """LangSearch's web search API, the family's backup when the local search fails. Without a key, or with today's
    budget used, it answers "not available" so the next engine runs; a 429 rests the engine like any other."""
    url = f"langsearch://search?q={quote_plus(query)}"
    if not api_key:
        return error_page(url, "langsearch is not available (no key)")
    if not _tavily_spend(usage_file, per_day):  # the same fleet-wide daily counter, in its own file
        return error_page(url, f"langsearch is not available (today's budget of {per_day} searches is used)")
    resp = client.post(LANGSEARCH_API, headers={"Authorization": "Bearer " + api_key},
                       json={"query": query[:380], "count": limit, "summary": False})
    if resp.status_code in (429, 503):
        return error_page(url, rate_limit_error(resp.status_code))
    if resp.status_code >= 400:
        return error_page(url, f"langsearch refused the search (HTTP {resp.status_code})")
    try:
        hits = ((resp.json().get("data") or {}).get("webPages") or {}).get("value") or []
    except (ValueError, AttributeError):
        hits = []
    rows: list[tuple[str, str, str]] = []
    seen: set[str] = set()
    for hit in hits:
        title, link = str(hit.get("name") or "").strip(), str(hit.get("url") or "").strip()
        if not title or not link.startswith("http") or link in seen:
            continue
        seen.add(link)
        rows.append((title, link, _strip_tags(str(hit.get("snippet") or ""))[:200]))
    return _results_page(url, f"Web search results for '{query}' (langsearch)", rows)


def marginalia_search(client: httpx.Client, query: str, api_key: str = "public", limit: int = 10) -> PageView:
    """Marginalia Search: an independent index of small, text-heavy websites. The shared `public` key
    answers 429 when every user of it together passes the per-minute quota, which pauses this engine
    like any other rate limit. Results are licensed CC-BY-NC-SA."""
    url = f"https://marginalia-search.com/search?query={quote_plus(query)}"
    resp = client.get(
        MARGINALIA_API,
        params={"query": query, "count": limit, "nsfw": 0},
        headers={"API-Key": api_key or "public", "Accept": "application/json"},
    )
    if resp.status_code in (429, 503):
        return error_page(url, rate_limit_error(resp.status_code))
    if resp.status_code >= 400:
        return error_page(url, f"the page does not exist (HTTP {resp.status_code})")
    data = resp.json()
    rows: list[tuple[str, str, str]] = []
    for hit in (data.get("results") or [])[:limit]:
        title, link = str(hit.get("title") or "").strip(), str(hit.get("url") or "").strip()
        if link.startswith("http"):
            rows.append((title or link, link, _strip_tags(str(hit.get("description") or ""))[:160]))
    return _results_page(url, f"Marginalia search results for '{query}'", rows)


def no_results(page: PageView) -> bool:
    return page.ok and not page.links and page.text.rstrip().endswith(NO_RESULTS)


def _strip_tags(text: str) -> str:
    import re
    from html import unescape

    return unescape(re.sub(r"<[^>]+>", "", text)).strip()


def load_marginalia_api_key(path: str | Path | None = None) -> str:
    """A personal Marginalia key from the env or the key file; the shared `public` key otherwise."""
    return load_key("MARGINALIA_API_KEY", path if path is not None else key_file("marginalia")) or "public"


def settings_from_config(cfg: Any) -> SearchSettings:
    """Build settings from whatever the config has; every key is optional so this works before a
    [search] section exists. Fake mode searches only the fake browser and keeps the pause local."""
    browser_cfg = getattr(cfg, "browser", None)
    fake = getattr(getattr(cfg, "agent", None), "mode", "web") == "fake"
    engines = list(getattr(browser_cfg, "search_engines", None) or ([BROWSER_ENGINE] if fake else DEFAULT_WEB_ENGINES))
    pause_file = getattr(browser_cfg, "search_pause_file", None)
    if pause_file:
        pause_path = cfg.path(pause_file)
    elif fake:
        pause_path = cfg.workspace / "search_pause.json"
    else:
        pause_path = DEFAULT_PAUSE_FILE
    policy = getattr(cfg, "policy", None)
    agent = getattr(cfg, "agent", None)
    return SearchSettings(
        engines=engines,
        marginalia_api_key=load_marginalia_api_key(getattr(browser_cfg, "marginalia_api_key_file", None)),
        pause_file=pause_path,
        rate_limit_minutes=float(getattr(policy, "search_rate_limit_cooldown_minutes", 5.0)),
        bot_check_minutes=float(getattr(policy, "search_cooldown_minutes", 30.0)),
        web_min_interval_seconds=0.0 if fake else float(getattr(browser_cfg, "search_web_interval_seconds", 180.0)),
        user_agent=str(getattr(cfg, "user_agent", "Mozilla/5.0 (compatible; explorer curiosity agent)")),
        api_user_agent=api_user_agent(str(getattr(agent, "name", "explorer")), str(getattr(agent, "contact", "") or "")),
        searxng_url=str(getattr(browser_cfg, "searxng_url", "") or "http://127.0.0.1:8888"),
        tavily_api_key=load_key("TAVILY_API_KEY", key_file("tavily")) or "",
        tavily_per_day=int(getattr(browser_cfg, "tavily_per_day", 30) or 0),
        langsearch_api_key=load_key("LANGSEARCH_API_KEY", key_file("langsearch")) or "",
        langsearch_per_day=int(getattr(browser_cfg, "langsearch_per_day", 100) or 0),
        parallel_api_key=load_key("PARALLEL_API_KEY", key_file("parallel")) or "",
        parallel_per_day=int(getattr(browser_cfg, "parallel_per_day", 30) or 0),
        **({"ddg_mcp_command": str(Path(str(getattr(browser_cfg, "ddg_mcp_command"))).expanduser())} if getattr(browser_cfg, "ddg_mcp_command", "") else {}),
        **({"places_db": Path(str(getattr(browser_cfg, "places_db"))).expanduser()} if getattr(browser_cfg, "places_db", "") else {}),
    )


def api_user_agent(name: str, contact: str) -> str:
    """`JoblessBotExplorer/0.1 (https://example.com) httpx`: what Wikimedia's policy asks for."""
    ident = "".join(ch for ch in name if ch.isalnum()) or "explorer"
    detail = contact.strip() or "curiosity agent; no contact configured"
    return f"{ident}Explorer/0.1 ({detail}) httpx/{httpx.__version__}"
