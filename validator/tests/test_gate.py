"""The write-time gate: the Validator's rules, pure, on the engine's action payloads."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import gate  # noqa: E402

GOOD_LEAD = {"type": "lead", "name": "Sunny Deli", "website": "https://sunnydeli-example.com", "email": "hello@sunnydeli-example.com",
             "pain_point": "No online ordering; the menu is a PDF.", "how_we_help": "Site and App Care",
             "evidence": "https://sunnydeli-example.com/menu", "location": "Detroit, Michigan, USA", "industry": "restaurant",
             "size": "3 locations", "sources": ["https://sunnydeli-example.com/contact"]}


def test_a_grounded_lead_passes():
    assert gate.check("lead", GOOD_LEAD, bot="lead-gen") == []


def test_a_hallucinated_lead_is_refused_with_reasons():
    """The fence still refuses (another site's evidence, a directory as website, a personal mailbox); shape rules
    (location, size) are flag-only since 2026-10-03 and do not stop the write."""
    bad = dict(GOOD_LEAD, location="Michigan", size="A fast-growing family business", evidence="https://yelp.com/biz/holy-molli")
    rules = {r.split(":")[0] for r in gate.check("lead", bad, bot="lead-gen")}
    assert rules == {"LD02"}, rules
    rules = {r.split(":")[0] for r in gate.check("lead", dict(GOOD_LEAD, email="x@gmail.com", website="https://yelp.com/biz/x"), bot="lead-gen")}
    assert {"LD01", "LD14"} <= rules, rules


def test_update_lead_judges_only_the_fields_written():
    assert gate.check("update_lead", {"type": "update_lead", "name": "Sunny Deli", "founded_by": "Jane Ross"}) == []
    r = gate.check("update_lead", {"type": "update_lead", "name": "Sunny Deli", "founded_by": "See website for franchise details"})
    assert len(r) == 1 and r[0].startswith("LD15")                       # an invented founder: the fence
    assert gate.check("update_lead", {"type": "update_lead", "name": "Sunny Deli", "location": "USA"}) == []   # LD07 flag-only
    assert gate.check("update_lead", {"type": "update_lead", "name": "Sunny Deli", "location": ""}) == []


def test_task_rules():
    """Task shape (title, priority, details, Done when) is quality: flag-only since 2026-10-03."""
    weak = {"type": "task", "title": "Follow up", "priority": "urgent", "assignee": "Nobody Known", "details": "short", "due": "2099-01-01"}
    assert gate.check("task", weak, bot="the-ceo") == []
    assert gate.check("update_task", {"type": "update_task", "title": "x", "priority": "high"}) == []


def test_publish_package_wrapper_rules():
    """The pitch's shape (greeting, deliverables, sign-off, conclusion) is quality: flag-only since 2026-10-03."""
    assert gate.check("publish_package", {"type": "publish_package", "name": "Website Care Basic",
                                          "title": "Website Care Basic", "email": "Buy now.", "conclusion": ""}, bot="the-ceo") == []


def test_unknown_actions_and_odd_payloads_are_ignored():
    assert gate.check("message", {"to": "Lead Gen"}) == []
    assert gate.check("lead", "not a dict") == []       # type: ignore[arg-type]
    assert gate.check("lead", {}) != []                 # an empty lead is refused, not crashed on


def test_the_direction_is_a_goal_not_a_rule():
    """MG02 (audience) moved to the after-the-fact review on 2026-10-03: no write-time question for a package."""
    assert gate.questions("publish_package", {"type": "publish_package", "name": "X", "title": "Y", "email": "Hi"}) == []


def test_gate3_questions_are_owner_text_with_short_context():
    assert gate.questions("message", {"to": "x"}) == []
    assert gate.questions("update_task", {"title": "x", "priority": "P2"}) == []        # no question for it: fast []
    q = gate.questions("task", {"type": "task", "title": "Call Eastside bakeries", "assignee": "Jo", "details": "x" * 5000},
                       bot="the-ceo", open_tasks=["Email Northside hardware stores"])
    assert [x["id"] for x in q] == ["MG01"]   # a call by a team member is human work: no MG04 question and "Open tasks" in q[0]["context"] and len(q[0]["context"]) <= gate.CONTEXT_MAX
    q = gate.questions("update_lead", {"type": "update_lead", "name": "Sunny Deli", "founded_by": "Jane Ross"}, page_text="Founded by Jane Ross in 2019.")
    assert [x["id"] for x in q] == ["MG03"] and "Jane Ross in 2019" in q[0]["context"]


def test_an_update_is_not_refused_for_fields_it_leaves_out():
    assert gate.check("update_lead", {"type": "update_lead", "name": "Sunny Deli", "evidence": "https://sunnydeli-example.com/locations",
                                      "location": "Greenville, SC, USA"}) == []
    # a field it does write is still judged
    assert gate.check("update_lead", {"type": "update_lead", "name": "Sunny Deli", "evidence": "not a url"})[0].startswith("LD02")


def test_the_ceo_picking_a_package_is_judged_by_name_not_by_page(monkeypatch):
    monkeypatch.setattr(gate, "package_names", lambda: ["Acme POS", "Website Care Basic"])
    pick = {"type": "update_lead", "name": "Sunny Deli", "how_we_help": "Acme POS"}
    assert gate.check("update_lead", pick, bot="the-ceo") == []
    assert gate.questions("update_lead", pick, bot="the-ceo") == []            # no MG03: a sales judgement
    bad = gate.check("update_lead", dict(pick, how_we_help="POS system package"), bot="the-ceo")
    assert len(bad) == 1 and bad[0].startswith("LD03") and "did you mean 'Acme POS'" in bad[0] and "Accepted:" in bad[0]
    # a fact written alongside is still judged by MG03, without the package in its context
    q = gate.questions("update_lead", dict(pick, location="Greenville, SC, USA"), bot="the-ceo", page_text="...")
    assert [x["id"] for x in q] == ["MG03"] and "Acme POS" not in q[0]["context"]


def test_mg03_judges_only_page_facts_not_the_email():
    lead = {"type": "lead", "name": "Oven Corner", "website": "https://ovencorner-example.com", "email": "support@ovencorner-example.com",
            "evidence": "https://ovencorner-example.com/contact", "pain_point": "old site", "how_we_help": "Website Care Basic"}
    assert gate.questions("lead", lead, page_text="...") == []                 # no page fact written: no MG03 call
    q = gate.questions("lead", dict(lead, location="Northside, NY, USA"), page_text="123 Bedford Ave, Northside, NY 11211")
    assert [x["id"] for x in q] == ["MG03"] and "support@" not in q[0]["context"] and "Northside, NY, USA" in q[0]["context"]


def test_mg03_never_sees_industry_or_absent_fields():
    lead = {"type": "lead", "name": "Kitchen Bronx", "website": "https://k.com", "email": "hi@k.com", "industry": "Caterers"}
    assert gate.questions("lead", lead, page_text="...") == []               # industry alone: no question
    q = gate.questions("lead", dict(lead, location="Bronx, NY, USA"), page_text="...")
    ctx = q[0]["context"]
    assert "Caterers" not in ctx and '"location"' in ctx and "founded_by\"" not in ctx
    assert "never answer no because" in q[0]["question"]


def test_one_offer_one_toggle(monkeypatch):
    # a project names its products in [validator.offers]; these two stand in for one
    monkeypatch.setattr(gate, "_OFFERS", {"mvp": r"\bmvp\b|starter", "website care": r"website (care|maintenance)|site care"})
    page = {"fixed-price mvp development for spf smbs": {"title": "Fixed-Price MVP Development for SPF SMBs – $30,000"},
            "website care basic": {"title": "Website Care Basic – $299 - $599/month"},
            "site and app care": {"title": "Site and App Care – $1,200-$2,000 per month"}}
    # a new MVP name for the same offer is refused; republishing the same package is not
    assert "Fixed-Price MVP" in gate.duplicate_offer("Starter Pack", "Starter Pack – $25,000", page)
    assert gate.duplicate_offer("Fixed-Price MVP Development for SPF SMBs", "new headline – $25,000", page) == ""
    assert "Website Care Basic" in gate.duplicate_offer("Website Care for SPF SMBs", "Website Care – $299/month", page)
    # different offers pass
    assert gate.duplicate_offer("Acme ERP", "Acme ERP for franchise chains", page) == ""
    assert gate.duplicate_offer("AI-Powered Website Enhancement", "AI-Powered Website Enhancement – $1,450", page) == ""


def test_outreach_tasks_are_human_work_without_asking_the_model():
    ids = lambda p: [q["id"] for q in gate.questions("task", p, bot="the-ceo", open_tasks=[])]  # noqa: E731
    assert ids({"type": "task", "title": "Outreach: Harbor Restaurant and 4 more", "details": "x"}) == ["MG01"]
    assert ids({"type": "task", "title": "Follow up with Noodle Bar One for a meeting with Alex", "details": "x"}) == ["MG01"]
    assert ids({"type": "task", "title": "Identify SPF SMB leads and their emails", "details": "x"}) == ["MG01", "MG04"]


def test_a_task_about_a_validator_flag_is_refused():
    r = gate.check("task", {"type": "task", "title": "Fix CEO-121 Task Format Checklist Items", "details": "x"}, bot="the-ceo")
    assert any(x.startswith("MG04") and "update_task" in x for x in r), r
    assert gate.check("task", {"type": "task", "title": "Outreach: Harbor Restaurant and 4 more", "details": "x"}, bot="the-ceo") == []


def test_research_for_a_person_is_refused_as_family_work():
    r = gate.check("task", {"type": "task", "title": "Organize Trending AI Agent Services by Category for Local Clients",
                            "assignee": "Alex Stone"})
    assert any(x.startswith("MG04") for x in r)
    assert not gate.family_work({"title": "Outreach: Sweet Corner and 4 more"})
    assert not gate.family_work({"title": "Call Poplar Books about the menu"})


def test_research_deliverables_for_a_person_are_family_work():
    """Owner, 2026-10-07: "ceoA is creating way to many task related to research and findings"."""
    for t in ("Draft AI Agent Services Client Advisory Guide for Local Shops", "Update Notion Pages with Trending AI Agent Services",
              "Build a Local Shop Target List for Custom AI Agent Services", "Develop AI Agent Service Offerings for Local Shops"):
        assert gate.family_work({"title": t}), t
    for t in ("Outreach: Sweet Corner and 9 more", "Send the AI agent proposal to Harbor Restaurant", "Review and sign the Harbor proposal"):
        assert not gate.family_work({"title": t}), t


def test_a_deliverable_for_a_meeting_or_a_person_stays_human_work():
    for t in ("Prepare presentation for the Sweet Corner meeting", "Review the package strategy with the owner",
              "Create marketing materials for the trade show", "Create a Canva presentation for the client pitch"):
        assert not gate.family_work({"title": t}), t
    assert gate.family_work({"title": "Develop AI Agent Service Offerings for Local Shops"})
    assert gate.family_work({"title": "Update Notion Pages with Trending AI Agent Services"})


def test_the_research_analyst_never_writes_to_the_board():
    r = gate.check("task", {"type": "task", "title": "Outreach: Sweet Corner"}, bot="research-analyst")
    assert r and r[0].startswith("RA05")
    assert not any(x.startswith("RA05") for x in gate.check("task", {"type": "task", "title": "Outreach: Sweet Corner"}, bot="the-ceo"))


def test_the_outreach_writer_only_fills_its_own_cell(monkeypatch):
    import checks
    monkeypatch.setattr(checks, "DRAFT_SIGNOFF", ["Regards,", "Alex", "-- Acme LLC"])
    ok = "Hi Sweet Corner team,\n\nYour contact form returns an error.\n\nRegards,\nAlex\n-- Acme LLC"
    assert gate.check("update_lead", {"type": "update_lead", "business": "Sweet Corner", "draft_email": ok}, bot="outreach-writer") == []
    r = gate.check("update_lead", {"type": "update_lead", "name": "Sweet Corner", "draft_email": ok, "stage": "Emailed"}, bot="outreach-writer")
    assert r and r[0].startswith("OW07")
    assert gate.check("task", {"type": "task", "title": "Outreach: Sweet Corner"}, bot="outreach-writer")[0].startswith("OW07")
    r = gate.check("update_lead", {"type": "update_lead", "name": "Sweet Corner", "draft_email": ok.replace("Alex\n", "")}, bot="outreach-writer")
    assert any(x.startswith("OW01") for x in r)


def test_the_daily_review_of_drafts_is_the_teams():
    for t in ("Review the drafted outreach list for today", "Review drafted outreach emails for 12 local businesses",
              "Review and approve 10 outreach drafts"):
        assert not gate.family_work({"title": t}), t
        assert gate.human_task({"title": t}), t


def test_a_whatsapp_number_not_shaped_as_a_wa_me_link_is_refused():
    r = gate.check("update_lead", {"type": "update_lead", "name": "Sweet Corner", "whatsapp": "+1 212 555 0100"})
    assert r and r[0].startswith("LD20")
    assert gate.check("update_lead", {"type": "update_lead", "name": "Sweet Corner", "whatsapp": "https://wa.me/12125550100"}) == []


def test_a_number_the_team_ruled_out_is_refused(monkeypatch):
    import whatsapp_false
    monkeypatch.setattr(whatsapp_false, "ruled_out", lambda: {"12125550100": {"business": "Sweet Corner"}})
    r = gate.check("update_lead", {"type": "update_lead", "name": "Sweet Corner", "whatsapp": "https://wa.me/12125550100"})
    assert r and r[0].startswith("LD20") and "not on WhatsApp" in r[0]
    assert gate.check("update_lead", {"type": "update_lead", "name": "Sweet Corner", "whatsapp": "https://wa.me/12125550199"}) == []
