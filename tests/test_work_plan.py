"""Work plans (owner, 2026-09-26): the bot's plan.json, the owner's work-plan.json in the system prompt, the allowed-now
line, and read-back after a Notion write."""
import json

from explorer.actions import Lead, Plan, Task, UpdateLead
from explorer.config import PolicyConfig, PublishConfig
from explorer.notion import FakeNotion
from explorer.plan import OwnerWorkPlan, WorkPlan
from explorer.policy import Denylist, Policy, PolicyContext

from conftest import DENYLIST, make_controller


def _policy():
    return Policy(PolicyConfig(), PublishConfig(), Denylist.load(DENYLIST))


def _ctx(plan=None, progress=None):
    c = PolicyContext(mode="web", current_page=None, actions_in_episode=0, pages_last_hour=0, open_questions=0, last_visit_by_domain={})
    c.plan, c.plan_progress_action_id = plan, progress
    return c


def test_plan_policy_new_tick_end():
    p = _policy()
    new = Plan(type="plan", task="Fill the 28 empty Leads-board cells", done_when="every cell filled or left blank with a reason", steps=["open each site", "update_lead per row"], source="priority")
    assert p.check(new, _ctx()).allowed
    assert not p.check(Plan(type="plan", task="x", done_when="", steps=["a"]), _ctx()).allowed
    plan = WorkPlan.new(new.task, new.done_when, new.steps, "priority")
    assert not p.check(new, _ctx(plan)).allowed  # one plan at a time
    assert not p.check(Plan(type="plan", tick=1), _ctx(plan, progress=None)).allowed  # nothing written yet
    assert p.check(Plan(type="plan", tick=1), _ctx(plan, progress=42)).allowed
    assert not p.check(Plan(type="plan", tick=9), _ctx(plan, progress=42)).allowed
    assert not p.check(Plan(type="plan", status="stuck"), _ctx(plan)).allowed  # a stuck plan says why
    assert p.check(Plan(type="plan", status="stuck", note="the site states no founder"), _ctx(plan)).allowed
    assert not p.check(Plan(type="plan", tick=1), _ctx(None)).allowed


def test_controller_writes_ticks_and_ends_the_plan(cfg):
    c = make_controller(cfg)
    ep = c.memory.start_episode(None)
    r = c._execute_plan(Plan(type="plan", task="List three Northside bakeries", done_when="three rows on the board", steps=["find sites", "list leads"]))
    assert r.ok and c.plan is not None and c.plan.active
    saved = json.loads((cfg.workspace / "plan.json").read_text())
    assert saved["task"] == "List three Northside bakeries" and saved["status"] == "active" and saved["steps"][0]["done"] is False
    assert c._plan_lines()[0].startswith("Your plan (own job, active): List three Northside bakeries")
    c.memory.record_action(1, ep, "note", {"type": "note"}, "", "allowed", "saved", True)  # the write behind step 1
    r = c._execute_plan(Plan(type="plan", tick=1))
    assert r.ok and "Next: step 2" in (r.feedback or "")
    saved = json.loads((cfg.workspace / "plan.json").read_text())
    assert saved["steps"][0]["done"] is True and saved["steps"][0]["done_at"] and saved["steps"][0]["by_action"] is not None
    r = c._execute_plan(Plan(type="plan", status="stuck", note="no bakery publishes an email"))
    assert r.ok and not c.plan.active and json.loads((cfg.workspace / "plan.json").read_text())["status"] == "stuck"
    assert c._plan_lines() == []  # no job on record: no nudge


def test_owner_work_plan_reaches_the_system_prompt(cfg):
    path = cfg.root.parent / "common-data" / "work-plan.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"version": 1, "bots": {cfg.root.name: {"goal": "SMB clients in Springfield",
                                "rules": [{"id": "r1", "text": "one message a day to the owner"}, {"id": "r2", "text": "no biotech"}]}}}))
    c = make_controller(cfg)
    assert "## YOUR GOAL, set by the owner" in c.system and "Goal: SMB clients in Springfield" in c.system and "- [r2] no biotech" in c.system
    # it opens the instructions, before the card, and it is in every step
    assert c.system.index("## YOUR GOAL") < c.system.index("Actions")
    assert "Owner's goal for you" in c.owner_plan.step_line() and "no biotech" in c.owner_plan.step_line()
    path.write_text(json.dumps({"version": 1, "bots": {cfg.root.name: {"goal": "Northside only", "rules": []}}}))
    import os, time
    os.utime(path, (time.time() + 5, time.time() + 5))
    assert c.owner_plan.refresh() and "Goal: Northside only" in c.owner_plan.block()
    path.unlink()


def test_allowed_now_lists_caps_and_counts(cfg):
    cfg.policy.max_says_per_day = 1
    c = make_controller(cfg)
    eid = c.memory.start_episode(None)
    c.memory.record_action(1, eid, "say", {"type": "say", "to": "owner", "text": "hi"}, "", "allowed", "told", True)
    ep = c.memory.current_episode()
    lines = c._allowed_now(ep)
    assert lines[0].startswith("today is ") and lines[1].startswith("actions left this episode:")
    assert "NOT NOW say to owner: 1/1 today" in lines


def test_readback_failure_makes_the_write_fail(cfg):
    notion = FakeNotion()
    cfg.leads.enabled = True
    c = make_controller(cfg, notion=notion, leads_notion=notion)
    ep = c.memory.current_episode() or c.memory.db.query("SELECT * FROM episodes ORDER BY id DESC LIMIT 1")
    eid = c.memory.start_episode(None)
    ep = c.memory.current_episode()
    lead = Lead(type="lead", name="Joe's Pizza", website="https://joespizza.example", email="hello@joespizza.example",
                pain_point="no online ordering", how_we_help="Acme POS", evidence="https://joespizza.example/menu")
    assert c._execute_lead(lead, ep).ok  # the fake board has the row: confirmed
    notion.gone.add(f"{len(notion.rows) + 1:032x}")  # the next row will be missing on read-back
    r = c._execute_lead(Lead(type="lead", name="Ghost Bakery", website="https://ghost.example", email="hi@ghost.example",
                             pain_point="x", how_we_help="Website Care", evidence="https://ghost.example/"), ep)
    assert not r.ok and "not confirmed" in r.summary
    assert c.memory.find_lead("Ghost Bakery") is None  # an unconfirmed row is not remembered
    # an update whose value did not land on the row is not done
    notion.update_row = lambda page_id, fields: None  # Notion silently drops the change
    r = c._execute_update_lead(UpdateLead(type="update_lead", name="Joe's Pizza", location="Northside, NY"))
    assert not r.ok and "not on the row: Location" in r.summary


def test_a_plan_of_talk_is_refused_and_done_needs_output():
    # the CEO's first plan (18:40): "message The CEO confirming the goal", "inform the owner" -- a job producing nothing
    p = _policy()
    c = _ctx(); c.bot_name = "The CEO"
    talk = Plan(type="plan", task="Confirm the revised SMB goal", done_when="goal confirmed",
                steps=["Send a message to The CEO confirming the SMB goal", "Inform the owner with a say message"])
    v = p.check(talk, c)
    assert not v.allowed and "messages yourself" in v.reason
    only_talk = Plan(type="plan", task="Tell everyone about SMB", done_when="told", steps=["Message Lead Gen about SMB", "Tell Scout"])
    assert not p.check(only_talk, c).allowed
    real = Plan(type="plan", task="SMB outreach batch", done_when="one task on the board", steps=["Message Lead Gen for SMB rows", "Write the outreach task"])
    assert p.check(real, c).allowed
    plan = WorkPlan.new(real.task, real.done_when, real.steps, "priority")
    assert plan.tick(1, 5, "message") and plan.active
    assert not p.check(Plan(type="plan", status="done"), _ctx(plan)).allowed  # nothing produced yet
    assert plan.tick(2, 9, "task") and plan.status == "done"  # a task behind the last step: finished by itself
    talk_plan = WorkPlan.new("x", "y", ["Message A", "Message B"], "priority")
    talk_plan.tick(1, 1, "message"); talk_plan.tick(2, 2, "say")
    assert talk_plan.active and "nothing produced" in talk_plan.note
    assert p.check(Plan(type="plan", status="stuck", note="no output possible"), _ctx(talk_plan)).allowed
    owner_plan = WorkPlan.new("answer the owner", "answered", ["read", "say"], "owner")
    owner_plan.tick(1, 1, "note"); owner_plan.tick(2, 2, "say")
    assert owner_plan.status == "done"


def test_a_plan_on_a_capped_site_ends_stuck_and_cannot_be_rebuilt(cfg):
    from explorer.config import PolicyConfig
    from explorer.policy import Verdict

    plan = WorkPlan.new("Update leads board: fill missing cells for Sunny Deli and Willow Salon", "cells filled",
                        ["open sunnydeli-example.com pages", "update_lead Sunny Deli", "update_lead Willow Salon"], "priority")
    assert plan.names_domain("sunnydeli-example.com") and plan.names_domain("willowsaloncompany.com") and not plan.names_domain("junipercafe.com")
    cfg.policy.domain_no_progress_cap = 5
    c = make_controller(cfg)
    c.plan = plan
    c._plan_stuck_on_domain("https://sunnydeli-example.com/locations/", "move on: 5 pages ...")
    assert c.plan.status == "stuck" and "sunnydeli-example.com does not state" in c.plan.note and "Tell whoever asked" in (c.feedback or "")
    policy = Policy(PolicyConfig(domain_no_progress_cap=5), PublishConfig(), Denylist.load(DENYLIST))
    ctx = _ctx(); ctx.domain_visits_no_progress = {"sunnydeli-example.com": 7}
    again = Plan(type="plan", task="Fill the Sunny Deli cells", done_when="filled", steps=["open the site", "update_lead Sunny Deli"])
    v = policy.check(again, ctx)
    assert not v.allowed and "gave nothing" in v.reason
    assert policy.check(Plan(type="plan", task="Fill the Juniper Cafe cells", done_when="filled", steps=["open the site", "update_lead Juniper Cafe"]), ctx).allowed


def test_notion_out_of_blocks_pauses_writes_and_tells_the_owner_once(cfg):
    from explorer.notion import NotionError

    c = make_controller(cfg)
    c.memory.start_episode(None); ep = c.memory.current_episode()
    c._note_notion_full(NotionError("Notion refused (403) -- the integration token or the page's access: restricted_resource This workspace has used all of its free blocks."))
    assert c._notion_full()
    assert any("NOT NOW any Notion write" in l for l in c._allowed_now(ep))
    chats = [r["text"] for r in c.memory.recent_chat(5) if r["role"] == "bot"]
    assert len([t for t in chats if "free blocks" in t]) == 1
    c._note_notion_full(NotionError("restricted_resource This workspace has used all of its free blocks."))
    assert len([r for r in c.memory.recent_chat(5) if r["role"] == "bot" and "free blocks" in r["text"]]) == 1  # told once
    c._note_notion_full(ValueError("something else"))  # unrelated errors change nothing


def test_first_accepted_write_after_a_full_workspace_clears_the_pause(cfg):
    from explorer.notion import FakeNotion, NotionError, page_id_from_url

    fake = FakeNotion()
    c = make_controller(cfg, notion=fake)
    events = []
    c.logger = type("L", (), {"info": lambda self, msg, *a, **k: events.append(msg), "warning": lambda *a, **k: None,
                              "debug": lambda *a, **k: None, "exception": lambda *a, **k: None})()
    c._note_notion_full(NotionError("restricted_resource This workspace has used all of its free blocks."))
    assert c.memory.db.get_state("notion_full_flag", "") == "1" and c._notion_full()
    url = fake.create_task("t", "d" * 320, None, "P3", None)
    assert c._confirm_write(fake, "task", page_id=page_id_from_url(url) or "") is None
    assert c.memory.db.get_state("notion_full_flag", "") == "" and not c._notion_full()
    assert any("writes accepted again" in str(e) for e in events)


def test_a_common_word_inside_a_domain_does_not_name_it():
    p = WorkPlan.new("Find SPF restaurants with an email on their site", "three leads", ["open restaurants from the slice", "list leads"])
    assert not p.names_domain("petrossianrestaurants.com")
    q = WorkPlan.new("Fill cells for Petrossian Restaurants", "done", ["open petrossianrestaurants.com", "update_lead"])
    assert q.names_domain("petrossianrestaurants.com")
    r = WorkPlan.new("Update leads board: Sunny Deli and Willow Salon", "cells filled", ["open sites", "update_lead"])
    assert r.names_domain("sunnydeli-example.com") and r.names_domain("willowsaloncompany.com") and not r.names_domain("junipercafe.com")


def test_estimates_and_actuals_are_recorded_and_nothing_is_enforced(cfg):
    import datetime as dt

    c = make_controller(cfg)
    eid = c.memory.start_episode(None)
    r = c._execute_plan(Plan(type="plan", task="List three Northside bakeries", done_when="three rows", steps=["find sites", "list leads"], step_minutes=[10, 30]))
    assert r.ok
    saved = json.loads((cfg.workspace / "plan.json").read_text())
    assert saved["estimate_min"] == 40 and [s["estimate_min"] for s in saved["steps"]] == [10, 30]
    assert c.plan.step_estimate(1) == 10 and WorkPlan.new("t", "d", ["a", "b"]).step_estimate(1) == 60

    # 12 actions four minutes apart since the plan started = 44 working minutes on a 10-minute step
    start = dt.datetime.fromisoformat(c.plan.started)
    for i in range(12):
        ts = (start + dt.timedelta(minutes=4 * i)).isoformat(timespec="seconds")
        c.memory.db.insert("INSERT INTO actions(ts, cycle, episode_id, action_type, payload, thought, verdict, result, progress) VALUES (?,?,?,?,?,?,?,?,?)",
                           (ts, i, eid, "search", "{}", "", "allowed", "ok", 1))
    assert 40 <= c.memory.working_minutes_since(c.plan.started) <= 48
    assert c.plan.active and len(c._plan_lines()) == 4  # nothing is enforced and nothing is said: the owner judges from the data
    c.memory.record_action(99, eid, "note", {"type": "note"}, "", "allowed", "saved", True)
    assert c._execute_plan(Plan(type="plan", tick=1)).ok
    assert json.loads((cfg.workspace / "plan.json").read_text())["steps"][0]["actual_min"] is not None
    assert not (cfg.workspace / "plan-history.jsonl").exists()  # still active
    assert c._execute_plan(Plan(type="plan", status="stuck", note="no bakery publishes an email")).ok
    hist = [json.loads(l) for l in (cfg.workspace / "plan-history.jsonl").read_text().splitlines()]
    assert len(hist) == 1 and hist[0]["status"] == "stuck" and hist[0]["estimate_min"] == 40 and hist[0]["actual_min"] >= 40
    assert [s["estimate_min"] for s in hist[0]["steps"]] == [10, 30] and hist[0]["steps"][0]["actual_min"] is not None and hist[0]["steps"][1]["actual_min"] is not None
    assert not _policy().check(Plan(type="plan", task="x y z", done_when="d", steps=["find a", "list b"], step_minutes=[0, 5]), _ctx()).allowed
