import datetime as dt

import signals
from sources import LeadRow


def _row(**kw):
    base = dict(page_id="p", url="", business="Joe's Pizza", website="https://joes.com", email="hi@joes.com", location="",
                industry="Pizzeria", company_size="", pain_point="", how_we_help="Acme POS & Ordering", evidence="", stage="",
                found_on=None, source_pages="", found_by="", created="", edited="", founded_by="Joe",
                email_check="deliverable, checked 2026-10-07")
    base.update(kw)
    return LeadRow(**base)


def test_the_site_is_read_for_facts_only():
    html = ('<html><head><script src="https://static.wixstatic.com/x.js"></script></head><body>'
            '<a href="/files/menu-2019.pdf">Menu</a><a href="https://www.doordash.com/store/joes">Order</a>© 2019 Joe\'s</body></html>')
    sig = signals.read_site("https://joes.com", get=lambda u: (200, html, "http://joes.com/"))
    assert sig["tools"] == ["Delivery apps", "Wix"] and not sig["https"] and not sig["phone_ready"]
    assert sig["copyright"] == 2019 and sig["pdf_menu"]
    text = signals.health_text(sig, dt.date(2026, 10, 14))
    assert "no https" in text and "not set up for phones" in text and "© 2019" in text and "PDF menu" in text
    s = signals.score(_row(), sig, draft_ok=True, pain_ok=True, today=dt.date(2026, 10, 14))
    assert s == 35 + 0 + round(23 * 25 / 35) + 15                      # fit 35, means 0, reach 16, ready 15
    assert signals.score(_row(website=""), {}, draft_ok=False, pain_ok=False, today=dt.date(2026, 10, 14)) == 21 + 16 + 5
    rich = dict(sig, tools=["Toast", "Meta Pixel"])
    assert signals.score(_row(company_size="~11 locations"), rich, draft_ok=True, pain_ok=True, today=dt.date(2026, 10, 14)) == round(34 * 0.7) + (10 + 7 + 5) + 16 + 15   # Toast ends the "no ordering" and template gaps
    assert signals.score(_row(industry="Dental practice", business="Canal Dental Group"), sig, draft_ok=True, pain_ok=True,
                         today=dt.date(2026, 10, 14)) == 35 + 5 + 16 + 15   # a practice with no online booking: full fit, plus a high-value trade
    assert signals.read_site("https://joes.com", get=lambda u: (404, "", u)) == {"status": 404}
