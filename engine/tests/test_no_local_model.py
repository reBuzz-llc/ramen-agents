"""With no local model, an empty chain is a rest with a plain line, and nothing on this machine is called."""
from __future__ import annotations

import logging
from types import SimpleNamespace

import pytest

from explorer.actions import Rest
from explorer.common.fallback import FallbackModel, build_model
from explorer.config import ModelConfig
from explorer.judge import build_judge
from explorer.model import ModelResult, NoLocalModel, OllamaModel

LOG = logging.getLogger("test-no-local")
OBS = SimpleNamespace(render=lambda: "o", feedback="")


class Down:
    label = "down"
    chain_name = "down"
    unavailable_until = 0.0

    def __init__(self, back=90.0):
        self.back = back

    def decide(self, system, obs):
        self.unavailable_until = 1000.0 + self.back
        return ModelResult(decision=None, raw="", error="429")

    def complete(self, system, prompt):
        self.unavailable_until = 1000.0 + self.back
        return ""


def _chain(*providers):
    m = FallbackModel(list(providers), NoLocalModel(), LOG)
    m.clock = lambda: 1000.0
    return m


def test_an_empty_chain_is_a_rest_until_the_first_provider_is_back(caplog):
    with caplog.at_level(logging.WARNING):
        r = _chain(Down(90), Down(300)).decide("s", OBS)
    assert r.held and isinstance(r.decision.action, Rest) and r.decision.action.seconds == 90
    assert "no provider answered; resting 90s" in caplog.text


@pytest.mark.parametrize("back,want", [(5, 60), (5000, 600)])
def test_the_rest_stays_between_one_and_ten_minutes(back, want):
    assert _chain(Down(back)).decide("s", OBS).decision.action.seconds == want


def test_writing_mode_needs_no_local_draft():
    m = _chain(Down(120))
    m.remote_for = "writing"
    r = m.decide("s", OBS)
    assert r.held and r.decision.action.seconds == 120


def test_the_default_is_no_local_model():
    assert ModelConfig().fallback_provider == "none"


def test_no_key_at_all_rests_and_names_the_next_step(tmp_path, monkeypatch, caplog):
    monkeypatch.setattr("explorer.common.fallback._remote_providers", lambda *a, **k: [])
    with caplog.at_level(logging.WARNING):
        m = build_model(ModelConfig(provider="remote", provider_chain=["zai"]), LOG, ledger_path=tmp_path / "ledger.json")
    assert "sh scripts/add-key.sh zai" in caplog.text
    r = m.decide("s", OBS)
    assert r.held and isinstance(r.decision.action, Rest)


def test_no_judge_touches_a_local_server(monkeypatch):
    def never(*a, **k):
        raise AssertionError("a local model was built")
    monkeypatch.setattr(OllamaModel, "__init__", never)
    chain = SimpleNamespace(complete=lambda s, p: "chain")
    assert build_judge("local", ModelConfig(fallback_provider="none"), "x", chain, LOG)("s", "p") == "chain"
    build_model(ModelConfig(provider="remote", provider_chain=[], fallback_provider="none"), LOG)
