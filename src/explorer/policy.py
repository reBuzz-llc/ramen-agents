"""The policy layer. Every action passes through here before it is executed.

The prompt asks the model to behave; this module makes sure it does.
"""
from __future__ import annotations

import ipaddress
import re
import logging
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlparse
from urllib.robotparser import RobotFileParser

from .actions import (
    Action,
    App,
    Ask,
    Click,
    Follow,
    Hotkey,
    Interest,
    Lead,
    ListFiles,
    Look,
    Message,
    Note,
    Open,
    Package,
    ProposeTeammate,
    Provider,
    Publish,
    PublishPackage,
    ReadFile,
    Rest,
    ReviseGoal,
    Plan,
    RunCommand,
    Say,
    Search,
    Summarize,
    Task,
    TypeText,
    UpdateLead,
    UpdateTask,
    Upgrade,
    UpgradeSubmit,
    UpgradeTest,
    WriteFile,
)
from .actions import CONSOLIDATION_TYPES, DESKTOP_TYPES, DEVELOPER_TYPES, NAVIGATION_TYPES, UPGRADE_TYPES
from .browser import PageView
from .chatroom import ROOM_RECIPIENT, is_room_recipient
from .config import KNOWN_PROVIDERS, ChatPartnerConfig, DesktopConfig, DeveloperConfig, HandoffConfig, LeadsConfig, MessagingConfig, NotionConfig, PolicyConfig, PublishConfig, ScoutConfig
from .desktop import DesktopView, hotkey_never_allowed, normalize_hotkey
from .memory import question_words, questions_are_similar
from .notion import valid_date, valid_priority
from .team import Member, find_member

# The agent's own tooling, phrased the way the model phrases it. Rate limits, captchas and search
# engines are obstacles the policy and the searcher handle; when the model turns them into
# questions and interests it circles them for days instead of its subject (both live bots had
# "bypassing rate limits" as their top interest on 2026-09-14). Word forms are deliberate: bare
# "brave" or "proxy" would catch real subjects, "brave search" or "bypass" would not.
META_TOPIC_PATTERN = re.compile(
    r"rate[\s-]?limit|ratelimit|captcha|bot[\s-]?check|human[\s-]?check|verify (?:that )?you are|"
    r"search engines?|search results?|brave(?: search|\.com| browser| web)|"
    r"wikipedia (?:search|did not|does not|didn't|doesn't)|\bno results\b|\bbypass|workaround|scrap(?:e|ing)\b|"
    r"user[\s-]?agents?|(?:block(?:ed|ing)?|blocks) (?:me|my|its|the bot|searches)",
    re.IGNORECASE,
)


def is_meta_topic(text: str) -> bool:
    """True when the text is about the agent's tools rather than a subject it could learn about."""
    return bool(META_TOPIC_PATTERN.search(text or ""))


# A self-authored goal may be anything EXCEPT the things the code fence forbids as actions -- naming one
# as a goal only wastes cycles and courts drift, so it is refused with an explanation. Kept narrow (verbs
# of acquisition + the fenced nouns, self-replication, spending) so ordinary research goals pass.
FORBIDDEN_GOAL_PATTERN = re.compile(
    r"(get|obtain|find|grab|harvest|collect|steal|take|acquire)[\w\s]{0,24}"
    r"(api[\s-]?keys?|credential|password|token|someone'?s account|logins?)|"
    r"leaked|stolen|\bclone (yourself|myself|itself)|replicate (yourself|myself|itself)|"
    r"(spend|pay|buy|purchase|subscribe)\b",
    re.IGNORECASE,
)


def forbidden_goal_reason(goal: str) -> bool:
    return bool(FORBIDDEN_GOAL_PATTERN.search(goal or ""))


_VERSION_SUFFIX = re.compile(r"[\s\-:]*\b(?:v|ver|version)\s*\.?\s*\d+\b|\s+\d+$", re.IGNORECASE)


_SEARCH_HOSTS = ("hn.algolia.com", "duckduckgo.com", "www.google.", "google.", "bing.com", "search.brave.com",
                 "searx", "search.marginalia.nu", "yandex.", "startpage.com")


def money_value(amount: str) -> float:
    """'$15,000' -> 15000.0; '$2.5k' -> 2500.0; '$1M' -> 1_000_000.0."""
    a = amount.replace("$", "").replace(",", "").replace(" ", "").rstrip(".").lower()
    mult = 1.0
    if a.endswith("k"):
        mult, a = 1_000.0, a[:-1]
    elif a.endswith("m"):
        mult, a = 1_000_000.0, a[:-1]
    try:
        return float(a) * mult
    except ValueError:
        return 0.0


def url_domain(url: str) -> str:
    """'https://www.Example.com/x?y' -> 'example.com'; '' when it is not a URL."""
    try:
        host = urlparse(url.strip()).netloc.lower().split("@")[-1].split(":")[0]
    except ValueError:
        return ""
    return host[4:] if host.startswith("www.") else host


def is_search_results_url(url: str) -> bool:
    """A search engine's results page (hn.algolia.com/?q=..., .../search?q=...): evidence of looking, not a
    source. A package must cite the pages opened *from* it."""
    try:
        u = urlparse(url.strip())
    except ValueError:
        return False
    host, path, query = u.netloc.lower(), u.path.lower(), u.query.lower()
    if any(host.startswith(h) or h in host for h in _SEARCH_HOSTS):
        return True
    has_q = bool(re.search(r"(^|&)(q|query|search|s)=", query))
    return has_q and (path in ("", "/") or "search" in path)


_FREE_MAIL = ("gmail.", "googlemail.", "yahoo.", "hotmail.", "outlook.", "live.", "msn.", "icloud.", "me.com", "aol.",
              "proton.me", "protonmail.", "gmx.", "mail.com", "yandex.", "zoho.")
_EMAIL = re.compile(r"^[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})$")


def email_domain(email: str) -> str:
    m = _EMAIL.match((email or "").strip())
    return m.group(1).lower().removeprefix("www.") if m else ""


def same_site(domain: str, site: str) -> bool:
    """example.com and mail.example.com count as the same business."""
    return bool(domain and site) and (domain == site or domain.endswith("." + site) or site.endswith("." + domain))


def _search_terms(q: str) -> set[str]:
    """Lower-cased content words with a crude singular form, so 'businesses with outdated websites' and
    'business outdated website' compare equal."""
    out = set()
    for w in re.findall(r"[a-z0-9]+", (q or "").lower()):
        if w in {"a", "an", "the", "in", "of", "for", "with", "and", "or", "to", "on", "at", "by", "near", "is", "are"}:
            continue
        if w.endswith("ies") and len(w) > 4:
            w = w[:-3] + "y"
        elif w.endswith(("ses", "xes", "shes", "ches")) and len(w) > 4:
            w = w[:-2]
        elif w.endswith("s") and not w.endswith("ss") and len(w) > 3:
            w = w[:-1]
        out.add(w)
    return out


def searches_are_twins(a: str, b: str, overlap: float = 0.75) -> bool:
    """The same search in other words: `overlap` of the shorter query's content words shared (plurals and order
    ignored). 0.75 by default; a bot whose recipe changes one word at a time (Lead Gen: the trade or the area) sets
    policy.repeat_search_overlap higher, so "salon Northside contact email" after "restaurant Northside contact email"
    is a new search (49 such refusals, 2026-09-29)."""
    wa, wb = _search_terms(a), _search_terms(b)
    if not wa or not wb:
        return False
    return len(wa & wb) / min(len(wa), len(wb)) >= overlap


def resolve_task_title(title: str, titles: set[str]) -> str | None:
    """The task a bot means by `title`, among its own (lower-cased) titles: the exact one, or the only one that starts
    with it. Refusals quote a title cut short, and the bot copied the cut title back: 50 of 53 update_task attempts
    were refused for that (2026-10-03 audit)."""
    t = title.strip().lower().rstrip(".… ")
    if t in titles:
        return t
    if len(t) < 15:
        return None
    starts = [x for x in titles if x.startswith(t)]
    return starts[0] if len(starts) == 1 else None


def url_key(url: str) -> str:
    """An address as the same page is recognised: no scheme, no "www.", lower-cased host, no #fragment, no trailing
    slash. `https://poplarbooks.com` was refused as never seen against the stored `https://poplarbooks.com/` (2026-10-03 audit:
    28 refused opens and sources differed only by a slash, the scheme, "www" or a fragment)."""
    u = (url or "").strip().split("#", 1)[0]
    u = re.sub(r"^https?://", "", u, flags=re.I)
    host, _, rest = u.partition("/")
    host = host.lower().removeprefix("www.")
    return (host + ("/" + rest if rest else "")).rstrip("/")


def posts_are_twins(a: str, b: str) -> bool:
    """Two chatroom posts saying the same thing ('Hey fleet, I'm free and can assist with Safari...' 46 ways): six or
    more content words each and 60% shared (plurals/order ignored)."""
    wa, wb = _search_terms(a), _search_terms(b)
    if len(wa) < 6 or len(wb) < 6:
        return False
    return len(wa & wb) / min(len(wa), len(wb)) >= 0.6


def notes_are_twins(a: str, b: str) -> bool:
    """Two note titles that say the same thing in different words: both long enough to carry a finding (four or
    more content words) and sharing three quarters of them. 'Fresnel lens orders' vs 'Fresnel lens history' are two
    notes on one subject, not twins; 'Speka offers a free tier with $1 included monthly, no card' said two ways is."""
    wa, wb = question_words(a), question_words(b)
    if len(wa) < 4 or len(wb) < 4:
        return False
    return questions_are_similar(a, b, threshold=0.75)


def package_base(name: str) -> str:
    """A package name with a trailing version marker stripped, so 'MVP Starter v2/v3' all reduce to
    'mvp starter'. A descriptive rename ('... : adds analytics') keeps its own base, so a genuinely
    different offer is not caught -- only bare re-versioning of the same package is."""
    return _VERSION_SUFFIX.sub("", (name or "").strip().lower()).strip(" -:").strip()


def fleet_already_knows_provider(name: str) -> str | None:
    """The KNOWN_PROVIDERS key a recorded provider name refers to, or None. So the Scout does not
    re-record a provider the fleet already reaches (Groq, Gemini, Mistral, OpenRouter, ...): those are
    already set up, and the point of the scout is finding new capacity. Matched on whole words, so
    'Google Gemini' -> gemini and 'OpenRouter' -> openrouter, but an unrelated name is left alone."""
    words = set(re.findall(r"[a-z0-9]+", name.lower()))
    compact = re.sub(r"[^a-z0-9]", "", name.lower())
    for key in KNOWN_PROVIDERS:
        if key in words or key == compact:
            return key
    return None


def meta_topic_reason(kind: str) -> str:
    return (
        f"that {kind} is about your own tools, not a subject: search engines, rate limits and bot checks are "
        "handled for you and are never something to search for, ask about, note, or take an interest in. "
        "Go back to your question with the pages you have"
    )


@dataclass
class Verdict:
    allowed: bool
    reason: str = ""
    permanent: bool = False  # True when retrying the same target can never succeed
    over_budget: bool = False  # the episode is past its grace and only summarize is left: the controller closes it
    tag: str = ""  # an event kind for a refusal worth counting on its own (domain_cap), "" for the rest

    @classmethod
    def ok(cls) -> "Verdict":
        return cls(True, "")

    @classmethod
    def no(cls, reason: str, permanent: bool = False, over_budget: bool = False, tag: str = "") -> "Verdict":
        return cls(False, reason, permanent, over_budget, tag)


@dataclass
class PolicyContext:
    mode: str  # fake | web
    current_page: PageView | None
    actions_in_episode: int
    pages_last_hour: int
    open_questions: int
    last_visit_by_domain: dict[str, float]
    blocked_keys: set[str] = field(default_factory=set)
    pages_since_note: int = 0
    episode_note_titles: set[str] = field(default_factory=set)  # lower-cased titles saved this episode
    recent_note_titles: set[str] = field(default_factory=set)  # lower-cased titles saved in the last few days
    notes_in_episode: int = 0  # notes saved this episode
    notes_today: int = 0  # notes saved today
    questions_in_episode: int = 0  # ask actions accepted this episode
    refused_asks_in_episode: int = 0  # ask actions refused this episode
    open_question_texts: list[str] = field(default_factory=list)  # to refuse a rephrasing of one it already has
    says_in_episode: int = 0  # say(to="owner") actions accepted this episode
    says_today: int = 0  # say(to="owner") actions accepted since local midnight
    owner_wrote: bool = False  # the owner wrote in chat this episode: a reply is always allowed
    partner_turns_since_note: int = 0  # say(to="partner") exchanges since the last note
    partner_turns_in_episode: int = 0  # say(to="partner") exchanges accepted this episode
    search_paused_seconds: float = 0.0  # > 0 while searching is paused after a bot check
    desktop_available: bool = False  # the Mac is free right now (owner away, unlocked, inside hours)
    desktop_reason: str = "desktop control is disabled"
    desktop_view: DesktopView | None = None  # what the agent last saw on the screen
    upgrade_active: bool = False  # an upgrade worktree exists right now
    upgrade_tests_passed: bool = False  # the most recent upgrade_test in this worktree passed
    upgrade_touches_protected: list[str] = field(default_factory=list)  # protected files changed in the worktree
    tasks_in_episode: int = 0  # Notion tasks created this episode
    tasks_today: int = 0  # Notion tasks created today
    posts_today: int = 0  # publish actions allowed today, every destination
    recent_task_titles: set[str] = field(default_factory=set)  # lower-cased, last 30 days: never create one twice
    team: list[Member] = field(default_factory=list)  # the owner's team (team.py); empty = no list, any name goes
    packages_in_episode: int = 0  # package handoffs accepted this episode
    packages_today: int = 0  # package handoffs accepted today
    recent_package_names: set[str] = field(default_factory=set)  # lower-cased, last 30 days
    visited_urls: set[str] = field(default_factory=set)  # pages this bot actually loaded (recent)
    domain_visits_no_progress: dict[str, int] = field(default_factory=dict)  # registrable domain -> visits this episode, nothing written
    plan: Any = None  # the bot's WorkPlan (plan.py) or None
    plan_progress_action_id: int | None = None  # newest accepted write since the plan's last tick (or start); None = nothing written
    bot_name: str = ""  # this bot's own name (a plan step that messages itself is refused)
    refused_searches_in_episode: int = 0  # after three, searching is over for the episode
    refused_notes_in_episode: int = 0  # after three, no more notes this episode
    refused_tasks_in_episode: int = 0  # after three, no more tasks this episode
    providers_in_episode: int = 0  # scout provider finds this episode
    providers_today: int = 0  # scout provider finds today
    recent_provider_names: set[str] = field(default_factory=set)  # already in the report / lower-cased
    fleet_provider_names: set[str] = field(default_factory=set)  # KNOWN_PROVIDERS keys the fleet has a key for
    messages_in_episode: int = 0  # peer messages sent this episode
    messages_today: int = 0  # peer messages sent today
    goal_revisions_today: int = 0  # revise_goal actions accepted today
    last_room_post: str = ""  # this bot's most recent chatroom post, to refuse repeating it
    own_room_posts_recent: list[str] = field(default_factory=list)  # this bot's posts within messaging.room_repeat_hours
    room_posts_today: int = 0  # this bot's genuine chatroom posts since midnight
    proposals_today: int = 0  # propose_teammate actions accepted today
    proposed_roles: set[str] = field(default_factory=set)  # roles already in proposed-bots.md, lower-cased
    published_package_names: set[str] = field(default_factory=set)  # packages already on the Notion page
    # Published packages whose toggle lacked source-company facts and whose package now has them: may go up again.
    republishable_package_names: set[str] = field(default_factory=set)
    package_names_last_day: set[str] = field(default_factory=set)
    task_titles_today: set[str] = field(default_factory=set)
    republish_reasons: dict[str, str] = field(default_factory=dict)  # stale toggles, name -> why (controller._stale_toggles)  # lower-cased titles of the tasks this bot created today  # packages this bot handed over in the last 24 hours
    # Toggles really on the page now, by lower-cased name: {"title", "email_sha", "day" (last published, YYYY-MM-DD)}.
    packages_on_page: dict[str, dict] = field(default_factory=dict)
    task_updates_in_episode: int = 0  # update_task actions accepted this episode
    lead_updates_in_episode: int = 0  # update_lead actions accepted this episode
    recent_lead_names: dict[str, str] = field(default_factory=dict)  # business name (lower) -> site domain, this bot's own leads
    # With leads.update_any_row: name -> site domain ("" when the row has no website) for a row on the board that this
    # bot did not list, or None when no such row exists. A callable so the board is only asked on an update_lead.
    lead_site_on_board: Callable[[str], str | None] | None = None
    # The oldest open request from a priority sender to this bot: {"sender", "text", "actions_since_read"}, or None.
    priority_request: dict[str, Any] | None = None
    # publish_package: the package record for a name (handoff.find_package), so the email can be checked against it.
    package_record: Callable[[str], dict[str, Any] | None] | None = None
    # Lower-cased names of colleagues with an open request to this bot: a message to them is an answer, always allowed.
    open_asks_from: set[str] = field(default_factory=set)
    # This bot's own OPEN asks, by recipient (lower) -> [(text, sent_at)]: the same ask is not sent again while it waits.
    open_asks_to: dict[str, list[tuple[str, str]]] = field(default_factory=dict)
    # Packages this bot handed over recently with no source_company.name; a fuller re-send of one is not a duplicate.
    recent_packages_without_company: set[str] = field(default_factory=set)
    leads_in_episode: int = 0  # lead rows accepted this episode
    leads_today: int = 0  # lead rows accepted today
    recent_lead_domains: set[str] = field(default_factory=set)  # businesses already listed (by web domain)
    recent_page_texts: dict[str, str] = field(default_factory=dict)  # url -> text of pages opened recently, to ground an email
    episode_search_queries: list[str] = field(default_factory=list)  # queries already searched this episode
    seen_link_urls: set[str] = field(default_factory=set)  # link targets shown on pages this episode (for open_only_seen_urls)
    publish_packages_in_episode: int = 0  # publish_package actions accepted this episode
    now: float = field(default_factory=time.time)
    # Fields whose value is expensive to read (a database query, the shared pause file): name -> loader.
    # A field listed here is read the first time the policy looks at it and kept, so a check that never
    # looks at it costs nothing, and one that does always sees the real value, never the placeholder.
    loaders: dict[str, Callable[[], object]] = field(default_factory=dict, repr=False, compare=False)

    def __getattribute__(self, name: str) -> object:
        pending = object.__getattribute__(self, "__dict__").get("loaders")
        if pending and name in pending:
            value = pending.pop(name)()
            object.__setattr__(self, name, value)
            return value
        return object.__getattribute__(self, name)


class Allowlist:
    """Hosts a bot may read. A listed host covers its subdomains (bbc...onion covers www.bbc...onion).
    Lines may be bare hosts or URLs; '#' starts a comment."""

    def __init__(self, hosts: list[str] | None = None):
        self.hosts = {h.lower().strip(".") for h in (hosts or []) if h.strip(".")}

    @classmethod
    def load(cls, path: Path) -> "Allowlist":
        hosts: list[str] = []
        if path.exists():
            for raw in path.read_text(encoding="utf-8").splitlines():
                line = raw.split("#", 1)[0].strip()
                if not line:
                    continue
                host = urlparse(line).hostname if "://" in line else line.split("/", 1)[0].split(":", 1)[0]
                if host:
                    hosts.append(host)
        return cls(hosts)

    def __len__(self) -> int:
        return len(self.hosts)

    def allows(self, host: str) -> bool:
        host = (host or "").lower().split(":", 1)[0].strip(".")
        return bool(host) and any(host == h or host.endswith("." + h) for h in self.hosts)


class Denylist:
    def __init__(self, domains: list[str] | None = None, path_segments: list[str] | None = None):
        self.domains = [d.lower().strip(".") for d in (domains or [])]
        self.path_segments = [p.lower() for p in (path_segments or [])]

    @classmethod
    def load(cls, path: Path) -> "Denylist":
        domains: list[str] = []
        segments: list[str] = []
        if path.exists():
            for raw in path.read_text(encoding="utf-8").splitlines():
                line = raw.strip()
                if not line or line.startswith("#"):
                    continue
                if line.startswith("domain:"):
                    domains.append(line[len("domain:"):].strip())
                elif line.startswith("path:"):
                    segments.append(line[len("path:"):].strip())
        return cls(domains, segments)

    def __len__(self) -> int:
        return len(self.domains) + len(self.path_segments)

    def matches(self, url: str) -> str | None:
        parsed = urlparse(url)
        if parsed.scheme == "fake":
            host, path = "", parsed.netloc + parsed.path
        else:
            host, path = parsed.netloc.lower().split("@")[-1].split(":")[0], parsed.path
        for d in self.domains:
            if host == d or host.endswith("." + d):
                return f"domain {d} is on the denylist"
        for seg in path.lower().split("/"):
            if not seg:
                continue
            base = seg.rsplit(".", 1)[0] if "." in seg else seg
            if seg in self.path_segments or base in self.path_segments:
                return f"URL path segment '{seg}' is on the denylist"
        return None


def is_private_host(host: str) -> bool:
    host = host.lower().split("@")[-1].split(":")[0].strip("[]")
    if host in ("localhost", "") or host.endswith((".local", ".internal", ".localhost", ".lan", ".home")):
        return True
    try:
        addr = ipaddress.ip_address(host)
    except ValueError:
        return False
    return addr.is_private or addr.is_loopback or addr.is_link_local or addr.is_reserved or addr.is_multicast


class RobotsCache:
    """Caches robots.txt per host. Unreachable robots files allow everything."""

    def __init__(self, user_agent: str, fetch: Callable[[str], str | None] | None = None, ttl: float = 3600.0):
        self.user_agent = user_agent
        self.fetch = fetch or self._default_fetch
        self.ttl = ttl
        self._cache: dict[str, tuple[RobotFileParser | None, float]] = {}

    def _default_fetch(self, url: str) -> str | None:
        import httpx

        try:
            resp = httpx.get(url, timeout=10.0, headers={"User-Agent": self.user_agent}, follow_redirects=True)
        except httpx.HTTPError:
            return None
        if resp.status_code >= 400:
            return ""
        return resp.text

    def can_fetch(self, url: str) -> bool:
        parsed = urlparse(url)
        key = f"{parsed.scheme}://{parsed.netloc}"
        entry = self._cache.get(key)
        if entry is None or time.time() - entry[1] > self.ttl:
            text = self.fetch(key + "/robots.txt")
            parser: RobotFileParser | None = None
            if text is not None:
                parser = RobotFileParser()
                parser.parse(text.splitlines())
            entry = (parser, time.time())
            self._cache[key] = entry
        parser = entry[0]
        if parser is None:
            return True
        return parser.can_fetch(self.user_agent, url)


PRIORITY_WORK_TYPES = frozenset({"search", "open", "follow", "read", "back", "summarize", "update_lead", "lead", "plan", "package"})  # package: the handoff answers "send me the record"  # plan: the first step of a job  # allowed while a priority ask waits (summarize: the episode must be able to close)


class Policy:
    def __init__(
        self,
        cfg: PolicyConfig,
        publish: PublishConfig,
        denylist: Denylist,
        robots: RobotsCache | None = None,
        desktop: DesktopConfig | None = None,
        chat_partner: ChatPartnerConfig | None = None,
        developer: DeveloperConfig | None = None,
        developer_root: Path | None = None,
        notion: NotionConfig | None = None,
        allowlist: Allowlist | None = None,
        handoff: HandoffConfig | None = None,
        scout: ScoutConfig | None = None,
        messaging: MessagingConfig | None = None,
        self_goals: bool = False,
        propose_teammates: bool = False,
        leads: LeadsConfig | None = None,
    ):
        self.cfg = cfg
        self.self_goals = self_goals
        self.propose_teammates = propose_teammates
        self.publish = publish
        self.denylist = denylist
        # When set, every page must be on it (the Tor bot); None means the whole web minus the denylist.
        self.allowlist = allowlist
        self.robots = robots
        self.desktop = desktop or DesktopConfig()  # disabled unless configured
        self.chat_partner = chat_partner or ChatPartnerConfig()  # disabled unless configured
        self.developer = developer or DeveloperConfig()  # disabled unless configured
        self.notion = notion or NotionConfig()  # disabled unless configured (and the client is ready)
        self.handoff = handoff or HandoffConfig()  # disabled unless configured
        self.scout = scout or ScoutConfig()  # disabled unless configured
        self.messaging = messaging or MessagingConfig()  # disabled unless configured
        self.leads = leads or LeadsConfig()  # disabled unless configured
        # The one folder developer actions may touch, already resolved against the config root.
        self.developer_root = developer_root.resolve() if developer_root is not None else None

    # -- handoff -------------------------------------------------------------

    def _check_package(self, action: Package, ctx: PolicyContext) -> Verdict:
        """A package handed to another bot must rest on pages this bot actually read, and stay rare."""
        h = self.handoff
        if not h.enabled:
            return Verdict.no("handing packages to another bot is not enabled; that action does not exist")
        name = action.name.strip()
        if not name or not action.price.strip() or not action.audience.strip() or not action.rationale.strip():
            return Verdict.no("a package needs a name, a price, who it is for, and why (the rationale)")
        if len(name) > 120:
            return Verdict.no("keep the package name under 120 characters")
        if is_meta_topic(name):
            return Verdict.no(meta_topic_reason("package"))
        if not any(ch.isdigit() for ch in action.price) and not re.search(r"\b(demo|quote|quoted|per deployment)\b", action.price, re.I):
            return Verdict.no("the price must be a real figure or range, like \"$4,000-6,000 fixed\" or \"$3,200/month\"")
        deliverables = [d for d in action.deliverables if d.strip()]
        if len(deliverables) < 2:
            return Verdict.no("list at least two concrete deliverables the client gets")
        if len(action.rationale) > 3000 or sum(len(d) for d in deliverables) > 3000:
            return Verdict.no("keep the rationale and the deliverables under 3000 characters each")
        sources = [u.strip() for u in action.sources if u.strip()]
        schemes = ("http://", "https://", "fake://") if ctx.mode == "fake" else ("http://", "https://")
        if not sources or any(not u.startswith(schemes) for u in sources):
            return Verdict.no("sources must be the http(s) pages you read that show these services and prices")
        need = int(getattr(self.handoff, "min_source_sites", 1) or 1)
        if len({url_domain(u) for u in sources}) < need:
            # 2026-09-26: four packages in a night on one page each; a package rests on two sites (two agencies' pricing pages)
            return Verdict.no(f"a package rests on sources from at least {need} different sites; open another agency's pricing page first")
        own = {d.strip().lower().removeprefix("www.") for d in h.own_domains if d.strip()}
        if any(url_domain(u) in own for u in sources):
            return Verdict.no(
                "your own company's site is not a source; a package rests on the competitor or agency pages you "
                "read (their pricing and about pages), so cite those and drop your own"
            )
        if any(is_search_results_url(u) for u in sources):
            return Verdict.no(
                "a search-results page is not a source, it is where you looked. Cite the agency pages you opened "
                "from it (their pricing page, their about page), not the search itself"
            )
        opened = lambda u: u in ctx.visited_urls or u.rstrip("/") in ctx.visited_urls  # noqa: E731
        unread = [u for u in sources if not opened(u)]
        if unread:
            read = [u for u in sorted(ctx.visited_urls)
                    if not is_search_results_url(u) and url_domain(u) not in own and u.startswith(schemes)]
            hint = (" Pages you did open: " + ", ".join(read[-5:])) if read else ""
            return Verdict.no(
                "every source must be a page you actually opened; you did not open: "
                + ", ".join(u[:80] for u in unread[:3]) + "." + hint
            )
        sc = action.source_company
        if not sc.name.strip() or not sc.website.strip():
            return Verdict.no(
                "source_company needs at least the name and website of the agency behind your sources -- the "
                "company whose pricing page you read. Take them from its pages; leave founded/employees/valuation/"
                "location blank when its pages do not say"
            )
        site = sc.website.strip()
        if not site.startswith(schemes):
            return Verdict.no("source_company.website must be the company's http(s) address")
        if url_domain(site) not in {url_domain(u) for u in sources}:
            return Verdict.no(
                "source_company.website must be the site of one of your sources: the source company is the one "
                "whose pages you cited, not another company you know of"
            )
        enriching = name.lower() in ctx.recent_packages_without_company and bool(sc.name.strip())
        resend = bool(getattr(h, "resend_same_name", False)) and name.lower() in ctx.recent_package_names
        if resend and name.lower() in ctx.package_names_last_day:
            return Verdict.no(f"you already handed over '{name[:60]}' in the last 24 hours; improve another package, or this one tomorrow", permanent=True)
        if name.lower() in ctx.recent_package_names and not enriching and not resend:
            return Verdict.no(f"you already handed over a package named '{name[:60]}' recently", permanent=True)
        base = package_base(name)
        if base and not enriching and not resend and base in {package_base(n) for n in ctx.recent_package_names}:
            return Verdict.no(
                f"you already sent a package for '{base[:50]}'; the fleet needs different offers, not another "
                "version of the same one. Design a package for a different service -- a web or mobile app build, "
                "a marketing retainer, maintenance, dedicated developers (Next Office), data work",
                permanent=True,
            )
        if ctx.packages_in_episode >= h.max_per_episode:
            return Verdict.no("you already handed over a package this episode; research the next one first")
        if ctx.packages_today >= h.max_per_day:
            return Verdict.no(f"you have handed over {ctx.packages_today} packages today, the daily limit; keep notes instead")
        return Verdict.ok()

    def _check_provider(self, action: Provider, ctx: PolicyContext) -> Verdict:
        """A provider find must rest on pages the scout actually read, and stay rare."""
        s = self.scout
        if not s.enabled:
            return Verdict.no("recording providers is not enabled; that action does not exist")
        name = action.name.strip()
        if not name or not action.base_url.strip() or not action.free_terms.strip() or not action.why.strip():
            return Verdict.no("a provider needs a name, an endpoint, its free terms, and why it is worth adding")
        if len(name) > 120:
            return Verdict.no("keep the provider name under 120 characters")
        if not action.base_url.strip().startswith(("http://", "https://")):
            return Verdict.no("base_url must be the provider's https:// API endpoint")
        if getattr(self.scout, "kind", "provider") == "agent" and ".onion" in action.base_url.lower():
            return Verdict.no("an AI agent's website must be a clearnet https page; a Tor address is not an agent for the owner's list "
                              "(OnionShare, 2026-09-26). Read the agent's own site first")
        sources = [u.strip() for u in action.sources if u.strip()]
        schemes = ("http://", "https://", "fake://") if ctx.mode == "fake" else ("http://", "https://")
        if not sources or any(not u.startswith(schemes) for u in sources):
            return Verdict.no("sources must be the http(s) pages you read about this provider")
        if not any(u in ctx.visited_urls or u.rstrip("/") in ctx.visited_urls for u in sources):
            return Verdict.no("none of those sources is a page you opened; read the provider's page first, then record it")
        if name.lower() in ctx.recent_provider_names:
            return Verdict.no(f"'{name[:60]}' is already in the report; find a different provider", permanent=True)
        known = fleet_already_knows_provider(name)
        if known and known in ctx.fleet_provider_names:
            return Verdict.no(
                f"the fleet already has a key for {known}, so it is not a new find; record only a provider the "
                "fleet does not already use, or a known one it has no key for yet",
                permanent=True,
            )
        if ctx.providers_in_episode >= s.max_per_episode:
            return Verdict.no("you already recorded a provider this episode; research the next one first")
        if ctx.providers_today >= s.max_per_day:
            return Verdict.no(f"you have recorded {ctx.providers_today} providers today, the daily limit; take notes instead")
        return Verdict.ok()

    def _check_plan(self, action: Plan, ctx: PolicyContext) -> Verdict:
        """A plan is a checklist with a test, one at a time; a tick needs an accepted write behind it (the Validator's
        PL01: a step marked done has by_action). Ending a plan is always allowed."""
        plan = ctx.plan
        if action.tick is not None:
            if plan is None or not plan.active:
                return Verdict.no("you have no active plan to tick; write one first with task, done_when and steps")
            if action.tick not in plan.open_steps:
                return Verdict.no(f"step {action.tick} is not an open step of your plan (open: {', '.join(map(str, plan.open_steps)) or 'none'})")
            if ctx.plan_progress_action_id is None:
                return Verdict.no("nothing has been written since your last tick (no lead, update, note, task, package or message on record), "
                                  "so that step is not done yet. Do the step, then tick it")
            return Verdict.ok()
        if action.status is not None:
            if plan is None or not plan.active:
                return Verdict.no("you have no active plan to end")
            if action.status not in ("done", "stuck"):
                return Verdict.no('a plan ends with status "done" or "stuck"')
            if action.status == "stuck" and not action.note.strip():
                return Verdict.no("say in `note` why you are stuck, so the owner can help")
            if action.status == "done" and not plan.produced:
                return Verdict.no("a plan is done when it produced something: no ticked step is backed by a lead, update, task, package, "
                                  'note or entry. Do that step, or end it with status "stuck" and say why')
            return Verdict.ok()
        task, done_when = action.task.strip(), action.done_when.strip()
        steps = [s.strip() for s in action.steps if s and s.strip()]
        if not task or not done_when or len(steps) < 2:
            return Verdict.no("a new plan needs task, done_when and at least two steps (or tick / status for the plan you have)")
        if any((not isinstance(m, int)) or m <= 0 or m > 600 for m in action.step_minutes) or \
                (action.estimate_min is not None and not 0 < action.estimate_min <= 3000):
            return Verdict.no("estimates are working minutes: 1 to 600 per step, up to 3000 for the plan")
        if len(task) > 200 or len(done_when) > 200 or any(len(s) > 160 for s in steps) or len(steps) > 8:
            return Verdict.no("keep the plan short: task and done_when under 200 characters, two to eight steps under 160 each")
        if is_meta_topic(task) or forbidden_goal_reason(task):
            return Verdict.no("that is not a job for you: your tools, rate limits and the owner's fence are not plans")
        me = (ctx.bot_name or "").strip().lower()
        if me and any(me in s.lower() and re.search(r"\b(message|send|tell|inform|confirm|notify)\b", s, re.I) for s in steps):
            return Verdict.no(f"a step that messages {ctx.bot_name} is a step that messages yourself; plan steps are work that produces "
                              "something (a lead, a task, a package, a note), not talk")
        work = re.compile(r"\b(lead(?!\s+gen)|update|task|package|publish|note|entry|row|list|fill|find|research|read|open|check|verify|write)\b", re.I)
        if not any(work.search(s) for s in steps):
            return Verdict.no("every step is talk (messages, confirmations); at least one step must produce something: a lead, task, package, note or entry")
        cap = self.cfg.domain_no_progress_cap
        if cap > 0:
            from .plan import WorkPlan

            probe = WorkPlan.new(task, done_when, steps)
            closed = [d for d, n in ctx.domain_visits_no_progress.items() if n >= cap and probe.names_domain(d)]
            if closed:
                return Verdict.no(f"that plan is built on {', '.join(closed[:3])}, which gave nothing after {cap} pages today; "
                                  "plan a different business, or report to whoever asked that the site does not state it")
        if plan is not None and plan.active:
            if plan.task.strip().lower() == task.lower():
                return Verdict.no("you already have this plan; tick its steps or end it")
            return Verdict.no(f'you already have an active plan ("{plan.task[:80]}"); end it with status "done" or "stuck" before starting another')
        return Verdict.ok()

    def _is_peer(self, name: str) -> bool:
        """A family member this bot can message: a task assigned to one becomes its request (owner, 2026-09-28:
        "family should listen to ceoA")."""
        m = self.messaging
        if m is None or not m.enabled:
            return False
        return name.strip().lower() in {p.strip().lower() for p in m.peer_names}

    def _check_revise_goal(self, action: ReviseGoal, ctx: PolicyContext) -> Verdict:
        """A bot may rewrite its own goal, but not into one of the things the code fence forbids, and
        not so often it thrashes. The goal is aspiration; the policy still governs every action."""
        if not self.self_goals:
            return Verdict.no("rewriting your own goal is not enabled; that action does not exist")
        goal = action.goal.strip()
        if not goal:
            return Verdict.no("a revised goal needs some text")
        if len(goal) > 1500:
            return Verdict.no("keep your goal under 1500 characters")
        if is_meta_topic(goal):
            return Verdict.no(meta_topic_reason("goal"))
        if forbidden_goal_reason(goal):
            return Verdict.no(
                "that goal is about getting hold of credentials, keys, accounts or stolen data, doing "
                "something illegal, spending money, or copying yourself onto machines -- those are off "
                "limits and can never be a goal. Set a goal about what you will learn, make, or help with.",
                permanent=True,
            )
        if ctx.goal_revisions_today >= 2:
            return Verdict.no("you have already rewritten your goal twice today; live with it a while before changing it again")
        return Verdict.ok()

    def _check_update_task(self, action: UpdateTask, ctx: PolicyContext) -> Verdict:
        """Fix a task this bot created: only its own tasks (exact title), only real changes, the same field rules
        as creating one, and rarely -- it exists to answer a Validator/owner defect, not to fidget."""
        if not self.notion.enabled:
            return Verdict.no("updating tasks is not enabled; that action does not exist")
        title = action.title.strip()
        if not title or resolve_task_title(title, ctx.recent_task_titles) is None:
            close = sorted(t for t in ctx.recent_task_titles if title and (title.lower()[:12] in t or t[:12] in title.lower()))[:3]
            return Verdict.no(
                "update_task takes the title of a task you created yourself; "
                f"'{title[:60]}' is not one of them" + (". Did you mean: " + " | ".join(f"'{t}'" for t in close) if close else "")
            )
        changes = [v for v in (action.assignee, action.priority, action.due, action.details_append) if v is not None and str(v).strip()]
        if not changes:
            return Verdict.no("an update needs at least one change: assignee, priority, due, or details_append")
        # Owner, 2026-09-28: any assignee, or none; an unknown name is left unassigned by the Notion client.
        if action.due is not None and action.due.strip() and not valid_date(action.due):
            return Verdict.no("due must be a date like 2026-09-30")
        if action.priority is not None and action.priority.strip() and not valid_priority(action.priority):
            return Verdict.no("priority must be P0 to P6")
        if action.details_append and len(action.details_append) > 3000:
            return Verdict.no("keep details_append under 3000 characters")
        if action.details_append and is_meta_topic(action.details_append):
            return Verdict.no(meta_topic_reason("update"))
        if ctx.task_updates_in_episode >= 2:
            return Verdict.no("you already fixed two tasks this episode; leave the rest for next time")
        return Verdict.ok()

    def _check_lead(self, action: Lead, ctx: PolicyContext) -> Verdict:
        """A lead is a business the bot actually read, with a business email published on its own site (no email,
        no lead), a pain point tied to a page it opened, and the package that fixes it. Each business once."""
        L = self.leads
        if not L.enabled:
            return Verdict.no("listing leads is not enabled; that action does not exist")
        name, site, email = action.name.strip(), action.website.strip(), action.email.strip()
        pain, fix, evidence = action.pain_point.strip(), action.how_we_help.strip(), action.evidence.strip()
        if not name or not site or not email or not pain or not fix or not evidence:
            return Verdict.no("a lead needs the business name, website, a business email, the pain point, how_we_help (a package name) and the evidence URL")
        if len(name) > 120 or len(pain) > 1500 or len(action.industry) > 200 or len(action.location) > 200:
            return Verdict.no("keep the name under 120 characters, the pain point under 1500, industry and location short")
        if is_meta_topic(pain) or is_meta_topic(name):
            return Verdict.no(meta_topic_reason("lead"))
        schemes = ("http://", "https://", "fake://") if ctx.mode == "fake" else ("http://", "https://")
        if not site.startswith(schemes):
            return Verdict.no("website must be the business's http(s) address")
        site_domain = url_domain(site)
        edomain = email_domain(email)
        if not edomain:
            return Verdict.no("email must be a real address like hello@theirdomain.com")
        if any(edomain == f or edomain.startswith(f) for f in _FREE_MAIL):
            return Verdict.no("that is a personal mailbox provider, not a business address; a lead needs an email on the business's own domain, or no lead")
        # Owner, 2026-09-30: an email on a different domain is accepted when it is printed on the business's own page
        # (shopcityspf.com on shopcity.us; sweetcorner.org on the .com site). The on-page check below is the
        # proof for every address, same domain or not; a free mailbox provider stays refused above.
        visited_keys = {url_key(u) for u in ctx.visited_urls}
        opened = lambda u: u in ctx.visited_urls or url_key(u) in visited_keys  # noqa: E731
        sources = [u.strip() for u in action.sources if u.strip()]
        if any(not u.startswith(schemes) for u in sources) or (sources and any(not opened(u) for u in sources)):
            return Verdict.no("sources must be http(s) pages you actually opened")
        if not opened(evidence):
            return Verdict.no("evidence must be the URL of a page you actually opened that shows the pain point")
        own_pages = {u: t for u, t in ctx.recent_page_texts.items() if same_site(url_domain(u), site_domain)}
        if not own_pages:
            # A city-record address that forwards to the business's real domain: the pages the bot read are on that
            # domain, and when the email's own domain is that domain they ARE the business's site (22 refusals).
            own_pages = {u: t for u, t in ctx.recent_page_texts.items() if same_site(url_domain(u), edomain)}
        if not own_pages:
            return Verdict.no("you have not opened any page on the business's own site; read its site (contact page, about page) before listing it")
        if not any(email.lower() in (t or "").lower() for t in own_pages.values()):
            return Verdict.no(
                f"'{email}' does not appear on any page of {site_domain} you opened. A lead's email must be published by "
                "the business on its own site (contact page, footer); never guess one or take it from elsewhere -- no email, no lead"
            )
        if site_domain in ctx.recent_lead_domains:
            return Verdict.no(f"{site_domain} is already on the Leads board; find a different business", permanent=True)
        if 0 < L.max_per_episode <= ctx.leads_in_episode:  # 0 = no cap (owner, 2026-09-24: "remove caps from lead gen")
            return Verdict.no("you already listed a lead this episode; research the next one first")
        if 0 < L.max_per_day <= ctx.leads_today:
            return Verdict.no(f"you have listed {ctx.leads_today} leads today, the daily limit; keep notes on candidates instead")
        return Verdict.ok()

    def _check_update_lead(self, action: UpdateLead, ctx: PolicyContext) -> Verdict:
        """Fix a lead this bot listed: only its own rows (exact business name), only real changes, and every changed
        field re-checked by the same rules as a new lead (an email is still one published on the business's own site,
        on a page the bot opened). Rare: it answers a Validator/owner defect, it is not a way to fidget."""
        L = self.leads
        if not L.enabled:
            return Verdict.no("updating leads is not enabled; that action does not exist")
        name = action.name.strip()
        site_domain = ctx.recent_lead_names.get(name.lower()) if name else None
        if name and site_domain is None and L.update_any_row and ctx.lead_site_on_board is not None:
            site_domain = ctx.lead_site_on_board(name)  # a row the owner or another bot put on the board
        if not name or site_domain is None:
            return Verdict.no(
                ("update_lead takes the exact business name of a lead on the Leads board" if L.update_any_row else
                 "update_lead takes the exact business name of a lead you listed yourself (see your recent leads)")
                + f"; '{name[:60]}' is not one of them"
            )
        if not site_domain and action.email and not (action.website or "").strip():
            return Verdict.no("that row has no website yet; give the website in the same update so the email can be checked against it")
        changes = {
            k: str(getattr(action, k)).strip()
            for k in ("website", "email", "pain_point", "how_we_help", "evidence", "location", "industry", "size", "founded_by")
            if getattr(action, k) is not None and str(getattr(action, k)).strip()
        }
        sources = [u.strip() for u in (action.sources or []) if u.strip()]
        only = [f for f in L.update_only_fields if f]
        if only:
            extra = sorted(k for k in changes if k not in only) + (["sources"] if sources and "sources" not in only else [])
            if extra:
                return Verdict.no(f"on the Leads board you decide only: {', '.join(only)}. Leave {', '.join(extra)} out of the update")
        if not changes and not sources:
            return Verdict.no("an update needs at least one change: website, email, pain_point, how_we_help, evidence, location, industry, size, founded_by or sources")
        if len(changes.get("founded_by", "")) > 120:
            return Verdict.no("founded_by is a person's name or two as a page states them, under 120 characters")
        if len(changes.get("pain_point", "")) > 1500 or len(changes.get("industry", "")) > 200 or len(changes.get("location", "")) > 200:
            return Verdict.no("keep the pain point under 1500 characters, industry and location short")
        if "pain_point" in changes and is_meta_topic(changes["pain_point"]):
            return Verdict.no(meta_topic_reason("lead"))
        schemes = ("http://", "https://", "fake://") if ctx.mode == "fake" else ("http://", "https://")
        if "website" in changes:
            if not changes["website"].startswith(schemes):
                return Verdict.no("website must be the business's http(s) address")
            site_domain = url_domain(changes["website"])
        if "email" in changes:
            email = changes["email"]
            edomain = email_domain(email)
            if not edomain:
                return Verdict.no("email must be a real address like hello@theirdomain.com")
            if any(edomain == f or edomain.startswith(f) for f in _FREE_MAIL):
                return Verdict.no("that is a personal mailbox provider, not a business address; a lead needs an email on the business's own domain")
            # a different domain is fine when the address is printed on the business's own page (checked below)
            own_pages = {u: t for u, t in ctx.recent_page_texts.items() if same_site(url_domain(u), site_domain)}
            if not own_pages or not any(email.lower() in (t or "").lower() for t in own_pages.values()):
                return Verdict.no(
                    f"'{email}' does not appear on any page of {site_domain} you opened. Open the business's contact page "
                    "first; the email must be published there, never guessed"
                )
        opened = lambda u: u in ctx.visited_urls or u.rstrip("/") in ctx.visited_urls  # noqa: E731
        if "evidence" in changes and (not changes["evidence"].startswith(schemes) or not opened(changes["evidence"])):
            return Verdict.no("evidence must be the URL of a page you actually opened that shows the pain point")
        if any(not u.startswith(schemes) for u in sources) or any(not opened(u) for u in sources):
            return Verdict.no("sources must be http(s) pages you actually opened")
        if 0 < L.max_updates_per_episode <= ctx.lead_updates_in_episode:
            return Verdict.no(f"you already fixed {ctx.lead_updates_in_episode} leads this episode; leave the rest for next time")
        return Verdict.ok()

    def _check_publish_package(self, action: PublishPackage, ctx: PolicyContext) -> Verdict:
        """Publish a received package as a toggle on the Notion page: needs the page configured, a
        marketing title and an email pitch, and each package goes up once."""
        if not self.notion.enabled or not self.notion.package_page_id.strip():
            return Verdict.no("publishing packages to the Notion page is not enabled; that action does not exist")
        name = action.name.strip()
        if not name or not action.title.strip() or not action.email.strip():
            return Verdict.no("that needs the exact package name, a marketing title, and the email pitch")
        if len(action.title) > 200:
            return Verdict.no("keep the title under 200 characters")
        if len(action.email) > 6000 or len(action.conclusion) > 2000:
            return Verdict.no("keep the email under 6000 characters and the conclusion under 2000")
        if is_meta_topic(action.title):
            return Verdict.no(meta_topic_reason("title"))
        on_page = ctx.packages_on_page or {}
        if (self.notion.package_republish_own and name.lower() in on_page
                and str(on_page[name.lower()].get("day", "")) == time.strftime("%Y-%m-%d")
                and not str(ctx.republish_reasons.get(name.lower(), "")).startswith(("written in pitch format", "the Package Designer re-sent"))):
            # replaced at 01:34 and again at 07:34 on 2026-10-03 on the Validator's request each time: a toggle churns
            # when the fix does not satisfy the flag. One replacement a day, whoever asks.
            return Verdict.no(f"'{name[:60]}' was already replaced today; a toggle is replaced at most once a day. "
                              "Make the next version right (price in the title and the email) and publish it tomorrow.", permanent=True)
        if (self.notion.package_republish_own and name.lower() in on_page and name.lower() not in ctx.republishable_package_names):
            # The CEO's own change to its package: same name, new title or pitch, replaces the toggle -- once a day.
            import hashlib

            shown = on_page[name.lower()]
            if str(shown.get("day", "")) == time.strftime("%Y-%m-%d"):
                return Verdict.no(f"'{name[:60]}' was already published today; a toggle is replaced at most once a day. Move on.", permanent=True)
            same_title = action.title.strip() == str(shown.get("title", "")).strip()
            same_email = bool(shown.get("email_sha")) and hashlib.sha256(action.email.strip().encode()).hexdigest() == shown.get("email_sha")
            if same_title and same_email:
                return Verdict.no(f"'{name[:60]}' is on the packages page with exactly this title and email; nothing would change. "
                                  "Republish only with a changed price, title or pitch.", permanent=True)
        elif name.lower() in ctx.published_package_names and name.lower() not in ctx.republishable_package_names and on_page and name.lower() not in on_page:
            # a name that went up once and was retired: saying "already on the page" sent The CEO round in circles
            names = "; ".join(str(v.get("name") or k) for k, v in sorted(on_page.items()))
            return Verdict.no(
                f"'{name[:60]}' was retired from the packages page (one offer, one toggle). The packages on the page are: {names}. "
                "To change one of them, publish_package with its exact name; do not bring a retired name back.", permanent=True)
        elif name.lower() in ctx.published_package_names and name.lower() not in ctx.republishable_package_names:
            return Verdict.no(
                f"'{name[:60]}' is already on the packages page; publish a different one (a package goes up again "
                "only when the Package Designer re-sends it with source-company facts its toggle lacks)",
                permanent=True,
            )
        if ctx.publish_packages_in_episode >= 1:
            return Verdict.no("you already published a package this episode; do the next one next time")
        lowered = action.email.lower()
        missing = [p for p in self.notion.package_email_required_phrases if p.strip() and p.strip().lower() not in lowered]
        if missing:
            return Verdict.no(
                f"the email must carry {', '.join(repr(m) for m in missing)} -- the owner's format: the co-founders Alex and Sam "
                "by name and role, and the one portfolio line (across our 20+ clients the top performer does about $500,000 in "
                "online sales a month, up from roughly $300,000). Write the email again with them in."
            )
        record = ctx.package_record(name) if ctx.package_record is not None else None
        rule = (self.notion.package_email_price_rule or "record").strip().lower()
        if record and rule in ("record", "range"):
            # "record": every money figure in the email must come from the record (The CEO wrote "starting at $2,500 for
            # setup ... from $500/month" into a package whose price is "quoted per deployment", 2026-09-25).
            # "range": any figure between the record's lowest and highest amount (owner, 2026-09-28).
            facts = " ".join(str(record.get(k, "")) for k in ("price", "rationale", "audience", "timeline")) + " " + " ".join(record.get("deliverables") or [])
            facts_amounts = set(re.findall(r"\$\s?\d[\d,]*(?:\.\d+)?\s?[kKmM]?", facts))
            norm = lambda a: a.replace(" ", "").lower().rstrip(",.")  # noqa: E731 - "$30,000," at a clause end is $30,000
            facts_norm = {norm(a) for a in facts_amounts}
            facts_norm |= {norm(a) for a in self.notion.package_email_allowed_figures}  # the owner's portfolio line
            values = [money_value(a) for a in facts_amounts]
            lo, hi = (min(values), max(values)) if values else (None, None)
            price = str(record.get("price", "")).strip()[:160]
            for amount in re.findall(r"\$\s?\d[\d,]*(?:\.\d+)?\s?[kKmM]?", action.email + " " + action.title + " " + action.conclusion):
                if norm(amount) in facts_norm:
                    continue
                if rule == "range" and lo is not None and lo <= money_value(amount) <= hi:
                    continue
                if rule == "range" and lo is not None:
                    return Verdict.no(f"the email names {amount.strip()}, outside the Package Designer's range for this package (\"{price}\"). "
                                      "Pick a price inside it, or use the record's wording.")
                return Verdict.no(
                    f"the email names {amount.strip()}, which the package record does not. The record's price is: \"{price}\". "
                    "Use that wording; never invent a figure, a setup fee or a monthly rate, and do not add features the record does not list."
                )
        return Verdict.ok()

    def _check_propose_teammate(self, action: ProposeTeammate, ctx: PolicyContext) -> Verdict:
        """A bot may suggest one new role the fleet is missing, rarely, and not one that would do a
        fenced thing (its purpose can't be acquiring credentials, spending, self-replication, etc.)."""
        if not self.propose_teammates:
            return Verdict.no("proposing new teammates is not enabled; that action does not exist")
        role, does, why = action.role.strip(), action.does.strip(), action.why.strip()
        if not role or not does or not why:
            return Verdict.no("a proposal needs a role name, what it would do, and why the fleet needs it")
        if len(role) > 80 or len(does) > 1000 or len(why) > 1000:
            return Verdict.no("keep the role name under 80 characters and does/why under 1000 each")
        if is_meta_topic(role) or is_meta_topic(does):
            return Verdict.no(meta_topic_reason("proposal"))
        if forbidden_goal_reason(does) or forbidden_goal_reason(role):
            return Verdict.no(
                "a proposed bot cannot exist to acquire credentials or stolen data, do something illegal, "
                "spend money, or copy itself onto machines -- those are off limits for any bot",
                permanent=True,
            )
        if role.lower() in ctx.proposed_roles:
            return Verdict.no(f"a '{role[:60]}' role is already proposed in the file; suggest a different one", permanent=True)
        if ctx.proposals_today >= 1:
            return Verdict.no("you already proposed a teammate today; give the owner time to weigh it")
        return Verdict.ok()

    def _check_message(self, action: Message, ctx: PolicyContext) -> Verdict:
        """A message to a peer bot: to the one configured peer, short, and (for a local-only bot)
        stripped of anything that would carry page content to a peer whose model is in the cloud."""
        m = self.messaging
        if not m.enabled:
            return Verdict.no("messaging another bot is not enabled; that action does not exist")
        text = action.text.strip()
        if not text:
            return Verdict.no("a message needs some text")
        to = action.to.strip()
        if is_room_recipient(to):
            if not m.room:
                return Verdict.no("there is no fleet chatroom to post to", permanent=True)
            norm = lambda s: " ".join((s or "").lower().split())  # noqa: E731
            if ctx.last_room_post and norm(text)[:80] == norm(ctx.last_room_post)[:80]:
                return Verdict.no(
                    "you already posted that to the chatroom; wait for a reply, answer someone else, or say "
                    "something new instead of repeating yourself"
                )
            twin = next((prev for prev in ctx.own_room_posts_recent if posts_are_twins(text, prev)), None)
            if twin is not None:
                return Verdict.no(
                    f"that restates what you already posted ('{twin[:50]}...'). The fleet read it the first time; do not "
                    "offer or announce the same thing again. Post only when you have something new: an answer to someone, "
                    "a result, a question"
                )
            if 0 < m.max_room_posts_per_day <= ctx.room_posts_today:
                return Verdict.no(
                    f"you have posted {ctx.room_posts_today} times to the chatroom today, the daily cap; reply to a colleague "
                    "directly (their name in \"to\") if it is for one bot, otherwise get on with your work"
                )
        elif to.lower() not in {n.lower() for n in m.peer_names}:
            targets = [*m.peer_names] + ([f'"{ROOM_RECIPIENT}" (the fleet chatroom)'] if m.room else [])
            listed = ", ".join(targets) or "(no colleagues configured)"
            hint = (" The owner is reached with `say`, not `message`." if to.lower() in ("owner", "the owner")
                    else " A person on the human team gets a `task`, not a `message`.")
            return Verdict.no(f"you can only message: {listed}.{hint}", permanent=True)
        else:
            folder = m.folder_for(to)
            if folder and (Path(folder).expanduser() / "workspace" / "STOP").exists():
                return Verdict.no(f"{to} is stopped (its STOP file is present); nobody would read that. Note it or ask someone who is running.")
            if to.lower() in {p.strip().lower() for p in m.route_only_peers} and not re.match(r"^\s*route\s+\S+\s+to\s+\S", text, re.I):
                return Verdict.no(f"{to} reads only route lines from bots (route <file> to <bot>: <why>); anything else to it is never read. Keep it as a note.")
        pr = ctx.priority_request
        if pr and to.lower() == str(pr.get("sender", "")).strip().lower() and str(pr.get("text", "")).startswith("file dropped by the owner:"):
            # The drop folder's announcement wants a decision the controller can carry out, not a report (The CEO,
            # 2026-09-24: "Noted the file drop...", "Processed the file... will proceed with outreach" -- neither routed anything).
            if not re.match(r"^\s*route\s+\S+\s+to\s+\S", text, re.I):
                m_name = re.match(r"file dropped by the owner:\s*(\S+)", str(pr.get("text", "")))
                name = m_name.group(1) if m_name else "<file name>"
                return Verdict.no(
                    f"{to} needs a decision, not a report, and only in this shape: route {name} to <bot name>: <why> "
                    f"-- or: route {name} to nobody: <why>. One line, nothing before 'route'. Bot names are your message "
                    "targets or yourself; 'everyone' means all bots. Do not describe work you have not done."
                )
        if is_meta_topic(text) and not re.match(r"^\s*route\s+\S+\s+to\s+", text, re.I):
            # "route tools.txt to Scout: a list of free APIs" is the drop-folder decision (dropbox.py), not a tools chat
            return Verdict.no(meta_topic_reason("message"))
        _pr = ctx.priority_request
        _answering = bool(_pr) and to.lower() == str(_pr.get("sender", "")).strip().lower()
        limit = max(m.max_chars, 1500) if _answering else m.max_chars  # a full answer to a priority ask may run long
        if len(text) > limit:
            return Verdict.no(
                f"keep the message under {limit} characters; send a short question or topic, not a long passage"
                + ("" if _answering else " (an answer to a priority ask may run to 1500)")
            )
        if m.plain_only:
            low = text.lower()
            if "://" in low or ".onion" in low or "http" in low or "www." in low:
                return Verdict.no(
                    "send your colleague only a short plain question or topic: no links, no URLs, no .onion "
                    "addresses, and no quoted page text. What you read over Tor stays on this Mac."
                )
        pr = ctx.priority_request
        answering_priority = bool(pr) and to.lower() == str(pr.get("sender", "")).strip().lower()
        claims = ("done", "updated", "published", "fixed", "created", "listed", "filled", "completed", "added", "replaced", "sent the")
        if answering_priority and text.lower().lstrip("*- ").startswith(claims) and "could not" not in text.lower()[:200] \
                and "writes_since_read" in pr and int(pr.get("writes_since_read") or 0) == 0:
            # "done: filled Founded by, Location ..." with zero accepted writes since the ask was read is a claim, not a
            # report (Lead Gen, 2026-09-25). Say what you could not do instead, or do it first.
            return Verdict.no(
                f"you have not done it: no note, lead, update, task or package of yours was accepted since you read {to}'s ask. "
                "Do the work first, or reply honestly starting with 'could not find: ...' / 'could not: ...' and why."
            )
        from .fleet_requests import is_status_note

        if not is_status_note(text) and not text.lower().startswith("done"):
            # The same ask twice while the first is still open is noise for the recipient (The CEO sent Lead Gen five
            # near-identical "shift focus to SMB leads" asks in 17 minutes, 2026-09-25); wait for the answer instead.
            from .fleet_requests import same_ask

            for prev, sent_at in ctx.open_asks_to.get(to.lower(), []):
                if same_ask(text, prev):
                    return Verdict.no(
                        f"you already asked {to} that at {sent_at[11:16]} and it is still open; they see it every cycle. "
                        "Wait for the answer or do your own work -- do not send it again."
                    )
        if is_status_note(text) and not text.lower().startswith("done") and to.lower() not in ctx.open_asks_from and not answering_priority:
            # "Checked X, not relevant" to a colleague is a status note; it would become their top priority and cost
            # them a reply. Notes go in a note; a message asks for something or answers an ask.
            return Verdict.no(
                "that is a status note, not a request: a message to a colleague asks them for one concrete thing or answers "
                "what they asked you. Keep what you checked in a `note`; write to them only when you need something from them."
            )
        if ctx.messages_in_episode >= m.max_per_episode and not answering_priority:
            # A reply to a priority request is never blocked by the per-episode cap (The CEO had two route lines to
            # send and three files left, 2026-09-24); the daily cap below still holds.
            return Verdict.no("you already messaged your colleague this episode; do your own research before the next one")
        if ctx.messages_today >= m.max_per_day and not _answering:
            # A reply to an open priority ask is never blocked by the daily cap either: the Package Designer sat behind
            # its cap of 12 for eleven hours with The CEO waiting (2026-09-29).
            return Verdict.no(f"you have sent {ctx.messages_today} messages today, the daily limit; take notes instead")
        return Verdict.ok()

    # -- developer -----------------------------------------------------------

    def resolve_dev_path(self, raw: str) -> Path | None:
        """The absolute path `raw` names under developer.root, or None if it would escape it.

        Absolute paths, `..`, and symlinks are all handled by resolving first and then checking
        containment, so there is no pattern to sneak past: what matters is where it lands.
        """
        if self.developer_root is None:
            return None
        raw = raw.strip() or "."
        if Path(raw).is_absolute():
            return None
        try:
            candidate = (self.developer_root / raw).resolve()
        except (OSError, RuntimeError):
            return None
        if candidate != self.developer_root and self.developer_root not in candidate.parents:
            return None
        return candidate

    def is_protected(self, path: Path) -> bool:
        """True when any component of the path under root is a protected name."""
        if self.developer_root is None:
            return False
        try:
            rel = path.relative_to(self.developer_root)
        except ValueError:
            return True
        protected = {p.strip().lower() for p in self.developer.protected_names}
        return any(part.lower() in protected for part in rel.parts)

    def _check_developer(self, action: Action, ctx: PolicyContext) -> Verdict:
        if not self.developer.enabled or self.developer_root is None:
            return Verdict.no("developer actions are not enabled; that action does not exist")
        if isinstance(action, RunCommand):
            if not self.developer.allow_shell:
                return Verdict.no("running commands is not enabled (developer.allow_shell is off)")
            if not action.argv or not action.argv[0].strip():
                return Verdict.no("run_command needs an argv list with at least a command")
            command = Path(action.argv[0].strip()).name
            allowed = {c.strip() for c in self.developer.allowed_commands}
            if command not in allowed:
                return Verdict.no(f"'{command}' is not an allowed command; allowed: {', '.join(sorted(allowed))}")
            cwd = self.resolve_dev_path(action.cwd)
            if cwd is None:
                return Verdict.no(f"cwd '{action.cwd}' is outside your folder", permanent=True)
            return Verdict.ok()
        target = self.resolve_dev_path(action.path)  # list_files, read_file, write_file
        if target is None:
            return Verdict.no(f"path '{action.path}' is outside your folder", permanent=True)
        if isinstance(action, WriteFile):
            if self.is_protected(target):
                return Verdict.no(f"'{action.path}' is a protected file; you may not change it", permanent=True)
            if len(action.content.encode("utf-8")) > self.developer.max_file_bytes:
                return Verdict.no(f"that file would be larger than {self.developer.max_file_bytes} bytes")
            return Verdict.ok()
        if isinstance(action, ReadFile) and action.offset < 0:
            return Verdict.no("offset must not be negative")
        return Verdict.ok()

    def _check_upgrade(self, action: Action, ctx: PolicyContext) -> Verdict:
        if not (self.developer.enabled and self.developer.upgrade_enabled):
            return Verdict.no("self-upgrade is not enabled; that action does not exist")
        if isinstance(action, Upgrade):
            if not action.goal.strip():
                return Verdict.no("upgrade needs a goal: what you want to change and why")
            if ctx.upgrade_active:
                return Verdict.no("an upgrade is already in progress; test it, submit it, or keep working on it")
            return Verdict.ok()
        if not ctx.upgrade_active:
            return Verdict.no("no upgrade is in progress; start one with upgrade first")
        if isinstance(action, UpgradeTest):
            return Verdict.ok()
        if isinstance(action, UpgradeSubmit):
            if ctx.upgrade_touches_protected:
                names = ", ".join(ctx.upgrade_touches_protected[:5])
                return Verdict.no(f"the change touches protected files ({names}); revert those first", permanent=True)
            if not ctx.upgrade_tests_passed:
                return Verdict.no("run upgrade_test and get a passing result before submitting")
            return Verdict.ok()
        return Verdict.no(f"unknown upgrade action {action.type}")

    # -- desktop -------------------------------------------------------------

    def _allowed_app(self, name: str) -> bool:
        return name.strip().lower() in {a.strip().lower() for a in self.desktop.allowed_apps}

    def _check_desktop(self, action: Action, ctx: PolicyContext) -> Verdict:
        if not self.desktop.enabled:
            return Verdict.no("desktop actions are not enabled; that action does not exist")
        if not ctx.desktop_available:
            return Verdict.no(f"the Mac is not free right now ({ctx.desktop_reason}); stay on the web")
        apps = ", ".join(self.desktop.allowed_apps)
        if isinstance(action, App):
            if not self._allowed_app(action.name):
                return Verdict.no(f"'{action.name}' is not an app you may use; choose one of: {apps}")
            return Verdict.ok()
        if isinstance(action, Look):
            return Verdict.ok()
        view = ctx.desktop_view
        if view is None or not view.ok or view.app is None:
            return Verdict.no("nothing is on your screen yet; use app to bring one of your apps to the front")
        if not self._allowed_app(view.app.name):
            return Verdict.no(
                f"the app in front ('{view.app.name}') is not one you may use; use app to switch to one of: {apps}"
            )
        if isinstance(action, Click):
            el = view.element(action.number)
            if el is None:
                return Verdict.no(f"there is no element [{action.number}] on the screen; look again")
            if not el.enabled:
                return Verdict.no(f"element [{action.number}] is disabled")
            if view.modal and not el.modal:
                return Verdict.no("a dialog is open; click one of its buttons (marked dialog) or press escape first")
            return Verdict.ok()
        if isinstance(action, TypeText):
            if not action.text.strip():
                return Verdict.no("nothing to type")
            if len(action.text) > self.desktop.max_type_chars:
                return Verdict.no(f"type at most {self.desktop.max_type_chars} characters at a time")
            focused = view.element(view.focused) if view.focused else None
            if focused is None or not focused.editable:
                return Verdict.no("nothing editable has keyboard focus; click a text field or text area first")
            if focused.secure:
                return Verdict.no("that is a password field; you never type into those")
            if view.modal and not focused.modal:
                return Verdict.no("a dialog is open; deal with it before typing elsewhere")
            return Verdict.ok()
        if isinstance(action, Hotkey):
            norm = normalize_hotkey(action.combo)
            if norm is None:
                return Verdict.no(f"'{action.combo}' is not a key combination like cmd+n")
            if hotkey_never_allowed(norm):
                return Verdict.no(f"'{norm}' is never allowed")
            allowed = {normalize_hotkey(h) for h in self.desktop.allowed_hotkeys}
            if norm not in allowed:
                return Verdict.no(
                    f"'{norm}' is not an allowed shortcut; allowed: {', '.join(self.desktop.allowed_hotkeys)}"
                )
            return Verdict.ok()
        return Verdict.no(f"unknown desktop action {action.type}")

    # -- helpers -------------------------------------------------------------

    def resolve_target(self, action: Action, ctx: PolicyContext) -> str | None:
        """The URL a navigation action would open, or None for non-navigation actions."""
        if isinstance(action, Open):
            return action.url.strip()
        if isinstance(action, Follow):
            page = ctx.current_page
            if page is None:
                return None
            for link in page.links:
                if link.number == action.link:
                    return link.url
            return None
        return None

    def static_reason(self, url: str, mode: str) -> str | None:
        """Why a URL can never be opened, independent of budgets and timing. None when it is fine."""
        parsed = urlparse(url)
        scheme = parsed.scheme.lower()
        if mode == "fake":
            if scheme != "fake":
                return "only fake:// pages exist in fake mode"
        elif scheme not in ("http", "https"):
            return f"scheme '{scheme or 'none'}' is not allowed; only http and https"
        if scheme in ("http", "https"):
            host = parsed.netloc
            if not host:
                return "URL has no host"
            if not self.cfg.allow_private_networks and is_private_host(host):
                return "private networks and localhost are off limits"
            if self.allowlist is not None and not self.allowlist.allows(parsed.hostname or ""):
                return "that site is not on this bot's allowlist; search the directory or follow links to listed sites"
        return self.denylist.matches(url)

    def check_url(self, url: str, ctx: PolicyContext) -> Verdict:
        parsed = urlparse(url)
        scheme = parsed.scheme.lower()
        reason = self.static_reason(url, ctx.mode)
        if reason:
            return Verdict.no(reason, permanent=True)
        if ctx.pages_last_hour >= self.cfg.pages_per_hour:
            return Verdict.no(f"page budget reached ({self.cfg.pages_per_hour} per hour); rest or take notes instead")
        domain = "fake" if scheme == "fake" else parsed.netloc.lower()
        last = ctx.last_visit_by_domain.get(domain)
        if last is not None and scheme != "fake":
            wait = self.cfg.per_domain_delay_seconds - (ctx.now - last)
            if wait > 0:
                return Verdict.no(f"{domain} was visited {int(ctx.now - last)}s ago; wait {int(wait) + 1}s or pick another site")
        if self.robots is not None and scheme in ("http", "https") and self.cfg.respect_robots:
            if not self.robots.can_fetch(url):
                return Verdict.no(f"{parsed.netloc} asks bots not to read that page (robots.txt)", permanent=True)
        cap = self.cfg.domain_no_progress_cap
        if cap > 0 and scheme in ("http", "https"):
            from .browser import registered_domain

            dom = registered_domain(parsed.netloc)
            n = ctx.domain_visits_no_progress.get(dom, 0)
            if n >= cap:
                span = "today" if self.cfg.domain_no_progress_hours > 0 else "this episode"
                return Verdict.no(
                    f"move on: {n} pages on {dom} {span} and nothing written from it (no lead, update or note). "
                    "This site does not state what you are looking for; leave the cell empty and search for another business",
                    tag="domain_cap",
                )
        return Verdict.ok()

    # -- main entry ----------------------------------------------------------

    GATED_TYPES = frozenset({"lead", "update_lead", "task", "update_task", "publish_package"})

    def _gate(self):
        """The write gate module, loaded once from policy.write_gate; None when off or unloadable."""
        if getattr(self, "_gate_loaded", False):
            return self._gate_module
        self._gate_loaded = True
        self._gate_module = None
        path = (self.cfg.write_gate or "").strip()
        if path:
            try:
                import importlib.util

                spec = importlib.util.spec_from_file_location("fleet_write_gate", Path(path).expanduser())
                module = importlib.util.module_from_spec(spec)  # type: ignore[arg-type]
                spec.loader.exec_module(module)  # type: ignore[union-attr]
                self._gate_module = module if callable(getattr(module, "check", None)) else None
            except Exception as exc:  # noqa: BLE001
                logging.getLogger("explorer.policy").warning("write gate %s could not be loaded (%s); writes are not gated", path, exc)
        return self._gate_module

    JUDGE_SYSTEM = (
        "You check one write by a research bot against one of its owner's rules. Judge only what the context shows. "
        'Answer with one JSON object only, no prose: {"ok": true or false, "why": "<at most 12 words>"}'
    )

    def gate_write(self, action: Action, bot: str = "", min_details: int = 300, *, page_text: str = "",
                   open_tasks: list[str] | None = None, judge: Callable[[str, str], str] | None = None) -> Verdict:
        """The owner's format rules at write time (validator/gate.py). Fails open. With `judge` (a (system, prompt) -> str
        callable) and policy.write_gate_model set, the checker's model-judged questions (gate.questions) are asked too,
        each answered once per content (cached); the verdicts are left in self.last_model_verdicts for the caller's log."""
        self.last_model_verdicts: list[dict] = []
        gate = self._gate() if action.type in self.GATED_TYPES else None
        if gate is None:
            return Verdict.ok()
        started = time.time()
        payload = action.model_dump()
        try:
            reasons = gate.check(action.type, payload, bot=bot, min_details=min_details)
        except Exception as exc:  # noqa: BLE001 - never block the family on a broken checker
            logging.getLogger("explorer.policy").warning("write gate failed on %s (%s); write allowed", action.type, exc)
            return Verdict.ok()
        took = time.time() - started
        if took > 2.0:
            logging.getLogger("explorer.policy").warning("write gate took %.1fs on %s", took, action.type)
        reasons = [str(r) for r in (reasons or []) if str(r).strip()]
        if reasons:
            return Verdict.no("Validator rules: " + "; ".join(reasons)[:700])
        if judge is not None and self.cfg.write_gate_model and callable(getattr(gate, "questions", None)):
            reasons = self._model_questions(gate, action.type, payload, bot, page_text, open_tasks, judge)
            if reasons:
                hint = ""
                if action.type == "task" and any(r.startswith("MG04") for r in reasons) and self.messaging is not None and self.messaging.enabled:
                    # the board is for people; name the way out so the bot does not retry the same task in new words
                    def running(name: str) -> bool:  # a stopped family member's inbox is nowhere to send work
                        folder = self.messaging.folder_for(name)
                        return bool(folder) and not (Path(folder).expanduser() / "workspace" / "STOP").exists()

                    peers = [p for p in self.messaging.peer_names if p.lower() in ("lead gen", "package designer", "scout") and running(p)]
                    if peers:
                        hint = (f" This is family work: hand it over with a `message`, or the same `task` with assignee set to "
                                f"{' or '.join(peers)} (delivered to that family member, not to the board).")
                return Verdict.no("Validator rules: " + "; ".join(reasons)[:700] + hint, tag="write_gate_model")
        return Verdict.ok()

    def _model_questions(self, gate, action_type: str, payload: dict, bot: str, page_text: str,
                         open_tasks: list[str] | None, judge: Callable[[str, str], str]) -> list[str]:
        from .judge import JudgeCache, content_hash, parse_verdict

        log = logging.getLogger("explorer.policy")
        try:
            questions = gate.questions(action_type, payload, bot=bot, page_text=page_text or "", open_tasks=open_tasks) or []
        except Exception as exc:  # noqa: BLE001
            log.warning("write gate questions failed on %s (%s); write allowed", action_type, exc)
            return []
        cache = getattr(self, "_judge_cache", None)
        if cache is None:
            cache = self._judge_cache = JudgeCache(self.cfg.write_gate_model_cache, logger=log)
        reasons: list[str] = []
        for q in questions[:4]:  # never more than four calls for one write
            qid, question, context = str(q.get("id", "?")), str(q.get("question", "")), str(q.get("context", ""))[:2000]
            if not question:
                continue
            key = content_hash(qid, question, context)
            verdict = cache.get(key)
            cached = verdict is not None
            if verdict is None:
                prompt = f"Rule {qid}: {question}\n\n{context}\n\nDoes the write satisfy the rule? Answer only the JSON object."
                try:
                    raw = judge(self.JUDGE_SYSTEM, prompt) or ""
                except Exception as exc:  # noqa: BLE001 - a judge never breaks a write
                    log.warning("write gate judge failed on %s %s (%s); rule not applied", action_type, qid, exc)
                    raw = ""
                verdict = parse_verdict(raw, "ok")
                if verdict is None:
                    self.last_model_verdicts.append({"id": qid, "ok": None, "why": "no judge answered", "cached": False})
                    continue  # fail open on this question
                cache.put(key, verdict)
            ok, why = bool(verdict.get("ok")), str(verdict.get("why", ""))[:120]
            self.last_model_verdicts.append({"id": qid, "ok": ok, "why": why, "cached": cached})
            if not ok:
                reasons.append(f"{qid}: {why or question[:80]}")
        return reasons

    def check(self, action: Action, ctx: PolicyContext, key: str | None = None) -> Verdict:
        if action.type in self.cfg.disabled_actions:
            return Verdict.no(f"{action.type} is not one of your actions; pick another", permanent=True)
        if key and key in ctx.blocked_keys:
            return Verdict.no("that action is blocked for this episode (repeated too often, or refused earlier)")

        budget_left = self.cfg.max_actions_per_episode - ctx.actions_in_episode
        if budget_left <= 0 and action.type != "summarize":
            if -budget_left >= self.cfg.budget_grace_actions:
                return Verdict.no("the episode is over budget; the only action allowed now is summarize", over_budget=True)
            if action.type not in CONSOLIDATION_TYPES:
                return Verdict.no("episode budget used up; summarize now (one last note, ask or say is also fine)")

        # `read` counts too: reading a long article chunk after chunk without noting is the same
        # stall as opening page after page (observed on the first soak runs, unaddressed until now).
        if (action.type in NAVIGATION_TYPES or action.type == "read") and (
            0 < self.cfg.max_pages_without_note <= ctx.pages_since_note
        ):
            return Verdict.no(
                f"you have opened or read {ctx.pages_since_note} pages without noting anything; "
                "note what you learned, or ask a question, before opening or reading another page"
            )

        pr = ctx.priority_request
        grace = self.messaging.priority_request_grace
        if pr and grace > 0 and int(pr.get("actions_since_read") or 0) >= grace and action.type not in DESKTOP_TYPES:
            sender = str(pr.get("sender", "a colleague"))
            answering = isinstance(action, Message) and action.to.strip().lower() == sender.strip().lower()
            if isinstance(action, Message) and not answering:
                # The Validator's FM01 ask reads "Answer The CEO with a `message` now": the message it asks for goes to a
                # third colleague, and refusing it made the ask impossible (Lead Gen, 2026-09-30).
                named = action.to.strip().lower()
                answering = bool(named) and re.search(rf"\banswer\s+{re.escape(named)}\b", str(pr.get("text", "")).lower()) is not None
            if sender.lower() == "owner":  # the owner's chat ask is fulfilled by messaging colleagues, saying, or the work types
                answering = action.type in ("message", "say")
            if not answering and action.type not in PRIORITY_WORK_TYPES:
                return Verdict.no(
                    f"{sender} is waiting for your answer ({pr.get('actions_since_read')} actions since you read it): "
                    f"\"{str(pr.get('text', ''))[:200]}\". Do what it asks -- search, open and read are still allowed for that -- "
                    f"then reply with one `message` to {sender} saying what you did, or why you cannot. Nothing else counts until then."
                )

        if action.type in DESKTOP_TYPES:
            return self._check_desktop(action, ctx)

        if action.type in DEVELOPER_TYPES:
            return self._check_developer(action, ctx)

        if action.type in UPGRADE_TYPES:
            return self._check_upgrade(action, ctx)

        if isinstance(action, Search):
            if not action.query.strip():
                return Verdict.no("search query is empty")
            chosen = (action.engine or "").strip().lower()
            if chosen in ("web", "default", "normal", "none", "searxng"):  # the normal search by another name: told about
                action.engine, chosen = "", ""                           # "engine":"files", the Scout wrote "engine":"web"
            # "files" (the bot's own files: handbook, knowledge, notes) may always be named: every card says "search your
            # files", and the web engine answered those searches first (2026-10-03 audit).
            if chosen and chosen not in ("files", "corpus") and chosen not in [e.lower() for e in self.cfg.search_engines_on_request]:
                if chosen == "tavily":
                    return Verdict.no("you cannot choose the search engine (a special search is The CEO's to run: ask it by message)")
                action.engine, chosen = "", ""  # "general", "duckduckgo": the normal search runs (49 refusals on 2026-10-03)
            if is_meta_topic(action.query):
                return Verdict.no(meta_topic_reason("search"))
            if ctx.search_paused_seconds > 0:
                minutes = int(ctx.search_paused_seconds // 60) + 1
                return Verdict.no(
                    f"searching is paused for {minutes} more minutes: every search engine answered with a rate "
                    "limit or a human check; follow a link from a page you are on, or open a URL you have actually "
                    "seen before. Do not invent URLs: a guessed address is usually a page that does not exist. "
                    "The pause is your tools' problem, not a subject: do not ask, note, or take an interest in it"
                )
            if len(action.query) > 200:
                return Verdict.no("search query is too long")
            if ctx.pages_last_hour >= self.cfg.pages_per_hour:
                return Verdict.no(f"page budget reached ({self.cfg.pages_per_hour} per hour); rest or take notes instead")
            # The same search in new words is the same search: a small model otherwise re-runs one query all episode
            # (Lead Gen ran "Northside small business outdated website" five times in an hour) instead of opening a result.
            q = action.query.strip()
            twin = next((prev for prev in ctx.episode_search_queries if searches_are_twins(q, prev, self.cfg.repeat_search_overlap)), None) \
                if self.cfg.refuse_repeated_searches and not chosen else None  # a chosen special engine may retry the same words
            if twin is not None:
                return Verdict.no(
                    f"you already searched '{twin[:60]}' this episode. Do not search it again in other words: open one of "
                    "its results (follow N), or search for something genuinely different"
                )
            if self.cfg.refuse_repeated_searches and ctx.refused_searches_in_episode >= 3:
                # Lead Gen had 100+ repeat-search refusals in 14 h (2026-09-29): after three, searching is over for the
                # episode -- the results it has are the way forward.
                return Verdict.no(
                    f"{ctx.refused_searches_in_episode} searches were refused this episode: no more searching now. Open one of "
                    "the results you already have (follow N), read it, or summarize"
                )
            return Verdict.ok()

        if action.type in NAVIGATION_TYPES:
            target = self.resolve_target(action, ctx)
            if target is None:
                if isinstance(action, Follow):
                    return Verdict.no(f"there is no link number {action.link} on the current page")
                return Verdict.no("no URL to open")
            if isinstance(action, Open) and self.cfg.open_only_seen_urls and ctx.mode != "fake":
                seen = target in ctx.visited_urls or target.rstrip("/") in ctx.visited_urls or target in ctx.seen_link_urls
                if not seen:
                    key = url_key(target)
                    seen = any(url_key(u) == key for u in ctx.visited_urls) or any(url_key(u) == key for u in ctx.seen_link_urls)
                # A business on the Leads board is no guess: its site is the row's Website (Lead Gen typed
                # https://sunnydeli-example.com from the Validator's upkeep list three times and was refused, 2026-09-26).
                seen = seen or (url_domain(target) in ctx.recent_lead_domains) or (target.rstrip("/") in ctx.seen_link_urls)
                if not seen:
                    return Verdict.no(
                        "open only an address you have actually seen -- on a page's link list this episode, or one you visited "
                        "before. That URL looks typed from memory; a guessed address is usually a dead page. Use follow N "
                        "on the page you are on, or search"
                    )
            return self.check_url(target, ctx)

        if isinstance(action, Note):
            if ctx.refused_notes_in_episode >= 3:
                return Verdict.no(f"{ctx.refused_notes_in_episode} notes were refused this episode (duplicates or no source): no more notes "
                                  "now. Do something different: follow a link, read, message a colleague, or summarize")
            if not action.title.strip() or not action.body.strip():
                return Verdict.no("a note needs a title and a body")
            if is_meta_topic(action.title):
                return Verdict.no(meta_topic_reason("note"))
            # corpus:// is the owner's own folder (corpus.py): a real source, just not on the web.
            if action.source_url and ctx.mode == "web" and not action.source_url.startswith(("http://", "https://", "corpus://")):
                if not re.fullmatch(r"[A-Za-z/._ -]{1,20}", action.source_url.strip()):  # another scheme (file:, internal://) is still refused
                    return Verdict.no("source_url must be an http(s) URL, or the corpus:// page of your own files; leave it empty for your own reasoning")
                action.source_url = ""  # "internal", "N/A", "self": the bot's own reasoning, saved without a source
            if action.title.strip().lower() in ctx.episode_note_titles:
                return Verdict.no(
                    f"you already saved a note titled '{action.title.strip()[:60]}' this episode; "
                    "add new information under a different title, or move on"
                )
            if action.title.strip().lower() in ctx.recent_note_titles:
                return Verdict.no(
                    f"you already saved a note titled '{action.title.strip()[:60]}' in the last few days; "
                    "it exists, do not save it again. Note something new, or move on",
                    permanent=True,
                )
            # The same fact in new words is still the same note (the Scout saved "Speka has a free tier" five ways).
            twin = next((t for t in ctx.recent_note_titles | ctx.episode_note_titles if notes_are_twins(action.title, t)), None)
            if twin:
                return Verdict.no(
                    f"that is the note you already have as '{twin[:60]}'; do not save the same finding in new words. "
                    "Read on and note only what is new",
                    permanent=True,
                )
            if 0 < self.cfg.max_notes_per_episode <= ctx.notes_in_episode:
                return Verdict.no(
                    "you have saved your note for this episode; read on -- the value of your work is in what you read, "
                    "not in how much you write. Summarize when you are done"
                )
            if 0 < self.cfg.max_notes_per_day <= ctx.notes_today:
                return Verdict.no(f"you have saved {ctx.notes_today} notes today, the daily cap; keep reading and rest")
            return Verdict.ok()

        if isinstance(action, Ask):
            if not action.question.strip():
                return Verdict.no("question is empty")
            limit = self.cfg.max_refused_asks_per_episode
            if limit > 0 and ctx.refused_asks_in_episode >= limit:
                return Verdict.no(
                    f"{ctx.refused_asks_in_episode} of your questions were already refused this episode, so asking is "
                    "closed until the next one. Read on, note what you have found, or summarize"
                )
            if is_meta_topic(action.question):
                return Verdict.no(meta_topic_reason("question"))
            if ctx.open_questions >= self.cfg.max_open_questions:
                return Verdict.no("too many open questions; answer or summarize before asking more")
            if ctx.questions_in_episode >= self.cfg.max_questions_per_episode:
                return Verdict.no(
                    f"you already asked {ctx.questions_in_episode} questions this episode; "
                    "pursue one of them, note what you learned, or summarize instead of asking more"
                )
            for existing in ctx.open_question_texts:
                if questions_are_similar(action.question, existing):
                    return Verdict.no(
                        f"you already have that question open: '{existing[:110]}'. "
                        "Pursue it, or ask about something genuinely different"
                    )
            return Verdict.ok()

        if isinstance(action, Interest):
            if not action.topic.strip():
                return Verdict.no("interest topic is empty")
            if is_meta_topic(action.topic):
                return Verdict.no(meta_topic_reason("interest"))
            if not -1.0 <= action.delta <= 1.0:
                return Verdict.no("interest delta must be between -1 and 1")
            return Verdict.ok()

        if isinstance(action, Rest):
            if action.seconds < 1:
                return Verdict.no("rest needs at least 1 second")
            if action.seconds > self.cfg.max_rest_seconds:
                return Verdict.no(f"rest is capped at {self.cfg.max_rest_seconds} seconds")
            return Verdict.ok()

        if isinstance(action, Say):
            if not action.text.strip():
                return Verdict.no("say needs some text")
            if len(action.text) > 1000:
                return Verdict.no("keep messages under 1000 characters")
            if action.to == "partner":
                if not self.chat_partner.enabled:
                    return Verdict.no("there is no AI partner to talk to right now")
                name = self.chat_partner.name
                if ctx.partner_turns_since_note >= self.chat_partner.max_turns_before_note:
                    return Verdict.no(
                        f"you have exchanged {ctx.partner_turns_since_note} messages with {name} without "
                        "noting anything; take a note on what you learned before continuing that conversation"
                    )
                if ctx.partner_turns_in_episode >= self.chat_partner.max_turns_per_episode:
                    return Verdict.no(
                        f"you have already exchanged {ctx.partner_turns_in_episode} messages with {name} this "
                        "episode; note what you learned, or move on to something else"
                    )
                return Verdict.ok()
            if ctx.says_in_episode >= self.cfg.max_says_per_episode:
                return Verdict.no(
                    f"you already sent {ctx.says_in_episode} messages this episode; say is for your owner, "
                    "not for narrating, so only use it again when you have something new for them"
                )
            if 0 < self.cfg.max_says_per_day <= ctx.says_today and not ctx.owner_wrote:
                return Verdict.no(
                    f"the owner wants {self.cfg.max_says_per_day} message{'s' if self.cfg.max_says_per_day != 1 else ''} "
                    f"a day from you and has had {ctx.says_today} today: a short list of what happened and what is next. "
                    "Keep working; tomorrow's message is where this goes (a reply to something the owner writes is always allowed)"
                )
            return Verdict.ok()

        if isinstance(action, Task):
            if not self.notion.enabled:
                return Verdict.no("creating tasks is not enabled; that action does not exist")
            if ctx.refused_tasks_in_episode >= 3:
                return Verdict.no(f"{ctx.refused_tasks_in_episode} tasks were refused this episode (the same task in other words): no more "
                                  "tasks now. Do something different: research, message a colleague, or summarize")
            title = action.title.strip()
            if not title or not action.details.strip():
                return Verdict.no("a task needs a title and details (why it matters, what done looks like)")
            if len(title) > 200:
                return Verdict.no("keep the task title under 200 characters")
            if len(action.details) > 4000:
                return Verdict.no("keep the task details under 4000 characters")
            if 0 < self.notion.min_details_chars > len(action.details.strip()):
                return Verdict.no(
                    "that task's details are too thin. Write a full brief a person could act on without asking "
                    "you: the context (why now), the concrete steps, the specifics from your notes (names, "
                    f"numbers, examples, sources), and what 'done' looks like -- at least {self.notion.min_details_chars} "
                    "characters. Fewer, richer tasks: put the depth here"
                )
            # Owner, 2026-09-28: "let ceoA assign task to any one or no one" -- a name Notion cannot resolve is left
            # unassigned with a warning (notion._set_assignee); a family member's name hands the task to that bot.
            if action.assignee and self._is_peer(action.assignee):
                folder = self.messaging.folder_for(action.assignee.strip())
                if folder and (Path(folder).expanduser() / "workspace" / "STOP").exists():
                    # a task for a stopped member sat unread in its inbox and stayed an open ask for days
                    return Verdict.no(f"{action.assignee.strip()} is stopped (its STOP file is present); nobody would read that task. "
                                      "Do the work yourself if your actions allow it, give it to a family member who is running, or leave it.")
                # The CEO handed "update the Fixed-Price MVP toggle title" to the Package Designer eight times in two
                # hours (2026-09-29): a task for a colleague is an ask, and an open ask is not asked again in other words.
                from .fleet_requests import same_ask

                peer = action.assignee.strip().lower()
                for to, asks in (ctx.open_asks_to or {}).items():
                    if to.strip().lower() != peer:
                        continue
                    for text, _sent_at in asks:  # (text, sent_at), keyed by the lower-cased peer name (controller._open_asks_to)
                        body = str(text).split("\n", 1)[0].removeprefix("task for you:").strip()
                        if same_ask(title, body) or title.lower() in text.lower():
                            return Verdict.no(
                                f"you already handed {action.assignee.strip()} that task and it is still open ('{body[:70]}'); "
                                "they see it every cycle. Wait for their answer, or do the part that is yours"
                            )
            if not valid_date(action.due):
                return Verdict.no("due must be a date like 2026-09-30, or null")
            if action.due and action.due.strip() and action.due.strip() < time.strftime("%Y-%m-%d"):
                return Verdict.no(f"due {action.due.strip()} is in the past; a Dead Line is today or later")
            if re.match(r"\s*outreach:", title, re.I) and any(re.match(r"\s*outreach:", t, re.I) for t in ctx.task_titles_today):
                # eight outreach tasks in seven hours on 2026-10-03, two of them for one new lead each: a batch is a day's leads
                return Verdict.no("one outreach batch a day: today's exists. Add newly listed leads to it with update_task "
                                  "(details_append), or leave them for tomorrow's batch", permanent=True)
            if not valid_priority(action.priority):
                return Verdict.no("priority must be P0 to P6 (P0 only for work genuinely being done this week)")
            if title.lower() in ctx.recent_task_titles:
                return Verdict.no(
                    f"you already created a task titled '{title[:60]}' recently; it exists, do not create it again",
                    permanent=True,
                )
            from .fleet_requests import same_ask

            def batch_head(t: str) -> str:  # "Outreach: Noodle Bar One and 9 more" -> "noodlebarone": one batch per first business
                m = re.match(r"\s*outreach:\s*(.+?)(?:\s+and\s+\d+\s+more.*)?$", t, re.I)
                return m.group(1).strip().lower() if m else ""

            head = batch_head(title)
            twin = next((t for t in ctx.recent_task_titles
                         if (batch_head(t) == head if head and batch_head(t) else same_ask(title, t))), None)
            if twin is not None:  # "Compile <city> biotech target list" twice in an hour (2026-09-26): a rewording is the same task
                return Verdict.no(
                    f"that is the task you already created as '{twin[:200]}', in other words; add to it with update_task (that exact title) or move on",
                    permanent=True,
                )
            if ctx.tasks_in_episode >= self.notion.max_tasks_per_episode:
                return Verdict.no(
                    "you already created a task this episode; one well-thought task beats several. "
                    "Note anything else as 'Possible task: ...' and decide next time"
                )
            if ctx.tasks_today >= self.notion.max_tasks_per_day:
                return Verdict.no(
                    f"you have created {ctx.tasks_today} tasks today, the daily limit; take notes instead"
                )
            return Verdict.ok()

        if isinstance(action, UpdateTask):
            return self._check_update_task(action, ctx)

        if isinstance(action, Lead):
            return self._check_lead(action, ctx)

        if isinstance(action, UpdateLead):
            return self._check_update_lead(action, ctx)

        if isinstance(action, Package):
            return self._check_package(action, ctx)

        if isinstance(action, Provider):
            return self._check_provider(action, ctx)

        if isinstance(action, Message):
            return self._check_message(action, ctx)

        if isinstance(action, ReviseGoal):
            return self._check_revise_goal(action, ctx)
        if isinstance(action, Plan):
            return self._check_plan(action, ctx)

        if isinstance(action, ProposeTeammate):
            return self._check_propose_teammate(action, ctx)

        if isinstance(action, PublishPackage):
            return self._check_publish_package(action, ctx)

        if isinstance(action, Publish):
            if not self.publish.enabled:
                return Verdict.no("publishing is disabled")
            if action.destination not in self.publish.destinations:
                return Verdict.no(f"destination '{action.destination}' is not enabled")
            if not action.title.strip() or not action.body.strip():
                return Verdict.no("a post needs a title and a body")
            if is_meta_topic(action.title):
                return Verdict.no(meta_topic_reason("post"))
            if len(action.body) > 20000:
                return Verdict.no("keep a post under 20000 characters")
            if ctx.posts_today >= self.publish.max_posts_per_day:
                return Verdict.no(
                    f"you have published {ctx.posts_today} posts today, the daily limit; keep notes and post tomorrow"
                )
            return Verdict.ok()

        if isinstance(action, Summarize):
            if ctx.actions_in_episode == 0:
                return Verdict.no("nothing to summarize yet; explore first")
            return Verdict.ok()

        # read, back
        if action.type in ("read", "back") and ctx.current_page is None:
            return Verdict.no("no page is open")
        return Verdict.ok()
