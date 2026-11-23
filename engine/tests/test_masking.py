"""a lead's email, phone and contact name never leave in a request, and come back whole in the reply."""
from __future__ import annotations

import json
from dataclasses import replace

import httpx
import pytest

from explorer.common import masking
from explorer.common.fallback import FallbackModel
from explorer.config import ModelConfig
from explorer.model import FakeModel, GeminiModel, OpenAICompatModel, ReplicateModel

from test_remote_providers import Clock, chat_reply, groq_provider, obs

ROWS = [
    {"business": "Daisy Bakery", "contact_person": "Maria Lopez", "phone": "(212) 555-0147", "whatsapp": "+1 646 555 0199",
     "domain": "example.com"},
    {"business": "Sunrise Tacos", "contact_person": "Best", "phone": "", "domain": "sunrisetacos.com"},
    {"business": "Corner Hardware", "contact_person": "Dr. Patel", "phone": "", "domain": ""},
    {"business": "Willow Salon", "contact_person": "Will", "phone": "", "domain": ""},
    {"business": "Maria Lopez Salon", "contact_person": "Ana Ruiz", "phone": "", "domain": ""},
]
SECRETS = ("Maria Lopez", "maria@example.com", "(212) 555-0147", "212-555-0147", "646 555 0199")
PROMPT = ("Row: Daisy Bakery. Contact person: Maria Lopez, maria@example.com. Phone (212) 555-0147, also 212-555-0147, "
          "WhatsApp +1 646 555 0199. Write to Maria.")


@pytest.fixture
def rows():
    masking._set_known(ROWS)


def call(text, system="You write."):
    return masking.Call([{"role": "system", "content": system}, {"role": "user", "content": text}])


def test_a_rows_values_leave_as_tokens(rows):
    sent = call(PROMPT).messages[1]["content"]
    for secret in SECRETS:
        assert secret not in sent
    assert "Daisy Bakery" in sent and "[CONTACT_FIRST_1]" in sent and "[EMAIL_1_OWN_DOMAIN]" in sent


def test_the_same_value_gets_the_same_token_and_comes_back(rows):
    c = call(PROMPT)
    sent = c.messages[1]["content"]
    assert sent.count("[EMAIL_1_OWN_DOMAIN]") == 1 and call(PROMPT + " Again (212) 555-0147.").messages[1]["content"].count("[PHONE_1]") == 2
    assert c.restore("Call [PHONE_1], write [EMAIL_1_OWN_DOMAIN], ask for [CONTACT_1].") == (
        "Call (212) 555-0147, write maria@example.com, ask for Maria Lopez.")


def test_a_phone_written_two_ways_comes_back_as_each_was_written(rows):
    c = call("Daisy Bakery (212) 555-0147 and 212-555-0147")
    sent = c.messages[1]["content"]
    assert "[PHONE_1]" in sent and "[PHONE_2]" in sent
    assert c.restore(sent) == "Daisy Bakery (212) 555-0147 and 212-555-0147"


def test_a_name_in_capitals_comes_back_in_capitals(rows):
    c = call("Daisy Bakery. MARIA LOPEZ and Maria Lopez.")
    sent = c.messages[1]["content"]
    assert "MARIA" not in sent and "Maria" not in sent
    assert c.restore(sent) == "Daisy Bakery. MARIA LOPEZ and Maria Lopez."


def test_a_dropped_label_is_the_same_value(rows):
    assert call(PROMPT).restore("write [EMAIL_1]") == "write maria@example.com"


def test_a_value_is_escaped_inside_json(rows):
    masking._set_known([{"business": "Daisy Bakery", "contact_person": 'Maria "Mia" Lopez', "phone": ""}])
    c = call('Daisy Bakery. Contact person: Maria "Mia" Lopez')
    token = next(t for t in c._values if t.startswith("[CONTACT_") and "FIRST" not in t)
    assert json.loads(c.restore(json.dumps({"to": token})))["to"] == 'Maria "Mia" Lopez'


@pytest.mark.parametrize("reply", ["write [EMAIL_9]", "ask [contact_1]", "ask [CONTACT 1]", "ask CONTACT_1", "call PHONE_1"])
def test_a_left_or_invented_token_fails_the_reply(rows, reply):
    with pytest.raises(masking.MaskFailed) as err:
        call(PROMPT).restore(reply)
    assert "maria" not in str(err.value).lower()


def test_a_token_already_in_the_prompt_stays_itself(rows):
    c = call(PROMPT + " Template field: [EMAIL_1].")
    assert "[EMAIL_2_OWN_DOMAIN]" in c.messages[1]["content"]
    assert c.restore("keep [EMAIL_1], write [EMAIL_2_OWN_DOMAIN]") == "keep [EMAIL_1], write maria@example.com"


# ---- over-masking -----------------------------------------------------------------------------------


def test_a_one_word_name_needs_its_business_in_the_prompt(rows):
    assert call("Maria is a common name.").messages[1]["content"] == "Maria is a common name."
    assert "[CONTACT_FIRST_1]" in call("Daisy Bakery: ask Maria.").messages[1]["content"]


def test_an_everyday_word_that_is_also_a_name_stays(rows):
    sent = call("Sunrise Tacos. Best regards, and Will you call? Contact person: Best").messages[1]["content"]
    assert "Best regards" in sent and "Will you call" in sent and sent.endswith("[CONTACT_FIRST_1]")


def test_a_business_name_is_never_masked(rows):
    sent = call("Maria Lopez Salon is on Main Street.").messages[1]["content"]
    assert sent == "Maria Lopez Salon is on Main Street."


@pytest.mark.parametrize("text", ["Invoice 2026-11-22 10:20", "id 00000000-0000-4000-8000-000000000000", "sold 1002003000 units",
                                  "logo@2x.png", "price 12.50 for 3"])
def test_ordinary_numbers_and_files_stay(rows, text):
    assert call(text).messages[1]["content"] == text


def test_role_cells_are_not_people():
    assert masking.first_name("Owner") == "" and masking.first_name("Front Desk") == "" and masking.first_name("Dr. Patel") == ""
    assert masking.first_name("Maria Lopez") == "Maria"


def test_a_greeting_with_no_safe_first_name_names_nobody(rows):
    masking._set_known([{"business": "Corner Hardware", "contact_person": "Patel Singh Kaur Dev Rao", "phone": ""},
                        {"business": "Lake Shop", "contact_person": "Dr. Patel", "phone": ""}])
    c = call("Lake Shop. Contact person: Dr. Patel")
    token = next(t for t in c._values if t.startswith("[CONTACT_"))
    assert c.restore(f"Hi {token}, we would like") == "Hi Lake Shop team, we would like"


def test_email_labels_are_drawn_by_code():
    own = {"example.com"}
    assert masking.email_label("info@example.com", own) == "ROLE_OWN_DOMAIN"
    assert masking.email_label("maria@example.com", own) == "OWN_DOMAIN"
    assert masking.email_label(f"daisy@{min(masking.FREE_MAIL)}", own) == "FREE_MAIL"
    assert masking.email_label("sales@example.org", own) == "ROLE_OTHER_DOMAIN"


def _seen(bodies):
    return "\n".join(bodies)


def _chat_model(name, reply, bodies, clock):
    def handler(req):
        bodies.append(req.content.decode())
        return chat_reply(reply(len(bodies)) if callable(reply) else reply)
    provider = groq_provider()
    provider.name = name
    return OpenAICompatModel(ModelConfig(max_retries=1), provider, "k", transport=httpx.MockTransport(handler), clock=clock)


def _decision(text):
    return json.dumps({"thought": "ok", "action": {"type": "search", "query": text}})


def test_nothing_personal_on_the_wire_for_openai_shape_and_the_reply_is_whole(rows):
    bodies = []
    m = _chat_model("a", "Mail [EMAIL_1_OWN_DOMAIN]", bodies, Clock(100.0))
    assert m.complete("s", PROMPT) == "Mail maria@example.com"
    for secret in SECRETS:
        assert secret not in _seen(bodies)


def test_nothing_personal_on_the_wire_for_gemini(rows):
    bodies = []

    def handler(req):
        bodies.append(req.content.decode())
        return httpx.Response(200, json={"candidates": [{"content": {"parts": [{"text": "Call [PHONE_1]"}]}}]})
    m = GeminiModel(ModelConfig(), "k", transport=httpx.MockTransport(handler))
    m.day_file = None
    m.cfg.gemini_calls_per_day = 0
    assert m.complete("s", PROMPT) == "Call (212) 555-0147"
    for secret in SECRETS:
        assert secret not in _seen(bodies)


def test_nothing_personal_on_the_wire_for_replicate(rows):
    bodies = []

    def handler(req):
        bodies.append(req.content.decode())
        return httpx.Response(200, json={"status": "succeeded", "output": ["Ask ", "[CONTACT_1]"]})
    provider = groq_provider()
    m = ReplicateModel(ModelConfig(), provider, "k", transport=httpx.MockTransport(handler))
    assert m.complete("s", PROMPT) == "Ask Maria Lopez"
    for secret in SECRETS:
        assert secret not in _seen(bodies)


def test_an_invented_token_moves_to_the_next_provider_and_neither_sees_a_value(rows):
    clock, first, second = Clock(100.0), [], []
    a = _chat_model("a", "Mail [EMAIL_7]", first, clock)
    b = _chat_model("b", "Mail [EMAIL_1_OWN_DOMAIN]", second, clock)
    chain = FallbackModel([a, b], FakeModel(), clock=clock)
    assert chain.complete("s", PROMPT) == "Mail maria@example.com"
    assert len(first) == 1 and len(second) == 1
    for secret in SECRETS:
        assert secret not in _seen(first + second)


def test_the_repair_turn_after_an_invalid_reply_carries_no_value(rows):
    clock, bodies = Clock(100.0), []
    replies = lambda n: "Mail [EMAIL_1_OWN_DOMAIN], not json" if n == 1 else _decision("Mail [EMAIL_1_OWN_DOMAIN]")
    m = _chat_model("a", replies, bodies, clock)
    result = m.decide("s", replace(obs(), feedback=PROMPT))
    assert result.decision is not None and result.decision.action.query == "Mail maria@example.com"
    assert len(bodies) == 2
    for secret in SECRETS:
        assert secret not in _seen(bodies)


def test_the_switch_off_sends_the_text_as_it_is(rows):
    bodies = []
    m = _chat_model("a", "ok", bodies, Clock(100.0))
    m.cfg.mask_personal = False
    m.complete("s", PROMPT)
    assert "maria@example.com" in _seen(bodies)




# ---- who may see what --------------------------------------------------------------------------


def _named(name, bodies, clock, reply=None, **cfg):
    def handler(req):
        bodies.append(name)
        return chat_reply(reply or json.dumps({"thought": "ok", "action": {"type": "search", "query": "tides"}}))
    conf = ModelConfig(max_retries=0, **cfg)
    m = OpenAICompatModel(conf, groq_provider(name=name, base_url=f"https://{name}.test/v1"), "k", transport=httpx.MockTransport(handler), clock=clock)
    m.chain_name = name
    return m


RULE = {"personal_closed": ["gemini"], "new_names_open": ["zai", "groq", "openrouter"]}


def test_the_engine_closes_gemini_to_personal_data_by_default():
    assert ModelConfig().personal_closed == ["gemini"]


def test_an_unmarked_call_never_reaches_a_closed_provider():
    clock, seen = Clock(100.0), []
    chain = FallbackModel([_named("gemini", seen, clock, **RULE), _named("zai", seen, clock, **RULE)], FakeModel(), clock=clock)
    assert chain.decide("s", obs()).decision is not None
    assert chain.complete("s", "p")
    assert set(seen) == {"zai"}


def test_a_closed_provider_is_not_reached_on_fallback_or_retry():
    clock, seen = Clock(100.0), []

    def down(req):
        seen.append("zai")
        return httpx.Response(500, json={})
    first = OpenAICompatModel(ModelConfig(max_retries=1, **RULE), groq_provider(name="zai"), "k", transport=httpx.MockTransport(down), clock=clock)
    first.chain_name = "zai"
    chain = FallbackModel([first, _named("gemini", seen, clock, **RULE), _named("groq", seen, clock, **RULE)], FakeModel(), clock=clock)
    assert chain.decide("s", obs()).decision is not None
    assert "gemini" not in seen and seen[-1] == "groq"


def test_a_closed_provider_spends_nothing_in_the_ledger(tmp_path):
    from explorer.common.fallback import CallLedger
    clock, seen = Clock(100.0), []
    closed = _named("gemini", seen, clock, **RULE)
    chain = FallbackModel([closed, _named("zai", seen, clock, **RULE)], FakeModel(), clock=clock, ledger=CallLedger(tmp_path / "l.json", bot="t"))
    chain.complete("s", "p")
    assert chain.ledger.count(chain.ledger_key(closed)) == 0


def test_our_own_text_may_go_to_any_provider():
    clock, seen = Clock(100.0), []
    chain = FallbackModel([_named("gemini", seen, clock, **RULE)], FakeModel(), clock=clock)
    with masking.call_kind("own_text"):
        assert chain.complete("s", "p")
    assert seen == ["gemini"]


@pytest.mark.parametrize("name,goes", [("zai", True), ("groq", True), ("openrouter", True), ("mistral", False), ("gemini", False), ("speka", False)])
def test_a_call_that_reads_new_names_goes_only_to_the_open_list(name, goes):
    clock, seen = Clock(100.0), []
    chain = FallbackModel([_named(name, seen, clock, **RULE)], FakeModel(), clock=clock)
    with masking.call_kind("new_names"):
        chain.complete("s", "p")
    assert (seen == [name]) is goes


def test_with_the_mask_off_a_personal_call_counts_as_unmasked():
    clock, seen = Clock(100.0), []
    chain = FallbackModel([_named("mistral", seen, clock, mask_personal=False, **RULE)], FakeModel(), clock=clock)
    chain.complete("s", "p")
    assert seen == []


def test_an_unknown_kind_is_refused():
    with pytest.raises(ValueError):
        with masking.call_kind("nothing"):
            pass


# ---- : a contact-finding member's decide runs unmasked, everything else as before ---------------


def _sent(name, clock, kind, **cfg):
    seen = []

    def handler(req):
        seen.append(req.content.decode())
        return chat_reply("<html>ok</html>")
    m = OpenAICompatModel(ModelConfig(max_retries=0, **cfg), groq_provider(name=name, base_url=f"https://{name}.test/v1"), "k",
                          transport=httpx.MockTransport(handler), clock=clock)
    m.chain_name = name
    chain = FallbackModel([m], FakeModel(), clock=clock)
    if kind:
        with masking.call_kind(kind):
            chain.complete("s", PROMPT)
    else:
        chain.complete("s", PROMPT)
    return "".join(seen)


def test_an_unmarked_call_is_masked_and_a_new_names_call_is_not(rows):
    assert "maria@example.com" not in _sent("zai", Clock(100.0), "", **RULE)
    assert "maria@example.com" in _sent("zai", Clock(100.0), "new_names", **RULE)


def test_an_unmasked_contact_call_never_reaches_gemini_or_mistral(rows):
    for name in ("gemini", "mistral"):
        assert _sent(name, Clock(100.0), "new_names", **RULE) == ""


def test_mistral_opens_by_its_config_line_alone(rows):
    rule = {**RULE, "new_names_open": [*RULE["new_names_open"], "mistral"]}
    assert "maria@example.com" in _sent("mistral", Clock(100.0), "new_names", **rule)


def test_a_page_call_is_unmasked_and_follows_the_personal_list(rows):
    assert "maria@example.com" in _sent("gemini", Clock(100.0), "page", personal_closed=[], new_names_open=RULE["new_names_open"])     # opened by the person's choice
    assert _sent("gemini", Clock(100.0), "page", **RULE) == ""                     # the line that would take it off them


def test_a_broken_mask_sends_nothing(rows, monkeypatch):
    def broken(*a, **k):
        raise RuntimeError("no")
    monkeypatch.setattr(masking, "begin", broken)
    assert _sent("zai", Clock(100.0), "") == ""


def test_a_business_name_at_the_end_of_the_text_does_not_break_the_mask():
    masking._set_known([{"business": "Blue Door Cafe", "contact_person": "Ana Reyes"}, {"business": "Door Cafe"}])
    assert masking.begin([{"role": "user", "content": "at the Door"}]) is not None


def _kind_in_decide(cfg):
    from conftest import make_controller
    seen = []

    class Spy(FakeModel):
        def decide(self, system, o):
            seen.append(masking._kind.get())
            return super().decide(system, o)
    c = make_controller(cfg, model=Spy())
    c._cycle()
    return seen, masking._kind.get()


def test_only_the_members_decide_call_carries_its_kind(cfg):
    cfg.model.decide_kind, cfg.model.new_names_open = "new_names", ["zai"]
    seen, after = _kind_in_decide(cfg)
    assert seen == ["new_names"] and after == ""       # the journal, judge and every later call are masked again


def test_any_other_member_decides_masked(cfg):
    seen, _ = _kind_in_decide(cfg)
    assert seen == ["personal"]


@pytest.mark.parametrize("line,why", [('decide_kind = "new_names"', "new_names_open"), ('decide_kind = "nothing"', "must be one of")])
def test_a_wrong_decide_line_is_refused_at_load(tmp_path, line, why):
    from explorer.config import load_config
    p = tmp_path / "config.toml"
    p.write_text(f"[model]\n{line}\n")
    with pytest.raises(ValueError, match=why):
        load_config(p)


def test_a_work_row_says_how_to_greet_its_contact_and_the_greeting_comes_back():
    masking._set_known([{"business": "Daisy Bakery", "contact_person": "Maria Lopez"}])
    c = masking.begin([{"role": "user", "content": "- Daisy Bakery | how we can help: Care | contact: Maria Lopez | pain point: -"}])
    sent = c.messages[-1]["content"]
    assert 'contact: [CONTACT_1] (greet: "Hi [CONTACT_1],") |' in sent and "Maria" not in sent
    assert c.restore('{"draft_email": "Hi [CONTACT_1],\\nA line."}') == '{"draft_email": "Hi Maria,\\nA line."}'
