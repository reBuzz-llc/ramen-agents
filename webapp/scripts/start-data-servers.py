"""Start the data server (`bot dashboard`) for every bot under ~/bots that does not have one running.

Run with the bot checkout's own interpreter so configs are read by the real loader:
    ~/Projects/bot/.venv/bin/python scripts/start-data-servers.py
Each server runs detached and logs to <bot>/workspace/logs/dashboard.out.
"""
from __future__ import annotations

import os
import socket
import subprocess
import sys
from pathlib import Path

from explorer.config import load_config

BOTS_DIR = Path(os.environ.get("BOTS_DIR", Path.home() / "bots"))
BOT_CLI = Path(sys.executable).with_name("bot")


def listening(host: str, port: int) -> bool:
    with socket.socket() as sock:
        sock.settimeout(0.5)
        return sock.connect_ex((host, port)) == 0


def main() -> int:
    configs = sorted(BOTS_DIR.glob("*/config.toml"))
    if not configs:
        print(f"no bots found under {BOTS_DIR}")
        return 0
    seen_ports: dict[int, str] = {}
    for config_path in configs:
        cfg = load_config(config_path)
        name, host, port = cfg.agent.name, cfg.dashboard.host, cfg.dashboard.port
        if port in seen_ports:
            print(f"{name}: port {port} is also used by {seen_ports[port]}; give it its own [dashboard] port")
            continue
        seen_ports[port] = name
        if listening(host, port):
            print(f"{name}: already serving on {host}:{port}")
            continue
        log_dir = cfg.workspace / "logs"
        log_dir.mkdir(parents=True, exist_ok=True)
        with (log_dir / "dashboard.out").open("ab") as log:
            subprocess.Popen(
                [str(BOT_CLI), "--config", str(config_path), "dashboard"],
                stdout=log, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL, start_new_session=True,
            )
        print(f"{name}: started on {host}:{port}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
