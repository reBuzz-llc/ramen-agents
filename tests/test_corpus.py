"""The corpus engine: the owner's own files, searched before the web."""
from pathlib import Path

from explorer.corpus import Corpus
from explorer.search import SearchPause, SearchSettings, Searcher
from explorer.browser import FakeBrowser

from conftest import FAKE_WEB


def make_corpus(tmp_path: Path) -> Corpus:
    raw = tmp_path / "raw"
    raw.mkdir()
    (raw / "clutch-spf-agencies.md").write_text(
        "# Clutch: MVP development agencies in Springfield\n\n"
        "Sumatosoft charges $50-99/hr, 4.9 stars from 40 reviews. BuildMVPFast: $25-49/hr, fixed-price MVP in 8 weeks.\n\n"
        "Founders say they pick an agency on portfolio and reply speed, rarely on price alone.\n",
        encoding="utf-8",
    )
    (raw / "pricing.txt").write_text("Acme Studio rate card: MVP build from $12,000; Next Office team $2,800 per developer per month.\n")
    (raw / "notes.html").write_text("<html><body><h1>Cold outreach</h1><script>x()</script><p>Reply rates: 3% on LinkedIn, 8% on warm intros.</p></body></html>")
    (raw / ".DS_Store").write_bytes(b"\x00")
    (raw / "image.png").write_bytes(b"\x89PNG")
    return Corpus(raw)


def test_corpus_search_returns_excerpts_from_the_best_matching_files(tmp_path: Path):
    corpus = make_corpus(tmp_path)
    page = corpus.search("what do Springfield MVP agencies charge per hour")
    assert page.ok and page.links == [] and page.url.startswith("corpus://raw?q=")
    assert page.text.index("### clutch-spf-agencies.md") < page.text.index("### pricing.txt")
    assert "$50-99/hr" in page.text and "rate card" in page.text
    assert "notes.html" not in page.text  # nothing about agencies or rates in it
    html = corpus.search("reply rates on LinkedIn outreach")
    assert "### notes.html" in html.text and "x()" not in html.text and "3% on LinkedIn" in html.text
    empty = corpus.search("cloud chamber physics")
    assert not empty.ok and "none of the owner's files" in (empty.error or "")
    assert not Corpus(tmp_path / "missing").search("anything").ok


def test_a_note_may_cite_the_owners_files_but_not_other_schemes():
    from explorer.actions import Note
    from explorer.config import PolicyConfig, PublishConfig
    from explorer.policy import Denylist, Policy, PolicyContext

    policy = Policy(PolicyConfig(), PublishConfig(), Denylist())
    ctx = PolicyContext(mode="web", current_page=None, actions_in_episode=0, pages_last_hour=0, open_questions=0,
                        last_visit_by_domain={}, blocked_keys=set())

    def note(url: str) -> Note:
        return Note(type="note", title="SPF agency rates", body="$50-99/hr on Clutch.", source_url=url)

    assert policy.check(note("corpus://raw?q=agency rates"), ctx).allowed
    assert policy.check(note("https://clutch.co/x"), ctx).allowed
    assert not policy.check(note("file:///etc/passwd"), ctx).allowed


def test_corpus_is_the_first_engine_and_the_web_still_answers_when_it_is_empty(tmp_path: Path):
    corpus = make_corpus(tmp_path)
    settings = SearchSettings(engines=["corpus", "browser"], pause_file=tmp_path / "pause.json")
    searcher = Searcher(FakeBrowser(FAKE_WEB), settings, SearchPause(settings.pause_file), extra_engines={"corpus": corpus.search})
    outcome = searcher.search("MVP development agencies in Springfield")
    assert outcome.engine == "corpus" and "Sumatosoft" in outcome.page.text
    # Nothing in the folder about moss: the web answers, and no engine is paused for it.
    outcome = searcher.search("moss")
    assert outcome.engine == "browser" and outcome.page.ok and outcome.paused == []
    assert searcher.pause.available(["corpus"]) == ["corpus"]


def test_loose_matches_and_the_readme_go_to_the_web(tmp_path: Path):
    """With a real folder almost any query shares a word with some file; only a file that holds at least
    half the query's words is an answer, so the bot still reaches the web for everything else."""
    corpus = make_corpus(tmp_path)
    (tmp_path / "raw" / "README.md").write_text("Drop files here: Clutch pages, pricing, case studies about Springfield startups.\n")
    loose = corpus.search("factors influencing Springfield startups choosing offshore software agencies")
    assert not loose.ok and "none of the owner's files" in (loose.error or "")
    solid = corpus.search("Springfield MVP agencies")
    assert solid.ok and "### clutch-spf-agencies.md" in solid.text and "README.md" not in solid.text
    assert "pricing.txt" not in solid.text  # shares only "mvp" with the query: dropped


def test_urls_in_own_files_become_followable_links(tmp_path):
    """A seed list of business sites in the owner's folder: the bot can `follow` them (open_only_seen_urls would
    refuse a typed URL), and duplicates collapse into one link."""
    from explorer.corpus import Corpus

    (tmp_path / "ny-seed.md").write_text(
        "# Northside bakeries with a published email\n\n- Mia's Bakery https://miasnorthside.com/ bakery@miasnorthside.com\n"
        "- Ovenly https://oven.ly/contact. Also https://miasnorthside.com/ again.\n", encoding="utf-8")
    page = Corpus(tmp_path).search("northside bakeries published email")
    assert page.ok and "Mia's Bakery" in page.text
    assert [l.url for l in page.links] == ["https://miasnorthside.com/", "https://oven.ly/contact"]
    assert page.links[0].number == 1 and page.links[1].number == 2
