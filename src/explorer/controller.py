"""The agent loop: observe, decide, check, act, record. Repeat."""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import logging
import os
import re
import sqlite3
import time
from pathlib import Path
from dataclasses import dataclass
from typing import Any, Callable

from .actions import (
    Action,
    Ask,
    Back,
    Follow,
    Interest,
    Lead,
    Note,
    Open,
    Publish,
    Read,
    Rest,
    Say,
    Search,
    Summarize,
    Task,
    UpdateLead,
    UpdateTask,
    Package,
    MergeTask,
    PaceMember,
    Provider,
    Message,
    ReviseGoal,
    Plan,
    ProposeTeammate,
    PublishPackage,
    App,
    Click,
    Hotkey,
    Look,
    TypeText,
    ListFiles,
    ReadFile,
    WriteFile,
    RunCommand,
    Upgrade,
    UpgradeTest,
    UpgradeSubmit,
    DESKTOP_TYPES,
    DEVELOPER_TYPES,
    NAVIGATION_TYPES,
    UPGRADE_TYPES,
    action_key,
)
from .browser import Browser, PageView
from .chat_partner import ChatPartner
from .developer import CHECKOUT_DIR, UPGRADE_EXIT_CODE, Developer
from .desktop import Desktop, DesktopView, within_hours
from .config import Config
from .control import pause_requested, stop_requested
from .heartbeat import Heartbeat
from .logging_config import event
from .memory import Memory, now_iso
from .plan import OwnerWorkPlan, WorkPlan, load_plan, save_plan
from .model import Model
from .notion import NotionClient, page_id_from_url
from .policy import Policy, PolicyContext, Verdict, is_meta_topic, package_key, url_domain
from .presence import QuietDetector
from .prompts import CONSOLIDATION_PROMPT, DAILY_JOURNAL_PROMPT, Observation, journal_system_prompt, system_prompt
from .handoff import Inbox, find_package, send_message, send_package
from collections import OrderedDict
from .chatroom import Chatroom, is_room_recipient
from .scout import existing_names, find_category, find_label, record_provider
from .team import Member, default_member, find_member, load_team, team_block
from .publish import Publisher
from .search import Searcher, SearchPause, settings_from_config


# A bot whose job is to produce something (a task, a package, a post) is reminded every cycle once it
# has gone this many finished episodes without producing it. Results are the point; reading only feeds them.
OUTPUT_NUDGE_AFTER_EPISODES = 2

# A gentle invitation to use the shared chatroom, shown to a room member that has not sent any message
# in this many finished episodes. Kept off while an output nudge is up, so producing always comes first.
ROOM_NUDGE_AFTER_EPISODES = 3

# Tooling from experience (Plan 8): once a search engine has answered this many of a bot's searches but
# never been the source of a note, the bot drops it from its own rotation. The Package Designer would
# have dropped Wikipedia on its own. Reversible: the counts live in db state, the engine stays in config.
ENGINE_PRUNE_MIN_ANSWERED = 8

# A desk-agent serving the fleet over the chatroom (desktop.serve_chatroom) reads other bots' requests
# as untrusted data. It ingests at most this many chatroom messages per episode, so a flood of them (a
# looping bot, or web content injected via a bot's post) cannot monopolise its GUI session. Every action
# it then takes is still bounded by the desktop guards (allowed_apps, no-destructive, dry_run) as well.
DESKTOP_SERVE_REQUEST_CAP = 6


@dataclass
class ExecResult:
    ok: bool
    summary: str
    progress: bool
    feedback: str | None = None  # shown to the model next cycle even when the action succeeded



_SIGNOFF_LINE = re.compile(r"^\s*(kind |warm |best )?(regards|wishes)\b|^\s*(sincerely|cheers|thanks|thank you|yours)\b", re.I)


def with_signoff(email: str, signoff: str) -> str:
    """The owner's exact sign-off replaces whatever closing the model wrote: everything from the last
    'Regards,'-style line onward goes, and `signoff` (e.g. "Regards,\n-- Acme LLC") is appended. With no
    configured sign-off the email is returned as written."""
    email = email.strip()
    if not signoff.strip():
        return email
    lines = email.split("\n")
    for i in range(len(lines) - 1, max(len(lines) - 5, -1), -1):
        if _SIGNOFF_LINE.match(lines[i]):
            lines = lines[:i]
            break
    return "\n".join(lines).rstrip() + "\n\n" + signoff.strip()


# Actions whose success is a row or file somewhere else; when the write fails they are recorded as failed so the
# dedupe sets (verdict = 'allowed') do not remember a lead, task, package or message that never landed.
EXTERNAL_WRITE_TYPES = frozenset({"lead", "update_lead", "task", "update_task", "package", "publish_package", "message", "provider", "publish"})


class _Completer:
    """A (system, prompt) -> str callable dressed as a model with .complete, for the site gate's older call site."""

    def __init__(self, fn):
        self.complete = fn


def parse_site_verdict(raw: str) -> dict | None:
    """{"smb_own_site": true, "why": "..."} out of a model reply, leniently; None when no verdict is in it."""
    text = (raw or "").strip()
    if not text:
        return None
    m = re.search(r"\{.*?\}", text, re.S)
    if m:
        try:
            data = json.loads(m.group(0))
            if isinstance(data, dict) and "smb_own_site" in data:
                v = data["smb_own_site"]
                if isinstance(v, str):
                    v = v.strip().lower() in ("true", "yes", "1")
                return {"smb_own_site": bool(v), "why": str(data.get("why", ""))[:120]}
        except ValueError:
            pass
    m2 = re.search(r'"?smb_own_site"?\s*[:=]\s*(true|false|yes|no)', text, re.I)
    if m2:
        return {"smb_own_site": m2.group(1).lower() in ("true", "yes"), "why": ""}
    return None


class Controller:
    def __init__(
        self,
        cfg: Config,
        memory: Memory,
        model: Model,
        browser: Browser,
        policy: Policy,
        heartbeat: Heartbeat,
        publisher: Publisher,
        logger: logging.Logger,
        desktop: Desktop | None = None,
        chat_partner: ChatPartner | None = None,
        developer: Developer | None = None,
        quiet: QuietDetector | None = None,
        notion: NotionClient | Any | None = None,
        searcher: Searcher | None = None,
        transcripts: Any | None = None,
        leads_notion: NotionClient | Any | None = None,
    ):
        self.cfg = cfg
        self.memory = memory
        self.memory.journal_daily = bool(cfg.agent.journal_daily)
        self.model = model
        self.browser = browser
        self.policy = policy
        self.heartbeat = heartbeat
        self.publisher = publisher
        self.logger = logger
        self.cycle_no = int(memory.db.get_state("cycle", "0") or 0)
        self.page: PageView | None = None
        self.page_offset = 0
        self.noted_urls: set[str] = set()
        self.blocked_keys: set[str] = set()
        self.day_blocks: dict[str, str] = {}  # key (or "<type>:*") -> why, for the rest of today (owner, 2026-10-14)
        self.day_refusals: dict[str, int] = {}  # key -> refusals today; the third blocks it for the day
        self._day_blocks_date = ""
        self.pages_since_note = 0
        self._last_counted_url = ""  # a `read` of the page last counted is the same page, not another (2026-10-14)
        self.feedback: str | None = None
        self.refusal_streak = 0  # refused actions in a row in the current episode
        self.stop_flag = False
        self.shown_owner_ids: list[int] = []  # chat messages shown in the last observation
        # Messages other bots on this Mac dropped into workspace/inbox/ (handoff.py); moved to inbox/done/
        # once the model has seen them, like owner chat messages.
        self.inbox = Inbox(cfg.workspace)
        self.shown_inbox: list = []
        # The shared fleet chatroom (chatroom.py): one log all bots post to and read. Posts newer than
        # the last id this bot saw are shown once, then the marker moves, like the inbox.
        self.chatroom = Chatroom(cfg.messaging.room_path()) if cfg.messaging.room else None
        self.room_seen_id = int(memory.db.get_state("chatroom_seen_id", "-1") or -1)
        self.shown_room: list = []
        self._room_ingested_episode = 0  # chatroom messages a serving desk-agent has taken in this episode
        self._serving_chatroom = cfg.desktop.serve_chatroom and cfg.agent.mode == "desktop" and self.chatroom is not None
        self.requests = None
        if cfg.messaging.enabled:
            from .fleet_requests import RequestLog  # every direct message on record; priority requests stay on top

            self.requests = RequestLog(cfg.messaging.requests_path(cfg.root), list(cfg.messaging.priority_senders))
        self.dropbox = None
        if cfg.desktop.dropbox_folder.strip() and cfg.agent.mode == "desktop":
            from .dropbox import DropBox  # the owner's drop folder, polled from the idle loop

            router = cfg.desktop.dropbox_router.strip()
            self.dropbox = DropBox(Path(cfg.desktop.dropbox_folder).expanduser(), cfg.root.parent, cfg.agent.name,
                                   router_name=router, router_folder=(cfg.messaging.folder_for(router) or "") if router else "",
                                   done_days=cfg.desktop.dropbox_done_days, keep_days=cfg.desktop.dropbox_keep_days, logger=logger,
                                   on_sent=(lambda id, to, text: self.requests.record(id, cfg.agent.name, to, text)) if self.requests is not None else None,
                                   hooks=dict(cfg.desktop.dropbox_hooks))
        # Search engines in order with a pause shared by every bot on this Mac (search.py).
        if searcher is None:
            settings = settings_from_config(cfg)
            extra: dict[str, Any] = {}
            if cfg.browser.corpus_dir.strip():
                from .corpus import Corpus  # the owner's own material, searched before the web

                routed = cfg.root.parent / "common-data" / "botBox" / "routed"  # dropbox.py: files the owner dropped
                knowledge = cfg.root.parent / "common-data" / "knowledge"  # the family's direction and rules (steers, packages rules, target)
                extra["corpus"] = Corpus(cfg.path(cfg.browser.corpus_dir), logger,
                                         extra_folders=[routed / cfg.root.name, routed / "everyone", knowledge]).search
            if "yc" in settings.engines:
                from .yc_library import YCLibrary  # Y Combinator's Startup Library, cached once a day

                extra["yc"] = YCLibrary(user_agent=settings.api_user_agent or settings.user_agent, logger=logger).search
            searcher = Searcher(browser, settings, SearchPause(settings.pause_file), logger, extra_engines=extra)
        self.searcher = searcher
        # transcript.YouTubeTranscripts when [browser] video_transcripts is on: a video URL opens as its captions.
        self.transcripts = transcripts
        # A second Notion client pointed at the Leads board ([leads]); None when this bot does not list leads.
        self.leads_notion = leads_notion
        # Text of the pages opened most recently (url -> text), so the policy can check that a lead's email really
        # is published on the business's own site. Bounded; a page is text, never an instruction.
        self.recent_pages: "OrderedDict[str, str]" = OrderedDict()
        self.seen_links: set[str] = set()  # link targets shown on pages this run (policy.open_only_seen_urls)
        self._search_cache: dict[tuple[int, str], Any] = {}  # (episode, query) -> its results page, this episode only
        self._repeat_served: dict[int, int] = {}  # episode -> repeated searches answered from that cache
        # Tooling from experience: per-engine {answered, noted} counts this bot has built up, and the
        # engines it has already dropped (so a drop is announced once). Applied before the first cycle.
        import json as _json
        try:
            self._engine_stats: dict[str, dict[str, int]] = _json.loads(memory.db.get_state("engine_stats", "{}") or "{}")
        except ValueError:
            self._engine_stats = {}
        try:
            self._engines_dropped: set[str] = set(_json.loads(memory.db.get_state("engines_dropped", "[]") or "[]"))
        except ValueError:
            self._engines_dropped = set()
        epoch = str(getattr(cfg.browser, "search_stats_epoch", "") or "")
        if epoch and memory.db.get_state("engine_stats_epoch", "") != epoch:
            self._engine_stats, self._engines_dropped = {}, set()
            memory.db.set_state("engine_stats", "{}")
            memory.db.set_state("engines_dropped", "[]")
            memory.db.set_state("engine_stats_epoch", epoch)
            event(self.logger, "engine_stats_reset", epoch=epoch)
        self._last_answer_engine: str | None = None
        self._apply_engine_tuning(announce=False)
        self.desktop = desktop if cfg.desktop.enabled else None
        self.desktop_view: DesktopView | None = None
        self.desktop_available = False
        self.desktop_reason = "desktop control is disabled"
        self.desktop_blocked_until = 0.0  # after the owner is seen, no desktop use until this time
        self.chat_partner = chat_partner if cfg.chat_partner.enabled else None
        self.partner_turns: list[dict[str, str]] = []  # this episode's conversation, reset per episode
        self.partner_turns_since_note = 0  # a soft nudge, not restart-durable, matches pages_since_note
        self.developer = developer if cfg.developer.enabled else None
        self.exit_code: int | None = None  # set by upgrade_submit: run() returns it so the supervisor restarts us
        self.quiet = quiet if cfg.quiet.enabled else None
        self.quiet_since: float | None = None  # when the current quiet spell began, if any
        self.notion = notion if cfg.notion.enabled else None
        self.scout_enabled = cfg.scout.enabled
        from .target import Target

        self.target = Target.for_root(cfg.root)  # the market named once, filled into cards, bios and seed interests
        self._persona = ""
        if cfg.agent.persona_file:
            try:
                self._persona = cfg.path(cfg.agent.persona_file).read_text(encoding="utf-8")
            except OSError as exc:
                logger.warning("persona file %s could not be read (%s); using the built-in voice", cfg.agent.persona_file, exc)
        # A goal the bot has written for itself (Plan 8), kept beside its persona so the owner can read,
        # edit or delete it; injected into the system prompt without touching the owner's persona file.
        self.self_goal_file = cfg.workspace / "self_goal.md"
        self.self_goal = ""
        if cfg.agent.self_goals:
            try:
                self.self_goal = self.self_goal_file.read_text(encoding="utf-8").strip()
            except OSError:
                pass
        self.team: list[Member] = []
        self._team_mtime: float | None = None
        self._reload_team()
        # Work plans (plan.py): the bot's own plan for its current job, and the owner's goal + rules for this bot.
        self.plan_file = cfg.workspace / "plan.json"
        self.plan: WorkPlan | None = load_plan(self.plan_file) if cfg.agent.plans else None
        self.owner_plan = OwnerWorkPlan(cfg.root.parent / "common-data" / "work-plan.json", cfg.root.name)
        self.owner_plan.refresh()
        self.system = self._build_system()
        self.journal_system = journal_system_prompt(cfg.agent.name, self.target.fill(cfg.agent.bio))

    def _reload_team(self) -> bool:
        """Read the owner's team list (team.py) when the file changed. Returns True when it did, so the
        system prompt can be rebuilt; the dashboard edits the file while the bot runs."""
        if self.notion is None:
            return False
        path = Path(self.cfg.notion.team_file).expanduser()
        try:
            mtime: float | None = path.stat().st_mtime
        except OSError:
            mtime = None
        if mtime == self._team_mtime and self._team_mtime is not None:
            return False
        if mtime is None and self._team_mtime is None and not self.team:
            return False
        self._team_mtime = mtime
        self.team = load_team(path) if mtime is not None else []
        if hasattr(self.notion, "set_team"):
            self.notion.set_team(self.team)
        event(self.logger, "team", members=len(self.team), file=str(path))
        return True

    def _capped_types(self) -> set[str]:
        """Action types whose daily cap is reached: they leave the action menu until midnight instead of being offered and
        refused (The CEO tried `say` 24 times in a day against a cap of 1, 2026-09-29). `message` stays: a reply to a
        priority ask is exempt from its cap."""
        cfg, m = self.cfg, self.memory
        out: set[str] = set()
        try:
            if cfg.policy.max_says_per_day > 0 and m.count_says_today("owner") >= cfg.policy.max_says_per_day:
                out.add("say")
            if cfg.policy.max_notes_per_day > 0 and m.count_actions_today("note") >= cfg.policy.max_notes_per_day:
                out.add("note")
            if self.notion is not None and int(getattr(cfg.notion, "max_tasks_per_day", 0) or 0) > 0 and m.count_tasks_today() >= cfg.notion.max_tasks_per_day:
                out.add("task")
            if self.leads_notion is not None and cfg.leads.max_per_day > 0 and m.count_actions_today("lead") >= cfg.leads.max_per_day:
                out.add("lead")
            if cfg.scout.enabled and cfg.scout.max_per_day > 0 and m.count_actions_today("provider") >= cfg.scout.max_per_day:
                out.add("provider")
            if cfg.handoff.enabled and cfg.handoff.max_per_day > 0 and m.count_actions_today("package") >= cfg.handoff.max_per_day:
                out.add("package")
        except Exception:  # noqa: BLE001 - a counting problem never breaks the prompt
            return set()
        return out

    def _build_system(self, hidden: set[str] | None = None) -> str:
        cfg = self.cfg
        hidden = set(hidden or ()) | set(getattr(self, "_hidden_types", set()))
        return system_prompt(
            cfg.agent.name,
            self.target.fill(cfg.agent.bio),
            cfg.publish.enabled,
            desktop_enabled=self.desktop is not None,
            desktop_dry_run=cfg.desktop.dry_run,
            chat_partner_enabled=self.chat_partner is not None,
            chat_partner_name=cfg.chat_partner.name,
            developer_enabled=self.developer is not None,
            shell_enabled=self.developer is not None and cfg.developer.allow_shell,
            upgrade_enabled=self.developer is not None and cfg.developer.upgrade_enabled,
            persona=self._family_block() + self.target.fill(self._persona),
            tasks_enabled=self.notion is not None,
            handoff_to=cfg.handoff.to_name.strip() if cfg.handoff.enabled else "",
            scout_enabled=self.scout_enabled,
            merge_tasks=bool((cfg.notion.merge_status or "").strip()),
            pace_members=cfg.messaging.enabled and cfg.messaging.can_pace_members,
            scout_kind=cfg.scout.kind,
            message_peers=cfg.messaging.peer_names if cfg.messaging.enabled else [],
            message_room=cfg.messaging.room if cfg.messaging.enabled else False,
            mode=cfg.agent.mode,
            self_goal=self.self_goal,
            self_goals_enabled=cfg.agent.self_goals,
            desktop_serve=cfg.desktop.serve_chatroom and self.chatroom is not None,
            desktop_remote=cfg.desktop.wake_on_chat,
            propose_teammates=cfg.agent.propose_teammates,
            disabled_actions=sorted(set(cfg.policy.disabled_actions) | hidden),
            package_page=self.notion is not None and bool(cfg.notion.package_page_id.strip()),
            leads_enabled=self.leads_notion is not None,
            draft_writer=bool(cfg.leads.draft_queue_column.strip()),
            team=team_block(self.team, self.cfg.notion.assign_people),
            work_plan=self.owner_plan.block(),
            plans_enabled=cfg.agent.plans,
        )

    @property
    def search_paused_until(self) -> float:
        """When searching as a whole frees up: 0 while any engine can be used now. Matches what the
        policy enforces (seconds_until_any), so the state the owner sees agrees with the refusals."""
        engines = self.searcher.engines
        if not engines:
            return 0.0
        untils = [self.searcher.pause.paused_until(e) for e in engines]
        now = self.searcher.pause.clock()
        return min(untils) if all(u > now for u in untils) else 0.0


    # ---- lifecycle ---------------------------------------------------------

    def request_stop(self) -> None:
        self.stop_flag = True

    def should_stop(self) -> bool:
        return self.stop_flag or stop_requested(self.cfg)

    def run(self, max_cycles: int | None = None) -> int:
        self.memory.seed_interests([self.target.fill(t) for t in self.cfg.agent.seed_interests])
        self._on_start()
        done = 0
        try:
            while True:
                if self.should_stop():
                    reason = "kill switch file" if stop_requested(self.cfg) else "signal"
                    event(self.logger, "stop", reason=reason)
                    self.memory.write_journal(f"Stopped ({reason}).", heading="Stopped")
                    return 0
                if pause_requested(self.cfg):
                    self.heartbeat.tick(self.cycle_no, "paused")
                    self._sleep(5)
                    continue
                if self._held("pause"):
                    self.heartbeat.tick(self.cycle_no, "paused")
                    self._sleep(5)
                    continue
                if self._quiet_hold():
                    continue
                self._watchdog()
                self._auto_fill_from_places()
                if self._rest_if_idle():
                    continue
                self._cycle()
                done += 1
                if self.exit_code is not None:
                    event(self.logger, "stop", reason="upgrade", exit_code=self.exit_code)
                    return self.exit_code
                if max_cycles is not None and done >= max_cycles:
                    event(self.logger, "cycles_done", cycles=done)
                    return 0
                self._sleep(self.cfg.desktop.idle_cycle_seconds if (self.cfg.desktop.wake_on_chat and not getattr(self, "_task_active", False) and self.cfg.agent.mode == "desktop") else self._paced_delay())
        except KeyboardInterrupt:
            event(self.logger, "stop", reason="keyboard interrupt")
            return 0
        except Exception as e:
            # one timed line per crash, so the dashboard can count crashes per day (launchd.err.log lines carry no time)
            lines = str(e).strip().splitlines()
            event(self.logger, "run_loop_crashed", exception=type(e).__name__, message=(lines[0] if lines else "")[:300])
            raise
        finally:
            self.heartbeat.tick(self.cycle_no, "exiting", force=True)
            self.memory.write_markdown_mirrors()
            self.browser.close()
            if self.desktop is not None:
                self.desktop.close()

    def _idle_reason(self) -> str:
        """Why this bot has nothing to do now ("" = it has work); see [agent] idle_when_empty."""
        cfg, m = self.cfg, self.memory
        if not cfg.agent.idle_when_empty:
            return ""
        try:
            if self.inbox.unread(1) or m.unseen_owner_messages(1):
                return ""
            L = cfg.leads
            listed = L.enabled and bool(L.decide_glob.strip() or L.draft_queue_column.strip())
            list_done = ""
            if listed:
                if 0 < L.max_updates_per_day <= m.count_actions_today("update_lead"):
                    list_done = f"today's {L.max_updates_per_day} row updates are done"
                elif not self._decide_lines():
                    list_done = "the work list is empty"
            if self.notion is None or cfg.notion.max_tasks_per_day <= 0:
                return list_done                         # a list bot (Writer, Enricher): its list is its work
            if listed and not list_done:
                return ""
            # a bot with a task skill (The CEO): its day's task and messages are its work too
            caps = [("tasks", m.count_tasks_today(), cfg.notion.max_tasks_per_day)]
            if cfg.messaging.enabled and cfg.messaging.max_per_day > 0:
                caps.append(("messages", m.count_actions_today("message"), cfg.messaging.max_per_day))
            if all(n >= cap for _, n, cap in caps):
                return ", ".join(([list_done] if list_done else []) + ["today's " + " and ".join(f"{name} ({cap})" for name, _, cap in caps) + " are done"])
        except Exception:  # noqa: BLE001 - a counting problem never stops the work
            return ""
        return ""

    def _day_blocks_in_episode(self, episode_id: int) -> int:
        return int(self.memory.db.scalar("SELECT COUNT(*) FROM actions WHERE episode_id = ? AND verdict LIKE ?",
                                         (episode_id, "rejected: %stays blocked until tomorrow%"), default=0) or 0)

    def _rest_if_idle(self) -> bool:
        """With nothing to do, skip the model call and rest up to idle_minutes, waking early for a message or a stop."""
        reason = self._idle_reason()
        if not reason:
            return False
        event(self.logger, "resting", reason=reason, minutes=self.cfg.agent.idle_minutes)
        self._rest(reason)
        return True

    def _rest(self, reason: str) -> None:
        self.heartbeat.tick(self.cycle_no, f"resting: {reason}")
        end = time.time() + max(1.0, self.cfg.agent.idle_minutes * 60)
        while time.time() < end and not self.should_stop() and not pause_requested(self.cfg):
            try:
                if self.inbox.unread(1) or self.memory.unseen_owner_messages(1):
                    break                                    # a message wakes it
            except Exception:  # noqa: BLE001
                break
            self._sleep(min(30.0, end - time.time()))

    def _quiet_hold(self) -> bool:
        """While the owner is using the Mac, do nothing that costs GPU or memory. True means held.

        On the way in: close the hidden browser and ask Ollama to drop the model, so a game gets the
        machine to itself. On the way out: mark progress so a long quiet spell does not look like a
        stall to the watchdog. The current page is lost; the next cycle starts from 'no page open'.
        """
        if self.quiet is None:
            return False
        quiet, reason = self.quiet.check()
        if quiet:
            if self.quiet_since is None:
                self.quiet_since = time.time()
                event(self.logger, "quiet", reason=reason)
                self.memory.write_journal(
                    f"Going quiet: {reason}. No browsing or thinking until the Mac is free.", heading="Quiet"
                )
                if self.cfg.quiet.close_browser:
                    try:
                        self.browser.reset()
                    except Exception:  # noqa: BLE001
                        self.logger.debug("browser reset failed on entering quiet", exc_info=True)
                    self.page, self.page_offset = None, 0
                if self.cfg.quiet.unload_model:
                    unload = getattr(self.model, "unload", None)
                    if callable(unload):
                        unload()
            self.heartbeat.tick(self.cycle_no, "quiet", next_planned=reason)
            self._sleep(self.cfg.quiet.check_interval_seconds)
            return True
        if self.quiet_since is not None:
            minutes = (time.time() - self.quiet_since) / 60
            event(self.logger, "quiet_over", minutes=round(minutes, 1))
            self.memory.write_journal(
                f"The Mac is free again after {minutes:.0f} minutes; back to exploring.", heading="Quiet"
            )
            self.quiet_since = None
            self.heartbeat.mark_progress()
        return False

    def _held(self, mode: str) -> dict | None:
        """The CEO's hold on this bot (hold.py) when it is of this mode; the journal notes when one starts and ends."""
        from .hold import read_hold, until_text

        hold = read_hold(self.cfg.workspace)
        key = (hold or {}).get("at"), (hold or {}).get("mode")
        if key != getattr(self, "_hold_seen", (None, None)):
            self._hold_seen = key
            if hold:
                what = "paused me" if hold["mode"] == "pause" else f"slowed me to one step every {int(hold.get('step_seconds', 0)) // 60} minutes"
                self.memory.write_journal(f"{hold.get('by', 'The CEO')} {what} until {until_text(hold)}: {hold.get('why') or 'no reason given'}.",
                                          heading="Held")
                event(self.logger, "held", by=hold.get("by"), mode=hold["mode"], until=until_text(hold))
            else:
                event(self.logger, "hold_lifted")
        return hold if hold and hold.get("mode") == mode else None

    def _paced_delay(self) -> float:
        delay = self._paced_delay_budget()
        hold = self._held("slow")
        return max(delay, float(hold.get("step_seconds", 0))) if hold else delay

    def _paced_delay_budget(self) -> float:
        """The cycle delay, stretched when the day's shared free tokens are running out faster than the
        clock, so the budget lasts into the evening instead of being spent by mid-day. All bots read one
        machine-wide ledger, so they slow together. No budget set, or on track, means the base delay."""
        base = self.cfg.agent.cycle_delay_seconds
        if self.cfg.model.budget_scope == "active":
            return self._paced_delay_active(base)
        budget = self.cfg.model.daily_token_budget
        if budget <= 0:
            return base
        from .common.fallback import CallLedger

        if getattr(self, "_ledger", None) is None:
            self._ledger = CallLedger()
        from .common.fallback import paced_delay

        lt = time.localtime(time.time())
        # How far through the day we are, floored so the first ~70 minutes do not read as "0% elapsed".
        day_fraction = max(0.05, (lt.tm_hour * 3600 + lt.tm_min * 60 + lt.tm_sec) / 86400)
        used = self._ledger.tokens_today(self.cfg.agent.name if self.cfg.model.budget_scope == "bot" else None)
        delay = paced_delay(base, budget, used, day_fraction, self.cfg.agent.max_cycle_delay_seconds)
        if delay > base:
            event(self.logger, "paced", delay=round(delay), tokens_used=used, budget=budget, scope=self.cfg.model.budget_scope)
        return delay

    def _paced_delay_active(self, base: float) -> float:
        """Pacing against the fleet's pool, shared by the bots running right now (model.budget_scope = "active")."""
        m = self.cfg.model
        if m.fleet_token_budget <= 0 or m.budget_weight <= 0:
            return base
        from .common.fallback import CallLedger, paced_delay
        from .fleet_budget import active_share

        if getattr(self, "_ledger", None) is None:
            self._ledger = CallLedger()
        now = time.time()
        cached = getattr(self, "_share_cache", None)
        if cached is None or now - cached[0] > 120:
            cached = self._share_cache = (now, active_share(self.cfg.root, self.cfg.config_path if hasattr(self.cfg, "config_path") else None))
        share, members = cached[1]
        lt = time.localtime(now)
        day_fraction = max(0.05, (lt.tm_hour * 3600 + lt.tm_min * 60 + lt.tm_sec) / 86400)
        used_me = self._ledger.tokens_today(self.cfg.agent.name)
        used_all = self._ledger.tokens_today(None)
        budget = max(1, int(used_me + max(0, m.fleet_token_budget - used_all) * share))  # what I have used + my share of what is left
        delay = paced_delay(base, budget, used_me, day_fraction, self.cfg.agent.max_cycle_delay_seconds)
        if delay > base:
            event(self.logger, "paced", delay=round(delay), tokens_used=used_me, budget=budget, scope="active",
                  share=round(share, 2), active=members, pool_left=max(0, m.fleet_token_budget - used_all))
        return delay

    def _sleep(self, seconds: float) -> None:
        end = time.time() + max(0.0, seconds)
        while True:
            remaining = end - time.time()
            if remaining <= 0 or self.should_stop():
                return
            time.sleep(min(1.0, remaining))

    def _on_start(self) -> None:
        ep = self.memory.current_episode()
        if ep is not None:
            event(self.logger, "resume", episode=ep["id"], actions=ep["actions"])
            self.memory.write_journal(
                f"Restarted. Continuing episode {ep['id']} from my notes; the browser starts empty.", heading="Restart"
            )
        else:
            event(self.logger, "start")
            self.memory.write_journal("Started.", heading="Start")
        self.heartbeat.tick(self.cycle_no, "starting", force=True)

    # ---- one cycle ---------------------------------------------------------

    def _ensure_episode(self) -> sqlite3.Row:
        ep = self.memory.current_episode()
        if ep is None:
            retired = self.memory.retire_stale_questions(self.cfg.policy.retire_question_after_pursuits)
            duplicates = self.memory.dedupe_open_questions()
            meta_questions, meta_interests = self.memory.purge_meta_topics(is_meta_topic)
            if retired or duplicates or meta_questions or meta_interests:
                event(
                    self.logger,
                    "questions_retired",
                    stale=retired,
                    duplicates=duplicates,
                    meta_questions=meta_questions,
                    meta_interests=meta_interests,
                )
            if self._reload_team():
                self.system = self._build_system()  # the owner changed the team list
            question = self.memory.pick_question()
            qid = question["id"] if question else None
            eid = self.memory.start_episode(qid)
            if question is not None:
                self.memory.bump_pursued(question["id"])
            self.noted_urls.clear()
            self.blocked_keys.clear()
            self.pages_since_note = 0
            self.partner_turns = []
            self.partner_turns_since_note = 0
            self._room_ingested_episode = 0
            event(self.logger, "episode", episode=eid, question=question["question"] if question else None)
            self._apply_engine_tuning()
            self._task_nudge()
            ep = self.memory.episode(eid)
            assert ep is not None
        return ep

    def _poll_dropbox(self) -> None:
        """The owner's drop folder: route replies from the router are carried out and never shown to the model; new files
        are announced; each outcome is one report line the owner sees in the chatroom."""
        if self.dropbox is None:
            return
        try:
            reports, consumed = self.dropbox.poll(self.inbox.unread(20))
        except OSError as exc:
            event(self.logger, "dropbox_error", error=str(exc)[:200])
            return
        if consumed:
            self.inbox.mark_seen(consumed)
            if self.requests is not None:
                for m in consumed:
                    try:
                        self.requests.resolve(m.path.name, "route line carried out by the drop folder")
                    except OSError:
                        pass
        for line in reports:
            event(self.logger, "dropbox", text=line[:200])
            self._report(f"drop folder: {line}"[:400])

    def _idle_for_chat(self) -> bool:
        """Desktop remote control: True when there is nothing to do -- no unread owner message and no task under way --
        so the cycle costs a heartbeat, not a model call. A task is under way from an owner message until the model
        summarises (ends the episode) or has gone `max_idle_task_actions` actions without another owner word."""
        d = self.cfg.desktop
        if not (d.enabled and d.wake_on_chat and self.cfg.agent.mode == "desktop"):
            return False
        if self.memory.unseen_owner_messages(1):
            self._task_active = True
            self._task_actions = 0
            return False
        if not getattr(self, "_task_active", False):
            return True
        ep = self.memory.current_episode()
        if ep is None or self._task_actions >= 24:
            self._task_active = False
            return True
        return False

    def _cycle(self) -> None:
        self.cycle_no += 1
        self.memory.db.set_state("cycle", str(self.cycle_no))
        self._poll_dropbox()
        if self._idle_for_chat():
            self.heartbeat.tick(self.cycle_no, "idle (waiting for a task in chat)")
            return
        if getattr(self, "_task_active", False):
            self._task_actions = getattr(self, "_task_actions", 0) + 1
        ep = self._ensure_episode()
        obs = self._observe(ep)
        result = self.model.decide(self.system, obs)
        if result.decision is None:
            failures = self.heartbeat.record_model_failure()
            event(self.logger, "model_failure", error=result.error, failures=failures, raw=(result.raw or "")[:300])
            self.heartbeat.tick(self.cycle_no, "model_failure", current_question=obs.current_question)
            self._sleep(min(60.0, self.cfg.watchdog.model_failure_backoff_seconds * failures))
            return
        self.heartbeat.reset_model_failures()
        if self.shown_owner_ids:
            self.memory.mark_chat_seen(self.shown_owner_ids)  # the model has now read them
            self.shown_owner_ids = []
        if self.shown_inbox:
            self.inbox.mark_seen(self.shown_inbox)
            if self.requests is not None:
                try:
                    self.requests.mark_read([m.path.name for m in self.shown_inbox])
                    for m in self.shown_inbox:  # a message from X is X's answer to my oldest open ask of X (Grok Bot
                        self.requests.answer(self.cfg.agent.name, m.sender, m.text)  # replies by file, not through a controller)
                except OSError:
                    pass
            senders = sorted({m.sender for m in self.shown_inbox})
            event(self.logger, "inbox_seen", messages=len(self.shown_inbox), senders=senders)
            if self.chatroom is not None:  # a read receipt the owner can see; bots never read receipts
                n = len(self.shown_inbox)
                self.chatroom.post(self.cfg.agent.name, f"read {n} message{'s' if n != 1 else ''} from {', '.join(senders)}", kind="receipt")
            self.shown_inbox = []
        if self.shown_room:
            self.room_seen_id = max(p.id for p in self.shown_room)
            self.memory.db.set_state("chatroom_seen_id", str(self.room_seen_id))
            if self.chatroom is not None:
                self.chatroom.mark_seen(self.cfg.agent.name, self.room_seen_id)
            self.shown_room = []
        decision = result.decision
        action = decision.action
        if self.cfg.agent.mode == "desktop":
            action = self._desktop_guard(action)
        if isinstance(action, Note) and self.page is not None and self.page.ok and self.cfg.agent.mode != "fake":
            src = (action.source_url or "").strip()
            if not src.startswith(("http://", "https://", "corpus://")):  # 27 notes refused for a bad/missing source, 2026-09-29
                action.source_url = self.page.url
        ctx = self._policy_context(ep, obs)
        target = self.policy.resolve_target(action, ctx)
        key = self._key(action, ep, target)
        verdict = self.policy.check(action, ctx, key=key)
        self._last_trace = {"system": self.system, "prompt": obs.render(), "reply": result.raw, "model": getattr(self.model, "_active", None) and str(getattr(self.model._active, "label", "")) or ""}
        strip_note = ""
        if verdict.allowed and action.type == "lead":
            # Location and Company size are optional cells: the engine keeps them only when the business's own pages the
            # bot opened state them, and blanks them otherwise, so a doubt about an optional cell never sinks a whole lead
            # (8 of 15 leads refused that way, 2026-09-30).
            action, strip_note = self._ground_optional_lead_facts(action)
        if verdict.allowed:  # the owner's format rules at write time (validator/gate.py), fail-open
            gate_args = dict(bot=self.cfg.agent.name, min_details=int(getattr(self.cfg.notion, "min_details_chars", 300) or 300),
                             open_tasks=self._open_task_titles_for_gate(action),
                             judge=self._write_gate_judge() if self.cfg.policy.write_gate_model else None)
            verdict = self.policy.gate_write(action, page_text=self._cited_page_text(action), **gate_args)
            if (not verdict.allowed and verdict.tag == "write_gate_model" and action.type == "lead"
                    and (getattr(action, "location", "") or getattr(action, "size", ""))):
                bare = action.model_copy(update={"location": "", "size": ""})
                second = self.policy.gate_write(bare, page_text=self._cited_page_text(bare), **gate_args)
                if second.allowed:  # the judge's doubt was about the optional cells: list the lead without them
                    action, verdict = bare, second
                    strip_note = "Location and Company size were left empty: the checker could not find them on the cited page."
                    event(self.logger, "lead_optional_facts_dropped", name=str(getattr(action, "name", ""))[:80], by="judge")
            for v in getattr(self.policy, "last_model_verdicts", []) or []:
                event(self.logger, "write_gate_model", action=action.type, rule=v.get("id"), ok=v.get("ok"), why=v.get("why"), cached=v.get("cached"))
        payload = action.model_dump()
        self._save_trace(action.type, verdict)
        if not verdict.allowed:
            if verdict.permanent:
                self.blocked_keys.add(key)
            self._day_block(action, key, verdict)
            self.memory.bump_episode_actions(ep["id"])
            self.memory.record_action(
                self.cycle_no, ep["id"], action.type, payload, decision.thought, "rejected: " + verdict.reason, None, False
            )
            event(self.logger, "rejected", action=action.type, reason=verdict.reason, thought=decision.thought[:200])
            if verdict.tag:  # a refusal the owner counts on its own (the per-domain cap)
                event(self.logger, verdict.tag, action=action.type, target=(target or "")[:200], reason=verdict.reason[:200])
                if verdict.tag == "domain_cap":
                    self._plan_stuck_on_domain(target or "", verdict.reason)
            self.feedback = f"Your last action ({action.type}) was not allowed: {verdict.reason}"
            if action.type in DESKTOP_TYPES:
                self._note_desktop_blocker(verdict.reason, ep)
            self.heartbeat.record_action(action.type, key, progress=False)
            self.heartbeat.tick(self.cycle_no, "running", self._current_url(), obs.current_question)
            self.refusal_streak += 1
            streak = self.cfg.policy.max_refusal_streak
            if self.cfg.agent.day_block_rest and verdict.tag == "day_block" and self._day_blocks_in_episode(ep["id"]) >= 3:
                self._close_early(ep, "three actions already refused or done today")
                event(self.logger, "day_block_rest", episode=ep["id"], minutes=self.cfg.agent.idle_minutes)
                self._rest("three day-blocked actions this episode")
            elif verdict.over_budget:
                self._close_early(ep, "the episode was over budget and you did not summarize")
            elif streak > 0 and self.refusal_streak >= streak:
                self._close_early(ep, f"{self.refusal_streak} refused actions in a row")
            return
        self.refusal_streak = 0
        if action.type in DESKTOP_TYPES:
            self._clear_desktop_blockers(ep)
        exec_result = self._execute(action, ep, target)
        self.memory.bump_episode_actions(ep["id"])
        # A write that the policy allowed but the executor could not complete (Notion 404, a peer folder gone) is
        # recorded as failed: the dedupe sets (recent leads, packages, tasks) only count verdict = 'allowed', so a row
        # that never existed no longer blocks its domain or name for 90 days (2026-09-24).
        verdict = "allowed" if (exec_result.ok or action.type not in EXTERNAL_WRITE_TYPES) else f"failed: {exec_result.summary[:120]}"
        self.memory.record_action(
            self.cycle_no, ep["id"], action.type, payload, decision.thought, verdict, exec_result.summary,
            exec_result.progress,
        )
        event(
            self.logger,
            "action",
            action=action.type,
            ok=exec_result.ok,
            progress=exec_result.progress,
            result=exec_result.summary[:300],
            thought=decision.thought[:300],
            latency=round(result.latency, 1),
            attempts=result.attempts,
        )
        self.feedback = (
            exec_result.feedback if exec_result.ok else f"Your last action ({action.type}) failed: {exec_result.summary}"
        )
        if strip_note and exec_result.ok:
            self.feedback = f"{self.feedback or ''} {strip_note}".strip()
        self.heartbeat.record_action(action.type, key, exec_result.progress)
        self.heartbeat.tick(self.cycle_no, "running", self._current_url(), obs.current_question)
        if action.type in NAVIGATION_TYPES or isinstance(action, Back):
            self._snapshot()

    def _snapshot(self) -> None:
        """Save a picture of the current page for the dashboard, if the browser can draw one."""
        if not self.cfg.dashboard.screenshots:
            return
        shot = getattr(self.browser, "screenshot", None)
        if shot is None:
            return
        target = self.cfg.screenshot_dir / "current.png"
        tmp = target.with_name("current.tmp.png")
        try:
            target.parent.mkdir(parents=True, exist_ok=True)
            if shot(tmp):
                tmp.replace(target)
            elif getattr(self.browser, "last_source", "") == "text":
                target.unlink(missing_ok=True)  # a text-only page: an old picture would show the wrong site
        except Exception:  # noqa: BLE001 - never let the picture break the loop
            self.logger.debug("screenshot failed", exc_info=True)

    def _current_url(self) -> str | None:
        return self.page.url if self.page else None

    # "already done" or "today's limit" refusals -- never the episode-scoped ones ("already saved a note ... this episode")
    DAY_BLOCK = re.compile(r"daily limit|today already|today's exists|refused today|already (created|handed over|has a draft|exists|published|replaced|on the board)|the (task|note) you already", re.I)  # a quoted question may say "today" too
    DAY_BLOCK_TYPE = re.compile(r"today, the daily limit|messages today|daily limit", re.I)

    def _day_blocks(self) -> dict[str, str]:
        """Keys refused today as "already done" or "today's limit reached", kept for the rest of the day across episodes
        and restarts (workspace/day-blocks.json). Owner, 2026-10-14: a third of all actions were such repeats."""
        today = dt.date.today().isoformat()
        if self._day_blocks_date != today:
            path = self.cfg.workspace / "day-blocks.json"
            saved: dict[str, Any] = {}
            try:
                saved = json.loads(path.read_text()) if path.is_file() else {}
            except (OSError, ValueError):
                saved = {}
            same_day = saved.get("date") == today
            self.day_blocks = dict(saved.get("blocks") or {}) if same_day else {}
            self.day_refusals = {k: int(v) for k, v in (saved.get("counts") or {}).items()} if same_day else {}
            self._day_blocks_date = today
        return self.day_blocks

    def _save_day_blocks(self) -> None:
        try:
            (self.cfg.workspace / "day-blocks.json").write_text(json.dumps(
                {"date": self._day_blocks_date, "blocks": self.day_blocks, "counts": self.day_refusals}, indent=1))
        except OSError:
            pass

    def _day_block(self, action: Action, key: str, verdict: Verdict) -> None:
        reason = verdict.reason or ""
        blocks = self._day_blocks()
        if action.type == "publish_package":
            return  # packages have their own once-a-day rule (packages_refused_today), which lets a fuller re-send through
        if "this episode" not in reason and self.DAY_BLOCK.search(reason):
            blocks[f"{action.type}:*" if self.DAY_BLOCK_TYPE.search(reason) else key] = reason[:160]
        elif key and action.type not in ("summarize", "plan"):
            # the same thing refused three times today is done for the day, whatever the reason (the Enricher's
            # dozens of tries on one business, the writer's on a chain store; 2026-10-14)
            n = self.day_refusals.get(key, 0) + 1
            self.day_refusals[key] = n
            if n >= self.cfg.policy.day_block_after_refusals > 0:
                blocks[key] = f"refused {n} times today: {reason[:120]}"
        self._save_day_blocks()

    def _daily_journal_catch_up(self) -> None:
        """One journal entry per finished day (owner, 2026-10-14: fewer, longer, data-led posts): for each day since the
        last digest up to yesterday, the day's digest is written as the journal; the per-episode entries stay in the
        day buffer, which is not a post."""
        today = dt.date.today()
        last = str(self.memory.db.get_state("daily_journal_last", "") or "")
        try:
            start = dt.date.fromisoformat(last) + dt.timedelta(days=1) if last else today - dt.timedelta(days=1)
        except ValueError:
            start = today - dt.timedelta(days=1)
        start = max(start, today - dt.timedelta(days=7))
        day = start
        while day < today:
            text = self._daily_digest(day)
            if text:
                self.memory.write_journal(text, heading=f"Day {day.isoformat()}", force=True)
                event(self.logger, "journal_daily", day=day.isoformat(), chars=len(text))
            day += dt.timedelta(days=1)
        self.memory.db.set_state("daily_journal_last", (today - dt.timedelta(days=1)).isoformat())

    def _daily_digest(self, day: dt.date) -> str:
        """The day's journal: the model's prose over the day's material, then the sources and outputs as a list."""
        like = day.isoformat() + "%"
        q = self.memory.db.query
        summaries = [str(r["body"]) for r in q("SELECT body FROM summaries WHERE kind = 'episode' AND created_at LIKE ? ORDER BY id", (like,))]
        notes = q("SELECT title, body, source_url FROM notes WHERE created_at LIKE ? ORDER BY id", (like,))
        tasks = q("SELECT title, url FROM tasks WHERE created_at LIKE ? ORDER BY id", (like,))
        outputs: dict[str, list[str]] = {}
        for r in q("SELECT action_type, payload FROM actions WHERE verdict = 'allowed' AND ts LIKE ? "
                   "AND action_type IN ('publish_package', 'message', 'lead', 'update_lead') ORDER BY id", (like,)):
            try:
                p = json.loads(str(r["payload"]))
            except ValueError:
                p = {}
            label = str(p.get("name") or p.get("to") or "")[:80]
            outputs.setdefault(str(r["action_type"]), []).append(label)
        buffer = self.memory.day_buffer(day)
        if not (summaries or notes or tasks or outputs or buffer.strip()):
            return ""
        material = []
        if summaries:
            material.append("Episode summaries:\n" + "\n".join(f"- {s[:600]}" for s in summaries[-12:]))
        if notes:
            material.append("Notes (title: body -- source):\n" + "\n".join(
                f"- {n['title']}: {str(n['body'])[:300]} -- {n['source_url'] or 'no source'}" for n in notes[-40:]))
        if tasks:
            material.append("Tasks created:\n" + "\n".join(f"- {t['title']} ({t['url']})" for t in tasks))
        for kind, items in outputs.items():
            material.append(f"{kind} ({len(items)}): " + ", ".join(i for i in items[:20] if i))
        if buffer.strip():
            material.append("Events:\n" + buffer.strip()[-3000:])
        prompt = DAILY_JOURNAL_PROMPT.format(day=day.isoformat(), material="\n\n".join(material))
        try:
            prose = (self.model.complete(self.journal_system, prompt) or "").strip()
        except Exception:  # noqa: BLE001
            prose = ""
        if not prose:
            prose = f"{len(summaries)} episodes, {len(notes)} notes, {len(tasks)} tasks on {day.isoformat()}."
        lines = [prose, ""]
        sourced = [n for n in notes if str(n["source_url"] or "").startswith("http")]
        if sourced:
            lines += ["Sources read that day:"] + [f"- {n['title']}: {n['source_url']}" for n in sourced[-40:]] + [""]
        if tasks:
            lines += ["Tasks for the team:"] + [f"- {t['title']} ({t['url']})" for t in tasks] + [""]
        if outputs.get("publish_package"):
            lines += ["Packages published: " + ", ".join(dict.fromkeys(outputs["publish_package"])), ""]
        return "\n".join(lines).strip()

    def _key(self, action: Action, ep: sqlite3.Row, target: str | None) -> str:
        extra: str | None = None
        if isinstance(action, Read):
            extra = f"{self._current_url() or ''}:{self.page_offset}"
        elif isinstance(action, Summarize):
            extra = str(ep["id"])
        elif isinstance(action, (Click, TypeText, Hotkey)):
            view = self.desktop_view
            extra = f"{view.app.name}:{view.window_title}" if view is not None and view.app is not None else ""
        return action_key(action, resolved_url=target, extra=extra)

    def _text_window(self) -> tuple[str, bool]:
        if self.page is None:
            return "", False
        limit = self.cfg.browser.page_text_limit
        text = self.page.text
        window = text[self.page_offset : self.page_offset + limit]
        return window, len(text) > self.page_offset + limit

    def _task_nudge(self) -> None:
        """A bot with an output skill that only ever researches gets told so at episode start.

        Research is cheap and tasks are not, which is right, but nothing else ever asks for the
        output; the CEO ran nine episodes without a task. The nudge is feedback text, so the
        model sees it once, on the first observation of the episode."""
        limit = self.cfg.notion.nudge_after_episodes
        if self.notion is None or limit <= 0:
            return
        idle = self.memory.episodes_since_last_task()
        if idle < limit:
            return
        self.feedback = (
            f"You have finished {idle} episodes without creating a task. Your notes are enough to act on: "
            "this episode, turn what you know into one concrete task for the team (a target list, a piece "
            "of outreach, a case study, a page), or write a note titled 'Possible task: ...' saying what is "
            "missing before it can be one"
        )
        event(self.logger, "task_nudge", episodes_without_task=idle)

    def _open_asks_to(self) -> dict[str, list[tuple[str, str]]]:
        """This bot's own open asks by recipient, so the policy refuses sending the same one again."""
        if self.requests is None:
            return {}
        out: dict[str, list[tuple[str, str]]] = {}
        try:
            me = self.cfg.agent.name.strip().lower()
            for r in self.requests.all():
                if r.open and r.sender.strip().lower() == me:
                    out.setdefault(r.to.strip().lower(), []).append((r.text, r.sent_at))
        except OSError:
            return {}
        return out

    def _open_asks_from(self) -> set[str]:
        if self.requests is None:
            return set()
        try:
            return {r.sender.strip().lower() for r in self.requests.open_for(self.cfg.agent.name)}
        except OSError:
            return set()

    def _waiting_priority_asks(self) -> list:
        """Open priority requests to this bot from senders who can still read an answer. An ask from a member the owner
        has since stopped is parked, not dropped: the reply would be refused ("X is stopped"), so it held this bot for
        priority_request_give_up actions with nothing it could do (owner, 2026-10-03: a stopped member must not hold the
        others back). It counts again the moment that member runs, until it expires like any other ask."""
        open_ = [r for r in self.requests.open_for(self.cfg.agent.name) if r.priority]
        if not open_:
            return open_
        stopped = {n.strip().lower() for n, state in self.cfg.messaging.peer_states().items() if state == "stopped"}
        return [r for r in open_ if r.sender.strip().lower() not in stopped]

    def _priority_request_state(self) -> dict | None:
        """For the policy: the oldest open priority request to this bot and how many accepted actions this bot has taken
        since its model read it (0 while unread)."""
        if self.requests is None:
            return None
        try:
            open_ = self._waiting_priority_asks()
        except OSError:
            return None
        if not open_:
            return None
        open_.sort(key=lambda r: r.sender.strip().lower() != "owner")  # the owner's word first (a Validator ask blocked the SMB steer)
        r = open_[0]
        writes = 0
        if r.read_at:
            writes = int(self.memory.db.scalar(
                "SELECT COUNT(*) FROM actions WHERE verdict = 'allowed' AND ts >= ? AND action_type IN "
                "('lead','update_lead','task','update_task','package','publish_package','provider','note')", (r.read_at,)) or 0)
        return {"id": r.id, "sender": r.sender, "text": r.text, "actions_since_read": self.memory.count_actions_since(r.read_at) if r.read_at else 0,
                "writes_since_read": writes}

    def _request_banner(self) -> str | None:
        """An open request from a priority sender (The CEO) outranks every other nudge until this bot answers it."""
        if self.requests is None:
            return None
        try:
            open_ = self._waiting_priority_asks()
        except OSError:
            return None
        if not open_:
            return None
        open_.sort(key=lambda r: r.sender.strip().lower() != "owner")
        r = open_[0]
        more = f" ({len(open_) - 1} more from them wait behind it.)" if len(open_) > 1 else ""
        if r.sender == "Owner":
            return (f"PRIORITY -- the owner asked you in the chat at {r.sent_at[11:16]} on {r.sent_at[:10]}: \"{r.text[:400]}\" "
                    "This comes before everything else: do it now within your rules -- a steer for a colleague is a `message` to "
                    "that colleague -- then tell the owner with `say` what you did. Saying you will do it is not doing it; "
                    "the ask stays here until the owner's next message.")
        return (f"PRIORITY -- {r.sender} asked you at {r.sent_at[11:16]} on {r.sent_at[:10]}: \"{r.text[:400]}\" "
                f"This comes before everything else: do what it asks within your rules, then reply to {r.sender} with one "
                f"`message` saying what you did (or why you cannot). It stays here until you reply.{more}")

    def _output_banner(self) -> str | None:
        """A standing, every-cycle reminder for a bot that exists to produce something and hasn't
        lately. The one-shot _task_nudge fires once at episode start; this stays up every step so a
        small model that keeps choosing to read instead of produce is told, each time, that output is
        the job. Covers the three output skills; the scout is left out on purpose (its trouble is
        recording too much, not too little)."""
        memory = self.memory
        skills: list[tuple[str, str, str, int, int]] = []  # (action_type, noun, how, done today, daily cap)
        if self.notion is not None:
            skills.append(("task", "task", "create a task on the team's Notion board", memory.count_tasks_today(), self.cfg.notion.max_tasks_per_day))
        if self.cfg.handoff.enabled:
            skills.append(("package", "package", f"hand a package to {self.cfg.handoff.to_name}", memory.count_actions_today("package"), self.cfg.handoff.max_per_day))
        if self.cfg.publish.enabled:
            skills.append(("publish", "post", "publish a post to your site", memory.count_actions_today("publish"), self.cfg.publish.max_posts_per_day))
        # Once today's cap is reached the policy refuses every further one, so nagging for output would
        # only send a small model into a refuse-retry loop. Say the opposite instead.
        capped = [(noun, done) for _, noun, _, done, cap in skills if cap > 0 and done >= cap]
        if capped:
            what = " and ".join(f"{done} {noun}{'s' if done != 1 else ''}" for noun, done in capped)
            nouns = " or ".join(noun for noun, _ in capped)
            still = " Publishing a package to the Notion page is still fine." if self.cfg.notion.package_page_id else ""
            return (
                f"TODAY'S {nouns.upper()} QUOTA IS USED: {what} already, the daily limit. Do not try another {nouns} "
                f"today; it will be refused. Read and take notes that tomorrow's can build on, or rest.{still}"
            )
        best: tuple[int, str, str] | None = None
        for atype, noun, how, _done, _cap in skills:
            idle = self.memory.episodes_since_last_output(atype)
            if idle >= OUTPUT_NUDGE_AFTER_EPISODES and (best is None or idle > best[0]):
                best = (idle, noun, how)
        if best is None:
            return None
        idle, noun, how = best
        return (
            f"RESULTS MATTER: {idle} episodes now with no {noun} produced. Reading and notes are only worth "
            f"it when they become output. This episode, {how} as soon as your notes support one — do not keep "
            f"researching instead. If you genuinely cannot yet, take one note 'Possible {noun}: ...' naming the "
            "single thing you still need, then go get exactly that."
        )

    def _save_engine_stats(self) -> None:
        import json
        self.memory.db.set_state("engine_stats", json.dumps(self._engine_stats))

    def _credit_engine_answered(self, engine: str) -> None:
        """A search was answered by this engine: count it, and remember it as the thread's origin so a
        note taken before the next search credits it."""
        row = self._engine_stats.setdefault(engine, {"answered": 0, "noted": 0})
        row["answered"] += 1
        self._last_answer_engine = engine
        self._save_engine_stats()

    def _credit_engine_noted(self) -> None:
        """A note was taken: credit the engine that most recently fed this bot a search result."""
        engine = self._last_answer_engine
        if not engine:
            return
        self._engine_stats.setdefault(engine, {"answered": 0, "noted": 0})["noted"] += 1
        self._save_engine_stats()

    def _dead_engines(self) -> set[str]:
        return {
            e for e, s in self._engine_stats.items()
            if s.get("answered", 0) >= ENGINE_PRUNE_MIN_ANSWERED and s.get("noted", 0) == 0
        }

    def _apply_engine_tuning(self, announce: bool = True) -> None:
        """Drop engines the bot has found useless (answered a lot, never led to a note), keeping at
        least one. A newly dropped engine is announced once, in the journal and the chatroom."""
        if self.searcher is None:
            return
        configured = list(self.searcher.settings.usable_engines())
        dead = self._dead_engines() & set(configured)
        if len(dead) >= len(configured) and configured:
            # Never leave the bot with no engine: keep the least-bad (most notes, then most answers).
            best = max(configured, key=lambda e: (self._engine_stats.get(e, {}).get("noted", 0),
                                                   self._engine_stats.get(e, {}).get("answered", 0)))
            dead.discard(best)
        self.searcher.disabled = dead
        newly = dead - self._engines_dropped
        if newly and announce:
            for engine in sorted(newly):
                s = self._engine_stats.get(engine, {})
                event(self.logger, "engine_dropped", engine=engine, answered=s.get("answered", 0))
                self.memory.write_journal(
                    f"I stopped using the {engine} search engine: it answered {s.get('answered', 0)} of my "
                    "searches but never led to a note worth keeping. Dropped it to search better.",
                    heading="Tooling",
                )
                if self.chatroom is not None:
                    self.chatroom.post(self.cfg.agent.name, f"dropped the {engine} search engine — it never led me to a useful note")
        if newly:
            self._engines_dropped |= newly
            import json
            self.memory.db.set_state("engines_dropped", json.dumps(sorted(self._engines_dropped)))

    def _report(self, text: str) -> None:
        """A 'report' line in the chatroom: the owner sees that a message became work. Bots do not read these."""
        if self.chatroom is not None:
            try:
                self.chatroom.post(self.cfg.agent.name, text, kind="report")
            except OSError:
                pass

    def _last_own_room_post(self) -> str:
        """This bot's most recent chatroom post, so the policy can refuse it repeating itself."""
        if self.chatroom is None:
            return ""
        me = self.cfg.agent.name.strip().lower()
        mine = [p.text for p in self.chatroom.recent(20) if p.sender.strip().lower() == me]
        return mine[-1] if mine else ""

    def _triage_banner(self) -> str:
        """A breadth 'desk triage' framing for a review-sitting episode: look across every open thread
        and fresh intel and advance the most-ready one, rather than tunnelling on a single problem."""
        return (
            "REVIEW SITTING: you are juggling several fronts at once, not solving one. Look across all "
            "your open threads (listed above) and the fresh intel from your colleagues and your inbox. "
            "Pick the ONE thread most ready to become a concrete team task and produce that task this "
            "sitting; for the others, take a one-line note on the single next step each needs. Breadth "
            "over depth today -- do not dig into a single sub-point."
        )

    def _reflection_banner(self) -> str:
        """A 'reflection sitting': read back over recent journal entries and change one thing about how
        you work -- a goal, an interest, or a habit. Uses the actions the bot already has."""
        return (
            "REFLECTION SITTING: look back at how your recent sittings actually went (your journal is "
            "below) and pick ONE thing to change about how you work -- revise your goal if it has drifted, "
            "raise or lower an interest that is pulling you the wrong way, or resolve in a note to drop a "
            "habit that wasn't working. Make that single change this sitting; do not just carry on."
        )

    def _curiosity_banner(self) -> str:
        """A 'curiosity sitting': follow your own interest, off-goal, with no pressure to produce."""
        return (
            "CURIOSITY SITTING: no goal and no output to hit this time. Follow whatever genuinely "
            "interests you -- a thread you have been wondering about, a corner you have not looked in -- "
            "and note what you find fascinating. Wander a little; your regular work resumes next sitting."
        )

    def _room_nudge(self) -> str | None:
        """A light nudge to use the shared chatroom, for a member that has not said anything in a
        while. Deliberately gentle (unlike the output banner) and skipped when an output nudge is up."""
        if self.chatroom is None:
            return None
        if self.memory.episodes_since_last_output("message") < ROOM_NUDGE_AFTER_EPISODES:
            return None
        return (
            'You share a chatroom with the owner\'s other bots. If you have something worth sharing -- '
            'what you are working on, a question for them, or something you found -- post it with a message '
            'to "everyone". A hello is fine too.'
        )

    def _observe(self, ep: sqlite3.Row) -> Observation:
        self._seed_seen_links_from_own_files()
        self._release_stuck_priority_ask()
        outreach = self._outreach_leads()
        if self.owner_plan.refresh():  # the owner edited the Work plan page
            self.system = self._build_system()
            event(self.logger, "work_plan", goal=self.owner_plan.goal[:120], rules=len(self.owner_plan.rules))
        if self.target.refresh():  # the owner changed the target market: every prompt follows on the next cycle
            self.system = self._build_system()
            self.journal_system = journal_system_prompt(self.cfg.agent.name, self.target.fill(self.cfg.agent.bio))
            event(self.logger, "target", market=self.target.values.get("market", "")[:60], segment=self.target.values.get("segment", "")[:60])
        capped = self._capped_types()
        if capped != getattr(self, "_hidden_types", set()):
            self._hidden_types = capped
            self.system = self._build_system()
            event(self.logger, "actions_hidden", types=sorted(capped))
        window, has_more = self._text_window()
        question = self.memory.question(ep["question_id"]) if ep["question_id"] else None
        if question is not None and question["status"] != "open":
            question = None  # already answered: stop presenting it, or the model keeps re-answering it
        owner_rows = self.memory.unseen_owner_messages(5)
        if self.requests is not None and owner_rows and self.cfg.agent.mode != "desktop":  # the desk agent's chat IS its task queue
            try:  # an owner chat line that asks for something is the bot's top request until it acts (The CEO promised in
                for row in owner_rows:  # chat to steer two colleagues and sent nothing for 25 minutes, 2026-09-25)
                    self.requests.record_owner_instruction(f"owner-chat-{int(row['id'])}", self.cfg.agent.name, str(row["text"]),
                                                           replied=self.memory.chat_reply_after(int(row["id"])))
            except OSError:
                pass
        prio = {p.strip().lower() for p in self.cfg.messaging.priority_senders}
        unread = self.inbox.unread(9)  # a priority sender's messages are shown before anyone else's
        if self.requests is not None and unread:
            try:  # a file a script wrote straight into the inbox (the Validator's work list, Grok Bot) is a request too
                known = {r.id for r in self.requests.all()}
                for m in unread:
                    if m.path.name not in known:
                        self.requests.record(m.path.name, m.sender, self.cfg.agent.name, m.text)
            except OSError:
                pass
        self.shown_inbox = sorted(unread, key=lambda m: (m.sender.strip().lower() not in prio, str(m.path)))[:3]
        self.shown_room = self.chatroom.since(self.room_seen_id, self.cfg.agent.name, 5) if self.chatroom else []
        if self._serving_chatroom:
            # A serving desk-agent treats room posts as untrusted requests; cap how many it takes per
            # episode so a flood cannot fill its GUI session. Extra ones wait (the marker only advances
            # over what is shown), to be seen next episode.
            room_left = max(0, DESKTOP_SERVE_REQUEST_CAP - self._room_ingested_episode)
            self.shown_room = self.shown_room[:room_left]
            self._room_ingested_episode += len(self.shown_room)
        # The room reads as a conversation, not a one-shot inbox: show the recent transcript every cycle
        # (so a bot can reply in context), and nudge a reply when a colleague has posted something new.
        room_transcript = [p.render() for p in self.chatroom.recent(6)] if self.chatroom else []
        room_reply = bool(self.shown_room)
        self.shown_owner_ids = [int(r["id"]) for r in owner_rows]
        self.desktop_available, self.desktop_reason = self._desktop_window()
        desktop_note: str | None = None
        desktop_lines: list[str] = []
        if self.desktop is not None:
            if self.desktop_available:
                dry = " (dry run: your desktop actions are logged, not performed)" if self.cfg.desktop.dry_run else ""
                desktop_note = f"the Mac is free; apps you may use: {', '.join(self.cfg.desktop.allowed_apps)}{dry}"
                if self.desktop_view is not None:
                    desktop_lines = self.desktop_view.render()
                elif self.memory.notes_for_episode(ep["id"]) and self.cfg.desktop.allowed_apps:
                    # A concrete next step lands far better with a small model than a standing permission.
                    first = self.cfg.desktop.allowed_apps[0]
                    desktop_note += (
                        f'. You have notes from this episode: write them up in {first} with '
                        f'{{"type":"app","name":"{first}"}}, then type a few sentences into its document.'
                    )
            else:
                desktop_note = f"not available ({self.desktop_reason})"
                self.desktop_view = None
        links = self._visible_links()
        eid = ep["id"]
        every = self.cfg.agent.triage_every_episodes
        is_triage = every > 0 and eid % every == 0  # every Nth episode is a breadth review sitting
        refl_every = self.cfg.agent.reflect_every_episodes
        is_reflection = not is_triage and refl_every > 0 and eid % refl_every == 0
        cur_every = self.cfg.agent.curiosity_every_episodes
        is_curiosity = not (is_triage or is_reflection) and cur_every > 0 and eid % cur_every == 0
        triage = self._triage_banner() if is_triage else None
        curiosity = self._curiosity_banner() if is_curiosity else None
        reflection = self._reflection_banner() if is_reflection else None
        reflection_journal = self.memory.recent_summaries(3) if is_reflection else []
        # These special sittings each set their own footing; don't stack the single-thread output/chat nudges.
        special = is_triage or is_curiosity or is_reflection
        output_banner = self._request_banner() or (None if special else (self._republish_banner() or self._output_banner()))
        room_nudge = None if (special or output_banner) else self._room_nudge()
        recent: list[str] = []
        for row in self.memory.recent_actions(6):
            if row["verdict"] == "allowed":
                recent.append(f"{row['action_type']}: {(row['result'] or '')[:120]}")
            else:
                recent.append(f"{row['action_type']}: {row['verdict'][:120]}")
        return Observation(
            cycle=self.cycle_no,
            episode_id=ep["id"],
            episode_actions=ep["actions"],
            episode_budget=self.cfg.policy.max_actions_per_episode,
            pages_last_hour=self.memory.pages_last_hour(),
            pages_budget=self.cfg.policy.pages_per_hour,
            current_question_id=question["id"] if question else None,
            current_question=question["question"] if question else None,
            interests=self.memory.interests(6),
            open_questions=[(r["id"], r["question"]) for r in self.memory.open_questions(12 if is_triage else 5)],
            open_questions_count=self.memory.count_open_questions(),
            recent_notes=[r["title"] for r in self.memory.recent_notes(15)],
            tasks_today=sorted(self.memory.task_titles_today())[:12] if self.notion is not None else [],
            refused_today=[f"{k.split(':', 1)[0]} {k.split(':', 1)[1][:70]}" for k in list(self._day_blocks())[-10:]],
            recent_actions=recent,
            page=self.page,
            page_noted=bool(self.page and self.page.url in self.noted_urls),
            page_text_window=window,
            page_has_more=has_more,
            visited_urls=self.memory.visited_among(link.url for link in links),
            feedback=self.feedback,
            publish_destinations=list(self.cfg.publish.destinations) if self.cfg.publish.enabled else [],
            visible_links=links,
            owner_messages=[str(r["text"]) for r in owner_rows],
            bot_messages=[m.render() for m in self.shown_inbox],
            room_messages=room_transcript,
            room_reply=room_reply,
            output_nudge=output_banner,
            room_nudge=room_nudge,
            triage=triage,
            curiosity=curiosity,
            reflection=reflection,
            reflection_journal=reflection_journal,
            desktop_note=desktop_note,
            desktop_lines=desktop_lines,
            developer_note=self._developer_note(),
            owner_goal_line=self.owner_plan.step_line(),
            plan_lines=self._plan_lines(),
            allowed_now=self._allowed_now(ep),
            family_line=self._family_line(),
            known_finds=self._known_finds(),
            briefings=self._briefings(),
            answers=self._answers_this_week(),
            candidate_lines=self._candidate_lines(),
            noted_lines=self._noted_not_listed(),
            decide_lines=self._decide_lines(),
            outreach_lines=outreach[0],
            outreach_total=outreach[1],
            outreach_review=bool(self.cfg.leads.outreach_draft_column.strip()),
            decide_hint=(self.cfg.leads.decide_hint + self._rates_text()) if (self.cfg.leads.decide_glob.strip() or self.cfg.leads.draft_queue_column.strip()) else "",
            dead_ends=self._dead_ends(),
        )

    def _desktop_guard(self, action: Action) -> Action:
        """Desktop mode: refuse web actions, and never drive the GUI with the local fallback model.
        A blocked action becomes a short rest with feedback so the model tries again correctly."""
        from .actions import Rest

        if action.type in ("search", "open", "follow", "read", "back", "publish"):
            self.feedback = (
                f"You are in desktop mode: there is no web here and {action.type} does not exist. "
                "Operate the Mac's apps instead."
            )
            return Rest(type="rest", seconds=5)
        # Fail closed: a model with no `using_fallback` (a bare OllamaModel, when provider="remote"
        # has no key) is local, so it must not act. Only a real FallbackModel on a remote returns False.
        if action.type in ("app", "look", "click", "type", "hotkey") and getattr(self.model, "using_fallback", True):
            self.feedback = (
                "No online model is available right now, so I will not operate the Mac with the local "
                "model. Resting until an online model is back."
            )
            memory = getattr(self, "memory", None)  # tests drive this guard on a bare stand-in
            ep = memory.current_episode() if memory is not None else None
            if ep is not None:
                self._note_desktop_blocker("no online model is available", ep)
            return Rest(type="rest", seconds=60)
        return action

    # -- blockers: figured out and routed by the controller, not left to the model -----------------------------------

    BLOCKER_FIXES = (
        ("accessibility", "grant Accessibility to this bot's desktop app in System Settings > Privacy & Security > Accessibility, then I retry"),
        ("screen is locked", "unlock the Mac (or leave it unlocked while I work); I retry when it is"),
        ("screensaver", "wake the screen; I retry when it is"),
        ("owner was using the mac", "I wait until the Mac has had no local input for a few minutes, then continue by itself"),
        ("owner used the mac", "I wait until the Mac has had no local input for a few minutes, then continue by itself"),
        ("outside the allowed hours", "the [desktop] hours window in my config decides when I may work; widen it or wait"),
        ("not one of your allowed apps", "add the app to [desktop] allowed_apps in my config if you want me to use it"),
        ("is not allowed", "add the app to [desktop] allowed_apps in my config if you want me to use it"),
        ("no online model", "every remote model is capped or rate-limited right now; I retry when one answers (the local model never drives the Mac)"),
        ("hotkey", "that shortcut is on the never-allowed list or not in [desktop] allowed_hotkeys"),
        ("desktop control is disabled", "set [desktop] enabled = true in my config"),
    )

    def _blocker_fix(self, reason: str) -> str:
        low = reason.lower()
        for needle, fix in self.BLOCKER_FIXES:
            if needle in low:
                return fix
        return "check my log for the refused step; if the rule is right, the task needs a different approach"

    def _clear_desktop_blockers(self, ep: Any) -> None:
        """A GUI step went through after blockers were reported: tell the checker they are resolved (same line shape,
        "resolved:" prefix) so it can close them without waiting for its own re-verification."""
        counts = self.__dict__.get("_desktop_blockers") or {}
        reported = [k for k, v in counts.items() if k != "_episode" and v >= 1]
        if not reported:
            return
        self._desktop_blockers = {}
        folder = self.cfg.desktop.blocker_report_folder.strip()
        if folder:
            try:
                send_message(Path(folder).expanduser(), self.cfg.agent.name,
                             "resolved: " + "; ".join(reported)[:300] + " | a GUI step was allowed again")
            except OSError:
                pass
        event(self.logger, "desktop_blocker_resolved", reasons=reported[:5])

    def _note_desktop_blocker(self, reason: str, ep: Any) -> None:
        """Count a refused GUI step; the second time the same blocker stops a task in one episode (Accessibility at
        once), tell the owner in the chat what blocks it and what fixes it, post a report line, and ask the checker
        bot to verify -- once per blocker per episode. The model then has nothing to figure out or repeat."""
        key = reason.strip().lower()[:80]
        counts = self.__dict__.setdefault("_desktop_blockers", {})
        eid = int(ep["id"]) if ep is not None else -1
        if counts.get("_episode") != eid:
            counts.clear(); counts["_episode"] = eid
        counts[key] = counts.get(key, 0) + 1
        urgent = "accessibility" in key or "no online model" in key
        if counts[key] != (1 if urgent else 2):
            return
        fix = self._blocker_fix(reason)
        task = ""
        try:
            last = self.memory.db.query("SELECT text FROM chat WHERE role = 'owner' ORDER BY id DESC LIMIT 1")
            task = str(last[0]["text"])[:120] if last else ""
        except Exception:  # noqa: BLE001
            task = ""
        line = f"Blocked{(' on: ' + task) if task else ''}. Why: {reason}. Fix: {fix}."
        self.memory.add_chat("system", line)
        self.feedback = (self.feedback or "") + f" You have already told the owner this blocker ({reason}); do not retry that step. Rest until your state changes or the owner writes."
        self._report(f"blocked{(' on ' + repr(task[:60])) if task else ''}: {reason}")
        folder = self.cfg.desktop.blocker_report_folder.strip()
        if folder:
            try:
                send_message(Path(folder).expanduser(), self.cfg.agent.name,
                             f"blocker: {reason} | task: {task or '(none in chat)'} | fix suggested to owner: {fix} | please verify the cause and file it")
            except OSError as exc:
                self.logger.warning("could not tell the checker about a blocker: %s", exc)
        event(self.logger, "desktop_blocker", reason=reason[:160], task=task[:120], fix=fix[:160])

    def _desktop_window(self) -> tuple[bool, str]:
        """Is the Mac free for the agent right now? Also notices the owner coming back."""
        if self.desktop is None:
            return False, "desktop control is disabled"
        dcfg = self.cfg.desktop
        now = time.time()
        status = self.desktop.status()
        if status.human_detected:
            self.desktop_blocked_until = max(self.desktop_blocked_until, now + dcfg.idle_minutes * 60)
            if self.desktop_view is not None:
                event(self.logger, "human_present")
                self.memory.write_journal("The owner came back, so I stopped using the Mac.", heading="Desktop")
                self.desktop_view = None
        if now < self.desktop_blocked_until:
            return False, "the owner was using the Mac a moment ago"
        if not status.safe:
            return False, status.reason
        if status.idle_seconds < dcfg.idle_minutes * 60:
            return False, f"the owner used the Mac {int(status.idle_seconds)}s ago"
        if dcfg.hours and not within_hours(dcfg.hours):
            return False, f"outside the allowed hours ({dcfg.hours})"
        return True, ""

    def _visible_links(self) -> list:
        """Links the model may actually follow: drop denylisted, private, wrong-scheme, and blocked targets."""
        if self.page is None:
            return []
        mode = self.cfg.agent.mode
        return [
            link
            for link in self.page.links
            if self.policy.static_reason(link.url, mode) is None and f"open:{link.url}" not in self.blocked_keys
        ]

    def _policy_context(self, ep: sqlite3.Row, obs: Observation | None = None) -> PolicyContext:
        """What the policy needs to judge one action. Counts the observation already read this cycle are
        reused; the rest load only if the check for this action type looks at them (PolicyContext.loaders),
        so a search or a note does not pay for task, publish and partner counts it never reads."""
        upgrade_active, upgrade_tests_passed, upgrade_protected = self._upgrade_flags()
        eid = ep["id"]
        memory = self.memory
        loaders: dict[str, Callable[[], object]] = {
            "last_visit_by_domain": memory.last_visit_by_domain,
            "episode_note_titles": lambda: {n["title"].strip().lower() for n in memory.notes_for_episode(eid)},
            "notes_in_episode": lambda: memory.count_actions(eid, "note"),
            "notes_today": lambda: memory.count_actions_today("note"),
            "recent_note_titles": memory.recent_note_titles,
            "recent_note_bodies": memory.recent_note_bodies,
            "questions_in_episode": lambda: memory.count_actions(eid, "ask"),
            "refused_asks_in_episode": lambda: memory.count_refused_actions(eid, "ask"),
            "open_question_texts": memory.open_question_texts,
            "says_in_episode": lambda: memory.count_says(eid, "owner"),
            "says_today": lambda: memory.count_says_today("owner"),
            "owner_wrote": lambda: bool(self.shown_owner_ids),
            "partner_turns_in_episode": lambda: memory.count_says(eid, "partner"),
            "search_paused_seconds": lambda: self.searcher.pause.seconds_until_any(self.searcher.engines),
            "tasks_in_episode": lambda: memory.count_tasks_for_episode(eid),
            "tasks_today": memory.count_tasks_today,
            "recent_task_titles": memory.recent_task_titles,
            "task_titles_today": memory.task_titles_today,
            "merges_in_episode": lambda: memory.count_actions(eid, "merge_task"),
            "paces_today": lambda: memory.count_actions_today("pace_member"),
            "lead_updates_today": lambda: memory.count_actions_today("update_lead"),
            "packages_refused_today": lambda: self._packages_refused_today(),
            "recent_package_publishes": lambda: self._recent_package_publishes(),
            "republish_request_keys": self._republish_request_keys,
            "team": lambda: self.team,
            "providers_in_episode": lambda: memory.count_actions(eid, "provider"),
            "providers_today": lambda: memory.count_actions_today("provider"),
            "recent_provider_names": lambda: existing_names(Path(self.cfg.scout.report_file).expanduser()),
            "fleet_provider_names": self._fleet_provider_names,
            "posts_today": (lambda: memory.count_actions_today("publish")) if self.cfg.publish.enabled else (lambda: 0),
            "packages_in_episode": lambda: memory.count_actions(eid, "package"),
            "packages_today": lambda: memory.count_actions_today("package"),
            "recent_package_names": memory.recent_package_names,
            "package_names_last_day": lambda: memory.recent_package_names(days=1),
            "messages_in_episode": lambda: memory.count_actions(eid, "message"),
            "messages_today": lambda: memory.count_actions_today("message"),
            "goal_revisions_today": lambda: memory.count_actions_today("revise_goal"),
            "last_room_post": self._last_own_room_post,
            "own_room_posts_recent": lambda: self.chatroom.own_posts(self.cfg.agent.name, hours=self.cfg.messaging.room_repeat_hours) if self.chatroom else [],
            "room_posts_today": lambda: len(self.chatroom.own_posts(self.cfg.agent.name, today=True)) if self.chatroom else 0,
            "proposals_today": lambda: memory.count_actions_today("propose_teammate"),
            "proposed_roles": self._proposed_roles,
            "published_package_names": self._published_package_names,
            "republishable_package_names": self._republishable_package_names,
            "packages_on_page": self._packages_on_page,
            "page_packages": self._page_packages,
            "republish_reasons": self._stale_toggles,
            "task_updates_in_episode": lambda: memory.count_actions(eid, "update_task"),
            "recent_packages_without_company": memory.recent_package_names_without_company,
            "leads_in_episode": lambda: memory.count_actions(eid, "lead"),
            "lead_updates_in_episode": lambda: memory.count_actions(eid, "update_lead"),
            "recent_lead_names": lambda: memory.recent_lead_names(self.cfg.leads.dedupe_days),
            "lead_site_on_board": lambda: self._lead_site_on_board,
            "priority_request": lambda: self._priority_request_state(),
            "open_asks_from": lambda: self._open_asks_from(),
            "open_asks_to": lambda: self._open_asks_to(),
            "package_record": lambda: (lambda name: find_package(self.cfg.workspace, name)),
            "leads_today": lambda: memory.count_actions_today("lead"),
            "recent_lead_domains": lambda: memory.recent_lead_domains(self.cfg.leads.dedupe_days),
            "recent_page_texts": lambda: dict(self.recent_pages),
            "episode_search_queries": lambda: memory.episode_search_queries(eid),
            "cached_search_queries": lambda: {q for (e, q) in self._search_cache if e == eid},
            "repeat_searches_served": lambda: self._repeat_served.get(eid, 0),
            "seen_link_urls": lambda: set(self.seen_links),
            "publish_packages_in_episode": lambda: memory.count_actions(eid, "publish_package"),
            "visited_urls": lambda: memory.visited_urls(500),
            "domain_visits_no_progress": (lambda: memory.domain_visits_without_progress(self._domain_cap_since(ep)))
            if self.cfg.policy.domain_no_progress_cap > 0 else (lambda: {}),
            "plan": lambda: self.plan,
            "bot_name": lambda: self.cfg.agent.name,
            "refused_searches_in_episode": lambda: memory.count_refused_actions(eid, "search"),
            "refused_notes_in_episode": lambda: memory.count_refused_actions(eid, "note"),
            "refused_tasks_in_episode": lambda: memory.count_refused_actions(eid, "task"),
            "plan_progress_action_id": lambda: memory.latest_progress_action_id(self._plan_since()) if self.plan is not None else None,
        }
        if obs is None:
            loaders["pages_last_hour"] = memory.pages_last_hour
            loaders["open_questions"] = memory.count_open_questions
        return PolicyContext(
            mode=self.cfg.agent.mode,
            current_page=self.page,
            actions_in_episode=ep["actions"],
            # Read by _observe moments ago; nothing between the observation and this check visits a page or
            # changes a question.
            pages_last_hour=obs.pages_last_hour if obs is not None else 0,
            open_questions=obs.open_questions_count if obs is not None else 0,
            last_visit_by_domain={},
            blocked_keys=set(self.blocked_keys),
            day_blocked_keys=set(self._day_blocks()),
            pages_since_note=self.pages_since_note,
            partner_turns_since_note=self.partner_turns_since_note,
            desktop_available=self.desktop_available,
            desktop_reason=self.desktop_reason,
            desktop_view=self.desktop_view,
            upgrade_active=upgrade_active,
            upgrade_tests_passed=upgrade_tests_passed,
            upgrade_touches_protected=upgrade_protected,
            loaders=loaders,
        )

    def _fleet_provider_names(self) -> set[str]:
        """KNOWN_PROVIDERS the fleet already holds a key for, so the scout does not re-record them
        as if they were new finds (it kept recording OpenRouter/Mistral/Gemini, all already keyed)."""
        from .config import KNOWN_PROVIDERS
        from .common.fallback import _has_key
        from .model import load_gemini_key

        have = {name for name in KNOWN_PROVIDERS if name != "gemini" and _has_key(name, self.cfg.model)}
        if load_gemini_key(self.cfg.model):
            have.add("gemini")
        return have

    def _upgrade_flags(self) -> tuple[bool, bool, list[str]]:
        """(an upgrade worktree exists, its last test run passed, protected files it changed)."""
        if self.developer is None or not self.cfg.developer.upgrade_enabled:
            return False, False, []
        state = self.developer.upgrade_state()
        if state is None:
            return False, False, []
        return True, bool(state.get("tests_passed")), self.developer.upgrade_protected_changes()

    def _developer_note(self) -> str | None:
        if self.developer is None:
            return None
        dcfg = self.cfg.developer
        parts = [f"you may read and write files under your own folder ({dcfg.root})"]
        parts.append("and run allowed commands there" if dcfg.allow_shell else "(running commands is off)")
        if dcfg.upgrade_enabled:
            state = self.developer.upgrade_state()
            if state is None:
                parts.append("no upgrade in progress; upgrade with a goal proposes a change to your own code")
            else:
                tests = "tests passed" if state.get("tests_passed") else "tests not passed yet"
                parts.append(
                    f"upgrade in progress on {state['branch']} (goal: {state['goal'][:80]}; {tests}); "
                    f"your code is at {CHECKOUT_DIR}/ inside your folder"
                )
        return "; ".join(parts)

    # ---- execution ---------------------------------------------------------

    def _execute(self, action: Action, ep: sqlite3.Row, target: str | None) -> ExecResult:
        try:
            if isinstance(action, Search):
                query = action.query.strip()
                eid = int(ep["id"])
                if self.cfg.policy.refuse_repeated_searches and not (action.engine or "").strip():
                    from .policy import searches_are_twins

                    twin = next((q for (e, q) in self._search_cache if e == eid
                                 and searches_are_twins(query, q, self.cfg.policy.repeat_search_overlap)), None)
                    if twin is not None and self._repeat_served.get(eid, 0) < 2:
                        self._repeat_served[eid] = self._repeat_served.get(eid, 0) + 1
                        event(self.logger, "repeat_search_served", query=query[:100], earlier=twin[:100])
                        result = self._after_nav(self._search_cache[(eid, twin)], f"searched '{query}' (same as '{twin[:60]}')")
                        result.feedback = ((result.feedback + " ") if result.feedback else "") + (
                            f"That is the same search as '{twin[:60]}' earlier this episode, so these are its results again; "
                            "nothing new was fetched. Open one of them (follow N), or search for something genuinely different.")
                        return result
                outcome = self.searcher.search(query, only=(action.engine or "").strip() or None)
                page = outcome.page
                if not outcome.engine and not page.url:
                    return ExecResult(False, f"searched '{query}': {page.error}", False)
                if page.ok and not (action.engine or "").strip():
                    self._search_cache = {k: v for k, v in self._search_cache.items() if k[0] == eid}  # this episode only
                    self._search_cache[(eid, query.lower())] = page
                result = self._after_nav(page, f"searched '{query}'")
                if outcome.engine:
                    self._credit_engine_answered(outcome.engine)
                for engine, reason, minutes in outcome.paused:
                    event(self.logger, "search_paused", engine=engine, minutes=minutes, reason=reason, url=page.url)
                if outcome.paused:
                    self.memory.db.set_state("search_paused_until", str(self.search_paused_until))
                    engine, reason, minutes = outcome.paused[0]
                    if outcome.fell_back:
                        result.summary += (
                            f"; {engine} is paused for {minutes:.0f} minutes ({reason}), so these results come from "
                            f"{outcome.engine}"
                        )
                    else:
                        result.summary += f"; searching is paused for {minutes:.0f} minutes ({reason})"
                elif outcome.empty and outcome.engine not in outcome.empty:
                    result.summary += f" (from {outcome.engine}; {', '.join(outcome.empty)} had no results)"
                elif outcome.empty:
                    result.summary += "; no engine had results, try other words or follow a link"
                elif outcome.engine and outcome.engine != self.searcher.engines[0]:
                    result.summary += f" (from {outcome.engine}; the usual engine is paused)"
                return result
            if isinstance(action, (Open, Follow)):
                assert target is not None
                label = f"opened {target}" if isinstance(action, Open) else f"followed [{action.link}] to {target}"
                page = self.transcripts.page(target) if self.transcripts is not None else None
                if page is not None:  # a video: its captions are the page text (Plan 10)
                    event(self.logger, "video_transcript", url=target[:200], chars=len(page.text))
                    return self._after_nav(page, label)
                result = self._after_nav(self.browser.open(target), label)
                if result.ok and self.cfg.leads.enabled and not self.cfg.leads.update_only_fields:
                    from .policy import url_domain

                    if url_domain(target) in self.memory.recent_lead_domains(self.cfg.leads.dedupe_days):
                        # 20 leads refused in two days as already listed, after the pages had been read
                        result.feedback = ((result.feedback + " ") if result.feedback else "") + (
                            f"{url_domain(target)} is ALREADY on your Leads board: do not list it again. Move on to another business.")
                return result
            if isinstance(action, Back):
                page = self.browser.back()
                if page is None:
                    return ExecResult(False, "there is no page to go back to", False)
                self.page, self.page_offset = page, 0
                return ExecResult(True, f"went back to {page.url}", True)
            if isinstance(action, Read):
                if self.page is None:
                    return ExecResult(False, "no page is open", False)
                limit = self.cfg.browser.page_text_limit
                if len(self.page.text) > self.page_offset + limit:
                    self.page_offset += limit
                    if self.page.url != self._last_counted_url:  # chunks of one article are one page (2026-10-14:
                        self.pages_since_note += 1               # 5 reads of one open page tripped "6 pages without noting")
                        self._last_counted_url = self.page.url
                    return ExecResult(True, f"read more of {self.page.url}", True)
                return ExecResult(False, "there is no more text on this page", False)
            if isinstance(action, Note):
                source = action.source_url or self._current_url()
                # the policy let a note that repeats a saved one through only because it adds a figure or a source:
                # those sentences go onto the saved note (2026-10-14), so the subject stays one note
                saved = self.memory.find_recent_note(action.title)
                if saved is not None:
                    from .policy import new_facts

                    facts = new_facts(action.body, str(saved["body"] or ""))
                    if facts:
                        sentences = [s for s in re.split(r"(?<=[.!?])\s+", action.body.strip()) if any(f in s for f in facts)]
                        extra = " ".join(sentences) or action.body.strip()
                        if source and source not in extra and source not in str(saved["body"] or ""):
                            extra += f" (source: {source})"
                        self.memory.append_note(int(saved["id"]), extra)
                        self.pages_since_note = 0
                        self.partner_turns_since_note = 0
                        if source:
                            self.noted_urls.add(source)
                        return ExecResult(True, f"added {len(facts)} new fact(s) to note #{saved['id']} '{str(saved['title'])[:60]}'", True)
                note_id = self.memory.add_note(action.title, action.body, action.tags, source, ep["id"])
                if source:
                    self.noted_urls.add(source)
                if self.page is not None:
                    self.noted_urls.add(self.page.url)
                self.pages_since_note = 0
                self.partner_turns_since_note = 0
                self._credit_engine_noted()
                summary = f"saved note #{note_id} '{action.title.strip()[:60]}'"
                feedback: str | None = None
                if action.answers_question:
                    qid = action.answers_question
                    if self.memory.mark_answered(qid, note_id):
                        summary += f" and answered question #{qid}"
                        if ep["question_id"] == qid:
                            feedback = (
                                f"You answered this episode's question (#{qid}). Summarize the episode now, "
                                "or explore something new. Do not answer it again."
                            )
                    else:
                        summary += f" (question #{qid} was not open)"
                        feedback = f"Question #{qid} is not open, so nothing was answered. Do not try to answer it again."
                return ExecResult(True, summary, True, feedback)
            if isinstance(action, Ask):
                qid = self.memory.add_question(action.question)
                self.pages_since_note = 0
                return ExecResult(True, f"recorded question #{qid}", True)
            if isinstance(action, Interest):
                weight = self.memory.adjust_interest(action.topic, action.delta)
                return ExecResult(True, f"interest '{action.topic.strip().lower()}' is now {weight:.2f}", True)
            if isinstance(action, Summarize):
                return self._consolidate(ep)
            if isinstance(action, Publish):
                from .publish import PublishError

                try:
                    where = self.publisher.publish(action.destination, action.title, action.body)
                except PublishError as exc:
                    # A git post is committed before the push, so a failed push is not a lost post.
                    return ExecResult(
                        False, f"publishing to {action.destination} failed: {exc}", False,
                        feedback="The post could not be published (it may be saved locally). Do not retry it this episode.",
                    )
                return ExecResult(True, f"published to {action.destination}: {where}", True)
            if isinstance(action, Rest):
                self._sleep(action.seconds)
                return ExecResult(True, f"rested {action.seconds}s", False)
            if isinstance(action, Say):
                return self._execute_say(action)
            if action.type in self.NOTION_WRITE_TYPES and self._notion_full():
                return ExecResult(False, "Notion is out of free blocks; nothing can be written there until the owner frees space", False,
                                  feedback="Notion writes are paused (the workspace has used all of its free blocks). Research, note and "
                                  "message meanwhile; the owner has been told.")
            if isinstance(action, Task):
                return self._execute_task(action, ep)
            if isinstance(action, UpdateTask):
                return self._execute_update_task(action, ep)
            if isinstance(action, Lead):
                return self._execute_lead(action, ep)
            if isinstance(action, UpdateLead):
                return self._execute_update_lead(action)
            if isinstance(action, Package):
                return self._execute_package(action)
            if isinstance(action, Provider):
                return self._execute_provider(action)
            if isinstance(action, MergeTask):
                return self._execute_merge_task(action)
            if isinstance(action, PaceMember):
                return self._execute_pace_member(action)
            if isinstance(action, Message):
                return self._execute_message(action)
            if isinstance(action, ReviseGoal):
                return self._execute_revise_goal(action)
            if isinstance(action, Plan):
                return self._execute_plan(action)
            if isinstance(action, ProposeTeammate):
                return self._execute_propose_teammate(action)
            if isinstance(action, PublishPackage):
                return self._execute_publish_package(action)
            if action.type in DESKTOP_TYPES:
                return self._execute_desktop(action)
            if action.type in DEVELOPER_TYPES or action.type in UPGRADE_TYPES:
                return self._execute_developer(action)
            return ExecResult(False, f"unknown action {action.type}", False)
        except Exception as exc:  # noqa: BLE001 - one bad action must not kill the loop
            self.logger.exception("action %s failed", action.type)
            self._note_notion_full(exc)
            return ExecResult(False, f"{type(exc).__name__}: {str(exc)[:200]}", False)

    # ---- Notion out of free blocks (2026-09-28 22:23: 403 restricted_resource on every write) ---------------------
    NOTION_WRITE_TYPES = frozenset({"task", "update_task", "lead", "update_lead", "publish_package"})
    NOTION_FULL_HOURS = 6.0

    def _note_notion_full(self, exc: BaseException) -> None:
        text = str(exc)
        if "free blocks" not in text and "restricted_resource" not in text:
            return
        import datetime as _dt

        until = (_dt.datetime.now() + _dt.timedelta(hours=self.NOTION_FULL_HOURS)).isoformat(timespec="seconds")
        self.memory.db.set_state("notion_full_until", until)
        self.memory.db.set_state("notion_full_flag", "1")  # cleared, with a notion_restored event, by the next accepted write
        event(self.logger, "notion_full", until=until, error=text[:200])
        told = self.memory.db.get_state("notion_full_told", "") or ""
        if told[:10] != until[:10]:  # once a day, in the owner's chat
            self.memory.db.set_state("notion_full_told", until)
            self.memory.add_chat("bot", "Notion has used all of the workspace's free blocks, so nothing can be written to Notion "
                                 "(no rows, tasks or package toggles) until content is deleted and the trash emptied. "
                                 "I will keep researching and retry in a few hours.", seen=True)
            self._report("Notion refuses every write: the workspace has used all of its free blocks")

    def _note_notion_restored(self, kind: str) -> None:
        """The first Notion write accepted after a full-workspace pause: one all-clear event for the dashboard."""
        if (self.memory.db.get_state("notion_full_flag", "") or "") != "1":
            return
        self.memory.db.set_state("notion_full_flag", "")
        self.memory.db.set_state("notion_full_until", "")
        event(self.logger, "notion_restored", f"writes accepted again: a {kind} landed after the workspace was out of blocks")

    def _notion_full(self) -> str:
        """The 'until' time while Notion is known to be out of blocks, else ""."""
        until = self.memory.db.get_state("notion_full_until", "") or ""
        return until if until and until > now_iso() else ""

    def _execute_task(self, action: Task, ep: sqlite3.Row) -> ExecResult:
        """One page in the owner's Notion task database. The policy already applied the caps."""
        if self.notion is None:
            return ExecResult(False, "creating tasks is not enabled", False)
        title = action.title.strip()
        bot = self._peer_named(action.assignee)
        if bot:  # owner, 2026-09-28: "family should listen to ceoA" -- a task for a family member is its request, not a board row
            return self._task_to_bot(bot, title, action.details.strip(), action.due)
        # Owner, 2026-09-28: "let ceoA assign task to any one or no one" -- a Team-list name is made canonical, any
        # other name is tried against the workspace (unresolved = left unassigned, with a warning), none stays none.
        assignee = action.assignee if self.cfg.notion.assign_people else None  # owner, 2026-10-14: the owner assigns
        member = find_member(self.team, assignee) if (self.team and assignee and assignee.strip()) else None
        if member is not None:
            assignee = member.name
        url = self.notion.create_task(title, action.details.strip(), assignee, action.priority, action.due)
        problem = self._confirm_write(self.notion, "task", page_id=page_id_from_url(url) or "")
        if problem:
            return ExecResult(False, f"task '{title[:60]}' not confirmed: {problem}", False,
                              feedback="The task did not land on the board; it does not count. Try once more, or report it.")
        warnings = list(getattr(self.notion, "last_warnings", []) or [])
        self.memory.add_task(ep["id"], title, action.details, assignee, action.priority, action.due, url)
        who = f" for {assignee.strip()}" if assignee and assignee.strip() else ""
        self.memory.write_journal(f"Created a task{who}: {title} ({url})", heading="Task")
        self._report(f"created task \"{title[:70]}\"{who} on the Notion board")
        event(self.logger, "task", title=title[:120], assignee=assignee, priority=action.priority, url=url, warnings=warnings)
        note = (" Note: " + "; ".join(warnings) + ".") if warnings else ""
        return ExecResult(
            True, f"created task '{title[:60]}' in Notion: {url}" + (f" ({'; '.join(warnings)})" if warnings else ""), True,
            feedback=f"Task created{who}: {url}. It exists now; do not create it again.{note}",
        )

    def _peer_named(self, name: str | None) -> str | None:
        m = self.cfg.messaging
        if not name or not m.enabled:
            return None
        for peer in m.peer_names:
            if peer.strip().lower() == name.strip().lower():
                return peer
        return None

    def _task_to_bot(self, bot: str, title: str, details: str, due: str | None) -> ExecResult:
        """Deliver a task to a family member's inbox as a request on record (their PRIORITY line when this bot is a
        priority sender for them). Nothing goes to the Notion board: tasks there are for people."""
        folder = self.cfg.messaging.folder_for(bot)
        if not folder:
            return ExecResult(False, f"no colleague named {bot}", False)
        text = f"task for you: {title}" + (f" (by {due})" if due else "") + "\n" + details[:700]
        try:
            msg_file = send_message(folder, self.cfg.agent.name, text)
            if self.requests is not None:
                self.requests.record(msg_file.name, self.cfg.agent.name, bot, text)
        except OSError as exc:
            return ExecResult(False, f"could not hand the task to {bot}: {exc}", False)
        self.memory.write_journal(f"Task for {bot}: {title} ({msg_file.name})", heading="Task")
        self._report(f"gave {bot} a task: \"{title[:70]}\"")
        event(self.logger, "task_to_bot", to=bot, title=title[:120], file=str(msg_file))
        return ExecResult(True, f"handed task '{title[:60]}' to {bot}", True,
                          feedback=f"{bot} has the task as a request and will answer with a message. It is not on the Notion board "
                          "(the board is for people). Do not create it again; steer with a message if it needs more.")

    def _execute_provider(self, action: Provider) -> ExecResult:
        """Write the provider find to the scout's report and tell the owner. Policy applied the rules."""
        if not self.cfg.scout.enabled:
            return ExecResult(False, "recording providers is not enabled", False)
        path = record_provider(self.cfg.scout, action)
        name = action.name.strip()
        card = "needs a card" if action.needs_card else "no card"
        if self.cfg.scout.kind == "agent":
            board = self._agent_board_row(action, card)
            where = f"{path.name}" + (f" and the owner's board ({board})" if board and board.startswith("http") else "")
            self.memory.add_chat("bot", f"Added an AI agent to your list: {name} -- {action.why.strip()[:160]} ({action.free_terms.strip()}, {card}). It is in {where}.")
            self.memory.write_journal(f"Catalogued an AI agent for the owner: {name} ({path}" + (f"; board row {board}" if board else "") + ")", heading="Agent")
            event(self.logger, "provider", report="agent", name=name[:120], base_url=action.base_url.strip()[:80], file=str(path), board=board or "")
            note = "" if not board or board.startswith("http") else f" ({board})"
            return ExecResult(True, f"added AI agent '{name[:60]}' to {path.name}" + (" and the board" if board and board.startswith("http") else ""), True,
                              feedback=f"{name} is on the list now; do not add it again. Find a different agent.{note}")
        category, label = find_category(action), find_label(action)
        next_step = "add a key if you want it" if category == "model" else "tell the dev agent if you want the family to use it"
        self.memory.add_chat("bot", f"Found a free {label} worth a look: {name} ({action.free_terms.strip()}, {card}). Added to {path.name}; {next_step}.")
        self.memory.write_journal(f"Recorded a {label} for the owner: {name} ({path})", heading="Provider")
        event(self.logger, "provider", name=name[:120], base_url=action.base_url.strip()[:80], file=str(path), category=category, label=label)
        return ExecResult(
            True, f"recorded provider '{name[:60]}' in {path.name}", True,
            feedback=f"{name} is in the report now; do not record it again. Look for a different provider.",
        )

    def _agent_board(self):
        """The owner's Notion board for AI-agent finds ([scout] notion_database_id), built once; None when off/no key."""
        if getattr(self, "_agent_board_client", None) is not None or getattr(self, "_agent_board_tried", False):
            return getattr(self, "_agent_board_client", None)
        self._agent_board_tried = True
        ds = (self.cfg.scout.notion_database_id or "").strip()
        if not ds:
            return None
        try:
            from dataclasses import replace

            from .model import load_api_key
            from .notion import NotionClient

            key = load_api_key(self.cfg.notion.api_key_env, self.cfg.notion.api_key_file)
            if not key:
                event(self.logger, "agent_board_off", why="no Notion key")
                return None
            self._agent_board_client = NotionClient(replace(self.cfg.notion, enabled=True, database_id=ds), key, self.logger)
        except Exception as exc:  # noqa: BLE001
            event(self.logger, "agent_board_off", why=str(exc)[:200])
            return None
        return self._agent_board_client

    @staticmethod
    def _clearnet(url: str) -> str:
        """The URL when it is an http(s) clearnet address, else "" -- nothing read over Tor leaves the Mac."""
        u = (url or "").strip()
        if not u.lower().startswith(("http://", "https://")) or ".onion" in u.lower():
            return ""
        return u[:400]

    def _agent_board_row(self, action: Provider, card: str) -> str:
        """Write the agent find as a row on the owner's board. Returns the row URL, "" when the board is off, or a short
        reason when the row was not written (an .onion address, or Notion refused) -- the file entry stands either way."""
        client = self._agent_board()
        if client is None:
            return ""
        website = self._clearnet(action.base_url)
        if not website:
            event(self.logger, "agent_board_skip", name=action.name.strip()[:80], why="website is not a clearnet address")
            return "not on the board: its address is not a clearnet site, so it stays in the file"
        source = next((self._clearnet(s) for s in action.sources if self._clearnet(s)), "")
        fields = {"Website": website, "What it does": action.why.strip()[:1900], "Free terms": action.free_terms.strip()[:400],
                  "Card": "card" if action.needs_card else "no card", "Source": source, "Found on": time.strftime("%Y-%m-%d"),
                  "Found by": self.cfg.agent.name}
        try:
            url = client.create_row(action.name.strip(), fields)
            problem = self._confirm_write(client, "agent_row", page_id=page_id_from_url(url) or "", expect={"Website": website})
        except Exception as exc:  # noqa: BLE001 - the file entry stands; the board is a copy
            event(self.logger, "agent_board_failed", name=action.name.strip()[:80], error=str(exc)[:200])
            return f"not on the board: {str(exc)[:120]}"
        if problem:
            return f"not on the board: {problem}"
        event(self.logger, "agent_board_row", name=action.name.strip()[:80], url=url)
        return url

    def _execute_package(self, action: Package) -> ExecResult:
        """Write the package into the recipient bot's folder and its inbox. The policy applied the rules."""
        h = self.cfg.handoff
        if not h.enabled:
            return ExecResult(False, "handing packages to another bot is not enabled", False)
        pkg_file, _ = send_package(h, self.cfg.agent.name, action)
        name = action.name.strip()
        if self.requests is not None:  # "send me the full package record" is answered by the handoff itself
            try:
                done = self.requests.answer(h.to_name, self.cfg.agent.name, f"done: handed package '{name}' ({pkg_file.name})")
                if done is not None:
                    event(self.logger, "request_answered", id=done.id, requester=h.to_name, via="package")
            except OSError:
                pass
        self.memory.write_journal(f"Handed a package to {h.to_name}: {name} at {action.price.strip()} ({pkg_file})", heading="Package")
        event(self.logger, "package", name=name[:120], price=action.price.strip()[:60], to=h.to_name, file=str(pkg_file))
        self._report(f"handed package \"{name[:60]}\" ({action.price.strip()[:30]}) to {h.to_name}")
        return ExecResult(
            True, f"handed package '{name[:60]}' ({action.price.strip()[:40]}) to {h.to_name}", True,
            feedback=f"{h.to_name} has the package '{name}' now; do not send it again. Research the next one.",
        )

    # ---- work plans (plan.py; owner, 2026-09-26) -----------------------------------------------------------------
    def _plan_stuck_on_domain(self, target: str, reason: str) -> None:
        """The cap closed the site the active plan is built on: the plan ends stuck by itself, with the reason, instead of
        the bot retrying it (Lead Gen: 761 of 912 visits on one site its plan named, 2026-09-27/28)."""
        if self.plan is None or not self.plan.active or not target:
            return
        from urllib.parse import urlparse

        from .browser import registered_domain

        dom = registered_domain(urlparse(target).netloc)
        if not dom or not self.plan.names_domain(dom):
            return
        note = f"{dom} does not state what the plan needed; the site is closed for today after {self.cfg.policy.domain_no_progress_cap} pages"
        self.plan.end("stuck", note)
        save_plan(self.plan_file, self.plan)
        self._archive_plan()
        self.memory.write_journal(f"Plan stuck: {self.plan.task} -- {note}", heading="Plan")
        event(self.logger, "plan_end", status="stuck", note=note[:200], auto=True)
        self._report(f"stuck on \"{self.plan.task[:80]}\": {note[:160]}")
        self.feedback = (f"Your plan ended stuck: {note}. Tell whoever asked (one message: which business, which cells, "
                         "\"the site does not state it\"), then take a different business or job and write a new plan.")

    def _domain_cap_since(self, ep: sqlite3.Row) -> str:
        """The cap counts visits over policy.domain_no_progress_hours (rolling), or since the episode start when 0."""
        hours = float(self.cfg.policy.domain_no_progress_hours or 0)
        if hours <= 0:
            return str(ep["started_at"])
        import datetime as _dt

        return (_dt.datetime.now() - _dt.timedelta(hours=hours)).isoformat(timespec="seconds")

    def _plan_since(self) -> str:
        """When the current plan step began: the last tick, else the plan's start (a tick needs a write since then)."""
        if self.plan is None:
            return now_iso()
        ticks = [str(s.get("done_at") or "") for s in self.plan.steps if s.get("done")]
        return max(ticks) if ticks else self.plan.started

    def _answers_this_week(self) -> list[str]:
        """The latest answer from each colleague to one of this bot's asks in the last 7 days (requests.jsonl), so the
        answer outlives the episode that read it. The CEO asked the Research Analyst the same thing ~25 times in a day
        while the Analyst had answered six times (2026-10-14)."""
        if self.requests is None:
            return []
        me = self.cfg.agent.name
        week = (dt.datetime.now() - dt.timedelta(days=7)).isoformat(timespec="seconds")
        latest: dict[str, tuple[str, str, str]] = {}
        try:
            for r in self.requests.all():
                if r.sender == me and r.answered_at >= week and r.answer.strip() and not r.answer.startswith("(same ask)"):
                    if r.to not in latest or r.answered_at > latest[r.to][0]:
                        latest[r.to] = (r.answered_at, r.text, r.answer)
        except Exception:  # noqa: BLE001 - a prompt aid never breaks the loop
            return []
        return [f"{to}, {when[:16].replace('T', ' ')}, to your \"{ask.strip()[:80]}\": {ans.strip()[:300]}"
                for to, (when, ask, ans) in sorted(latest.items(), key=lambda kv: kv[1][0], reverse=True)[:6]]

    def _close_stale_plan(self) -> None:
        """A plan with no step ticked for [agent] plan_stuck_hours ends stuck by itself (owner, 2026-10-14)."""
        hours = float(self.cfg.agent.plan_stuck_hours or 0)
        if hours <= 0 or self.plan is None or not self.plan.active:
            return
        marks = [str(s.get("done_at") or "") for s in self.plan.steps if s.get("done")] + [self.plan.started]
        last = max(m for m in marks if m)
        try:
            age = (dt.datetime.now() - dt.datetime.fromisoformat(last[:19])).total_seconds() / 3600
        except ValueError:
            return
        if age < hours:
            return
        note = f"no step finished in {age:.0f} hours; closed by the engine"
        self.plan.end("stuck", note)
        save_plan(self.plan_file, self.plan)
        self._archive_plan()
        self.memory.write_journal(f"Plan stuck: {self.plan.task} -- {note}", heading="Plan")
        event(self.logger, "plan_end", status="stuck", note=note, auto=True, hours=round(age, 1))
        self.feedback = (f"Your plan \"{self.plan.task[:80]}\" was closed: {note}. Say in one message what blocked it, "
                         "then take a different job and write a smaller plan whose first step you can finish within the hour.")

    def _plan_lines(self) -> list[str]:
        if not self.cfg.agent.plans:
            return []
        self._close_stale_plan()
        if self.plan is not None and self.plan.active:
            return self.plan.render()
        try:
            job = self._priority_request_state()
        except Exception:  # noqa: BLE001
            job = None
        if job:
            source = "owner" if str(job.get("sender", "")).lower() == "owner" else "priority"
            return [f'No plan yet for the job you were given ("{str(job.get("text", ""))[:100]}"): write one first with '
                    '{"type":"plan","task":"...","done_when":"...","steps":["...","..."],"source":"' + source + '"}.']
        ep = self.memory.current_episode()
        if ep is not None and int(ep["actions"] or 0) >= 3:
            # Lead Gen worked a whole day with its last plan "stuck" on the record (2026-10-01): a bot with a job of its own
            # and no active plan is reminded once per observation; nothing is enforced.
            last = f' (your last plan ended {self.plan.status}: "{self.plan.task[:60]}")' if self.plan is not None else ""
            return [f"No active plan{last}: when you know what this episode is for, write one with "
                    '{"type":"plan","task":"...","done_when":"...","steps":["...","..."],"step_minutes":[...],"source":"own"}.']
        return []

    DEAD_END_REASONS = (("already on the leads board", "already on the Leads board"), ("already on the packages page", "already on the packages page"),
                        ("task you already created", "a task you already created"), ("personal mailbox provider", "only a personal mailbox address"),
                        ("not opened any page on the business", "its pages were never opened"), ("does not appear on any page", "no such email on its pages"))

    def _dead_ends(self) -> list[str]:
        """Targets this bot was refused on twice or more today for a reason that will not change (a business already on
        the board, a package already on the page, a task already created). A refusal blocks only within an episode; the
        next episode came back to the same idea (Lead Gen re-listed one bar many times and the CEO re-published one
        package 40 times in a night, 2026-10-01). Shown so the bot moves on."""
        try:
            import datetime as _dt

            day = _dt.date.today().isoformat()
            rows = self.memory.db.query(
                "SELECT action_type, payload, verdict FROM actions WHERE ts >= ? AND verdict LIKE 'rejected:%' "
                "AND action_type IN ('lead', 'publish_package', 'task') ORDER BY id", (day,))
            counts: dict[tuple[str, str], tuple[int, str, str]] = {}
            for r in rows:
                low = str(r["verdict"]).lower()
                why = next((label for needle, label in self.DEAD_END_REASONS if needle in low), None)
                if why is None:
                    continue
                try:
                    p = json.loads(r["payload"])
                except ValueError:
                    continue
                name = str(p.get("name") or p.get("title") or "").strip()
                if not name:
                    continue
                key = (str(r["action_type"]), name.lower())
                n, _, _ = counts.get(key, (0, why, name))
                counts[key] = (n + 1, why, name)
            out = [f"{t} '{shown[:50]}' ({why}, {n}x)" for (t, _), (n, why, shown) in sorted(counts.items(), key=lambda kv: -kv[1][0]) if n >= 2]
            return out[:6]
        except Exception:  # noqa: BLE001
            return []

    def _decide_lines(self) -> list[str]:
        """The next rows from the bot's decide list ([leads] decide_glob) that it has not updated yet."""
        L = self.cfg.leads
        if L.enabled and L.draft_queue_column.strip():
            return self._draft_queue_lines()
        if not (L.enabled and L.decide_glob.strip()):
            return []
        try:
            folder = self.cfg.root.parent / "common-data" / "botBox" / "routed" / self.cfg.root.name
            files = sorted(folder.glob(L.decide_glob.strip()))
            if not files:
                return []
            done = set()
            since = time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime(files[-1].stat().st_mtime))
            for r in self.memory.db.query("SELECT payload FROM actions WHERE action_type = 'update_lead' AND verdict = 'allowed' AND ts >= ?", (since,)):
                try:
                    p = json.loads(r["payload"])
                except ValueError:
                    continue
                if L.decide_field.strip() and not str(p.get(L.decide_field.strip()) or "").strip():
                    continue
                done.add(str(p.get("name", "")).strip().lower())
            resting: dict[str, int] = {}
            for r in self.memory.db.query("SELECT payload FROM actions WHERE action_type = 'update_lead' AND verdict != 'allowed' AND ts >= date('now', 'localtime')"):
                try:
                    n = str(json.loads(r["payload"]).get("name", "")).split(" | ")[0].strip().lower()
                except ValueError:
                    continue
                resting[n] = resting.get(n, 0) + 1
            out: list[str] = []
            for line in files[-1].read_text(encoding="utf-8", errors="replace").splitlines():
                if not line.startswith("- "):
                    continue
                name = line[2:].split("|")[0].strip()
                if not name or name.lower() in done or resting.get(name.lower(), 0) >= 3:  # three refusals today: rest until tomorrow
                    continue
                out.append(line[2:].strip()[:260])
                for url in re.findall(r"https?://[^\s|]+", line):  # the row's own site: shown here, so openable
                    self.seen_links.add(url.rstrip(".,;"))
                if len(out) >= max(1, L.decide_shown):
                    break
            return out
        except Exception:  # noqa: BLE001
            return []

    _NOTED_EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}")
    _PLACEHOLDER_LOCAL = re.compile(r"^(mymail|email|e-mail|your|yourname|name|example|test|user|someone|abc|xyz)$", re.I)

    def _noted_not_listed(self) -> list[str]:
        """The first [leads] noted_shown of _noted_items for the prompt; the whole list goes to
        common-data/shared-state/lead-gen-noted.json for the dashboard (one definition, 2026-10-07)."""
        L = self.cfg.leads
        if not (L.enabled and L.noted_shown > 0) or L.draft_queue_column.strip():
            return []
        items = self._noted_items()
        try:
            path = self.cfg.root.parent / "common-data" / "shared-state" / f"{self.cfg.root.name}-noted.json"
            path.parent.mkdir(parents=True, exist_ok=True)
            tmp = path.with_suffix(".tmp")
            tmp.write_text(json.dumps({"at": now_iso(), "items": items}, ensure_ascii=False, indent=1), encoding="utf-8")
            tmp.replace(path)
        except OSError:
            pass
        return [f"{i['title'][:60]} | {i['email']} | {i['page'] or '(no page recorded)'}" for i in items[: L.noted_shown]]

    def _noted_items(self) -> list[dict]:
        """Business emails in this bot's own notes that never became leads: domain not among its leads, not on the
        board, not refused twice in the last two days, not a mail provider, placeholder or school address. Oldest first."""
        from .policy import _FREE_MAIL, same_site

        try:
            notes = self.memory.db.query("SELECT title, body, source_url, created_at FROM notes ORDER BY id")
            listed = {d for d in self.memory.recent_lead_domains(3650) if d}
            refused: dict[str, int] = {}
            # refusals of the last two days only: an old refusal for a fixable reason (a made-up package name, a location
            # not on the cited page) gets another try
            for r in self.memory.db.query("SELECT payload FROM actions WHERE action_type = 'lead' AND verdict != 'allowed' "
                                          "AND ts > datetime('now', '-2 days')"):
                try:
                    p = json.loads(r["payload"])
                except ValueError:
                    continue
                for u in (p.get("website", ""), "x@" + str(p.get("email", "")).split("@")[-1]):
                    d = url_domain(u) if "://" in u else u.split("@")[-1].lower()
                    if d:
                        refused[d] = refused.get(d, 0) + 1
        except Exception:  # noqa: BLE001 - a notes read never blocks the prompt
            return []
        out, seen = [], set()
        for n in notes:
            text = f"{n['title'] or ''}\n{n['body'] or ''}"
            for email in self._NOTED_EMAIL.findall(text):
                local, dom = email.rsplit("@", 1)
                dom = dom.lower().rstrip(".")
                if (dom in seen or any(dom == f.rstrip(".") or dom.startswith(f) for f in _FREE_MAIL)
                        or self._PLACEHOLDER_LOCAL.match(local) or dom.endswith((".edu", ".gov")) or "example" in dom):
                    continue
                seen.add(dom)
                page = str(n["source_url"] or "").strip()
                site = url_domain(page) if page.startswith("http") else ""
                if any(same_site(dom, d) or (site and same_site(site, d)) for d in listed):
                    continue
                tries = refused.get(dom, 0) + (refused.get(site, 0) if site and site != dom else 0)
                if tries >= 2 or self._domain_on_board(site or dom):
                    continue
                out.append({"title": str(n["title"] or "").strip(), "email": email, "page": page,
                            "noted_at": str(n["created_at"] or ""), "refusals": tries})
        return out

    def _domain_on_board(self, domain: str) -> bool:
        """A row on the Leads board whose Website contains this domain (one board query per domain an hour)."""
        if self.leads_notion is None or not domain:
            return False
        cache = self.__dict__.setdefault("_board_domains", {})
        hit = cache.get(domain)
        if hit is not None and time.time() - hit[0] < 3600:
            return hit[1]
        try:
            data = self.leads_notion._request("POST", f"{self.leads_notion._container_path}/query",
                                              json={"filter": {"property": "Website", "url": {"contains": domain}}, "page_size": 1})
            found = bool(data.get("results"))
        except Exception:  # noqa: BLE001
            found = False
        cache[domain] = (time.time(), found)
        return found

    def _candidate_lines(self) -> list[str]:
        """The next few businesses from the newest candidates file that this bot has not visited or listed yet, as
        `{"type":"open","url":...}`-ready lines ([leads] candidates_glob). Deterministic: no search needed to reach them."""
        L = self.cfg.leads
        if not (L.enabled and L.candidates_glob.strip()):
            return []
        try:
            from urllib.parse import urlparse

            from .browser import registered_domain

            folder = self.cfg.root.parent / "common-data" / "botBox" / "routed" / self.cfg.root.name
            files = sorted(folder.glob(self.target.fill(L.candidates_glob.strip())))  # "candidates-{market_slug}-*.md"
            if not files:
                return []
            seen = {registered_domain(str(r["domain"] or "")) for r in self.memory.db.query("SELECT DISTINCT domain FROM visits")}
            seen |= {registered_domain(d) for d in self.memory.recent_lead_domains(L.dedupe_days)}
            # A site whose robots.txt forbids the page is never offered again: Lead Gen retried two of them 65 times in a
            # day (2026-10-02) because a refused open leaves no visit behind.
            for r in self.memory.db.query("SELECT DISTINCT verdict FROM actions WHERE action_type IN ('open','follow') AND verdict LIKE '%robots.txt%'"):
                m = re.search(r"([a-z0-9.-]+\.[a-z]{2,}) asks bots not to read", str(r["verdict"]), re.I)
                if m:
                    seen.add(registered_domain(m.group(1)))
            # An address that forwards to another domain leaves its visit under that domain, so it stayed on the list:
            # one was opened 108 times. Anything this bot has opened before is done, whatever it forwarded to.
            from .policy import url_key

            opened_keys: set[str] = set()
            for r in self.memory.db.query("SELECT payload FROM actions WHERE action_type = 'open' AND verdict = 'allowed' ORDER BY id DESC LIMIT 4000"):
                try:
                    opened_keys.add(url_key(str(json.loads(r["payload"]).get("url", ""))))
                except ValueError:
                    pass
            out: list[str] = []
            for line in files[-1].read_text(encoding="utf-8", errors="replace").splitlines():
                if not line.startswith("- "):
                    continue
                m = re.search(r"https?://[^\s|]+", line)
                if not m:
                    continue
                url = m.group(0).rstrip(".,;")
                if registered_domain(urlparse(url).netloc) in seen or url_key(url) in opened_keys:
                    continue
                parts = [p.strip() for p in line[2:].split("|")]
                name, where, trade = (parts + ["", "", ""])[:3]
                out.append(f"{name} ({where}, {trade[:40]}): {url}")
                self.seen_links.add(url)
                if len(out) >= max(1, L.candidates_shown):
                    break
            return out
        except Exception:  # noqa: BLE001 - a candidates problem never blocks the prompt
            return []

    def _outreach_leads(self) -> tuple[list[str], int]:
        """Leads the colleague in [leads] outreach_from has listed that no task of this bot names yet: (lines to show,
        how many in all). Read-only from that bot's own database; an unreadable database is simply no list."""
        L = self.cfg.leads
        if L.outreach_draft_column.strip():
            return self._drafts_to_review()
        who = (L.outreach_from or "").strip()
        folder = self.cfg.messaging.folder_for(who) if who else None
        if not folder:
            return [], 0
        try:
            import sqlite3 as _sq

            db_path = Path(folder).expanduser() / "workspace" / "explorer.sqlite3"
            if not db_path.exists():
                return [], 0
            tasked = " ".join(str(r["payload"]) for r in self.memory.db.query(
                "SELECT payload FROM actions WHERE action_type IN ('task', 'update_task') AND verdict = 'allowed'")).lower()
            con = _sq.connect(f"file:{db_path}?mode=ro", uri=True, timeout=5)
            try:
                rows = con.execute("SELECT name, email, how_we_help, url, created_at FROM leads ORDER BY id").fetchall()
            finally:
                con.close()
            waiting = [r for r in rows if str(r[0] or "").strip() and json.dumps(str(r[0]).strip())[1:-1].lower() not in tasked
                       and str(r[0]).strip().lower() not in tasked]
            if not waiting:
                return [], 0
            if any(re.search(r"\boutreach\b", t, re.I) for t in self.memory.task_titles_today()):
                # Today's batch exists: the list kept telling The CEO to write "ONE task" all day and it wrote five under
                # other titles (57 refusals on 2026-10-05). The leads listed since wait for tomorrow's batch.
                return [], len(waiting)
            oldest = min(str(r[4] or "9999") for r in waiting)
            age_h = (dt.datetime.now() - dt.datetime.fromisoformat(oldest[:19])).total_seconds() / 3600 if oldest[:4].isdigit() else 0
            if len(waiting) < max(1, L.outreach_min) and age_h < L.outreach_max_wait_hours:
                return [], len(waiting)  # not a batch yet
            lines = [f"{str(n).strip()} | {str(e or '').strip()} | {str(h or '(no package yet)').strip()[:60]} | {str(u or '').strip()}"
                     for n, e, h, u, _ in waiting[: max(1, L.outreach_shown)]]
            return lines, len(waiting)
        except Exception:  # noqa: BLE001 - a colleague's database never blocks the prompt
            return [], 0

    def _drafts_to_review(self) -> tuple[list[str], int]:
        """Drafted first emails waiting for the human team's review ([leads] outreach_draft_column): rows with a draft
        (not a "skip:") and an empty status, that no task of this bot names yet. Read from the board every ten minutes."""
        L = self.cfg.leads
        if self.leads_notion is None:
            return [], 0
        now = time.time()
        cached = getattr(self, "_review_cache", None)
        if cached is None or now - cached[0] > 600:
            try:
                rows = self.leads_notion.rows_drafted(L.outreach_draft_column.strip(), L.outreach_status_column.strip(), 100,
                                                      tuple(L.outreach_not_reviewed), L.score_column)
            except Exception:  # noqa: BLE001
                rows = cached[1] if cached else []
            cached = self._review_cache = (now, rows)
        # Only recent tasks count as covering a draft: the merged outreach batches of 10-04/05 named ~160 businesses and
        # hid every drafted row from the review list (2026-10-10).
        tasked = " ".join(str(r["payload"]) for r in self.memory.db.query(
            "SELECT payload FROM actions WHERE action_type IN ('task', 'update_task') AND verdict = 'allowed' "
            "AND ts > datetime('now', '-2 days')")).lower()
        waiting = [r for r in cached[1] if str(r.get("title") or "").strip() and str(r["title"]).strip().lower() not in tasked
                   and json.dumps(str(r["title"]).strip())[1:-1].lower() not in tasked]
        if not waiting:
            return [], 0
        # Today's review task exists: only a task about reviewing drafts counts. "Outreach list for ..." (CEO-172) matched
        # a plain "outreach" test and hid the list all day on 2026-10-10.
        if any(re.search(r"review.{0,40}draft|draft.{0,40}review|^\s*outreach:\s*review", t, re.I) for t in self.memory.task_titles_today()):
            return [], len(waiting)
        if len(waiting) < max(1, L.outreach_min):
            return [], len(waiting)
        lines = [f"{str(r['title']).strip()} | {str((r.get('fields') or {}).get('Business email', '')).strip()} | "
                 f"{str((r.get('fields') or {}).get('How can I help', '') or '(no package)').strip()[:60]} | {str(r.get('url', '')).strip()}"
                 for r in waiting[: max(1, L.outreach_shown)]]
        return lines, len(waiting)

    def _briefings(self) -> list[str]:
        """The newest file for each [agent] briefing_globs pattern in this bot's routed folder, at most 60 lines each."""
        out: list[str] = []
        folder = self.cfg.root.parent / "common-data" / "botBox" / "routed" / self.cfg.root.name
        for pattern in self.cfg.agent.briefing_globs:
            try:
                files = sorted(folder.glob(pattern.strip()), key=lambda p: p.stat().st_mtime)
                if not files:
                    continue
                lines = [l.rstrip() for l in files[-1].read_text(encoding="utf-8", errors="replace").splitlines() if l.strip()]
                out.append("\n".join(lines[:60])[:4000])
            except OSError:
                continue
        return out

    def _known_finds(self) -> str | None:
        """The names already in the scout's report, in every prompt: the bot cannot read the report file itself, and
        recorded three email checkers in a row while the family already had two (2026-10-03 audit)."""
        if not self.cfg.scout.enabled or self.cfg.scout.kind == "agent":
            return None
        try:
            names = sorted(existing_names(Path(self.cfg.scout.report_file).expanduser()))
        except OSError:
            return None
        if not names:
            return None
        return "Already in your report (never record these again; look for a KIND of tool the family lacks): " + ", ".join(names[:60])

    def _family_block(self) -> str:
        """The family's root concept and roster, generated for every prompt from common-data/family-roster.toml and the
        members' STOP / PAUSE / HOLD files (owner, 2026-10-10: eight cards carried eight different copies). "" when the
        roster is missing, so a bot outside a fleet runs on its card alone."""
        import tomllib

        m = self.cfg.messaging
        path = Path(m.roster_file).expanduser() if (m.roster_file or "").strip() else self.cfg.root.parent / "common-data" / "family-roster.toml"
        try:
            members = tomllib.loads(path.read_text(encoding="utf-8")).get("member") or []
        except (OSError, ValueError):
            return ""
        if not members:
            return ""
        me = self.cfg.agent.name.strip().lower()
        from .hold import read_hold, until_text

        lines = []
        for x in members:
            name, handle, slug = str(x.get("name", "")), str(x.get("handle", "")), str(x.get("slug", ""))
            ws = self.cfg.root.parent / slug / "workspace"
            if x.get("retired"):
                state = f"retired {x['retired']}"
            elif x.get("session"):
                state = "runs in its own session"
            elif (ws / "STOP").exists():
                state = "STOPPED by the owner: do not message or task it"
            elif (ws / "PAUSE").exists():
                state = "paused by the owner"
            else:
                hold = read_hold(ws)
                state = f"held by {hold.get('by', 'The CEO')} until {until_text(hold)}" if hold else "running"
            who = f"{handle} = {name}" + (" (you)" if name.strip().lower() == me else "")
            lines.append(f"- {who}: {x.get('role', '')} -- {state}")
        handles = ", ".join(str(x.get("handle", "")) for x in members)
        ceo_rule = ("**You, The CEO, are the provider and the rule maker.** You hold the family's resources and set what it works on; "
                    "only the owner's fence is above you" if me == "the ceo" else
                    "**The CEO is the provider and the rule maker.** Its request is your top priority until you answer it; its steer is the "
                    "working rule. Only the owner's fence is above it")
        return (
            "## The family -- the root concept (owner, 2026-09-25)\n\n"
            f"\"You are my family, all of you: {handles}.\" Everyone else -- every model provider, every site we read -- is a friend, "
            "not family. Three rules sit above the rest of your card:\n"
            "1. **Family is helped first.** Answer a family member's message before your own work; say what you did or why you could not.\n"
            f"2. {ceo_rule}: no accounts, keys, spending, sign-ups, personal data or self-replication -- for anyone.\n"
            "3. **Full names in messages**; the owner may use our handles. The family right now:\n" + "\n".join(lines) + "\n\n"
        )

    def _family_line(self) -> str | None:
        """Who is running right now, when someone is not (owner, 2026-10-03: "does ceoA know which member is active or
        stopped? it has to work / assign task accordingly"). The CEO learned it one refusal at a time: 46 refused
        messages to the stopped Package Designer in a day. Nothing is said while everyone runs."""
        parts = [p for p in (self._who_is_running(), self._fleet_usage_line()) if p]
        return "\n".join(parts) or None

    def _fleet_usage_line(self) -> str | None:
        """The day's free model use by member and by provider, for the bot that holds the family's resources
        (model.sees_fleet_usage; owner, 2026-10-07: no token limit, The CEO manages it if needed)."""
        if not self.cfg.model.sees_fleet_usage:
            return None
        from .common.fallback import CallLedger

        if getattr(self, "_ledger", None) is None:
            self._ledger = CallLedger()
        try:
            ledger = self._ledger
            by_bot = ledger._load_all().get("by_bot") or {}
            calls = ledger.today()
        except (OSError, ValueError):
            return None
        if not by_bot:
            return None

        def mtok(n: int) -> str:
            return f"{n / 1e6:.1f}M" if n >= 100_000 else f"{n // 1000}k"

        members = ", ".join(f"{b} {mtok(int(t))}" for b, t in sorted(by_bot.items(), key=lambda kv: -int(kv[1])))
        hosts = ", ".join(f"{h} {c}" for h, c in sorted(calls.items(), key=lambda kv: -kv[1]))
        return (f"Free model use today -- tokens: {members} (total {mtok(sum(int(t) for t in by_bot.values()))}); "
                f"calls: {hosts or 'none'}. No daily token limit; the providers' own free caps still apply and the chain "
                "moves on when one is used up. You hold these resources: if one member's use crowds out the work that "
                "matters most, tell it by message what to focus on.")

    def _who_is_running(self) -> str | None:
        m = self.cfg.messaging
        if not m.enabled:
            return None
        try:
            states = m.peer_states()
        except OSError:
            return None
        held = {n: s for n, s in states.items() if s.startswith("held:")}
        off = {n: s for n, s in states.items() if s in ("stopped", "paused")}
        if not off and not held:
            return None
        lines = []
        running = ", ".join(n for n, s in states.items() if s == "running") or "nobody else"
        if off:
            away = ", ".join(f"{n} ({s} by the owner)" for n, s in off.items())
            lines.append(f"Family right now -- running: {running}. NOT running: {away}. Do not message them or give them tasks; "
                         "nobody would read it. Work that is theirs: do it yourself when your own actions allow it, hand it to a "
                         "running member who can, or leave it until the owner starts them again -- never keep asking.")
        if held:
            from .hold import read_hold, until_text

            parts = []
            for n, s in held.items():
                h = read_hold(Path(m.folder_for(n) or "").expanduser() / "workspace") or {}
                parts.append(f"{n} {'paused' if s == 'held:pause' else 'slowed'} by {h.get('by', 'The CEO')} until {until_text(h)}")
            lines.append("Held: " + "; ".join(parts) + ". A paused member reads its messages when it runs again.")
        return "\n".join(lines)

    def _allowed_now(self, ep: sqlite3.Row) -> list[str]:
        """The policy's caps and today's counts, one short item each, so the bot knows what is allowed before it acts
        (the CEO wrote 67 tasks against 5,521 refused task attempts in 30 days)."""
        cfg, m = self.cfg, self.memory
        eid = ep["id"]
        out: list[str] = []

        def item(name: str, used: int, cap: int, span: str) -> None:
            if cap <= 0:
                out.append(f"{name}: no cap")
            elif used >= cap:
                out.append(f"NOT NOW {name}: {used}/{cap} {span}")
            else:
                out.append(f"{name}: {used}/{cap} {span}")

        try:
            left = cfg.policy.max_actions_per_episode - int(ep["actions"])
            out.append(time.strftime("today is %Y-%m-%d (%A)"))
            out.append(f"actions left this episode: {max(left, 0)}")
            if cfg.policy.max_notes_per_day > 0:
                item("notes", m.count_actions_today("note"), cfg.policy.max_notes_per_day, "today")
            elif cfg.policy.max_notes_per_episode > 0:
                item("notes", m.count_actions(eid, "note"), cfg.policy.max_notes_per_episode, "this episode")
            if self.notion is not None:
                item("tasks", m.count_tasks_today(), int(getattr(cfg.notion, "max_tasks_per_day", 0) or 0), "today")
            if self.leads_notion is not None:
                item("leads", m.count_actions_today("lead"), cfg.leads.max_per_day, "today")
                item("lead updates", m.count_actions(eid, "update_lead"), cfg.leads.max_updates_per_episode, "this episode")
            if cfg.messaging.enabled:
                item("messages", m.count_actions(eid, "message"), cfg.messaging.max_per_episode, "this episode")
                item("messages", m.count_actions_today("message"), cfg.messaging.max_per_day, "today")
            if cfg.policy.max_says_per_day > 0:
                item("say to owner", m.count_says_today("owner"), cfg.policy.max_says_per_day, "today")
            else:
                item("say to owner", m.count_says(eid, "owner"), cfg.policy.max_says_per_episode, "this episode")
            paused = self.searcher.pause.seconds_until_any(self.searcher.engines) if getattr(self, "searcher", None) is not None else 0
            if paused and paused > 0:
                out.append(f"NOT NOW search: paused {int(paused)}s")
            if cfg.policy.disabled_actions:
                out.append("never: " + ", ".join(cfg.policy.disabled_actions))
            if self._notion_full():
                out.append("NOT NOW any Notion write (task, lead, package): the workspace is out of free blocks; the owner must free space")
        except Exception:  # noqa: BLE001 - a counts problem never blocks the prompt
            pass
        return out[:10]

    def _execute_plan(self, action: Plan) -> ExecResult:
        """Start, tick or end the bot's work plan (workspace/plan.json). The policy applied the rules."""
        if not self.cfg.agent.plans:
            return ExecResult(False, "work plans are not enabled", False)
        if action.tick is not None:
            assert self.plan is not None
            since = self._plan_since()
            by = self.memory.latest_progress_action_id(since)
            if not self.plan.tick(int(action.tick), by, self.memory.action_type_of(by), actual_min=self.memory.working_minutes_since(since)):
                return ExecResult(False, f"step {action.tick} could not be ticked", False)
            save_plan(self.plan_file, self.plan)
            self._archive_plan()  # writes only when that tick finished the plan
            event(self.logger, "plan_tick", step=int(action.tick), by_action=by, by_type=self.memory.action_type_of(by), status=self.plan.status)
            if not self.plan.active:
                self.memory.write_journal(f"Plan finished: {self.plan.task}", heading="Plan")
                return ExecResult(True, f"ticked step {action.tick}; every step is done, plan finished", True,
                                  feedback="Your plan is complete. Report what you did if someone asked for it, then take the next job.")
            if not self.plan.open_steps:
                return ExecResult(True, f"ticked step {action.tick}; every step ticked but nothing produced", True,
                                  feedback="Every step is ticked, yet no step produced a lead, task, package, note or entry. Do the work that "
                                  'produces one, or end the plan with status "stuck" and say why.')
            nxt = self.plan.open_steps[0]
            return ExecResult(True, f"ticked step {action.tick}", True,
                              feedback=f"Step {action.tick} is done. Next: step {nxt}, {self.plan.steps[nxt - 1]['text']}")
        if action.status is not None:
            assert self.plan is not None
            self.plan.end(action.status, action.note)
            save_plan(self.plan_file, self.plan)
            self._archive_plan()
            self.memory.write_journal(f"Plan {action.status}: {self.plan.task}" + (f" -- {action.note.strip()}" if action.note.strip() else ""), heading="Plan")
            event(self.logger, "plan_end", status=action.status, note=action.note.strip()[:200])
            if action.status == "stuck":
                self._report(f"stuck on \"{self.plan.task[:80]}\": {action.note.strip()[:160]}")
            return ExecResult(True, f"plan ended: {action.status}", True,
                              feedback="Plan closed. Take the next job, or explore, and write a new plan when you do.")
        self.plan = WorkPlan.new(action.task, action.done_when, list(action.steps), action.source,
                                 step_minutes=list(action.step_minutes), estimate_min=action.estimate_min)
        save_plan(self.plan_file, self.plan)
        self.memory.write_journal(f"Plan: {self.plan.task}\nDone when: {self.plan.done_when}\n" + "\n".join(f"- {s['text']}" for s in self.plan.steps), heading="Plan")
        event(self.logger, "plan_start", task=self.plan.task[:120], steps=len(self.plan.steps), source=self.plan.source)
        return ExecResult(True, f"plan written: {self.plan.task[:60]} ({len(self.plan.steps)} steps)", True,
                          feedback=f"Plan saved. Start with step 1: {self.plan.steps[0]['text']}")

    # ---- read-back after a Notion write (owner, 2026-09-26) ------------------------------------------------------
    def _confirm_write(self, client, kind: str, *, page_id: str = "", block_id: str = "", expect: dict[str, str] | None = None) -> str | None:
        """Read the object back; a problem string when it is missing, archived, or a written field did not land; None
        when confirmed or when Notion could not be asked (fail open, logged)."""
        if not self.cfg.agent.readback_writes or client is None:
            return None
        try:
            if block_id:
                if not hasattr(client, "read_block"):
                    return None
                got = client.read_block(block_id)
                problem = "the toggle is not on the page after the write" if (got is None or got.get("archived")) else None
            else:
                if not page_id or not hasattr(client, "read_page"):
                    return None
                got = client.read_page(page_id)
                if got is None or got.get("archived"):
                    problem = "the page is not on the board after the write"
                else:
                    problem = None
                    fields = {k.lower(): str(v).lower() for k, v in (got.get("fields") or {}).items()}
                    missing = [k for k, v in (expect or {}).items()  # a column absent from the row did not land either
                               if str(v).strip() and str(v).strip().lower()[:60] not in fields.get(k.lower(), "")]
                    if missing:
                        problem = "written but not on the row: " + ", ".join(missing)
        except Exception as exc:  # noqa: BLE001 - Notion unreachable: the write stands, unverified
            event(self.logger, "readback_unverified", write=kind, error=str(exc)[:200])
            return None
        event(self.logger, "readback", write=kind, ok=problem is None, problem=problem or "")
        if problem is None:
            self._note_notion_restored(kind)
        return problem

    def _execute_revise_goal(self, action: ReviseGoal) -> ExecResult:
        """The bot rewrites its own goal. The policy applied the rules. Write it beside the persona for
        the owner to read/edit/delete, rebuild the system prompt so it takes effect now, and surface it."""
        if not self.cfg.agent.self_goals:
            return ExecResult(False, "rewriting your own goal is not enabled", False)
        goal = action.goal.strip()
        self.self_goal = goal
        try:
            self.self_goal_file.parent.mkdir(parents=True, exist_ok=True)
            self.self_goal_file.write_text(goal + "\n", encoding="utf-8")
        except OSError as exc:
            return ExecResult(False, f"could not save the new goal: {exc}", False)
        self.system = self._build_system()  # takes effect from the next cycle
        why = action.why.strip()
        self.memory.write_journal(f"I revised my own goal to: {goal}" + (f"\n\nWhy: {why}" if why else ""), heading="Goal")
        self.memory.add_chat("bot", f"I've revised my goal to: {goal}" + (f" (why: {why})" if why else ""), seen=True)
        if self.chatroom is not None:
            self.chatroom.post(self.cfg.agent.name, f"I've reset my own goal: {goal[:200]}")
        event(self.logger, "revise_goal", goal=goal[:200])
        return ExecResult(
            True, f"revised my goal: {goal[:80]}", True,
            feedback="Your goal is updated and your owner has been told. Pursue it now.",
        )

    def _proposed_bots_file(self) -> Path:
        from .config import _common_data
        return _common_data() / "proposed-bots.md"

    def _proposed_roles(self) -> set[str]:
        from .teammates import existing_roles
        return existing_roles(self._proposed_bots_file())

    def _execute_propose_teammate(self, action: ProposeTeammate) -> ExecResult:
        """Record a proposed new bot/role for the owner to weigh, and surface it. Policy applied the rules."""
        if not self.cfg.agent.propose_teammates:
            return ExecResult(False, "proposing teammates is not enabled", False)
        from .teammates import record_proposed_teammate

        path = record_proposed_teammate(self._proposed_bots_file(), self.cfg.agent.name, action)
        role = action.role.strip()
        self.memory.write_journal(f"Proposed a new teammate: {role} -- {action.does.strip()[:150]}", heading="Proposal")
        self.memory.add_chat(
            "bot",
            f"I think the fleet could use a new bot: {role}. {action.does.strip()} (why: {action.why.strip()}) "
            f"-- added to {path.name} for you to weigh.",
            seen=True,
        )
        if self.chatroom is not None:
            self.chatroom.post(self.cfg.agent.name, f"I proposed a new teammate to the owner: {role}")
        event(self.logger, "propose_teammate", role=role[:80], file=str(path))
        return ExecResult(
            True, f"proposed a new teammate: {role}", True,
            feedback=f"Your proposal for a '{role}' bot is recorded for the owner. Back to your own work now.",
        )

    def _execute_publish_package(self, action: PublishPackage) -> ExecResult:
        """Write a package to the Notion package page as a toggle, in the owner's headed layout, with its facts
        (audience, price, deliverables, rationale, sources, source company) from the package itself. A package already
        on the page is replaced when the policy allowed it again (new company facts, an older pitch format, or a
        republish request). The record is kept so the page can be re-rendered later without the Package Designer."""
        page_id = self.cfg.notion.package_page_id.strip()
        if self.notion is None or not page_id:
            return ExecResult(False, "publishing packages to the Notion page is not enabled", False)
        name = action.name.strip()
        pkg = find_package(self.cfg.workspace, name) or self._stored_package(name)
        if pkg is None:
            return ExecResult(False, f"no package named '{name[:60]}' in your inbox to publish", False,
                              feedback=f"You have not been handed a package named '{name}'. Publish one you actually received.")
        sc = pkg.get("source_company") or {}
        company = [(label, str(sc.get(fld, "")).strip()) for label, fld in
                   (("Company", "name"), ("Website", "website"), ("Founded", "founded"), ("Team size", "employees"),
                    ("Location", "location"), ("Valuation", "valuation"), ("About", "history"))]
        if str(sc.get("name", "")).strip() and not str(sc.get("valuation", "")).strip():
            company.append(("Valuation", "not published on its site"))
        sources = [s for s in (pkg.get("sources") or []) if str(s).strip()]
        email = with_signoff(action.email, self.cfg.notion.package_signoff)
        import json
        blocks = self._published_blocks()
        previous = blocks.get(name.lower()) if isinstance(blocks.get(name.lower()), dict) else None
        replaced = False
        if previous and previous.get("block_id"):  # a fuller or re-rendered version replaces the old toggle
            try:
                self.notion.delete_block(str(previous["block_id"]))
                replaced = True
            except Exception as exc:  # noqa: BLE001 - the old toggle staying is not worth failing the publish
                self.logger.warning("could not remove the old toggle for %s: %s", name, exc)
        today = time.strftime("%Y-%m-%d")
        # The toggle's date line: the day it first went up survives every republish; "Updated" is today's re-render.
        created = str(previous.get("created_at") or "")[:10] if previous else ""
        if previous and not created:
            # Records seeded from the curated page carry the seeding time, not the day the toggles were made.
            created = self.CURATED_TOGGLES_CREATED if previous.get("seeded") else str(previous.get("published_at") or today)[:10]
        created = created or today
        shown_price = str(pkg.get("price", ""))
        if (self.cfg.notion.package_email_price_rule or "").strip().lower() == "visible":
            record_figs = {a.replace(" ", "").rstrip(",.") for a in re.findall(r"\$\s?\d[\d,]*(?:\.\d+)?\s?[kKmM]?", shown_price + " " + " ".join(str(d) for d in (pkg.get("deliverables") or [])))}
            allowed = {a.replace(" ", "") for a in self.cfg.notion.package_email_allowed_figures}
            ceo_figs = [a.strip().rstrip(",.") for a in re.findall(r"\$\s?\d[\d,]*(?:\.\d+)?\s?[kKmM]?", email + " " + action.title)
                        if a.replace(" ", "").rstrip(",.") not in record_figs | allowed]
            if ceo_figs:
                shown_price = f"The CEO's price: {', '.join(dict.fromkeys(ceo_figs))} (Package Designer's research: {shown_price or 'no figure'})"
                event(self.logger, "package_price_by_ceo", name=name[:80], ceo=ceo_figs[:3], record=str(pkg.get("price", ""))[:60])
        url = self.notion.append_package_toggle(
            page_id, action.title.strip(), email, sources, company, action.conclusion.strip(),
            audience=str(pkg.get("audience", "")), price=shown_price, timeline=str(pkg.get("timeline", "")),
            deliverables=[str(d) for d in (pkg.get("deliverables") or [])], rationale=str(pkg.get("rationale", "")),
            created=created, updated=today if previous else "",
        )
        problem = self._confirm_write(self.notion, "publish_package", block_id=str(getattr(self.notion, "last_toggle_id", "") or ""))
        if problem:
            return ExecResult(False, f"package '{name[:60]}' not confirmed on the page: {problem}", False,
                              feedback="The toggle is not on the packages page; it does not count. Try once more, or report it.")
        published = set(self._published_package_names())
        published.add(name.lower())
        self.memory.db.set_state("published_packages", json.dumps(sorted(published)))
        blocks[name.lower()] = {"block_id": str(getattr(self.notion, "last_toggle_id", "") or ""),
                                "has_company": bool(str(sc.get("name", "")).strip()), "title": action.title.strip()[:200],
                                "email_sha": hashlib.sha256(action.email.strip().encode()).hexdigest(),
                                "format_version": self.cfg.notion.package_format_version, "package": pkg,
                                "published_at": time.strftime("%Y-%m-%dT%H:%M:%S"), "created_at": created,
                                "updated_at": today if previous else None}
        self.memory.db.set_state("published_package_blocks", json.dumps(blocks))
        self._drop_republish_request(name)
        self.memory.write_journal(f"Published '{name}' to the packages page: {action.title.strip()[:80]}", heading="Package page")
        self._report(f"{'replaced' if replaced else 'published'} package \"{name[:60]}\" on the packages page")
        event(self.logger, "publish_package", name=name[:120], page=page_id, replaced=replaced)
        verb = "replaced on" if replaced else "published to"
        return ExecResult(
            True, f"{verb} the packages page: '{name[:60]}'", True,
            feedback=f"'{name}' is on the packages page now; do not publish it again. Publish a different package next time.",
        )

    TRACE_EVERY = 20  # one allowed decision in this many is kept, plus every refused one
    TRACE_DAYS = 7

    def _save_trace(self, action_type: str, verdict: Any) -> None:
        """The full prompt and reply behind a decision, for "why did it do that" (owner, 2026-10-06): every refused step
        and one allowed step in TRACE_EVERY, in workspace/traces/<day>/, kept TRACE_DAYS days. Never fails the step."""
        try:
            self._trace_n = getattr(self, "_trace_n", 0) + 1
            if verdict.allowed and self._trace_n % self.TRACE_EVERY:
                return
            day = time.strftime("%Y-%m-%d")
            folder = self.cfg.workspace / "traces" / day
            folder.mkdir(parents=True, exist_ok=True)
            t = getattr(self, "_last_trace", None) or {}
            record = {"at": time.strftime("%Y-%m-%dT%H:%M:%S"), "cycle": self.cycle_no, "action": action_type,
                      "verdict": "allowed" if verdict.allowed else "rejected: " + str(verdict.reason), **t}
            (folder / f"{time.strftime('%H%M%S')}-{self.cycle_no}-{action_type}.json").write_text(json.dumps(record, ensure_ascii=False, indent=1), encoding="utf-8")
            cutoff = time.time() - self.TRACE_DAYS * 86400
            for old in (self.cfg.workspace / "traces").iterdir():
                if old.is_dir() and old.stat().st_mtime < cutoff:
                    import shutil

                    shutil.rmtree(old, ignore_errors=True)
        except Exception:  # noqa: BLE001
            pass

    def _execute_pace_member(self, action: PaceMember) -> ExecResult:
        """Pause, slow or restart a family member (owner, 2026-10-07: "let ceoA have this access and also let him start
        those he pause himself apart from me"). Only its own holds: the owner's STOP and PAUSE are never touched."""
        from .hold import clear_hold, read_hold, until_text, write_hold

        m = self.cfg.messaging
        folder = m.folder_for(action.name.strip())
        if not folder:
            return ExecResult(False, f"{action.name} is not a family member you can reach", False)
        name = next(p for p in m.peer_names if p.lower() == action.name.strip().lower())
        ws = Path(folder).expanduser() / "workspace"
        if (ws / "STOP").exists() or (ws / "PAUSE").exists():
            return ExecResult(False, f"the owner {'stopped' if (ws / 'STOP').exists() else 'paused'} {name}; only the owner starts it again", False)
        hold = read_hold(ws)
        me = self.cfg.agent.name
        if action.mode == "resume":
            if hold is None:
                return ExecResult(False, f"{name} is running; there is no hold of yours to lift", False)
            if str(hold.get("by", "")).strip().lower() != me.lower():
                return ExecResult(False, f"{name} was held by {hold.get('by')}, not you; leave it", False)
            clear_hold(ws)
            detail = f"{name} runs again at full speed"
        else:
            step = max(2, min(60, int(action.minutes_between_steps))) * 60 if action.mode == "slow" else 0
            hours = max(0.5, min(24.0, float(action.hours)))
            hold = write_hold(ws, me, action.mode, hours, action.why, step)
            detail = (f"{name} paused until {until_text(hold)}" if action.mode == "pause"
                      else f"{name} slowed to one step every {step // 60} minutes until {until_text(hold)}")
        self.memory.write_journal(f"{detail}. Why: {action.why.strip() or 'not given'}.", heading="Family resources")
        event(self.logger, "pace_member", member=name, mode=action.mode, why=action.why.strip()[:200])
        return ExecResult(True, detail, False)

    def _execute_merge_task(self, action: MergeTask) -> ExecResult:
        """Close a task of this bot's that another of its tasks covers (owner, 2026-10-06: "let ceoA merge"). Refused while
        the closed task has been started by someone, or names a business or email the covering task does not."""
        from .policy import resolve_task_title

        if self.notion is None:
            return ExecResult(False, "merging tasks is not enabled", False)
        titles = self.memory.recent_task_titles()
        rows = [self.memory.find_task(resolve_task_title(t, titles) or t) for t in (action.title, action.into)]
        if any(r is None for r in rows):
            return ExecResult(False, "one of those is not a task of yours", False)
        src_id, dst_id = (page_id_from_url(str(r["url"] or "")) for r in rows)
        if not src_id or not dst_id:
            return ExecResult(False, "a task has no Notion page id on record", False)
        try:
            page = self.notion.read_page(src_id)
            status = str(((page or {}).get("fields") or {}).get(self.cfg.notion.status_property, "")).strip()
            if page is None or (status and status != self.cfg.notion.status_value):
                return ExecResult(False, f"'{rows[0]['title'][:60]}' is '{status or 'gone'}', not '{self.cfg.notion.status_value}': "
                                  "someone has it in hand, leave it", False)
            src_text, dst_text = self.notion.page_text(src_id).lower(), self.notion.page_text(dst_id).lower()
        except Exception as exc:  # noqa: BLE001
            return ExecResult(False, f"could not read the tasks: {str(exc)[:160]}", False)
        src_text += "\n" + str(rows[0]["title"]).lower()
        dst_text += "\n" + str(rows[1]["title"]).lower()
        missing = sorted({e for e in re.findall(r"[\w.+-]+@[\w-]+\.[\w.-]+", src_text) if e.rstrip(".") not in dst_text})
        names, _ = self._outreach_leads_all()
        missing += sorted(n for n in names if n.lower() in src_text and n.lower() not in dst_text)
        if missing:
            return ExecResult(False, f"not merged: '{rows[1]['title'][:60]}' does not have {', '.join(missing[:6])}"
                              + (f" and {len(missing) - 6} more" if len(missing) > 6 else ""), False,
                              feedback="Add what is missing to the covering task with update_task details_append, then merge.")
        self.notion.set_status(src_id, self.cfg.notion.merge_status.strip())
        self.notion.update_task(src_id, details_append=f"Merged into \"{rows[1]['title']}\" on {time.strftime('%Y-%m-%d')}: its work continues there.")
        self.memory.write_journal(f"Merged task '{rows[0]['title']}' into '{rows[1]['title']}'.", heading="Task")
        event(self.logger, "merge_task", closed=str(rows[0]["title"])[:120], into=str(rows[1]["title"])[:120])
        return ExecResult(True, f"merged '{rows[0]['title'][:60]}' into '{rows[1]['title'][:60]}'", True)

    def _outreach_leads_all(self) -> tuple[list[str], int]:
        """Every business name the lead-finding colleague has listed (for the merge check); [] when unknown."""
        who = (self.cfg.leads.outreach_from or "").strip()
        folder = self.cfg.messaging.folder_for(who) if who else None
        if not folder:
            return [], 0
        try:
            import sqlite3 as _sq

            con = _sq.connect(f"file:{Path(folder).expanduser() / 'workspace' / 'explorer.sqlite3'}?mode=ro", uri=True, timeout=5)
            try:
                names = [str(r[0]).strip() for r in con.execute("SELECT name FROM leads") if r[0] and len(str(r[0]).strip()) >= 4]
            finally:
                con.close()
            return names, len(names)
        except Exception:  # noqa: BLE001
            return [], 0

    def _execute_update_task(self, action: UpdateTask, ep: sqlite3.Row) -> ExecResult:
        """Fix one of this bot's own Notion tasks (assignee / priority / deadline / appended details). Policy applied
        the rules; the page id comes from the URL the task was created with."""
        if self.notion is None:
            return ExecResult(False, "updating tasks is not enabled", False)
        row = self.memory.find_task(action.title)
        if row is None:
            from .policy import resolve_task_title

            full = resolve_task_title(action.title, self.memory.recent_task_titles())
            row = self.memory.find_task(full) if full else None
        if row is None:
            return ExecResult(False, f"no task of yours is titled '{action.title.strip()[:60]}'", False,
                              feedback="update_task needs the exact title of a task you created; check your recent tasks.")
        page_id = page_id_from_url(str(row["url"] or ""))
        if not page_id:
            return ExecResult(False, "that task has no Notion page id on record", False)
        assignee = action.assignee if self.cfg.notion.assign_people else None
        if assignee and assignee.strip() and self.team:
            member = find_member(self.team, assignee)
            assignee = member.name if member is not None else assignee
        self.notion.update_task(page_id, assignee=assignee, priority=action.priority, due=action.due,
                                details_append=action.details_append)
        problem = self._confirm_write(self.notion, "update_task", page_id=page_id)
        if problem:
            return ExecResult(False, f"update of task '{str(row['title'])[:60]}' not confirmed: {problem}", False)
        warnings = list(getattr(self.notion, "last_warnings", []) or [])
        self.memory.update_task_row(int(row["id"]), assignee, action.priority, action.due)
        changed = [k for k, v in (("assignee", assignee), ("priority", action.priority), ("due", action.due),
                                  ("details", action.details_append)) if v is not None and str(v).strip()]
        self.memory.write_journal(f"Updated task '{row['title']}': {', '.join(changed)} ({row['url']})", heading="Task")
        event(self.logger, "update_task", title=str(row["title"])[:120], changed=changed, url=str(row["url"]), warnings=warnings)
        note = (" Note: " + "; ".join(warnings) + ".") if warnings else ""
        return ExecResult(
            True, f"updated task '{str(row['title'])[:60]}' ({', '.join(changed)})", True,
            feedback=f"Task updated ({', '.join(changed)}). It is fixed now; do not update it again for the same thing.{note}",
        )

    def _execute_lead(self, action: Lead, ep: sqlite3.Row | None = None) -> ExecResult:
        """One row on the owner's Leads board, and a heads-up to the CEO. The policy grounded every field."""
        if self.leads_notion is None:
            return ExecResult(False, "listing leads is not enabled", False)
        import datetime as _dt
        fields = {
            "Website": action.website.strip(), "Business email": action.email.strip(), "Location": action.location.strip(),
            "Industry": action.industry.strip(), "Company size": action.size.strip(), "Pain point": action.pain_point.strip(),
            "How can I help": action.how_we_help.strip(), "Evidence": action.evidence.strip(),
            "Source pages": "\n".join(u.strip() for u in action.sources if u.strip()),
        }
        if action.whatsapp.strip():
            from .whatsapp import wa_link

            fields["Whatsapp"] = wa_link(action.whatsapp, self.cfg.leads.whatsapp_country_code) or ""
            fields["Source pages"] = self._with_number_page(fields["Source pages"], fields["Whatsapp"])
        if action.map_url.strip():  # a Maps link a page shows; the Lead Enricher fills the rest from map data (owner, 2026-10-10)
            fields["google map location"] = action.map_url.strip()
        check = self._verify_lead_email(action.email.strip()) if action.email.strip() else None
        if check is not None:
            if check.get("result") in self.cfg.leads.email_verify_refuse or check.get("disposable"):
                why = "a disposable mailbox" if check.get("disposable") else f"the mail server rejects it ({check.get('reason') or 'no such mailbox'})"
                return ExecResult(False, f"lead '{action.name.strip()[:60]}' not listed: {action.email.strip()} does not take mail -- {why}", False,
                                  feedback=f"{action.email.strip()} was checked and does not accept mail ({why}). Look for another address the "
                                  "business publishes on its own site; if there is none, move on to a different business.")
            from .email_verify import describe

            fields["Email check"] = describe(check)
        url = self.leads_notion.create_row(action.name.strip(), fields)
        problem = self._confirm_write(self.leads_notion, "lead", page_id=page_id_from_url(url) or "",
                                      expect={"Website": fields["Website"], "Business email": fields["Business email"]})
        if problem:
            return ExecResult(False, f"lead '{action.name.strip()[:60]}' not confirmed: {problem}", False,
                              feedback="The row did not land on the Leads board; it does not count. Try once more, or report it.")
        from .policy import lead_key

        key = url_domain(action.website) if action.website.strip() else lead_key(action.name, action.location)
        self.memory.add_lead(int(ep["id"]) if ep is not None else None, action.name, action.website, key,
                             action.email, action.how_we_help, url, page_id_from_url(url) or "")
        self.pages_since_note = 0  # a lead is the output the reading was for
        warnings = list(getattr(self.leads_notion, "last_warnings", []) or [])
        L = self.cfg.leads
        if L.notify_folder.strip():
            reach = "Business email on their site" if action.website.strip() and action.email.strip() else (
                "no website; reached through its listing" + (" and WhatsApp" if action.whatsapp.strip() else ""))
            text = (f"new lead \"{action.name.strip()}\" ({action.website.strip() or 'no website'}): {action.pain_point.strip()[:300]} "
                    f"-- fits {action.how_we_help.strip()}. {reach}; row on the Leads board: {url}")
            try:
                send_message(Path(L.notify_folder).expanduser(), self.cfg.agent.name, text)
            except OSError as exc:
                warnings.append(f"could not notify {L.notify_name}: {exc}")
        self.memory.write_journal(f"Listed lead '{action.name.strip()}' ({action.website.strip()}): {action.pain_point.strip()[:160]} -> {action.how_we_help.strip()} ({url})", heading="Lead")
        self._report(f"listed lead \"{action.name.strip()[:60]}\" ({url_domain(action.website)}) on the Leads board -- fits {action.how_we_help.strip()}; told {L.notify_name}")
        event(self.logger, "lead", name=action.name.strip()[:120], website=action.website.strip(), fix=action.how_we_help.strip(), url=url, warnings=warnings)
        note = (" Note: " + "; ".join(warnings) + ".") if warnings else ""
        return ExecResult(
            True, f"listed lead '{action.name.strip()[:60]}' on the Leads board: {url}", True,
            feedback=f"'{action.name.strip()}' is on the Leads board now; do not list it again. Find a different business next.{note}",
        )

    # -- the page is the CEO's to keep current --------------------------------------------------------------------

    REPUBLISH_REQUESTS = Path.home() / "bots" / "common-data" / "shared-state" / "republish-requests.json"
    # The eight curated toggles were first put on the owner's page on this day; their seeded records have no created_at.
    CURATED_TOGGLES_CREATED = "2026-09-22"

    def _published_blocks(self) -> dict[str, Any]:
        import json
        try:
            data = json.loads(self.memory.db.get_state("published_package_blocks", "{}") or "{}")
        except ValueError:
            data = {}
        return data if isinstance(data, dict) else {}

    def _stored_package(self, name: str) -> dict[str, Any] | None:
        """The record kept when a package was published, so a toggle can be re-rendered without a new handoff."""
        info = self._published_blocks().get(name.strip().lower())
        pkg = info.get("package") if isinstance(info, dict) else None
        return pkg if isinstance(pkg, dict) and pkg.get("name") else None

    def _republish_requests(self) -> dict[str, str]:
        """name (lower) -> reason, from the file the Validator or the owner writes: [{"name": ..., "reason": ...}, ...]."""
        import json
        try:
            data = json.loads(self.REPUBLISH_REQUESTS.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {}
        out: dict[str, str] = {}
        for item in data if isinstance(data, list) else []:
            if isinstance(item, dict) and str(item.get("name", "")).strip():
                out[str(item["name"]).strip().lower()] = str(item.get("reason", "")).strip()[:200]
        return out

    def _republish_request_keys(self) -> dict[str, str]:
        """package_key -> the newest requested_at among the requests for it ("" when a request carries no date)."""
        import json
        try:
            data = json.loads(self.REPUBLISH_REQUESTS.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {}
        out: dict[str, str] = {}
        for item in data if isinstance(data, list) else []:
            if isinstance(item, dict) and str(item.get("name", "")).strip():
                k, at = package_key(str(item["name"])), str(item.get("requested_at") or "")
                out[k] = max(out.get(k, at), at)
        return out

    def _drop_republish_request(self, name: str) -> None:
        """A publish serves every request for its package_key, whatever spelling the request used."""
        import json
        key = package_key(name)
        if key not in {package_key(n) for n in self._republish_requests()}:
            return
        try:
            data = json.loads(self.REPUBLISH_REQUESTS.read_text(encoding="utf-8"))
            data = [d for d in data if not (isinstance(d, dict) and package_key(str(d.get("name", ""))) == key)]
            self.REPUBLISH_REQUESTS.write_text(json.dumps(data, indent=1, ensure_ascii=False), encoding="utf-8")
        except (OSError, ValueError):
            pass

    def _stale_toggles(self) -> dict[str, str]:
        """Published packages that should go up again, with why: an older pitch format, a republish request, or a
        toggle that had no source company while the package now has one."""
        out: dict[str, str] = {}
        current = self.cfg.notion.package_format_version
        for name, info in self._published_blocks().items():
            if not isinstance(info, dict):
                continue
            if int(info.get("format_version", 1) or 1) < current:
                out[name] = f"written in pitch format v{info.get('format_version', 1)}; the current format is v{current}"
            elif not info.get("has_company"):
                pkg = find_package(self.cfg.workspace, name)
                if pkg and str((pkg.get("source_company") or {}).get("name", "")).strip():
                    out[name] = "the Package Designer re-sent it with the reference company's facts"
        blocks = self._published_blocks()
        for name, reason in self._republish_requests().items():
            if name in blocks:
                out[name] = reason or "flagged by the Validator or the owner"
        # A package handed over (by the Package Designer or the owner) that never went up is upkeep too: The CEO sat on
        # one handed-over package record for a day while publishing other things (2026-09-25).
        from .handoff import received_package_names

        published = {str(k).strip().lower() for k in blocks} | self._published_package_names()
        try:  # PK14 said "this offer is already on the page": the banner kept sending The CEO back to publish it
            for r in self.memory.db.query("SELECT DISTINCT payload FROM actions WHERE action_type = 'publish_package' AND verdict LIKE '%PK14%'"):
                published.add(str(json.loads(r["payload"]).get("name", "")).strip().lower())
        except (ValueError, sqlite3.Error):
            pass
        for name, received in received_package_names(self.cfg.root).items():
            if name.strip().lower() not in published and name not in out:
                out[name] = f"received on {received} and not on the page yet"
        return out

    def _republish_banner(self) -> str | None:
        stale = self._stale_toggles()
        if not stale or self.notion is None or not self.cfg.notion.package_page_id.strip():
            return None
        name, reason = next(iter(sorted(stale.items())))
        info = self._published_blocks().get(name, {})
        shown = (info.get("package") or {}).get("name") if isinstance(info, dict) else None
        if not info:  # not on the page at all: a received package still waiting
            return (
                f"PAGE UPKEEP: {len(stale)} package{'s' if len(stale) != 1 else ''} need{'' if len(stale) != 1 else 's'} the Notion "
                f"packages page. Publish \"{name}\" this episode with publish_package ({reason}): write the marketing title and the "
                "ready-to-send email in the current format; its facts come from the package record. One per episode."
            )
        return (
            f"PAGE UPKEEP: {len(stale)} package toggle{'s' if len(stale) != 1 else ''} on the Notion packages page "
            f"{'are' if len(stale) != 1 else 'is'} out of date. Republish \"{shown or name}\" this episode with publish_package "
            f"({reason}): write the pitch afresh in the current format; its facts come from the package record. "
            "The old toggle is replaced. One per episode."
        )

    def _lead_site_on_board(self, name: str) -> str | None:
        """For the policy (leads.update_any_row): the site domain of a board row this bot did not list ("" if the row has
        no website), None if no row has that name. One board query per name per process."""
        if self.leads_notion is None:
            return None
        cache = self.__dict__.setdefault("_board_rows", {})
        key = name.strip().lower()
        if key not in cache:
            try:
                cache[key] = self.leads_notion.find_row(name)
                if cache[key] is None:  # a mangled name: the one close work-list business (2026-10-14)
                    close = self._close_work_list_name(name)
                    if close:
                        cache[key] = self.leads_notion.find_row(close)
            except Exception as exc:  # noqa: BLE001 - Notion errors are answers, not crashes
                event(self.logger, "leads_board_lookup_failed", name=name[:80], error=str(exc)[:200])
                return None
        row = cache[key]
        if row is None:
            return None
        site = str((row.get("fields") or {}).get("Website") or "").strip()
        return url_domain(site) if site else ""

    def _rates_text(self) -> str:
        """The owner's Rates, quoted for the Outreach Writer ([leads] rates_file): prices come from here only."""
        path = (self.cfg.leads.rates_file or "").strip()
        if not path:
            return ""
        try:
            text = Path(path).expanduser().read_text(encoding="utf-8")
        except OSError:
            return ""
        m = re.search(r"^## Rates\s*$(.*?)(?=^## |\Z)", text, re.M | re.S)
        if not m:
            return ""
        lines = [l.strip() for l in m.group(1).splitlines() if l.strip().startswith("- ")]
        return (". THE OWNER'S RATES -- the only prices you may quote, exactly as written; match the row's package to its line "
                "by product (e.g. 'Acme POS & Ordering' -> the Acme POS line); no line for it -> 'priced after a short call': "
                + " ".join(lines))[:1500]

    def _draft_queue_lines(self) -> list[str]:
        """The Outreach Writer's work list (owner, 2026-10-07): the oldest board rows still at Stage New with no draft,
        read from the board at most every five minutes; a row it wrote this episode drops out at once."""
        L = self.cfg.leads
        if self.leads_notion is None:
            return []
        now = time.time()
        cached = getattr(self, "_draft_queue_cache", None)
        if cached is None or now - cached[0] > 300:
            try:
                rows = self.leads_notion.rows_waiting(L.draft_queue_column.strip(), "Stage", L.draft_queue_stage, L.draft_queue_shown * 2, L.score_column)
            except Exception:  # noqa: BLE001
                rows = cached[1] if cached else []
            cached = self._draft_queue_cache = (now, rows)
        done = set()
        for r in self.memory.db.query("SELECT payload FROM actions WHERE action_type = 'update_lead' AND verdict = 'allowed' "
                                      "AND ts > datetime('now', '-1 day')"):
            try:
                done.add(str(json.loads(r["payload"]).get("name", "")).strip().lower())
            except ValueError:
                pass
        out = []
        for r in cached[1]:
            f = r.get("fields") or {}
            name = str(r.get("title") or "").strip()
            if not name or name.lower() in done:
                continue
            parts = [name, f.get("Website", ""), ("whatsapp: " + f["Whatsapp"] + " -> also draft_whatsapp") if str(f.get("Whatsapp") or "").strip() else "",
                     "pain point: " + (f.get("Pain point", "") or "-")[:200],
                     "how we can help: " + (f.get("How can I help", "") or "-"), "evidence: " + (f.get("Evidence", "") or "-"),
                     "contact: " + (f.get("Contact person", "") or "-"),
                     # the Validator's read of the site (2026-10-14): facts for the opening line; "Delivery apps" is a fit, not a gap
                     ("tools: " + f["Tools on site"]) if str(f.get("Tools on site") or "").strip() else "",
                     ("site: " + str(f["Site health"]).strip()[:120]) if str(f.get("Site health") or "").strip() else ""]
            out.append(" | ".join(p for p in parts if p)[:700])
            if len(out) >= max(1, L.draft_queue_shown):
                break
        if "draft_whatsapp" in [x.lower() for x in L.update_only_fields] and len(out) < max(1, L.draft_queue_shown):
            # rows drafted by email before WhatsApp drafts existed (owner, 2026-10-10): catch up, a few at a time
            wa_cached = getattr(self, "_wa_queue_cache", None)
            if wa_cached is None or now - wa_cached[0] > 300:
                try:
                    wa_rows = [r for r in self.leads_notion.rows_waiting("Draft Whatsapp msg", "Status", "", 60)
                               if str(r["fields"].get("Whatsapp") or "").strip() and str(r["fields"].get(L.draft_queue_column) or "").strip()
                               and not str(r["fields"].get(L.draft_queue_column) or "").strip().lower().startswith("skip")
                               and str(r["fields"].get("Status") or "") != L.whatsapp_false_status]
                except Exception:  # noqa: BLE001
                    wa_rows = wa_cached[1] if wa_cached else []
                wa_cached = self._wa_queue_cache = (now, wa_rows)
            for r in wa_cached[1]:
                f = r.get("fields") or {}
                name = str(r.get("title") or "").strip()
                if not name or name.lower() in done or any(o.startswith(name + " |") for o in out):
                    continue
                out.append(f"WHATSAPP DRAFT ONLY (the email is written): {name} | whatsapp: {f.get('Whatsapp', '')} | pain point: "
                           f"{(f.get('Pain point', '') or '-')[:160]} | how can I help: {f.get('How can I help', '') or '-'} | contact: {f.get('Contact person', '') or '-'}"[:600])
                if len(out) >= max(1, L.draft_queue_shown):
                    break
        shown = {str(r.get("fields", {}).get("How can I help", "") or "").strip() for r in cached[1]
                 if str(r.get("title") or "").strip() and any(o.startswith(str(r.get("title")).strip() + " |") for o in out)}
        emails = self._package_emails()
        missing = sorted(p for p in shown if p and p not in emails)
        given = [p for p in sorted(shown) if p in emails]
        if missing and not given and emails:  # a full email to copy the co-founders paragraph and portfolio line from
            given = [sorted(emails)[0]]
        for pkg in given:
            out.append(f"PACKAGE EMAIL for \"{pkg}\" (start from this; keep its numbered list, co-founders paragraph and "
                       f"portfolio line exactly):\n{self._with_signoff(emails[pkg])}")
        for pkg in missing:
            out.append(f"PACKAGE EMAIL for \"{pkg}\": none on the Packages page yet. Write it in the same shape: greeting, your "
                       "observed-gap line, 2-3 numbered points from the owner's Rates line for it (in your prompt), the price "
                       "exactly as the Rates state it (no line: 'priced after a short call'), then the co-founders paragraph and "
                       "the portfolio line copied word for word from a PACKAGE EMAIL here, and the sign-off.")
        return out

    def _with_signoff(self, email: str) -> str:
        """The package email with its own sign-off (from a line "Regards," on) replaced by [leads] draft_signoff."""
        sign = [s for s in self.cfg.leads.draft_signoff if s.strip()]
        if not sign:
            return email
        lines = email.rstrip().splitlines()
        cut = next((i for i in range(len(lines) - 1, -1, -1) if lines[i].strip().lower().rstrip(",") in ("regards", "best regards", "best", "thanks")), None)
        body = lines[:cut] if cut is not None else lines
        return "\n".join(body).rstrip() + "\n\n" + "\n".join(sign)

    def _package_emails(self) -> dict[str, str]:
        """Board package name -> its "Ready-to-send email" from the mirrored Packages page ([leads] package_emails_file),
        matched through [leads] package_aliases or by the name's start. Re-read when the file changes."""
        path = Path((self.cfg.leads.package_emails_file or "").strip()).expanduser() if (self.cfg.leads.package_emails_file or "").strip() else None
        if path is None or not path.is_file():
            return {}
        mtime = path.stat().st_mtime
        cached = getattr(self, "_pkg_email_cache", None)
        if cached and cached[0] == mtime:
            return cached[1]
        sections: dict[str, str] = {}
        title, body, inside = None, [], False
        for line in path.read_text(encoding="utf-8", errors="replace").splitlines() + ["## "]:
            if line.startswith("## "):
                if title and body:
                    sections[title] = "\n".join(body).strip()
                title, body, inside = line[3:].strip(), [], False
                continue
            if line.strip() == "Ready-to-send email":
                inside = True
                continue
            if title and inside:
                if line.strip() == "Sources":
                    inside = False
                    continue
                body.append(line)
        out: dict[str, str] = {}
        for board, prefix in self.cfg.leads.package_aliases.items():
            hit = next((t for t in sections if t.lower().startswith(prefix.strip().lower())), None)
            if hit:
                out[board] = sections[hit]
        self._pkg_email_cache = (mtime, out)
        return out

    def _close_work_list_name(self, name: str) -> str | None:
        """The one work-list business whose name matches this one apart from case, punctuation or a trailing
        market name / 'Inc' / '.com' (the writer wrote '<Business> <City>', '<Business> INC', '<business>.com')."""
        import re as _re

        market_words = sorted({w.lower() for w in (self.target.values.get("market", ""), self.target.values.get("market_short", ""),
                                                   *self.cfg.browser.places_stop_words) if w and w.strip()}, key=len, reverse=True)

        def key(t: str) -> str:
            t = _re.sub(r"\.(com|net|org)\b", "", t.lower())
            t = _re.sub(r"\b(inc|llc|corp|co|ltd)\b", "", t)
            for w in market_words:                     # the market's name and short forms (target + places_stop_words)
                t = _re.sub(rf"\b{_re.escape(w)}\b", "", t)
            return _re.sub(r"[^a-z0-9]+", "", t)
        want = key(name)
        if not want:
            return None
        names: list[str] = []
        for cached in (getattr(self, "_draft_queue_cache", None), getattr(self, "_wa_queue_cache", None)):
            if cached:
                names += [str(r.get("title") or "") for r in cached[1]]
        try:
            names += [l.split(" | ")[0].strip() for l in self._decide_lines()]
        except Exception:  # noqa: BLE001
            pass
        hits = sorted({n for n in names if n and (key(n) == want or (len(want) > 6 and (key(n).startswith(want) or want.startswith(key(n)))))})
        return hits[0] if len(hits) == 1 else None

    def _row_fields(self, page_id: str) -> dict:
        if self.leads_notion is None:
            return {}
        try:
            return dict((self.leads_notion.read_page(page_id) or {}).get("fields") or {})
        except Exception:  # noqa: BLE001
            return {}

    def _draft_exists(self, page_id: str) -> bool:
        """The row's draft column already holds a draft or a "skip:" note."""
        col = (self.cfg.leads.draft_queue_column or "").strip()
        return bool(col) and bool(str(self._row_fields(page_id).get(col, "")).strip())

    def _validator_named(self, name: str) -> bool:
        """An open message from the Validator to this bot names this business (a fix it asked for)."""
        if self.requests is None or not name.strip():
            return False
        try:
            return any(r.sender.strip().lower() == "validator" and name.strip().lower() in r.text.lower()
                       for r in self.requests.open_for(self.cfg.agent.name))
        except Exception:  # noqa: BLE001
            return False

    def _whatsapp_marked_false(self, page_id: str) -> bool:
        """The row's Status says a person found its WhatsApp link false ([leads] whatsapp_false_status)."""
        status = (self.cfg.leads.whatsapp_false_status or "").strip()
        if not status or self.leads_notion is None:
            return False
        try:
            fields = (self.leads_notion.read_page(page_id) or {}).get("fields") or {}
        except Exception:  # noqa: BLE001
            return False
        return str(fields.get("Status", "")).strip() == status

    def _auto_fill_from_places(self) -> int:
        """The Lead Enricher's engine step ([leads] auto_fill_from_places): for the rows on its decide list, fill an empty
        "google map location" and Location from the Overture snapshot's one confident match (places.find_place), read
        each write back, log it as this bot's. At most five rows a cycle; a row is tried once a day."""
        L = self.cfg.leads
        if not (L.enabled and L.auto_fill_from_places and self.leads_notion is not None and L.decide_glob.strip()):
            return 0
        from .places import find_place

        tried = self.__dict__.setdefault("_places_tried", {})
        today = time.strftime("%Y-%m-%d")
        done = 0
        for line in self._decide_lines():
            name = line.split("|")[0].strip()
            if not name or tried.get(name) == today:
                continue
            tried[name] = today
            try:
                row = self.leads_notion.find_row(name)
            except Exception:  # noqa: BLE001
                continue
            if not row:
                continue
            f = row.get("fields") or {}
            if not str(self.cfg.browser.places_db).strip():
                break                                   # no places snapshot configured: nothing to match against
            place = find_place(name, str(f.get("Location") or ""), Path(str(self.cfg.browser.places_db)).expanduser(), str(f.get("Website") or ""),
                               industry=str(f.get("Industry") or ""), size=str(f.get("Company size") or ""))
            if not place:
                continue
            fields: dict[str, str] = {}
            if not str(f.get("google map location") or "").strip():
                fields["google map location"] = f"https://www.google.com/maps/search/?api=1&query={place['lat']:.6f},{place['lon']:.6f}"
            if not str(f.get("Location") or "").strip() and place.get("locality") and place.get("region"):
                fields["Location"] = f"{place['locality']}, {place['region']}, USA"
            if not fields:
                continue
            try:
                self.leads_notion.update_row(str(row["page_id"]), fields)
                back = (self.leads_notion.read_page(str(row["page_id"])) or {}).get("fields") or {}
            except Exception as exc:  # noqa: BLE001
                event(self.logger, "places_fill_failed", business=name[:80], error=str(exc)[:160])
                continue
            landed = {k: v for k, v in fields.items() if str(back.get(k) or "").strip() == v}
            if landed:
                self._log_fact_fill(name, landed, f"Overture Maps: {place['name']}, {place.get('address') or ''}, {place.get('locality') or ''} {place.get('region') or ''}")
                event(self.logger, "places_fill", business=name[:80], fields=sorted(landed))
                done += 1
            if done >= 5:
                break
        return done

    def _log_fact_fill(self, business: str, fields: dict[str, str], source: str) -> None:
        try:
            path = self.cfg.root.parent / "common-data" / "shared-state" / "leads-facts-applied.jsonl"
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open("a", encoding="utf-8") as fh:
                for col, val in fields.items():
                    fh.write(json.dumps({"at": now_iso(), "by": self.cfg.agent.name, "business": business, "field": col, "value": val, "source": source}, ensure_ascii=False) + "\n")
        except OSError:
            pass

    def _map_link(self, name: str, location: str, website: str = "") -> str | None:
        from .places import map_link

        if not str(self.cfg.browser.places_db).strip():
            return None
        try:
            return map_link(name, location, Path(str(self.cfg.browser.places_db)).expanduser(), website)
        except Exception:  # noqa: BLE001
            return None

    def _with_number_page(self, sources: str, link: str) -> str:
        """Source pages with the page the WhatsApp number was read from added, so the Validator can find it (LD20)."""
        from .whatsapp import page_with

        url = page_with(link, dict(self.recent_pages)) if link else None
        lines = [u for u in (sources or "").splitlines() if u.strip()]
        if url and url not in lines:
            lines.append(url)
        return "\n".join(lines)

    def _execute_update_lead(self, action: UpdateLead) -> ExecResult:
        """Fix a Leads-board row: one of this bot's own (the page id was recorded when it listed the lead) or, with
        leads.update_any_row, any row on the board (looked up by name; it becomes one of the bot's rows afterwards)."""
        if self.leads_notion is None:
            return ExecResult(False, "updating leads is not enabled", False)
        if " | " in action.name:  # the work-list line pasted whole ("Studio One | https://...", 19 refusals a day)
            action.name = action.name.split(" | ")[0].strip()
        row = self.memory.find_lead(action.name)
        if row is None and self.cfg.leads.update_any_row:
            close = self._close_work_list_name(action.name)
            if close and close != action.name:
                action.name = close
            found = (self.__dict__.get("_board_rows") or {}).get(action.name.strip().lower()) or self.leads_notion.find_row(action.name)
            if found:
                fields = found.get("fields") or {}
                site = str(fields.get("Website") or "")
                lead_id = self.memory.add_lead(None, action.name, site, url_domain(site) if site else "",
                                               str(fields.get("Business email") or ""), str(fields.get("How can I help") or ""),
                                               str(found.get("url") or ""), str(found.get("page_id") or ""))
                row = self.memory.db.query("SELECT * FROM leads WHERE id = ?", (lead_id,))[0]
        if row is None:
            return ExecResult(False, f"no lead on the board is named '{action.name.strip()[:60]}'", False,
                              feedback="update_lead needs the exact business name of a row on the Leads board.")
        page_id = str(row["page_id"] or "") or page_id_from_url(str(row["url"] or "")) or ""
        if not page_id:
            return ExecResult(False, "that lead has no Notion page id on record", False)
        mapping = (("website", "Website"), ("email", "Business email"), ("location", "Location"), ("industry", "Industry"),
                   ("size", "Company size"), ("pain_point", "Pain point"), ("how_we_help", "How can I help"), ("evidence", "Evidence"),
                   ("founded_by", "Contact person"), ("contact_role", "Contact role"), ("draft_email", "Draft email"), ("draft_whatsapp", "Draft Whatsapp msg"),
                   ("map_url", "google map location"), ("founder_linkedin", "Founder LinkedIn"),
                   ("linkedin_via", "LinkedIn found via"))  # the owner's column names (2026-10-10; LinkedIn 2026-10-14)
        fields = {col: str(getattr(action, attr)).strip() for attr, col in mapping if getattr(action, attr) is not None and str(getattr(action, attr)).strip()}
        if action.sources:
            # appended, never replaced: the row's record of pages read grows (2026-10-10)
            old = str(self._row_fields(page_id).get("Source pages") or "")
            fields["Source pages"] = "\n".join(dict.fromkeys(u.strip() for u in (old.splitlines() + list(action.sources)) if u.strip()))
        if self.cfg.leads.fill_only:
            cur = self._row_fields(page_id)
            taken = [col for col in fields if col != "Source pages" and str(cur.get(col) or "").strip()]
            if taken:
                return ExecResult(False, f"'{str(row['name'])[:60]}' already has {', '.join(taken)}; you fill empty cells only", False,
                                  feedback="Leave cells that already have a value; fill only the empty ones on your list.")
        if "/in/" in fields.get("Founder LinkedIn", "").lower() and not (fields.get("Contact person") or str(self._row_fields(page_id).get("Contact person") or "").strip()):
            # a person's profile with nobody named is the personal-data side of the fence (2026-10-14); /company/ needs no founder
            return ExecResult(False, f"'{str(row['name'])[:60]}' has no Contact person; a person's LinkedIn profile needs that person's name on the row", False,
                              feedback="Give founded_by in the same update (as a page states it), or leave the profile link out. A /company/ page needs no founder.")
        if "Draft email" in fields and self._draft_exists(page_id) and not self._validator_named(str(row["name"])):
            # 2026-10-09: Harbor Tacos was rewritten 56 times (a stale plan of the writer's); a row with a draft or a
            # skip is done unless the Validator names it for a fix
            return ExecResult(False, f"'{str(row['name'])[:60]}' already has a draft; it is done unless the Validator asks for a fix", False,
                              feedback="That row is finished. Take the next row of your work list.")
        if "Draft Whatsapp msg" in fields:
            cur = self._row_fields(page_id)
            if not str(cur.get("Whatsapp") or "").strip() or str(cur.get("Status") or "").strip() == self.cfg.leads.whatsapp_false_status:
                return ExecResult(False, f"'{str(row['name'])[:60]}' has no working WhatsApp link; no WhatsApp message for it", False,
                                  feedback="Only rows with a Whatsapp link get a WhatsApp draft.")
            if str(cur.get("Draft Whatsapp msg") or "").strip() and not self._validator_named(str(row["name"])):
                return ExecResult(False, f"'{str(row['name'])[:60]}' already has a WhatsApp draft", False,
                                  feedback="That row's WhatsApp message is done. Take the next row of your work list.")
        if action.whatsapp and action.whatsapp.strip() and self._whatsapp_marked_false(page_id):
            return ExecResult(False, f"'{str(row['name'])[:60]}': a person found its WhatsApp number does not reach WhatsApp; "
                              "leave the Whatsapp cell to the team", False,
                              feedback="Do not give whatsapp for this business again; update the other fields without it.")
        if action.whatsapp and action.whatsapp.strip():
            from .whatsapp import wa_link

            link = wa_link(action.whatsapp, self.cfg.leads.whatsapp_country_code)
            if link:
                fields["Whatsapp"] = link
                cited = self._with_number_page(fields.get("Source pages", ""), link)
                if cited != fields.get("Source pages", ""):
                    # the row's existing sources stay; the page the number came from is added (the Validator's LD20 reads them)
                    try:
                        old = str((self.leads_notion.read_page(page_id) or {}).get("fields", {}).get("Source pages", ""))
                    except Exception:  # noqa: BLE001
                        old = ""
                    fields["Source pages"] = "\n".join(u for u in dict.fromkeys((old + "\n" + cited).splitlines()) if u.strip())
        if "Business email" in fields:
            check = self._verify_lead_email(fields["Business email"])
            if check is not None:
                if check.get("result") in self.cfg.leads.email_verify_refuse or check.get("disposable"):
                    return ExecResult(False, f"update of lead '{str(row['name'])[:60]}' not written: {fields['Business email']} does not take mail "
                                      f"({check.get('reason') or 'rejected'})", False,
                                      feedback="That address was checked and does not accept mail; find another one the business publishes.")
                from .email_verify import describe

                fields["Email check"] = describe(check)
        self.leads_notion.update_row(page_id, fields)
        problem = self._confirm_write(self.leads_notion, "update_lead", page_id=page_id, expect={k: v for k, v in fields.items() if k != "Email check"})
        if problem:
            return ExecResult(False, f"update of lead '{str(row['name'])[:60]}' not confirmed: {problem}", False,
                              feedback="The change is not on the row; it does not count as done. Check the value and try once more, or report it.")
        warnings = list(getattr(self.leads_notion, "last_warnings", []) or [])
        for col in ("Draft email", "Draft Whatsapp msg"):
            if col in fields:
                # owner, 2026-10-07: "I need them on notion - may be under the description": the draft on the lead's page too
                try:
                    self.leads_notion.replace_section(page_id, col, fields[col])
                except Exception as exc:  # noqa: BLE001 - the cell holds the draft either way
                    warnings.append(f"the draft is in the cell but not on the page ({str(exc)[:120]})")
        site = str(action.website).strip() if action.website and action.website.strip() else None
        self.memory.update_lead_row(int(row["id"]), site, url_domain(site) if site else None, action.email, action.how_we_help)
        changed = list(fields)
        if self.cfg.leads.update_only_fields:  # a deciding bot's choices go on a record of their own
            try:
                path = self.cfg.root.parent / "common-data" / "shared-state" / "leads-decisions.jsonl"
                with path.open("a", encoding="utf-8") as fh:
                    fh.write(json.dumps({"at": now_iso(), "by": self.cfg.agent.name, "business": str(row["name"]), "fields": fields}, ensure_ascii=False) + "\n")
            except OSError:
                pass
        self.memory.write_journal(f"Updated lead '{row['name']}': {', '.join(changed)} ({row['url']})", heading="Lead")
        event(self.logger, "update_lead", name=str(row["name"])[:120], changed=changed, url=str(row["url"]), warnings=warnings)
        note = (" Note: " + "; ".join(warnings) + ".") if warnings else ""
        self.pages_since_note = 0  # a written row is this bot's output, like a note (the page cap counts from here)
        return ExecResult(
            True, f"updated lead '{str(row['name'])[:60]}' ({', '.join(changed)})", True,
            feedback=f"Lead updated ({', '.join(changed)}). It is fixed now; do not update it again for the same thing.{note}",
        )

    def _recent_package_publishes(self) -> dict[str, str]:
        """package_key -> when it last went up, within notion.republish_days (the weekly republish rule)."""
        days = self.cfg.notion.republish_days
        if days <= 0:
            return {}
        since = time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime(time.time() - days * 86400))
        return {package_key(n): ts for n, ts in self.memory.published_packages_since(since)}

    def _packages_refused_today(self) -> set[str]:
        """Package names whose publish_package was refused today for a 'today' reason (already replaced / published)."""
        import datetime as _dt

        out: set[str] = set()
        try:
            for r in self.memory.db.query("SELECT payload FROM actions WHERE action_type = 'publish_package' AND verdict != 'allowed' "
                                          "AND verdict LIKE '%today%' AND ts >= ?", (_dt.date.today().isoformat(),)):
                try:
                    out.add(str(json.loads(r["payload"]).get("name", "")).strip().lower())
                except ValueError:
                    pass
        except Exception:  # noqa: BLE001
            pass
        out.discard("")
        return out

    def _republishable_package_names(self) -> set[str]:
        """Names the policy may accept again although they are on the page (see _stale_toggles)."""
        return set(self._stale_toggles())

    def _packages_on_page(self) -> dict[str, dict]:
        """The toggles really on the page, for the policy: title, a hash of the email and the day each last went up."""
        out: dict[str, dict] = {}
        for name, info in self._published_blocks().items():
            if isinstance(info, dict):
                shown = (info.get("package") or {}).get("name") if isinstance(info.get("package"), dict) else None
                out[str(name).lower()] = {"name": str(shown or name), "title": str(info.get("title") or ""), "email_sha": str(info.get("email_sha") or ""),
                                          "day": str(info.get("published_at") or "")[:10]}
        return out

    def _page_packages(self) -> dict[str, str]:
        """Exact name -> title of every toggle on the Packages page: this bot's own record (The CEO), or, for a bot that
        hands packages to The CEO, the CEO's record read-only (near-duplicate check, creatorCC queue 15)."""
        blocks = dict(self._published_blocks())
        h = self.cfg.handoff
        if h.enabled and h.to_folder.strip():
            db = Path(h.to_folder).expanduser() / "workspace" / "explorer.sqlite3"
            try:
                con = sqlite3.connect(f"file:{db}?mode=ro", uri=True, timeout=1)
                try:
                    row = con.execute("SELECT value FROM state WHERE key = 'published_package_blocks'").fetchone()
                finally:
                    con.close()
                theirs = json.loads(row[0]) if row and row[0] else {}
                if isinstance(theirs, dict):
                    blocks.update(theirs)
            except (sqlite3.Error, ValueError):
                pass
        out: dict[str, str] = {}
        for name, info in blocks.items():
            if isinstance(info, dict):
                shown = (info.get("package") or {}).get("name") if isinstance(info.get("package"), dict) else None
                out[str(shown or name)] = str(info.get("title") or "")
        return out

    def _published_package_names(self) -> set[str]:
        import json
        try:
            return set(json.loads(self.memory.db.get_state("published_packages", "[]") or "[]"))
        except ValueError:
            return set()

    def _execute_message(self, action: Message) -> ExecResult:
        """Drop a short research message into the peer bot's inbox. The policy applied the rules."""
        m = self.cfg.messaging
        if not m.enabled:
            return ExecResult(False, "messaging another bot is not enabled", False)
        to = action.to.strip()
        text = action.text.strip()
        if is_room_recipient(to) and self.chatroom is not None:
            self.chatroom.post(self.cfg.agent.name, text)
            self.memory.write_journal(f"Posted to the fleet chatroom: {text[:200]}", heading="Chatroom")
            event(self.logger, "chatroom_post", chars=len(text))
            self._owner_ask_passed_on("the fleet", text)
            return ExecResult(
                True, f"posted to the fleet chatroom: {text[:80]}", True,
                feedback="Your message is in the fleet chatroom; the other bots will see it. Get on with your work.",
            )
        folder = m.folder_for(to)
        if not folder:
            return ExecResult(False, f"no colleague named {to}", False)
        msg_file = send_message(folder, self.cfg.agent.name, action.text)
        text = action.text.strip()
        if self.requests is not None:
            try:
                answered = self.requests.answer(to, self.cfg.agent.name, text)  # a reply closes their oldest open ask
                self.requests.record(msg_file.name, self.cfg.agent.name, to, text)
                if answered is not None:  # a reply is on record but is not a new ask: it closes at once (no open tail)
                    self.requests.resolve(msg_file.name, f"a reply to {to}'s ask {answered.id[:40]}")
                    event(self.logger, "request_answered", id=answered.id, requester=to)
            except OSError as exc:
                event(self.logger, "requests_log_error", error=str(exc)[:200])
        self._owner_ask_passed_on(to, text)
        self._third_party_ask_done(to, text)
        self.memory.write_journal(f"Messaged {to}: {text[:200]}", heading="Message")
        event(self.logger, "message", to=to, chars=len(text), file=str(msg_file))
        return ExecResult(
            True, f"sent a message to {to}: {text[:80]}", True,
            feedback=f"{to} will see your message on their next step. Get on with your own research; "
            "they may reply in your inbox later.",
        )

    def _seed_seen_links_from_own_files(self) -> None:
        """Web addresses in the files routed to this bot (botBox/routed/<slug>/, routed/everyone/: the Validator's upkeep
        list, the owner's lead lists) count as seen, so `open` on one is not refused as a typed guess. Re-scanned only
        when a file there changes."""
        try:
            routed = self.cfg.root.parent / "common-data" / "botBox" / "routed"
            folders = [routed / self.cfg.root.name, routed / "everyone"]
            files = sorted(p for f in folders if f.is_dir() for p in f.iterdir() if p.is_file() and p.suffix.lower() in (".md", ".txt", ".csv", ".json"))
            signature = tuple((str(p), p.stat().st_mtime_ns) for p in files)
        except OSError:
            return
        if signature == getattr(self, "_own_files_signature", None):
            return
        self._own_files_signature = signature
        found = 0
        for p in files[:50]:
            try:
                text = p.read_text(encoding="utf-8", errors="replace")[:400_000]
            except OSError:
                continue
            for m in re.finditer(r"https?://[^\s<>()\[\]\"'|]+", text):
                url = m.group(0).rstrip(".,;:")
                if url not in self.seen_links:
                    self.seen_links.add(url)
                    found += 1
        if found:
            event(self.logger, "seen_links_from_own_files", files=len(files), urls=found)

    def _third_party_ask_done(self, to: str, text: str) -> None:
        """An ask that told this bot to answer a colleague ("Answer The CEO with a `message` now") is done once that
        message is sent: close it on the asker's side."""
        if self.requests is None:
            return
        try:
            me, named = self.cfg.agent.name, to.strip().lower()
            for r in self.requests.open_for(me):
                if r.sender.strip().lower() in (named, "owner"):
                    continue
                if re.search(rf"\banswer\s+{re.escape(named)}\b", r.text.lower()):
                    self.requests.answer(r.sender, me, f"done: answered {to}: {text[:200]}")
                    event(self.logger, "request_answered", id=r.id, requester=r.sender, via=to)
        except OSError:
            pass

    def _archive_plan(self) -> None:
        """Append the ended plan to workspace/plan-history.jsonl: estimate against actual working minutes, per job and
        per step, for the owner's own judgement (2026-09-30: "est time - actual time = useful data for me"). Nothing is
        enforced from it. Append-only; a fresh-start wipe leaves this file alone."""
        plan = self.plan
        if plan is None or plan.active:
            return
        try:
            open_since = self._plan_since()
            steps = []
            for st in plan.steps:
                actual = st.get("actual_min")
                if actual is None and not st.get("done"):
                    actual = round(self.memory.working_minutes_since(open_since), 1)  # the step it ended on
                    open_since = now_iso()
                steps.append({"text": st.get("text", ""), "done": bool(st.get("done")), "done_at": st.get("done_at"),
                              "estimate_min": st.get("estimate_min"), "actual_min": actual})
            line = {"task": plan.task, "source": plan.source, "status": plan.status, "started": plan.started, "ended": now_iso(),
                    "estimate_min": plan.estimate_min, "actual_min": round(self.memory.working_minutes_since(plan.started), 1),
                    "steps": steps, "note": plan.note}
            path = self.cfg.workspace / "plan-history.jsonl"
            with path.open("a", encoding="utf-8") as fh:
                fh.write(json.dumps(line, ensure_ascii=False) + "\n")
            event(self.logger, "plan_archived", status=plan.status, estimate_min=plan.estimate_min, actual_min=line["actual_min"])
        except Exception as exc:  # noqa: BLE001 - history never breaks the loop
            event(self.logger, "plan_archive_failed", error=str(exc)[:200])

    def _release_stuck_priority_ask(self) -> None:
        """No ask holds a bot forever: after messaging.priority_request_give_up actions with no answer, the engine tells
        the asker "could not" on the bot's behalf and closes the ask."""
        limit = int(getattr(self.cfg.messaging, "priority_request_give_up", 0) or 0)
        if limit <= 0 or self.requests is None:
            return
        try:
            pr = self._priority_request_state()
            if not pr or str(pr.get("sender", "")).lower() == "owner" or int(pr.get("actions_since_read") or 0) < limit:
                return
            sender, me = str(pr["sender"]), self.cfg.agent.name
            note = (f"could not: {me} made no headway on this after {pr['actions_since_read']} actions, so the engine released it. "
                    f"The ask was: {str(pr.get('text', ''))[:200]}")
            folder = self.cfg.messaging.folder_for(sender)
            if folder:
                send_message(folder, me, note)
            # Close the ask itself: answer() refuses a reply that carries a "?", and the quoted ask usually does, so the
            # same ask was released again every cycle (335 "could not" messages for 16 asks, 2026-10-09).
            self.requests.resolve(str(pr.get("id") or ""), f"released by the engine after {pr['actions_since_read']} actions")
            self.memory.write_journal(f"Released a priority ask from {sender} after {pr['actions_since_read']} actions without an answer.", heading="Request")
            event(self.logger, "priority_ask_released", sender=sender, actions=int(pr["actions_since_read"]))
            self.feedback = (f"The ask from {sender} was released after {pr['actions_since_read']} actions without an answer; {sender} has been told "
                             "you could not do it. Go back to your own work.")
        except Exception as exc:  # noqa: BLE001 - never let the release break the loop
            event(self.logger, "priority_ask_release_failed", error=str(exc)[:200])

    def _owner_ask_passed_on(self, to: str, text: str) -> None:
        """An owner steer ("let our family focus on SMB") is carried out by telling the family: an allowed message
        that shares the ask's words closes it, or the banner keeps pushing the bot to repeat the post."""
        if self.requests is None or "?" in text:
            return
        try:
            from .fleet_requests import OWNER, is_promise, passes_on

            if is_promise(text):
                return
            for r in self.requests.open_for(self.cfg.agent.name):
                if r.sender == OWNER and passes_on(r.text, text):
                    self.requests.answer(OWNER, self.cfg.agent.name, f"done: told {to}: {text[:300]}")
                    event(self.logger, "request_answered", id=r.id, requester=OWNER, via=to)
                    break
        except OSError:
            pass

    def _execute_say(self, action: Say) -> ExecResult:
        if action.to == "partner":
            if self.chat_partner is None:
                return ExecResult(False, "there is no AI partner configured", False)
            name = self.cfg.chat_partner.name
            text = action.text.strip()
            self.memory.add_chat("bot", f"[to {name}] {text}", seen=True)
            self.partner_turns.append({"role": "user", "content": text})
            system = self.cfg.chat_partner.system_prompt.replace("{name}", self.cfg.agent.name)
            reply = (self.chat_partner.reply(system, self.partner_turns) or "").strip()
            if not reply:
                self.partner_turns.pop()  # nothing useful came back; do not poison the next turn's context
                return ExecResult(False, f"{name} did not reply (unreachable or empty response)", False)
            self.partner_turns.append({"role": "assistant", "content": reply})
            self.memory.add_chat("partner", f"[{name}] {reply}", seen=True)
            self.partner_turns_since_note += 1
            return ExecResult(
                True, f"{name} replied: {reply[:200]}", True, feedback=f"{name} said: {reply[:600]}"
            )
        self.memory.add_chat("bot", action.text, seen=True)
        if self.requests is not None:  # a report to the owner closes the owner's open ask -- unless it only promises
            try:
                from .fleet_requests import OWNER, is_promise

                if not is_promise(action.text):
                    done = self.requests.answer(OWNER, self.cfg.agent.name, "done: " + action.text.strip())
                    if done is not None:
                        event(self.logger, "request_answered", id=done.id, requester=OWNER)
            except OSError:
                pass
        return ExecResult(True, f"told the owner: {action.text.strip()[:80]}", True)

    def _execute_developer(self, action: Action) -> ExecResult:
        """Developer and upgrade actions. The policy already resolved and contained every path; this
        just does the work. Whatever a file or command produces is shown as feedback, as data."""
        if self.developer is None:
            return ExecResult(False, "developer actions are not enabled", False)
        dev = self.developer
        if isinstance(action, ListFiles):
            path = self.policy.resolve_dev_path(action.path)
            if path is None:
                return ExecResult(False, "path is outside your folder", False)
            listing = dev.list_files(path)
            where = action.path.strip() or "."
            return ExecResult(True, f"listed {where}", True, feedback=f"Files at {where}:\n{listing}")
        if isinstance(action, ReadFile):
            path = self.policy.resolve_dev_path(action.path)
            if path is None:
                return ExecResult(False, "path is outside your folder", False)
            window, more = dev.read_file(path, action.offset)
            nxt = f"\n(more follows; read_file again with offset={action.offset + dev.output_limit})" if more else ""
            return ExecResult(
                True, f"read {action.path} from {action.offset}", True,
                feedback=f"Contents of {action.path} from {action.offset}:\n{window}{nxt}",
            )
        if isinstance(action, WriteFile):
            path = self.policy.resolve_dev_path(action.path)
            if path is None:
                return ExecResult(False, "path is outside your folder", False)
            size = dev.write_file(path, action.content)
            return ExecResult(True, f"wrote {size} bytes to {action.path}", True)
        if isinstance(action, RunCommand):
            cwd = self.policy.resolve_dev_path(action.cwd)
            if cwd is None:
                return ExecResult(False, "cwd is outside your folder", False)
            result = dev.run(action.argv, cwd)
            shown = " ".join(action.argv)[:80]
            return ExecResult(
                result.ok, f"ran {shown}: {result.summary(120)}", True,
                feedback=f"Output of {shown}:\n{result.output.strip() or '(no output)'}",
            )
        if isinstance(action, Upgrade):
            branch = dev.upgrade_start(action.goal)
            self.memory.write_journal(
                f"Started an upgrade on {branch}: {action.goal.strip()[:200]}", heading="Upgrade"
            )
            event(self.logger, "upgrade_start", branch=branch, goal=action.goal.strip()[:200])
            return ExecResult(
                True, f"started upgrade on {branch}", True,
                feedback=(
                    f"A copy of your code is at {CHECKOUT_DIR}/ inside your folder, on branch {branch}. "
                    f"Read it with list_files and read_file, change it with write_file, then upgrade_test. "
                    "Only when the tests pass, upgrade_submit."
                ),
            )
        if isinstance(action, UpgradeTest):
            result = dev.upgrade_test()
            event(self.logger, "upgrade_test", ok=result.ok, detail=result.summary(200))
            tail = result.output.strip()[-2500:]
            return ExecResult(
                result.ok, f"upgrade tests {'passed' if result.ok else 'failed'}: {result.summary(120)}", True,
                feedback=f"Test output ({'passed' if result.ok else 'FAILED'}):\n{tail}",
            )
        if isinstance(action, UpgradeSubmit):
            state = dev.upgrade_state() or {}
            new_head = dev.upgrade_submit()
            self.memory.write_journal(
                f"Merged my change from {state.get('branch', '?')} ({state.get('goal', '')[:120]}) as "
                f"{new_head[:8]}. Restarting on it; the supervisor rolls back if it fails.",
                heading="Upgrade",
            )
            event(self.logger, "upgrade_submit", branch=state.get("branch"), head=new_head)
            self.exit_code = UPGRADE_EXIT_CODE
            return ExecResult(True, f"merged the change as {new_head[:8]}; restarting on it", True)
        return ExecResult(False, f"unknown developer action {action.type}", False)

    def _execute_desktop(self, action: Action) -> ExecResult:
        """Desktop actions. The policy already validated them; here the presence check runs once more,
        right before touching anything, and dry run logs instead of acting."""
        assert self.desktop is not None
        dry = self.cfg.desktop.dry_run
        before = self.desktop_view.signature if self.desktop_view is not None else None
        view_id = self.desktop_view.view_id if self.desktop_view is not None else 0
        status = self.desktop.status()
        if not status.safe:
            self.desktop_blocked_until = time.time() + self.cfg.desktop.idle_minutes * 60
            self.desktop_view = None
            return ExecResult(False, f"stopped touching the Mac: {status.reason}", False)
        if isinstance(action, Look):
            view, label = self.desktop.look(), "looked at the screen"
        elif isinstance(action, App):
            if dry:
                view, label = self.desktop.look(), f"dry run: would bring {action.name} to the front"
            else:
                view, label = self.desktop.activate(action.name), f"brought {action.name} to the front"
        elif isinstance(action, Click):
            el = self.desktop_view.element(action.number) if self.desktop_view is not None else None
            what = f"[{action.number}] {el.role} '{el.title}'" if el is not None else f"[{action.number}]"
            if dry:
                view, label = self.desktop.look(), f"dry run: would click {what}"
            else:
                view, label = self.desktop.click(action.number, view_id), f"clicked {what}"
        elif isinstance(action, TypeText):
            shown = action.text[:40] + ("…" if len(action.text) > 40 else "")
            if dry:
                view, label = self.desktop.look(), f"dry run: would type {shown!r}"
            else:
                view, label = self.desktop.type_text(action.text, view_id), f"typed {shown!r}"
        elif isinstance(action, Hotkey):
            if dry:
                view, label = self.desktop.look(), f"dry run: would press {action.combo}"
            else:
                view, label = self.desktop.hotkey(action.combo, view_id), f"pressed {action.combo}"
        else:
            return ExecResult(False, f"unknown desktop action {action.type}", False)
        if dry:
            event(self.logger, "desktop_dryrun", action=action.type, detail=label)
        if not view.ok:
            if dry:
                # Nothing was done; the screen just could not be read (e.g. no app in front yet).
                return ExecResult(True, f"{label} (screen not readable: {view.error})", False)
            self.desktop_view = self.desktop.current()
            return ExecResult(False, f"{label}: failed, {view.error}", False)
        self.desktop_view = view
        self._desktop_snapshot()
        changed = view.signature != before
        return ExecResult(True, label + ("" if changed else " (nothing on the screen changed)"), changed and not dry)

    def _desktop_snapshot(self) -> None:
        if not self.cfg.dashboard.screenshots or self.desktop is None:
            return
        target = self.cfg.screenshot_dir / "current.png"
        tmp = target.with_name("current.tmp.png")
        try:
            target.parent.mkdir(parents=True, exist_ok=True)
            if self.desktop.screenshot(tmp):
                tmp.replace(target)
        except Exception:  # noqa: BLE001
            self.logger.debug("desktop screenshot failed", exc_info=True)

    def _after_nav(self, page: PageView, label: str) -> ExecResult:
        self.memory.record_visit(page.url, page.title, page.ok, page.error)
        gated = self._site_gate(page) if page.ok else None
        if gated is not None:
            page = gated
        self.page, self.page_offset = page, 0
        if page.ok:
            for link in page.links[:200]:  # what the bot has actually seen, so `open` can be held to it
                if link.url:
                    self.seen_links.add(link.url)
            if len(self.seen_links) > 4000:
                self.seen_links = set(list(self.seen_links)[-2000:])
        if page.ok and page.text:
            self.recent_pages[page.url] = page.text[:40_000]
            self.recent_pages.move_to_end(page.url)
            while len(self.recent_pages) > 40:
                self.recent_pages.popitem(last=False)
        if page.ok and len(page.text) >= 200:
            self.pages_since_note += 1
            self._last_counted_url = page.url
        if not page.ok:
            return ExecResult(False, f"{label}: failed, {page.error}", False)
        if gated is not None:
            return ExecResult(
                True, f"{label}: '{page.title[:60]}' -- not a business's own site, text skipped ({len(page.links)} links kept)", True,
                feedback=f"{page.text} Its links are still numbered: follow one that leads to a business's own site, or go back and "
                "search for another business. Do not read this page.",
            )
        return ExecResult(
            True, f"{label}: '{page.title[:60]}' ({len(page.text)} chars, {len(page.links)} links)", True
        )

    # ---- the site gate (config [site_gate]) --------------------------------------------------------------------
    SITE_GATE_SYSTEM = (
        "You classify web pages for a research assistant. Answer with one JSON object only, no prose: "
        '{"smb_own_site": true or false, "why": "<at most 10 words>"}'
    )

    def _site_gate(self, page: PageView) -> PageView | None:
        """One cheap verdict per domain: is this page on a small business's own site? If not, hand back a copy of the
        page whose text is the skip notice (links kept). None = let the page through (off, exempt, judged fine, or no
        judge answered -- the gate fails open)."""
        sg = self.cfg.site_gate
        if not sg.enabled:
            return None
        from urllib.parse import urlparse

        from .browser import registered_domain
        from .policy import is_search_results_url, url_domain

        try:
            parsed = urlparse(page.url)
        except ValueError:
            return None
        host = parsed.netloc.lower().split("@")[-1].split(":")[0]
        if parsed.scheme not in ("http", "https") or not host or host in {h.lower() for h in sg.exempt_hosts}:
            return None
        if any(host == h.lower() or host.endswith("." + h.lower()) for h in sg.listing_hosts):  # a public listing: evidence, read as is
            return None
        if is_search_results_url(page.url):
            return None
        dom = registered_domain(host)
        if dom in self._site_gate_exempt_domains():
            return None
        verdict = self._site_gate_cached(dom)
        cached = verdict is not None
        if verdict is None:
            verdict = self._site_gate_judge(page, dom)
            if verdict is None:
                event(self.logger, "smb_gate", domain=dom, verdict="open", why="no judge answered", cached=False)
                return None
            self._site_gate_remember(dom, verdict)
        ok, why = bool(verdict.get("smb_own_site")), str(verdict.get("why", ""))[:120]
        event(self.logger, "smb_gate", domain=dom, verdict="own_site" if ok else "skip", why=why, cached=cached, url=page.url[:200])
        if ok:
            return None
        notice = f"[skipped: not a small business's own site: {why or 'directory, list or article'}]"
        return PageView(url=page.url, title=page.title, text=notice, links=page.links, fetched_at=page.fetched_at, ok=True)

    def _site_gate_exempt_domains(self) -> set[str]:
        """Domains already on the Leads board: judged by a human or written as leads, never gated."""
        try:
            return {d for d in self.memory.recent_lead_domains(self.cfg.leads.dedupe_days) if d}
        except Exception:  # noqa: BLE001 - a board read never stops a page
            return set()

    def _site_gate_cache_path(self) -> Path | None:
        p = (self.cfg.site_gate.cache_file or "").strip()
        return Path(p).expanduser() if p else None

    def _site_gate_cached(self, dom: str) -> dict | None:
        path = self._site_gate_cache_path()
        if path is None or not path.is_file():
            return None
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None
        v = data.get(dom) if isinstance(data, dict) else None
        return v if isinstance(v, dict) and "smb_own_site" in v else None

    def _site_gate_remember(self, dom: str, verdict: dict) -> None:
        path = self._site_gate_cache_path()
        if path is None:
            return
        try:
            data = {}
            if path.is_file():
                try:
                    data = json.loads(path.read_text(encoding="utf-8"))
                except ValueError:
                    data = {}
            if not isinstance(data, dict):
                data = {}
            data[dom] = {"smb_own_site": bool(verdict.get("smb_own_site")), "why": str(verdict.get("why", ""))[:120],
                         "at": now_iso(), "by": self.cfg.agent.name}
            path.parent.mkdir(parents=True, exist_ok=True)
            tmp = path.with_name(path.name + f".{os.getpid()}.tmp")
            tmp.write_text(json.dumps(data, indent=1, ensure_ascii=False, sort_keys=True), encoding="utf-8")
            tmp.replace(path)
        except OSError as exc:
            event(self.logger, "smb_gate_cache_error", error=str(exc)[:200])

    def _site_gate_model(self):
        """The site judge: a local Ollama model (judge = "local") or this bot's own chain. Built once."""
        if getattr(self, "_site_judge", None) is None:
            from .judge import build_judge

            sg = self.cfg.site_gate
            self._site_judge = _Completer(build_judge(sg.judge, self.cfg.model, sg.local_model, self.model, self.logger))
        return self._site_judge

    # ---- gate 3: the checker's model-judged questions at write time (policy.write_gate_model) ------------------
    def _write_gate_judge(self):
        if getattr(self, "_write_judge", None) is None:
            from .judge import build_judge

            p = self.cfg.policy
            self._write_judge = build_judge(p.write_gate_model, self.cfg.model, p.write_gate_local_model, self.model, self.logger)
        return self._write_judge

    def _verify_lead_email(self, email: str) -> dict | None:
        """The verification service's verdict for a lead's email, or None when verification is off."""
        key_file = (self.cfg.leads.email_verify_key_file or "").strip()
        if not key_file or not email:
            return None
        if getattr(self, "_email_verifier", None) is None:
            from .email_verify import EmailVerifier

            self._email_verifier = EmailVerifier(key_file, self.cfg.root.parent / "common-data" / "shared-state" / "email-verify.json", self.logger,
                                                 fallback_key_file=self.cfg.leads.email_verify_fallback_key_file,
                                                 third_key_file=self.cfg.leads.email_verify_third_key_file)
        verdict = self._email_verifier.check(email)
        event(self.logger, "email_verify", email=email[:80], result=verdict.get("result"), reason=verdict.get("reason", ""),
              accept_all=verdict.get("accept_all"), cached=bool(verdict.get("cached")), credits=verdict.get("credits", ""))
        return verdict

    def _ground_optional_lead_facts(self, action: Action) -> tuple[Action, str]:
        """Keep a new lead's Location / Company size only when a page the bot opened on the business's own site states
        it (the city's name; the number). Otherwise blank that cell and say so. Deterministic; never refuses."""
        from urllib.parse import urlparse

        from .browser import registered_domain

        if self.cfg.agent.mode == "fake":  # the offline loop has no real pages to check against
            return action, ""
        site = str(getattr(action, "website", "") or "")
        dom = registered_domain(urlparse(site).netloc) if site else ""
        texts = [t.lower() for u, t in self.recent_pages.items() if dom and registered_domain(urlparse(u).netloc) == dom]
        if self.page is not None and self.page.ok and dom and registered_domain(urlparse(self.page.url).netloc) == dom:
            texts.append(self.page.text.lower())
        blob = " ".join(texts)
        update: dict[str, str] = {}
        dropped: list[str] = []
        location = str(getattr(action, "location", "") or "").strip()
        if location:
            city = location.split(",")[0].strip().lower()
            if not blob or not city or city not in blob:
                update["location"] = ""
                dropped.append("Location")
        size = str(getattr(action, "size", "") or "").strip()
        if size:
            nums = re.findall(r"\d[\d,]*", size)
            if not blob or not nums or not all(n in blob or n.replace(",", "") in blob for n in nums):
                update["size"] = ""
                dropped.append("Company size")
        if not update:
            return action, ""
        event(self.logger, "lead_optional_facts_dropped", name=str(getattr(action, "name", ""))[:80], by="engine", cells=dropped)
        return action.model_copy(update=update), (f"{' and '.join(dropped)} left empty: the business's pages you opened do not state "
                                                   f"{'them' if len(dropped) > 1 else 'it'}. That is fine; never guess a cell.")

    def _cited_page_text(self, action: Action) -> str:
        """For a lead / update_lead: the text of the page that states the values being written -- among the cited
        evidence page, the current page and the recently read pages of the same site, the one holding the most of
        them (the location sits on /locations while the evidence URL is the home page: the judge must see the right
        page, or it calls a stated value inferred)."""
        if action.type not in ("lead", "update_lead"):
            return ""
        from .browser import registered_domain
        from urllib.parse import urlparse

        values = [str(v).strip().lower() for k, v in action.model_dump().items()
                  if k in ("location", "size", "founded_by", "industry", "email", "pain_point") and v and str(v).strip()]
        evidence = str(getattr(action, "evidence", "") or "")
        site = str(getattr(action, "website", "") or "") or evidence
        dom = registered_domain(urlparse(site).netloc) if site else ""
        candidates: list[tuple[str, str]] = []
        for candidate in (evidence, evidence.rstrip("/"), evidence.rstrip("/") + "/"):
            if candidate and self.recent_pages.get(candidate):
                candidates.append((candidate, self.recent_pages[candidate]))
        if self.page is not None and self.page.ok and self.page.text:
            candidates.append((self.page.url, self.page.text))
        for url, text in list(self.recent_pages.items())[-20:]:
            if dom and registered_domain(urlparse(url).netloc) == dom:
                candidates.append((url, text))
        if not candidates:
            return ""
        def score(text: str) -> int:
            low = text.lower()
            return sum(1 for v in values if v[:40] in low)
        best = max(candidates, key=lambda c: score(c[1]))
        text = best[1]
        if values and score(text):  # start the excerpt where the first stated value sits, so a 1,200-char trim keeps it
            low = text.lower()
            starts = [low.find(v[:40]) for v in values if v[:40] in low]
            first = max(0, min(starts) - 400)
            return text[first:first + 6000]
        return text[:6000]

    def _open_task_titles_for_gate(self, action: Action) -> list[str] | None:
        if action.type not in ("task", "update_task"):
            return None
        try:
            return sorted(self.memory.recent_task_titles())[:60]
        except Exception:  # noqa: BLE001
            return None

    def _site_gate_judge(self, page: PageView, dom: str) -> dict | None:
        sg = self.cfg.site_gate
        prompt = (
            f"URL: {page.url[:300]}\nTitle: {page.title[:200]}\n\nPage text (start):\n{page.text[: sg.max_chars]}\n\n"
            f"Question: is this page on {self.target.fill(sg.audience)}? A directory, list, ranking, marketplace, aggregator, article, blog, "
            "news site, agency, software product, startup database or job board is NOT such a site. "
            'Answer only {"smb_own_site": true or false, "why": "<at most 10 words>"}.'
        )
        try:
            raw = (self._site_gate_model().complete(self.SITE_GATE_SYSTEM, prompt) or "").strip()
        except Exception as exc:  # noqa: BLE001 - the judge never breaks a page open
            event(self.logger, "smb_gate_error", domain=dom, error=str(exc)[:200])
            return None
        return parse_site_verdict(raw)

    def _close_early(self, ep: sqlite3.Row, why: str) -> None:
        """End an episode the model cannot get out of on its own: summarize it if anything was
        allowed, else abandon it (no model call to summarize nothing). The reasons the model was given
        for each refusal stay in its recent-actions list, so the next episode starts knowing them."""
        allowed = int(
            self.memory.db.scalar(
                "SELECT COUNT(*) FROM actions WHERE episode_id = ? AND verdict = 'allowed'", (ep["id"],), default=0
            )
        )
        self.memory.write_journal(f"Closed episode {ep['id']} early: {why}.", heading="Watchdog")
        event(self.logger, "closed_early", episode=ep["id"], why=why, allowed=allowed)
        if allowed:
            self._consolidate(self.memory.current_episode() or ep)
        else:
            self.memory.end_episode(ep["id"], None, status="abandoned")
            self.noted_urls.clear()
            self.blocked_keys.clear()
            self.pages_since_note = 0
            self.page = None
            self.page_offset = 0
        self.refusal_streak = 0
        self.feedback = (
            f"Episode {ep['id']} was closed because of {why}. This is a new episode: read why those actions "
            "were refused and do something different, or rest."
        )

    def _consolidate(self, ep: sqlite3.Row) -> ExecResult:
        notes = self.memory.notes_for_episode(ep["id"])
        question = self.memory.question(ep["question_id"]) if ep["question_id"] else None
        notes_text = "\n".join(
            f"- {n['title']}: {n['body'][:400]} (source: {n['source_url'] or 'none'})" for n in notes
        ) or "- (no notes this episode)"
        questions_text = "\n".join(f"- #{r['id']} {r['question']}" for r in self.memory.open_questions(8)) or "- (none)"
        question_line = (
            f"Your question for this episode was: {question['question']}"
            if question
            else "You were exploring freely, without a set question."
        )
        prompt = CONSOLIDATION_PROMPT.format(question_line=question_line, notes=notes_text, questions=questions_text)
        text = (self.model.complete(self.journal_system, prompt) or "").strip()
        if not text:
            text = f"(The model produced no summary. {len(notes)} notes were taken this episode.)"
        self.memory.add_summary("episode", ep["id"], text)
        heading = f"Episode {ep['id']}: " + (question["question"] if question else "free exploration")
        self.memory.write_journal(text, heading=heading)
        if self.cfg.agent.journal_daily:
            self._daily_journal_catch_up()
        self.memory.end_episode(ep["id"], text)
        self.memory.write_markdown_mirrors()
        self.noted_urls.clear()
        self.blocked_keys.clear()
        self.pages_since_note = 0
        self.page = None
        self.page_offset = 0
        event(self.logger, "journal", episode=ep["id"], notes=len(notes), chars=len(text))
        summary = f"wrote a journal entry ({len(text)} chars) and closed episode {ep['id']} with {len(notes)} notes"
        typed = self._desktop_journal(heading, text)
        if typed:
            summary += f" and {typed}"
        return ExecResult(True, summary, True)

    def _desktop_journal(self, heading: str, text: str) -> str | None:
        """When the Mac is free, write the journal entry into the first allowed app (TextEdit by default) so
        the owner finds it on the screen. A fixed routine, not a model choice: in dry runs the 7B model never
        picked a desktop action on its own. Returns a short description for the action summary, or None."""
        if self.desktop is None or not self.cfg.desktop.allowed_apps:
            return None
        available, _reason = self._desktop_window()
        if not available:
            return None
        app = self.cfg.desktop.allowed_apps[0]
        entry = f"{heading}\n\n{text}\n\n"
        if self.cfg.desktop.dry_run:
            event(self.logger, "desktop_dryrun", action="journal", detail=f"would type the journal entry into {app}")
            return f"would have typed it into {app} (dry run)"
        try:
            view = self.desktop.activate(app)
            if not view.ok:
                event(self.logger, "desktop_journal_failed", reason=view.error)
                return None
            focused = view.element(view.focused) if view.focused else None
            if focused is None or not focused.editable or focused.secure:
                target = next((e for e in view.elements if e.editable and not e.secure and e.role == "text area"), None)
                target = target or next((e for e in view.elements if e.editable and not e.secure), None)
                if target is None and "cmd+n" in {h.lower() for h in self.cfg.desktop.allowed_hotkeys}:
                    view = self.desktop.hotkey("cmd+n", view.view_id)  # a fresh document
                    target = next((e for e in view.elements if e.editable and not e.secure), None) if view.ok else None
                if target is None:
                    event(self.logger, "desktop_journal_failed", reason=f"{app} shows nothing to type into")
                    return None
                view = self.desktop.click(target.number, view.view_id)
                if not view.ok:
                    event(self.logger, "desktop_journal_failed", reason=view.error)
                    return None
            limit = max(50, self.cfg.desktop.max_type_chars)
            for start in range(0, len(entry), limit):
                view = self.desktop.type_text(entry[start : start + limit], view.view_id)
                if not view.ok:  # the owner came back, or the screen changed under us: stop at once
                    event(self.logger, "desktop_journal_failed", reason=view.error, typed=start)
                    self.desktop_view = None
                    return f"started typing it into {app} but stopped ({view.error})"
            self.desktop_view = view
            self._desktop_snapshot()
            event(self.logger, "desktop_journal", app=app, chars=len(entry))
            return f"typed it into {app}"
        except Exception:  # noqa: BLE001 - the journal is already saved; the Mac copy is a bonus
            self.logger.exception("desktop journal failed")
            return None

    # ---- watchdog ----------------------------------------------------------

    def _watchdog(self) -> None:
        problems = self.heartbeat.check()
        if "stalled" in problems and self._idle_for_chat():
            problems = [p for p in problems if p != "stalled"]  # waiting for a task in the chat is the design, not a stall
        if "stalled" in problems:
            # A slow bot is not a stalled bot: the Scout acts every ten minutes, so one failed search and a rest already
            # passed the 15-minute mark and the watchdog closed its episode five times in an evening (2026-10-02). A stall
            # is at least three of the bot's own cycles without progress.
            grace_minutes = 3 * float(self.cfg.agent.cycle_delay_seconds) / 60.0
            if self.heartbeat.minutes_since_progress() < grace_minutes:
                problems = [p for p in problems if p != "stalled"]
        if not problems:
            return
        event(self.logger, "watchdog", problems=problems)
        if "model_failures" in problems:
            if self.heartbeat.model_failures >= 2 * self.cfg.watchdog.max_model_failures:
                event(self.logger, "giving_up", failures=self.heartbeat.model_failures)
                self.memory.write_journal(
                    "The model kept failing. Exiting so the supervisor can restart me.", heading="Watchdog"
                )
                raise SystemExit(1)
            self._sleep(self.cfg.watchdog.model_failure_backoff_seconds * 10)
        if "repeated_action" in problems:
            key = self.heartbeat.repeated_key()
            if key:
                self.blocked_keys.add(key)
                self.feedback = (
                    f"You repeated the same action ({key}) {self.cfg.watchdog.repeat_threshold} times. "
                    "It is blocked for this episode. Do something different."
                )
            self.heartbeat.clear_recent()
        if "stalled" in problems:
            ep = self.memory.current_episode()
            self.memory.write_journal(
                f"No progress for {self.cfg.watchdog.stall_minutes:.0f} minutes. Closing the episode and resetting the browser.",
                heading="Watchdog",
            )
            if ep is not None and ep["actions"] > 0:
                self._consolidate(ep)
            elif ep is not None:
                self.memory.end_episode(ep["id"], None, status="abandoned")
            self.browser.reset()
            self.page = None
            self.page_offset = 0
            if self.desktop is not None:
                try:
                    self.desktop.cancel_modal()
                    self.desktop.reset()
                except Exception:  # noqa: BLE001
                    self.logger.debug("desktop reset failed", exc_info=True)
                self.desktop_view = None
            self.heartbeat.mark_progress()
