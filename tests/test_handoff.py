"""Package Designer → The CEO: a package action writes a file and an inbox message; the recipient sees it once."""
from __future__ import annotations

import json
from pathlib import Path

from explorer import fleet
from explorer.actions import Decision, Package, Say
from explorer.config import HandoffConfig, PolicyConfig, PublishConfig, load_config
from explorer.handoff import Inbox, send_package
from explorer.model import ModelResult
from explorer.policy import Denylist, Policy, PolicyContext

from conftest import make_controller


def package(**over) -> Package:
    spec = dict(
        type="package", name="MVP Launch Starter", audience="pre-seed founders in Springfield with a validated idea",
        price="$6,500 fixed", deliverables=["Clickable prototype", "Web MVP with auth and payments", "Launch checklist"],
        timeline="8 weeks", rationale="SPF agencies list $25k+ MVPs; productized studios sell 8-week MVPs for $5-10k.",
        sources=["https://example.com/pricing"],
        source_company={"name": "Example Studio", "website": "https://example.com"},
    )
    spec.update(over)
    return Package(**spec)


def ctx(**over) -> PolicyContext:
    base = dict(mode="web", current_page=None, actions_in_episode=0, pages_last_hour=0, open_questions=0,
                last_visit_by_domain={}, visited_urls={"https://example.com/pricing"})
    base.update(over)
    return PolicyContext(**base)


def test_policy_requires_evidence_a_price_and_rarity():
    off = Policy(PolicyConfig(), PublishConfig(), Denylist())
    assert "not enabled" in off.check(package(), ctx()).reason
    policy = Policy(PolicyConfig(), PublishConfig(), Denylist(),
                    handoff=HandoffConfig(enabled=True, to_name="The CEO", to_folder="/tmp/x", max_per_day=2))
    assert policy.check(package(), ctx()).allowed
    assert "real figure" in policy.check(package(price="competitive"), ctx()).reason
    assert "two concrete deliverables" in policy.check(package(deliverables=["An app"]), ctx()).reason
    assert "http(s)" in policy.check(package(sources=["my notes"]), ctx()).reason
    unread = policy.check(package(sources=["https://never-opened.example/"]), ctx())
    assert not unread.allowed and "actually opened" in unread.reason
    dup = policy.check(package(), ctx(recent_package_names={"mvp launch starter"}))
    assert not dup.allowed and dup.permanent
    # Re-versioning the same package (v2/v3) is caught as the same offer; a different service is not.
    reversioned = policy.check(package(name="MVP Launch Starter v2"), ctx(recent_package_names={"mvp launch starter"}))
    assert not reversioned.allowed and reversioned.permanent and "different service" in reversioned.reason
    assert policy.check(package(name="Marketing Retainer"), ctx(recent_package_names={"mvp launch starter"})).allowed
    assert "this episode" in policy.check(package(), ctx(packages_in_episode=1)).reason
    assert "daily limit" in policy.check(package(), ctx(packages_today=2)).reason
    assert "own tools" in policy.check(package(name="Rate limit bypass bundle"), ctx()).reason


def test_policy_wants_the_agency_pages_it_read_and_the_company_behind_them():
    """Plan 9: a search-results page and the seller's own site are not sources; every source must have been
    opened; the source company must be named and be the site of one of the sources."""
    policy = Policy(PolicyConfig(), PublishConfig(), Denylist(),
                    handoff=HandoffConfig(enabled=True, to_name="The CEO", to_folder="/tmp/x",
                                          own_domains=["acme.example"]))
    read = {"https://example.com/pricing", "https://example.com/about", "https://hn.algolia.com/?q=mvp+pricing",
            "https://acme.example/"}
    assert policy.check(package(sources=["https://example.com/pricing", "https://example.com/about"]), ctx(visited_urls=read)).allowed
    own = policy.check(package(sources=["https://example.com/pricing", "https://acme.example/"]), ctx(visited_urls=read))
    assert not own.allowed and "own company" in own.reason
    searchy = policy.check(package(sources=["https://example.com/pricing", "https://hn.algolia.com/?q=mvp+pricing"]), ctx(visited_urls=read))
    assert not searchy.allowed and "search-results" in searchy.reason
    # Every source must be opened, and the refusal names what it did read (third-party pages only).
    partly = policy.check(package(sources=["https://example.com/pricing", "https://other.example/plans"]), ctx(visited_urls=read))
    assert not partly.allowed and "did not open: https://other.example/plans" in partly.reason
    assert "https://example.com/pricing" in partly.reason and "hn.algolia" not in partly.reason and "acmestudio" not in partly.reason
    # The company behind the sources is required, and must be one of them.
    nameless = policy.check(package(source_company={"name": "", "website": ""}), ctx())
    assert not nameless.allowed and "name and website" in nameless.reason
    elsewhere = policy.check(package(source_company={"name": "Other Co", "website": "https://other.example"}), ctx())
    assert not elsewhere.allowed and "one of your sources" in elsewhere.reason


def test_search_results_urls_are_recognised():
    from explorer.policy import is_search_results_url, url_domain
    assert is_search_results_url("https://hn.algolia.com/?q=mvp+pricing")
    assert is_search_results_url("http://127.0.0.1:8888/search?q=agency+pricing")
    assert is_search_results_url("https://duckduckgo.com/?q=x")
    assert not is_search_results_url("https://speedmvps.com/mvp-development-cost")
    assert not is_search_results_url("https://agency.example/pricing?plan=starter")
    assert url_domain("https://www.Example.com/x?y=1") == "example.com"


def test_send_package_writes_the_file_and_the_message_and_the_recipient_reads_it_once(tmp_path: Path):
    from explorer.actions import SourceCompany

    ceo = tmp_path / "the-ceo"
    cfg = HandoffConfig(enabled=True, to_name="The CEO", to_folder=str(ceo))
    pkg = package(source_company=SourceCompany(name="SpeedMVPs", founded="2019", location="Springfield, USA",
                                               website="https://speedmvps.example", valuation=""))
    pkg_file, msg_file = send_package(cfg, "Package Designer", pkg)
    assert pkg_file.parent == ceo / "raw" / "packages"
    text = pkg_file.read_text()
    assert text.startswith("# Package: MVP Launch Starter") and "**Price:** $6,500 fixed" in text
    assert "- Web MVP with auth and payments" in text and "https://example.com/pricing" in text
    # Source company: only the facts that were set appear; the blank valuation is omitted.
    assert "## Source company" in text and "**Company:** SpeedMVPs" in text and "**Founded:** 2019" in text
    assert "https://speedmvps.example" in text and "Valuation" not in text
    message = json.loads(msg_file.read_text())
    assert message["from"] == "Package Designer" and message["kind"] == "package"
    assert "$6,500 fixed" in message["text"] and message["file"].startswith("raw/packages/")

    inbox = Inbox(ceo / "workspace")
    unread = inbox.unread()
    assert [m.sender for m in unread] == ["Package Designer"]
    assert unread[0].render().startswith('From Package Designer: new package "MVP Launch Starter" at $6,500 fixed')
    inbox.mark_seen(unread)
    assert inbox.unread() == [] and (ceo / "workspace" / "inbox" / "done" / msg_file.name).exists()
    (ceo / "workspace" / "inbox" / "broken.json").write_text("{not json")
    assert inbox.unread() == [] and (ceo / "workspace" / "inbox" / "broken" / "broken.json").exists()


class Designer:
    """Opens the pricing page, then hands over the package."""

    def __init__(self):
        self.step = 0

    def decide(self, system, obs):
        self.step += 1
        from explorer.actions import Open

        action = Open(type="open", url="fake://tides.html") if self.step == 1 else package(sources=["fake://tides.html"], source_company={"name": "Tides", "website": "fake://tides.html"})
        return ModelResult(decision=Decision(thought="design", action=action))

    def complete(self, system, prompt):
        return "summary"


def test_designer_hands_a_package_and_the_ceo_sees_it_on_its_next_step(cfg, tmp_path: Path):
    ceo_folder = tmp_path / "the-ceo"
    cfg.agent.name = "Package Designer"
    cfg.agent.mode = "fake"
    cfg.handoff = HandoffConfig(enabled=True, to_name="The CEO", to_folder=str(ceo_folder))
    designer = make_controller(cfg, model=Designer())
    assert "package:" in designer.system and "hand one service package to The CEO" in designer.system
    designer.run(max_cycles=2)
    rows = designer.memory.db.query("SELECT action_type, verdict, result FROM actions ORDER BY id")
    assert [(r["action_type"], r["verdict"]) for r in rows] == [("open", "allowed"), ("package", "allowed")]
    assert list((ceo_folder / "raw" / "packages").glob("*.md"))
    assert designer.memory.recent_package_names() == {"mvp launch starter"}

    # The CEO: a separate bot with its own workspace, reading its inbox.
    from explorer.config import Config

    ceo_cfg = Config(root=ceo_folder)
    for key in ("cycle_delay_seconds", "seed_interests"):
        setattr(ceo_cfg.agent, key, getattr(cfg.agent, key))
    ceo_cfg.agent.name = "The CEO"
    ceo_cfg.browser.fake_web_dir = cfg.browser.fake_web_dir
    ceo_cfg.policy.denylist_file = cfg.policy.denylist_file
    ceo_cfg.watchdog.heartbeat_interval_seconds = 0
    ceo_cfg.quiet.enabled = False
    ceo_cfg.ensure_dirs()
    seen: list[str] = []

    class CEO:
        def decide(self, system, obs):
            seen.append(obs.render())
            return ModelResult(decision=Decision(thought="ok", action=Say(type="say", text="Got the package.")))

        def complete(self, system, prompt):
            return "summary"

    ceo = make_controller(ceo_cfg, model=CEO())
    ceo.run(max_cycles=2)
    assert "Messages from your colleagues" in seen[0] and 'From Package Designer: new package "MVP Launch Starter"' in seen[0]
    assert "From Package Designer" not in seen[1]  # shown once, then filed under inbox/done


def test_output_banner_pushes_a_producer_overdue_on_output(cfg, tmp_path: Path):
    """A bot whose job is to hand over packages is reminded, every cycle, once it has gone a couple of
    episodes without producing one -- results are the point, not endless research."""
    cfg.handoff = HandoffConfig(enabled=True, to_name="The CEO", to_folder=str(tmp_path / "the-ceo"))
    c = make_controller(cfg)
    assert c._output_banner() is None  # no finished episodes yet, nothing overdue
    for _ in range(2):
        c.memory.end_episode(c.memory.start_episode(), "done")
    banner = c._output_banner()
    assert banner and "RESULTS MATTER" in banner and "package" in banner


def test_package_designer_persona_writes_a_handoff_section(tmp_path: Path):
    folder = fleet.new_bot("Package Designer", tmp_path / "bots", persona="package-designer", port=8790)
    text = (folder / "config.toml").read_text()
    assert "[handoff]" in text and "enabled = false" in text
    cfg = load_config(folder / "config.toml")
    assert cfg.handoff.enabled is False and cfg.handoff.files_dir == "raw/packages"
    assert (folder / "persona.md").read_text().startswith("You are the package designer")


def test_find_package_falls_back_to_the_package_file(tmp_path: Path):
    """Older inbox messages carry no "package" dict; the CEO still finds the package in raw/packages/*.md."""
    from explorer.actions import SourceCompany
    from explorer.handoff import find_package

    ceo = tmp_path / "the-ceo"
    cfg = HandoffConfig(enabled=True, to_name="The CEO", to_folder=str(ceo))
    pkg = package(source_company=SourceCompany(name="Example Studio", website="https://example.com", founded="2019",
                                               history="A Northside studio that has shipped 40 MVPs."))
    _, msg_file = send_package(cfg, "Package Designer", pkg)
    data = json.loads(msg_file.read_text()); data.pop("package", None); msg_file.write_text(json.dumps(data))
    found = find_package(ceo / "workspace", "mvp launch starter")
    assert found and found["price"] == "$6,500 fixed" and found["deliverables"][1] == "Web MVP with auth and payments"
    assert found["sources"] == ["https://example.com/pricing"] and found["rationale"].startswith("SPF agencies")
    assert found["source_company"]["name"] == "Example Studio" and found["source_company"]["founded"] == "2019"
    assert found["source_company"]["history"].startswith("A Northside studio") and found["source_company"]["valuation"] == ""
    assert find_package(ceo / "workspace", "no such package") is None
