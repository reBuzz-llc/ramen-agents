"""The CEO fixes its own tasks on the board (update_task) and a fuller package replaces its toggle (Plan 9 item 4)."""
from __future__ import annotations

import json

from explorer.actions import Decision, MergeTask, Task, UpdateTask
from explorer.config import PackagesConfig, TasksConfig, PolicyConfig
from explorer.model import ModelResult
from explorer.board import FakeBoard, page_id_from_url
from explorer.policy import Denylist, Policy, PolicyContext
from explorer.team import Member

from conftest import make_controller


def upd(**over) -> UpdateTask:
    spec = dict(type="update_task", title="Build the Springfield target list", due="2026-10-06")
    spec.update(over)
    return UpdateTask(**spec)


def ctx(**over) -> PolicyContext:
    base = dict(mode="web", current_page=None, actions_in_episode=0, pages_last_hour=0, open_questions=0,
                last_visit_by_domain={}, recent_task_titles={"build the springfield target list"})
    base.update(over)
    return PolicyContext(**base)


def test_ids_come_out_of_board_urls():
    assert page_id_from_url("http://127.0.0.1:3000/tasks/0123456789abcdef0123456789abcdef") == "01234567-89ab-cdef-0123-456789abcdef"
    assert page_id_from_url("https://portal.example/leads/0123456789abcdef0123456789abcdef?tab=1") == "01234567-89ab-cdef-0123-456789abcdef"
    assert page_id_from_url("https://board.fake/task-1") is None


def test_policy_only_fixes_the_bots_own_tasks_with_real_changes():
    off = Policy(PolicyConfig(), Denylist())
    assert "not enabled" in off.check(upd(), ctx()).reason
    policy = Policy(PolicyConfig(), Denylist(), tasks=TasksConfig(enabled=True), packages=PackagesConfig())
    assert policy.check(upd(), ctx()).allowed
    assert "task you created" in policy.check(upd(title="Someone else's task"), ctx()).reason
    assert "at least one change" in policy.check(upd(due=None), ctx()).reason
    assert "P0 to P6" in policy.check(upd(priority="urgent"), ctx()).reason
    assert "date like" in policy.check(upd(due="next week"), ctx()).reason
    team = [Member(id="u1", name="Jo", email="s@x", role="Marketing", details="", default=True)]
    assert policy.check(upd(assignee="Bob"), ctx(team=team)).allowed  # owner, 2026-09-28: any assignee; the board leaves assignees to the team
    assert policy.check(upd(assignee="Jo"), ctx(team=team)).allowed
    assert "two tasks this episode" in policy.check(upd(), ctx(task_updates_in_episode=2)).reason
    assert policy.check(upd(due=None, details_append="### Done when\n- [ ] The list has 50 names."), ctx()).allowed


class FixesItsTask:
    """Creates a task, then fixes its deadline and appends a checklist."""

    def __init__(self):
        self.step = 0

    def decide(self, system, obs):
        self.step += 1
        if self.step == 1:
            action = Task(type="task", title="Build the Springfield target list", details="### Why\n\nWe need names. " * 30, priority="P3")
        else:
            action = upd(assignee="Jo", details_append="### Done when\n- [ ] 50 named founders with a reason each.")
        return ModelResult(decision=Decision(thought="fix", action=action))

    def complete(self, system, prompt):
        return "summary"


def test_the_controller_updates_the_task_and_its_own_record(cfg):
    cfg.tasks, cfg.packages = TasksConfig(enabled=True, team_file=str(cfg.root / "no-team.json")), PackagesConfig()  # never the live team list
    fake = FakeBoard()
    ctl = make_controller(cfg, model=FixesItsTask(), board=fake)
    ctl.run(max_cycles=2)
    rows = ctl.memory.db.query("SELECT action_type, verdict, result FROM actions ORDER BY id")
    assert [(r["action_type"], r["verdict"]) for r in rows] == [("task", "allowed"), ("update_task", "allowed")]
    assert "updated task 'Build the Springfield target list' (due, details)" in rows[1]["result"]
    assert fake.updates == [{"page_id": "00000000-0000-0000-0000-000000000001", "assignee": None, "priority": None,
                             "due": "2026-10-06", "details_append": "### Done when\n- [ ] 50 named founders with a reason each."}]
    task = ctl.memory.find_task("build the springfield target list")
    assert task["due"] == "2026-10-06"   # queue 572: the assignee is the team's cell; the bot never sets it


# ---- a fuller package replaces its toggle -------------------------------------------------------------------

def test_republish_is_allowed_only_for_a_toggle_that_lacked_the_company():
    from test_publish_package import pub, ctx as pctx

    on = Policy(PolicyConfig(), Denylist(), tasks=TasksConfig(enabled=True), packages=PackagesConfig(enabled=True))
    dup = on.check(pub(), pctx(published_package_names={"mvp launch starter"}))
    assert not dup.allowed and dup.permanent and "source-company facts" in dup.reason
    again = on.check(pub(), pctx(published_package_names={"mvp launch starter"}, republishable_package_names={"mvp launch starter"}))
    assert again.allowed


def test_the_ceo_replaces_the_old_toggle_when_the_package_comes_back_with_a_company(cfg, tmp_path):
    from explorer.actions import PublishPackage, SourceCompany
    from explorer.config import HandoffConfig
    from explorer.handoff import send_package
    from test_handoff import package

    cfg.tasks, cfg.packages = TasksConfig(enabled=True), PackagesConfig(enabled=True)
    fake = FakeBoard()
    ceo = cfg.root
    # First hand-over: no source company. The CEO publishes it.
    send_package(HandoffConfig(enabled=True, to_name="The CEO", to_folder=str(ceo)), "Package Designer",
                 package(source_company=SourceCompany()))

    class Publishes:
        def decide(self, system, obs):
            return ModelResult(decision=Decision(thought="p", action=PublishPackage(
                type="publish_package", name="MVP Launch Starter", title="Ship your MVP", email="Hi,\n\nOffer.", conclusion="")))

        def complete(self, system, prompt):
            return "summary"

    def run_one(model):  # each publish in its own episode (one publish_package per episode is the rule)
        ctl = make_controller(cfg, model=model, board=fake)
        ctl.run(max_cycles=1)
        ep = ctl.memory.current_episode()
        if ep is not None:
            ctl.memory.end_episode(ep["id"], None, status="abandoned")
        return ctl

    ctl = run_one(Publishes())
    assert len(fake.toggles) == 1 and fake.deleted == []
    blocks = json.loads(ctl.memory.db.get_state("published_package_blocks", "{}"))
    rec = blocks["mvp launch starter"]
    assert (rec["block_id"], rec["has_company"], rec["title"]) == ("toggle-1", False, "Ship your MVP")
    assert rec["package"]["name"] == "MVP Launch Starter" and rec["format_version"] == 1
    # Same name again, still without a company: refused as a duplicate.
    ctl2 = run_one(Publishes())
    assert "already on the packages page" in ctl2.memory.db.query("SELECT verdict FROM actions ORDER BY id DESC LIMIT 1")[0]["verdict"]
    assert len(fake.toggles) == 1
    # The Package Designer re-sends it with the agency's facts: the CEO replaces the toggle.
    send_package(HandoffConfig(enabled=True, to_name="The CEO", to_folder=str(ceo)), "Package Designer",
                 package(source_company=SourceCompany(name="Example Studio", website="https://example.com", founded="2019")))
    ctl3 = run_one(Publishes())
    last = ctl3.memory.db.query("SELECT verdict, result FROM actions ORDER BY id DESC LIMIT 1")[0]
    assert last["verdict"] == "allowed" and last["result"].startswith("replaced on the packages page")
    assert fake.deleted == ["toggle-1"] and len(fake.toggles) == 2
    assert ("Company", "Example Studio") in fake.toggles[1]["company"] and ("Founded", "2019") in fake.toggles[1]["company"]
    blocks = json.loads(ctl3.memory.db.get_state("published_package_blocks", "{}"))
    assert blocks["mvp launch starter"]["has_company"] is True and blocks["mvp launch starter"]["block_id"] == "toggle-2"


def test_the_designer_may_resend_a_company_less_package_once_it_has_the_company():
    from explorer.config import HandoffConfig
    from test_handoff import package, ctx as hctx

    policy = Policy(PolicyConfig(), Denylist(),
                    handoff=HandoffConfig(enabled=True, to_name="The CEO", to_folder="/tmp/x"))
    sent = {"mvp launch starter"}
    # The helper package() carries a source company; the same name again is a duplicate unless the earlier one had none.
    assert not policy.check(package(), hctx(recent_package_names=sent)).allowed
    assert policy.check(package(), hctx(recent_package_names=sent, recent_packages_without_company=sent)).allowed
    assert policy.check(package(name="MVP Launch Starter v2"), hctx(recent_package_names=sent, recent_packages_without_company=sent)).allowed is False


class MergesTwice:
    """Creates two outreach tasks, tries to merge the first into the second (one email missing), then fixes and merges."""

    def __init__(self):
        self.step = 0

    def decide(self, system, obs):
        from explorer.actions import MergeTask

        self.step += 1
        long = "### Why\nOutreach. " * 30
        actions = {
            1: Task(type="task", title="Outreach: Maple Diner and 1 more", details=long + "\n- Maple Diner: hello@maplediner.example\n- Cedar Dental: info@cedardental.example", priority="P3"),
            2: Task(type="task", title="Contact list for the week of October 6", details=long + "\n- Maple Diner: hello@maplediner.example", priority="P3"),
            3: MergeTask(type="merge_task", title="Outreach: Maple Diner and 1 more", into="Contact list for the week of October 6"),
            4: upd(title="Contact list for the week of October 6", details_append="- Cedar Dental: info@cedardental.example"),
            5: MergeTask(type="merge_task", title="Outreach: Maple Diner and 1 more", into="Contact list for the week of October 6"),
        }
        return ModelResult(decision=Decision(thought="tidy", action=actions.get(self.step, upd(title="x"))))

    def complete(self, system, prompt):
        return "summary"


def test_merging_tasks_is_not_offered(cfg):
    """Queue 572: a task's status is the team's cell on the board, so a bot never closes a task by merging."""
    cfg.tasks.enabled = True
    c = make_controller(cfg, board=FakeBoard())
    assert "merge_task" not in c.system
    ep = c.memory.episode(c.memory.start_episode())
    r = c._execute(MergeTask(type="merge_task", title="A", into="B"), ep, None)
    assert not r.ok and "not enabled" in r.summary
