#!/usr/bin/env python3
"""A day's review of the bots: are they producing, where do their answers come from, and does the
Package Designer -> The CEO handoff work?

Usage: review.py [BOT ...] [--date YYYY-MM-DD] [--since HH:MM]
       BOT is a folder under ~/bots; default: every installed bot folder with a log for that day.

Reads only: each bot's log (workspace/logs/explorer.jsonl), its database, its inbox folder, the CEO's
packages folder, and the shared call ledger (~/.config/explorer/model_calls.json, which holds today
only). Imports nothing from the bot code. Prints plain text.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import sqlite3
from collections import Counter
from pathlib import Path

BOTS = Path.home() / "bots"
LEDGER = Path.home() / ".config" / "explorer" / "model_calls.json"

# Each engine's results page has its own heading; the log keeps the start of it in the action result.
ENGINE_BY_HEADING = [
    ("'Own files:", "corpus (own files)"),
    ("'YC Library:", "yc (YC library)"),
    ("'Web search results for", "searxng (Google, Brave, DDG...)"),
    ("'Hacker News results for", "hn (Hacker News)"),
    ("'Wikipedia search results for", "wikipedia"),
    ("'Marginalia", "marginalia"),
]


def engine_of(result: str) -> str:
    for marker, name in ENGINE_BY_HEADING:
        if marker in result:
            return name
    return "browser / other"


def log_rows(ws: Path, start: str, end: str) -> list[dict]:
    path = ws / "logs" / "explorer.jsonl"
    rows = []
    if not path.exists():
        return rows
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        try:
            row = json.loads(line)
        except ValueError:
            continue
        if start <= str(row.get("ts", "")) < end:
            rows.append(row)
    return rows


def refusal_label(reason: str) -> str:
    for needle, label in (
        ("asking is closed", "asking closed after refusals"),
        ("already have that question", "question already open"),
        ("your own tools", "own tools (meta topic)"),
        ("budget", "over episode budget"),
        ("blocked for this episode", "blocked repeat"),
        ("without noting", "read/opened too much without a note"),
        ("actually opened", "package sources not actually opened"),
        ("already handed over", "package already sent"),
    ):
        if needle in reason:
            return label
    return reason[:60]


def review_bot(slug: str, start: str, end: str) -> dict:
    folder = BOTS / slug
    ws = folder / "workspace"
    rows = log_rows(ws, start, end)
    actions: Counter[str] = Counter()
    refusals: Counter[str] = Counter()
    engines: Counter[str] = Counter()
    paused: Counter[str] = Counter()
    writers: Counter[str] = Counter()
    limits: list[str] = []
    inbox_seen = 0
    nudges = 0
    for row in rows:
        kind = str(row.get("kind") or "")
        msg = str(row.get("msg", ""))
        if kind == "action":
            actions[str(row.get("action"))] += 1
            if row.get("action") == "search" and row.get("ok"):
                engines[engine_of(str(row.get("result", "")))] += 1
        elif kind == "rejected":
            refusals[f"{row.get('action')}: {refusal_label(str(row.get('reason', '')))}"] += 1
        elif kind == "search_paused":
            paused[f"{row.get('engine')} ({row.get('reason')})"] += 1
        elif kind == "inbox_seen":
            inbox_seen += int(row.get("messages") or 0)
        elif kind == "task_nudge":
            nudges += 1
        if "kept the local draft" in msg:
            writers["local draft (no remote model answered)"] += 1
        elif msg.startswith("using "):
            writers[msg[6:].split(":")[0]] += 1
        if "rate limit" in msg or "server error" in msg or "token budget" in msg or "throttled" in msg:
            limits.append(f"{str(row.get('ts'))[11:16]} {msg[:130]}")

    out: dict = {"slug": slug, "rows": len(rows)}
    db_path = ws / "explorer.sqlite3"
    if not db_path.exists():
        return out
    db = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    db.row_factory = sqlite3.Row
    notes = db.execute("SELECT id, title FROM notes WHERE created_at >= ? AND created_at < ? ORDER BY id", (start, end)).fetchall()
    tasks = db.execute("SELECT title, priority, url FROM tasks WHERE created_at >= ? AND created_at < ? ORDER BY id", (start, end)).fetchall()
    packages = []
    for r in db.execute("SELECT ts, payload FROM actions WHERE action_type = 'package' AND verdict = 'allowed' AND ts >= ? AND ts < ? ORDER BY id", (start, end)):
        try:
            p = json.loads(r["payload"])
        except ValueError:
            continue
        packages.append((r["ts"][11:16], str(p.get("name", "")), str(p.get("price", "")), len(p.get("sources") or [])))
    episodes = db.execute("SELECT COUNT(*) FROM episodes WHERE started_at >= ? AND started_at < ?", (start, end)).fetchone()[0]
    running = (ws / "STOP").exists() is False

    tags: list[str] = []
    cfg_path = folder / "config.toml"
    if cfg_path.is_file():
        try:
            import tomllib
            tags = list(tomllib.loads(cfg_path.read_text(encoding="utf-8")).get("agent", {}).get("tags", []) or [])
        except (OSError, ValueError):
            tags = []
    tag_str = f" · tags: {', '.join(tags)}" if tags else ""
    print(f"\n=== {slug}{'' if running else ' (STOP file present: stopped)'}{tag_str}")
    print(f"  episodes {episodes} · notes {len(notes)} · Notion tasks {len(tasks)} · packages sent {len(packages)}"
          + (f" · task nudges {nudges}" if nudges else "") + (f" · messages read from other bots {inbox_seen}" if inbox_seen else ""))
    if not rows:
        print("  (no log lines in this window)")
        return out
    print("  actions:", ", ".join(f"{k} {v}" for k, v in actions.most_common()) or "none")
    total = sum(engines.values())
    if total:
        print(f"  searches answered by ({total}):", ", ".join(f"{k} {v} ({100 * v // total}%)" for k, v in engines.most_common()))
    if paused:
        print("  engines paused:", ", ".join(f"{k} x{v}" for k, v in paused.most_common()))
    if writers:
        print("  who wrote notes/tasks/packages:", ", ".join(f"{k} {v}" for k, v in writers.most_common()))
    if refusals:
        print("  top refusals:", "; ".join(f"{k} x{v}" for k, v in refusals.most_common(5)))
    if limits:
        print(f"  limits and errors ({len(limits)}), last few:")
        for line in limits[-4:]:
            print("    " + line)
    if notes:
        print("  notes:")
        for n in notes[-8:]:
            print(f"    #{n['id']} {n['title']}")
    if packages:
        print("  packages sent:")
        for when, name, price, nsrc in packages:
            print(f"    {when} {name} · {price} · {nsrc} source(s)")
    if tasks:
        print("  Notion tasks:")
        for t in tasks:
            print(f"    [{t['priority']}] {t['title']}")
    out.update(packages=packages, tasks=[t["title"] for t in tasks])
    return out


def scout_kpi(results: dict[str, dict], start: str, end: str) -> None:
    """The Scout's measures: finds in the window, finds adopted (a key on disk), tokens per find."""
    if "scout" not in results:
        return
    report = BOTS / "common-data" / "providers-found.md"
    keys = BOTS / "common-data" / "keys"
    found, adopted, in_window = 0, 0, 0
    if report.is_file():
        text = report.read_text(encoding="utf-8").split("# Declined")[0]
        for m in re.finditer(r"^## ([^\n]+)\n\nFound (\d{4}-\d{2}-\d{2})\..*?`~/bots/common-data/keys/([^`]+)`", text, re.M | re.S):
            found += 1
            if (keys / m.group(3)).is_file():
                adopted += 1
            if start[:10] <= m.group(2) < end[:10]:
                in_window += 1
    ws = BOTS / "scout" / "workspace"
    db = sqlite3.connect(f"file:{ws / 'explorer.sqlite3'}?mode=ro", uri=True)
    notes = db.execute("SELECT COUNT(*) FROM notes WHERE created_at >= ? AND created_at < ?", (start, end)).fetchone()[0]
    reads = db.execute("SELECT COUNT(*) FROM actions WHERE action_type IN ('open','follow','read') AND verdict='allowed' AND ts >= ? AND ts < ?", (start, end)).fetchone()[0]
    print(f"\n=== scout KPI: finds in window {in_window} · finds on record {found} ({adopted} adopted, key on disk) · "
          f"reads {reads} vs notes {notes} ({(reads / notes):.1f} reads per note)" if notes else
          f"\n=== scout KPI: finds in window {in_window} · finds on record {found} ({adopted} adopted, key on disk) · reads {reads}, notes 0")
    watch = BOTS / "common-data" / "provider-watch-report.md"
    if watch.is_file():
        print("  terms watch: " + (watch.read_text(encoding="utf-8").splitlines()[2] if len(watch.read_text(encoding="utf-8").splitlines()) > 2 else "(no report yet)"))


def handoff_check(results: dict[str, dict], start: str, end: str) -> None:
    sent = results.get("package-designer", {}).get("packages", [])
    ceo = results.get("the-ceo", {})
    if not sent and "package-designer" not in results:
        return
    print("\n=== Package Designer -> The CEO")
    inbox = BOTS / "the-ceo" / "workspace" / "inbox"
    waiting = sorted(inbox.glob("*.json")) if inbox.is_dir() else []
    done = sorted((inbox / "done").glob("*.json")) if (inbox / "done").is_dir() else []
    files = sorted((BOTS / "the-ceo" / "raw" / "packages").glob("*.md"))
    print(f"  package files in the-ceo/raw/packages: {len(files)} · inbox unread {len(waiting)} · read {len(done)}")
    tasks = [t.lower() for t in ceo.get("tasks", [])]
    for _, name, price, _ in sent:
        match = next((t for t in tasks if name.lower() in t), None)
        print(f"  {name} ({price}): " + (f"Notion task created: {match}" if match else "no Notion task with that name yet"))
    if not sent:
        print("  no packages sent in this window")


def cost_per_output(results: dict[str, dict], start: str, end: str) -> None:
    """Tokens per thing that landed.
    Tokens come from the ledger's per-bot totals (today only); outputs from each bot's accepted actions in the window."""
    if not LEDGER.exists() or start[:10] != dt.date.today().isoformat():
        return
    try:
        by_bot = (json.loads(LEDGER.read_text(encoding="utf-8")).get("by_bot") or {})
    except (OSError, ValueError):
        return
    if not by_bot:
        return
    print("\n=== Cost per output today (remote tokens per accepted lead / update_lead / task / package / publish / provider)")
    for slug, info in results.items():
        db_path = BOTS / slug / "workspace" / "explorer.sqlite3"
        if not db_path.exists():
            continue
        db = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
        outputs = db.execute(
            "SELECT COUNT(*) FROM actions WHERE verdict = 'allowed' AND ts >= ? AND ts < ? AND action_type IN "
            "('lead','update_lead','task','update_task','package','publish_package','provider')", (start, end)).fetchone()[0]
        name = None
        try:
            import tomllib
            name = tomllib.loads((BOTS / slug / "config.toml").read_text(encoding="utf-8")).get("agent", {}).get("name")
        except (OSError, ValueError):
            pass
        tokens = int(by_bot.get(name or "", 0))
        if tokens or outputs:
            per = f"{tokens // outputs:,} tokens per output" if outputs else "no output yet"
            print(f"  {slug:18s} {tokens:>10,} tokens · {outputs:3d} outputs · {per}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("bots", nargs="*")
    ap.add_argument("--date", default=dt.date.today().isoformat())
    ap.add_argument("--since", default="00:00", help="only count from this local time on")
    args = ap.parse_args()
    start, end = f"{args.date}T{args.since}", f"{args.date}T99"
    slugs = args.bots or sorted(p.name for p in BOTS.iterdir() if (p / "config.toml").is_file() and (p / "workspace" / "logs" / "explorer.jsonl").exists())
    print(f"Review for {args.date} from {args.since}")
    results = {s: review_bot(s, start, end) for s in slugs}
    scout_kpi(results, start, end)
    handoff_check(results, start, end)
    cost_per_output(results, start, end)
    if LEDGER.exists() and args.date == dt.date.today().isoformat():
        data = json.loads(LEDGER.read_text(encoding="utf-8"))
        if data.get("day") == args.date:
            print("\n=== Remote models today (all bots)")
            print("  calls:", data.get("counts"))
            for provider, by_kind in (data.get("usage") or {}).items():
                for k, (calls, prompt, completion) in by_kind.items():
                    print(f"  {provider} {k}: {calls} calls, {prompt + completion} tokens (~{(prompt + completion) // max(calls, 1)} each)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
