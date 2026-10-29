"""Provider health in the call ledger, and a timed-out host benched long (creatorCC queue 16, 2026-10-29)."""
from __future__ import annotations

import json

import httpx

from explorer.common.fallback import CallLedger
from explorer.config import ModelConfig
from explorer.model import TIMEOUT_BENCH_SECONDS, OpenAICompatModel

from test_remote_providers import Clock, groq_provider, obs


def test_health_keeps_the_last_success_and_the_last_failure_with_its_reason_across_days(tmp_path):
    clock = Clock(1_761_700_000.0)
    led = CallLedger(tmp_path / "calls.json", clock=clock)
    led.note_health("api.z.ai", True)
    led.note_health("api.z.ai", False, "api.z.ai rate limit or daily cap (429)")
    clock.t += 86400                                     # a new day: counts reset, health stays
    led.record("api.groq.com")
    data = json.loads((tmp_path / "calls.json").read_text())
    h = data["health"]["api.z.ai"]
    assert h["last_reason"] == "api.z.ai rate limit or daily cap (429)" and h["last_ok"] and h["last_fail"]
    assert data["counts"] == {"api.groq.com": 1}


def test_a_hanging_host_is_benched_for_fifteen_minutes_a_refused_one_for_two():
    for exc, wait in ((httpx.ReadTimeout("slow"), TIMEOUT_BENCH_SECONDS), (httpx.ConnectError("refused"), 120.0)):
        def handler(request, exc=exc):
            raise exc
        clock = Clock(1000.0)
        m = OpenAICompatModel(ModelConfig(provider="remote", max_retries=0), groq_provider(), "k", transport=httpx.MockTransport(handler), clock=clock)
        m.decide("sys", obs())
        assert m.unavailable_until == 1000.0 + wait


def test_first_fail_marks_where_a_run_of_failures_began_and_a_success_clears_it(tmp_path):
    clock = Clock(1_761_700_000.0)
    led = CallLedger(tmp_path / "calls.json", clock=clock)
    led.note_health("gemini", False, "503")
    first = json.loads((tmp_path / "calls.json").read_text())["health"]["gemini"]["first_fail"]
    clock.t += 600
    led.note_health("gemini", False, "503")
    h = json.loads((tmp_path / "calls.json").read_text())["health"]["gemini"]
    assert h["first_fail"] == first and h["last_fail"] > first
    led.note_health("gemini", True)
    assert "first_fail" not in json.loads((tmp_path / "calls.json").read_text())["health"]["gemini"]
