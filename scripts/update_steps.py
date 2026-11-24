#!/usr/bin/env python3
"""The parts of sh scripts/update.sh that are easier in Python. Standard library only. Never prints a key.

    python3 scripts/update_steps.py changes <fleet-before> <fleet-after> [<engine-dir> <engine-before> <engine-after>]
    python3 scripts/update_steps.py reapply <manifest.json>        # after the pull: put your set-aside edits back
    python3 scripts/update_steps.py missing                        # setup-check.py's missing lines, one per line
    python3 scripts/update_steps.py new-missing <before.txt> <after.txt>
    python3 scripts/update_steps.py record <result> <fleet-before> <fleet-after> <engine-before> <engine-after> <reapplied.txt> <set-aside.txt> <new-missing.txt>
    python3 scripts/update_steps.py heads                          # the before heads of the last update, for --rollback

What changed is the docs/updates.json entries added between the two fleet heads (an entry reaches you when it is pushed,
whatever day it carries), and with no such file, the commit subjects.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(os.environ.get("RAMEN_ROOT") or Path(__file__).resolve().parent.parent)
LOCAL = ROOT / "common-data" / "local"
LAST = LOCAL / "last-update.json"
UPDATES = "docs/updates.json"


def git(*args: str, cwd: Path = ROOT) -> subprocess.CompletedProcess:
    return subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True)


def entries_at(rev: str) -> list[dict] | None:
    """docs/updates.json's entries at a commit; None when the file is not there."""
    got = git("show", f"{rev}:{UPDATES}")
    if got.returncode != 0:
        return None
    try:
        data = json.loads(got.stdout)
    except ValueError:
        return None
    return [e for e in (data.get("entries") or []) if isinstance(e, dict)]


def _key(e: dict) -> tuple:
    return (str(e.get("date") or ""), str(e.get("kind") or ""), str(e.get("line") or ""))


def changes(before: str, after: str, engine: str = "", ebefore: str = "", eafter: str = "") -> list[str]:
    out: list[str] = []
    new, old = entries_at(after), entries_at(before)
    if new is not None:
        seen = {_key(e) for e in (old or [])}
        for e in new:
            if _key(e) not in seen:
                step = str(e.get("step") or "").strip()
                out.append(f"  new      {e.get('date', '')} {e.get('kind', '')}: {e.get('line', '')}" + (f" (run: {step})" if step else ""))
    if not out:
        log = git("log", "--no-merges", "--format=%h %s", f"{before}..{after}").stdout.splitlines()
        out += [f"  commit   {line[:130]}" for line in log[:20]]
    if engine and ebefore and eafter and ebefore != eafter:
        log = git("log", "--no-merges", "--format=%h %s", f"{ebefore}..{eafter}", cwd=Path(engine)).stdout.splitlines()
        out += [f"  engine   {line[:130]}" for line in log[:10]]
    return out or ["  nothing new"]


def reapply(manifest: Path) -> tuple[list[str], list[str]]:
    """Each set-aside edit is applied again on the new version of its file (git apply); one that does not apply stays in
    common-data/local/before-update/ and is named. Returns (re-applied, set aside)."""
    try:
        items = json.loads(manifest.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return [], []
    done, kept = [], []
    for it in items if isinstance(items, list) else []:
        path, patch = str(it.get("path") or ""), str(it.get("patch") or "")
        if not path:
            continue
        p = ROOT / patch
        if patch and p.is_file() and git("apply", "--check", str(p)).returncode == 0 and git("apply", str(p)).returncode == 0:
            done.append(path)
            print(f"  ok       re-applied your edit to {path}")
        else:
            kept.append(path)
            print(f"  note     could not re-apply your edit to {path}: kept in common-data/local/before-update/{path}")
    return done, kept


def missing(script: str = "") -> list[str]:
    """The setup check's missing lines (python3 scripts/setup-check.py, or `script`: the new version's copy, run against this
    folder, so the check before an update words its lines as the one after it), or RAMEN_UPDATE_CHECK's for tests."""
    cmd = os.environ.get("RAMEN_UPDATE_CHECK") or f'"{sys.executable}" "{script or ROOT / "scripts" / "setup-check.py"}"'
    got = subprocess.run(cmd, shell=True, cwd=ROOT, capture_output=True, text=True, env={**os.environ, "RAMEN_ROOT": str(ROOT)})
    lines, inside = [], False
    for line in got.stdout.splitlines():
        if line.startswith("Still missing"):
            inside = True
        elif inside and line.startswith("  - "):
            lines.append(line[4:].strip())
        elif inside:
            break                      # the block ends at its first other line
    return lines


def _lines(path: str) -> list[str]:
    try:
        return [x for x in Path(path).read_text(encoding="utf-8").splitlines() if x.strip()]
    except OSError:
        return []


def record(result: str, fb: str, fa: str, eb: str, ea: str, reapplied: str, kept: str, new: str) -> None:
    LOCAL.mkdir(parents=True, exist_ok=True)
    data = {"at": dt.datetime.now().astimezone().isoformat(timespec="seconds"), "fleet": {"before": fb, "after": fa},
            "engine": {"before": eb, "after": ea}, "result": result, "reapplied": _lines(reapplied), "set_aside": _lines(kept),
            "new_missing": _lines(new)}
    tmp = LAST.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, indent=1) + "\n", encoding="utf-8")
    tmp.replace(LAST)


def main(argv: list[str]) -> int:
    cmd, args = (argv[0] if argv else ""), argv[1:]
    if cmd == "changes":
        print("\n".join(changes(*args)))
    elif cmd == "reapply":
        done, kept = reapply(Path(args[0]))
        for name, rows in (("reapplied", done), ("set_aside", kept)):
            Path(os.environ.get("RAMEN_UPDATE_TMP", "."), f"{name}.txt").write_text("".join(f"{r}\n" for r in rows), encoding="utf-8")
    elif cmd == "missing":
        sys.stdout.write("".join(f"{x}\n" for x in missing(*args[:1])))           # nothing missing: an empty output, not a blank line
    elif cmd == "new-missing":
        old = set(_lines(args[0]))
        sys.stdout.write("".join(f"{x}\n" for x in _lines(args[1]) if x not in old))
    elif cmd == "record":
        record(*args)
    elif cmd == "heads":
        try:
            d = json.loads(LAST.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return 1
        print(str((d.get("fleet") or {}).get("before") or ""), str((d.get("engine") or {}).get("before") or ""))
    else:
        print(__doc__)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
