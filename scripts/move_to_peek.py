#!/usr/bin/env python3
"""Move the local board into Peek, step one: write its rows as Peek's rebuild files (update.sh runs it once, when the
team's board moves from the dashboard's local board to Peek running on this Mac).

    python3 scripts/move_to_peek.py [--board FILE] [--out DIR] [--stamp STAMP]

Reads common-data/local-board.sqlite3 read-only and writes, in --out (default common-data/local/move-<stamp>/):
  leads-rebuild-<stamp>.jsonl   {id, created_at, archived, fields: {<key>: {value, source, at, by}}}
  tasks-rebuild-<stamp>.jsonl   the same for the task board
  assets-rebuild-<stamp>.jsonl  {kind: rate | package, position, ...}
Each cell says who wrote it last (`by`: "person" or "bot"), so that on Peek a cell a person set stays a person's and the
agents still leave it alone. The derived cells (domain, city, state) are left out: Peek works them out again. Then Peek's
own loader takes the folder, first with --dry-run (the command is printed at the end). Nothing on the local board is
changed or deleted. Standard library only (Python 3.11+).
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DERIVED = {"domain", "city", "state"}
SOURCE = "the local board"


def cell(value: object, at: str, by: str) -> dict:
    return {"value": value, "source": SOURCE, "at": at, "by": "person" if by == "person" else "bot"}


def row_line(r: sqlite3.Row) -> dict:
    cells = json.loads(r["cells"] or "{}")
    last_by = json.loads(r["last_by"] or "{}")
    fields = {k: cell(v, r["updated_at"], last_by.get(k, "bot")) for k, v in cells.items() if k not in DERIVED}
    return {"id": r["id"], "created_at": r["created_at"], "archived": bool(r["archived"]), "fields": fields}


def rate_line(cells: dict) -> str:
    """Peek keeps a rate as one line: "Starter Website: $500 one-time" from the local board's line and price."""
    line, price = str(cells.get("line") or "").strip(), str(cells.get("price") or "").strip()
    return f"{line}: {price}" if line and price and price not in line else line or price


def asset_lines(rates: list[sqlite3.Row], packages: list[sqlite3.Row]) -> list[dict]:
    out: list[dict] = []
    for i, r in enumerate(rates):
        line = rate_line(json.loads(r["cells"] or "{}"))
        if line:
            out.append({"kind": "rate", "position": i, "line": line, "source": SOURCE})
    for i, r in enumerate(packages):
        c = json.loads(r["cells"] or "{}")
        if not c.get("name"):
            continue
        out.append({"kind": "package", "position": i, **{k: c.get(k) for k in ("name", "price", "offer", "buyer", "deliverables", "status", "why", "sources") if c.get(k) not in (None, "")}, "source": SOURCE})
    return out


def export(board: Path, out: Path, stamp: str) -> dict[str, int]:
    if not board.exists():
        raise SystemExit(f"no local board at {board}: nothing to move")
    con = sqlite3.connect(f"file:{board}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    rows = {b: con.execute("SELECT * FROM rows WHERE board = ? ORDER BY rev", (b,)).fetchall() for b in ("leads", "tasks", "rates", "packages")}
    con.close()
    out.mkdir(parents=True, exist_ok=True)
    files = {
        f"leads-rebuild-{stamp}.jsonl": [row_line(r) for r in rows["leads"]],
        f"tasks-rebuild-{stamp}.jsonl": [row_line(r) for r in rows["tasks"]],
        f"assets-rebuild-{stamp}.jsonl": asset_lines(rows["rates"], rows["packages"]),
    }
    for name, lines in files.items():
        (out / name).write_text("".join(json.dumps(x, ensure_ascii=False) + "\n" for x in lines), encoding="utf-8")
    return {"leads": len(files[f"leads-rebuild-{stamp}.jsonl"]), "tasks": len(files[f"tasks-rebuild-{stamp}.jsonl"]),
            "assets": len(files[f"assets-rebuild-{stamp}.jsonl"]),
            "person cells": sum(1 for b in ("leads", "tasks") for r in rows[b] for v in json.loads(r["last_by"] or "{}").values() if v == "person")}


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--board", type=Path, default=ROOT / "common-data" / "local-board.sqlite3")
    ap.add_argument("--stamp", default=time.strftime("%Y%m%d-%H%M"))
    ap.add_argument("--out", type=Path)
    a = ap.parse_args(argv)
    out = a.out or ROOT / "common-data" / "local" / f"move-{a.stamp}"
    n = export(a.board, out, a.stamp)
    print(f"Written to {out}: {n['leads']} leads, {n['tasks']} tasks, {n['assets']} rates and packages; {n['person cells']} cells a person set last.")
    print(f"Next, in Peek's folder: node scripts/rebuild-load.mjs --pglite .data/db --dir {out} --stamp {a.stamp} --dry-run")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
