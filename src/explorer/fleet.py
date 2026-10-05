"""Several bots, one codebase: creating a bot folder, installing its launch agent, listing them.

Layout the owner chose (2026-09-14): the code lives once (this checkout), and each bot is a folder
holding only its `config.toml`, its `persona.md`, and its `workspace/`. launchd runs one job per
bot, labelled `com.rebuzz.bot.<slug>`, through the shared supervisor; the job's environment tells
the supervisor which config and workspace it is for. The launch agents on disk are the registry:
`bot list` reads them, so there is no separate file that can go stale.
"""
from __future__ import annotations

import datetime as dt
import plistlib
import re
import shutil
import subprocess
import time
from pathlib import Path
from typing import Any

CODE_ROOT = Path(__file__).resolve().parents[2]
LABEL_PREFIX = "com.rebuzz.bot."
TEMPLATE = CODE_ROOT / "launchd" / "bot.plist.template"
PERSONAS_DIR = CODE_ROOT / "personas"

# Per-persona starting points. The persona's voice lives in personas/<name>.md; this is the config.
PERSONAS: dict[str, dict[str, Any]] = {
    "explorer": {
        "bio": "An automated exploration agent run by a human. It reads the web out of curiosity and keeps a journal.",
        "seed_interests": ["how everyday things work", "history of the internet", "small independent websites", "unusual animals and plants"],
        "cycle_delay_seconds": 20,
        "notion": False,
    },
    "ceo": {
        "bio": "The CEO of a small company, run as an automated agent by its owner. It keeps up with the company's world and turns what it learns into clear tasks for the team.",
        "seed_interests": ["running a small company", "marketing for small businesses", "hiring and managing a small team", "what customers complain about"],
        "cycle_delay_seconds": 45,
        "notion": True,
    },
    "researcher": {
        "bio": "A text-only research agent run by a human. It reads legitimate onion sites through Tor to understand the onion web, and keeps a journal.",
        "seed_interests": ["why news outlets run onion services", "censorship circumvention", "how onion services work", "privacy tools and their history"],
        "cycle_delay_seconds": 45,
        "notion": False,
        "tor": True,  # browser.backend = "tor", local model only, allowlist from `bot onion-directory`
        "messaging": True,  # [messaging]: a plain-only research channel to a peer bot (handoff.py inbox)
    },
    "package-designer": {
        "bio": "The package designer of a small company, run as an automated agent by its owner. It researches which services sell and what they cost right now, and hands concrete service packages to the company's CEO bot.",
        "seed_interests": ["best-selling software development service packages", "what agencies charge for mvp development", "productized services for startups", "retainer and subscription pricing for dev and marketing services"],
        "cycle_delay_seconds": 45,
        "notion": False,
        "handoff": True,  # [handoff]: packages go to another bot's folder and inbox (handoff.py)
    },
    "scout": {
        "bio": "The scout of a bot fleet, run as an automated agent by its owner. It looks for AI providers with a genuinely free tier and records the good ones for the owner to add.",
        "seed_interests": ["free tier llm inference providers", "openai-compatible api endpoints with no credit card", "which ai providers give free monthly tokens", "how much free usage ai providers give"],
        "cycle_delay_seconds": 60,
        "notion": False,
        "scout": True,  # [scout]: records free-provider finds to a file the owner reviews (scout.py)
        "messaging": True,  # [messaging]: a research channel to a peer bot (handoff.py inbox)
    },
}


def slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:40] or "bot"


def label_for(name: str) -> str:
    return LABEL_PREFIX + slug(name)


def agents_dir() -> Path:
    return Path.home() / "Library" / "LaunchAgents"


def render_plist(label: str, code_root: Path, config_path: Path, workspace: Path, log_dir: Path) -> str:
    text = TEMPLATE.read_text(encoding="utf-8")
    for token, value in {
        "LABEL": label,
        "CODE": str(code_root),
        "CONFIG": str(config_path),
        "WORKSPACE": str(workspace),
        "LOGS": str(log_dir),
        "HOME": str(Path.home()),
    }.items():
        text = text.replace("{{" + token + "}}", value)
    if "{{" in text:
        raise ValueError("plist template has an unreplaced token")
    return text


def shared_config_for(parent: Path, persona: str) -> Path | None:
    """The shared file a new bot in `parent` should extend, when the parent has the common-data layout:
    common-data/configs/web-bots.toml for clear-web bots, common.toml for the Tor researcher (whose model
    must stay local). None for a parent without shared configs."""
    configs = parent / "common-data" / "configs"
    names = ["common.toml"] if PERSONAS[persona].get("tor") else ["web-bots.toml", "common.toml"]
    return next((configs / n for n in names if (configs / n).is_file()), None)


def _inherited(shared: Path | None) -> dict[str, Any]:
    """Flat "section.key" values a shared config (and whatever it extends) already provides."""
    if shared is None:
        return {}
    from .config import _read_with_extends

    return {f"{sec}.{k}": v for sec, table in _read_with_extends(shared).items() if isinstance(table, dict) for k, v in table.items()}


def write_bot_config(folder: Path, name: str, persona: str, port: int, code_root: Path = CODE_ROOT) -> Path:
    """A minimal config.toml for a new bot: only what differs from the defaults and the shared configs."""
    from .common.keys import key_file

    spec = PERSONAS[persona]
    tor = bool(spec.get("tor"))
    shared = shared_config_for(folder.parent, persona)
    have = _inherited(shared)

    def line(key: str, value: str, toml: str) -> str:
        """`key = toml` unless the shared config already sets this exact value."""
        return "" if have.get(key) == value else f"{key.split('.', 1)[1]} = {toml}\n"

    interests = ", ".join(f'"{s}"' for s in spec["seed_interests"])
    scout_block = (
        "\n[scout]\n"
        "# The scout's output skill: free AI providers it finds go to a file the owner reviews.\n"
        "enabled = true\n"
        if spec.get("scout")
        else ""
    )
    notion_block = (
        "\n[notion]\n"
        "# The CEO's output skill. Create an internal integration at notion.so/my-integrations, share your\n"
        "# task database with it, paste the database id below, put the token in the key file, then set\n"
        "# enabled = true. `bot check` verifies all of it.\n"
        "enabled = false\n"
        'database_id = ""\n'
        f'api_key_file = "{key_file("notion")}"\n'
        if spec["notion"]
        else ""
    )
    tor_note = (
        "# Before the first run: `bot --config <this file> onion-directory` stages the site list, you review it,\n"
        "# `... onion-directory --accept` writes the allowlist, then `bot check`.\n"
        if tor
        else ""
    )
    # The Tor bot's model is always written here: page text read over Tor never goes to a cloud provider,
    # whatever a shared file says.
    model = (
        "# Local only: pages read over Tor stay on this Mac instead of going to a cloud provider.\nprovider = \"ollama\"\n"
        if tor
        else ("" if "model.provider" in have else 'provider = "ollama"\n')  # web bots take the shared model chain
    )
    tor_browser = 'backend = "tor"\ntor_proxy = "socks5h://127.0.0.1:9050"\n' if tor else ""
    tor_policy = (
        'allowlist_file = "workspace/allowed_hosts.txt"\n'
        "# Onion circuits are slow and these sites are run by small teams; read gently.\n"
        "pages_per_hour = 30\n"
        "per_domain_delay_seconds = 20\n"
        if tor
        else ""
    )
    fake_web = str(code_root / "workspace" / "fake_web")
    denylist = "" if "policy.denylist_file" in have else 'denylist_file = "workspace/denylist.txt"\n'

    def section(title: str, body: str) -> str:
        return f"\n[{title}]\n{body}" if body.strip() else ""

    if shared is not None:
        rel = Path("..") / shared.relative_to(folder.parent)
        header = (
            f"# {name}: a bot made by `bot new` on {dt.date.today().isoformat()} with the {persona} persona.\n"
            f"# Shared settings come from {rel.as_posix()}; anything set below wins over them. The rest keeps\n"
            f"# the defaults in {code_root / 'config.example.toml'}.\n"
            f"{tor_note}"
            f'extends = "{rel.as_posix()}"\n'
        )
    else:
        header = (
            f"# {name}: a bot made by `bot new` on {dt.date.today().isoformat()} with the {persona} persona.\n"
            f"# Everything not set here keeps the defaults in {code_root / 'config.example.toml'}.\n"
            f"{tor_note}"
        )
    text = (
        header
        + section(
            "agent",
            f'name = "{name}"\n'
            f'bio = "{spec["bio"]}"\n'
            + line("agent.mode", "web", '"web"')
            + f"cycle_delay_seconds = {spec['cycle_delay_seconds']}\n"
            + line("agent.persona_file", "persona.md", '"persona.md"')
            + f"seed_interests = [{interests}]\n",
        )
        + section("model", model)
        + section("browser", tor_browser + line("browser.fake_web_dir", fake_web, f'"{fake_web}"'))
        + section("policy", denylist + tor_policy)
        + section("dashboard", f"port = {port}\n")
        + section("quiet", line("quiet.enabled", True, "true"))  # type: ignore[arg-type]
        + notion_block
        + scout_block
        + (
            "\n[handoff]\n"
            "# Packages go to the bot named here: a Markdown file in its folder (files_dir) and a message in its\n"
            "# workspace/inbox/. Set to_name and to_folder (absolute), then enabled = true. `bot check` shows it.\n"
            "enabled = false\n"
            'to_name = ""\n'
            'to_folder = ""\n'
            'files_dir = "raw/packages"\n'
            if spec.get("handoff")
            else ""
        )
        + (
            "\n[messaging]\n"
            "# A research channel to one or more peer bots: a `message` action drops a short note into a\n"
            "# peer's workspace/inbox/, and their messages land in yours. Add a [[messaging.peers]] table\n"
            "# (name + absolute folder) for each colleague, then enabled = true. `bot check` shows it.\n"
            "enabled = false\n"
            + (
                # A local-only (Tor) bot must never carry page text to a cloud-model peer: keep it plain and short.
                "plain_only = true\n"
                "max_chars = 300\n"
                if tor
                else ""
            )
            + "\n# [[messaging.peers]]\n"
            '# name = "Scout"\n'
            '# folder = "/absolute/path/to/bots/scout"\n'
            if spec.get("messaging")
            else ""
        )
    )
    path = folder / "config.toml"
    path.write_text(text, encoding="utf-8")
    return path


def new_bot(name: str, parent: Path, persona: str, port: int, code_root: Path = CODE_ROOT) -> Path:
    """Create <parent>/<slug>/ with config.toml, persona.md and a workspace. The denylist is copied into the
    workspace only when no shared config provides one (common-data/denylist.txt in the shared layout)."""
    if persona not in PERSONAS:
        raise ValueError(f"unknown persona {persona!r}; choose one of: {', '.join(PERSONAS)}")
    folder = parent / slug(name)
    if folder.exists() and any(folder.iterdir()):
        raise FileExistsError(f"{folder} already exists and is not empty")
    (folder / "workspace").mkdir(parents=True, exist_ok=True)
    write_bot_config(folder, name, persona, port, code_root)
    persona_src = PERSONAS_DIR / f"{persona}.md"
    (folder / "persona.md").write_text(persona_src.read_text(encoding="utf-8"), encoding="utf-8")
    if "policy.denylist_file" not in _inherited(shared_config_for(parent, persona)):
        shutil.copy(code_root / "workspace" / "denylist.txt", folder / "workspace" / "denylist.txt")
    return folder


def _launchctl(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["launchctl", *args], capture_output=True, text=True, check=False)


def _uid() -> str:
    import os

    return str(os.getuid())


def install(label: str, config_path: Path, workspace: Path, log_dir: Path, code_root: Path = CODE_ROOT) -> Path:
    """Write the launch agent and (re)load it. Retries bootstrap: a just-removed job takes a moment."""
    agents_dir().mkdir(parents=True, exist_ok=True)
    log_dir.mkdir(parents=True, exist_ok=True)
    plist_path = agents_dir() / f"{label}.plist"
    plist_path.write_text(render_plist(label, code_root, config_path, workspace, log_dir), encoding="utf-8")
    _launchctl("bootout", f"gui/{_uid()}/{label}")
    last = ""
    for _ in range(6):
        result = _launchctl("bootstrap", f"gui/{_uid()}", str(plist_path))
        if result.returncode == 0:
            return plist_path
        last = (result.stderr or result.stdout).strip()
        time.sleep(2)
    raise RuntimeError(f"launchctl bootstrap failed: {last}")


def uninstall(label: str) -> bool:
    _launchctl("bootout", f"gui/{_uid()}/{label}")
    plist_path = agents_dir() / f"{label}.plist"
    if plist_path.exists():
        plist_path.unlink()
        return True
    return False


def job_state(label: str) -> str:
    out = _launchctl("print", f"gui/{_uid()}/{label}").stdout
    match = re.search(r"^\s*state = (\S+)", out, re.MULTILINE)
    return match.group(1) if match else "not loaded"


def installed_bots(folder: Path | None = None) -> list[dict[str, Any]]:
    """Every bot launch agent on disk, with the config and workspace its job points at."""
    folder = folder or agents_dir()
    bots: list[dict[str, Any]] = []
    for plist_path in sorted(folder.glob(f"{LABEL_PREFIX}*.plist")):
        try:
            data = plistlib.loads(plist_path.read_bytes())
        except (plistlib.InvalidFileException, ValueError):
            continue
        env = data.get("EnvironmentVariables") or {}
        bots.append(
            {
                "label": str(data.get("Label", plist_path.stem)),
                "config": env.get("EXPLORER_CONFIG"),
                "workspace": env.get("EXPLORER_WORKSPACE"),
                "plist": str(plist_path),
            }
        )
    return bots
