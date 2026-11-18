"""Tasks on the team's board (queue 572: in place of Notion): the policy's task rules and the controller's task skill,
against the offline FakeBoard."""
from __future__ import annotations

import pytest

from explorer.actions import Task
from explorer.config import PackagesConfig, TasksConfig, PolicyConfig
from explorer.board import FakeBoard
from explorer.policy import Denylist, Policy, PolicyContext

from conftest import DENYLIST, make_controller

def make_policy(tasks: TasksConfig | None = None) -> Policy:
    return Policy(PolicyConfig(), Denylist.load(DENYLIST), tasks=tasks)


def ctx(**over) -> PolicyContext:
    base = dict(mode="web", current_page=None, actions_in_episode=0, pages_last_hour=0, open_questions=0, last_visit_by_domain={})
    base.update(over)
    return PolicyContext(**base)


def task(**over) -> Task:
    base = dict(type="task", title="Draft the pricing page", details="because")
    base.update(over)
    return Task(**base)


def test_task_does_not_exist_unless_tasks_are_enabled():
    assert not make_policy(None).check(task(), ctx()).allowed
    assert not make_policy(TasksConfig(enabled=False)).check(task(), ctx()).allowed
    assert make_policy(TasksConfig(enabled=True)).check(task(), ctx()).allowed


def test_task_caps_priority_and_dedupe():
    policy = make_policy(TasksConfig(enabled=True, max_per_episode=1, max_per_day=3))
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
    policy = make_policy(TasksConfig(enabled=True, min_details_chars=300))
    thin = policy.check(task(details="because it matters for SPF clients"), ctx())
    assert not thin.allowed and "too thin" in thin.reason and "300" in thin.reason
    assert policy.check(task(details="x" * 300), ctx()).allowed
    # No minimum by default: a short brief still passes.
    assert make_policy(TasksConfig(enabled=True)).check(task(details="short"), ctx()).allowed


# ---- controller ------------------------------------------------------------


def test_episodes_without_a_task_earn_a_nudge_that_a_task_resets(cfg):
    cfg.tasks.enabled = True
    cfg.tasks.nudge_after_episodes = 2
    controller = make_controller(cfg, board=FakeBoard())
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

    # Without the task board there is nothing to nudge toward.
    cfg.tasks.enabled = False
    quiet = make_controller(cfg)
    for _ in range(3):
        quiet.memory.end_episode(quiet.memory.start_episode(), "done")
    quiet.feedback = None
    quiet._ensure_episode()
    assert quiet.feedback is None


def test_controller_creates_a_task_records_it_and_refuses_a_second_one(cfg):
    cfg.tasks.enabled = True
    board = FakeBoard()
    controller = make_controller(cfg, board=board)
    ep = controller.memory.episode(controller.memory.start_episode())
    assert ep is not None
    assert "task:" in controller.system.split("Actions (choose")[1]

    result = controller._execute(task(assignee="Jane Park", priority="P1"), ep, None)
    assert result.ok and "/task-1" in result.summary
    assert board.tasks[0]["assignee"] is None   # queue 572: assignees are the team's cell on the board
    rows = controller.memory.recent_tasks(5)
    assert rows[0]["title"] == "Draft the pricing page" and rows[0]["url"].endswith("task-1")
    assert "Draft the pricing page" in controller.memory.journal_path().read_text()

    context = controller._policy_context(ep)
    assert context.tasks_in_episode == 1 and context.tasks_today == 1
    assert not controller.policy.check(task(title="Another"), context).allowed
    assert not controller.policy.check(task(), context).allowed


def test_unresolved_assignee_warning_reaches_the_model(cfg):
    cfg.tasks.enabled = True

    class WarningBoard(FakeBoard):
        def create_task(self, *a, **k):
            url = super().create_task(*a, **k)
            self.last_warnings = ["no workspace user matches 'Marketing team'; left unassigned"]
            return url

    controller = make_controller(cfg, board=WarningBoard())
    ep = controller.memory.episode(controller.memory.start_episode())
    result = controller._execute(task(assignee="Marketing team"), ep, None)
    assert result.ok and "left unassigned" in (result.feedback or "")


def test_controller_without_a_board_has_no_task_help(cfg):
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


def test_no_bot_write_carries_the_human_only_result_columns():
    from explorer.board import FakeBoard, _without_human_columns

    assert _without_human_columns({"Website": "x", "Result": "Client", "Result date": "2026-10-06"}) == {"Website": "x"}
    fake = FakeBoard()
    fake.create_row("Maple Diner", {"Website": "https://maplediner.example", "Result": "Client"})
    assert "Result" not in fake.rows[0]


def test_one_task_a_day_and_the_rest_goes_into_it(tmp_path):
    """creatorCC queue 5, 2026-10-28: The CEO made hundreds of refused task attempts in a week; with a cap of 1 it adds to its task."""
    import datetime as dt

    from explorer.actions import UpdateTask
    from explorer.db import Database
    from explorer.memory import Memory

    policy = make_policy(TasksConfig(enabled=True, max_per_day=1))
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
