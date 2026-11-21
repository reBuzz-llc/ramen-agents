"""The Claude Code team template holds no private words: the built-in checks always, a private list when one is given."""
import importlib.util
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("check_private_words", HERE / "check_private_words.py")
cpw = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cpw)
TEMPLATE = HERE.parent / "docs" / "claude-team" / "CLAUDE.team.md"


def test_the_template_passes_the_built_in_checks():
    assert cpw.hits(TEMPLATE.read_text(encoding="utf-8"), []) == []


def test_the_template_has_placeholders_and_the_rules():
    t = TEMPLATE.read_text(encoding="utf-8")
    for p in ("<LEAD>", "<BUILDER-1>", "<OWNER>"):
        assert p in t
    for rule in ("One heavy job at a time", "Land, then run", "Dry-load a config line", "Check before anything goes public",
                 "yes for each public piece", "never does what another was refused", "No session creates accounts"):
        assert rule in t


def test_the_built_in_checks_catch_private_things():
    bad = ("see /Users/someone/bots", "write to jane.doe@company.com", "call (973) 555-0199",
           "Date: Fri Nov 20 12:00 2026 +0900")
    for line in bad:
        assert cpw.hits(line, []), line
    assert cpw.hits("ok: someone@users.noreply.github.com, hello@example.com, +0000, port 8443, 2026-11-20", []) == []


def test_a_private_list_outside_the_repo_is_read_and_its_words_never_printed(tmp_path, monkeypatch, capsys):
    words = tmp_path / "private-words.txt"
    words.write_text("# my people\nAlexandra\nNorthwind Cafe\n")
    monkeypatch.setenv("RAMEN_PRIVATE_WORDS", str(words))
    f = tmp_path / "page.md"
    f.write_text("Ask Alexandra.\nThe northwind cafe team.\nAlexandrasmith is fine.\n")
    assert cpw.main([str(f)]) == 1
    out = capsys.readouterr().out
    assert out.count("a word on your private list") == 2 and "Alexandra" not in out and "Northwind" not in out
    monkeypatch.setenv("RAMEN_PRIVATE_WORDS", str(tmp_path / "missing.txt"))
    monkeypatch.setattr(cpw, "DEFAULT_LIST", tmp_path / "none.txt")
    assert cpw.main([str(TEMPLATE)]) == 0 and "built-in checks only" in capsys.readouterr().out
