"""The Lead Gen bot lists potential customers on the owner's Leads board -- only businesses whose own site it read,
with a business email published there, a grounded pain point and the package that fixes it (Plan 11)."""
from __future__ import annotations

from explorer.actions import Decision, Lead, Open
from explorer.browser import PageView
from explorer.config import LeadsConfig, PolicyConfig, PublishConfig
from explorer.model import ModelResult
from explorer.notion import FakeNotion
from explorer.policy import Denylist, Policy, PolicyContext, email_domain, same_site

from conftest import make_controller

SITE = "https://acmebakery.example"
CONTACT = SITE + "/contact"
HOME_TEXT = "Acme Bakery. Northside's sourdough since 2009. Our website was last updated in 2016 and orders are by phone only."
CONTACT_TEXT = "Contact Acme Bakery: 122 Court St, Northside NY. Email hello@acmebakery.example or call us."


def lead(**over) -> Lead:
    spec = dict(type="lead", name="Acme Bakery", website=SITE, email="hello@acmebakery.example",
                pain_point="Orders are phone-only and the site was last updated in 2016: no online ordering, not mobile-friendly.",
                how_we_help="Website Care Basic", evidence=SITE, location="Northside, NY", industry="bakery",
                sources=[SITE, CONTACT])
    spec.update(over)
    return Lead(**spec)


def ctx(**over) -> PolicyContext:
    base = dict(mode="web", current_page=None, actions_in_episode=0, pages_last_hour=0, open_questions=0, last_visit_by_domain={},
                visited_urls={SITE, CONTACT}, recent_page_texts={SITE: HOME_TEXT, CONTACT: CONTACT_TEXT})
    base.update(over)
    return PolicyContext(**base)


def test_email_helpers():
    assert email_domain("Hello@Acme.Example") == "acme.example" and email_domain("not an email") == ""
    assert same_site("mail.acme.example", "acme.example") and not same_site("acme.example", "other.example")


def test_policy_wants_a_published_business_email_and_grounded_facts():
    off = Policy(PolicyConfig(), PublishConfig(), Denylist())
    assert "not enabled" in off.check(lead(), ctx()).reason
    policy = Policy(PolicyConfig(), PublishConfig(), Denylist(), leads=LeadsConfig(enabled=True, database_id="ds", max_per_day=3))
    assert policy.check(lead(), ctx()).allowed
    # No email, no lead -- and it must be theirs, on their site, on a page that was opened.
    assert "business email" in policy.check(lead(email=""), ctx()).reason
    assert "personal mailbox" in policy.check(lead(email="acmebakery@gmail.com"), ctx()).reason
    assert "does not appear on any page" in policy.check(lead(email="hello@other.example"), ctx()).reason  # another domain, not printed on the site
    unseen = policy.check(lead(email="owner@acmebakery.example"), ctx())
    assert not unseen.allowed and "does not appear on any page" in unseen.reason
    assert "not opened any page on the business's own site" in policy.check(lead(), ctx(recent_page_texts={})).reason
    assert "evidence must be" in policy.check(lead(evidence="https://acmebakery.example/never-opened"), ctx()).reason
    assert "actually opened" in policy.check(lead(sources=["https://elsewhere.example/"]), ctx()).reason
    dup = policy.check(lead(), ctx(recent_lead_domains={"acmebakery.example"}))
    assert not dup.allowed and dup.permanent
    assert "this episode" in policy.check(lead(), ctx(leads_in_episode=1)).reason
    assert "daily limit" in policy.check(lead(), ctx(leads_today=3)).reason
    assert "own tools" in policy.check(lead(pain_point="Their site has a captcha rate limit problem"), ctx()).reason


class SiteBrowser:
    """A two-page business website."""

    pages = {SITE: PageView(url=SITE, title="Acme Bakery", text=HOME_TEXT), CONTACT: PageView(url=CONTACT, title="Contact", text=CONTACT_TEXT)}

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


class ReadsThenLists:
    def __init__(self):
        self.step = 0

    def decide(self, system, obs):
        self.step += 1
        action = {1: Open(type="open", url=SITE), 2: Open(type="open", url=CONTACT)}.get(self.step) or lead()
        return ModelResult(decision=Decision(thought="lead", action=action))

    def complete(self, system, prompt):
        return "summary"


def test_the_controller_lists_the_lead_and_tells_the_ceo(cfg, tmp_path):
    cfg.agent.mode = "web"
    cfg.policy.per_domain_delay_seconds = 0  # two pages of one site back to back
    ceo = tmp_path / "the-ceo"
    cfg.leads = LeadsConfig(enabled=True, database_id="ds", notify_folder=str(ceo), notify_name="The CEO")
    fake = FakeNotion()
    ctl = make_controller(cfg, model=ReadsThenLists(), browser=SiteBrowser(), leads_notion=fake)
    assert "- lead:" in ctl.system
    ctl.run(max_cycles=3)
    rows = ctl.memory.db.query("SELECT action_type, verdict FROM actions ORDER BY id")
    assert [(r["action_type"], r["verdict"]) for r in rows] == [("open", "allowed"), ("open", "allowed"), ("lead", "allowed")]
    assert fake.rows == [{"title": "Acme Bakery", "Website": SITE, "Business email": "hello@acmebakery.example",
                          "Location": "Northside, NY", "Industry": "bakery",
                          "Pain point": "Orders are phone-only and the site was last updated in 2016: no online ordering, not mobile-friendly.",
                          "How we can help": "Website Care Basic", "Evidence": SITE, "Stage": "New",
                          "Found on": fake.rows[0]["Found on"], "Source pages": f"{SITE}\n{CONTACT}"}]
    inbox = list((ceo / "workspace" / "inbox").glob("*.json"))
    import json
    assert len(inbox) == 1
    msg = json.loads(inbox[0].read_text())
    assert msg["kind"] == "message" and msg["text"].startswith('new lead "Acme Bakery" (https://acmebakery.example)') and "row-1" in msg["text"]
    # Listing it again is refused: one business once.
    ctl2 = make_controller(cfg, model=ReadsThenLists(), browser=SiteBrowser(), leads_notion=fake)
    ctl2.run(max_cycles=3)
    assert "already on the Leads board" in ctl2.memory.db.query("SELECT verdict FROM actions ORDER BY id DESC LIMIT 1")[0]["verdict"]
    assert len(fake.rows) == 1


def test_lead_columns_constant_matches_what_the_controller_writes(cfg, tmp_path):
    """LEAD_COLUMNS is what `bot check` verifies against the board, so it must stay equal to the columns
    _execute_lead fills -- otherwise the check passes on a board that silently drops a field. A lead with every
    optional field set, since an empty one is left out of the row."""
    from explorer.notion import LEAD_COLUMNS

    class ListsAFullLead(ReadsThenLists):
        def decide(self, system, obs):
            result = super().decide(system, obs)
            if result.decision.action.type == "lead":
                result.decision.action = lead(size="8 people", location="Northside, NY", industry="bakery")
            return result

    cfg.agent.mode = "web"
    cfg.policy.per_domain_delay_seconds = 0
    cfg.leads = LeadsConfig(enabled=True, database_id="ds", notify_folder=str(tmp_path / "ceo"), notify_name="The CEO")
    fake = FakeNotion()
    ctl = make_controller(cfg, model=ListsAFullLead(), browser=SiteBrowser(), leads_notion=fake)
    ctl._ground_optional_lead_facts = lambda action: (action, "")  # this test is about the columns, not about grounding
    ctl.run(max_cycles=3)
    written = set(fake.rows[0]) - {"title"}
    assert written == set(LEAD_COLUMNS), f"drifted: only in the row {written - set(LEAD_COLUMNS)}, only in the constant {set(LEAD_COLUMNS) - written}"


def test_candidates_from_the_daily_file_reach_the_prompt_and_skip_visited_sites(cfg):
    from conftest import make_controller

    cfg.leads.enabled = True
    cfg.leads.candidates_glob = "spf-open-data-*.md"
    routed = cfg.root.parent / "common-data" / "botBox" / "routed" / cfg.root.name
    routed.mkdir(parents=True, exist_ok=True)
    (routed / "spf-open-data-2026-09-30.md").write_text(
        "# SPF Open Data\n\n- Greene Grape Provisions | Northside | Grocery | http://www.greenegrape.com | owner on city record: A B\n"
        "- St. Petersburg Trade House | Northside | Gifts | http://www.stpgoods.com | owner on city record: N O\n")
    c = make_controller(cfg)
    lines = c._candidate_lines()
    assert len(lines) == 2 and lines[0].startswith("Greene Grape Provisions (Northside, Grocery): http://www.greenegrape.com")
    assert "http://www.greenegrape.com" in c.seen_links  # `open` on it is not a typed guess
    c.memory.record_visit("http://www.greenegrape.com/contact", "Greene Grape", True)
    assert [l.split(" (")[0] for l in c._candidate_lines()] == ["St. Petersburg Trade House"]
    obs_text = c._observe(c.memory.current_episode() or c.memory.db.query("SELECT * FROM episodes WHERE id = ?", (c.memory.start_episode(None),))[0]).render()
    assert "Businesses to open next" in obs_text and "stpgoods.com" in obs_text
    (routed / "spf-open-data-2026-09-30.md").unlink()


def test_optional_lead_facts_are_kept_only_when_the_sites_pages_state_them(cfg):
    from explorer.actions import Lead
    from conftest import make_controller

    cfg.leads.enabled = True
    cfg.agent.mode = "web"
    c = make_controller(cfg)
    c.recent_pages["https://www.ovencorner.example/contact"] = "Oven Corner. 1673 Lexington Ave, Springfield, NY 10029. Email support@ovencorner.example"
    lead = Lead(type="lead", name="Oven Corner", website="https://www.ovencorner.example", email="support@ovencorner.example",
                pain_point="no online ordering", how_we_help="Acme POS", evidence="https://www.ovencorner.example/contact",
                location="Springfield, NY, USA", size="12 staff")
    kept, note = c._ground_optional_lead_facts(lead)
    assert kept.location == "Springfield, NY, USA" and kept.size == "" and "Company size left empty" in note
    far = lead.model_copy(update={"location": "Northside, NY, USA", "size": ""})
    kept2, note2 = c._ground_optional_lead_facts(far)
    assert kept2.location == "" and "Location left empty" in note2
    same, none = c._ground_optional_lead_facts(lead.model_copy(update={"size": ""}))
    assert same.location == "Springfield, NY, USA" and none == ""


def test_an_email_on_another_domain_is_accepted_when_the_businesss_own_page_prints_it():
    # owner, 2026-09-30: shopcityspf.com on shopcity.us, sweetcorner.org on the .com site -- "yes"
    policy = Policy(PolicyConfig(), PublishConfig(), Denylist(), leads=LeadsConfig(enabled=True, database_id="ds", max_per_day=3))
    printed = ctx(recent_page_texts={SITE: HOME_TEXT, CONTACT: CONTACT_TEXT + " Orders: sandra@acmebakery-spf.example"})
    assert policy.check(lead(email="sandra@acmebakery-spf.example"), printed).allowed
    assert "does not appear on any page" in policy.check(lead(email="sandra@acmebakery-spf.example"), ctx()).reason  # not printed: refused
    assert "personal mailbox" in policy.check(lead(email="acmebakery@gmail.com"), printed).reason  # a free mailbox stays refused


def test_an_undeliverable_email_stops_the_lead_and_a_good_one_is_noted_on_the_row(cfg):
    from explorer.notion import FakeNotion
    from conftest import make_controller

    cfg.leads.enabled = True
    cfg.leads.email_verify_key_file = "/nonexistent/key"
    notion = FakeNotion()
    c = make_controller(cfg, leads_notion=notion)
    c.memory.start_episode(None); ep = c.memory.current_episode()
    c._verify_lead_email = lambda email: {"result": "invalid", "reason": "rejected_email", "at": "2026-10-02T10:00:00"}
    r = c._execute_lead(lead(), ep)
    assert not r.ok and "does not take mail" in r.summary and notion.rows == []
    c._verify_lead_email = lambda email: {"result": "valid", "reason": "accepted_email", "accept_all": False, "at": "2026-10-02T10:00:00"}
    assert c._execute_lead(lead(), ep).ok and notion.rows[0]["Email check"] == "deliverable, checked 2026-10-02"
