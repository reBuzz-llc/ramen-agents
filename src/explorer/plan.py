"""Work plans (owner, 2026-09-26).

Two files meet here. `workspace/plan.json` is the bot's own plan for the job it is on -- a task line, a "done when"
test and a short checklist it ticks as it goes -- written by the engine, read by the webapp's Work plan page and by
the Validator (a ticked step carries done_at and by_action: the accepted write behind it). `common-data/work-plan.json`
is the owner's: a one-line goal and up to eight one-line rules per bot, edited on the page and injected into the
system prompt as "## The owner's work plan", re-read whenever the file changes."""
from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

MAX_STEPS = 8
# A plan is finished by output, not by talk: at least one ticked step must be backed by one of these writes (the CEO's
# first plan was "message myself, then tell the owner" -- a whole job that produced nothing, 2026-09-26).
OUTPUT_TYPES = frozenset({"lead", "update_lead", "task", "update_task", "package", "publish_package", "provider", "note"})


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S")


@dataclass
class WorkPlan:
    task: str
    done_when: str
    steps: list[dict[str, Any]] = field(default_factory=list)  # {"text", "done", "done_at", "by_action"}
    source: str = "own"  # owner | priority | own
    status: str = "active"  # active | done | stuck
    started: str = field(default_factory=_now)
    updated: str = field(default_factory=_now)
    note: str = ""  # why it ended, when stuck
    estimate_min: int | None = None  # the bot's estimate of working minutes for the whole job

    @classmethod
    def new(cls, task: str, done_when: str, steps: list[str], source: str = "own",
            step_minutes: list[int] | None = None, estimate_min: int | None = None) -> "WorkPlan":
        kept = [s.strip()[:160] for s in steps if s.strip()][:MAX_STEPS]
        mins = [int(m) for m in (step_minutes or []) if isinstance(m, (int, float)) and 0 < int(m) <= 600]
        rows = [{"text": t, "done": False, "done_at": None, "by_action": None, "estimate_min": (mins[i] if i < len(mins) else None)}
                for i, t in enumerate(kept)]
        total = int(estimate_min) if estimate_min and 0 < int(estimate_min) <= 3000 else (sum(mins[: len(kept)]) or None)
        return cls(task=task.strip()[:200], done_when=done_when.strip()[:200], source=source if source in ("owner", "priority", "own") else "own",
                   steps=rows, estimate_min=total)

    def step_estimate(self, number: int, default: int = 60) -> int:
        """Working minutes the bot gave step `number` (1-based), else its share of the plan's estimate, else `default`."""
        if 1 <= number <= len(self.steps):
            est = self.steps[number - 1].get("estimate_min")
            if est:
                return int(est)
        if self.estimate_min and self.steps:
            return max(5, int(self.estimate_min / len(self.steps)))
        return default

    @property
    def active(self) -> bool:
        return self.status == "active"

    @property
    def open_steps(self) -> list[int]:
        return [i + 1 for i, s in enumerate(self.steps) if not s.get("done")]

    @property
    def produced(self) -> bool:
        """Some ticked step is backed by an output write (OUTPUT_TYPES), or the job was the owner's own ask."""
        return self.source == "owner" or any(s.get("done") and str(s.get("by_type") or "") in OUTPUT_TYPES for s in self.steps)

    def tick(self, number: int, by_action: int | None, by_type: str = "", actual_min: float | None = None) -> bool:
        """Mark step `number` (1-based) done. False when there is no such open step. The plan finishes itself only when
        every step is ticked AND something was produced; otherwise it stays active with a note."""
        if not 1 <= number <= len(self.steps) or self.steps[number - 1].get("done"):
            return False
        self.steps[number - 1].update({"done": True, "done_at": _now(), "by_action": by_action, "by_type": by_type or None,
                                       "actual_min": (round(float(actual_min), 1) if actual_min is not None else None)})
        self.updated = _now()
        if not self.open_steps:
            if self.produced:
                self.status, self.note = "done", "every step ticked"
            else:
                self.note = "every step ticked but nothing produced (no lead, task, package, note or entry)"
        return True

    def end(self, status: str, note: str = "") -> None:
        self.status = status if status in ("done", "stuck") else "done"
        self.note = note.strip()[:300]
        self.updated = _now()

    def names_domain(self, domain: str) -> bool:
        """True when the plan's task or steps name this site: the domain itself, or its main label as the business
        name without spaces ("Sunny Deli" for sunnydeli-example.com). A common word that merely sits inside the label does
        not count -- "restaurants" is not petrossianrestaurants.com (26 wrongly refused plans, 2026-09-30)."""
        dom = (domain or "").lower()
        label = dom.split(".")[0]
        if not label:
            return False
        text = " ".join([self.task, *(str(s.get("text", "")) for s in self.steps)]).lower()
        if dom in text:
            return True
        squashed = __import__("re").sub(r"[^a-z0-9]", "", text)
        if len(label) >= 6 and label in squashed:
            return True
        # the business name as written ("cedar dental") against a label that wraps it ("eatholymolli"): two or more
        # consecutive words of the plan, at least 8 letters together, found inside the label
        words = __import__("re").findall(r"[a-z0-9]+", text)
        for i in range(len(words) - 1):
            pair = words[i] + words[i + 1]
            if len(pair) >= 8 and pair in label:
                return True
        return False

    def render(self) -> list[str]:
        """Lines for the decide prompt: where the bot is in its job."""
        head = f"Your plan ({self.source} job, {self.status}): {self.task}"
        lines = [head, f"Done when: {self.done_when}"]
        for i, s in enumerate(self.steps, 1):
            lines.append(f"  [{'x' if s.get('done') else ' '}] {i}. {s.get('text', '')}")
        return lines

    def to_dict(self) -> dict[str, Any]:
        return {"task": self.task, "source": self.source, "done_when": self.done_when, "steps": self.steps,
                "status": self.status, "started": self.started, "updated": self.updated, "note": self.note,
                "estimate_min": self.estimate_min}

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "WorkPlan":
        steps = [s if isinstance(s, dict) else {"text": str(s), "done": False, "done_at": None, "by_action": None} for s in (d.get("steps") or [])]
        return cls(task=str(d.get("task", "")), done_when=str(d.get("done_when", "")), steps=steps, source=str(d.get("source", "own")),
                   status=str(d.get("status", "active")), started=str(d.get("started") or _now()), updated=str(d.get("updated") or _now()),
                   note=str(d.get("note", "")), estimate_min=(int(d["estimate_min"]) if d.get("estimate_min") else None))


def load_plan(path: Path) -> WorkPlan | None:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return WorkPlan.from_dict(data) if isinstance(data, dict) and data.get("task") else None


def save_plan(path: Path, plan: WorkPlan) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + f".{os.getpid()}.tmp")
    tmp.write_text(json.dumps(plan.to_dict(), indent=1, ensure_ascii=False), encoding="utf-8")
    tmp.replace(path)


class OwnerWorkPlan:
    """The owner's goal and rules for one bot from common-data/work-plan.json, re-read when the file changes."""

    def __init__(self, path: Path | None, slug: str):
        self.path, self.slug = path, slug
        self._mtime: float | None = None
        self.goal, self.rules = "", []  # type: str, list[tuple[str, str]]

    def refresh(self) -> bool:
        """True when the file changed (the system prompt should be rebuilt)."""
        if self.path is None:
            return False
        try:
            mtime: float | None = self.path.stat().st_mtime
        except OSError:
            mtime = None
        if mtime == self._mtime:
            return False
        self._mtime = mtime
        goal, rules = "", []
        if mtime is not None:
            try:
                data = json.loads(self.path.read_text(encoding="utf-8"))
                mine = ((data.get("bots") or {}).get(self.slug) or {}) if isinstance(data, dict) else {}
                goal = str(mine.get("goal") or "").strip()[:200]
                for i, r in enumerate((mine.get("rules") or [])[:8], 1):
                    if isinstance(r, dict):
                        rid, text = str(r.get("id") or f"r{i}"), str(r.get("text") or "").strip()
                    else:
                        rid, text = f"r{i}", str(r).strip()
                    if text:
                        rules.append((rid, text[:160]))
            except (OSError, ValueError):
                pass
        self.goal, self.rules = goal, rules
        return True

    def block(self) -> str:
        if not self.goal and not self.rules:
            return ""
        lines = ["", "## YOUR GOAL, set by the owner on the Work plan page",
                 "This outranks the goal and the work described in the rest of these instructions, your own goal, and any "
                 "colleague's steer; only the owner's fence (no accounts, keys, spending, personal data, invented values) is "
                 "above it. Read everything below as HOW you work toward it. If your own goal does not serve it, revise your goal."]
        if self.goal:
            lines.append(f"Goal: {self.goal}")
        if self.rules:
            lines.append("The owner's rules for you:")
        lines.extend(f"- [{rid}] {text}" for rid, text in self.rules)
        return "\n".join(lines) + "\n"

    def step_line(self) -> str | None:
        """One line for every step's state: the goal stays in front of the bot, not only in its instructions."""
        if not self.goal and not self.rules:
            return None
        rules = "; ".join(text for _, text in self.rules)
        return ("Owner's goal for you (outranks everything but the fence): " + (self.goal or "(no goal; follow the rules)")
                + (f". Owner's rules: {rules}" if rules else "") + ". Is this step a step toward it?")
