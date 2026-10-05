"""Gemini provider with a local fallback: JSON decisions, quota handling, cooldown, key loading."""
from __future__ import annotations

import json
from pathlib import Path

import httpx

from explorer.config import ModelConfig
from explorer.common.fallback import FallbackModel, build_model
from explorer.model import FakeModel, GeminiModel, load_gemini_key
from explorer.prompts import Observation


def obs() -> Observation:
    return Observation(
        cycle=1, episode_id=1, episode_actions=0, episode_budget=6, pages_last_hour=0, pages_budget=60,
        current_question_id=None, current_question=None, interests=[("tides", 0.6)], open_questions=[],
        open_questions_count=0, recent_notes=[], recent_actions=[], page=None, page_noted=False,
        page_text_window="", page_has_more=False,
    )


def gemini_reply(text: str) -> httpx.Response:
    return httpx.Response(200, json={"candidates": [{"content": {"parts": [{"text": text}]}}]})


class Clock:
    def __init__(self, t: float = 1000.0):
        self.t = t

    def __call__(self) -> float:
        return self.t


def make_gemini(handler, clock=None, **over) -> GeminiModel:
    cfg = ModelConfig(provider="gemini", max_retries=1, **over)
    return GeminiModel(cfg, "test-key", transport=httpx.MockTransport(handler), clock=clock or Clock())


def test_decide_parses_a_json_reply_and_sends_json_mode():
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return gemini_reply(json.dumps({"thought": "look", "action": {"type": "search", "query": "tides"}}))

    model = make_gemini(handler)
    result = model.decide("system", obs())
    assert result.decision is not None
    assert result.decision.action.type == "search"
    assert result.attempts == 1
    body = json.loads(seen[0].content)
    assert body["generationConfig"]["responseMimeType"] == "application/json"
    assert body["systemInstruction"]["parts"][0]["text"] == "system"
    assert seen[0].headers["x-goog-api-key"] == "test-key" and "key=" not in str(seen[0].url)
    assert "gemini-3.6-flash:generateContent" in str(seen[0].url)


def test_invalid_reply_is_retried_with_the_error():
    replies = iter(["not json at all", json.dumps({"thought": "", "action": {"type": "rest", "seconds": 5}})])
    requests: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(json.loads(request.content))
        return gemini_reply(next(replies))

    result = make_gemini(handler).decide("s", obs())
    assert result.decision is not None and result.attempts == 2
    assert "not valid" in requests[1]["contents"][-1]["parts"][0]["text"]


def test_429_marks_the_provider_unavailable_for_the_cooldown():
    clock = Clock(1000.0)
    model = make_gemini(lambda r: httpx.Response(429, json={"error": {"message": "quota"}}), clock=clock, gemini_cooldown_minutes=15)
    result = model.decide("s", obs())
    assert result.decision is None and "429" in (result.error or "")
    assert model.unavailable_until == 1000.0 + 15 * 60
    assert model.complete("s", "p") == ""  # also marks, never raises


def test_bad_key_backs_off_for_an_hour_and_network_errors_briefly():
    clock = Clock(0.0)
    bad = make_gemini(lambda r: httpx.Response(400, json={"error": {"message": "API key not valid"}}), clock=clock)
    bad.decide("s", obs())
    assert bad.unavailable_until == 3600.0

    def boom(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("down")

    down = make_gemini(boom, clock=clock)
    down.decide("s", obs())
    assert down.unavailable_until == 120.0


def test_fallback_switches_on_quota_and_returns_after_cooldown():
    clock = Clock(0.0)
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        if calls["n"] == 1:
            return httpx.Response(429, json={})
        return gemini_reply(json.dumps({"thought": "", "action": {"type": "rest", "seconds": 1}}))

    primary = make_gemini(handler, clock=clock, gemini_cooldown_minutes=1)
    model = FallbackModel(primary, FakeModel(), clock=clock)

    first = model.decide("s", obs())  # 429 -> fallback answers
    assert first.decision is not None and first.decision.thought == "fake model heuristic"
    assert model.using_fallback and calls["n"] == 1

    second = model.decide("s", obs())  # still in cooldown: primary not even called
    assert second.decision.thought == "fake model heuristic" and calls["n"] == 1

    clock.t = 61.0
    third = model.decide("s", obs())  # cooldown over: primary tried and answers
    assert third.decision.action.type == "rest" and calls["n"] == 2
    assert not model.using_fallback

    assert model.complete("s", "journal") != ""  # primary text path


def test_fallback_does_not_switch_on_an_invalid_reply():
    clock = Clock(0.0)
    primary = make_gemini(lambda r: gemini_reply("garbage"), clock=clock)
    model = FallbackModel(primary, FakeModel(), clock=clock)
    result = model.decide("s", obs())
    assert result.decision is None and "invalid reply" in (result.error or "")
    assert not model.using_fallback


def test_load_gemini_key_prefers_env_then_file(tmp_path: Path, monkeypatch):
    key_file = tmp_path / "gemini_api_key"
    cfg = ModelConfig(provider="gemini", gemini_api_key_env="EXPLORER_TEST_GEMINI", gemini_api_key_file=str(key_file))
    monkeypatch.delenv("EXPLORER_TEST_GEMINI", raising=False)
    assert load_gemini_key(cfg) is None
    key_file.write_text("  from-file \n")
    assert load_gemini_key(cfg) == "from-file"
    monkeypatch.setenv("EXPLORER_TEST_GEMINI", "from-env")
    assert load_gemini_key(cfg) == "from-env"


def test_build_model_without_a_key_runs_on_the_fallback_only(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("EXPLORER_KEYS_DIR", str(tmp_path))  # no auto-discovery from the real key folder
    cfg = ModelConfig(
        provider="gemini", fallback_provider="fake",
        gemini_api_key_env="EXPLORER_TEST_GEMINI", gemini_api_key_file=str(tmp_path / "missing"),
    )
    monkeypatch.delenv("EXPLORER_TEST_GEMINI", raising=False)
    assert isinstance(build_model(cfg), FakeModel)
    monkeypatch.setenv("EXPLORER_TEST_GEMINI", "k")
    assert isinstance(build_model(cfg), FallbackModel)
    assert isinstance(build_model(ModelConfig(provider="fake")), FakeModel)


def test_gemini_fallback_models_follow_the_main_one_and_are_benched_separately(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("EXPLORER_KEYS_DIR", str(tmp_path))
    monkeypatch.setenv("EXPLORER_TEST_GEMINI", "k")
    cfg = ModelConfig(
        provider="remote", fallback_provider="fake", provider_chain=["gemini"], gemini_api_key_env="EXPLORER_TEST_GEMINI",
        gemini_api_key_file=str(tmp_path / "missing"), gemini_model="gemini-3.6-flash",
        gemini_fallback_models=["gemini-flash-lite-latest", "gemini-3.6-flash", " "],
    )
    model = build_model(cfg, ledger_path=tmp_path / "calls.json")
    assert [p.label for p in model.primaries] == ["gemini/gemini-3.6-flash", "gemini/gemini-flash-lite-latest"]

    # The main model is busy (503): the lite model answers, and only the busy one is benched.
    calls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request.url.path.rsplit("/", 1)[-1])
        if "3.6-flash" in request.url.path:
            return httpx.Response(503, json={"error": {"message": "overloaded"}})
        return gemini_reply(json.dumps({"thought": "lite", "action": {"type": "rest", "seconds": 1}}))

    clock = Clock(0.0)
    main = GeminiModel(cfg, "k", transport=httpx.MockTransport(handler), clock=clock)
    from dataclasses import replace

    lite = GeminiModel(replace(cfg, gemini_model="gemini-flash-lite-latest"), "k", transport=httpx.MockTransport(handler), clock=clock)
    chain = FallbackModel([main, lite], FakeModel(), clock=clock)
    assert chain.decide("s", obs()).decision.thought == "lite"
    assert calls == ["gemini-3.6-flash:generateContent", "gemini-flash-lite-latest:generateContent"]
    assert main.unavailable_until == 300.0 and lite.unavailable_until == 0.0


def test_available_sends_the_key_in_a_header_never_the_url():
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"name": "models/gemini-test"})

    ok, _ = make_gemini(handler).available()
    assert ok
    assert seen[0].headers["x-goog-api-key"] == "test-key"
    assert "test-key" not in str(seen[0].url)


def test_the_ledger_totals_tokens_per_bot_for_budget_scope_bot(tmp_path):
    from explorer.common.fallback import CallLedger

    a = CallLedger(tmp_path / "ledger.json", bot="Lead Gen")
    b = CallLedger(tmp_path / "ledger.json", bot="The CEO")
    a.add_usage("api.z.ai", "write", 1000, 200)
    b.add_usage("ollama.com", "decide", 7000, 500)
    b.add_usage("ollama.com", "decide", 7000, 500)
    assert a.tokens_today("Lead Gen") == 1200 and a.tokens_today("The CEO") == 15000
    assert a.tokens_today() == 16200  # the machine-wide figure is unchanged
    assert CallLedger(tmp_path / "ledger.json").tokens_today("Nobody") == 0
