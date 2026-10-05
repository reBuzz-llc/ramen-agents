"""Notes are for what is new: a near-duplicate of a recent note is refused, and a bot may be capped on how many it
saves (owner, 2026-09-22: the Scout wrote two notes per page read)."""
from __future__ import annotations

from explorer.actions import Note
from explorer.config import PolicyConfig, PublishConfig
from explorer.policy import Denylist, Policy, PolicyContext


def note(title: str) -> Note:
    return Note(type="note", title=title, body="body", tags=[], source_url="https://example.com/p")


def ctx(**over) -> PolicyContext:
    base = dict(mode="web", current_page=None, actions_in_episode=0, pages_last_hour=0, open_questions=0, last_visit_by_domain={})
    base.update(over)
    return PolicyContext(**base)


def test_the_same_finding_in_new_words_is_refused():
    policy = Policy(PolicyConfig(), PublishConfig(), Denylist())
    recent = {"speka offers a genuinely free tier with no card required and $1 usage included monthly"}
    twin = policy.check(note("Speka offers a free tier with $1 usage included monthly, no credit card required"), ctx(recent_note_titles=recent))
    assert not twin.allowed and twin.permanent and "same finding in new words" in twin.reason
    assert policy.check(note("Cloudflare Workers AI free tier limits"), ctx(recent_note_titles=recent)).allowed


def test_note_caps_per_episode_and_day():
    capped = Policy(PolicyConfig(max_notes_per_episode=1, max_notes_per_day=6), PublishConfig(), Denylist())
    assert capped.check(note("A first note"), ctx()).allowed
    assert "note for this episode" in capped.check(note("A second note"), ctx(notes_in_episode=1)).reason
    assert "daily cap" in capped.check(note("A seventh note"), ctx(notes_today=6)).reason
    uncapped = Policy(PolicyConfig(), PublishConfig(), Denylist())
    assert uncapped.check(note("Another note"), ctx(notes_in_episode=5, notes_today=50)).allowed


def test_a_search_is_not_run_twice_in_one_episode_and_opens_can_be_held_to_seen_urls():
    from explorer.actions import Open, Search
    from explorer.browser import PageView

    policy = Policy(PolicyConfig(refuse_repeated_searches=True), PublishConfig(), Denylist())
    prior = ["Northside small business outdated website"]
    again = policy.check(Search(type="search", query="Northside small businesses with outdated websites"), ctx(episode_search_queries=prior))
    assert not again.allowed and "already searched" in again.reason
    assert policy.check(Search(type="search", query="Midtown dental clinic website"), ctx(episode_search_queries=prior)).allowed
    # Off by default: the fallback-engine and pause flows re-run a query on purpose.
    assert Policy(PolicyConfig(), PublishConfig(), Denylist()).check(Search(type="search", query="Northside small business outdated website"), ctx(episode_search_queries=prior)).allowed
    # open_only_seen_urls: a typed-from-memory address is refused; a link seen on a page, or a visited page, is fine.
    strict = Policy(PolicyConfig(open_only_seen_urls=True), PublishConfig(), Denylist())
    guessed = strict.check(Open(type="open", url="https://outdatedweb.com/"), ctx())
    assert not guessed.allowed and "actually seen" in guessed.reason
    assert strict.check(Open(type="open", url="https://acme.example/contact"), ctx(seen_link_urls={"https://acme.example/contact"})).allowed
    assert strict.check(Open(type="open", url="https://acme.example/"), ctx(visited_urls={"https://acme.example/"})).allowed
    assert policy.check(Open(type="open", url="https://outdatedweb.com/"), ctx()).allowed  # off by default
