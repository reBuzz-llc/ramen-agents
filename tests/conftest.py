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
from explorer.publish import Publisher

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
    cfg: Config, model=None, browser=None, desktop=None, chat_partner=None, developer=None, quiet=None, notion=None,
    searcher=None, transcripts=None, leads_notion=None,
) -> Controller:
    db = Database(cfg.db_path)
    memory = Memory(db, cfg.workspace)
    policy = Policy(
        cfg.policy,
        cfg.publish,
        Denylist.load(Path(cfg.policy.denylist_file)),
        desktop=cfg.desktop,
        chat_partner=cfg.chat_partner,
        developer=cfg.developer,
        developer_root=cfg.path(cfg.developer.root),
        notion=cfg.notion,
        handoff=cfg.handoff,
        scout=cfg.scout,
        messaging=cfg.messaging,
        self_goals=cfg.agent.self_goals,
        propose_teammates=cfg.agent.propose_teammates,
        leads=cfg.leads,
    )
    heartbeat = Heartbeat(db, cfg.watchdog)
    publisher = Publisher(cfg.publish, cfg.root, cfg.agent.name, cfg.agent.bio)
    logger = logging.getLogger("explorer.test")
    return Controller(
        cfg,
        memory,
        model or FakeModel(),
        browser or FakeBrowser(FAKE_WEB),
        policy,
        heartbeat,
        publisher,
        logger,
        desktop=desktop,
        chat_partner=chat_partner,
        developer=developer,
        quiet=quiet,
        notion=notion,
        searcher=searcher,
        transcripts=transcripts,
        leads_notion=leads_notion,
    )


@pytest.fixture
def controller(cfg: Config) -> Controller:
    return make_controller(cfg)
