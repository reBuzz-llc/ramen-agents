import logging
from pathlib import Path

import pytest

from explorer.browser import FakeBrowser
from explorer.config import Config
from explorer.controller import Controller
from explorer.db import Database
from explorer.heartbeat import Heartbeat
from explorer.memory import Memory
from explorer.model import FakeModel
from explorer.policy import Denylist, Policy

REPO = Path(__file__).resolve().parents[1]
FAKE_WEB = REPO / "workspace" / "fake_web"
DENYLIST = REPO / "workspace" / "denylist.txt"


@pytest.fixture
def cfg(tmp_path: Path) -> Config:
    cfg = Config(root=tmp_path)
    cfg.agent.cycle_delay_seconds = 0
    cfg.agent.seed_interests = ["tides", "lighthouses", "moss"]
    cfg.browser.fake_web_dir = str(FAKE_WEB)
    cfg.policy.denylist_file = str(DENYLIST)
    cfg.policy.max_actions_per_episode = 6
    cfg.watchdog.heartbeat_interval_seconds = 0
    cfg.watchdog.model_failure_backoff_seconds = 0
    cfg.quiet.enabled = False  # tests drive the loop directly; quiet mode has its own tests
    cfg.ensure_dirs()
    return cfg


def make_controller(
    cfg: Config, model=None, browser=None, chat_partner=None, developer=None, quiet=None, board=None,
    searcher=None, transcripts=None, leads_board=None,
) -> Controller:
    db = Database(cfg.db_path)
    memory = Memory(db, cfg.workspace)
    policy = Policy(
        cfg.policy,
        Denylist.load(Path(cfg.policy.denylist_file)),
        chat_partner=cfg.chat_partner,
        developer=cfg.developer,
        developer_root=cfg.path(cfg.developer.root),
        tasks=cfg.tasks,
        packages=cfg.packages,
        handoff=cfg.handoff,
        scout=cfg.scout,
        messaging=cfg.messaging,
        self_goals=cfg.agent.self_goals,
        propose_teammates=cfg.agent.propose_teammates,
        leads=cfg.leads,
    )
    heartbeat = Heartbeat(db, cfg.watchdog)
    logger = logging.getLogger("explorer.test")
    return Controller(
        cfg,
        memory,
        model or FakeModel(),
        browser or FakeBrowser(FAKE_WEB),
        policy,
        heartbeat,
        logger,
        chat_partner=chat_partner,
        developer=developer,
        quiet=quiet,
        board=board,
        searcher=searcher,
        transcripts=transcripts,
        leads_board=leads_board,
    )


@pytest.fixture
def controller(cfg: Config) -> Controller:
    return make_controller(cfg)


@pytest.fixture(autouse=True)
def _no_real_keys(tmp_path_factory, monkeypatch):
    """A test never sees the keys of the Mac it runs on: an empty folder unless the test sets its own."""
    monkeypatch.setenv("EXPLORER_KEYS_DIR", str(tmp_path_factory.mktemp("keys")))


@pytest.fixture(autouse=True)
def _mask_reads_no_live_board():
    """A test never reads a live lead cache through the mask; the pattern pass still runs."""
    from explorer.common import masking
    masking._set_known([])
    yield
    masking._reset_known()
