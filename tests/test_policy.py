import time

from explorer.actions import Ask, Follow, Note, Open, Publish, Rest, Say, Search, Summarize
from explorer.browser import Link, PageView
from explorer.config import PolicyConfig, PublishConfig
from explorer.policy import Denylist, Policy, PolicyContext, RobotsCache, is_private_host

from conftest import DENYLIST


def make_policy(**overrides):
    cfg = PolicyConfig(**overrides)
    return Policy(cfg, PublishConfig(), Denylist.load(DENYLIST))


def ctx(mode="web", page=None, actions=0, pages=0, questions=0, last=None, blocked=None):
    return PolicyContext(
        mode=mode,
        current_page=page,
        actions_in_episode=actions,
        pages_last_hour=pages,
        open_questions=questions,
        last_visit_by_domain=last or {},
        blocked_keys=blocked or set(),
    )


def test_denylist_blocks_login_pages_in_both_modes():
    policy = make_policy()
    assert not policy.check(Open(type="open", url="fake://login.html"), ctx(mode="fake")).allowed
    assert not policy.check(Open(type="open", url="https://example.com/login"), ctx()).allowed
    assert not policy.check(Open(type="open", url="https://example.com/user/signin.php"), ctx()).allowed
    assert not policy.check(Open(type="open", url="https://accounts.google.com/o/oauth2"), ctx()).allowed
    assert not policy.check(Open(type="open", url="https://sub.paypal.com/x"), ctx()).allowed


def test_reading_ordinary_pages_is_allowed():
    policy = make_policy()
    assert policy.check(Open(type="open", url="https://en.wikipedia.org/wiki/Tide"), ctx()).allowed
    assert policy.check(Open(type="open", url="fake://tides.html"), ctx(mode="fake")).allowed
    assert policy.check(Search(type="search", query="how do tides work"), ctx()).allowed


def test_private_networks_and_schemes():
    policy = make_policy()
    assert not policy.check(Open(type="open", url="http://127.0.0.1:8000/"), ctx()).allowed
    assert not policy.check(Open(type="open", url="http://10.0.0.5/admin"), ctx()).allowed
    assert not policy.check(Open(type="open", url="http://localhost/"), ctx()).allowed
    assert not policy.check(Open(type="open", url="file:///etc/passwd"), ctx()).allowed
    assert not policy.check(Open(type="open", url="ftp://example.com/"), ctx()).allowed
    assert not policy.check(Open(type="open", url="fake://index.html"), ctx(mode="web")).allowed
    assert not policy.check(Open(type="open", url="https://example.com/"), ctx(mode="fake")).allowed
    assert is_private_host("192.168.1.10")
    assert is_private_host("printer.local")
    assert not is_private_host("example.org")


def test_page_budget_and_domain_delay():
    policy = make_policy(pages_per_hour=2, per_domain_delay_seconds=30)
    assert not policy.check(Open(type="open", url="https://example.com/"), ctx(pages=2)).allowed
    assert not policy.check(Search(type="search", query="x"), ctx(pages=2)).allowed
    recent = {"example.com": time.time() - 5}
    verdict = policy.check(Open(type="open", url="https://example.com/a"), ctx(last=recent))
    assert not verdict.allowed and "wait" in verdict.reason
    assert policy.check(Open(type="open", url="https://other.org/a"), ctx(last=recent)).allowed


def test_episode_budget_forces_consolidation():
    policy = make_policy(max_actions_per_episode=3)
    full = ctx(actions=3)
    assert not policy.check(Open(type="open", url="https://example.com/"), full).allowed
    assert not policy.check(Search(type="search", query="x"), full).allowed
    assert policy.check(Summarize(type="summarize"), full).allowed
    assert policy.check(Ask(type="ask", question="why?"), full).allowed
    assert policy.check(Rest(type="rest", seconds=5), full).allowed


def test_summarize_needs_something_to_summarize():
    policy = make_policy()
    assert not policy.check(Summarize(type="summarize"), ctx(actions=0)).allowed
    assert policy.check(Summarize(type="summarize"), ctx(actions=1)).allowed


def test_follow_resolves_link_numbers():
    policy = make_policy()
    page = PageView(url="https://a.org/", title="A", text="t", links=[Link(1, "b", "https://b.org/"), Link(2, "login", "https://b.org/login")])
    assert policy.resolve_target(Follow(type="follow", link=1), ctx(page=page)) == "https://b.org/"
    assert policy.check(Follow(type="follow", link=1), ctx(page=page)).allowed
    assert not policy.check(Follow(type="follow", link=2), ctx(page=page)).allowed
    assert not policy.check(Follow(type="follow", link=9), ctx(page=page)).allowed
    assert not policy.check(Follow(type="follow", link=1), ctx(page=None)).allowed


def test_publish_and_rest_limits():
    policy = make_policy(max_rest_seconds=10)
    assert not policy.check(Publish(type="publish", destination="local", title="t", body="b"), ctx()).allowed
    enabled = Policy(PolicyConfig(), PublishConfig(enabled=True, destinations=["local"]), Denylist())
    assert enabled.check(Publish(type="publish", destination="local", title="t", body="b"), ctx()).allowed
    assert not enabled.check(Publish(type="publish", destination="twitter", title="t", body="b"), ctx()).allowed
    assert not policy.check(Rest(type="rest", seconds=11), ctx()).allowed
    assert policy.check(Rest(type="rest", seconds=10), ctx()).allowed


def test_blocked_keys_and_question_cap():
    policy = make_policy(max_open_questions=1)
    verdict = policy.check(Open(type="open", url="https://a.org/"), ctx(blocked={"open:https://a.org/"}), key="open:https://a.org/")
    assert not verdict.allowed and "repeated" in verdict.reason
    assert not policy.check(Ask(type="ask", question="q"), ctx(questions=1)).allowed


def test_robots_cache_respects_disallow():
    robots = RobotsCache("RoamExplorer/0.1", fetch=lambda url: "User-agent: *\nDisallow: /private/\n")
    assert robots.can_fetch("https://x.org/public/page")
    assert not robots.can_fetch("https://x.org/private/page")
    unreachable = RobotsCache("RoamExplorer/0.1", fetch=lambda url: None)
    assert unreachable.can_fetch("https://x.org/anything")
    policy = Policy(PolicyConfig(), PublishConfig(), Denylist(), robots)
    assert not policy.check(Open(type="open", url="https://x.org/private/1"), ctx()).allowed


def test_pages_without_note_cap():
    policy = make_policy(max_pages_without_note=2)
    assert policy.check(Open(type="open", url="https://a.org/"), ctx(page=None, actions=0)).allowed
    blocked = PolicyContext(mode="web", current_page=None, actions_in_episode=2, pages_last_hour=2, open_questions=0, last_visit_by_domain={}, pages_since_note=2)
    verdict = policy.check(Open(type="open", url="https://a.org/"), blocked)
    assert not verdict.allowed and "noting" in verdict.reason
    assert not policy.check(Search(type="search", query="x"), blocked).allowed
    assert policy.check(Ask(type="ask", question="why?"), blocked).allowed
    off = make_policy(max_pages_without_note=0)
    assert off.check(Open(type="open", url="https://a.org/"), blocked).allowed


def test_duplicate_note_titles_are_refused_within_an_episode():
    policy = make_policy()
    note = Note(type="note", title="Fresnel lens orders", body="Six orders, by size.")
    c = ctx(mode="fake")
    assert policy.check(note, c).allowed
    c.episode_note_titles = {"fresnel lens orders"}
    verdict = policy.check(note, c)
    assert not verdict.allowed and "already saved a note" in verdict.reason
    other = Note(type="note", title="Fresnel lens history", body="Invented in 1822.")
    assert policy.check(other, c).allowed


def test_duplicate_note_titles_are_refused_across_recent_episodes():
    """The same title saved in an earlier episode (last few days) is refused, so a small model does
    not re-save the same conclusion every fresh episode (the observed cross-episode duplication)."""
    policy = make_policy()
    note = Note(type="note", title="Comet studio product clarity sprint", body="A $6k productized build.")
    c = ctx(mode="fake")
    assert policy.check(note, c).allowed  # nothing recent yet
    c.recent_note_titles = {"comet studio product clarity sprint"}
    verdict = policy.check(note, c)
    assert not verdict.allowed and verdict.permanent and "last few days" in verdict.reason
    assert policy.check(Note(type="note", title="Something genuinely new", body="Fresh."), c).allowed


def test_say_needs_text_and_stays_short():
    policy = make_policy()
    from explorer.actions import Say

    assert policy.check(Say(type="say", text="Found something on Fresnel lenses."), ctx()).allowed
    assert not policy.check(Say(type="say", text="   "), ctx()).allowed
    assert not policy.check(Say(type="say", text="x" * 1001), ctx()).allowed
    # say is a consolidation action: still allowed once the episode budget is used up
    assert policy.check(Say(type="say", text="wrapping up"), ctx(actions=12)).allowed  # at budget, within grace


def test_over_budget_grace_then_only_summarize():
    policy = make_policy(max_actions_per_episode=3, budget_grace_actions=2)
    at_budget = ctx(actions=3)
    assert policy.check(Ask(type="ask", question="why?"), at_budget).allowed
    assert not policy.check(Open(type="open", url="https://example.com/"), at_budget).allowed
    over = ctx(actions=5)  # budget + grace
    verdict = policy.check(Ask(type="ask", question="why?"), over)
    assert not verdict.allowed and "only action allowed now is summarize" in verdict.reason
    assert not policy.check(Rest(type="rest", seconds=5), over).allowed
    assert policy.check(Summarize(type="summarize"), over).allowed


def test_questions_per_episode_are_capped():
    policy = make_policy(max_questions_per_episode=2)
    c = ctx()
    c.questions_in_episode = 1
    assert policy.check(Ask(type="ask", question="one more?"), c).allowed
    c.questions_in_episode = 2
    verdict = policy.check(Ask(type="ask", question="and another?"), c)
    assert not verdict.allowed and "already asked 2 questions" in verdict.reason


def test_a_rephrased_question_is_refused():
    policy = make_policy()
    from explorer.actions import Ask

    c = ctx()
    c.open_question_texts = [
        "What are some examples of everyday objects and their innovative designs that utilize physics principles?"
    ]
    rephrased = Ask(
        type="ask",
        question="Can you provide examples of everyday objects and their innovative designs that utilize physics principles?",
    )
    verdict = policy.check(rephrased, c)
    assert not verdict.allowed and "already have that question open" in verdict.reason
    assert policy.check(Ask(type="ask", question="How does a Fresnel lens bend light?"), c).allowed


def test_asking_closes_for_the_episode_after_repeated_refusals():
    policy = make_policy(max_refused_asks_per_episode=2)
    question = Ask(type="ask", question="Who in Springfield buys offshore development?")
    c = ctx()
    c.refused_asks_in_episode = 1
    assert policy.check(question, c).allowed
    c.refused_asks_in_episode = 2
    verdict = policy.check(question, c)
    assert not verdict.allowed and "asking is closed" in verdict.reason
    assert make_policy(max_refused_asks_per_episode=0).check(question, c).allowed  # 0 = no limit


def test_daily_say_cap_keeps_owner_replies_open():
    # owner, 2026-09-26: "1 msg a day with a short list of things" -- after 19 chat messages in one day
    policy = make_policy(max_says_per_day=1)
    c = ctx(); c.says_today = 0
    assert policy.check(Say(type="say", text="Today: 3 packages published, Lead Gen paused."), c).allowed
    c.says_today = 1
    v = policy.check(Say(type="say", text="Also, I researched biotech."), c)
    assert not v.allowed and "1 message a day" in v.reason
    c.owner_wrote = True  # the owner just wrote in chat: a reply is always allowed
    assert policy.check(Say(type="say", text="Yes, the list is in Notion."), c).allowed
    c.owner_wrote = False
    assert policy.check(Say(type="say", text="x"), ctx()).allowed or make_policy().check(Say(type="say", text="x"), c).allowed  # 0 = no cap


def test_domain_no_progress_cap_refuses_the_same_site_and_tags_it():
    # Lead Gen: 95 of 257 visits on one site hunting a founder it never states (2026-09-25 night)
    policy = make_policy(domain_no_progress_cap=5, respect_robots=False)
    c = ctx(); c.domain_visits_no_progress = {"maplediner.com": 5, "junipercafe.com": 2}
    v = policy.check(Open(type="open", url="https://www.maplediner.com/about"), c)
    assert not v.allowed and v.tag == "domain_cap" and "move on" in v.reason
    assert policy.check(Open(type="open", url="https://junipercafe.com/menu"), c).allowed
    assert make_policy(respect_robots=False).check(Open(type="open", url="https://www.maplediner.com/about"), c).allowed  # 0 = off


def test_open_only_seen_urls_lets_a_leads_board_site_through():
    # Lead Gen typed https://sunnydeli-example.com from the Validator's upkeep list and was refused three times (2026-09-26)
    policy = make_policy(open_only_seen_urls=True, respect_robots=False)
    c = ctx(mode="web"); c.recent_lead_domains = {"sunnydeli-example.com"}
    assert policy.check(Open(type="open", url="https://sunnydeli-example.com"), c).allowed
    assert policy.check(Open(type="open", url="https://www.sunnydeli-example.com/about"), c).allowed
    assert not policy.check(Open(type="open", url="https://someothershop.com"), c).allowed


def test_plan_is_allowed_while_a_priority_ask_waits_and_at_episode_end():
    from explorer.actions import Plan
    from explorer.config import MessagingConfig
    from explorer.policy import PRIORITY_WORK_TYPES
    from explorer.actions import CONSOLIDATION_TYPES

    assert "plan" in PRIORITY_WORK_TYPES and "plan" in CONSOLIDATION_TYPES
    policy = make_policy(max_actions_per_episode=6)
    c = ctx(actions=6)  # budget used up: a plan tick/end is still allowed, like a last note
    from explorer.plan import WorkPlan
    c.plan = WorkPlan.new("Fill cells", "all filled", ["open", "update"]); c.plan_progress_action_id = 7
    assert policy.check(Plan(type="plan", tick=1), c).allowed


def test_three_refused_searches_end_searching_for_the_episode():
    policy = make_policy(refuse_repeated_searches=True)
    c = ctx(); c.refused_searches_in_episode = 3
    v = policy.check(Search(type="search", query="something genuinely new"), c)
    assert not v.allowed and "no more searching" in v.reason
    c.refused_searches_in_episode = 2
    assert policy.check(Search(type="search", query="something genuinely new"), c).allowed


def test_a_task_handed_to_a_colleague_is_not_handed_twice_while_open():
    from explorer.actions import Task
    from explorer.config import MessagingConfig, NotionConfig
    from explorer.policy import Policy, Denylist
    from explorer.config import PolicyConfig, PublishConfig
    from conftest import DENYLIST

    m = MessagingConfig(enabled=True, peers=[{"name": "Package Designer", "folder": "/tmp/pd"}])
    policy = Policy(PolicyConfig(), PublishConfig(), Denylist.load(DENYLIST), notion=NotionConfig(enabled=True), messaging=m)
    c = ctx(); c.open_asks_to = {"package designer": [("task for you: Update Fixed-Price MVP Development package toggle title with exact price\nx", "2026-09-29T02:05:00")]}
    again = Task(type="task", title="Update the Fixed-Price MVP Development toggle title to include the exact price", details="y" * 320, assignee="Package Designer")
    v = policy.check(again, c)
    assert not v.allowed and "already handed" in v.reason
    other = Task(type="task", title="Research website care pricing at three Northside agencies", details="y" * 320, assignee="Package Designer")
    assert policy.check(other, c).allowed


def test_three_refused_notes_or_tasks_end_that_type_for_the_episode():
    from explorer.actions import Task
    from explorer.config import NotionConfig
    from explorer.policy import PRIORITY_WORK_TYPES

    assert "package" in PRIORITY_WORK_TYPES
    policy = make_policy()
    c = ctx(); c.refused_notes_in_episode = 3
    v = policy.check(Note(type="note", title="t", body="b", source_url="https://x.example/"), c)
    assert not v.allowed and "no more notes" in v.reason
    from explorer.config import PolicyConfig, PublishConfig
    from explorer.policy import Policy, Denylist
    from conftest import DENYLIST
    p2 = Policy(PolicyConfig(), PublishConfig(), Denylist.load(DENYLIST), notion=NotionConfig(enabled=True))
    c2 = ctx(); c2.refused_tasks_in_episode = 3
    assert "no more tasks" in p2.check(Task(type="task", title="x" * 20, details="y" * 320), c2).reason


def test_a_malformed_address_is_refused_not_crashed():
    # Lead Gen died again and again on "host:host": httpx raised InvalidURL deep inside the robots fetch.
    policy = make_policy()
    for url in ("https://www.caswellpowellfilming.com:www.caswellpowellfilming.com", "https://:example.com/x"):
        v = policy.check(Open(type="open", url=url), ctx())
        assert not v.allowed and "not a valid web address" in v.reason


def test_robots_cache_survives_a_fetch_that_raises():
    calls = []

    def fetch(url):
        calls.append(url)
        raise ValueError("Invalid port")

    robots = RobotsCache("RoamExplorer/0.1", fetch=fetch)
    assert robots.can_fetch("https://site.example/a")
    assert robots.can_fetch("https://site.example/b")
    assert calls == ["https://site.example/robots.txt"]  # cached as unreadable for the TTL
