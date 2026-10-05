"""The target market, named once (owner, 2026-09-30: "things don't have to be just from SPF ... it should be said in
task and goals, not in code").

`common-data/knowledge/target.toml` holds the market the family is working right now -- market, market_short, segment,
trades, areas. Cards, bios and seed interests say `{market}` / `{segment}` / `{trades}` / `{areas}` / `{market_short}`
and the engine fills them in whenever it builds a prompt, re-reading the file when it changes. Changing the target is
one edit to that file; nothing in the code names a place."""
from __future__ import annotations

import re
import tomllib
from pathlib import Path

KEYS = ("market", "market_short", "segment", "trades", "areas", "market_slug")
# What a card reads when no target file exists: generic words, never a place.
GENERIC = {"market": "the target market", "market_short": "the target market", "segment": "businesses",
           "trades": "the trades the owner names", "areas": "the target market", "market_slug": "market"}


def slug(text: str) -> str:
    """'Springfield' -> 'springfield': the market as it appears in file names (the candidates feed's output)."""
    import unicodedata

    ascii_ = unicodedata.normalize("NFKD", text or "").encode("ascii", "ignore").decode("ascii")  # "São Paulo" -> "Sao Paulo"
    return re.sub(r"[^a-z0-9]+", "-", ascii_.lower()).strip("-") or "market"
_TOKEN = re.compile(r"\{(" + "|".join(KEYS) + r")\}")


class Target:
    def __init__(self, path: Path | str | None):
        self.path = Path(path) if path else None
        self._mtime: float | None = None
        self.values: dict[str, str] = dict(GENERIC)
        self.refresh()

    @classmethod
    def for_root(cls, root: Path) -> "Target":
        """The fleet's target file beside a bot folder: <fleet>/common-data/knowledge/target.toml."""
        return cls(Path(root).parent / "common-data" / "knowledge" / "target.toml")

    def refresh(self) -> bool:
        """Re-read the file when it changed. True when the values changed (prompts should be rebuilt)."""
        if self.path is None:
            return False
        try:
            mtime: float | None = self.path.stat().st_mtime
        except OSError:
            mtime = None
        if mtime == self._mtime:
            return False
        self._mtime = mtime
        values = dict(GENERIC)
        if mtime is not None:
            try:
                data = tomllib.loads(self.path.read_text(encoding="utf-8"))
                for k in KEYS:
                    v = str(data.get(k, "")).strip()
                    if v:
                        values[k] = v
                if "market_short" not in data and data.get("market"):
                    values["market_short"] = str(data["market"]).strip()
                if not str(data.get("market_slug", "")).strip() and data.get("market"):
                    values["market_slug"] = slug(str(data["market"]))
            except (OSError, ValueError):
                pass
        changed = values != self.values
        self.values = values
        return changed

    def fill(self, text: str) -> str:
        """Replace the known placeholders; every other brace (JSON examples on a card) is left alone."""
        if not text or "{" not in text:
            return text
        return _TOKEN.sub(lambda m: self.values[m.group(1)], text)
