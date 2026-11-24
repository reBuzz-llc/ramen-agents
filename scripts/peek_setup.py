#!/usr/bin/env python3
"""The steps of `sh scripts/peek.sh setup` and `back` that read files or Peek (935 stage 4). Standard library only.

    python3 scripts/peek_setup.py local-rows [--board FILE]            # rows on the dashboard's local board (0: none)
    python3 scripts/peek_setup.py expected --dir DIR --stamp STAMP     # what the move's files hold, as counts
    python3 scripts/peek_setup.py check-export --dir DIR --stamp STAMP # exit 1 when the files hold fewer leads and tasks than the board
    python3 scripts/peek_setup.py readback --dir DIR --stamp STAMP [--url URL] [--key FILE]
                                                                       # the same counts read back from Peek; exit 1 on a mismatch
    python3 scripts/peek_setup.py set-url URL                          # [leads] portal_url in common-data/configs/local.toml
    python3 scripts/peek_setup.py unset-url                            # take it out again (back to the local board)
    python3 scripts/peek_setup.py news --portal DIR --old REV          # Peek's own docs/updates.json lines new since REV

The read-back uses the dashboard's read key (common-data/keys/portal-dashboard.key), sent in a header by this program,
never on a command line. Every lead and task the files hold must be on Peek by its id, archived ones included, and the
rate and package lists must hold as many lines as the files.
"""
from __future__ import annotations

import argparse
import json
import re
import sqlite3
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOCAL_TOML = ROOT / "common-data" / "configs" / "local.toml"
BOARD = ROOT / "common-data" / "local-board.sqlite3"
KEY = ROOT / "common-data" / "keys" / "portal-dashboard.key"
PEEK = "http://127.0.0.1:3100"


def local_rows(board: Path = BOARD, boards: tuple[str, ...] = ()) -> int:
    """Rows on the dashboard's local board (only the named boards when given); 0 with no board file."""
    if not board.exists():
        return 0
    con = sqlite3.connect(f"file:{board}?mode=ro", uri=True)
    try:
        if boards:
            q = f"SELECT count(*) FROM rows WHERE board IN ({','.join('?' * len(boards))})"
            return int(con.execute(q, boards).fetchone()[0])
        return int(con.execute("SELECT count(*) FROM rows").fetchone()[0])
    except sqlite3.Error:
        return 0
    finally:
        con.close()


def _lines(path: Path) -> list[dict]:
    return [json.loads(x) for x in path.read_text(encoding="utf-8").splitlines() if x.strip()] if path.exists() else []


def expected(folder: Path, stamp: str) -> dict:
    leads = _lines(folder / f"leads-rebuild-{stamp}.jsonl")
    tasks = _lines(folder / f"tasks-rebuild-{stamp}.jsonl")
    assets = _lines(folder / f"assets-rebuild-{stamp}.jsonl")
    return {"leads": {x["id"] for x in leads if x.get("id")}, "tasks": {x["id"] for x in tasks if x.get("id")},
            "rates": sum(1 for a in assets if a.get("kind") == "rate"), "packages": sum(1 for a in assets if a.get("kind") == "package")}


def check_export(folder: Path, stamp: str, board: Path = BOARD) -> tuple[str, bool]:
    """The local board's leads and tasks against the move's files: a line with both numbers, and whether none is missing."""
    have = local_rows(board, ("leads", "tasks"))
    w = expected(folder, stamp)
    files = len(w["leads"]) + len(w["tasks"])
    return f"local board {have} leads and tasks; in the move's files {files}", files >= have


def _get(url: str, key: str) -> dict:
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {key}"})
    with urllib.request.urlopen(req, timeout=30) as r:  # noqa: S310 -- this Mac's own Peek
        return json.loads(r.read().decode("utf-8"))


def on_peek(url: str, key: str) -> dict:
    """Every lead and task id on Peek (archived ones too, page by page), and the lengths of the rate and package lists."""
    out: dict = {}
    for board in ("leads", "tasks"):
        ids: set[str] = set()
        since = 0
        for _ in range(200):
            body = _get(f"{url}/v1/boards/{board}/rows?since={since}&limit=500&archived=true", key)
            ids.update(str(x.get("id")) for x in body.get(board, []) if x.get("id"))
            if not body.get("more"):
                break
            since = int(body.get("next") or since)
        out[board] = ids
    for name in ("rates", "packages"):
        out[name] = len(_get(f"{url}/v1/assets/{name}", key).get(name, []))
    return out


def compare(want: dict, got: dict) -> tuple[list[str], bool]:
    """Lines "leads   moved 12   on Peek 12" and whether everything moved is there."""
    rows, ok = [], True
    for board in ("leads", "tasks"):
        missing = want[board] - got[board]
        ok = ok and not missing
        rows.append(f"{board:<9} moved {len(want[board]):>5}   on Peek {len(want[board]) - len(missing):>5}" + (f"   MISSING {len(missing)}" if missing else ""))
    for name in ("rates", "packages"):
        same = got[name] == want[name]
        ok = ok and same
        rows.append(f"{name:<9} moved {want[name]:>5}   on Peek {got[name]:>5}" + ("" if same else "   DIFFERENT"))
    return rows, ok


def set_url(text: str, url: str | None) -> str:
    """local.toml's text with [leads] portal_url set to `url`, or taken out when `url` is None; everything else as it was."""
    lines = text.splitlines()
    start = next((i for i, l in enumerate(lines) if l.strip() == "[leads]"), None)
    if start is None:
        if url is None:
            return text
        sep = "" if not text or text.endswith("\n\n") else ("\n" if text.endswith("\n") else "\n\n")
        return f"{text}{sep}[leads]\nportal_url = \"{url}\"\n"
    end = next((i for i in range(start + 1, len(lines)) if re.match(r"^\s*\[", lines[i])), len(lines))
    at = next((i for i in range(start + 1, end) if re.match(r"^\s*portal_url\s*=", lines[i])), None)
    if url is None:
        if at is not None:
            del lines[at]
    elif at is not None:
        lines[at] = f'portal_url = "{url}"'
    else:
        lines.insert(start + 1, f'portal_url = "{url}"')
    return "\n".join(lines) + "\n"


def news(portal: Path, old: str) -> list[str]:
    """Peek's docs/updates.json entries that its version `old` did not have, newest first (none when it keeps no such file)."""
    import subprocess

    def entries(text: str) -> list[dict]:
        try:
            return list(json.loads(text).get("entries") or [])
        except (ValueError, AttributeError):
            return []
    now = entries((portal / "docs" / "updates.json").read_text(encoding="utf-8")) if (portal / "docs" / "updates.json").exists() else []
    before = subprocess.run(["git", "-C", str(portal), "show", f"{old}:docs/updates.json"], capture_output=True, text=True)
    seen = {json.dumps(e, sort_keys=True) for e in entries(before.stdout if before.returncode == 0 else "")}
    return [f"{e.get('date', '')} {e.get('line', '')}".strip() + (f" ({e['step']})" if e.get("step") else "") for e in now if json.dumps(e, sort_keys=True) not in seen]


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("local-rows")
    s.add_argument("--board", type=Path, default=BOARD)
    for name in ("expected", "readback", "check-export"):
        s = sub.add_parser(name)
        s.add_argument("--dir", type=Path, required=True)
        s.add_argument("--stamp", required=True)
        if name == "readback":
            s.add_argument("--url", default=PEEK)
            s.add_argument("--key", type=Path, default=KEY)
    s = sub.add_parser("news")
    s.add_argument("--portal", type=Path, required=True)
    s.add_argument("--old", required=True)
    s = sub.add_parser("set-url")
    s.add_argument("url")
    sub.add_parser("unset-url")
    a = ap.parse_args(argv)
    if a.cmd == "local-rows":
        print(local_rows(a.board))
        return 0
    if a.cmd == "news":
        for line in news(a.portal, a.old):
            print(f"  new      {line}")
        return 0
    if a.cmd == "check-export":
        line, ok = check_export(a.dir, a.stamp)
        print(f"  {'ok' if ok else 'STOP':<8} {line}")
        return 0 if ok else 1
    if a.cmd == "expected":
        w = expected(a.dir, a.stamp)
        print(f"  to move  {len(w['leads'])} leads, {len(w['tasks'])} tasks, {w['rates']} rates, {w['packages']} packages")
        return 0
    if a.cmd == "readback":
        key = a.key.read_text(encoding="utf-8").strip() if a.key.exists() else ""
        if not key:
            print(f"  STOP     no read key at {a.key}")
            return 1
        try:
            got = on_peek(a.url.rstrip("/"), key)
        except Exception as e:  # noqa: BLE001 -- said in one line, never with the key
            print(f"  STOP     Peek did not answer the read-back: {type(e).__name__}")
            return 1
        rows, ok = compare(expected(a.dir, a.stamp), got)
        for r in rows:
            print(f"  {r}")
        return 0 if ok else 1
    text = LOCAL_TOML.read_text(encoding="utf-8") if LOCAL_TOML.exists() else ""
    LOCAL_TOML.parent.mkdir(parents=True, exist_ok=True)
    LOCAL_TOML.write_text(set_url(text, a.url if a.cmd == "set-url" else None), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
