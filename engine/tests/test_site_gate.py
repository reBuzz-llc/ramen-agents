"""The Lead Gen site gate ([site_gate]): one judge verdict per domain; a page that is not a business's own site loses its
text (links kept) and the verdict is cached."""
import json

from explorer.browser import Link, PageView
from explorer.controller import parse_site_verdict
from explorer.model import FakeModel

from conftest import make_controller


class JudgeModel(FakeModel):
    def __init__(self, answer: str):
        self.answer, self.calls = answer, 0

    def complete(self, system: str, prompt: str) -> str:
        self.calls += 1
        return self.answer


def _page(url: str, text: str = "Best 50 restaurants in SPF ranked " * 30) -> PageView:
    return PageView(url=url, title="A page", text=text, links=[Link(number=1, text="Joe's Pizza", url="https://joespizza.example/")])


def test_parse_site_verdict_is_lenient():
    assert parse_site_verdict('{"smb_own_site": false, "why": "a ranking article"}') == {"smb_own_site": False, "why": "a ranking article"}
    assert parse_site_verdict('Sure! {"smb_own_site": "true", "why": "restaurant site"} hope this helps') == {"smb_own_site": True, "why": "restaurant site"}
    assert parse_site_verdict("smb_own_site: no")["smb_own_site"] is False
    assert parse_site_verdict("") is None and parse_site_verdict("I cannot tell") is None


def test_gate_skips_text_keeps_links_and_caches(cfg, tmp_path):
    cfg.site_gate.enabled = True
    cfg.site_gate.judge = "chain"
    cfg.site_gate.cache_file = str(tmp_path / "smb-gate.json")
    judge = JudgeModel('{"smb_own_site": false, "why": "a directory of restaurants"}')
    c = make_controller(cfg, model=judge)
    result = c._after_nav(_page("https://www.eater.com/spf/best-restaurants"), "opened")
    assert result.ok and "text skipped" in result.summary
    assert c.page.text.startswith("[skipped: not a small business's own site: a directory of restaurants]")
    assert [l.url for l in c.page.links] == ["https://joespizza.example/"]  # the hop to a business survives
    assert "follow one" in (result.feedback or "")
    cache = json.loads((tmp_path / "smb-gate.json").read_text())
    assert cache["eater.com"]["smb_own_site"] is False and cache["eater.com"]["by"] == cfg.agent.name
    c._after_nav(_page("https://eater.com/spf/another-list"), "opened")
    assert judge.calls == 1  # judged once per domain


def test_gate_lets_own_sites_search_results_and_board_domains_through(cfg, tmp_path):
    cfg.site_gate.enabled = True
    cfg.site_gate.judge = "chain"
    cfg.site_gate.cache_file = str(tmp_path / "smb-gate.json")
    judge = JudgeModel('{"smb_own_site": true, "why": "a pizzeria presenting its menu"}')
    c = make_controller(cfg, model=judge)
    page = _page("https://joespizza.example/", "Joe's Pizza, Carmine Street. Slices since 1975. Order online.")
    assert c._after_nav(page, "opened").ok and c.page.text.startswith("Joe's Pizza")
    assert judge.calls == 1
    c._after_nav(_page("http://127.0.0.1:8888/search?q=spf+bakeries"), "searched")
    c._after_nav(_page("https://duckduckgo.com/?q=spf+bakeries"), "searched")
    assert judge.calls == 1  # search results and localhost are never judged


def test_gate_fails_open_when_no_judge_answers(cfg, tmp_path):
    cfg.site_gate.enabled = True
    cfg.site_gate.judge = "chain"
    cfg.site_gate.cache_file = str(tmp_path / "smb-gate.json")
    judge = JudgeModel("")
    c = make_controller(cfg, model=judge)
    page = _page("https://www.eater.com/spf/best-restaurants")
    c._after_nav(page, "opened")
    assert c.page.text == page.text and not (tmp_path / "smb-gate.json").exists()


def test_gate_off_by_default(cfg):
    c = make_controller(cfg, model=JudgeModel('{"smb_own_site": false, "why": "x"}'))
    page = _page("https://www.eater.com/spf/best-restaurants")
    c._after_nav(page, "opened")
    assert c.page.text == page.text
