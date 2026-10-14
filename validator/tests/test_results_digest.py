import datetime as dt

import results_digest
from results_digest import build
from sources import LeadRow


def _row(**kw):
    base = dict(page_id="p", url="", business="B", website="", email="", location="Brooklyn, NY, USA", industry="Cafe",
                company_size="", pain_point="", how_we_help="Acme POS & Ordering", evidence="", stage="New", found_on=None,
                source_pages="", found_by="", created="", edited="")
    base.update(kw)
    return LeadRow(**base)


def test_no_results_yet_says_so_and_nothing_else(tmp_path, monkeypatch):
    monkeypatch.setattr(results_digest, "SENT_LOG", tmp_path / "none.jsonl")
    text = build([_row(status="Email Sent"), _row()], dt.date(2026, 10, 12))
    assert "- results | none yet |" in text and "1 emails sent" in text and "reply rate" not in text


def test_rates_openings_and_bounces(tmp_path, monkeypatch):
    monkeypatch.setattr(results_digest, "SENT_LOG", tmp_path / "none.jsonl")
    rows = [_row(business="A", result="Replied", result_date="2026-10-10",
                 draft_email="Hi Maria,\n\nYour menu is a PDF from 2019. More text.\n\nRegards,\nAlex"),
            _row(business="C", result="Emailed", result_date="2026-10-01", how_we_help="Acme ERP", location="Queens, NY, USA"),
            _row(business="D", result="Bounced", result_date="2026-10-11")]
    text = build(rows, dt.date(2026, 10, 12))
    assert "- sent | this week | 2" in text and "- sent | in total | 3 of 3 rows" in text
    assert "- reply rate by package | Acme POS & Ordering | 1 of 2 replied (50%)" in text
    assert "- reply rate by area | Queens | 0 of 1 replied (0%)" in text
    assert "- opening that got an answer | Replied | Acme POS & Ordering | Your menu is a PDF from 2019." in text
    assert "- bounces | bounced | 1 (D)" in text
