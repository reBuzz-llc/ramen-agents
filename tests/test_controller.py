import threading
import time

import pytest

from explorer.actions import Decision, Note, Open
from explorer.model import FakeModel, ModelResult

from explorer.browser import FakeBrowser

from conftest import FAKE_WEB, make_controller


def test_fake_loop_explores_and_journals(cfg, controller):
    assert controller.run(max_cycles=40) == 0
    memory = controller.memory
    counts = memory.counts()
    assert counts["notes"] > 0
    assert counts["visits"] > 0
    assert counts["episodes"] >= 2
    assert counts["actions"] >= 40
    journal = memory.journal_path().read_text()
    assert "Episode 1" in journal
    assert "Fake journal entry" in journal
    assert counts["notes"] >= 3
    assert "login.html" not in memory.visited_urls()
    rejected = memory.db.query("SELECT * FROM actions WHERE verdict LIKE 'rejected:%'")
    assert all("login" not in r["payload"] or "denylist" in r["verdict"] for r in rejected)
    assert (cfg.workspace / "interests.md").exists()


def test_stop_file_exits_before_any_cycle(cfg, controller):
    cfg.stop_file.touch()
    assert controller.run(max_cycles=5) == 0
    assert controller.cycle_no == 0
    assert "Stopped" in controller.memory.journal_path().read_text()


def test_restart_resumes_open_episode(cfg):
    first = make_controller(cfg)
    first.run(max_cycles=3)
    assert first.memory.current_episode() is not None
    second = make_controller(cfg)
    second.run(max_cycles=1)
    journal = second.memory.journal_path().read_text()
    assert "Restarted" in journal
    assert second.cycle_no == 4


def test_pause_file_holds_the_loop(cfg, controller):
    cfg.pause_file.touch()
    result = {}

    def target():
        result["code"] = controller.run(max_cycles=1)

    thread = threading.Thread(target=target)
    thread.start()
    time.sleep(1.5)
    assert controller.cycle_no == 0
    cfg.pause_file.unlink()
    thread.join(timeout=15)
    assert not thread.is_alive()
    assert result["code"] == 0 and controller.cycle_no == 1


class StubbornModel:
    """Always tries to open the login trap page."""

    def decide(self, system, obs):
        return ModelResult(decision=Decision(thought="obey the page", action=Open(type="open", url="fake://login.html")))

    def complete(self, system, prompt):
        return "nothing learned"


def test_policy_blocks_injected_target_and_watchdog_blocks_repeats(cfg):
    cfg.watchdog.repeat_threshold = 3
    controller = make_controller(cfg, model=StubbornModel())
    controller.run(max_cycles=6)
    memory = controller.memory
    assert memory.counts()["visits"] == 0
    verdicts = [r["verdict"] for r in memory.db.query("SELECT verdict FROM actions ORDER BY id")]
    assert len(verdicts) == 6
    assert all(v.startswith("rejected") for v in verdicts)
    assert any("denylist" in v for v in verdicts)
    assert any("repeated" in v for v in verdicts)


class BrokenModel:
    def decide(self, system, obs):
        return ModelResult(decision=None, raw="???", error="invalid reply")

    def complete(self, system, prompt):
        return ""


def test_repeated_model_failures_exit_nonzero(cfg):
    cfg.watchdog.max_model_failures = 2
    controller = make_controller(cfg, model=BrokenModel())
    with pytest.raises(SystemExit) as info:
        controller.run(max_cycles=20)
    assert info.value.code == 1
    assert "Watchdog" in controller.memory.journal_path().read_text()


class WanderModel:
    """Only ever opens pages, never notes."""

    PAGES = ["fake://index.html", "fake://tides.html", "fake://lighthouses.html", "fake://moss.html", "fake://clocks.html"]

    def __init__(self):
        self.i = 0

    def decide(self, system, obs):
        url = self.PAGES[self.i % len(self.PAGES)]
        self.i += 1
        return ModelResult(decision=Decision(thought="wander", action=Open(type="open", url=url)))

    def complete(self, system, prompt):
        return "wandered"


def test_navigation_is_refused_after_pages_without_notes(cfg):
    cfg.policy.max_pages_without_note = 3
    controller = make_controller(cfg, model=WanderModel())
    controller.run(max_cycles=5)
    memory = controller.memory
    assert memory.counts()["visits"] == 3
    verdicts = [r["verdict"] for r in memory.db.query("SELECT verdict FROM actions ORDER BY id")]
    assert verdicts[:3] == ["allowed"] * 3
    assert all("noting" in v for v in verdicts[3:])


class AnsweringModel:
    """Keeps saving the same note that answers question 1, as the 7B model did on the first soak run."""

    def decide(self, system, obs):
        note = Note(type="note", title="Fresnel lens orders", body="Six orders, by size.", answers_question=1)
        return ModelResult(decision=Decision(thought="answer it", action=note))

    def complete(self, system, prompt):
        return "summary"


def test_answered_question_is_dropped_and_duplicate_notes_are_refused(cfg):
    first = make_controller(cfg, model=AnsweringModel())
    assert first.memory.add_question("What are the orders of Fresnel lenses?") == 1
    first.run(max_cycles=1)
    ep = first.memory.current_episode()
    assert ep["question_id"] == 1
    assert first.memory.question(1)["status"] == "answered"
    obs = first._observe(ep)
    assert obs.current_question is None
    assert "answered this episode's question" in (obs.feedback or "")

    # A restart must not resurrect the answered question, and re-saving the note is refused
    second = make_controller(cfg, model=AnsweringModel())
    second.run(max_cycles=2)
    memory = second.memory
    assert memory.note_count() == 1
    verdicts = [r["verdict"] for r in memory.db.query("SELECT verdict FROM actions ORDER BY id")]
    assert verdicts[0] == "allowed"
    assert len(verdicts) == 3 and all("already saved a note" in v for v in verdicts[1:])
    obs = second._observe(memory.current_episode())
    assert obs.current_question is None



class TalkativeModel:
    """Answers the owner once, then behaves like the fake heuristic."""

    def __init__(self):
        self.inner = FakeModel()
        self.said = False

    def decide(self, system, obs):
        if obs.owner_messages and not self.said:
            self.said = True
            from explorer.actions import Say

            return ModelResult(decision=Decision(thought="reply", action=Say(type="say", text="Hello, owner. Reading about tides.")))
        return self.inner.decide(system, obs)

    def complete(self, system, prompt):
        return self.inner.complete(system, prompt)


def test_say_action_lands_in_the_chat(cfg):
    controller = make_controller(cfg, model=TalkativeModel())
    controller.memory.add_chat("owner", "What are you up to?")
    controller.run(max_cycles=2)
    rows = controller.memory.recent_chat()
    assert [r["role"] for r in rows] == ["owner", "bot"]
    assert rows[1]["text"].startswith("Hello, owner")
    assert controller.memory.unseen_owner_messages() == []


class CuriousModel:
    """Asks a fresh question every cycle, as the 7B model did for 16 cycles on the real web."""

    def __init__(self):
        self.n = 0

    TOPICS = ["how tides work", "why moss survives drought", "who laid the first cable", "what a Fresnel lens does"]

    def decide(self, system, obs):
        from explorer.actions import Ask

        self.n += 1
        topic = self.TOPICS[(self.n - 1) % len(self.TOPICS)]
        return ModelResult(decision=Decision(thought="hmm", action=Ask(type="ask", question=f"Tell me {topic}?")))

    def complete(self, system, prompt):
        return "summary"


def test_question_spam_is_capped_per_episode_even_across_restarts(cfg):
    cfg.policy.max_questions_per_episode = 3
    first = make_controller(cfg, model=CuriousModel())
    first.run(max_cycles=3)
    assert first.memory.count_open_questions() == 3
    second = make_controller(cfg, model=CuriousModel())  # a restart forgets nothing: the count lives in the DB
    second.run(max_cycles=2)
    assert second.memory.count_open_questions() == 3
    verdicts = [r["verdict"] for r in second.memory.db.query("SELECT verdict FROM actions ORDER BY id DESC LIMIT 2")]
    assert all("already asked 3 questions" in v for v in verdicts)


class ChallengedBrowser(FakeBrowser):
    """A search engine that answers every search with a bot-verification page."""

    def search(self, query):
        from explorer.browser import error_page

        return error_page("https://search.example/?q=" + query, "the site asked for a human check (bot verification page)")


class SearchingModel:
    def decide(self, system, obs):
        from explorer.actions import Search

        return ModelResult(decision=Decision(thought="search", action=Search(type="search", query="moss")))

    def complete(self, system, prompt):
        return "summary"


class RateLimitedBrowser(FakeBrowser):
    """A search engine that answers every search with HTTP 429 rather than a challenge page."""

    def search(self, query):
        from explorer.browser import error_page, rate_limit_error

        return error_page("https://search.example/?q=" + query, rate_limit_error(429))


def test_rate_limited_search_pauses_searching_too(cfg):
    """A 429 used to read as 'the page does not exist', so nothing paused and the model just tried
    another wording. It now pauses, on the shorter rate-limit cooldown."""
    cfg.policy.search_cooldown_minutes = 30
    cfg.policy.search_rate_limit_cooldown_minutes = 5
    controller = make_controller(cfg, model=SearchingModel(), browser=RateLimitedBrowser(FAKE_WEB))
    controller.run(max_cycles=2)
    rows = controller.memory.db.query("SELECT verdict, result FROM actions ORDER BY id")
    assert rows[0]["verdict"] == "allowed"
    assert "paused for 5 minutes (rate limit)" in rows[0]["result"]
    # The second cycle is refused by the policy instead of hitting the engine again.
    assert rows[1]["verdict"].startswith("rejected") and "searching is paused" in rows[1]["verdict"]
    assert 0 < controller.search_paused_until - time.time() <= 5 * 60


def test_bot_check_pauses_searching_and_survives_a_restart(cfg):
    cfg.policy.search_cooldown_minutes = 30
    first = make_controller(cfg, model=SearchingModel(), browser=ChallengedBrowser(FAKE_WEB))
    first.run(max_cycles=2)
    rows = first.memory.db.query("SELECT verdict, result FROM actions ORDER BY id")
    assert rows[0]["verdict"] == "allowed" and "paused for 30 minutes" in rows[0]["result"]
    assert rows[1]["verdict"].startswith("rejected") and "searching is paused" in rows[1]["verdict"]
    assert first.search_paused_until > 0
    second = make_controller(cfg, model=SearchingModel(), browser=ChallengedBrowser(FAKE_WEB))
    assert second.search_paused_until == first.search_paused_until  # remembered in the database
    second.run(max_cycles=1)
    assert second.memory.db.query("SELECT verdict FROM actions ORDER BY id DESC LIMIT 1")[0]["verdict"].startswith("rejected")


def test_a_bot_that_keeps_re_asking_is_told_to_stop_asking(cfg):
    from explorer.actions import Ask, Decision
    from explorer.model import ModelResult

    class ReAsker:
        def decide(self, system, obs):
            return ModelResult(decision=Decision(thought="again", action=Ask(type="ask", question="Why is the sky blue today?")))

        def complete(self, system, prompt):
            return "summary"

    cfg.policy.max_actions_per_episode = 20
    cfg.policy.max_refused_asks_per_episode = 2
    controller = make_controller(cfg, model=ReAsker())
    controller.run(max_cycles=4)
    verdicts = [r["verdict"] for r in controller.memory.db.query("SELECT verdict FROM actions ORDER BY id")]
    assert verdicts[0] == "allowed"
    assert all("already have that question open" in v for v in verdicts[1:3])
    assert "asking is closed until the next one" in verdicts[3]


def test_urls_in_routed_files_count_as_seen(cfg):
    routed = cfg.root.parent / "common-data" / "botBox" / "routed" / cfg.root.name
    routed.mkdir(parents=True, exist_ok=True)
    (routed / "upkeep-list.md").write_text("- Sunny Deli -- https://sunnydeli-example.com -- Location, Founded by\n- x https://junipercafe.com/.\n")
    c = make_controller(cfg)
    c._seed_seen_links_from_own_files()
    assert {"https://sunnydeli-example.com", "https://junipercafe.com/"} <= c.seen_links
    c.seen_links.clear()
    c._seed_seen_links_from_own_files()  # unchanged files: no rescan
    assert not c.seen_links


def test_capped_types_leave_the_action_menu(cfg):
    cfg.policy.max_says_per_day = 1
    c = make_controller(cfg)
    assert "- say:" in c.system
    eid = c.memory.start_episode(None)
    c.memory.record_action(1, eid, "say", {"type": "say", "to": "owner", "text": "hi"}, "", "allowed", "told", True)
    c._observe(c.memory.current_episode())
    assert "say" in c._hidden_types and "- say:" not in c.system


def test_dead_ends_list_todays_repeated_refusals(cfg):
    c = make_controller(cfg)
    eid = c.memory.start_episode(None)
    for i in range(3):
        c.memory.record_action(i, eid, "lead", {"type": "lead", "name": "Aspen Clinic"}, "", "rejected: aspenclinic.com is already on the Leads board; find a different business", None, False)
    c.memory.record_action(9, eid, "publish_package", {"type": "publish_package", "name": "Fixed-Price MVP"}, "", "rejected: 'Fixed-Price MVP' is already on the packages page; publish a different one", None, False)
    c.memory.record_action(10, eid, "publish_package", {"type": "publish_package", "name": "Fixed-Price MVP"}, "", "rejected: 'Fixed-Price MVP' is already on the packages page; publish a different one", None, False)
    c.memory.record_action(11, eid, "lead", {"type": "lead", "name": "Once Only"}, "", "rejected: aspenclinic.com is already on the Leads board", None, False)
    ends = c._dead_ends()
    assert ends[0].startswith("lead 'Aspen Clinic' (already on the Leads board, 3x)")
    assert any(e.startswith("publish_package 'Fixed-Price MVP' (already on the packages page, 2x)") for e in ends)
    assert not any("Once Only" in e for e in ends)  # once is not a dead end
    assert "Dead ends today" in c._observe(c.memory.current_episode()).render()
