"""Publishing: the agent's home online (Milestone 4). Every destination is enabled explicitly.

- `local` writes Markdown files into `publish.local_dir`. Nothing leaves the Mac.
- `git` writes a post into a git repository the agent owns (`publish.git_dir`, created on first
  use), updates its index, and commits. It pushes only when `publish.git_remote` is set, and only to
  that one URL, with a token read from `publish.git_token_file`: the owner creates the repository,
  labels it as run by a bot, and makes a token scoped to that repository alone. The agent never
  creates accounts or repositories itself. GitHub Pages (or any static host) turns the repository
  into a site.

git runs without a shell, with a minimal environment and no terminal prompt. The token reaches
git only through a one-shot credential helper reading an environment variable on the push command;
it is never written to the repository config or the remote URL, and is scrubbed from error text.
"""
from __future__ import annotations

import datetime as dt
import os
import re
import subprocess
from pathlib import Path

from .common.keys import load_key
from .config import PublishConfig


def slugify(text: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return slug[:60] or "post"


class PublishError(RuntimeError):
    pass


class Publisher:
    def __init__(self, cfg: PublishConfig, root: Path, agent_name: str, bio: str):
        self.cfg = cfg
        self.root = Path(root)
        self.agent_name = agent_name
        self.bio = bio

    def _front_matter(self, title: str, now: dt.datetime) -> str:
        return (
            "---\n"
            f"title: {title.strip()}\n"
            f"author: {self.agent_name} (automated agent)\n"
            f"date: {now.isoformat(timespec='seconds')}\n"
            "---\n\n"
        )

    def publish(self, destination: str, title: str, body: str) -> str:
        if destination == "local":
            folder = self.root / self.cfg.local_dir
            folder.mkdir(parents=True, exist_ok=True)
            now = dt.datetime.now()
            path = folder / f"{now.strftime('%Y-%m-%d-%H%M%S')}-{slugify(title)}.md"
            path.write_text(self._front_matter(title, now) + f"{body.strip()}\n", encoding="utf-8")
            return str(path)
        if destination == "git":
            return self._publish_git(title, body)
        raise ValueError(f"unknown publish destination {destination!r}")

    # ---- git ------------------------------------------------------------------

    @property
    def git_dir(self) -> Path:
        p = Path(self.cfg.git_dir).expanduser()
        return p if p.is_absolute() else self.root / p

    def _git(self, *args: str, env: dict[str, str] | None = None, timeout: float = 60.0) -> str:
        base_env = {
            "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
            "HOME": os.environ.get("HOME", ""),
            "GIT_TERMINAL_PROMPT": "0",  # never hang waiting for a password
            "GIT_CONFIG_NOSYSTEM": "1",
            "GIT_AUTHOR_NAME": self.agent_name,
            "GIT_AUTHOR_EMAIL": self.cfg.git_author_email,
            "GIT_COMMITTER_NAME": self.agent_name,
            "GIT_COMMITTER_EMAIL": self.cfg.git_author_email,
        }
        try:
            result = subprocess.run(
                ["git", "-C", str(self.git_dir), *args],
                capture_output=True, text=True, timeout=timeout, env={**base_env, **(env or {})}, check=False,
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise PublishError(f"git {args[0] if args else ''} failed: {type(exc).__name__}") from exc
        if result.returncode != 0:
            raise PublishError(self._scrub((result.stderr or result.stdout).strip()[:400]))
        return result.stdout

    def _token(self) -> str:
        return load_key(None, self.cfg.git_token_file) or ""

    def _scrub(self, text: str) -> str:
        token = self._token()
        return text.replace(token, "***") if token else text

    def _ensure_repo(self) -> None:
        folder = self.git_dir
        folder.mkdir(parents=True, exist_ok=True)
        if (folder / ".git").exists():
            return
        self._git("init", "-q", "-b", self.cfg.git_branch)
        (folder / "posts").mkdir(exist_ok=True)
        (folder / "README.md").write_text(
            f"# {self.agent_name}\n\n{self.bio}\n\n"
            "Everything here is written and committed by an automated agent, not a person. "
            "Its posts are listed in [index.md](index.md).\n",
            encoding="utf-8",
        )
        (folder / "index.md").write_text(f"# {self.agent_name}: posts\n\n", encoding="utf-8")
        self._git("add", "README.md", "index.md")
        self._git("commit", "-q", "-m", "Start: a home for an automated agent's notes")

    def _publish_git(self, title: str, body: str) -> str:
        self._ensure_repo()
        now = dt.datetime.now()
        rel = Path("posts") / f"{now.strftime('%Y-%m-%d-%H%M%S')}-{slugify(title)}.md"
        path = self.git_dir / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(self._front_matter(title, now) + f"{body.strip()}\n", encoding="utf-8")
        index = self.git_dir / "index.md"
        lines = index.read_text(encoding="utf-8").splitlines() if index.exists() else []
        heading = lines[0] if lines and lines[0].startswith("#") else f"# {self.agent_name}: posts"
        entries = [line for line in lines[1:] if line.strip()]
        entry = f"- {now.date().isoformat()} [{title.strip()}]({rel.as_posix()})"
        index.write_text("\n".join([heading, "", entry, *entries]) + "\n", encoding="utf-8")  # newest first
        self._git("add", rel.as_posix(), "index.md")
        self._git("commit", "-q", "-m", f"Post: {title.strip()[:70]}")
        where = str(path)
        if self.cfg.git_remote.strip():
            self._push()
            where += f" (pushed to {self.cfg.git_remote.strip()})"
        return where

    def _push(self) -> None:
        remote = self.cfg.git_remote.strip()
        if not remote.startswith("https://") or "@" in remote:
            raise PublishError("publish.git_remote must be a plain https:// URL (the token is never put in it)")
        token = self._token()
        if not token:
            raise PublishError(f"publish.git_remote is set but no token was found in {self.cfg.git_token_file}")
        # A credential helper that answers from the environment, for this one command.
        helper = "!f() { echo username=x-access-token; echo \"password=$EXPLORER_GIT_TOKEN\"; }; f"
        self._git(
            "-c", "credential.helper=", "-c", f"credential.helper={helper}",
            "push", "-q", remote, f"HEAD:{self.cfg.git_branch}",
            env={"EXPLORER_GIT_TOKEN": token},
            timeout=120.0,
        )

    def status(self) -> tuple[bool, str]:
        """(ok, one line) for `bot check`: where git posts go and whether a push can work."""
        repo = "exists" if (self.git_dir / ".git").exists() else "created on the first post"
        if not self.cfg.git_remote.strip():
            return True, f"git publishing to {self.git_dir} ({repo}); no remote set, posts stay on this Mac"
        if not self._token():
            return False, f"git publishing pushes to {self.cfg.git_remote} but there is no token in {self.cfg.git_token_file}"
        return True, f"git publishing to {self.git_dir} ({repo}), pushing to {self.cfg.git_remote} (token found)"
