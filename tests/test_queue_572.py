"""Queue 572 (owner, 2026-11-16: "remove notion from all location and repos"): the starter runs a whole family on the
dashboard's local board with no Notion anywhere. Tasks and package drafts go through portal_store like the leads, the
user's own values live in untracked overlays, a leftover [notion] stops a bot at load naming the file, and a board that
is not running is a plain rest, never a crash or a write recorded that never landed."""
from __future__ import annotations

import json
import time
from pathlib import Path

import httpx
import pytest

from explorer import board_down
from explorer.actions import PublishPackage, Task
from explorer.board import BoardError
from explorer.cli import build_boards
from explorer.config import load_config
from explorer.portal_store import PortalBoard, PortalLeadStore

from conftest import make_controller


def write(path: Path, text: str) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return path


# ---- 1. no Notion: the config ------------------------------------------------------------------------------------

def test_a_family_config_without_notion_loads_with_the_local_board_by_default(tmp_path):
    cfg = load_config(write(tmp_path / "the-ceo" / "config.toml", '[agent]\nname = "The CEO"\n[tasks]\nenabled = true\nmax_per_day = 2\n'
                                                                 '[packages]\nenabled = true\nsignoff = "Regards,"\n[leads]\nenabled = true\n'))
    assert cfg.leads.portal_url == "http://127.0.0.1:3000"
    assert cfg.tasks.enabled and cfg.tasks.max_per_day == 2 and cfg.packages.enabled and cfg.packages.signoff == "Regards,"
    assert not hasattr(cfg, "notion")


def test_a_leftover_notion_section_stops_the_bot_and_names_the_file(tmp_path):
    path = write(tmp_path / "the-ceo" / "config.toml", '[agent]\nname = "The CEO"\n[notion]\nenabled = true\ndatabase_id = "x"\n')
    with pytest.raises(ValueError) as err:
        load_config(path)
    assert "unknown section(s) ['notion']" in str(err.value) and str(path) in str(err.value) and "update.sh" in str(err.value)


def test_a_notion_id_under_leads_stops_the_bot(tmp_path):
    with pytest.raises(ValueError, match=r"unknown keys in \[leads\].*database_id"):
        load_config(write(tmp_path / "lead-gen" / "config.toml", '[leads]\nenabled = true\ndatabase_id = "ds"\n'))


# ---- 2. the overlays ---------------------------------------------------------------------------------------------

def test_the_overlays_are_read_after_the_tracked_files_and_the_members_own_wins(tmp_path):
    common = write(tmp_path / "common-data" / "configs" / "common.toml", '[leads]\nportal_url = "http://tracked.example"\nmax_per_day = 3\n'
                                                                         '[tasks]\nmax_per_day = 4\n')
    member = write(tmp_path / "the-ceo" / "config.toml", f'extends = "{common}"\n[agent]\nname = "The CEO"\n[tasks]\nenabled = true\nmax_per_day = 5\n')
    assert load_config(member).tasks.max_per_day == 5                      # the member's tracked file over the shared one
    write(tmp_path / "common-data" / "configs" / "local.toml", '[leads]\nportal_url = "http://shared-local.example"\n[tasks]\nmax_per_day = 6\n')
    cfg = load_config(member)
    assert cfg.leads.portal_url == "http://shared-local.example" and cfg.tasks.max_per_day == 6   # any local beats any tracked
    assert cfg.leads.max_per_day == 3                                       # tables merge key by key
    write(tmp_path / "the-ceo" / "config.local.toml", '[tasks]\nmax_per_day = 7\n')
    cfg = load_config(member)
    assert cfg.tasks.max_per_day == 7 and cfg.leads.portal_url == "http://shared-local.example"   # the member's own last


def test_an_overlay_is_validated_like_the_tracked_file_and_named(tmp_path):
    member = write(tmp_path / "lead-gen" / "config.toml", '[leads]\nenabled = true\n')
    local = write(tmp_path / "lead-gen" / "config.local.toml", '[leads]\nmax_per_dya = 3\n')
    with pytest.raises(ValueError) as err:
        load_config(member)
    assert "max_per_dya" in str(err.value) and str(local) in str(err.value)
    local.write_text('[notion]\nenabled = true\n')
    with pytest.raises(ValueError, match="unknown section"):
        load_config(member)
    local.write_text('extends = "../x.toml"\n')
    with pytest.raises(ValueError, match="extends is not read in a local overlay"):
        load_config(member)


# ---- 1. the board clients: built from one key, tasks and packages on the board -----------------------------------

def test_the_board_clients_come_from_one_address_and_one_key(tmp_path, monkeypatch):
    monkeypatch.delenv("PORTAL_ENGINE_KEY", raising=False)
    cfg = load_config(write(tmp_path / "the-ceo" / "config.toml", f'[tasks]\nenabled = true\n[leads]\nenabled = true\nportal_key_file = "{tmp_path / "none.key"}"\n'))
    import logging
    assert build_boards(cfg, logging.getLogger("t")) == (None, None)       # no key: off, with a warning, no crash
    monkeypatch.setenv("PORTAL_ENGINE_KEY", "k")
    leads, board = build_boards(cfg, logging.getLogger("t"))
    assert isinstance(leads, PortalLeadStore) and isinstance(board, PortalBoard)
    assert board.base == "http://127.0.0.1:3000" and board.headers == {"Authorization": "Bearer k"} and board.down_flag is not None


class Board:
    """The local board's task and package routes, as appCC serves them (queue 572)."""

    def __init__(self):
        self.calls: list[tuple[str, str, dict]] = []
        self.tasks: dict[str, dict] = {}
        self.drafts: list[dict] = []

    def handler(self, req: httpx.Request) -> httpx.Response:
        body = json.loads(req.content) if req.content else {}
        self.calls.append((req.method, req.url.path, body))
        if req.method == "POST" and req.url.path == "/v1/boards/tasks/rows":
            tid = f"{len(self.tasks) + 1:08x}-0000-0000-0000-000000000000"
            task = {"id": tid, "status": "Not started", "assignees": [], **body["fields"]}
            self.tasks[tid] = task
            return httpx.Response(201, json={"task": task, "written": list(body["fields"]), "refused": []})
        if req.url.path.startswith("/v1/tasks/"):
            task = self.tasks.get(req.url.path.rsplit("/", 1)[-1])
            if task is None:
                return httpx.Response(404, json={"error": {"code": "not_found", "message": "no such task"}})
            if req.method == "PATCH":
                task.update(body.get("fields") or {})
                if body.get("details_append"):
                    task["details"] = task.get("details", "") + "\n\n" + body["details_append"]
            return httpx.Response(200, json={"task": task, "written": list(body.get("fields") or {}), "refused": []})
        if req.url.path == "/v1/assets/packages/drafts":
            if req.method == "POST":
                draft = {"id": f"d{len(self.drafts) + 1}", "status": "draft", **body}
                self.drafts.append(draft)
                return httpx.Response(201, json={"package": draft})
            return httpx.Response(200, json={"drafts": self.drafts})
        return httpx.Response(404, json={"error": {"code": "not_found", "message": "no route"}})


def _board(b: Board, **kw) -> PortalBoard:
    return PortalBoard("http://board.test", "k", "The CEO", http=httpx.Client(base_url="http://board.test", transport=httpx.MockTransport(b.handler)), **kw)


def test_a_task_goes_to_the_board_unassigned_and_reads_back(tmp_path):
    b = Board()
    client = _board(b, default_project="Outreach")
    url = client.create_task("Draft the pricing page", "### Why\nbecause", assignee="Jane", priority="p2", due="2026-12-01")
    method, path, body = b.calls[-1]
    assert (method, path) == ("POST", "/v1/boards/tasks/rows") and body["actor"] == "The CEO"
    assert body["fields"] == {"title": "Draft the pricing page", "priority": "P2", "details": "### Why\nbecause", "due": "2026-12-01", "projects": ["Outreach"]}
    assert "assignee 'Jane' not set" in client.last_warnings[0]
    pid = url.rsplit("/", 1)[-1]
    page = client.read_page(pid)
    assert page["fields"]["Task"] == "Draft the pricing page" and page["fields"]["Status"] == "Not started"
    client.update_task(pid, priority="P1", details_append="### Done when\n- [ ] it is live")
    assert b.calls[-1][2] == {"actor": "The CEO", "fields": {"priority": "P1"}, "details_append": "### Done when\n- [ ] it is live"}
    assert "it is live" in client.page_text(pid)
    with pytest.raises(BoardError, match="no task"):
        client.update_task("ffffffff-0000-0000-0000-000000000000", priority="P1")
    with pytest.raises(BoardError, match="team's cell"):
        client.set_status(pid, "Dublicate")


def test_a_package_goes_to_the_board_as_a_draft_and_reads_back():
    b = Board()
    client = _board(b)
    client.append_package_toggle("", "Ship your MVP in 8 weeks", "Hi [Name], ...\nRegards,", ["https://a.example/pricing"],
                                 [("Company", "A Agency"), ("Founded", "")], "fits", name="MVP Launch Starter",
                                 audience="pre-seed founders", price="$6,500 fixed", timeline="8 weeks", deliverables=["MVP", "Launch"])
    body = b.calls[-1][2]
    assert body["name"] == "MVP Launch Starter" and body["price"] == "$6,500 fixed" and body["buyer"] == "pre-seed founders"
    assert body["offer"].startswith("Ship your MVP in 8 weeks\n\nHi [Name]") and body["deliverables"] == ["MVP", "Launch"]
    assert "Company: A Agency" in body["why"] and "Founded" not in body["why"] and body["by"] == "The CEO"
    assert client.last_toggle_id == "d1" and client.read_block("d1")["name"] == "MVP Launch Starter" and client.read_block("d9") is None


def test_the_ceo_hands_a_package_and_makes_a_task_with_no_notion(cfg):
    cfg.tasks.enabled = cfg.packages.enabled = True
    b = Board()
    c = make_controller(cfg, board=_board(b))
    ep = c.memory.episode(c.memory.start_episode())
    r = c._execute(Task(type="task", title="Draft the pricing page for the spring offer", details="### Why\n" + "x" * 50,
                        assignee=None, priority="P3", due=None), ep, None)
    assert r.ok, r.summary
    assert c.package_board is not None and c.task_board is not None
    r2 = c._execute(PublishPackage(type="publish_package", name="Nope", title="t", email="e", conclusion="c"), ep, None)
    assert not r2.ok and "no package named" in r2.summary         # the skill is there; this one just was not handed over


# ---- 3. the board down -------------------------------------------------------------------------------------------

def _refused(req: httpx.Request) -> httpx.Response:
    raise httpx.ConnectError("Connection refused", request=req)


def test_a_dashboard_that_is_not_running_raises_the_flag_and_the_rest_waits_without_a_request(tmp_path):
    flag = tmp_path / "board-down.json"
    calls = []

    def refused(req):
        calls.append(req.url.path)
        return _refused(req)
    store = PortalLeadStore("http://127.0.0.1:3000", "k", "Writer", http=httpx.Client(transport=httpx.MockTransport(refused)), down_flag=flag)
    with pytest.raises(BoardError, match="is the dashboard running"):
        store.refresh(force=True)
    info = board_down.read(flag)
    assert info["why"] == "ConnectError" and info["url"] == "http://127.0.0.1:3000"
    board = PortalBoard("http://127.0.0.1:3000", "k", "The CEO", http=httpx.Client(transport=httpx.MockTransport(refused)), down_flag=flag)
    with pytest.raises(board_down.BoardDown) as err:
        board.create_task("A task title here", "details", priority="P3")
    assert len(calls) == 1 and "Nothing was written" in str(err.value) and "dashboard running" in str(err.value)


def test_the_board_answering_takes_the_flag_down(tmp_path):
    flag = tmp_path / "board-down.json"
    board_down.failed("ConnectError", flag, now=time.time() - 120)
    ok = PortalLeadStore("http://b.test", "k", "Writer", http=httpx.Client(base_url="http://b.test", transport=httpx.MockTransport(
        lambda r: httpx.Response(200, json={"leads": [], "next": 0, "more": False}))), down_flag=flag)
    ok.refresh(force=True)
    assert not board_down.read(flag)


def test_a_board_write_while_down_fails_plainly_and_is_not_counted(cfg, tmp_path):
    flag = tmp_path / "board-down.json"
    board_down.failed("ConnectError", flag, url="http://127.0.0.1:3000")
    cfg.tasks.enabled = True
    board = PortalBoard("http://127.0.0.1:3000", "k", "The CEO", http=httpx.Client(transport=httpx.MockTransport(_refused)), down_flag=flag)
    c = make_controller(cfg, board=board)
    ep = c.memory.episode(c.memory.start_episode())
    r = c._execute(Task(type="task", title="Draft the pricing page for the spring offer", details="### Why\nbecause",
                        assignee=None, priority="P3", due=None), ep, None)
    assert not r.ok and "board is down" in r.summary          # no crash: the action failed with the reason
    assert c.memory.count_tasks_today() == 0                  # never recorded as written
    assert any("NOT NOW any board write" in line for line in c._allowed_now(ep))


def test_a_member_whose_work_is_the_board_rests_until_it_is_back(cfg, tmp_path):
    flag = tmp_path / "board-down.json"
    now = time.time()
    board_down.failed("ConnectError", flag, now=now - board_down.PAUSE_SECONDS - 5, url="http://127.0.0.1:3000")
    flag.write_text(json.dumps({**board_down.read(flag), "probe_at": now - board_down.PROBE_SECONDS + 0.2}))
    cfg.leads.enabled = True
    cfg.leads.draft_queue_column = "Draft email"
    store = PortalLeadStore("http://127.0.0.1:3000", "k", "Writer", http=httpx.Client(transport=httpx.MockTransport(_refused)), down_flag=flag)
    c = make_controller(cfg, leads_board=store)
    t0 = time.time()
    assert c._rest_if_board_down() is True
    assert time.time() - t0 < 5
    # a member whose work is not the board (no draft queue, no fill-only list) keeps working
    cfg.leads.draft_queue_column = ""
    assert c._rest_if_board_down() is False


# ---- no Notion anywhere ------------------------------------------------------------------------------------------

def test_there_is_no_notion_module_and_no_notion_key_check():
    import importlib.util
    assert importlib.util.find_spec("explorer.notion") is None
    src = Path(__file__).resolve().parents[1] / "src" / "explorer"
    for p in src.rglob("*.py"):
        text = p.read_text(encoding="utf-8").lower()
        assert "api.notion.com" not in text and "notion.key" not in text and "notion_api_version" not in text, p


# ---- a new user's first minute: the family started before the dashboard ------------------------------------------

def test_a_fresh_member_started_before_the_dashboard_rests_then_wakes_by_itself(cfg, tmp_path, monkeypatch, caplog):
    """No crash loop, no write recorded that never landed, and no 30-minute idle nap on an 'empty' list it could not
    read: the member rests on "board down" with the plain reason and carries on once the dashboard answers."""
    import logging
    import threading

    monkeypatch.setattr(board_down, "PROBE_SECONDS", 0.3)
    flag = tmp_path / "board-down.json"
    state = {"up": False, "calls": 0}

    def dashboard(req: httpx.Request) -> httpx.Response:
        state["calls"] += 1
        if not state["up"]:
            raise httpx.ConnectError("Connection refused", request=req)
        if req.url.path == "/v1/boards/leads/rows":
            return httpx.Response(200, json={"leads": [{"id": "a" * 32, "business": "Corner Bakery", "website": "https://corner.example",
                                                        "package": "", "rev": 1}], "next": 1, "more": False})
        return httpx.Response(200, json={"tasks": [], "next": 0, "more": False})

    http = httpx.Client(base_url="http://127.0.0.1:3000", transport=httpx.MockTransport(dashboard))
    # The CEO's shape: tasks, packages and a decide list read off the Leads board.
    cfg.agent.idle_when_empty = True
    cfg.tasks.enabled = cfg.packages.enabled = True
    cfg.leads.enabled = True
    cfg.leads.update_any_row, cfg.leads.update_only_fields = True, ["how_we_help"]
    cfg.leads.decide_glob = "leads-need-package*.md"
    leads = PortalLeadStore("http://127.0.0.1:3000", "k", "The CEO", http=http, down_flag=flag)
    board = PortalBoard("http://127.0.0.1:3000", "k", "The CEO", http=http, down_flag=flag)
    c = make_controller(cfg, board=board, leads_board=leads)
    with pytest.raises(BoardError):
        leads.refresh(force=True)                 # the first read at start: the dashboard is not running
    assert board_down.read(flag)
    caplog.set_level(logging.INFO)
    out: dict = {}
    t = threading.Thread(target=lambda: out.setdefault("rc", c.run(max_cycles=1)), daemon=True)
    t.start()
    time.sleep(1.2)
    assert t.is_alive() and "rc" not in out                      # resting, not crashed and not finished
    rests = [r for r in caplog.records if "board_down_rest" in r.getMessage()]
    assert rests and not any("resting" in r.getMessage() and "work list is empty" in r.getMessage() for r in caplog.records)
    assert c.memory.db.scalar("SELECT COUNT(*) FROM actions", default=0) == 0      # nothing done, nothing counted
    probes_while_down = state["calls"]
    assert probes_while_down <= 8                                # about one probe per PROBE_SECONDS, never a tight loop
    state["up"] = True                                           # the user starts the dashboard
    t.join(timeout=20)
    assert not t.is_alive() and out.get("rc") is not None        # it woke by itself and worked a cycle
    assert not board_down.read(flag)
    assert any("board_back" in r.getMessage() for r in caplog.records)


def test_a_writer_added_to_a_starter_gets_a_draft_queue_from_the_board_as_shipped(cfg):
    """The board has no Stage field: with the shipped default (draft_queue_stage = "") every row without a draft is
    the Writer's work, best first; with "New" (the old default) the queue was always empty."""
    rows = [{"id": "a" * 32, "business": "Corner Bakery", "website": "https://corner.example", "package": "Starter Website",
             "pain_point": "No online menu", "draft_email": None, "rev": 1, "created_at": "2026-11-16T10:00:00"},
            {"id": "b" * 32, "business": "Done Deli", "website": "https://done.example", "draft_email": "Hi team", "rev": 2}]
    http = httpx.Client(base_url="http://127.0.0.1:3000", transport=httpx.MockTransport(
        lambda r: httpx.Response(200, json={"leads": rows, "next": 2, "more": False})))
    cfg.leads.enabled = True
    cfg.leads.draft_queue_column = "Draft email"
    assert cfg.leads.draft_queue_stage == ""
    c = make_controller(cfg, leads_board=PortalLeadStore("http://127.0.0.1:3000", "k", "Outreach Writer", http=http))
    text = "\n".join(c._draft_queue_lines())
    assert "Corner Bakery" in text and "Done Deli" not in text
