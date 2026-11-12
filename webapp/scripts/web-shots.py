"""Pictures for the floating screens (creatorCC queue 41): render the family's recent valid pages on this Mac.

The bots read pages with the light browser (plain HTTP to text), so they almost never leave a screenshot. This renders
each page in /api/web's recent_pages (already the validity-filtered list: allowed, titled, 500+ characters, not
refused, captcha, login, search or denylisted) that has no picture yet: headless Chromium at 1280x800, device scale
0.5 (a 640x400 file, well under 200 KB), 12 s, no media, no fonts, no third-party scripts, images or requests (the
page's own images and any stylesheet stay). A page that lands on a login, consent or captcha page is discarded. The
file goes into the ring as <slug>-<YYYYMMDDTHHMMSS>-<8 hex of sha1(url)>.png, where /api/web matches it to its page by
the address hash. Every attempt is logged in web-shots/attempts.json {url: {at, ok, reason}}; an address is tried at
most once a day. One Chromium per run, closed at the end. Run by launchd every 2 minutes (com.rebuzz.web-shots), or:
    npm run web-shots
It uses the engine's venv (Playwright for Python, the browser already installed there), never Node Playwright.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import os
import re
import sys
import urllib.request
from pathlib import Path
from urllib.parse import urlparse

BOTS = Path(os.environ.get("BOTS_DIR", Path.home() / "bots"))
RING = BOTS / "common-data" / "shared-state" / "web-shots"
ATTEMPTS = RING / "attempts.json"
API = os.environ.get("WEB_SHOTS_API", "http://127.0.0.1:3000/api/web")
TIMEOUT_MS = 12_000

BAD_TITLE = re.compile(r"sign ?in|log ?in|captcha|just a moment|access denied|verify you are human|attention required|consent|cookie settings|are you a robot", re.I)
BAD_URL = re.compile(r"(^|[./])(login|signin|accounts|consent|auth)[./-]|/(login|signin|sign-in|consent|captcha)\b", re.I)


def url_hash(url: str) -> str:
    return hashlib.sha1(url.encode("utf-8")).hexdigest()[:8]


def file_name(slug: str, ts: str, url: str) -> str:
    """The ring's name for a rendered page: the bot, the visit, the address hash /api/web matches on."""
    return f"{slug}-{re.sub(r'[-:]', '', ts)}-{url_hash(url)}.png"


def tried_today(attempts: dict, url: str, today: str) -> bool:
    """An address is rendered at most once a day, whatever came of it."""
    return str(attempts.get(url, {}).get("at", ""))[:10] == today


def discard_reason(final_url: str, title: str) -> str | None:
    """Why a rendered page is not shown: it landed on a login, consent or captcha page."""
    if BAD_TITLE.search(title or ""):
        return f"landed on {title.strip()[:60]!r}"
    host_path = urlparse(final_url)
    if BAD_URL.search(f"{host_path.netloc}{host_path.path}"):
        return f"redirected to {final_url[:100]}"
    return None


def blank(png: bytes) -> bool:
    """A near-empty picture: a 640x400 PNG of one colour compresses to a few KB; a real page is tens of KB."""
    return len(png) < 6000


def site(host: str) -> str:
    """The last two labels of a host (good enough to tell first-party requests from third-party ones)."""
    parts = host.lower().split(".")
    return ".".join(parts[-2:]) if len(parts) >= 2 else host.lower()


def load_attempts() -> dict:
    try:
        return json.loads(ATTEMPTS.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def save_attempts(attempts: dict) -> None:
    tmp = ATTEMPTS.with_suffix(".tmp")
    tmp.write_text(json.dumps(attempts, indent=1, sort_keys=True), encoding="utf-8")
    tmp.replace(ATTEMPTS)


def main() -> int:
    RING.mkdir(parents=True, exist_ok=True)
    try:
        with urllib.request.urlopen(API, timeout=20) as r:
            pages = json.load(r).get("recent_pages", [])
    except Exception as exc:  # noqa: BLE001 - the dashboard may be restarting; the next run tries again
        print(f"web-shots: could not read {API}: {exc}")
        return 0
    today = dt.date.today().isoformat()
    attempts = load_attempts()
    todo = [p for p in pages if not p.get("shot") and p.get("url") and not tried_today(attempts, p["url"], today)]
    if not todo:
        print("web-shots: nothing new")
        return 0
    from playwright.sync_api import sync_playwright  # only when there is work: the import starts nothing

    done = 0
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        try:
            for p in todo:
                url = p["url"]
                own = site(urlparse(url).hostname or "")
                ctx = browser.new_context(viewport={"width": 1280, "height": 800}, device_scale_factor=0.5, java_script_enabled=True)
                page = ctx.new_page()

                def gate(route, request, own=own):
                    kind = request.resource_type
                    third = site(urlparse(request.url).hostname or "") != own
                    if kind in ("media", "font") or (third and kind in ("script", "image", "xhr", "fetch", "websocket", "other")):
                        return route.abort()
                    return route.continue_()

                page.route("**/*", gate)
                record = {"at": dt.datetime.now().isoformat(timespec="seconds"), "ok": False, "reason": ""}
                try:
                    page.goto(url, timeout=TIMEOUT_MS, wait_until="domcontentloaded")
                    page.wait_for_timeout(1200)  # let the first paint settle
                    why = discard_reason(page.url, page.title())
                    if why:
                        record["reason"] = why
                    else:
                        png = page.screenshot(full_page=False)
                        if blank(png):
                            record["reason"] = "blank (the page draws itself with scripts it was not given)"
                        else:
                            (RING / file_name(p["slug"], p["ts"], url)).write_bytes(png)
                            record.update(ok=True, reason="saved")
                            done += 1
                except Exception as exc:  # noqa: BLE001 - one page failing never stops the rest
                    record["reason"] = str(exc).splitlines()[0][:160]
                finally:
                    ctx.close()
                attempts[url] = record
        finally:
            browser.close()
    # forget attempts older than a week, so the log stays small
    cut = (dt.date.today() - dt.timedelta(days=7)).isoformat()
    attempts = {u: a for u, a in attempts.items() if str(a.get("at", ""))[:10] >= cut}
    save_attempts(attempts)
    print(f"web-shots: {done} of {len(todo)} rendered")
    return 0


if __name__ == "__main__":
    sys.exit(main())
