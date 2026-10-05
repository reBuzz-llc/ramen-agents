#!/usr/bin/env python3
"""Weekly terms watch for the providers the fleet depends on.

Reads common-data/provider-watchlist.md, fetches each page as text, and compares it with the snapshot from the
last run (common-data/shared-state/provider-watch/). For every page that changed it asks the fleet's writing model
for a two-line summary of what changed in the free terms, then writes common-data/provider-watch-report.md, drops a
short message into the Scout's inbox (so it reads the changes and notes what matters), and posts one line to the
fleet chatroom. First run only seeds the snapshots. Read-only on the web; no model call when nothing changed.

    ~/Projects/bot/.venv/bin/python ~/bots/scripts/provider_watch.py [--quiet]
"""
from __future__ import annotations

import difflib
import hashlib
import json
import logging
import re
import sys
import time
from pathlib import Path

import httpx

from explorer.chatroom import Chatroom
from explorer.common.fallback import build_model
from explorer.config import load_config
from explorer.handoff import send_message
from explorer.light_browser import LightBrowser

COMMON = Path.home() / "bots" / "common-data"
WATCHLIST = COMMON / "provider-watchlist.md"
SNAPSHOTS = COMMON / "shared-state" / "provider-watch"
REPORT = COMMON / "provider-watch-report.md"
SCOUT = Path.home() / "bots" / "scout"
CEO_CFG = Path.home() / "bots" / "the-ceo" / "config.toml"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36"
SYSTEM = ("You compare two versions of an AI provider's pricing or limits page. In at most three short bullet points, say "
          "what changed that matters to a user on the FREE tier: limits, prices, card requirements, models added or retired. "
          "Only what the diff shows; if the changes are cosmetic (dates, layout, wording), answer exactly: no material change.")


def entries() -> list[tuple[str, str]]:
    out = []
    for line in WATCHLIST.read_text(encoding="utf-8").splitlines():
        m = re.match(r"^- (.+?) \| (https?://\S+)$", line.strip())
        if m:
            out.append((m.group(1).strip(), m.group(2).strip()))
    return out


def fetch(browser: LightBrowser, client: httpx.Client, url: str) -> str | None:
    if "raw.githubusercontent.com" in url:
        try:
            r = client.get(url, timeout=30)
            return r.text if r.status_code == 200 else None
        except httpx.HTTPError:
            return None
    try:
        page = browser.open(url)
    except Exception:  # noqa: BLE001
        return None
    return page.text if page.ok and len(page.text) > 300 else None


def normalise(text: str) -> str:
    text = re.sub(r"\d{1,2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{4}", "<date>", text)
    return re.sub(r"[ \t]+", " ", text).strip()


def main() -> None:
    quiet = "--quiet" in sys.argv
    logging.basicConfig(level=logging.WARNING)
    SNAPSHOTS.mkdir(parents=True, exist_ok=True)
    browser = LightBrowser(UA, chromium=lambda: (_ for _ in ()).throw(RuntimeError("no chromium")), timeout_seconds=30)
    client = httpx.Client(headers={"User-Agent": UA}, follow_redirects=True)
    model = None
    changed: list[tuple[str, str, str]] = []
    unreadable: list[str] = []
    seeded = 0
    for name, url in entries():
        text = fetch(browser, client, url)
        if text is None:
            unreadable.append(f"{name} ({url})")
            continue
        text = normalise(text)
        key = hashlib.sha1(url.encode()).hexdigest()[:16]
        snap = SNAPSHOTS / f"{key}.txt"
        if not snap.exists():
            snap.write_text(text, encoding="utf-8"); seeded += 1
            continue
        old = snap.read_text(encoding="utf-8")
        if old == text:
            continue
        diff = "\n".join(difflib.unified_diff(old.splitlines(), text.splitlines(), lineterm="", n=1))[:6000]
        if model is None:
            model = build_model(load_config(CEO_CFG).model, logging.getLogger("watch"))
        summary = (model.complete(SYSTEM, f"Provider page: {name} ({url})\n\nDiff (old -> new):\n{diff}") or "").strip()
        snap.write_text(text, encoding="utf-8")
        if summary and "no material change" not in summary.lower():
            changed.append((name, url, summary))
        time.sleep(1)
    stamp = time.strftime("%Y-%m-%d %H:%M")
    lines = [f"# Provider terms watch — {stamp}", "", f"Pages watched: {len(entries())} · changed: {len(changed)} · seeded: {seeded} · unreadable: {len(unreadable)}", ""]
    for name, url, summary in changed:
        lines += [f"## {name}", f"<{url}>", "", summary, ""]
    if unreadable:
        lines += ["## Could not read", *[f"- {u}" for u in unreadable], ""]
    REPORT.write_text("\n".join(lines), encoding="utf-8")
    if changed and not quiet:
        heads = "; ".join(n for n, _, _ in changed)
        send_message(SCOUT, "Provider watch", f"weekly terms watch: {len(changed)} provider page(s) changed -- {heads}. "
                     f"Read the report in your files (provider-watch-report.md) and note what matters to the fleet's free budget.")
        try:
            Chatroom(COMMON / "chatroom.jsonl").post("Provider watch", f"Weekly terms watch: {len(changed)} change(s) -- {heads}. Report: common-data/provider-watch-report.md")
        except Exception:  # noqa: BLE001
            pass
    print(f"watched {len(entries())}: changed {len(changed)}, seeded {seeded}, unreadable {len(unreadable)} -> {REPORT}")
    for name, _, summary in changed:
        print(f"  * {name}: {summary.splitlines()[0][:120]}")
    for u in unreadable:
        print(f"  ? unreadable: {u[:100]}")


if __name__ == "__main__":
    main()
