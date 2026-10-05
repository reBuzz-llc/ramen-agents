"""Developer actions: path containment, protected names, command gating, and the executor."""
from __future__ import annotations

import os
from pathlib import Path

from explorer.actions import ListFiles, ReadFile, RunCommand, WriteFile
from explorer.config import DeveloperConfig, PolicyConfig, PublishConfig
from explorer.developer import Developer
from explorer.policy import Denylist, Policy, PolicyContext

from conftest import DENYLIST, make_controller


def make_policy(tmp_path: Path, **dev) -> tuple[Policy, Path]:
    root = tmp_path / "dev"
    root.mkdir(exist_ok=True)
    policy = Policy(
        PolicyConfig(), PublishConfig(), Denylist.load(DENYLIST), developer=DeveloperConfig(**dev), developer_root=root
    )
    return policy, root


def ctx() -> PolicyContext:
    return PolicyContext(
        mode="fake", current_page=None, actions_in_episode=0, pages_last_hour=0, open_questions=0, last_visit_by_domain={}
    )


def test_developer_actions_do_not_exist_when_disabled(tmp_path):
    policy, _ = make_policy(tmp_path, enabled=False)
    for action in (
        ListFiles(type="list_files"),
        ReadFile(type="read_file", path="x"),
        WriteFile(type="write_file", path="x", content="y"),
        RunCommand(type="run_command", argv=["ls"]),
    ):
        verdict = policy.check(action, ctx())
        assert not verdict.allowed
        assert "not enabled" in verdict.reason


def test_paths_cannot_leave_the_root(tmp_path):
    policy, root = make_policy(tmp_path, enabled=True)
    for bad in ("../secret", "/etc/passwd", "a/../../x", "..", str(tmp_path / "elsewhere")):
        verdict = policy.check(ReadFile(type="read_file", path=bad), ctx())
        assert not verdict.allowed, bad
        assert verdict.permanent, bad
    assert policy.check(ReadFile(type="read_file", path="sub/file.txt"), ctx()).allowed
    assert policy.check(ListFiles(type="list_files", path="."), ctx()).allowed
    assert policy.check(ListFiles(type="list_files", path=""), ctx()).allowed


def test_symlinks_that_escape_are_refused(tmp_path):
    policy, root = make_policy(tmp_path, enabled=True)
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "secret").write_text("no")
    (root / "link").symlink_to(outside)
    verdict = policy.check(ReadFile(type="read_file", path="link/secret"), ctx())
    assert not verdict.allowed and verdict.permanent
    assert policy.resolve_dev_path("link/secret") is None


def test_protected_names_cannot_be_written_anywhere_under_root(tmp_path):
    policy, _ = make_policy(tmp_path, enabled=True)
    for bad in (
        "checkout/src/explorer/policy.py",
        "checkout/config.toml",
        "checkout/docs/plan.md",
        "checkout/launchd/x.plist",
        "checkout/workspace/denylist.txt",
        "CLAUDE.md",
    ):
        verdict = policy.check(WriteFile(type="write_file", path=bad, content="x"), ctx())
        assert not verdict.allowed, bad
        assert "protected" in verdict.reason
    assert policy.check(WriteFile(type="write_file", path="checkout/src/explorer/prompts.py", content="x"), ctx()).allowed
    assert policy.check(WriteFile(type="write_file", path="notes/policy_ideas.md", content="x"), ctx()).allowed


def test_write_size_is_capped(tmp_path):
    policy, _ = make_policy(tmp_path, enabled=True, max_file_bytes=10)
    assert not policy.check(WriteFile(type="write_file", path="big.txt", content="x" * 11), ctx()).allowed
    assert policy.check(WriteFile(type="write_file", path="ok.txt", content="x" * 10), ctx()).allowed


def test_run_command_gating(tmp_path):
    policy, _ = make_policy(tmp_path, enabled=True, allow_shell=False)
    assert not policy.check(RunCommand(type="run_command", argv=["ls"]), ctx()).allowed
    policy, _ = make_policy(tmp_path, enabled=True, allow_shell=True)
    assert policy.check(RunCommand(type="run_command", argv=["ls", "-la"]), ctx()).allowed
    assert policy.check(RunCommand(type="run_command", argv=["/bin/ls"]), ctx()).allowed
    assert not policy.check(RunCommand(type="run_command", argv=["rm", "-rf", "/"]), ctx()).allowed
    assert not policy.check(RunCommand(type="run_command", argv=["sh", "-c", "ls"]), ctx()).allowed
    assert not policy.check(RunCommand(type="run_command", argv=[]), ctx()).allowed
    bad_cwd = policy.check(RunCommand(type="run_command", argv=["ls"], cwd="../"), ctx())
    assert not bad_cwd.allowed and bad_cwd.permanent


def test_developer_file_operations(tmp_path):
    root = tmp_path / "dev"
    dev = Developer(DeveloperConfig(enabled=True), root, repo_root=tmp_path, output_limit=8)
    path = root / "notes" / "a.txt"
    assert dev.write_file(path, "0123456789abcdef") == 16
    window, more = dev.read_file(path, 0)
    assert window == "01234567" and more
    window, more = dev.read_file(path, 8)
    assert window == "9abcdef" or window == "89abcdef"
    assert not more or len(window) == 8
    listing = dev.list_files(root)
    assert "notes/" in listing
    assert "a.txt" in dev.list_files(root / "notes")
    assert "nothing" in dev.list_files(root / "missing")


def test_developer_run_uses_a_clean_environment_and_no_shell(tmp_path):
    root = tmp_path / "dev"
    dev = Developer(DeveloperConfig(enabled=True, allow_shell=True), root, repo_root=tmp_path, output_limit=4000)
    os.environ["EXPLORER_TEST_SECRET"] = "leak"
    try:
        result = dev.run(["python", "-c", "import os; print(sorted(os.environ))"], cwd=root)
    finally:
        del os.environ["EXPLORER_TEST_SECRET"]
    assert result.ok, result.output
    assert "EXPLORER_TEST_SECRET" not in result.output
    assert "PATH" in result.output and "HOME" in result.output
    # No shell: metacharacters are literal arguments.
    result = dev.run(["python", "-c", "import sys; print(sys.argv[1:])", "a;b", "$HOME"], cwd=root)
    assert "'a;b'" in result.output and "'$HOME'" in result.output
    failing = dev.run(["python", "-c", "raise SystemExit(3)"], cwd=root)
    assert not failing.ok and failing.returncode == 3


def test_developer_run_times_out(tmp_path):
    root = tmp_path / "dev"
    dev = Developer(DeveloperConfig(enabled=True, allow_shell=True), root, repo_root=tmp_path)
    result = dev.run(["python", "-c", "import time; time.sleep(5)"], cwd=root, timeout=0.5)
    assert not result.ok and result.timed_out
    assert "timed out" in result.output


def test_controller_executes_developer_actions(cfg):
    cfg.developer.enabled = True
    cfg.developer.allow_shell = True
    root = cfg.path(cfg.developer.root)
    dev = Developer(cfg.developer, root, repo_root=cfg.root)
    controller = make_controller(cfg, developer=dev)
    ep = controller.memory.episode(controller.memory.start_episode())
    assert ep is not None

    wrote = controller._execute(WriteFile(type="write_file", path="draft.txt", content="hello there"), ep, None)
    assert wrote.ok and (root / "draft.txt").read_text() == "hello there"

    read = controller._execute(ReadFile(type="read_file", path="draft.txt"), ep, None)
    assert read.ok and read.feedback and "hello there" in read.feedback

    listed = controller._execute(ListFiles(type="list_files", path="."), ep, None)
    assert listed.ok and listed.feedback and "draft.txt" in listed.feedback

    ran = controller._execute(RunCommand(type="run_command", argv=["ls"]), ep, None)
    assert ran.ok and ran.feedback and "draft.txt" in ran.feedback

    # The policy context and system prompt know the folder exists.
    assert "your own folder" in (controller._developer_note() or "")
    assert "list_files" in controller.system and "run_command" in controller.system
    assert "upgrade" not in controller.system.split("Actions (choose")[1]


def test_controller_without_developer_has_no_developer_help(cfg):
    controller = make_controller(cfg)
    assert controller._developer_note() is None
    assert "list_files" not in controller.system
    assert "run programs" in controller.system
