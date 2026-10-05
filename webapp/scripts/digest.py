"""Write one bot's period recap with that bot's own model, for the dashboard's Summary tab.

Reads {"system": ..., "prompt": ...} as JSON on stdin and prints {"text": ..., "model": ...}. The prompt
is built by the dashboard (lib/digest.ts) from the bot's own database, so the text only ever goes to the
model that bot already uses. A bot that reads over Tor or keeps its messages plain (the Onion Reader) is
local-only: its recap is written by its local Ollama model and never by a remote provider, whatever the
config says, so no page text it read reaches a cloud model.
    ~/Projects/bot/.venv/bin/python scripts/digest.py /path/to/bot/config.toml < request.json
"""
from __future__ import annotations

import json
import logging
import sys

from explorer.common.fallback import FallbackModel, build_model
from explorer.config import load_config
from explorer.model import FakeModel, OllamaModel


def main() -> int:
    cfg = load_config(sys.argv[1])
    req = json.load(sys.stdin)
    logger = logging.getLogger("digest")
    logging.basicConfig(level=logging.WARNING, stream=sys.stderr)
    local_only = cfg.browser.backend == "tor" or bool(getattr(cfg.messaging, "plain_only", False))
    if local_only:
        model = OllamaModel(cfg.model, logger)
        label = f"local model ({cfg.model.name})"
    else:
        model = build_model(cfg.model, logger)
        label = ""
    if isinstance(model, FakeModel):
        print(json.dumps({"error": "this bot has no real model configured (fake)"}))
        return 0
    text = model.complete(str(req["system"]), str(req["prompt"]))
    why = ""
    if isinstance(model, FallbackModel):
        label = model._name(model._active)
        if model._active is None:
            why = next((str(p.last_error) for p in model.primaries if getattr(p, "last_error", None)), "")
    elif isinstance(model, OllamaModel) and not label:
        label = f"local model ({cfg.model.name})"
    print(json.dumps({"text": text, "model": label, "localOnly": local_only, "fallbackReason": why[:300]}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
