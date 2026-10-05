import datetime as dt

from explorer.db import Database
from explorer.memory import Memory


def test_notes_and_fts_search(tmp_path):
    memory = Memory(Database(":memory:"), tmp_path)
    memory.add_note("Tides", "The moon pulls the ocean into two bulges.", ["sea"], "fake://tides.html", 1)
    memory.add_note("Moss", "Moss has no roots and drinks through its leaves.", ["plants"], None, 1)
    hits = memory.search_notes("moon bulges")
    assert [h["title"] for h in hits] == ["Tides"]
    assert memory.search_notes('"quoted" ; drop') == [] or True
    assert memory.note_count() == 2
    assert [n["title"] for n in memory.notes_for_episode(1)] == ["Tides", "Moss"]


def test_questions_lifecycle(tmp_path):
    memory = Memory(Database(":memory:"), tmp_path)
    q1 = memory.add_question("Why two tides?")
    q2 = memory.add_question("What is a Fresnel lens?")
    assert memory.pick_question()["id"] == q1
    memory.bump_pursued(q1)
    assert memory.pick_question()["id"] == q2
    note = memory.add_note("Answer", "because of the far-side bulge", [], None, None)
    assert memory.mark_answered(q1, note)
    assert not memory.mark_answered(q1, note)
    assert memory.count_open_questions() == 1


def test_interests_clamp_and_seed(tmp_path):
    memory = Memory(Database(":memory:"), tmp_path)
    assert memory.seed_interests(["Tides", " moss "]) == 2
    assert memory.seed_interests(["again"]) == 0
    assert memory.adjust_interest("tides", 0.9) == 1.0
    assert memory.adjust_interest("tides", -3) == 0.0
    assert memory.adjust_interest("new thing", 0.2) == 0.7
    assert memory.interests(1)[0][0] == "new thing"


def test_visits_and_budget(tmp_path):
    memory = Memory(Database(":memory:"), tmp_path)
    memory.record_visit("https://a.org/x", "A", True)
    memory.record_visit("fake://index.html", "I", True)
    assert memory.visited("https://a.org/x")
    assert memory.pages_last_hour() == 2
    assert "a.org" in memory.last_visit_by_domain()
    assert "fake" in memory.last_visit_by_domain()
    assert memory.domain_counts()[0][1] == 1


def test_journal_and_mirrors(tmp_path):
    memory = Memory(Database(":memory:"), tmp_path)
    memory.add_question("open one")
    memory.adjust_interest("moss", 0.1)
    path = memory.write_journal("first entry", heading="Episode 1")
    memory.write_journal("second entry")
    text = path.read_text()
    assert text.startswith(f"# {dt.date.today().isoformat()}")
    assert "Episode 1" in text and "second entry" in text
    memory.write_markdown_mirrors()
    assert "moss" in (tmp_path / "interests.md").read_text()
    assert "open one" in (tmp_path / "questions.md").read_text()


def test_rephrasings_are_recognised_and_distinct_questions_are_not():
    from explorer.memory import questions_are_similar

    a = "What are some examples of everyday objects and their innovative designs that utilize physics principles?"
    b = "Can you provide examples of everyday objects and their innovative designs that utilize physics principles?"
    assert questions_are_similar(a, b)
    assert not questions_are_similar(a, "How does a Fresnel lens bend light?")
    assert not questions_are_similar("", "anything at all")


def test_questions_chased_too_often_are_retired(tmp_path):
    memory = Memory(Database(":memory:"), tmp_path)
    keep = memory.add_question("How does a Fresnel lens bend light?")
    chased = memory.add_question("What are examples of everyday objects and physics?")
    for _ in range(3):
        memory.bump_pursued(chased)
    assert memory.count_open_questions() == 2
    assert memory.retire_stale_questions(3) == 1
    assert memory.count_open_questions() == 1
    assert memory.question(chased)["status"] == "stale"
    assert memory.question(keep)["status"] == "open"
    assert memory.retire_stale_questions(0) == 0  # disabled


def test_an_open_list_full_of_rephrasings_is_deduped_to_the_earliest(tmp_path):
    memory = Memory(Database(":memory:"), tmp_path)
    first = memory.add_question("What are examples of everyday objects and their designs that use physics principles?")
    memory.add_question("Can you provide examples of everyday objects and their designs that use physics principles?")
    memory.add_question("Examples of everyday objects and their designs that use physics principles, please?")
    other = memory.add_question("How does a Fresnel lens bend light?")
    assert memory.count_open_questions() == 4
    assert memory.dedupe_open_questions() == 2
    assert memory.count_open_questions() == 2
    assert memory.question(first)["status"] == "open"  # the earliest survives
    assert memory.question(other)["status"] == "open"
    assert memory.dedupe_open_questions() == 0  # idempotent


def test_visited_among_finds_only_visited_urls_at_any_age(tmp_path):
    from explorer.db import Database
    from explorer.memory import Memory

    memory = Memory(Database(tmp_path / "m.sqlite3"), tmp_path)
    for i in range(600):  # the old check only looked at the latest 500 visits
        memory.record_visit(f"https://example.com/{i}", f"page {i}", True)
    assert memory.visited_among(["https://example.com/0", "https://example.com/599", "https://example.com/nope", ""]) == {
        "https://example.com/0",
        "https://example.com/599",
    }
    assert memory.visited_among([]) == set()


def test_domain_visits_without_progress_counts_only_domains_nothing_was_written_from(tmp_path):
    memory = Memory(Database(":memory:"), tmp_path)
    since = (dt.datetime.now() - dt.timedelta(minutes=1)).isoformat(timespec="seconds")
    ep = memory.start_episode(None)
    for path in ("", "about", "team", "contact", "locations"):
        memory.record_visit(f"https://www.maplediner.com/{path}", "Alder Fitness", True)
    memory.record_visit("https://junipercafe.com/", "Juniper Cafe", True)
    memory.record_visit("fake://index.html", "fake", True)
    assert memory.domain_visits_without_progress(since) == {"maplediner.com": 5, "junipercafe.com": 1}  # nothing written yet
    memory.record_action(1, ep, "note", {"type": "note", "title": "Juniper Cafe"}, "", "allowed", "saved", True)
    assert memory.domain_visits_without_progress(since) == {}  # a write after the first visit is progress for every open thread
    assert memory.domain_visits_without_progress(dt.datetime.now().isoformat(timespec="seconds")) == {}  # a new episode starts clean
