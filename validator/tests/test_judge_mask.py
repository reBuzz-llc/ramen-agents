"""The judgment pass sends masked text only, and never to a provider on the closed list."""
from __future__ import annotations

import json

import pytest

from explorer.common import masking
from judge import Judge, Provider, closed_names, judge_prompt

ADDRESS = "someone@example.com"
PHONE = "(212) 555-0142"


def _chain(tmp_path, *names):
    out = []
    for n in names:
        key = tmp_path / f"{n}.key"
        key.write_text("k" * 20)
        out.append(Provider(n, f"https://{n}.invalid/v1", "m", str(key)))
    return out


def _post(reply="{}", log=None):
    def post(url, headers, body):
        if log is not None:
            log.append((url, json.dumps(body)))
        return 200, {"choices": [{"message": {"content": reply}}], "usage": {"prompt_tokens": 1, "completion_tokens": 1}}
    return post


@pytest.fixture(autouse=True)
def no_board(monkeypatch):
    monkeypatch.setattr(masking, "_load", lambda: masking.Known())
    monkeypatch.setattr(masking, "board_readable", lambda: True)


def _prompt():
    return judge_prompt("task", {"Title": "x", "Brief": f"Write to {ADDRESS} or call {PHONE}."}, ["Q?"])


def test_a_closed_provider_is_never_asked(tmp_path):
    sent = []
    answer = Judge(_chain(tmp_path, "gemini", "groq"), post=_post('{"verdicts": []}', sent), closed={"gemini"}).ask("s", _prompt())
    assert answer.provider == "groq" and len(sent) == 1 and "gemini" not in sent[0][0]


def test_gemini_is_closed_when_no_list_is_given(tmp_path):
    sent = []
    assert Judge(_chain(tmp_path, "gemini"), post=_post("{}", sent)).ask("s", _prompt()) is None and sent == []


def test_gemini_is_asked_after_the_persons_yes(tmp_path):
    sent = []
    assert Judge(_chain(tmp_path, "gemini"), post=_post('{"verdicts": []}', sent), closed=set()).ask("s", _prompt()).provider == "gemini"
    assert len(sent) == 1


def test_the_address_and_phone_do_not_leave(tmp_path):
    sent = []
    Judge(_chain(tmp_path, "groq"), post=_post('{"verdicts": []}', sent), closed=()).ask("s", _prompt())
    assert ADDRESS not in sent[0][1] and "555-0142" not in sent[0][1] and "[EMAIL_1]" in sent[0][1]


def test_a_stand_in_comes_back_in_the_answer(tmp_path):
    answer = Judge(_chain(tmp_path, "groq"), post=_post('{"why": "[EMAIL_1]"}'), closed=()).ask("s", _prompt())
    assert ADDRESS in answer.text


def test_an_invented_stand_in_moves_to_the_next_provider(tmp_path):
    answers = iter(['{"why": "[EMAIL_9]"}', '{"verdicts": []}'])
    def post(url, headers, body):
        return 200, {"choices": [{"message": {"content": next(answers)}}], "usage": {}}
    assert Judge(_chain(tmp_path, "groq", "zai"), post=post, closed=()).ask("s", _prompt()).provider == "zai"


@pytest.mark.parametrize("mask", [lambda m: None, lambda m: (_ for _ in ()).throw(RuntimeError("no"))])
def test_no_mask_means_nothing_is_sent(tmp_path, mask):
    sent = []
    assert Judge(_chain(tmp_path, "groq"), post=_post("{}", sent), closed=(), mask=mask).ask("s", _prompt()) is None and sent == []


def test_an_unreadable_board_copy_means_nothing_is_sent(tmp_path, monkeypatch):
    monkeypatch.setattr(masking, "board_readable", lambda: False)
    sent = []
    j = Judge(_chain(tmp_path, "groq", "zai"), post=_post("{}", sent), closed=())
    assert j.ask("s", _prompt()) is None and sent == [] and j.mask_failed is True


def test_a_provider_that_does_not_answer_is_not_a_mask_failure(tmp_path):
    def post(url, headers, body):
        return 500, {"error": "down"}
    j = Judge(_chain(tmp_path, "groq"), post=post, closed=())
    assert j.ask("s", _prompt()) is None and j.mask_failed is False


def _configs(root, web=None, local=None):
    d = root / "common-data" / "configs"
    d.mkdir(parents=True)
    if web is not None:
        (d / "web-bots.toml").write_text(web)
    if local is not None:
        (d / "local.toml").write_text(local)


@pytest.mark.parametrize("web,local,want", [
    ('[model]\npersonal_closed = ["gemini"]\n', None, {"gemini"}),
    ('[model]\npersonal_closed = ["gemini"]\n', '[model]\npersonal_closed = []\n', set()),
    ('[model]\npersonal_closed = []\n', '[model]\npersonal_closed = ["gemini"]\n', {"gemini"}),
    ('[model]\npersonal_closed = []\n', 'not toml [', {"gemini"}),
    ('[model]\npersonal_closed = "gemini"\n', None, {"gemini"}),
    (None, None, {"gemini"}),
])
def test_the_closed_list(tmp_path, web, local, want):
    _configs(tmp_path, web, local)
    assert closed_names(tmp_path) == want


def _pass(monkeypatch, budget):
    import datetime as dt
    from types import SimpleNamespace as NS

    import judge
    import validator as v
    asked, kept = [], {}

    class FakeJudge:
        tokens_used, used = 2, {"groq": 1}

        def __init__(self, chain, **kw):
            kept.update(kw)

        def ask(self, system, prompt):
            asked.append(prompt)
            return judge.Answer('{"verdicts": [{"q": 1, "answer": "yes", "why": "ok"}]}', "groq", 2)

    monkeypatch.setattr(v, "Judge", FakeJudge)
    monkeypatch.setattr(v, "closed_names", lambda root: {"gemini"})
    task = NS(status="open", title="A task", assignee_names=["Pat Example"], due="", priority="High", body="Brief", page_id="t1", edited="e", created="c", label="A task", url="u")
    me = NS(s={"model": {"chain": [{"name": "groq", "base_url": "https://x.invalid/v1", "model": "m", "key_file": "/none"}], "daily_token_budget": budget, "max_items_per_run": 8},
               "task_owner_bot": "the-ceo"},
            state={}, now=dt.datetime(2026, 11, 23, 12), stamp="2026-11-23T12:00:00", current=[], judged_now=set(), notes=[], errors=[],
            ins=NS(questions={"the-ceo": ["Q?"]}, question_tags={}))
    v.Run._model_pass(me, [task], [])
    return asked, kept, me


def test_a_budget_of_zero_means_no_cap(monkeypatch):
    asked, _, me = _pass(monkeypatch, 0)
    assert len(asked) == 1 and not me.errors


def test_a_used_budget_still_stops_the_pass(monkeypatch):
    asked, _, _ = _pass(monkeypatch, 1)
    assert len(asked) == 1          # one item, then the budget of 1 is used


def test_the_pass_sends_no_assignee_name_and_passes_the_closed_list(monkeypatch):
    asked, kept, _ = _pass(monkeypatch, 0)
    assert "Pat Example" not in asked[0] and "Assignee: assigned" in asked[0] and kept["closed"] == {"gemini"}


def test_the_pass_says_the_mask_stopped_it(monkeypatch):
    import judge
    import validator as v

    class NoMask(judge.Judge):
        def __init__(self, chain, **kw):
            super().__init__(chain, **kw)
            self.mask_failed = True

        def ask(self, system, prompt):
            return None

    from types import SimpleNamespace as NS
    import datetime as dt
    monkeypatch.setattr(v, "Judge", NoMask)
    monkeypatch.setattr(v, "closed_names", lambda root: set())
    task = NS(status="open", title="T", assignee_names=[], due="", priority="", body="B", page_id="t", edited="e", created="c", label="T", url="u")
    me = NS(s={"model": {"chain": [{"name": "groq", "base_url": "https://x.invalid/v1", "model": "m", "key_file": "/none"}], "daily_token_budget": 0},
               "task_owner_bot": "the-ceo"},
            state={}, now=dt.datetime(2026, 11, 23), stamp="s", current=[], judged_now=set(), notes=[], errors=[],
            ins=NS(questions={"the-ceo": ["Q?"]}, question_tags={}))
    v.Run._model_pass(me, [task], [])
    assert me.errors == ["judgment pass: the mask could not run, so nothing was sent; skipped for this run"]
