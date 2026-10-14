"""Lead Gen fixes its own Leads-board rows (update_lead) when the Validator or the owner reports a defect."""
from __future__ import annotations

from explorer.actions import Decision, Lead, Open, UpdateLead
from explorer.browser import PageView
from explorer.config import LeadsConfig, PolicyConfig, PublishConfig
from explorer.model import ModelResult
from explorer.notion import FakeNotion
from explorer.policy import Denylist, Policy, PolicyContext

from conftest import make_controller

SITE = "https://acmebakery.example"
CONTACT = SITE + "/contact"
ABOUT = SITE + "/about"
HOME_TEXT = "Acme Bakery. Northside's sourdough since 2009. Our website was last updated in 2016 and orders are by phone only."
CONTACT_TEXT = "Contact Acme Bakery: 122 Court St, Northside NY. Email hello@acmebakery.example or orders@acmebakery.example."
ABOUT_TEXT = "About Acme Bakery: a family business of twelve people in Carroll Gardens."


def upd(**over) -> UpdateLead:
    spec = dict(type="update_lead", name="Acme Bakery", evidence=CONTACT)
    spec.update(over)
    return UpdateLead(**spec)


def ctx(**over) -> PolicyContext:
    base = dict(mode="web", current_page=None, actions_in_episode=0, pages_last_hour=0, open_questions=0, last_visit_by_domain={},
                visited_urls={SITE, CONTACT, ABOUT}, recent_page_texts={SITE: HOME_TEXT, CONTACT: CONTACT_TEXT, ABOUT: ABOUT_TEXT},
                recent_lead_names={"acme bakery": "acmebakery.example"})
    base.update(over)
    return PolicyContext(**base)


def test_policy_only_fixes_the_bots_own_leads_with_grounded_changes():
    off = Policy(PolicyConfig(), PublishConfig(), Denylist())
    assert "not enabled" in off.check(upd(), ctx()).reason
    policy = Policy(PolicyConfig(), PublishConfig(), Denylist(), leads=LeadsConfig(enabled=True, database_id="ds"))
    assert policy.check(upd(), ctx()).allowed
    assert "lead you listed yourself" in policy.check(upd(name="Someone Else"), ctx()).reason
    assert "at least one change" in policy.check(upd(evidence=None), ctx()).reason
    # Changed fields obey the lead rules: email on the business's own domain AND on a page the bot opened.
    assert policy.check(upd(evidence=None, email="orders@acmebakery.example"), ctx()).allowed
    assert "does not appear on" in policy.check(upd(email="acmebakery@gmail.com"), ctx()).reason  # free-mail: same page proof; the gate judges the rest
    assert "does not appear on any page" in policy.check(upd(email="hello@other.example"), ctx()).reason  # another domain, not printed on the site
    assert "does not appear on any page" in policy.check(upd(email="owner@acmebakery.example"), ctx()).reason
    assert "actually opened" in policy.check(upd(evidence=SITE + "/never"), ctx()).reason
    assert "actually opened" in policy.check(upd(sources=["https://elsewhere.example/"]), ctx()).reason
    assert "http(s) address" in policy.check(upd(website="acmebakery.example"), ctx()).reason
    assert "own tools" in policy.check(upd(pain_point="Their site has a captcha rate limit problem"), ctx()).reason
    assert "fixed 2 leads this episode" in policy.check(upd(), ctx(lead_updates_in_episode=2)).reason
    assert policy.check(upd(evidence=None, size="12 people", location="Carroll Gardens, Northside"), ctx()).allowed
    # 0 = no cap, for listing and for fixing (owner, 2026-09-24: "remove caps from lead gen")
    free = Policy(PolicyConfig(), PublishConfig(), Denylist(), leads=LeadsConfig(enabled=True, database_id="ds", max_updates_per_episode=0))
    assert free.check(upd(), ctx(lead_updates_in_episode=50)).allowed


class SiteBrowser:
    pages = {SITE: PageView(url=SITE, title="Acme Bakery", text=HOME_TEXT), CONTACT: PageView(url=CONTACT, title="Contact", text=CONTACT_TEXT),
             ABOUT: PageView(url=ABOUT, title="About", text=ABOUT_TEXT)}

    def open(self, url):
        return self.pages.get(url) or PageView(url=url, title="", text="", ok=False, error="no such page")

    def search(self, query):
        return PageView(url="https://search.example/?q=" + query, title="search", text="nothing", ok=True)

    def back(self):
        return None

    def current(self):
        return None

    def close(self):
        pass

    def screenshot(self, path):
        return False

    def fetch_text(self, url):
        return None


class ListsThenFixes:
    """Reads the site, lists the lead with a thin pain point, then (as the Validator would ask) fixes it: a fuller
    pain point with its evidence page, the team size from the about page, and the orders@ address."""

    def __init__(self):
        self.step = 0

    def decide(self, system, obs):
        self.step += 1
        action = {
            1: Open(type="open", url=SITE), 2: Open(type="open", url=CONTACT), 3: Open(type="open", url=ABOUT),
            4: Lead(type="lead", name="Acme Bakery", website=SITE, email="hello@acmebakery.example", pain_point="Old site.",
                    how_we_help="Website Care Basic", evidence=SITE, sources=[SITE, CONTACT]),
            5: UpdateLead(type="update_lead", name="Acme Bakery", size="12 people", email="orders@acmebakery.example",
                          pain_point="Site last updated in 2016, orders by phone only: no online ordering, not mobile-friendly.",
                          evidence=SITE, sources=[SITE, CONTACT, ABOUT]),
            6: UpdateLead(type="update_lead", name="Nobody's Deli", size="3"),
        }.get(self.step) or UpdateLead(type="update_lead", name="Acme Bakery", location="Carroll Gardens, Northside")
        return ModelResult(decision=Decision(thought="lead", action=action))

    def complete(self, system, prompt):
        return "summary"


def test_the_controller_updates_its_own_row_on_the_board(cfg, tmp_path):
    cfg.agent.mode = "web"
    cfg.policy.per_domain_delay_seconds = 0
    cfg.policy.max_actions_per_episode = 12  # seven scripted steps in one episode
    cfg.leads = LeadsConfig(enabled=True, database_id="ds", notify_folder=str(tmp_path / "the-ceo"), notify_name="The CEO")
    fake = FakeNotion()
    ctl = make_controller(cfg, model=ListsThenFixes(), browser=SiteBrowser(), leads_notion=fake)
    assert "- update_lead:" in ctl.system
    ctl.run(max_cycles=7)
    rows = ctl.memory.db.query("SELECT action_type, verdict FROM actions ORDER BY id")
    kinds = [(r["action_type"], r["verdict"]) for r in rows]
    assert kinds[:5] == [("open", "allowed"), ("open", "allowed"), ("open", "allowed"), ("lead", "allowed"), ("update_lead", "allowed")]
    assert kinds[5][0] == "update_lead" and "lead you listed yourself" in kinds[5][1]   # not its row
    assert kinds[6] == ("update_lead", "allowed")                                       # second fix of the episode
    assert len(kinds) == 7 or "two leads this episode" in kinds[7][1]
    # The Notion row was created once and patched in place, never re-created.
    assert len(fake.rows) == 1
    row = fake.rows[0]
    assert row["Business email"] == "orders@acmebakery.example" and row["Company size"] == "12 people"
    assert row["Pain point"].startswith("Site last updated in 2016") and row["Source pages"] == f"{SITE}\n{CONTACT}\n{ABOUT}"
    assert row["Location"] == "Carroll Gardens, Northside"
    assert [u["page_id"] for u in fake.updates] == [fake.updates[0]["page_id"]] * 2
    # The local mirror followed.
    lead_row = ctl.memory.find_lead("Acme Bakery")
    assert lead_row["email"] == "orders@acmebakery.example" and lead_row["page_id"]
    assert ctl.memory.recent_lead_names() == {"acme bakery": "acmebakery.example"}
    assert "acmebakery.example" in ctl.memory.recent_lead_domains()


def test_with_update_any_row_the_bot_enriches_a_row_the_owner_put_on_the_board(cfg):
    from explorer.config import LeadsConfig
    from explorer.policy import Denylist, Policy

    notion = FakeNotion()
    notion.create_row("Acme Bakery", {"Website": SITE})  # the owner's row: no email, no pain point yet
    notion.create_row("Blank Deli", {})
    leads = LeadsConfig(enabled=True, database_id="ds", update_any_row=True)
    # Policy: the board is asked for the site domain; the email is checked against it as for any lead.
    lookup = lambda name: {"acme bakery": "acmebakery.example", "blank deli": ""}.get(name.lower())  # noqa: E731
    policy = Policy(PolicyConfig(), PublishConfig(), Denylist(), leads=leads)
    c = ctx(recent_lead_names={}, lead_site_on_board=lookup)
    assert policy.check(upd(evidence=None, email="orders@acmebakery.example"), c).allowed
    assert "not one of them" in policy.check(upd(name="Nobody", evidence=None, email="x@y.example"), c).reason
    assert "no website yet" in policy.check(upd(name="Blank Deli", evidence=None, email="hi@blankdeli.example"), c).reason
    assert policy.check(upd(name="Blank Deli", evidence=None, pain_point="No online ordering at all"), c).allowed
    # Controller: the row is found on the board by name, updated, and is one of the bot's rows from then on.
    cfg.leads = leads
    ctl = make_controller(cfg, leads_notion=notion)
    assert ctl._lead_site_on_board("Acme Bakery") == "acmebakery.example" and ctl._lead_site_on_board("Blank Deli") == "" and ctl._lead_site_on_board("Nobody") is None
    res = ctl._execute_update_lead(upd(evidence=None, email="orders@acmebakery.example", pain_point="Orders by phone only"))
    assert res.ok, res.result
    assert notion.rows[0]["Business email"] == "orders@acmebakery.example" and notion.rows[0]["Pain point"] == "Orders by phone only"
    assert ctl.memory.find_lead("Acme Bakery")["page_id"] == f"{1:032x}"


def test_founded_by_is_a_fillable_cell_and_upkeep_stays_allowed_under_a_priority_ask(cfg):
    from explorer.config import LeadsConfig, MessagingConfig
    from explorer.policy import Denylist, Policy

    notion = FakeNotion()
    notion.create_row("Acme Bakery", {"Website": SITE})
    leads = LeadsConfig(enabled=True, database_id="ds", update_any_row=True)
    m = MessagingConfig(enabled=True, peers=[{"name": "Validator", "folder": "/tmp/v"}], priority_senders=["Validator"], priority_request_grace=1)
    policy = Policy(PolicyConfig(), PublishConfig(), Denylist(), leads=leads, messaging=m)
    waiting = ctx(recent_lead_names={"acme bakery": "acmebakery.example"},
                  priority_request={"sender": "Validator", "text": "Leads board upkeep: 1 row has cells you can fill", "actions_since_read": 5})
    assert policy.check(upd(evidence=None, founded_by="Maria Rossi", location="Northside, NY, USA"), waiting).allowed
    assert "under 120" in policy.check(upd(evidence=None, founded_by="x" * 130), waiting).reason
    cfg.leads = leads
    ctl = make_controller(cfg, leads_notion=notion)
    assert ctl._execute_update_lead(upd(evidence=None, founded_by="Maria Rossi")).ok
    assert notion.rows[0]["Contact person"] == "Maria Rossi"


def test_a_deciding_bot_may_change_only_its_fields_and_sees_its_rows(cfg):
    # owner, 2026-09-30: "The CEO decides How can I help" for the rows that have none
    from explorer.actions import UpdateLead
    from explorer.notion import FakeNotion
    from conftest import make_controller

    cfg.leads.enabled, cfg.leads.update_any_row = True, True
    cfg.leads.update_only_fields = ["how_we_help"]
    cfg.leads.decide_glob = "leads-need-package*.md"
    routed = cfg.root.parent / "common-data" / "botBox" / "routed" / cfg.root.name
    routed.mkdir(parents=True, exist_ok=True)
    (routed / "leads-need-package.md").write_text("# rows\n\n- Birch Bakery | burger chain | no online ordering on its own site\n- Juniper Cafe | cafe chain | phone-only catering orders\n")
    notion = FakeNotion()
    notion.create_row("Birch Bakery", {"Website": "https://www.birchbakery.com"})
    notion.create_row("Juniper Cafe", {"Website": "https://junipercafe.com"})
    c = make_controller(cfg, notion=notion, leads_notion=notion)
    c.memory.start_episode(None); ep = c.memory.current_episode()
    assert [l.split(" | ")[0] for l in c._decide_lines()] == ["Birch Bakery", "Juniper Cafe"]
    ctx = c._policy_context(ep, None)
    v = c.policy.check(UpdateLead(type="update_lead", name="Birch Bakery", how_we_help="Acme POS", location="Florida"), ctx)
    assert not v.allowed and "you decide only: how_we_help" in v.reason
    ok = UpdateLead(type="update_lead", name="Birch Bakery", how_we_help="Acme POS")
    assert c.policy.check(ok, ctx).allowed
    assert c._execute_update_lead(ok).ok and notion.rows[0]["How can I help"] == "Acme POS"
    c.memory.record_action(1, ep["id"], "update_lead", ok.model_dump(), "", "allowed", "updated", True)
    assert [l.split(" | ")[0] for l in c._decide_lines()] == ["Juniper Cafe"]
    (routed / "leads-need-package.md").unlink()


def test_the_outreach_writer_drafts_only_its_column_from_the_oldest_new_rows(cfg):
    """Owner, 2026-10-07: the Outreach Writer writes a first email into "Draft email" for leads still at Stage New."""
    from explorer.actions import Lead, UpdateLead
    from explorer.notion import FakeNotion
    from explorer.prompts import DRAFT_EMAIL_ACTION_HELP
    from conftest import make_controller

    cfg.leads.enabled, cfg.leads.update_any_row = True, True
    cfg.leads.update_only_fields = ["draft_email"]
    cfg.leads.draft_queue_column = "Draft email"
    notion = FakeNotion()
    notion.create_row("Acme Bakery", {"Website": "https://www.acmebakery.example", "Stage": "New", "Pain point": "no online ordering"})
    notion.create_row("Poplar Toast", {"Website": "https://poplartoast.example", "Stage": "Emailed"})
    notion.create_row("Harbor Restaurant", {"Website": "https://harbor.example", "Stage": "New", "Draft email": "Hi Harbor Restaurant team"})
    c = make_controller(cfg, notion=notion, leads_notion=notion)
    c.memory.start_episode(None); ep = c.memory.current_episode()
    lines = c._decide_lines()
    assert [l.split(" | ")[0] for l in lines] == ["Acme Bakery"] and "pain point: no online ordering" in lines[0]
    ctx = c._policy_context(ep, None)
    draft = "Hi Acme Bakery team,\n\nYour site has no online ordering.\n\nAlex\nAcme LLC"
    ok = UpdateLead(type="update_lead", name="Acme Bakery", draft_email=draft)
    assert c.policy.check(ok, ctx).allowed
    assert not c.policy.check(UpdateLead(type="update_lead", name="Acme Bakery", draft_email=draft, location="Florida"), ctx).allowed
    lead = Lead(type="lead", name="New Place", website="https://new.example", email="hi@new.example", pain_point="x", how_we_help="y", evidence="https://new.example")
    assert "Lead Gen's job" in c.policy.check(lead, ctx).reason
    assert c._execute_update_lead(ok).ok and notion.rows[0]["Draft email"] == draft
    # no other bot may write the column
    cfg.leads.update_only_fields = []
    assert "Outreach Writer's column" in c.policy.check(ok, ctx).reason


def test_the_ceo_sees_drafts_waiting_for_review_not_skips_or_approved_ones(cfg):
    """Owner, 2026-10-07: the team checks each draft and sets Status "Ready to Send Email"; The CEO writes the review task."""
    from explorer.notion import FakeNotion
    from conftest import make_controller

    cfg.leads.enabled = True
    cfg.leads.outreach_draft_column, cfg.leads.outreach_min = "Draft email", 2
    notion = FakeNotion()
    notion.create_row("Acme Bakery", {"Draft email": "Hi Acme Bakery team, ...", "Business email": "hi@acmebakery.example"})
    notion.create_row("Poplar Toast", {"Draft email": "skip: the site has online ordering now"})
    notion.create_row("Harbor Restaurant", {"Draft email": "Hi Harbor Restaurant team, ...", "Status": "Ready to Send Email"})
    notion.create_row("Noodle Bar One", {"Draft email": "Hi Noodle Bar One team, ..."})
    notion.create_row("Maple Gallery", {"Draft email": "Hi Arco team, ...", "Status": "WhatsApp Verified"})  # checked, not reviewed
    c = make_controller(cfg, notion=notion, leads_notion=notion)
    lines, total = c._outreach_leads()
    assert total == 3 and [l.split(" | ")[0] for l in lines] == ["Acme Bakery", "Noodle Bar One", "Maple Gallery"]
    cfg.leads.outreach_min = 4
    c._review_cache = None
    assert c._outreach_leads() == ([], 3)  # not a batch yet


def test_a_draft_also_goes_on_the_leads_page_and_the_rates_are_quoted(cfg, tmp_path):
    from explorer.actions import UpdateLead
    from explorer.notion import FakeNotion
    from conftest import make_controller

    cfg.leads.enabled, cfg.leads.update_any_row = True, True
    cfg.leads.update_only_fields, cfg.leads.draft_queue_column = ["draft_email"], "Draft email"
    rates = tmp_path / "what-we-have.md"
    rates.write_text("# What we have\n\n## Rates\nThe card.\n- Acme POS: $299 setup, $79/month\n\n## Who does what\n- x\n")
    cfg.leads.rates_file = str(rates)
    notion = FakeNotion()
    notion.create_row("Acme Bakery", {"Stage": "New"})
    c = make_controller(cfg, notion=notion, leads_notion=notion)
    assert c._execute_update_lead(UpdateLead(type="update_lead", name="Acme Bakery", draft_email="Hi team,\n\nAlex\nAcme LLC")).ok
    assert notion.rows[0]["_sections"]["Draft email"] == "Hi team,\n\nAlex\nAcme LLC"
    assert "$299 setup, $79/month" in c._rates_text() and "Who does what" not in c._rates_text()


def test_a_whatsapp_number_a_person_marked_false_is_never_refilled(cfg):
    """Owner, 2026-10-07: Status "False Whatsapp Number" -- checked by hand in WhatsApp Web, it does not reach WhatsApp."""
    from explorer.actions import UpdateLead
    from explorer.notion import FakeNotion
    from conftest import make_controller

    cfg.leads.enabled, cfg.leads.update_any_row = True, True
    notion = FakeNotion()
    notion.create_row("Acme Bakery", {"Website": SITE, "Status": "False Whatsapp Number"})
    notion.create_row("Blank Deli", {"Website": "https://blankdeli.example"})
    c = make_controller(cfg, notion=notion, leads_notion=notion)
    c.recent_pages = {SITE: "Call (212) 555-0187", "https://blankdeli.example": "Call (212) 555-0199"}
    r = c._execute_update_lead(UpdateLead(type="update_lead", name="Acme Bakery", whatsapp="(212) 555-0187"))
    assert not r.ok and "does not reach WhatsApp" in r.summary and "Whatsapp" not in notion.rows[0]
    assert c._execute_update_lead(UpdateLead(type="update_lead", name="Blank Deli", whatsapp="(212) 555-0199")).ok
    assert notion.rows[1]["Whatsapp"] == "https://wa.me/12125550199"


def test_the_writer_gets_each_rows_package_email_in_its_work_list(cfg, tmp_path):
    """2026-10-07: the Outreach Writer spent most of its steps hunting for the package template."""
    from explorer.notion import FakeNotion
    from conftest import make_controller

    page = tmp_path / "packages-page.md"
    page.write_text("# Packages\n\n## Acme POS for Restaurants – after demo\nWho it is for\nChains\nReady-to-send email\n"
                    "Hi [Name],\n1. POS\nRegards,\n-- Your Company\nSources\n- https://x.example\n\n## Other – $1\nReady-to-send email\nHi\n")
    cfg.leads.enabled, cfg.leads.update_any_row = True, True
    cfg.leads.update_only_fields, cfg.leads.draft_queue_column = ["draft_email"], "Draft email"
    cfg.leads.package_emails_file = str(page)
    cfg.leads.package_aliases = {"Acme POS & Ordering": "Acme POS for Restaurants"}
    notion = FakeNotion()
    notion.create_row("Sweet Corner", {"Stage": "New", "How can I help": "Acme POS & Ordering"})
    notion.create_row("Deli", {"Stage": "New", "How can I help": "Acme ERP"})
    c = make_controller(cfg, notion=notion, leads_notion=notion)
    c.memory.start_episode(None)
    lines = c._draft_queue_lines()
    pos = next(l for l in lines if l.startswith('PACKAGE EMAIL for "Acme POS & Ordering"'))
    assert "Hi [Name],\n1. POS\nRegards,\n-- Your Company" in pos and "Sources" not in pos
    cfg.leads.draft_signoff = ["Regards,", "Alex", "-- Acme LLC"]
    pos = next(l for l in c._draft_queue_lines() if l.startswith('PACKAGE EMAIL for "Acme POS & Ordering"'))
    assert pos.endswith("1. POS\n\nRegards,\nAlex\n-- Acme LLC")
    assert any(l.startswith('PACKAGE EMAIL for "Acme ERP": none on the Packages page yet') and "word for word" in l for l in lines)


def test_a_drafted_row_is_not_rewritten_unless_the_validator_names_it(cfg, tmp_path):
    """2026-10-09: the Outreach Writer rewrote Harbor Tacos 56 times."""
    from explorer.actions import UpdateLead
    from explorer.notion import FakeNotion
    from conftest import make_controller

    cfg.leads.enabled, cfg.leads.update_any_row = True, True
    cfg.leads.update_only_fields, cfg.leads.draft_queue_column = ["draft_email"], "Draft email"
    notion = FakeNotion()
    notion.create_row("Harbor Tacos", {"Stage": "New", "Draft email": "Hi Harbor Tacos team, ..."})
    c = make_controller(cfg, notion=notion, leads_notion=notion)
    r = c._execute_update_lead(UpdateLead(type="update_lead", name="Harbor Tacos", draft_email="Hi again"))
    assert not r.ok and "already has a draft" in r.summary and notion.rows[0]["Draft email"] == "Hi Harbor Tacos team, ..."
    c._validator_named = lambda name: True  # the Validator asked for a fix on this row
    assert c._execute_update_lead(UpdateLead(type="update_lead", name="Harbor Tacos", draft_email="Hi again")).ok


def test_whatsapp_drafts_and_map_links(cfg, tmp_path):
    """Owner, 2026-10-10: the writer fills "Draft Whatsapp msg" for rows with a Whatsapp link; Lead Gen fills the map link."""
    import sqlite3

    from explorer.actions import UpdateLead
    from explorer.notion import FakeNotion
    from explorer.places import MAP_LINK, map_link
    from conftest import make_controller

    cfg.leads.enabled, cfg.leads.update_any_row = True, True
    cfg.leads.update_only_fields, cfg.leads.draft_queue_column = ["draft_email", "draft_whatsapp"], "Draft email"
    notion = FakeNotion()
    notion.create_row("Sweet Corner", {"Draft email": "Hi team", "Whatsapp": "https://wa.me/12125550187"})
    notion.create_row("Deli", {"Draft email": "Hi team"})
    notion.create_row("Gone", {"Draft email": "Hi team", "Whatsapp": "https://wa.me/1", "Status": "False Whatsapp Number"})
    c = make_controller(cfg, notion=notion, leads_notion=notion)
    msg = "Hi Sweet Corner team, your site has no ordering. We set that up. Would a 15-minute call this week help?\n– Alex, Acme LLC"
    assert c._execute_update_lead(UpdateLead(type="update_lead", name="Sweet Corner", draft_whatsapp=msg)).ok
    assert notion.rows[0]["Draft Whatsapp msg"] == msg and notion.rows[0]["_sections"]["Draft Whatsapp msg"] == msg
    assert "already has a WhatsApp draft" in c._execute_update_lead(UpdateLead(type="update_lead", name="Sweet Corner", draft_whatsapp="again")).summary
    assert "no working WhatsApp link" in c._execute_update_lead(UpdateLead(type="update_lead", name="Deli", draft_whatsapp=msg)).summary
    assert "no working WhatsApp link" in c._execute_update_lead(UpdateLead(type="update_lead", name="Gone", draft_whatsapp=msg)).summary
    # the map link: one confident match in the places snapshot, by name and city
    db = tmp_path / "places.sqlite"
    con = sqlite3.connect(db)
    con.execute("CREATE TABLE places (id TEXT, name TEXT, name_norm TEXT, category TEXT, website TEXT, phone TEXT, socials TEXT,"
                " address TEXT, locality TEXT, postcode TEXT, confidence REAL, status TEXT, lat REAL, lon REAL, region TEXT)")
    con.executemany("INSERT INTO places VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", [
        ("1", "Corner Cafe", "corner cafe", "cafe", "http://www.cornercafe.com/", None, "", "12 Main St", "New York", "10003", 0.99, "open", 40.7367, -73.9878, "NY"),
        ("2", "Corner Cafe", "corner cafe", "cafe", "http://www.cornercafe.com/", None, "", "8 Elm Ave", "Brooklyn", "11222", 0.99, "open", 40.7249, -73.9509, "NY"),
        ("3", "Harbor Restaurant", "harbor restaurant", "restaurant", None, None, "", "40 Oak St", "New York", "10009", 0.5, "open", 40.7, -73.9, "NY"),
        ("4", "Bay Bakery", "bay bakery", "bakery", "http://balthazarbakery.net/", None, "", "1 Main", "Englewood", "07631", 0.95, "open", 40.89, -73.97, "NJ"),
        ("5", "Burger Spot", "burger spot", "burger", None, None, "", "2 Ave", "Clifton", "07011", 0.9, "open", 40.86, -74.16, "NJ")])
    con.commit(); con.close()
    assert map_link("Corner Cafe", "", db, website="https://www.cornercafe.com") is None  # two places of that name: a chain, no guess
    assert map_link("Corner Cafe", "Brooklyn, NY, USA", db) is None  # same: one store's address would misplace the business
    assert map_link("Bay Bakery", "Englewood, NJ, USA", db, website="https://balthazarbakery.net") is None  # NJ: outside the market
    assert map_link("Harbor Restaurant", "New York, NY", db) is None  # below the confidence floor
    assert map_link("Bay Bakery", "New York, NY, USA", db, website="https://baybakery.example") is None  # NJ place, other domain
    assert map_link("Burger Spot", "New York, NY, USA", db) is None  # NJ: outside the market
    assert MAP_LINK.match("https://maps.app.goo.gl/abc") and not MAP_LINK.match("https://example.com/map")


def test_a_fill_only_bot_never_replaces_a_cell_and_sources_append(cfg):
    """Owner, 2026-10-10: the Lead Enricher fills empty cells only, about 20 a day."""
    from explorer.actions import UpdateLead
    from explorer.notion import FakeNotion
    from explorer.policy import PolicyContext
    from conftest import make_controller

    cfg.leads.enabled, cfg.leads.update_any_row, cfg.leads.fill_only = True, True, True
    cfg.leads.update_only_fields = ["founded_by", "location", "size", "industry", "map_url", "sources"]
    notion = FakeNotion()
    notion.create_row("Sweet Corner", {"Website": "https://www.sweetcorner.example", "Location": "Florida, USA", "Source pages": "https://www.sweetcorner.example"})
    c = make_controller(cfg, notion=notion, leads_notion=notion)
    r = c._execute_update_lead(UpdateLead(type="update_lead", name="Sweet Corner", location="New York, NY, USA"))
    assert not r.ok and "already has Location" in r.summary and notion.rows[0]["Location"] == "Florida, USA"
    ok = c._execute_update_lead(UpdateLead(type="update_lead", name="Sweet Corner", founded_by="John Baker", sources=["https://www.sweetcorner.example/about"]))
    assert ok.ok and notion.rows[0]["Contact person"] == "John Baker"
    assert notion.rows[0]["Source pages"] == "https://www.sweetcorner.example\nhttps://www.sweetcorner.example/about"
    cfg.leads.max_updates_per_day = 20
    ctx = PolicyContext(mode="web", current_page=None, actions_in_episode=0, pages_last_hour=0, open_questions=0, last_visit_by_domain={},
                        recent_lead_names={"sweet corner": "sweetcorner.example"}, lead_updates_today=20)
    assert "daily limit" in c.policy.check(UpdateLead(type="update_lead", name="Sweet Corner", industry="burgers"), ctx).reason


def test_the_enricher_fills_map_link_and_location_from_the_snapshot_for_its_list(cfg, tmp_path):
    """Owner, 2026-10-10: map links and Locations are the Lead Enricher's; the engine fills them from map data as that bot."""
    import json, sqlite3

    from explorer.notion import FakeNotion
    from conftest import make_controller

    db = tmp_path / "places.sqlite"
    con = sqlite3.connect(db)
    con.execute("CREATE TABLE places (id TEXT, name TEXT, name_norm TEXT, category TEXT, website TEXT, phone TEXT, socials TEXT,"
                " address TEXT, locality TEXT, postcode TEXT, confidence REAL, status TEXT, lat REAL, lon REAL, region TEXT)")
    con.execute("INSERT INTO places VALUES ('1','Jar Shop','jar shop','shop','https://jarshop.example/',NULL,'','20 River St','Brooklyn','11222',0.99,'open',40.7242,-73.9499,'NY')")
    con.commit(); con.close()
    cfg.agent.name = "Lead Enricher"
    cfg.leads.enabled, cfg.leads.update_any_row, cfg.leads.fill_only, cfg.leads.auto_fill_from_places = True, True, True, True
    cfg.leads.decide_glob = "empty-cells*.md"
    cfg.browser.places_db = str(db)
    routed = cfg.root.parent / "common-data" / "botBox" / "routed" / cfg.root.name
    routed.mkdir(parents=True, exist_ok=True)
    (routed / "empty-cells.md").write_text("# cells\n\n- Jar Shop | https://jarshop.example | missing: Location, google map location | pages: https://jarshop.example\n")
    notion = FakeNotion()
    notion.create_row("Jar Shop", {"Website": "https://jarshop.example"})
    c = make_controller(cfg, notion=notion, leads_notion=notion)
    c.memory.start_episode(None)
    assert c._auto_fill_from_places() == 1
    assert notion.rows[0]["Location"] == "Brooklyn, NY, USA" and notion.rows[0]["google map location"].endswith("query=40.724200,-73.949900")
    assert c._auto_fill_from_places() == 0  # once a day per row
    log = (cfg.root.parent / "common-data" / "shared-state" / "leads-facts-applied.jsonl").read_text().splitlines()
    assert json.loads(log[-1])["by"] == "Lead Enricher"
    (routed / "empty-cells.md").unlink()


def test_a_fill_only_bots_facts_must_be_printed_on_a_page_it_opened():
    """Owner, 2026-10-10: "enrA can take things slow, I expect high accuracy and fact check from it"."""
    from explorer.actions import UpdateLead
    from explorer.config import LeadsConfig, PolicyConfig, PublishConfig
    from explorer.policy import Denylist, Policy, PolicyContext

    policy = Policy(PolicyConfig(), PublishConfig(), Denylist(), leads=LeadsConfig(enabled=True, database_id="ds", update_any_row=True, fill_only=True,
                                                                                   update_only_fields=["founded_by", "location", "size", "industry", "sources"]))
    about = "https://acme.example/about"
    def ctx(texts):
        return PolicyContext(mode="web", current_page=None, actions_in_episode=1, pages_last_hour=0, open_questions=0, last_visit_by_domain={},
                             visited_urls={about}, recent_page_texts=texts, recent_lead_names={"acme bakery": "acme.example"})
    printed = ctx({about: "About Acme Bakery. Founded by Maria Rossi in Brooklyn in 2009. A team of 12."})
    assert policy.check(UpdateLead(type="update_lead", name="Acme Bakery", founded_by="Maria Rossi", location="Brooklyn, NY, USA", sources=[about]), printed).allowed
    v = policy.check(UpdateLead(type="update_lead", name="Acme Bakery", founded_by="John Smith"), printed)
    assert not v.allowed and "not printed on any page" in v.reason
    assert "open the business's page first" in policy.check(UpdateLead(type="update_lead", name="Acme Bakery", size="12 staff"), ctx({})).reason


def test_review_fixes_2026_10_14(cfg):
    """A fill-only bot's extra fields are dropped, not refused; a pasted work-list line resolves to the business; a mangled
    name resolves to the one close work-list name; a same-site page counts as seen."""
    from explorer.actions import Open, UpdateLead
    from explorer.notion import FakeNotion
    from explorer.policy import PolicyContext
    from conftest import make_controller

    cfg.leads.enabled, cfg.leads.update_any_row, cfg.leads.fill_only = True, True, True
    cfg.leads.update_only_fields, cfg.leads.draft_queue_column = ["founded_by", "location", "size", "industry", "sources"], ""
    cfg.leads.decide_glob = "empty-cells*.md"
    routed = cfg.root.parent / "common-data" / "botBox" / "routed" / cfg.root.name
    routed.mkdir(parents=True, exist_ok=True)
    (routed / "empty-cells.md").write_text("- Studio One | https://www.studioone.example/ | missing: Contact person\n- Corner Kitchen | https://cornerkitchen.example | missing: Location\n")
    notion = FakeNotion()
    notion.create_row("Studio One", {"Website": "https://www.studioone.example/"})
    notion.create_row("Corner Kitchen", {"Website": "https://cornerkitchen.example"})
    c = make_controller(cfg, notion=notion, leads_notion=notion)
    c.memory.start_episode(None); ep = c.memory.current_episode()
    about = "https://www.studioone.example/about"
    c.recent_pages = {about: "Studio One, Crown Heights. Founded by Jane Doe."}
    ctx = c._policy_context(ep, None)
    ctx.visited_urls = {about}; ctx.recent_page_texts = dict(c.recent_pages)
    a = UpdateLead(type="update_lead", name="Studio One | https://www.studioone.example/", website="https://www.studioone.example/", founded_by="Jane Doe", sources=[about])
    v = c.policy.check(a, ctx)
    assert v.allowed and a.website is None  # the echoed website is dropped, the fill stays
    assert c._execute_update_lead(a).ok and notion.rows[0]["Contact person"] == "Jane Doe"
    assert c._close_work_list_name("Corner Kitchen New York") == "Corner Kitchen"
    assert c._close_work_list_name("Nobody Here") is None
    # a page on the same site as one opened this episode is not a guess
    seen_ctx = PolicyContext(mode="web", current_page=None, actions_in_episode=1, pages_last_hour=0, open_questions=0, last_visit_by_domain={},
                             visited_urls={"https://ajcdesign.example/"}, recent_page_texts={})
    c.policy.cfg.open_only_seen_urls = True
    assert c.policy.check(Open(type="open", url="https://ajcdesign.example/about/"), seen_ctx).allowed
    assert "actually seen" in c.policy.check(Open(type="open", url="https://other.example/about/"), seen_ctx).reason
    (routed / "empty-cells.md").unlink()


def test_founder_linkedin_is_a_link_a_page_showed_with_its_step(cfg):
    """Owner, 2026-10-14: "Founder LinkedIn" is filled step-wise (own site, listing, press, search result), only as a link a
    page the bot opened shows, never from linkedin.com or memory; the step goes to "LinkedIn found via"."""
    from explorer.actions import UpdateLead
    from explorer.notion import FakeNotion
    from explorer.policy import PolicyContext
    from conftest import make_controller

    cfg.leads.enabled, cfg.leads.update_any_row, cfg.leads.fill_only = True, True, True
    cfg.leads.update_only_fields = ["founded_by", "contact_role", "founder_linkedin", "linkedin_via", "sources"]
    notion = FakeNotion()
    notion.create_row("Studio One", {"Website": "https://www.studioone.example/", "Contact person": "Jane Doe"})
    c = make_controller(cfg, notion=notion, leads_notion=notion)
    about = "https://www.studioone.example/about"
    ctx = PolicyContext(mode="web", current_page=None, actions_in_episode=1, pages_last_hour=0, open_questions=0, last_visit_by_domain={},
                        recent_lead_names={"studio one": "studioone.example"}, visited_urls={about},
                        recent_page_texts={about: "Our founder Jane Doe"}, seen_link_urls={"https://www.linkedin.com/in/jane-doe-yoga/"})
    link = "https://www.linkedin.com/in/jane-doe-yoga"
    a = UpdateLead(type="update_lead", name="Studio One", founder_linkedin=link, linkedin_via="1 Own site", sources=[about])
    assert c.policy.check(a, ctx).allowed
    assert c._execute_update_lead(a).ok and notion.rows[0]["Founder LinkedIn"] == link and notion.rows[0]["LinkedIn found via"] == "1 Own site"
    assert "one of:" in c.policy.check(UpdateLead(type="update_lead", name="Studio One", founder_linkedin=link, linkedin_via="own site"), ctx).reason
    assert "goes with" in c.policy.check(UpdateLead(type="update_lead", name="Studio One", linkedin_via="1 Own site"), ctx).reason
    assert "/in/<name>" in c.policy.check(UpdateLead(type="update_lead", name="Studio One", founder_linkedin="https://linkedin.com/feed", linkedin_via="1 Own site"), ctx).reason
    unseen = UpdateLead(type="update_lead", name="Studio One", founder_linkedin="https://www.linkedin.com/in/someone-else", linkedin_via="4 Search result")
    assert "page you opened" in c.policy.check(unseen, ctx).reason
    # a person's profile with no founder named is refused at write time (2026-10-14); a company page is not
    notion.create_row("Nameless Shop", {"Website": "https://nameless.example/"})
    r = c._execute_update_lead(UpdateLead(type="update_lead", name="Nameless Shop", founder_linkedin="https://www.linkedin.com/in/who-dis", linkedin_via="2 Business listing"))
    assert not r.ok and "no Contact person" in r.summary and not notion.rows[1].get("Founder LinkedIn")
    assert c._execute_update_lead(UpdateLead(type="update_lead", name="Nameless Shop", founder_linkedin="https://www.linkedin.com/company/nameless", linkedin_via="1 Own site")).ok
    notion.create_row("Dana's Shop", {"Website": "https://danas.example/"})
    assert c._execute_update_lead(UpdateLead(type="update_lead", name="Dana's Shop", founded_by="Dana Reyes", founder_linkedin="https://www.linkedin.com/in/dana-reyes", linkedin_via="1 Own site")).ok
    # the contact's role is one of the board's options, exactly (owner, 2026-10-14: "Contact person" / "Contact role")
    assert "one of:" in c.policy.check(UpdateLead(type="update_lead", name="Studio One", contact_role="founder"), ctx).reason
    assert c.policy.check(UpdateLead(type="update_lead", name="Studio One", contact_role="General Manager"), ctx).allowed
    assert c._execute_update_lead(UpdateLead(type="update_lead", name="Dana's Shop", contact_role="Owner")).ok and notion.rows[2]["Contact role"] == "Owner"



def test_best_lead_score_first_and_site_facts_on_the_writer_list(cfg):
    """the Validator session, 2026-10-14: the Validator scores leads; the writer's queue and the CEO's review list take the best first,
    unscored last; the writer's line shows the site's tools and health as facts for the opening line."""
    from explorer.notion import FakeNotion
    from conftest import make_controller

    cfg.leads.enabled, cfg.leads.update_any_row = True, True
    cfg.leads.update_only_fields, cfg.leads.draft_queue_column, cfg.leads.draft_queue_shown = ["draft_email"], "Draft email", 3
    cfg.leads.outreach_from, cfg.leads.outreach_draft_column, cfg.leads.outreach_status_column, cfg.leads.outreach_min = "Lead Gen", "Draft email", "Status", 1
    notion = FakeNotion()
    notion.create_row("Old Unscored", {"Website": "https://old.example"})
    notion.create_row("Mid", {"Website": "https://mid.example", "Lead score": "40", "Tools on site": "Square, Delivery apps", "Site health": "© 2019 · PDF menu"})
    notion.create_row("Best", {"Website": "https://best.example", "Lead score": "85"})
    c = make_controller(cfg, notion=notion, leads_notion=notion)
    lines = c._draft_queue_lines()
    assert [l.split(" | ")[0] for l in lines] == ["Best", "Mid", "Old Unscored"]
    assert "tools: Square, Delivery apps | site: © 2019 · PDF menu" in lines[1] and "tools:" not in lines[0]
    for i, r in enumerate(notion.rows):
        r["Draft email"] = f"Hi, draft {i}"
    review, n = c._drafts_to_review()
    assert n == 3 and [l.split(" | ")[0] for l in review] == ["Best", "Mid", "Old Unscored"]


def test_a_refusal_for_already_done_or_todays_limit_blocks_the_action_for_the_day(cfg):
    """Owner, 2026-10-14 ("do less but more quality work"): a third of all actions were repeats of something already done
    or refused that day. Such a refusal blocks the key (or, for a daily cap, the whole type) until tomorrow, across
    episodes and restarts, and the prompt lists it."""
    from explorer.actions import Note
    from explorer.policy import PolicyContext, Verdict
    from conftest import make_controller

    c = make_controller(cfg)
    note = Note(type="note", title="Speka has a free tier", body="x", source_url="")
    c._day_block(note, "note:speka has a free tier", Verdict.no("that is the note you already have as 'speka free tier'"))
    c._day_block(note, "note:other", Verdict.no("no page is open"))  # an ordinary refusal: not for the day
    assert set(c._day_blocks()) == {"note:speka has a free tier"}
    ctx = PolicyContext(mode="web", current_page=None, actions_in_episode=0, pages_last_hour=0, open_questions=0, last_visit_by_domain={},
                        day_blocked_keys=set(c._day_blocks()))
    assert "until tomorrow" in c.policy.check(note, ctx, key="note:speka has a free tier").reason
    assert "until tomorrow" not in c.policy.check(note, ctx, key="note:other").reason
    # a daily cap blocks the whole action type; the block survives a restart (workspace/day-blocks.json)
    from explorer.actions import Message
    msg = Message(type="message", to="Lead Gen", text="hello")
    c._day_block(msg, "message:lead gen:hello", Verdict.no("you have sent 20 messages today, the daily limit; take notes instead"))
    c2 = make_controller(cfg)
    assert "message:*" in c2._day_blocks()
    ctx.day_blocked_keys = set(c2._day_blocks())
    assert "until tomorrow" in c2.policy.check(Message(type="message", to="Scout", text="other"), ctx, key="message:scout:other").reason
    # the prompt names them
    from explorer.prompts import Observation
    import dataclasses
    fields = {f.name for f in dataclasses.fields(Observation)}
    assert {"refused_today", "tasks_today"} <= fields


def test_daily_journal_is_one_data_led_entry_a_day(cfg):
    """Owner, 2026-10-14: fewer, longer, data-oriented posts with links -- one journal entry per day from the day's
    notes (with sources), tasks and outputs; the per-episode entries wait in a buffer that is not a post."""
    import datetime as dt
    from conftest import make_controller

    class Prose:
        def decide(self, system, obs):
            raise AssertionError("not used")

        def complete(self, system, prompt):
            assert "Rates at Agency X" in prompt and "https://agency-x.example/rates" in prompt
            return "Yesterday I compared rates: Agency X lists website care at $250 a month."

    cfg.agent.journal_daily = True
    c = make_controller(cfg, model=Prose())
    yesterday = (dt.date.today() - dt.timedelta(days=1)).isoformat()
    c.memory.db.conn.execute("INSERT INTO notes(created_at, title, body, tags, source_url) VALUES (?, ?, ?, '', ?)",
                             (yesterday + "T10:00:00", "Rates at Agency X", "website care $250/month", "https://agency-x.example/rates"))
    c.memory.db.conn.execute("INSERT INTO summaries(created_at, kind, body) VALUES (?, 'episode', ?)", (yesterday + "T10:30:00", "I read rate pages."))
    c.memory.db.conn.commit()
    # an episode-style entry today goes to the buffer, not the journal
    c.memory.write_journal("Episode text", heading="Episode 9: free exploration")
    assert not c.memory.journal_path().exists() and "Episode 9" in c.memory.day_buffer(dt.date.today())
    c._daily_journal_catch_up()
    journal = c.memory.journal_path().read_text()
    assert f"Day {yesterday}" in journal and "Agency X lists website care at $250" in journal
    assert "- Rates at Agency X: https://agency-x.example/rates" in journal
    assert c.memory.db.get_state("daily_journal_last") == yesterday
    # a second call the same day writes nothing more
    c._daily_journal_catch_up()
    assert journal == c.memory.journal_path().read_text()


def test_the_third_refusal_of_the_same_action_blocks_it_for_the_day(cfg):
    """the Validator session, 2026-10-14: the Enricher tried Studio One 138 times in a day. Whatever the reason, the third refusal
    of the same key is the last one today."""
    from explorer.actions import UpdateLead
    from explorer.policy import PolicyContext, Verdict
    from conftest import make_controller

    c = make_controller(cfg)
    a = UpdateLead(type="update_lead", name="Studio One", founded_by="X")
    for _ in range(2):
        c._day_block(a, "update_lead:studio one", Verdict.no("Validator rules: MG03: No founder stated"))
    assert not c._day_blocks()
    c._day_block(a, "update_lead:studio one", Verdict.no("Validator rules: MG03: No founder stated"))
    assert "refused 3 times today" in c._day_blocks()["update_lead:studio one"]
    ctx = PolicyContext(mode="web", current_page=None, actions_in_episode=0, pages_last_hour=0, open_questions=0, last_visit_by_domain={},
                        day_blocked_keys=set(make_controller(cfg)._day_blocks()))  # survives a restart
    assert "until tomorrow" in c.policy.check(a, ctx, key="update_lead:studio one").reason


def test_answers_outlive_the_episode_and_a_plan_with_nothing_done_for_six_hours_closes(cfg, tmp_path):
    """Owner, 2026-10-14 ("go"): The CEO keeps each colleague's last answer in its prompt for a week; a plan with no step
    finished in 6 hours ends stuck by itself (Package Designer: 45 hours, 2,192 actions, 0 steps)."""
    import datetime as dt
    import json
    from explorer.plan import WorkPlan, save_plan
    from conftest import make_controller

    cfg.agent.name = "The CEO"
    cfg.messaging.enabled = True
    c = make_controller(cfg)
    assert c.requests is not None
    r = c.requests.record("ask-1", "The CEO", "Research Analyst", "What do NYC cafes pay for online ordering?")
    c.requests.answer("The CEO", "Research Analyst", "Typical plans run $49-$149 a month (Toast, Square), per their pricing pages.")
    answers = c._answers_this_week()
    assert len(answers) == 1 and answers[0].startswith("Research Analyst, ") and "$49-$149" in answers[0] and "online ordering" in answers[0]
    old = (dt.datetime.now() - dt.timedelta(hours=7)).isoformat(timespec="seconds")
    plan = WorkPlan(task="Fix package deliverables", done_when="2-6 deliverables", steps=[{"text": "open", "done": False, "done_at": None, "by_action": None}],
                    source="priority", started=old, updated=old)
    save_plan(c.plan_file, plan)
    c.plan = plan
    assert c._plan_lines() == [] or "stuck" not in c._plan_lines()[0]  # no active plan rendered
    assert c.plan.status == "stuck" and "closed by the engine" in c.plan.note and "closed" in (c.feedback or "")
    assert any("Plan stuck" in line for line in c.memory.journal_path().read_text().splitlines())
    fresh = WorkPlan(task="New", done_when="x", steps=[{"text": "a", "done": False, "done_at": None, "by_action": None}], source="own")
    c.plan = fresh
    assert c._plan_lines()[0].startswith("Your plan") and c.plan.active
