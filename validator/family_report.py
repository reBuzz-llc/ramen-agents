"""The agents' day and week on the team portal's Family page (the portal's POST /v1/family/report).

Runs only when common-data/configs/common.toml sets [leads] portal_url, with the Validator's key
(common-data/keys/portal-validator.key). After every Validator run it posts:
- tick: today's numbers from the agents' own records (leads listed and the share with no website, first emails and
  WhatsApp pitches drafted, contact roles written -- each only when that agent is installed) and each agent's state line
  (running, resting until when, or stopped; its accepted actions of the last 30 minutes);
- morning: once a day from 06:00, each agent's last 24 hours (actions, refused share, accepted outputs);
- week: once per post, the newest entry of common-data/family-weeks.json (scripts/family_week.py), when common.toml sets
  [family] week_url (the address the post is published under, e.g. "https://your-blog.example/family-week"; the post's
  link is <week_url>/<its Sunday>).

Every text is masked before it leaves the Mac: email addresses, phone numbers (9 or more digits) and web addresses become
[email], [phone] and [link] (the portal refuses a line that still has one). A failed post is one error line in the run.
"""
from __future__ import annotations

import datetime as dt
import json
import re
import sqlite3
import tomllib
from pathlib import Path
from typing import Any

BOTS = Path.home() / "bots"
COMMON = BOTS / "common-data" / "configs" / "common.toml"
WEEKS = BOTS / "common-data" / "family-weeks.json"
KEY = BOTS / "common-data" / "keys" / "portal-validator.key"
MAX_LINE = 300
OPEN_HOUR = 6

_EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
_URL = re.compile(r"https?://\S+|www\.\S+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|co|us|biz|info|io|shop|store|nyc|app|dev|me|ai)\b\S*", re.I)
_PHONE = re.compile(r"\+?\d[\d ()./-]{7,}\d")


def mask(text: Any, limit: int = MAX_LINE) -> str:
    s = re.sub(r"\s+", " ", str(text or "")).strip()
    s = _EMAIL.sub("[email]", s)
    s = _URL.sub("[link]", s)
    s = _PHONE.sub(lambda m: "[phone]" if len(re.sub(r"\D", "", m.group(0))) >= 9 else m.group(0), s)
    return s if len(s) <= limit else s[: limit - 1].rstrip() + "…"


def settings(common: Path = COMMON) -> tuple[str, str]:
    """(portal_url, week_url) from common.toml; "" where unset."""
    try:
        data = tomllib.loads(common.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return "", ""
    portal = str((data.get("leads") or {}).get("portal_url") or "").strip().rstrip("/")
    week = str((data.get("family") or {}).get("week_url") or "").strip().rstrip("/")
    return portal, week


def agents(root: Path = BOTS) -> list[tuple[str, str]]:
    """(folder, name) of every agent: a folder whose config.toml has an [agent] name (the Validator has none)."""
    out = []
    for cfg in sorted(root.glob("*/config.toml")):
        try:
            agent = tomllib.loads(cfg.read_text(encoding="utf-8")).get("agent") or {}
        except (OSError, ValueError):
            continue
        if agent.get("name") and not agent.get("not_a_bot_run_agent"):
            out.append((cfg.parent.name, str(agent["name"])))
    return out


def _q(db: Path, sql: str, args: tuple = ()) -> list[tuple]:
    if not db.exists():
        return []
    try:
        con = sqlite3.connect(f"file:{db}?mode=ro", uri=True, timeout=2)
        try:
            return con.execute(sql, args).fetchall()
        finally:
            con.close()
    except sqlite3.Error:
        return []


def _db(root: Path, slug: str) -> Path:
    return root / slug / "workspace" / "explorer.sqlite3"


def today_numbers(now: dt.datetime, root: Path = BOTS) -> dict:
    day = now.date().isoformat()
    out: dict[str, Any] = {}
    if _db(root, "lead-gen").exists():
        leads = _q(_db(root, "lead-gen"), "SELECT coalesce(json_extract(payload, '$.website'), '') FROM actions WHERE action_type = 'lead' "
                                          "AND verdict = 'allowed' AND substr(ts, 1, 10) = ?", (day,))
        out["leads_listed"] = len(leads)
        out["no_site_share"] = round(100 * sum(1 for (w,) in leads if not str(w or "").strip()) / len(leads)) if leads else 0
    if _db(root, "outreach-writer").exists():
        def drafted(col: str) -> int:
            rows = _q(_db(root, "outreach-writer"), f"SELECT COUNT(DISTINCT json_extract(payload, '$.name')) FROM actions WHERE action_type = 'update_lead' "
                                                    f"AND verdict = 'allowed' AND substr(ts, 1, 10) = ? AND coalesce(json_extract(payload, '$.{col}'), '') != '' "
                                                    f"AND lower(json_extract(payload, '$.{col}')) NOT LIKE 'skip:%'", (day,))
            return int(rows[0][0] or 0) if rows else 0
        out["drafts_landed"], out["whatsapp_pitches"] = drafted("draft_email"), drafted("draft_whatsapp")
    if _db(root, "lead-enricher").exists():
        roles = _q(_db(root, "lead-enricher"), "SELECT json_extract(payload, '$.contact_role'), COUNT(DISTINCT json_extract(payload, '$.name')) FROM actions "
                                               "WHERE action_type = 'update_lead' AND verdict = 'allowed' AND substr(ts, 1, 10) = ? "
                                               "AND coalesce(json_extract(payload, '$.contact_role'), '') != '' GROUP BY 1 ORDER BY 2 DESC LIMIT 20", (day,))
        out["contact_roles"] = {mask(r, 60): int(n) for r, n in roles if mask(r, 60)}
    return out


def member_lines(now: dt.datetime, root: Path = BOTS) -> list[dict]:
    since = (now - dt.timedelta(minutes=30)).isoformat(timespec="seconds")
    out = []
    for slug, name in agents(root)[:30]:
        ws = root / slug / "workspace"
        rows = _q(_db(root, slug), "SELECT COUNT(*), SUM(verdict = 'allowed') FROM actions WHERE ts >= ?", (since,))
        n, ok = (int(rows[0][0] or 0), int(rows[0][1] or 0)) if rows else (0, 0)
        state, rest = "running", ""
        if (ws / "STOP").exists():
            state = "stopped"
        else:
            try:
                until = str(json.loads((ws / "rest-until.json").read_text(encoding="utf-8")).get("until") or "")
            except (OSError, ValueError):
                until = ""
            if until > now.isoformat(timespec="seconds"):
                state, rest = "resting", until[11:16]
        line = f"{ok} of {n} actions accepted in the last 30 minutes" + (f"; resting until {rest}" if rest else "")
        out.append({"name": mask(name, 60), "state": state, "line": mask(line)})
    return out


def morning_lines(now: dt.datetime, root: Path = BOTS) -> list[str]:
    since = (now - dt.timedelta(hours=24)).isoformat(timespec="seconds")
    out = []
    for slug, name in agents(root):
        rows = _q(_db(root, slug), "SELECT COUNT(*), SUM(verdict LIKE 'rejected%'), SUM(verdict = 'allowed' AND action_type IN "
                                   "('lead', 'update_lead', 'task', 'update_task', 'publish_package', 'note', 'message')) FROM actions WHERE ts > ?", (since,))
        n, bad, outs = (int(rows[0][0] or 0), int(rows[0][1] or 0), int(rows[0][2] or 0)) if rows else (0, 0, 0)
        if n:
            out.append(mask(f"{name}: {n} actions in the last 24 hours, {round(100 * bad / n)}% refused, {outs} accepted outputs"))
    return out[:60]


def week_body(state: dict, week_url: str, weeks: Path = WEEKS) -> dict | None:
    if not week_url:
        return None
    try:
        posts = json.loads(weeks.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    w = None
    if isinstance(posts, list):   # the newest Sunday, whatever the order
        w = max((p for p in posts if isinstance(p, dict) and p.get("slug")), key=lambda p: str(p["slug"]), default=None)
    if not w or state.get("family_week_posted") == w["slug"]:
        return None
    return {"kind": "week", "week": {"title": mask(w.get("title"), 160), "summary": mask(w.get("summary")), "url": f"{week_url}/{w['slug']}"}}


def post(portal: str, body: dict, http=None, token: str | None = None) -> str:
    """POST one report; "" when it landed, else the reason in a few words."""
    import httpx
    token = token or (KEY.read_text(encoding="utf-8").strip() if KEY.exists() else "")
    if not token:
        return "no Validator key for the portal (common-data/keys/portal-validator.key)"
    client = http or httpx.Client(base_url=portal, timeout=20)
    try:
        r = client.post("/v1/family/report", headers={"Authorization": f"Bearer {token}"}, json=body)
    except httpx.HTTPError as exc:
        return type(exc).__name__
    if r.status_code >= 400:
        try:
            err = r.json().get("error")
            err = (err.get("message") or err.get("code")) if isinstance(err, dict) else err
        except ValueError:
            err = ""
        return f"HTTP {r.status_code} {str(err or '')[:120]}".strip()
    return ""


def run(state: dict, now: dt.datetime, http=None, root: Path = BOTS, common: Path = COMMON, weeks: Path = WEEKS) -> str:
    """The tick (always), the morning (once a day from 06:00) and the week (once per post): one note line, or a
    RuntimeError naming what failed. "" when no portal is set."""
    portal, week_url = settings(common)
    if not portal:
        return ""
    at = now.astimezone().isoformat(timespec="seconds")
    jobs: list[tuple[str, dict, str, str]] = [("tick", {"kind": "tick", "at": at, "today": today_numbers(now, root), "members": member_lines(now, root)}, "", "")]
    day = now.date().isoformat()
    if now.hour >= OPEN_HOUR and state.get("family_morning_posted") != day:
        lines = morning_lines(now, root)
        if lines:
            jobs.append(("morning", {"kind": "morning", "at": at, "lines": lines}, "family_morning_posted", day))
    w = week_body(state, week_url, weeks)
    if w:
        jobs.append(("week", w, "family_week_posted", w["week"]["url"].rsplit("/", 1)[-1]))
    done, failed = [], []
    for kind, body, key, value in jobs:
        why = post(portal, body, http=http)
        if why:
            failed.append(f"{kind} {why}")
        else:
            done.append(kind)
            if key:
                state[key] = value
    if failed:
        raise RuntimeError("family report: " + "; ".join(failed) + (f" (posted: {', '.join(done)})" if done else ""))
    return f"family report posted: {', '.join(done)}"
