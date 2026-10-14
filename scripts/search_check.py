#!/usr/bin/env python3
"""Search health check.

When every source behind the local SearXNG bot-checks this Mac, the bots' searches return nothing and nobody is
told; the bots just "find nothing" and rest. This runs one ordinary test search every three
hours (launchd: com.ramen-agents.search-check), records which engines answered in common-data/shared-state/search-health.json,
and posts a macOS notification when search returns nothing -- once when it goes down, again every 12 hours while it
stays down, and once when it is back. A zero-result check is repeated once after a minute with another query before
it counts, so one blip is not an alert. Eight test searches a day against the fleet's ~100.

    ~/Projects/bot/.venv/bin/python ~/bots/scripts/search_check.py [--quiet] [--no-notify] [--test-notify]
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import subprocess
import sys
import time
from pathlib import Path

import httpx

COMMON = Path.home() / "bots" / "common-data"
STATE = COMMON / "shared-state" / "search-health.json"
LOG = COMMON / "logs" / "search-check.log"
SEARXNG = "http://127.0.0.1:8888"
# Ordinary questions any engine answers; a different one each run so the check is not one repeated query.
QUERIES = [
    "public library opening hours",
    "how to bake sourdough bread",
    "bicycle repair shop",
    "history of the telephone",
    "best way to learn spanish",
    "community garden volunteer",
    "used bookstore",
    "how does a heat pump work",
]
REMIND_HOURS = 12
RETRY_SECONDS = 60


def now() -> dt.datetime:
    return dt.datetime.now().astimezone().replace(microsecond=0)


def probe(client: httpx.Client, base_url: str, query: str) -> dict:
    """One search: how many results, which engines gave them, which refused and why."""
    try:
        resp = client.get(f"{base_url}/search", params={"q": query, "format": "json"})
    except httpx.HTTPError as exc:
        return {"query": query, "results": 0, "answered": {}, "refused": {}, "error": f"search service not answering ({type(exc).__name__})"}
    if resp.status_code != 200:
        return {"query": query, "results": 0, "answered": {}, "refused": {}, "error": f"search service answered HTTP {resp.status_code}"}
    try:
        data = resp.json()
    except ValueError:
        return {"query": query, "results": 0, "answered": {}, "refused": {}, "error": "search service answered something that is not JSON"}
    answered: dict[str, int] = {}
    results = data.get("results") or []
    for row in results:
        for engine in row.get("engines") or []:
            answered[engine] = answered.get(engine, 0) + 1
    refused = {str(e[0]): str(e[1]) for e in data.get("unresponsive_engines") or [] if isinstance(e, (list, tuple)) and len(e) >= 2}
    return {"query": query, "results": len(results), "answered": answered, "refused": refused, "error": ""}


def notify(title: str, body: str) -> None:
    script = f"display notification {json.dumps(body)} with title {json.dumps(title)}"
    try:
        subprocess.run(["/usr/bin/osascript", "-e", script], capture_output=True, timeout=15)
    except (OSError, subprocess.SubprocessError):
        pass  # the state file and the log still say it


def load_state(path: Path) -> dict:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def why(check: dict) -> str:
    if check["error"]:
        return check["error"]
    if check["refused"]:
        return "every source refused: " + ", ".join(f"{k} ({v})" for k, v in sorted(check["refused"].items()))
    return "no source returned a result"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--quiet", action="store_true", help="print nothing when search is healthy")
    ap.add_argument("--no-notify", action="store_true", help="record only, no macOS notification")
    ap.add_argument("--test-notify", action="store_true", help="post one test notification and exit")
    ap.add_argument("--url", default=SEARXNG)
    ap.add_argument("--state", type=Path, default=STATE)
    ap.add_argument("--retry-seconds", type=float, default=RETRY_SECONDS)
    args = ap.parse_args()
    if args.test_notify:
        notify("Search check (test)", "This is what an alert looks like when the bots' web search returns nothing.")
        return 0

    at = now()
    first = at.hour // 3 % len(QUERIES)
    with httpx.Client(timeout=45) as client:
        check = probe(client, args.url, QUERIES[first])
        attempts = 1
        if check["results"] == 0:
            time.sleep(args.retry_seconds)
            check = probe(client, args.url, QUERIES[(first + 1) % len(QUERIES)])
            attempts = 2
    ok = check["results"] > 0

    prev = load_state(args.state)
    down_since = prev.get("down_since") or ""
    last_alert = prev.get("last_alert") or ""
    alert = ""
    if ok:
        if down_since:
            alert = f"Web search is back: {len(check['answered'])} sources answering (it was down since {down_since[11:16]} on {down_since[:10]})."
            if not args.no_notify:
                notify("Bots: web search is back", alert)
        down_since = last_alert = ""
    else:
        reminded = dt.datetime.fromisoformat(last_alert) if last_alert else None
        if not down_since:
            down_since = at.isoformat()
        if reminded is None or (at - reminded).total_seconds() >= REMIND_HOURS * 3600:
            alert = f"The bots' web search returns nothing ({why(check)}). Tell the dev agent: fix search."
            if not args.no_notify:
                notify("Bots: web search is down", alert)
            last_alert = at.isoformat()

    state = {
        "checked_at": at.isoformat(),
        "ok": ok,
        "results": check["results"],
        "query": check["query"],
        "attempts": attempts,
        "answered": check["answered"],   # engine -> results it contributed
        "refused": check["refused"],     # engine -> SearXNG's reason (CAPTCHA, too many requests, timeout, ...)
        "thin": ok and len(check["answered"]) < 2,   # one source left: the next block means nothing
        "error": "" if ok else why(check),
        "down_since": down_since,
        "last_alert": last_alert,
        "last_ok": at.isoformat() if ok else prev.get("last_ok", ""),
    }
    args.state.parent.mkdir(parents=True, exist_ok=True)
    tmp = args.state.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")
    tmp.replace(args.state)

    line = (f"{at.isoformat()} {'ok' if ok else 'DOWN'} results={check['results']} "
            f"answered={','.join(sorted(check['answered'])) or '-'} refused={','.join(sorted(check['refused'])) or '-'}"
            + (f" alert={alert!r}" if alert else ""))
    if args.state == STATE:
        LOG.parent.mkdir(parents=True, exist_ok=True)
        with LOG.open("a", encoding="utf-8") as fh:
            fh.write(line + "\n")
    if not (args.quiet and ok):
        print(line)
    return 0


if __name__ == "__main__":
    sys.exit(main())
