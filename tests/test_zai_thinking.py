"""z.ai's glm-4.5-flash is asked not to think: its reasoning ate the whole max_tokens (creatorCC queue 14, 2026-10-29)."""
from __future__ import annotations

import json
import logging

import httpx

from explorer.config import ModelConfig
from explorer.model import OpenAICompatModel

from test_remote_providers import DECISION, chat_reply, groq_provider, obs


def _model(base_url, seen, reply=None):
    def handler(request):
        seen.append(json.loads(request.content))
        return reply or chat_reply(json.dumps(DECISION))
    return OpenAICompatModel(ModelConfig(provider="remote", max_retries=0), groq_provider(name="zai", base_url=base_url, model="glm-4.5-flash"),
                             "k", transport=httpx.MockTransport(handler))


def test_zai_requests_carry_thinking_disabled_and_other_providers_do_not():
    seen = []
    _model("https://api.z.ai/api/paas/v4", seen).decide("sys", obs())
    _model("https://api.groq.com/openai/v1", seen).decide("sys", obs())
    assert seen[0]["thinking"] == {"type": "disabled"} and "thinking" not in seen[1]


def test_a_reply_cut_at_max_tokens_is_logged(caplog):
    seen = []
    cut = httpx.Response(200, json={"choices": [{"finish_reason": "length", "message": {"content": json.dumps(DECISION)}}]})
    m = _model("https://api.z.ai/api/paas/v4", seen, cut)
    m.logger.propagate = True
    with caplog.at_level(logging.WARNING):
        m.decide("sys", obs())
    assert any("stopped at max_tokens" in r.getMessage() for r in caplog.records)
