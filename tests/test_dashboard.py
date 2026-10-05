import json
import threading
import urllib.error
import urllib.request

import pytest

from explorer.dashboard import DashboardApp, make_server
from explorer.model import FakeModel

from conftest import make_controller


@pytest.fixture
def dashboard(cfg):
    """A dashboard on a free port over a workspace that already has a few cycles of data."""
    make_controller(cfg).run(max_cycles=4)
    # The test controller logs to a bare logger; give the dashboard a log file to read like the real run has.
    cfg.log_path.write_text(
        '{"ts": "2026-09-12T10:00:00", "level": "INFO", "msg": "start", "kind": "start"}\n'
        '{"ts": "2026-09-12T10:00:30", "level": "INFO", "msg": "rejected", "kind": "rejected", "action": "open", "reason": "denylist"}\n'
        "not json at all\n",
        encoding="utf-8",
    )
    app = DashboardApp(cfg, FakeModel())
    server = make_server(app, "127.0.0.1", 0)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base = f"http://127.0.0.1:{server.server_address[1]}"
    yield app, base
    server.shutdown()
    server.server_close()


def get(base: str, path: str):
    with urllib.request.urlopen(base + path, timeout=5) as resp:
        return resp.status, json.loads(resp.read().decode("utf-8")) if "json" in resp.headers.get("Content-Type", "") else resp.read()


def post(base: str, path: str, body: dict, token: str | None = None, origin: str | None = None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["X-Token"] = token
    if origin:
        headers["Origin"] = origin
    req = urllib.request.Request(base + path, data=json.dumps(body).encode("utf-8"), headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        return exc.code, json.loads(exc.read().decode("utf-8") or "{}")


def test_page_and_read_endpoints(dashboard):
    app, base = dashboard
    status, html = get(base, "/")
    assert status == 200
    assert app.token.encode() in html and b"__TOKEN__" not in html
    status, state = get(base, "/api/state")
    assert status == 200
    assert state["running"] is False
    assert state["counts"]["actions"] == 4
    assert state["heartbeat"]["cycle"] == 4
    _, events = get(base, "/api/events?n=10")
    assert events and all("ts" in e for e in events)
    _, notes = get(base, "/api/notes")
    assert notes and {"id", "title", "body"} <= set(notes[0])
    _, questions = get(base, "/api/questions")
    assert set(questions) == {"open", "answered"}
    _, journal = get(base, "/api/journal")
    assert "Started" in journal["text"]
    status, _ = get(base, "/api/interests")
    assert status == 200


def test_reads_need_the_token_too_when_not_bound_to_loopback(dashboard):
    app, base = dashboard
    app.reads_need_token = True  # what make_server sets for any host but loopback
    with pytest.raises(urllib.error.HTTPError) as err:
        get(base, "/api/notes")
    assert err.value.code == 401
    status, _ = get(base, "/")  # the page itself still loads; it carries the token for its own calls
    assert status == 200
    req = urllib.request.Request(base + "/api/notes", headers={"X-Token": app.token})
    with urllib.request.urlopen(req, timeout=5) as resp:
        assert resp.status == 200 and json.loads(resp.read())
    app.reads_need_token = False
    assert get(base, "/api/notes")[0] == 200


def test_writes_need_the_token_and_a_matching_origin(dashboard, cfg):
    app, base = dashboard
    status, body = post(base, "/api/control", {"op": "pause"})
    assert status == 403 and body["error"] == "forbidden"
    assert not cfg.pause_file.exists()
    status, _ = post(base, "/api/control", {"op": "pause"}, token=app.token, origin="http://evil.example")
    assert status == 403
    status, body = post(base, "/api/control", {"op": "pause"}, token=app.token, origin=base)
    assert status == 200 and cfg.pause_file.exists()
    status, _ = post(base, "/api/control", {"op": "resume"}, token=app.token)
    assert status == 200 and not cfg.pause_file.exists()
    status, body = post(base, "/api/control", {"op": "format-disk"}, token=app.token)
    assert status == 400 and "unknown op" in body["error"]


def test_chat_replies_and_the_running_agent_sees_owner_messages(dashboard, cfg):
    app, base = dashboard
    status, body = post(base, "/api/chat", {"text": "What have you been reading?"}, token=app.token)
    assert status == 200 and body["kind"] == "model" and "Fake journal entry" in body["reply"]
    _, history = get(base, "/api/chat")
    assert [m["role"] for m in history] == ["owner", "bot"]

    # The plain message is left unseen for the agent; it appears once in the observation, then is marked seen.
    controller = make_controller(cfg)
    assert [r["text"] for r in controller.memory.unseen_owner_messages()] == ["What have you been reading?"]
    ep = controller._ensure_episode()
    obs = controller._observe(ep)
    assert "Owner says: What have you been reading?" in obs.render()
    controller.run(max_cycles=1)
    assert controller.memory.unseen_owner_messages() == []
    assert "Owner says" not in controller._observe(controller._ensure_episode()).render()


def test_chat_never_wakes_the_local_model_while_a_game_runs(cfg):
    from explorer.config import QuietConfig
    from explorer.common.fallback import FallbackModel
    from explorer.presence import QuietDetector

    class Local:
        calls = 0

        def complete(self, system, prompt):
            Local.calls += 1
            return "local reply"

    class Remote:
        label = "api.groq.com/x"
        unavailable_until = 0.0
        calls_per_day = 0

        def __init__(self, text):
            self.text = text

        def complete(self, system, prompt):
            return self.text

    gaming = QuietDetector(QuietConfig(apps=["Steam"]), idle_fn=lambda: 0.0, front_fn=lambda: "Steam", procs_fn=lambda n: [])
    typing = QuietDetector(QuietConfig(apps=["Steam"]), idle_fn=lambda: 0.0, front_fn=lambda: "Safari", procs_fn=lambda n: [])

    app = DashboardApp(cfg, FallbackModel([Remote("groq reply")], Local()), quiet=gaming)
    assert app.chat_message("hi")["reply"] == "groq reply" and Local.calls == 0

    app = DashboardApp(cfg, FallbackModel([Remote("")], Local()), quiet=gaming)
    reply = app.chat_message("hi")["reply"]
    assert "Steam is in front" in reply and "not using the local model" in reply and Local.calls == 0

    app = DashboardApp(cfg, Local(), quiet=gaming)  # local only: nothing is called at all
    assert "Steam is in front" in app.chat_message("hi")["reply"] and Local.calls == 0

    # Typing in the chat is owner activity, not a game: the local model answers as usual.
    app = DashboardApp(cfg, Local(), quiet=typing)
    assert app.chat_message("hi")["reply"] == "local reply" and Local.calls == 1


def test_slash_commands_are_handled_by_code_not_the_model(dashboard, cfg):
    app, base = dashboard
    status, body = post(base, "/api/chat", {"text": "/ask Why do tides have two highs a day?"}, token=app.token)
    assert status == 200 and body["kind"] == "command" and body["reply"].startswith("Added question #")
    assert any("two highs" in r["question"] for r in app.memory.open_questions(10))
    assert app.memory.unseen_owner_messages() == []  # commands never reach the agent as "Owner says"
    _, body = post(base, "/api/chat", {"text": "/interest moss 0.5"}, token=app.token)
    assert "moss" in body["reply"]
    _, body = post(base, "/api/chat", {"text": "/pause"}, token=app.token)
    assert cfg.pause_file.exists()
    _, body = post(base, "/api/chat", {"text": "/resume"}, token=app.token)
    assert not cfg.pause_file.exists()
    _, body = post(base, "/api/chat", {"text": "/dance"}, token=app.token)
    assert body["reply"].startswith("Unknown command")
    status, body = post(base, "/api/chat", {"text": "   "}, token=app.token)
    assert status == 400


def test_a_chat_reply_is_held_to_the_record_not_to_its_own_past_replies(cfg, tmp_path):
    """The CEO's chat once invented an engineer "Sam" and a Notion token it never made (owner, 2026-09-25): the
    reply prompt carries what the bot actually did, whom it actually asked, and the people who actually exist."""
    from explorer.fleet_requests import RequestLog

    team = tmp_path / "team.json"
    team.write_text(json.dumps({"version": 1, "members": [{"notionId": "u1", "name": "Jo", "role": "Marketing Lead"}]}))
    cfg.notion.team_file = str(team)
    cfg.agent.name = "The CEO"
    cfg.messaging.peers = [{"name": "Lead Gen", "folder": str(tmp_path / "lead-gen")}]
    cfg.messaging.requests_file = str(tmp_path / "requests.jsonl")
    log = RequestLog(cfg.messaging.requests_path(cfg.root))
    log.record("r1", "The CEO", "Lead Gen", "Please fill the missing emails on the Leads board.")
    log.record("r2", "Lead Gen", "The CEO", "Which rows first?")
    log.answer("Lead Gen", "The CEO", "The Springfield biotech ones.")

    app = DashboardApp(cfg, FakeModel())
    app.memory.record_action(1, None, "search", {}, None, "allowed", "searched 'spf biotech founders'", True)
    app.memory.record_action(2, None, "message", {}, None, "rejected: you can only message a peer", None, False)
    app.memory.record_action(3, None, "notion", {}, None, "failed: 403 from Notion", None, False)
    app.memory.add_chat("bot", "I regenerated the Notion token and asked Sam to check it.", seen=True)

    system, prompt = app._build_prompt("who is Sam?")
    assert "never make up a colleague" in system and "the record is right" in system
    assert "search: done searched 'spf biotech founders'" in prompt
    assert "message: NOT done (rejected" in prompt and "notion: NOT done (failed: 403" in prompt
    assert "you asked Lead Gen: 'Please fill the missing emails" in prompt and "(still open)" in prompt
    assert "Lead Gen asked you: 'Which rows first?' (answered" in prompt
    assert "- Jo: Marketing Lead (team)" in prompt and "- Lead Gen (a bot in the fleet)" in prompt
    assert "Sam " not in prompt.split("## The conversation so far")[0]  # only the old reply mentions Sam
    assert "may be wrong" in prompt  # and the history is labelled as not a record


def test_a_chat_reply_with_nothing_on_record_says_so(cfg, tmp_path):
    cfg.notion.team_file = str(tmp_path / "missing.json")
    cfg.messaging.requests_file = str(tmp_path / "none.jsonl")
    _, prompt = DashboardApp(cfg, FakeModel())._build_prompt("hello")
    assert "- (nothing yet)" in prompt and "- (no requests on record)" in prompt and "- (no team or fleet on record)" in prompt
