"""Gate 3: the checker's model-judged questions at write time (policy.write_gate_model), asked through a judge callable,
cached by content, fail-open."""
import json
from pathlib import Path

from explorer.actions import Task
from explorer.config import PolicyConfig, PublishConfig
from explorer.policy import Denylist, Policy

from conftest import DENYLIST

GATE = '''
def check(action, payload, *, bot="", min_details=300):
    return []

def questions(action, payload, *, bot="", page_text="", open_tasks=None):
    if action != "task":
        return []
    return [{"id": "MG01", "question": "Does the task name only people from the Team list?",
             "context": "The write: " + payload.get("title", "") + " | Team list: Jo, Alex | page:" + page_text[:20]}]
'''


def make_policy(tmp_path: Path, model: str = "local"):
    gate = tmp_path / "gate.py"
    gate.write_text(GATE)
    cfg = PolicyConfig(write_gate=str(gate), write_gate_model=model, write_gate_model_cache=str(tmp_path / "cache.json"))
    return Policy(cfg, PublishConfig(), Denylist.load(DENYLIST))


class Judge:
    def __init__(self, answer):
        self.answer, self.calls = answer, 0

    def __call__(self, system, prompt):
        self.calls += 1
        assert "MG01" in prompt and "Jo" in prompt
        return self.answer


TASK = Task(type="task", title="Ask Bob to call the leads", details="x" * 320)


def test_model_question_refuses_with_the_rule_id_and_caches(tmp_path):
    policy = make_policy(tmp_path)
    judge = Judge('{"ok": false, "why": "Bob is not on the Team list"}')
    v = policy.gate_write(TASK, bot="The CEO", judge=judge)
    assert not v.allowed and v.reason == "Validator rules: MG01: Bob is not on the Team list" and v.tag == "write_gate_model"
    assert policy.last_model_verdicts == [{"id": "MG01", "ok": False, "why": "Bob is not on the Team list", "cached": False}]
    v2 = policy.gate_write(TASK, bot="The CEO", judge=judge)
    assert not v2.allowed and judge.calls == 1 and policy.last_model_verdicts[0]["cached"] is True
    cache = json.loads((tmp_path / "cache.json").read_text())
    assert len(cache) == 1 and list(cache.values())[0]["ok"] is False


def test_model_question_passes_and_fails_open(tmp_path):
    policy = make_policy(tmp_path)
    assert policy.gate_write(TASK, bot="The CEO", judge=Judge('{"ok": true, "why": "team names only"}')).allowed
    silent = Judge("")
    v = policy.gate_write(Task(type="task", title="Another task for Bob", details="y" * 320), bot="The CEO", judge=silent)
    assert v.allowed and silent.calls == 1 and policy.last_model_verdicts[0]["ok"] is None  # no answer: the rule is not applied
    assert len(json.loads((tmp_path / "cache.json").read_text())) == 1  # the unanswered question is not cached


def test_model_questions_off_without_config_or_judge(tmp_path):
    judge = Judge('{"ok": false, "why": "x"}')
    assert make_policy(tmp_path, model="").gate_write(TASK, bot="The CEO", judge=judge).allowed
    assert make_policy(tmp_path).gate_write(TASK, bot="The CEO").allowed
    assert judge.calls == 0


def test_mg04_refusal_names_the_family_member_to_hand_the_work_to(tmp_path):
    from explorer.config import MessagingConfig

    gate = tmp_path / "gate.py"
    gate.write_text('def check(action, payload, *, bot="", min_details=300):\n    return []\n\n'
                    'def questions(action, payload, *, bot="", page_text="", open_tasks=None):\n'
                    '    return [{"id": "MG04", "question": "Does this task need a person?", "context": payload.get("title", "")}] if action == "task" else []\n')
    cfg = PolicyConfig(write_gate=str(gate), write_gate_model="local", write_gate_model_cache=str(tmp_path / "cache.json"))
    stopped = tmp_path / "scout" / "workspace"; stopped.mkdir(parents=True); (stopped / "STOP").touch()
    m = MessagingConfig(enabled=True, peers=[{"name": "Lead Gen", "folder": str(tmp_path / "lg")}, {"name": "Package Designer", "folder": str(tmp_path / "pd")},
                                             {"name": "Scout", "folder": str(tmp_path / "scout")}])
    policy = Policy(cfg, PublishConfig(), Denylist.load(DENYLIST), messaging=m)
    v = policy.gate_write(Task(type="task", title="Find a Northside bakery and its email", details="x" * 320), bot="The CEO",
                          judge=lambda s, p: '{"ok": false, "why": "Lead Gen can find businesses"}')
    assert not v.allowed and "MG04" in v.reason and "assignee set to Lead Gen or Package Designer" in v.reason
    assert "Scout" not in v.reason  # a stopped family member is not offered
