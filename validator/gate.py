"""The Validator's rules at write time (owner, 2026-09-25: "valB is supposed to keep all output in check").

The engine calls `check(action, payload, bot=...)` before a `lead`, `update_lead`, `task`, `update_task` or
`publish_package` action writes to Notion. It returns reasons in the bots' vocabulary; an empty list means the write
may go ahead. Checking stays the Validator's job -- the rule text is validator/instructions/*.md, the rule code is
checks.py -- the engine only gains the authority to refuse. This module is pure: no network, no writes, answers in
milliseconds; only rules marked as errors refuse (a [warn] stays an after-the-fact finding). What needs the web or
the board (LD09 email-on-site, LD03 package names, duplicates, the founder of a NEW lead) stays with the sweep.
"""
from __future__ import annotations

import datetime as dt
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

from checks import Checker, Flag, Instructions, check_lead, check_package_toggle, check_task, load_instructions  # noqa: E402
from sources import LeadRow, PackageToggle, TaskRow  # noqa: E402

INSTRUCTIONS = HERE / "instructions"
TEAM = HERE.parent / "common-data" / "team.json"
GATED = ("lead", "update_lead", "task", "update_task", "publish_package")

# Rules a write-time gate cannot judge, or that the engine fills in after the payload (Found by, Status, the
# Projects relation, the toggle's price line and Created date, the Package Designer's sources).
_SKIP = {
    "lead": {"LD04", "LD06", "LD09", "LD11"},
    "update_lead": {"LD04", "LD06", "LD09"},
    "task": {"T02", "T03", "T08", "T09"},
    "update_task": {"T01", "T02", "T03", "T04", "T06", "T07", "T08", "T09", "T12"},
    "publish_package": {"PK01", "PK11", "PK12", "PS01", "PS02", "PS03", "PS04", "PS05", "PS06"},
}
# update_*: a rule counts only when the field it judges is among the fields being written (and not blank -- an
# honest blank is allowed; the owner's deletions must never be refused or refilled by the gate).
_FIELDS = {
    "LD01": {"website", "email"}, "LD03": {"how_we_help"}, "LD02": {"evidence", "pain_point"}, "LD05": {"pain_point", "location", "industry", "size"},
    "LD07": {"location"}, "LD08": {"size"}, "LD10": {"evidence"}, "LD11": {"founded_by"}, "LD15": {"founded_by"}, "LD12": {"sources"},
    "LD13": {"email"}, "LD14": {"website"}, "LD20": {"whatsapp"}, "LD22": {"map_url", "google_map_location"}, "LD23": {"founder_linkedin", "linkedin_via"}, "LD24": {"contact_role"},
    "T05": {"priority"}, "T10": {"details_append", "details", "title"}, "T11": {"due"}, "T13": {"details_append", "details", "title"},
}

# What the gate may REFUSE (owner, 2026-10-03: "clean up ... guardrails so that they have more flexibility"). Three
# kinds of rule, kept apart: the fence and the owner's own rules refuse before the write; quality rules (shapes, formats,
# wording) let the write through and the sweep reports them afterwards. Everything not listed here is flag-only.
GATE_REFUSES = {
    # the fence: personal data, invented or wrong-business values, an address that bounces
    "LD01", "LD02", "LD14", "LD15", "LD18", "MG03", "LD20", "LD23", "LD24",
    # board integrity: a value Notion would add as a new dropdown option
    "LD03",
    # the owner's own rules (2026-10-01/02) and the repeat guard
    "PK14", "MG04", "MG01", "RA05", "MG05",
    # the Outreach Writer (2026-10-07): only its own cell; no invented price; no contact details; the sign-off
    "OW07", "OW02", "OW04", "OW01", "OW11", "OW12",
    # the Lead Enricher (2026-10-10): only its own cells
    "EN01",
}

_cache: dict[str, object] = {}


def instructions() -> Instructions:
    """The rule text, reloaded when a file under instructions/ changes."""
    from checks import TARGET
    stamp = tuple(sorted((p.name, p.stat().st_mtime_ns) for p in INSTRUCTIONS.glob("*.md"))) + (
        (TARGET.stat().st_mtime_ns if TARGET.exists() else 0),)   # a new market re-fills {market} in the rule text
    if _cache.get("stamp") != stamp:
        _cache["ins"] = load_instructions(INSTRUCTIONS)
        _cache["stamp"] = stamp
    return _cache["ins"]  # type: ignore[return-value]


def team_names() -> set[str]:
    try:
        data = json.loads(TEAM.read_text(encoding="utf-8"))
        return {m.get("name", "").strip().lower() for m in data.get("members", []) if m.get("name")}
    except (OSError, ValueError):
        return set()


def _today() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")


def _s(v) -> str:
    return "" if v is None else str(v)


def _reason(f: Flag) -> str:
    return f"{f.rule}: {f.detail}"


def _lead_row(p: dict, *, bot: str) -> LeadRow:
    return LeadRow(
        page_id="", url="", business=_s(p.get("name")), website=_s(p.get("website")), email=_s(p.get("email")),
        location=_s(p.get("location")), industry=_s(p.get("industry")), company_size=_s(p.get("size")),
        pain_point=_s(p.get("pain_point")), how_we_help=_s(p.get("how_we_help")), evidence=_s(p.get("evidence")),
        stage="", found_on=None, source_pages=" ".join(p.get("sources") or []) if isinstance(p.get("sources"), list) else _s(p.get("sources")),
        found_by=bot or "bot", created=_today(), edited="", founded_by=_s(p.get("founded_by")), whatsapp=_s(p.get("whatsapp")),
        map_url=_s(p.get("map_url") or p.get("google_map_location")),
        founder_linkedin=_s(p.get("founder_linkedin")), linkedin_via=_s(p.get("linkedin_via")), contact_role=_s(p.get("contact_role")),
    )


def _task_row(p: dict, *, min_details: int) -> TaskRow:
    return TaskRow(
        page_id="", url="", title=_s(p.get("title")), status="Not started", priority=_s(p.get("priority")),
        assignee_ids=["given"] if p.get("assignee") else [], assignee_names=[_s(p.get("assignee"))] if p.get("assignee") else [],
        due=p.get("due") or None, project_ids=["given"], created=_today(), edited="",
        body=_s(p.get("details") or p.get("details_append")), uid="", blocks=[],
    )


def check(action: str, payload: dict, *, bot: str = "", min_details: int = 300) -> list[str]:
    """Reasons this write breaks the owner's rules; [] = allowed. Pure; never raises on odd payloads."""
    if action not in (*GATED, "message") or not isinstance(payload, dict):
        return []
    # the engine passes the bot's display name ("Outreach Writer"); compare on the folder slug ("outreach-writer").
    # Until 2026-10-07 21:00 the slug compare never matched, so OW and RA05 were not refused at write time.
    slug = re.sub(r"[^a-z0-9]+", "-", (bot or "").strip().lower()).strip("-")
    if slug == "outreach-writer":
        # owner, 2026-10-07: it writes the "Draft email" cell and nothing else; it never contacts a business
        other = sorted(k for k, v in payload.items() if k not in ("type", "name", "business", "page_id", "draft_email", "draft_whatsapp", "draft_whatsapp_msg") and v not in (None, "", []))
        if action != "update_lead" or other:
            return ["OW07: the Outreach Writer only fills the Draft email cell (update_lead with draft_email); "
                    + (f"not {', '.join(other)}" if other and action == "update_lead" else f"not {action}")]
        from checks import draft_issues
        wa_msg = _s(payload.get("draft_whatsapp") or payload.get("draft_whatsapp_msg"))
        from checks import whatsapp_draft_issues
        return ([f"{rid}: {d}" for rid, d in draft_issues(_s(payload.get("draft_email"))) if rid in GATE_REFUSES]
                + [f"{rid}: {d}" for rid, d in whatsapp_draft_issues(wa_msg) if rid in GATE_REFUSES])
    if action in ("lead", "update_lead") and _s(payload.get("whatsapp")).strip():
        from whatsapp_false import digits_of, ruled_out
        d = digits_of(_s(payload.get("whatsapp")))
        hit = ruled_out().get(d) or next((v for k, v in ruled_out().items() if d and k[-10:] == d[-10:]), None)
        if hit:
            return [f"LD20: {d} was checked by the team in WhatsApp Web and is not on WhatsApp ({hit.get('business', '')}); "
                    "find a different number or leave the cell empty"]
    if action == "message":
        return ceo_message_issues(payload) if slug == "the-ceo" else []
    if slug == "the-ceo" and action in ("task", "update_task") and _s(payload.get("assignee")).strip():
        # owner, 2026-10-14: "tell ceoA not to assign person ... I will handle that part for now"
        return ["MG05: leave the Assignee empty; the owner assigns people on the task board for now. Write the task without an assignee."]
    if slug == "lead-enricher":
        # owner, 2026-10-10 ("yes go"): it fills empty Founder / CEO, Location, Company size, Industry and map cells only
        other = sorted(k for k, v in payload.items() if k not in ("type", "name", "business", "page_id", "founded_by", "location",
                                                                  "size", "industry", "map_url", "google_map_location", "sources",
                                                                  "pain_point", "whatsapp", "founder_linkedin", "linkedin_via", "contact_role")
                 and v not in (None, "", []))
        if action != "update_lead" or other:
            return ["EN01: the Lead Enricher only fills empty Founder / CEO, Location, Company size, Industry, Pain point, Whatsapp and map cells "
                    "(update_lead); " + (f"not {', '.join(other)}" if other and action == "update_lead" else f"not {action}")]
    if action == "update_lead" and _s(payload.get("pain_point")).strip():
        # owner, 2026-10-10 ("sounds like a good plan"): a rewritten Pain point is refused when weak or not in the three
        # parts, so the writer sees why and tries again; a new lead is never refused for it (the sweep flags it, LD21)
        from checks import pain_point_issue
        weak = pain_point_issue(_s(payload.get("pain_point")))
        if weak:
            return [f"LD21: {weak}. Write three lines: 'Pain point: <one gap you saw, and where>', 'They can try: <a fix "
                    "they can do themselves>', 'We propose: <what our team does, from the row's package>'"]
    if slug == "research-analyst" and action in GATED:
        return ["RA05: the Research Analyst never writes to the task board or Notion: research is never a task; "
                "post the findings and answer The CEO by message"]
    ck = Checker(instructions())
    skip = _SKIP[action]
    written = {k for k, v in payload.items() if v not in (None, "", [])}
    flags: list[Flag] = []
    if action in ("lead", "update_lead"):
        flags = check_lead(ck, _lead_row(payload, bot=bot), allowed_packages=package_names(), duplicate_of=[])
    elif action in ("task", "update_task"):
        flags = check_task(ck, _task_row(payload, min_details=min_details), team={}, min_details=min_details if action == "task" else 0,
                           duplicate_of=[], bot=bot or "the-ceo")
    elif action == "publish_package":
        toggle = PackageToggle(block_id="", title=f'{_s(payload.get("name"))} {_s(payload.get("title"))}', email=_s(payload.get("email")),
                               sources=[], company={}, conclusion=_s(payload.get("conclusion")), page_url="", extra={"_gate_now": _today()})
        flags = check_package_toggle(ck, toggle, own_domains=[])
        dup = duplicate_offer(_s(payload.get("name")), _s(payload.get("title")))
        if dup and "PK14" in ck.rules:
            flags.append(Flag("PK14", bot, "package", "", "", "", "", f"this offer is already on the Packages page as '{dup[:80]}'; "
                              "republish that package (its own name) to change it, instead of adding a second toggle", "error"))
    out: list[str] = []
    for f in flags:
        if f.rule in skip or f.severity != "error" or f.rule not in GATE_REFUSES:
            continue
        if action.startswith("update_"):
            fields = _FIELDS.get(f.rule)
            if fields is not None and not (fields & written):
                continue
            # an update changes only the fields it names: a field it leaves out is not missing (LD02 "no Pain point"
            # refused seven evidence-only update_leads, 2026-09-26/28)
            if f.detail.startswith("no ") or " is empty" in f.detail:
                continue
        out.append(_reason(f))
    if action == "task" and family_work(payload):
        out.append("MG04: researching, compiling, listing or sorting information is family work: do it yourself as notes, "
                   "or ask a family member by message; a board task is for work only a person can do")
    if action == "task" and about_validator_flag(payload):
        out.append("MG04: this task is about fixing a Validator flag on your own work; that is yours to do with update_task "
                   "or a republish, not a task for the human team")
    return out




CONTEXT_MAX = 2000      # bot-creator: keep each call cheap
MG03_FIELDS = ("founded_by", "location", "size")   # industry is the bot's own description of the trade, not a page fact


def _open_task_titles() -> list[str]:
    """Titles of the tasks the sweep last saw open (the engine may pass its own list instead)."""
    try:
        state = json.loads((HERE / "workspace" / "state.json").read_text(encoding="utf-8"))
        return [t for t in state.get("open_task_titles", [])][:40]
    except (OSError, ValueError):
        return []


def questions(action: str, payload: dict, *, bot: str = "", page_text: str = "", open_tasks: list[str] | None = None) -> list[dict]:
    """Gate 3: the owner's model-judged questions for this write, each with its context assembled (<= CONTEXT_MAX chars).
    Pure and fast; [] for an action with no questions. The engine asks a small model for {"ok": bool, "why": str}, caches,
    fails open, and refuses with "Validator rules: <id>: <why>" when ok is false. `page_text` is the cited page's text,
    which only the engine holds (recent_page_texts)."""
    if action not in GATED or not isinstance(payload, dict):
        return []
    qs = [q for q in instructions().write_questions if q[1] == action and q[0] in GATE_REFUSES]
    if action == "task" and human_task(payload):
        # contacting a business is human work by the owner's rule (2026-10-02); the 7B judge flipped its own reasoning
        # ("Sends emails, thus requires human action" -> ok=false) on 7 outreach tasks, so this is decided, not asked
        qs = [q for q in qs if q[0] != "MG04"]
    if action in ("lead", "update_lead"):
        # MG03 judges only the facts a page must state: founder, location, size -- and only those actually written. The email is checked by the
        # engine against the pages opened (MG03 saw a 1,200-char excerpt and refused an email the contact page had,
        # 2026-09-30); website, evidence and pain point are the bot's own reading; how_we_help is The CEO's sales pick.
        facts = {k: v for k, v in payload.items() if k in MG03_FIELDS and v not in (None, "", [])}
        if not facts:
            return []
        payload = {"name": payload.get("name", ""), **facts}
    if not qs:
        return []
    # each field trimmed, so a long body never crowds the team list or the cited page out of the budget
    fields = {k: (v[:300] + "…" if isinstance(v, str) and len(v) > 300 else v)
              for k, v in payload.items() if k != "type" and v not in (None, "", [])}
    base = "The write:\n" + json.dumps(fields, ensure_ascii=False, indent=1)
    extra = ""
    if action in ("task", "update_task"):
        extra = ("\nOpen tasks:\n" + "\n".join(f"- {t}" for t in (open_tasks if open_tasks is not None else _open_task_titles())))
    elif action in ("lead", "update_lead"):
        extra = "\nCited page text:\n" + (page_text or "(not supplied)")[:1200]
    elif action == "publish_package":
        # the owner's direction, not The CEO's working goal: the CEO rewrites that as a task sentence every few hours,
        # and the 7B judged packages against the task (2026-09-28: same package ok at 22:23, refused at 22:25)
        extra = "\nThe owner's current direction:\n" + (newest_steer() or current_goal())[:600]
    out = []
    for qid, _, text, _bot in qs:
        ctx = (base + extra)[:CONTEXT_MAX]
        out.append({"id": qid, "question": text, "context": ctx})
    return out


def current_goal() -> str:
    """The CEO's own goal (revise_goal writes it), else the newest steer in the knowledge base."""
    for path in (HERE.parent / "the-ceo" / "workspace" / "self_goal.md",):
        try:
            text = path.read_text(encoding="utf-8").strip()
            if text:
                return text
        except OSError:
            pass
    try:
        steers = (HERE.parent / "common-data" / "knowledge" / "steers.md").read_text(encoding="utf-8")
        parts = steers.split("\n## ")
        return parts[1].strip() if len(parts) > 1 else ""
    except OSError:
        return ""


def newest_steer() -> str:
    """The newest section of common-data/knowledge/steers.md: the owner's current direction."""
    try:
        parts = (HERE.parent / "common-data" / "knowledge" / "steers.md").read_text(encoding="utf-8").split("\n## ")
        return parts[1].strip() if len(parts) > 1 else ""
    except OSError:
        return ""


def package_names() -> list[str]:
    """The package names the board accepts (its select options plus the packages page), as the last sweep saw them."""
    try:
        state = json.loads((HERE / "workspace" / "state.json").read_text(encoding="utf-8"))
        return list(state.get("lead_package_names") or [])
    except (OSError, ValueError):
        return []


if __name__ == "__main__":     # gate.py '<action>' '<json payload>' -- try a payload by hand
    print(json.dumps(check(sys.argv[1], json.loads(sys.argv[2])), indent=2))


# PK14: one offer, one toggle. The products you sell, as the words that name them; two packages naming the same product
# are the same offer whatever the headline or price says. Yours come from [validator.offers] in validator/config.toml:
#   "website care" = "website (care|maintenance)|site care"
# With no table, PK14 only refuses a second toggle under an identical name.
def _load_offers() -> dict[str, str]:
    try:
        import tomllib

        data = tomllib.loads((HERE / "config.toml").read_text(encoding="utf-8"))
        table = (data.get("validator") or {}).get("offers") or {}
        return {str(k): str(v) for k, v in table.items() if str(v).strip()}
    except (OSError, ValueError):
        return {}


_OFFERS = _load_offers()


def offers_of(text: str) -> set[str]:
    return {k for k, pat in _OFFERS.items() if re.search(pat, text or "", re.I)}


def _published() -> dict:
    """The CEO's record of what is on the Packages page: lower-cased package name -> {block_id, title, ...}."""
    import sqlite3
    db = HERE.parent / "the-ceo" / "workspace" / "explorer.sqlite3"
    try:
        con = sqlite3.connect(f"file:{db}?mode=ro", uri=True, timeout=1)
        try:
            row = con.execute("SELECT value FROM state WHERE key = 'published_package_blocks'").fetchone()
        finally:
            con.close()
        return json.loads(row[0]) if row and row[0] else {}
    except (sqlite3.Error, ValueError):
        return {}


def duplicate_offer(name: str, title: str, published: dict | None = None) -> str:
    """The title of a toggle already on the page that sells the same offer under ANOTHER package name, or ""."""
    published = _published() if published is None else published
    if (name or "").strip().lower() in published:
        return ""                               # a republish of the same package replaces its own toggle
    mine = offers_of(f"{name} {title}")
    # the more specific offers win: "website & app care" is app care, not plain website care
    if "app care" in mine: mine -= {"website care"}
    if "ai website" in mine: mine -= {"website care"}
    if not mine:
        return ""
    for key, rec in published.items():
        theirs = offers_of(f"{key} {rec.get('title', '')}")
        if "app care" in theirs: theirs -= {"website care"}
        if "ai website" in theirs: theirs -= {"website care"}
        if mine & theirs and len(mine) <= 2:
            return str(rec.get("title") or key)
    return ""


_HUMAN_WORK = re.compile(r"^\s*(outreach\b|follow[- ]?up\b|call\b|email\b|send\b|meet\b|visit\b|post\b|publish .* (website|deck)|"
                         r"pitch\b|demo\b|book\b|schedule\b|sign\b|design\b|decide\b)", re.I)


def human_task(payload: dict) -> bool:
    """A task that is plainly a person's (MG04 not asked): its title opens with contacting, meeting, posting, designing
    or deciding ("Outreach: Harbor and 4 more", "Follow up with Noodle Bar One ..."), or it is assigned to a person on the
    team list."""
    title = _s(payload.get("title"))
    who = _s(payload.get("assignee")).strip().lower()
    if family_work(payload):
        return False            # naming a person does not make research a person's job (CEO-151, 2026-10-06)
    return bool(_HUMAN_WORK.match(title) or _REVIEW_DRAFTS.match(title)) or (bool(who) and who in team_names())


_FAMILY_WORK = re.compile(
    r"^\s*(?:research|compile|list|categori[sz]e|organi[sz]e|sort|analy[sz]e|identify|find|gather|collect|summari[sz]e|"
    r"catalog(?:ue)?|map|survey|benchmark|compare)\b"
    r".*\b(?:services?|trends?|trending|tools?|competitors?|leads?|businesses|market|categor(?:y|ies)|options|vendors?|"
    r"providers?|pric(?:es|ing)|offers?|packages?|data|insights?|landscape|findings|adoption|posts?)\b", re.I)

# "Have Package Designer create ..." -- a task telling a person to make a bot do its own job (2026-10-10)
_HAVE_A_BOT = re.compile(r"^\s*(?:have|ask|get|tell|let)\s+(?:the\s+)?(?:package designer|lead gen|research analyst|scout|"
                         r"outreach writer|validator|ceo|the ceo|pacA|leaA|anaA|scoA|outA)\b", re.I)


# 2026-10-07 (the owner: The CEO was making too many tasks out of research and findings): seven got through in a day
# as Develop/Draft/Review/Build/Update ... recommendations, guide, offerings, materials, target list, Notion pages.
_FAMILY_DELIVERABLE = re.compile(
    r"^\s*(?:develop|draft|create|build|review|update|prepare|write|produce|incorporate|consolidate|publish|finali[sz]e|"
    r"coordinate|complete|polish)\b"
    r".*\b(?:recommendations?|guides?|offerings?|materials?|presentations?|strateg(?:y|ies)|reports?|research|advisory|"
    r"target lists?|lists?|notion pages?|overview|playbook|analysis|findings|trends?|trending|"
    r"(?:findings |blog )?posts?|articles?|publication|packages?)\b", re.I)   # 2026-10-09: 4 "findings post" tasks went to a person


def family_work(payload: dict) -> bool:
    """A task whose job is research or compiling information (MG04: family work, never a board task for a person):
    e.g. 'Organize trending AI agent services by category for our clients', assigned to a person."""
    title = _s(payload.get("title"))
    if _REVIEW_DRAFTS.match(title):
        return False            # the team's daily review of the Outreach Writer's drafts
    if _FAMILY_WORK.match(title) or _HAVE_A_BOT.match(title):
        return True
    # a deliverable for a meeting, a pitch, an event or a design tool, or one done with a person, is the team's
    return bool(_FAMILY_DELIVERABLE.match(title)) and not _PERSON_DELIVERABLE.search(title)


_PERSON_DELIVERABLE = re.compile(
    r"\b(?:meetings?|pitch(?:es)?|calls?|trade ?shows?|events?|workshops?|demos?|canva|figma|decks?|slides?|flyers?|"
    r"brochures?|print|videos?|photos?|ad creatives?|with (?:the )?(?:owner|team|client))\b", re.I)

# The team's daily review of the Outreach Writer's drafts: reading, approving and sending is a person's.
_REVIEW_DRAFTS = re.compile(r"^\s*(?:review|approve|check|edit|proofread)\b.*\b(?:drafts|drafted|draft emails?|outreach (?:drafts?|emails?)|"
                            r"ready to send)\b", re.I)


_FLAG_TASK = re.compile(r"\b(T|PK|LD|MG|FM|PL)\d{2}\b|\bvalidator\b|\btask format\b|\bformat checklist\b|\bchecklist items\b|"
                        r"^\s*fix\s+ceo-\d+", re.I)


def about_validator_flag(payload: dict) -> bool:
    """'Fix CEO-121 Task Format Checklist Items' (2026-10-03): a task whose subject is a Validator flag or a format fix."""
    return bool(_FLAG_TASK.search(_s(payload.get("title"))))


# ---- The CEO's messages to the family (2026-10-14: owner asked "what instructions does ceoA give"; since 10-13 it asked the
# Research Analyst ~25 times for findings the Analyst had answered six times, and its other messages were pep talk) ----

_PEP = re.compile(r"^\s*(?:thanks|thank you|great|good job|well done|keep up|keep going|keep the focus|continue|please ensure|ensure|"
                  r"make sure|remember|let'?s|i acknowledge|i'?ve acknowledged|acknowledged|noted|i will|i'?ll|i am|i'?m)\b", re.I)
_CONCRETE = re.compile(r"\?|\b(?:by|before|today|tomorrow|monday|tuesday|wednesday|thursday|friday|\d{4}-\d{2}-\d{2}|\d+)\b", re.I)
REQUESTS = Path.home() / "bots" / "common-data" / "shared-state" / "requests.jsonl"


def _words(text: str) -> set[str]:
    return {w for w in re.findall(r"[a-z]{4,}", text.lower())} - {"could", "please", "share", "would", "your", "with", "that",
                                                                   "this", "from", "have", "what", "about", "findings", "research"}


def ceo_message_issues(payload: dict, *, now: dt.datetime | None = None, log: Path | None = None) -> list[str]:
    to, text = _s(payload.get("to")).strip(), _s(payload.get("text")).strip()
    if not text:
        return []
    if _PEP.match(text) and not _CONCRETE.search(text):
        return ["MG06: no concrete ask -- a message to a colleague asks one question or names one deliverable and when "
                "(\"thanks / keep up / please ensure / I acknowledge\" is not a message). Send nothing, or ask the question."]
    now = now or dt.datetime.now()
    try:
        rows = [json.loads(x) for x in (log or REQUESTS).read_text(encoding="utf-8").splitlines() if x.strip()]
    except (OSError, ValueError):
        return []
    week = (now - dt.timedelta(days=7)).isoformat(timespec="seconds")
    answered = {r["id"]: r for r in rows if r.get("kind") in ("answered", "resolved")}
    mine = _words(text)
    for r in reversed(rows):
        if r.get("kind") != "request" or r.get("from") != "The CEO" or r.get("to") != to or str(r.get("at", "")) < week:
            continue
        theirs = _words(str(r.get("text", "")))
        if mine and theirs and len(mine & theirs) / len(mine | theirs) >= 0.4 and r["id"] in answered:
            when = str(answered[r["id"]].get("at", ""))[:16].replace("T", " ")
            return [f"MG07: you asked {to} this on {str(r.get('at', ''))[:10]} and it answered at {when}; read that answer in your "
                    "inbox (done) and use it instead of asking again."]
    return []
