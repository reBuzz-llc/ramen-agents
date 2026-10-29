"""The provider chain shared by every bot: try each remote provider in order, bench one that is
rate-limited, capped or down, and fall back to the local model. `build_model` assembles it from a
ModelConfig, `CallLedger` holds the machine-wide daily counts and token usage, and `FallbackModel`
is the runtime. The model adapters themselves (Fake, Ollama, Gemini, OpenAI-compatible) live in
`..model`; this module only orchestrates them, so there is no import cycle."""
from __future__ import annotations

import json
import logging
import os
import time
from pathlib import Path
from typing import Any, Callable

from ..config import KNOWN_PROVIDERS, ModelConfig
from .keys import key_file, load_key
from ..model import (
    FakeModel,
    GeminiModel,
    ReplicateModel,
    Model,
    ModelResult,
    OllamaModel,
    OpenAICompatModel,
    load_gemini_key,
    load_provider_key,
    provider_config,
)
from ..prompts import Observation


DEFAULT_LEDGER = Path.home() / ".config" / "explorer" / "model_calls.json"


class CallLedger:
    """Remote calls per provider for today, in a file every bot and dashboard on this Mac shares.

    The free tiers are per key and per day; without a shared count two bots spend a 50-call quota
    before breakfast and a restart forgets what was spent. The ledger is small and best effort: a
    file that cannot be read counts as zero, one that cannot be written is still honoured in-process."""

    def __init__(self, path: Path | str = DEFAULT_LEDGER, clock: Callable[[], float] = time.time, bot: str = ""):
        self.path = Path(path)
        self.clock = clock
        self.bot = bot.strip()  # whose calls these are; usage is also totalled per bot for budget_scope = "bot"
        self._memory: dict[str, Any] = {}

    def _today(self) -> str:
        return time.strftime("%Y-%m-%d", time.localtime(self.clock()))

    def _load_all(self) -> dict[str, Any]:
        """Today's ledger: {"day", "counts": {key: calls}, "usage": {key: {kind: [calls, prompt, completion]}}}."""
        data: dict[str, Any] = self._memory
        try:
            loaded = json.loads(self.path.read_text(encoding="utf-8"))
            if isinstance(loaded, dict):
                data = loaded
        except (OSError, ValueError):
            pass
        health = data.get("health") if isinstance(data.get("health"), dict) else {}
        if data.get("day") != self._today():
            return {"day": self._today(), "counts": {}, "usage": {}, "health": health}  # health outlives the day
        counts = data.get("counts") or {}
        usage = data.get("usage") or {}
        return {
            "day": self._today(),
            "counts": {str(k): int(v) for k, v in counts.items() if isinstance(v, int)},
            "usage": usage if isinstance(usage, dict) else {},
            "by_bot": data.get("by_bot") if isinstance(data.get("by_bot"), dict) else {},
            "health": health,
        }

    def _load(self) -> dict[str, int]:
        return self._load_all()["counts"]

    def _save_all(self, data: dict[str, Any]) -> None:
        self._memory = data
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            tmp = self.path.with_name(f"{self.path.name}.{os.getpid()}.tmp")
            tmp.write_text(json.dumps(data), encoding="utf-8")
            os.replace(tmp, self.path)
        except OSError:
            pass

    def count(self, key: str) -> int:
        return self._load().get(key, 0)

    def record(self, key: str) -> int:
        data = self._load_all()
        data["counts"][key] = data["counts"].get(key, 0) + 1
        self._save_all(data)
        return data["counts"][key]

    def note_health(self, key: str, ok: bool, reason: str = "") -> None:
        """A provider's last success, last failure and why, for the dashboard (creatorCC queue 16, 2026-10-29)."""
        data = self._load_all()
        row = data["health"].setdefault(key, {})
        now = time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime(self.clock()))
        if ok:
            row["last_ok"] = now
        else:
            row["last_fail"], row["last_reason"] = now, (reason or "no usable reply")[:200]
        self._save_all(data)

    def add_usage(self, key: str, kind: str, prompt_tokens: int, completion_tokens: int) -> None:
        """Tokens one remote call used, by call kind (decide, write, complete), so the owner can see
        what a step costs against a per-minute token limit."""
        data = self._load_all()
        row = data["usage"].setdefault(key, {}).setdefault(kind, [0, 0, 0])
        row[0] += 1
        row[1] += int(prompt_tokens)
        row[2] += int(completion_tokens)
        if self.bot:
            by_bot = data.setdefault("by_bot", {})
            by_bot[self.bot] = int(by_bot.get(self.bot, 0)) + int(prompt_tokens) + int(completion_tokens)
        self._save_all(data)

    def usage_today(self) -> dict[str, dict[str, list[int]]]:
        return self._load_all()["usage"]

    def tokens_today(self, bot: str | None = None) -> int:
        """Total remote tokens (prompt + completion, every provider and kind) spent today -- the whole Mac, or one
        bot's own when `bot` is given (budget_scope = "bot"). The daily free budget is mostly tokens, not calls."""
        if bot:
            return int((self._load_all().get("by_bot") or {}).get(bot.strip(), 0))
        return sum(v[1] + v[2] for by_kind in self.usage_today().values() for v in by_kind.values())

    def today(self) -> dict[str, int]:
        return self._load()


class FallbackModel:
    """Remote providers in order, with a local model that never goes away as the last resort.

    A provider that reports itself unavailable (quota, outage, bad key) is skipped until its
    cooldown passes, and the next one is tried. Invalid replies are not a reason to switch
    provider: they get the loop's normal retry and backoff, the same as for any model.

    With remote_for = "writing" the local model decides every step and the remote chain is asked
    only when that step writes something (WRITING_TYPES): it gets the same observation plus the
    local draft and writes the action itself. If no remote provider answers, the draft stands.
    """

    # Actions whose text is the bot's output: what the owner, the Notion board or a reader sees.
    # Owner-facing rows (Notion tasks, leads, package toggles) and their fixes are written by the remote chain too.
    WRITING_TYPES = frozenset({"note", "task", "publish", "say", "package", "provider", "publish_package", "lead", "update_task", "update_lead"})

    def __init__(
        self,
        primary: Any,
        secondary: Model,
        logger: logging.Logger | None = None,
        clock: Callable[[], float] = time.time,
        ledger: CallLedger | None = None,
        remote_for: str = "all",
    ):
        self.primaries: list[Any] = list(primary) if isinstance(primary, (list, tuple)) else [primary]
        self.secondary = secondary
        self.logger = logger or logging.getLogger("explorer")
        self.clock = clock
        self.ledger = ledger
        self.remote_for = remote_for
        self._capped_logged: set[str] = set()
        self._active: Any | None = self.primaries[0] if self.primaries else None

    def _record_usage(self, provider: Any, kind: str, ok: bool = True) -> None:
        usage = getattr(provider, "last_usage", None)
        if self.ledger is not None and usage:
            self.ledger.add_usage(self.ledger_key(provider), kind, usage[0], usage[1])
        if self.ledger is not None:
            self.ledger.note_health(self.ledger_key(provider), ok, "" if ok else str(getattr(provider, "last_error", "") or ""))

    @staticmethod
    def ledger_key(provider: Any) -> str:
        """Quotas are per key and host, not per model id: `api.groq.com`, `gemini`."""
        return str(getattr(provider, "label", type(provider).__name__)).split("/")[0]

    def _capped(self, provider: Any) -> bool:
        """True when this provider has used its calls_per_day today; otherwise records the call."""
        cap = int(getattr(provider, "calls_per_day", 0) or 0)
        if self.ledger is None or cap <= 0:
            return False
        key = self.ledger_key(provider)
        used = self.ledger.count(key)
        if used >= cap:
            marker = f"{key}:{self.ledger._today()}"
            if marker not in self._capped_logged:
                self._capped_logged.add(marker)
                self.logger.warning("%s has used its %d calls for today; not using it until tomorrow", key, cap)
            return True
        self.ledger.record(key)
        return False

    @property
    def primary(self) -> Any | None:
        """The first remote provider, for callers that only configured one."""
        return self.primaries[0] if self.primaries else None

    def _down(self, provider: Any) -> bool:
        return self.clock() < float(getattr(provider, "unavailable_until", 0.0))

    def _name(self, provider: Any | None) -> str:
        if provider is None:
            return f"the local fallback ({type(self.secondary).__name__})"
        return getattr(provider, "label", type(provider).__name__)

    def _note(self, provider: Any | None) -> None:
        if provider is self._active:
            return
        if provider is None:
            why = next((getattr(p, "last_error", None) for p in self.primaries if getattr(p, "last_error", None)), None)
            self.logger.info("switched to %s: %s", self._name(None), why or "no remote provider available")
        else:
            self.logger.info("using %s", self._name(provider))
        self._active = provider

    def decide(self, system: str, obs: Observation) -> ModelResult:
        if self.remote_for == "writing":
            return self._decide_locally_then_write_remotely(system, obs)
        for provider in self.primaries:
            if self._down(provider) or self._capped(provider):
                continue
            result = provider.decide(system, obs)
            self._record_usage(provider, "decide", result.decision is not None)
            if result.decision is not None or not self._down(provider):
                self._note(provider)
                return result
        self._note(None)
        return self.secondary.decide(system, obs)

    def _decide_locally_then_write_remotely(self, system: str, obs: Observation) -> ModelResult:
        draft = self.secondary.decide(system, obs)
        if draft.decision is None or draft.decision.action.type not in self.WRITING_TYPES:
            return draft
        from dataclasses import replace

        kind = draft.decision.action.type
        hint = (
            f"Your first draft for this step is a {kind} action: "
            f"{draft.decision.action.model_dump_json(exclude_none=True)[:1500]}. "
            f"Write this {kind} yourself from the page and your state: accurate, specific, in your own words, "
            "only what the page actually says. If the draft is wrong or not worth writing, choose a better action."
        )
        writing_obs = replace(obs, feedback=f"{obs.feedback}\n{hint}" if obs.feedback else hint)
        for provider in self.primaries:
            if self._down(provider) or self._capped(provider):
                continue
            result = provider.decide(system, writing_obs)
            self._record_usage(provider, "write", result.decision is not None)
            if result.decision is not None:
                self._note(provider)
                result.latency += draft.latency
                return result
        self.logger.info("kept the local draft of a %s: %s", kind, "no remote provider answered")
        return draft

    def complete(self, system: str, prompt: str) -> str:
        for provider in self.primaries:
            if self._down(provider) or self._capped(provider):
                continue
            text = provider.complete(system, prompt)
            self._record_usage(provider, "complete", bool(text))
            if text or not self._down(provider):
                self._note(provider)
                return text
        self._note(None)
        return self.secondary.complete(system, prompt)

    @property
    def using_fallback(self) -> bool:
        return self._active is None

    def unload(self) -> None:
        for provider in [*self.primaries, self.secondary]:
            unload = getattr(provider, "unload", None)
            if callable(unload):
                unload()


def _remote_provider(name: str, cfg: ModelConfig, logger: logging.Logger) -> Any | None:
    """One configured remote provider, or None when its key is missing."""
    if name == "gemini":
        key = load_gemini_key(cfg)
        if not key:
            logger.warning(
                "gemini is configured but no API key was found (env %s, file %s); skipping it",
                cfg.gemini_api_key_env, cfg.gemini_api_key_file,
            )
            return None
        return GeminiModel(cfg, key, logger)
    return _remote_provider_named(name, cfg, logger)


def _remote_providers(name: str, cfg: ModelConfig, logger: logging.Logger) -> list[Any]:
    """The providers one chain entry expands to: "gemini" is gemini_model and then each of
    gemini_fallback_models (same key, each benched on its own when busy); any other name is one."""
    if name == "gemini":
        from dataclasses import replace

        first = _remote_provider(name, cfg, logger)
        if first is None:
            return []
        extra = [GeminiModel(replace(cfg, gemini_model=m), first.api_key, logger)
                 for m in cfg.gemini_fallback_models if m.strip() and m != cfg.gemini_model]
        return [first, *extra]
    provider = _remote_provider(name, cfg, logger)
    return [provider] if provider is not None else []


def _remote_provider_named(name: str, cfg: ModelConfig, logger: logging.Logger) -> Any | None:
    """A provider from its [model.providers.<name>] table or from KNOWN_PROVIDERS (auto-discovered),
    or None when its key is missing."""
    if name in cfg.providers or name in KNOWN_PROVIDERS:
        provider = provider_config(name, cfg)
        key = load_provider_key(provider)
        if not key:
            logger.warning(
                "%s is configured but no API key was found (env %s, file %s); skipping it",
                name, provider.api_key_env, provider.api_key_file,
            )
            return None
        if provider.kind == "replicate":
            return ReplicateModel(cfg, provider, key, logger)
        return OpenAICompatModel(cfg, provider, key, logger)
    return None


def paced_delay(base: float, budget: int, used_tokens: int, day_fraction: float, cap: float = 0.0) -> float:
    """Stretch a cycle delay when today's shared free tokens are ahead of the clock. `day_fraction` is
    how far through the day we are (0-1, floored by the caller); `cap` (0 = none) bounds the result."""
    if budget <= 0:
        return base
    day_fraction = max(0.01, day_fraction)
    used_fraction = used_tokens / budget
    if used_fraction <= day_fraction:
        return base
    delay = base * (used_fraction / day_fraction)
    return min(delay, cap) if cap > 0 else delay


def _has_key(name: str, cfg: ModelConfig) -> bool:
    """True when a key for a KNOWN provider is reachable: its env var or ~/bots/common-data/keys/<name>.key."""
    env = f"{name.upper().replace('-', '_')}_API_KEY"
    return bool(load_key(env, key_file(name)))


def discovered_providers(cfg: ModelConfig) -> list[str]:
    """KNOWN_PROVIDERS (except gemini, which is built in) that have a key on disk and are not already
    named in the chain. Appended after the explicit chain, so an explicit provider_chain stays
    authoritative in its own order and nothing is doubled."""
    if not getattr(cfg, "auto_discover_providers", True):
        return []
    named = set(cfg.provider_chain) | set(getattr(cfg, "provider_first", [])) | {cfg.provider}
    return [
        name for name, info in KNOWN_PROVIDERS.items()
        # Only genuinely free providers auto-join. Paid ones (info["auto"] is False) must be added to
        # provider_chain by hand with a calls_per_day cap, so a key file never quietly spends money.
        if name != "gemini" and info.get("auto", True) and name not in named
        and name not in cfg.providers and _has_key(name, cfg)
    ]


def effective_chain(cfg: ModelConfig) -> list[str]:
    """The provider names build_model will try, in order: this bot's provider_first, the explicit chain
    (or the single provider) without those, then any auto-discovered ones."""
    first = list(dict.fromkeys(getattr(cfg, "provider_first", [])))
    explicit = first + [n for n in (list(cfg.provider_chain) or [cfg.provider]) if n not in first]
    return explicit + [n for n in discovered_providers(cfg) if n not in explicit]


def build_model(
    cfg: ModelConfig, logger: logging.Logger | None = None, ledger_path: Path | str | None = None, bot_name: str = ""
) -> Model:
    """The configured model: fake, ollama, or remote providers in order with a local fallback.
    One place for every entry point (bot run, bot dashboard)."""
    logger = logger or logging.getLogger("explorer")
    if cfg.provider == "fake":
        return FakeModel()
    if cfg.provider == "ollama":
        return OllamaModel(cfg, logger)
    secondary: Model = OllamaModel(cfg, logger) if cfg.fallback_provider == "ollama" else FakeModel()
    names = effective_chain(cfg)
    primaries = [p for n in names for p in _remote_providers(n, cfg, logger)]
    if not primaries:
        logger.warning("no remote provider has a key; running on %s only", cfg.fallback_provider)
        return secondary
    # Always a ledger: it holds the daily caps and the token usage by call kind that `bot check` shows.
    ledger = CallLedger(ledger_path or DEFAULT_LEDGER, bot=bot_name)
    return FallbackModel(primaries, secondary, logger, ledger=ledger, remote_for=cfg.remote_for)
