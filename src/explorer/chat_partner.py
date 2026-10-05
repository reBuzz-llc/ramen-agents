"""A second local model the agent can talk to. Only active when [chat_partner] is enabled.

The partner's replies reach the agent as plain text, exactly like page text or a completion from
its own model, never as anything closer to instructions. See controller.py's Say handling and
policy.py's `_check` for the caps that keep a conversation from becoming the whole episode.
"""
from __future__ import annotations

import logging
from typing import Protocol

import httpx

from .config import ChatPartnerConfig
from .model import ollama_chat


class ChatPartner(Protocol):
    def reply(self, system: str, turns: list[dict[str, str]]) -> str: ...


class FakeChatPartner:
    """Deterministic partner for tests and fake mode. No LLM, no network."""

    def __init__(self) -> None:
        self.calls = 0
        self.last_system = ""

    def reply(self, system: str, turns: list[dict[str, str]]) -> str:
        self.calls += 1
        self.last_system = system
        last = turns[-1]["content"] if turns else ""
        return f"(fake partner reply #{self.calls} to: {last[:60]})"


class OllamaChatPartner:
    """Talks to a second persona over Ollama's HTTP API, same shape as model.py's OllamaModel."""

    def __init__(self, cfg: ChatPartnerConfig, logger: logging.Logger | None = None):
        self.cfg = cfg
        self.logger = logger or logging.getLogger("explorer.chat_partner")
        self.client = httpx.Client(
            base_url=cfg.host.rstrip("/"), timeout=httpx.Timeout(cfg.timeout_seconds, connect=10.0)
        )

    def reply(self, system: str, turns: list[dict[str, str]]) -> str:
        messages = [{"role": "system", "content": system}] + turns
        try:
            return ollama_chat(
                self.client,
                self.cfg.model,
                messages,
                temperature=self.cfg.temperature,
                num_ctx=self.cfg.num_ctx,
                num_predict=self.cfg.num_predict,
            ).strip()
        except httpx.HTTPError as exc:
            self.logger.warning("chat partner unreachable: %s", exc)
            return ""
