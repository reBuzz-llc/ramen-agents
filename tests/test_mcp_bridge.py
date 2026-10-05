"""MCP: the owner's allowlist decides what a bot may call; the call itself runs a local server over stdio."""
import sys
from pathlib import Path

from explorer.actions import McpCall
from explorer.config import McpConfig
from explorer.mcp_bridge import call_tool, ready_servers
from explorer.policy import Denylist, Policy, PolicyContext

FAKE = str(Path(__file__).parent / "fixtures" / "fake_mcp_server.py")


def server(tmp_path, **kw):
    return {"name": "google-analytics", "command": sys.executable, "args": [FAKE], "tools": ["run_report"], **kw}


def test_a_call_returns_the_tools_answer_and_a_failure_is_a_reason(tmp_path):
    ok, text = call_tool(server(tmp_path), "run_report", {"metric": "users"}, timeout=60)
    assert ok and "users: 1234" in text
    ok, text = call_tool(server(tmp_path), "broken", {}, timeout=60)
    assert not ok and "broken" in text
    ok, text = call_tool({**server(tmp_path), "command": "/nonexistent/server"}, "run_report", {}, timeout=20)
    assert not ok


def test_the_policy_holds_calls_to_the_allowlist_the_setup_and_the_daily_cap(cfg, tmp_path):
    creds = tmp_path / "ga.json"
    mcp = McpConfig(enabled=True, servers=[server(tmp_path, requires=[str(creds)])], max_calls_per_day=2)
    policy = Policy(cfg.policy, cfg.publish, Denylist.load(Path(cfg.policy.denylist_file)), mcp=mcp)
    ctx = lambda **kw: PolicyContext(mode="web", current_page=None, actions_in_episode=1, pages_last_hour=0, open_questions=0, last_visit_by_domain={}, **kw)  # noqa: E731
    call = McpCall(type="mcp", server="google-analytics", tool="run_report", arguments={"metric": "sessions"})
    assert "not set up yet" in policy.check(call, ctx()).reason and ready_servers(mcp.servers) == []
    creds.write_text("{}")
    assert policy.check(call, ctx()).allowed and len(ready_servers(mcp.servers)) == 1
    assert "no tool 'broken'" in policy.check(McpCall(type="mcp", server="google-analytics", tool="broken"), ctx()).reason
    assert "no MCP server named" in policy.check(McpCall(type="mcp", server="hubspot", tool="send"), ctx()).reason
    assert "daily limit" in policy.check(call, ctx(mcp_calls_today=2)).reason
    off = Policy(cfg.policy, cfg.publish, Denylist.load(Path(cfg.policy.denylist_file)))
    assert "not enabled" in off.check(call, ctx()).reason
