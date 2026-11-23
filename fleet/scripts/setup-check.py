#!/usr/bin/env python3
"""What is still missing before ramen-agents can run, in plain lines (docs/setup-queue.md is the list to work through).

    python3 scripts/setup-check.py            # what is missing and where you get it; exit 0 when nothing is
    python3 scripts/setup-check.py --probe    # also test each key with one read-only request to its provider

It changes nothing. Without --probe it makes no call to the internet; it only looks at files and asks this Mac's own
services (127.0.0.1) whether they answer. Standard library only, Python 3.8 or newer (the system python3 is enough).
Never prints a key.
"""
from __future__ import annotations

import json
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent  # this repository (the fleet branch, normally ~/bots)
HOME = Path.home()
ENGINE = Path(os.environ.get("RAMEN_ENGINE", HOME / "Projects" / "bot"))
KEYS = ROOT / "common-data" / "keys"

# Model providers: file name, who, where you make the key. At least one is needed (docs/free-tiers.md).
MODEL_KEYS = [
    ("zai", "Z.ai", "https://z.ai"),
    ("gemini", "Google AI Studio", "https://aistudio.google.com/apikey"),
    ("groq", "Groq", "https://console.groq.com/keys"),
    ("openrouter", "OpenRouter (free models only)", "https://openrouter.ai/keys"),
]
OPTIONAL_KEYS = [
    ("quickemailverification", "QuickEmailVerification (Lead Gen checks an email before listing it)", "https://quickemailverification.com"),
    ("sniffmail", "Sniffmail (the backup email check)", "https://sniffmail.io"),
]
# The board's keys, one per reader (the dashboard's local board; setup writes them, or for the hosted portal
# they are minted in its checkout with node --env-file=.env.local scripts/api-key.mjs <name> <scopes>)
PORTAL_KEYS = [
    ("portal-engine", "engine board:read board:write", "the agents read and write leads"),
    ("portal-validator", "validator board:read board:write", "the Validator checks and fills leads"),
    ("portal-dashboard", "dashboard board:read", "the dashboard reads the board"),
]


def key_ok(name: str) -> bool:
    f = KEYS / f"{name}.key"
    return f.is_file() and f.read_text(encoding="utf-8", errors="ignore").strip() != ""


def local_answers(url: str) -> bool:
    try:
        with urllib.request.urlopen(url, timeout=3) as r:  # noqa: S310 - 127.0.0.1 only
            return r.status < 500
    except urllib.error.HTTPError as e:
        return e.code < 500
    except (OSError, ValueError):
        return False


def portal_url() -> str:
    """The board's address: [leads] portal_url in common-data/configs/local.toml, else in common.toml, else the
    dashboard's local board. A small scan, no TOML library needed."""
    for f in (ROOT / "common-data" / "configs" / "local.toml", ROOT / "common-data" / "configs" / "common.toml"):
        table = ""
        for raw in (f.read_text(encoding="utf-8").splitlines() if f.is_file() else []):
            line = raw.strip()
            head = re.match(r"^\[([^\[\]]+)\]", line)
            if head:
                table = head.group(1).strip()
            elif table == "leads":
                m = re.match(r'^portal_url\s*=\s*"([^"]*)"', line)
                if m and m.group(1).strip():
                    return m.group(1).strip().rstrip("/")
    return "http://127.0.0.1:3000"


def family_missing() -> list[str]:
    """What the first-run answers still lack: common-data/local/family.toml needs [company] name, sells and
    buyers and [target] market. Written by sh scripts/setup.sh (step 2) or the dashboard's first-run page."""
    import tomllib
    f = ROOT / "common-data" / "local" / "family.toml"
    try:
        data = tomllib.loads(f.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return ["common-data/local/family.toml (step 2: sh scripts/setup.sh, or the dashboard's first-run page)"]
    company = data.get("company") if isinstance(data.get("company"), dict) else {}
    target = data.get("target") if isinstance(data.get("target"), dict) else {}
    return [f"[company] {k}" for k in ("name", "sells", "buyers") if not str(company.get(k) or "").strip()] + \
           ([] if str(target.get("market") or "").strip() else ["[target] market"])


def checks() -> tuple[list[str], list[str], int]:
    """(missing, optional, done): each missing line says what and where you get it."""
    missing: list[str] = []
    optional: list[str] = []
    done = 0

    def need(ok: bool, line: str) -> None:
        nonlocal done
        if ok:
            done += 1
        else:
            missing.append(line)

    # 1. the engine
    need(ENGINE.is_dir(), f"the engine at {ENGINE}: git clone -b engine -o starter https://github.com/reBuzz-llc/ramen-agents {ENGINE} -- or sh scripts/install.sh, which clones it (step 1)")
    need((ENGINE / ".venv" / "bin" / "bot").exists(), f"the engine's Python environment: cd {ENGINE} && python3 -m venv .venv && .venv/bin/pip install -e \".[dev]\" (Python 3.11+)")
    caches = [HOME / "Library" / "Caches" / "ms-playwright", HOME / ".cache" / "ms-playwright"]
    browser = any(c.is_dir() and any(x.name.startswith(("chromium-", "chromium_headless_shell-")) for x in c.iterdir()) for c in caches)
    need(browser, f"the agents' browser: {ENGINE}/.venv/bin/playwright install chromium")
    # 2. this repository
    need((HOME / ".config" / "explorer").is_symlink(), "the folders and the state link: sh scripts/install.sh (step 1)")
    # 3. model keys
    have = [n for n, _, _ in MODEL_KEYS if key_ok(n) and not (n == "gemini" and gemini_closed())]
    if key_ok("gemini") and gemini_closed():
        optional.append("common-data/keys/gemini.key is on file but closed to lead data until you choose: sh scripts/add-key.sh gemini")
    if not have:
        missing.append("at least one model key, sh scripts/add-key.sh <provider> (step 3): " + "; ".join(f"{n}.key from {link}" for n, _, link in MODEL_KEYS[:3]) + " (more are optional)")
    else:
        done += 1
        for n, who, link in MODEL_KEYS:
            if n not in have and not key_ok(n):
                optional.append(f"common-data/keys/{n}.key: {who}, {link} (another fallback)")
    for n in have + [k for k, _, _ in OPTIONAL_KEYS if key_ok(k)]:
        mode = (KEYS / f"{n}.key").stat().st_mode & 0o077
        if mode:
            missing.append(f"common-data/keys/{n}.key can be read by others: chmod 600 common-data/keys/{n}.key")
    # 4. the board: the dashboard's local board (or the hosted portal named in local.toml), one key per reader
    portal = portal_url()
    for n, mint, why in PORTAL_KEYS:
        need(key_ok(n), f"common-data/keys/{n}.key ({why}): sh scripts/install.sh writes it (step 1)" + ("" if portal.startswith("http://127.0.0.1") else
             f"; for the hosted portal, mint it in its checkout: node --env-file=.env.local scripts/api-key.mjs {mint}") + ", one line, chmod 600")
        if key_ok(n) and (KEYS / f"{n}.key").stat().st_mode & 0o077:
            missing.append(f"common-data/keys/{n}.key can be read by others: chmod 600 common-data/keys/{n}.key")
    for n, who, link in OPTIONAL_KEYS:
        if not key_ok(n):
            optional.append(f"common-data/keys/{n}.key: {who}, {link}")
    # 5. the company, in your words
    left = family_missing()
    need(not left, "your family (step 2): " + ", ".join(left) + " -- sh scripts/setup.sh asks for them")
    # 6. search
    need(local_answers("http://127.0.0.1:8888/config"), "the local search (SearXNG) does not answer on 127.0.0.1:8888 (SETUP.md step 4; it starts with the launch agents)")
    # 7. the dashboard
    need((ROOT / "webapp" / ".next" / "BUILD_ID").is_file(), "the dashboard is not built: sh scripts/install.sh builds it (step 1)")
    # 8. always on
    agents = HOME / "Library" / "LaunchAgents"
    installed = sorted(p.name for p in agents.glob("com.ramen-agents.*.plist")) if agents.is_dir() else []
    need(bool(installed), "the launch agents: sh scripts/setup.sh starts the members you choose (step 4)")
    need(local_answers("http://127.0.0.1:3000/"), "the dashboard does not answer on http://127.0.0.1:3000 (it starts with the launch agents)")
    return missing, optional, done


def probe() -> list[str]:
    """One read-only request per key on file: the board's first row, and each provider's list of models."""
    text = (ROOT / "common-data" / "configs" / "web-bots.toml").read_text(encoding="utf-8") if (ROOT / "common-data" / "configs" / "web-bots.toml").is_file() else ""
    out = []
    portal = portal_url()
    for n, _, _ in PORTAL_KEYS:
        if not key_ok(n):
            continue
        req = urllib.request.Request(f"{portal}/v1/boards/leads/rows?since=0&limit=1", headers={"Authorization": f"Bearer {(KEYS / f'{n}.key').read_text(encoding='utf-8').strip()}"})
        try:
            with urllib.request.urlopen(req, timeout=15) as r:  # noqa: S310 - the board named in the configs
                out.append(f"  ok {n}: the board answered ({r.status})")
        except urllib.error.HTTPError as e:
            out.append(f"  !! {n}: the board: {'the key is refused' if e.code in (401, 403) else f'HTTP {e.code}'}")
        except OSError as e:
            out.append(f"  !! {n}: the board at {portal}: no answer, is the dashboard running? ({str(e)[:60]})")
    for n, who, _ in MODEL_KEYS:
        if not key_ok(n):
            continue
        key = (KEYS / f"{n}.key").read_text(encoding="utf-8").strip()
        if n == "gemini":
            req = urllib.request.Request("https://generativelanguage.googleapis.com/v1beta/models", headers={"x-goog-api-key": key})   # never in the URL
        else:
            m = re.search(rf"\[model\.providers\.{re.escape(n)}\][^\[]*?base_url\s*=\s*\"([^\"]+)\"", text, re.S)
            if not m:
                out.append(f"  ?  {n}: no base_url in web-bots.toml to test against")
                continue
            req = urllib.request.Request(m.group(1).rstrip("/") + "/models", headers={"Authorization": f"Bearer {key}"})
        try:
            with urllib.request.urlopen(req, timeout=15) as r:  # noqa: S310 - the provider's own address
                out.append(f"  ok {n}: {who} answered ({r.status})")
        except urllib.error.HTTPError as e:
            hint = "the key is refused" if e.code in (401, 403) or (n == "gemini" and e.code == 400) else f"HTTP {e.code}"
            out.append(f"  !! {n}: {who}: {hint}")
        except OSError as e:
            out.append(f"  !! {n}: {who}: no answer ({str(e)[:60]})")
    return out


def gemini_closed() -> bool:
    """Gemini takes lead data only after the person's own choice in sh scripts/add-key.sh gemini."""
    for f in (ROOT / "common-data" / "configs" / "local.toml", ROOT / "common-data" / "configs" / "web-bots.toml"):
        try:
            found = re.search(r"(?m)^\s*personal_closed\s*=\s*\[([^\]]*)\]", f.read_text(encoding="utf-8"))
        except OSError:
            continue
        if found:
            return '"gemini"' in found.group(1)
    return True


def main(argv: list[str]) -> int:
    missing, optional, done = checks()
    print(f"ramen-agents setup check ({ROOT})")
    if missing:
        print(f"\nStill missing ({len(missing)}):")
        for m in missing:
            print(f"  - {m}")
    else:
        print("\nNothing is missing.")
    if optional:
        print(f"\nOptional ({len(optional)}):")
        for o in optional:
            print(f"  - {o}")
    print(f"\n{done} checks passed.")
    if "--probe" in argv:
        print("\nKeys, tested read-only:")
        for line in probe() or ["  (no keys on file yet)"]:
            print(line)
    return 1 if missing else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
