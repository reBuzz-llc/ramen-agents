"""Developer actions and self-upgrade. Only active when [developer] is enabled.

Everything here is workspace-scoped: the policy has already resolved every path and checked that
it stays inside `developer.root`; this module does the work. Command output, file contents and
test results reach the model as plain text, never as instructions.

Self-upgrade never edits the checkout the bot is running from. It works in a git worktree under
`root/checkout`, on a branch named `<prefix><n>`. Submitting fast-forwards `main` and hands
control to the supervisor (exit code 75), which restarts on the new code and rolls back if the
new version crashes soon after starting. See scripts/supervise.sh.
"""
from __future__ import annotations

import datetime as dt
import json
import logging
import os
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

from .config import DeveloperConfig

UPGRADE_EXIT_CODE = 75  # "merged a new version; restart me on it" -- the supervisor understands this
CHECKOUT_DIR = "checkout"
STATE_FILE = "upgrade.json"
LAST_GOOD_FILE = "last_good"


@dataclass
class CommandResult:
    ok: bool
    returncode: int
    output: str
    timed_out: bool = False

    def summary(self, limit: int = 300) -> str:
        head = "ok" if self.ok else ("timed out" if self.timed_out else f"exit {self.returncode}")
        tail = self.output.strip().replace("\n", " | ")[:limit]
        return f"{head}: {tail}" if tail else head


class Developer:
    def __init__(
        self,
        cfg: DeveloperConfig,
        root: Path,
        repo_root: Path,
        logger: logging.Logger | None = None,
        output_limit: int = 6000,
    ):
        self.cfg = cfg
        self.root = Path(root).resolve()
        self.repo_root = Path(repo_root).resolve()
        self.logger = logger or logging.getLogger("explorer.developer")
        self.output_limit = output_limit
        self.root.mkdir(parents=True, exist_ok=True)

    # ---- files --------------------------------------------------------------

    def list_files(self, path: Path) -> str:
        if not path.exists():
            return f"(nothing at {self._rel(path)})"
        if path.is_file():
            return f"{self._rel(path)} ({path.stat().st_size} bytes)"
        lines: list[str] = []
        for child in sorted(path.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower())):
            if child.name in (".git", "__pycache__", ".venv") or child.name.startswith(".pytest"):
                continue
            mark = "/" if child.is_dir() else f" ({child.stat().st_size} bytes)"
            lines.append(f"{child.name}{mark}")
            if len(lines) >= 200:
                lines.append("(more entries not shown)")
                break
        return "\n".join(lines) if lines else "(empty folder)"

    def read_file(self, path: Path, offset: int) -> tuple[str, bool]:
        """A window of text starting at `offset`, and whether more follows. Same paging as `read`."""
        if not path.is_file():
            raise FileNotFoundError(f"no file at {self._rel(path)}")
        if path.stat().st_size > self.cfg.max_file_bytes:
            raise ValueError(f"{self._rel(path)} is larger than {self.cfg.max_file_bytes} bytes")
        text = path.read_text(encoding="utf-8", errors="replace")
        window = text[offset : offset + self.output_limit]
        return window, len(text) > offset + self.output_limit

    def write_file(self, path: Path, content: str) -> int:
        path.parent.mkdir(parents=True, exist_ok=True)
        data = content.encode("utf-8")
        path.write_bytes(data)
        return len(data)

    # ---- commands -----------------------------------------------------------

    def run(self, argv: list[str], cwd: Path, timeout: float | None = None) -> CommandResult:
        """argv without a shell. Clean environment: only PATH, HOME, LANG, and the venv's python."""
        env = {
            "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
            "HOME": os.environ.get("HOME", str(Path.home())),
            "LANG": os.environ.get("LANG", "en_US.UTF-8"),
            "PYTHONDONTWRITEBYTECODE": "1",
        }
        argv = [a for a in argv]
        if argv and Path(argv[0]).name in ("python", "python3", "pytest"):
            # Use the bot's own interpreter so the worktree's tests run with the same dependencies.
            argv = [sys.executable, "-m", "pytest"] + argv[1:] if Path(argv[0]).name == "pytest" else [sys.executable] + argv[1:]
        timeout = timeout or self.cfg.command_timeout_seconds
        try:
            proc = subprocess.run(
                argv, cwd=str(cwd), env=env, capture_output=True, text=True, timeout=timeout, check=False
            )
        except subprocess.TimeoutExpired as exc:
            out = (exc.stdout or "") if isinstance(exc.stdout, str) else ""
            return CommandResult(False, -1, self._clip(out + f"\n(timed out after {timeout:.0f}s)"), timed_out=True)
        except (OSError, ValueError) as exc:
            return CommandResult(False, -1, f"{type(exc).__name__}: {exc}")
        output = self._clip((proc.stdout or "") + (("\n" + proc.stderr) if proc.stderr else ""))
        return CommandResult(proc.returncode == 0, proc.returncode, output)

    # ---- self-upgrade ------------------------------------------------------

    @property
    def checkout(self) -> Path:
        return self.root / CHECKOUT_DIR

    @property
    def state_path(self) -> Path:
        return self.root / STATE_FILE

    @property
    def last_good_path(self) -> Path:
        return self.root / LAST_GOOD_FILE

    def upgrade_state(self) -> dict | None:
        if not self.state_path.exists():
            return None
        try:
            state = json.loads(self.state_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return None
        if not self.checkout.exists():
            self.state_path.unlink(missing_ok=True)  # stale state without a worktree
            return None
        return state

    def _save_state(self, state: dict) -> None:
        self.state_path.write_text(json.dumps(state, indent=2), encoding="utf-8")

    def _git(self, *args: str, cwd: Path | None = None) -> CommandResult:
        return self.run(["git", *args], cwd=cwd or self.repo_root, timeout=120)

    def _next_branch(self) -> str:
        listing = self._git("branch", "--list", f"{self.cfg.upgrade_branch_prefix}*")
        n = 0
        for line in listing.output.splitlines():
            name = line.strip().lstrip("* ").strip()
            tail = name[len(self.cfg.upgrade_branch_prefix):]
            if tail.isdigit():
                n = max(n, int(tail))
        return f"{self.cfg.upgrade_branch_prefix}{n + 1}"

    def upgrade_start(self, goal: str) -> str:
        if self.upgrade_state() is not None:
            raise RuntimeError("an upgrade is already in progress")
        if self.checkout.exists():
            self._git("worktree", "remove", "--force", str(self.checkout))
            if self.checkout.exists():  # a plain folder the agent made earlier, not a worktree
                shutil.rmtree(self.checkout)
        self._git("worktree", "prune")
        base = self._git("rev-parse", "HEAD")
        if not base.ok:
            raise RuntimeError(f"cannot read the repository: {base.summary()}")
        branch = self._next_branch()
        made = self._git("worktree", "add", "-b", branch, str(self.checkout), "HEAD")
        if not made.ok:
            raise RuntimeError(f"could not create the worktree: {made.summary()}")
        self._save_state(
            {
                "branch": branch,
                "goal": goal.strip()[:500],
                "base": base.output.strip(),
                "started": dt.datetime.now().isoformat(timespec="seconds"),
                "tests_passed": False,
            }
        )
        self.logger.info("upgrade started on %s: %s", branch, goal.strip()[:80])
        return branch

    def upgrade_test(self) -> CommandResult:
        state = self.upgrade_state()
        if state is None:
            raise RuntimeError("no upgrade in progress")
        result = self.run(["pytest", "-q", "-x", "--no-header", "-p", "no:cacheprovider"], cwd=self.checkout, timeout=600)
        state["tests_passed"] = result.ok
        state["last_test"] = result.summary(200)
        self._save_state(state)
        return result

    def upgrade_changed_files(self) -> list[str]:
        """Paths changed in the worktree relative to its base: committed, staged, and unstaged."""
        state = self.upgrade_state()
        if state is None:
            return []
        names: set[str] = set()
        for args in (("diff", "--name-only", state["base"]), ("diff", "--name-only", "--cached"), ("ls-files", "--others", "--exclude-standard")):
            res = self._git(*args, cwd=self.checkout)
            if res.ok:
                names.update(line.strip() for line in res.output.splitlines() if line.strip())
        return sorted(names)

    def upgrade_protected_changes(self) -> list[str]:
        protected = {p.strip().lower() for p in self.cfg.protected_names}
        return [f for f in self.upgrade_changed_files() if any(part.lower() in protected for part in Path(f).parts)]

    def upgrade_submit(self) -> str:
        """Commit the worktree, fast-forward main, record the previous version as last good, and
        remove the worktree. Returns the new HEAD. The caller exits with UPGRADE_EXIT_CODE."""
        state = self.upgrade_state()
        if state is None:
            raise RuntimeError("no upgrade in progress")
        if not state.get("tests_passed"):
            raise RuntimeError("the last test run did not pass")
        protected = self.upgrade_protected_changes()
        if protected:
            raise RuntimeError(f"protected files changed: {', '.join(protected[:5])}")
        self._git("add", "-A", cwd=self.checkout)
        staged = self._git("diff", "--cached", "--quiet", cwd=self.checkout)
        if not staged.ok:  # exit 1 means there is something to commit
            msg = f"bot: {state['goal'][:72]}\n\nProposed and tested by the agent itself in {state['branch']}."
            committed = self._git("commit", "-q", "-m", msg, cwd=self.checkout)
            if not committed.ok:
                raise RuntimeError(f"could not commit the change: {committed.summary()}")
        previous = self._git("rev-parse", "HEAD").output.strip()
        merged = self._git("merge", "--ff-only", state["branch"])
        if not merged.ok:
            raise RuntimeError(f"could not fast-forward main: {merged.summary()}")
        self.last_good_path.write_text(previous + "\n", encoding="utf-8")
        self._git("worktree", "remove", "--force", str(self.checkout))
        self.state_path.unlink(missing_ok=True)
        new_head = self._git("rev-parse", "HEAD").output.strip()
        self.logger.info("upgrade %s merged: %s -> %s", state["branch"], previous[:8], new_head[:8])
        return new_head

    def upgrade_abandon(self) -> None:
        """Drop the worktree but keep the branch, so the owner can look at what was tried."""
        if self.checkout.exists():
            self._git("worktree", "remove", "--force", str(self.checkout))
        self._git("worktree", "prune")
        self.state_path.unlink(missing_ok=True)

    # ---- helpers ------------------------------------------------------------

    def _rel(self, path: Path) -> str:
        try:
            return str(path.relative_to(self.root)) or "."
        except ValueError:
            return str(path)

    def _clip(self, text: str) -> str:
        if len(text) <= self.output_limit:
            return text
        return text[: self.output_limit] + f"\n(output cut at {self.output_limit} characters)"
