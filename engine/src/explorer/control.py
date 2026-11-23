"""Operator controls: the STOP and PAUSE files, and the single-instance lock."""
from __future__ import annotations

import fcntl
import os
from pathlib import Path
from typing import IO

from .config import Config


def stop_requested(cfg: Config) -> bool:
    return cfg.stop_file.exists()


def pause_requested(cfg: Config) -> bool:
    return cfg.pause_file.exists()


class PidLock:
    """An flock on the pid file. Only one explorer may run per workspace."""

    def __init__(self, path: Path):
        self.path = path
        self._fh: IO[str] | None = None

    def acquire(self) -> bool:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        fh = open(self.path, "a+", encoding="utf-8")
        try:
            fcntl.flock(fh.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            fh.close()
            return False
        fh.seek(0)
        fh.truncate()
        fh.write(str(os.getpid()))
        fh.flush()
        self._fh = fh
        return True

    def release(self) -> None:
        if self._fh is None:
            return
        try:
            fcntl.flock(self._fh.fileno(), fcntl.LOCK_UN)
        finally:
            self._fh.close()
            self._fh = None

    def __enter__(self) -> "PidLock":
        if not self.acquire():
            raise RuntimeError(f"another instance holds {self.path}")
        return self

    def __exit__(self, *exc: object) -> None:
        self.release()

    @staticmethod
    def read_pid(path: Path) -> int | None:
        try:
            return int(path.read_text(encoding="utf-8").strip() or "0") or None
        except (OSError, ValueError):
            return None

    @staticmethod
    def is_locked(path: Path) -> bool:
        """True when another process currently holds the lock."""
        if not path.exists():
            return False
        with open(path, "a+", encoding="utf-8") as fh:
            try:
                fcntl.flock(fh.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            except OSError:
                return True
            fcntl.flock(fh.fileno(), fcntl.LOCK_UN)
            return False
