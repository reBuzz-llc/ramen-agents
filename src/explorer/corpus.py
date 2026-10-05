"""A search engine over the owner's own files: the `corpus` entry in browser.search_engines.

The CEO cannot reach the sources it needs most (LinkedIn, Clutch, Google Maps: login walls and
bot blocks), and the owner can. So the owner drops what they find into a folder (`raw/` in the
bot's folder: pasted pages, pricing, guides, exports) and the bot searches that first. A hit is a
synthetic results page whose text is the matching excerpts themselves, so the model can note from
it directly; there are no links to follow and nothing leaves the Mac. Plain files only, read on
every search (the folder is small and edited by hand), so a new file counts immediately.
"""
from __future__ import annotations

import logging
import re
from pathlib import Path

from .browser import Link, PageView, error_page

EXTENSIONS = {".md", ".txt", ".html", ".htm", ".csv", ".json", ".jsonl"}
MAX_FILE_BYTES = 2_000_000
STOPWORDS = frozenset(
    "a an and are as at be by do for from how in is it of on or that the to what which who why with".split()
)


def _words(text: str) -> list[str]:
    return [w for w in re.findall(r"[a-z0-9][a-z0-9'-]{1,}", text.lower()) if w not in STOPWORDS]


def _strip_html(text: str) -> str:
    from html import unescape

    text = re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", " ", text)
    text = re.sub(r"(?s)<[^>]+>", " ", text)
    return unescape(re.sub(r"[ \t]+", " ", text))


class Corpus:
    def __init__(self, folder: Path | str, logger: logging.Logger | None = None, excerpt_chars: int = 1500,
                 max_hits: int = 4, min_coverage: float = 0.5, extra_folders: list[Path | str] | None = None):
        self.folder = Path(folder)
        # Also searched: files the owner dropped for this bot (common-data/botBox/routed/<slug>/ and /everyone/).
        self.extra_folders = [Path(f) for f in (extra_folders or [])]
        self.logger = logger or logging.getLogger("explorer.corpus")
        self.excerpt_chars = excerpt_chars
        self.max_hits = max_hits
        # The folder answers a query only when its best file holds at least this share of the query's
        # words. With a few dozen files almost any query shares a word or two with something ("startups",
        # "software"); without this the bot would read its own company blog forever and never reach the web.
        self.min_coverage = min_coverage

    def files(self) -> list[Path]:
        out: list[Path] = []
        for folder in (self.folder, *self.extra_folders):
            if folder.is_dir():
                out.extend(p for p in sorted(folder.rglob("*")) if p.is_file() and p.suffix.lower() in EXTENSIONS
                           and not p.name.startswith(".") and p.name.lower() != "readme.md")  # the folder's own instructions
        return out

    def _label(self, path: Path) -> str:
        for folder in (self.folder, *self.extra_folders):
            if path.is_relative_to(folder):
                rel = path.relative_to(folder).as_posix()
                return rel if folder == self.folder else f"dropped by the owner: {rel}"
        return path.name

    def _read(self, path: Path) -> str:
        try:
            if path.stat().st_size > MAX_FILE_BYTES:
                return ""
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            return ""
        return _strip_html(text) if path.suffix.lower() in (".html", ".htm") else text

    @staticmethod
    def _excerpt(text: str, terms: list[str], chars: int) -> str:
        """The window of `chars` around the densest cluster of query terms, on paragraph edges."""
        lowered = text.lower()
        positions = sorted(m.start() for t in terms for m in re.finditer(re.escape(t), lowered))
        if not positions:
            return text[:chars].strip()
        best_start, best_count = 0, 0
        for i, pos in enumerate(positions):
            count = sum(1 for p in positions[i:] if p - pos <= chars)
            if count > best_count:
                best_start, best_count = pos, count
        start = max(0, best_start - chars // 4)
        start = text.rfind("\n", 0, start) + 1 if start else 0
        return text[start:start + chars].strip()

    def search(self, query: str) -> PageView:
        terms = _words(query)
        url = f"corpus://{self.folder.name}?q={query}"
        scored: list[tuple[float, Path, str, int]] = []
        for path in self.files():
            text = self._read(path)
            if not text.strip():
                continue
            words = _words(text)
            if not words:
                continue
            counts = {t: words.count(t) for t in terms}
            hit_terms = sum(1 for c in counts.values() if c)
            if hit_terms == 0:
                continue
            # Files that cover more of the query beat files that repeat one word; length-normalised.
            score = hit_terms * 10 + sum(min(c, 5) for c in counts.values()) / (1 + len(words) / 2000)
            if path.stem.lower() in query.lower():
                score += 5
            scored.append((score, path, text, hit_terms))
        scored.sort(key=lambda s: -s[0])
        distinct = max(1, len(set(terms)))
        # Coverage is measured inside each file's best passage, not across the whole file: a long blog post
        # holds most everyday words somewhere, but only a passage that is about the question holds them together.
        scored = [
            (score, path, text, sum(1 for t in set(terms) if t in set(_words(self._excerpt(text, terms, self.excerpt_chars)))))
            for score, path, text, _ in scored
        ]
        if scored and max(s[3] for s in scored) / distinct < self.min_coverage:
            scored = []  # only loose matches: let the web answer this one
        else:
            scored = [s for s in scored if s[3] >= min(2, distinct)]  # drop files that share a single word
        if not scored:
            # Not an answer: the searcher moves on to the web. (A results page saying "nothing"
            # would be the answer, and the model would search the folder again and again.)
            return error_page(url, f"none of the owner's files in {self.folder.name}/ match")
        lines = [f"Your own files ({self.folder.name}/) matching '{query}'"]
        for _, path, text, _hits in scored[: self.max_hits]:
            lines.append("")
            lines.append(f"### {self._label(path)}")
            lines.append(self._excerpt(text, terms, self.excerpt_chars))
        body = "\n".join(lines)
        # Web addresses the owner's files mention become numbered links, so a bot can `follow` a business or pricing
        # page named in a seed list instead of typing the URL (which open_only_seen_urls refuses as a guess).
        links: list[Link] = []
        seen: set[str] = set()
        for m in re.finditer(r"https?://[^\s<>()\[\]\"']+", body):
            href = m.group(0).rstrip(".,;:")
            if href in seen or len(links) >= 40:
                continue
            seen.add(href)
            links.append(Link(number=len(links) + 1, text=href[:120], url=href))
        return PageView(url=url, title=f"Own files: {query[:60]}", text=body, links=links)
