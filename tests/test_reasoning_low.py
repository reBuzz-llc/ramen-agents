"""Hidden reasoning turned down per provider, as the 2026-10-29 probes showed each API takes it (creatorCC queue 18)."""
from __future__ import annotations

import json

import httpx

from explorer.config import ModelConfig
from explorer.model import GeminiModel, OpenAICompatModel, provider_config

from test_remote_providers import DECISION, chat_reply, obs


def _sent(name, spec):
    seen = []

    def handler(request):
        seen.append(json.loads(request.content))
        return chat_reply(json.dumps(DECISION))
    cfg = ModelConfig(provider="remote", max_retries=0, providers={name: spec})
    OpenAICompatModel(cfg, provider_config(name, cfg), "k", transport=httpx.MockTransport(handler)).decide("sys", obs())
    return seen[0]


def test_groq_speka_and_ollama_cloud_send_reasoning_effort_low():
    for name, url, model in (("groq", "https://api.groq.com/openai/v1", "openai/gpt-oss-120b"), ("speka", "https://speka.me/v1", "openai/gpt-oss-20b"),
                             ("ollama-cloud", "https://ollama.com/v1", "gpt-oss:120b")):
        body = _sent(name, {"base_url": url, "model": model, "reasoning_effort": "low"})
        assert body["reasoning_effort"] == "low" and "thinking" not in body, name


def test_a_provider_without_the_setting_sends_nothing_new_and_a_floor_raises_max_tokens():
    plain = _sent("mistral", {"base_url": "https://api.mistral.ai/v1", "model": "mistral-small-latest"})
    assert "reasoning_effort" not in plain and plain["max_tokens"] == ModelConfig().num_predict
    assert _sent("mistral", {"base_url": "https://api.mistral.ai/v1", "model": "m", "max_tokens": 2048})["max_tokens"] == 2048


def _gemini_body(model):
    seen = []

    def handler(request):
        seen.append(json.loads(request.content))
        return httpx.Response(200, json={"candidates": [{"content": {"parts": [{"text": json.dumps(DECISION)}]}}]})
    cfg = ModelConfig(provider="gemini", gemini_model=model, max_retries=0, gemini_thinking_level="low", gemini_max_output_tokens=2048)
    GeminiModel(cfg, "k", transport=httpx.MockTransport(handler)).decide("sys", obs())
    return seen[0]["generationConfig"]


def test_gemini_3_gets_a_low_thinking_level_and_a_2048_cap_and_an_older_model_no_new_field():
    g3 = _gemini_body("gemini-3.6-flash")
    assert g3["thinkingConfig"] == {"thinkingLevel": "low"} and g3["maxOutputTokens"] == 2048
    lite = _gemini_body("gemini-flash-lite-latest")
    assert "thinkingConfig" not in lite and lite["maxOutputTokens"] == 2048


def test_the_shared_config_with_the_new_keys_loads(tmp_path):
    from explorer.config import load_config
    (tmp_path / "config.toml").write_text('[model]\nprovider = "remote"\nprovider_chain = ["groq"]\ngemini_thinking_level = "low"\n'
                                          'gemini_max_output_tokens = 2048\n\n[model.providers.groq]\nbase_url = "https://api.groq.com/openai/v1"\n'
                                          'model = "openai/gpt-oss-120b"\nreasoning_effort = "low"\nmax_tokens = 1200\n')
    c = load_config(tmp_path / "config.toml")
    p = provider_config("groq", c.model)
    assert (p.reasoning_effort, p.max_tokens, c.model.gemini_thinking_level, c.model.gemini_max_output_tokens) == ("low", 1200, "low", 2048)
