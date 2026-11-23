"""A write gate that cannot load or run holds the write; it never lets one through unchecked."""
from pathlib import Path

import pytest

from explorer.actions import Note, Task
from explorer.config import PolicyConfig
from explorer.policy import Denylist, Policy

from conftest import DENYLIST

GOOD = "def check(action, payload, *, bot='', min_details=300):\n    return []\n"
TASK = Task(type="task", title="t", details="d")


def policy(tmp_path: Path, source: str | None, **extra) -> Policy:
    gate = tmp_path / "gate.py"
    if source is not None:
        gate.write_text(source, encoding="utf-8")
    return Policy(PolicyConfig(denylist_file=str(DENYLIST), write_gate=str(gate), **extra), Denylist.load(DENYLIST))


def held(v) -> bool:
    return not v.allowed and v.tag == "judge_wait" and v.reason.startswith("this write waits")


@pytest.mark.parametrize("source", [
    None,                                                            # the file is gone
    "def check(:\n",                                                 # it does not parse
    "from explorer import a_name_the_engine_lacks\n" + GOOD,   # a fleet commit landed before its engine
    "x = 1\n",                                                       # no check in it
])
def test_a_gate_that_will_not_load_holds_the_write(tmp_path, source):
    assert held(policy(tmp_path, source).gate_write(TASK, bot="The CEO"))


def test_an_import_inside_the_check_holds_the_write(tmp_path):
    source = "def check(action, payload, *, bot='', min_details=300):\n    from explorer import a_name_the_engine_lacks\n    return []\n"
    assert held(policy(tmp_path, source).gate_write(TASK, bot="The CEO"))


def test_a_failed_load_is_tried_again_and_recovers(tmp_path):
    p = policy(tmp_path, "def check(:\n")
    assert held(p.gate_write(TASK, bot="The CEO"))
    (tmp_path / "gate.py").write_text(GOOD, encoding="utf-8")
    assert held(p.gate_write(TASK, bot="The CEO"))        # not before the minute is up
    p._gate_retry_at = 0
    assert p.gate_write(TASK, bot="The CEO").allowed


def test_questions_that_crash_hold_the_write(tmp_path):
    source = GOOD + "def questions(action, payload, *, bot='', page_text='', open_tasks=None):\n    raise RuntimeError('broken')\n"
    p = policy(tmp_path, source, write_gate_model="chain", write_gate_model_cache=str(tmp_path / "cache.json"))
    assert held(p.gate_write(TASK, bot="The CEO", judge=lambda s, q: '{"ok": true, "why": "x"}'))


def test_a_working_gate_an_ungated_action_and_no_gate_still_pass(tmp_path):
    assert policy(tmp_path, GOOD).gate_write(TASK, bot="The CEO").allowed
    assert policy(tmp_path, "def check(:\n").gate_write(Note(type="note", title="n", body="b"), bot="The CEO").allowed
    assert Policy(PolicyConfig(denylist_file=str(DENYLIST)), Denylist.load(DENYLIST)).gate_write(TASK, bot="The CEO").allowed


def test_a_question_no_judge_answers_holds_the_write(tmp_path):
    source = GOOD + "def questions(action, payload, *, bot='', page_text='', open_tasks=None):\n    return [{'id': 'MG01', 'question': 'q', 'context': 'c'}]\n"
    p = policy(tmp_path, source, write_gate_model="chain", write_gate_model_cache=str(tmp_path / "cache.json"))
    assert held(p.gate_write(TASK, bot="The CEO", judge=lambda s, q: ""))
