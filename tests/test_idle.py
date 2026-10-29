"""[agent] idle_when_empty: no model call when there is nothing to do (creatorCC queue 6, 2026-10-28)."""
from __future__ import annotations

import json
import time

from explorer.handoff import send_message
from explorer.notion import FakeNotion

from conftest import make_controller


def _enricher(cfg, rows: list[str]):
    cfg.agent.idle_when_empty = True
    cfg.leads.enabled, cfg.leads.update_any_row = True, True
    cfg.leads.decide_glob = "empty-cells*.md"
    routed = cfg.root.parent / "common-data" / "botBox" / "routed" / cfg.root.name
    routed.mkdir(parents=True, exist_ok=True)
    (routed / "empty-cells.md").write_text("# rows\n\n" + "".join(f"- {r} | missing: Location\n" for r in rows))
    notion = FakeNotion()
    return make_controller(cfg, notion=notion, leads_notion=notion)


def test_a_bot_with_an_empty_work_list_rests_without_a_model_call(cfg):
    c = _enricher(cfg, [])
    assert c._idle_reason() == "the work list is empty"
    cfg.agent.idle_minutes = 0.0
    calls = []
    c.model.decide = lambda *a, **k: calls.append(1)     # never reached
    assert c._rest_if_idle() and calls == []


def test_a_row_on_the_list_or_a_message_wakes_it(cfg):
    assert _enricher(cfg, ["Kestrel"])._idle_reason() == ""
    c = _enricher(cfg, [])
    send_message(cfg.root, "The CEO", "please fill Tamarind's map link")
    assert c._idle_reason() == ""


def test_the_update_cap_reached_is_rest_too_and_off_by_default(cfg):
    c = _enricher(cfg, ["Kestrel"])
    cfg.leads.max_updates_per_day = 1
    c.memory.db.execute("INSERT INTO actions (ts, cycle, episode_id, action_type, payload, thought, verdict) VALUES (?,?,?,?,?,?,?)",
                        (time.strftime("%Y-%m-%dT%H:%M:%S"), 1, 1, "update_lead", json.dumps({"name": "Kestrel"}), "", "allowed"))
    assert c._idle_reason() == "today's 1 row updates are done"
    cfg.agent.idle_when_empty = False
    assert c._idle_reason() == ""


def test_the_ceo_rests_when_its_task_and_message_caps_are_both_reached(cfg):
    cfg.agent.idle_when_empty = True
    cfg.notion.enabled, cfg.notion.database_id, cfg.notion.max_tasks_per_day = True, "x", 1
    cfg.messaging.enabled, cfg.messaging.max_per_day = True, 1
    c = make_controller(cfg, notion=FakeNotion())
    now = time.strftime("%Y-%m-%dT%H:%M:%S")
    c.memory.db.execute("INSERT INTO tasks (created_at, title, details) VALUES (?, ?, ?)", (now, "today's batch", "d"))
    assert c._idle_reason() == ""                                      # a message is still left
    c.memory.db.execute("INSERT INTO actions (ts, cycle, episode_id, action_type, payload, thought, verdict) VALUES (?,?,?,?,?,?,?)",
                        (now, 1, 1, "message", "{}", "", "allowed"))
    assert c._idle_reason() == "today's tasks (1) and messages (1) are done"


def test_a_ceo_with_a_list_rests_only_when_the_list_and_its_caps_are_done(cfg):
    c = _enricher(cfg, ["Grillhaus"])
    cfg.notion.enabled, cfg.notion.database_id, cfg.notion.max_tasks_per_day = True, "x", 1
    cfg.messaging.enabled, cfg.messaging.max_per_day = True, 1
    c.notion = FakeNotion()
    now = time.strftime("%Y-%m-%dT%H:%M:%S")
    c.memory.db.execute("INSERT INTO tasks (created_at, title, details) VALUES (?, ?, ?)", (now, "today's batch", "d"))
    c.memory.db.execute("INSERT INTO actions (ts, cycle, episode_id, action_type, payload, thought, verdict) VALUES (?,?,?,?,?,?,?)",
                        (now, 1, 1, "message", "{}", "", "allowed"))
    assert c._idle_reason() == ""                                       # Grillhaus still waits for its package
    (cfg.root.parent / "common-data" / "botBox" / "routed" / cfg.root.name / "empty-cells.md").write_text("# rows\n")
    assert c._idle_reason() == "the work list is empty, today's tasks (1) and messages (1) are done"


def test_a_list_bot_rests_on_an_empty_list_whatever_its_message_cap(cfg):
    c = _enricher(cfg, [])
    cfg.messaging.enabled, cfg.messaging.max_per_day = True, 12
    assert c._idle_reason() == "the work list is empty"
