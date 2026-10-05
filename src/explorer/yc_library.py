"""The `yc` search engine: Y Combinator's Startup Library, searched locally.

ycombinator.com/library is one page that embeds the whole library (Startup School, Office Hours, Paul
Graham's essays, Founder FAQ, podcasts), each item with its description and full text or transcript.
YC's robots.txt allows that page and every /library/<slug> article, and forbids only its search URLs
(/library?*). So this engine never calls YC's search: it downloads the library page at most once a day
into a shared cache (~/.config/explorer/yc_library.json, one download for every bot on the Mac) and
searches the cached text here. A hit is a synthetic results page with the best passages and numbered
links to the articles, so the bot can note from the excerpt or follow a link.

A query is answered only when an item's best passage covers at least half the query's words (the same
rule as the corpus engine); otherwise the next engine gets it.
"""
from __future__ import annotations

import html
import json
import logging
import os
import re
import time
from pathlib import Path
from typing import Any, Callable

import httpx

from .browser import Link, PageView, error_page
from .corpus import Corpus, _words

LIBRARY_URL = "https://www.ycombinator.com/library"
ARTICLE_URL = "https://www.ycombinator.com/library/{slug}"
DEFAULT_CACHE = Path.home() / ".config" / "explorer" / "yc_library.json"
MAX_AGE_SECONDS = 24 * 3600
MAX_ITEM_CHARS = 60_000  # a long transcript is plenty at this size


def parse_library(page_html: str) -> list[dict[str, str]]:
    """Items from the library page's embedded data (data-page JSON): slug, title, series, text, url."""
    match = re.search(r'data-page="([^"]+)"', page_html)
    if not match:
        return []
    try:
        data = json.loads(html.unescape(match.group(1)))
    except ValueError:
        return []
    props = data.get("props") or {}
    found: dict[str, dict[str, str]] = {}

    def add(item: Any, series: str) -> None:
        if not isinstance(item, dict) or not item.get("slug") or not item.get("title"):
            return
        parts = [str(item.get(k) or "") for k in ("description", "content", "transcript")]
        text = "\n\n".join(p for p in dict.fromkeys(parts) if p and p != "None")[:MAX_ITEM_CHARS]
        found.setdefault(str(item["slug"]), {
            "slug": str(item["slug"]),
            "title": str(item["title"]).strip(),
            "series": str(item.get("series_name") or series or "").replace("None", "").strip(),
            "author": str(item.get("author") or "").replace("None", "").strip(),
            "url": ARTICLE_URL.format(slug=item["slug"]),
            "text": text,
        })

    add(props.get("featured"), "")
    for carousel in props.get("carousels") or []:
        name = str(carousel.get("title") or carousel.get("name") or "") if isinstance(carousel, dict) else ""
        for item in (carousel.get("articles") or []) if isinstance(carousel, dict) else []:
            add(item, name)
    return list(found.values())


class YCLibrary:
    def __init__(
        self,
        cache_path: Path | str = DEFAULT_CACHE,
        client: httpx.Client | None = None,
        logger: logging.Logger | None = None,
        clock: Callable[[], float] = time.time,
        user_agent: str = "explorer curiosity agent",
        max_hits: int = 3,
        excerpt_chars: int = 1500,
        min_coverage: float = 0.5,
    ):
        self.cache_path = Path(cache_path)
        self.client = client or httpx.Client(timeout=httpx.Timeout(60.0, connect=15.0), follow_redirects=True,
                                             headers={"User-Agent": user_agent})
        self.logger = logger or logging.getLogger("explorer.yc")
        self.clock = clock
        self.max_hits = max_hits
        self.excerpt_chars = excerpt_chars
        self.min_coverage = min_coverage
        self._items: list[dict[str, str]] | None = None
        self._loaded_at = 0.0  # cache file mtime the in-memory copy came from
        self._fetched_at = 0.0  # clock time of this process's last successful download

    def items(self) -> list[dict[str, str]]:
        """The library, from the cache when it is under a day old, else downloaded once and cached."""
        try:
            stat = self.cache_path.stat()
            fresh = self.clock() - max(stat.st_mtime, self._fetched_at) < MAX_AGE_SECONDS
        except OSError:
            stat, fresh = None, False
        if self._items is not None and stat is not None and stat.st_mtime == self._loaded_at and fresh:
            return self._items
        if not fresh:
            downloaded = self._download()
            if downloaded:
                return downloaded
        try:  # stale cache beats no library at all when YC is unreachable
            data = json.loads(self.cache_path.read_text(encoding="utf-8"))
            self._items = [i for i in data.get("items", []) if isinstance(i, dict)]
            self._loaded_at = self.cache_path.stat().st_mtime
        except (OSError, ValueError):
            self._items = []
        return self._items

    def _download(self) -> list[dict[str, str]]:
        try:
            resp = self.client.get(LIBRARY_URL)
        except httpx.HTTPError as exc:
            self.logger.info("YC library download failed: %s", type(exc).__name__)
            return []
        if resp.status_code != 200:
            self.logger.info("YC library answered HTTP %s", resp.status_code)
            return []
        items = parse_library(resp.text)
        if not items:
            self.logger.warning("YC library page had no readable items; keeping the old cache")
            return []
        self.cache_path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.cache_path.with_name(f".{self.cache_path.name}.{os.getpid()}.tmp")
        tmp.write_text(json.dumps({"source": LIBRARY_URL, "items": items}, ensure_ascii=False), encoding="utf-8")
        os.replace(tmp, self.cache_path)
        self._items, self._loaded_at, self._fetched_at = items, self.cache_path.stat().st_mtime, self.clock()
        self.logger.info("YC library cached: %d items", len(items))
        return items

    def search(self, query: str) -> PageView:
        url = f"https://www.ycombinator.com/library#q={query}"  # a label for the log; never fetched
        terms = _words(query)
        distinct = set(terms)
        items = self.items()
        if not items:
            return error_page(url, "the YC library is not available right now")
        if not distinct:
            return error_page(url, "no words to search the YC library for")
        scored: list[tuple[float, int, dict[str, str], str]] = []
        for item in items:
            body = f"{item['title']}\n{item.get('series', '')}\n{item.get('text', '')}"
            words = _words(body)
            if not words:
                continue
            counts = {t: words.count(t) for t in distinct}
            if not any(counts.values()):
                continue
            passage = Corpus._excerpt(item.get("text", "") or body, terms, self.excerpt_chars)
            in_passage = set(_words(f"{item['title']} {passage}"))
            coverage = sum(1 for t in distinct if t in in_passage)
            title_hits = sum(1 for t in distinct if t in set(_words(item["title"])))
            score = coverage * 10 + title_hits * 6 + sum(min(c, 5) for c in counts.values()) / (1 + len(words) / 4000)
            scored.append((score, coverage, item, passage))
        scored.sort(key=lambda s: -s[0])
        if not scored or max(s[1] for s in scored) / len(distinct) < self.min_coverage:
            return error_page(url, "nothing in the YC library covers that question")
        scored = [s for s in scored if s[1] >= min(2, len(distinct))][: self.max_hits]
        if not scored:
            return error_page(url, "nothing in the YC library covers that question")
        lines = [f"Y Combinator Startup Library results for '{query}'"]
        links: list[Link] = []
        for n, (_, _, item, passage) in enumerate(scored, start=1):
            series = f" ({item['series']})" if item.get("series") else ""
            lines += ["", f"[{n}] {item['title']}{series}", passage]
            links.append(Link(n, item["title"][:120], item["url"]))
        return PageView(url=url, title=f"YC Library: {query[:60]}", text="\n".join(lines), links=links)
