"""The AI chat partner: say(to="partner"), its policy caps, and the offline fake client."""
from __future__ import annotations

from explorer.actions import Note, Say
from explorer.chat_partner import FakeChatPartner
from explorer.config import ChatPartnerConfig, DesktopConfig, PolicyConfig, PublishConfig
from explorer.policy import Denylist, Policy, PolicyContext

from conftest import DENYLIST, make_controller


def make_policy(chat_partner: ChatPartnerConfig | None = None, **overrides) -> Policy:
    cfg = PolicyConfig(**overrides)
    return Policy(cfg, PublishConfig(), Denylist.load(DENYLIST), desktop=DesktopConfig(), chat_partner=chat_partner)


def ctx(**over) -> PolicyContext:
    base = dict(mode="web", current_page=None, actions_in_episode=0, pages_last_hour=0, open_questions=0, last_visit_by_domain={})
    base.update(over)
    return PolicyContext(**base)


def test_partner_say_refused_when_no_partner_configured():
    policy = make_policy(chat_partner=None)
    verdict = policy.check(Say(type="say", text="hi", to="partner"), ctx())
    assert not verdict.allowed
    assert "no AI partner" in verdict.reason


def test_partner_say_refused_when_disabled():
    policy = make_policy(chat_partner=ChatPartnerConfig(enabled=False))
    verdict = policy.check(Say(type="say", text="hi", to="partner"), ctx())
    assert not verdict.allowed


def test_partner_say_allowed_when_enabled():
    policy = make_policy(chat_partner=ChatPartnerConfig(enabled=True))
    verdict = policy.check(Say(type="say", text="hi", to="partner"), ctx())
    assert verdict.allowed


def test_owner_say_budget_is_independent_of_partner_budget():
    """A long partner conversation must not eat into the owner's say budget, or vice versa."""
    policy = make_policy(chat_partner=ChatPartnerConfig(enabled=True), max_says_per_episode=1)
    # The owner budget is already used up, but the partner conversation is untouched.
    partner_ok = policy.check(Say(type="say", text="hi", to="partner"), ctx(says_in_episode=1, partner_turns_in_episode=0))
    assert partner_ok.allowed
    # And the reverse: a busy partner conversation does not block a message to the owner.
    owner_ok = policy.check(Say(type="say", text="hi", to="owner"), ctx(says_in_episode=0, partner_turns_in_episode=5))
    assert owner_ok.allowed


def test_partner_say_refused_past_turns_before_note():
    cp = ChatPartnerConfig(enabled=True, max_turns_before_note=2)
    policy = make_policy(chat_partner=cp)
    allowed = policy.check(Say(type="say", text="hi", to="partner"), ctx(partner_turns_since_note=1))
    assert allowed.allowed
    refused = policy.check(Say(type="say", text="hi", to="partner"), ctx(partner_turns_since_note=2))
    assert not refused.allowed
    assert "without noting" in refused.reason


def test_partner_say_refused_past_turns_per_episode():
    cp = ChatPartnerConfig(enabled=True, max_turns_per_episode=3)
    policy = make_policy(chat_partner=cp)
    refused = policy.check(Say(type="say", text="hi", to="partner"), ctx(partner_turns_in_episode=3))
    assert not refused.allowed
    assert "this episode" in refused.reason


def test_fake_chat_partner_replies_deterministically():
    partner = FakeChatPartner()
    reply1 = partner.reply("system", [{"role": "user", "content": "hello"}])
    reply2 = partner.reply("system", [{"role": "user", "content": "hello again"}])
    assert "hello" in reply1
    assert reply1 != reply2  # the call counter makes each reply distinct


def test_controller_executes_a_partner_conversation_end_to_end(cfg):
    cfg.chat_partner.enabled = True
    cfg.chat_partner.max_turns_before_note = 2
    controller = make_controller(cfg, chat_partner=FakeChatPartner())
    ep = controller.memory.episode(controller.memory.start_episode())
    assert ep is not None

    def say_partner(text: str):
        return controller._execute_say(Say(type="say", text=text, to="partner"))

    result = say_partner("what do you think about tides")
    assert result.ok
    assert "fake partner reply" in result.summary
    chat_rows = controller.memory.recent_chat(10)
    assert any(r["role"] == "partner" for r in chat_rows)
    assert any(r["role"] == "bot" and "[to Convo]" in r["text"] for r in chat_rows)
    assert controller.partner_turns_since_note == 1

    # A note resets the since-note counter, the same way pages_since_note resets.
    controller._execute(Note(type="note", title="tides", body="learned something", answers_question=None), ep, None)
    assert controller.partner_turns_since_note == 0


def test_partner_prompt_uses_the_agents_configured_name(cfg):
    cfg.agent.name = "Jobless-Bot"
    cfg.chat_partner.enabled = True
    partner = FakeChatPartner()
    controller = make_controller(cfg, chat_partner=partner)
    controller._execute_say(Say(type="say", text="hello", to="partner"))
    assert "Jobless-Bot has someone to talk to" in partner.last_system
    assert "{name}" not in partner.last_system


def test_controller_partner_say_without_a_client_fails_cleanly(cfg):
    cfg.chat_partner.enabled = True
    controller = make_controller(cfg, chat_partner=None)
    result = controller._execute_say(Say(type="say", text="hi", to="partner"))
    assert not result.ok
    assert "no AI partner" in result.summary
