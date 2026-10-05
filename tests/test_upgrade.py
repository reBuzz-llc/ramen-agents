"""Self-upgrade: a worktree per proposal, tests gate the merge, protected files block it, and a
successful submit hands the supervisor the restart exit code. Runs real git in a throwaway repo."""
from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

from explorer.actions import Upgrade, UpgradeSubmit, UpgradeTest, WriteFile
from explorer.config import DeveloperConfig
from explorer.developer import UPGRADE_EXIT_CODE, Developer

from conftest import make_controller


def git(repo: Path, *args: str) -> str:
    return subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True, text=True).stdout.strip()


@pytest.fixture
def repo(tmp_path: Path) -> Path:
    repo = tmp_path / "repo"
    repo.mkdir()
    subprocess.run(["git", "init", "-q", "-b", "main", str(repo)], check=True)
    git(repo, "config", "user.email", "test@example.com")
    git(repo, "config", "user.name", "Test")
    (repo / "pyproject.toml").write_text('[tool.pytest.ini_options]\ntestpaths = ["tests"]\n')
    (repo / "tests").mkdir()
    (repo / "tests" / "test_ok.py").write_text("def test_ok():\n    assert True\n")
    (repo / "config.toml").write_text("[agent]\nname = 'x'\n")
    (repo / "docs").mkdir()
    (repo / "docs" / "plan.md").write_text("plan\n")
    (repo / "src").mkdir()
    (repo / "src" / "prompts.py").write_text("HELP = 'v1'\n")
    git(repo, "add", "-A")
    git(repo, "commit", "-q", "-m", "initial")
    return repo


def make_dev(tmp_path: Path, repo: Path, **over) -> Developer:
    cfg = DeveloperConfig(enabled=True, allow_shell=True, upgrade_enabled=True, **over)
    return Developer(cfg, tmp_path / "dev", repo_root=repo, output_limit=4000)


def test_upgrade_start_creates_a_worktree_on_a_new_branch(tmp_path, repo):
    dev = make_dev(tmp_path, repo)
    assert dev.upgrade_state() is None
    branch = dev.upgrade_start("make the help text clearer")
    assert branch == "bot/proposal-1"
    assert (dev.checkout / "src" / "prompts.py").exists()
    state = dev.upgrade_state()
    assert state and state["branch"] == branch and state["tests_passed"] is False
    assert branch in git(repo, "branch", "--list", "bot/proposal-*")
    with pytest.raises(RuntimeError):
        dev.upgrade_start("a second one at the same time")


def test_upgrade_tests_gate_the_submit(tmp_path, repo):
    dev = make_dev(tmp_path, repo)
    dev.upgrade_start("break something")
    with pytest.raises(RuntimeError, match="did not pass"):
        dev.upgrade_submit()  # never tested
    (dev.checkout / "tests" / "test_bad.py").write_text("def test_bad():\n    assert False\n")
    result = dev.upgrade_test()
    assert not result.ok
    assert dev.upgrade_state()["tests_passed"] is False
    with pytest.raises(RuntimeError, match="did not pass"):
        dev.upgrade_submit()
    assert git(repo, "rev-parse", "main") == git(repo, "rev-parse", "HEAD")  # main untouched


def test_protected_files_block_the_submit(tmp_path, repo):
    dev = make_dev(tmp_path, repo)
    dev.upgrade_start("edit config")
    (dev.checkout / "config.toml").write_text("[agent]\nname = 'y'\n")
    (dev.checkout / "docs" / "plan.md").write_text("changed\n")
    assert dev.upgrade_test().ok
    protected = dev.upgrade_protected_changes()
    assert "config.toml" in protected and "docs/plan.md" in protected
    with pytest.raises(RuntimeError, match="protected"):
        dev.upgrade_submit()


def test_successful_upgrade_fast_forwards_main_and_records_last_good(tmp_path, repo):
    dev = make_dev(tmp_path, repo)
    before = git(repo, "rev-parse", "HEAD")
    dev.upgrade_start("add a test and improve the help")
    (dev.checkout / "src" / "prompts.py").write_text("HELP = 'v2'\n")
    (dev.checkout / "tests" / "test_more.py").write_text("def test_more():\n    assert 1 + 1 == 2\n")
    assert dev.upgrade_test().ok
    assert dev.upgrade_protected_changes() == []
    new_head = dev.upgrade_submit()
    assert new_head != before
    assert git(repo, "rev-parse", "main") == new_head
    assert (repo / "src" / "prompts.py").read_text() == "HELP = 'v2'\n"
    assert dev.last_good_path.read_text().strip() == before
    assert not dev.checkout.exists()
    assert dev.upgrade_state() is None
    assert "bot/proposal-1" in git(repo, "branch", "--list", "bot/proposal-*")  # kept for the owner
    assert "Proposed and tested by the agent" in git(repo, "log", "-1", "--format=%B")
    # A second proposal gets the next number.
    assert dev.upgrade_start("another") == "bot/proposal-2"


def test_abandon_keeps_the_branch_and_drops_the_worktree(tmp_path, repo):
    dev = make_dev(tmp_path, repo)
    dev.upgrade_start("try something")
    dev.upgrade_abandon()
    assert not dev.checkout.exists() and dev.upgrade_state() is None
    assert "bot/proposal-1" in git(repo, "branch", "--list", "bot/proposal-*")


def test_controller_upgrade_flow_ends_with_the_restart_exit_code(cfg, tmp_path, repo):
    cfg.developer.enabled = True
    cfg.developer.allow_shell = True
    cfg.developer.upgrade_enabled = True
    dev = Developer(cfg.developer, cfg.path(cfg.developer.root), repo_root=repo, output_limit=4000)
    controller = make_controller(cfg, developer=dev)
    ep = controller.memory.episode(controller.memory.start_episode())
    assert ep is not None

    # Nothing in progress: test and submit are refused by the policy, upgrade is allowed.
    assert not controller.policy.check(UpgradeTest(type="upgrade_test"), controller._policy_context(ep)).allowed
    assert controller.policy.check(Upgrade(type="upgrade", goal="tidy the help"), controller._policy_context(ep)).allowed

    started = controller._execute(Upgrade(type="upgrade", goal="tidy the help"), ep, None)
    assert started.ok and "checkout/" in (started.feedback or "")
    assert "upgrade in progress" in (controller._developer_note() or "")
    assert not controller.policy.check(Upgrade(type="upgrade", goal="again"), controller._policy_context(ep)).allowed
    assert not controller.policy.check(UpgradeSubmit(type="upgrade_submit"), controller._policy_context(ep)).allowed

    # Protected file inside the checkout is refused by write_file itself.
    blocked = controller.policy.check(
        WriteFile(type="write_file", path="checkout/config.toml", content="x"), controller._policy_context(ep)
    )
    assert not blocked.allowed and "protected" in blocked.reason

    wrote = controller._execute(WriteFile(type="write_file", path="checkout/src/prompts.py", content="HELP = 'v3'\n"), ep, None)
    assert wrote.ok
    tested = controller._execute(UpgradeTest(type="upgrade_test"), ep, None)
    assert tested.ok, tested.feedback
    assert controller.policy.check(UpgradeSubmit(type="upgrade_submit"), controller._policy_context(ep)).allowed

    submitted = controller._execute(UpgradeSubmit(type="upgrade_submit"), ep, None)
    assert submitted.ok
    assert controller.exit_code == UPGRADE_EXIT_CODE
    assert (repo / "src" / "prompts.py").read_text() == "HELP = 'v3'\n"
    journal = controller.memory.journal_path().read_text()
    assert "Merged my change" in journal
