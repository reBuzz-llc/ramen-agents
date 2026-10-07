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
    assert "personal mailbox" in policy.check(upd(email="acmebakery@gmail.com"), ctx()).reason
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
    assert notion.rows[0]["Founded by"] == "Maria Rossi"


def test_a_deciding_bot_may_change_only_its_fields_and_sees_its_rows(cfg):
    # owner, 2026-09-30: "The CEO decides How we can help" for the rows that have none
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
    assert c._execute_update_lead(ok).ok and notion.rows[0]["How we can help"] == "Acme POS"
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
    notion.create_row("Toastique", {"Website": "https://toastique.com", "Stage": "Emailed"})
    notion.create_row("Pylos", {"Website": "https://pylos.example", "Stage": "New", "Draft email": "Hi Pylos team"})
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
    notion.create_row("Toastique", {"Draft email": "skip: the site has online ordering now"})
    notion.create_row("Pylos", {"Draft email": "Hi Pylos team, ...", "Status": "Ready to Send Email"})
    notion.create_row("Mokbar", {"Draft email": "Hi Mokbar team, ..."})
    notion.create_row("Arco Gallery", {"Draft email": "Hi Arco team, ...", "Status": "WhatsApp Verified"})  # checked, not reviewed
    c = make_controller(cfg, notion=notion, leads_notion=notion)
    lines, total = c._outreach_leads()
    assert total == 3 and [l.split(" | ")[0] for l in lines] == ["Acme Bakery", "Mokbar", "Arco Gallery"]
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
