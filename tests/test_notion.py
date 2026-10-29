"""Notion tasks: the client's request shape against a mocked API, the policy caps, and the loop.

The board shape follows the owner's notionGuide.md: Task / Status (Not started...) / Priority
(P0-P6) / Assign (people) / Dead Line.
"""
from __future__ import annotations

import json

import httpx
import pytest

from explorer.actions import Task
from explorer.config import NotionConfig, PolicyConfig, PublishConfig
from explorer.notion import LEAD_COLUMNS, PRIORITY_OPTIONS, STATUS_OPTIONS, FakeNotion, NotionClient, NotionError
from explorer.policy import Denylist, Policy, PolicyContext

from conftest import DENYLIST, make_controller

SCHEMA = {
    "properties": {
        "Task": {"type": "title"},
        "Status": {"type": "status"},
        "Assign": {"type": "people"},
        "Priority": {"type": "select"},
        "Dead Line": {"type": "date"},
        "Blocker": {"type": "rich_text"},
    }
}
USERS = {
    "results": [
        {"object": "user", "type": "person", "id": "u-jane", "name": "Jane Park"},
        {"object": "user", "type": "person", "id": "u-pukar", "name": "Pukar Khanal"},
        {"object": "user", "type": "bot", "id": "u-bot", "name": "bot connection"},
    ],
    "has_more": False,
}


def make_client(handler, **over) -> NotionClient:
    cfg = NotionConfig(enabled=True, database_id="db123", **over)
    return NotionClient(cfg, "ntn_test", transport=httpx.MockTransport(handler))


def api(schema=SCHEMA, page_status=200, page_body=None, record=None, users=USERS):
    def handler(request: httpx.Request) -> httpx.Response:
        if record is not None:
            record.append(request)
        if request.method == "GET" and request.url.path == "/v1/databases/db123":
            return httpx.Response(200, json=schema)
        if request.method == "GET" and request.url.path == "/v1/users":
            return httpx.Response(200, json=users)
        if request.method == "POST" and request.url.path == "/v1/pages":
            return httpx.Response(page_status, json=page_body or {"url": "https://www.notion.so/page-1"})
        if request.method == "POST" and request.url.path == "/v1/databases":
            return httpx.Response(200, json={"id": "new-db", "url": "https://www.notion.so/new-db"})
        return httpx.Response(404, json={"message": "no"})

    return handler


def test_create_task_follows_the_canonical_board():
    seen: list[httpx.Request] = []
    client = make_client(api(record=seen))
    url = client.create_task("Draft the pricing page", "Why: ...\nDone looks like: ...", assignee="Jane Park", priority="P1", due="2026-09-30")
    assert url == "https://www.notion.so/page-1"
    post = next(r for r in seen if r.method == "POST")
    assert post.headers["authorization"] == "Bearer ntn_test"
    body = json.loads(post.content)
    props = body["properties"]
    assert props["Task"]["title"][0]["text"]["content"] == "Draft the pricing page"
    assert props["Status"] == {"status": {"name": "Not started"}}
    assert props["Priority"] == {"select": {"name": "P1"}}
    assert props["Assign"] == {"people": [{"id": "u-jane"}]}
    assert props["Dead Line"] == {"date": {"start": "2026-09-30"}}
    assert client.last_warnings == []
    assert sum(1 for r in seen if r.url.path == "/v1/users") == 1  # users cached


def test_every_task_links_to_the_default_project_when_the_relation_exists():
    schema = {"properties": {**SCHEMA["properties"], "Projects": {"type": "relation"}}}
    seen: list[httpx.Request] = []
    make_client(api(schema=schema, record=seen), default_project_id="proj-ny").create_task("A", "b")
    props = json.loads(next(r for r in seen if r.method == "POST").content)["properties"]
    assert props["Projects"] == {"relation": [{"id": "proj-ny"}]}
    ok, text = make_client(api(schema=schema)).available()
    assert ok and "no default_project_id" in text
    seen.clear()
    make_client(api(record=seen), default_project_id="proj-ny").create_task("A", "b")  # no relation on the board
    assert "Projects" not in json.loads(next(r for r in seen if r.method == "POST").content)["properties"]


def test_assignee_is_resolved_by_name_or_left_unassigned_with_a_warning():
    seen: list[httpx.Request] = []
    client = make_client(api(record=seen))
    client.create_task("A", "b", assignee="pukar")  # unambiguous partial, any case
    props = json.loads([r for r in seen if r.method == "POST"][-1].content)["properties"]
    assert props["Assign"] == {"people": [{"id": "u-pukar"}]}

    client.create_task("B", "b", assignee="Marketing team")
    props = json.loads([r for r in seen if r.method == "POST"][-1].content)["properties"]
    assert "Assign" not in props
    assert client.last_warnings == ["no workspace user matches 'Marketing team'; left unassigned"]


def test_drifted_board_names_still_work_and_missing_ones_are_skipped():
    schema = {"properties": {"Task name": {"type": "title"}, "Assignee": {"type": "rich_text"}, "Due date": {"type": "date"}}}
    seen: list[httpx.Request] = []
    client = make_client(api(schema=schema, record=seen), assignee_property="Assignee", due_property="Due date")
    client.create_task("A", "b", assignee="Anyone", priority="P2", due="2026-01-01")
    props = json.loads(next(r for r in seen if r.method == "POST").content)["properties"]
    assert set(props) == {"Task name", "Assignee", "Due date"}
    ok, text = client.available()
    assert ok and "'Task name'" in text and "no 'Status' property, skipped" in text


def test_two_people_properties_are_flagged_by_available():
    schema = {"properties": {"Task": {"type": "title"}, "Assign": {"type": "people"}, "Assigned to": {"type": "people"}}}
    ok, text = make_client(api(schema=schema)).available()
    assert ok and "WARNING 2 people properties" in text


def test_bad_inputs_and_errors_become_plain_reasons():
    with pytest.raises(NotionError, match="P0 to P6"):
        make_client(api()).create_task("A", "b", priority="High")
    with pytest.raises(NotionError, match="due must be"):
        make_client(api()).create_task("A", "b", due="soon")
    with pytest.raises(NotionError, match="token"):
        make_client(lambda r: httpx.Response(401, json={})).create_task("A", "b")
    with pytest.raises(NotionError, match="share the page or database"):
        make_client(lambda r: httpx.Response(404, json={})).create_task("A", "b")
    with pytest.raises(NotionError, match="validation failed"):
        make_client(api(page_status=400, page_body={"message": "validation failed"})).create_task("A", "b")

    def boom(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("down")

    ok, text = make_client(boom).available()
    assert not ok and "unreachable" in text


def test_create_board_sends_the_canonical_properties_and_lists_the_manual_steps():
    seen: list[httpx.Request] = []
    client = make_client(api(record=seen))
    database_id, url, followups = client.create_board("0" * 32, "CEO Task", "ceo", registry_id="reg-1")
    assert database_id == "new-db" and url.endswith("new-db")
    body = json.loads(next(r for r in seen if r.url.path == "/v1/databases").content)
    assert body["parent"] == {"type": "page_id", "page_id": "0" * 32}
    props = body["properties"]
    assert "Task" in props and "title" in props["Task"]
    assert [o["name"] for o in props["Priority"]["select"]["options"]] == PRIORITY_OPTIONS
    assert props["Assign"] == {"people": {}} and props["Dead Line"] == {"date": {}}
    assert props["ID"] == {"unique_id": {"prefix": "CEO"}}
    assert props["Projects"]["relation"]["database_id"] == "reg-1"
    assert "Status" not in props  # the API cannot create status properties
    assert any("Status" in f and STATUS_OPTIONS[0] in f for f in followups)


def test_create_board_falls_back_to_base_properties_when_optional_ones_are_refused():
    calls: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1/databases":
            body = json.loads(request.content)
            calls.append(body)
            if "ID" in body["properties"]:
                return httpx.Response(400, json={"message": "unique_id cannot be created"})
            return httpx.Response(200, json={"id": "new-db", "url": "u"})
        return httpx.Response(404, json={})

    _, _, followups = make_client(handler).create_board("0" * 32, "B", "b", registry_id="reg")
    assert len(calls) == 2 and "ID" not in calls[1]["properties"] and "Projects" not in calls[1]["properties"]
    assert any("ID property" in f for f in followups) and any("Projects relation" in f for f in followups)


def test_new_api_version_uses_data_sources():
    """From 2025-09-03 the schema lives on the data source and pages are parented to it."""
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if request.url.path == "/v1/data_sources/ds1" and request.method == "GET":
            return httpx.Response(200, json=SCHEMA)
        if request.url.path == "/v1/data_sources/ds1" and request.method == "PATCH":
            return httpx.Response(200, json={"properties": {"Task": {"type": "title"}}})
        if request.url.path == "/v1/users":
            return httpx.Response(200, json=USERS)
        if request.url.path == "/v1/pages":
            return httpx.Response(200, json={"url": "https://www.notion.so/p"})
        if request.url.path == "/v1/databases":
            return httpx.Response(200, json={"id": "db-new", "url": "u", "data_sources": [{"id": "ds-new", "name": "T"}]})
        return httpx.Response(404, json={"message": "no"})

    cfg = NotionConfig(enabled=True, database_id="ds1", api_version="2025-09-03")
    client = NotionClient(cfg, "k", transport=httpx.MockTransport(handler))
    assert client.new_api
    client.create_task("A", "b", assignee="Jane Park")
    post = next(r for r in seen if r.url.path == "/v1/pages")
    assert json.loads(post.content)["parent"] == {"type": "data_source_id", "data_source_id": "ds1"}
    assert post.headers["notion-version"] == "2025-09-03"

    gets_before = sum(1 for r in seen if r.method == "GET" and r.url.path == "/v1/data_sources/ds1")
    new_schema = client.update_properties({"Task name": {"name": "Task"}})
    patch = next(r for r in seen if r.method == "PATCH")
    assert json.loads(patch.content) == {"properties": {"Task name": {"name": "Task"}}}
    gets_after = sum(1 for r in seen if r.method == "GET" and r.url.path == "/v1/data_sources/ds1")
    assert gets_after == gets_before + 1  # the schema is re-read after the change, not trusted from the PATCH
    assert new_schema == {k: v["type"] for k, v in SCHEMA["properties"].items()}

    board_id, _, _ = client.create_board("0" * 32, "B", "b")
    create = next(r for r in seen if r.url.path == "/v1/databases")
    assert "initial_data_source" in json.loads(create.content)
    assert board_id == "ds-new"


# ---- policy ----------------------------------------------------------------


def make_policy(notion: NotionConfig | None = None) -> Policy:
    return Policy(PolicyConfig(), PublishConfig(), Denylist.load(DENYLIST), notion=notion)


def ctx(**over) -> PolicyContext:
    base = dict(mode="web", current_page=None, actions_in_episode=0, pages_last_hour=0, open_questions=0, last_visit_by_domain={})
    base.update(over)
    return PolicyContext(**base)


def task(**over) -> Task:
    base = dict(type="task", title="Draft the pricing page", details="because")
    base.update(over)
    return Task(**base)


def test_task_does_not_exist_unless_notion_is_enabled():
    assert not make_policy(None).check(task(), ctx()).allowed
    assert not make_policy(NotionConfig(enabled=False)).check(task(), ctx()).allowed
    assert make_policy(NotionConfig(enabled=True, database_id="x")).check(task(), ctx()).allowed


def test_task_caps_priority_and_dedupe():
    policy = make_policy(NotionConfig(enabled=True, database_id="x", max_tasks_per_episode=1, max_tasks_per_day=3))
    assert not policy.check(task(title=" "), ctx()).allowed
    assert not policy.check(task(details=""), ctx()).allowed
    assert not policy.check(task(due="next week"), ctx()).allowed
    assert not policy.check(task(priority="high"), ctx()).allowed
    assert policy.check(task(priority="p0"), ctx()).allowed
    assert not policy.check(task(), ctx(tasks_in_episode=1)).allowed
    assert not policy.check(task(), ctx(tasks_today=3)).allowed
    dup = policy.check(task(), ctx(recent_task_titles={"draft the pricing page"}))
    assert not dup.allowed and dup.permanent and "already created" in dup.reason


def test_min_details_chars_refuses_a_thin_task():
    """With a minimum, a one-liner task is refused so tasks are full, executable briefs."""
    policy = make_policy(NotionConfig(enabled=True, database_id="x", min_details_chars=300))
    thin = policy.check(task(details="because it matters for SPF clients"), ctx())
    assert not thin.allowed and "too thin" in thin.reason and "300" in thin.reason
    assert policy.check(task(details="x" * 300), ctx()).allowed
    # No minimum by default: a short brief still passes.
    assert make_policy(NotionConfig(enabled=True, database_id="x")).check(task(details="short"), ctx()).allowed


# ---- controller ------------------------------------------------------------


def test_episodes_without_a_task_earn_a_nudge_that_a_task_resets(cfg):
    cfg.notion.enabled = True
    cfg.notion.database_id = "db123"
    cfg.notion.nudge_after_episodes = 2
    controller = make_controller(cfg, notion=FakeNotion())
    memory = controller.memory
    for _ in range(2):
        memory.end_episode(memory.start_episode(), "done")
    assert memory.episodes_since_last_task() == 2
    controller.feedback = None
    ep = controller._ensure_episode()
    assert controller.feedback is not None and "2 episodes without creating a task" in controller.feedback
    assert "Possible task:" in controller.feedback

    controller._execute(task(), ep, None)
    memory.end_episode(ep["id"], "done")
    assert memory.episodes_since_last_task() == 0
    controller.feedback = None
    controller._ensure_episode()
    assert controller.feedback is None  # a task was just made; no nudge

    # Without Notion there is nothing to nudge toward.
    cfg.notion.enabled = False
    quiet = make_controller(cfg)
    for _ in range(3):
        quiet.memory.end_episode(quiet.memory.start_episode(), "done")
    quiet.feedback = None
    quiet._ensure_episode()
    assert quiet.feedback is None


def test_controller_creates_a_task_records_it_and_refuses_a_second_one(cfg):
    cfg.notion.enabled = True
    cfg.notion.database_id = "db123"
    notion = FakeNotion()
    controller = make_controller(cfg, notion=notion)
    ep = controller.memory.episode(controller.memory.start_episode())
    assert ep is not None
    assert "task:" in controller.system.split("Actions (choose")[1]

    result = controller._execute(task(assignee="Jane Park", priority="P1"), ep, None)
    assert result.ok and "/task-1" in result.summary
    assert notion.tasks[0]["assignee"] == "Jane Park"
    rows = controller.memory.recent_tasks(5)
    assert rows[0]["title"] == "Draft the pricing page" and rows[0]["url"].endswith("task-1")
    assert "Created a task for Jane Park" in controller.memory.journal_path().read_text()

    context = controller._policy_context(ep)
    assert context.tasks_in_episode == 1 and context.tasks_today == 1
    assert not controller.policy.check(task(title="Another"), context).allowed
    assert not controller.policy.check(task(), context).allowed


def test_unresolved_assignee_warning_reaches_the_model(cfg):
    cfg.notion.enabled = True
    cfg.notion.database_id = "db123"

    class WarningNotion(FakeNotion):
        def create_task(self, *a, **k):
            url = super().create_task(*a, **k)
            self.last_warnings = ["no workspace user matches 'Marketing team'; left unassigned"]
            return url

    controller = make_controller(cfg, notion=WarningNotion())
    ep = controller.memory.episode(controller.memory.start_episode())
    result = controller._execute(task(assignee="Marketing team"), ep, None)
    assert result.ok and "left unassigned" in (result.feedback or "")


def test_controller_without_notion_has_no_task_help(cfg):
    controller = make_controller(cfg)
    assert "task:" not in controller.system.split("Actions (choose")[1]
    result = controller._execute(task(), controller.memory.episode(controller.memory.start_episode()), None)
    assert not result.ok


def test_persona_file_is_injected_into_the_prompt(cfg):
    (cfg.root / "persona.md").write_text("You are the CEO of a small company.\n\n## Team\n\n- Maya, designer\n")
    cfg.agent.persona_file = "persona.md"
    controller = make_controller(cfg)
    assert "## Who you are" in controller.system
    assert "Maya, designer" in controller.system
    assert "You roam the web because you are curious" not in controller.system
    plain = make_controller(cfg.__class__(root=cfg.root))
    assert "You roam the web because you are curious" in plain.system


def test_task_details_render_as_blocks_with_a_done_when_checklist():
    """The owner ticks acceptance criteria off in Notion: `### Done when` bullets become to_do blocks; other
    markdown becomes headings and lists; plain prose stays paragraphs (#/todo, 2026-09-22)."""
    from explorer.notion import NotionClient

    details = (
        "### Why\n\nThe MVP wins the project; the retainer keeps the client.\nSecond line of the same paragraph.\n\n"
        "### What to do\n\n1. Cover the four retainers on one page.\n2. End with one call to action.\n\n"
        "- A loose bullet outside the checklist\n\n"
        "### Done when\n\n- A one-page PDF in the shared drive.\n- [x] Sales has the retainer map.\n"
    )
    blocks = NotionClient._blocks(details)
    kinds = [b["type"] for b in blocks]
    assert kinds == ["heading_3", "paragraph", "heading_3", "numbered_list_item", "numbered_list_item",
                     "bulleted_list_item", "heading_3", "to_do", "to_do"]
    assert blocks[1]["paragraph"]["rich_text"][0]["text"]["content"] == "The MVP wins the project; the retainer keeps the client. Second line of the same paragraph."
    assert blocks[7]["to_do"] == {"rich_text": [{"type": "text", "text": {"content": "A one-page PDF in the shared drive."}}], "checked": False}
    assert blocks[8]["to_do"]["checked"] is True
    # Prose with no markup renders exactly as before: one paragraph.
    plain = NotionClient._blocks("Just a brief.\n\nWith two paragraphs.")
    assert [b["type"] for b in plain] == ["paragraph", "paragraph"]


LEADS_SCHEMA = {"properties": {c: {"type": "rich_text"} for c in LEAD_COLUMNS} | {"Business": {"type": "title"}}}


def test_columns_available_reports_a_row_board_and_its_missing_columns():
    """`bot check` on the Leads board: reachable, and which of the columns a lead fills are really there."""
    good, text = make_client(api(schema=LEADS_SCHEMA)).columns_available(LEAD_COLUMNS)
    assert good and "all 9 columns this bot fills exist" in text and "title 'Business'" in text
    thin = {"properties": {"Business": {"type": "title"}, "Website": {"type": "url"}}}
    good, text = make_client(api(schema=thin)).columns_available(LEAD_COLUMNS)
    assert good and "NOT on the board" in text and "Business email" in text and "Source pages" in text


def test_columns_available_explains_a_data_source_id_on_the_old_api_version():
    """The failure that left the owner's Leads board empty for two days: a data source id under 2022-06-28
    answers 404, and the message has to say why rather than only 'not found'."""
    def only_new_api(request):
        if request.url.path == "/v1/data_sources/db123":
            return httpx.Response(200, json=LEADS_SCHEMA)
        return httpx.Response(404, json={"message": "path not found"})

    good, text = make_client(only_new_api).columns_available(LEAD_COLUMNS)  # defaults to 2022-06-28
    assert not good and "not found" in text and 'api_version = "2025-09-03"' in text
    good, text = make_client(only_new_api, api_version="2025-09-03").columns_available(LEAD_COLUMNS)
    assert good and "all 9 columns" in text


def test_no_bot_write_carries_the_human_only_result_columns():
    from explorer.notion import FakeNotion, _without_human_columns

    assert _without_human_columns({"Website": "x", "Result": "Client", "Result date": "2026-10-06"}) == {"Website": "x"}
    fake = FakeNotion()
    fake.create_row("Maple Diner", {"Website": "https://maplediner.example", "Result": "Client"})
    assert "Result" not in fake.rows[0]


def test_one_task_a_day_and_the_rest_goes_into_it(tmp_path):
    """creatorCC queue 5, 2026-10-28: The CEO made hundreds of refused task attempts in a week; with a cap of 1 it adds to its task."""
    import datetime as dt

    from explorer.actions import UpdateTask
    from explorer.db import Database
    from explorer.memory import Memory

    policy = make_policy(NotionConfig(enabled=True, database_id="x", max_tasks_per_day=1))
    assert policy.check(task(), ctx(tasks_today=0)).allowed
    second = policy.check(task(title="Another batch"), ctx(tasks_today=1))
    assert not second.allowed and second.permanent and second.reason == "today's task exists; add to it with update_task"
    upd = policy.check(UpdateTask(type="update_task", title="Draft the pricing page", details_append="two more rows"),
                       ctx(tasks_today=1, recent_task_titles={"draft the pricing page"}))
    assert upd.allowed, upd.reason
    # the count is today's: yesterday's task does not hold today's back
    mem = Memory(Database(":memory:"), tmp_path)
    yesterday = (dt.date.today() - dt.timedelta(days=1)).isoformat() + "T23:00:00"
    mem.db.execute("INSERT INTO tasks (created_at, title, details) VALUES (?, ?, ?)", (yesterday, "old", "d"))
    assert mem.count_tasks_today() == 0
