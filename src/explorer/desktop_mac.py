"""The real Mac: accessibility tree in, keyboard and mouse events out.

This is the only module that imports pyobjc. It is imported lazily by cli.build_controller when
desktop.backend = "mac". Everything the model sees comes from the accessibility tree; screenshots are
only for the dashboard. See docs/plan-dashboard-and-desktop.md for the design and the pitfalls.
"""
from __future__ import annotations

import logging
import re
import subprocess
import time
from collections import deque
from pathlib import Path
from typing import Any

import AppKit
import ApplicationServices as AS
import Quartz
from CoreFoundation import CFEqual

from .config import DesktopConfig
from .desktop import AppInfo, DesktopStatus, DesktopView, Element, error_view, normalize_hotkey

# ---- tables --------------------------------------------------------------------

ROLE_NAMES = {
    "AXButton": "button", "AXTextField": "text field", "AXTextArea": "text area",
    "AXSecureTextField": "password field", "AXCheckBox": "checkbox", "AXRadioButton": "radio button",
    "AXPopUpButton": "popup button", "AXComboBox": "combo box", "AXMenuButton": "menu button",
    "AXMenuBarItem": "menu", "AXMenuItem": "menu item", "AXLink": "link", "AXStaticText": "static text",
    "AXSlider": "slider", "AXIncrementor": "stepper", "AXDisclosureTriangle": "disclosure", "AXTab": "tab",
    "AXCell": "cell", "AXRow": "row", "AXImage": "image", "AXHeading": "heading",
}
SHOW = set(ROLE_NAMES) - {"AXCell", "AXRow", "AXImage"}
DESCEND = {
    "AXWindow", "AXSheet", "AXDrawer", "AXGroup", "AXScrollArea", "AXSplitGroup", "AXToolbar", "AXTabGroup",
    "AXList", "AXTable", "AXOutline", "AXRow", "AXCell", "AXWebArea", "AXMenuBar", "AXMenu", "AXLayoutArea",
    "AXGenericElement", "AXRadioGroup", "AXUnknown", "AXBrowser", "AXColumn",
}
EDITABLE = {"AXTextField", "AXTextArea", "AXComboBox", "AXSecureTextField"}
SECURE_TITLE = re.compile(r"password|passcode|\bpin\b|secret|token|\botp\b|credential", re.IGNORECASE)

KEYCODES = {
    "a": 0, "s": 1, "d": 2, "f": 3, "h": 4, "g": 5, "z": 6, "x": 7, "c": 8, "v": 9, "b": 11, "q": 12,
    "w": 13, "e": 14, "r": 15, "y": 16, "t": 17, "1": 18, "2": 19, "3": 20, "4": 21, "6": 22, "5": 23,
    "=": 24, "9": 25, "7": 26, "-": 27, "8": 28, "0": 29, "]": 30, "o": 31, "u": 32, "[": 33, "i": 34,
    "p": 35, "return": 36, "l": 37, "j": 38, "'": 39, "k": 40, ";": 41, "\\": 42, ",": 43, "/": 44,
    "n": 45, "m": 46, ".": 47, "tab": 48, "space": 49, "`": 50, "delete": 51, "escape": 53,
    "left": 123, "right": 124, "down": 125, "up": 126, "home": 115, "end": 119, "pageup": 116, "pagedown": 121,
}
MODIFIER_FLAGS = {
    "cmd": Quartz.kCGEventFlagMaskCommand,
    "shift": Quartz.kCGEventFlagMaskShift,
    "alt": Quartz.kCGEventFlagMaskAlternate,
    "ctrl": Quartz.kCGEventFlagMaskControl,
}
ATTRS = [
    AS.kAXRoleAttribute, AS.kAXSubroleAttribute, AS.kAXTitleAttribute, AS.kAXValueAttribute,
    AS.kAXDescriptionAttribute, AS.kAXEnabledAttribute, AS.kAXPositionAttribute, AS.kAXSizeAttribute,
]
_NUM = re.compile(r"[-+]?\d+(?:\.\d+)?")


# ---- small AX helpers --------------------------------------------------------------


def _get(el: Any, attr: str) -> Any:
    try:
        err, value = AS.AXUIElementCopyAttributeValue(el, attr, None)
    except Exception:  # noqa: BLE001 - pyobjc raises on some dead elements
        return None
    return value if err == 0 else None


def _children(el: Any, limit: int = 60) -> list[Any]:
    try:
        err, kids = AS.AXUIElementCopyAttributeValues(el, AS.kAXChildrenAttribute, 0, limit, None)
        if err == 0 and kids:
            return list(kids)
    except Exception:  # noqa: BLE001
        pass
    kids = _get(el, AS.kAXChildrenAttribute)
    return list(kids)[:limit] if kids else []


def _axvalue_numbers(value: Any) -> list[float]:
    """AXValue structs (points, sizes) come back as opaque objects; their repr carries the numbers."""
    if value is None:
        return []
    return [float(n) for n in _NUM.findall(repr(value))][-2:]


def _point(value: Any) -> tuple[float, float]:
    try:
        ok, point = AS.AXValueGetValue(value, 1, None)  # kAXValueCGPointType
        if ok and point is not None:
            return float(point.x), float(point.y)
    except Exception:  # noqa: BLE001
        pass
    nums = _axvalue_numbers(value)
    return (nums[0], nums[1]) if len(nums) == 2 else (0.0, 0.0)


def _size(value: Any) -> tuple[float, float]:
    try:
        ok, size = AS.AXValueGetValue(value, 2, None)  # kAXValueCGSizeType
        if ok and size is not None:
            return float(size.width), float(size.height)
    except Exception:  # noqa: BLE001
        pass
    nums = _axvalue_numbers(value)
    return (nums[0], nums[1]) if len(nums) == 2 else (0.0, 0.0)


def _text(value: Any, limit: int = 120) -> str:
    if value is None:
        return ""
    if isinstance(value, (int, float, bool)):
        return str(value)
    if isinstance(value, str):
        return " ".join(value.split())[:limit]
    return ""


def _same(a: Any, b: Any) -> bool:
    try:
        return bool(CFEqual(a, b))
    except Exception:  # noqa: BLE001
        return False


# ---- presence: is a human using the Mac? --------------------------------------------------


class Presence:
    """Tells our own synthetic events apart from the owner's input.

    HID idle time resets on posted events too, so an input newer than our last post (plus a margin)
    is a human. Event types we never synthesise (scroll, right/middle click, modifier-only changes)
    are human whenever they are newer than the last human input we knew about."""

    MARGIN = 0.75
    HUMAN_ONLY = (
        Quartz.kCGEventScrollWheel, Quartz.kCGEventRightMouseDown, Quartz.kCGEventOtherMouseDown,
        Quartz.kCGEventFlagsChanged,
    )

    def __init__(self) -> None:
        now = time.time()
        self.last_posted = float("-inf")
        self.last_human = now - self._idle(Quartz.kCGAnyInputEventType)  # the best baseline we have

    @staticmethod
    def _idle(event_type: int) -> float:
        return float(Quartz.CGEventSourceSecondsSinceLastEventType(Quartz.kCGEventSourceStateHIDSystemState, event_type))

    def note_posted(self) -> None:
        self.last_posted = time.time()

    def check(self) -> tuple[bool, float]:
        """(new human input since the last check, seconds since the last known human input)."""
        now = time.time()
        human = False
        last_input = now - self._idle(Quartz.kCGAnyInputEventType)
        if last_input > self.last_posted + self.MARGIN and last_input > self.last_human + 0.05:
            self.last_human = last_input
            human = True
        for kind in self.HUMAN_ONLY:
            when = now - self._idle(kind)
            if when > self.last_human + 0.05 and when > self.last_posted + self.MARGIN:
                self.last_human = when
                human = True
        return human, max(0.0, now - self.last_human)


# ---- the adapter ---------------------------------------------------------------------


class MacDesktop:
    def __init__(self, cfg: DesktopConfig, logger: logging.Logger | None = None):
        self.cfg = cfg
        self.logger = logger or logging.getLogger("explorer.desktop")
        self.presence = Presence()
        self._view: DesktopView | None = None
        self._view_id = 0
        self._elements: dict[int, tuple[Any, str, str]] = {}  # number -> (AXUIElement, role, title)
        self._app_el: Any = None
        self._app_pid = 0
        self._window_frame: tuple[float, float, float, float] | None = None
        try:
            AS.AXUIElementSetMessagingTimeout(AS.AXUIElementCreateSystemWide(), 2.0)
        except Exception:  # noqa: BLE001
            pass

    # -- status

    def status(self) -> DesktopStatus:
        session = Quartz.CGSessionCopyCurrentDictionary() or {}
        human, idle = self.presence.check()
        front = self._frontmost()
        screensaver = bool(AppKit.NSRunningApplication.runningApplicationsWithBundleIdentifier_("com.apple.ScreenSaver.Engine"))
        if front is not None and front.bundle_id in ("com.apple.loginwindow", "com.apple.ScreenSaver.Engine"):
            screensaver = True
        try:
            asleep = bool(Quartz.CGDisplayIsAsleep(Quartz.CGMainDisplayID()))
        except Exception:  # noqa: BLE001
            asleep = False
        return DesktopStatus(
            trusted=bool(AS.AXIsProcessTrusted()),
            on_console=bool(session.get("kCGSSessionOnConsoleKey", False)) if session else False,
            locked=bool(session.get("CGSSessionScreenIsLocked", False)),
            screensaver=screensaver,
            display_asleep=asleep,
            idle_seconds=idle,
            human_detected=human,
            frontmost=front,
        )

    @staticmethod
    def _frontmost() -> AppInfo | None:
        ra = AppKit.NSWorkspace.sharedWorkspace().frontmostApplication()
        if ra is None:
            return None
        return AppInfo(str(ra.localizedName() or ""), str(ra.bundleIdentifier() or ""), int(ra.processIdentifier()))

    def apps(self) -> list[AppInfo]:
        out = []
        for ra in AppKit.NSWorkspace.sharedWorkspace().runningApplications():
            if ra.activationPolicy() == 0:  # regular apps with a Dock icon
                out.append(AppInfo(str(ra.localizedName() or ""), str(ra.bundleIdentifier() or ""), int(ra.processIdentifier())))
        return out

    # -- activation and looking

    def activate(self, name: str) -> DesktopView:
        wanted = name.strip().lower()
        try:
            subprocess.run(["open", "-a", name.strip()], check=True, capture_output=True, timeout=15)
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as exc:
            return error_view(None, f"could not open '{name}': {str(exc)[:120]}")
        deadline = time.time() + 6
        while time.time() < deadline:
            front = self._frontmost()
            if front is not None and front.name.lower() == wanted:
                time.sleep(0.4)  # let the window settle
                return self.look()
            time.sleep(0.2)
        front = self._frontmost()
        return error_view(front, f"'{name}' did not come to the front (front is '{front.name if front else 'nothing'}')")

    def look(self) -> DesktopView:
        front = self._frontmost()
        if front is None:
            return error_view(None, "no app is in front")
        if not AS.AXIsProcessTrusted():
            return error_view(front, "Accessibility permission is not granted")
        if self._app_pid != front.pid or self._app_el is None:
            self._app_el = AS.AXUIElementCreateApplication(front.pid)
            self._app_pid = front.pid
            try:
                AS.AXUIElementSetMessagingTimeout(self._app_el, 1.0)
                AS.AXUIElementSetAttributeValue(self._app_el, "AXManualAccessibility", True)  # wakes Electron apps
            except Exception:  # noqa: BLE001
                pass
        app_el = self._app_el
        roots: list[tuple[Any, bool]] = []
        modal: str | None = None
        window_title = ""
        self._window_frame = None
        for win in _children_of_windows(app_el):
            role = _text(_get(win, AS.kAXRoleAttribute))
            subrole = _text(_get(win, AS.kAXSubroleAttribute))
            if role == "AXSheet" or subrole in ("AXDialog", "AXSystemDialog") or bool(_get(win, AS.kAXModalAttribute)):
                modal = modal or f'{"sheet" if role == "AXSheet" else "dialog"} "{_text(_get(win, AS.kAXTitleAttribute)) or "untitled"}"'
                roots.append((win, True))
        focused_win = _get(app_el, AS.kAXFocusedWindowAttribute)
        if focused_win is not None and not bool(_get(focused_win, AS.kAXMinimizedAttribute)):
            window_title = _text(_get(focused_win, AS.kAXTitleAttribute), 100)
            x, y = _point(_get(focused_win, AS.kAXPositionAttribute))
            w, h = _size(_get(focused_win, AS.kAXSizeAttribute))
            if w > 0 and h > 0:
                self._window_frame = (x, y, w, h)
            for sheet in _children(focused_win, 20):
                if _text(_get(sheet, AS.kAXRoleAttribute)) == "AXSheet":
                    modal = modal or f'sheet "{_text(_get(sheet, AS.kAXTitleAttribute)) or "untitled"}"'
                    roots.append((sheet, True))
            roots.append((focused_win, False))
        menubar = _get(app_el, AS.kAXMenuBarAttribute)
        if menubar is not None:
            roots.append((menubar, False))
        focused_el = _get(app_el, AS.kAXFocusedUIElementAttribute)
        elements, truncated = self._walk(roots, focused_el)
        self._view_id += 1
        focused = next((e.number for e in elements if e.focused), None)
        self._view = DesktopView(front, window_title, elements, modal, focused, truncated, self._view_id)
        return self._view

    def _walk(self, roots: list[tuple[Any, bool]], focused_el: Any) -> tuple[list[Element], bool]:
        elements: list[Element] = []
        self._elements = {}
        queue: deque[tuple[Any, bool, int]] = deque((root, modal, 0) for root, modal in roots)
        examined = 0
        started = time.monotonic()
        truncated = False
        while queue:
            if len(elements) >= self.cfg.max_elements or examined >= 800 or time.monotonic() - started > 2.5:
                truncated = True
                break
            el, modal, depth = queue.popleft()
            examined += 1
            try:
                err, values = AS.AXUIElementCopyMultipleAttributeValues(el, ATTRS, 0, None)
                if err != 0 or values is None:
                    continue
                role, subrole, title, value, desc, enabled, pos, size = [None if _is_error_marker(v) else v for v in values]
            except Exception:  # noqa: BLE001
                continue
            role_s = _text(role)
            if depth > 0:
                w, h = _size(size)
                if w <= 0 or h <= 0:
                    continue
            else:
                w, h = _size(size)
            x, y = _point(pos)
            title_s = _text(title, 80) or _text(desc, 80)
            value_s = _text(value)
            if role_s in SHOW and (role_s != "AXStaticText" or value_s or title_s):
                number = len(elements) + 1
                secure = role_s == "AXSecureTextField" or (role_s in EDITABLE and bool(SECURE_TITLE.search(title_s)))
                elements.append(
                    Element(
                        number, ROLE_NAMES.get(role_s, role_s.lower()), title_s,
                        value_s if role_s != "AXSecureTextField" else None,
                        enabled is not False, role_s in EDITABLE and not secure, secure,
                        focused=focused_el is not None and _same(el, focused_el), modal=modal, frame=(x, y, w, h),
                    )
                )
                self._elements[number] = (el, role_s, title_s)
            descend = role_s in DESCEND
            if role_s == "AXMenuBarItem":
                descend = bool(_get(el, AS.kAXSelectedAttribute))  # only an open menu shows its items
            if descend:
                limit = 30 if role_s == "AXWebArea" else 60
                for child in _children(el, limit):
                    queue.append((child, modal, depth + 1))
        return elements, truncated

    # -- acting

    def _guard(self, view_id: int) -> DesktopView | None:
        status = self.status()
        if not status.safe:
            return error_view(status.frontmost, status.reason)
        if self._view is None or view_id != self._view.view_id:
            return error_view(status.frontmost, "the screen changed; look again")
        front = status.frontmost
        if front is None or front.pid != self._app_pid:
            return error_view(front, "a different app came to the front; look again")
        return None

    def click(self, number: int, view_id: int) -> DesktopView:
        err = self._guard(view_id)
        if err is not None:
            return err
        entry = self._elements.get(number)
        if entry is None:
            return error_view(self._frontmost(), f"there is no element [{number}]")
        el, role, title = entry
        if _text(_get(el, AS.kAXRoleAttribute)) != role or _text(_get(el, AS.kAXTitleAttribute), 80) not in (title, ""):
            return error_view(self._frontmost(), f"element [{number}] is not what it was; look again")
        pressed = False
        try:
            err_code, names = AS.AXUIElementCopyActionNames(el, None)
            if err_code == 0 and names and AS.kAXPressAction in list(names):
                pressed = AS.AXUIElementPerformAction(el, AS.kAXPressAction) == 0
        except Exception:  # noqa: BLE001
            pressed = False
        if not pressed:
            x, y = _point(_get(el, AS.kAXPositionAttribute))
            w, h = _size(_get(el, AS.kAXSizeAttribute))
            if w <= 0 or h <= 0:
                return error_view(self._frontmost(), f"element [{number}] has no position to click")
            self._cg_click(x + w / 2, y + h / 2)
        time.sleep(0.35)
        return self.look()

    def _cg_click(self, x: float, y: float) -> None:
        old = Quartz.CGEventGetLocation(Quartz.CGEventCreate(None))
        for kind in (Quartz.kCGEventLeftMouseDown, Quartz.kCGEventLeftMouseUp):
            ev = Quartz.CGEventCreateMouseEvent(None, kind, (x, y), Quartz.kCGMouseButtonLeft)
            Quartz.CGEventSetIntegerValueField(ev, Quartz.kCGMouseEventClickState, 1)
            Quartz.CGEventPost(Quartz.kCGHIDEventTap, ev)
            self.presence.note_posted()
            time.sleep(0.04)
        try:
            Quartz.CGWarpMouseCursorPosition(old)  # a warp posts no HID event
        except Exception:  # noqa: BLE001
            pass

    def type_text(self, text: str, view_id: int) -> DesktopView:
        err = self._guard(view_id)
        if err is not None:
            return err
        focused = _get(self._app_el, AS.kAXFocusedUIElementAttribute)
        if focused is None:
            return error_view(self._frontmost(), "nothing has keyboard focus")
        try:
            pid_err, pid = AS.AXUIElementGetPid(focused, None)
        except Exception:  # noqa: BLE001
            pid_err, pid = 1, 0
        if pid_err != 0 or int(pid) != self._app_pid:
            return error_view(self._frontmost(), "keyboard focus is in another app; look again")
        role = _text(_get(focused, AS.kAXRoleAttribute))
        title = _text(_get(focused, AS.kAXTitleAttribute), 80) or _text(_get(focused, AS.kAXDescriptionAttribute), 80)
        if role == "AXSecureTextField" or SECURE_TITLE.search(title):
            return error_view(self._frontmost(), "refusing to type into a password field")
        if role not in EDITABLE:
            return error_view(self._frontmost(), f"the focused element ({ROLE_NAMES.get(role, role)}) is not editable")
        done = False
        try:
            settable_err, settable = AS.AXUIElementIsAttributeSettable(focused, AS.kAXSelectedTextAttribute, None)
            if settable_err == 0 and settable:
                done = AS.AXUIElementSetAttributeValue(focused, AS.kAXSelectedTextAttribute, text) == 0
        except Exception:  # noqa: BLE001
            done = False
        if not done:
            self._cg_type(text)
        time.sleep(0.25)
        return self.look()

    def _cg_type(self, text: str) -> None:
        for line_no, line in enumerate(text.split("\n")):
            if line_no:
                self._cg_key(KEYCODES["return"], 0)
            for start in range(0, len(line), 20):
                chunk = line[start : start + 20]
                for down in (True, False):
                    ev = Quartz.CGEventCreateKeyboardEvent(None, 0, down)
                    Quartz.CGEventKeyboardSetUnicodeString(ev, len(chunk), chunk)
                    Quartz.CGEventPost(Quartz.kCGHIDEventTap, ev)
                    self.presence.note_posted()
                time.sleep(0.01)

    def _cg_key(self, keycode: int, flags: int) -> None:
        for down in (True, False):
            ev = Quartz.CGEventCreateKeyboardEvent(None, keycode, down)
            Quartz.CGEventSetFlags(ev, flags)
            Quartz.CGEventPost(Quartz.kCGHIDEventTap, ev)
            self.presence.note_posted()
            time.sleep(0.03)

    def hotkey(self, combo: str, view_id: int) -> DesktopView:
        err = self._guard(view_id)
        if err is not None:
            return err
        norm = normalize_hotkey(combo)
        if norm is None:
            return error_view(self._frontmost(), f"'{combo}' is not a key combination")
        *mods, key = norm.split("+")
        if key not in KEYCODES:
            return error_view(self._frontmost(), f"no key code for '{key}'")
        flags = 0
        for mod in mods:
            flags |= MODIFIER_FLAGS[mod]
        self._cg_key(KEYCODES[key], flags)
        time.sleep(0.35)
        return self.look()

    def cancel_modal(self) -> DesktopView:
        front = self._frontmost()
        if self._app_el is None or front is None or front.pid != self._app_pid:
            return self.look()
        for win in _children_of_windows(self._app_el):
            role = _text(_get(win, AS.kAXRoleAttribute))
            subrole = _text(_get(win, AS.kAXSubroleAttribute))
            if role == "AXSheet" or subrole in ("AXDialog", "AXSystemDialog"):
                cancel = _get(win, AS.kAXCancelButtonAttribute)
                if cancel is not None and AS.AXUIElementPerformAction(cancel, AS.kAXPressAction) == 0:
                    time.sleep(0.3)
                    return self.look()
                for child in _children(win, 40):
                    if _text(_get(child, AS.kAXRoleAttribute)) == "AXButton" and _text(_get(child, AS.kAXTitleAttribute)).lower() in ("cancel", "close", "not now", "don't allow"):
                        AS.AXUIElementPerformAction(child, AS.kAXPressAction)
                        time.sleep(0.3)
                        return self.look()
        self._cg_key(KEYCODES["escape"], 0)
        time.sleep(0.3)
        return self.look()

    # -- pictures and housekeeping

    def screenshot(self, path: Path | str) -> bool:
        target = Path(path)
        cmd = ["screencapture", "-x", "-o", "-t", "png"]
        if self._window_frame is not None:
            x, y, w, h = self._window_frame
            cmd += ["-R", f"{int(x)},{int(y)},{int(w)},{int(h)}"]
        cmd.append(str(target))
        try:
            subprocess.run(cmd, check=True, capture_output=True, timeout=10)
            subprocess.run(["sips", "-Z", "1280", str(target)], check=False, capture_output=True, timeout=10)
            return target.exists() and target.stat().st_size > 0
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError):
            return False

    def current(self) -> DesktopView | None:
        return self._view

    def reset(self) -> None:
        self._view = None
        self._elements = {}

    def close(self) -> None:
        try:  # never leave the OS thinking a modifier is held
            ev = Quartz.CGEventCreateKeyboardEvent(None, 0, False)
            Quartz.CGEventSetFlags(ev, 0)
            Quartz.CGEventPost(Quartz.kCGHIDEventTap, ev)
        except Exception:  # noqa: BLE001
            pass


def _children_of_windows(app_el: Any) -> list[Any]:
    windows = _get(app_el, AS.kAXWindowsAttribute)
    return list(windows)[:20] if windows else []


def _is_error_marker(value: Any) -> bool:
    """Unsupported attributes come back as AXValue objects of the error type, not as None."""
    try:
        return value is not None and hasattr(value, "__class__") and AS.AXValueGetType(value) == 5
    except Exception:  # noqa: BLE001
        return False


def doctor() -> dict[str, Any]:
    """Facts for `bot check --desktop`: permissions, interpreter, presence, what is in front."""
    import os
    import sys

    session = Quartz.CGSessionCopyCurrentDictionary() or {}
    front = MacDesktop._frontmost()
    parent = ""
    try:
        parent = subprocess.run(["ps", "-o", "comm=", "-p", str(os.getppid())], capture_output=True, text=True, timeout=5).stdout.strip()
    except Exception:  # noqa: BLE001
        pass
    interpreter = os.path.realpath(sys.executable)
    # The framework build's python3.13 re-executes into Python.app; that bundle is what TCC lists.
    bundle = interpreter
    marker = "/Python.framework/Versions/"
    if marker in interpreter:
        root, version = interpreter.split(marker, 1)
        bundle = f"{root}{marker}{version.split('/', 1)[0]}/Resources/Python.app"
    return {
        "accessibility": bool(AS.AXIsProcessTrusted()),
        "screen_recording": bool(Quartz.CGPreflightScreenCaptureAccess()),
        "interpreter": interpreter,
        "grant_to": bundle,
        "parent_process": parent,
        "on_console": bool(session.get("kCGSSessionOnConsoleKey", False)),
        "locked": bool(session.get("CGSSessionScreenIsLocked", False)),
        "idle_seconds": round(float(Quartz.CGEventSourceSecondsSinceLastEventType(Quartz.kCGEventSourceStateHIDSystemState, Quartz.kCGAnyInputEventType)), 1),
        "frontmost": f"{front.name} ({front.bundle_id})" if front else "none",
    }
