"""The target market, named once (owner, 2026-09-30: "things don't have to be just from SPF ... it should be said in
task and goals, not in code").

`common-data/knowledge/target.toml` holds the market the family is working right now -- market, market_short, segment,
trades, areas. Cards, bios and seed interests say `{market}` / `{segment}` / `{trades}` / `{areas}` / `{market_short}`
and the engine fills them in whenever it builds a prompt, re-reading the file when it changes. Changing the target is
one edit to that file; nothing in the code names a place.

The starter's first run: the user's own answers live in the untracked common-data/local/family.toml, read on
top of target.toml -- its [target] keys win, and its [company] fills {company}, {sells}, {buyers}, {place}, {owner} and
{signoff} the same way -- so a tracked card says "{company}" and a `git pull` never meets an edited file."""
from __future__ import annotations

import re
import tomllib
from pathlib import Path

TARGET_KEYS = ("market", "market_short", "segment", "trades", "areas", "market_slug")
# family.toml [company] key -> placeholder (name -> {company})
COMPANY_KEYS = {"name": "company", "sells": "sells", "buyers": "buyers", "place": "place", "owner": "owner", "signoff": "signoff"}
KEYS = TARGET_KEYS + tuple(COMPANY_KEYS.values())
# What a card reads when no file says: generic words, never a place or a name.
GENERIC = {"market": "the target market", "market_short": "the target market", "segment": "businesses",
           "trades": "the trades the owner names", "areas": "the target market", "market_slug": "market",
           "company": "the company", "sells": "its services", "buyers": "small businesses", "place": "its area",
           "owner": "the team", "signoff": ""}


def slug(text: str) -> str:
    """'Springfield' -> 'springfield': the market as it appears in file names (the candidates feed's output)."""
    import unicodedata

    ascii_ = unicodedata.normalize("NFKD", text or "").encode("ascii", "ignore").decode("ascii")  # "São Paulo" -> "Sao Paulo"
    return re.sub(r"[^a-z0-9]+", "-", ascii_.lower()).strip("-") or "market"
_TOKEN = re.compile(r"\{(" + "|".join(KEYS) + r")\}")


def _mtime(path: Path | None) -> float | None:
    try:
        return path.stat().st_mtime if path is not None else None
    except OSError:
        return None


class Target:
    def __init__(self, path: Path | str | None, local: Path | str | None = None):
        self.path = Path(path) if path else None
        # the user's own answers: <fleet>/common-data/local/family.toml beside common-data/knowledge/target.toml
        self.local = Path(local) if local else (self.path.parent.parent / "local" / "family.toml" if self.path else None)
        self._mtime: tuple | None = None
        self.steer = ""          # family.toml's top-level steer: the owner's current direction in their words
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
        mtime = (_mtime(self.path), _mtime(self.local))
        if mtime == self._mtime:
            return False
        self._mtime = mtime
        values = dict(GENERIC)
        steer = ""
        data: dict = {}
        for path, table in ((self.path, None), (self.local, "target")):
            try:
                read = tomllib.loads(path.read_text(encoding="utf-8")) if path is not None and path.is_file() else {}
            except (OSError, ValueError):
                read = {}
            part = {k: v for k, v in ((read.get(table) if table else read) or {}).items() if k in TARGET_KEYS and str(v).strip()}
            if table and part.get("market"):     # the user's own market: the tracked file's short name and slug do not follow
                for k in ("market_short", "market_slug"):
                    if k not in part:
                        data.pop(k, None)
            data.update(part)
            if table:
                steer = str(read.get("steer") or "").strip()
                for k, token in COMPANY_KEYS.items():
                    v = str(((read.get("company") or {}) if isinstance(read.get("company"), dict) else {}).get(k, "")).strip()
                    if v:
                        values[token] = v
        for k in TARGET_KEYS:
            v = str(data.get(k, "")).strip()
            if v:
                values[k] = v
        if "market_short" not in data and data.get("market"):
            values["market_short"] = str(data["market"]).strip()
        if not str(data.get("market_slug", "")).strip() and data.get("market"):
            values["market_slug"] = slug(str(data["market"]))
        changed = values != self.values or steer != self.steer
        self.values, self.steer = values, steer
        return changed

    def fill(self, text: str) -> str:
        """Replace the known placeholders; every other brace (JSON examples on a card) is left alone."""
        if not text or "{" not in text:
            return text
        return _TOKEN.sub(lambda m: self.values[m.group(1)], text)
