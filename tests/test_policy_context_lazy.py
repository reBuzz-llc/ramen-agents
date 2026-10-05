"""PolicyContext.loaders: an expensive field is read on first use, never shown as its placeholder."""
from __future__ import annotations

from explorer.actions import Ask, Search
from explorer.config import PolicyConfig, PublishConfig
from explorer.policy import Denylist, Policy, PolicyContext

from conftest import DENYLIST


def make_policy(**overrides) -> Policy:
    return Policy(PolicyConfig(**overrides), PublishConfig(), Denylist.load(DENYLIST))


def base(**fields) -> PolicyContext:
    return PolicyContext(mode="web", current_page=None, actions_in_episode=0, pages_last_hour=0, open_questions=0,
                         last_visit_by_domain={}, **fields)


def test_a_lazy_field_loads_once_on_first_read_and_replaces_the_placeholder():
    calls: list[str] = []

    def load() -> int:
        calls.append("x")
        return 7

    ctx = base(questions_in_episode=0, loaders={"questions_in_episode": load})
    assert calls == []  # building the context reads nothing
    assert ctx.questions_in_episode == 7
    assert ctx.questions_in_episode == 7
    assert calls == ["x"]


def test_fields_nobody_reads_never_load():
    touched: list[str] = []
    ctx = base(loaders={"tasks_today": lambda: touched.append("tasks") or 0, "recent_task_titles": lambda: touched.append("titles") or set()})
    make_policy().check(Search(type="search", query="tides"), ctx, key="search:tides")
    assert touched == []  # a search never looks at Notion task counts


def test_lazy_and_eager_contexts_give_the_same_verdicts():
    # Enough asks already this episode: the ask must be refused whether the count is eager or lazy.
    cfg = dict(max_open_questions=40)
    ask = Ask(type="ask", question="Why do tides differ between coasts?")
    eager = base(questions_in_episode=99, refused_asks_in_episode=0, open_question_texts=[])
    lazy = base(loaders={"questions_in_episode": lambda: 99, "refused_asks_in_episode": lambda: 0, "open_question_texts": lambda: []})
    v1 = make_policy(**cfg).check(ask, eager, key="ask:1")
    v2 = make_policy(**cfg).check(ask, lazy, key="ask:1")
    assert (v1.allowed, v1.reason) == (v2.allowed, v2.reason)
    assert not v1.allowed
