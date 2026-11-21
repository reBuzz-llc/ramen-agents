#!/usr/bin/env python3
"""Lift a user's own values out of the tracked files, once, so `git pull` meets no edit (update.sh runs it).

    python3 scripts/migrate_local.py [--dry-run]      # in ~/bots, before the pull

For every tracked file you changed -- against the starter's version you last took (RAMEN_BASE, which update.sh sets to
the merge base with the starter; the checked-out commit without it), so edits you committed count as well as edits you
did not:
  - a TOML config (common.toml, web-bots.toml, <member>/config.toml, validator/config.toml): each value you set that
    differs goes to its git-ignored overlay -- common-data/configs/local.toml for the shared files,
    <member>/config.local.toml for a member's own -- where it still wins; the old Notion settings are moved to their new
    homes ([tasks], [packages]) or dropped, and each one is named;
  - target.toml and team.json: your market and your team go to common-data/local/family.toml ([target], [[team]]);
  - any other tracked file you edited (a card, a knowledge page): your version is kept in
    common-data/local/before-update/<path>;
then the tracked file is put back as the starter has it (with commits of your own, that is one more commit, "your values
moved to the git-ignored files", so the pull meets no edit). An overlay that already exists keeps its values (yours
win over what is lifted). Nothing is deleted: keys stay in common-data/keys. Standard library only (Python 3.11+).
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tomllib
from pathlib import Path
from typing import Any

ROOT = Path(os.environ.get("RAMEN_ROOT") or Path(__file__).resolve().parent.parent)  # RAMEN_ROOT: run from a copy (update.sh on an old checkout)
BASE = os.environ.get("RAMEN_BASE") or "HEAD"  # the starter's commit to compare with
SHARED = {"common-data/configs/common.toml", "common-data/configs/web-bots.toml"}
# The [notion] keys that moved, and where
MOVED = {
    "max_tasks_per_episode": ("tasks", "max_per_episode"),
    "max_tasks_per_day": ("tasks", "max_per_day"),
    "min_details_chars": ("tasks", "min_details_chars"),
    "nudge_after_episodes": ("tasks", "nudge_after_episodes"),
    "team_file": ("tasks", "team_file"),
    "default_project_id": ("tasks", "default_project"),
    "package_signoff": ("packages", "signoff"),
    "package_format_version": ("packages", "format_version"),
    "package_republish_own": ("packages", "republish_own"),
    "republish_days": ("packages", "republish_days"),
    "package_email_allowed_figures": ("packages", "email_allowed_figures"),
    "package_email_price_rule": ("packages", "email_price_rule"),
    "package_email_required_phrases": ("packages", "email_required_phrases"),
    "package_email_format_note": ("packages", "email_format_note"),
}
VALIDATOR_DROPPED = {"task_data_source_id", "package_page_id", "leads_data_source_id", "notion_api_version"}


def git(*args: str, check: bool = True) -> str:
    return subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True, check=check).stdout


def changed_files() -> list[str]:
    """Files the starter has at BASE that differ from it here: committed since, staged or not. A file the starter does
    not have (one you added) is yours alone and merges as it is."""
    out = []
    for path in git("diff", "--name-only", "--no-renames", BASE).splitlines():
        if path and subprocess.run(["git", "cat-file", "-e", f"{BASE}:{path}"], cwd=ROOT, capture_output=True).returncode == 0:
            out.append(path)
    return out


def base_text(path: str) -> str:
    return git("show", f"{BASE}:{path}", check=False)


def put_back(path: str) -> None:
    """The tracked file as the starter has it at BASE."""
    git("checkout", BASE, "--", path)


def commit_put_back(paths: list[str], notes: list[str]) -> None:
    """With commits of your own on these files, the put-back is a commit too, or the pull would meet it."""
    if BASE == "HEAD" or not paths:
        return
    if subprocess.run(["git", "diff", "--cached", "--quiet", "HEAD", "--", *paths], cwd=ROOT).returncode == 0:
        return
    msg = "update.sh: your values moved to the git-ignored files (common-data/local/, config.local.toml)"
    if subprocess.run(["git", "commit", "-q", "-m", msg, "--", *paths], cwd=ROOT, capture_output=True).returncode != 0:
        git("-c", "user.name=ramen-agents update", "-c", "user.email=update@ramen-agents.invalid", "commit", "-q", "-m", msg, "--", *paths)
    notes.append(f"committed: {msg}")


def diff(user: Any, base: Any) -> Any:
    """What the user set that the base does not have the same: tables key by key, anything else whole. None: nothing."""
    if isinstance(user, dict) and isinstance(base, dict):
        out = {}
        for k, v in user.items():
            if k not in base:
                out[k] = v
            else:
                d = diff(v, base[k])
                if d is not None:
                    out[k] = d
        return out or None
    return None if user == base else user


def is_notion_id(v: Any) -> bool:
    h = str(v).replace("-", "").lower()
    return len(h) == 32 and all(c in "0123456789abcdef" for c in h)


def notion_out(over: dict, notes: list[str], where: str, validator: bool) -> dict:
    """The old Notion settings moved to their new homes, or dropped with a note."""
    n = over.pop("notion", None)
    if isinstance(n, dict):
        for k, v in n.items():
            if k in MOVED:
                table, key = MOVED[k]
                if key == "default_project" and is_notion_id(v):
                    notes.append(f"{where}: [notion] {k} was a Notion id: dropped (set [tasks] default_project to a project name)")
                    continue
                over.setdefault(table, {})[key] = v
                notes.append(f"{where}: [notion] {k} moved to [{table}] {key}")
            elif k == "enabled":
                if v is True:
                    over.setdefault("tasks", {})["enabled"] = True
                    notes.append(f"{where}: [notion] enabled moved to [tasks] enabled")
            elif k == "package_page_id":
                over.setdefault("packages", {})["enabled"] = True
                notes.append(f"{where}: [notion] package_page_id dropped; [packages] enabled = true hands packages to the board")
            else:
                notes.append(f"{where}: [notion] {k} dropped (Notion is gone)")
    leads = over.get("leads")
    if isinstance(leads, dict) and "database_id" in leads:
        leads.pop("database_id")
        notes.append(f"{where}: [leads] database_id dropped (the leads live on the board now)")
        if not leads:
            over.pop("leads")
    if validator:
        v = over.get("validator") if isinstance(over.get("validator"), dict) else over
        for k in sorted(VALIDATOR_DROPPED & set(v)):
            v.pop(k)
            notes.append(f"{where}: {k} dropped (Notion is gone)")
        if "validator" in over and not over["validator"]:
            over.pop("validator")
    return over


# ---- a small TOML writer: tables, arrays of tables, strings, numbers, booleans, arrays --------------------------------
def _val(v: Any) -> str:
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return repr(v)
    if isinstance(v, str):
        return json.dumps(v, ensure_ascii=False)
    if isinstance(v, list):
        return "[" + ", ".join(_val(x) for x in v) + "]"
    if isinstance(v, dict):
        return "{ " + ", ".join(f"{_key(k)} = {_val(x)}" for k, x in v.items()) + " }"
    return json.dumps(str(v))


def _key(k: str) -> str:
    return k if k.replace("_", "").replace("-", "").isalnum() else json.dumps(k)


def dumps(d: dict, prefix: str = "") -> str:
    lines: list[str] = []
    plain = {k: v for k, v in d.items() if not isinstance(v, dict) and not (isinstance(v, list) and v and all(isinstance(x, dict) for x in v))}
    tables = {k: v for k, v in d.items() if isinstance(v, dict)}
    arrays = {k: v for k, v in d.items() if isinstance(v, list) and v and all(isinstance(x, dict) for x in v)}
    if prefix and plain:
        lines.append(f"[{prefix}]")
    lines += [f"{_key(k)} = {_val(v)}" for k, v in plain.items()]
    for k, v in tables.items():
        sub = dumps(v, f"{prefix}.{_key(k)}" if prefix else _key(k))
        if sub:
            lines += ["", sub]
    for k, items in arrays.items():
        name = f"{prefix}.{_key(k)}" if prefix else _key(k)
        for it in items:
            lines += ["", f"[[{name}]]"] + [f"{_key(a)} = {_val(b)}" for a, b in it.items()]
    return "\n".join(lines).strip()


def merge_into(path: Path, add: dict, note: str) -> None:
    """Write `add` into the overlay at `path`; a value already in the overlay wins."""
    cur = tomllib.loads(path.read_text(encoding="utf-8")) if path.exists() else {}

    def keep(a: dict, b: dict) -> dict:  # b (the overlay) wins
        out = dict(a)
        for k, v in b.items():
            out[k] = keep(out[k], v) if isinstance(out.get(k), dict) and isinstance(v, dict) else v
        return out

    merged = keep(add, cur)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(f"# {note}\n" + dumps(merged) + "\n", encoding="utf-8")


def overlay_for(path: str) -> Path:
    return ROOT / "common-data" / "configs" / "local.toml" if path in SHARED else ROOT / Path(path).parent / "config.local.toml"


def family_lift(path: str, user_text: str, family: dict, notes: list[str]) -> None:
    """target.toml and team.json: the user's market and team into family.toml."""
    if path.endswith("target.toml"):
        t = tomllib.loads(user_text)
        got = {k: v for k, v in t.items() if isinstance(v, str) and v.strip() and "FILL-ME" not in v}
        if got:
            family.setdefault("target", {}).update({k: v for k, v in got.items() if k not in family.get("target", {})})
            notes.append(f"{path}: your market went to common-data/local/family.toml [target]")
    elif path.endswith("team.json"):
        try:
            members = json.loads(user_text).get("members") or []
        except ValueError:
            members = []
        team = [{k: str(m[k]) for k in ("name", "role", "details", "email") if m.get(k) and "FILL-ME" not in str(m[k])} for m in members if isinstance(m, dict)]
        team = [m for m in team if m.get("name")]
        if team and not family.get("team"):
            family["team"] = team
            notes.append(f"{path}: your team went to common-data/local/family.toml [[team]]")


def migrate(dry: bool = False) -> list[str]:
    notes: list[str] = []
    files = changed_files()
    fam_path = ROOT / "common-data" / "local" / "family.toml"
    family = tomllib.loads(fam_path.read_text(encoding="utf-8")) if fam_path.exists() else {}
    fam_before = json.dumps(family, sort_keys=True)
    restored: list[str] = []
    for path in files:
        full = ROOT / path
        if not full.exists():
            continue
        user_text = full.read_text(encoding="utf-8", errors="replace")
        if path.endswith("config.toml") or path in SHARED:
            try:
                over = diff(tomllib.loads(user_text), tomllib.loads(base_text(path) or "")) or {}
            except tomllib.TOMLDecodeError as e:
                notes.append(f"{path}: not valid TOML ({e}); kept in common-data/local/before-update/{path}")
                over = None
            if over is not None:
                over.pop("extends", None)
                over = notion_out(over, notes, path, validator=path.startswith("validator/"))
                if over:
                    ov = overlay_for(path)
                    if not dry:
                        merge_into(ov, over, "Your own values, lifted from the tracked config by sh scripts/update.sh. Not in git; yours win here.")
                    notes.append(f"{path}: your values went to {ov.relative_to(ROOT)}")
                if not dry:
                    put_back(path)
                    restored.append(path)
                continue
        if path.endswith(("target.toml", "team.json")):
            family_lift(path, user_text, family, notes)
        backup = ROOT / "common-data" / "local" / "before-update" / path
        if not dry:
            backup.parent.mkdir(parents=True, exist_ok=True)
            backup.write_text(user_text, encoding="utf-8")
            put_back(path)
            restored.append(path)
        notes.append(f"{path}: your version is kept in common-data/local/before-update/{path}")
    if json.dumps(family, sort_keys=True) != fam_before and not dry:
        fam_path.parent.mkdir(parents=True, exist_ok=True)
        fam_path.write_text("# Your family's answers (sh scripts/setup.sh). Not in git.\n" + dumps(family) + "\n", encoding="utf-8")
        os.chmod(fam_path, 0o600)
    if not dry:
        commit_put_back(restored, notes)
    return notes


def main(argv: list[str]) -> int:
    dry = "--dry-run" in argv
    notes = migrate(dry)
    for n in notes:
        print(f"  {n}")
    if not notes:
        print("  nothing to lift: no tracked file was edited")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
