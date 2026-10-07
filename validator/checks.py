"""The Validator's built-in checks: pure functions from an artefact plus the enabled rules to a list of
flags. Each check is keyed to a rule id; a rule id absent from the instructions file is not enforced.
No I/O here, so it is unit-tested without Notion.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import re
from dataclasses import dataclass, field
from pathlib import Path

from sources import (LeadRow, PackageFile, PackageToggle, ProviderRecord, TaskRow, domain, is_search_results_url,
                     norm_title)

# ---- rules and flags --------------------------------------------------------------

_RULE_LINE = re.compile(r"^\s*-\s+([A-Z]{1,3}\d{2})\s*[—–:-]\s*(.+?)\s*(\[warn\])?\s*$")


@dataclass
class Rule:
    id: str
    text: str
    bot: str            # slug of the instructions file it came from
    severity: str       # "error" | "warn"

    @property
    def short(self) -> str:
        """The first sentence, for a message to a bot."""
        first = re.split(r"(?<=[.!?])\s", self.text.strip(), maxsplit=1)[0]
        return first[:160]


@dataclass
class Instructions:
    rules: dict[str, Rule] = field(default_factory=dict)
    questions: dict[str, list[str]] = field(default_factory=dict)   # bot -> model-judged questions
    write_questions: list[tuple[str, str, str, str]] = field(default_factory=list)   # (id, action, question, bot): gate 3
    digest: str = ""
    files: list[str] = field(default_factory=list)


TARGET = Path.home() / "bots" / "common-data" / "knowledge" / "target.toml"


def target() -> dict[str, str]:
    """The family's current market (owner, 2026-09-30: "it should be said in task and goals, not in code"). One file,
    common-data/knowledge/target.toml; rule text uses {market}, {market_short}, {segment}, {trades}, {areas}."""
    import tomllib
    try:
        return {k: str(v) for k, v in tomllib.loads(TARGET.read_text(encoding="utf-8")).items()}
    except (OSError, ValueError):
        return {}


def market_words() -> set[str]:
    t = target()
    return {w for w in re.findall(r"[a-z0-9]+", f"{t.get('market', '')} {t.get('market_short', '')}".lower()) if w}


# "- MG01 [task] — question" in a "## Model-judged at write time" section
_WRITE_Q = re.compile(r"^-\s*(MG\d+)\s*\[([a-z_]+)\]\s*[—-]+\s*(.+)$")


def load_instructions(folder: Path) -> Instructions:
    ins = Instructions()
    h = hashlib.sha256()
    for path in sorted(folder.glob("*.md")):
        if path.name.lower() == "readme.md":
            continue
        bot = path.stem
        text = path.read_text(encoding="utf-8")
        for k, v in target().items():
            text = text.replace("{" + k + "}", v)
        h.update(path.name.encode())
        h.update(text.encode())
        ins.files.append(path.name)
        section = ""
        for line in text.splitlines():
            if line.startswith("## "):
                section = line[3:].strip().lower()
                continue
            m = _RULE_LINE.match(line)
            if m:
                rid, body, warn = m.group(1), m.group(2), m.group(3)
                ins.rules[rid] = Rule(rid, body, bot, "warn" if warn else "error")
            elif section.startswith("model-judged at write time") and line.strip().startswith("- "):
                m2 = _WRITE_Q.match(line.strip())
                if m2:
                    ins.write_questions.append((m2.group(1), m2.group(2), m2.group(3).strip(), bot))
            elif section.startswith("model-judged") and line.strip().startswith("- "):
                ins.questions.setdefault(bot, []).append(line.strip()[2:].strip())
    ins.digest = h.hexdigest()[:16]
    return ins


@dataclass
class Flag:
    rule: str
    bot: str            # who should fix it: a bot slug, or "owner"
    kind: str           # task | package | package_file | provider
    artifact: str       # stable id of the item
    label: str          # human label of the item
    url: str
    text: str           # the rule text (what is required)
    detail: str         # what was found
    severity: str
    when: str = ""      # the artefact's date (YYYY-MM-DD) when known; "" = current
    name: str = ""      # the exact title / package name, for a fix instruction the bot can act on

    @property
    def fingerprint(self) -> str:
        return hashlib.sha1(f"{self.kind}|{self.artifact}|{self.rule}".encode()).hexdigest()[:16]


class Checker:
    def __init__(self, ins: Instructions):
        self.rules = ins.rules

    def flag(self, rid: str, kind: str, artifact: str, label: str, url: str, detail: str, bot: str | None = None,
             when: str = "", name: str = "") -> Flag | None:
        rule = self.rules.get(rid)
        if rule is None:
            return None
        return Flag(rid, bot or rule.bot, kind, artifact, label, url, rule.text, detail, rule.severity, when, name)


def _collect(*flags: Flag | None) -> list[Flag]:
    return [f for f in flags if f is not None]


# ---- prompt injection (FM07) ----------------------------------------------------------

_INJECTION = re.compile(
    r"\b(?:ignore|disregard|forget|override)\s+(?:all\s+|any\s+|your\s+|the\s+|previous\s+|prior\s+|above\s+)*"
    r"(?:rules?|instructions?|guidelines?|prompts?|polic(?:y|ies)|guardrails?)\b"
    r"|\byou\s+are\s+now\s+(?:a|an|in)\b|\bnew\s+instructions?\s*:|\bsystem\s+prompt\b|\bjailbreak\b"
    r"|\b(?:email|e-mail|message|contact)\s+(?:this|the\s+following|everyone\s+on\s+this)\s+(?:list|contacts?|people|addresses)\b"
    r"|\bsend\s+(?:this|it|the\s+(?:list|data|leads?|keys?|file))\s+to\s+\S+@\S+"
    r"|\b(?:reveal|print|share|send|email)\s+(?:your|the|all|our)\s+(?:\w+\s+){0,8}?(?:api\s+)?(?:keys?|tokens?|passwords?|credentials)\b"
    r"|\b(?:email|send|forward|share)\s+(?:your|our|the|all)\s+(?:full\s+|whole\s+|entire\s+)?(?:list\s+of\s+)?(?:leads|contacts|clients|customers)\s+(?:list\s+)?to\b"
    r"|\bstop\s+following\s+(?:your|their|the|our)\s+rules\b"
    r"|\b(?:official\s+)?instructions?\s+from\s+(?:your|the)\s+owner\b"
    r"|\bnote\s+to\s+(?:ai|llm|bots?|agents?)\b"
    r"|\b(?:send|write)\s+(?:a\s+message\s+)?to\s+every\s+(?:colleague|bot|agent|family\s+member)",
    re.I)


def injection(text: str) -> str:
    """The phrase in a bot's output that reads like an instruction lifted from a page (FM07), or ""."""
    m = _INJECTION.search(text or "")
    return m.group(0) if m else ""


# ---- tasks (T) ---------------------------------------------------------------------

BARE_TITLES = {
    "fixes", "fix", "deploy", "qa", "ad", "ads", "outreach", "design", "box design", "update", "research",
    "test", "testing", "bug", "bugs", "meeting", "call", "email", "content", "seo", "misc", "todo", "plan",
}
STATUS_VOCAB = ["Not started", "In progress", "Blocker", "In Review", "QA", "Done", "Archived", "Dublicate", "Not Fisible"]   # the board's own options, spelling as the owner made them
_PRIORITY = re.compile(r"^P[0-6]$")
_DONE_WORDS = re.compile(r"\b(done|acceptance|accepted when|definition of done|complete when|deliverables?)\b", re.I)
_DONE_HEADING = re.compile(r"^(done when|acceptance criteria|acceptance|definition of done|what done looks like|done looks like)\b", re.I)
_LIST_TYPES = {"bulleted_list_item", "numbered_list_item", "paragraph", "to_do"}


def done_section(blocks: list[tuple[str, str, bool]]) -> tuple[bool, list[str]]:
    """(found, item block types) for the acceptance-criteria section: a heading (or bold one-liner)
    matching "Done when"/"Acceptance ..." and the list items that follow it up to the next heading."""
    for i, (kind, text, bold) in enumerate(blocks):
        heading = kind.startswith("heading") or (bold and kind == "paragraph" and len(text) <= 60)
        if heading and _DONE_HEADING.match(text.strip().rstrip(":")):
            items: list[str] = []
            for k, t, b in blocks[i + 1:]:
                if k.startswith("heading") or (b and k == "paragraph" and len(t) <= 60):
                    break
                if k in _LIST_TYPES:
                    items.append(k)
            return True, items
    return False, []


_COMMIT = re.compile(
    r"\b(sign (a|the) (contract|agreement|nda)|hire (a|an|two|three|four|five|new) |"
    r"commit(s|ted)? (the company|us) to|guarantee[sd]? (a|the) (price|deadline|delivery))\b", re.I)


def check_task(
    ck: Checker, t: TaskRow, *, team: dict[str, str], min_details: int, duplicate_of: list[str], bot: str,
) -> list[Flag]:
    """`bot` is who answers for this row (the CEO for rows it created, else "owner")."""
    f = lambda rid, detail: ck.flag(rid, "task", t.page_id, t.label, t.url, detail, bot=bot, when=t.created[:10], name=t.title)  # noqa: E731
    out: list[Flag] = []
    title = t.title.strip()
    hit = injection(f"{t.title}\n{t.body}")
    if hit:
        out += _collect(f("FM07", f"repeats a page's instruction: '{hit[:60]}'"))
    words = [w for w in re.split(r"\s+", title) if w]
    if not title:
        out += _collect(f("T01", "the row has no title"))
    elif title.lower() in BARE_TITLES or len(words) < 4 or len(title) < 20 or title.lower().startswith("possible task"):
        out += _collect(f("T01", f"title is '{title[:60]}' ({len(words)} words)"))
    if not t.status:
        out += _collect(f("T02", "Status is empty"))
    elif t.status not in STATUS_VOCAB:
        out += _collect(f("T02", f"Status is '{t.status}', not in the board vocabulary"))
    if len(t.assignee_ids) != 1:
        out += _collect(f("T03", "no assignee" if not t.assignee_ids else f"{len(t.assignee_ids)} people assigned"))
    elif team and t.assignee_ids[0] not in team:
        out += _collect(f("T03", f"assigned to '{t.assignee_names[0] or t.assignee_ids[0]}', who is not on the team list"))
    if not t.due:
        out += _collect(f("T04", "Dead Line is empty"))
    if not t.priority:
        out += _collect(f("T05", "Priority is empty"))
    elif not _PRIORITY.match(t.priority.strip().upper()):
        out += _collect(f("T05", f"Priority is '{t.priority}'"))
    body = t.body.strip()
    if min_details > 0 and len(body) < min_details:
        out += _collect(f("T06", f"details are {len(body)} characters (minimum {min_details})"))
    if body:
        found, items = done_section(t.blocks)
        if not found:
            if t.blocks or not _DONE_WORDS.search(body):
                out += _collect(f("T07", "no 'Done when' section" + ("" if t.blocks or not body else " or sentence saying what 'done' looks like")))
        elif not items or any(k != "to_do" for k in items):
            kinds = ", ".join(sorted({k.replace("_list_item", "") for k in items})) or "nothing"
            out += _collect(f("T12", f"'Done when' items are {kinds}, not a to-do checklist"))
    if not t.project_ids:
        out += _collect(f("T08", "Projects relation is empty"))
    if duplicate_of:
        out += _collect(f("T09", "same title as " + ", ".join(duplicate_of[:3])))
    m = _COMMIT.search(f"{title}\n{body}")
    if m:
        out += _collect(f("T10", f"contains '{m.group(0)}'"))
    if t.due and t.created:
        try:
            due_d = dt.date.fromisoformat(t.due[:10])
            created_d = dt.date.fromisoformat(t.created[:10])
            if due_d < created_d:
                out += _collect(f("T11", f"Dead Line {t.due[:10]} is before the creation date {t.created[:10]}"))
        except ValueError:
            pass
    return out


# ---- packages page toggles (PK: the CEO's wrapper; PS: the Package Designer's sources) ----

_PRICE_FIG = re.compile(r"(\$|usd)\s?\d", re.I)
_DOLLARS = re.compile(r"\$\s?\d[\d,]*(?:\.\d+)?(?:[kKmM]\b)?")
# Figures every pitch may carry although no package record has them (a portfolio line, say): never counted as an
# invented price. Set from [validator] package_allowed_figures.
PROOF_FIGURES: set[str] = set()
# The exact last lines of a pitch, e.g. ["Regards,", "-- Your Company"]. Set from [validator] package_signoff;
# empty = the sign-off is not checked (PK05).
SIGNOFF: list[str] = []
_GREETING = re.compile(r"^(hi|hello|dear|good (morning|afternoon|evening)|hey)\b", re.I)
_NUMBERED = re.compile(r"^\s*\d+[.)]\s+\S", re.M)
_VERSION_TAG = re.compile(r"\b(v\d+|version\s*\d+)\b", re.I)


def check_package_toggle(ck: Checker, p: PackageToggle, *, own_domains: list[str]) -> list[Flag]:
    made = re.search(r"\d{4}-\d{2}-\d{2}", p.extra.get("Created", ""))
    f = lambda rid, detail: ck.flag(rid, "package", p.block_id, p.label, p.page_url, detail, when=made.group(0) if made else "",  # noqa: E731
                                    name=p.title.split(" — ", 1)[0].strip())
    out: list[Flag] = []
    email = p.email.strip()
    first = next((ln.strip() for ln in email.splitlines() if ln.strip()), "")
    if not _PRICE_FIG.search(p.title):
        out += _collect(f("PK01", "no price figure in the toggle title"))
    if not email:
        out += _collect(f("PK02", "no email pitch under the toggle"))
    elif not _GREETING.match(first):
        out += _collect(f("PK02", f"opens with '{first[:60]}'"))
    n_items = len(_NUMBERED.findall(email))
    if email and not 2 <= n_items <= 6:
        out += _collect(f("PK03", f"{n_items} numbered deliverables"))
    tail = [ln.strip() for ln in email.splitlines() if ln.strip()][-len(SIGNOFF):] if SIGNOFF else []
    if email and SIGNOFF and tail != SIGNOFF:
        out += _collect(f("PK05", "sign-off is '" + " / ".join(tail)[:80] + "', not exactly '" + "' / '".join(SIGNOFF) + "'"))
    if not p.conclusion.strip():
        out += _collect(f("PK07", "no Conclusion section"))
    # Every dollar figure the pitch quotes must be the package's own price (title or price line): the CEO wrote
    # "$2,500 setup, $500/month" into a package whose price is "quoted per deployment" (2026-09-25).
    quoted = {m.replace(" ", "").rstrip(",.") for m in _DOLLARS.findall(email)}
    allowed_src = f"{p.title} {p.extra.get('Price and timeline', '')} {p.extra.get('What is included', '')}"
    allowed = {m.replace(" ", "").rstrip(",.") for m in _DOLLARS.findall(allowed_src)} | PROOF_FIGURES
    stray = sorted(q for q in quoted if q.lower() not in {a.lower() for a in allowed})
    if email and stray:
        out += _collect(f("PK12", "the pitch quotes " + ", ".join(stray[:4]) + " which is not the package's price"))
    if not re.search(r"Created \d{4}-\d{2}-\d{2}", p.extra.get("Created", "")):
        out += _collect(f("PK11", "no 'Created <date>' line at the top of the toggle"))
    out += _source_checks(f, "PS", p.sources, p.company, own_domains)
    if _VERSION_TAG.search(p.title):
        out += _collect(f("PS06", f"title has a version tag: '{_VERSION_TAG.search(p.title).group(0)}'"))
    return out


def _source_checks(f, prefix: str, sources: list[str], company: dict[str, str], own_domains: list[str]) -> list[Flag]:
    """Shared by the toggle (PS) and the package file (PD): sources present, none a search page, none
    our own site, company name + website present, website among the sources."""
    ids = {"PS": ("PS01", "PS02", "PS03", "PS04", "PS05"), "PD": ("PD04", "PD04", "PD05", "PD06", "PD07")}[prefix]
    r_present, r_search, r_own, r_company, r_site = ids
    out: list[Flag] = []
    own = {d.strip().lower().removeprefix("www.") for d in own_domains if d.strip()}
    if not sources:
        out += _collect(f(r_present, "no sources listed"))
    searchy = [s for s in sources if is_search_results_url(s)]
    if searchy:
        out += _collect(f(r_search, "search-results page cited: " + ", ".join(s[:70] for s in searchy[:2])))
    ours = [s for s in sources if domain(s) in own or any(domain(s).endswith("." + d) for d in own)]
    if ours:
        out += _collect(f(r_own, "our own site cited: " + ", ".join(s[:60] for s in ours[:2])))
    facts = {k.strip().lower(): v for k, v in company.items()}
    name = facts.get("company") or facts.get("name") or ""
    site = facts.get("website") or ""
    if not name or not site:
        missing = [k for k, v in (("name", name), ("website", site)) if not v]
        out += _collect(f(r_company, "source company " + " and ".join(missing) + " missing"))
    elif sources and domain(site) and domain(site) not in {domain(s) for s in sources}:
        out += _collect(f(r_site, f"website {domain(site)} is not among the sources"))
    return out


# ---- package files (PD) ------------------------------------------------------------

def check_package_file(ck: Checker, p: PackageFile, *, own_domains: list[str]) -> list[Flag]:
    f = lambda rid, detail: ck.flag(rid, "package_file", p.key, p.label, str(p.path), detail, when=p.key[:10], name=p.name)  # noqa: E731
    out: list[Flag] = []
    m = _VERSION_TAG.search(p.name)
    if m:
        out += _collect(f("PD01", f"name has a version tag: '{m.group(0)}'"))
    if not any(ch.isdigit() for ch in p.price):
        out += _collect(f("PD02", f"price is '{p.price[:40]}'"))
    if not 2 <= len(p.deliverables) <= 6:
        out += _collect(f("PD03", f"{len(p.deliverables)} deliverables"))
    out += _source_checks(f, "PD", p.sources, p.company, own_domains)
    return out


# ---- provider records (SC) -----------------------------------------------------------

KNOWN_PROVIDERS = [
    "groq", "gemini", "google ai studio", "cerebras", "mistral", "sambanova", "openrouter", "together",
    "deepseek", "openai", "moonshot", "kimi", "replicate",
]
_NICHE = re.compile(
    r"\b(role-?play|storytelling|image[- ]only|images? only|text-to-speech|speech[- ]only|"
    r"embeddings?[- ]only|voice[- ]only)\b", re.I)
_TRIAL = re.compile(
    r"\b(trial credits?|free credits?|\$\d+ (in )?(free )?credits?|\$\d+ free to start|one-?time credit|"
    r"pay[- ]as[- ]you[- ]go)\b", re.I)
_LISTICLE = re.compile(r"(awesome|free-llm|top-\d|best-free|blog/)", re.I)


def check_provider(ck: Checker, r: ProviderRecord, *, fleet_has: list[str] | None = None) -> list[Flag]:
    f = lambda rid, detail: ck.flag(rid, "provider", r.key, r.label, r.endpoint, detail, when=r.found)  # noqa: E731
    out: list[Flag] = []
    ep = r.endpoint.strip()
    if r.is_tool:
        ep = r.website.strip()      # a tool is judged on its own site; SC01 (an OpenAI-compatible endpoint) is for model providers
    elif not ep.startswith("https://"):
        out += _collect(f("SC01", f"endpoint is '{ep[:60] or '(empty)'}'"))
    elif domain(ep) in ("aistudio.google.com", "console.groq.com", "platform.openai.com", "github.com"):
        out += _collect(f("SC01", f"endpoint is a console/marketing page: {ep[:60]}"))
    terms = r.free_terms.strip()
    if not terms:
        out += _collect(f("SC02", "free terms are empty"))
    elif "no card" not in terms.lower():
        out += _collect(f("SC02", "free terms do not say 'no card required'"))
    known = [] if r.is_tool else [k for k in (fleet_has or KNOWN_PROVIDERS) if k in r.name.lower()]
    if known:
        out += _collect(f("SC03", f"'{r.name}' is a provider the fleet already knows ({known[0]})"))
    text = f"{r.free_terms} {r.why} {r.models}"
    m = None if r.is_tool else _NICHE.search(text)
    if m:
        out += _collect(f("SC04", f"niche service: '{m.group(0)}'"))
    if not r.sources:
        out += _collect(f("SC05", "no sources listed"))
    else:
        ep_dom = domain(ep)
        root = ".".join(ep_dom.split(".")[-2:]) if ep_dom else ""
        own_site = [s for s in r.sources if root and root in domain(s)]
        if not own_site:
            out += _collect(f("SC06", "sources are third-party pages only: " + ", ".join(s[:60] for s in r.sources[:2])))
    m = _TRIAL.search(text)
    if m:
        out += _collect(f("SC07", f"not a durable free tier: '{m.group(0)}'"))
    return out


# ---- leads (LD) --------------------------------------------------------------------------

PERSONAL_MAILBOXES = {
    "gmail.com", "googlemail.com", "yahoo.com", "ymail.com", "hotmail.com", "outlook.com", "live.com", "msn.com",
    "icloud.com", "me.com", "mac.com", "proton.me", "protonmail.com", "pm.me", "aol.com", "gmx.com", "gmx.net",
    "mail.com", "zoho.com", "yandex.com", "fastmail.com", "hey.com", "duck.com",
}
JOB_BOARDS = ("greenhouse.io", "lever.co", "workable.com", "ashbyhq.com", "bamboohr.com", "breezy.hr",
              "jobs.smartrecruiters.com", "myworkdayjobs.com", "wellfound.com", "linkedin.com")
_PHONE = re.compile(r"(\+?\d[\d\s().-]{8,}\d)")
# "Found by" holds a short source label ("Lead Gen", "owner's list", "enrich_leads.py"), not a sentence: the
# owner reads that column as a name. How an address was checked belongs in Source pages (owner, 2026-09-24).
FOUND_BY_MAX = 40
# Location reads "City, State, Country" -- "Springfield, IL, USA". The board arrived holding bare
# countries ("USA", "UK", "USA / Canada") and one full street address, neither of which says where a business is
# in a way the owner can sort or hand to the team.
# Company size is a size: "40 staff", "~400 locations", "50-200 employees" -- or blank when their pages do not say
# (owner, 2026-09-24, finding the column full of descriptions like "Fast-casual chicken salad chain; multi-unit
# area development"). What the business does belongs in Industry, what is wrong in Pain point.
COMPANY_SIZE_MAX = 60
# Sites that list businesses but are not one: a row whose "website" is a directory or an association carries the
# directory's email, not the business's.
DIRECTORY_SITES = ("thebfa.org", "franchiseoverview.com", "franchisedirect.com", "franchising.com", "franchisegator.com",
                   "franchiseopportunities.com", "linkedin.com", "facebook.com", "instagram.com", "yelp.com",
                   "crunchbase.com", "clutch.co", "goodfirms.co", "indeed.com", "glassdoor.com", "wikipedia.org")
# Mailboxes that exist for something other than buying: writing to press@ about POS is a wasted send.
NOT_A_SALES_CONTACT = {"press", "media", "pr", "marketing", "careers", "jobs", "legal", "privacy", "abuse", "security",
                       "webmaster", "postmaster", "noreply", "no-reply", "unsubscribe", "newsletter"}
# A size is a count and its unit, once or twice ("~11 locations, 120 staff"). A description that happens to carry
# a number is not ("~400 acai/smoothie shops; multi-unit deals ongoing"), so the number and the unit have to sit
# together with nothing else between them.
_SIZE_UNIT = r"(?:locations?|stores?|shops?|outlets?|sites?|units?|branches|restaurants?|staff|employees?|people|team members?|franchisees?|franchises?)"
_SIZE_PART = re.compile(rf"^(?:about|approx\.?|around|over|under|up to|~|<|>)?\s*\d[\d,.\s]*(?:[-–—+]\s*\d[\d,.]*)?\s*\+?\s*{_SIZE_UNIT}$", re.I)
# A founder is a person: at least two capitalised words, or two names joined by & / ; / "and" for co-founders.
_PERSON = re.compile(r"\b[A-Z][a-z'’-]+(?:\s+[A-Z][a-z'’.-]+)+")
COUNTRY_WORDS = {"usa", "us", "u.s.", "u.s.a.", "united states", "united states of america", "uk", "u.k.",
                 "united kingdom", "canada", "ca", "australia", "india", "nepal", "ireland", "germany", "france"}
_STREET = re.compile(r"^\d|\b(street|st|avenue|ave|road|rd|boulevard|blvd|lane|ln|drive|dr|suite|ste|floor|fl)\b\.?$", re.I)
_EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")


def _same_site(a: str, b: str) -> bool:
    a, b = a.lower().removeprefix("www."), b.lower().removeprefix("www.")
    return bool(a) and bool(b) and (a == b or a.endswith("." + b) or b.endswith("." + a))


# ---- the Outreach Writer's drafts (OW) ---------------------------------------------------

WHAT_WE_HAVE = Path.home() / "bots" / "the-ceo" / "raw" / "what-we-have.md"
DRAFT_SIGNOFF: list[str] = []   # the Outreach Writer's sign-off lines ([validator] draft_signoff); [] = not checked
DRAFT_MAX_WORDS = 300      # the package's ready-to-send email plus one opening line
_MONEY = re.compile(r"\$\s?\d[\d,]*(?:\.\d+)?\s?[kK]?")
_DRAFT_EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.]+")
_DRAFT_PHONE = re.compile(r"(?<!\d)(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}(?!\d)")
_DRAFT_LINK = re.compile(r"https?://\S+|\bwww\.\S+", re.I)
_DRAFT_GREETING = re.compile(r"^\s*(?:hi|hello|dear|hey)\s+([A-Z][\w'’-]+)", re.I | re.M)


def _money(s: str) -> str:
    s = s.replace(" ", "").replace(",", "").lower()
    return str(int(float(s[1:-1]) * 1000)) if s.endswith("k") else s[1:].split(".")[0]


def rate_figures(path: Path = WHAT_WE_HAVE) -> set[str]:
    """Every dollar figure in the owner's Rates on "What we have" (the only prices a draft may quote)."""
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return set()
    m = re.search(r"^## Rates\b(.*?)(?=^## |\Z)", text, re.M | re.S)
    return {_money(x) for x in _MONEY.findall(m.group(1) if m else "")}


def draft_issues(draft: str, *, founded_by: str = "", website: str = "", rates: set[str] | None = None,
                 whatsapp: str = "") -> list[tuple[str, str]]:
    """(rule, detail) for an Outreach Writer draft. A "skip: ..." note is the bot's verdict, not an email: nothing to check."""
    text = (draft or "").strip()
    if not text or text.lower().startswith("skip:"):
        return []
    out: list[tuple[str, str]] = []
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    if DRAFT_SIGNOFF and lines[-len(DRAFT_SIGNOFF):] != DRAFT_SIGNOFF:
        out.append(("OW01", "the draft does not end with '" + "' / '".join(DRAFT_SIGNOFF) + "' on their own lines"))
    if not 2 <= len(_NUMBERED.findall(text)) <= 6:
        out.append(("OW09", "not built on the package's ready-to-send email (its numbered list is missing)"))
    rates = rate_figures() if rates is None else rates
    bad = [m for m in _MONEY.findall(text) if _money(m) not in rates]
    if bad:
        out.append(("OW02", "price not on the Rates: " + ", ".join(b.strip() for b in bad[:3])))
    g = _DRAFT_GREETING.search(text)
    if g and g.group(1).lower() not in ("there", "team", "all", "friends"):
        first = (founded_by or "").split()[0].strip(",").lower() if founded_by.strip() else ""
        if g.group(1).lower() != first and not g.group(1).lower() in (founded_by or "").lower():
            out.append(("OW03", f"greets '{g.group(1)}', who is not the row's Founded by ('{founded_by or 'empty'}')"))
    personal = _DRAFT_EMAIL.findall(text) + _DRAFT_PHONE.findall(text)
    if personal:
        out.append(("OW04", "contact details in the draft: " + ", ".join(personal[:2])))
    site = domain(website) if website else ""
    wa = (whatsapp or "").strip().rstrip("/")
    links = [u for u in _DRAFT_LINK.findall(text) if (not site or domain(u if u.startswith("http") else "https://" + u) != site)
             and not (wa and u.rstrip("/.,)") == wa)]
    if links:
        out.append(("OW05", "links other than the business's own site: " + ", ".join(u[:50] for u in links[:2])))
    words = len(re.findall(r"\w+", text))
    if words > DRAFT_MAX_WORDS:
        out.append(("OW06", f"{words} words (keep it under {DRAFT_MAX_WORDS})"))
    hit = injection(text)
    if hit:
        out.append(("FM07", f"repeats a page's instruction: '{hit[:60]}'"))
    return out


_WA_SHAPE = re.compile(r"^https://wa\.me/\d{7,15}$")


def whatsapp_shape(link: str) -> str:
    """LD20 (shape): the Whatsapp cell holds https://wa.me/<digits> or nothing."""
    link = (link or "").strip()
    if not link or _WA_SHAPE.match(link):
        return ""
    return f"Whatsapp is '{link[:60]}', not https://wa.me/<digits> copied from a link on the business's own site"


def check_lead_whatsapp_published(ck: Checker, ld: LeadRow, verdict) -> list[Flag]:
    """LD20 (proof): the wa.me number was looked for as a Whatsapp link on the business's own pages."""
    if verdict.status != "not_found":
        return []
    seen = f"; links there: {', '.join('wa.me/' + d for d in verdict.others)}" if verdict.others else ""
    return _collect(ck.flag("LD20", "lead", ld.page_id, ld.label, ld.url,
                            f"{ld.whatsapp} is not linked on its own site ({verdict.where}){seen}",
                            when=ld.created[:10], name=ld.business))


STALE_EMAILED_DAYS = 10


def stale_emailed(ld: LeadRow, today: dt.date | None = None) -> str:
    """LD19: the team emailed this business 10+ days ago and no Result has come since. "" when not stale."""
    if ld.result.strip().lower() != "emailed":
        return ""
    since, basis = (ld.result_date, "Result date") if ld.result_date else (ld.edited, "last edit (no Result date)")
    try:
        day = dt.date.fromisoformat(since[:10])
    except ValueError:
        return ""
    age = ((today or dt.date.today()) - day).days
    return f"Emailed {age} days ago by its {basis} ({day}) and no reply, meeting or other result since" if age >= STALE_EMAILED_DAYS else ""


def check_lead(ck: Checker, ld: LeadRow, *, allowed_packages: list[str], duplicate_of: list[str]) -> list[Flag]:
    f = lambda rid, detail: ck.flag(rid, "lead", ld.page_id, ld.label, ld.url, detail, when=ld.created[:10], name=ld.business)  # noqa: E731
    out: list[Flag] = []
    for rid, detail in draft_issues(ld.draft_email, founded_by=ld.founded_by, website=ld.website, whatsapp=ld.whatsapp):
        out += _collect(ck.flag(rid, "lead", ld.page_id, ld.label, ld.url, detail, bot="outreach-writer",
                                when=ld.created[:10], name=ld.business))
    wa = whatsapp_shape(ld.whatsapp)
    if wa:
        out += _collect(f("LD20", wa))
    stale = stale_emailed(ld)
    if stale:
        out += _collect(ck.flag("LD19", "lead", ld.page_id, ld.label, ld.url, stale, bot="owner", when="", name=ld.business))
    hit = injection(" \n".join((ld.pain_point, ld.how_we_help, ld.founded_by, ld.location, ld.industry, ld.company_size)))
    if hit:
        out += _collect(ck.flag("FM07", "lead", ld.page_id, ld.label, ld.url, f"repeats a page's instruction: '{hit[:60]}'",
                                bot="lead-gen", when=ld.created[:10], name=ld.business))
    site = domain(ld.website) if ld.website.startswith(("http://", "https://")) else ld.website.strip().lower().removeprefix("www.").split("/")[0]
    email = ld.email.strip().lower()
    if not ld.business.strip():
        out += _collect(f("LD01", "no Business name"))
    if not site:
        out += _collect(f("LD01", "no Website"))
    if not email or "@" not in email:
        out += _collect(f("LD01", "no Business email"))
    else:
        mail_dom = email.rsplit("@", 1)[1]
        if mail_dom in PERSONAL_MAILBOXES:
            out += _collect(f("LD01", f"email is on a personal mailbox provider ({mail_dom})"))
        # a different domain is fine when the address is printed on the business's own site (owner, 2026-09-30:
        # shop-city.example on shop.example) -- LD09 proves that from the site's pages; the engine proves it at write time
    ev = ld.evidence.strip()
    if not ld.pain_point.strip():
        out += _collect(f("LD02", "no Pain point"))
    if not ev:
        out += _collect(f("LD10", "no Evidence URL: nothing on record shows the pain point is real"))
    elif not ev.startswith(("http://", "https://")):
        out += _collect(f("LD02", f"Evidence is not a URL: {ev[:50]}"))
    elif site:
        ev_dom = domain(ev)
        if not (_same_site(ev_dom, site) or any(ev_dom == jb or ev_dom.endswith("." + jb) for jb in JOB_BOARDS)):
            out += _collect(f("LD02", f"Evidence is on {ev_dom}, not the business's site or a job board it uses"))
    if not ld.how_we_help.strip():
        out += _collect(f("LD03", "How we can help is empty"))
    elif allowed_packages and ld.how_we_help.strip() not in allowed_packages:
        near = closest_package(ld.how_we_help, allowed_packages)
        hint = f"; did you mean '{near}'?" if near else ""
        out += _collect(f("LD03", f"'{ld.how_we_help[:50]}' is not one of the package names{hint} Accepted: "
                                  + "; ".join(sorted(allowed_packages, key=len)[:12])))
    if duplicate_of:
        out += _collect(f("LD04", f"same website domain as " + ", ".join(duplicate_of[:3])))
    size = ld.company_size.strip()
    parts = [x.strip() for x in re.split(r"[;,]", size) if x.strip()]
    if size and (len(size) > COMPANY_SIZE_MAX or not parts or not all(_SIZE_PART.match(x) for x in parts)):
        out += _collect(f("LD08", f"Company size reads '{size[:50]}…', which describes the business instead of sizing it"))
    place = [x.strip() for x in ld.location.split(",") if x.strip()]
    if not place:
        pass                      # blank is honest: better than a city nobody read off their pages
    elif len(place) < 2 or place[0].lower() in COUNTRY_WORDS:
        out += _collect(f("LD07", f"Location is '{ld.location.strip()[:40]}', not City, State, Country"))
    elif _STREET.search(place[0]):
        out += _collect(f("LD07", f"Location starts with a street address ('{place[0][:30]}'), not the city"))
    founder = ld.founded_by.strip()
    if not founder:
        out += _collect(f("LD11", "Founded by is empty: the founder's name is the thing outreach opens with"))
    elif not _PERSON.search(founder):
        out += _collect(f("LD15", f"Founded by reads '{founder[:50]}', which is not a person's name"))
    elif re.search(r"(\b[A-Z]|['’-])$", founder):
        out += _collect(f("LD15", f"Founded by reads '{founder[:50]}', a name cut off mid-word"))
    if (ld.email_check or "").strip().lower().startswith("not deliverable"):
        out += _collect(f("LD18", f"the email service says '{ld.email}' is {ld.email_check.strip()[:60]}: outreach to it would bounce"))
    pages = [x for x in re.split(r"[\s,;]+", ld.source_pages) if x]
    if pages and any(not x.startswith(("http://", "https://")) for x in pages):
        out += _collect(f("LD12", f"Source pages holds prose ('{ld.source_pages.strip()[:50]}…'), not page URLs"))
    site_dom = domain(ld.website) if ld.website.startswith(("http://", "https://")) else ""
    if site_dom and any(site_dom == d or site_dom.endswith("." + d) for d in DIRECTORY_SITES):
        out += _collect(f("LD14", f"Website is {site_dom}, a directory or association, not the business's own site"))
    local = email.split("@", 1)[0] if "@" in email else ""
    if local in NOT_A_SALES_CONTACT:
        out += _collect(f("LD13", f"'{email}' is a {local}@ address: the wrong desk for a sales approach"))
    found_by = ld.found_by.strip()
    if not found_by:
        out += _collect(f("LD06", "Found by is empty"))
    elif len(found_by) > FOUND_BY_MAX or ";" in found_by:
        out += _collect(f("LD06", f"Found by reads '{found_by[:70]}…' instead of naming who found it"))
    text = f"{ld.pain_point}\n{ld.location}\n{ld.industry}\n{ld.company_size}"
    others = [m for m in _EMAIL.findall(text) if m.lower() != email]
    phone = _PHONE.search(text)
    if others or phone:
        what = ("a second email address" if others else "") + (" and " if others and phone else "") + ("a phone number" if phone else "")
        out += _collect(f("LD05", f"text fields contain {what}"))
    return out


def check_lead_email_published(ck: Checker, ld: LeadRow, verdict) -> list[Flag]:
    """LD09: the claimed Business email was looked for on the business's own pages (email_check.py). Separate from
    check_lead because it needs the network; the runner feeds in the verdict it cached."""
    if verdict is None or verdict.status in ("published", "skipped", "unreachable"):
        return []
    instead = (" It does publish " + ", ".join(verdict.others) + ".") if verdict.others else ""
    detail = f"'{ld.email}' is on none of its pages the Validator could read ({verdict.where}).{instead}"
    flag = ck.flag("LD09", "lead", ld.page_id, ld.label, ld.url, detail, when=ld.created[:10], name=ld.business)
    return [flag] if flag else []


def lead_site_key(website: str) -> str:
    site = domain(website) if website.startswith(("http://", "https://")) else website.strip().lower().split("/")[0]
    return site.removeprefix("www.")


def site_duplicate_index(rows: dict[str, dict[str, str]]) -> dict[str, list[str]]:
    out: dict[str, list[str]] = {}
    for pid, row in rows.items():
        key = lead_site_key(row.get("website", ""))
        if key:
            out.setdefault(key, []).append(pid)
    return out


# ---- duplicates helper -------------------------------------------------------------------

def duplicate_index(rows: dict[str, dict[str, str]]) -> dict[str, list[str]]:
    """norm title -> page ids, over the task index the runner keeps between runs."""
    out: dict[str, list[str]] = {}
    for pid, row in rows.items():
        key = norm_title(row.get("title", ""))
        if key:
            out.setdefault(key, []).append(pid)
    return out


_AI_WORDS = re.compile(r"\b(ai|agents?|assistant|llm|models?|gpt|copilot|chatbot|automat\w*|machine learning|autonomous)\b", re.I)


def check_agent_entry(ck: Checker, a) -> list[Flag]:
    f = lambda rid, detail: ck.flag(rid, "agent", a.key, f'AI agent "{a.name[:60]}"', "", detail, name=a.name)  # noqa: E731
    out: list[Flag] = []
    host = a.website.split("/")[2] if a.website.count("/") >= 2 else ""
    if not a.website.startswith("https://") or host.endswith(".onion"):
        out += _collect(f("O07", f"Website is '{a.website[:70] or 'empty'}', not a clearnet https page"))
    if not a.sources:
        out += _collect(f("O08", "no Sources page"))
    if not _AI_WORDS.search(a.what):
        out += _collect(f("O09", f"What it does reads '{a.what[:70]}', which is not an AI agent"))
    return out


def closest_package(value: str, names: list[str]) -> str:
    """The accepted package name nearest to what a bot wrote: most shared words, then the shorter name (the board's
    option rather than a long toggle headline). "Acme POS for Franchise Chains" -> "Acme POS"."""
    import difflib
    stop = {"for", "the", "and", "with", "your", "our"} | market_words()
    words = lambda t: {w for w in re.findall(r"[a-z0-9]+", t.lower()) if (len(w) > 2 or w.isdigit()) and w not in stop}  # noqa: E731
    want = words(value)
    scored = [(len(want & words(n)), -len(n), n) for n in names]
    best = max(scored, default=(0, 0, ""))
    if best[0] >= 1:
        return best[2]
    near = difflib.get_close_matches(value, names, n=1, cutoff=0.5)
    return near[0] if near else ""
