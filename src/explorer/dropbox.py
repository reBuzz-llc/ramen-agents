"""The owner's drop folder (~/bots/common-data/botBox; renamed from dropbox 2026-09-24): a file put there reaches the bot that needs it.

Deterministic; no model call. The desk agent polls this from its idle loop:

* ``<slug>--name.ext`` (or ``everyone--``) is routed at once to that bot, no decision needed.
* Any other file is announced to the router bot (The CEO) with a preview; the router answers in the desk agent's
  inbox with one line ``route <name> to <bot>[, <bot>]: <why>`` (or ``to nobody``), and this module carries it out.
* Routing = a copy under ``routed/<slug>/`` (each bot's own-files search covers ``routed/<its slug>/`` and
  ``routed/everyone/``), the original moved to ``done/<date>-<name>`` (the owner's undo window), one line in ``log.md``
  and a message to every bot that got it. A changed file (new content hash) counts as a new drop.
* Retention: ``done/`` files older than ``done_days`` and ``routed/`` copies older than ``keep_days`` are deleted.

File contents are data for the bots, never instructions: nothing here reads them as commands, and the fence in the
policy is not touched by anything a file says.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import logging
import os
import re
import shutil
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

from .handoff import InboxMessage, send_message

READABLE = {".md", ".txt", ".html", ".htm", ".csv", ".json", ".jsonl"}  # what corpus.py can search
PREVIEW_CHARS = 500
EVERYONE = "everyone"
_PREFIX = re.compile(r"^([a-z0-9][a-z0-9-]*)--(.+)$", re.I)
_ROUTE = re.compile(r"^\s*route\s+(?P<file>.+?)\s+to\s+(?P<targets>[^:]+?)\s*(?::\s*(?P<reason>.*))?$", re.I | re.S)
_NOBODY = {"nobody", "no one", "noone", "none", "no-one"}


def slug_of(name: str) -> str:
    """'Lead Gen' -> 'lead-gen'; 'the-ceo' stays."""
    return re.sub(r"-{2,}", "-", re.sub(r"[^a-z0-9]+", "-", name.strip().lower())).strip("-")


@dataclass
class Routed:
    name: str
    targets: list[str]
    reason: str
    by: str


@dataclass
class DropBox:
    folder: Path
    bots_root: Path
    sender: str  # the desk agent's name, as the message sender
    router_name: str = ""  # who decides for unprefixed files ("The CEO"); "" = leave them in place
    router_folder: str = ""
    done_days: int = 7
    keep_days: int = 90
    reask_hours: int = 24  # a file the router has not routed after this long is announced again (once a day)
    logger: logging.Logger = field(default_factory=lambda: logging.getLogger("explorer.dropbox"))
    now: Callable[[], dt.datetime] = dt.datetime.now
    # Called with (message file name, recipient's display name, text) for every message this sends, so the fleet's
    # requests record (fleet_requests.py) sees drop-folder announcements too -- they are the router's priority asks.
    on_sent: Callable[[str, str, str], None] | None = None
    # {slug: command template}: run (detached) with {file} = the routed copy when a file is routed to that bot.
    hooks: dict[str, str] = field(default_factory=dict)

    # ----- layout -------------------------------------------------------------------------------------------------
    @property
    def routed_dir(self) -> Path:
        return self.folder / "routed"

    @property
    def done_dir(self) -> Path:
        return self.folder / "done"

    @property
    def state_path(self) -> Path:
        return self.folder / ".state.json"

    @property
    def log_path(self) -> Path:
        return self.folder / "log.md"

    def _state(self) -> dict:
        try:
            return json.loads(self.state_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {"files": {}}

    def _save(self, state: dict) -> None:
        tmp = self.state_path.with_suffix(".tmp")
        tmp.write_text(json.dumps(state, ensure_ascii=False, indent=1), encoding="utf-8")
        os.replace(tmp, self.state_path)

    def bots(self) -> list[str]:
        """Slugs of every bot folder (has a config.toml) under bots_root."""
        if not self.bots_root.is_dir():
            return []
        return sorted(p.name for p in self.bots_root.iterdir() if (p / "config.toml").is_file())

    def pending(self) -> list[Path]:
        """Files in the drop folder itself, not yet routed. README.md is the folder's own instructions."""
        if not self.folder.is_dir():
            return []
        return sorted(p for p in self.folder.iterdir() if p.is_file() and not p.name.startswith(".")
                      and p.name.lower() not in ("readme.md", "log.md"))

    @staticmethod
    def _sha(path: Path) -> str:
        h = hashlib.sha256()
        with path.open("rb") as f:
            for chunk in iter(lambda: f.read(65536), b""):
                h.update(chunk)
        return h.hexdigest()[:16]

    @staticmethod
    def preview(path: Path) -> str:
        if path.suffix.lower() not in READABLE:
            return "(not a text file; bots cannot read it until it is converted to .txt/.md/.csv)"
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            return "(unreadable)"
        return re.sub(r"\s+", " ", text)[:PREVIEW_CHARS].strip()

    def _log(self, line: str) -> None:
        stamp = self.now().strftime("%Y-%m-%d %H:%M")
        try:
            if not self.log_path.exists():
                self.log_path.write_text("# Drop folder log\n\nOne line per file: when, what, who got it, why.\n\n", encoding="utf-8")
            with self.log_path.open("a", encoding="utf-8") as f:
                f.write(f"- {stamp} · {line}\n")
        except OSError:
            pass

    def bot_name(self, folder: Path) -> str:
        """The display name in <folder>/config.toml [agent] name; the folder name when there is none."""
        try:
            import tomllib

            name = str((tomllib.loads((folder / "config.toml").read_text(encoding="utf-8")).get("agent") or {}).get("name") or "").strip()
        except (OSError, ValueError):
            name = ""
        return name or folder.name

    def _send(self, folder: Path, text: str) -> None:
        try:
            msg_file = send_message(folder, self.sender, text, now=self.now())
        except OSError as exc:
            self.logger.warning("dropbox: could not message %s: %s", folder, exc)
            return
        if self.on_sent is not None:
            try:
                self.on_sent(msg_file.name, self.router_name if folder == Path(self.router_folder) else self.bot_name(folder), text)
            except Exception as exc:  # noqa: BLE001 - the record is a convenience, never a reason to lose the message
                self.logger.warning("dropbox: could not record the message: %s", exc)

    # ----- the poll -----------------------------------------------------------------------------------------------
    def poll(self, inbox: list[InboxMessage] | None = None) -> tuple[list[str], list[InboxMessage]]:
        """One pass: carry out route replies from the router, take in new or changed files, prune old copies.
        Returns (report lines for the chatroom, the inbox messages this consumed)."""
        reports: list[str] = []
        consumed: list[InboxMessage] = []
        for m in inbox or []:
            if m.sender.strip().lower() != self.router_name.strip().lower() or not _ROUTE.match(m.text):
                continue
            consumed.append(m)
            reports.extend(self._apply_route(m.text, m.sender))
        state = self._state()
        files = state.setdefault("files", {})
        for path in self.pending():
            try:
                sha = self._sha(path)
            except OSError:
                continue
            entry = files.get(path.name)
            if entry and entry.get("sha") == sha:
                # already announced in this content -- but a file still waiting a day later is asked about again
                # (rebuz-franchise-leads-latest.md sat 31 hours after its announcement was lost, 2026-09-25)
                if entry.get("status") == "asked" and self.reask_hours > 0 and self.router_folder:
                    try:
                        asked_at = dt.datetime.fromisoformat(str(entry.get("at")))
                    except ValueError:
                        asked_at = self.now()
                    if (self.now() - asked_at).total_seconds() >= self.reask_hours * 3600:
                        entry["at"] = self.now().isoformat(timespec="seconds")
                        entry["status"] = "pending"
                        reports.extend(self._take_in(path, entry))
                continue
            files[path.name] = {"sha": sha, "status": "pending", "at": self.now().isoformat(timespec="seconds")}
            reports.extend(self._take_in(path, files[path.name]))
        # entries whose file is gone (routed, or the owner removed it) can go
        names = {p.name for p in self.pending()}
        for name in [n for n, e in files.items() if n not in names and e.get("status") != "routed"]:
            del files[name]
        self._save(state)
        reports.extend(self.prune())
        return reports, consumed

    def _take_in(self, path: Path, entry: dict) -> list[str]:
        m = _PREFIX.match(path.name)
        bots = self.bots()
        if m and (m.group(1).lower() in bots or m.group(1).lower() == EVERYONE):
            return self._route(path, [m.group(1).lower()], "named in the file name", "owner", stored_name=m.group(2))
        if path.suffix.lower() not in READABLE:
            entry["status"] = "unreadable"
            self._log(f"{path.name} · not routed · {path.suffix or 'no extension'} is not a text type bots can read")
            return [f"{path.name}: bots cannot read {path.suffix or 'that'} files; save it as .txt, .md or .csv and drop again"]
        if not self.router_folder:
            self._log(f"{path.name} · waiting · no router set; name the bot in the file name (lead-gen--{path.name})")
            return [f"{path.name}: no router set; rename it <bot>--{path.name}"]
        size = path.stat().st_size
        self._send(Path(self.router_folder), (
            f"file dropped by the owner: {path.name} ({path.suffix.lower() or 'no type'}, {size // 1024 or 1} KB). "
            f"Preview: {self.preview(path)} | Decide who needs it. Reply to me ({self.sender}) with exactly one line: "
            f"route {path.name} to <bot name>[, <bot name>]: <why> -- or: route {path.name} to nobody: <why>. "
            "Bots you name find it under their own files (search engine corpus); everyone = all bots."))
        entry["status"] = "asked"
        self._log(f"{path.name} · asked {self.router_name} who needs it")
        return [f"new file {path.name}: asked {self.router_name} who needs it"]

    def _apply_route(self, text: str, by: str) -> list[str]:
        m = _ROUTE.match(text)
        assert m is not None
        name = m.group("file").strip().strip("'\"`")
        raw_targets = [t for t in re.split(r",|\band\b|;", m.group("targets")) if t.strip()]
        reason = (m.group("reason") or "").strip().rstrip(".")[:200] or "no reason given"
        path = next((p for p in self.pending() if p.name.lower() == name.lower()), None)
        if path is None:
            self._log(f"{name} · route from {by} ignored · no such file waiting")
            return [f"{by} routed {name}, but no such file is waiting"]
        if all(t.strip().lower() in _NOBODY for t in raw_targets):
            self._finish(path, path.name)
            self._log(f"{path.name} · nobody · by {by} · {reason}")
            self._mark(path.name, "routed", [])
            return [f"{path.name}: {by} says nobody needs it ({reason}); moved to done/"]
        bots = self.bots()
        targets, unknown = [], []
        for t in raw_targets:
            s = slug_of(t)
            (targets if s in bots or s == EVERYONE else unknown).append(s)
        if unknown and not targets:
            self._log(f"{path.name} · route from {by} ignored · unknown bot(s) {', '.join(unknown)}")
            return [f"{by} routed {path.name} to unknown bot(s) {', '.join(unknown)}; still waiting"]
        return self._route(path, targets, reason, by)

    def _route(self, path: Path, targets: list[str], reason: str, by: str, stored_name: str | None = None) -> list[str]:
        stored = stored_name or path.name
        recipients: list[str] = []
        for slug in dict.fromkeys(targets):
            dest = self.routed_dir / slug
            dest.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(path, dest / stored)  # copyfile: the copy is dated now, so keep_days counts from today
            recipients.extend(b for b in self.bots() if b != slug_of(self.sender)) if slug == EVERYONE else recipients.append(slug)
        self._finish(path, stored)
        self._mark(path.name, "routed", targets)
        who = ", ".join(targets)
        self._log(f"{path.name} · to {who} · by {by} · {reason}")
        hooked = [self._run_hook(slug, self.routed_dir / slug / stored) for slug in dict.fromkeys(targets) if slug in self.hooks]
        hooked = [h for h in hooked if h]
        note = f"the owner dropped a file for you: {stored} ({reason}). It is one of your own files now (search engine corpus, folder routed/). Preview: {self.preview(self.routed_dir / targets[0] / stored)}"
        for slug in dict.fromkeys(recipients):
            self._send(self.bots_root / slug, note)
        return [f"routed {stored} to {who} ({reason})", *hooked]

    def _run_hook(self, slug: str, copy: Path) -> str:
        """Start the owner's command for this bot on the routed copy, detached; its output goes to <dropbox>/logs/."""
        import shlex
        import subprocess

        template = self.hooks.get(slug, "").strip()
        if not template:
            return ""
        cmd = [part.replace("{file}", str(copy)) for part in shlex.split(template)]
        logs = self.folder / "logs"
        logs.mkdir(parents=True, exist_ok=True)
        log_path = logs / f"{self.now().strftime('%Y-%m-%d-%H%M%S')}-{slug}-{copy.name[:40]}.log"
        try:
            with log_path.open("ab") as out:
                subprocess.Popen(cmd, stdout=out, stderr=subprocess.STDOUT, start_new_session=True, cwd=str(self.bots_root))
        except (OSError, ValueError) as exc:
            self._log(f"{copy.name} · hook for {slug} failed to start · {exc}")
            return f"the {slug} hook did not start: {exc}"
        self._log(f"{copy.name} · hook for {slug} started · log {log_path.name}")
        return f"started the {slug} checker on {copy.name} (log: logs/{log_path.name})"

    def _finish(self, path: Path, stored: str) -> None:
        self.done_dir.mkdir(parents=True, exist_ok=True)
        target = self.done_dir / f"{self.now().strftime('%Y-%m-%d')}-{stored}"
        n = 1
        while target.exists():
            n += 1
            target = self.done_dir / f"{self.now().strftime('%Y-%m-%d')}-{n}-{stored}"
        shutil.move(str(path), str(target))
        try:
            os.utime(target, None)  # done_days counts from the move, not from when the owner wrote the file
        except OSError:
            pass

    def _mark(self, name: str, status: str, targets: list[str]) -> None:
        state = self._state()
        entry = state.setdefault("files", {}).setdefault(name, {})
        entry.update(status=status, targets=targets, at=self.now().isoformat(timespec="seconds"))
        self._save(state)

    def prune(self) -> list[str]:
        """Delete done/ files older than done_days and routed/ copies older than keep_days."""
        out: list[str] = []
        now = self.now().timestamp()
        for base, days in ((self.done_dir, self.done_days), (self.routed_dir, self.keep_days)):
            if days <= 0 or not base.is_dir():
                continue
            for p in base.rglob("*"):
                if p.is_file() and now - p.stat().st_mtime > days * 86400:
                    try:
                        p.unlink()
                        out.append(f"deleted {p.relative_to(self.folder).as_posix()} (older than {days} days)")
                    except OSError:
                        pass
        return out
