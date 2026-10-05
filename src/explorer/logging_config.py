"""JSON-lines logging with rotation. One line per event; `bot tail` reads it back."""
from __future__ import annotations

import json
import logging
import sys
import time
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Any


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime(record.created)),
            "level": record.levelname,
            "msg": record.getMessage(),
        }
        extra = getattr(record, "event", None)
        if isinstance(extra, dict):
            payload.update(extra)
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False, default=str)


def setup_logging(log_path: Path, level: int = logging.INFO, to_stderr: bool = True) -> logging.Logger:
    logger = logging.getLogger("explorer")
    logger.setLevel(level)
    logger.handlers.clear()
    logger.propagate = False
    log_path.parent.mkdir(parents=True, exist_ok=True)
    fh = RotatingFileHandler(log_path, maxBytes=5_000_000, backupCount=5, encoding="utf-8")
    fh.setFormatter(JsonFormatter())
    logger.addHandler(fh)
    if to_stderr:
        sh = logging.StreamHandler(sys.stderr)
        sh.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s", "%H:%M:%S"))
        logger.addHandler(sh)
    return logger


def event(logger: logging.Logger, kind: str, msg: str = "", **fields: Any) -> None:
    """Log a structured event. `kind` is the event type; extra fields ride along as JSON."""
    text = msg or kind
    if fields and not msg:
        text = kind + " " + " ".join(f"{k}={str(v)[:80]!s}" for k, v in fields.items())
    logger.info(text, extra={"event": {"kind": kind, **fields}})
