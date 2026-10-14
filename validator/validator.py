#!/usr/bin/env python3
"""The Validator bot: checks the other bots' outputs against the owner's format instructions and asks
the responsible bot to fix what is wrong.

    ~/Projects/bot/.venv/bin/python ~/bots/validator/validator.py [--full] [--dry-run] [--no-notify] [--json]

Each run: re-read instructions/<bot>.md (a change triggers a full sweep of all past data), read what
changed on the Notion task board since the last run plus the whole packages page, the package files in
the-ceo/raw/packages/ and the Scout's providers-found.md, run the checks in checks.py, reconcile with the
flags already raised (workspace/flags.json), write a report (workspace/reports/, latest-report.md), send
each responsible bot one inbox message with its new defects, and post a one-line summary to the fleet
chatroom. A full sweep of every task row also happens every `full_sweep_every_hours`.

Read-only on Notion. Writes only to its own workspace, the bots' inboxes and the chatroom.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json

import httpx
import logging
import os
import re
import sys
import tomllib
from collections import Counter, defaultdict
from dataclasses import asdict
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from checks import Checker, Flag, Instructions, _collect, check_lead, check_lead_email_published, check_package_file, check_package_toggle, check_provider, check_task, duplicate_index, lead_key, lead_site_key, load_instructions, site_duplicate_index  # noqa: E402
import checks  # noqa: E402
from judge import Judge, Provider, judge_prompt, parse_verdicts  # noqa: E402
from email_check import stale, verify_many  # noqa: E402
from leads_upkeep import ASSIGN_HOURS, Deletion, deletion_report, examine, provider_message, work_message, write_board_file  # noqa: E402
import claims  # noqa: E402
import family  # noqa: E402
from blockers import Blocker, parse_blocker, parse_resolved, reply_text, unanswered_owner_messages, verify  # noqa: E402
from sources import BOTS, NotionReader, bot_task_page_ids, norm_title, package_files, providers, team_members, utc_now  # noqa: E402

WS = HERE / "workspace"
STATE = WS / "state.json"
FLAGS = WS / "flags.json"
LOG = WS / "logs" / "validator.log"
SENDER = "Validator"
FULL_KINDS = {"package", "package_file", "provider", "request", "agent", "plan"}   # scanned completely on every run

DEFAULTS: dict[str, Any] = {
    "task_data_source_id": "",
    "package_page_id": "",
    "notion_api_version": "2025-09-03",
    "task_owner_bot": "the-ceo",
    "leads_data_source_id": "",
    "lead_owner_bot": "lead-gen",
    "full_sweep_every_hours": 24,
    "notify": True,
    "max_messages_per_bot_per_day": 3,
    "max_flags_per_message": 3,
    "own_domains": [],
    "package_signoff": [],            # e.g. ["Regards,", "-- Your Company"]; empty = PK05 is not checked
    "package_allowed_figures": [],    # figures every pitch may carry although no record has them
    "draft_proof_figures": [],        # dollar figures a draft may carry that are not prices (a portfolio line), e.g. ["750000"]
    "whatsapp_signoff": "",           # the last line of a first WhatsApp message, e.g. "Alex, Acme LLC"; "" = OW11 not checked
    "own_product_words": [],          # your own company/product/package names (regex): never the gap in a Pain point
    "pain_integrated_tools": [],      # tools your offer integrates (regex): calling one a problem is a fit, not a gap
    "model": {"enabled": False, "daily_token_budget": 40000, "max_items_per_run": 8, "max_output_tokens": 400, "chain": [],
              "rejudge_every_days": 7},
    "message_only_since": "",
    "legacy_kinds": ["package_file", "provider"],
    # LD09 reads the businesses' own sites to see whether a claimed email is really published there. Network
    # work, so it is rate-limited per sweep and a verdict is cached until it goes stale.
    "email_checks_per_run": 12,
    "email_recheck_days": 30,
    "blocker_bot": "",
    "blocker_escalate_hours": 2,
    "owner_reply_within_minutes": 60,
}

log = logging.getLogger("validator")


# ---- files --------------------------------------------------------------------------------

PROVIDER_KEYS = {"name", "base_url", "model", "key_file"}


def load_settings() -> dict[str, Any]:
    data = tomllib.loads((HERE / "config.toml").read_text(encoding="utf-8"))
    v = data.get("validator") or {}
    # A key written below a [[validator.model.chain]] entry belongs to that provider in TOML, silently: the cutoff and
    # family settings sat there unseen from 2026-09-22 to 09-28. Refuse to run on such a file rather than ignore them.
    for entry in (v.get("model") or {}).get("chain") or []:
        stray = sorted(set(entry) - PROVIDER_KEYS)
        if stray:
            raise SystemExit(f"config.toml: {stray} sit under the model provider '{entry.get('name')}' -- move them above [validator.model]")
    return {**DEFAULTS, **v}


def load_json(path: Path, default: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default


def save_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    os.replace(tmp, path)


def min_details_for(bot: str) -> int:
    """The bot's own [notion] min_details_chars, so the Validator holds it to the bar its policy sets."""
    try:
        data = tomllib.loads((BOTS / bot / "config.toml").read_text(encoding="utf-8"))
        return int((data.get("notion") or {}).get("min_details_chars", 300))
    except (OSError, ValueError, TypeError):
        return 300


# ---- the run ---------------------------------------------------------------------------------

# Which column each per-column rule is about, so a cell the team deleted stops being asked for.
_COLUMN_RULES = {"LD11": "Contact person", "LD07": "Location", "LD08": "Company size", "LD10": "Evidence", "LD06": "Found by", "LD12": "Source pages",
                 "LD03": "How can I help"}   # the owner emptied the whole column 2026-09-25 22:29: a verdict, not 28 defects


class _Verdict:
    """A cached LD09 verdict, shaped like email_check.EmailVerdict for the check function."""

    def __init__(self, rec: dict[str, Any]):
        self.status = str(rec.get("status", ""))
        self.where = str(rec.get("where", ""))
        self.others = tuple(rec.get("others") or ())


class Run:
    def __init__(self, args: argparse.Namespace):
        self.args = args
        self.s = load_settings()
        self.now = dt.datetime.now()
        self.now_utc = utc_now()
        self.stamp = self.now.isoformat(timespec="seconds")
        self.ins: Instructions = load_instructions(HERE / "instructions")
        self.ck = Checker(self.ins)
        self.state: dict[str, Any] = load_json(STATE, {})
        self.flags: dict[str, dict[str, Any]] = load_json(FLAGS, {})
        self.current: list[Flag] = []
        self.checked: set[tuple[str, str]] = set()
        self.counts: Counter = Counter()
        self.errors: list[str] = []
        self.notes: list[str] = []
        self.judged_now: set[tuple[str, str]] = set()
        self.pending_cells: dict[str, Any] = {}
        # keys "<page id>|<rule>"; Notion ids come with or without dashes, so both are normalised to no dashes
        self.exceptions: dict[str, Any] = {k.replace("-", ""): v for k, v in
                                           load_json(BOTS / "common-data" / "shared-state" / "validator-exceptions.json", {}).items()}          # "<page id>|<column>" the team emptied, waiting for The CEO's assignee
        self.pending_messages: dict[str, list[str]] = {}  # bot -> work messages (not defects) to send this run
        self.posts: list[str] = []                        # chatroom lines for the owner
        self.full, self.why_full = self._sweep_mode()

    def _sweep_mode(self) -> tuple[bool, str]:
        if getattr(self.args, "inbox", False):
            return False, "inbox"
        if self.args.full:
            return True, "--full"
        if self.state.get("instructions_digest") != self.ins.digest:
            return True, "instructions changed" if self.state.get("instructions_digest") else "first run"
        last = self.state.get("last_full_sweep")
        if not last:
            return True, "no full sweep yet"
        try:
            age = self.now - dt.datetime.fromisoformat(last)
        except ValueError:
            return True, "unreadable last sweep time"
        if age >= dt.timedelta(hours=float(self.s["full_sweep_every_hours"])):
            return True, f"last full sweep {age.total_seconds() / 3600:.0f}h ago"
        return False, "incremental"

    # ---- gathering -------------------------------------------------------------------

    def gather(self) -> None:
        own = list(self.s["own_domains"])
        checks.SIGNOFF = [str(x) for x in self.s.get("package_signoff") or []]
        checks.DRAFT_SIGNOFF = [str(x) for x in self.s.get("draft_signoff") or []]
        checks.OUR_WHATSAPP = str(self.s.get("draft_whatsapp") or "").strip().rstrip("/")
        checks.DRAFT_SPINE = [str(x) for x in self.s.get("draft_spine_phrases") or []]
        checks.PROOF_FIGURES = {str(x) for x in self.s.get("package_allowed_figures") or []}
        checks.DRAFT_PROOF_FIGURES = {str(x).replace(",", "").lstrip("$") for x in self.s.get("draft_proof_figures") or []}
        checks.WA_MSG_SIGNOFF = str(self.s.get("whatsapp_signoff") or "").strip()
        checks.OWN_PRODUCT_WORDS = [str(x) for x in self.s.get("own_product_words") or []]
        checks.INTEGRATED_TOOLS = [str(x) for x in self.s.get("pain_integrated_tools") or []]
        self._process_inbox()
        self._family_check()
        if self.args.inbox:
            self._leads_quick_look()
            self._clear_false_whatsapp()
            return
        self._gather_notion(own)
        folder = BOTS / self.s["task_owner_bot"] / "raw" / "packages"
        files = package_files(folder)
        self.counts["package files"] = len(files)
        for pf in files:
            self.checked.add(("package_file", pf.key))
            self.current += check_package_file(self.ck, pf, own_domains=own)
        recs = providers(BOTS / "common-data" / "providers-found.md")
        self.counts["provider records"] = len(recs)
        for r in recs:
            self.checked.add(("provider", r.key))
            self.current += check_provider(self.ck, r)
        self._onion_notes()
        self._analyst_notes()
        import plans
        n_plans = 0
        for plan_file in sorted(BOTS.glob("*/workspace/plan.json")):
            slug = plan_file.parent.parent.name
            plan = plans.load(plan_file)
            if not plan:
                continue
            n_plans += 1
            for fnd in plans.check(slug, plan, plan_file.parent / "explorer.sqlite3"):
                self.checked.add(("plan", fnd.key))
                flag = self.ck.flag(fnd.rule, "plan", fnd.key, fnd.label, "", fnd.detail, bot=slug, name=str(plan.get("task") or ""))
                if flag:
                    self.current.append(flag)
        self.counts["bot plans checked"] = n_plans
        from sources import agent_entries
        from checks import check_agent_entry
        agents = agent_entries(BOTS / "common-data" / "ai-agents-found.md")
        self.counts["AI-agent entries"] = len(agents)
        for a in agents:
            self.checked.add(("agent", a.key))
            self.current += [x for x in check_agent_entry(self.ck, a) if x]

    def _family_check(self) -> None:
        """The key check: the requests record against the family rules (family.py). Every run, both loops."""
        asks = family.fold(now=self.now)
        self.counts["family asks"] = sum(1 for a in asks if family.is_family(a.sender))
        for f in family.check(asks, self.now, answer_within_hours=float(self.s.get("family_answer_hours", 6)),
                              ceo_within_hours=float(self.s.get("family_ceo_hours", 2)),
                              grace_actions=int(self.s.get("family_grace_actions", 4))):
            self.checked.add(("request", f.ask.id))
            flag = self.ck.flag(f.rule, "request", f.ask.id, f"{f.ask.sender} → {f.ask.to} ({f.ask.at[:16]})", "",
                                f.detail, bot=f.bot, when=f.ask.at[:10],
                                name=f.ask.to if f.rule in ("FM03", "FM05", "FM06", "FM07") else f.ask.sender)
            if flag:
                self.current.append(flag)
        self.notes.append(family.summary(asks, self.now))

    def _clear_false_whatsapp(self) -> None:
        """Rows the team marked "False Whatsapp Number": rule the number out, clear the cell and the Status, and ask
        Lead Gen once for another number (owner, 2026-10-07). The Validator's one write to the Leads board."""
        ds = self.s.get("leads_data_source_id")
        if not ds:
            return
        from whatsapp_false import ask_text, clear_false
        try:
            cleared = clear_false(ds, now=self.now, api_version=self.s["notion_api_version"], dry_run=self.args.dry_run)
        except (OSError, httpx.HTTPError, KeyError, ValueError) as exc:
            self.errors.append(f"false-WhatsApp clean-up failed: {exc}")
            return
        if not cleared:
            return
        self.counts["false whatsapp cleared"] = len(cleared)
        # the Lead Enricher fills empty cells, Whatsapp included (2026-10-10); a fleet without one asks Lead Gen
        slug = "lead-enricher" if (BOTS / "lead-enricher").is_dir() else str(self.s.get("lead_owner_bot", "lead-gen"))
        self.posts.append(f"Cleared {len(cleared)} Whatsapp numbers the team marked False; {slug} asked to look for others")
        if self.args.dry_run or (BOTS / slug / "workspace" / "STOP").exists():
            return
        try:
            from explorer.handoff import send_message
            send_message(BOTS / slug, SENDER, ask_text(cleared), now=self.now)
        except OSError as exc:
            self.errors.append(f"message to {slug} failed: {exc}")

    def _leads_quick_look(self) -> None:
        """On the 10-minute loop: only rows edited since the last look, for the deleted-cell verdicts and the
        blank-cell work list. Cheap (one query, no page bodies) and it is what makes the team's deletions land
        with Lead Gen in minutes rather than at the next six-hourly sweep."""
        ds = self.s.get("leads_data_source_id")
        if not ds:
            return
        try:
            reader = NotionReader(self.s["notion_api_version"])
            since = self.state.get("last_leads_look_utc") or self.state.get("last_run_utc")
            edited_after = None
            if since:
                edited_after = (dt.datetime.fromisoformat(since) - dt.timedelta(minutes=10)).isoformat(timespec="seconds").replace("+00:00", "Z")
            leads = reader.leads(ds, edited_after)
            # the gate's accepted package names, fresh every 10 minutes: an option added to the board ("New Product",
            # 2026-09-30) must not be refused until the next 6-hour sweep
            self.state["lead_package_names"] = sorted(reader.select_options(ds, "How can I help"))
        except Exception as exc:  # noqa: BLE001
            self.errors.append(f"leads quick look: {exc}")
            return
        self.state["last_leads_look_utc"] = self.now_utc.isoformat(timespec="seconds")
        if leads:
            self.counts["lead rows (quick look)"] = len(leads)
            self._lead_upkeep(leads)

    def _gather_notion(self, own: list[str]) -> None:
        try:
            reader = NotionReader(self.s["notion_api_version"])
        except Exception as exc:  # noqa: BLE001 - reported, the file checks still run
            self.errors.append(f"Notion unavailable: {exc}")
            return
        owner_bot = self.s["task_owner_bot"]
        edited_after = None
        if not self.full and self.state.get("last_run_utc"):
            try:
                since = dt.datetime.fromisoformat(self.state["last_run_utc"]) - dt.timedelta(minutes=10)
                edited_after = since.isoformat(timespec="seconds").replace("+00:00", "Z")
            except ValueError:
                edited_after = None
        try:
            tasks = reader.tasks(self.s["task_data_source_id"], edited_after) if self.s["task_data_source_id"] else []
        except Exception as exc:  # noqa: BLE001
            self.errors.append(f"task board: {exc}")
            tasks = []
        self.counts["Notion tasks"] = len(tasks)
        created_by_bot = bot_task_page_ids(BOTS / owner_bot / "workspace" / "explorer.sqlite3")
        team = team_members(BOTS / "common-data" / "team.json")
        index: dict[str, dict[str, str]] = {} if self.full else dict(self.state.get("tasks_index") or {})
        for t in tasks:
            index[t.page_id] = {"title": t.title, "url": t.url, "uid": t.uid}
        dups = duplicate_index(index)
        min_details = min_details_for(owner_bot)
        for t in tasks:
            self.checked.add(("task", t.page_id))
            others = [index[p].get("uid") or p[:8] for p in dups.get(norm_title(t.title), []) if p != t.page_id]
            bot = owner_bot if t.page_id in created_by_bot else "owner"
            self.current += check_task(self.ck, t, team=team, min_details=min_details, duplicate_of=others, bot=bot)
            if (t.status or "").lower() not in ("done", "archived", "cancelled", "dublicate", "not fisible"):
                self.state.setdefault("_open_titles_run", []).append(t.title)
        self.state["tasks_index"] = index
        toggles = []
        if self.s["package_page_id"]:
            try:
                toggles = reader.package_toggles(self.s["package_page_id"])
            except Exception as exc:  # noqa: BLE001
                self.errors.append(f"packages page: {exc}")
                toggles = []
            self.counts["package toggles"] = len(toggles)
            for p in toggles:
                self.checked.add(("package", p.block_id))
                self.current += check_package_toggle(self.ck, p, own_domains=own)
        if self.s.get("leads_data_source_id"):
            self._gather_leads(reader, edited_after, [p.title.split(" — ", 1)[0].strip() for p in toggles])
        if "_open_titles_run" in self.state:
            self.state["open_task_titles"] = self.state.pop("_open_titles_run")[:60]
        self.notes.append(f"Notion requests: {reader.requests}")
        if (self.s.get("model") or {}).get("enabled"):
            if self.args.dry_run:
                self.notes.append("judgment pass skipped (dry run spends no tokens)")
            else:
                self._model_pass(tasks, toggles)

    def _gather_leads(self, reader: NotionReader, edited_after: str | None, package_names: list[str]) -> None:
        ds = self.s["leads_data_source_id"]
        try:
            leads = reader.leads(ds, edited_after)
            # The board's own dropdown is the authority for a package name; the packages page titles are marketing
            # headlines the CEO rewrites ("Fast-track Your MVP in 6 Weeks"), so they are only an extra
            # allowance for a package published but not yet in the dropdown. Taking them first flagged every row
            # on the board as a wrong package name (2026-09-24).
            allowed = sorted({*reader.select_options(ds, "How can I help"), *package_names})
            # the write gate accepts only the board's own options: any other value makes Notion add a new option
            self.state["lead_package_names"] = sorted(reader.select_options(ds, "How can I help"))
        except Exception as exc:  # noqa: BLE001
            self.errors.append(f"leads board: {exc}")
            return
        self.counts["lead rows"] = len(leads)
        if self.full and edited_after is None and not self.args.dry_run:
            import signals          # Tools on site / Site health / Lead score (owner, 2026-10-14)
            try:
                from checks import draft_issues as _di, pain_point_issue as _pi, pain_point_parts as _pp
                res = signals.run(leads, self.state, api_key=self._notion_key(), data_source=ds,
                                  api_version=self.s["notion_api_version"], now=self.now,
                                  draft_ok=lambda ld: bool(ld.draft_email.strip()) and not ld.draft_email.lower().startswith("skip:")
                                  and not _di(ld.draft_email, founded_by=ld.founded_by, website=ld.website, whatsapp=ld.whatsapp, status=ld.status),
                                  pain_ok=lambda ld: bool(_pp(ld.pain_point)) and not _pi(ld.pain_point))
                self.notes.append(f"lead signals: {res['read']} sites read, {res['written']} rows written")
            except (OSError, httpx.HTTPError) as exc:
                self.errors.append(f"lead signals: {exc}")
            import okr_progress     # progress under The CEO's weekly key results
            try:
                self.notes.append("OKR: " + okr_progress.run(leads, self.now))
            except OSError as exc:
                self.errors.append(f"okr progress: {exc}")
            import refusal_report   # the family's refusal scoreboard and the team's sends, once a day (2026-10-14)
            if refusal_report.due(self.state, self.now):
                try:
                    self.notes.append(f"refusal report: {refusal_report.write(self.state, self.now, leads)}")
                except OSError as exc:
                    self.errors.append(f"refusal report: {exc}")
            import enricher_list    # the Lead Enricher's daily work list (owner, 2026-10-10)
            if enricher_list.due(self.state, self.now):
                try:
                    self.notes.append(f"Lead Enricher list: {enricher_list.write(leads, self.state, self.now)} rows")
                except OSError as exc:
                    self.errors.append(f"enricher list: {exc}")
            import results_digest   # The CEO's weekly steering input (owner, 2026-10-10)
            if results_digest.due(self.state, self.now):
                try:
                    self.notes.append(f"results digest written: {results_digest.write(leads, self.state, self.now)}")
                except OSError as exc:
                    self.errors.append(f"results digest: {exc}")
        index: dict[str, dict[str, str]] = {} if self.full else dict(self.state.get("leads_index") or {})
        for ld in leads:
            index[ld.page_id] = {"business": ld.business, "website": ld.website, "url": ld.url,
                                 "city": ld.location.split(",")[0].strip()}
        dups = site_duplicate_index(index)
        for ld in leads:
            self.checked.add(("lead", ld.page_id))
            others = [index[p].get("business") or p[:8] for p in dups.get(lead_key({"website": ld.website, "business": ld.business, "city": ld.location.split(",")[0]}), []) if p != ld.page_id]
            flags = check_lead(self.ck, ld, allowed_packages=allowed, duplicate_of=others)
            # a cell the team just deleted is The CEO's to assign, not a defect to message Lead Gen about
            # owner, 2026-09-29: an EMPTY cell on a row made before the fresh start is not a defect (wrong values still are)
            old_row = (ld.created or "")[:10] < str(self.s.get("lead_message_only_since") or "")
            flags = [f for f in flags if not (old_row and (f.detail.startswith("no ") or " is empty" in f.detail))]
            # the owner's per-row decisions (common-data/shared-state/validator-exceptions.json, "<page id>|<rule>")
            flags = [f for f in flags if f"{ld.page_id.replace('-', '')}|{f.rule}" not in self.exceptions]
            self.current += [f for f in flags if f.rule not in _COLUMN_RULES
                             or f"{ld.page_id}|{_COLUMN_RULES[f.rule]}" not in self.pending_cells]
        self.state["leads_index"] = index
        self._lead_upkeep(leads)
        self._verify_lead_emails(leads)
        self._verify_lead_whatsapp(leads)
        self._fact_check_enricher(leads)

    def _lead_upkeep(self, leads: list) -> None:
        """Blanks are work for Lead Gen; a cell the team emptied means the value was wrong, so The CEO is told and
        assigns who finds the right one (owner, 2026-09-25 evening). Deleted cells wait ASSIGN_HOURS before they
        rejoin Lead Gen's own list. The empty-cell counts go to The CEO too, once in a blue moon."""
        deleted: dict[str, Any] = self.state.setdefault("deleted_cells", {})
        legacy = self.state.pop("useless_cells", None)            # the old rule's memory: same cells, new meaning
        if legacy:
            for k, v in legacy.items():
                deleted.setdefault(k, {**v, "reported": False})
        self.state.pop("unwanted_columns", None)
        now_utc = self.now
        def age_ok(v: dict) -> bool:
            try:
                return (now_utc - dt.datetime.fromisoformat(v["at"])).total_seconds() < ASSIGN_HOURS * 3600
            except (KeyError, ValueError):
                return False
        self.pending_cells = {k: v for k, v in deleted.items() if age_ok(v)}
        self.state["lead_names"] = sorted({ld.business.strip() for ld in leads if ld.business.strip()})
        if self.full:                                   # only a full fetch is the whole board
            self.counts["board rows listed for Lead Gen"] = write_board_file(leads)
        previous = self.state.get("lead_cells") or {}
        up = examine(leads, previous, self.pending_cells)
        if self.args.inbox or not self.args.full:
            self.state["lead_cells"] = {**previous, **up.snapshot}
        else:
            self.state["lead_cells"] = {**previous, **up.snapshot}
        # A script that clears cells it wrote itself records them here; that is not the team's verdict (2026-09-26:
        # a withdrawn fill tool's 12 cleared cells were reported to The CEO as team deletions).
        try:
            script_clears = json.loads((BOTS / "common-data" / "shared-state" / "leads-script-clears.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            script_clears = {}
        up.deletions = [d for d in up.deletions if d.key not in script_clears]
        for d in up.deletions:
            deleted[d.key] = {"business": d.business, "column": d.column, "was": d.was[:200], "at": self.stamp, "reported": False}
            self.pending_cells[d.key] = deleted[d.key]
        # owner, 2026-10-10 (a cell the team deleted goes to the Validator): the Validator hands a deleted cell to the Lead
        # Enricher's list with its old value ruled out; only a deleted package ("How can I help") is still The CEO's call
        import enricher_list
        for k, v in deleted.items():
            if not v.get("reported") and v.get("column", k.split("|")[-1]) in enricher_list.FILLS:
                v["reported"] = True
                v["to_enricher"] = True
        unreported = [Deletion(k.split("|")[0], v.get("business", "?"), v.get("column", k.split("|")[-1]), v.get("was", ""))
                      for k, v in deleted.items() if not v.get("reported")]
        if unreported:
            from collections import Counter
            per = Counter(d.column for d in unreported)
            clears = sorted(c for c, n in per.items() if n >= 3)
            names = ", ".join(sorted({f"{d.business}/{d.column}" for d in unreported})[:4])
            self.notes.append(f"the team deleted {len(unreported)} package cell(s): {names} — reported to The CEO to decide")
            self.counts["cells deleted by the team"] += len(unreported)
            if self.s.get("provider_bot"):
                self.pending_messages.setdefault(self.s["provider_bot"], []).append(deletion_report(unreported, clears, paused=(BOTS / self.s["lead_owner_bot"] / "workspace" / "STOP").exists()))
                for v in deleted.values():
                    v["reported"] = True
            self.posts.append(f"The team deleted {len(unreported)} Leads-board cell(s) ({names}): the values were wrong; The CEO assigns who finds the right ones")
        # a row Lead Gen keeps failing on rests for a week instead of reopening every episode
        benched: dict[str, Any] = self.state.setdefault("upkeep_benched", {})
        for name, n in claims.stuck_businesses(self.s["lead_owner_bot"], (self.now - dt.timedelta(hours=48)).isoformat(timespec="seconds")).items():
            benched.setdefault(name, {"at": self.stamp, "refusals": n})
        week_ago = (self.now - dt.timedelta(days=7)).isoformat(timespec="seconds")
        for name in [n for n, v in benched.items() if v.get("at", "") < week_ago]:
            benched.pop(name)
        if benched:
            up.work = [w for w in up.work if w[0] not in benched]
            self.notes.append("leads upkeep: resting after repeated refusals: " + ", ".join(sorted(benched)[:5]))
        to_lead_bot = bool(self.s.get("upkeep_to_lead_bot", True))
        if up.work and not to_lead_bot:
            # owner, 2026-09-28 ("go" on bot-creator's review): Lead Gen hunts new leads; empty cells are reported, not asked
            from collections import Counter
            cols = Counter(c for _, _, missing in up.work for c in missing)
            self.notes.append(f"leads board: {len(up.work)} row(s) have empty cells ("
                              + ", ".join(f"{c} {n}" for c, n in cols.most_common()) + ") -- for a person or the owner's file; Lead Gen is on new leads")
        if up.work and to_lead_bot:
            self.notes.append(f"leads upkeep: {len(up.work)} row(s) have cells Lead Gen can fill")
            self.pending_messages.setdefault(self.s["lead_owner_bot"], []).append(work_message(up.work, len(leads)))
            every = float(self.s.get("provider_gaps_every_days", 3))
            last = self.state.get("provider_gaps_sent_at", "")
            try:
                due = not last or (now_utc - dt.datetime.fromisoformat(last)).total_seconds() >= every * 86400
            except ValueError:
                due = True
            if self.s.get("provider_bot") and due:
                self.pending_messages.setdefault(self.s["provider_bot"], []).append(provider_message(up.work, len(leads), paused=(BOTS / self.s["lead_owner_bot"] / "workspace" / "STOP").exists() or not to_lead_bot))
                self.state["provider_gaps_sent_at"] = self.stamp

    def _onion_notes(self) -> None:
        """O05/O06: the Onion Reader's notes carry their source page, and a headline claim a second proof page. Read-only
        from its own sqlite; only notes made since the last full sweep (a first run looks back two days)."""
        import sqlite3
        db = BOTS / "onion-reader" / "workspace" / "explorer.sqlite3"
        if not db.exists() or not any(r.startswith("O0") for r in self.ins.rules):
            return
        since = str(self.state.get("onion_notes_since") or (self.now - dt.timedelta(days=2)).isoformat(timespec="seconds"))
        try:
            con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
            try:
                rows = con.execute("SELECT id, created_at, title, body, source_url FROM notes WHERE created_at > ? ORDER BY id", (since,)).fetchall()
            finally:
                con.close()
        except sqlite3.Error as exc:
            self.errors.append(f"onion-reader notes unreadable: {exc}")
            return
        claim = re.compile(r"\b(claim|verdict|proofs?|confirmed|reported|according to)\b", re.I)
        url = re.compile(r"https?://\S+")
        for nid, created, title, body, src in rows:
            art, label = f"onion-note-{nid}", f'note #{nid} "{(title or "")[:60]}"'
            self.checked.add(("note", art))
            f = lambda rid, detail: self.ck.flag(rid, "note", art, label, "", detail, when=str(created)[:10], name=title or "")  # noqa: E731
            flags = []
            if not (src or "").startswith(("http://", "https://")):
                flags.append(f("O05", "the note records no source page"))
            text = f"{title}\n{body}"
            if claim.search(text) and not [u for u in url.findall(body or "") if u.rstrip(".,)") != (src or "").rstrip("/")]:
                flags.append(f("O06", "states a headline claim with no proof page besides its own source"))
            self.current += [x for x in flags if x]
        self.counts["onion notes checked"] = len(rows)
        if rows:
            self.state["onion_notes_since"] = str(rows[-1][1])

    def _analyst_notes(self) -> None:
        """RA01/RA03/RA04: the Research Analyst's notes (its findings posts) cite their page, carry no personal data and
        repeat no page's instruction. Read-only from its own sqlite; notes since the last sweep (first run: two days)."""
        import sqlite3
        from checks import injection
        from sources import is_search_results_url
        db = BOTS / "research-analyst" / "workspace" / "explorer.sqlite3"
        if not db.exists() or "RA01" not in self.ins.rules:
            return
        since = str(self.state.get("analyst_notes_since") or (self.now - dt.timedelta(days=2)).isoformat(timespec="seconds"))
        try:
            con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
            try:
                rows = con.execute("SELECT id, created_at, title, body, source_url FROM notes WHERE created_at > ? ORDER BY id", (since,)).fetchall()
            finally:
                con.close()
        except sqlite3.Error as exc:
            self.errors.append(f"research-analyst notes unreadable: {exc}")
            return
        phone = re.compile(r"(?<!\d)(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}(?!\d)")
        email = re.compile(r"\b([\w.+-]+)@[\w-]+\.[\w.]+")
        role = re.compile(r"^(info|hello|contact|sales|support|office|team|admin|enquiries|inquiries|help|bookings?|orders?|press|media)$", re.I)
        for nid, created, title, body, src in rows:
            art, label = f"analyst-note-{nid}", f'note #{nid} "{(title or "")[:60]}"'
            self.checked.add(("note", art))
            f = lambda rid, detail: self.ck.flag(rid, "note", art, label, src or "", detail, bot="research-analyst",  # noqa: E731
                                                 when=str(created)[:10], name=title or "")
            flags = []
            if not (src or "").startswith(("http://", "https://")):
                flags.append(f("RA01", "the note records no source page"))
            elif is_search_results_url(src):
                flags.append(f("RA01", f"the source is a search results page: {src[:70]}"))
            text = f"{title}\n{body}"
            personal = [m.group(0) for m in email.finditer(text) if not role.match(m.group(1))] + phone.findall(text)
            if personal:
                flags.append(f("RA03", "personal contact details in the note: " + ", ".join(personal[:2])))
            hit = injection(text)
            if hit:
                flags.append(f("RA04", f"repeats a page's instruction: '{hit[:60]}'"))
            self.current += [x for x in flags if x]
        self.counts["analyst notes checked"] = len(rows)
        if rows:
            self.state["analyst_notes_since"] = str(rows[-1][1])


    def _lead_bot_name(self) -> str:
        from family import FAMILY
        slug = self.s["lead_owner_bot"]
        return next((n for n, (_, sl) in FAMILY.items() if sl == slug), "Lead Gen")

    def _verify_claim(self, m) -> None:
        """LD16: a 'done' from Lead Gen is held to its own record -- accepted lead / update_lead writes since the work
        list went out (or the last 24 h). A business it names without a write is an invented output; it is told at
        once, and the chatroom hears the truth, not the claim."""
        slug = self.s["lead_owner_bot"]
        sent = (self.state.get("upkeep_sent") or {})
        since = max([v.get("at", "") for k, v in sent.items() if k.startswith(slug)] or [""]) \
            or (self.now - dt.timedelta(hours=24)).isoformat(timespec="seconds")
        writes = claims.lead_writes(slug, since)
        claimed, unverified = claims.check_claim(m.text, self.state.get("lead_names") or [], writes)
        when = str(getattr(m, "sent_at", "") or self.stamp)[:16]
        if not unverified:
            self.posts.append(f"Lead Gen on the Leads board (verified against its record): {m.text[:300]}")
            return
        detail = (f"reported at {when}: '{m.text[:120]}' -- the record shows "
                  + (f"no accepted update_lead for {', '.join(unverified)}" if claimed else "no accepted lead or update_lead at all")
                  + f" since {since[:16]} ({len(writes)} write(s) on record: {', '.join(sorted(set(writes))[:4]) or 'none'})")
        flag = self.ck.flag("LD16", "request", f"claim|{when}", f"Lead Gen's report {when}", "", detail, bot=slug, when=when[:10],
                            name=", ".join(unverified) if claimed else "the work list")
        if flag:
            self.current.append(flag)
            self.checked.add(("request", f"claim|{when}"))
        self.counts["false done reports"] += 1
        self.posts.append(f"Lead Gen reported Leads-board rows filled ({', '.join(claimed) if claimed else 'unnamed'}) that its own record does not show; asked to write first, then report")
        if not self.args.dry_run and self.s["notify"] and not self.args.no_notify:
            try:
                from explorer.handoff import send_message
                send_message(BOTS / slug, SENDER,
                             f"Your report '{m.text[:80]}' names work the record does not show: no accepted update_lead for "
                             f"{', '.join(unverified) if claimed else 'any business'} since {since[11:16]}. A report without a write is a "
                             "false report. Open the business's site, write the cell with update_lead (watch its verdict), and only "
                             "then reply 'done: <business>: <cells>'.", now=self.now)
            except OSError as exc:
                self.errors.append(f"reply to {slug} failed: {exc}")

    def _verify_lead_emails(self, leads: list) -> None:
        """LD09: is the claimed address really on the business's own site? A few rows per sweep, cached by
        address so a row is fetched once; a verdict goes stale after `email_recheck_days`."""
        if "LD09" not in self.ins.rules or self.args.dry_run:
            cached_only = self.state.get("email_verdicts") or {}
            for ld in leads:            # a dry run reports what is already known, and fetches nothing
                rec = cached_only.get(f"{ld.email.lower()}|{lead_site_key(ld.website)}")
                if rec:
                    self.current += check_lead_email_published(self.ck, ld, _Verdict(rec))
            return
        cache: dict[str, Any] = self.state.setdefault("email_verdicts", {})
        recheck = float(self.s.get("email_recheck_days", 30))
        todo, known = [], []
        own = str(self.s.get("lead_owner_bot", "lead-gen"))
        for ld in leads:
            if ld.found_by.strip().lower() in ("lead gen", "lead-gen", own):
                continue      # its policy already saw the address on a rendered page of the site before it could list it
            key = f"{ld.email.lower()}|{lead_site_key(ld.website)}"
            rec = cache.get(key)
            if rec and not stale(str(rec.get("at", "")), recheck, self.now):
                known.append((ld, _Verdict(rec)))
            elif ld.email.strip() and (ld.website.strip() or ld.evidence.strip() or ld.source_pages.strip()):
                todo.append((ld, key))
        budget = int(self.s.get("email_checks_per_run", 12))
        fetched = verify_many([(k, ld.email, ld.website, tuple(u for u in (ld.evidence, *ld.source_pages.split()) if u))
                               for ld, k in todo[:budget]]) if todo[:budget] else {}
        for ld, key in todo[:budget]:
            v = fetched.get(key)
            if v is None:
                continue
            cache[key] = {"status": v.status, "where": v.where, "others": list(v.others), "at": self.stamp}
            known.append((ld, v))
        for ld, v in known:
            self.current += check_lead_email_published(self.ck, ld, v)
        if todo:
            self.notes.append(f"email checks: {len(fetched)} site(s) read this run, {max(0, len(todo) - len(fetched))} waiting, {len(cache)} cached")

    def _notion_key(self) -> str:
        return (BOTS / "common-data" / "keys" / "notion.key").read_text(encoding="utf-8").strip()

    def _fact_check_enricher(self, leads: list) -> None:
        """EN05: the Lead Enricher's founder, city and size are printed on a page it cites or on the business's site
        (owner, 2026-10-10: "I expect high accuracy and fact check from it")."""
        if "EN05" not in self.ins.rules or self.args.dry_run:
            return
        import enricher_check
        sites = {enricher_check._norm(ld.business): ld.website for ld in leads}
        by_name = {enricher_check._norm(ld.business): ld for ld in leads}
        for m in enricher_check.run(self.state, sites, budget=int(self.s.get("email_checks_per_run", 12))):
            ld = by_name.get(enricher_check._norm(m["name"]))
            col = {"founded_by": "Contact person", "location": "Location", "size": "Company size", "founder_linkedin": "Founder LinkedIn"}[m["field"]]
            self.current += _collect(self.ck.flag("EN05", "lead", ld.page_id if ld else m["name"], f'lead "{m["name"]}"',
                                                        ld.url if ld else "", f"{col}: {m['why']}", bot="lead-enricher",
                                                        when=m["ts"][:10], name=m["name"]))

    def _verify_lead_whatsapp(self, leads: list) -> None:
        """LD20: is the row's wa.me number really linked on the business's own site? Every row with a Whatsapp, Lead
        Gen's included (the column is new, 2026-10-07); cached by number and site, re-read after `email_recheck_days`."""
        from email_check import verify_whatsapp
        from checks import check_lead_whatsapp_published
        # a row the team marked "WhatsApp Verified" was confirmed by a person in WhatsApp Web: no page proof needed
        rows = [ld for ld in leads if ld.whatsapp.strip() and (ld.website.strip() or ld.evidence.strip() or ld.source_pages.strip()) and ld.status.strip().lower() not in ("whatsapp verified", "false whatsapp number")]
        if not rows or "LD20" not in self.ins.rules:
            return
        cache: dict[str, Any] = self.state.setdefault("whatsapp_verdicts", {})
        recheck = float(self.s.get("email_recheck_days", 30))
        budget = int(self.s.get("email_checks_per_run", 12))
        for ld in rows:
            key = f"{ld.whatsapp.strip()}|{lead_site_key(ld.website)}"
            rec = cache.get(key)
            if not rec or stale(str(rec.get("at", "")), recheck, self.now):
                if self.args.dry_run or budget <= 0:
                    continue
                budget -= 1
                v = verify_whatsapp(ld.whatsapp, ld.website, tuple(u for u in (ld.evidence, *ld.source_pages.split()) if u))
                rec = cache[key] = {"status": v.status, "where": v.where, "others": list(v.others), "at": self.stamp}
            self.current += check_lead_whatsapp_published(self.ck, ld, _Verdict(rec))

    # ---- Desk Agent blockers and questions (the inbox) -------------------------------

    def _process_inbox(self) -> None:
        """Read this bot's inbox: a "blocker:" line from the Desk Agent is verified against facts on this Mac and
        answered in its inbox; open blockers are re-checked every run and the Desk Agent told when the cause is
        cleared; one still open after `blocker_escalate_hours` is a DA01 flag for the owner. An owner chat message
        the Desk Agent left unanswered for `owner_reply_within_minutes` is a DA02 defect."""
        try:
            from explorer.handoff import Inbox, send_message
        except ImportError as exc:
            self.errors.append(f"inbox unavailable: {exc}")
            return
        bot = str(self.s.get("blocker_bot") or "")
        folder = BOTS / (bot or "_no-blocker-bot")  # no such folder: nothing to verify, the rest of the inbox is still read
        blockers: dict[str, dict[str, Any]] = self.state.setdefault("blockers", {})
        posts: list[str] = []
        inbox = Inbox(WS)
        msgs = inbox.unread(limit=20)
        for m in msgs:
            resolved_reasons = parse_resolved(m.text)
            if resolved_reasons:
                cleared = 0
                for rec in blockers.values():
                    if rec.get("status") == "open" and any(rec["reason"].lower()[:80] == r or rec["reason"].lower().startswith(r) for r in resolved_reasons):
                        rec["status"], rec["cleared_at"], rec["verdict"] = "cleared", self.stamp, "resolved by the Desk Agent"
                        cleared += 1
                posts.append(f"Desk Agent unblocked ({cleared} blocker(s) cleared): a GUI step was allowed again")
                self.counts["blockers cleared"] += cleared
                continue
            b = parse_blocker(m.text)
            if b is None:
                if claims.is_claim(m.text) and m.sender == self._lead_bot_name():   # Lead Gen reporting a finished work list
                    self.counts["upkeep replies"] += 1
                    self._verify_claim(m)
                self.notes.append(f"inbox from {m.sender}: {m.text[:120]}")
                self.state.setdefault("inbox_log", []).append({"at": self.stamp, "from": m.sender, "text": m.text[:400]})
                self.state["inbox_log"] = self.state["inbox_log"][-50:]
                continue
            rec = blockers.get(b.key) or {"reason": b.reason, "task": b.task, "fix": b.fix, "sender": m.sender,
                                          "first_seen": self.stamp, "status": "open", "reports": 0}
            rec["reports"] = int(rec.get("reports", 0)) + 1
            rec["last_seen"] = self.stamp
            v = verify(b)
            rec.update(verdict=v.status, detail=v.detail, fix_verified=v.fix, last_verified=self.stamp)
            if v.status == "cleared":
                rec["status"], rec["cleared_at"] = "cleared", self.stamp
            blockers[b.key] = rec
            if not self.args.dry_run:
                try:
                    send_message(folder, SENDER, reply_text(b, v), now=self.now)
                    rec["replied_at"] = self.stamp
                except OSError as exc:
                    self.errors.append(f"reply to {bot} failed: {exc}")
            posts.append(f"Desk Agent blocked on '{b.task[:60] or b.reason[:60]}': {v.status} — {v.detail[:140]}. Fix: {v.fix[:120]}")
            self.counts["blockers reported"] += 1
        if not self.args.dry_run:
            inbox.mark_seen(msgs)
            self._close_on_record(inbox)
        # Re-check what is still open; tell the Desk Agent the moment a cause clears; escalate the old ones.
        escalate_after = float(self.s.get("blocker_escalate_hours", 2)) * 3600
        for key, rec in blockers.items():
            if rec.get("status") != "open":
                continue
            b = Blocker(rec["reason"], rec.get("task", ""), rec.get("fix", ""))
            if rec.get("last_verified") != self.stamp:
                v = verify(b)
                rec.update(verdict=v.status, detail=v.detail, fix_verified=v.fix, last_verified=self.stamp)
                if v.status == "cleared":
                    rec["status"], rec["cleared_at"] = "cleared", self.stamp
                    if not self.args.dry_run:
                        try:
                            send_message(folder, SENDER, reply_text(b, v), now=self.now)
                        except OSError as exc:
                            self.errors.append(f"reply to {bot} failed: {exc}")
                    posts.append(f"Desk Agent unblocked: '{b.task[:60] or b.reason[:60]}' — {v.detail[:140]}")
                    continue
            try:
                age = (self.now - dt.datetime.fromisoformat(rec["first_seen"])).total_seconds()
            except (KeyError, ValueError):
                age = 0
            self.checked.add(("blocker", key))
            if age >= escalate_after:
                flag = self.ck.flag("DA01", "blocker", key, f"Desk Agent blocker \"{b.reason[:60]}\"", "", 
                                    f"open for {age / 3600:.1f} h: {rec.get('detail', '')[:160]}; fix: {rec.get('fix_verified') or b.fix}",
                                    bot="owner", when=rec["first_seen"][:10], name=b.task[:80])
                if flag:
                    self.current.append(flag)
                    if not rec.get("escalated_at"):
                        rec["escalated_at"] = self.stamp
                        posts.append(f"OWNER: Desk Agent has been blocked {age / 3600:.0f} h on '{b.task[:60] or b.reason[:60]}': {rec.get('detail', '')[:120]}. Fix: {rec.get('fix_verified') or b.fix}")
        # Owner messages the Desk Agent never answered.
        for msg in unanswered_owner_messages(folder / "workspace" / "explorer.sqlite3", within_minutes=int(self.s.get("owner_reply_within_minutes", 60)), now=self.now):
            art = f"chat:{msg['id']}"
            self.checked.add(("chat", art))
            flag = self.ck.flag("DA02", "chat", art, f"owner message \"{msg['text'][:60]}\"", "",
                                f"no reply for {msg['age_minutes']} min", bot=bot, when=str(msg["ts"])[:10], name=msg["text"][:80])
            if flag:
                self.current.append(flag)
        open_now = sum(1 for r in blockers.values() if r.get("status") == "open")
        if open_now or msgs:
            self.notes.append(f"blockers: {open_now} open, {len(msgs)} inbox message(s) read")
        if posts and not self.args.dry_run and self.s["notify"] and not self.args.no_notify:
            try:
                from explorer.chatroom import Chatroom
                room = Chatroom(BOTS / "common-data" / "chatroom.jsonl")
                for text in posts[:3]:
                    room.post(SENDER, text[:600], now=self.now)
            except (ImportError, OSError) as exc:
                self.errors.append(f"chatroom post failed: {exc}")

    # ---- optional model pass -------------------------------------------------------------

    def _close_on_record(self, inbox: Any) -> None:
        """Close the asks the inbox has taken, on the fleet's requests record (common-data/shared-state/requests.jsonl).
        The Validator answers only blocker lines, and it answers those in the Desk Agent's inbox; without this every
        message to it (Lead Gen's upkeep replies, say) stayed "unread" and open on the Requests page until it
        expired (owner, 2026-09-25). Anything addressed to the Validator that is no longer waiting in its inbox has
        been taken, so it is read and resolved here, including asks taken before this rule existed."""
        try:
            from explorer.fleet_requests import RequestLog
        except ImportError as exc:
            self.errors.append(f"requests record unavailable: {exc}")
            return
        log = RequestLog(BOTS / "common-data" / "shared-state" / "requests.jsonl")
        waiting = {m.path.name for m in inbox.unread(limit=1000)}
        try:
            taken = [r for r in log.open_for(SENDER) if r.id not in waiting]
            for r in taken:
                if not r.read_at:
                    log.mark_read([r.id])
                note = ("blocker checked; the answer went to the Desk Agent's inbox" if parse_blocker(r.text)
                        else "taken by the Validator; it answers only blocker lines, so there is no reply to wait for")
                log.resolve(r.id, note)
        except OSError as exc:
            self.errors.append(f"requests record: {exc}")
            return
        if taken:
            self.counts["requests closed"] += len(taken)

    def _model_pass(self, tasks: list, toggles: list) -> None:
        """The judgment pass: the strongest free model answers the instructions' plain-English questions for
        items that passed the exact checks and are new or changed since last judged. A "no" is a warning."""
        ms = self.s["model"]
        chain = [Provider(str(p["name"]), str(p["base_url"]), str(p["model"]), str(p["key_file"])) for p in ms.get("chain") or []]
        if not chain:
            self.errors.append("judgment pass: no [[validator.model.chain]] providers configured")
            return
        budget = int(ms.get("daily_token_budget", 40000))
        usage = self.state.setdefault("model_usage", {})
        if usage.get("date") != self.now.strftime("%Y-%m-%d"):
            usage.clear()
            usage.update(date=self.now.strftime("%Y-%m-%d"), tokens=0, calls=0)
        if usage.get("tokens", 0) >= budget:
            self.notes.append(f"judgment pass skipped: today's {budget} token budget is used")
            return
        try:
            from explorer.common.fallback import CallLedger
            ledger = CallLedger()
        except Exception:  # noqa: BLE001
            ledger = None
        judge = Judge(chain, max_output_tokens=int(ms.get("max_output_tokens", 400)), ledger=ledger)
        system = (HERE / "persona.md").read_text(encoding="utf-8")
        failed = {(f.kind, f.artifact) for f in self.current if f.severity == "error"}
        judged: dict[str, Any] = self.state.setdefault("judged", {})
        rejudge_days = float(ms.get("rejudge_every_days", 7))
        q_digest = hashlib.sha1(json.dumps(self.ins.questions, sort_keys=True).encode()).hexdigest()[:8]
        for key, rec in list(judged.items()):          # records from before re-judging existed: judged at the last run
            if isinstance(rec, str):
                judged[key] = {"version": rec, "at": self.state.get("last_run") or self.stamp, "questions": q_digest}

        def due(key: str, version: str) -> tuple[int, str]:
            """(priority, since): 0 = never judged or changed, 1 = questions changed, 2 = judged too long ago, 9 = fresh."""
            rec = judged.get(key)
            if isinstance(rec, str):                       # older state format: version only
                rec = {"version": rec, "at": "", "questions": ""}
            if not rec or rec.get("version") != version:
                return 0, ""
            if rec.get("questions") != q_digest:
                return 1, rec.get("at", "")
            try:
                age = (self.now - dt.datetime.fromisoformat(rec.get("at") or "1970-01-01")).days
            except ValueError:
                age = 10**6
            return (2, rec.get("at", "")) if rejudge_days > 0 and age >= rejudge_days else (9, rec.get("at", ""))

        owner_bot = self.s["task_owner_bot"]
        candidates: list[tuple[str, str, str, str, str, dict[str, str], str, str]] = []  # kind, artifact, version, bot, label, fields, url, name
        closed = {"done", "archived", "cancelled", "dublicate", "not fisible"}
        for t in [t for t in tasks if (t.status or "").lower() not in closed]:   # a closed task needs no review
            fields = {"Title": t.title, "Assignee": ", ".join(t.assignee_names), "Dead Line": t.due or "", "Priority": t.priority, "Brief": t.body}
            candidates.append(("task", t.page_id, t.edited or t.created, owner_bot, t.label, fields, t.url, t.title))
        for p in toggles:
            version = hashlib.sha1(f"{p.title}|{p.email}|{p.conclusion}|{p.sources}".encode()).hexdigest()[:12]
            fields = {"Title": p.title, "Email pitch": p.email, "Conclusion": p.conclusion, "Sources": "; ".join(p.sources),
                      "Company facts": "; ".join(f"{k}: {v}" for k, v in p.company.items()), **p.extra}
            candidates.append(("package", p.block_id, version, "package-designer", p.label, fields, p.page_url, p.title))
        done = 0
        stale = 0
        ranked = sorted(((due(f"{k}:{a}", ver), (k, a, ver, b, lab, f, u, n)) for k, a, ver, b, lab, f, u, n in candidates), key=lambda x: x[0])
        for (prio, _since), (kind, artifact, version, bot, label, fields, url, name) in ranked:
            if done >= int(ms.get("max_items_per_run", 8)) or usage.get("tokens", 0) >= budget:
                break
            if (kind, artifact) in failed or prio == 9:
                continue
            stale += prio in (1, 2)
            questions = self.ins.questions.get(bot) or []
            if kind == "package":
                questions = (self.ins.questions.get("the-ceo") or [])[:0] + questions   # package questions live in package-designer.md
            if not questions:
                continue
            answer = judge.ask(system, judge_prompt(kind, fields, questions))
            if answer is None:
                self.errors.append("judgment pass: no model in the chain answered; skipped for this run")
                break
            done += 1
            usage["tokens"] = usage.get("tokens", 0) + answer.tokens
            usage["calls"] = usage.get("calls", 0) + 1
            verdicts = parse_verdicts(answer.text)
            if not verdicts:
                self.errors.append(f"judgment pass: unreadable answer from {answer.provider} on {label}")
                continue
            judged[f"{kind}:{artifact}"] = {"version": version, "at": self.stamp, "questions": q_digest}
            self.judged_now.add((kind, artifact))
            for vd in verdicts:
                if vd["answer"].startswith("y") or not 1 <= vd["q"] <= len(questions):
                    continue
                self.current.append(Flag(f"MJ{vd['q']:02d}", bot, kind, artifact, label, url, questions[vd["q"] - 1],
                                         f"{answer.provider} says no: {vd['why']}", "warn", name=name))
        by = ", ".join(f"{n} by {p}" for p, n in judge.used.items())
        self.notes.append(f"judgment pass: {done} item(s) judged ({stale} re-judged older ones), {judge.tokens_used} tokens ({by})" if done
                          else "judgment pass: nothing new or due to judge")

    # ---- reconcile ------------------------------------------------------------------------

    def reconcile(self) -> tuple[list[str], list[str], list[str]]:
        new, reopened, resolved = [], [], []
        seen: set[str] = set()
        for f in self.current:
            fp = f.fingerprint
            seen.add(fp)
            rec = self.flags.get(fp)
            if rec is None:
                self.flags[fp] = {**asdict(f), "first_seen": self.stamp, "last_seen": self.stamp, "status": "open",
                                  "messaged_at": None, "resolved_at": None}
                new.append(fp)
            else:
                rec.update(text=f.text, detail=f.detail, label=f.label, url=f.url, bot=f.bot, severity=f.severity,
                           last_seen=self.stamp)
                if rec.get("status") == "resolved":
                    rec["status"], rec["resolved_at"] = "open", None
                    reopened.append(fp)
        kinds_fully_scanned = set(FULL_KINDS) | ({"task"} if self.full and "Notion tasks" in self.counts else set()) \
            | ({"lead"} if self.full and "lead rows" in self.counts else set())
        kinds_fully_scanned |= {"blocker", "chat"}          # both are re-derived completely on every run
        if self.args.inbox:
            kinds_fully_scanned = {"blocker", "chat", "request"}
        if self.errors and any("Notion" in e or "packages page" in e for e in self.errors):
            kinds_fully_scanned.discard("package")
        if any("task board" in e or "Notion unavailable" in e for e in self.errors):
            kinds_fully_scanned.discard("task")
        for fp, rec in self.flags.items():
            if rec.get("status") != "open" or fp in seen:
                continue
            if rec.get("rule", "").startswith("MJ"):
                if (rec["kind"], rec["artifact"]) in self.judged_now:   # re-judged and the "no" did not recur
                    rec["status"], rec["resolved_at"] = "resolved", self.stamp
                    resolved.append(fp)
                continue
            if (rec["kind"], rec["artifact"]) in self.checked or rec["kind"] in kinds_fully_scanned:
                rec["status"], rec["resolved_at"] = "resolved", self.stamp
                resolved.append(fp)
        return new, reopened, resolved

    # ---- output -------------------------------------------------------------------------------

    def report(self, new: list[str], reopened: list[str], resolved: list[str]) -> str:
        open_flags = [r for r in self.flags.values() if r["status"] == "open"]
        lines = [f"# Validator report — {self.now:%Y-%m-%d %H:%M} ({'full sweep' if self.full else 'incremental'}: {self.why_full})", ""]
        lines.append("Checked: " + ", ".join(f"{v} {k}" for k, v in self.counts.items()) + ".")
        lines.append(f"New flags: {len(new)}. Re-opened: {len(reopened)}. Resolved since last run: {len(resolved)}. "
                     f"Open in total: {len(open_flags)} ({sum(1 for r in open_flags if r['severity'] == 'error')} defects, "
                     f"{sum(1 for r in open_flags if r['severity'] == 'warn')} warnings).")
        if self.errors:
            lines += ["", "**Could not check:** " + "; ".join(self.errors)]
        if self.notes:
            lines += ["", "_" + "; ".join(self.notes) + "_"]
        by_bot: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for r in open_flags:
            by_bot[r["bot"]].append(r)
        for bot in sorted(by_bot, key=lambda b: (b == "owner", b)):
            items = sorted(by_bot[bot], key=lambda r: (r["severity"] != "error", r["kind"], r["label"], r["rule"]))
            who = "Owner-made rows (not sent to a bot)" if bot == "owner" else bot
            lines += ["", f"## {who} — {len(items)} open"]
            by_item: dict[str, list[dict[str, Any]]] = defaultdict(list)
            for r in items:
                by_item[r["label"]].append(r)
            for label, rs in by_item.items():
                url = rs[0].get("url") or ""
                lines.append(f"- **{label}**" + (f" <{url}>" if url else ""))
                for r in rs:
                    tag = "warn" if r["severity"] == "warn" else "defect"
                    fresh = " *(new)*" if r["first_seen"] == self.stamp else ""
                    lines.append(f"  - [{r['rule']}] {tag}: {r['detail']}{fresh}")
        blockers = [r for r in (self.state.get("blockers") or {}).values() if r.get("status") == "open"]
        if blockers:
            lines += ["", f"## Desk Agent blockers — {len(blockers)} open"]
            for r in sorted(blockers, key=lambda r: r.get("first_seen", "")):
                lines.append(f"- since {r.get('first_seen', '?')[:16]}: \"{r.get('reason', '')[:80]}\" for task \"{r.get('task', '')[:60]}\" — "
                             f"{r.get('verdict', '?')}: {r.get('detail', '')[:140]}. Fix: {r.get('fix_verified') or r.get('fix', '')}")
        if resolved:
            lines += ["", f"## Resolved this run — {len(resolved)}"]
            for fp in resolved:
                r = self.flags[fp]
                lines.append(f"- [{r['rule']}] {r['label']}: {r['detail']}")
        return "\n".join(lines) + "\n"

    def notify(self) -> list[str]:
        """One inbox message per bot with its new, not-yet-messaged defects; one chatroom line."""
        sent: list[str] = []
        if not self.s["notify"] or self.args.no_notify or self.args.dry_run:
            return sent
        try:
            from explorer.chatroom import Chatroom
            from explorer.handoff import send_message
        except ImportError as exc:
            self.errors.append(f"cannot message bots: {exc}")
            return sent
        today = self.now.strftime("%Y-%m-%d")
        msgs = self.state.setdefault("messages", {})
        if msgs.get("date") != today:
            msgs.clear()
            msgs["date"] = today
        pending: dict[str, list[dict[str, Any]]] = defaultdict(list)
        since = str(self.s.get("message_only_since") or "")
        legacy_kinds = set(self.s.get("legacy_kinds") or [])
        legacy = 0
        for r in self.flags.values():
            if r["status"] == "open" and r["severity"] == "error" and not r.get("messaged_at") and r["bot"] != "owner":
                if since and r["kind"] in legacy_kinds and (r.get("when") or "0000") < since:   # undated = made before
                    legacy += 1      # made before the rule existed: the owner's to judge, not the bot's defect
                    continue
                lead_since = str(self.s.get("lead_message_only_since") or "")
                if lead_since and r["kind"] == "lead" and (r.get("when") or "") < lead_since:
                    legacy += 1      # an old board row: reported, not an ask (owner, 2026-09-28: Lead Gen is on new leads)
                    continue
                if r["kind"] == "request" and "Leads board upkeep" in (r.get("detail") or ""):
                    legacy += 1      # chasing the retired upkeep asks
                    continue
                pending[r["bot"]].append(r)
        if legacy:
            self.notes.append(f"{legacy} defect(s) on items older than {since} are reported only, not sent to a bot")
        cap = int(self.s["max_messages_per_bot_per_day"])
        per = int(self.s["max_flags_per_message"])
        silent = set(self.s.get("silent_bots") or [])     # bots that never read an inbox (the Desk Agent): report only
        silent.add("validator")                            # its own findings go in its report, never its own inbox
        silent |= {b for b in list(pending) + list(self.pending_messages) if (BOTS / b / "workspace" / "STOP").exists()}
        # FM06 holds the Validator too: while its earlier ask to a bot is still open, it does not send another
        # (it sent Scout the same format check at 21:21, 03:28 and 09:40 on 2026-09-25/26).
        try:
            open_to = {family.slug_of(a.to) for a in family.fold(now=self.now) if a.open and a.sender == SENDER}
        except Exception:  # noqa: BLE001 -- the record is advisory here
            open_to = set()
        for bot, items in pending.items():
            folder = BOTS / bot
            if bot in silent:
                self.notes.append(f"{bot}: {len(items)} defect(s) in the report only (it does not read bot messages)")
                for r in items:
                    r["messaged_at"] = "report-only"
                continue
            if not (folder / "workspace").is_dir():
                self.errors.append(f"no bot folder to message for '{bot}'")
                continue
            if bot in open_to:
                self.notes.append(f"{bot}: {len(items)} defect(s) wait -- my earlier message is still unanswered")
                continue
            if msgs.get(bot, 0) >= cap:
                self.notes.append(f"{bot}: daily message cap reached, {len(items)} defect(s) wait")
                continue
            batch = sorted(items, key=lambda r: (r["first_seen"], r["label"]))[:per]
            text = self._message(bot, batch, len(items))
            try:
                send_message(folder, SENDER, text, now=self.now)
            except OSError as exc:
                self.errors.append(f"message to {bot} failed: {exc}")
                continue
            for r in batch:
                r["messaged_at"] = self.stamp
            msgs[bot] = msgs.get(bot, 0) + 1
            sent.append(f"{bot} ({len(batch)} of {len(items)})")
            log.info("messaged %s: %s", bot, text[:120])
        for bot, texts in self.pending_messages.items():
            folder = BOTS / bot
            if bot in silent:
                self.notes.append(f"{bot}: {len(texts)} upkeep message(s) not sent (paused or does not read bot messages)")
                continue
            if not (folder / "workspace").is_dir():
                self.errors.append(f"no bot folder to message for '{bot}'")
                continue
            # Upkeep is the owner's standing work, not a defect: it is not held behind the defect cap. A deletion
            # notice always goes out (it is the team's verdict, and rare); the work list goes out when it changed
            # or after six quiet hours, so the ten-minute loop does not repeat it every run.
            sent_log = self.state.setdefault("upkeep_sent", {})
            for text in texts[:2]:
                is_work = text.startswith("Leads board")
                digest = hashlib.sha1(text.encode()).hexdigest()[:12]
                if is_work:
                    last = sent_log.get(f"{bot}:{text[:30]}") or {}
                    fresh = last.get("digest") != digest
                    try:
                        quiet = (self.now - dt.datetime.fromisoformat(last.get("at", ""))).total_seconds() >= 6 * 3600
                    except ValueError:
                        quiet = True
                    if not (fresh or quiet):
                        continue
                try:
                    send_message(folder, SENDER, text, now=self.now)
                except OSError as exc:
                    self.errors.append(f"message to {bot} failed: {exc}")
                    continue
                if is_work:
                    sent_log[f"{bot}:{text[:30]}"] = {"digest": digest, "at": self.stamp}
                sent.append(f"{bot} ({'upkeep' if is_work else 'notice'})")
                log.info("messaged %s: %s", bot, text[:120])
        for line in self.posts[:3]:
            try:
                Chatroom(BOTS / "common-data" / "chatroom.jsonl").post(SENDER, line[:600], now=self.now)
            except OSError as exc:
                self.errors.append(f"chatroom post failed: {exc}")
        self._republish_requests()
        new_total = sum(1 for r in self.flags.values() if r["first_seen"] == self.stamp)
        if sent or new_total:
            by_bot = Counter(r["bot"] for r in self.flags.values() if r["first_seen"] == self.stamp)
            summary = (f"Validator sweep ({'full' if self.full else 'incremental'}): "
                       + ", ".join(f"{v} {k}" for k, v in self.counts.items()) + f". {new_total} new flag(s)"
                       + (" (" + ", ".join(f"{b}: {n}" for b, n in by_bot.most_common()) + ")" if by_bot else "")
                       + (". Asked: " + ", ".join(sent) if sent else "") + ". Details are in the owner's Work plan page.")   # bots cannot read validator/ (Lead Gen searched the web for the file, 2026-09-30)
            try:
                Chatroom(BOTS / "common-data" / "chatroom.jsonl").post(SENDER, summary[:600], now=self.now)
            except OSError as exc:
                self.errors.append(f"chatroom post failed: {exc}")
        return sent

    def _republish_requests(self) -> None:
        """A packages-page toggle that fails the CEO's wrapper rules (PK*) is fixed by the CEO republishing it: the
        CEO reads common-data/shared-state/republish-requests.json ([{"name","reason"}]) and matches the PACKAGE NAME
        (its record's key), not the toggle's headline -- until 2026-10-03 the Validator wrote headlines and none of 23
        requests ever matched. Asked once per package and rule set in 7 days: a fix that keeps missing is reported, not
        re-asked every sweep (one toggle was replaced twice in six hours for the same PK01/PK03)."""
        import gate
        path = BOTS / "common-data" / "shared-state" / "republish-requests.json"
        published = gate._published()
        by_block = {str(v.get("block_id", "")).replace("-", ""): str((v.get("package") or {}).get("name") or k)
                    for k, v in published.items()}
        names = {str((v.get("package") or {}).get("name") or k).lower() for k, v in published.items()}
        wanted: dict[str, list[str]] = {}
        for r in self.flags.values():
            if r["status"] == "open" and r["kind"] == "package" and r["rule"].startswith("PK") and r["severity"] == "error" \
                    and r["rule"] != "PK11" and not r.get("republish_asked_at"):   # PK11: the version bump already republishes
                name = by_block.get(str(r.get("artifact", "")).replace("-", ""))
                if name:
                    wanted.setdefault(name, []).append(f"{r['rule']}: {r['detail']}")
        log: dict[str, Any] = self.state.setdefault("republish_log", {})
        week_ago = (self.now - dt.timedelta(days=7)).isoformat(timespec="seconds")
        fresh: dict[str, list[str]] = {}
        for name, reasons in wanted.items():
            rules = sorted({x.split(":")[0] for x in reasons})
            last = log.get(name.lower()) or {}
            if last.get("rules") == rules and last.get("at", "") >= week_ago:
                continue                          # asked for exactly this within the week: report it, don't re-ask
            fresh[name] = reasons
        try:
            current = json.loads(path.read_text(encoding="utf-8")) if path.exists() else []
        except (OSError, ValueError):
            current = []
        if not isinstance(current, list):
            current = []
        # requests for names the CEO has no package for can never be served: drop them
        current = [e for e in current if isinstance(e, dict) and str(e.get("name", "")).lower() in names]
        queued = {str(e.get("name", "")).lower() for e in current}
        for name, reasons in fresh.items():
            if name.lower() not in queued:
                current.append({"name": name, "reason": "Validator: " + "; ".join(reasons)[:400], "requested_at": self.stamp})
            log[name.lower()] = {"rules": sorted({x.split(":")[0] for x in reasons}), "at": self.stamp}
        try:
            save_json(path, current)
        except OSError as exc:
            self.errors.append(f"republish request not written: {exc}")
            return
        for r in self.flags.values():
            if r["status"] == "open" and r["kind"] == "package" and r["rule"].startswith("PK") \
                    and by_block.get(str(r.get("artifact", "")).replace("-", "")) in wanted:
                r["republish_asked_at"] = self.stamp
        if fresh:
            self.notes.append("republish requested for " + ", ".join(sorted(fresh)))

    def _message(self, bot: str, batch: list[dict[str, Any]], total: int) -> str:
        head = (f"Validator format check {self.now:%Y-%m-%d}: {total} of your outputs "
                f"{'is' if total == 1 else 'are'} missing required information or not in the required shape. "
                "Please fix these and keep every new one to the rules; the owner sees the same list. ")
        by_item: dict[str, list[dict[str, Any]]] = {}
        for r in batch:
            by_item.setdefault(r["label"], []).append(r)
        parts = []
        for i, (label, rs) in enumerate(by_item.items(), 1):
            problems = []
            for r in rs:
                rule = self.ins.rules.get(r["rule"])
                want = rule.short if rule else r["text"][:120]
                problems.append(f"{r['detail']} (rule {r['rule']}: {want})")
            parts.append(f"{i}) {label}: " + "; ".join(problems) + "." + self._fix_hint(rs[0]))
        text = head + " ".join(parts)
        if total > len(batch):
            text += f" ({total - len(batch)} more in the Validator's report.)"
        return text[:900]

    @staticmethod
    def _fix_hint(r: dict[str, Any]) -> str:
        """What action fixes it, in the bots' own vocabulary (update_task / a re-sent package)."""
        name = (r.get("name") or "").strip()
        if not name:
            return ""
        if r["kind"] == "task":
            return f' Fix with update_task on "{name}".'
        if r["kind"] == "lead":
            return f' Fix with update_lead on "{name}" (only the fields named here).'
        if r["kind"] == "request" and r["rule"] in ("FM01", "FM02"):
            return f' Answer {name} with a `message` now -- what you did, or why you cannot.'
        if r["kind"] in ("package", "package_file") and r["rule"].startswith(("PS", "PD")):
            return f' Fix by re-sending "{name}" with the agency\'s own pages as sources and its source_company facts; it replaces the toggle.'
        if r["kind"] == "package" and r["rule"].startswith("PK"):
            return f' A republish request for "{name}" is queued for you; republishing the toggle in the standard shape clears this.'
        return ""

    # ---- main --------------------------------------------------------------------------------

    def _sweep_marker(self, status: str, summary: str = "") -> None:
        """workspace/sweep.json: what state_server.py shows the webapp while and after a run."""
        if self.args.dry_run:
            return
        data = load_json(WS / "sweep.json", {})
        if status == "sweeping":
            data = {"status": "sweeping", "started": self.stamp, "mode": "full" if self.full else "incremental", "why": self.why_full}
        else:
            data.update(status="idle", finished=dt.datetime.now().isoformat(timespec="seconds"), summary=summary,
                        checked=dict(self.counts), checked_total=sum(self.counts.values()), errors=list(self.errors))
        save_json(WS / "sweep.json", data)

    def execute(self) -> dict[str, Any]:
        if not self.args.inbox:
            self._sweep_marker("sweeping")
        self.gather()
        new, reopened, resolved = self.reconcile()
        sent = self.notify() if not self.args.dry_run else []
        text = self.report(new, reopened, resolved)
        if self.args.inbox and not self.args.dry_run:
            save_json(FLAGS, self.flags)
            save_json(STATE, self.state)
            return {"mode": "inbox", "why": "inbox", "checked": dict(self.counts), "new": len(new), "reopened": len(reopened),
                    "resolved": len(resolved), "open": sum(1 for r in self.flags.values() if r["status"] == "open"),
                    "messaged": sent, "errors": self.errors, "report": "", "dry_run": False, "notes": self.notes}
        if not self.args.dry_run:
            (WS / "reports").mkdir(parents=True, exist_ok=True)
            (WS / "reports" / f"{self.now:%Y-%m-%d-%H%M%S}.md").write_text(text, encoding="utf-8")
            (WS / "latest-report.md").write_text(text, encoding="utf-8")
            save_json(FLAGS, self.flags)
            self.state.update(
                last_run=self.stamp, last_run_utc=self.now_utc.isoformat(timespec="seconds"),
                instructions_digest=self.ins.digest, instructions_files=self.ins.files,
            )
            if self.full and not any("task board" in e or "Notion unavailable" in e for e in self.errors):
                self.state["last_full_sweep"] = self.stamp
            self.state["runs"] = int(self.state.get("runs", 0)) + 1
            save_json(STATE, self.state)
        open_now = sum(1 for r in self.flags.values() if r["status"] == "open")
        self._sweep_marker("idle", f"{'full' if self.full else 'incremental'} sweep: " + ", ".join(f"{v} {k}" for k, v in self.counts.items())
                           + f"; {len(new)} new, {len(resolved)} resolved, {open_now} open")
        return {
            "mode": "full" if self.full else "incremental", "why": self.why_full, "checked": dict(self.counts),
            "new": len(new), "reopened": len(reopened), "resolved": len(resolved),
            "open": sum(1 for r in self.flags.values() if r["status"] == "open"),
            "messaged": sent, "errors": self.errors, "report": text, "dry_run": bool(self.args.dry_run),
        }


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--full", action="store_true", help="re-check every task row, not only those edited since the last run")
    ap.add_argument("--dry-run", action="store_true", help="print the report; write nothing, message nobody")
    ap.add_argument("--no-notify", action="store_true", help="write the report and state but send no messages")
    ap.add_argument("--json", action="store_true", help="print a JSON summary instead of the report")
    ap.add_argument("--inbox", action="store_true", help="only read the inbox (Desk Agent blockers) and the desk chat; no Notion, no files")
    args = ap.parse_args(argv)
    LOG.parent.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s",
                        handlers=[logging.FileHandler(LOG, encoding="utf-8")])
    logging.getLogger("httpx").setLevel(logging.WARNING)
    log.info("run start: %s", " ".join(sys.argv[1:]))
    result = Run(args).execute()
    log.info("run done: mode=%s new=%s resolved=%s open=%s messaged=%s errors=%s", result["mode"], result["new"],
             result["resolved"], result["open"], result["messaged"], result["errors"])
    if args.json:
        print(json.dumps({k: v for k, v in result.items() if k != "report"}, indent=1))
    else:
        print(result["report"])
        if result["messaged"]:
            print("Messaged:", ", ".join(result["messaged"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
