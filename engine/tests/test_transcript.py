"""Plan 10: a YouTube video opens as its caption transcript, so the bot reads what is said (owner, 2026-09-22)."""
from __future__ import annotations

from explorer.actions import Decision, Open
from explorer.model import ModelResult
from explorer.transcript import YouTubeTranscripts, video_id

from conftest import make_controller

CAPTIONS = [f"sentence {i} of the talk about winning clients in springfield." for i in range(40)]


def fake_fetch(vid, languages):
    assert vid == "UF8uR6Z6KLc" and list(languages) == ["en"]
    return CAPTIONS


def fake_oembed(url):
    return {"title": "Stanford Commencement Address", "author_name": "Stanford"}


def test_video_ids_are_recognised_on_every_youtube_url_shape():
    assert video_id("https://www.youtube.com/watch?v=UF8uR6Z6KLc&t=12s") == "UF8uR6Z6KLc"
    assert video_id("https://youtu.be/UF8uR6Z6KLc") == "UF8uR6Z6KLc"
    assert video_id("https://m.youtube.com/shorts/UF8uR6Z6KLc") == "UF8uR6Z6KLc"
    assert video_id("https://www.youtube.com/embed/UF8uR6Z6KLc?rel=0") == "UF8uR6Z6KLc"
    assert video_id("https://www.youtube.com/@stanford/videos") is None
    assert video_id("https://www.youtube.com/watch?v=short") is None
    assert video_id("https://example.com/watch?v=UF8uR6Z6KLc") is None


def test_a_video_becomes_a_readable_page_and_failures_fall_through():
    t = YouTubeTranscripts(fetch=fake_fetch, oembed=fake_oembed)
    page = t.page("https://youtu.be/UF8uR6Z6KLc")
    assert page is not None and page.ok and page.links == []
    assert page.title == "Stanford Commencement Address (video transcript)"
    assert page.text.startswith('Transcript of the YouTube video "Stanford Commencement Address" by Stanford (')
    assert "sentence 39 of the talk" in page.text and "\n" not in page.text.split("\n\n", 1)[1]
    # Not a video, no captions, or too little text: None, and the caller opens the page normally.
    assert t.page("https://example.com/pricing") is None
    def boom(vid, langs):
        raise RuntimeError("Subtitles are disabled for this video")
    assert YouTubeTranscripts(fetch=boom, oembed=fake_oembed).page("https://youtu.be/UF8uR6Z6KLc") is None
    assert YouTubeTranscripts(fetch=lambda v, l: ["hi"], oembed=fake_oembed).page("https://youtu.be/UF8uR6Z6KLc") is None
    # No oEmbed answer: a plain title, still a page.
    assert YouTubeTranscripts(fetch=fake_fetch, oembed=lambda u: {}).page("https://youtu.be/UF8uR6Z6KLc").title == "YouTube video UF8uR6Z6KLc (video transcript)"


class OpensVideo:
    def decide(self, system, obs):
        return ModelResult(decision=Decision(thought="watch", action=Open(type="open", url="https://www.youtube.com/watch?v=UF8uR6Z6KLc")))

    def complete(self, system, prompt):
        return "summary"


def test_the_controller_opens_a_video_as_its_transcript(cfg):
    cfg.agent.mode = "web"  # the policy must accept a real https URL; the browser itself is never reached
    ctl = make_controller(cfg, model=OpensVideo(), transcripts=YouTubeTranscripts(fetch=fake_fetch, oembed=fake_oembed))
    ctl.run(max_cycles=1)
    row = ctl.memory.db.query("SELECT verdict, result FROM actions ORDER BY id DESC LIMIT 1")[0]
    assert row["verdict"] == "allowed" and "(video transcript)" in row["result"]
    assert ctl.page is not None and "sentence 12 of the talk" in ctl.page.text
    visits = ctl.memory.db.query("SELECT url, title FROM visits ORDER BY id DESC LIMIT 1")
    assert visits and visits[0]["url"].endswith("v=UF8uR6Z6KLc")
