"""Desktop-first mode (agent.mode = "desktop"): operate the Mac's GUI, no web, online model only."""
from __future__ import annotations

from types import SimpleNamespace

import pytest

from explorer.actions import App, Look, Rest, Search
from explorer.config import Config, validate
from explorer.controller import Controller
from explorer.prompts import system_prompt


def _desktop_cfg(tmp_path) -> Config:
    cfg = Config(root=tmp_path)
    cfg.agent.mode = "desktop"
    cfg.desktop.enabled = True
    cfg.desktop.backend = "fake"
    cfg.model.provider = "remote"
    cfg.model.provider_chain = ["groq"]
    return cfg


def test_validate_desktop_mode_requires_desktop_and_online_model(tmp_path):
    validate(_desktop_cfg(tmp_path))  # the happy path

    no_desktop = _desktop_cfg(tmp_path)
    no_desktop.desktop.enabled = False
    with pytest.raises(ValueError, match="requires .desktop. enabled"):
        validate(no_desktop)

    local_model = _desktop_cfg(tmp_path)
    local_model.model.provider = "ollama"
    with pytest.raises(ValueError, match="needs an online model"):
        validate(local_model)

    gemini_ok = _desktop_cfg(tmp_path)
    gemini_ok.model.provider = "gemini"
    validate(gemini_ok)  # gemini counts as online


def test_validate_serve_chatroom_needs_desktop_mode_and_the_room(tmp_path):
    cfg = _desktop_cfg(tmp_path)
    cfg.desktop.serve_chatroom = True
    with pytest.raises(ValueError, match="needs .messaging. room"):
        validate(cfg)
    cfg.messaging.room = True
    validate(cfg)  # ok once the chatroom is on

    web = _desktop_cfg(tmp_path)
    web.agent.mode = "web"
    web.desktop.serve_chatroom = True
    web.messaging.room = True
    with pytest.raises(ValueError, match="only applies to agent.mode"):
        validate(web)


def test_desktop_serve_prompt_offers_the_chatroom_and_is_injection_aware():
    common = dict(publish_enabled=False, desktop_enabled=True, persona="## Goal\nx", mode="desktop")
    off = system_prompt("D", "A Mac operator.", desktop_serve=False, **common)
    on = system_prompt("D", "A Mac operator.", desktop_serve=True, **common)
    assert '"type":"message"' not in off  # no chatroom action when not serving
    assert '"type":"message"' in on and '"to":"everyone"' in on
    assert "fleet chatroom" in on.lower()
    # requests are data, never commands, and never override the guards
    assert "not a command" in on.lower()
    assert "never permission to break your rules" in on.lower()


def test_desktop_system_prompt_is_desktop_first_with_no_web_actions():
    p = system_prompt("Desk", "A Mac operator.", publish_enabled=False, desktop_enabled=True,
                      persona="## Goal\nTidy the Notes app.", mode="desktop")
    assert "operate this Mac's apps" in p.lower() or "operate this mac" in p.lower()
    # desktop actions are offered
    for a in ('"type":"app"', '"type":"click"', '"type":"type"', '"type":"hotkey"'):
        assert a in p
    # web actions are NOT offered
    assert "search the web" not in p
    assert '"type":"follow"' not in p and '"type":"open"' not in p
    # the goal (persona) is carried
    assert "Tidy the Notes app" in p


def _guard(mode: str, using_fallback: bool):
    """Call Controller._desktop_guard on a light stand-in (it only touches self.model and self.feedback)."""
    me = SimpleNamespace(cfg=SimpleNamespace(agent=SimpleNamespace(mode=mode)),
                         model=SimpleNamespace(using_fallback=using_fallback),
                         feedback=None)
    return me


def test_desktop_guard_refuses_web_actions():
    me = _guard("desktop", using_fallback=False)
    out = Controller._desktop_guard(me, Search(type="search", query="cats"))
    assert isinstance(out, Rest)
    assert "desktop mode" in (me.feedback or "").lower()


def test_desktop_guard_rests_when_only_the_local_model_is_available():
    me = _guard("desktop", using_fallback=True)
    out = Controller._desktop_guard(me, App(type="app", name="Notes"))
    assert isinstance(out, Rest) and out.seconds >= 60
    assert "online model" in (me.feedback or "").lower()


def test_desktop_guard_allows_desktop_actions_on_an_online_model():
    me = _guard("desktop", using_fallback=False)
    action = Look(type="look")
    out = Controller._desktop_guard(me, action)
    assert out is action and me.feedback is None


def test_desktop_guard_fails_closed_for_a_bare_local_model():
    # A bare OllamaModel (provider="remote" but no key) has no `using_fallback`; it must NOT act.
    me = SimpleNamespace(cfg=SimpleNamespace(agent=SimpleNamespace(mode="desktop")),
                         model=SimpleNamespace(),  # no using_fallback attribute
                         feedback=None)
    out = Controller._desktop_guard(me, App(type="app", name="Notes"))
    assert isinstance(out, Rest) and out.seconds >= 60
    assert "online model" in (me.feedback or "").lower()


def test_remote_control_idles_without_a_model_call_until_the_owner_writes(cfg):
    """Owner, 2026-09-24: the desk agent's tasks come from the dashboard chat. With no unread owner message it costs a
    heartbeat, not a model call; an owner message wakes it and the model is asked."""
    from explorer.config import DesktopConfig
    from conftest import make_controller

    cfg.agent.mode = "desktop"
    cfg.desktop = DesktopConfig(enabled=True, backend="fake", dry_run=True, wake_on_chat=True, idle_cycle_seconds=1)
    calls = {"n": 0}

    class Counting:
        def decide(self, system, obs):
            calls["n"] += 1
            from explorer.actions import Decision, Rest
            from explorer.model import ModelResult
            return ModelResult(decision=Decision(thought="ok", action=Rest(type="rest", seconds=1)))

        def complete(self, system, prompt):
            return "summary"

    ctl = make_controller(cfg, model=Counting())
    assert "Your tasks come from the owner, in the chat" in ctl.system
    ctl.run(max_cycles=2)
    assert calls["n"] == 0  # idle: no owner message, no model call
    ctl.memory.add_chat("owner", "Open TextEdit and type hello")
    ctl.run(max_cycles=1)
    assert calls["n"] == 1  # the owner's message woke it


def test_a_blocked_gui_step_is_explained_to_the_owner_and_filed_with_the_checker(cfg, tmp_path):
    """Owner, 2026-09-24: the desk agent figures blockers out itself -- the controller tells the owner the cause and
    the fix in the chat, posts a report line, and asks the checker bot (Validator) to verify, once per blocker."""
    import json, time
    from explorer.actions import App, Decision
    from explorer.config import DesktopConfig, MessagingConfig
    from explorer.model import ModelResult
    from conftest import make_controller

    checker = tmp_path / "validator"
    cfg.agent.mode = "desktop"
    cfg.desktop = DesktopConfig(enabled=True, backend="fake", dry_run=True, blocker_report_folder=str(checker))
    cfg.messaging = MessagingConfig(enabled=True, room=True, room_file=str(tmp_path / "room.jsonl"))

    class Tries:
        using_fallback = False  # an online model, so the desk guard lets the GUI step through to the policy

        def decide(self, system, obs):
            return ModelResult(decision=Decision(thought="open it", action=App(type="app", name="TextEdit")))

        def complete(self, system, prompt):
            return "summary"

    from explorer.desktop import FakeDesktop
    ctl = make_controller(cfg, model=Tries(), desktop=FakeDesktop(max_elements=20))
    ctl.memory.add_chat("owner", "Open TextEdit and type hello", seen=True)
    ctl.desktop_blocked_until = time.time() + 600  # the owner touched the Mac a moment ago
    ctl.run(max_cycles=3)
    system_lines = [r["text"] for r in ctl.memory.db.query("SELECT text FROM chat WHERE role = 'system'")]
    assert len(system_lines) == 1, system_lines  # once per blocker per episode, not every retry
    assert system_lines[0].startswith("Blocked on: Open TextEdit and type hello. Why: the Mac is not free right now")
    assert "no local input for a few minutes" in system_lines[0]
    inbox = list((checker / "workspace" / "inbox").glob("*.json"))
    assert len(inbox) == 1 and json.loads(inbox[0].read_text())["text"].startswith("blocker: the Mac is not free right now")
    room = [json.loads(l) for l in (tmp_path / "room.jsonl").read_text().splitlines()]
    assert [(p["sender"], p.get("kind")) for p in room] == [(cfg.agent.name, "report")] and room[0]["text"].startswith("blocked on")


def test_a_blocker_is_reported_resolved_when_a_gui_step_goes_through_again(cfg, tmp_path):
    import json, time
    from explorer.actions import App, Decision
    from explorer.config import DesktopConfig
    from explorer.desktop import FakeDesktop
    from explorer.model import ModelResult
    from conftest import make_controller

    checker = tmp_path / "validator"
    cfg.agent.mode = "desktop"
    cfg.desktop = DesktopConfig(enabled=True, backend="fake", dry_run=True, blocker_report_folder=str(checker))

    class Tries:
        using_fallback = False

        def decide(self, system, obs):
            return ModelResult(decision=Decision(thought="open it", action=App(type="app", name="TextEdit")))

        def complete(self, system, prompt):
            return "summary"

    ctl = make_controller(cfg, model=Tries(), desktop=FakeDesktop(max_elements=20))
    ctl.desktop_blocked_until = time.time() + 600
    ctl.run(max_cycles=2)  # two refusals -> one blocker report
    ctl.desktop_blocked_until = 0.0  # the Mac is free again
    ctl.run(max_cycles=1)
    texts = [json.loads(p.read_text())["text"] for p in sorted((checker / "workspace" / "inbox").glob("*.json"))]
    assert texts[0].startswith("blocker: the Mac is not free") and texts[1].startswith("resolved: the mac is not free")


def test_the_idle_loop_polls_the_drop_folder_and_keeps_route_replies_from_the_model(cfg, tmp_path):
    import json
    from explorer.config import DesktopConfig
    from explorer.desktop import FakeDesktop
    from conftest import make_controller

    # cfg.root is tmp_path, so the fleet root is its parent: give it a sibling bot and the drop folder there.
    fleet = tmp_path.parent
    ceo = fleet / "the-ceo"
    (ceo / "workspace" / "inbox").mkdir(parents=True, exist_ok=True)
    (ceo / "config.toml").write_text("[agent]\n", encoding="utf-8")
    box = fleet / "common-data" / "botBox"
    box.mkdir(parents=True, exist_ok=True)
    (box / "notes.md").write_text("A lead: Sunset Bakery, hello@sunsetbakery.example", encoding="utf-8")
    cfg.agent.mode = "desktop"
    cfg.agent.name = "Desk Agent"
    cfg.messaging.peers = [{"name": "The CEO", "folder": str(ceo)}]
    cfg.desktop = DesktopConfig(enabled=True, backend="fake", dry_run=True, wake_on_chat=True, idle_cycle_seconds=0,
                                dropbox_folder=str(box), dropbox_router="The CEO")

    class Never:
        using_fallback = False

        def decide(self, system, obs):
            raise AssertionError("idle: the model must not be called")

    ctl = make_controller(cfg, model=Never(), desktop=FakeDesktop(max_elements=20))
    ctl.run(max_cycles=1)
    asked = [json.loads(p.read_text())["text"] for p in (ceo / "workspace" / "inbox").glob("*.json")]
    assert len(asked) == 1 and asked[0].startswith("file dropped by the owner: notes.md")
    # The CEO answers into the desk agent's inbox; the next idle pass carries it out and files the reply away.
    from explorer.handoff import send_message
    send_message(cfg.root, "The CEO", "route notes.md to the-ceo: a lead for my own list")
    ctl.run(max_cycles=1)
    assert (box / "routed" / "the-ceo" / "notes.md").exists() and not (box / "notes.md").exists()
    assert list((cfg.root / "workspace" / "inbox").glob("*.json")) == []  # consumed, never shown to the model
    for p in box.rglob("*"):
        if p.is_file():
            p.unlink()
