"""The Validator closes what its inbox took on the fleet's requests record (owner, 2026-09-25)."""
from __future__ import annotations

import sys
from collections import Counter
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import validator  # noqa: E402
from explorer.fleet_requests import RequestLog  # noqa: E402


class FakeInbox:
    def __init__(self, waiting: list[str]):
        self.waiting = waiting

    def unread(self, limit: int = 3):
        return [SimpleNamespace(path=Path(n)) for n in self.waiting]


def test_taken_asks_are_read_and_resolved_waiting_ones_stay_open(tmp_path, monkeypatch):
    monkeypatch.setattr(validator, "BOTS", tmp_path)
    log = RequestLog(tmp_path / "common-data" / "shared-state" / "requests.jsonl")
    log.record("a.json", "Lead Gen", "Validator", "I'm ready to help with the upkeep. Could you send the rows?")
    log.record("b.json", "Desk Agent", "Validator", "blocker: accessibility is off | task: click | fix: grant it")
    log.record("c.json", "Lead Gen", "Validator", "still in the inbox")
    log.record("d.json", "Lead Gen", "The CEO", "not ours")
    me = SimpleNamespace(errors=[], counts=Counter())

    validator.Run._close_on_record(me, FakeInbox(["c.json"]))

    by_id = {r.id: r for r in log.all()}
    assert by_id["a.json"].resolved_at and by_id["a.json"].read_at
    assert by_id["b.json"].resolved_at
    assert by_id["c.json"].open and by_id["d.json"].open
    assert me.counts["requests closed"] == 2 and not me.errors
    assert "blocker checked" in (tmp_path / "common-data" / "shared-state" / "requests.jsonl").read_text()
