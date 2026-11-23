"""The decide loop every adapter shares (model.decide_with_retries), and the Ollama request both the
agent's model and the chat partner send (model.ollama_chat)."""
from __future__ import annotations

import json

import httpx

from explorer.chat_partner import OllamaChatPartner
from explorer.config import ChatPartnerConfig, ModelConfig
from explorer.model import OllamaModel, ProviderUnavailable, decide_with_retries

from test_remote_providers import DECISION, chat_reply, make_compat, obs


def clock() -> float:
    return 0.0


def test_invalid_then_valid_reply_shows_the_model_its_mistake():
    sent: list[list[dict]] = []
    replies = iter(["", DECISION])

    def send(messages):
        sent.append(messages)
        return next(replies)

    result = decide_with_retries(send, [{"role": "user", "content": "go"}], max_retries=2, clock=clock,
                                 stop_on=(ProviderUnavailable,), on_stop=str, empty_reply="(empty)")
    assert result.decision is not None and result.attempts == 2
    assert sent[1][-2] == {"role": "assistant", "content": "(empty)"}
    assert sent[1][-1]["content"].startswith("That reply was not valid. invalid reply:")


def test_a_stop_exception_ends_the_loop_at_once_with_its_error():
    calls: list[int] = []

    def send(messages):
        calls.append(1)
        raise ProviderUnavailable("groq rate limit (429)", 60.0)

    stopped: list[BaseException] = []
    result = decide_with_retries(send, [], max_retries=3, clock=clock, stop_on=(ProviderUnavailable,),
                                 on_stop=lambda exc: stopped.append(exc) or f"stopped: {exc}")
    assert result.decision is None and result.attempts == 1 and calls == [1]
    assert result.error == "stopped: groq rate limit (429)" and len(stopped) == 1


def test_a_body_that_is_not_json_counts_as_an_invalid_reply_not_a_crash():
    def send(messages):
        raise json.JSONDecodeError("Expecting value", "<html>", 0)

    result = decide_with_retries(send, [], max_retries=1, clock=clock, stop_on=(ProviderUnavailable,), on_stop=str)
    assert result.decision is None and result.attempts == 2 and result.error.startswith("invalid reply")


def ollama(handler) -> OllamaModel:
    model = OllamaModel(ModelConfig(provider="ollama", max_retries=2))
    model.client = httpx.Client(base_url="http://ollama.test", transport=httpx.MockTransport(handler))
    return model


def test_ollama_falls_back_from_schema_to_json_mode_inside_one_attempt_then_retries_invalid_replies():
    bodies: list[dict] = []
    replies = iter(["not json", DECISION])

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        bodies.append(body)
        if isinstance(body.get("format"), dict):
            return httpx.Response(400, json={"error": "schema not supported"})
        return httpx.Response(200, json={"message": {"content": next(replies)}})

    model = ollama(handler)
    result = model.decide("system", obs())
    assert result.decision is not None and result.attempts == 2
    assert isinstance(bodies[0]["format"], dict) and bodies[1]["format"] == "json" and bodies[2]["format"] == "json"
    assert model.schema_supported is False
    assert bodies[1]["keep_alive"] == model.cfg.keep_alive and bodies[1]["options"]["num_ctx"] == model.cfg.num_ctx
    assert bodies[2]["messages"][0] == {"role": "system", "content": "system"}


def test_ollama_network_error_stops_with_an_ollama_error():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused", request=request)

    result = ollama(handler).decide("system", obs())
    assert result.decision is None and result.attempts == 1
    assert result.error.startswith("ollama error: ConnectError")


def test_compat_paces_and_records_usage_on_every_attempt(monkeypatch):
    replies = iter(["nonsense", DECISION])
    model = make_compat(lambda request: chat_reply(next(replies)))
    paced: list[int] = []
    monkeypatch.setattr(model, "_pace", lambda messages, max_tokens: paced.append(len(messages)))
    result = model.decide("s", obs())
    assert result.decision is not None and result.attempts == 2
    assert paced == [2, 4]  # the retry carries the bad reply and the correction


def test_chat_partner_sends_the_shared_ollama_request_without_keep_alive_or_format():
    seen: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(json.loads(request.content))
        return httpx.Response(200, json={"message": {"content": "  hello  "}})

    cfg = ChatPartnerConfig(enabled=True)
    partner = OllamaChatPartner(cfg)
    partner.client = httpx.Client(base_url="http://ollama.test", transport=httpx.MockTransport(handler))
    assert partner.reply("be brief", [{"role": "user", "content": "hi"}]) == "hello"
    body = seen[0]
    assert body["model"] == cfg.model and body["stream"] is False
    assert "keep_alive" not in body and "format" not in body
    assert body["messages"] == [{"role": "system", "content": "be brief"}, {"role": "user", "content": "hi"}]
