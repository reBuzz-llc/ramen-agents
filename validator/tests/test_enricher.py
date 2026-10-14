import datetime as dt

import enricher_list
import gate
from sources import LeadRow


def _row(pid, **kw):
    base = dict(page_id=pid, url="", business=f"B{pid}", website=f"https://b{pid}.com", email="", location="Queens, NY, USA",
                industry="Cafe", company_size="10 staff", pain_point="", how_we_help="", evidence="", stage="", found_on=None,
                source_pages="", found_by="", created=f"2026-10-0{pid}", edited="", founded_by="Ada Okafor")
    base.update(kw)
    return LeadRow(**base)


def test_the_list_puts_founders_first_and_rests_offered_rows():
    now = dt.datetime(2026, 10, 10, 9)
    full = dict(pain_point="Pain point: x\nThey can try: y\nWe propose: z", whatsapp="https://wa.me/1", map_url="https://maps.app.goo.gl/x", founder_linkedin="https://www.linkedin.com/in/ada")
    state = {"deleted_cells": {"3|Location": {"was": "Clifton, NY, USA", "to_enricher": True}}}
    leads = [_row("1", location="", **full), _row("2", founded_by="", **full), _row("3", location="", **full), _row("4", **full)]
    text, n = enricher_list.build(leads, state, now)
    lines = [ln for ln in text.splitlines() if ln.startswith("- ")]
    assert n == 3 and lines[0].startswith("- B3 |") and "deleted 'Clifton, NY, USA': not that" in lines[0]
    assert lines[1].startswith("- B2 |") and "missing: Contact person" in lines[1] and lines[2].startswith("- B1 |")
    assert enricher_list.build(leads, {}, now)[1] == 3 and "Pain point" in enricher_list.build([_row("5", **dict(full, pain_point=""))], {}, now)[0]
    st = {}
    enricher_list.build(leads, st, now)
    assert enricher_list.build(leads, st, now + dt.timedelta(days=1))[1] == 0          # offered rows rest a week
    assert enricher_list.build(leads, st, now + dt.timedelta(days=8))[1] == 3


def test_the_enricher_fills_only_its_cells():
    ok = {"type": "update_lead", "name": "Joe's Pizza", "founded_by": "Joe Russo", "location": "Queens, NY, USA"}
    assert not [r for r in gate.check("update_lead", ok, bot="Lead Enricher") if r.startswith("EN01")]
    assert gate.check("update_lead", dict(ok, how_we_help="Acme ERP"), bot="Lead Enricher")[0].startswith("EN01")
    assert not [r for r in gate.check("update_lead", dict(ok, whatsapp="https://wa.me/17185550100"), bot="Lead Enricher") if r.startswith("EN01")]
    assert gate.check("lead", dict(ok, type="lead"), bot="Lead Enricher")[0].startswith("EN01")


def test_a_fill_is_fact_checked_against_the_pages():
    import enricher_check
    page = "<html><body><h1>About us</h1><p>Founded in 2012 by Joe Russo in Astoria, Queens. 12 staff.</p></body></html>"
    get = lambda url: (200, page)  # noqa: E731
    ok = {"payload": {"founded_by": "Joe Russo", "location": "Queens, NY, USA", "size": "12 staff", "sources": ["https://joes.com/about"]}}
    assert enricher_check.check_fill(ok, "https://joes.com", get=get) == []
    bad = {"payload": {"founded_by": "Maria Russo", "location": "Brooklyn, NY, USA", "sources": ["https://joes.com/about"]}}
    assert {f for f, _ in enricher_check.check_fill(bad, "https://joes.com", get=get)} == {"founded_by", "location"}
    assert enricher_check.check_fill(bad, "https://joes.com", get=lambda u: (404, "")) == []     # unreadable: not wrong


def test_a_linkedin_from_the_own_site_must_be_linked_there():
    import enricher_check
    page = '<p>Founded by Joe Russo <a href="https://www.linkedin.com/in/joe-russo-123/">LinkedIn</a></p>'
    fill = {"payload": {"founded_by": "Joe Russo", "founder_linkedin": "https://www.linkedin.com/in/joe-russo-123", "linkedin_via": "1 Own site", "sources": ["https://joes.com/about"]}}
    assert enricher_check.check_fill(fill, "https://joes.com", get=lambda u: (200, page)) == []
    other = dict(fill, payload=dict(fill["payload"], founder_linkedin="https://www.linkedin.com/in/someone-else"))
    assert [f for f, _ in enricher_check.check_fill(other, "https://joes.com", get=lambda u: (200, page))] == ["founder_linkedin"]
