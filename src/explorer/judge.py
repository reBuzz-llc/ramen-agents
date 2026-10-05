"""One cheap yes/no model call, shared by the site gate ([site_gate]) and the write gate's model-judged questions
(policy.write_gate_model). A judge answers a JSON object; the parser is lenient; verdicts are cached by content hash so
the same question about the same content is asked once; and every caller fails open when no judge answers."""
from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import time
from pathlib import Path
from typing import Any, Callable

Judge = Callable[[str, str], str]  # (system, prompt) -> raw reply


def parse_verdict(raw: str, key: str) -> dict | None:
    """{"<key>": true, "why": "..."} out of a model reply, leniently; None when no verdict is in it."""
    text = (raw or "").strip()
    if not text:
        return None
    m = re.search(r"\{.*?\}", text, re.S)
    if m:
        try:
            data = json.loads(m.group(0))
            if isinstance(data, dict) and key in data:
                v = data[key]
                if isinstance(v, str):
                    v = v.strip().lower() in ("true", "yes", "1")
                return {key: bool(v), "why": str(data.get("why", ""))[:120]}
        except ValueError:
            pass
    m2 = re.search(rf'"?{re.escape(key)}"?\s*[:=]\s*(true|false|yes|no)', text, re.I)
    if m2:
        return {key: m2.group(1).lower() in ("true", "yes"), "why": ""}
    return None


def content_hash(*parts: str) -> str:
    h = hashlib.sha1()
    for p in parts:
        h.update((p or "").encode("utf-8", "replace"))
        h.update(b"\0")
    return h.hexdigest()[:24]


class JudgeCache:
    """A JSON file of verdicts by key, rewritten atomically; several bots may share one file. Missing or unreadable
    file = empty cache; a write error is logged, never raised."""

    def __init__(self, path: str | Path | None, max_entries: int = 3000, logger: logging.Logger | None = None):
        self.path = Path(path).expanduser() if path else None
        self.max_entries = max_entries
        self.logger = logger or logging.getLogger("explorer")

    def _load(self) -> dict[str, Any]:
        if self.path is None or not self.path.is_file():
            return {}
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {}
        return data if isinstance(data, dict) else {}

    def get(self, key: str) -> dict | None:
        v = self._load().get(key)
        return v if isinstance(v, dict) else None

    def put(self, key: str, verdict: dict) -> None:
        if self.path is None:
            return
        try:
            data = self._load()
            data[key] = {**verdict, "at": time.strftime("%Y-%m-%dT%H:%M:%S")}
            if len(data) > self.max_entries:  # drop the oldest entries, by their "at"
                for k, _ in sorted(data.items(), key=lambda kv: str(kv[1].get("at", "")) if isinstance(kv[1], dict) else "")[: len(data) - self.max_entries]:
                    data.pop(k, None)
            self.path.parent.mkdir(parents=True, exist_ok=True)
            tmp = self.path.with_name(self.path.name + f".{os.getpid()}.tmp")
            tmp.write_text(json.dumps(data, indent=1, ensure_ascii=False, sort_keys=True), encoding="utf-8")
            tmp.replace(self.path)
        except OSError as exc:
            self.logger.warning("judge cache %s not written: %s", self.path, exc)


def build_judge(mode: str, model_cfg: Any, local_model: str, chain: Any, logger: logging.Logger | None = None) -> Judge:
    """mode "local": Ollama `local_model` on this Mac when it is up (nothing spent), else the bot's chain;
    "chain": the bot's own configured model. The result is a plain (system, prompt) -> str callable."""
    logger = logger or logging.getLogger("explorer")
    if mode == "local":
        try:
            from dataclasses import replace

            from .model import OllamaModel

            local = OllamaModel(replace(model_cfg, name=local_model, num_predict=80), logger)
            ok, why = local.available()
            if ok:
                return local.complete
            logger.info("judge: local model not available (%s); using the bot's chain", why)
        except Exception as exc:  # noqa: BLE001
            logger.info("judge: local model not built (%s); using the bot's chain", exc)
    return chain.complete
