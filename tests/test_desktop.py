import datetime as dt

from explorer.actions import App, Click, Decision, Hotkey, Look, Summarize, TypeText
from explorer.config import DesktopConfig, PolicyConfig, PublishConfig
from explorer.desktop import FakeDesktop, hotkey_never_allowed, normalize_hotkey, within_hours
from explorer.model import FakeModel, ModelResult
from explorer.policy import Denylist, Policy, PolicyContext

from conftest import DENYLIST, make_controller


# ---- the fake desktop itself -----------------------------------------------------


def find(view, title):
    return next(e for e in view.elements if e.title == title)


def test_fake_desktop_numbers_elements_types_and_shows_sheets():
    d = FakeDesktop()
    v = d.activate("TextEdit")
    assert v.ok and v.app.name == "TextEdit" and v.window_title == "Untitled"
    doc = find(v, "document")
    assert doc.editable and doc.focused and v.focused == doc.number
    assert [e.title for e in v.elements if e.role == "menu"] == ["File", "Edit"]

    typed = d.type_text("Dear diary,", v.view_id)
    assert find(typed, "document").value == "Dear diary," and typed.signature != v.signature

    stale = d.click(1, v.view_id)  # the screen changed since that view
    assert not stale.ok and "look again" in stale.error

    sheet = d.hotkey("cmd+s", typed.view_id)
    assert sheet.modal == 'sheet "Save"'
    cancel = find(sheet, "Cancel")
    assert cancel.modal and not find(sheet, "document").modal
    assert "dialog" in cancel.describe()
    after = d.click(cancel.number, sheet.view_id)
    assert after.modal is None
    assert ("type", "Dear diary,") in d.posted and ("hotkey", "cmd+s") in d.posted

    menu = d.click(find(after, "File").number, after.view_id)  # opening a menu reveals its items
    assert [e.title for e in menu.elements if e.role == "menu item"] == ["New", "Save", "Close"]


def test_fake_calculator_adds_and_the_display_is_the_signal():
    d = FakeDesktop()
    v = d.activate("Calculator")
    for label in ("1", "2", "+", "3", "="):
        v = d.click(find(v, label).number, v.view_id)
    assert find(v, "display").value == "15"


def test_fake_desktop_refuses_when_the_owner_is_back_or_the_screen_is_locked():
    d = FakeDesktop()
    v = d.activate("TextEdit")
    d.set_human(True)
    assert not d.status().safe and "owner" in d.status().reason
    refused = d.type_text("x", v.view_id)
    assert not refused.ok and "owner" in refused.error and ("type", "x") not in d.posted
    d.set_human(False)
    d.locked = True
    assert "locked" in d.status().reason
    d.locked = False
    d.hung.add("TextEdit")
    assert "not responding" in d.look().error


def test_hotkeys_are_normalised_and_dangerous_ones_are_never_allowed():
    assert normalize_hotkey("Command + Shift+Z") == "cmd+shift+z"
    assert normalize_hotkey("esc") == "escape"
    assert normalize_hotkey("cmd+shift") is None and normalize_hotkey("") is None
    for combo in ("cmd+q", "cmd+space", "cmd+tab", "cmd+alt+escape", "cmd+shift+4", "cmd+alt+power"):
        assert hotkey_never_allowed(normalize_hotkey(combo)), combo
    assert not hotkey_never_allowed("cmd+n")


def test_within_hours_wraps_midnight():
    assert within_hours("")
    assert within_hours("22:00-07:00", dt.time(23, 30))
    assert within_hours("22:00-07:00", dt.time(3, 0))
    assert not within_hours("22:00-07:00", dt.time(12, 0))
    assert within_hours("09:00-17:00", dt.time(12, 0))
    assert not within_hours("09:00-17:00", dt.time(18, 0))


# ---- policy ------------------------------------------------------------------------


def desktop_policy(**overrides):
    return Policy(PolicyConfig(), PublishConfig(), Denylist.load(DENYLIST), desktop=DesktopConfig(enabled=True, **overrides))


def dctx(view, available=True, reason=""):
    return PolicyContext(
        mode="fake", current_page=None, actions_in_episode=0, pages_last_hour=0, open_questions=0,
        last_visit_by_domain={}, desktop_available=available, desktop_reason=reason, desktop_view=view,
    )


def test_desktop_actions_do_not_exist_unless_enabled_and_the_mac_is_free():
    d = FakeDesktop()
    view = d.activate("TextEdit")
    off = Policy(PolicyConfig(), PublishConfig(), Denylist.load(DENYLIST))
    assert "not enabled" in off.check(App(type="app", name="TextEdit"), dctx(view)).reason
    p = desktop_policy()
    busy = p.check(App(type="app", name="TextEdit"), dctx(view, available=False, reason="the owner used the Mac 5s ago"))
    assert not busy.allowed and "not free" in busy.reason and "5s ago" in busy.reason
    assert p.check(App(type="app", name="textedit"), dctx(view)).allowed
    assert p.check(Look(type="look"), dctx(None)).allowed


def test_desktop_policy_allowlists_apps_and_guards_typing():
    d = FakeDesktop()
    p = desktop_policy()
    assert "not an app you may use" in p.check(App(type="app", name="Terminal"), dctx(None)).reason
    assert "nothing is on your screen" in p.check(Click(type="click", number=1), dctx(None)).reason
    terminal = d.activate("Terminal")
    assert "not one you may use" in p.check(TypeText(type="type", text="rm -rf /"), dctx(terminal)).reason
    view = d.activate("TextEdit")
    assert p.check(TypeText(type="type", text="hello"), dctx(view)).allowed
    assert "at most 500" in p.check(TypeText(type="type", text="x" * 501), dctx(view)).reason
    assert "no element [99]" in p.check(Click(type="click", number=99), dctx(view)).reason
    assert p.check(Click(type="click", number=view.focused), dctx(view)).allowed
    lenient = desktop_policy(allowed_apps=["TextEdit", "Passwords"])
    passwords = d.activate("Passwords")
    assert "password field" in lenient.check(TypeText(type="type", text="hunter2"), dctx(passwords)).reason


def test_desktop_policy_handles_dialogs_and_hotkeys():
    d = FakeDesktop()
    p = desktop_policy()
    view = d.activate("TextEdit")
    sheet = d.hotkey("cmd+s", view.view_id)
    assert "dialog is open" in p.check(Click(type="click", number=find(sheet, "document").number), dctx(sheet)).reason
    assert p.check(Click(type="click", number=find(sheet, "Cancel").number), dctx(sheet)).allowed
    assert p.check(Hotkey(type="hotkey", combo="escape"), dctx(sheet)).allowed
    assert "never allowed" in p.check(Hotkey(type="hotkey", combo="cmd+q"), dctx(view)).reason
    assert "not an allowed shortcut" in p.check(Hotkey(type="hotkey", combo="cmd+s"), dctx(view)).reason
    assert "not a key combination" in p.check(Hotkey(type="hotkey", combo="cmd+shift"), dctx(view)).reason
    assert "not an allowed shortcut" in p.check(Hotkey(type="hotkey", combo="banana"), dctx(view)).reason
    assert p.check(Hotkey(type="hotkey", combo="Command+N"), dctx(view)).allowed


# ---- the controller loop -------------------------------------------------------------


class Scripted:
    """Plays a fixed list of desktop actions, then behaves like the fake heuristic."""

    def __init__(self, actions):
        self.actions = list(actions)
        self.inner = FakeModel()
        self.prompts = []

    def decide(self, system, obs):
        self.prompts.append(obs.render())
        if self.actions:
            return ModelResult(decision=Decision(thought="desktop", action=self.actions.pop(0)))
        return self.inner.decide(system, obs)

    def complete(self, system, prompt):
        return self.inner.complete(system, prompt)


def desktop_cfg(cfg, dry_run):
    cfg.desktop.enabled = True
    cfg.desktop.backend = "fake"
    cfg.desktop.dry_run = dry_run
    cfg.desktop.idle_minutes = 0
    cfg.policy.max_actions_per_episode = 20
    return cfg


def test_prompt_mentions_the_desktop_only_when_enabled(cfg):
    plain = make_controller(cfg)
    assert '"type":"app"' not in plain.system and plain.desktop is None
    desktop_cfg(cfg, dry_run=True)
    enabled = make_controller(cfg, desktop=FakeDesktop())
    assert '"type":"app"' in enabled.system and "dry run" in enabled.system


def test_dry_run_validates_and_logs_but_posts_nothing(cfg):
    desktop_cfg(cfg, dry_run=True)
    d = FakeDesktop()
    model = Scripted([App(type="app", name="TextEdit"), TypeText(type="type", text="hello"), Hotkey(type="hotkey", combo="cmd+q")])
    controller = make_controller(cfg, model=model, desktop=d)
    controller.run(max_cycles=3)
    assert d.posted == []
    rows = controller.memory.db.query("SELECT action_type, verdict, result FROM actions ORDER BY id")
    assert rows[0]["action_type"] == "app" and rows[0]["verdict"] == "allowed" and "dry run: would bring TextEdit" in rows[0]["result"]
    assert rows[1]["action_type"] == "type" and "nothing is on your screen" in rows[1]["verdict"]  # dry run never activated it
    assert rows[2]["action_type"] == "hotkey" and rows[2]["verdict"].startswith("rejected")
    assert "Desktop: the Mac is free; apps you may use: TextEdit, Calculator, Notes (dry run" in model.prompts[0]


def test_real_flow_types_into_textedit_and_stops_when_the_owner_returns(cfg):
    desktop_cfg(cfg, dry_run=False)
    d = FakeDesktop()
    model = Scripted(
        [
            App(type="app", name="TextEdit"),
            TypeText(type="type", text="Dear diary, "),
            Hotkey(type="hotkey", combo="cmd+s"),  # refused: not an allowed shortcut
            Look(type="look"),
            TypeText(type="type", text="today I used a Mac."),
            TypeText(type="type", text="unreachable"),  # the owner is back by then
            Summarize(type="summarize"),
        ]
    )
    controller = make_controller(cfg, model=model, desktop=d)
    controller.run(max_cycles=5)
    assert ("activate", "TextEdit") in d.posted and ("type", "Dear diary, ") in d.posted
    assert find(d.look(), "document").value == "Dear diary, today I used a Mac."
    assert "## Screen" in model.prompts[1] and 'App: TextEdit  Window: "Untitled"' in model.prompts[1]
    rows = controller.memory.db.query("SELECT action_type, verdict, result, progress FROM actions ORDER BY id")
    assert rows[1]["progress"] == 1  # typing changed the screen
    assert rows[2]["verdict"].startswith("rejected") and "not an allowed shortcut" in rows[2]["verdict"]
    assert rows[3]["action_type"] == "look" and rows[3]["progress"] == 0  # looking changes nothing

    d.set_human(True)
    controller.run(max_cycles=1)
    last = controller.memory.db.query("SELECT verdict FROM actions ORDER BY id DESC LIMIT 1")[0]["verdict"]
    assert "not free" in last and "owner" in last
    assert ("type", "unreachable") not in d.posted
    assert "The owner came back" in controller.memory.journal_path().read_text()
    assert "Desktop: not available" in model.prompts[-1] and "## Screen" not in model.prompts[-1]


# ---- the journal goes into TextEdit when the Mac is free --------------------------------


class NoteThenSummarize:
    """One note, then summarize: the shortest path to a journal entry."""

    def __init__(self):
        self.n = 0

    def decide(self, system, obs):
        from explorer.actions import Note

        self.n += 1
        if self.n == 1:
            return ModelResult(decision=Decision(thought="", action=Note(type="note", title="Tides", body="Two highs a day.")))
        return ModelResult(decision=Decision(thought="", action=Summarize(type="summarize")))

    def complete(self, system, prompt):
        return "Today I learned that the sea breathes twice a day."


def test_journal_entry_is_typed_into_textedit_when_the_mac_is_free(cfg):
    desktop_cfg(cfg, dry_run=False)
    d = FakeDesktop()
    controller = make_controller(cfg, model=NoteThenSummarize(), desktop=d)
    controller.run(max_cycles=2)
    assert ("activate", "TextEdit") in d.posted
    typed = "".join(t[1] for t in d.posted if t[0] == "type")
    assert "Episode 1" in typed and "the sea breathes twice a day" in typed
    assert "the sea breathes twice a day" in find(d.look(), "document").value
    result = controller.memory.db.query("SELECT result FROM actions WHERE action_type = 'summarize'")[0]["result"]
    assert "typed it into TextEdit" in result


def test_journal_typing_is_skipped_in_dry_run_and_when_the_owner_is_present(cfg):
    desktop_cfg(cfg, dry_run=True)
    d = FakeDesktop()
    controller = make_controller(cfg, model=NoteThenSummarize(), desktop=d)
    controller.run(max_cycles=2)
    assert d.posted == []
    result = controller.memory.db.query("SELECT result FROM actions WHERE action_type = 'summarize'")[0]["result"]
    assert "dry run" in result and "TextEdit" in result

    desktop_cfg(cfg, dry_run=False)
    d2 = FakeDesktop()
    d2.set_human(True)
    controller = make_controller(cfg, model=NoteThenSummarize(), desktop=d2)
    controller.run(max_cycles=2)
    assert d2.posted == []
