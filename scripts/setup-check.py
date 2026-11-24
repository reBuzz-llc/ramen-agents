#!/usr/bin/env python3
"""What is still missing before ramen-agents can run, in plain lines (docs/setup-queue.md is the list to work through).

    python3 scripts/setup-check.py            # what is missing and where you get it; exit 0 when nothing is
    python3 scripts/setup-check.py --probe    # also test each key with one read-only request to its provider
    python3 scripts/setup-check.py --key-info <name>   # (for add-key.sh) one provider's line from common-data/providers.json
    python3 scripts/setup-check.py --test-key <name>   # (for add-key.sh) test that one saved key with its free read

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
import urllib.parse
import urllib.request
from pathlib import Path

# this repository (the fleet branch, normally ~/bots); RAMEN_ROOT when update.sh runs the new version's copy against it
ROOT = Path(os.environ.get("RAMEN_ROOT") or Path(__file__).resolve().parent.parent)
HOME = Path.home()
ENGINE = Path(os.environ.get("RAMEN_ENGINE", HOME / "Projects" / "bot"))
KEYS = ROOT / "common-data" / "keys"

# Every provider and its key comes from common-data/providers.json, the one list (the Providers page and add-key.sh read it
# too). Model keys: the chain's, in its order; at least one is needed. Optional: the ones marked usable, free and added with
# add-key.sh, outside the chain's models; a provider marked unusable or set aside, or not judged yet, is never suggested.
# The steps named in the lines below are AGENTS.md's: 1 install, 2 a model key, 3 the answers and setup, 4 this check.
def load_providers() -> list[dict]:
    try:
        return [p for p in json.loads((ROOT / "common-data" / "providers.json").read_text(encoding="utf-8"))["providers"] if isinstance(p, dict) and p.get("name")]
    except (OSError, ValueError, KeyError, TypeError):
        return []


PROVIDERS = load_providers()


def _describe(p: dict) -> str:
    note = (p.get("mark_note") or "").strip().rstrip(".")
    return f"{p.get('who') or p['name']} ({note})" if note else (p.get("who") or p["name"])


MODEL_KEYS = [(p["name"], p.get("who") or p["name"], p.get("where") or "") for p in PROVIDERS if p.get("use") == "model" and p.get("status") == "chain"]
def _has_table(name: str) -> bool:
    """A model provider the config can call: web-bots.toml has its [model.providers.<name>] table."""
    try:
        return f"[model.providers.{name}]" in (ROOT / "common-data" / "configs" / "web-bots.toml").read_text(encoding="utf-8")
    except OSError:
        return False


def _optional(p: dict) -> bool:
    if p.get("mark") != "usable" or p.get("free") is not True or not p.get("add_key") or p.get("status") == "removed":
        return False
    if p.get("use") == "model":   # outside the chain: only one the config can call, so a key is never saved for nothing
        return p.get("status") != "chain" and _has_table(p["name"])
    return True


OPTIONAL_KEYS = [(p["name"], _describe(p) + ("; add it to provider_chain in common-data/configs/local.toml to use it" if p.get("use") == "model" else ""),
                  p.get("where") or "") for p in PROVIDERS if _optional(p)]
FIRST_KEYS = ("zai", "groq", "openrouter")    # the FAQ's first keys; Gemini asks first (sh scripts/add-key.sh gemini)
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
    buyers and [target] market. Written by sh scripts/setup.sh (step 3) or the dashboard's first-run page."""
    import tomllib
    f = ROOT / "common-data" / "local" / "family.toml"
    try:
        data = tomllib.loads(f.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return ["common-data/local/family.toml (step 3: sh scripts/setup.sh, or the dashboard's first-run page)"]
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
        first = [k for k in MODEL_KEYS if k[0] in FIRST_KEYS]
        missing.append("at least one model key (step 2): Z.ai, Groq or OpenRouter first, sh scripts/add-key.sh zai (or groq, openrouter): "
                       + "; ".join(f"{n}.key from {link}" for n, _, link in first) + ". Gemini asks first: sh scripts/add-key.sh gemini")
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
    need(not left, "your family (step 3): " + ", ".join(left) + " -- sh scripts/setup.sh asks for them")
    # 6. search
    need(local_answers("http://127.0.0.1:8888/config"), "the local search (SearXNG) does not answer on 127.0.0.1:8888 (it starts with the launch agents, step 3: sh scripts/setup.sh)")
    # 7. the dashboard
    need((ROOT / "webapp" / ".next" / "BUILD_ID").is_file(), "the dashboard is not built: sh scripts/install.sh builds it (step 1)")
    # 8. always on
    agents = HOME / "Library" / "LaunchAgents"
    installed = sorted(p.name for p in agents.glob("com.ramen-agents.*.plist")) if agents.is_dir() else []
    need(bool(installed), "the launch agents: sh scripts/setup.sh starts the members you choose (step 3)")
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
    for n, _, _ in MODEL_KEYS + OPTIONAL_KEYS:
        if key_ok(n):
            out.append(test_key_line(n))
    return out


def entry(name: str) -> dict | None:
    return next((p for p in PROVIDERS if p.get("name") == name), None)


def test_request(p: dict, key: str) -> tuple[str, dict] | None:
    """The free read that tests a key (a models list or the account), never a completion. The key goes in a header unless
    the provider takes it only as a query parameter. None: this provider has no free read."""
    t = p.get("test") or {}
    url, auth = t.get("url") or "", t.get("auth") or ""
    if t.get("kind") != "models" or not url.startswith("https://"):
        return None
    if auth == "bearer":
        return url, {"Authorization": f"Bearer {key}"}
    if auth == "x-api-key":
        return url, {"x-api-key": key}
    m = re.fullmatch(r"header:([A-Za-z0-9-]{1,40})", auth)
    if m:
        return url, {m.group(1): key}
    m = re.fullmatch(r"query:([A-Za-z0-9_]{1,40})", auth)
    if m:
        sep = "&" if "?" in url else "?"
        return f"{url}{sep}{urllib.parse.urlencode({m.group(1): key})}", {}
    return None


def test_key_line(name: str) -> str:
    """One line: "  ok <name>: ..." (a 2xx), "  !! <name>: ..." (refused, no quota, no answer) or "  ?  <name>: saved, not
    tested". The key and the address it was sent to are never printed."""
    p = entry(name)
    if not p or not key_ok(name):
        return f"  ?  {name}: no key on file"
    who = p.get("who") or name
    req = test_request(p, (KEYS / f"{name}.key").read_text(encoding="utf-8").strip())
    if not req:
        return f"  ?  {name}: saved, not tested ({who} has no free read to test a key with)"
    try:
        with urllib.request.urlopen(urllib.request.Request(req[0], headers={**req[1], "User-Agent": "ramen-agents setup-check"}), timeout=15) as r:  # noqa: S310
            return f"  ok {name}: {who} answered a free read ({r.status})"
    except urllib.error.HTTPError as e:
        if e.code in (401, 403) or (name == "gemini" and e.code == 400):
            return f"  !! {name}: {who}: the key is refused ({e.code})"
        if e.code in (402, 429):
            return f"  !! {name}: {who}: no quota or credit right now ({e.code})"
        return f"  ?  {name}: saved, not tested ({who} answered {e.code})"
    except OSError as e:
        return f"  ?  {name}: saved, not tested (no answer from {who}: {type(e).__name__})"


SEP = "\x1f"   # add-key.sh splits --key-info on this (a tab would merge empty fields)


def key_info(name: str) -> str | None:
    """One provider's fields for add-key.sh, in a fixed order; None when it is not on the list or takes no key."""
    p = entry(name)
    if not p or not p.get("add_key"):
        return None
    hint = ""
    if p.get("use") == "model" and p.get("status") != "chain":
        web = (ROOT / "common-data" / "configs" / "web-bots.toml")
        has_table = web.is_file() and f"[model.providers.{name}]" in web.read_text(encoding="utf-8")
        hint = (f"The key does nothing until you add {name} to provider_chain in common-data/configs/local.toml." if has_table
                else f"No member uses {name} yet: it needs a [model.providers.{name}] table first (docs/free-tiers.md, Adding a provider).")
    fields = [p.get("who") or name, p.get("where") or "", "yes" if p.get("free") else "no", p.get("card") or "", p.get("mark") or "",
              p.get("mark_by") or "", p.get("mark_date") or "", p.get("mark_note") or "", "yes" if test_request(p, "x") else "no", hint]
    return SEP.join(" ".join(str(f).split()) for f in fields)


def names_with_keys() -> list[str]:
    return [p["name"] for p in PROVIDERS if p.get("add_key")]


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
    if argv[:1] == ["--key-info"] and len(argv) == 2:
        info = key_info(argv[1])
        if info is None:
            print("known: " + ", ".join(names_with_keys()))
            return 2
        print(info)
        return 0
    if argv == ["--key-names"]:
        print(", ".join(names_with_keys()))
        return 0
    if argv[:1] == ["--test-key"] and len(argv) == 2:
        print(test_key_line(argv[1]).strip())
        return 0
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
