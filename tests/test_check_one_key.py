"""One model key is enough: `bot check` passes with one provider that answers and names the next step with none."""
from __future__ import annotations

from types import SimpleNamespace

import pytest

from explorer import cli
from explorer.model import OpenAICompatModel


def _cfg(cfg, chain, closed=()):
    cfg.model.provider = "remote"
    cfg.model.provider_chain = chain
    cfg.model.personal_closed = list(closed)
    cfg.model.fallback_provider = "none"
    cfg.leads.enabled = cfg.tasks.enabled = cfg.packages.enabled = False
    cfg.agent.mode = "fake"
    return cfg


def _keys(monkeypatch, have):
    monkeypatch.setattr(cli, "load_provider_key", lambda provider: "k" if provider.name in have else "")
    monkeypatch.setattr(cli, "load_gemini_key", lambda model: "k" if "gemini" in have else "")


def _run(cfg, capsys):
    code = cli.cmd_check(cfg, SimpleNamespace(all=False))
    return code, capsys.readouterr().out


def test_one_answering_key_is_enough(cfg, monkeypatch, capsys):
    _keys(monkeypatch, {"zai"})
    monkeypatch.setattr(OpenAICompatModel, "available", lambda self: (True, f"{self.provider.name} answers"))
    code, out = _run(_cfg(cfg, ["zai", "groq", "openrouter"]), capsys)
    assert code == 0 and "model providers: 1 of 3" in out and "FAIL  groq" not in out and "note  groq key: not found" in out


def test_no_key_fails_and_names_the_next_step(cfg, monkeypatch, capsys):
    _keys(monkeypatch, set())
    code, out = _run(_cfg(cfg, ["zai", "groq"]), capsys)
    assert code != 0 and "model providers: 0 of 2" in out and "sh scripts/add-key.sh zai" in out


def test_a_key_that_is_refused_does_not_count(cfg, monkeypatch, capsys):
    _keys(monkeypatch, {"zai"})
    monkeypatch.setattr(OpenAICompatModel, "available", lambda self: (False, "rejected the key"))
    code, out = _run(_cfg(cfg, ["zai", "groq"]), capsys)
    assert code != 0 and "model providers: 0 of 2" in out


def test_a_provider_down_does_not_stop_the_others(cfg, monkeypatch, capsys):
    _keys(monkeypatch, {"zai", "groq"})
    monkeypatch.setattr(OpenAICompatModel, "available", lambda self: (self.provider.name == "groq", "x"))
    code, out = _run(_cfg(cfg, ["zai", "groq"]), capsys)
    assert code == 0 and "model providers: 1 of 2" in out


@pytest.mark.parametrize("opened,want", [((), 0), (("gemini",), 1)])
def test_a_gemini_key_closed_to_lead_data_does_not_count(cfg, monkeypatch, capsys, opened, want):
    _keys(monkeypatch, {"gemini"})
    monkeypatch.setattr(cli.GeminiModel, "available", lambda self: (True, "gemini answers"))
    closed = () if opened else ("gemini",)
    code, out = _run(_cfg(cfg, ["gemini"], closed), capsys)
    assert (code == 0) is bool(want) and f"model providers: {want} of 1" in out
    assert ("closed to lead data" in out) is (not opened)
