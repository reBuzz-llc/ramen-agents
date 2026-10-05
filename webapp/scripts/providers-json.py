"""Print one bot's model providers as JSON for the dashboard's Settings > AI providers page.

Uses the bot code's own config loader and provider table, the same ones `bot providers` uses, so the dashboard
never keeps a second copy. Reports whether each key file exists, never its contents.
    ~/Projects/bot/.venv/bin/python scripts/providers-json.py /path/to/bot/config.toml
"""
from __future__ import annotations

import json
import sys
import tomllib
from pathlib import Path

from explorer.common.fallback import CallLedger, discovered_providers, effective_chain
from explorer.common.keys import key_file
from explorer.config import KNOWN_PROVIDERS, load_config
from explorer.model import provider_config


def key_state(path: str) -> dict:
    p = Path(path).expanduser()
    try:
        return {"keyFile": str(p), "hasKey": p.is_file() and p.stat().st_size > 0}
    except OSError:
        return {"keyFile": str(p), "hasKey": False}


def known_catalog() -> list[dict]:
    return [
        {"name": name, "note": info.get("free", ""), "baseUrl": info.get("base_url", ""), "kind": info.get("kind", "openai"),
         "model": info.get("model", ""), "auto": info.get("auto", True) is not False, **key_state(key_file(name))}
        for name, info in KNOWN_PROVIDERS.items() if name != "gemini"
    ]


def not_a_run_agent(path: str) -> str | None:
    """A folder the framework must not run (the Validator: `agent.not_a_bot_run_agent = true`) has no model
    chain of its own; report it as such instead of failing on the guard key."""
    try:
        data = tomllib.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    agent = data.get("agent") or {}
    return str(agent.get("name") or Path(path).parent.name) if agent.get("not_a_bot_run_agent") else None


def judge_chain(path: str) -> list[dict]:
    """The Validator's own judge chain ([[validator.model.chain]] in its config): strongest free model first,
    with today's usage from the shared ledger (kind "validate")."""
    try:
        data = tomllib.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    model = (data.get("validator") or {}).get("model") or {}
    usage = CallLedger().usage_today()
    out = []
    for i, p in enumerate(model.get("chain") or [], 1):
        base = str(p.get("base_url", ""))
        host = base.split("//")[-1].split("/")[0]
        used = usage.get(host, {})
        out.append({"position": i, "name": str(p.get("name", "")), "model": str(p.get("model", "")), "baseUrl": base, "kind": "openai",
                    "host": host, "auto": False, "note": "judge chain: strongest free model first; skipped when none answers"
                    + ("" if model.get("enabled", True) else " (disabled)"),
                    "usage": {k: {"calls": v[0], "tokens": v[1] + v[2]} for k, v in sorted(used.items())}, **key_state(str(p.get("key_file", "")))})
    return out


def main() -> int:
    guarded = not_a_run_agent(sys.argv[1])
    if guarded:
        chain = judge_chain(sys.argv[1])
        print(json.dumps({"bot": guarded, "provider": "judge" if chain else "none", "fallback": "none (never the local model)",
                          "chain": chain, "known": known_catalog(),
                          "note": "The Validator's exact checks use no model; this chain answers its plain-English judgment questions, strongest first."}))
        return 0
    cfg = load_config(sys.argv[1])
    out: dict = {"bot": cfg.agent.name, "provider": cfg.model.provider, "fallback": cfg.model.fallback_provider, "chain": [], "known": []}
    remote = cfg.model.provider in ("remote", "gemini") or bool(cfg.model.provider_chain)
    chain = effective_chain(cfg.model) if remote else []
    discovered = set(discovered_providers(cfg.model)) if remote else set()
    usage = CallLedger().usage_today()
    for i, name in enumerate(chain, 1):
        if name == "gemini":
            entry = {"model": cfg.model.gemini_model, "baseUrl": "https://generativelanguage.googleapis.com/v1beta", "kind": "gemini", "host": "gemini", **key_state(cfg.model.gemini_api_key_file)}
        else:
            prov = provider_config(name, cfg.model)
            host = prov.base_url.split("//")[-1].split("/")[0]
            kind = KNOWN_PROVIDERS.get(name, {}).get("kind", "openai")
            entry = {"model": prov.model, "baseUrl": prov.base_url, "kind": kind, "host": host, **key_state(prov.api_key_file)}
        used = usage.get(entry["host"], {})
        entry.update(
            position=i,
            name=name,
            auto=name in discovered,
            note=KNOWN_PROVIDERS.get(name, {}).get("free", ""),
            usage={k: {"calls": v[0], "tokens": v[1] + v[2]} for k, v in sorted(used.items())},
        )
        out["chain"].append(entry)
    for name, info in KNOWN_PROVIDERS.items():
        if name in chain or name == "gemini":
            continue
        out["known"].append({"name": name, "note": info.get("free", ""), "baseUrl": info.get("base_url", ""), "kind": info.get("kind", "openai"), "model": info.get("model", ""), "auto": info.get("auto", True) is not False, **key_state(key_file(name))})
    print(json.dumps(out))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
