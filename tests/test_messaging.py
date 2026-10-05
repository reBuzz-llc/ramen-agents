"""The Scout <-> Onion Reader research channel: a `message` action drops a note in the peer's inbox,
the peer reads it once, and a plain-only (local-only) bot may not carry links or page text out."""
from __future__ import annotations

import json
from pathlib import Path

from explorer import fleet
from explorer.actions import Decision, Message, Open, Say
from explorer.config import MessagingConfig, PolicyConfig, PublishConfig, load_config
from explorer.handoff import Inbox, send_message
from explorer.model import ModelResult
from explorer.policy import Denylist, Policy, PolicyContext

from conftest import make_controller


def msg(**over) -> Message:
    spec = dict(type="message", to="Onion Reader", text="Which onion news outlets are worth reading?")
    spec.update(over)
    return Message(**spec)


def ctx(**over) -> PolicyContext:
    base = dict(mode="web", current_page=None, actions_in_episode=0, pages_last_hour=0, open_questions=0,
                last_visit_by_domain={})
    base.update(over)
    return PolicyContext(**base)


def policy(peers=None, **over) -> Policy:
    spec = dict(enabled=True, peers=peers or [{"name": "Onion Reader", "folder": "/tmp/onion"}], max_per_day=3)
    spec.update(over)
    return Policy(PolicyConfig(), PublishConfig(), Denylist(), messaging=MessagingConfig(**spec))


def test_message_policy_peer_length_and_rarity():
    off = Policy(PolicyConfig(), PublishConfig(), Denylist())
    assert "not enabled" in off.check(msg(), ctx()).reason
    p = policy()
    assert p.check(msg(), ctx()).allowed
    assert not p.check(msg(text=""), ctx()).allowed
    wrong = p.check(msg(to="The CEO"), ctx())
    assert not wrong.allowed and wrong.permanent and "Onion Reader" in wrong.reason

    # More than one peer: the bot may message any of them, and only them.
    two = policy(peers=[{"name": "Scout", "folder": "/tmp/scout"}, {"name": "The CEO", "folder": "/tmp/ceo"}])
    assert two.check(msg(to="Scout"), ctx()).allowed
    assert two.check(msg(to="The CEO"), ctx()).allowed
    assert not two.check(msg(to="Jobless-Bot"), ctx()).allowed
    assert "own tools" in p.check(msg(text="how do we get around the rate limit?"), ctx()).reason
    assert "under 600 characters" in p.check(msg(text="x" * 601), ctx()).reason
    assert "this episode" in p.check(msg(), ctx(messages_in_episode=1)).reason
    assert "daily limit" in p.check(msg(), ctx(messages_today=3)).reason


def test_plain_only_bot_may_not_send_links_or_onion_hosts():
    """The Onion Reader is local-only; nothing it read over Tor may reach the Scout's cloud model."""
    p = policy(peers=[{"name": "Scout", "folder": "/tmp/scout"}], plain_only=True, max_chars=300)
    ok = p.check(msg(to="Scout", text="Any provider that hosts an uncensored small model, cheaply?"), ctx())
    assert ok.allowed
    for leak in (
        "see https://example.onion/page",
        "read bbcnewsv2vjtpsuy.onion for this",
        "the page at http://x said so",
        "check www.example.com",
    ):
        v = p.check(msg(to="Scout", text=leak), ctx())
        assert not v.allowed and "stays on this Mac" in v.reason
    assert not p.check(msg(to="Scout", text="y" * 301), ctx()).allowed  # its own shorter cap


def test_send_message_writes_a_note_the_peer_reads_once(tmp_path: Path):
    onion = tmp_path / "onion-reader"
    msg_file = send_message(str(onion), "Scout", "Which onion news outlets are worth reading?")
    assert msg_file.parent == onion / "workspace" / "inbox"
    body = json.loads(msg_file.read_text())
    assert body["from"] == "Scout" and body["kind"] == "message"
    assert body["text"] == "Which onion news outlets are worth reading?"

    inbox = Inbox(onion / "workspace")
    unread = inbox.unread()
    assert [m.sender for m in unread] == ["Scout"]
    assert unread[0].render() == "From Scout: Which onion news outlets are worth reading?"
    inbox.mark_seen(unread)
    assert inbox.unread() == []


class Sender:
    """Opens a page (so the episode has an action), then messages the peer."""

    def __init__(self):
        self.step = 0

    def decide(self, system, obs):
        self.step += 1
        action = Open(type="open", url="fake://tides.html") if self.step == 1 else msg()
        return ModelResult(decision=Decision(thought="ask a colleague", action=action))

    def complete(self, system, prompt):
        return "summary"


def test_scout_messages_the_onion_reader_and_it_sees_it_on_its_next_step(cfg, tmp_path: Path):
    onion_folder = tmp_path / "onion-reader"
    cfg.agent.name = "Scout"
    cfg.agent.mode = "fake"
    cfg.messaging = MessagingConfig(enabled=True, peers=[{"name": "Onion Reader", "folder": str(onion_folder)}])
    scout = make_controller(cfg, model=Sender())
    assert "message:" in scout.system and "Onion Reader" in scout.system
    scout.run(max_cycles=2)
    rows = scout.memory.db.query("SELECT action_type, verdict FROM actions ORDER BY id")
    assert [(r["action_type"], r["verdict"]) for r in rows] == [("open", "allowed"), ("message", "allowed")]
    assert list((onion_folder / "workspace" / "inbox").glob("*.json"))

    from explorer.config import Config

    onion_cfg = Config(root=onion_folder)
    for key in ("cycle_delay_seconds", "seed_interests"):
        setattr(onion_cfg.agent, key, getattr(cfg.agent, key))
    onion_cfg.agent.name = "Onion Reader"
    onion_cfg.browser.fake_web_dir = cfg.browser.fake_web_dir
    onion_cfg.policy.denylist_file = cfg.policy.denylist_file
    onion_cfg.watchdog.heartbeat_interval_seconds = 0
    onion_cfg.quiet.enabled = False
    onion_cfg.ensure_dirs()
    seen: list[str] = []

    class Reader:
        def decide(self, system, obs):
            seen.append(obs.render())
            return ModelResult(decision=Decision(thought="ok", action=Say(type="say", text="Reading up on it.")))

        def complete(self, system, prompt):
            return "summary"

    reader = make_controller(onion_cfg, model=Reader())
    reader.run(max_cycles=2)
    assert "Messages from your colleagues" in seen[0]
    assert "From Scout: Which onion news outlets are worth reading?" in seen[0]
    assert "From Scout" not in seen[1]  # shown once, then filed under inbox/done


def test_room_nudge_invites_a_quiet_member_to_the_chatroom(cfg, tmp_path: Path):
    """A room member that has not sent any message in a few episodes gets a gentle invitation."""
    cfg.messaging = MessagingConfig(enabled=True, room=True, room_file=str(tmp_path / "chatroom.jsonl"))
    c = make_controller(cfg)
    assert c._room_nudge() is None  # no finished episodes yet
    for _ in range(3):
        c.memory.end_episode(c.memory.start_episode(), "done")
    nudge = c._room_nudge()
    assert nudge and '"everyone"' in nudge and "chatroom" in nudge
    # A bot with no room configured is never nudged.
    cfg.messaging = MessagingConfig(enabled=False)
    quiet = make_controller(cfg)
    for _ in range(3):
        quiet.memory.end_episode(quiet.memory.start_episode(), "done")
    assert quiet._room_nudge() is None


def test_chatroom_post_and_read_back(tmp_path: Path):
    from explorer.chatroom import Chatroom

    room = Chatroom(tmp_path / "chatroom.jsonl")
    assert room.recent() == [] and room.last_id() == -1
    room.post("Scout", "found a new free provider worth a look")
    room.post("The CEO", "who has notes on SPF agency pricing?")
    posts = room.recent()
    assert [p.sender for p in posts] == ["Scout", "The CEO"]
    assert posts[0].render() == "Scout: found a new free provider worth a look"
    # A bot sees only posts newer than the last it saw, and never its own.
    fresh = room.since(after_id=-1, exclude_sender="Scout")
    assert [p.sender for p in fresh] == ["The CEO"]
    assert room.since(after_id=room.last_id()) == []  # nothing new


def test_policy_room_post_needs_the_room_and_still_honours_plain_only():
    from explorer.chatroom import ROOM_RECIPIENT

    # Room off: "everyone" is refused even though peers exist.
    no_room = policy(peers=[{"name": "Scout", "folder": "/tmp/scout"}])
    assert not no_room.check(msg(to=ROOM_RECIPIENT), ctx()).allowed
    # Room on: posting to "everyone" is allowed, and so are the synonyms a small model might reach for...
    on = policy(peers=[], room=True)
    for token in (ROOM_RECIPIENT, "all", "room", "the room", "Chatroom"):
        assert on.check(msg(to=token), ctx()).allowed, token
    # ...but a plain-only (local) bot still may not put links or page text in a room post.
    local = policy(peers=[], room=True, plain_only=True, max_chars=300)
    leak = local.check(msg(to=ROOM_RECIPIENT, text="see https://x.onion/leak"), ctx())
    assert not leak.allowed and "stays on this Mac" in leak.reason


def test_room_reads_as_a_conversation_and_refuses_repeats(cfg, tmp_path: Path):
    """The room shows a rolling transcript and nudges a reply when a colleague posts something new, and
    the policy refuses a bot repeating its own last post (the observed one-sided 'Desk Agent' behaviour)."""
    from explorer.chatroom import Chatroom
    cfg.agent.name = "The CEO"
    cfg.messaging = MessagingConfig(enabled=True, room=True, room_file=str(tmp_path / "chatroom.jsonl"))
    c = make_controller(cfg)
    room = Chatroom(tmp_path / "chatroom.jsonl")
    room.post("Package Designer", "does anyone need a rate for MVP builds?")

    ep = c._ensure_episode()
    obs = c._observe(ep)
    assert any("Package Designer:" in m for m in obs.room_messages)  # transcript, in context
    assert obs.room_reply is True  # a colleague posted something new -> reply nudge

    # The CEO posts; then repeating that exact post is refused.
    ctx_over = {"mode": "web", "current_page": None, "actions_in_episode": 0, "pages_last_hour": 0,
                "open_questions": 0, "last_visit_by_domain": {}, "last_room_post": "Here is our MVP rate."}
    from explorer.policy import PolicyContext
    p = c.policy
    from explorer.actions import Message
    dup = Message(type="message", to="everyone", text="Here is our MVP rate.")
    v = p.check(dup, PolicyContext(**ctx_over))
    assert not v.allowed and "already posted that" in v.reason


def test_scout_and_researcher_personas_write_a_messaging_section(tmp_path: Path):
    scout = fleet.new_bot("Scout", tmp_path / "bots", persona="scout", port=8792)
    text = (scout / "config.toml").read_text()
    assert "[messaging]" in text and "enabled = false" in text and "plain_only" not in text
    assert load_config(scout / "config.toml").messaging.enabled is False

    onion = fleet.new_bot("Onion Reader", tmp_path / "bots", persona="researcher", port=8789)
    otext = (onion / "config.toml").read_text()
    assert "[messaging]" in otext and "plain_only = true" in otext and "max_chars = 300" in otext
    ocfg = load_config(onion / "config.toml")
    assert ocfg.messaging.plain_only is True and ocfg.messaging.max_chars == 300


def test_room_kinds_receipts_and_seen_by(tmp_path):
    """Owner, 2026-09-22: bots only read genuine posts; reports/receipts are for the owner, and 'seen by' is recorded."""
    from explorer.chatroom import Chatroom
    import json

    room = Chatroom(tmp_path / "chatroom.jsonl")
    room.post("Package Designer", "new rate for SPF MVPs: $12.5k")
    room.post("The CEO", "read 1 message from Package Designer", kind="receipt")
    room.post("Lead Gen", "listed lead \"Acme\" on the Leads board", kind="report")
    room.post("Desk Agent", "Hey fleet, I'm free and can help")
    posts = room.since(-1, exclude_sender="Nobody")
    assert [p.kind for p in posts] == ["post", "post"] and [p.sender for p in posts] == ["Package Designer", "Desk Agent"]
    assert [p.kind for p in room.recent()] == ["post", "receipt", "report", "post"]
    room.mark_seen("The CEO", 3)
    seen = json.loads(room.seen_path.read_text())
    assert seen["The CEO"]["last_id"] == 3
    assert room.own_posts("Desk Agent", hours=1) == ["Hey fleet, I'm free and can help"]
    assert room.own_posts("The CEO", today=True) == []  # its receipt is not a post


def test_policy_refuses_restated_room_posts_and_caps_them_per_day():
    from explorer.actions import Message
    from explorer.config import MessagingConfig, PolicyConfig, PublishConfig
    from explorer.policy import Denylist, Policy, PolicyContext

    def ctx(**over):
        base = dict(mode="web", current_page=None, actions_in_episode=0, pages_last_hour=0, open_questions=0, last_visit_by_domain={})
        base.update(over)
        return PolicyContext(**base)

    policy = Policy(PolicyConfig(), PublishConfig(), Denylist(), messaging=MessagingConfig(enabled=True, room=True, max_room_posts_per_day=3))
    offer = "Hey fleet, I'm free and can assist with GUI tasks in Safari, TextEdit, Notes, Finder, or Calculator. Let me know what you need!"
    again = Message(type="message", to="everyone", text="Ready to assist with Safari, TextEdit, Notes, Finder, or Calculator tasks. What can I help with?")
    v = policy.check(again, ctx(own_room_posts_recent=[offer]))
    assert not v.allowed and "restates what you already posted" in v.reason
    fresh = Message(type="message", to="everyone", text="Finished the TextEdit request from The CEO: the note is saved as Meeting notes.txt on the Desktop.")
    assert policy.check(fresh, ctx(own_room_posts_recent=[offer])).allowed
    capped = policy.check(fresh, ctx(own_room_posts_recent=[], room_posts_today=3))
    assert not capped.allowed and "daily cap" in capped.reason


def test_a_task_assigned_to_a_family_member_becomes_its_request(cfg, tmp_path):
    # owner, 2026-09-28: "family should listen to ceoA" (26 CEO tasks for 'Lead Gen' were refused that day)
    import json
    from explorer.actions import Task
    from explorer.notion import FakeNotion
    from explorer.team import Member
    from conftest import make_controller

    peer = tmp_path / "lead-gen"; (peer / "workspace" / "inbox").mkdir(parents=True)
    cfg.messaging.enabled = True
    cfg.messaging.peers = [{"name": "Lead Gen", "folder": str(peer)}]
    cfg.notion.enabled = True
    c = make_controller(cfg, notion=FakeNotion())
    c.team = [Member(name="Jo", notion_id="u1")]
    ep = c.memory.current_episode() or c.memory.db.query("SELECT * FROM episodes ORDER BY id DESC LIMIT 1")
    c.memory.start_episode(None); ep = c.memory.current_episode()
    task = Task(type="task", title="List ten Northside bakeries with an email on their site", details="x" * 320, assignee="Lead Gen", due="2099-10-01")
    ctx = c._policy_context(ep, None)
    assert c.policy.check(task, ctx).allowed
    r = c._execute_task(task, ep)
    assert r.ok and "handed task" in r.summary
    files = list((peer / "workspace" / "inbox").glob("*.json"))
    assert len(files) == 1 and "task for you: List ten Northside bakeries" in json.loads(files[0].read_text())["text"]
    assert c.notion.tasks == []  # nothing on the Notion board


def test_a_claimed_update_needs_a_write_like_done_does():
    from explorer.actions import Message
    from explorer.config import MessagingConfig, PolicyConfig, PublishConfig
    from explorer.policy import Denylist, Policy, PolicyContext
    from conftest import DENYLIST

    m = MessagingConfig(enabled=True, peers=[{"name": "The CEO", "folder": "/tmp/ceo"}])
    policy = Policy(PolicyConfig(), PublishConfig(), Denylist.load(DENYLIST), messaging=m)
    c = PolicyContext(mode="web", current_page=None, actions_in_episode=0, pages_last_hour=0, open_questions=0, last_visit_by_domain={})
    c.priority_request = {"sender": "The CEO", "text": "update the toggle title", "actions_since_read": 3, "writes_since_read": 0}
    v = policy.check(Message(type="message", to="The CEO", text="Updated the Fixed-Price MVP Development package toggle title to include the price."), c)
    assert not v.allowed and "have not done it" in v.reason
    assert policy.check(Message(type="message", to="The CEO", text="could not: publishing toggles is your own publish_package action, not mine"), c).allowed


def test_a_reply_to_a_priority_ask_may_run_long_and_ignores_the_daily_cap():
    from explorer.actions import Message
    from explorer.config import MessagingConfig, PolicyConfig, PublishConfig
    from explorer.policy import Denylist, Policy, PolicyContext
    from conftest import DENYLIST

    m = MessagingConfig(enabled=True, peers=[{"name": "The CEO", "folder": "/tmp/ceo"}], max_chars=600, max_per_day=12)
    policy = Policy(PolicyConfig(), PublishConfig(), Denylist.load(DENYLIST), messaging=m)
    c = PolicyContext(mode="web", current_page=None, actions_in_episode=0, pages_last_hour=0, open_questions=0, last_visit_by_domain={})
    c.messages_today = 12
    c.priority_request = {"sender": "The CEO", "text": "send me the full package record", "actions_since_read": 1, "writes_since_read": 1}
    long_reply = "could not hand it as a file yet; here is the record: " + "price $500/month; deliverables: " * 30
    assert 600 < len(long_reply) < 1500
    assert policy.check(Message(type="message", to="The CEO", text=long_reply), c).allowed
    assert not policy.check(Message(type="message", to="Lead Gen", text="a chat"), c).allowed  # the cap still holds for others


def test_an_ask_that_says_answer_a_colleague_lets_that_message_through():
    # the Validator's FM01: "Answer The CEO with a `message` now" -- the grace rule refused the message to The CEO (2026-09-30)
    from explorer.actions import Message
    from explorer.config import MessagingConfig, PolicyConfig, PublishConfig
    from explorer.policy import Denylist, Policy, PolicyContext
    from conftest import DENYLIST

    m = MessagingConfig(enabled=True, priority_request_grace=4,
                        peers=[{"name": "The CEO", "folder": "/tmp/ceo"}, {"name": "Validator", "folder": "/tmp/v"}, {"name": "Scout", "folder": "/tmp/s"}])
    policy = Policy(PolicyConfig(), PublishConfig(), Denylist.load(DENYLIST), messaging=m)
    c = PolicyContext(mode="web", current_page=None, actions_in_episode=0, pages_last_hour=0, open_questions=0, last_visit_by_domain={})
    c.priority_request = {"sender": "Validator", "actions_since_read": 10, "writes_since_read": 0,
                          "text": "Validator format check: The CEO has waited 23 h. Answer The CEO with a `message` now -- what you did, or why you cannot."}
    assert policy.check(Message(type="message", to="The CEO", text="could not yet: the hunt restarts now from the city list"), c).allowed
    v = policy.check(Message(type="message", to="Scout", text="any directory of bakeries?"), c)
    assert not v.allowed and "Validator is waiting" in v.reason


def test_a_stuck_priority_ask_is_released_after_the_give_up_limit(cfg, tmp_path):
    from conftest import make_controller

    peer = tmp_path / "validator"; (peer / "workspace" / "inbox").mkdir(parents=True)
    cfg.messaging.enabled = True
    cfg.messaging.peers = [{"name": "Validator", "folder": str(peer)}]
    cfg.messaging.priority_senders = ["Validator"]
    cfg.messaging.priority_request_give_up = 3
    c = make_controller(cfg)
    if c.requests is None:
        return  # no shared request log in this test layout
    c.requests.record("ask-1.json", "Validator", cfg.agent.name, "please fix the report named in a file you cannot read")
    c.requests.mark_read(["ask-1.json"])
    eid = c.memory.start_episode(None)
    for i in range(4):
        c.memory.record_action(i, eid, "search", {"type": "search", "query": f"q{i}"}, "", "allowed", "ok", True)
    c._release_stuck_priority_ask()
    assert c.requests.open_for(cfg.agent.name) == []
    assert list((peer / "workspace" / "inbox").glob("*.json"))  # the asker was told "could not"
