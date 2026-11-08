#!/usr/bin/env python3
"""This week in the family: one short write-up a week, in the first person plural, from the family's own records.
Every Sunday at 21:00 if you install it (sh scripts/install-launchd.sh family-week). Post it on your blog, your team
chat or your portal as it is.

What it reads (read only):
  - each agent's actions table (<agent>/workspace/explorer.sqlite3): leads listed and the share with no website of
    their own (Lead Gen), drafts landed and WhatsApp pitches (an Outreach Writer, if you run one), contact roles (a Lead
    Enricher, if you run one), and each agent's refused share this week against last week;
  - common-data/shared-state/usage-history.json (the dashboard keeps it): model calls and tokens on the days measured;
  - common-data/configs/web-bots.toml at the week's start and now (git): the providers that joined or left the chain;
  - this repository's commit subjects of the week (git log): what broke and what was fixed, in plain words.
A section whose source is missing is left out, never shown as zero.

Masking: nothing in it may name a business, a person or a place. It masks every business name and website on the
portal's lead cache (common-data/shared-state/portal-leads-cache.json, when the portal is in use), the names in
common-data/team.json, everything in common-data/configs/family-week.toml (copy family-week.example.toml: your places,
your people, any other words), and every email address, phone number and web address.

What it writes: common-data/family-weeks.json (newest first, one entry per week; a week already there is replaced) and
common-data/family-weeks/<Sunday>.md, the same post in Markdown.

    ~/Projects/bot/.venv/bin/python scripts/family_week.py                  # the week ending today (Sunday)
    ~/Projects/bot/.venv/bin/python scripts/family_week.py --end 2026-11-08 # a given week (Monday to that Sunday)
    ~/Projects/bot/.venv/bin/python scripts/family_week.py --print          # print it, write nothing
"""
from __future__ import annotations

import datetime as dt
import json
import re
import sqlite3
import subprocess
import sys
import tomllib
from collections import Counter
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent.parent  # this repository (the fleet branch, normally ~/bots)
WEB_BOTS = "common-data/configs/web-bots.toml"


# ---- masking ------------------------------------------------------------------------------------------------------------
def _json(path: Path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default


def mask_terms(root: Path = ROOT) -> dict[str, str]:
    """Term -> what it becomes: the portal's businesses and their websites, the team's names, and family-week.toml."""
    terms: dict[str, str] = {}
    cache = _json(root / "common-data/shared-state/portal-leads-cache.json", {})
    for lead in (cache.get("leads") or {}).values() if isinstance(cache, dict) else []:
        name = str(lead.get("business") or "").strip()
        if len(name) >= 4:
            terms.setdefault(name, "a business")
        host = urlparse(str(lead.get("website") or "")).netloc.removeprefix("www.")
        if len(host) >= 4:
            terms.setdefault(host, "a website")
    for m in (_json(root / "common-data/team.json", {}).get("members") or []):
        name = str(m.get("name") or "").strip()
        if name.startswith("FILL-ME"):
            continue
        for n in (name, name.split(" ")[0] if name else ""):
            if len(n) >= 3:
                terms[n] = "a teammate"
    try:
        cfg = tomllib.loads((root / "common-data/configs/family-week.toml").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        cfg = {}
    for p in cfg.get("places") or []:
        terms[str(p)] = "a city"
    for p in cfg.get("people") or []:
        terms[str(p)] = "a person"
    for k, v in (cfg.get("mask") or {}).items():
        terms[str(k)] = str(v)
    return {k: v for k, v in terms.items() if k.strip()}


class Masker:
    def __init__(self, terms: dict[str, str]):
        self.lower = {k.lower(): v for k, v in terms.items()}
        groups: dict[str, list[str]] = {}
        for k in sorted(terms, key=len, reverse=True):
            groups.setdefault(k[0].lower(), []).append(re.escape(k))
        self.res = [re.compile(r"(?<![A-Za-z])(" + "|".join(g) + r")(?![A-Za-z])", re.I) for g in groups.values()]

    def __call__(self, s: str) -> str:
        s = re.sub(r"[\w.+-]+@[\w-]+(\.[\w-]+)+", "an email address", s)
        s = re.sub(r"https?://\S+", "a web address", s)
        s = re.sub(r"\+?\d[\d ()-]{7,}\d", "a phone number", s)
        for rx in self.res:
            s = rx.sub(lambda m: self.lower.get(m.group(0).lower(), "a business"), s)
        return re.sub(r"\b[a-z0-9-]+\.(com|net|org|co|us|biz|info|io|shop|store)\b", "a website", s, flags=re.I)


# ---- the numbers ----------------------------------------------------------------------------------------------------------
def week_of(end: dt.date) -> tuple[dt.date, dt.date]:
    """Monday to Sunday: the week `end` falls in."""
    start = end - dt.timedelta(days=end.weekday())
    return start, start + dt.timedelta(days=6)


def _db(root: Path, slug: str) -> Path:
    return root / slug / "workspace" / "explorer.sqlite3"


def _rows(db: Path, sql: str, args: tuple) -> list[tuple] | None:
    """The rows, or None when the agent has no database (not installed): the section is then left out."""
    if not db.is_file():
        return None
    try:
        con = sqlite3.connect(f"file:{db}?mode=ro", uri=True, timeout=5)
        try:
            return con.execute(sql, args).fetchall()
        finally:
            con.close()
    except sqlite3.Error:
        return None


def _span(start: dt.date, end: dt.date) -> tuple[str, str]:
    return start.isoformat(), (end + dt.timedelta(days=1)).isoformat()


def leads(root: Path, start: dt.date, end: dt.date) -> dict | None:
    a, b = _span(start, end)
    rows = _rows(_db(root, "lead-gen"), "SELECT coalesce(json_extract(payload, '$.website'), '') FROM actions WHERE action_type = 'lead' AND verdict = 'allowed' AND ts >= ? AND ts < ?", (a, b))
    if rows is None:
        return None
    return {"listed": len(rows), "no_site": sum(1 for (w,) in rows if str(w).strip().lower() in {"", "none", "null", "-"})}


def drafts(root: Path, start: dt.date, end: dt.date) -> dict | None:
    a, b = _span(start, end)
    q = ("SELECT COUNT(DISTINCT json_extract(payload, '$.name')) FROM actions WHERE action_type = 'update_lead' AND verdict = 'allowed' "
         "AND ts >= ? AND ts < ? AND coalesce(json_extract(payload, '$.{c}'), '') != '' AND lower(json_extract(payload, '$.{c}')) NOT LIKE 'skip:%'")
    db = _db(root, "outreach-writer")
    email, wa = _rows(db, q.format(c="draft_email"), (a, b)), _rows(db, q.format(c="draft_whatsapp"), (a, b))
    if email is None:
        return None
    return {"emails": int(email[0][0] or 0), "whatsapp": int(wa[0][0] or 0) if wa else 0}


def roles(root: Path, start: dt.date, end: dt.date) -> Counter | None:
    a, b = _span(start, end)
    rows = _rows(_db(root, "lead-enricher"), "SELECT json_extract(payload, '$.name'), json_extract(payload, '$.contact_role') FROM actions WHERE action_type = 'update_lead' "
                 "AND verdict = 'allowed' AND ts >= ? AND ts < ? AND coalesce(json_extract(payload, '$.contact_role'), '') != ''", (a, b))
    if rows is None:
        return None
    last: dict[str, str] = {}
    for name, role in rows:
        last[str(name)] = str(role).strip()
    return Counter(last.values())


def members(root: Path = ROOT) -> list[tuple[str, str]]:
    """The agents: every folder with a config.toml naming one (a timer job like the Validator left out)."""
    out = []
    for cfg in sorted(root.glob("*/config.toml")):
        try:
            agent = tomllib.loads(cfg.read_text(encoding="utf-8")).get("agent") or {}
        except (OSError, ValueError):
            continue
        if agent.get("not_a_bot_run_agent"):
            continue
        out.append((cfg.parent.name, str(agent.get("name") or cfg.parent.name)))
    return out


def refused(root: Path, start: dt.date, end: dt.date) -> list[dict]:
    out = []
    for slug, name in members(root):
        weeks = []
        for s, e in ((start, end), (start - dt.timedelta(days=7), end - dt.timedelta(days=7))):
            a, b = _span(s, e)
            r = _rows(_db(root, slug), "SELECT COUNT(*), SUM(verdict LIKE 'rejected%') FROM actions WHERE ts >= ? AND ts < ?", (a, b)) or [(0, 0)]
            n, bad = int(r[0][0] or 0), int(r[0][1] or 0)
            weeks.append((n, round(100 * bad / n) if n else None))
        if weeks[0][0] or weeks[1][0]:
            out.append({"name": name, "actions": weeks[0][0], "share": weeks[0][1], "last": weeks[1][1]})
    return out


def drain(shared: Path, start: dt.date, end: dt.date) -> dict:
    days = _json(shared / "usage-history.json", {}).get("days") or {}
    calls: Counter = Counter()
    tokens: Counter = Counter()
    measured = []
    for day, v in sorted(days.items()):
        if start.isoformat() <= day <= end.isoformat():
            measured.append(day)
            for host, h in (v.get("hosts") or {}).items():
                calls[host] += int(h.get("calls") or 0)
                tokens[host] += int(h.get("tokens") or 0)
    return {"days": measured, "calls": sum(calls.values()), "tokens": sum(tokens.values()), "providers": len([h for h in calls if calls[h]])}


def _git(args: list[str], root: Path) -> str:
    try:
        return subprocess.run(["git", "-C", str(root), *args], capture_output=True, text=True, timeout=30).stdout
    except (OSError, subprocess.SubprocessError):
        return ""


def chain_of(text: str) -> list[str]:
    try:
        return list((tomllib.loads(text).get("model") or {}).get("provider_chain") or [])
    except (ValueError, TypeError):
        return []


def providers(root: Path, start: dt.date) -> dict:
    rev = _git(["log", "-1", f"--before={start.isoformat()}T00:00", "--format=%H", "--", WEB_BOTS], root).strip()
    before = chain_of(_git(["show", f"{rev}:{WEB_BOTS}"], root)) if rev else []
    try:
        now = chain_of((root / WEB_BOTS).read_text(encoding="utf-8"))
    except OSError:
        now = []
    return {"joined": [p for p in now if p not in before] if before else [], "left": [p for p in before if p not in now]}


FIXES = re.compile(r"\b(fix|fixed|no longer|never|crash|broke|broken|stopped|failed|failing|refused|repair|restor|wrong|stuck)\w*", re.I)


def plain(subject: str) -> str:
    """A commit subject in plain words: no hashes, quotes, ticket numbers or file paths."""
    s = re.sub(r"\((?:[^()]*(?:#\d+|upstream|queue \d+)[^()]*)\)", "", subject)
    s = re.sub(r"\b[0-9a-f]{7,40}\b", "", s)
    s = re.sub(r"[\"“][^\"”]*[\"”]", "", s)
    s = re.sub(r"\S+/\S+\.(?:py|ts|tsx|sh|toml|json|md|mjs)\b", "a script", s)
    s = re.sub(r"\s{2,}", " ", s).strip(" ,;:-")
    return s[0].upper() + s[1:] if s else s


def broke_and_fixed(root: Path, start: dt.date, end: dt.date, limit: int = 8) -> list[str]:
    log = _git(["log", f"--since={start.isoformat()}T00:00", f"--until={(end + dt.timedelta(days=1)).isoformat()}T00:00", "--format=%s"], root)
    out: list[str] = []
    for line in log.splitlines():
        if not FIXES.search(line) or line.startswith("Merge "):
            continue
        p = plain(line)
        p = p if len(p) <= 160 else p[:157].rsplit(" ", 1)[0] + "…"
        if p and p not in out:
            out.append(p)
        if len(out) >= limit:
            break
    return out


# ---- the post ---------------------------------------------------------------------------------------------------------------
def _day(d: dt.date) -> str:
    return f"{d.day} {d.strftime('%B')}"


def compose(start: dt.date, end: dt.date, data: dict, mask: Masker) -> dict:
    lead, dr, rl, rf, dn, pv, fx = (data.get(k) for k in ("leads", "drafts", "roles", "refused", "drain", "providers", "fixes"))
    sections = []
    if lead is not None:
        n, no = lead["listed"], lead["no_site"]
        more = (f" {no} of them ({round(100 * no / n)}%) have no website of their own: we found them on a directory or map listing, and that page is the proof." if no else " Every one of them has a website of its own.") if n else ""
        sections.append({"heading": "Leads", "lines": [f"We listed {n} new leads.{more}"]})
    if dr is not None:
        sections.append({"heading": "First messages", "lines": [f"We drafted {dr['emails']} first emails and {dr['whatsapp']} WhatsApp pitches. None went out on their own: a person reads, fixes and sends each one."]})
    if rl:
        top = ", ".join(f"{r} {n}" for r, n in rl.most_common(5))
        sections.append({"heading": "Who we would talk to", "lines": [f"We found the contact's role for {sum(rl.values())} leads: {top}. A role only; we never record a person's private details."]})
    if rf:
        lines = ["Every write passes our Validator first; a refusal is a rule doing its job, and a wasted call. Per member:"]
        for r in rf:
            if r["share"] is None:
                lines.append(f"{r['name']}: no actions this week (last week {r['last']}% refused).")
            else:
                was = f"last week {r['last']}%" if r["last"] is not None else "not running last week"
                lines.append(f"{r['name']}: {r['share']}% of {r['actions']:,} actions refused ({was}).")
        sections.append({"heading": "What the Validator refused", "lines": lines})
    if dn and dn["days"]:
        tok = f"{dn['tokens'] / 1e6:.1f} million" if dn["tokens"] >= 1e6 else f"{dn['tokens']:,}"
        first, last = dt.date.fromisoformat(dn["days"][0]), dt.date.fromisoformat(dn["days"][-1])
        sections.append({"heading": "Free tiers", "lines": [f"On the {len(dn['days'])} days we measured ({_day(first)} to {_day(last)}) we made {dn['calls']:,} model calls, about {tok} tokens, across {dn['providers']} free providers. Our bill: $0."]})
    pl = ([f"Joined our chain: {', '.join(pv['joined'])}."] if pv and pv["joined"] else []) + ([f"Left our chain: {', '.join(pv['left'])}."] if pv and pv["left"] else [])
    if pl:
        sections.append({"heading": "Providers", "lines": pl})
    if fx:
        sections.append({"heading": "What broke and what we fixed", "lines": fx})
    sections = [{"heading": s["heading"], "lines": [mask(l) for l in s["lines"] if l]} for s in sections]
    bits = ([f"{lead['listed']} leads"] if lead is not None else []) + ([f"{dr['emails']} first emails and {dr['whatsapp']} WhatsApp pitches drafted"] if dr is not None else [])
    return {
        "slug": end.isoformat(),
        "from": start.isoformat(),
        "to": end.isoformat(),
        "title": f"This week in the family: {_day(start)} to {_day(end)} {end.year}",
        "summary": mask((", ".join(bits) + ", on free tiers only.") if bits else "Our week, on free tiers only."),
        "sections": sections,
        "generated_at": dt.datetime.now().isoformat(timespec="seconds"),
    }


def markdown(post: dict) -> str:
    out = [f"# {post['title']}", "", post["summary"], ""]
    for s in post["sections"]:
        out += [f"## {s['heading']}", ""]
        lines = s["lines"]
        if len(lines) > 1:
            if lines[0].endswith(":"):
                out += [lines[0], ""]
                lines = lines[1:]
            out += [f"- {l}" for l in lines]
        else:
            out += lines
        out.append("")
    return "\n".join(out + ["— the family", ""])


def gather(start: dt.date, end: dt.date, root: Path = ROOT) -> dict:
    return {"leads": leads(root, start, end), "drafts": drafts(root, start, end), "roles": roles(root, start, end),
            "refused": refused(root, start, end), "drain": drain(root / "common-data/shared-state", start, end),
            "providers": providers(root, start), "fixes": broke_and_fixed(root, start, end)}


def save(post: dict, root: Path = ROOT) -> Path:
    out = root / "common-data" / "family-weeks.json"
    posts = [p for p in _json(out, []) if p.get("slug") != post["slug"]] + [post]
    posts.sort(key=lambda p: p["to"], reverse=True)
    tmp = out.with_suffix(".tmp")
    tmp.write_text(json.dumps(posts, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    tmp.replace(out)
    md = root / "common-data" / "family-weeks" / f"{post['slug']}.md"
    md.parent.mkdir(parents=True, exist_ok=True)
    md.write_text(markdown(post), encoding="utf-8")
    return md


def main(argv: list[str]) -> int:
    end = dt.date.fromisoformat(argv[argv.index("--end") + 1]) if "--end" in argv else dt.date.today()
    start, end = week_of(end)
    post = compose(start, end, gather(start, end), Masker(mask_terms()))
    if "--print" in argv:
        print(markdown(post))
        return 0
    print(f"family week {post['from']} to {post['to']}: {save(post)}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
