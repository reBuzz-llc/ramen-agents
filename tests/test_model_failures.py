"""The two causes of The CEO's "Models keep failing" alerts (2026-09-25): a reply with the action keyed by
its own name, and a prompt too big for Groq's free tier benching Groq for every call."""
from __future__ import annotations

import json

import httpx

from explorer.actions import parse_decision
from explorer.common.fallback import FallbackModel
from explorer.config import ModelConfig
from explorer.model import SKIP_THIS_CALL, FakeModel, GeminiModel, OpenAICompatModel

from test_remote_providers import DECISION, Clock, chat_reply, groq_provider, obs

TOO_LARGE = {
    "error": {
        "message": "Request too large for model `openai/gpt-oss-120b` on tokens per minute (TPM): "
        "Limit 8000, Requested 8288, please reduce your message size and try again.",
        "type": "tokens",
        "code": "rate_limit_exceeded",
    }
}


# ---- the action keyed by its own name --------------------------------------------------------------


def test_an_action_keyed_by_its_own_name_is_repaired():
    reply = json.dumps({"thought": "a task for Jo", "action": {"task": {"title": "Build the list", "details": "x" * 40}}})
    decision = parse_decision(reply)
    assert decision.action.type == "task"
    assert decision.action.title == "Build the list"
    assert decision.thought == "a task for Jo"


def test_the_repair_also_takes_a_redundant_inner_type():
    reply = json.dumps({"thought": "", "action": {"search": {"type": "search", "query": "biotech SPF"}}})
    assert parse_decision(reply).action.query == "biotech SPF"


def test_other_invalid_shapes_are_still_rejected():
    import pytest
    from pydantic import ValidationError

    for bad in (
        {"thought": "", "action": {"frobnicate": {"x": 1}}},  # not an action type
        {"thought": "", "action": {"task": "a string"}},  # not an object
        {"thought": "", "action": {"task": {}, "note": {}}},  # two candidates: no guessing
        {"thought": "", "action": {"type": "search"}},  # has a type, just missing fields
    ):
        with pytest.raises(ValidationError):
            parse_decision(json.dumps(bad))


# ---- a prompt too large for the provider ------------------------------------------------------------


def test_a_413_skips_the_provider_for_this_call_only_and_the_chain_moves_on():
    clock = Clock(100.0)
    calls: list[str] = []

    def groq(request: httpx.Request) -> httpx.Response:
        calls.append("groq")
        return httpx.Response(413, json=TOO_LARGE)

    def gemini(request: httpx.Request) -> httpx.Response:
        calls.append("gemini")
        return httpx.Response(200, json={"candidates": [{"content": {"parts": [{"text": DECISION}]}}]})

    cfg = ModelConfig(provider="remote", max_retries=0)
    first = OpenAICompatModel(cfg, groq_provider(), "k", transport=httpx.MockTransport(groq), clock=clock)
    second = GeminiModel(cfg, "k", transport=httpx.MockTransport(gemini), clock=clock)
    model = FallbackModel([first, second], FakeModel(), clock=clock)

    result = model.decide("s", obs())
    assert result.decision is not None and result.decision.action.type == "search"
    assert calls == ["groq", "gemini"]  # Groq tried, then the next provider answered: no model failure
    assert first.unavailable_until == clock.t + SKIP_THIS_CALL  # seconds, not the old 15-minute bench
    assert first.tokens_limit == 8000  # learned from the error message


def test_once_the_limit_is_known_an_oversized_request_is_not_sent_at_all():
    clock = Clock(100.0)
    sent: list[int] = []

    def groq(request: httpx.Request) -> httpx.Response:
        sent.append(len(request.content))
        return chat_reply(DECISION)

    model = OpenAICompatModel(ModelConfig(provider="remote", max_retries=0), groq_provider(), "k",
                              transport=httpx.MockTransport(groq), clock=clock)
    model.tokens_limit = 8000

    big = model.decide("x" * 40_000, obs())  # ~11k tokens: can never fit
    assert big.decision is None and "cannot take a request this size" in (big.error or "")
    assert sent == []  # no round trip spent on a certain rejection

    clock.t += SKIP_THIS_CALL + 1  # the next, small call
    small = model.decide("a short system prompt", obs())
    assert small.decision is not None and len(sent) == 1  # Groq still serves what fits


def test_a_real_rate_limit_still_benches_the_provider():
    clock = Clock(100.0)

    def groq(request: httpx.Request) -> httpx.Response:
        return httpx.Response(429, json={})

    model = OpenAICompatModel(ModelConfig(provider="remote", max_retries=0), groq_provider(cooldown_minutes=15), "k",
                              transport=httpx.MockTransport(groq), clock=clock)
    model.decide("s", obs())
    assert model.unavailable_until == clock.t + 15 * 60  # unchanged: a 429 is not a 413
