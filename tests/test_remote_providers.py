"""OpenAI-compatible providers ([model.providers.<name>] tables) and the ordered provider chain."""
from __future__ import annotations

import json

import httpx

from explorer.config import ModelConfig
from explorer.common.fallback import FallbackModel, build_model
from explorer.model import (
    CompatProvider,
    FakeModel,
    GeminiModel,
    OpenAICompatModel,
    load_api_key,
)
from explorer.prompts import Observation


def obs() -> Observation:
    return Observation(
        cycle=1, episode_id=1, episode_actions=0, episode_budget=6, pages_last_hour=0, pages_budget=60,
        current_question_id=None, current_question=None, interests=[("tides", 0.6)], open_questions=[],
        open_questions_count=0, recent_notes=[], recent_actions=[], page=None, page_noted=False,
        page_text_window="", page_has_more=False,
    )


DECISION = json.dumps({"thought": "look", "action": {"type": "search", "query": "tides"}})


def chat_reply(text: str) -> httpx.Response:
    return httpx.Response(200, json={"choices": [{"message": {"content": text}}]})


class Clock:
    def __init__(self, t: float = 0.0):
        self.t = t

    def __call__(self) -> float:
        return self.t


GROQ = "https://api.groq.com/openai/v1"


def groq_provider(**over) -> CompatProvider:
    spec = {"name": "groq", "base_url": GROQ, "model": "openai/gpt-oss-120b", "api_key_env": "GROQ_API_KEY",
            "api_key_file": "~/.config/explorer/groq_api_key"}
    spec.update(over)
    return CompatProvider(**spec)


def make_compat(handler, clock=None, **over) -> OpenAICompatModel:
    cfg = ModelConfig(provider="remote", max_retries=1)
    return OpenAICompatModel(cfg, groq_provider(**over), "gsk-test", transport=httpx.MockTransport(handler), clock=clock or Clock())


def test_decide_sends_the_openai_shape_with_auth_and_json_mode():
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return chat_reply(DECISION)

    model = make_compat(handler)
    result = model.decide("system", obs())
    assert result.decision is not None and result.decision.action.type == "search"
    request = seen[0]
    assert str(request.url) == "https://api.groq.com/openai/v1/chat/completions"
    assert request.headers["authorization"] == "Bearer gsk-test"
    assert "x-title" not in request.headers and "http-referer" not in request.headers
    body = json.loads(request.content)
    assert body["model"] == "openai/gpt-oss-120b"
    assert body["response_format"] == {"type": "json_object"}
    assert body["messages"][0]["role"] == "system"
    assert model.label == "api.groq.com/openai/gpt-oss-120b"


def test_json_mode_is_dropped_when_the_model_rejects_it():
    bodies: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        bodies.append(body)
        if "response_format" in body:
            return httpx.Response(400, json={"error": {"message": "response_format is not supported"}})
        return chat_reply(DECISION)

    model = make_compat(handler)
    result = model.decide("s", obs())
    assert result.decision is not None
    assert not model.json_mode_supported
    assert "response_format" in bodies[0] and "response_format" not in bodies[1]
    # The next call does not try JSON mode again.
    bodies.clear()
    model.decide("s", obs())
    assert "response_format" not in bodies[0]


def test_invalid_reply_is_retried_with_the_error():
    replies = iter(["nonsense", DECISION])
    bodies: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        bodies.append(json.loads(request.content))
        return chat_reply(next(replies))

    result = make_compat(handler).decide("s", obs())
    assert result.decision is not None and result.attempts == 2
    assert "not valid" in bodies[1]["messages"][-1]["content"]


def test_rate_limit_key_and_outage_cooldowns():
    clock = Clock(100.0)
    limited = make_compat(lambda r: httpx.Response(429, json={}), clock=clock, cooldown_minutes=15)
    assert limited.decide("s", obs()).decision is None
    assert limited.unavailable_until == 100.0 + 15 * 60

    # A per-minute limit that says when it frees up benches the provider for that long only.
    per_minute = make_compat(lambda r: httpx.Response(429, headers={"retry-after": "7"}, json={}), clock=Clock(100.0))
    per_minute.decide("s", obs())
    assert per_minute.unavailable_until == 107.0
    groq = make_compat(lambda r: httpx.Response(429, headers={"x-ratelimit-reset-tokens": "1m2.5s"}, json={}), clock=Clock(0.0))
    groq.decide("s", obs())
    assert groq.unavailable_until == 62.5
    # Groq's free daily token limit says when it frees up (here 19.5 min, longer than the 15-minute
    # cooldown): honour it exactly, and name the limit in the reason. Absurd waits are capped at 6 hours.
    tpd_body = {"error": {"message": "Rate limit reached for model `openai/gpt-oss-120b` ... on tokens per day (TPD): "
                                     "Limit 200000, Used 196952, Requested 5752. Please try again in 19m28.128s.",
                          "type": "tokens", "code": "rate_limit_exceeded"}}
    daily = make_compat(lambda r: httpx.Response(429, headers={"retry-after": "1169"}, json=tpd_body), clock=Clock(0.0),
                        cooldown_minutes=15)
    result = daily.decide("s", obs())
    assert daily.unavailable_until == 1169 and "on tokens per day" in (result.error or "")
    huge = make_compat(lambda r: httpx.Response(429, headers={"retry-after": "400000"}, json={}), clock=Clock(0.0))
    huge.decide("s", obs())
    assert huge.unavailable_until == 6 * 3600

    bad_key = make_compat(lambda r: httpx.Response(401, json={}), clock=Clock(0.0))
    bad_key.decide("s", obs())
    assert bad_key.unavailable_until == 3600.0

    def boom(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("down")

    offline = make_compat(boom, clock=Clock(0.0))
    offline.decide("s", obs())
    assert offline.unavailable_until == 120.0
    assert offline.complete("s", "p") == ""


def test_error_body_returned_with_status_200_is_treated_as_unavailable():
    clock = Clock(0.0)
    model = make_compat(
        lambda r: httpx.Response(200, json={"error": {"message": "rate limited upstream", "code": 429}}),
        clock=clock, cooldown_minutes=10,
    )
    result = model.decide("s", obs())
    assert result.decision is None
    assert model.unavailable_until == 10 * 60


def test_available_checks_the_model_id_against_the_catalogue():
    catalogue = {"data": [{"id": "openai/gpt-oss-120b"}, {"id": "openai/gpt-oss-20b"}]}
    ok, text = make_compat(lambda r: httpx.Response(200, json=catalogue)).available()
    assert ok and "reachable" in text

    missing = make_compat(lambda r: httpx.Response(200, json=catalogue), model="llama-3.3-70b-versatile")
    ok, text = missing.available()
    assert not ok
    assert "not in the catalogue" in text and "openai/gpt-oss-20b" in text

    ok, text = make_compat(lambda r: httpx.Response(401, json={})).available()
    assert not ok and "rejected the key" in text


def test_chain_tries_providers_in_order_then_the_local_fallback():
    clock = Clock(0.0)
    calls: list[str] = []

    def groq(request: httpx.Request) -> httpx.Response:
        calls.append("groq")
        return httpx.Response(429, json={})

    def gemini(request: httpx.Request) -> httpx.Response:
        calls.append("gemini")
        return httpx.Response(200, json={"candidates": [{"content": {"parts": [{"text": DECISION}]}}]})

    cfg = ModelConfig(provider="remote", max_retries=0, gemini_cooldown_minutes=5)
    first = OpenAICompatModel(cfg, groq_provider(cooldown_minutes=5), "k", transport=httpx.MockTransport(groq), clock=clock)
    second = GeminiModel(cfg, "k", transport=httpx.MockTransport(gemini), clock=clock)
    model = FallbackModel([first, second], FakeModel(), clock=clock)

    result = model.decide("s", obs())  # groq is rate limited, gemini answers
    assert result.decision is not None and result.decision.action.type == "search"
    assert calls == ["groq", "gemini"]
    assert not model.using_fallback

    calls.clear()
    model.decide("s", obs())  # groq still cooling down: skipped entirely
    assert calls == ["gemini"]

    second.unavailable_until = clock.t + 300  # both down: the local model answers
    calls.clear()
    result = model.decide("s", obs())
    assert result.decision is not None and result.decision.thought == "fake model heuristic"
    assert calls == [] and model.using_fallback

    clock.t = 400.0  # cooldowns over: back to the first provider
    calls.clear()
    model.decide("s", obs())
    assert calls[0] == "groq"


def test_build_model_from_the_config(tmp_path, monkeypatch):
    monkeypatch.setenv("EXPLORER_KEYS_DIR", str(tmp_path))  # no auto-discovery from the real key folder
    key_file = tmp_path / "key"
    cfg = ModelConfig(
        provider="remote", fallback_provider="fake", provider_chain=["groq"],
        providers={"groq": {"base_url": GROQ, "model": "openai/gpt-oss-120b",
                            "api_key_env": "EXPLORER_TEST_GROQ", "api_key_file": str(key_file)}},
        gemini_api_key_env="EXPLORER_TEST_GEM", gemini_api_key_file=str(tmp_path / "missing"),
    )
    monkeypatch.delenv("EXPLORER_TEST_GROQ", raising=False)
    monkeypatch.delenv("EXPLORER_TEST_GEM", raising=False)
    assert isinstance(build_model(cfg), FakeModel)  # no key: local only

    key_file.write_text("gsk-x\n")
    model = build_model(cfg)
    assert isinstance(model, FallbackModel)
    assert isinstance(model.primary, OpenAICompatModel)
    assert load_api_key("EXPLORER_TEST_GROQ", str(key_file)) == "gsk-x"

    # A chain skips providers whose key is missing and keeps the order of the rest.
    cfg.provider_chain = ["gemini", "groq"]
    model = build_model(cfg)
    assert isinstance(model, FallbackModel)
    assert [type(p).__name__ for p in model.primaries] == ["OpenAICompatModel"]

    monkeypatch.setenv("EXPLORER_TEST_GEM", "gem-key")
    model = build_model(cfg)
    assert [type(p).__name__ for p in model.primaries] == ["GeminiModel", "OpenAICompatModel"]


def test_named_providers_stack_in_the_chain_with_their_own_keys_and_caps(tmp_path, monkeypatch):
    monkeypatch.setenv("EXPLORER_KEYS_DIR", str(tmp_path))
    (tmp_path / "groq_api_key").write_text("gsk_test\n")
    (tmp_path / "cerebras_api_key").write_text("csk_test\n")
    monkeypatch.delenv("GROQ_API_KEY", raising=False)
    monkeypatch.delenv("CEREBRAS_API_KEY", raising=False)
    cfg = ModelConfig(
        provider="remote", fallback_provider="fake", calls_per_day=45,
        provider_chain=["groq", "cerebras", "together"],
        providers={
            "groq": {"base_url": GROQ, "model": "openai/gpt-oss-120b",
                     "api_key_file": str(tmp_path / "groq_api_key"), "calls_per_day": 900, "cooldown_minutes": 30},
            "cerebras": {"base_url": "https://api.cerebras.ai/v1", "model": "llama3.1-8b",
                         "api_key_file": str(tmp_path / "cerebras_api_key")},
            "together": {"base_url": "https://api.together.xyz/v1", "model": "x",
                         "api_key_file": str(tmp_path / "missing")},
        },
    )
    model = build_model(cfg, ledger_path=tmp_path / "calls.json")
    assert isinstance(model, FallbackModel)
    assert [p.label for p in model.primaries] == ["api.groq.com/openai/gpt-oss-120b", "api.cerebras.ai/llama3.1-8b"]
    assert [p.calls_per_day for p in model.primaries] == [900, 45]  # its own cap, then the model-wide one
    assert [p.provider.cooldown_minutes for p in model.primaries] == [30, 15.0]
    assert model.primaries[0].api_key == "gsk_test" and model.primaries[1].api_key == "csk_test"
    assert model.ledger is not None and model.ledger.path == tmp_path / "calls.json"


def test_daily_cap_is_shared_through_the_ledger_and_resets_tomorrow(tmp_path):
    from explorer.common.fallback import CallLedger

    clock = Clock(1_700_000_000.0)
    calls: list[str] = []

    def groq(request: httpx.Request) -> httpx.Response:
        calls.append("groq")
        return chat_reply(DECISION)

    provider = make_compat(groq, clock=clock, calls_per_day=2, base_url=GROQ)
    ledger = CallLedger(tmp_path / "calls.json", clock)
    model = FallbackModel([provider], FakeModel(), clock=clock, ledger=ledger)
    assert model.decide("s", obs()).decision.action.type == "search"
    assert model.decide("s", obs()).decision.action.type == "search"
    assert calls == ["groq", "groq"] and ledger.count("api.groq.com") == 2
    third = model.decide("s", obs())  # capped: the local model answers, the provider is not called
    assert third.decision.thought == "fake model heuristic" and calls == ["groq", "groq"] and model.using_fallback
    # A second process (another bot, the dashboard) reading the same file sees the cap too.
    other = FallbackModel([make_compat(groq, clock=clock, calls_per_day=2, base_url=GROQ)],
                          FakeModel(), clock=clock, ledger=CallLedger(tmp_path / "calls.json", clock))
    assert other.decide("s", obs()).decision.thought == "fake model heuristic" and calls == ["groq", "groq"]
    clock.t += 86_400  # tomorrow: fresh count
    assert model.decide("s", obs()).decision.action.type == "search" and calls == ["groq"] * 3
    # No cap, no ledger entries.
    free = FallbackModel([make_compat(groq, clock=clock)], FakeModel(), clock=clock, ledger=ledger)
    free.decide("s", obs())
    assert ledger.count("api.groq.com") == 1


def test_groq_json_validation_failure_drops_json_mode_instead_of_pausing_the_provider():
    bodies: list[dict] = []

    def groq(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        bodies.append(body)
        if "response_format" in body:
            return httpx.Response(400, json={"error": {
                "message": "Failed to validate JSON. Please adjust your prompt. See 'failed_generation' for more details.",
                "type": "invalid_request_error", "code": "json_validate_failed", "failed_generation": "{...}"}})
        return chat_reply(DECISION)

    model = make_compat(groq, base_url=GROQ)
    result = model.decide("s", obs())
    assert result.decision is not None and result.decision.action.type == "search"
    assert model.unavailable_until == 0.0 and not model.json_mode_supported
    assert [("response_format" in b) for b in bodies] == [True, False]


def test_provider_tables_and_chain_entries_are_validated(tmp_path):
    import pytest

    from explorer.config import Config, validate

    cfg = Config(root=tmp_path)
    cfg.model.provider = "openrouter"  # removed: a clear error, not a silent local-only bot
    with pytest.raises(ValueError, match="was removed"):
        validate(cfg)
    cfg.model.provider = "remote"
    with pytest.raises(ValueError, match="needs model.provider_chain"):
        validate(cfg)
    # A KNOWN_PROVIDERS name is valid in the chain with no table (auto-discovery / defaults cover it).
    cfg.model.provider_chain = ["openrouter"]
    validate(cfg)
    cfg.model.provider_chain = ["groq"]
    validate(cfg)
    cfg.model.provider_chain = ["nope-not-real"]
    with pytest.raises(ValueError, match="unknown provider 'nope-not-real'"):
        validate(cfg)
    cfg.model.provider_chain = ["groq"]  # valid again, so the table checks below are what's tested
    cfg.model.providers = {"groq": {"base_url": "https://api.groq.com/openai/v1"}}
    with pytest.raises(ValueError, match="needs model"):
        validate(cfg)
    cfg.model.providers["groq"]["model"] = "openai/gpt-oss-120b"
    cfg.model.providers["groq"]["app_title"] = "OpenRouter-only header, gone"
    with pytest.raises(ValueError, match="unknown keys"):
        validate(cfg)
    del cfg.model.providers["groq"]["app_title"]
    validate(cfg)


# ---- Plan 6: spend a per-minute token budget on the output that shows -----------------------


class Local:
    """A local model that always answers with the given action and counts its calls."""

    def __init__(self, action: dict):
        self.action = action
        self.calls = 0

    def decide(self, system, observation):
        from explorer.actions import parse_decision
        from explorer.model import ModelResult

        self.calls += 1
        return ModelResult(decision=parse_decision(json.dumps({"thought": "local", "action": self.action})))

    def complete(self, system, prompt):
        return "local text"


def groq_like(seen: list, reply: str, remaining: str = "7000", usage=(5000, 300)):
    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(json.loads(request.content))
        return httpx.Response(
            200,
            headers={"x-ratelimit-limit-tokens": "8000", "x-ratelimit-remaining-tokens": remaining, "x-ratelimit-reset-tokens": "30s"},
            json={"choices": [{"message": {"content": reply}}], "usage": {"prompt_tokens": usage[0], "completion_tokens": usage[1]}},
        )

    return handler


def test_writing_mode_decides_locally_and_asks_the_remote_chain_only_to_write(tmp_path):
    from explorer.common.fallback import CallLedger

    seen: list[dict] = []
    note = json.dumps({"thought": "remote", "action": {"type": "note", "title": "Clutch rates for SPF MVP shops",
                                                        "body": "Most list $50-99/hr.", "source_url": "https://clutch.co/x"}})
    remote = make_compat(groq_like(seen, note))
    ledger = CallLedger(tmp_path / "calls.json")

    browsing = Local({"type": "search", "query": "spf mvp agencies"})
    model = FallbackModel([remote], browsing, ledger=ledger, remote_for="writing")
    result = model.decide("s", obs())
    assert result.decision.action.type == "search" and browsing.calls == 1 and seen == []  # no remote call

    drafting = Local({"type": "note", "title": "rates", "body": "cheap", "source_url": "https://clutch.co/x"})
    model = FallbackModel([remote], drafting, ledger=ledger, remote_for="writing")
    result = model.decide("s", obs())
    assert result.decision.thought == "remote" and result.decision.action.title == "Clutch rates for SPF MVP shops"
    prompt = seen[0]["messages"][1]["content"]
    assert "Your first draft for this step is a note action" in prompt and '"title":"rates"' in prompt
    assert ledger.usage_today() == {"api.groq.com": {"write": [1, 5000, 300]}}

    # The journal still goes remote first, and its tokens are counted under their own kind.
    remote_text = make_compat(groq_like(seen, "A journal entry.", usage=(900, 200)))
    assert FallbackModel([remote_text], drafting, ledger=ledger, remote_for="writing").complete("s", "p") == "A journal entry."
    assert ledger.usage_today()["api.groq.com"]["complete"] == [1, 900, 200]


def test_writing_mode_keeps_the_local_draft_when_no_remote_provider_answers():
    down = make_compat(lambda r: httpx.Response(429, json={}), clock=Clock(0.0))
    drafting = Local({"type": "note", "title": "rates", "body": "cheap"})
    model = FallbackModel([down], drafting, clock=Clock(0.0), remote_for="writing")
    result = model.decide("s", obs())
    assert result.decision.thought == "local" and result.decision.action.title == "rates"
    # Benched now: the next draft does not even try it.
    assert model.decide("s", obs()).decision.thought == "local"


def test_token_budget_waits_briefly_or_benches_instead_of_spending_a_request_on_a_429():
    clock = Clock(1000.0)
    slept: list[float] = []
    seen: list[dict] = []
    cfg = ModelConfig(provider="remote", max_retries=0, num_predict=700, token_wait_seconds=20)
    provider = groq_provider()
    model = OpenAICompatModel(cfg, provider, "k", transport=httpx.MockTransport(groq_like(seen, DECISION, remaining="500")),
                              clock=clock, sleep=slept.append)
    assert model.decide("s", obs()).decision is not None and len(seen) == 1
    assert model.tokens_remaining == 500 and model.tokens_limit == 8000 and model.tokens_full_at == 1030.0

    # A small call needs ~1,000 tokens, 500 short: at 8,000 a minute that refills in under 4 s, so it waits.
    assert model.complete("s", "p" * 1000) != "" and len(seen) == 2
    assert len(slept) == 1 and 0 < slept[0] < 5

    # A big call 4,000 short would wait 30 s (until full), longer than token_wait_seconds: benched instead.
    model.tokens_remaining, model.tokens_full_at = 500, clock.t + 30
    big = model.decide("s" * 14000, obs())
    assert big.decision is None and "token budget" in (big.error or "") and len(seen) == 2
    assert model.unavailable_until == clock.t + 30

    # Once the minute has passed, the stale budget is ignored.
    clock.t += 31
    model.unavailable_until = 0.0
    assert model.decide("s", obs()).decision is not None and len(seen) == 3


def test_remote_for_is_validated(tmp_path):
    import pytest

    from explorer.config import Config, validate

    cfg = Config(root=tmp_path)
    cfg.model.remote_for = "sometimes"
    with pytest.raises(ValueError, match="remote_for"):
        validate(cfg)


def test_a_dropped_key_file_joins_the_chain_without_a_config_edit(tmp_path, monkeypatch):
    from explorer.common.fallback import build_model, discovered_providers, effective_chain
    from explorer.config import ModelConfig

    monkeypatch.setenv("EXPLORER_KEYS_DIR", str(tmp_path))
    for name in ("GROQ_API_KEY", "SAMBANOVA_API_KEY", "CEREBRAS_API_KEY"):
        monkeypatch.delenv(name, raising=False)
    (tmp_path / "groq.key").write_text("gsk-a\n")
    cfg = ModelConfig(provider="remote", fallback_provider="fake", provider_chain=["groq", "gemini"])

    assert discovered_providers(cfg) == []  # groq is already in the chain; nothing else has a key
    (tmp_path / "sambanova.key").write_text("sk-b\n")
    assert discovered_providers(cfg) == ["sambanova"]
    assert effective_chain(cfg) == ["groq", "gemini", "sambanova"]

    model = build_model(cfg, ledger_path=tmp_path / "calls.json")
    assert [p.label for p in model.primaries] == ["api.groq.com/openai/gpt-oss-120b", "api.sambanova.ai/Meta-Llama-3.3-70B-Instruct"]

    # An explicit chain stays authoritative and nothing doubles, even with the key present.
    cfg.provider_chain = ["sambanova", "groq"]
    assert effective_chain(cfg) == ["sambanova", "groq"]
    # The flag turns discovery off.
    cfg.provider_chain = ["groq"]
    cfg.auto_discover_providers = False
    assert effective_chain(cfg) == ["groq"]


def test_provider_first_reorders_the_shared_chain_and_never_shortens_it(tmp_path, monkeypatch):
    from explorer.common.fallback import effective_chain
    from explorer.config import ModelConfig

    monkeypatch.setenv("EXPLORER_KEYS_DIR", str(tmp_path))
    cfg = ModelConfig(provider="remote", fallback_provider="fake", provider_chain=["zai", "gemini", "groq", "ollama-cloud"],
                      auto_discover_providers=False)
    assert effective_chain(cfg) == ["zai", "gemini", "groq", "ollama-cloud"]
    cfg.provider_first = ["ollama-cloud", "ollama-cloud"]
    assert effective_chain(cfg) == ["ollama-cloud", "zai", "gemini", "groq"]
    cfg.provider_first = ["speka"]  # not in the shared chain: joins at the front, nothing is dropped
    assert effective_chain(cfg) == ["speka", "zai", "gemini", "groq", "ollama-cloud"]


def test_provider_first_names_are_validated(tmp_path):
    import pytest

    from explorer.config import load_config

    cfg_file = tmp_path / "config.toml"
    cfg_file.write_text('[model]\nprovider = "remote"\nprovider_chain = ["groq"]\nprovider_first = ["nope-not-real"]\n')
    with pytest.raises(ValueError, match="unknown provider 'nope-not-real'"):
        load_config(cfg_file, root=tmp_path)


def test_known_provider_config_needs_no_table():
    from explorer.config import ModelConfig
    from explorer.model import provider_config

    prov = provider_config("sambanova", ModelConfig())
    assert prov.base_url == "https://api.sambanova.ai/v1" and prov.api_key_env == "SAMBANOVA_API_KEY"
    assert prov.api_key_file.endswith("/sambanova.key")
    import pytest

    with pytest.raises(KeyError):
        provider_config("nope-not-real", ModelConfig())


def test_paced_delay_stretches_when_tokens_run_ahead_of_the_clock():
    from explorer.common.fallback import paced_delay

    # No budget, or on/under pace: the base delay.
    assert paced_delay(45, 0, 999999, 0.5) == 45
    assert paced_delay(45, 200_000, 100_000, 0.5) == 45  # half the tokens at midday: on pace
    assert paced_delay(45, 200_000, 40_000, 0.5) == 45  # under pace
    # Ahead of pace: delay grows in proportion, capped.
    assert paced_delay(45, 200_000, 100_000, 0.25) == 90  # 50% used a quarter into the day -> 2x
    assert paced_delay(45, 200_000, 200_000, 0.25) == 180  # all tokens a quarter in -> 4x
    assert paced_delay(45, 200_000, 200_000, 0.1, cap=300) == 300  # 10x = 450, capped at 300
    assert paced_delay(60, 200_000, 200_000, 0.1) == 600  # 10x, no cap
