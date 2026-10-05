"""API keys and tokens: one place that knows where they live and how they are read.

Every bot on this Mac shares one folder of keys, `~/bots/common-data/keys/<name>.key` (chmod 600), next
to the bot folders. `EXPLORER_KEYS_DIR` moves it. A config names a key file with a full path; when it
does not, the default here applies. An environment variable, when set, wins over the file, but launchd
jobs get no shell environment, so the file is the practical route for the real agents.

This module imports nothing from the rest of the package, so config.py can use it for its defaults.
"""
from __future__ import annotations

import os
from pathlib import Path


def keys_dir() -> Path:
    return Path(os.environ.get("EXPLORER_KEYS_DIR") or Path.home() / "bots" / "common-data" / "keys").expanduser()


def key_file(name: str) -> str:
    """The default key file for a provider or service, e.g. key_file("groq") -> .../keys/groq.key."""
    return str(keys_dir() / f"{name}.key")


def load_key(env_name: str | None, file_path: str | os.PathLike[str] | None) -> str | None:
    """A key from the env var, else from the file. None when neither has one (or the file is empty)."""
    if env_name:
        key = os.environ.get(env_name, "").strip()
        if key:
            return key
    if not file_path or not str(file_path).strip():
        return None
    try:
        text = Path(file_path).expanduser().read_text(encoding="utf-8").strip()
    except OSError:
        return None
    return text or None
