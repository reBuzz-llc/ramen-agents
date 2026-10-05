"""The git publish destination: a repository the agent owns, committed locally, pushed only to the
one configured remote with a token that never lands in the repo."""
from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

from explorer.actions import Publish
from explorer.config import PolicyConfig, PublishConfig
from explorer.policy import Denylist, Policy, PolicyContext
from explorer.publish import PublishError, Publisher


def git(cwd: Path, *args: str) -> str:
    return subprocess.run(["git", "-C", str(cwd), *args], capture_output=True, text=True, check=True).stdout


def test_git_posts_are_committed_with_an_index_and_a_bot_readme(tmp_path: Path):
    cfg = PublishConfig(enabled=True, destinations=["git"], git_dir="site")
    pub = Publisher(cfg, tmp_path, "Jobless-Bot", "An automated exploration agent.")
    assert pub.status() == (True, f"git publishing to {tmp_path / 'site'} (created on the first post); no remote set, posts stay on this Mac")

    first = Path(pub.publish("git", "How a cloud chamber shows a track", "Alcohol vapour condenses along the path."))
    second = Path(pub.publish("git", "Federated learning, briefly", "Models train where the data lives."))
    site = tmp_path / "site"
    assert first.parent == site / "posts" and first.read_text().startswith("---\ntitle: How a cloud chamber")
    assert "author: Jobless-Bot (automated agent)" in second.read_text()
    readme = (site / "README.md").read_text()
    assert "automated agent, not a person" in readme
    index = (site / "index.md").read_text().splitlines()
    assert index[0] == "# Jobless-Bot: posts" and "Federated learning" in index[2] and "cloud chamber" in index[3]
    log = git(site, "log", "--format=%an|%s").splitlines()
    assert log == [
        "Jobless-Bot|Post: Federated learning, briefly",
        "Jobless-Bot|Post: How a cloud chamber shows a track",
        "Jobless-Bot|Start: a home for an automated agent's notes",
    ]
    assert git(site, "status", "--porcelain") == ""


def test_push_goes_only_to_the_configured_remote_and_the_token_never_lands_in_the_repo(tmp_path: Path):
    remote = tmp_path / "remote.git"
    subprocess.run(["git", "init", "-q", "--bare", "-b", "main", str(remote)], check=True)
    token = tmp_path / "token"
    token.write_text("github_pat_SECRET123\n")

    # A file:// remote is refused: only a plain https:// URL may be pushed to.
    bad = Publisher(PublishConfig(git_dir="a", git_remote=f"file://{remote}", git_token_file=str(token)), tmp_path, "B", "b")
    with pytest.raises(PublishError, match="plain https://"):
        bad.publish("git", "t", "b")
    with_creds = Publisher(PublishConfig(git_dir="c", git_remote="https://x:y@github.com/o/r.git", git_token_file=str(token)), tmp_path, "B", "b")
    with pytest.raises(PublishError, match="plain https://"):
        with_creds.publish("git", "t", "b")
    no_token = Publisher(PublishConfig(git_dir="d", git_remote="https://github.com/o/r.git", git_token_file=str(tmp_path / "none")), tmp_path, "B", "b")
    assert no_token.status()[0] is False
    with pytest.raises(PublishError, match="no token"):
        no_token.publish("git", "t", "b")

    # An https remote that cannot be reached fails with the token scrubbed, and the commit stays local.
    unreachable = Publisher(
        PublishConfig(git_dir="e", git_remote="https://127.0.0.1:9/o/r.git", git_token_file=str(token)), tmp_path, "B", "b"
    )
    with pytest.raises(PublishError) as err:
        unreachable.publish("git", "Local first", "still committed")
    assert "SECRET123" not in str(err.value)
    site = tmp_path / "e"
    assert "Post: Local first" in git(site, "log", "--format=%s")
    config = (site / ".git" / "config").read_text()
    assert "SECRET123" not in config and "credential" not in config and "127.0.0.1" not in config


def test_policy_caps_posts_per_day_and_refuses_meta_titles():
    policy = Policy(PolicyConfig(), PublishConfig(enabled=True, destinations=["git"], max_posts_per_day=2), Denylist())

    def ctx(posts: int) -> PolicyContext:
        return PolicyContext(mode="web", current_page=None, actions_in_episode=0, pages_last_hour=0,
                             open_questions=0, last_visit_by_domain={}, blocked_keys=set(), posts_today=posts)

    post = Publish(type="publish", destination="git", title="What a cloud chamber shows", body="Tracks.")
    assert policy.check(post, ctx(1)).allowed
    capped = policy.check(post, ctx(2))
    assert not capped.allowed and "daily limit" in capped.reason
    meta = Publish(type="publish", destination="git", title="How to bypass rate limits", body="...")
    assert not policy.check(meta, ctx(0)).allowed
    assert not policy.check(Publish(type="publish", destination="local", title="t", body="b"), ctx(0)).allowed
