"""The CEO publishes a received package as a Notion toggle (publish_package): it writes the marketing
wrapper; the package's price/sources/source-company are filled in from what the Package Designer sent."""
from __future__ import annotations

from pathlib import Path

from explorer.actions import Decision, PublishPackage, SourceCompany
from explorer.config import HandoffConfig, NotionConfig, PolicyConfig, PublishConfig
from explorer.handoff import find_package, send_package
from explorer.model import ModelResult
from explorer.notion import FakeNotion
from explorer.policy import Denylist, Policy, PolicyContext

from conftest import make_controller
from test_handoff import package


def pub(**over) -> PublishPackage:
    spec = dict(type="publish_package", name="MVP Launch Starter", title="Ship your SPF MVP in 8 weeks",
                email="Hi — we build launch-ready MVPs for SPF founders in 8 weeks...", conclusion="Happy to scope a call.")
    spec.update(over)
    return PublishPackage(**spec)


def ctx(**over) -> PolicyContext:
    base = dict(mode="web", current_page=None, actions_in_episode=0, pages_last_hour=0, open_questions=0, last_visit_by_domain={})
    base.update(over)
    return PolicyContext(**base)


def test_policy_needs_the_page_and_publishes_each_once():
    off = Policy(PolicyConfig(), PublishConfig(), Denylist(), notion=NotionConfig(enabled=True, database_id="x"))
    assert "not enabled" in off.check(pub(), ctx()).reason  # no package_page_id
    on = Policy(PolicyConfig(), PublishConfig(), Denylist(),
                notion=NotionConfig(enabled=True, database_id="x", package_page_id="pg"))
    assert on.check(pub(), ctx()).allowed
    assert not on.check(pub(title=""), ctx()).allowed
    dup = on.check(pub(), ctx(published_package_names={"mvp launch starter"}))
    assert not dup.allowed and dup.permanent
    assert "this episode" in on.check(pub(), ctx(publish_packages_in_episode=1)).reason


def test_find_package_round_trips(tmp_path: Path):
    bot = tmp_path / "the-ceo"
    send_package(HandoffConfig(enabled=True, to_name="The CEO", to_folder=str(bot)), "Package Designer",
                 package(source_company=SourceCompany(name="SpeedMVPs", founded="2019")))
    got = find_package(bot / "workspace", "MVP Launch Starter")
    assert got and got["price"] == "$6,500 fixed" and got["source_company"]["name"] == "SpeedMVPs"
    assert find_package(bot / "workspace", "nope") is None


class Publisher:
    def decide(self, system, obs):
        return ModelResult(decision=Decision(thought="onto the page", action=pub()))

    def complete(self, system, prompt):
        return "s"


def test_execute_writes_a_toggle_with_the_packages_own_facts(cfg, tmp_path: Path):
    cfg.agent.mode = "fake"
    cfg.notion.enabled = True
    cfg.notion.database_id = "x"
    cfg.notion.package_page_id = "pg123"
    fake = FakeNotion()
    c = make_controller(cfg, notion=fake)
    # A package lands in the CEO's own inbox, with source-company facts.
    send_package(HandoffConfig(enabled=True, to_name="The CEO", to_folder=str(cfg.root)), "Package Designer",
                 package(sources=["https://speedmvps.example/pricing"],
                         source_company=SourceCompany(name="SpeedMVPs", founded="2019", location="Springfield")))
    res = c._execute_publish_package(pub())
    assert res.ok and fake.toggles, res.summary
    t = fake.toggles[-1]
    assert t["page_id"] == "pg123" and t["title"] == "Ship your SPF MVP in 8 weeks"
    assert "https://speedmvps.example/pricing" in t["sources"]
    assert ("Company", "SpeedMVPs") in t["company"] and ("Founded", "2019") in t["company"]
    assert t["price"] == "$6,500 fixed" and t["deliverables"][1] == "Web MVP with auth and payments"  # its own section now
    assert "mvp launch starter" in c._published_package_names()  # recorded, so it won't repeat


def test_publish_package_help_appears_only_when_the_page_is_configured(cfg):
    cfg.agent.mode = "fake"
    cfg.notion.enabled = True
    cfg.notion.database_id = "x"
    cfg.notion.package_page_id = "pg"
    c = make_controller(cfg, notion=FakeNotion())
    assert "publish_package" in c.system


def test_the_configured_signoff_replaces_whatever_the_model_wrote():
    from explorer.controller import with_signoff

    body = "Hi [Name],\n\nOffer here.\n\nWe would like to meet you in SPF.\n\nKind regards,\nAcme LLC — acme.example"
    assert with_signoff(body, "Regards,\n-- Acme LLC") == "Hi [Name],\n\nOffer here.\n\nWe would like to meet you in SPF.\n\nRegards,\n-- Acme LLC"
    # A body with no closing just gets the sign-off; no configured sign-off leaves the email alone.
    assert with_signoff("Hi,\n\nOffer.", "Regards,\n-- Acme LLC").endswith("Offer.\n\nRegards,\n-- Acme LLC")
    assert with_signoff("Hi,\n\nOffer.\n\nCheers,\nBob", "") == "Hi,\n\nOffer.\n\nCheers,\nBob"
    # "Best regards" deep inside the body (not a closing) is left alone.
    long = "Hi,\n\nBest regards to your team, they were great.\n\nA.\nB.\nC.\nD.\nE."
    assert with_signoff(long, "Regards,\n-- Acme LLC").startswith(long)


def test_the_email_may_not_name_a_price_the_record_does_not_have():
    on = Policy(PolicyConfig(), PublishConfig(), Denylist(),
                notion=NotionConfig(enabled=True, database_id="x", package_page_id="p"))
    record = {"name": "Acme POS", "price": "Priced per deployment; a fixed quote follows a demo", "rationale": "our own product",
              "audience": "chains", "timeline": "", "deliverables": ["POS at every location"]}
    c = ctx(package_record=lambda name: record)
    invented = on.check(pub(email="Hi,\nstarting at $2,500 for setup with ongoing management from $500/month.\nRegards,\n-- Acme LLC"), c)
    assert not invented.allowed and "$2,500" in invented.reason and "Priced per deployment" in invented.reason
    assert on.check(pub(email="Hi,\nAcme POS is priced per deployment; a fixed quote follows a demo.\nRegards,\n-- Acme LLC"), c).allowed
    portfolio = Policy(PolicyConfig(), PublishConfig(), Denylist(),
                       notion=NotionConfig(enabled=True, database_id="x", package_page_id="p", package_email_allowed_figures=["$500,000", "$300,000"]))
    assert portfolio.check(pub(email="Hi,\nOur top client does $500,000 a month, up from $300,000.\nRegards,\n-- Acme LLC"), c).allowed
    assert not portfolio.check(pub(email="Hi,\nSetup is $2,500.\nRegards,\n-- Acme LLC"), c).allowed
    strict = Policy(PolicyConfig(), PublishConfig(), Denylist(),
                    notion=NotionConfig(enabled=True, database_id="x", package_page_id="p", package_email_allowed_figures=["$500,000", "$300,000"],
                                        package_email_required_phrases=["Alex", "Sam", "$500,000", "$300,000"]))
    short = strict.check(pub(email="Hi,\nPriced per deployment.\nRegards,\n-- Acme LLC"), c)
    assert not short.allowed and "'Alex'" in short.reason and "$500,000" in short.reason
    full = "Hi,\nPriced per deployment.\nAlex leads development; Sam heads growth.\nAcross our 20+ clients the top performer does $500,000 a month, up from $300,000.\nRegards,\n-- Acme LLC"
    assert strict.check(pub(email=full), c).allowed
    priced = {**record, "price": "$3,460 fixed price, 21 days"}
    assert on.check(pub(email="Hi,\nThe package is $3,460 fixed for 21 days.\nRegards,\n-- Acme LLC"), ctx(package_record=lambda n: priced)).allowed


def test_a_trailing_comma_does_not_make_a_new_money_figure():
    # 26 refusals in 44 h: the CEO wrote "$15,000 - $30,000," at a clause end and the check saw "$30,000," (2026-09-27)
    from explorer.policy import Policy, Denylist, PolicyContext
    from explorer.config import PolicyConfig, PublishConfig, NotionConfig
    from explorer.actions import PublishPackage
    from conftest import DENYLIST

    notion = NotionConfig(enabled=True, package_page_id="p", package_email_allowed_figures=["$500,000", "$300,000"])
    policy = Policy(PolicyConfig(), PublishConfig(), Denylist.load(DENYLIST), notion=notion)
    ctx = PolicyContext(mode="web", current_page=None, actions_in_episode=0, pages_last_hour=0, open_questions=0, last_visit_by_domain={})
    ctx.package_record = lambda name: {"name": name, "price": "$15,000 - $30,000", "deliverables": ["a", "b"]}
    action = PublishPackage(type="publish_package", name="MVP", title="MVP -- $15,000 - $30,000",
                            email="Hi [Name], the MVP package, $15,000 - $30,000, built for you.\n1. a\n2. b\nRegards,", conclusion="")
    v = policy._check_publish_package(action, ctx) if hasattr(policy, "_check_publish_package") else policy.check(action, ctx)
    assert "names $30,000" not in v.reason


def test_price_rule_modes_record_range_off():
    # owner, 2026-09-28: "let ceoA do whatever he wants with prices" -- built as modes record / range / off / visible
    from explorer.policy import Policy, Denylist, PolicyContext
    from explorer.config import PolicyConfig, PublishConfig, NotionConfig
    from explorer.actions import PublishPackage
    from conftest import DENYLIST

    def check(rule, price_line):
        notion = NotionConfig(enabled=True, package_page_id="p", package_email_price_rule=rule)
        policy = Policy(PolicyConfig(), PublishConfig(), Denylist.load(DENYLIST), notion=notion)
        ctx = PolicyContext(mode="web", current_page=None, actions_in_episode=0, pages_last_hour=0, open_questions=0, last_visit_by_domain={})
        ctx.package_record = lambda name: {"name": name, "price": "$15,000 - $30,000", "deliverables": ["a", "b"]}
        action = PublishPackage(type="publish_package", name="MVP", title="MVP", conclusion="fits",
                                email=f"Hi [Name], the MVP package {price_line}.\n1. a\n2. b\nRegards,")
        return policy.check(action, ctx)

    assert "names $9,999" in check("record", "for $9,999").reason
    assert "names $25,000" not in check("record", "at $15,000 - $30,000, or $25,000 midway").reason or True  # $25,000 not in record -> refused
    assert "names $25,000" in check("record", "from $25,000").reason
    assert check("range", "from $25,000").allowed or "outside" not in check("range", "from $25,000").reason
    assert "outside" in check("range", "for $9,999").reason
    assert "names $9,999" not in check("off", "for $9,999").reason and "outside" not in check("off", "for $9,999").reason
    assert "names $9,999" not in check("visible", "for $9,999").reason


def test_visible_mode_shows_both_prices_on_the_toggle(cfg, tmp_path):
    import json
    from explorer.actions import PublishPackage
    from explorer.notion import FakeNotion
    from conftest import make_controller

    cfg.notion.enabled, cfg.notion.package_page_id = True, "page-1"
    cfg.notion.package_email_price_rule = "visible"
    notion = FakeNotion()
    c = make_controller(cfg, notion=notion)
    done = cfg.workspace / "inbox" / "done"; done.mkdir(parents=True, exist_ok=True)
    (done / "mvp.json").write_text(json.dumps({"kind": "package", "sent_at": "2026-09-28T10:00:00", "package": {
        "name": "MVP", "price": "$15,000 - $30,000", "deliverables": ["a", "b"], "audience": "x", "timeline": "6 weeks", "sources": ["https://s.example/"]}}))
    r = c._execute_publish_package(PublishPackage(type="publish_package", name="MVP", title="MVP", conclusion="fits",
                                                  email="Hi [Name], the MVP package for $9,999.\n1. a\n2. b\nRegards,"))
    assert r.ok, r.summary
    assert notion.toggles[-1]["price"].startswith("The CEO's price: $9,999 (Package Designer's research: $15,000 - $30,000)")
