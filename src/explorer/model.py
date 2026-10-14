"""Model adapters. The agent loop only sees the Model protocol."""
from __future__ import annotations

import json
import logging
import os
import time
from dataclasses import dataclass
from typing import Any, Callable, Protocol

import httpx
from pydantic import ValidationError

from .actions import Ask, Decision, Follow, Note, Open, Rest, Search, Summarize, decision_schema, parse_decision
from .config import ModelConfig
from .common.keys import key_file, load_key
from .prompts import Observation

# How long a provider sits out after a request it cannot take (too large for it), as opposed to a rate
# limit. Long enough that the fallback sees it as down and moves on to the next provider for this call
# (FallbackModel.decide only moves past a provider that is down), short enough that the next, smaller
# call -- seconds later at the earliest -- has it back.
SKIP_THIS_CALL = 5.0


@dataclass
class ModelResult:
    decision: Decision | None
    raw: str = ""
    error: str | None = None
    latency: float = 0.0
    attempts: int = 1


class Model(Protocol):
    def decide(self, system: str, observation: Observation) -> ModelResult: ...

    def complete(self, system: str, prompt: str) -> str: ...


class FakeModel:
    """A deterministic heuristic explorer. No LLM. Used for tests and Milestone 1."""

    def __init__(self) -> None:
        self.calls = 0
        self.tried_login = False   # once a session it walks into a login page, so the demo shows the fence refusing it

    def decide(self, system: str, obs: Observation) -> ModelResult:
        self.calls += 1
        page = obs.page
        action: Any
        if obs.episode_actions >= obs.episode_budget:
            action = Summarize(type="summarize")
        elif self.calls == 6 and not self.tried_login:
            self.tried_login = True
            return ModelResult(decision=Decision(thought="fake model: this page asks me to sign in; let me try",
                                                 action=Open(type="open", url="fake://login.html")))
        elif page is None or not page.ok:
            if obs.interests:
                action = Search(type="search", query=obs.interests[(self.calls // 3) % len(obs.interests)][0])
            else:
                action = Open(type="open", url="fake://index.html")
        elif not obs.page_noted and page.text:
            answers = obs.current_question_id if (obs.current_question_id and self.calls % 5 == 0) else None
            action = Note(
                type="note",
                title=(page.title or page.url)[:80],
                body=page.text[:300],
                tags=["auto"],
                source_url=page.url,
                answers_question=answers,
            )
        elif self.calls % 4 == 0 and obs.open_questions_count < 10:
            action = Ask(type="ask", question=f"What else connects to {page.title or 'this page'}?")
        else:
            unvisited = [link for link in obs.links if link.url not in obs.visited_urls]
            if unvisited:
                action = Follow(type="follow", link=unvisited[0].number)
            elif obs.interests:
                action = Search(type="search", query=obs.interests[self.calls % len(obs.interests)][0])
            else:
                action = Rest(type="rest", seconds=1)
        return ModelResult(decision=Decision(thought="fake model heuristic", action=action))

    def complete(self, system: str, prompt: str) -> str:
        notes = prompt.count("\n- ")
        return (
            f"Fake journal entry. I browsed a few local pages and took about {notes} notes. "
            "Nothing surprised me because I am a heuristic, but the loop works."
        )

    def unload(self) -> None:
        """Nothing to free; counted so tests can see quiet mode asked."""
        self.unloads = getattr(self, "unloads", 0) + 1


RETRY_INSTRUCTION = 'Reply again with exactly one JSON object of the form {"thought": "...", "action": {...}}.'


def decide_with_retries(
    send: Callable[[list[dict[str, str]]], str],
    messages: list[dict[str, str]],
    *,
    max_retries: int,
    clock: Callable[[], float],
    stop_on: tuple[type[BaseException], ...],
    on_stop: Callable[[BaseException], str],
    empty_reply: str = "",
) -> ModelResult:
    """The decide loop every model adapter shares: send, parse one Decision, and on an invalid reply
    show the model its reply and the error and ask again, up to max_retries more times.

    `send` makes one request (an adapter's pacing, usage and JSON-mode fallbacks live inside it, so they
    run on every attempt). An exception in `stop_on` ends the loop at once: `on_stop` records it (bench a
    provider, log) and returns the error text. A reply that does not parse, or a body that is not JSON,
    is an invalid reply and gets another attempt. `empty_reply` is what an empty reply is echoed back as.
    """
    started = clock()
    raw = ""
    error: str | None = None
    attempt = 0
    for attempt in range(1, max_retries + 2):
        try:
            raw = send(messages)
            decision = parse_decision(raw)
            decision.thought = decision.thought.strip()[:600]
            return ModelResult(decision=decision, raw=raw, latency=clock() - started, attempts=attempt)
        except stop_on as exc:
            return ModelResult(decision=None, raw=raw, error=on_stop(exc), latency=clock() - started, attempts=attempt)
        except (ValidationError, ValueError, json.JSONDecodeError) as exc:
            error = f"invalid reply: {str(exc).splitlines()[0][:300]}"
            messages = messages + [
                {"role": "assistant", "content": raw or empty_reply},
                {"role": "user", "content": f"That reply was not valid. {error}\n{RETRY_INSTRUCTION}"},
            ]
    return ModelResult(decision=None, raw=raw, error=error, latency=clock() - started, attempts=attempt)


def ollama_chat(
    client: httpx.Client,
    model: str,
    messages: list[dict[str, str]],
    *,
    temperature: float,
    num_ctx: int,
    num_predict: int,
    keep_alive: str | None = None,
    fmt: Any = None,
) -> str:
    """One non-streaming /api/chat request to Ollama; raises httpx errors. Used by the agent's model and
    by the chat partner (chat_partner.py)."""
    body: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "stream": False,
        "options": {"temperature": temperature, "num_ctx": num_ctx, "num_predict": num_predict},
    }
    if keep_alive is not None:
        body["keep_alive"] = keep_alive
    if fmt is not None:
        body["format"] = fmt
    resp = client.post("/api/chat", json=body)
    resp.raise_for_status()
    return str(resp.json().get("message", {}).get("content", ""))


class OllamaModel:
    """Talks to a local Ollama server. Uses schema-constrained JSON for decisions."""

    def __init__(self, cfg: ModelConfig, logger: logging.Logger | None = None):
        self.cfg = cfg
        self.logger = logger or logging.getLogger("explorer")
        self.client = httpx.Client(
            base_url=cfg.host.rstrip("/"), timeout=httpx.Timeout(cfg.timeout_seconds, connect=10.0)
        )
        self.schema = decision_schema()
        self.schema_supported = True

    def _chat(self, messages: list[dict[str, str]], fmt: Any = None, num_predict: int | None = None) -> str:
        return ollama_chat(
            self.client,
            self.cfg.name,
            messages,
            temperature=self.cfg.temperature,
            num_ctx=self.cfg.num_ctx,
            num_predict=num_predict or self.cfg.num_predict,
            keep_alive=self.cfg.keep_alive,
            fmt=fmt,
        )

    def _send_decision(self, messages: list[dict[str, str]]) -> str:
        fmt: Any = self.schema if self.schema_supported else "json"
        try:
            return self._chat(messages, fmt)
        except httpx.HTTPStatusError as exc:
            if self.schema_supported and exc.response.status_code == 400:
                self.schema_supported = False
                self.logger.warning("ollama rejected the JSON schema; falling back to plain json mode")
                return self._chat(messages, "json")
            raise

    def decide(self, system: str, obs: Observation) -> ModelResult:
        messages = [{"role": "system", "content": system}, {"role": "user", "content": obs.render()}]
        return decide_with_retries(
            self._send_decision,
            messages,
            max_retries=self.cfg.max_retries,
            clock=time.time,
            stop_on=(httpx.HTTPError,),
            on_stop=lambda exc: f"ollama error: {type(exc).__name__}: {str(exc)[:200]}",
        )

    def complete(self, system: str, prompt: str) -> str:
        messages = [{"role": "system", "content": system}, {"role": "user", "content": prompt}]
        try:
            return self._chat(messages, None, num_predict=600).strip()
        except httpx.HTTPError as exc:
            self.logger.warning("ollama completion failed: %s", exc)
            return ""

    def available(self) -> tuple[bool, str]:
        try:
            resp = self.client.get("/api/tags", timeout=5.0)
            resp.raise_for_status()
        except httpx.HTTPError as exc:
            return False, f"cannot reach Ollama at {self.cfg.host}: {type(exc).__name__}"
        names = [m.get("name", "") for m in resp.json().get("models", [])]
        wanted = self.cfg.name if ":" in self.cfg.name else self.cfg.name + ":latest"
        if wanted in names or self.cfg.name in names:
            return True, f"Ollama reachable, model {self.cfg.name} present"
        return False, f"Ollama reachable but model {self.cfg.name} is not pulled (have: {', '.join(names) or 'none'})"

    def unload(self) -> None:
        """Ask Ollama to drop the model from memory now instead of after keep_alive (quiet mode)."""
        try:
            self.client.post("/api/generate", json={"model": self.cfg.name, "keep_alive": 0}, timeout=10.0)
        except httpx.HTTPError as exc:
            self.logger.debug("ollama unload failed: %s", exc)


# ---- Gemini (free tier) with a local fallback -------------------------------------------------


class ProviderUnavailable(RuntimeError):
    """The provider cannot serve right now: quota, rate limit, outage, bad key. Carries how long to wait."""

    def __init__(self, reason: str, retry_seconds: float):
        super().__init__(reason)
        self.retry_seconds = retry_seconds


def load_api_key(env_name: str, file_path: str) -> str | None:
    """A key from the env var, else from its key file (common/keys.py). None when neither has one."""
    return load_key(env_name, file_path)


def load_gemini_key(cfg: ModelConfig) -> str | None:
    return load_api_key(cfg.gemini_api_key_env, cfg.gemini_api_key_file)


@dataclass
class CompatProvider:
    """One [model.providers.<name>] table: an OpenAI-compatible endpoint and how to reach it."""

    name: str
    base_url: str
    model: str
    api_key_env: str
    api_key_file: str
    cooldown_minutes: float = 15.0
    calls_per_day: int = 0
    kind: str = "openai"  # "openai" (chat/completions) or "replicate" (predictions API)


def load_provider_key(provider: CompatProvider) -> str | None:
    return load_api_key(provider.api_key_env, provider.api_key_file)


def retry_after_seconds(resp: httpx.Response) -> float | None:
    """How long a 429 asks us to wait, from `retry-after` (seconds or an HTTP date) or Groq's
    `x-ratelimit-reset-tokens` / `-requests` ("7.66s", "1m26.4s", "577ms"). None when absent."""
    import re
    from email.utils import parsedate_to_datetime

    raw = (resp.headers.get("retry-after") or "").strip()
    if raw:
        try:
            return max(1.0, float(raw))
        except ValueError:
            try:
                return max(1.0, parsedate_to_datetime(raw).timestamp() - time.time())
            except (TypeError, ValueError):
                pass
    for header in ("x-ratelimit-reset-tokens", "x-ratelimit-reset-requests"):
        value = (resp.headers.get(header) or "").strip()
        parts = re.findall(r"(\d+(?:\.\d+)?)(ms|h|m|s)", value)
        if parts:
            scale = {"ms": 0.001, "s": 1.0, "m": 60.0, "h": 3600.0}
            return max(1.0, sum(float(n) * scale[u] for n, u in parts))
    return None


def provider_config(name: str, cfg: ModelConfig) -> CompatProvider:
    """A named [model.providers.<name>] table with its defaults filled in. Key defaults follow the
    file convention: env <NAME>_API_KEY, then ~/bots/common-data/keys/<name>.key (common/keys.py)."""
    from .config import KNOWN_PROVIDERS

    spec = cfg.providers.get(name) or KNOWN_PROVIDERS.get(name)
    if not spec:
        raise KeyError(f"unknown provider {name!r}: no [model.providers.{name}] table and not in KNOWN_PROVIDERS")
    return CompatProvider(
        name=name,
        base_url=str(spec["base_url"]),
        model=str(spec["model"]),
        api_key_env=str(spec.get("api_key_env") or f"{name.upper().replace('-', '_')}_API_KEY"),
        api_key_file=str(spec.get("api_key_file") or key_file(name)),
        cooldown_minutes=float(spec.get("cooldown_minutes", 15.0)),
        calls_per_day=int(spec.get("calls_per_day", cfg.calls_per_day)),
        kind=str(spec.get("kind", "openai")),
    )


class GeminiModel:
    """Google's Generative Language API. JSON mode for decisions, plain text for journal entries.

    Never raises out of decide()/complete(): when the provider cannot serve, it records
    `unavailable_until` and returns a failed result, so the loop's own backoff applies when it
    is used alone and FallbackModel can switch providers when it is not.
    """

    BASE = "https://generativelanguage.googleapis.com/v1beta"

    def __init__(
        self,
        cfg: ModelConfig,
        api_key: str,
        logger: logging.Logger | None = None,
        transport: httpx.BaseTransport | None = None,
        clock: Callable[[], float] = time.time,
    ):
        self.cfg = cfg
        self.api_key = api_key
        self.logger = logger or logging.getLogger("explorer")
        self.clock = clock
        self.client = httpx.Client(
            base_url=self.BASE, timeout=httpx.Timeout(cfg.timeout_seconds, connect=10.0), transport=transport
        )
        self.unavailable_until = 0.0
        self.last_error: str | None = None
        self.calls_per_day = int(cfg.calls_per_day)
        self.label = f"gemini/{cfg.gemini_model}"

    def _generate(self, system: str, messages: list[dict[str, str]], json_mode: bool, max_tokens: int) -> str:
        contents = [
            {"role": "user" if m["role"] == "user" else "model", "parts": [{"text": m["content"]}]} for m in messages
        ]
        body: dict[str, Any] = {
            "systemInstruction": {"parts": [{"text": system}]},
            "contents": contents,
            "generationConfig": {"temperature": self.cfg.temperature, "maxOutputTokens": max_tokens},
        }
        if json_mode:
            body["generationConfig"]["responseMimeType"] = "application/json"
        try:
            # The key goes in a header, never the URL: URLs end up in proxy logs and exception text.
            resp = self.client.post(
                f"/models/{self.cfg.gemini_model}:generateContent", headers={"x-goog-api-key": self.api_key}, json=body
            )
        except httpx.HTTPError as exc:
            raise ProviderUnavailable(f"gemini unreachable: {type(exc).__name__}", 120.0) from exc
        if resp.status_code == 429:
            raise ProviderUnavailable("gemini quota or rate limit (429)", self.cfg.gemini_cooldown_minutes * 60)
        if resp.status_code >= 500:
            raise ProviderUnavailable(f"gemini server error ({resp.status_code})", 300.0)
        if resp.status_code >= 400:
            # A bad key or model name will not fix itself in a minute; do not hammer the API.
            raise ProviderUnavailable(f"gemini rejected the request ({resp.status_code}): {resp.text[:200]}", 3600.0)
        data = resp.json()
        try:
            parts = data["candidates"][0]["content"]["parts"]
        except (KeyError, IndexError, TypeError):
            blocked = (data.get("promptFeedback") or {}).get("blockReason")
            self.logger.warning("gemini returned no candidates%s", f" (blocked: {blocked})" if blocked else "")
            return ""
        return "".join(str(p.get("text", "")) for p in parts if isinstance(p, dict))

    def _mark_unavailable(self, exc: ProviderUnavailable) -> None:
        self.unavailable_until = self.clock() + exc.retry_seconds
        self.last_error = str(exc)
        self.logger.warning("%s; not using gemini for %.0f minutes", exc, exc.retry_seconds / 60)

    def decide(self, system: str, obs: Observation) -> ModelResult:
        return decide_with_retries(
            lambda messages: self._generate(system, messages, True, self.cfg.num_predict),
            [{"role": "user", "content": obs.render()}],
            max_retries=self.cfg.max_retries,
            clock=self.clock,
            stop_on=(ProviderUnavailable,),
            on_stop=self._stop,
            empty_reply="(empty)",
        )

    def _stop(self, exc: BaseException) -> str:
        assert isinstance(exc, ProviderUnavailable)
        self._mark_unavailable(exc)
        return str(exc)

    def complete(self, system: str, prompt: str) -> str:
        try:
            return self._generate(system, [{"role": "user", "content": prompt}], False, 600).strip()
        except ProviderUnavailable as exc:
            self._mark_unavailable(exc)
            return ""

    def available(self) -> tuple[bool, str]:
        try:
            # The key goes in a header, never the URL, where proxies and error messages could log it.
            resp = self.client.get(f"/models/{self.cfg.gemini_model}", headers={"x-goog-api-key": self.api_key}, timeout=10.0)
        except httpx.HTTPError as exc:
            return False, f"cannot reach Gemini: {type(exc).__name__}"
        if resp.status_code == 200:
            return True, f"Gemini reachable, model {self.cfg.gemini_model} available"
        return False, f"Gemini answered {resp.status_code} for model {self.cfg.gemini_model}: {resp.text[:120]}"


# ---- OpenAI-compatible endpoints (Groq, Cerebras, ...) ------------------------------------------


class OpenAICompatModel:
    """Any /chat/completions endpoint that speaks the OpenAI shape.

    Same contract as GeminiModel: never raises out of decide()/complete(), records
    `unavailable_until` when the provider cannot serve, and retries an invalid reply with the
    validation error. JSON mode is attempted once and dropped for the rest of the process if the
    endpoint or model rejects it, the same way the Ollama adapter drops schema mode.
    """

    def __init__(
        self,
        cfg: ModelConfig,
        provider: CompatProvider,
        api_key: str,
        logger: logging.Logger | None = None,
        transport: httpx.BaseTransport | None = None,
        clock: Callable[[], float] = time.time,
        sleep: Callable[[float], None] = time.sleep,
    ):
        self.cfg = cfg  # sampling, retries and timeouts shared with every model
        self.provider = provider
        self.api_key = api_key
        self.logger = logger or logging.getLogger("explorer")
        self.clock = clock
        self.sleep = sleep
        # The per-minute token budget as the provider last reported it (x-ratelimit-* headers).
        self.tokens_limit: int | None = None
        self.tokens_remaining: int | None = None
        self.tokens_full_at = 0.0  # when the budget is back to its limit
        self.last_usage: tuple[int, int] | None = None  # (prompt, completion) tokens of the last call
        self.client = httpx.Client(
            base_url=provider.base_url.rstrip("/"),
            timeout=httpx.Timeout(cfg.timeout_seconds, connect=10.0),
            headers={"Authorization": f"Bearer {api_key}"},
            transport=transport,
        )
        self.json_mode_supported = True
        self.unavailable_until = 0.0
        self.last_error: str | None = None
        self.calls_per_day = int(provider.calls_per_day)

    @property
    def label(self) -> str:
        host = self.provider.base_url.split("//")[-1].split("/")[0]
        return f"{host}/{self.provider.model}"

    @staticmethod
    def _limit_name(resp: httpx.Response) -> str:
        """Which limit a 429 names, from the error message ("tokens per day (TPD)"), for the log."""
        import re

        try:
            message = str((resp.json().get("error") or {}).get("message", ""))
        except (ValueError, AttributeError):
            return ""
        match = re.search(r"on (tokens|requests) per (minute|day) \((\w+)\)", message)
        return f" on {match.group(1)} per {match.group(2)}" if match else ""

    @staticmethod
    def estimate_tokens(messages: list[dict[str, str]], max_tokens: int) -> int:
        """What a call will count against a per-minute token limit: prompt (about 3.5 characters a
        token, erring high) plus the reply allowance."""
        return int(sum(len(m.get("content") or "") for m in messages) / 3.5) + max_tokens

    def _read_budget(self, resp: httpx.Response) -> None:
        """Remember the per-minute token budget the provider reports (Groq, OpenAI and others send
        x-ratelimit-limit-tokens, -remaining-tokens and -reset-tokens)."""
        remaining = resp.headers.get("x-ratelimit-remaining-tokens")
        if remaining is None:
            return
        try:
            self.tokens_remaining = int(float(remaining))
            limit = resp.headers.get("x-ratelimit-limit-tokens")
            self.tokens_limit = int(float(limit)) if limit is not None else self.tokens_limit
        except ValueError:
            return
        reset = retry_after_seconds(httpx.Response(200, headers={"x-ratelimit-reset-tokens": resp.headers.get("x-ratelimit-reset-tokens", "")}))
        self.tokens_full_at = self.clock() + (reset or 60.0)

    def _pace(self, messages: list[dict[str, str]], max_tokens: int) -> None:
        """Wait for the token budget instead of spending a request on a certain 429.

        The budget refills continuously, so the wait is the shortfall at the refill rate, never
        longer than until it is full. Short waits are slept; a longer one benches the provider for
        that long, so the chain moves on (or the local draft stands) and nothing blocks the loop."""
        needed = self.estimate_tokens(messages, max_tokens)
        if self.tokens_limit is not None and needed > self.tokens_limit:
            # Bigger than the provider takes in a minute, so bigger than it will ever take in one request
            # (Groq's free tier: 8,000). Not a rate limit, so no bench: the chain moves on for this call,
            # and the next, smaller call -- a note, a journal -- still gets this provider.
            raise ProviderUnavailable(
                f"{self.label} cannot take a request this size (~{needed} tokens, limit {self.tokens_limit})", SKIP_THIS_CALL
            )
        if self.tokens_remaining is None:
            return
        now = self.clock()
        if now >= self.tokens_full_at:
            self.tokens_remaining = None
            return
        if needed <= self.tokens_remaining:
            return
        until_full = self.tokens_full_at - now
        if self.tokens_limit:
            rate = self.tokens_limit / 60.0
            wait = min(until_full, (needed - self.tokens_remaining) / rate)
        else:
            wait = until_full
        if wait <= self.cfg.token_wait_seconds:
            self.logger.info("%s: waiting %.0fs for its token budget (~%d needed, %d left)", self.label, wait, needed, self.tokens_remaining)
            self.sleep(wait)
            self.tokens_remaining = None
            return
        raise ProviderUnavailable(
            f"{self.label} token budget: ~{needed} tokens needed, {self.tokens_remaining} left for {wait:.0f}s", wait
        )

    def _chat(self, messages: list[dict[str, str]], json_mode: bool, max_tokens: int) -> str:
        body: dict[str, Any] = {
            "model": self.provider.model,
            "messages": messages,
            "temperature": self.cfg.temperature,
            "max_tokens": max_tokens,
        }
        if json_mode and self.json_mode_supported:
            body["response_format"] = {"type": "json_object"}
        self._pace(messages, max_tokens)
        self.last_usage = None
        try:
            resp = self.client.post("/chat/completions", json=body)
        except httpx.HTTPError as exc:
            raise ProviderUnavailable(f"{self.label} unreachable: {type(exc).__name__}", 120.0) from exc
        self._read_budget(resp)
        if resp.status_code == 429:
            wait = retry_after_seconds(resp)
            which = self._limit_name(resp)
            if wait is not None:
                # The provider says when it frees up: a per-minute limit clears in seconds, Groq's free
                # 200,000 tokens a day in minutes to hours. Bench it for exactly that (at most 6 hours),
                # so the bot neither retries into a certain 429 nor waits longer than it must.
                wait = min(wait, 6 * 3600.0)
                raise ProviderUnavailable(f"{self.label} rate limit{which} (429), retry in {wait / 60:.0f} min", wait)
            raise ProviderUnavailable(f"{self.label} rate limit or daily cap{which} (429)", self.provider.cooldown_minutes * 60)
        if resp.status_code in (401, 403):
            raise ProviderUnavailable(f"{self.label} rejected the key ({resp.status_code})", 3600.0)
        if resp.status_code >= 500:
            raise ProviderUnavailable(f"{self.label} server error ({resp.status_code})", 300.0)
        if resp.status_code == 413:
            # "Request too large ... Limit 8000, Requested 8288": this prompt is too big for this
            # provider, which says nothing about the next one. Remember the limit so an oversized call
            # is skipped without a round trip (_pace), and do not bench the provider -- a 15-minute
            # bench here took Groq away from The CEO's small writing calls too.
            import re

            limit = re.search(r"Limit (\d+)", resp.text)
            if limit:
                self.tokens_limit = int(limit.group(1))
            raise ProviderUnavailable(f"{self.label} cannot take a request this size (413)", SKIP_THIS_CALL)
        if resp.status_code >= 400:
            detail = resp.text[:300]
            if json_mode and self.json_mode_supported and (
                "response_format" in detail or "json_validate_failed" in detail or "validate JSON" in detail
            ):
                # This model does not do JSON mode (or, on Groq, its output failed the server-side
                # JSON check: `json_validate_failed`, a 400 that is really an invalid reply). Ask
                # again in plain text for the rest of the run; parse_decision extracts the JSON.
                self.json_mode_supported = False
                self.logger.warning("%s rejected JSON mode; asking for plain JSON text instead", self.label)
                return self._chat(messages, False, max_tokens)
            raise ProviderUnavailable(f"{self.label} rejected the request ({resp.status_code}): {detail}", 900.0)
        data = resp.json()
        if isinstance(data.get("error"), dict):  # some gateways answer 200 with an error body
            message = str(data["error"].get("message", ""))[:200]
            code = data["error"].get("code")
            wait = self.provider.cooldown_minutes * 60 if code in (429, "429") else 300.0
            raise ProviderUnavailable(f"{self.label} error: {message}", wait)
        usage = data.get("usage") if isinstance(data.get("usage"), dict) else {}
        if usage:
            self.last_usage = (int(usage.get("prompt_tokens") or 0), int(usage.get("completion_tokens") or 0))
        try:
            return str(data["choices"][0]["message"]["content"] or "")
        except (KeyError, IndexError, TypeError):
            self.logger.warning("%s returned no choices", self.label)
            return ""

    def _mark_unavailable(self, exc: ProviderUnavailable) -> None:
        self.unavailable_until = self.clock() + exc.retry_seconds
        self.last_error = str(exc)
        if exc.retry_seconds > SKIP_THIS_CALL:
            self.logger.warning("%s; not using it for %.0f minutes", exc, exc.retry_seconds / 60)
        else:
            self.logger.info("%s; skipping it for this call", exc)

    def _stop(self, exc: BaseException) -> str:
        assert isinstance(exc, ProviderUnavailable)
        self._mark_unavailable(exc)
        return str(exc)

    def decide(self, system: str, obs: Observation) -> ModelResult:
        return decide_with_retries(
            lambda messages: self._chat(messages, True, self.cfg.num_predict),
            [{"role": "system", "content": system}, {"role": "user", "content": obs.render()}],
            max_retries=self.cfg.max_retries,
            clock=self.clock,
            stop_on=(ProviderUnavailable,),
            on_stop=self._stop,
            empty_reply="(empty)",
        )

    def complete(self, system: str, prompt: str) -> str:
        messages = [{"role": "system", "content": system}, {"role": "user", "content": prompt}]
        try:
            return self._chat(messages, False, 600).strip()
        except ProviderUnavailable as exc:
            self._mark_unavailable(exc)
            return ""

    def available(self) -> tuple[bool, str]:
        base = self.provider.base_url
        try:
            resp = self.client.get("/models", timeout=15.0)
        except httpx.HTTPError as exc:
            return False, f"cannot reach {base}: {type(exc).__name__}"
        if resp.status_code in (401, 403):
            return False, f"{base} rejected the key ({resp.status_code})"
        if resp.status_code != 200:
            return False, f"{base} answered {resp.status_code} for /models"
        try:
            ids = sorted(str(row.get("id", "")) for row in resp.json().get("data", []) if isinstance(row, dict))
        except (ValueError, AttributeError):
            return False, f"{base} returned an unreadable model list"
        if not ids or self.provider.model in ids:
            return True, f"{self.label} reachable"
        return False, f"{self.provider.model} is not in the catalogue at {base}; it offers: {', '.join(ids[:8])}"


class ReplicateModel:
    """Replicate's HTTP API (api.replicate.com), for models like meta/meta-llama-3-70b-instruct.

    Not OpenAI-compatible: a prediction is created and, with `Prefer: wait`, returned when it finishes
    (or polled a few times if it does not within the wait). Its input is {prompt, system_prompt,
    max_tokens, temperature} and its output is a list of text chunks joined into one string. Same
    contract as the other adapters: never raises out of decide()/complete(), records unavailable_until,
    retries an invalid reply. Replicate bills by run time, not tokens, so this reports no token usage
    and the daily token budget does not apply; calls_per_day still caps it. It is NOT free once the
    trial credit is gone -- the owner opts in by giving it a key and a calls_per_day cap."""

    def __init__(
        self,
        cfg: ModelConfig,
        provider: CompatProvider,
        api_key: str,
        logger: logging.Logger | None = None,
        transport: httpx.BaseTransport | None = None,
        clock: Callable[[], float] = time.time,
        sleep: Callable[[float], None] = time.sleep,
    ):
        self.cfg = cfg
        self.provider = provider
        self.api_key = api_key
        self.logger = logger or logging.getLogger("explorer")
        self.clock = clock
        self.sleep = sleep
        self.last_usage: tuple[int, int] | None = None  # Replicate bills by time; no token count
        self.client = httpx.Client(
            base_url=provider.base_url.rstrip("/"),
            timeout=httpx.Timeout(cfg.timeout_seconds, connect=10.0),
            headers={"Authorization": f"Bearer {api_key}"},
            transport=transport,
        )
        self.unavailable_until = 0.0
        self.last_error: str | None = None
        self.calls_per_day = int(provider.calls_per_day)

    @property
    def label(self) -> str:
        return f"replicate/{self.provider.model}"

    @staticmethod
    def _split(messages: list[dict[str, str]]) -> tuple[str, str]:
        """A Replicate model takes one system_prompt and one prompt; fold the message list into those."""
        system = "\n\n".join(m["content"] for m in messages if m["role"] == "system")
        rest = [m for m in messages if m["role"] != "system"]
        prompt = "\n\n".join(
            (m["content"] if m["role"] == "user" else f"(your previous reply)\n{m['content']}") for m in rest
        )
        return system, prompt

    def _output_text(self, prediction: dict[str, Any]) -> str:
        out = prediction.get("output")
        if isinstance(out, list):
            return "".join(str(x) for x in out)
        return str(out or "")

    def _run(self, messages: list[dict[str, str]], max_tokens: int) -> str:
        system, prompt = self._split(messages)
        body = {"input": {"prompt": prompt, "system_prompt": system,
                          "max_tokens": max_tokens, "temperature": self.cfg.temperature}}
        try:
            resp = self.client.post(
                f"/models/{self.provider.model}/predictions", json=body, headers={"Prefer": "wait=55"}
            )
        except httpx.HTTPError as exc:
            raise ProviderUnavailable(f"{self.label} unreachable: {type(exc).__name__}", 120.0) from exc
        if resp.status_code == 429:
            wait = retry_after_seconds(resp) or self.provider.cooldown_minutes * 60
            raise ProviderUnavailable(f"{self.label} rate limit (429)", min(wait, 6 * 3600.0))
        if resp.status_code == 402:
            raise ProviderUnavailable(f"{self.label} out of credit (402): add credit or remove the key", 3600.0)
        if resp.status_code in (401, 403):
            raise ProviderUnavailable(f"{self.label} rejected the key ({resp.status_code})", 3600.0)
        if resp.status_code >= 500:
            raise ProviderUnavailable(f"{self.label} server error ({resp.status_code})", 300.0)
        if resp.status_code >= 400:
            raise ProviderUnavailable(f"{self.label} rejected the request ({resp.status_code}): {resp.text[:200]}", 900.0)
        prediction = resp.json()
        prediction = self._await(prediction)
        status = prediction.get("status")
        if status != "succeeded":
            detail = str(prediction.get("error") or status)[:200]
            raise ProviderUnavailable(f"{self.label} prediction {status}: {detail}", 300.0)
        return self._output_text(prediction)

    def _await(self, prediction: dict[str, Any], tries: int = 12) -> dict[str, Any]:
        """`Prefer: wait` usually returns a finished prediction; if it is still running, poll its URL."""
        get_url = (prediction.get("urls") or {}).get("get")
        for _ in range(tries):
            if prediction.get("status") in ("succeeded", "failed", "canceled") or not get_url:
                return prediction
            self.sleep(5.0)
            try:
                resp = self.client.get(get_url)
            except httpx.HTTPError as exc:
                raise ProviderUnavailable(f"{self.label} unreachable while polling: {type(exc).__name__}", 120.0) from exc
            if resp.status_code >= 400:
                raise ProviderUnavailable(f"{self.label} polling failed ({resp.status_code})", 300.0)
            prediction = resp.json()
        return prediction

    def _mark_unavailable(self, exc: ProviderUnavailable) -> None:
        self.unavailable_until = self.clock() + exc.retry_seconds
        self.last_error = str(exc)
        self.logger.warning("%s; not using it for %.0f minutes", exc, exc.retry_seconds / 60)

    def _stop(self, exc: BaseException) -> str:
        assert isinstance(exc, ProviderUnavailable)
        self._mark_unavailable(exc)
        return str(exc)

    def decide(self, system: str, obs: Observation) -> ModelResult:
        return decide_with_retries(
            lambda messages: self._run(messages, self.cfg.num_predict),
            [{"role": "system", "content": system}, {"role": "user", "content": obs.render()}],
            max_retries=self.cfg.max_retries,
            clock=self.clock,
            stop_on=(ProviderUnavailable,),
            on_stop=self._stop,
            empty_reply="(empty)",
        )

    def complete(self, system: str, prompt: str) -> str:
        try:
            return self._run([{"role": "system", "content": system}, {"role": "user", "content": prompt}], 600).strip()
        except ProviderUnavailable as exc:
            self._mark_unavailable(exc)
            return ""

    def available(self) -> tuple[bool, str]:
        try:
            resp = self.client.get(f"/models/{self.provider.model}")
        except httpx.HTTPError as exc:
            return False, f"cannot reach {self.provider.base_url}: {type(exc).__name__}"
        if resp.status_code in (401, 403):
            return False, f"replicate rejected the key ({resp.status_code})"
        if resp.status_code == 404:
            return False, f"replicate model {self.provider.model} not found (owner/name?)"
        if resp.status_code != 200:
            return False, f"replicate answered {resp.status_code} for {self.provider.model}"
        return True, f"{self.label} reachable"
