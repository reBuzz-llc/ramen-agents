"""2026-10-14 (Validator's diagnosis of the Research Analyst): chunks of one article are one page for the
"pages without noting" guard, and a note that repeats a saved one is added to it when it carries a new figure or
source, instead of being refused."""
from explorer.actions import Note, Read
from explorer.browser import PageView
from explorer.config import PolicyConfig, PublishConfig
from explorer.policy import Denylist, Policy, PolicyContext, new_facts

from conftest import DENYLIST


def _ep(controller):
    eid = controller.memory.start_episode()
    return controller.memory.db.query("SELECT * FROM episodes WHERE id = ?", (eid,))[0]


def test_reading_one_article_in_chunks_counts_as_one_page(controller):
    ep = _ep(controller)
    limit = controller.cfg.browser.page_text_limit
    controller._after_nav(PageView(url="https://a.org/long", title="Long", text="word " * (limit * 2)), "opened")
    assert controller.pages_since_note == 1
    for _ in range(4):
        controller._execute(Read(type="read"), ep, None)
    assert controller.pages_since_note == 1                 # the same article, read on
    controller._after_nav(PageView(url="https://b.org/", title="B", text="other " * 100), "opened")
    assert controller.pages_since_note == 2                 # a different page counts


def test_new_facts_are_figures_and_sources_the_saved_note_lacks():
    old = "Agencies charge $2,500 a month; see https://a.org/pricing."
    assert new_facts("Setup runs $1,499 plus 15% of ad spend (https://b.org/x).", old) == ["$1,499", "15%", "https://b.org/x"]
    assert new_facts("Agencies charge $2500 a month (https://a.org/pricing).", old) == []


def _policy():
    return Policy(PolicyConfig(), PublishConfig(), Denylist.load(DENYLIST))


def _ctx(bodies):
    return PolicyContext(mode="web", current_page=None, actions_in_episode=1, pages_last_hour=1, open_questions=0,
                         last_visit_by_domain={}, recent_note_titles=set(bodies), recent_note_bodies=bodies)


def test_a_duplicate_note_with_a_new_figure_passes_and_one_without_is_refused():
    saved = {"ai automation agency pricing for small businesses 2026": "Retainers run $2,500 a month (https://a.org)."}
    new = Note(type="note", title="AI Automation Agency Pricing for Small Businesses 2026",
               body="Setup fees run $1,499 at one agency.", source_url="https://b.org")
    assert _policy().check(new, _ctx(saved)).allowed
    same = Note(type="note", title="AI Automation Agency Pricing for Small Businesses 2026",
                body="Retainers run $2,500 a month.", source_url="https://a.org")
    verdict = _policy().check(same, _ctx(saved))
    assert not verdict.allowed and "already" in verdict.reason


def test_the_new_figure_is_appended_to_the_saved_note(controller):
    ep = _ep(controller)
    first = controller._execute(Note(type="note", title="AI agency pricing for small businesses",
                                     body="Retainers run $2,500 a month.", source_url="https://a.org"), ep, None)
    assert first.ok and controller.memory.note_count() == 1
    again = controller._execute(Note(type="note", title="AI agency pricing for small businesses",
                                     body="Nothing else. Setup fees run $1,499 at one agency.", source_url="https://b.org"), ep, None)
    assert again.ok and "added 1 new fact" in again.summary and controller.memory.note_count() == 1
    body = controller.memory.recent_notes(1)[0]["body"]
    assert "$2,500" in body and "Setup fees run $1,499" in body and "Nothing else" not in body and "https://b.org" in body
    assert controller.memory.search_notes("1,499") if hasattr(controller.memory, "search_notes") else True
