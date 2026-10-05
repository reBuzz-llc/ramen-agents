"""The CEO fixes its own Notion tasks (update_task) and a fuller package replaces its toggle (Plan 9 item 4)."""
from __future__ import annotations

import json

from explorer.actions import Decision, Task, UpdateTask
from explorer.config import NotionConfig, PolicyConfig, PublishConfig
from explorer.model import ModelResult
from explorer.notion import FakeNotion, page_id_from_url
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


def test_page_ids_come_out_of_notion_urls():
    assert page_id_from_url("https://app.notion.com/p/Write-the-sell-sheet-afcd97e11026987aa90908803ded3dc0?v=1a2b3c4d5e6f7081") == "afcd97e1-1026-987a-a909-08803ded3dc0"
    assert page_id_from_url("https://www.notion.so/afcd97e11026987aa90908803ded3dc0") == "afcd97e1-1026-987a-a909-08803ded3dc0"
    assert page_id_from_url("https://notion.fake/task-1") is None


def test_policy_only_fixes_the_bots_own_tasks_with_real_changes():
    off = Policy(PolicyConfig(), PublishConfig(), Denylist())
    assert "not enabled" in off.check(upd(), ctx()).reason
    policy = Policy(PolicyConfig(), PublishConfig(), Denylist(), notion=NotionConfig(enabled=True, database_id="x"))
    assert policy.check(upd(), ctx()).allowed
    assert "task you created" in policy.check(upd(title="Someone else's task"), ctx()).reason
    assert "at least one change" in policy.check(upd(due=None), ctx()).reason
    assert "P0 to P6" in policy.check(upd(priority="urgent"), ctx()).reason
    assert "date like" in policy.check(upd(due="next week"), ctx()).reason
    team = [Member(notion_id="u1", name="Jo", email="s@x", role="Marketing", details="", default=True)]
    assert policy.check(upd(assignee="Bob"), ctx(team=team)).allowed  # owner, 2026-09-28: any assignee; Notion leaves an unknown one unassigned
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


def test_the_controller_updates_the_notion_page_and_its_own_record(cfg):
    cfg.notion = NotionConfig(enabled=True, database_id="db", api_key_file="/nonexistent")
    fake = FakeNotion()
    ctl = make_controller(cfg, model=FixesItsTask(), notion=fake)
    ctl.run(max_cycles=2)
    rows = ctl.memory.db.query("SELECT action_type, verdict, result FROM actions ORDER BY id")
    assert [(r["action_type"], r["verdict"]) for r in rows] == [("task", "allowed"), ("update_task", "allowed")]
    assert "updated task 'Build the Springfield target list' (assignee, due, details)" in rows[1]["result"]
    assert fake.updates == [{"page_id": "00000000-0000-0000-0000-000000000001", "assignee": "Jo", "priority": None,
                             "due": "2026-10-06", "details_append": "### Done when\n- [ ] 50 named founders with a reason each."}]
    task = ctl.memory.find_task("build the springfield target list")
    assert task["assignee"] == "Jo" and task["due"] == "2026-10-06"


# ---- a fuller package replaces its toggle -------------------------------------------------------------------

def test_republish_is_allowed_only_for_a_toggle_that_lacked_the_company():
    from test_publish_package import pub, ctx as pctx

    on = Policy(PolicyConfig(), PublishConfig(), Denylist(), notion=NotionConfig(enabled=True, database_id="x", package_page_id="pg"))
    dup = on.check(pub(), pctx(published_package_names={"mvp launch starter"}))
    assert not dup.allowed and dup.permanent and "source-company facts" in dup.reason
    again = on.check(pub(), pctx(published_package_names={"mvp launch starter"}, republishable_package_names={"mvp launch starter"}))
    assert again.allowed


def test_the_ceo_replaces_the_old_toggle_when_the_package_comes_back_with_a_company(cfg, tmp_path):
    from explorer.actions import PublishPackage, SourceCompany
    from explorer.config import HandoffConfig
    from explorer.handoff import send_package
    from test_handoff import package

    cfg.notion = NotionConfig(enabled=True, database_id="db", package_page_id="pg", api_key_file="/nonexistent")
    fake = FakeNotion()
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
        ctl = make_controller(cfg, model=model, notion=fake)
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

    policy = Policy(PolicyConfig(), PublishConfig(), Denylist(),
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


def test_the_ceo_merges_a_task_only_when_nothing_would_be_lost(cfg):
    cfg.notion = NotionConfig(enabled=True, database_id="db", api_key_file="/nonexistent", merge_status="Dublicate",
                              team_file=str(cfg.root / "no-team.json"), max_tasks_per_episode=5, max_tasks_per_day=10)
    cfg.policy.max_actions_per_episode = 10
    fake = FakeNotion()
    ctl = make_controller(cfg, model=MergesTwice(), notion=fake)
    assert "merge_task" in ctl.system
    ctl.run(max_cycles=5)
    rows = ctl.memory.db.query("SELECT action_type, verdict, result FROM actions ORDER BY id")
    merges = [r for r in rows if r["action_type"] == "merge_task"]
    assert "not merged" in merges[0]["result"] and "info@cedardental.example" in merges[0]["result"]
    assert merges[1]["result"].startswith("merged") and fake.tasks[0]["Status"] == "Dublicate" and fake.tasks[1]["Status"] == "Not started"
