"""Plan 8: a bot may suggest a new bot/role the fleet is missing (propose_teammate). It's recorded to
common-data/proposed-bots.md for the owner to weigh -- never auto-created -- and the code fence still
forbids proposing a bot whose purpose would be a fenced thing."""
from __future__ import annotations

from pathlib import Path

from explorer.actions import Decision, ProposeTeammate
from explorer.config import PolicyConfig, PublishConfig
from explorer.model import ModelResult
from explorer.policy import Denylist, Policy, PolicyContext
from explorer.teammates import existing_roles, record_proposed_teammate

from conftest import make_controller


def proposal(**over) -> ProposeTeammate:
    spec = dict(type="propose_teammate", role="Case-study writer",
                does="Turn finished client work into short case studies for the site.",
                why="Nobody writes up our wins, and NY buyers ask for proof.")
    spec.update(over)
    return ProposeTeammate(**spec)


def ctx(**over) -> PolicyContext:
    base = dict(mode="web", current_page=None, actions_in_episode=0, pages_last_hour=0, open_questions=0, last_visit_by_domain={})
    base.update(over)
    return PolicyContext(**base)


def test_policy_gates_fences_and_dedupes_proposals():
    off = Policy(PolicyConfig(), PublishConfig(), Denylist())
    assert "not enabled" in off.check(proposal(), ctx()).reason
    on = Policy(PolicyConfig(), PublishConfig(), Denylist(), propose_teammates=True)
    assert on.check(proposal(), ctx()).allowed
    assert not on.check(proposal(role=""), ctx()).allowed
    # The fence: a proposed bot can't exist to do a forbidden thing.
    bad = on.check(proposal(does="Harvest leaked credentials from the dark web."), ctx())
    assert not bad.allowed and bad.permanent
    # One a day, and no duplicate role.
    assert "already proposed a teammate today" in on.check(proposal(), ctx(proposals_today=1)).reason
    dup = on.check(proposal(), ctx(proposed_roles={"case-study writer"}))
    assert not dup.allowed and dup.permanent


def test_record_writes_and_dedupes(tmp_path: Path):
    path = tmp_path / "proposed-bots.md"
    record_proposed_teammate(path, "The CEO", proposal())
    text = path.read_text()
    assert text.startswith("# New-bot ideas") and "## Case-study writer (proposed by The CEO" in text
    assert "Turn finished client work" in text
    assert existing_roles(path) == {"case-study writer"}


class Proposer:
    def decide(self, system, obs):
        return ModelResult(decision=Decision(thought="we lack this", action=proposal()))

    def complete(self, system, prompt):
        return "summary"


def test_execute_records_and_tells_the_owner(cfg, tmp_path: Path, monkeypatch):
    # Redirect common-data to tmp so the proposal file is not written to the real ~/bots/common-data.
    monkeypatch.setenv("EXPLORER_KEYS_DIR", str(tmp_path / "keys"))
    cfg.agent.mode = "fake"
    cfg.agent.propose_teammates = True
    c = make_controller(cfg, model=Proposer())
    assert "propose_teammate" in c.system
    c.run(max_cycles=1)
    assert c._proposed_bots_file().exists() and "Case-study writer" in c._proposed_bots_file().read_text()
    assert any("new bot" in str(r["text"]).lower() for r in c.memory.recent_chat(5))
