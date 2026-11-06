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
    ("mistral", "Mistral (activate the free plan in the console first)", "https://console.mistral.ai"),
    ("openrouter", "OpenRouter (free models only)", "https://openrouter.ai/keys"),
    ("ollama-cloud", "Ollama Cloud", "https://ollama.com/settings/keys"),
    ("speka", "Speka", "https://speka.me"),
]
OPTIONAL_KEYS = [
    ("quickemailverification", "QuickEmailVerification (Lead Gen checks an email before listing it)", "https://quickemailverification.com"),
    ("sniffmail", "Sniffmail (the backup email check)", "https://sniffmail.io"),
]
BOARD_FILES = ["the-ceo/config.toml", "lead-gen/config.toml"]
FILL_DIRS = ["the-ceo", "lead-gen", "package-designer", "scout", "research-analyst", "validator/config.toml", "common-data"]


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


def fill_me() -> list[tuple[str, int]]:
    """Files with FILL-ME markers left, and how many."""
    out = []
    for d in FILL_DIRS:
        p = ROOT / d
        files = [p] if p.is_file() else [f for f in p.rglob("*") if f.suffix in {".md", ".toml", ".json"}] if p.is_dir() else []
        for f in sorted(files):
            if "keys" in f.parts or "workspace" in f.parts:
                continue
            n = f.read_text(encoding="utf-8", errors="ignore").count("FILL-ME")
            if n:
                out.append((str(f.relative_to(ROOT)), n))
    return out


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
    need(ENGINE.is_dir(), f"the engine at {ENGINE}: git clone -b engine -o starter https://github.com/reBuzz-llc/ramen-agents {ENGINE} (setup-queue step 1)")
    need((ENGINE / ".venv" / "bin" / "bot").exists(), f"the engine's Python environment: cd {ENGINE} && python3 -m venv .venv && .venv/bin/pip install -e \".[dev]\" (Python 3.11+)")
    caches = [HOME / "Library" / "Caches" / "ms-playwright", HOME / ".cache" / "ms-playwright"]
    browser = any(c.is_dir() and any(x.name.startswith(("chromium-", "chromium_headless_shell-")) for x in c.iterdir()) for c in caches)
    need(browser, f"the agents' browser: {ENGINE}/.venv/bin/playwright install chromium")
    # 2. this repository
    need((HOME / ".config" / "explorer").is_symlink(), "the folders and the state link: sh scripts/setup.sh (setup-queue step 2)")
    # 3. model keys
    have = [n for n, _, _ in MODEL_KEYS if key_ok(n)]
    if not have:
        missing.append("at least one model key, one line in common-data/keys/<name>.key (chmod 600): " + "; ".join(f"{n}.key from {link}" for n, _, link in MODEL_KEYS[:3]) + " (more in setup-queue step 3)")
    else:
        done += 1
        for n, who, link in MODEL_KEYS:
            if n not in have:
                optional.append(f"common-data/keys/{n}.key: {who}, {link} (another fallback)")
    for n in have + [k for k, _, _ in OPTIONAL_KEYS if key_ok(k)] + (["notion"] if key_ok("notion") else []):
        mode = (KEYS / f"{n}.key").stat().st_mode & 0o077
        if mode:
            missing.append(f"common-data/keys/{n}.key can be read by others: chmod 600 common-data/keys/{n}.key")
    # 4. the boards
    need(key_ok("notion"), "common-data/keys/notion.key: a Notion internal integration's secret, https://www.notion.so/my-integrations (setup-queue step 4)")
    for f in BOARD_FILES:
        p = ROOT / f
        off = p.is_file() and re.search(r"^enabled = false .*FILL-ME", p.read_text(encoding="utf-8"), re.M)
        need(not off, f"a board in {f} is still off: paste its id and set enabled = true (SETUP.md step 6)")
    for n, who, link in OPTIONAL_KEYS:
        if not key_ok(n):
            optional.append(f"common-data/keys/{n}.key: {who}, {link}")
    # 5. the company, in your words
    left = fill_me()
    need(not left, "FILL-ME markers to fill (setup-queue step 5): " + ", ".join(f"{f} ({n})" for f, n in left[:8]) + (f" and {len(left) - 8} more files" if len(left) > 8 else ""))
    # 6. search and the local model
    need(local_answers("http://127.0.0.1:8888/config"), "the local search (SearXNG) does not answer on 127.0.0.1:8888 (SETUP.md step 4; it starts with the launch agents)")
    if not local_answers("http://127.0.0.1:11434/api/tags"):
        optional.append("the local model (Ollama) on 127.0.0.1:11434, the last resort when no provider answers (SETUP.md step 3)")
    # 7. the dashboard
    need((ROOT / "webapp" / ".next" / "BUILD_ID").is_file(), "the dashboard is not built: Node.js 20+, then cd webapp && npm ci && npm run build (setup-queue step 7)")
    # 8. always on
    agents = HOME / "Library" / "LaunchAgents"
    installed = sorted(p.name for p in agents.glob("com.ramen-agents.*.plist")) if agents.is_dir() else []
    need(bool(installed), "the launch agents: sh scripts/install-launchd.sh (setup-queue step 8)")
    need(local_answers("http://127.0.0.1:3000/"), "the dashboard does not answer on http://127.0.0.1:3000 (it starts with the launch agents)")
    return missing, optional, done


def probe() -> list[str]:
    """One read-only request per key on file: the provider's list of models (Notion: who the integration is)."""
    text = (ROOT / "common-data" / "configs" / "web-bots.toml").read_text(encoding="utf-8") if (ROOT / "common-data" / "configs" / "web-bots.toml").is_file() else ""
    out = []
    for n, who, _ in MODEL_KEYS + [("notion", "Notion", "")]:
        if not key_ok(n):
            continue
        key = (KEYS / f"{n}.key").read_text(encoding="utf-8").strip()
        if n == "gemini":
            req = urllib.request.Request(f"https://generativelanguage.googleapis.com/v1beta/models?key={key}")
        elif n == "notion":
            req = urllib.request.Request("https://api.notion.com/v1/users/me", headers={"Authorization": f"Bearer {key}", "Notion-Version": "2022-06-28"})
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
