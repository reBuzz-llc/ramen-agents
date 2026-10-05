"""The Replicate adapter: a prediction-based (not OpenAI) provider, opted into with a key."""
from __future__ import annotations

import json

import httpx

from explorer.config import KNOWN_PROVIDERS, ModelConfig
from explorer.model import ProviderUnavailable, ReplicateModel, provider_config
from explorer.prompts import Observation


def obs() -> Observation:
    return Observation(
        cycle=1, episode_id=1, episode_actions=0, episode_budget=6, pages_last_hour=0, pages_budget=60,
        current_question_id=None, current_question=None, interests=[], open_questions=[],
        open_questions_count=0, recent_notes=[], recent_actions=[], page=None, page_noted=False,
        page_text_window="", page_has_more=False,
    )


DECISION = json.dumps({"thought": "look", "action": {"type": "search", "query": "tides"}})


def make(handler, **over):
    cfg = ModelConfig(provider="remote", max_retries=1, **over)
    prov = provider_config("replicate", cfg)
    return ReplicateModel(cfg, prov, "r8-test", transport=httpx.MockTransport(handler), clock=lambda: 0.0, sleep=lambda s: None), prov


def test_known_provider_is_replicate_kind():
    prov = provider_config("replicate", ModelConfig())
    assert prov.kind == "replicate" and prov.base_url == "https://api.replicate.com/v1"
    assert KNOWN_PROVIDERS["replicate"]["kind"] == "replicate"


def test_a_synchronous_prediction_is_read_as_the_reply():
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        assert request.url.path == "/v1/models/meta/meta-llama-3-70b-instruct/predictions"
        body = json.loads(request.content)
        assert "prompt" in body["input"] and "system_prompt" in body["input"]
        return httpx.Response(201, json={"status": "succeeded", "output": [DECISION[:10], DECISION[10:]]})

    model, _ = make(handler)
    result = model.decide("system", obs())
    assert result.decision is not None and result.decision.action.type == "search"
    assert seen[0].headers["authorization"] == "Bearer r8-test" and seen[0].headers["prefer"].startswith("wait")
    assert model.last_usage is None  # billed by time, not tokens


def test_a_running_prediction_is_polled_until_it_finishes():
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST":
            return httpx.Response(201, json={"status": "processing", "urls": {"get": "https://api.replicate.com/v1/predictions/abc"}})
        calls["n"] += 1
        if calls["n"] < 2:
            return httpx.Response(200, json={"status": "processing", "urls": {"get": "https://api.replicate.com/v1/predictions/abc"}})
        return httpx.Response(200, json={"status": "succeeded", "output": [DECISION]})

    model, _ = make(handler)
    assert model.decide("s", obs()).decision is not None and calls["n"] == 2


def test_payment_and_rate_limit_bench_the_provider():
    out_of_credit, _ = make(lambda r: httpx.Response(402, json={"detail": "insufficient credit"}))
    res = out_of_credit.decide("s", obs())
    assert res.decision is None and out_of_credit.unavailable_until == 3600.0 and "out of credit" in (res.error or "")
    limited, _ = make(lambda r: httpx.Response(429, headers={"retry-after": "30"}, json={}))
    limited.decide("s", obs())
    assert limited.unavailable_until == 30.0


def test_a_failed_prediction_is_not_a_reply():
    model, _ = make(lambda r: httpx.Response(201, json={"status": "failed", "error": "model error"}))
    res = model.decide("s", obs())
    assert res.decision is None and "failed" in (res.error or "")


def test_build_model_routes_replicate_by_kind(tmp_path, monkeypatch):
    from explorer.common.fallback import build_model

    monkeypatch.setenv("EXPLORER_KEYS_DIR", str(tmp_path))
    (tmp_path / "replicate.key").write_text("r8-abc\n")
    cfg = ModelConfig(provider="remote", fallback_provider="fake", provider_chain=["replicate"])
    model = build_model(cfg, ledger_path=tmp_path / "calls.json")
    assert [type(p).__name__ for p in model.primaries] == ["ReplicateModel"]
    assert model.primaries[0].label == "replicate/meta/meta-llama-3-70b-instruct"


def test_paid_providers_never_auto_join_but_free_ones_do(tmp_path, monkeypatch):
    from explorer.common.fallback import discovered_providers

    monkeypatch.setenv("EXPLORER_KEYS_DIR", str(tmp_path))
    for n in ("replicate", "sambanova", "openai"):
        (tmp_path / f"{n}.key").write_text("k\n")
    cfg = ModelConfig(provider="remote", provider_chain=["groq"])
    found = discovered_providers(cfg)
    assert "sambanova" in found  # free, no card -> auto
    assert "replicate" not in found and "openai" not in found  # paid -> opt-in only
