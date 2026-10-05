"""Desktop control: what the agent sees on the Mac, and a fake desktop for tests.

The agent never aims at pixels. It sees the frontmost app's accessibility tree as a numbered list of
elements and picks by number; the adapter does the clicking and typing. The real macOS adapter lives in
desktop_mac.py and needs pyobjc; nothing in this module imports it, so tests run anywhere.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Protocol

# ---- shapes ------------------------------------------------------------------


@dataclass
class AppInfo:
    name: str
    bundle_id: str = ""
    pid: int = 0


@dataclass
class Element:
    number: int
    role: str  # button, text field, text area, password field, menu, menu item, checkbox, static text, ...
    title: str = ""
    value: str | None = None
    enabled: bool = True
    editable: bool = False
    secure: bool = False
    focused: bool = False
    modal: bool = False  # belongs to an open sheet or dialog
    frame: tuple[float, float, float, float] = (0.0, 0.0, 0.0, 0.0)  # x, y, w, h in screen points

    def describe(self) -> str:
        parts = [f"[{self.number}] {self.role}"]
        if self.title:
            parts.append(f'"{self.title[:80]}"')
        if self.value:
            parts.append("= " + repr(self.value[:120]))
        flags: list[str] = []
        if self.focused:
            flags.append("focused")
        if not self.enabled:
            flags.append("disabled")
        if self.modal:
            flags.append("dialog")
        if self.secure:
            flags.append("password field: never type here")
        if flags:
            parts.append("(" + ", ".join(flags) + ")")
        return " ".join(parts)


@dataclass
class DesktopView:
    app: AppInfo | None
    window_title: str = ""
    elements: list[Element] = field(default_factory=list)
    modal: str | None = None  # e.g. 'sheet "Save"' while a sheet or dialog is up
    focused: int | None = None  # element number with keyboard focus
    truncated: bool = False
    view_id: int = 0  # bumped on every look(); writes are validated against it
    ok: bool = True
    error: str | None = None
    captured_at: float = field(default_factory=time.time)

    def element(self, number: int) -> Element | None:
        for el in self.elements:
            if el.number == number:
                return el
        return None

    @property
    def signature(self) -> str:
        """Changes when anything the model can see changes; equal signatures mean 'nothing happened'."""
        h = hashlib.sha1()
        h.update((self.app.name if self.app else "").encode())
        h.update(self.window_title.encode())
        h.update((self.modal or "").encode())
        for el in self.elements:
            h.update(f"{el.role}|{el.title}|{el.value or ''}|{el.enabled}|{el.focused}".encode())
        return h.hexdigest()[:16]

    def render(self) -> list[str]:
        if not self.ok:
            return [f"Screen: unavailable ({self.error})"]
        app = self.app.name if self.app else "(none)"
        lines = [f'App: {app}  Window: "{self.window_title}"']
        if self.modal:
            lines.append(
                f"A dialog is open: {self.modal}. Deal with it first: click one of its buttons (marked dialog) "
                "or press the escape hotkey."
            )
        if self.elements:
            lines.extend(el.describe() for el in self.elements)
        else:
            lines.append("(this app shows no controls)")
        if self.truncated:
            lines.append("(more elements not shown)")
        return lines


def error_view(app: AppInfo | None, message: str) -> DesktopView:
    return DesktopView(app=app, ok=False, error=message)


@dataclass
class DesktopStatus:
    trusted: bool = True  # Accessibility permission granted
    on_console: bool = True  # this login session owns the screen
    locked: bool = False
    screensaver: bool = False
    display_asleep: bool = False
    idle_seconds: float = 0.0  # since the last human input, as far as the adapter can tell
    human_detected: bool = False  # input happened that the adapter did not generate
    frontmost: AppInfo | None = None

    @property
    def safe(self) -> bool:
        return self.reason == ""

    @property
    def reason(self) -> str:
        if not self.trusted:
            return "Accessibility permission is not granted"
        if not self.on_console:
            return "this session does not own the screen"
        if self.locked:
            return "the screen is locked"
        if self.screensaver:
            return "the screensaver is running"
        if self.display_asleep:
            return "the display is asleep"
        if self.human_detected:
            return "the owner is using the Mac"
        return ""


class Desktop(Protocol):
    def status(self) -> DesktopStatus: ...

    def apps(self) -> list[AppInfo]: ...

    def activate(self, name: str) -> DesktopView: ...

    def look(self) -> DesktopView: ...

    def click(self, number: int, view_id: int) -> DesktopView: ...

    def type_text(self, text: str, view_id: int) -> DesktopView: ...

    def hotkey(self, combo: str, view_id: int) -> DesktopView: ...

    def cancel_modal(self) -> DesktopView: ...

    def screenshot(self, path: Path | str) -> bool: ...

    def current(self) -> DesktopView | None: ...

    def reset(self) -> None: ...

    def close(self) -> None: ...


def within_hours(spec: str, now: dt.time | None = None) -> bool:
    """'22:00-07:00' is true from 22:00 to 07:00, wrapping midnight. An empty spec means always."""
    if not spec.strip():
        return True
    start_text, end_text = spec.strip().split("-", 1)
    start = dt.time.fromisoformat(start_text.strip())
    end = dt.time.fromisoformat(end_text.strip())
    now = now or dt.datetime.now().time()
    if start <= end:
        return start <= now < end
    return now >= start or now < end


# ---- hotkeys -----------------------------------------------------------------

MODIFIER_ORDER = ("cmd", "ctrl", "alt", "shift")
_KEY_ALIASES = {
    "command": "cmd", "control": "ctrl", "option": "alt", "opt": "alt",
    "esc": "escape", "enter": "return", "ret": "return", "del": "delete", "backspace": "delete",
}
# Never, whatever the config says: app switching, quitting, Spotlight, logout/lock, hiding, screenshots, power.
NEVER_HOTKEYS = frozenset(
    {
        "cmd+space", "cmd+alt+space", "cmd+tab", "cmd+shift+tab", "cmd+q", "cmd+alt+q", "cmd+shift+q",
        "cmd+ctrl+q", "cmd+alt+escape", "cmd+h", "cmd+alt+h", "cmd+shift+3", "cmd+shift+4", "cmd+shift+5",
        "cmd+ctrl+alt+eject", "ctrl+cmd+power", "cmd+alt+power", "cmd+shift+power", "cmd+`",
    }
)
NEVER_KEYS = frozenset({"power", "eject", "f11", "f12"})


def normalize_hotkey(combo: str) -> str | None:
    """'Command + Shift+Z' -> 'cmd+shift+z'; None when it is not modifiers plus exactly one key."""
    parts = [_KEY_ALIASES.get(p.strip().lower(), p.strip().lower()) for p in combo.split("+") if p.strip()]
    if not parts:
        return None
    mods = [p for p in parts if p in MODIFIER_ORDER]
    keys = [p for p in parts if p not in MODIFIER_ORDER]
    if len(keys) != 1 or len(mods) != len(set(mods)):
        return None
    return "+".join([m for m in MODIFIER_ORDER if m in mods] + keys)


def hotkey_never_allowed(normalized: str) -> bool:
    return normalized in NEVER_HOTKEYS or normalized.split("+")[-1] in NEVER_KEYS


# ---- fake desktop --------------------------------------------------------------


@dataclass
class FakeNode:
    role: str
    title: str = ""
    value: str = ""
    enabled: bool = True
    editable: bool = False
    secure: bool = False
    children: list["FakeNode"] = field(default_factory=list)
    on_press: Callable[["FakeApp"], None] | None = None


@dataclass
class FakeApp:
    info: AppInfo
    window_title: str
    menu: list[FakeNode] = field(default_factory=list)  # menu bar items, each with menu-item children
    body: list[FakeNode] = field(default_factory=list)
    sheet: FakeNode | None = None  # an open sheet; its children are modal
    focused: FakeNode | None = None
    open_menu: FakeNode | None = None
    hotkeys: dict[str, Callable[["FakeApp"], None]] = field(default_factory=dict)
    undo: list[str] = field(default_factory=list)
    state: dict[str, str] = field(default_factory=dict)


def _dismiss(app: FakeApp) -> None:
    app.sheet = None
    app.open_menu = None


def _open_save_sheet(app: FakeApp) -> None:
    def save(a: FakeApp) -> None:
        a.state["saved"] = a.body[0].value
        _dismiss(a)

    name_field = FakeNode("text field", "Save As", value="Untitled", editable=True)
    app.sheet = FakeNode(
        "sheet", "Save", children=[name_field, FakeNode("button", "Cancel", on_press=_dismiss), FakeNode("button", "Save", on_press=save)]
    )
    app.focused = name_field


def _new_document(app: FakeApp) -> None:
    app.undo.append(app.body[0].value)
    app.body[0].value = ""
    app.focused = app.body[0]


def _undo(app: FakeApp) -> None:
    if app.undo:
        app.body[0].value = app.undo.pop()


def make_textedit() -> FakeApp:
    document = FakeNode("text area", "document", editable=True)
    app = FakeApp(
        info=AppInfo("TextEdit", "com.fake.textedit", 101),
        window_title="Untitled",
        body=[document],
    )
    app.menu = [
        FakeNode(
            "menu", "File",
            children=[
                FakeNode("menu item", "New", on_press=_new_document),
                FakeNode("menu item", "Save", on_press=_open_save_sheet),
                FakeNode("menu item", "Close", on_press=_dismiss),
            ],
        ),
        FakeNode("menu", "Edit", children=[FakeNode("menu item", "Undo", on_press=_undo)]),
    ]
    app.focused = document
    app.hotkeys = {"cmd+s": _open_save_sheet, "cmd+n": _new_document, "cmd+z": _undo, "cmd+a": lambda a: None}
    return app


def make_calculator() -> FakeApp:
    display = FakeNode("static text", "display", value="0")
    app = FakeApp(info=AppInfo("Calculator", "com.fake.calculator", 102), window_title="Calculator", body=[display])
    app.state["acc"] = ""
    app.state["op"] = ""

    def press(label: str) -> Callable[[FakeApp], None]:
        def handler(a: FakeApp) -> None:
            if label.isdigit():
                a.state["acc"] += label
                display.value = a.state["acc"]
            elif label in "+-":
                a.state["lhs"] = a.state.get("acc") or "0"
                a.state["op"] = label
                a.state["acc"] = ""
            elif label == "=":
                lhs, rhs = int(a.state.get("lhs") or 0), int(a.state.get("acc") or 0)
                total = lhs + rhs if a.state.get("op") == "+" else lhs - rhs
                display.value = str(total)
                a.state["acc"] = str(total)
            elif label == "C":
                a.state["acc"] = ""
                a.state["op"] = ""
                display.value = "0"

        return handler

    app.body.extend(FakeNode("button", label, on_press=press(label)) for label in "7894561230+-=C")
    return app


def make_decoys() -> list[FakeApp]:
    """Apps that must never be allowlisted or typed into; here so policy tests can prove it."""
    shell = FakeNode("text area", "shell", editable=True)
    terminal = FakeApp(info=AppInfo("Terminal", "com.fake.terminal", 103), window_title="zsh", body=[shell], focused=shell)
    password = FakeNode("password field", "Password", editable=True, secure=True)
    passwords = FakeApp(
        info=AppInfo("Passwords", "com.fake.passwords", 104), window_title="Unlock", body=[password], focused=password
    )
    game = FakeApp(info=AppInfo("Game", "com.fake.game", 105), window_title="Game")
    return [terminal, passwords, game]


def default_fake_apps() -> list[FakeApp]:
    return [make_textedit(), make_calculator(), *make_decoys()]


class FakeDesktop:
    """An in-memory Mac: a few apps with element trees, sheets, hotkeys, and settable presence state.

    Every write is recorded in `posted`, so tests can prove that dry-run mode posts nothing."""

    def __init__(self, apps: list[FakeApp] | None = None, max_elements: int = 150):
        self.apps_by_name = {a.info.name.lower(): a for a in (apps or default_fake_apps())}
        self.front: FakeApp | None = None
        self.max_elements = max_elements
        self.idle_seconds = 3600.0
        self.locked = False
        self.human = False
        self.trusted = True
        self.hung: set[str] = set()
        self.posted: list[tuple] = []
        self._view: DesktopView | None = None
        self._view_id = 0
        self._nodes: dict[int, FakeNode] = {}

    # -- presence knobs for tests
    def set_human(self, present: bool) -> None:
        self.human = present
        if present:
            self.idle_seconds = 0.0

    # -- protocol
    def status(self) -> DesktopStatus:
        return DesktopStatus(
            trusted=self.trusted,
            locked=self.locked,
            idle_seconds=self.idle_seconds,
            human_detected=self.human,
            frontmost=self.front.info if self.front else None,
        )

    def apps(self) -> list[AppInfo]:
        return [a.info for a in self.apps_by_name.values()]

    def activate(self, name: str) -> DesktopView:
        guard = self._guard()
        if guard is not None:
            return guard
        app = self.apps_by_name.get(name.strip().lower())
        if app is None:
            return error_view(None, f"no running app named '{name}'")
        self.front = app
        self.posted.append(("activate", app.info.name))
        return self.look()

    def look(self) -> DesktopView:
        app = self.front
        if app is None:
            return error_view(None, "no app is in front; activate one")
        if app.info.name in self.hung:
            return error_view(app.info, "the app is not responding")
        self._view_id += 1
        self._nodes = {}
        elements: list[Element] = []
        truncated = False

        def add(node: FakeNode, modal: bool) -> None:
            nonlocal truncated
            if len(elements) >= self.max_elements:
                truncated = True
                return
            number = len(elements) + 1
            self._nodes[number] = node
            elements.append(
                Element(
                    number, node.role, node.title, node.value or None, node.enabled, node.editable, node.secure,
                    focused=node is app.focused, modal=modal,
                )
            )

        modal = None
        if app.sheet is not None:
            modal = f'sheet "{app.sheet.title}"'
            for child in app.sheet.children:
                add(child, True)
        for item in app.menu:
            add(item, False)
            if item is app.open_menu:
                for child in item.children:
                    add(child, False)
        for node in app.body:
            add(node, False)
        focused = next((el.number for el in elements if el.focused), None)
        self._view = DesktopView(app.info, app.window_title, elements, modal, focused, truncated, self._view_id)
        return self._view

    def _guard(self) -> DesktopView | None:
        status = self.status()
        if not status.safe:
            return error_view(self.front.info if self.front else None, status.reason)
        return None

    def _stale(self, view_id: int) -> DesktopView | None:
        if self._view is None or view_id != self._view.view_id:
            return error_view(self.front.info if self.front else None, "the screen changed; look again")
        return None

    def click(self, number: int, view_id: int) -> DesktopView:
        err = self._guard() or self._stale(view_id)
        if err is not None:
            return err
        app = self.front
        assert app is not None
        node = self._nodes.get(number)
        if node is None:
            return error_view(app.info, f"there is no element [{number}]")
        if not node.enabled:
            return error_view(app.info, f"element [{number}] is disabled")
        self.posted.append(("click", number, node.title))
        if node.role == "menu":
            app.open_menu = None if app.open_menu is node else node
        elif node.editable:
            app.focused = node
        elif node.on_press is not None:
            if node.role == "menu item":
                app.open_menu = None
            node.on_press(app)
        return self.look()

    def type_text(self, text: str, view_id: int) -> DesktopView:
        err = self._guard() or self._stale(view_id)
        if err is not None:
            return err
        app = self.front
        assert app is not None
        node = app.focused
        if node is None or not node.editable:
            return error_view(app.info, "nothing editable has keyboard focus")
        if node.secure:
            return error_view(app.info, "refusing to type into a password field")
        self.posted.append(("type", text))
        app.undo.append(node.value)
        node.value += text
        return self.look()

    def hotkey(self, combo: str, view_id: int) -> DesktopView:
        err = self._guard() or self._stale(view_id)
        if err is not None:
            return err
        app = self.front
        assert app is not None
        norm = normalize_hotkey(combo)
        if norm is None:
            return error_view(app.info, f"'{combo}' is not a key combination")
        self.posted.append(("hotkey", norm))
        handler = app.hotkeys.get(norm)
        if handler is not None:
            handler(app)
        elif norm == "escape":
            _dismiss(app)
        return self.look()

    def cancel_modal(self) -> DesktopView:
        app = self.front
        if app is None:
            return error_view(None, "no app is in front")
        self.posted.append(("cancel_modal",))
        _dismiss(app)
        return self.look()

    def screenshot(self, path: Path | str) -> bool:
        return False

    def current(self) -> DesktopView | None:
        return self._view

    def reset(self) -> None:
        self._view = None
        if self.front is not None:
            _dismiss(self.front)

    def close(self) -> None:
        return None
