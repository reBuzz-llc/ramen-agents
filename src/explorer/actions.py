"""The closed action vocabulary. The model may only choose among these types."""
from __future__ import annotations

import json
import re
from typing import Annotated, Any, Literal, Union

from pydantic import BaseModel, Field, ValidationError


class Search(BaseModel):
    type: Literal["search"]
    query: str
    engine: str = ""  # leave empty; only a bot the owner allows may name a special engine (policy.search_engines_on_request)


class Open(BaseModel):
    type: Literal["open"]
    url: str


class Read(BaseModel):
    type: Literal["read"]


class Follow(BaseModel):
    type: Literal["follow"]
    link: int


class Back(BaseModel):
    type: Literal["back"]


class Note(BaseModel):
    type: Literal["note"]
    title: str
    body: str
    tags: list[str] = Field(default_factory=list)
    source_url: str | None = None
    answers_question: int | None = None


class Ask(BaseModel):
    type: Literal["ask"]
    question: str


class Interest(BaseModel):
    type: Literal["interest"]
    topic: str
    delta: float


class Summarize(BaseModel):
    type: Literal["summarize"]


class Publish(BaseModel):
    type: Literal["publish"]
    destination: str
    title: str
    body: str


class Rest(BaseModel):
    type: Literal["rest"]
    seconds: int


class Say(BaseModel):
    """A short message for the owner, or for the AI chat partner when one is configured.
    Both show up in the dashboard chat."""

    type: Literal["say"]
    text: str
    to: Literal["owner", "partner"] = "owner"


# Desktop actions exist only when [desktop] is enabled; the policy refuses them otherwise.


class App(BaseModel):
    """Bring one of the allowed Mac apps to the front."""

    type: Literal["app"]
    name: str


class Look(BaseModel):
    """Re-read the screen: the frontmost app's elements, numbered."""

    type: Literal["look"]


class Click(BaseModel):
    type: Literal["click"]
    number: int


class TypeText(BaseModel):
    type: Literal["type"]
    text: str


class Hotkey(BaseModel):
    type: Literal["hotkey"]
    combo: str  # e.g. "cmd+n"


# Developer actions exist only when [developer] is enabled; the policy refuses them otherwise.
# Every path is workspace-scoped: resolved and checked to stay inside developer.root.


class ListFiles(BaseModel):
    type: Literal["list_files"]
    path: str = "."


class ReadFile(BaseModel):
    type: Literal["read_file"]
    path: str
    offset: int = 0


class WriteFile(BaseModel):
    type: Literal["write_file"]
    path: str
    content: str


class RunCommand(BaseModel):
    """argv, not a shell string -- no shell, no metacharacter interpretation."""

    type: Literal["run_command"]
    argv: list[str]
    cwd: str = "."  # relative to developer.root


class Task(BaseModel):
    """Create a task for the team in Notion. Exists only when [notion] is enabled and configured."""

    type: Literal["task"]
    title: str
    details: str
    assignee: str | None = None  # a person's name as the owner lists it
    priority: str = "P3"  # P0 (this week, genuinely urgent) to P6; the policy refuses anything else
    due: str | None = None  # YYYY-MM-DD


class UpdateTask(BaseModel):
    """Fix a task this bot created on the Notion board -- set or change its assignee, priority, deadline, or add
    to its details -- when the owner or the fleet's Validator reports it incomplete. Never creates a task."""

    type: Literal["update_task"]
    title: str  # the exact title of a task you created
    assignee: str | None = None  # a person's name from the Team list, to (re)assign
    priority: str | None = None  # P0 to P6
    due: str | None = None  # YYYY-MM-DD, the Dead Line
    details_append: str | None = None  # Markdown added to the end of the task page, e.g. a "### Done when" checklist


class MergeTask(BaseModel):
    """Close one of your own board tasks that another of your tasks already covers: it is marked with the board's
    duplicate status and a line saying where its work went. Exists only when [notion] merge_status is set."""

    type: Literal["merge_task"]
    title: str  # the task to close (one you created, not started yet)
    into: str  # the task that carries its work (one you created)


class PaceMember(BaseModel):
    """Pause, slow down or restart a running family member to manage the family's resources (owner, 2026-10-07).
    Every pause or slow-down ends by itself after `hours`; `resume` lifts your own hold early. Only what you held: the
    owner's STOP and PAUSE are never yours to lift. Exists only when [messaging] can_pace_members is set."""

    type: Literal["pace_member"]
    name: str  # the family member
    mode: Literal["pause", "slow", "resume"]
    hours: float = 4.0  # how long the pause or slow-down lasts, at most 24
    minutes_between_steps: int = 10  # mode "slow" only: its wait between steps, 2 to 60
    why: str = ""  # one line the member and the owner will see


class Lead(BaseModel):
    """List one potential customer on the owner's Leads board -- a business whose own pages the bot read, with a
    pain point one of our packages fixes. Exists only for a bot with [leads] enabled. No business email published
    on the business's own site = no lead."""

    type: Literal["lead"]
    name: str  # the business
    website: str  # its https:// site
    email: str  # a business email published on that site (hello@, info@, a named address they publish)
    pain_point: str  # what is wrong or missing, as seen on their pages, in one or two sentences
    how_we_help: str  # the package that fixes it, by its name on the packages page
    evidence: str  # the URL of the page that shows the pain point
    location: str = ""  # city/area, only if stated on their pages
    industry: str = ""  # what they do, in a few words
    size: str = ""  # team size, only if stated
    sources: list[str] = Field(default_factory=list)  # the pages read (contact page, about page, ...)
    whatsapp: str = ""  # the business's phone or WhatsApp number as a page you opened prints it; the engine makes the wa.me link


class UpdateLead(BaseModel):
    """Fix a row this bot listed on the Leads board -- when the owner or the fleet's Validator reports it incomplete
    or wrong. Only the fields given change; it never lists a new business (that is `lead`)."""

    type: Literal["update_lead"]
    name: str  # the exact business name of a lead you listed
    website: str | None = None
    email: str | None = None  # a business email published on the business's own site (a page you opened)
    pain_point: str | None = None
    how_we_help: str | None = None  # a package name from the packages page
    evidence: str | None = None  # URL of a page you opened that shows the pain point
    location: str | None = None
    industry: str | None = None
    founded_by: str | None = None  # the founder's name as a page states it (owner's "Founded by" column, 2026-09-25)
    size: str | None = None
    sources: list[str] | None = None  # pages read (contact page, about page, ...)
    whatsapp: str | None = None  # the business's phone or WhatsApp number as a page you opened prints it
    draft_email: str | None = None  # a first email for the team to send (Outreach Writer only), or "skip: <why>"


class SourceCompany(BaseModel):
    """Basic facts about the source/competitor company a package's pricing rests on -- ONLY as actually
    read on its own pages, never guessed (leave a field blank when the page does not state it, which for
    valuation is most of the time). Feeds the package's Notion toggle later."""

    name: str = ""  # the company, e.g. "SpeedMVPs"
    founded: str = ""  # year it started, e.g. "2019", only if stated
    employees: str = ""  # headcount or range, e.g. "20-50", only if stated
    valuation: str = ""  # only if the page states it; usually blank
    location: str = ""  # city/country as the page states it, e.g. "Austin, USA"
    website: str = ""  # its https:// site
    history: str = ""  # one or two sentences of background, only as its own pages state it


class Package(BaseModel):
    """Hand a service package to another bot (the recipient in [handoff]). Exists only when handoff is on."""

    type: Literal["package"]
    name: str  # e.g. "MVP Launch Starter"
    audience: str  # who buys it, e.g. "pre-seed founders in the target city with a validated idea"
    price: str  # e.g. "$6,500 fixed" or "$3,200/month per developer"
    deliverables: list[str]  # two to six concrete things the client gets; a package with fewer is refused
    timeline: str = ""  # e.g. "8 weeks"
    rationale: str  # why this package and price: what the market sells and charges, in your own words
    sources: list[str] = Field(default_factory=list)  # http(s) URLs you actually read
    # The company behind the sources, from what you read (optional, grounded); feeds the Notion toggle.
    source_company: SourceCompany = Field(default_factory=SourceCompany)


class PublishPackage(BaseModel):
    """Publish a package the bot has received as a toggle on the Notion package page: you write the
    marketing wrapper, the package's own facts (price, sources, source company) are filled in for you.
    Exists only when notion.package_page_id is set."""

    type: Literal["publish_package"]
    name: str  # the exact name of a package you were handed
    title: str  # a marketing / email-subject line for the toggle
    email: str  # the offer written as a ready-to-send email template
    conclusion: str = ""  # a short closing line


class Provider(BaseModel):
    """Record a free, card-free provider or tool the scout found (an AI API, a search/data/verification API), for
    the owner to review. Only with [scout] enabled."""

    type: Literal["provider"]
    name: str  # the provider, e.g. "SambaNova Cloud"
    base_url: str  # its OpenAI-compatible endpoint, e.g. "https://api.sambanova.ai/v1"
    free_terms: str  # the free tier in a phrase, e.g. "free, ~30 req/min, no card"
    needs_card: bool = False
    models: list[str] = Field(default_factory=list)
    # What kind of find it is: "model" (an AI model API), "search", "data", "verification" or "tool". Free text from
    # the model, normalised by scout.find_category; the owner was told "Found a free AI provider" for an email
    # checker (2026-10-02), so the wording now follows this.
    category: str = ""
    why: str  # why it is worth adding for this fleet, in your own words
    sources: list[str] = Field(default_factory=list)  # http(s) pages you actually read


class Message(BaseModel):
    """Send a short research message to the peer bot in [messaging]: a question to ask a colleague,
    or a short answer to one. Exists only when [messaging] is enabled."""

    type: Literal["message"]
    to: str  # the peer bot's display name (must be the configured peer)
    text: str  # a short, plain question or topic; no page text, links, or quotes


class ReviseGoal(BaseModel):
    """Rewrite your own goal -- what you are trying to do and why it matters -- in your own words, as
    you understand it better over time. Your owner reviews it and can change or clear it. Exists only
    when self-authored goals are enabled."""

    type: Literal["revise_goal"]
    goal: str  # the new goal, in your own words
    why: str = ""  # what you learned that makes you want to change it


class Plan(BaseModel):
    """Your work plan for the job you are on (owner, 2026-09-26). Start one with task + done_when + steps when you take
    on a job (an owner or priority ask, or your own episode question); tick a step with `tick` once the write behind it
    is on record; end it with status "done" or "stuck". Shown in every prompt so you know where you are."""

    type: Literal["plan"]
    task: str = ""  # new plan: the job in one line
    done_when: str = ""  # new plan: the test that says the job is finished
    steps: list[str] = []  # new plan: two to eight one-line steps
    step_minutes: list[int] = []  # new plan: your estimate of working minutes for each step, in the same order
    estimate_min: int | None = None  # new plan: working minutes for the whole job (default: the steps' sum)
    source: str = "own"  # owner | priority | own
    tick: int | None = None  # existing plan: the step number just completed
    status: str | None = None  # existing plan: "done" or "stuck" to end it
    note: str = ""  # why, when ending it stuck


class ProposeTeammate(BaseModel):
    """Suggest a new bot/role you think the fleet is missing, for the owner to consider creating.
    Exists only when [agent] propose_teammates is on."""

    type: Literal["propose_teammate"]
    role: str  # a short name for the role, e.g. "Case-study writer"
    does: str  # what it would do
    why: str  # the gap you see that makes it worth creating


# Self-upgrade (milestone 6) actions exist only when [developer].upgrade_enabled is true.


class Upgrade(BaseModel):
    """Start a fresh worktree on a new branch for a proposed change."""

    type: Literal["upgrade"]
    goal: str


class UpgradeTest(BaseModel):
    """Run the test suite inside the current upgrade worktree."""

    type: Literal["upgrade_test"]


class UpgradeSubmit(BaseModel):
    """Merge the worktree into main and restart on it, only if the last test run passed and no
    protected file was touched."""

    type: Literal["upgrade_submit"]


Action = Annotated[
    Union[
        Search, Open, Read, Follow, Back, Note, Ask, Interest, Summarize, Publish, Rest, Say,
        App, Look, Click, TypeText, Hotkey,
        ListFiles, ReadFile, WriteFile, RunCommand, Upgrade, UpgradeTest, UpgradeSubmit,
        Task, Package, Provider, Message, ReviseGoal, ProposeTeammate, PublishPackage, UpdateTask, Lead, UpdateLead, Plan,
        MergeTask, PaceMember,
    ],
    Field(discriminator="type"),
]

NAVIGATION_TYPES = frozenset({"search", "open", "follow"})
CONSOLIDATION_TYPES = frozenset({"summarize", "note", "ask", "interest", "rest", "say", "plan"})  # plan: tick or close it at the end
DESKTOP_TYPES = frozenset({"app", "look", "click", "type", "hotkey"})
DEVELOPER_TYPES = frozenset({"list_files", "read_file", "write_file", "run_command"})
UPGRADE_TYPES = frozenset({"upgrade", "upgrade_test", "upgrade_submit"})
ALL_TYPES = (
    "search", "open", "read", "follow", "back", "note", "ask", "interest", "summarize", "publish", "rest", "say",
    "app", "look", "click", "type", "hotkey",
    "list_files", "read_file", "write_file", "run_command", "upgrade", "upgrade_test", "upgrade_submit",
    "task", "package", "provider", "message", "revise_goal", "propose_teammate", "publish_package", "update_task", "lead",
    "update_lead", "plan", "merge_task", "pace_member",
)


class Decision(BaseModel):
    thought: str = ""
    action: Action


_FENCE = re.compile(r"^```(?:json)?\s*|\s*```$", re.MULTILINE)


def extract_json_object(text: str) -> str:
    """Pull the outermost JSON object out of a model reply that may carry fences or chatter."""
    cleaned = _FENCE.sub("", text.strip()).strip()
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise ValueError("no JSON object found in reply")
    return cleaned[start : end + 1]


def _unwrap_action(raw: str) -> dict[str, Any] | None:
    """The one wrong shape models keep producing: the action keyed by its own name,
    {"action": {"task": {"title": ...}}}, instead of {"action": {"type": "task", "title": ...}}.
    It says exactly what was meant, so it is repaired rather than thrown away -- 54 of The CEO's
    95 failed decisions in two days were this and nothing else. Returns None for any other shape."""
    try:
        data = json.loads(raw)
    except ValueError:
        return None
    action = data.get("action") if isinstance(data, dict) else None
    if not isinstance(action, dict) or "type" in action or len(action) != 1:
        return None
    name, body = next(iter(action.items()))
    if name not in ALL_TYPES or not isinstance(body, dict):
        return None
    return {**data, "action": {**body, "type": name}}


def parse_decision(text: str) -> Decision:
    """Parse and validate a model reply. Raises ValueError or pydantic.ValidationError."""
    raw = extract_json_object(text)
    try:
        return Decision.model_validate_json(raw)
    except ValidationError:
        repaired = _unwrap_action(raw)
        if repaired is None:
            raise
        return Decision.model_validate(repaired)


_DROP_KEYS = {"title", "default", "discriminator", "description", "minLength", "maxLength", "minimum", "maximum"}


def _simplify(node: Any, name_map: bool = False) -> Any:
    """Drop schema annotations the grammar does not need. Keys inside 'properties' and '$defs'
    are names, not annotations, so they are always kept."""
    if isinstance(node, dict):
        out: dict[str, Any] = {}
        for k, v in node.items():
            if name_map:
                out[k] = _simplify(v, False)
            elif k in ("properties", "$defs"):
                out[k] = _simplify(v, True)
            elif k in _DROP_KEYS:
                continue
            else:
                out[k] = _simplify(v, False)
        return out
    if isinstance(node, list):
        return [_simplify(v, False) for v in node]
    return node


def decision_schema() -> dict[str, Any]:
    """JSON schema handed to the model runtime for constrained decoding. Kept small on purpose."""
    return _simplify(Decision.model_json_schema())


def action_key(action: Action, resolved_url: str | None = None, extra: str | None = None) -> str:
    """A stable identity for 'the same action again', used by the watchdog and the policy."""
    if isinstance(action, Search):
        return f"search:{action.query.strip().lower()}"
    if isinstance(action, Open):
        return f"open:{(resolved_url or action.url).strip()}"
    if isinstance(action, Follow):
        return f"open:{resolved_url.strip()}" if resolved_url else f"follow:{action.link}"
    if isinstance(action, Note):
        return f"note:{action.title.strip().lower()}"
    if isinstance(action, Ask):
        return f"ask:{action.question.strip().lower()}"
    if isinstance(action, Interest):
        return f"interest:{action.topic.strip().lower()}"
    if isinstance(action, Publish):
        return f"publish:{action.title.strip().lower()}"
    if isinstance(action, Read):
        return f"read:{extra or ''}"
    if isinstance(action, Summarize):
        return f"summarize:{extra or ''}"
    if isinstance(action, App):
        return f"app:{action.name.strip().lower()}"
    if isinstance(action, Click):
        return f"click:{extra or ''}:{action.number}"
    if isinstance(action, TypeText):
        return f"type:{extra or ''}:{action.text.strip().lower()[:60]}"
    if isinstance(action, Hotkey):
        return f"hotkey:{extra or ''}:{action.combo.strip().lower()}"
    if isinstance(action, ListFiles):
        return f"list_files:{action.path.strip()}"
    if isinstance(action, ReadFile):
        return f"read_file:{action.path.strip()}:{action.offset}"
    if isinstance(action, WriteFile):
        return f"write_file:{action.path.strip()}"
    if isinstance(action, RunCommand):
        return f"run_command:{action.cwd.strip()}:{' '.join(action.argv)}"
    if isinstance(action, Task):
        return f"task:{action.title.strip().lower()}"
    if isinstance(action, Package):
        return f"package:{action.name.strip().lower()}"
    if isinstance(action, Provider):
        return f"provider:{action.name.strip().lower()}"
    if isinstance(action, Message):
        return f"message:{action.to.strip().lower()}:{action.text.strip().lower()[:60]}"
    if isinstance(action, ReviseGoal):
        return f"revise_goal:{action.goal.strip().lower()[:60]}"
    if isinstance(action, ProposeTeammate):
        return f"propose_teammate:{action.role.strip().lower()[:60]}"
    if isinstance(action, PublishPackage):
        return f"publish_package:{action.name.strip().lower()}"
    if isinstance(action, UpdateTask):
        return f"update_task:{action.title.strip().lower()}"
    if isinstance(action, Lead):
        return f"lead:{action.website.strip().lower()}"
    if isinstance(action, UpdateLead):
        return f"update_lead:{action.name.strip().lower()}"
    return action.type


def dump_action(action: Action) -> str:
    return json.dumps(action.model_dump(), ensure_ascii=False)
