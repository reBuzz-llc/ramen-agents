import datetime as dt

import okr_progress
from sources import LeadRow

TEXT = """# This week's objective (2026-10-13 to 2026-10-19) -- PROPOSED, the owner edits

Objective: the first replies.

Key results (what counts, measured on the Leads board):
1. The team sends 30 drafted emails by hand (Status "Email Sent").
2. 3 rows reach Result = Replied, Meeting or Client.
3. Every row with a reply has its Contact person and Contact role filled.

Every instruction names the key result it serves.
"""


def _row(pid, **kw):
    base = dict(page_id=pid, url="", business="B", website="", email="", location="", industry="", company_size="", pain_point="",
                how_we_help="", evidence="", stage="", found_on=None, source_pages="", found_by="", created="", edited="2026-10-14T10:00")
    base.update(kw)
    return LeadRow(**base)


def test_progress_lines_go_under_each_key_result_and_the_owner_text_stays(monkeypatch, tmp_path):
    monkeypatch.setattr(okr_progress, "SIGNALS", tmp_path / "none.json")
    leads = [_row("a", status="Email Sent"), _row("b", status="Email Sent", result="Replied", founded_by="Joe", contact_role="Owner")]
    now = dt.datetime(2026, 10, 14, 9, 30)
    out = okr_progress.update(TEXT, leads, now)
    assert "   Progress (2026-10-14 09:30): 2 rows marked Email Sent this week (2 in total) -- target 30." in out
    assert "1 rows at Replied, Meeting or Client -- target 3." in out
    assert "0 of 1 replied rows have Contact person" in out                  # no Lead score yet
    again = okr_progress.update(out, leads, now + dt.timedelta(hours=6))
    assert again.count("Progress (") == 3 and "15:30" in again               # replaced, not added
    assert [ln for ln in again.splitlines() if "Progress" not in ln] == TEXT.rstrip("\n").splitlines()


def test_a_finished_week_is_archived_and_a_template_left(monkeypatch, tmp_path):
    monkeypatch.setattr(okr_progress, "FOLDER", tmp_path)
    monkeypatch.setattr(okr_progress, "OKR", tmp_path / "okr-week.md")
    monkeypatch.setattr(okr_progress, "SIGNALS", tmp_path / "none.json")
    (tmp_path / "okr-week.md").write_text(TEXT)
    okr_progress.run([], dt.datetime(2026, 10, 20, 8, 0))
    assert (tmp_path / "okr-2026-10-13.md").exists()
    new = (tmp_path / "okr-week.md").read_text()
    assert "(2026-10-20 to 2026-10-26)" in new and "Progress" not in new
