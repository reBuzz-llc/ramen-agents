#!/usr/bin/env python3
"""Write the "Every provider we know" tables in docs/free-tiers.md from common-data/providers.json, the one list.

    python3 scripts/providers_table.py           # rewrite the part between the two markers
    python3 scripts/providers_table.py --check   # exit 1 when the doc is not what the list says

Standard library only. The rest of docs/free-tiers.md is written by hand.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LIST = ROOT / "common-data" / "providers.json"
DOC = ROOT / "docs" / "free-tiers.md"
START = "<!-- providers table: written by scripts/providers_table.py from common-data/providers.json; do not edit by hand -->"
END = "<!-- end of the providers table -->"
USE = {"model": "AI model", "email-check": "Email check", "search": "Search", "tool": "Tool", "board": "Board"}
GROUPS = [
    ("chain", "In the default chain", "Free model tiers the members use, in this order."),
    ("free", "Other free keys", "Optional; none is needed."),
    ("paid", "Only if you pay", "Not free; setup never asks for one."),
    ("listed", "Listed, not judged yet", "What each provider's own page says, and the day we read it. Nobody has tested these."),
    ("unusable", "Unusable", "Tested by the owner and found wanting, with the date of that test."),
    ("set-aside", "Set aside by the maintainers", "Judged on paper, not tested, with the date of that judgement."),
    ("removed", "No longer used", ""),
]


def group(p: dict) -> str:  # the same rule as webapp/lib/providers-list.ts groupOf
    if p["status"] == "removed":
        return "removed"
    if p["mark"] == "unusable":
        return "unusable"
    if p["mark"] == "rejected":
        return "set-aside"
    if p["status"] == "chain":
        return "chain"
    if p["mark"] is None:
        return "listed"
    return "free" if p["free"] else "paid"


def cell(text: str) -> str:
    return " ".join(text.split()).replace("|", "\\|")


def table() -> str:
    providers = json.loads(LIST.read_text(encoding="utf-8"))["providers"]
    out = [START, ""]
    for key, title, line in GROUPS:
        rows = [p for p in providers if group(p) == key]
        if not rows:
            continue
        out += [f"### {title}", ""]
        if line:
            out += [line, ""]
        out += ["| Provider | Use | Free tier and card | Mark |", "|---|---|---|---|"]
        for p in rows:
            who = f"[{cell(p['who'])}]({p['where']})" if p["where"] else cell(p["who"])
            free = cell(p["card"]) or ("Free." if p["free"] else "Not free.")
            if p["mark"] is None:
                mark = "not judged yet"
            else:
                by = "" if p["mark"] == "rejected" else f"{p['mark_by']}, "
                mark = f"{p['mark']} ({by}{p['mark_date']})" + (f": {cell(p['mark_note'])}" if p["mark_note"] else "")
            out.append(f"| {who} | {USE.get(p['use'], p['use'])} | {free} | {mark} |")
        out.append("")
    out.append(END)
    return "\n".join(out)


def written(doc: str) -> str:
    if START in doc and END in doc:
        head, rest = doc.split(START, 1)
        return head + table() + rest.split(END, 1)[1]
    anchor = "## Adding a provider"
    section = "## Every provider we know\n\nEvery provider in `common-data/providers.json`, the list the Providers page, `add-key.sh` and\n`setup-check.py` read. Each has an Add key on the dashboard's Settings → Providers → All providers; one marked unusable or\nset aside shows its reason before the key field, and none of them is ever suggested.\n\n"
    return doc.replace(anchor, section + table() + "\n\n" + anchor, 1)


def main(argv: list[str]) -> int:
    doc = DOC.read_text(encoding="utf-8")
    new = written(doc)
    if "--check" in argv:
        if new != doc:
            print("docs/free-tiers.md: the providers table is not what common-data/providers.json says; run python3 scripts/providers_table.py")
            return 1
        return 0
    DOC.write_text(new, encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
