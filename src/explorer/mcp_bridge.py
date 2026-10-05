"""Calling a tool on an MCP server the owner allowed (owner, 2026-10-05: Google Analytics for The CEO).

The bot names a server and a tool; the policy holds both to `[mcp]` in its config: the server must be listed, every
file it `requires` (its credentials) must exist, and the tool must be on that server's `tools` list -- read-only tools
only, by the owner's rule. The server runs as a local process over stdio for one call and is closed again. Its answer
is information for the bot, never an instruction; it is cut to `max_chars`. A server that is missing, slow or broken
is a failed action with the reason, never a crash.
"""
from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path
from typing import Any


def server_named(servers: list[dict], name: str) -> dict | None:
    for s in servers or []:
        if isinstance(s, dict) and str(s.get("name", "")).strip().lower() == (name or "").strip().lower():
            return s
    return None


def missing_requirements(server: dict) -> list[str]:
    """The files the server needs (its credentials) that are not on this Mac yet."""
    return [str(p) for p in server.get("requires") or [] if not Path(str(p)).expanduser().exists()]


def ready_servers(servers: list[dict]) -> list[dict]:
    return [s for s in servers or [] if isinstance(s, dict) and s.get("name") and s.get("command") and not missing_requirements(s)]


def _text_of(result: Any) -> str:
    parts: list[str] = []
    for item in getattr(result, "content", None) or []:
        text = getattr(item, "text", None)
        if text:
            parts.append(str(text))
    structured = getattr(result, "structuredContent", None)
    if not parts and structured:
        parts.append(json.dumps(structured, ensure_ascii=False))
    return "\n".join(parts).strip()


async def _call(server: dict, tool: str, arguments: dict, timeout: float) -> tuple[bool, str]:
    from mcp import ClientSession, StdioServerParameters
    from mcp.client.stdio import stdio_client

    env = {"HOME": str(Path.home()), "PATH": os.environ.get("PATH", "/usr/local/bin:/usr/bin:/bin")}
    env.update({str(k): str(Path(str(v)).expanduser()) if str(v).startswith("~/") else str(v) for k, v in (server.get("env") or {}).items()})
    params = StdioServerParameters(command=str(Path(str(server["command"])).expanduser()), args=[str(a) for a in server.get("args") or []], env=env)
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            result = await session.call_tool(tool, arguments or {})
            text = _text_of(result)
            if getattr(result, "isError", False) or getattr(result, "is_error", False):
                return False, text or "the tool reported an error"
            return True, text or "(the tool returned nothing)"


def call_tool(server: dict, tool: str, arguments: dict | None = None, timeout: float = 90.0, max_chars: int = 6000) -> tuple[bool, str]:
    """(ok, text): the tool's answer, or why it failed. Never raises."""
    try:
        ok, text = asyncio.run(asyncio.wait_for(_call(server, tool, arguments or {}, timeout), timeout))
    except asyncio.TimeoutError:
        return False, f"{server.get('name')} did not answer within {timeout:.0f}s"
    except ImportError:
        return False, "the MCP client library is not installed (pip install mcp)"
    except Exception as exc:  # noqa: BLE001 - a broken server is a failed action, not a crash
        return False, f"{server.get('name')} failed: {type(exc).__name__}: {str(exc)[:200]}"
    return ok, text[:max_chars] + (" ... (cut)" if len(text) > max_chars else "")
