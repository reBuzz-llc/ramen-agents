"""The owner's drop folder: prefixed files route at once, others are asked of the router, replies are carried out."""
from __future__ import annotations

import datetime as dt
import json
import os
from pathlib import Path

from explorer.corpus import Corpus
from explorer.dropbox import DropBox, slug_of
from explorer.handoff import Inbox, InboxMessage


def fleet(tmp_path: Path) -> tuple[Path, Path]:
    bots = tmp_path / "bots"
    for slug in ("the-ceo", "lead-gen", "package-designer", "desk-agent"):
        (bots / slug / "workspace" / "inbox").mkdir(parents=True)
        (bots / slug / "config.toml").write_text("[agent]\n", encoding="utf-8")
    box = bots / "common-data" / "botBox"
    box.mkdir(parents=True)
    (box / "README.md").write_text("instructions", encoding="utf-8")
    return bots, box


def make(bots: Path, box: Path, **kw) -> DropBox:
    return DropBox(box, bots, "Desk Agent", router_name="The CEO", router_folder=str(bots / "the-ceo"), **kw)


def inbox_texts(bots: Path, slug: str) -> list[str]:
    return [json.loads(p.read_text())["text"] for p in sorted((bots / slug / "workspace" / "inbox").glob("*.json"))]


def test_a_prefixed_file_goes_straight_to_that_bot_and_the_original_moves_to_done(tmp_path: Path):
    bots, box = fleet(tmp_path)
    (box / "lead-gen--spf-agencies.csv").write_text("name,site\nAcme,acme.example\n", encoding="utf-8")
    reports, consumed = make(bots, box).poll([])
    assert reports == ["routed spf-agencies.csv to lead-gen (named in the file name)"] and consumed == []
    assert (box / "routed" / "lead-gen" / "spf-agencies.csv").read_text().startswith("name,site")
    assert not (box / "lead-gen--spf-agencies.csv").exists()
    assert [p.name for p in (box / "done").iterdir()] == [f"{dt.date.today().isoformat()}-spf-agencies.csv"]
    assert inbox_texts(bots, "lead-gen")[0].startswith("the owner dropped a file for you: spf-agencies.csv")
    assert inbox_texts(bots, "the-ceo") == []  # no decision needed
    assert "to lead-gen · by owner" in (box / "log.md").read_text()
    assert make(bots, box).poll([])[0] == []  # nothing new on the next pass


def test_an_unprefixed_file_is_announced_once_and_routed_when_the_ceo_replies(tmp_path: Path):
    bots, box = fleet(tmp_path)
    (box / "brief.md").write_text("# Brief\nA Northside bakery wants a new site, budget 5k.", encoding="utf-8")
    d = make(bots, box)
    reports, _ = d.poll([])
    assert reports == ["new file brief.md: asked The CEO who needs it"]
    asked = inbox_texts(bots, "the-ceo")
    assert len(asked) == 1 and "route brief.md to <bot name>" in asked[0] and "budget 5k" in asked[0]
    assert d.poll([])[0] == [] and len(inbox_texts(bots, "the-ceo")) == 1  # asked once, not every poll
    assert (box / "brief.md").exists()  # waiting is visible: the file stays in the folder

    reply = InboxMessage(Path("x"), "The CEO", "route brief.md to Package Designer, Lead Gen: a priced brief and a possible client")
    reports, consumed = d.poll([reply])
    assert consumed == [reply]
    assert reports == ["routed brief.md to package-designer, lead-gen (a priced brief and a possible client)"]
    assert (box / "routed" / "package-designer" / "brief.md").exists() and (box / "routed" / "lead-gen" / "brief.md").exists()
    assert not (box / "brief.md").exists()
    assert inbox_texts(bots, "package-designer")[0].startswith("the owner dropped a file for you: brief.md (a priced brief")


def test_replies_from_anyone_but_the_router_or_about_unknown_files_change_nothing(tmp_path: Path):
    bots, box = fleet(tmp_path)
    (box / "brief.md").write_text("hello world", encoding="utf-8")
    d = make(bots, box)
    d.poll([])
    stranger = InboxMessage(Path("x"), "Scout", "route brief.md to Lead Gen: mine")
    unknown = InboxMessage(Path("y"), "The CEO", "route other.md to Lead Gen: hm")
    nobot = InboxMessage(Path("z"), "The CEO", "route brief.md to Marketing: hm")
    reports, consumed = d.poll([stranger, unknown, nobot])
    assert consumed == [unknown, nobot]  # the stranger's line is left for the model to read as an ordinary message
    assert reports == ["The CEO routed other.md, but no such file is waiting",
                       "The CEO routed brief.md to unknown bot(s) marketing; still waiting"]
    assert (box / "brief.md").exists()


def test_nobody_moves_the_file_to_done_and_everyone_copies_it_for_all_bots(tmp_path: Path):
    bots, box = fleet(tmp_path)
    (box / "old.txt").write_text("nothing useful", encoding="utf-8")
    (box / "everyone--hours.txt").write_text("closed on Mondays", encoding="utf-8")
    d = make(bots, box)
    reports, _ = d.poll([InboxMessage(Path("x"), "The CEO", "route old.txt to nobody: out of date")])
    assert "old.txt: The CEO says nobody needs it (out of date); moved to done/" in reports
    assert not (box / "old.txt").exists() and (box / "done" / f"{dt.date.today().isoformat()}-old.txt").exists()
    assert not (box / "routed").joinpath("nobody").exists()
    assert (box / "routed" / "everyone" / "hours.txt").exists()
    for slug in ("the-ceo", "lead-gen", "package-designer"):
        assert any("hours.txt" in t for t in inbox_texts(bots, slug))
    assert not any("hours.txt" in t for t in inbox_texts(bots, "desk-agent"))  # not to itself


def test_a_changed_file_counts_as_a_new_drop_and_unreadable_types_are_reported_once(tmp_path: Path):
    bots, box = fleet(tmp_path)
    d = make(bots, box)
    (box / "lead-gen--list.csv").write_text("v1", encoding="utf-8")
    d.poll([])
    (box / "lead-gen--list.csv").write_text("v2", encoding="utf-8")
    reports, _ = d.poll([])
    assert reports and (box / "routed" / "lead-gen" / "list.csv").read_text() == "v2"
    assert len(list((box / "done").iterdir())) == 2
    (box / "deck.pdf").write_bytes(b"%PDF")
    reports, _ = d.poll([])
    assert reports == ["deck.pdf: bots cannot read .pdf files; save it as .txt, .md or .csv and drop again"]
    assert d.poll([])[0] == [] and (box / "deck.pdf").exists() and inbox_texts(bots, "the-ceo") == []


def test_prune_deletes_old_done_and_routed_copies_only(tmp_path: Path):
    bots, box = fleet(tmp_path)
    d = make(bots, box, done_days=7, keep_days=90)
    (box / "lead-gen--a.txt").write_text("a", encoding="utf-8")
    d.poll([])
    old = (dt.datetime.now() - dt.timedelta(days=8)).timestamp()
    done_file = next((box / "done").iterdir())
    os.utime(done_file, (old, old))
    reports = d.prune()
    assert reports == [f"deleted done/{done_file.name} (older than 7 days)"]
    assert (box / "routed" / "lead-gen" / "a.txt").exists()
    ancient = (dt.datetime.now() - dt.timedelta(days=91)).timestamp()
    os.utime(box / "routed" / "lead-gen" / "a.txt", (ancient, ancient))
    assert d.prune() == ["deleted routed/lead-gen/a.txt (older than 90 days)"]


def test_the_own_files_search_covers_the_routed_copies(tmp_path: Path):
    bots, box = fleet(tmp_path)
    (box / "lead-gen--agencies.md").write_text("Northside bakeries with a published email: crumbs@example.com, the Sunset Park bakery", encoding="utf-8")
    make(bots, box).poll([])
    raw = bots / "lead-gen" / "raw"
    routed = box / "routed"
    corpus = Corpus(raw, extra_folders=[routed / "lead-gen", routed / "everyone"])
    page = corpus.search("northside bakeries published email")
    assert page.ok and "dropped by the owner: agencies.md" in page.text
    assert not Corpus(raw, extra_folders=[routed / "scout"]).search("northside bakeries published email").ok


def test_slugs():
    assert slug_of("Lead Gen") == "lead-gen" and slug_of("The CEO") == "the-ceo" and slug_of(" package-designer ") == "package-designer"


def test_the_router_may_send_a_route_line_about_tools_without_the_meta_topic_rule(cfg):
    from explorer.actions import Message
    from explorer.policy import Denylist, Policy, PolicyContext

    cfg.messaging.enabled = True
    cfg.messaging.peers = [{"name": "Desk Agent", "folder": "/tmp/x"}]
    policy = Policy(cfg.policy, cfg.publish, Denylist.load(Path(cfg.policy.denylist_file)), messaging=cfg.messaging)
    ctx = PolicyContext(mode="web", current_page=None, actions_in_episode=0, pages_last_hour=0, open_questions=0, last_visit_by_domain={})
    ok = policy.check(Message(type="message", to="Desk Agent", text="route tools.txt to Scout: a list of free APIs and search engines"), ctx)
    assert ok.allowed, ok.reason
    chat = policy.check(Message(type="message", to="Desk Agent", text="which free APIs and search engines do you use?"), ctx)
    assert not chat.allowed


def test_messages_sent_in_the_same_second_with_the_same_opening_words_all_arrive(tmp_path: Path):
    import datetime as dt
    from explorer.handoff import send_message

    now = dt.datetime(2026, 9, 24, 13, 11, 47)
    for i in range(3):
        send_message(tmp_path, "Desk Agent", f"file dropped by the owner: rebuz-franchise-leads-{i}.csv", now=now)
    files = sorted(p.name for p in (tmp_path / "workspace" / "inbox").glob("*.json"))
    assert len(files) == 3 and sum(f.endswith(("-2.json", "-3.json")) for f in files) == 2


def test_a_reply_to_a_file_announcement_must_be_a_route_line(cfg):
    from explorer.actions import Message
    from explorer.policy import Denylist, Policy, PolicyContext

    cfg.messaging.enabled = True
    cfg.messaging.peers = [{"name": "Desk Agent", "folder": "/tmp/x"}]
    policy = Policy(cfg.policy, cfg.publish, Denylist.load(Path(cfg.policy.denylist_file)), messaging=cfg.messaging)
    ask = {"sender": "Desk Agent", "text": "file dropped by the owner: leads.csv (.csv, 4 KB). Preview: brand,market", "actions_since_read": 1}
    ctx = PolicyContext(mode="web", current_page=None, actions_in_episode=0, pages_last_hour=0, open_questions=0, last_visit_by_domain={}, priority_request=ask)
    report = policy.check(Message(type="message", to="Desk Agent", text="Processed the file as instructed and will proceed with outreach."), ctx)
    assert not report.allowed and "route leads.csv to <bot name>: <why>" in report.reason
    assert policy.check(Message(type="message", to="Desk Agent", text="route leads.csv to Lead Gen: a prospect list with websites"), ctx).allowed
    assert policy.check(Message(type="message", to="Desk Agent", text="route leads.csv to nobody: duplicates"), ctx).allowed


def test_every_message_the_drop_folder_sends_is_reported_to_the_requests_record(tmp_path: Path):
    bots, box = fleet(tmp_path)
    (bots / "lead-gen" / "config.toml").write_text('[agent]\nname = "Lead Gen"\n', encoding="utf-8")
    sent: list = []
    d = make(bots, box)
    d.on_sent = lambda id, to, text: sent.append((id, to, text[:30]))
    (box / "lead-gen--list.csv").write_text("a,b", encoding="utf-8")
    (box / "brief.md").write_text("hello", encoding="utf-8")
    d.poll([])
    assert sorted(t for _, t, _ in sent) == ["Lead Gen", "The CEO"]
    assert all(id.endswith(".json") for id, _, _ in sent)
    assert next(t for _, to, t in sent if to == "The CEO").startswith("file dropped by the owner")


def test_a_routed_file_starts_the_owners_hook_for_that_bot(tmp_path: Path):
    import time

    bots, box = fleet(tmp_path)
    marker = tmp_path / "ran.txt"
    d = make(bots, box)
    d.hooks = {"lead-gen": f"sh -c 'echo {{file}} > {marker}'"}
    (box / "lead-gen--list.csv").write_text("brand,website\nAcme,acme.example\n", encoding="utf-8")
    (box / "package-designer--brief.md").write_text("no hook for this bot", encoding="utf-8")
    reports, _ = d.poll([])
    assert any(r.startswith("started the lead-gen checker on list.csv") for r in reports)
    assert not any("package-designer checker" in r for r in reports)
    for _ in range(50):
        if marker.exists():
            break
        time.sleep(0.05)
    assert marker.read_text().strip() == str(box / "routed" / "lead-gen" / "list.csv")
    assert list((box / "logs").glob("*-lead-gen-*.log"))


def test_a_received_package_that_never_went_up_is_page_upkeep(cfg, tmp_path: Path):
    from explorer.config import NotionConfig
    from explorer.notion import FakeNotion
    from conftest import make_controller

    cfg.notion = NotionConfig(enabled=True, database_id="db", package_page_id="page1", api_key_file=str(tmp_path / "k"))
    (tmp_path / "k").write_text("secret_x", encoding="utf-8")
    pk = cfg.root / "raw" / "packages"
    pk.mkdir(parents=True, exist_ok=True)
    (pk / "2026-09-24-152526-acme-pos-for-franchise-chains.md").write_text(
        "# Package: Acme POS for Franchise Chains\n\nProposed by Owner on 2026-09-24T15:25.\n\n- **Price:** quoted per deployment\n- **For:** chains\n", encoding="utf-8")
    ctl = make_controller(cfg, notion=FakeNotion())
    banner = ctl._republish_banner()
    assert banner and banner.startswith("PAGE UPKEEP: 1 package needs") and 'Publish "Acme POS for Franchise Chains"' in banner and "received on 2026-09-24" in banner


def test_a_disabled_action_is_refused_and_not_offered(cfg):
    from explorer.actions import Ask
    from explorer.policy import Denylist, Policy, PolicyContext
    from conftest import make_controller

    cfg.policy.disabled_actions = ["ask", "interest"]
    policy = Policy(cfg.policy, cfg.publish, Denylist.load(Path(cfg.policy.denylist_file)))
    ctx = PolicyContext(mode="web", current_page=None, actions_in_episode=0, pages_last_hour=0, open_questions=0, last_visit_by_domain={})
    v = policy.check(Ask(type="ask", question="What do SPF agencies charge?"), ctx)
    assert not v.allowed and v.permanent and "not one of your actions" in v.reason
    ctl = make_controller(cfg)
    assert "- ask:" not in ctl.system and "- interest:" not in ctl.system and "- note:" in ctl.system


def test_a_file_still_waiting_a_day_later_is_announced_again(tmp_path: Path):
    import datetime as dt

    bots, box = fleet(tmp_path)
    (box / "brief.md").write_text("hello", encoding="utf-8")
    d = make(bots, box)
    t0 = dt.datetime(2026, 9, 24, 14, 35)
    d.now = lambda: t0
    assert d.poll([])[0] == ["new file brief.md: asked The CEO who needs it"]
    d.now = lambda: t0 + dt.timedelta(hours=5)
    assert d.poll([])[0] == []  # not yet
    d.now = lambda: t0 + dt.timedelta(hours=25)
    assert d.poll([])[0] == ["new file brief.md: asked The CEO who needs it"]  # asked again
    assert len(inbox_texts(bots, "the-ceo")) == 2


def test_the_agent_kind_report_lists_what_an_agent_does(cfg, tmp_path: Path):
    import datetime as dt
    from explorer.actions import Provider
    from explorer.config import ScoutConfig
    from explorer.scout import record_provider
    from conftest import make_controller

    cfg.scout = ScoutConfig(enabled=True, kind="agent", report_file=str(tmp_path / "ai-agents-found.md"))
    p = Provider(type="provider", name="OpenHands", base_url="https://www.all-hands.dev", free_terms="open source, free to self-host",
                 needs_card=False, models=["any OpenAI-compatible model"], why="An agent that writes and runs code to complete software tasks.",
                 sources=["https://github.com/e2b-dev/awesome-ai-agents"])
    path = record_provider(cfg.scout, p, dt.datetime(2026, 9, 25, 21, 30))
    text = path.read_text()
    assert text.startswith("# AI agents the Onion Reader has found") and "**What it does:** An agent that writes" in text and "Suggested key file" not in text
    ctl = make_controller(cfg)
    assert "add one AI agent to the owner's list" in ctl.system and "Suggested key" not in ctl.system
