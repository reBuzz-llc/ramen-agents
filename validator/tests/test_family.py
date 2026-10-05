"""The family check: the requests record held to family.md."""
from __future__ import annotations

import datetime as dt
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import family  # noqa: E402

NOW = dt.datetime(2026, 9, 25, 20, 0)


def record(tmp_path, events):
    p = tmp_path / "requests.jsonl"
    p.write_text("\n".join(json.dumps(e) for e in events) + "\n")
    return p


def ask(i, sender, to, text, hours_ago, priority=False, **more):
    at = (NOW - dt.timedelta(hours=hours_ago)).isoformat(timespec="seconds")
    return {"kind": "request", "id": f"r{i}", "from": sender, "to": to, "text": text, "priority": priority, "at": at, **more}


def test_fold_matches_the_engine(tmp_path):
    p = record(tmp_path, [
        ask(1, "The CEO", "Lead Gen", "Please harvest 30 founders", 3, priority=True),
        {"kind": "read", "id": "r1", "at": (NOW - dt.timedelta(hours=2.5)).isoformat()},
        ask(2, "The CEO", "Scout", "Checked the jobs page, nothing there", 1, priority=True),   # a status note
        ask(3, "Scout", "Onion Reader", "Which onion news outlets?", 60),                        # expired
        ask(4, "Package Designer", "The CEO", "Rate for a landing page?", 1),
        {"kind": "answered", "id": "r4", "answer": "$1,200-2,000", "at": NOW.isoformat()},
    ])
    asks = {a.id: a for a in family.fold(p, now=NOW)}
    assert asks["r1"].open and asks["r1"].priority and asks["r1"].read_at
    assert not asks["r2"].priority                     # status notes are never priority
    assert asks["r3"].expired and not asks["r3"].open   # two days: expired, not open
    assert not asks["r4"].open and asks["r4"].answer == "$1,200-2,000"


def test_rules_name_the_bot_that_answers_for_it(tmp_path):
    p = record(tmp_path, [
        ask(1, "The CEO", "Lead Gen", "Please harvest 30 founders", 3, priority=True),
        {"kind": "read", "id": "r1", "at": (NOW - dt.timedelta(hours=2.5)).isoformat()},
        ask(2, "Desk Agent", "Lead Gen", "please list the founders in the file I routed to you", 8),
        ask(3, "The CEO", "Grok Bot", "Can you help?", 1, priority=True),
        ask(4, "Scout", "Validator", "leaA, which rows are blank?", 1),
        ask(5, "The CEO", "Scout", "Find SPF accelerators", 3, priority=True),
        ask(6, "Scout", "Onion Reader", "Which onion news outlets?", 60),
        ask(7, "Package Designer", "The CEO", "Fresh and answered", 0.5),
        {"kind": "answered", "id": "r7", "at": NOW.isoformat()},
    ])
    ran = {"lead-gen": 5, "scout": 0}
    found = family.check(family.fold(p, now=NOW), NOW, actions=lambda slug, since: ran.get(slug, 0), stopped=set())
    by = {(f.rule, f.ask.id): f for f in found}
    # The CEO asked Lead Gen 3 h ago; Lead Gen ran five episodes of its own since reading it.
    assert by[("FM02", "r1")].bot == "lead-gen" and "5 actions" in by[("FM02", "r1")].detail
    # An ordinary family ask open 8 h: the recipient answers for it.
    assert by[("FM01", "r2")].bot == "lead-gen" and "not even read" in by[("FM01", "r2")].detail
    # Written to nobody in the family: the sender is told.
    assert by[("FM05", "r3")].bot == "the-ceo" and "Grok Bot" in by[("FM05", "r3")].detail
    # A handle instead of a name: the sender is told (and the ask is young, so nothing else).
    assert by[("FM03", "r4")].bot == "scout" and "leaA" in by[("FM03", "r4")].detail
    # A CEO ask 3 h old but never read and no actions since: not FM02; under 6 h so not FM01 either.
    assert ("FM02", "r5") not in by and ("FM01", "r5") not in by
    # Expired: reported against the recipient as a pattern, not chased.
    assert by[("FM04", "r6")].bot == "onion-reader"
    assert not any(f.ask.id == "r7" for f in found)
    assert family.summary(family.fold(p, now=NOW), NOW).startswith("family: 4 open ask(s), 2 from The CEO")


def test_status_notes_and_the_grace_are_respected(tmp_path):
    p = record(tmp_path, [
        ask(1, "The CEO", "Scout", "Checked the Builtin jobs page, not relevant", 30, priority=False),   # note, old
        ask(2, "The CEO", "Lead Gen", "Please list five founders", 3, priority=True),
        {"kind": "read", "id": "r2", "at": (NOW - dt.timedelta(hours=2.5)).isoformat()},
    ])
    asks = family.fold(p, now=NOW)
    assert asks[0].note and not asks[0].expired
    within_grace = family.check(asks, NOW, actions=lambda s, since: 4)
    assert not any(f.rule in ("FM01", "FM02", "FM04") and f.ask.id == "r1" for f in within_grace)   # a note is never chased
    assert not any(f.rule == "FM02" for f in within_grace)                                          # 4 actions: what the policy allows
    past = family.check(asks, NOW, actions=lambda s, since: 5)
    assert any(f.rule == "FM02" and f.ask.id == "r2" for f in past)


def test_fleet_notices_are_not_asks(tmp_path):
    """A drop routed to you, a lead listed, a 'done:' report: information, never chased (2026-09-25 the record
    held three 30-hour-old 'the owner dropped a file for you' notices to Lead Gen)."""
    p = record(tmp_path, [
        ask(1, "Desk Agent", "Lead Gen", "the owner dropped a file for you: leads.csv (CSV, 32 KB)", 30),
        ask(2, "Lead Gen", "The CEO", "new lead \"Main Street Hardware\" (https://mainstreethardwarespf.com): old site", 30),
        ask(3, "Lead Gen", "Validator", "done: Main Street Hardware: Founded by; could not find: Location", 30),
        ask(4, "The CEO", "Desk Agent", "Processed the file as instructed. Drafted cold emails.", 30, priority=False),
    ])
    asks = family.fold(p, now=NOW)
    assert all(a.note for a in asks)
    assert family.check(asks, NOW, actions=lambda s, since: 0) == []


def test_the_same_ask_three_times_is_on_the_sender(tmp_path):
    base = "Please shift your search focus to target SMB leads in Springfield, especially biotech startups"
    p = record(tmp_path, [
        ask(1, "The CEO", "Lead Gen", base + ", and prepare a list for outreach.", 0.3, priority=True),
        ask(2, "The CEO", "Lead Gen", base + ". Gather company name, primary contact.", 0.2, priority=True),
        ask(3, "The CEO", "Lead Gen", base + ".", 0.1, priority=True),
        ask(4, "The CEO", "Package Designer", "Please adjust your design work to create packages targeting SMB leads", 0.2, priority=True),
        ask(5, "Scout", "The CEO", "Which biotech accelerators?", 0.3),
        ask(6, "Scout", "The CEO", "Which biotech accelerators?", 0.2),     # twice is not a pattern
        ask(7, "Lead Gen", "Validator", "done: Sunny Deli: Location; done: BurgerBox: Founded by", 0.1),
        ask(8, "Lead Gen", "Validator", "done: Sunny Deli: Location; done: Saroki's: Founded by", 0.05),
        ask(9, "Lead Gen", "Validator", "done: Sunny Deli: Location; done: Bowl Brothers: Location", 0.01),
        {"kind": "resolved", "id": "r2", "note": "superseded", "at": NOW.isoformat()},
        {"kind": "resolved", "id": "r3", "note": "superseded", "at": NOW.isoformat()},
    ])
    found = family.check(family.fold(p, now=NOW), NOW, actions=lambda slug, since: 0, stopped=set())
    fm06 = [f for f in found if f.rule == "FM06"]
    assert len(fm06) == 1 and fm06[0].bot == "the-ceo" and fm06[0].ask.id == "r3"
    assert "3 times" in fm06[0].detail and "Lead Gen" in fm06[0].detail
    # one repeat is allowed, a different ask is not a repeat, and "done:" notices never count
    assert not any(f.rule == "FM06" and f.ask.sender in ("Scout", "Lead Gen") for f in found)


def test_a_bot_the_owner_stopped_is_not_chased(tmp_path):
    p = record(tmp_path, [ask(1, "The CEO", "Scout", "Find a free SMB review API", 30, priority=True)])
    asks = family.fold(p, now=NOW)
    assert any(f.ask.id == "r1" for f in family.check(asks, NOW, actions=lambda s, t: 0, stopped=set()))
    assert not family.check(asks, NOW, actions=lambda s, t: 0, stopped={"scout"})
