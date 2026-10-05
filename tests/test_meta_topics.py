"""The agent's own tooling is never a subject: rate limits, captchas and search engines are refused
as searches, questions, notes and interests, and old ones are purged at episode start. Both live
bots had 'bypassing rate limits' as their top interest on 2026-09-14 before this existed."""
from explorer.actions import Ask, Interest, Note, Read, Search
from explorer.browser import PageView
from explorer.config import PolicyConfig, PublishConfig
from explorer.db import Database
from explorer.memory import Memory
from explorer.policy import Denylist, Policy, PolicyContext, is_meta_topic

from conftest import DENYLIST, make_controller


def test_meta_topic_matcher_catches_the_live_phrasings_and_spares_real_subjects():
    for text in (
        "bypassing rate limits",
        "how to bypass rate limits",
        "tools to bypass rate limits API scraping LinkedIn Google search rate limit workaround",
        "brave search alternative methods",
        "Wikipedia did not provide specific MVP development channels",
        "How can I research MVP channels without encountering rate-limits?",
        "Is there a captcha on every search engine?",
        "brave web browser",
        "No results found for communities or forums on design and physics",
    ):
        assert is_meta_topic(text), text
    for text in (
        "how offshore software agencies win clients in springfield",
        "Brave New World by Aldous Huxley",
        "cloud chamber physics",
        "the history of Wikipedia as an encyclopedia",
        "decentralized ai platforms",
    ):
        assert not is_meta_topic(text), text


def ctx(pages_since_note: int = 0) -> PolicyContext:
    return PolicyContext(
        mode="web",
        current_page=PageView(url="https://example.com/long", title="long", text="x" * 500, links=[]),
        actions_in_episode=0,
        pages_last_hour=0,
        open_questions=0,
        last_visit_by_domain={},
        blocked_keys=set(),
        pages_since_note=pages_since_note,
    )


def test_policy_refuses_the_agents_own_tools_as_a_subject():
    policy = Policy(PolicyConfig(), PublishConfig(), Denylist.load(DENYLIST))
    refused = (
        Search(type="search", query="tools to bypass rate limits API scraping"),
        Ask(type="ask", question="How can I research channels without encountering rate limits?"),
        Interest(type="interest", topic="bypassing rate limits", delta=0.3),
        Interest(type="interest", topic="bypassing rate limits", delta=-0.3),
        Note(type="note", title="Wikipedia did not provide specific channels", body="Nothing useful."),
    )
    for action in refused:
        verdict = policy.check(action, ctx())
        assert not verdict.allowed and "your own tools" in verdict.reason, action
    assert policy.check(Ask(type="ask", question="Who in Springfield buys MVP development?"), ctx()).allowed
    assert policy.check(Search(type="search", query="Springfield startups MVP development agencies"), ctx()).allowed
    assert policy.check(Interest(type="interest", topic="brave new world by huxley", delta=0.2), ctx()).allowed


def test_reading_chunk_after_chunk_without_noting_is_refused_like_navigation(cfg):
    policy = Policy(PolicyConfig(max_pages_without_note=3), PublishConfig(), Denylist.load(DENYLIST))
    assert policy.check(Read(type="read"), ctx(pages_since_note=2)).allowed
    verdict = policy.check(Read(type="read"), ctx(pages_since_note=3))
    assert not verdict.allowed and "read" in verdict.reason
    # And the controller counts a chunk read toward that cap.
    controller = make_controller(cfg)
    controller.page = PageView(url="fake://long.html", title="long", text="x" * 20000, links=[])
    controller.page_offset = 0
    assert controller.pages_since_note == 0
    result = controller._execute(Read(type="read"), None, None)  # type: ignore[arg-type]
    assert result.ok and controller.pages_since_note == 1


def test_meta_questions_and_interests_are_purged_at_episode_start(tmp_path):
    memory = Memory(Database(":memory:"), tmp_path)
    keep = memory.add_question("Who exactly in Springfield buys a remote development team?")
    drop = memory.add_question("How can I bypass rate limits when researching?")
    memory.adjust_interest("bypassing rate limits", 0.5)
    memory.adjust_interest("how to bypass rate limits", 0.5)
    memory.adjust_interest("how offshore software agencies win clients in springfield", 0.5)
    assert memory.purge_meta_topics(is_meta_topic) == (1, 2)
    assert memory.question(keep)["status"] == "open"
    assert memory.question(drop)["status"] == "meta"
    assert [t for t, _ in memory.interests()] == ["how offshore software agencies win clients in springfield"]
    assert memory.purge_meta_topics(is_meta_topic) == (0, 0)  # idempotent
