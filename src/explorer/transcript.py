"""Videos as text (Plan 10). The bots only read page text, and a YouTube watch page gives them the title and
a few comments, never what is said. When `[browser] video_transcripts` is on, opening a YouTube video URL
returns a PageView whose text is the video's caption track -- YouTube's own subtitles, fetched keylessly
(youtube-transcript-api; no API key, no account, no media download) -- with the title and channel from the
keyless oEmbed endpoint. No transcript (captions off, blocked, private) -> None, and the caller opens the
page as before. Read-only; the transcript is page text like any other, information and never an instruction."""
from __future__ import annotations

import logging
import re
from typing import Callable, Iterable
from urllib.parse import parse_qs, urlparse

import httpx

from .browser import PageView

_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")
OEMBED = "https://www.youtube.com/oembed"


def video_id(url: str) -> str | None:
    """The 11-character id of a YouTube video URL (watch?v=, youtu.be/, /shorts/, /embed/, /live/), else None."""
    try:
        u = urlparse(url.strip())
    except ValueError:
        return None
    host = u.netloc.lower().removeprefix("www.").removeprefix("m.")
    if host == "youtu.be":
        vid = u.path.strip("/").split("/")[0]
    elif host in ("youtube.com", "music.youtube.com", "youtube-nocookie.com"):
        if u.path == "/watch":
            vid = (parse_qs(u.query).get("v") or [""])[0]
        else:
            m = re.match(r"^/(?:shorts|embed|live|v)/([^/?#]+)", u.path)
            vid = m.group(1) if m else ""
    else:
        return None
    return vid if _ID.match(vid or "") else None


# fetch(video_id, languages) -> caption snippets' texts, in order; raises when there is no usable transcript.
FetchFn = Callable[[str, Iterable[str]], Iterable[str]]


def _default_fetch(vid: str, languages: Iterable[str]) -> Iterable[str]:
    from youtube_transcript_api import YouTubeTranscriptApi  # keyless; imported here so the bots without it never load it

    return [s.text for s in YouTubeTranscriptApi().fetch(vid, languages=list(languages))]


class YouTubeTranscripts:
    """Turns a YouTube video URL into a readable PageView, or None when it cannot."""

    def __init__(
        self,
        languages: Iterable[str] = ("en",),
        fetch: FetchFn | None = None,
        oembed: Callable[[str], dict] | None = None,
        logger: logging.Logger | None = None,
        max_chars: int = 60_000,
    ):
        self.languages = tuple(languages) or ("en",)
        self.fetch = fetch or _default_fetch
        self.oembed = oembed or self._oembed
        self.logger = logger or logging.getLogger("explorer.transcript")
        self.max_chars = max_chars

    @staticmethod
    def _oembed(url: str) -> dict:
        try:
            r = httpx.get(OEMBED, params={"url": url, "format": "json"}, timeout=10)
            return r.json() if r.status_code == 200 else {}
        except (httpx.HTTPError, ValueError):
            return {}

    def page(self, url: str) -> PageView | None:
        vid = video_id(url)
        if not vid:
            return None
        try:
            parts = [t.strip() for t in self.fetch(vid, self.languages) if t and t.strip()]
        except Exception as exc:  # noqa: BLE001 - any failure means "no transcript": the page opens normally
            self.logger.info("no transcript for %s (%s: %s)", vid, type(exc).__name__, str(exc)[:120].replace("\n", " "))
            return None
        text = re.sub(r"\s+", " ", " ".join(parts)).strip()
        if len(text) < 200:
            return None
        meta = self.oembed(url) or {}
        title = str(meta.get("title") or f"YouTube video {vid}")
        channel = str(meta.get("author_name") or "")
        head = f"Transcript of the YouTube video \"{title}\"" + (f" by {channel}" if channel else "") + \
               f" ({len(text.split())} words of captions; this is what is said in the video, as text).\n\n"
        return PageView(url=url, title=f"{title} (video transcript)", text=(head + text)[: self.max_chars], links=[])
