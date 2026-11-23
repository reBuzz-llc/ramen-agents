"""Command line entry point.

bot run | status | tail | pause | resume | stop | init | check | journal | dashboard | tasks
bot new NAME [--fake] | demo | install | uninstall | list        (several bots, one codebase; see fleet.py)
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import logging
import os
import signal
import sys
from pathlib import Path
from typing import Any

from . import __version__
from .browser import FakeBrowser, PlaywrightBrowser
from .chat_partner import OllamaChatPartner
from .config import Config, PackagesConfig, TasksConfig, load_config, validate
from .control import PidLock, pause_requested, stop_requested
from .controller import Controller
from .db import Database
from .heartbeat import Heartbeat
from .logging_config import setup_logging
from .memory import Memory
from .common.fallback import CallLedger, FallbackModel, build_model
from .model import (
    GeminiModel,
    OllamaModel,
    OpenAICompatModel,
    load_api_key,
    load_provider_key,
    load_gemini_key,
    provider_config,
)
from .policy import Allowlist, Denylist, Policy, RobotsCache
from .presence import QuietDetector


def build_boards(cfg: Config, logger: logging.Logger) -> tuple[Any, Any]:
    """(the Leads board client, the tasks-and-packages board client), each None when its skills are off or no agents'
    key was found. One board for both: [leads] portal_url (the dashboard's local board by default) and portal_key_file
    (the starter has no Notion)."""
    wants_leads = cfg.leads.enabled
    wants_board = cfg.tasks.enabled or cfg.packages.enabled
    url = cfg.leads.portal_url.strip()
    if not (wants_leads or wants_board):
        return None, None
    if not url:
        logger.warning("leads.portal_url is empty; leads, tasks and packages are off")
        return None, None
    token = load_api_key("PORTAL_ENGINE_KEY", cfg.leads.portal_key_file)
    if not token:
        logger.warning("no agents' key for the board (%s); leads, tasks and packages are off", cfg.leads.portal_key_file)
        return None, None
    from . import board_down
    from .portal_store import PortalBoard, PortalLeadStore, shared_cache_path

    flag = board_down.flag_path()
    leads = PortalLeadStore(url, token, cfg.agent.name, logger, cache=shared_cache_path(), down_flag=flag) if wants_leads else None
    board = PortalBoard(url, token, cfg.agent.name, logger, down_flag=flag, default_project=cfg.tasks.default_project) if wants_board else None
    return leads, board


def build_controller(cfg: Config, logger: logging.Logger) -> Controller:
    db = Database(cfg.db_path)
    memory = Memory(db, cfg.workspace)
    model = build_model(cfg.model, logger, bot_name=cfg.agent.name)
    policy: Policy | None = None
    searcher = None
    if cfg.agent.mode == "web" and cfg.browser.backend == "light":
        from .light_browser import LightBrowser

        def chromium() -> PlaywrightBrowser:
            return PlaywrightBrowser(
                cfg.path(cfg.browser.user_data_dir),
                cfg.user_agent,
                headless=cfg.browser.headless,
                max_links=cfg.browser.max_links,
                search_url=cfg.browser.search_url,
                navigation_timeout_seconds=cfg.browser.navigation_timeout_seconds,
            )

        browser = LightBrowser(
            cfg.user_agent,
            chromium,
            max_links=cfg.browser.max_links,
            timeout_seconds=cfg.browser.navigation_timeout_seconds,
            max_bytes=cfg.browser.max_page_bytes,
            allow_url=lambda url: policy.static_reason(url, "web") if policy is not None else "policy not ready",
        )
        robots = RobotsCache(cfg.user_agent, fetch=browser.fetch_text) if cfg.policy.respect_robots else None
    elif cfg.agent.mode == "web":
        browser = PlaywrightBrowser(
            cfg.path(cfg.browser.user_data_dir),
            cfg.user_agent,
            headless=cfg.browser.headless,
            max_links=cfg.browser.max_links,
            search_url=cfg.browser.search_url,
            navigation_timeout_seconds=cfg.browser.navigation_timeout_seconds,
        )
        robots = RobotsCache(cfg.user_agent, fetch=browser.fetch_text) if cfg.policy.respect_robots else None
    else:
        browser = FakeBrowser(cfg.path(cfg.browser.fake_web_dir), max_links=cfg.browser.max_links)
        robots = None
    denylist = Denylist.load(cfg.path(cfg.policy.denylist_file))
    # A configured allowlist that is missing on disk allows nothing, never everything.
    allowlist = Allowlist.load(cfg.path(cfg.policy.allowlist_file)) if cfg.policy.allowlist_file.strip() else None
    developer_root = cfg.path(cfg.developer.root)
    leads_board, board = build_boards(cfg, logger)
    policy = Policy(
        cfg.policy,
        denylist,
        robots,
        chat_partner=cfg.chat_partner,
        developer=cfg.developer,
        developer_root=developer_root,
        # The policy only lets `task` and `publish_package` exist when the board client is ready, not merely enabled.
        tasks=cfg.tasks if board is not None else TasksConfig(),
        packages=cfg.packages if board is not None else PackagesConfig(),
        allowlist=allowlist,
        handoff=cfg.handoff,
        scout=cfg.scout,
        messaging=cfg.messaging,
        self_goals=cfg.agent.self_goals,
        propose_teammates=cfg.agent.propose_teammates,
        leads=cfg.leads,
    )
    heartbeat = Heartbeat(db, cfg.watchdog)
    chat_partner = OllamaChatPartner(cfg.chat_partner, logger) if cfg.chat_partner.enabled else None
    developer = None
    if cfg.developer.enabled:
        from .developer import Developer

        developer = Developer(
            cfg.developer, developer_root, repo_root=cfg.root, logger=logger, output_limit=cfg.browser.page_text_limit
        )
    quiet = QuietDetector(cfg.quiet) if cfg.quiet.enabled else None
    transcripts = None
    if cfg.agent.mode == "web" and cfg.browser.video_transcripts:
        from .transcript import YouTubeTranscripts

        transcripts = YouTubeTranscripts(cfg.browser.video_transcript_languages, logger=logger)
    return Controller(
        cfg, memory, model, browser, policy, heartbeat, logger,
        chat_partner=chat_partner, developer=developer, quiet=quiet, board=board,
        transcripts=transcripts,
        searcher=searcher,
        leads_board=leads_board,
    )


def config_path_for(args: argparse.Namespace) -> Path:
    """The config file this invocation is about, resolved the same way load_config finds it."""
    raw = args.config or os.environ.get("EXPLORER_CONFIG") or str(Path.cwd() / "config.toml")
    return Path(raw).expanduser().resolve()


# ---- commands ----------------------------------------------------------------

def cmd_run(cfg: Config, args: argparse.Namespace) -> int:
    if args.mode:
        cfg.agent.mode = args.mode
    if args.model:
        cfg.model.provider = args.model
    if args.headed:
        cfg.browser.headless = False
    if args.delay is not None:
        cfg.agent.cycle_delay_seconds = args.delay
    validate(cfg)
    cfg.ensure_dirs()
    logger = setup_logging(cfg.log_path, to_stderr=not args.quiet)
    if stop_requested(cfg):
        print(f"STOP file present at {cfg.stop_file}. Run 'bot resume' to clear it.", file=sys.stderr)
        return 2
    lock = PidLock(cfg.pid_file)
    if not lock.acquire():
        print(f"another explorer holds {cfg.pid_file}", file=sys.stderr)
        return 3
    try:
        controller = build_controller(cfg, logger)
        signal.signal(signal.SIGTERM, lambda *_: controller.request_stop())
        chain = " -> ".join([*cfg.model.provider_chain, f"{cfg.model.fallback_provider}/{cfg.model.name}"])
        model_desc = chain if cfg.model.provider_chain else f"{cfg.model.provider}/{cfg.model.name}"
        logger.info(
            "explorer %s starting: mode=%s model=%s cycles=%s",
            __version__, cfg.agent.mode, model_desc, args.cycles or "unlimited",
        )
        return controller.run(max_cycles=args.cycles)
    finally:
        lock.release()


def cmd_status(cfg: Config, args: argparse.Namespace) -> int:
    if not cfg.db_path.exists():
        print("no database yet; run 'bot init' or 'bot run'")
        return 1
    db = Database(cfg.db_path)
    memory = Memory(db, cfg.workspace)
    running = PidLock.is_locked(cfg.pid_file)
    pid = PidLock.read_pid(cfg.pid_file)
    lines = [f"process: {'running (pid %s)' % pid if running else 'not running'}"]
    flags = [name for name, on in (("PAUSE", pause_requested(cfg)), ("STOP", stop_requested(cfg))) if on]
    lines.append("flags: " + (", ".join(flags) if flags else "none"))
    hb = Heartbeat.latest(db)
    if hb is None:
        lines.append("heartbeat: none yet")
    else:
        age = (dt.datetime.now() - dt.datetime.fromisoformat(hb["ts"])).total_seconds()
        lines.append(f"heartbeat: {hb['status']} at {hb['ts']} ({int(age)}s ago), cycle {hb['cycle']}")
        if running and age > 3 * cfg.watchdog.heartbeat_interval_seconds + 60:
            lines.append("warning: heartbeat is stale while the process is alive; it may be hung")
        lines.append(f"current page: {hb['current_url'] or '-'}")
        lines.append(f"current question: {hb['current_question'] or '-'}")
        lines.append(f"last action: {hb['last_action'] or '-'}")
        lines.append(f"model failures: {hb['model_failures']}")
    counts = memory.counts()
    lines.append("counts: " + ", ".join(f"{k}={v}" for k, v in counts.items()))
    ep = memory.current_episode()
    lines.append(f"open episode: #{ep['id']} with {ep['actions']} actions" if ep else "open episode: none")
    top = memory.domain_counts(5)
    if top:
        lines.append("top domains: " + ", ".join(f"{d} ({n})" for d, n in top))
    lines.append(f"journal: {memory.journal_path()}")
    print("\n".join(lines))
    return 0


def cmd_tail(cfg: Config, args: argparse.Namespace) -> int:
    path = cfg.log_path
    if not path.exists():
        print("no log yet")
        return 1
    lines = path.read_text(encoding="utf-8", errors="replace").splitlines()[-args.n :]
    for line in lines:
        try:
            entry = json.loads(line)
        except json.JSONDecodeError:
            print(line)
            continue
        kind = entry.get("kind") or entry.get("level", "")
        fields = {k: v for k, v in entry.items() if k not in ("ts", "level", "msg", "kind")}
        if fields:
            body = " ".join(f"{k}={str(v)[:110]}" for k, v in fields.items())
        else:
            body = entry.get("msg", "")
        print(f"{entry.get('ts', '')} {kind:<14} {body}")
    return 0


def cmd_pause(cfg: Config, args: argparse.Namespace) -> int:
    cfg.pause_file.parent.mkdir(parents=True, exist_ok=True)
    cfg.pause_file.touch()
    print(f"paused: {cfg.pause_file} exists; the agent finishes its current action and waits")
    return 0


def cmd_resume(cfg: Config, args: argparse.Namespace) -> int:
    removed = []
    for path in (cfg.pause_file, cfg.stop_file):
        if path.exists():
            path.unlink()
            removed.append(path.name)
    print("cleared: " + (", ".join(removed) if removed else "nothing to clear"))
    return 0


def cmd_stop(cfg: Config, args: argparse.Namespace) -> int:
    cfg.stop_file.parent.mkdir(parents=True, exist_ok=True)
    cfg.stop_file.touch()
    print(f"stop requested: {cfg.stop_file} exists; the agent exits within a second and launchd will not restart it")
    return 0


def cmd_init(cfg: Config, args: argparse.Namespace) -> int:
    cfg.ensure_dirs()
    db = Database(cfg.db_path)
    memory = Memory(db, cfg.workspace)
    from .target import Target

    target = Target.for_root(cfg.root)
    added = memory.seed_interests([target.fill(t) for t in cfg.agent.seed_interests])
    memory.write_markdown_mirrors()
    print(f"workspace: {cfg.workspace}")
    print(f"database: {cfg.db_path}")
    print(f"seeded interests: {added}")
    return 0


def cmd_check(cfg: Config, args: argparse.Namespace) -> int:
    ok = True

    def report(good: bool, text: str) -> None:
        nonlocal ok
        ok = ok and good
        print(("ok    " if good else "FAIL  ") + text)

    if cfg.model.provider == "remote" and cfg.model.provider_chain:
        first = cfg.model.provider_chain[0]
        if first in cfg.model.providers:
            first = f"{first}/{cfg.model.providers[first]['model']}"
        else:
            first = f"gemini/{cfg.model.gemini_model}"
        more = f" +{len(cfg.model.provider_chain) - 1} more" if len(cfg.model.provider_chain) > 1 else ""
        model_label = f"{first}{more} (fallback {cfg.model.fallback_provider}/{cfg.model.name})"
    elif cfg.model.provider == "gemini":
        model_label = f"gemini/{cfg.model.gemini_model} (fallback {cfg.model.fallback_provider}/{cfg.model.name})"
    else:
        model_label = f"{cfg.model.provider}/{cfg.model.name}"
    report(True, f"config: mode={cfg.agent.mode} model={model_label} root={cfg.root}")
    try:
        Database(":memory:")
        report(True, "sqlite with FTS5")
    except Exception as exc:  # noqa: BLE001
        report(False, f"sqlite FTS5: {exc}")
    try:
        cfg.ensure_dirs()
        probe = cfg.workspace / ".write_test"
        probe.write_text("ok", encoding="utf-8")
        probe.unlink()
        report(True, f"workspace writable: {cfg.workspace}")
    except Exception as exc:  # noqa: BLE001
        report(False, f"workspace: {exc}")
    denylist = Denylist.load(cfg.path(cfg.policy.denylist_file))
    report(len(denylist) > 0, f"denylist entries: {len(denylist)} ({cfg.path(cfg.policy.denylist_file)})")
    if cfg.agent.mode == "fake" or args.all:
        pages = list(cfg.path(cfg.browser.fake_web_dir).glob("*.html"))
        report(len(pages) > 0, f"fake web pages: {len(pages)}")
    remote = list(cfg.model.provider_chain) or (["gemini"] if cfg.model.provider == "gemini" else [])
    if cfg.model.provider == "ollama" or cfg.model.fallback_provider == "ollama" or args.all:
        good, text = OllamaModel(cfg.model).available()
        report(good, text + (" (the local fallback)" if remote else ""))
    if remote:
        print("note  remote providers, in order: " + ", ".join(remote))
    answering = 0      # one provider that can take a member's call is enough: the chain skips the rest
    for name in remote or ((["gemini"] + list(cfg.model.providers)) if args.all else []):
        configured = name in remote
        closed = configured and name in (cfg.model.personal_closed or [])
        if name == "gemini":
            key = load_gemini_key(cfg.model)
            where = f"env {cfg.model.gemini_api_key_env} or file {cfg.model.gemini_api_key_file}"
            model = GeminiModel(cfg.model, key) if key else None
        else:
            provider = provider_config(name, cfg.model)
            key = load_provider_key(provider)
            where = f"env {provider.api_key_env} or file {provider.api_key_file}"
            model = OpenAICompatModel(cfg.model, provider, key) if key else None
        if model is None:
            if configured:
                print(f"note  {name} key: not found ({where}); skipped")
            else:
                report(True, f"{name} key: not found ({where})")
            continue
        good, text = model.available()
        cap = int(getattr(model, "calls_per_day", 0) or 0)
        if cap:
            used = CallLedger().count(FallbackModel.ledger_key(model))
            text += f"; {used}/{cap} calls used today (machine-wide)"
        if closed:
            text += "; closed to lead data until you choose (sh scripts/add-key.sh gemini)"
        if configured:
            answering += bool(good) and not closed
            print(("ok    " if good else "note  ") + text)
        else:
            report(True, text)
        usage = CallLedger().usage_today().get(FallbackModel.ledger_key(model), {})
        if usage:
            parts = [
                f"{kind} {calls} calls, ~{(prompt + completion) // max(calls, 1)} tokens each"
                for kind, (calls, prompt, completion) in sorted(usage.items())
            ]
            print(f"note  {FallbackModel.ledger_key(model)} today: " + "; ".join(parts))
    if remote:
        report(answering > 0, f"model providers: {answering} of {len(remote)} can take a member's call"
               + ("" if answering else "; add a key: sh scripts/add-key.sh zai"))
        print(f"note  remote_for = {cfg.model.remote_for}: " + (
            "the local model decides every step; notes, tasks, posts and messages are written remotely"
            if cfg.model.remote_for == "writing" else "every call goes to the remote chain first"
        ))
    if cfg.scout.enabled:
        report_file = Path(cfg.scout.report_file).expanduser()
        n = sum(1 for line in report_file.read_text(encoding="utf-8").splitlines() if line.startswith("## ")) if report_file.exists() else 0
        report(True, f"scout: free-provider finds go to {report_file} ({n} recorded so far)")
    if cfg.handoff.enabled:
        target = Path(cfg.handoff.to_folder).expanduser()
        report(target.is_dir(), f"handoff: packages go to {cfg.handoff.to_name} at {target / cfg.handoff.files_dir}"
               + ("" if target.is_dir() else " (that folder does not exist)"))
    if cfg.messaging.enabled:
        missing = [p["name"] for p in cfg.messaging.peers if not Path(str(p["folder"])).expanduser().is_dir()]
        channels = [*cfg.messaging.peer_names]
        if cfg.messaging.room:
            channels.append(f"the fleet chatroom ({cfg.messaging.room_path()})")
        report(not missing, f"messaging: {', '.join(channels) or 'nothing configured'}"
               + (f" (missing peer folders: {', '.join(missing)})" if missing else ""))
    inbox = cfg.workspace / "inbox"
    if inbox.is_dir():
        waiting = len(list(inbox.glob("*.json")))
        print(f"note  inbox: {waiting} unread message(s) from other bots, {len(list((inbox / 'done').glob('*.json')))} seen")
    if cfg.policy.allowlist_file.strip():
        allow_path = cfg.path(cfg.policy.allowlist_file)
        allowed = Allowlist.load(allow_path)
        report(len(allowed) > 0, f"allowlist: {len(allowed)} hosts ({allow_path})" + ("" if len(allowed) else "; nothing may be read"))
    if (cfg.agent.mode == "web" and cfg.browser.backend in ("light", "chromium")) or args.all:
        import os

        base = Path(os.environ.get("PLAYWRIGHT_BROWSERS_PATH") or Path.home() / "Library" / "Caches" / "ms-playwright")
        found = sorted(base.glob("chromium-*"))
        report(bool(found), f"chromium: {found[-1] if found else 'not installed (run: playwright install chromium)'}")
    report(not stop_requested(cfg), "STOP flag absent" if not stop_requested(cfg) else "STOP flag present (run 'bot resume')")
    if cfg.leads.enabled or cfg.tasks.enabled or cfg.packages.enabled or args.all:
        # The board, built exactly as the runner builds it: the address, the agents' key and one read.
        url = cfg.leads.portal_url.strip()
        token = load_api_key("PORTAL_ENGINE_KEY", cfg.leads.portal_key_file)
        if not url:
            report(False, "board: [leads] portal_url is empty")
        elif not token:
            report(False, f"board: no agents' key (env PORTAL_ENGINE_KEY or file {cfg.leads.portal_key_file})")
        else:
            from .portal_store import PortalBoard

            good, text = PortalBoard(url, token, cfg.agent.name).available()
            report(good, "board: " + text)
    if cfg.agent.persona_file:
        persona_path = cfg.path(cfg.agent.persona_file)
        report(persona_path.exists(), f"persona file: {persona_path}")
    if cfg.quiet.enabled:
        print(f"note  quiet mode: {QuietDetector(cfg.quiet).describe()}")
        print(f"note  quiet mode watches apps {cfg.quiet.apps}, processes {cfg.quiet.processes}, "
              f"idle < {cfg.quiet.idle_seconds:.0f}s" + ("" if cfg.quiet.when_owner_active else " (owner activity ignored)"))
    else:
        print("note  quiet mode is off: the agent keeps working while you use the Mac")
    if pause_requested(cfg):
        print("note  PAUSE flag present")
    return 0 if ok else 1


def cmd_journal(cfg: Config, args: argparse.Namespace) -> int:
    day = dt.date.fromisoformat(args.date) if args.date else dt.date.today()
    path = cfg.workspace / "journal" / f"{day.isoformat()}.md"
    if not path.exists():
        print(f"no journal for {day}")
        return 1
    print(path.read_text(encoding="utf-8"))
    return 0


def cmd_dashboard(cfg: Config, args: argparse.Namespace) -> int:
    from .dashboard import DashboardApp, make_server

    cfg.ensure_dirs()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s", datefmt="%H:%M:%S")
    logger = logging.getLogger("explorer.dashboard")
    model = build_model(cfg.model, logger, bot_name=cfg.agent.name)
    app = DashboardApp(cfg, model, logger, quiet=QuietDetector(cfg.quiet) if cfg.quiet.enabled else None)
    host = args.host or cfg.dashboard.host
    port = cfg.dashboard.port if args.port is None else args.port
    if host not in ("127.0.0.1", "localhost", "::1"):
        logger.warning(
            "dashboard bound to %s, reachable from other machines: every request, reads included, "
            "now needs the token in %s", host, cfg.dashboard_token_file,
        )
    try:
        server = make_server(app, host, port)
    except OSError as exc:
        print(f"cannot listen on {host}:{port}: {exc}", file=sys.stderr)
        return 2
    app.write_token()
    url = f"http://{host}:{server.server_address[1]}/"
    print(f"dashboard: {url}  (Ctrl+C to stop)")
    if args.open:
        import webbrowser

        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        app.remove_token()
    return 0


def cmd_tasks(cfg: Config, args: argparse.Namespace) -> int:
    if not cfg.db_path.exists():
        print("no database yet")
        return 1
    memory = Memory(Database(cfg.db_path), cfg.workspace)
    rows = memory.recent_tasks(args.n)
    if not rows:
        print("no tasks created yet")
        return 0
    for r in reversed(rows):
        who = f" -> {r['assignee']}" if r["assignee"] else ""
        due = f" due {r['due']}" if r["due"] else ""
        print(f"{r['created_at']}  [{r['priority']}] {r['title']}{who}{due}\n    {r['url']}")
    return 0

def cmd_new(cfg: Config, args: argparse.Namespace) -> int:
    from .fleet import new_bot

    try:
        folder = new_bot(args.name, Path(args.dir).expanduser(), args.persona, args.port, fake=args.fake)
    except (FileExistsError, ValueError) as exc:
        print(f"cannot create the bot: {exc}", file=sys.stderr)
        return 2
    print(f"created {folder}")
    if args.fake:
        print("  fake mode: a built-in model and the bundled fake web; no key, nothing leaves this machine")
        print("next:")
        print(f"  bot --config {folder / 'config.toml'} demo")
        return 0
    print(f"  config:  {folder / 'config.toml'}   (edit to taste)")
    print(f"  persona: {folder / 'persona.md'}    (fill in the sections marked for the owner)")
    print("next:")
    print(f"  bot --config {folder / 'config.toml'} check")
    print(f"  bot --config {folder / 'config.toml'} install")
    return 0


def cmd_demo(cfg: Config, args: argparse.Namespace) -> int:
    """A few steps in fake mode, printed one line each, then the journal entry (the quickstart, 2026-10-14). Always the
    fake model and the fake web, whatever the config says, so it runs with no key and no network."""
    import shutil
    import tempfile

    cfg.agent.mode = "fake"
    cfg.model.provider = "fake"
    cfg.model.provider_chain = []
    cfg.agent.cycle_delay_seconds = 0
    cfg.quiet.enabled = False  # a demo is watched: never wait for the person at the keyboard to step away
    if not cfg.path(cfg.policy.denylist_file).exists():  # a folder made by hand: the fence still needs its list
        shipped = Path(__file__).resolve().parents[2] / "workspace" / "denylist.txt"
        if shipped.exists():
            cfg.policy.denylist_file = str(shipped)
    # every demo runs on its own throwaway workspace, so each run shows the same steps and never reads or
    # writes the folder's day blocks, database, journal or logs. The inputs (fence lists, fake web, persona) are
    # pinned to their real place first; only the state moves.
    for section, name in (("policy", "denylist_file"), ("policy", "allowlist_file"), ("browser", "fake_web_dir"),
                          ("agent", "persona_file")):
        holder = getattr(cfg, section)
        value = getattr(holder, name)
        if str(value).strip():
            setattr(holder, name, str(cfg.path(Path(value).expanduser())))
    if stop_requested(cfg):  # the folder's own STOP still holds, read before the state moves
        print(f"STOP file present at {cfg.stop_file}. Run 'bot resume' to clear it.", file=sys.stderr)
        return 2
    scratch = Path(tempfile.mkdtemp(prefix="demo-"))
    try:
        return _demo_in(cfg, args, scratch)
    finally:
        shutil.rmtree(scratch, ignore_errors=True)


def _demo_in(cfg: Config, args: argparse.Namespace, scratch: Path) -> int:
    import sqlite3

    cfg.paths.workspace = str(scratch)
    cfg.paths.db = str(scratch / "explorer.sqlite3")
    cfg.paths.log = str(scratch / "logs" / "explorer.jsonl")
    cfg.browser.user_data_dir = str(scratch / "browser_profile")
    cfg.browser.search_pause_file = ""
    cfg.developer.root = str(scratch / "dev")
    validate(cfg)
    cfg.ensure_dirs()
    logger = setup_logging(cfg.log_path, to_stderr=False)
    lock = PidLock(cfg.pid_file)
    if not lock.acquire():
        print(f"another run holds {cfg.pid_file}", file=sys.stderr)
        return 3
    started = dt.datetime.now().isoformat(timespec="seconds")
    try:
        build_controller(cfg, logger).run(max_cycles=args.steps)
    finally:
        lock.release()
        for handler in list(logger.handlers):  # the log lives in the throwaway folder: let it go with it
            handler.close()
            logger.removeHandler(handler)

    con = sqlite3.connect(f"file:{cfg.db_path}?mode=ro", uri=True)
    try:
        rows = con.execute(
            "SELECT action_type, payload, verdict, result FROM actions WHERE ts >= ? ORDER BY id", (started,)
        ).fetchall()
    finally:
        con.close()
    for i, (kind, payload, verdict, result) in enumerate(rows, 1):
        try:
            data = json.loads(payload or "{}")
        except ValueError:
            data = {}
        what = data.get("url") or data.get("query") or (f"'{data['title']}'" if data.get("title") else "") or data.get("text", "")
        outcome = "allowed" if verdict == "allowed" else f"refused ({str(verdict).removeprefix('rejected: ')[:60]})"
        detail = f" ({str(result)[:60]})" if verdict == "allowed" and result and kind in ("open", "follow") else ""
        print(" ".join(f"step {i}: {kind} {str(what)[:70]} -> {outcome}{detail}".split()))
    journal = cfg.workspace / "journal" / f"{dt.date.today().isoformat()}.md"
    if journal.exists():
        print(f"\njournal ({journal.name}, a throwaway copy):\n")
        print(journal.read_text(encoding="utf-8").strip()[-2000:])
    return 0


def read_only_copy(path: Path) -> Path | None:
    """The folder holding READ-ONLY-COPY.md above this config, or None: main's fleet/ and engine/ are copies for reading."""
    for folder in Path(path).resolve().parents:
        if (folder / "READ-ONLY-COPY.md").is_file():
            return folder
    return None


def cmd_install(cfg: Config, args: argparse.Namespace) -> int:
    from .fleet import install, label_for

    config_path = config_path_for(args)
    if not config_path.exists():
        print(f"no config at {config_path}; pass --config", file=sys.stderr)
        return 2
    # the config can sit anywhere: an editable install from the copy is caught by where this package itself lives
    if (copy := read_only_copy(config_path) or read_only_copy(Path(__file__))) is not None:
        print(f"STOP: {copy} is a read-only copy of the code, for reading; nothing is installed from it.\n"
              "Install from the branch, as the README says: git clone -b fleet -o starter "
              "https://github.com/reBuzz-llc/ramen-agents.git ~/bots", file=sys.stderr)
        return 2
    cfg.ensure_dirs()
    label = label_for(cfg.agent.name)
    try:
        plist = install(label, config_path, cfg.workspace, cfg.log_path.parent)
    except (RuntimeError, OSError, ValueError) as exc:
        print(f"install failed: {exc}", file=sys.stderr)
        return 1
    print(f"installed {label}")
    print(f"  launch agent: {plist}")
    print(f"  config:       {config_path}")
    print(f"  workspace:    {cfg.workspace}")
    print(f"  stop for good: bot --config {config_path} stop   (then: bot --config {config_path} uninstall)")
    return 0


def cmd_uninstall(cfg: Config, args: argparse.Namespace) -> int:
    from .fleet import label_for, uninstall

    label = label_for(cfg.agent.name)
    removed = uninstall(label)
    print(f"{'removed' if removed else 'not installed'}: {label}")
    return 0


def cmd_providers(cfg: Config, args: argparse.Namespace) -> int:
    """Every model provider this bot would try, in order, with its key status, model and today's use.

    Shows auto-discovered providers (a key file dropped in ~/bots/common-data/keys/) as well as the
    explicit chain, so the owner can see at a glance what a new key added and what has quota left."""
    from .common.fallback import CallLedger, discovered_providers, effective_chain
    from .config import KNOWN_PROVIDERS
    from .model import load_gemini_key, load_provider_key, provider_config

    if cfg.model.provider not in ("remote", "gemini") and not cfg.model.provider_chain:
        print(f"model.provider = {cfg.model.provider!r}: no remote chain (fallback {cfg.model.fallback_provider}).")
        return 0
    chain = effective_chain(cfg.model)
    discovered = set(discovered_providers(cfg.model))
    usage = CallLedger().usage_today()
    print(f"Provider chain for {cfg.agent.name} ({len(chain)} providers, then {cfg.model.fallback_provider} locally):")
    for i, name in enumerate(chain, 1):
        tag = " [auto: key found]" if name in discovered else ""
        if name == "gemini":
            key, model_id, host = load_gemini_key(cfg.model), cfg.model.gemini_model, "gemini"
        else:
            prov = provider_config(name, cfg.model)
            key, model_id, host = load_provider_key(prov), prov.model, prov.base_url.split("//")[-1].split("/")[0]
        note = KNOWN_PROVIDERS.get(name, {}).get("free", "")
        used = usage.get(host, {})
        used_str = "; ".join(f"{k} {v[0]} calls/{v[1] + v[2]} tok" for k, v in sorted(used.items())) if used else "unused today"
        print(f"  {i}. {name}{tag}: {'KEY' if key else 'NO KEY'} - {model_id} - {note}")
        print(f"       today: {used_str}")
    off = [n for n in KNOWN_PROVIDERS if n not in chain and n != "gemini"]
    if off:
        print("\nKnown providers not in the chain:")
        for name in off:
            info = KNOWN_PROVIDERS[name]
            how = f"a key at ~/bots/common-data/keys/{name}.key adds it" if info.get("auto", True) else "needs billing: a key file does not add it"
            print(f"  {name}: {info['free']} ({info['base_url']}) - {how}")
    return 0


def cmd_list(cfg: Config, args: argparse.Namespace) -> int:
    from .fleet import installed_bots, job_state

    bots = installed_bots()
    if not bots:
        print("no bots installed (bot new NAME, then bot --config .../config.toml install)")
        return 0
    for bot in bots:
        config_path = Path(bot["config"] or "")
        state = job_state(bot["label"])
        if not config_path.exists():
            print(f"{bot['label']}: launch agent {state}, but its config is missing: {config_path}")
            continue
        try:
            bcfg = load_config(config_path)
        except (ValueError, OSError) as exc:
            print(f"{bot['label']}: config error: {exc}")
            continue
        line = [f"{bcfg.agent.name} ({bot['label']}): job {state}"]
        if bcfg.db_path.exists():
            db = Database(bcfg.db_path)
            hb = Heartbeat.latest(db)
            running = PidLock.is_locked(bcfg.pid_file)
            if hb is not None:
                age = int((dt.datetime.now() - dt.datetime.fromisoformat(hb["ts"])).total_seconds())
                line.append(f"{'running' if running else 'not running'}, {hb['status']} {age}s ago, cycle {hb['cycle']}")
            counts = Memory(db, bcfg.workspace).counts()
            line.append(f"notes {counts['notes']}, episodes {counts['episodes']}")
            db.close()
        else:
            line.append("no database yet")
        if bcfg.agent.tags:
            line.append(f"tags: {', '.join(bcfg.agent.tags)}")
        line.append(f"dashboard :{bcfg.dashboard.port}, config {config_path}")
        print("; ".join(line))
    return 0


# ---- argument parsing --------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="bot", description="Explorer: a curiosity-driven local web agent.")
    parser.add_argument("--config", help="path to config.toml (default: ./config.toml or $EXPLORER_CONFIG)")
    parser.add_argument("--version", action="version", version=f"explorer {__version__}")
    sub = parser.add_subparsers(dest="cmd", required=True)

    run = sub.add_parser("run", help="run the agent loop")
    run.add_argument("--cycles", type=int, help="stop after this many cycles (default: run forever)")
    run.add_argument("--mode", choices=["fake", "web"], help="override agent.mode")
    run.add_argument("--model", choices=["fake", "ollama", "gemini", "remote"], help="override model.provider")
    run.add_argument("--headed", action="store_true", help="show the browser window (web mode)")
    run.add_argument("--delay", type=float, help="override cycle delay in seconds")
    run.add_argument("--quiet", action="store_true", help="do not echo the log to stderr")
    run.set_defaults(func=cmd_run)

    sub.add_parser("status", help="show the latest heartbeat and counts").set_defaults(func=cmd_status)
    tail = sub.add_parser("tail", help="print the last log lines")
    tail.add_argument("-n", type=int, default=40)
    tail.set_defaults(func=cmd_tail)
    sub.add_parser("pause", help="create the PAUSE file").set_defaults(func=cmd_pause)
    sub.add_parser("resume", help="remove the PAUSE and STOP files").set_defaults(func=cmd_resume)
    sub.add_parser("stop", help="create the STOP file (kill switch)").set_defaults(func=cmd_stop)
    sub.add_parser("init", help="create the workspace and database").set_defaults(func=cmd_init)
    check = sub.add_parser("check", help="verify the environment")
    check.add_argument("--all", action="store_true", help="check every backend, not only the configured ones")
    check.set_defaults(func=cmd_check)
    journal = sub.add_parser("journal", help="print a day's journal")
    journal.add_argument("--date", help="YYYY-MM-DD (default: today)")
    journal.set_defaults(func=cmd_journal)
    dash = sub.add_parser("dashboard", help="serve the local dashboard and chat page")
    dash.add_argument("--port", type=int, help="override dashboard.port")
    dash.add_argument("--host", help="override dashboard.host (default 127.0.0.1)")
    dash.add_argument("--open", action="store_true", help="open the page in your browser")
    dash.set_defaults(func=cmd_dashboard)
    tasks = sub.add_parser("tasks", help="list the tasks this bot created on the board")
    tasks.add_argument("-n", type=int, default=20)
    tasks.set_defaults(func=cmd_tasks)

    new = sub.add_parser("new", help="create a new bot folder (config, persona, workspace)")
    new.add_argument("name", help='the bot\'s name, e.g. "The CEO"')
    from .fleet import PERSONAS

    new.add_argument("--persona", choices=list(PERSONAS), default="explorer")
    new.add_argument("--dir", default="~/bots", help="parent folder for bots (default ~/bots)")
    new.add_argument("--port", type=int, default=8787, help="dashboard port for this bot")
    new.add_argument("--fake", action="store_true", help="a bot for trying it out: built-in model, bundled fake web, no key")
    new.set_defaults(func=cmd_new)
    demo = sub.add_parser("demo", help="run a few steps in fake mode and print them (no key, no network)")
    demo.add_argument("--steps", type=int, default=16, help="how many steps (default 16: one research session, its journal entry, and a refusal)")
    demo.set_defaults(func=cmd_demo)
    sub.add_parser("install", help="install (or reinstall) this bot's launch agent; use --config").set_defaults(func=cmd_install)
    sub.add_parser("uninstall", help="remove this bot's launch agent; use --config").set_defaults(func=cmd_uninstall)
    sub.add_parser("providers", help="the model provider chain, keys and usage").set_defaults(func=cmd_providers)
    sub.add_parser("list", help="every installed bot and its state").set_defaults(func=cmd_list)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        cfg = load_config(args.config)
    except (ValueError, OSError) as exc:
        print(f"config error: {exc}", file=sys.stderr)
        return 2
    return int(args.func(cfg, args))
