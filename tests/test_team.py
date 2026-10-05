"""The owner's team list (team.py, common-data/team.json, edited in the dashboard): who a bot may
assign Notion tasks to. With a list, every task ends up with one of those people."""

import json

from explorer.actions import Decision, Task
from explorer.config import NotionConfig, PolicyConfig, PublishConfig
from explorer.model import ModelResult
from explorer.notion import FakeNotion
from explorer.policy import Denylist, Policy, PolicyContext
from explorer.team import Member, default_member, find_member, load_team, team_block

from conftest import DENYLIST, make_controller

TEAM = [
    Member("u-alex", "Alex Stone", "alex@acmestudio.com", "Springfield representative", "meets clients in person", False),
    Member("u-sam", "Sam Rai", "sam@acmestudio.com", "Springfield representative", "", False),
    Member("u-mkt", "Marketing Lead", "mkt@acmestudio.com", "Marketing", "outreach, content, website", True),
]


def write_team(path, members=TEAM):
    path.write_text(json.dumps({"version": 1, "members": [
        {"notionId": m.notion_id, "name": m.name, "email": m.email, "role": m.role, "details": m.details, "default": m.default}
        for m in members
    ]}))


def test_members_match_by_full_name_first_name_or_email():
    assert find_member(TEAM, "Alex Stone") is TEAM[0]
    assert find_member(TEAM, "alex") is TEAM[0]
    assert find_member(TEAM, "SAM@acmestudio.com") is TEAM[1]
    assert find_member(TEAM, "Ash") is None
    assert find_member(TEAM, "") is None
    assert default_member(TEAM) is TEAM[2]
    assert default_member(TEAM[:2]) is None  # two people, nobody marked: no guess
    assert default_member(TEAM[:1]) is TEAM[0]  # a team of one is the default


def test_a_broken_or_missing_file_is_an_empty_team(tmp_path):
    assert load_team(tmp_path / "nope.json") == []
    (tmp_path / "bad.json").write_text("{not json")
    assert load_team(tmp_path / "bad.json") == []
    (tmp_path / "half.json").write_text(json.dumps({"members": [{"name": "No id"}, {"notionId": "u1", "name": "Ok"}]}))
    assert [m.name for m in load_team(tmp_path / "half.json")] == ["Ok"]


def test_the_prompt_block_names_everyone_and_the_default():
    block = team_block(TEAM)
    assert "Alex Stone: Springfield representative -- meets clients in person" in block
    assert "Marketing Lead (default" in block
    assert team_block([]) == ""


def policy():
    return Policy(PolicyConfig(), PublishConfig(), Denylist.load(DENYLIST), notion=NotionConfig(enabled=True, database_id="db"))


def ctx(**kw):
    base = dict(mode="fake", current_page=None, actions_in_episode=0, pages_last_hour=0, open_questions=0, last_visit_by_domain={})
    return PolicyContext(**base, **kw)


def test_an_assignee_off_the_team_is_refused_but_a_blank_one_is_not():
    details = "why now, the steps, the specifics, and what done looks like " * 3
    off = Task(type="task", title="Call the prospect", details=details, assignee="Ash")
    verdict = policy().check(off, ctx(team=TEAM))
    assert verdict.allowed  # owner, 2026-09-28: "let ceoA assign task to any one or no one"
    assert policy().check(Task(type="task", title="Call the prospect", details=details, assignee="alex"), ctx(team=TEAM)).allowed
    assert policy().check(Task(type="task", title="Call the prospect", details=details, assignee=None), ctx(team=TEAM)).allowed
    assert policy().check(off, ctx(team=[])).allowed  # no list: any name, as before


class TaskModel:
    def __init__(self, assignee, title="Meet the prospect"):
        self.assignee = assignee
        self.title = title

    def decide(self, system, obs):
        details = "why now, the steps, the specifics from notes, and what done looks like " * 3
        return ModelResult(decision=Decision(thought="x", action=Task(type="task", title=self.title, details=details, assignee=self.assignee)))

    def complete(self, system, prompt):
        return "summary"


def test_tasks_keep_no_assignee_and_names_are_made_canonical(cfg, tmp_path):
    cfg.notion.enabled = True
    cfg.notion.database_id = "db"
    cfg.notion.team_file = str(tmp_path / "team.json")
    write_team(tmp_path / "team.json")
    notion = FakeNotion()
    controller = make_controller(cfg, model=TaskModel(None), notion=notion)
    assert "## Team" in controller.system and "Marketing Lead" in controller.system
    controller.run(max_cycles=1)
    assert notion.tasks[-1]["assignee"] in (None, "")  # owner, 2026-09-28: no assignee stays no assignee (no forced default)
    controller.memory.end_episode(controller.memory.current_episode()["id"], "done")  # one task per episode
    controller = make_controller(cfg, model=TaskModel("alex", "Book the discovery meeting"), notion=FakeNotion())
    controller.run(max_cycles=1)
    assert controller.notion.tasks[-1]["assignee"] == "Alex Stone"  # a first name -> the full name


def test_the_team_file_is_reread_when_it_changes(cfg, tmp_path):
    cfg.notion.enabled = True
    cfg.notion.database_id = "db"
    cfg.notion.team_file = str(tmp_path / "team.json")
    controller = make_controller(cfg, model=TaskModel(None), notion=FakeNotion())
    assert "## Team" not in controller.system  # no file yet
    write_team(tmp_path / "team.json")
    import os
    os.utime(tmp_path / "team.json", (1, 1))  # a clearly different mtime
    controller.run(max_cycles=1)  # a new episode starts: the list is picked up without a restart
    assert "Sam Rai" in controller.system
    assert controller.notion.tasks[-1]["assignee"] in (None, "")  # owner, 2026-09-28: no forced default; the team list still reaches the prompt


def test_notion_client_resolves_team_members_before_the_workspace():
    from explorer.notion import NotionClient

    client = NotionClient(NotionConfig(enabled=True, database_id="db"), api_key="k")
    client._users = {"alex stone": "ws-alex", "someone else": "ws-x"}
    client.set_team(TEAM)
    assert client.resolve_user("alex") == "u-alex"  # the owner's pick wins over the workspace guess
    assert client.resolve_user("someone else") == "ws-x"
