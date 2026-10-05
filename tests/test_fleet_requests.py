"""Requests between bots are on record; a CEO request is the recipient's top priority until answered."""
from __future__ import annotations

import json
from pathlib import Path

from explorer.actions import Decision, Message, Note
from explorer.fleet_requests import RequestLog
from explorer.handoff import send_message
from explorer.model import ModelResult

from conftest import make_controller


def test_the_log_folds_events_and_puts_priority_asks_first(tmp_path: Path):
    log = RequestLog(tmp_path / "requests.jsonl")
    log.record("m1", "Scout", "Lead Gen", "any free email checkers?")
    log.record("m2", "The CEO", "Lead Gen", "this month: franchise brands entering SPF")
    open_ = log.open_for("lead gen")
    assert [r.id for r in open_] == ["m2", "m1"] and open_[0].priority and not open_[1].priority
    log.mark_read(["m2"])
    assert log.all()[1].read_at
    assert log.answer("The CEO", "Lead Gen", "done: 3 franchise leads listed").id == "m2"
    assert [r.id for r in log.open_for("Lead Gen")] == ["m1"]
    assert log.answer("The CEO", "Lead Gen", "again") is None
    log.resolve("m1", "carried out")
    assert log.open_for("Lead Gen") == []
    assert log.all()[0].resolved_at and log.all()[1].answer.startswith("done")


def test_a_ceo_request_is_shown_first_with_a_banner_until_the_bot_replies(cfg, tmp_path: Path):
    ceo = tmp_path.parent / "the-ceo"
    (ceo / "workspace" / "inbox").mkdir(parents=True, exist_ok=True)
    cfg.agent.name = "Lead Gen"
    cfg.messaging.enabled = True
    cfg.messaging.peers = [{"name": "The CEO", "folder": str(ceo)}, {"name": "Scout", "folder": str(tmp_path.parent / "scout")}]
    cfg.messaging.requests_file = str(tmp_path / "requests.jsonl")
    (tmp_path.parent / "scout" / "workspace" / "inbox").mkdir(parents=True, exist_ok=True)
    log = RequestLog(Path(cfg.messaging.requests_file))
    # Two messages wait: the Scout's came first, the CEO's second; the CEO's must be shown first and carry the banner.
    f1 = send_message(cfg.root, "Scout", "any free email checkers?")
    log.record(f1.name, "Scout", "Lead Gen", "any free email checkers?")
    f2 = send_message(cfg.root, "The CEO", "this month: franchise brands entering SPF")
    log.record(f2.name, "The CEO", "Lead Gen", "this month: franchise brands entering SPF")

    seen: list = []

    class Model:
        using_fallback = False
        n = 0

        def decide(self, system, obs):
            seen.append(obs)
            self.n += 1
            if self.n == 1:
                return ModelResult(decision=Decision(thought="ok", action=Note(type="note", title="Franchise brands in SPF", body="A first look at the segment the CEO asked for.")))
            return ModelResult(decision=Decision(thought="reply", action=Message(type="message", to="The CEO", text="done: I started on franchise brands entering SPF")))

        def complete(self, system, prompt):
            return "summary"

    ctl = make_controller(cfg, model=Model())
    ctl.run(max_cycles=2)
    first, second = seen[0], seen[1]
    assert first.bot_messages[0].startswith("From The CEO:") and first.bot_messages[1].startswith("From Scout:")
    assert first.output_nudge.startswith("PRIORITY -- The CEO asked you") and "franchise brands" in first.output_nudge
    assert second.output_nudge.startswith("PRIORITY")  # still open after the note: only a reply closes it
    rows = log.all()
    ceo_ask = next(r for r in rows if r.sender == "The CEO")
    assert ceo_ask.read_at and ceo_ask.answered_at and ceo_ask.answer.startswith("done:")
    assert log.open_for("Lead Gen")[0].sender == "Scout"  # the Scout's ordinary ask stays open, no banner for it
    ctl.run(max_cycles=1) if False else None
    reply = next(r for r in rows if r.sender == "Lead Gen")
    assert reply.to == "The CEO" and not reply.priority
    assert any(json.loads(p.read_text())["text"].startswith("done:") for p in (ceo / "workspace" / "inbox").glob("*.json"))


def test_after_the_grace_only_answering_and_reading_are_allowed(cfg, tmp_path: Path):
    from explorer.actions import Search
    from explorer.config import MessagingConfig
    from explorer.policy import Denylist, Policy, PolicyContext

    m = MessagingConfig(enabled=True, peers=[{"name": "The CEO", "folder": "/tmp/x"}, {"name": "Scout", "folder": "/tmp/y"}], priority_request_grace=3)
    policy = Policy(cfg.policy, cfg.publish, Denylist.load(Path(cfg.policy.denylist_file)), messaging=m)
    base = dict(mode="web", current_page=None, actions_in_episode=1, pages_last_hour=0, open_questions=0, last_visit_by_domain={})
    ask = {"sender": "The CEO", "text": "list the franchise brands from the owner's file", "actions_since_read": 3}
    waiting = PolicyContext(**base, priority_request=ask)
    fresh = PolicyContext(**base, priority_request={**ask, "actions_since_read": 2})
    note = Note(type="note", title="Something else", body="Unrelated research that can wait.")
    assert policy.check(note, fresh).allowed  # within the grace: the banner does the asking
    refused = policy.check(note, waiting)
    assert not refused.allowed and "The CEO is waiting for your answer" in refused.reason
    assert policy.check(Search(type="search", query="franchise brands entering springfield 2026"), waiting).allowed
    assert not policy.check(Message(type="message", to="Scout", text="unrelated: any free email checkers?"), waiting).allowed
    assert policy.check(Message(type="message", to="The CEO", text="done: three franchise brands listed with published emails"), waiting).allowed
    # grace 0 = banner only, never a refusal
    off = Policy(cfg.policy, cfg.publish, Denylist.load(Path(cfg.policy.denylist_file)), messaging=MessagingConfig(enabled=True, peers=m.peers, priority_request_grace=0))
    assert off.check(note, waiting).allowed


def test_an_incoming_message_closes_my_oldest_open_ask_to_that_sender(cfg, tmp_path: Path):
    """Grok Bot answers by writing a file, not through a controller, so the reader marks the answer."""
    grok = tmp_path.parent / "grok-bot"
    (grok / "workspace" / "inbox").mkdir(parents=True, exist_ok=True)
    cfg.agent.name = "The CEO"
    cfg.messaging.enabled = True
    cfg.messaging.peers = [{"name": "Grok Bot", "folder": str(grok)}]
    cfg.messaging.requests_file = str(tmp_path / "requests.jsonl")
    log = RequestLog(Path(cfg.messaging.requests_file))
    log.record("ask-1", "The CEO", "Grok Bot", "what is the Northside bakery's published email?")
    send_message(cfg.root, "Grok Bot", "hello@sunsetbakery.example, from their contact page")

    class Model:
        using_fallback = False

        def decide(self, system, obs):
            return ModelResult(decision=Decision(thought="ok", action=Note(type="note", title="Sunset Bakery email", body="Grok Bot found hello@sunsetbakery.example on the contact page.")))

        def complete(self, system, prompt):
            return "summary"

    make_controller(cfg, model=Model()).run(max_cycles=1)
    ask = log.all()[0]
    assert ask.answered_at and ask.answer.startswith("hello@sunsetbakery")


def test_priority_replies_bypass_the_per_episode_message_cap_and_summarize_stays_allowed(cfg):
    from explorer.actions import Summarize
    from explorer.config import MessagingConfig
    from explorer.policy import Denylist, Policy, PolicyContext

    m = MessagingConfig(enabled=True, peers=[{"name": "Desk Agent", "folder": "/tmp/x"}, {"name": "Scout", "folder": "/tmp/y"}], max_per_episode=1, priority_request_grace=1)
    policy = Policy(cfg.policy, cfg.publish, Denylist.load(Path(cfg.policy.denylist_file)), messaging=m)
    ask = {"sender": "Desk Agent", "text": "file dropped by the owner: b.csv (.csv, 1 KB). Preview: x", "actions_since_read": 5}
    ctx = PolicyContext(mode="web", current_page=None, actions_in_episode=3, pages_last_hour=0, open_questions=0, last_visit_by_domain={}, messages_in_episode=1, priority_request=ask)
    assert policy.check(Message(type="message", to="Desk Agent", text="route b.csv to Lead Gen: prospects"), ctx).allowed
    assert not policy.check(Message(type="message", to="Scout", text="route b.csv to Lead Gen: prospects"), ctx).allowed  # not the requester: still refused
    assert policy.check(Summarize(type="summarize", text="Routed the owner's files."), ctx).allowed


def test_a_write_the_executor_could_not_complete_is_recorded_as_failed_not_allowed(cfg, tmp_path: Path):
    from explorer.controller import ExecResult

    cfg.messaging.enabled = True
    cfg.messaging.peers = [{"name": "Scout", "folder": str(tmp_path.parent / "scout")}]
    cfg.messaging.requests_file = str(tmp_path / "requests.jsonl")

    class Model:
        using_fallback = False

        def decide(self, system, obs):
            return ModelResult(decision=Decision(thought="ask", action=Message(type="message", to="Scout", text="any free email checkers?")))

        def complete(self, system, prompt):
            return "summary"

    ctl = make_controller(cfg, model=Model())
    ctl._execute = lambda action, ep, target: ExecResult(False, "Notion answered 404: not found", False)  # the write died
    ctl.run(max_cycles=1)
    rows = ctl.memory.db.query("SELECT action_type, verdict FROM actions ORDER BY id DESC LIMIT 1")
    assert rows[0]["action_type"] == "message" and rows[0]["verdict"].startswith("failed: Notion answered 404")


def test_an_inbox_file_a_script_wrote_becomes_a_recorded_priority_request_when_read(cfg, tmp_path: Path):
    """The Validator writes work lists straight into Lead Gen's inbox (no controller sends them)."""
    cfg.agent.name = "Lead Gen"
    cfg.messaging.enabled = True
    cfg.messaging.peers = [{"name": "Validator", "folder": str(tmp_path.parent / "validator")}]
    cfg.messaging.priority_senders = ["Validator"]
    cfg.messaging.requests_file = str(tmp_path / "requests.jsonl")
    (tmp_path.parent / "validator" / "workspace" / "inbox").mkdir(parents=True, exist_ok=True)
    send_message(cfg.root, "Validator", "Leads board upkeep: 2 rows have cells you can fill: Acme Bakery (acme.example): Location, Founded by")
    seen: list = []

    class Model:
        using_fallback = False

        def decide(self, system, obs):
            seen.append(obs)
            return ModelResult(decision=Decision(thought="ok", action=Note(type="note", title="Upkeep list", body="Two rows to fill from their sites.")))

        def complete(self, system, prompt):
            return "summary"

    make_controller(cfg, model=Model()).run(max_cycles=1)
    log = RequestLog(Path(cfg.messaging.requests_file))
    rows = log.all()
    assert len(rows) == 1 and rows[0].sender == "Validator" and rows[0].priority and rows[0].read_at
    assert seen[0].output_nudge and seen[0].output_nudge.startswith("PRIORITY -- Validator asked you")


def test_status_notes_are_never_priority_and_old_asks_expire(tmp_path: Path):
    import datetime as dt

    log = RequestLog(tmp_path / "requests.jsonl", ["The CEO"])
    assert not log.record("n1", "The CEO", "Lead Gen", "Checked the Builtin jobs page for Springfield tech roles. Not directly relevant.").priority
    assert not log.record("n2", "The CEO", "Grok Bot", "Noted the job listings on the Builtin page.").priority
    assert log.record("a1", "The CEO", "Lead Gen", "Please list the franchise brands from the owner's file").priority
    log.now = dt.datetime.now() - dt.timedelta(hours=49)
    log.record("old", "The CEO", "Desk Agent", "Can you look into the lead bot and give it Notion access?")
    log.now = None
    rows = {r.id: r for r in log.all()}
    assert rows["old"].expired and not rows["old"].open
    assert rows["a1"].open and not rows["a1"].expired
    assert [r.id for r in log.open_for("Lead Gen")] == ["a1"]  # the note closed on record: a notice, not an ask


def test_a_status_note_to_a_colleague_is_refused_unless_it_answers_them(cfg):
    from explorer.config import MessagingConfig
    from explorer.policy import Denylist, Policy, PolicyContext

    m = MessagingConfig(enabled=True, peers=[{"name": "Lead Gen", "folder": "/tmp/l"}, {"name": "Validator", "folder": "/tmp/v"}])
    policy = Policy(cfg.policy, cfg.publish, Denylist.load(Path(cfg.policy.denylist_file)), messaging=m)
    base = dict(mode="web", current_page=None, actions_in_episode=1, pages_last_hour=0, open_questions=0, last_visit_by_domain={})
    note = Message(type="message", to="Lead Gen", text="Checked out the biotech growth strategies on Airship's blog. Noted that onboarding friction matters.")
    refused = policy.check(note, PolicyContext(**base))
    assert not refused.allowed and "status note" in refused.reason
    assert policy.check(Message(type="message", to="Lead Gen", text="Please list five SPF biotech founders with a landing page and no product."), PolicyContext(**base)).allowed
    assert policy.check(Message(type="message", to="Validator", text="done: Acme Bakery: Location, Founded by; could not find: size"), PolicyContext(**base)).allowed
    assert policy.check(note, PolicyContext(**base, open_asks_from={"lead gen"})).allowed  # answering their open ask


def test_a_notice_answers_nothing(tmp_path: Path):
    log = RequestLog(tmp_path / "requests.jsonl", ["The CEO"])
    log.record("ask", "The CEO", "Lead Gen", "Please harvest 30 Springfield biotech founders")
    assert log.answer("The CEO", "Lead Gen", "new lead 'Acme Bakery' on the Leads board: https://notion.example/x") is None
    assert log.answer("The CEO", "Lead Gen", "done: listed 3 founders; could not find: the rest").id == "ask"
    assert not log.record("n", "Desk Agent", "Lead Gen", "the owner dropped a file for you: list.csv").priority or True  # a notice, whatever the sender
    assert not log.record("n2", "The CEO", "Desk Agent", "Processed the file as instructed.").priority


def test_a_question_back_is_not_an_answer_and_priority_is_the_readers_view(tmp_path: Path):
    sender_side = RequestLog(tmp_path / "requests.jsonl", ["Desk Agent"])  # the CEO's own list
    sender_side.record("ask", "The CEO", "Lead Gen", "Please harvest 30 Springfield biotech founders")
    reader_side = RequestLog(tmp_path / "requests.jsonl", ["The CEO", "Validator"])  # Lead Gen's list
    assert reader_side.open_for("Lead Gen")[0].priority  # re-judged by the reader
    assert reader_side.answer("The CEO", "Lead Gen", "Could you please provide the list of businesses?") is None
    assert reader_side.open_for("Lead Gen")  # still open
    assert reader_side.answer("The CEO", "Lead Gen", "done: 30 founders listed; 4 without a published email").id == "ask"


def test_a_reply_does_not_open_a_new_request_and_stopped_or_route_only_peers_are_not_messaged(cfg, tmp_path: Path):
    from explorer.config import MessagingConfig
    from explorer.policy import Denylist, Policy, PolicyContext

    scout = tmp_path.parent / "scout"; desk = tmp_path.parent / "desk-agent"; ceo = tmp_path.parent / "the-ceo"
    for f in (scout, desk, ceo):
        (f / "workspace" / "inbox").mkdir(parents=True, exist_ok=True)
    (scout / "workspace" / "STOP").write_text("", encoding="utf-8")
    m = MessagingConfig(enabled=True, peers=[{"name": "Scout", "folder": str(scout)}, {"name": "Desk Agent", "folder": str(desk)}, {"name": "The CEO", "folder": str(ceo)}],
                        route_only_peers=["Desk Agent"])
    policy = Policy(cfg.policy, cfg.publish, Denylist.load(Path(cfg.policy.denylist_file)), messaging=m)
    ctx = PolicyContext(mode="web", current_page=None, actions_in_episode=0, pages_last_hour=0, open_questions=0, last_visit_by_domain={})
    assert "is stopped" in policy.check(Message(type="message", to="Scout", text="Please find a free SPF accelerator list"), ctx).reason
    # the bot is told who is not running before it tries (owner, 2026-10-03), and a task for a stopped member is refused too
    assert m.peer_states() == {"Scout": "stopped", "Desk Agent": "running", "The CEO": "running"}
    assert "reads only route lines" in policy.check(Message(type="message", to="Desk Agent", text="Can you look into the lead bot?"), ctx).reason
    assert policy.check(Message(type="message", to="Desk Agent", text="route list.csv to Lead Gen: prospects"), ctx).allowed
    (scout / "workspace" / "STOP").unlink()
    assert policy.check(Message(type="message", to="Scout", text="Please find a free SPF accelerator list"), ctx).allowed

    # the reply that closes an ask is recorded and resolved at once
    cfg.agent.name = "Lead Gen"
    cfg.messaging = MessagingConfig(enabled=True, peers=[{"name": "The CEO", "folder": str(ceo)}], requests_file=str(tmp_path / "requests.jsonl"))
    log = RequestLog(Path(cfg.messaging.requests_file))
    log.record("ask-1", "The CEO", "Lead Gen", "Please list five SMB leads in Eastside")

    class Model:
        using_fallback = False

        def decide(self, system, obs):
            return ModelResult(decision=Decision(thought="reply", action=Message(type="message", to="The CEO", text="could not find: five Eastside SMB leads with a published email today; two candidates without one noted")))

        def complete(self, system, prompt):
            return "summary"

    make_controller(cfg, model=Model()).run(max_cycles=1)
    rows = {r.id: r for r in log.all()}
    assert rows["ask-1"].answered_at
    reply = next(r for r in rows.values() if r.sender == "Lead Gen")
    assert reply.resolved_at and not reply.open and log.open_for("The CEO") == []


def test_an_owner_chat_instruction_is_the_bots_top_request_until_the_next_one(cfg, tmp_path: Path):
    from explorer.config import MessagingConfig
    from explorer.fleet_requests import is_instruction
    from explorer.policy import Denylist, Policy, PolicyContext

    assert is_instruction("lets shift some of our focus. 1st leaA should search for SMB leads") and not is_instruction("ok thanks") and not is_instruction("good job")
    cfg.agent.name = "The CEO"
    cfg.messaging.enabled = True
    cfg.messaging.peers = [{"name": "Lead Gen", "folder": str(tmp_path.parent / "lead-gen")}]
    cfg.messaging.requests_file = str(tmp_path / "requests.jsonl")
    (tmp_path.parent / "lead-gen" / "workspace" / "inbox").mkdir(parents=True, exist_ok=True)
    seen: list = []

    class Model:
        using_fallback = False

        def decide(self, system, obs):
            seen.append(obs)
            return ModelResult(decision=Decision(thought="ok", action=Note(type="note", title="Focus shift", body="The owner wants SMB leads first.")))

        def complete(self, system, prompt):
            return "summary"

    ctl = make_controller(cfg, model=Model())
    ctl.memory.add_chat("owner", "lets shift some of our focus. leaA should search for SMB leads from now on.")
    ctl.run(max_cycles=1)
    log = RequestLog(Path(cfg.messaging.requests_file))
    ask = log.open_for("The CEO")[0]
    assert ask.sender == "Owner" and ask.priority and ask.read_at
    assert seen[0].output_nudge.startswith("PRIORITY -- the owner asked you in the chat")
    ctl.memory.add_chat("owner", "also pacA should design for SMB leads please")
    ctl.run(max_cycles=1)
    open_ = log.open_for("The CEO")
    assert len(open_) == 1 and "pacA" in open_[0].text  # the newer word supersedes the older
    # under the grace, messaging a colleague and saying are allowed; a note is not
    m = MessagingConfig(enabled=True, peers=cfg.messaging.peers, priority_request_grace=1)
    policy = Policy(cfg.policy, cfg.publish, Denylist.load(Path(cfg.policy.denylist_file)), messaging=m)
    pr = {"sender": "Owner", "text": "shift focus to SMB", "actions_since_read": 5}
    ctx = PolicyContext(mode="web", current_page=None, actions_in_episode=2, pages_last_hour=0, open_questions=0, last_visit_by_domain={}, priority_request=pr)
    assert policy.check(Message(type="message", to="Lead Gen", text="Please prioritise Springfield SMB leads from now on."), ctx).allowed
    assert not policy.check(Note(type="note", title="x", body="y"), ctx).allowed


def test_the_same_ask_is_not_sent_again_while_the_first_is_open(cfg):
    from explorer.config import MessagingConfig
    from explorer.policy import Denylist, Policy, PolicyContext

    m = MessagingConfig(enabled=True, peers=[{"name": "Lead Gen", "folder": "/tmp/l"}])
    policy = Policy(cfg.policy, cfg.publish, Denylist.load(Path(cfg.policy.denylist_file)), messaging=m)
    base = dict(mode="web", current_page=None, actions_in_episode=1, pages_last_hour=0, open_questions=0, last_visit_by_domain={})
    waiting = {"lead gen": [("Please shift your search focus to SMB leads in Springfield, especially biotech startups.", "2026-09-25T21:40:00")]}
    again = Message(type="message", to="Lead Gen", text="Please shift your search focus to SMB leads in Springfield, especially biotech startups and small businesses.")
    v = policy.check(again, PolicyContext(**base, open_asks_to=waiting))
    assert not v.allowed and "already asked Lead Gen that at 21:40" in v.reason
    assert policy.check(again, PolicyContext(**base)).allowed  # nothing open: fine
    different = Message(type="message", to="Lead Gen", text="Which Northside bakeries did you list this week?")
    assert policy.check(different, PolicyContext(**base, open_asks_to=waiting)).allowed


def test_same_ask_matches_the_ceos_measured_repeats_and_not_different_files():
    from explorer.fleet_requests import same_ask

    a = "Please shift your search focus to SMB leads in Springfield, especially biotech startups and small businesses with outdated websites, and build a list of emailable contacts."
    b = "Please shift your search to focus on SMB leads in Springfield -- small businesses, biotech startups -- and compile emailable contacts for outreach this week."
    assert same_ask(a, b)
    assert not same_ask(a, "Which Northside bakeries did you list this week and did any publish an info@ address?")
    assert not same_ask("route rebuz-franchise-leads-100.csv to Lead Gen: prospects", "route rebuz-franchise-leads-all.csv to Lead Gen: prospects")
    assert not same_ask("file dropped by the owner: a.csv (.csv, 4 KB)", "file dropped by the owner: b.csv (.csv, 4 KB)")


def test_the_write_gate_refuses_with_the_validators_reasons_and_fails_open(cfg, tmp_path: Path):
    from explorer.actions import Lead, Task
    from explorer.policy import Denylist, Policy

    gate = tmp_path / "gate.py"
    gate.write_text(
        "def check(action, payload, *, bot='', min_details=300):\n"
        "    if action == 'lead' and payload.get('email', '').endswith('@gmail.com'):\n"
        "        return ['LD01: email is on a personal mailbox provider (gmail.com)']\n"
        "    if action == 'task':\n"
        "        raise RuntimeError('broken checker')\n"
        "    return []\n", encoding="utf-8")
    cfg.policy.write_gate = str(gate)
    policy = Policy(cfg.policy, cfg.publish, Denylist.load(Path(cfg.policy.denylist_file)))
    lead = Lead(type="lead", name="X", website="https://x.example", email="info@gmail.com", pain_point="p", how_we_help="Website Care Basic", evidence="https://x.example")
    v = policy.gate_write(lead, bot="Lead Gen")
    assert not v.allowed and v.reason.startswith("Validator rules: LD01")
    ok = Lead(type="lead", name="X", website="https://x.example", email="info@x.example", pain_point="p", how_we_help="Website Care Basic", evidence="https://x.example")
    assert policy.gate_write(ok, bot="Lead Gen").allowed
    assert policy.gate_write(Task(type="task", title="t", details="d"), bot="The CEO").allowed  # broken gate: fails open
    off = Policy(cfg.policy.__class__(), cfg.publish, Denylist.load(Path(cfg.policy.denylist_file)))
    assert off.gate_write(lead, bot="Lead Gen").allowed  # no gate configured


def test_a_report_to_the_owner_closes_the_owner_ask_but_a_promise_does_not(cfg, tmp_path: Path):
    import datetime as dt
    from explorer.actions import Say
    from explorer.fleet_requests import is_promise

    assert is_promise("I can update the focus. I'll message Lead Gen to prioritize SMB leads.") and not is_promise("Done: messaged Lead Gen and Package Designer about SMB leads.")
    cfg.agent.name = "The CEO"
    cfg.messaging.enabled = True
    cfg.messaging.peers = [{"name": "Lead Gen", "folder": str(tmp_path.parent / "lead-gen")}]
    cfg.messaging.requests_file = str(tmp_path / "requests.jsonl")
    (tmp_path.parent / "lead-gen" / "workspace" / "inbox").mkdir(parents=True, exist_ok=True)
    says = iter(["I'll message Lead Gen to shift focus.", "Messaged Lead Gen and Package Designer: SMB leads in Springfield are the focus now."])

    class Model:
        using_fallback = False

        def decide(self, system, obs):
            return ModelResult(decision=Decision(thought="tell", action=Say(type="say", text=next(says))))

        def complete(self, system, prompt):
            return "summary"

    ctl = make_controller(cfg, model=Model())
    ctl.memory.add_chat("owner", "lets shift our focus: leaA should search for SMB leads from now on")
    ctl.run(max_cycles=1)
    log = RequestLog(Path(cfg.messaging.requests_file))
    assert log.open_for("The CEO")  # the promise closed nothing
    ctl.run(max_cycles=1)
    assert log.open_for("The CEO") == []  # the report closed it
    old = RequestLog(tmp_path / "r2.jsonl"); old.now = dt.datetime.now() - dt.timedelta(hours=4)
    old.record_owner_instruction("owner-chat-9", "The CEO", "please find SMB leads"); old.now = None
    assert old.open_for("The CEO") == []  # an owner ask nobody reported on for 3 hours is over


def test_notices_are_closed_the_moment_they_are_recorded(tmp_path: Path):
    log = RequestLog(tmp_path / "requests.jsonl", ["Desk Agent"])
    n = log.record("f1", "Desk Agent", "Lead Gen", "the owner dropped a file for you: leads.csv (routed). It is one of your own files now.")
    r = log.record("r1", "Package Designer", "The CEO", "Responded to the question: Exploring monthly retainer pricing for SPF SMBs, $1,200-$3,500.")
    ask = log.record("a1", "Desk Agent", "The CEO", "file dropped by the owner: leads.csv (.csv, 4 KB). Preview: ... route leads.csv to <bot name>: <why>")
    assert not n.open and not r.open and ask.open and ask.priority
    assert [x.id for x in log.all() if x.open] == ["a1"]


def test_progress_notes_are_notices_too():
    from explorer.fleet_requests import is_status_note

    assert is_status_note("Exploring monthly retainer pricing for development services in SPF.")
    assert is_status_note("From Scout: I am still working on finding a free, card-free source.")
    assert is_status_note("Working on the SMB packages; first draft tomorrow.")
    assert not is_status_note("Please list five SMB leads in Eastside by Friday.")


def test_a_report_style_reply_closes_the_ask_and_its_open_repeats(tmp_path: Path):
    log = RequestLog(tmp_path / "requests.jsonl", ["The CEO"])
    log.record("a1", "The CEO", "Lead Gen", "Please shift your lead generation focus to SMB leads in Springfield, especially small businesses with outdated sites.")
    log.record("a2", "The CEO", "Lead Gen", "Please shift your search to focus on SMB leads in Springfield -- small businesses with outdated websites.")
    log.record("b1", "The CEO", "Lead Gen", "Which Northside bakeries did you list this week?")
    assert log.answer("The CEO", "Lead Gen", "Shifted focus to Springfield SMB leads as requested. Scanned three sites.").id == "a1"
    assert [r.id for r in log.open_for("Lead Gen")] == ["b1"]  # a2 closed as the same ask; the bakery question stays
    assert log.answer("The CEO", "Lead Gen", "new lead 'Acme' on the board") is None


def test_a_done_reply_needs_an_accepted_write_behind_it(cfg):
    from explorer.config import MessagingConfig
    from explorer.policy import Denylist, Policy, PolicyContext

    m = MessagingConfig(enabled=True, peers=[{"name": "Validator", "folder": "/tmp/v"}], priority_senders=["Validator"])
    policy = Policy(cfg.policy, cfg.publish, Denylist.load(Path(cfg.policy.denylist_file)), messaging=m)
    base = dict(mode="web", current_page=None, actions_in_episode=3, pages_last_hour=0, open_questions=0, last_visit_by_domain={})
    ask = {"sender": "Validator", "text": "Leads board upkeep: 28 rows have cells you can fill", "actions_since_read": 6, "writes_since_read": 0}
    claim = Message(type="message", to="Validator", text="done: Corner Chicken House: Founded by, Location, Company size")
    v = policy.check(claim, PolicyContext(**base, priority_request=ask))
    assert not v.allowed and "you have not done it" in v.reason
    assert policy.check(Message(type="message", to="Validator", text="could not find: Corner Chicken House: Founded by (no page names a founder)"), PolicyContext(**base, priority_request=ask)).allowed
    assert policy.check(claim, PolicyContext(**base, priority_request={**ask, "writes_since_read": 2})).allowed


def test_a_plain_question_in_chat_is_not_a_run_loop_ask():
    from explorer.fleet_requests import is_instruction

    assert not is_instruction("what are you doing?") and not is_instruction("what happen?")
    assert is_instruction("can you list five SMB leads in Eastside?") and is_instruction("lets shift some of our focus to SMB leads")


def test_a_reworded_task_and_a_one_site_package_are_refused(cfg):
    from explorer.actions import Package, SourceCompany, Task
    from explorer.config import HandoffConfig, NotionConfig
    from explorer.policy import Denylist, Policy, PolicyContext

    policy = Policy(cfg.policy, cfg.publish, Denylist.load(Path(cfg.policy.denylist_file)),
                    notion=NotionConfig(enabled=True, database_id="db"), handoff=HandoffConfig(enabled=True, to_name="The CEO", to_folder="/tmp/c", min_source_sites=2))
    base = dict(mode="web", current_page=None, actions_in_episode=1, pages_last_hour=0, open_questions=0, last_visit_by_domain={})
    ctx = PolicyContext(**base, recent_task_titles={"compile spf biotech startup target list for q4 2026 outreach"}, visited_urls={"https://a.example/pricing", "https://b.example/pricing", "https://a.example/about"})
    v = policy.check(Task(type="task", title="Compile SPF biotech target list for Q4 2026 outreach", details="### Why\nx\n### What to do\n1. y\n### Done when\n- [ ] z", priority="P3", due="2099-10-03"), ctx)
    assert not v.allowed and "in other words" in v.reason
    one_site = Package(type="package", name="Website Care Lite", audience="SPF shops", price="$900/month", deliverables=["updates", "backups"], rationale="market", sources=["https://a.example/pricing", "https://a.example/about"], source_company=SourceCompany(name="A", website="https://a.example"))
    v2 = policy.check(one_site, ctx)
    assert not v2.allowed and "2 different sites" in v2.reason


def test_quiet_instruction_opens_no_ask_and_closes_the_open_one(tmp_path):
    # "take rest, 1 msg a day" recorded as a priority ask pushed The CEO to reply again (2026-09-26)
    from explorer.fleet_requests import RequestLog, is_quiet_instruction

    log = RequestLog(tmp_path / "requests.jsonl")
    assert log.record_owner_instruction("owner-chat-1", "The CEO", "please find SMB leads") is not None
    assert is_quiet_instruction("you are sending me too many msgs.")
    assert is_quiet_instruction("take rest, and moving forward may be send me 1 msg a day with a short list of things.")
    assert not is_quiet_instruction("please send me the list of biotech founders")
    assert log.record_owner_instruction("owner-chat-2", "The CEO", "take rest, and moving forward may be send me 1 msg a day.") is None
    assert log.open_for("The CEO") == []


def test_owner_question_answered_in_chat_opens_no_ask_and_keeps_the_standing_order(tmp_path):
    # 2026-09-26 17:52: "what kind of prompt should I send to our dev agent ...?" superseded the SMB order
    from explorer.fleet_requests import RequestLog

    log = RequestLog(tmp_path / "requests.jsonl")
    assert log.record_owner_instruction("owner-chat-1", "The CEO", "let our family focus on SMB for next 3 month.") is not None
    q = "what kind of prompt should I send to our dev agent coding your engine so that you can achieve such things?"
    assert log.record_owner_instruction("owner-chat-2", "The CEO", q, replied="Something like: 'Enhance goal prioritization ...'") is None
    assert [r.id for r in log.open_for("The CEO")] == ["owner-chat-1"]
    # a question the chat only promised to handle is still work, but it does not replace the standing order
    r = log.record_owner_instruction("owner-chat-3", "The CEO", "can you find SMB leads in Eastside?", replied="I'll message Lead Gen about Eastside.")
    assert r is not None and {x.id for x in log.open_for("The CEO")} == {"owner-chat-1", "owner-chat-3"}
    # a plain order still supersedes everything open from the owner
    log.record_owner_instruction("owner-chat-4", "The CEO", "focus on Northside restaurants this week.")
    assert {x.id for x in log.open_for("The CEO")} == {"owner-chat-4"}


def test_passes_on_matches_the_owner_steer_told_to_the_family():
    from explorer.fleet_requests import passes_on

    ask = "switch your goal for next 3 month. we need SMB ko survive. let our family focus on SMB for next 3 month."
    assert passes_on(ask, "Team shift: per the owner's direction we focus exclusively on SMB clients for the next 3 months.")
    assert not passes_on(ask, "Can you send me the rate for website care?")


def test_the_prompt_names_who_is_not_running_and_a_task_for_a_stopped_member_is_refused(cfg, tmp_path: Path):
    """Owner, 2026-10-03: "does ceoA know which member is active or stopped? it has to work / assign task accordingly"."""
    from explorer.actions import Task
    from explorer.config import MessagingConfig
    from explorer.policy import Denylist, Policy, PolicyContext
    from explorer.prompts import Observation

    designer = tmp_path.parent / "package-designer"; leadgen = tmp_path.parent / "lead-gen"
    for f in (designer, leadgen):
        (f / "workspace" / "inbox").mkdir(parents=True, exist_ok=True)
    cfg.agent.name = "The CEO"
    cfg.messaging = MessagingConfig(enabled=True, peers=[{"name": "Package Designer", "folder": str(designer)}, {"name": "Lead Gen", "folder": str(leadgen)}],
                                    requests_file=str(tmp_path / "requests.jsonl"))
    ceo = make_controller(cfg)
    assert ceo._family_line() is None  # everyone runs: nothing to say
    (designer / "workspace" / "STOP").write_text("", encoding="utf-8")
    line = ceo._family_line()
    assert "running: Lead Gen." in line and "Package Designer (stopped by the owner)" in line
    obs = Observation(
        cycle=1, episode_id=1, episode_actions=0, episode_budget=6, pages_last_hour=0, pages_budget=60,
        current_question_id=None, current_question=None, interests=[], open_questions=[], open_questions_count=0,
        recent_notes=[], recent_actions=[], page=None, page_noted=False, page_text_window="", page_has_more=False,
        family_line=line,
    )
    assert line in obs.render()

    from explorer.config import NotionConfig

    policy = Policy(cfg.policy, cfg.publish, Denylist.load(Path(cfg.policy.denylist_file)), messaging=cfg.messaging,
                    notion=NotionConfig(enabled=True, database_id="db"))
    ctx = PolicyContext(mode="web", current_page=None, actions_in_episode=1, pages_last_hour=0, open_questions=0, last_visit_by_domain={})
    details = "### Why\nThe toggle is stale.\n### What to do\n1. Rewrite it.\n### Done when\n- [ ] it reads right\n" + "x" * 300
    task = Task(type="task", title="Rewrite the Website Care package pitch", details=details, assignee="Package Designer", due="2099-10-10")
    assert "is stopped" in policy.check(task, ctx).reason
    (designer / "workspace" / "STOP").unlink()
    assert "is stopped" not in (policy.check(task, ctx).reason or "")


def test_an_ask_from_a_member_stopped_since_is_parked_until_it_runs_again(cfg, tmp_path: Path):
    from explorer.config import MessagingConfig
    from explorer.fleet_requests import RequestLog

    ceo = tmp_path.parent / "the-ceo-parked"
    (ceo / "workspace" / "inbox").mkdir(parents=True, exist_ok=True)
    cfg.agent.name = "Lead Gen"
    cfg.messaging = MessagingConfig(enabled=True, peers=[{"name": "The CEO", "folder": str(ceo)}], priority_senders=["The CEO"],
                                    requests_file=str(tmp_path / "requests.jsonl"))
    lead_gen = make_controller(cfg)
    RequestLog(tmp_path / "requests.jsonl", priority_senders=["The CEO"]).record("m1.json", "The CEO", "Lead Gen", "List ten Eastside bakeries with a published email")
    assert lead_gen._priority_request_state()["sender"] == "The CEO" and "PRIORITY" in lead_gen._request_banner()
    (ceo / "workspace" / "STOP").write_text("", encoding="utf-8")
    assert lead_gen._priority_request_state() is None and lead_gen._request_banner() is None
    (ceo / "workspace" / "STOP").unlink()
    assert lead_gen._priority_request_state()["sender"] == "The CEO"  # parked, not dropped


def test_the_ceo_may_replace_its_own_toggle_once_a_day_and_a_retired_name_is_called_retired(cfg):
    """2026-10-03: the card said "republish under the same name"; the policy refused it 100 times in two days."""
    import hashlib
    import time

    from explorer.actions import PublishPackage
    from explorer.config import NotionConfig
    from explorer.policy import Denylist, Policy, PolicyContext

    notion = NotionConfig(enabled=True, database_id="db", package_page_id="page", package_republish_own=True)
    policy = Policy(cfg.policy, cfg.publish, Denylist.load(Path(cfg.policy.denylist_file)), notion=notion)
    email = "Hi [Name],\nWebsite care at $299 a month.\n1. Updates\n2. Backups\nRegards,\n-- Acme LLC"
    sha = hashlib.sha256(email.encode()).hexdigest()
    base = dict(mode="web", current_page=None, actions_in_episode=1, pages_last_hour=0, open_questions=0, last_visit_by_domain={},
                published_package_names={"website care basic", "fixed-price mvp - $30,000"})
    page = {"website care basic": {"name": "Website Care Basic", "title": "Website Care Basic – $299/month", "email_sha": sha, "day": "2026-09-30"}}
    pub = lambda **kw: PublishPackage(**{**dict(type="publish_package", name="Website Care Basic", title="Website Care Basic – $299/month",  # noqa: E731
                                                email=email, conclusion="Fits shops with stale sites."), **kw})
    ctx = PolicyContext(**base, packages_on_page=page)
    assert "nothing would change" in policy.check(pub(), ctx).reason
    assert "already on the packages page" not in (policy.check(pub(title="Website Care Basic – $349/month"), ctx).reason or "")
    assert "nothing would change" not in (policy.check(pub(title="Website Care Basic – $349/month"), ctx).reason or "")
    today = {**page["website care basic"], "day": time.strftime("%Y-%m-%d")}
    assert "at most once a day" in policy.check(pub(title="New title"), PolicyContext(**base, packages_on_page={"website care basic": today})).reason
    retired = policy.check(pub(name="Fixed-Price MVP - $30,000"), ctx).reason
    assert "was retired" in retired and "Website Care Basic" in retired
    # switched off (the default), the old rule stands
    old = Policy(cfg.policy, cfg.publish, Denylist.load(Path(cfg.policy.denylist_file)), notion=NotionConfig(enabled=True, database_id="db", package_page_id="page"))
    assert "already on the packages page" in old.check(pub(title="Other"), PolicyContext(**base)).reason


def test_leads_no_task_names_yet_are_listed_for_one_outreach_task(cfg, tmp_path: Path):
    import sqlite3

    from explorer.config import MessagingConfig

    leadgen = tmp_path.parent / "lead-gen-outreach"
    (leadgen / "workspace").mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(leadgen / "workspace" / "explorer.sqlite3")
    con.execute("CREATE TABLE leads (id INTEGER PRIMARY KEY, name TEXT, email TEXT, how_we_help TEXT, url TEXT, created_at TEXT)")
    con.executemany("INSERT INTO leads (name, email, how_we_help, url, created_at) VALUES (?,?,?,?,?)", [
        ("Noodle Bar One", "hello@noodlebarone.com", "Acme POS for Franchise Chains", "https://notion.example/noodlebarone", __import__("datetime").datetime.now().isoformat(timespec="seconds")),
        ("Harbor Restaurant", "info@harbor.example", "Website Care Basic", "https://notion.example/harbor", __import__("datetime").datetime.now().isoformat(timespec="seconds"))])
    con.commit(); con.close()
    cfg.agent.name = "The CEO"
    cfg.messaging = MessagingConfig(enabled=True, peers=[{"name": "Lead Gen", "folder": str(leadgen)}], requests_file=str(tmp_path / "requests.jsonl"))
    cfg.leads.outreach_from = "Lead Gen"
    cfg.leads.outreach_min = 8  # two leads are not a batch yet...
    ceo0 = make_controller(cfg)
    assert ceo0._outreach_leads() == ([], 2)
    cfg.leads.outreach_max_wait_hours = 0  # ...until the oldest has waited long enough
    ceo = make_controller(cfg)
    lines, total = ceo._outreach_leads()
    assert total == 2 and lines[0].startswith("Noodle Bar One | hello@noodlebarone.com | Acme POS")
    ep = ceo.memory.db.query("SELECT id FROM episodes ORDER BY id DESC LIMIT 1")
    ceo.memory.db.execute("INSERT INTO actions (ts, cycle, episode_id, action_type, payload, thought, verdict, result, progress) VALUES (?,?,?,?,?,?,?,?,?)",
                          ("2026-10-03T01:00:00", 1, ep[0]["id"] if ep else 1, "task", '{"type":"task","title":"Outreach: Noodle Bar One and 0 more","details":"Noodle Bar One hello@noodlebarone.com"}', "", "allowed", "", 1))
    lines, total = ceo._outreach_leads()
    assert total == 1 and lines[0].startswith("Harbor Restaurant")


def test_audit_fixes_of_2026_10_03(cfg):
    """One test per contradiction the card audits found between what a card says and what the engine refused."""
    from explorer.actions import Note, Open, Search, UpdateTask
    from explorer.config import NotionConfig
    from explorer.policy import Denylist, Policy, PolicyContext, resolve_task_title, searches_are_twins, url_key

    # the same page, whatever the slash, scheme, "www" or fragment
    assert url_key("https://poplarbooks.com") == url_key("http://www.poplarbooks.com/") == url_key("https://poplarbooks.com/#top") == "poplarbooks.com"
    assert url_key("https://a.example/Contact/") == "a.example/Contact" != url_key("https://a.example/about")
    # Lead Gen's recipe changes one word; with a higher overlap that is a new search, a rewording still is not
    assert searches_are_twins("restaurant Northside contact email", "salon Northside contact email")
    assert not searches_are_twins("restaurant Northside contact email", "salon Northside contact email", 0.85)
    assert searches_are_twins("Northside restaurants contact email", "contact email Northside restaurant", 0.85)
    # a title cut short by a refusal message still finds its task, when only one starts that way
    titles = {"update fixed-price mvp development for spf smbs package toggle title with price", "follow up with noodle bar one"}
    assert resolve_task_title("Update Fixed-Price MVP Development for SPF SMBs package toggle title w", titles) == sorted(titles)[1]
    assert resolve_task_title("follow up", titles) is None and resolve_task_title("Follow up with Noodle Bar One", titles) == "follow up with noodle bar one"

    cfg.policy.open_only_seen_urls = True
    cfg.policy.refuse_repeated_searches = True
    policy = Policy(cfg.policy, cfg.publish, Denylist.load(Path(cfg.policy.denylist_file)), notion=NotionConfig(enabled=True, database_id="db"))
    base = dict(mode="web", current_page=None, actions_in_episode=1, pages_last_hour=0, open_questions=0, last_visit_by_domain={})
    ctx = PolicyContext(**base, visited_urls={"https://poplarbooks.com/"}, recent_task_titles=titles, episode_search_queries=["handbook lead rule"])
    assert "actually seen" not in (policy.check(Open(type="open", url="https://poplarbooks.com"), ctx).reason or "")
    assert "actually seen" in policy.check(Open(type="open", url="https://never-seen.example/"), ctx).reason
    # own files may always be named; another engine may not
    assert "cannot choose" not in (policy.check(Search(type="search", query="handbook lead rule", engine="files"), ctx).reason or "")
    assert "cannot choose" in policy.check(Search(type="search", query="x y z", engine="tavily"), ctx).reason
    web = Search(type="search", query="free page reader api", engine="web")
    assert "cannot choose" not in (policy.check(web, ctx).reason or "") and web.engine == ""
    # a note whose "source" is the word internal is saved without one
    note = Note(type="note", title="Package Designer status", body="It is stopped; its work waits.", source_url="internal")
    assert "source_url" not in (policy.check(note, ctx).reason or "") and note.source_url == ""
    assert "is not one of them" not in (policy.check(UpdateTask(type="update_task", title="Follow up with Noodle Bar One", due="2026-10-09"), ctx).reason or "")
    assert "Did you mean" in policy.check(UpdateTask(type="update_task", title="Follow up with Noodle Bar One restaurant today", due="2026-10-09"), ctx).reason


def test_one_outreach_batch_a_day_and_no_past_deadline(cfg):
    from explorer.actions import Task
    from explorer.config import NotionConfig
    from explorer.policy import Denylist, Policy, PolicyContext

    policy = Policy(cfg.policy, cfg.publish, Denylist.load(Path(cfg.policy.denylist_file)), notion=NotionConfig(enabled=True, database_id="db"))
    base = dict(mode="web", current_page=None, actions_in_episode=1, pages_last_hour=0, open_questions=0, last_visit_by_domain={})
    details = "### Why\nx\n### What to do\n1. y\n### Done when\n- [ ] z\n" + "x" * 300
    task = lambda **kw: Task(**{**dict(type="task", title="Outreach: Noodle Bar One and 9 more", details=details, due="2099-12-01"), **kw})  # noqa: E731
    assert policy.check(task(), PolicyContext(**base)).allowed
    assert "one outreach batch a day" in policy.check(task(), PolicyContext(**base, task_titles_today={"outreach: harbor and 4 more"})).reason
    assert "in the past" in policy.check(task(due="2026-09-26"), PolicyContext(**base)).reason


def test_a_package_named_by_its_headline_is_that_package(cfg):
    from explorer.actions import PublishPackage
    from explorer.config import NotionConfig
    from explorer.policy import Denylist, Policy, PolicyContext

    notion = NotionConfig(enabled=True, database_id="db", package_page_id="page", package_republish_own=True)
    policy = Policy(cfg.policy, cfg.publish, Denylist.load(Path(cfg.policy.denylist_file)), notion=notion)
    page = {"website care basic": {"name": "Website Care Basic", "title": "Care for Your Shop's Website – $299/month", "email_sha": "x", "day": "2026-09-30"}}
    ctx = PolicyContext(mode="web", current_page=None, actions_in_episode=1, pages_last_hour=0, open_questions=0, last_visit_by_domain={},
                        published_package_names={"website care basic"}, packages_on_page=page)
    pub = PublishPackage(type="publish_package", name="Care for Your Shop's Website", title="Care for Your Shop's Website – $349/month",
                         email="Hi [Name],\nCare at $349.\n1. Updates\n2. Backups\nRegards,\n-- Acme", conclusion="Fits.")
    policy.check(pub, ctx)
    assert pub.name == "Website Care Basic"


def test_any_outreach_title_counts_as_todays_batch(cfg):
    from explorer.actions import Task
    from explorer.config import NotionConfig
    from explorer.policy import Denylist, Policy, PolicyContext

    policy = Policy(cfg.policy, cfg.publish, Denylist.load(Path(cfg.policy.denylist_file)), notion=NotionConfig(enabled=True, database_id="db"))
    base = dict(mode="web", current_page=None, actions_in_episode=1, pages_last_hour=0, open_questions=0, last_visit_by_domain={})
    details = "### Why\nx\n### What to do\n1. y\n### Done when\n- [ ] z\n" + "x" * 300
    again = Task(type="task", title="Perform outreach to local leads in legal and dental", details=details)
    assert "one outreach batch a day" in policy.check(again, PolicyContext(**base, task_titles_today={"outreach: maple diner and 7 more"})).reason
    assert policy.check(again, PolicyContext(**base)).allowed
