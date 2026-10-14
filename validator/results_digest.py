"""The weekly results digest for The CEO's steering (owner, 2026-10-10: The CEO steers weekly from the Leads board's Result
column; the engine wires the file into its prompt). Written with Monday's first full sweep to
common-data/botBox/routed/the-ceo/results-digest.md. Facts only, counted from the board; while no Result is set it says
so in one line, so no steer is invented from nothing.

Line shape, one fact per line:  - <section> | <key> | <value>
"""
from __future__ import annotations

import datetime as dt
import json
import re
from collections import Counter, defaultdict
from pathlib import Path

from sources import LeadRow

BOTS = Path.home() / "bots"
DIGEST = BOTS / "common-data" / "botBox" / "routed" / "the-ceo" / "results-digest.md"
SENT_LOG = BOTS / "common-data" / "shared-state" / "emails-sent.jsonl"
REPLIED = {"replied", "meeting", "client", "not interested"}       # any answer from the business
GOOD = {"replied", "meeting", "client"}


def _date(s: str) -> dt.date | None:
    try:
        return dt.date.fromisoformat((s or "")[:10])
    except ValueError:
        return None


def _sent(ld: LeadRow) -> bool:
    r = ld.result.strip().lower()
    return ld.status.strip().lower() == "email sent" or (bool(r) and r != "not contacted")


def _area(location: str) -> str:
    return (location or "").split(",")[0].strip() or "(no location)"


def _industry(industry: str) -> str:
    first = re.split(r"[·,;/(]| - | — ", industry or "")[0].strip()
    return first[:40] or "(no industry)"


def _opening(draft: str) -> str:
    """The first sentence after the greeting line."""
    lines = [ln.strip() for ln in (draft or "").splitlines() if ln.strip()]
    body = " ".join(lines[1:] if lines and re.match(r"^(hi|hello|dear|hey)\b", lines[0], re.I) else lines)
    return re.split(r"(?<=[.!?])\s", body, maxsplit=1)[0][:200]


def _rates(leads: list[LeadRow], key) -> list[str]:
    sent, replied = Counter(), Counter()
    for ld in leads:
        if _sent(ld):
            sent[key(ld)] += 1
            replied[key(ld)] += ld.result.strip().lower() in REPLIED
    return [f"{k} | {replied[k]} of {n} replied ({100 * replied[k] // n}%)" for k, n in sent.most_common(12)]


def build(leads: list[LeadRow], today: dt.date) -> str:
    week_ago = today - dt.timedelta(days=7)
    sent = [ld for ld in leads if _sent(ld)]
    this_week = [ld for ld in sent if (d := _date(ld.result_date)) and d > week_ago]
    try:
        log = [json.loads(ln) for ln in SENT_LOG.read_text(encoding="utf-8").splitlines() if ln.strip()]
    except (OSError, ValueError):
        log = []
    log_week = sum(1 for e in log if (d := _date(str(e.get("at", "")))) and d > week_ago)
    results = Counter(ld.result.strip() for ld in leads if ld.result.strip())
    out = [f"# Results digest, week to {today.isoformat()} (Validator, counted from the Leads board)", "",
           "Facts for The CEO's weekly steer. Steer only from what is here; a section with no lines has no data yet.", "",
           f"- sent | this week | {max(len(this_week), log_week)}",
           f"- sent | in total | {len(sent)} of {len(leads)} rows"]
    if not results or set(results) <= {"Not contacted"}:
        out.append(f"- results | none yet | no Result is set on any row; {len(sent)} emails sent so far. Do not change "
                   "direction on results this week.")
        return "\n".join(out) + "\n"
    out += [f"- results | {k} | {n}" for k, n in results.most_common()]
    out += [f"- reply rate by package | {ln}" for ln in _rates(leads, lambda ld: ld.how_we_help.strip() or "(no package)")]
    out += [f"- reply rate by industry | {ln}" for ln in _rates(leads, lambda ld: _industry(ld.industry))]
    out += [f"- reply rate by area | {ln}" for ln in _rates(leads, lambda ld: _area(ld.location))]
    won = [ld for ld in leads if ld.result.strip().lower() in GOOD and ld.draft_email.strip()
           and not ld.draft_email.strip().lower().startswith("skip:")]
    out += [f"- opening that got an answer | {ld.result.strip()} | {ld.how_we_help.strip() or '-'} | {_opening(ld.draft_email)}"
            for ld in won[:10]]
    bounced = [ld for ld in leads if ld.result.strip().lower() == "bounced"]
    undeliverable = sum(1 for ld in leads if ld.email_check.strip().lower().startswith("not deliverable"))
    out.append(f"- bounces | bounced | {len(bounced)}" + (f" ({', '.join(ld.business for ld in bounced[:8])})" if bounced else ""))
    out.append(f"- bounces | Email check says not deliverable | {undeliverable}")
    by_pkg = defaultdict(int)
    for ld in leads:
        if not _sent(ld) and ld.draft_email.strip() and not ld.draft_email.strip().lower().startswith("skip:"):
            by_pkg[ld.how_we_help.strip() or "(no package)"] += 1
    out += [f"- drafted, not sent yet | {k} | {n}" for k, n in sorted(by_pkg.items(), key=lambda x: -x[1])[:8]]
    return "\n".join(out) + "\n"


def due(state: dict, now: dt.datetime) -> bool:
    """Monday's first full sweep, or any full sweep when the last digest is a week old or missing."""
    last = _date(str(state.get("results_digest_at", "")))
    return not DIGEST.exists() or last is None or (now.weekday() == 0 and last < now.date()) or (now.date() - last).days >= 7


def write(leads: list[LeadRow], state: dict, now: dt.datetime) -> Path:
    DIGEST.parent.mkdir(parents=True, exist_ok=True)
    DIGEST.write_text(build(leads, now.date()), encoding="utf-8")
    state["results_digest_at"] = now.date().isoformat()
    return DIGEST
