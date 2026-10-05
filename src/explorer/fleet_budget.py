"""Who shares the fleet's token pool right now (owner, 2026-10-02: "I might stop one and run the other ... active
members should take max leverage").

A bot is a sharer when it sits beside this bot in the fleet folder, has no STOP or PAUSE file, its run loop is alive
(workspace/explorer.pid), and its config says budget_scope = "active" with a budget_weight above zero. This bot's share
is its weight over the sum of the sharers' weights; alone, it has the whole pool."""
from __future__ import annotations

import os
from pathlib import Path


def _alive(pid_file: Path) -> bool:
    try:
        pid = int(pid_file.read_text(encoding="utf-8").split()[0])
        os.kill(pid, 0)
        return True
    except (OSError, ValueError, IndexError):
        return False


def _weight(config_file: Path) -> float:
    """budget_weight of a bot when it is in the pool, else 0. Uses the engine's own loader so `extends` is honoured."""
    try:
        from .config import load_config

        m = load_config(str(config_file)).model
        return float(m.budget_weight) if m.budget_scope == "active" and m.budget_weight > 0 else 0.0
    except Exception:  # noqa: BLE001 - an unreadable neighbour is simply not counted
        return 0.0


def active_share(root: Path, _unused: object = None) -> tuple[float, list[str]]:
    """(this bot's share of the pool, the slugs sharing it). `root` is this bot's folder."""
    root = Path(root)
    weights: dict[str, float] = {}
    for folder in sorted(p for p in root.parent.iterdir() if p.is_dir()):
        cfg, ws = folder / "config.toml", folder / "workspace"
        if not cfg.is_file() or not ws.is_dir():
            continue
        me = folder.resolve() == root.resolve()
        if (ws / "STOP").exists() or (ws / "PAUSE").exists():
            continue
        if not me and not _alive(ws / "explorer.pid"):
            continue
        w = _weight(cfg)
        if w > 0:
            weights[folder.name] = w
    mine = weights.get(root.name, 0.0)
    total = sum(weights.values())
    if mine <= 0 or total <= 0:
        return 1.0, [root.name]
    return mine / total, sorted(weights)
