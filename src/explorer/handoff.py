"""Bots handing work to each other on this Mac: package files plus an inbox.

The sender (the Package Designer, `[handoff]` in its config) writes each package as Markdown into the
recipient bot's folder (`files_dir`, its searchable raw/ folder by default) and drops one JSON message
into the recipient's `workspace/inbox/`. The recipient (any bot; nothing to configure) shows unread
inbox messages in its observation as "From <sender>: ...", and moves each one to `inbox/done/` once its
model has seen it, the way owner chat messages are marked seen.

Plain files, written atomically (temp file and rename), so two separate processes never share a
database. Nothing leaves the Mac. A message from another bot is a colleague's information: the
recipient's policy and persona decide what to do with it.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .actions import Package
from .config import HandoffConfig

MAX_MESSAGE_CHARS = 900


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:60] or "package"


def _atomic_write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, path)


def _company_markdown(c) -> str:
    """A 'Source company' section from whatever facts were actually read; empty when nothing was."""
    rows = [
        (label, getattr(c, field).strip())
        for label, field in (("Company", "name"), ("Founded", "founded"), ("Employees", "employees"),
                             ("Valuation", "valuation"), ("Location", "location"), ("Website", "website"),
                             ("About", "history"))
    ]
    lines = [f"- **{label}:** {value}" for label, value in rows if value]
    return f"\n## Source company\n\n" + "\n".join(lines) + "\n" if lines else ""


def package_markdown(pkg: Package, sender: str, now: dt.datetime) -> str:
    deliverables = "\n".join(f"- {d.strip()}" for d in pkg.deliverables if d.strip()) or "- (none listed)"
    sources = "\n".join(f"- {s.strip()}" for s in pkg.sources if s.strip()) or "- (none)"
    return (
        f"# Package: {pkg.name.strip()}\n\n"
        f"Proposed by {sender} (automated agent) on {now.isoformat(timespec='minutes')}.\n\n"
        f"- **Price:** {pkg.price.strip()}\n"
        f"- **For:** {pkg.audience.strip()}\n"
        + (f"- **Timeline:** {pkg.timeline.strip()}\n" if pkg.timeline.strip() else "")
        + f"\n## What the client gets\n\n{deliverables}\n\n"
        f"## Why this package and price\n\n{pkg.rationale.strip()}\n\n"
        f"## Sources read\n\n{sources}\n"
        + _company_markdown(pkg.source_company)
    )


def send_package(cfg: HandoffConfig, sender: str, pkg: Package, now: dt.datetime | None = None) -> tuple[Path, Path]:
    """Write the package file and the inbox message. Returns (package file, message file)."""
    now = now or dt.datetime.now()
    recipient = Path(cfg.to_folder).expanduser()
    stamp = now.strftime("%Y-%m-%d-%H%M%S")
    pkg_file = recipient / cfg.files_dir / f"{stamp}-{_slug(pkg.name)}.md"
    _atomic_write(pkg_file, package_markdown(pkg, sender, now))
    items = "; ".join(d.strip() for d in pkg.deliverables if d.strip())
    text = (
        f"new package \"{pkg.name.strip()}\" at {pkg.price.strip()}, for {pkg.audience.strip()}"
        + (f", {pkg.timeline.strip()}" if pkg.timeline.strip() else "")
        + f". Includes: {items}. Why: {pkg.rationale.strip()}"
    )[:MAX_MESSAGE_CHARS]
    rel = pkg_file.relative_to(recipient).as_posix()
    message = {
        "from": sender,
        "kind": "package",
        "sent_at": now.isoformat(timespec="seconds"),
        "name": pkg.name.strip(),
        "price": pkg.price.strip(),
        "file": rel,
        "text": text + f" Full package: your file {rel} (search your own files for its name).",
        # The full structured package, so the recipient can publish it (e.g. a Notion toggle) faithfully.
        "package": pkg.model_dump(),
    }
    msg_file = recipient / "workspace" / "inbox" / f"{stamp}-{_slug(pkg.name)}.json"
    _atomic_write(msg_file, json.dumps(message, ensure_ascii=False, indent=1))
    return pkg_file, msg_file


def send_message(peer_folder: str | Path, sender: str, text: str, now: dt.datetime | None = None) -> Path:
    """Drop a plain research message into the peer bot's inbox. Returns the message file.

    The peer reads it with the same Inbox as packages ("From <sender>: ..."). No package file: this
    is a short question, tip or answer, not a deliverable. The policy already capped and (for a
    plain_only bot) sanitised the text; this only trims to the hard ceiling and writes it."""
    now = now or dt.datetime.now()
    recipient = Path(peer_folder).expanduser()
    stamp = now.strftime("%Y-%m-%d-%H%M%S")
    body = text.strip()[:MAX_MESSAGE_CHARS]
    message = {
        "from": sender,
        "kind": "message",
        "sent_at": now.isoformat(timespec="seconds"),
        "text": body,
    }
    inbox = recipient / "workspace" / "inbox"
    msg_file = inbox / f"{stamp}-{_slug(body[:40])}.json"
    n = 1
    while msg_file.exists():  # several messages in one second with the same opening words must not overwrite each other
        n += 1
        msg_file = inbox / f"{stamp}-{_slug(body[:40])}-{n}.json"
    _atomic_write(msg_file, json.dumps(message, ensure_ascii=False, indent=1))
    return msg_file


def find_package(workspace: Path | str, name: str) -> dict[str, Any] | None:
    """The most recent received package with this name (from the inbox and inbox/done json messages),
    so the recipient can publish its full data. Case-insensitive on the name."""
    inbox = Path(workspace) / "inbox"
    want = name.strip().lower()
    best: tuple[str, dict[str, Any]] | None = None
    for path in [*inbox.glob("*.json"), *(inbox / "done").glob("*.json")]:
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        pkg = data.get("package")
        if data.get("kind") == "package" and isinstance(pkg, dict) and str(pkg.get("name", "")).strip().lower() == want:
            if best is None or str(data.get("sent_at", "")) >= best[0]:
                best = (str(data.get("sent_at", "")), pkg)
    if best:
        return best[1]
    return _package_from_files(Path(workspace).parent, want)


_COMPANY_ROWS = {"Company": "name", "Founded": "founded", "Employees": "employees", "Valuation": "valuation",
                 "Location": "location", "Website": "website", "About": "history"}


def _section(md: str, title: str) -> str:
    m = re.search(rf"^## {re.escape(title)}\s*\n(.*?)(?=^## |\Z)", md, re.M | re.S)
    return m.group(1).strip() if m else ""


def _field(text: str, label: str) -> str:
    m = re.search(rf"^- \*\*{re.escape(label)}:\*\*\s*(.+)$", text, re.M)
    return m.group(1).strip() if m else ""


def received_package_names(bot_folder: Path) -> dict[str, str]:
    """{package name: date received} for every package file in raw/packages/ (newest file per name wins)."""
    out: dict[str, str] = {}
    for path in sorted((bot_folder / "raw" / "packages").glob("*.md")):
        try:
            head = path.read_text(encoding="utf-8", errors="replace")[:600]
        except OSError:
            continue
        m = re.search(r"^# Package: (.+)$", head, re.M)
        if m:
            out[m.group(1).strip()] = path.name[:10]
    return out


def _package_from_files(bot_folder: Path, want: str) -> dict[str, Any] | None:
    """Read the package back from the Markdown file send_package wrote (raw/packages/*.md), for packages
    handed over before the inbox message carried the full dict. Newest matching file wins."""
    for path in sorted((bot_folder / "raw" / "packages").glob("*.md"), reverse=True):
        try:
            md = path.read_text(encoding="utf-8")
        except OSError:
            continue
        head = re.match(r"# Package: (.+)", md)
        if not head or head.group(1).strip().lower() != want:
            continue
        bullets = lambda text: [b.strip() for b in re.findall(r"^- (.+)$", text, re.M)]  # noqa: E731
        company_md = _section(md, "Source company")
        return {
            "name": head.group(1).strip(), "price": _field(md, "Price"), "audience": _field(md, "For"),
            "timeline": _field(md, "Timeline"), "deliverables": bullets(_section(md, "What the client gets")),
            "rationale": _section(md, "Why this package and price"),
            "sources": [u for u in bullets(_section(md, "Sources read")) if u.startswith(("http://", "https://", "fake://"))],
            "source_company": {fld: _field(company_md, label) for label, fld in _COMPANY_ROWS.items()},
        }
    return None


@dataclass
class InboxMessage:
    path: Path
    sender: str
    text: str

    def render(self) -> str:
        return f"From {self.sender}: {self.text}"


class Inbox:
    """A bot's own workspace/inbox/: unread messages from other bots, oldest first."""

    def __init__(self, workspace: Path):
        self.folder = Path(workspace) / "inbox"

    def unread(self, limit: int = 3) -> list[InboxMessage]:
        if not self.folder.is_dir():
            return []
        out: list[InboxMessage] = []
        for path in sorted(self.folder.glob("*.json"))[:limit]:
            try:
                data: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                self._file_away(path, "broken")
                continue
            sender = str(data.get("from") or "another bot").strip()[:60]
            text = str(data.get("text") or "").strip()[:MAX_MESSAGE_CHARS + 200]
            if text:
                out.append(InboxMessage(path, sender, text))
            else:
                self._file_away(path, "broken")
        return out

    def mark_seen(self, messages: list[InboxMessage]) -> None:
        for m in messages:
            self._file_away(m.path, "done")

    @staticmethod
    def _file_away(path: Path, sub: str) -> None:
        target = path.parent / sub / path.name
        try:
            target.parent.mkdir(parents=True, exist_ok=True)
            os.replace(path, target)
        except OSError:
            pass  # already moved by a restart of the same bot; nothing to do
