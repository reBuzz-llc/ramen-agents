"""Lead signals the Validator reads off each business's own homepage, no model involved (owner, 2026-10-14: "lets go with
1 and 2" -- the tools a site runs on, the site's health, and a lead score so the team calls the best leads first).

Writes three Leads columns the Validator alone fills: "Tools on site" (multi-select), "Site health" (text) and
"Lead score" (number, 0-100). Every value is something the page source shows, so it is a fact, not a guess.

Score = fit (up to 35: gaps our packages fix, seen on the page) + means (up to 25: able to pay -- owner, 2026-10-14: "work
with rich people to scale fast") + reach (up to 25: a deliverable email, a WhatsApp, a person to talk to) + ready (up to
15: a three-part pain point, a passing draft, a package chosen).
"""
from __future__ import annotations

import datetime as dt
import json
import re
import time
from pathlib import Path
from typing import Callable

import httpx

BOTS = Path.home() / "bots"
API = "https://api.notion.com/v1"
RECHECK_DAYS = 14
PER_RUN = 40
LOG = BOTS / "common-data" / "shared-state" / "leads-facts-applied.jsonl"
CACHE = BOTS / "validator" / "workspace" / "signals.json"      # its own file: a long first run never races the 10-minute pass

TOOLS = {
    "Wix": r"static\.wixstatic\.com|wix\.com|_wixCIDX",
    "Squarespace": r"squarespace\.com|static1\.squarespace",
    "WordPress": r"/wp-content/|/wp-includes/",
    "Shopify": r"cdn\.shopify\.com|myshopify\.com",
    "GoDaddy builder": r"img1\.wsimg\.com|godaddy\.com/websites",
    "Weebly": r"weebly\.com|editmysite\.com",
    "Webflow": r"webflow\.(?:com|io)",
    "BentoBox": r"getbento\.com",
    "Toast": r"toasttab\.com",
    "Square": r"squareup\.com|square\.site",
    "Clover": r"clover\.com/online-ordering|clover\.com/order",
    "ChowNow": r"chownow\.com",
    "Delivery apps": r"doordash\.com|ubereats\.com|grubhub\.com|seamless\.com",
    "OpenTable": r"opentable\.com",
    "Resy": r"resy\.com",
    "Vagaro": r"vagaro\.com",
    "Mindbody": r"mindbodyonline\.com|healcode\.com",
    "Calendly": r"calendly\.com",
    "Acuity": r"acuityscheduling\.com|squarespacescheduling",
    "Booksy": r"booksy\.com",
    "Meta Pixel": r"connect\.facebook\.net/[^\"']*fbevents|fbq\(",
    "Google Analytics": r"googletagmanager\.com|google-analytics\.com|gtag\(",
    "WhatsApp chat": r"wa\.me/|api\.whatsapp\.com",
}
_BOOKING = {"Vagaro", "Mindbody", "Calendly", "Acuity", "Booksy", "OpenTable", "Resy"}
_ORDERING = {"Toast", "Square", "Clover", "ChowNow", "BentoBox", "Shopify"}
_TEMPLATE = {"Wix", "GoDaddy builder", "Weebly"}
_FOOD = re.compile(r"restaurant|cafe|café|coffee|bakery|pizza|grill|kitchen|food|deli|bar\b|catering|taco|burger|chicken", re.I)
_PAID_SOFTWARE = {"Shopify", "Toast", "BentoBox", "OpenTable", "Resy", "Mindbody", "Vagaro", "Clover", "ChowNow"}
_HIGH_VALUE = re.compile(r"medical|dental|dentist|orthodont|dermatolog|clinic|surgery|surgical|physical therap|chiropract|"
                         r"law\b|legal|attorney|real estate|realty|property|properties|brokerage|wealth|financial|investment", re.I)
_MANY = re.compile(r"(\d+)\s*\+?\s*(?:locations?|stores?|shops?|outlets?|restaurants?|units?|studios?|clinics?|offices?)", re.I)
_APPOINTMENT = re.compile(r"salon|spa|barber|nail|lash|fitness|gym|yoga|pilates|studio|clinic|therap|dental|health|massage|wellness|tutor|school|class", re.I)


def read_site(url: str, *, get: Callable | None = None) -> dict:
    """{tools, https, phone_ready, copyright, pdf_menu, status, seconds} from the homepage; {} when it will not open."""
    url = (url or "").strip()
    if not url.startswith(("http://", "https://")):
        return {}
    started = time.time()
    try:
        if get:
            status, html, final = get(url)
        else:
            with httpx.Client(timeout=20, follow_redirects=True, headers={"User-Agent": "Mozilla/5.0"}) as c:
                r = c.get(url)
                status, html, final = r.status_code, r.text, str(r.url)
    except Exception:  # noqa: BLE001
        return {"status": 0}
    if status >= 400 or not html:
        return {"status": status}
    years = [int(y) for y in re.findall(r"(?:©|&copy;|copyright)\s*(?:\d{4}\s*[-–]\s*)?((?:19|20)\d{2})", html, re.I)]
    return {
        "status": status,
        "seconds": round(time.time() - started, 1),
        "https": final.startswith("https://"),
        "phone_ready": bool(re.search(r"<meta[^>]+name=[\"']viewport", html, re.I)),
        "copyright": max(years) if years else None,
        "pdf_menu": bool(re.search(r"href=[\"'][^\"']*menu[^\"']*\.pdf", html, re.I)),
        "tools": sorted(n for n, pat in TOOLS.items() if re.search(pat, html, re.I)),
    }


def health_text(sig: dict, today: dt.date) -> str:
    if not sig:
        return "no website"
    if not sig.get("tools") and "https" not in sig:
        return f"site did not open (HTTP {sig.get('status', 0)}), {today.isoformat()}"
    bits = ["https" if sig["https"] else "no https", "phone-ready" if sig["phone_ready"] else "not set up for phones"]
    if sig.get("copyright"):
        bits.append(f"© {sig['copyright']}")
    if sig.get("pdf_menu"):
        bits.append("PDF menu")
    bits.append(f"{sig.get('seconds', 0)}s to load")
    return " · ".join(bits) + f" (checked {today.isoformat()})"


def score(ld, sig: dict, *, draft_ok: bool, pain_ok: bool, today: dt.date) -> int:
    tools = set(sig.get("tools") or [])
    kind = f"{ld.industry} {ld.business}"
    fit = 0
    if sig and "https" in sig:
        fit += 0 if sig["https"] else 8
        fit += 0 if sig["phone_ready"] else 10
        fit += 8 if sig.get("copyright") and sig["copyright"] <= today.year - 2 else 0
        fit += 8 if sig.get("pdf_menu") else 0
        fit += 6 if tools & _TEMPLATE else 0
        if _FOOD.search(kind) and not tools & _ORDERING:
            fit += 10                                   # a food business with no ordering of its own
        elif _APPOINTMENT.search(kind) and not tools & _BOOKING:
            fit += 10                                   # an appointment business with no online booking
    elif not ld.website.strip():
        fit += 30                                       # no website at all: the clearest web-development need
    tools_paid = tools & _PAID_SOFTWARE
    many = [int(n) for n in _MANY.findall(ld.company_size)]
    means = 0
    means += 10 if (many and max(many) >= 2) or re.search(r"multiple locations|franchise", f"{ld.company_size} {kind} {ld.how_we_help}", re.I) else 0
    means += 7 if tools_paid else 0                      # already paying for software
    means += 5 if "Meta Pixel" in tools else 0           # already paying for ads
    means += 5 if _HIGH_VALUE.search(kind) else 0        # a high-value trade
    reach = (15 if ld.email_check.strip().lower().startswith("deliverable") else 5 if ld.email.strip() else 0)
    reach += 12 if ld.status.strip().lower() == "whatsapp verified" else 6 if ld.whatsapp.strip() and ld.status.strip().lower() != "false whatsapp number" else 0
    reach += 8 if ld.founded_by.strip() else 0
    ready = (5 if pain_ok else 0) + (5 if draft_ok else 0) + (5 if ld.how_we_help.strip() else 0)
    return round(min(fit, 50) * 0.7) + min(means, 25) + round(min(reach, 35) * 25 / 35) + min(ready, 15)


def run(leads: list, state: dict | None, *, api_key: str, data_source: str, api_version: str, now: dt.datetime,
        draft_ok: Callable, pain_ok: Callable, dry_run: bool = False, get: Callable | None = None, per_run: int = PER_RUN) -> dict:
    """Read up to PER_RUN sites due for a check, then write Tools / Site health / Lead score where they changed."""
    try:
        cache: dict = json.loads(CACHE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        cache = {}
    cutoff = (now - dt.timedelta(days=RECHECK_DAYS)).date().isoformat()
    due = sorted((ld for ld in leads if ld.website.strip() and str(cache.get(ld.page_id, {}).get("at", "")) < cutoff),
                 key=lambda ld: str(cache.get(ld.page_id, {}).get("at", "")))[:per_run]
    for ld in due:
        cache[ld.page_id] = {**cache.get(ld.page_id, {}), "at": now.date().isoformat(), "sig": read_site(ld.website, get=get)}
    client = None if dry_run else httpx.Client(headers={"Authorization": f"Bearer {api_key}", "Notion-Version": api_version}, timeout=60)
    written = 0
    for ld in leads:
        sig = (cache.get(ld.page_id) or {}).get("sig", {}) if ld.website.strip() else {}
        if ld.website.strip() and ld.page_id not in cache:
            continue                                     # not read yet: next run
        want = {"tools": sig.get("tools") or [], "health": health_text(sig, now.date()) if (sig or not ld.website.strip()) else "",
                "score": score(ld, sig, draft_ok=draft_ok(ld), pain_ok=pain_ok(ld), today=now.date())}
        had = (cache.get(ld.page_id) or {}).get("written") or {}
        if had.get("tools") == want["tools"] and had.get("score") == want["score"] and had.get("health", "")[:40] == want["health"][:40]:
            continue
        if client is not None:
            props = {"Tools on site": {"multi_select": [{"name": t} for t in want["tools"]]},
                     "Site health": {"rich_text": [{"text": {"content": want["health"][:300]}}] if want["health"] else []},
                     "Lead score": {"number": want["score"]}}
            r = client.patch(f"{API}/pages/{ld.page_id}", json={"properties": props})
            if r.status_code != 200:
                continue
        cache.setdefault(ld.page_id, {})["written"] = want
        written += 1
    if not dry_run:
        CACHE.write_text(json.dumps(cache, ensure_ascii=False), encoding="utf-8")
    if written and not dry_run:
        with LOG.open("a", encoding="utf-8") as f:
            f.write(json.dumps({"at": now.isoformat(timespec="seconds"), "by": "Validator signals", "rows": written,
                                "fields": ["Tools on site", "Site health", "Lead score"]}) + "\n")
    return {"read": len(due), "written": written}
