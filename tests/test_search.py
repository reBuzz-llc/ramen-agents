"""Search with fallbacks and a pause shared across bots."""
from __future__ import annotations

import json
from pathlib import Path

import httpx
import pytest

from explorer.actions import Search
from explorer.browser import FakeBrowser, Link, PageView, error_page, rate_limit_error
from explorer.config import validate
from explorer.model import Decision, ModelResult
from explorer.search import (
    SearchPause,
    SearchSettings,
    Searcher,
    api_user_agent,
    hn_search,
    load_marginalia_api_key,
    marginalia_search,
    settings_from_config,
    wikipedia_search,
)

from conftest import FAKE_WEB, make_controller


class Clock:
    def __init__(self, t: float = 1000.0):
        self.t = t

    def __call__(self) -> float:
        return self.t


def test_pause_is_shared_through_the_file_and_expires(tmp_path: Path):
    clock = Clock()
    a = SearchPause(tmp_path / "pause.json", clock)
    b = SearchPause(tmp_path / "pause.json", clock)  # a second bot on the same Mac
    assert a.available(["browser", "wikipedia"]) == ["browser", "wikipedia"]
    a.pause("browser", 300)
    assert b.available(["browser", "wikipedia"]) == ["wikipedia"]
    assert b.paused_until("browser") == 1300.0
    assert b.seconds_until_any(["browser", "wikipedia"]) == 0.0
    b.pause("wikipedia", 60)
    assert a.available(["browser", "wikipedia"]) == []
    assert a.seconds_until_any(["browser", "wikipedia"]) == 60.0
    clock.t = 1061.0
    assert a.available(["browser", "wikipedia"]) == ["wikipedia"]
    a.pause("wikipedia", 10)  # a shorter new pause never shortens an existing longer one
    a.pause("browser", 1)
    assert a.paused_until("browser") == 1300.0
    assert not (tmp_path / "pause.json").read_text().count("nonsense")


def test_pause_survives_a_missing_or_broken_file(tmp_path: Path):
    p = SearchPause(tmp_path / "missing" / "pause.json")
    assert p.available(["x"]) == ["x"]
    (tmp_path / "bad.json").write_text("{not json")
    assert SearchPause(tmp_path / "bad.json").available(["x"]) == ["x"]


class RateLimitedBrowser(FakeBrowser):
    def search(self, query):
        return error_page("https://search.example/?q=" + query, rate_limit_error(429))


def results(query: str) -> PageView:
    return PageView(url="https://alt.example/?q=" + query, title="alt results", text=f"[1] Something about {query}",
                    links=[])


def make_searcher(tmp_path: Path, browser, engines, clock=None, extra=None) -> Searcher:
    settings = SearchSettings(engines=engines, pause_file=tmp_path / "pause.json", rate_limit_minutes=5, bot_check_minutes=30)
    return Searcher(browser, settings, SearchPause(settings.pause_file, clock or Clock()), extra_engines=extra or {})


def test_searcher_falls_through_to_the_next_engine_and_pauses_the_first(tmp_path: Path):
    calls: list[str] = []

    def alt(query: str) -> PageView:
        calls.append(query)
        return results(query)

    searcher = make_searcher(tmp_path, RateLimitedBrowser(FAKE_WEB), ["browser", "alt"], extra={"alt": alt})
    outcome = searcher.search("moss")
    assert outcome.engine == "alt" and outcome.page.ok and outcome.fell_back
    assert outcome.paused == [("browser", "rate limit", 5)]
    assert calls == ["moss"]
    # The next search skips the paused engine entirely.
    outcome = searcher.search("tides")
    assert outcome.engine == "alt" and outcome.paused == []
    assert searcher.pause.available(["browser"]) == []


def test_searcher_reports_when_every_engine_is_paused(tmp_path: Path):
    def also_limited(query: str) -> PageView:
        return error_page("https://alt.example/", rate_limit_error(503))

    searcher = make_searcher(tmp_path, RateLimitedBrowser(FAKE_WEB), ["browser", "alt"], extra={"alt": also_limited})
    outcome = searcher.search("moss")
    assert outcome.engine == "" and not outcome.page.ok
    assert [p[0] for p in outcome.paused] == ["browser", "alt"]
    outcome = searcher.search("moss")
    assert "every search engine is paused" in (outcome.page.error or "")


def test_an_engine_with_no_results_hands_the_query_to_the_next_one_without_a_pause(tmp_path: Path):
    def nothing(query: str) -> PageView:
        return PageView(url="https://small.example/?q=" + query, title="small", text="(no results)", links=[])

    def found(query: str) -> PageView:
        return PageView(url="https://big.example/?q=" + query, title="big", text="[1] hit",
                        links=[Link(1, "hit", "https://big.example/hit")])

    searcher = make_searcher(tmp_path, FakeBrowser(FAKE_WEB), ["small", "big"], extra={"small": nothing, "big": found})
    outcome = searcher.search("offshore agencies")
    assert outcome.engine == "big" and outcome.empty == ["small"] and outcome.paused == []
    assert searcher.pause.available(["small", "big"]) == ["small", "big"]
    # When nobody has anything, the first empty page is the answer, not an error.
    searcher = make_searcher(tmp_path, FakeBrowser(FAKE_WEB), ["small", "also"], extra={"small": nothing, "also": nothing})
    outcome = searcher.search("zzzz")
    assert outcome.page.ok and outcome.engine == "also" and outcome.empty == ["small"]
    # An empty page also beats a later engine's rate limit.
    limited = lambda q: error_page("https://x.example/", rate_limit_error(429))  # noqa: E731
    searcher = make_searcher(tmp_path / "b", FakeBrowser(FAKE_WEB), ["small", "limited"], extra={"small": nothing, "limited": limited})
    outcome = searcher.search("zzzz")
    assert outcome.page.ok and outcome.engine == "small" and outcome.paused == [("limited", "rate limit", 5)]


def test_marginalia_search_builds_a_results_page_and_pauses_on_the_shared_quota():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.host == "api2.marginalia-search.com" and request.url.params["query"] == "fresnel lens"
        assert request.headers["api-key"] == "public" and request.url.params["nsfw"] == "0"
        return httpx.Response(200, json={"license": "CC-BY-NC-SA 4.0", "results": [
            {"url": "https://lighthouse.example/fresnel", "title": "Fresnel lenses", "description": "Rings of <b>glass</b>"},
            {"url": "https://untitled.example/", "title": "", "description": ""},
            {"url": "ftp://old.example/", "title": "not http"},
        ]})

    page = marginalia_search(httpx.Client(transport=httpx.MockTransport(handler)), "fresnel lens")
    assert page.ok and page.title == "Marginalia search results for 'fresnel lens'"
    assert [l.url for l in page.links] == ["https://lighthouse.example/fresnel", "https://untitled.example/"]
    assert "[1] Fresnel lenses: Rings of glass" in page.text
    over = marginalia_search(httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(429, text="QPM Limit Exceeded"))), "x")
    assert not over.ok and "rate-limiting" in (over.error or "")


def test_marginalia_key_comes_from_env_then_file_then_public(tmp_path: Path, monkeypatch):
    monkeypatch.delenv("MARGINALIA_API_KEY", raising=False)
    assert load_marginalia_api_key(tmp_path / "missing") == "public"
    (tmp_path / "key").write_text("mine\n")
    assert load_marginalia_api_key(tmp_path / "key") == "mine"
    monkeypatch.setenv("MARGINALIA_API_KEY", "from-env")
    assert load_marginalia_api_key(tmp_path / "key") == "from-env"


def test_wikipedia_search_builds_a_results_page():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.params["list"] == "search" and request.url.params["srsearch"] == "fresnel lens"
        return httpx.Response(200, json={"query": {"search": [
            {"title": "Fresnel lens", "snippet": "A <span class=\"searchmatch\">Fresnel</span> lens is a type of composite compact lens"},
            {"title": "Augustin-Jean Fresnel", "snippet": "French civil engineer"},
        ]}})

    client = httpx.Client(transport=httpx.MockTransport(handler))
    page = wikipedia_search(client, "fresnel lens")
    assert page.ok and page.url == "https://en.wikipedia.org/w/index.php?search=fresnel+lens"
    assert "[1] Fresnel lens: A Fresnel lens is a type" in page.text
    assert page.links[0].url == "https://en.wikipedia.org/wiki/Fresnel_lens"
    assert page.links[1].url == "https://en.wikipedia.org/wiki/Augustin-Jean_Fresnel"
    limited = wikipedia_search(httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(429))), "x")
    assert not limited.ok and "rate-limiting" in (limited.error or "")
    refused = wikipedia_search(
        httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(403, text="Please respect our robot policy"))), "x"
    )
    assert not refused.ok and "agent.contact" in (refused.error or "")


def test_api_engines_send_a_bot_user_agent_with_the_contact(cfg):
    cfg.agent.name, cfg.agent.contact = "The CEO", "https://example.com"
    s = settings_from_config(cfg)
    assert s.api_user_agent.startswith("TheCEOExplorer/0.1 (https://example.com) httpx/")
    assert api_user_agent("Jobless-Bot", "") == api_user_agent("JoblessBot", "")
    assert "no contact configured" in api_user_agent("Jobless-Bot", "")
    seen: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request.headers["user-agent"])
        return httpx.Response(200, json={"query": {"search": []}})

    s.engines = ["wikipedia"]
    searcher = Searcher(None, s, SearchPause(cfg.workspace / "pause.json"))
    searcher.client = httpx.Client(transport=httpx.MockTransport(handler), headers=searcher.client.headers)
    assert searcher.search("x").engine == "wikipedia"
    assert seen == [s.api_user_agent]


def test_settings_from_config_keep_fake_mode_offline(cfg):
    s = settings_from_config(cfg)  # the test cfg is fake mode
    assert s.engines == ["browser"]
    assert s.pause_file == cfg.workspace / "search_pause.json"
    cfg.agent.mode = "web"
    s = settings_from_config(cfg)
    assert s.engines == ["searxng", "duckduckgo-mcp"]  # keyless engines only; no paid search plan
    assert s.pause_file.name == "search_pause.json" and "bots" not in str(s.pause_file)
    assert s.bot_check_minutes == cfg.policy.search_cooldown_minutes


def test_config_search_keys_reach_the_settings_and_are_validated(cfg):
    validate(cfg)  # the defaults: empty engines = the standard chain
    cfg.browser.search_engines = ["wikipedia"]
    cfg.browser.search_pause_file = "shared/pause.json"
    validate(cfg)
    s = settings_from_config(cfg)
    assert s.engines == ["wikipedia"] and s.pause_file == cfg.path("shared/pause.json")
    cfg.browser.search_engines = ["google"]
    with pytest.raises(ValueError, match="unknown engine"):
        validate(cfg)
    cfg.browser.search_engines = ["brave-api"]  # removed: the owner pays for no search plan
    with pytest.raises(ValueError, match="unknown engine"):
        validate(cfg)


class SearchingModel:
    def decide(self, system, obs):
        return ModelResult(decision=Decision(thought="search", action=Search(type="search", query="moss")))

    def complete(self, system, prompt):
        return "summary"


def test_controller_keeps_searching_through_the_fallback_and_shares_the_pause(cfg, tmp_path: Path):
    cfg.policy.search_rate_limit_cooldown_minutes = 5
    browser = RateLimitedBrowser(FAKE_WEB)
    searcher = make_searcher(cfg.workspace, browser, ["browser", "alt"], extra={"alt": results})
    controller = make_controller(cfg, model=SearchingModel(), browser=browser, searcher=searcher)
    controller.run(max_cycles=2)
    rows = controller.memory.db.query("SELECT verdict, result FROM actions ORDER BY id")
    assert rows[0]["verdict"] == "allowed"
    assert "browser is paused for 5 minutes (rate limit), so these results come from alt" in rows[0]["result"]
    assert rows[1]["verdict"] == "allowed"  # the policy still allows searching: an engine is available
    assert "(from alt; the usual engine is paused)" in rows[1]["result"]
    # Searching as a whole is not paused while alt answers; the state agrees with the policy.
    assert controller.search_paused_until == 0.0
    searcher.pause.pause("alt", 300)
    assert controller.search_paused_until > 0
    # A second bot reading the same pause file sees Brave paused too.
    other = make_searcher(cfg.workspace, FakeBrowser(FAKE_WEB), ["browser", "alt"], extra={"alt": results})
    assert other.pause.available(["browser"]) == []
    assert json.loads((cfg.workspace / "pause.json").read_text())["browser"] > 0


def test_hn_search_builds_a_results_page_linking_to_articles_or_threads():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.host == "hn.algolia.com" and request.url.params["query"] == "dev shops"
        return httpx.Response(200, json={"hits": [
            {"title": "Ask HN: Who hires offshore dev shops?", "url": "", "objectID": "42", "points": 120, "num_comments": 80},
            {"title": "How we chose an agency", "url": "https://blog.example/agency", "points": 5, "num_comments": 0},
            {"title": "", "url": "https://blog.example/untitled"},
        ]})

    page = hn_search(httpx.Client(transport=httpx.MockTransport(handler)), "dev shops")
    assert page.ok and page.title == "Hacker News results for 'dev shops'"
    assert [l.url for l in page.links] == ["https://news.ycombinator.com/item?id=42", "https://blog.example/agency"]
    assert "[1] Ask HN: Who hires offshore dev shops?: 120 points, 80 comments" in page.text
    limited = hn_search(httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(429))), "x")
    assert not limited.ok and "rate-limiting" in (limited.error or "")


def test_brave_web_rests_between_searches_machine_wide_and_other_engines_fill_in(tmp_path: Path):
    clock = Clock()
    searcher = make_searcher(tmp_path, FakeBrowser(FAKE_WEB), ["browser", "alt"], clock=clock, extra={"alt": results})
    searcher.settings.web_min_interval_seconds = 180
    assert searcher.search("moss").engine == "browser"
    assert searcher.search("tides").engine == "alt"  # Brave is resting, no pause was reported
    other = make_searcher(tmp_path, FakeBrowser(FAKE_WEB), ["browser"], clock=clock)  # a second bot
    assert other.pause.available(["browser"]) == []
    clock.t += 181
    assert searcher.search("lighthouses").engine == "browser"


def test_fake_mode_never_rests_the_fake_search(cfg):
    assert settings_from_config(cfg).web_min_interval_seconds == 0.0
    cfg.agent.mode = "web"
    assert settings_from_config(cfg).web_min_interval_seconds == 180.0
    cfg.browser.search_engines = ["hn", "wikipedia"]
    validate(cfg)


def test_brave_web_is_the_old_name_of_the_browser_engine(tmp_path):
    from explorer.search import SearchPause, SearchSettings, canonical_engine

    assert canonical_engine("brave-web") == "browser" and canonical_engine("hn") == "hn"
    assert SearchSettings(engines=["brave-web", "hn", "browser"]).engines == ["browser", "hn"]
    pause_file = tmp_path / "pause.json"
    pause_file.write_text('{"brave-web": 2000.0}')  # written before the rename
    pause = SearchPause(pause_file, clock=lambda: 1000.0)
    assert pause.paused_until("browser") == 2000.0
    assert pause.available(["browser", "hn"]) == ["hn"]
    pause.pause("brave-web", 10)  # a caller still using the old name lands on the new one
    assert "brave-web" not in pause_file.read_text() and pause.paused_until("browser") == 2000.0


def test_searxng_search_reads_the_local_json_and_maps_throttling_to_a_rate_limit():
    from explorer.browser import backoff_reason
    from explorer.search import NO_RESULTS, searxng_search

    def answer(payload, status=200):
        seen: list[httpx.Request] = []

        def handler(request: httpx.Request) -> httpx.Response:
            seen.append(request)
            return httpx.Response(status, json=payload)

        return httpx.Client(transport=httpx.MockTransport(handler)), seen

    client, seen = answer({"results": [
        {"title": "MVP Development Cost in Springfield", "url": "https://example.com/spf-mvp", "content": "<b>$25k</b> to $80k", "engines": ["google", "brave"]},
        {"title": "Duplicate", "url": "https://example.com/spf-mvp", "content": "", "engines": ["startpage"]},
        {"title": "", "url": "https://example.com/untitled"},
    ], "unresponsive_engines": [["duckduckgo", "CAPTCHA"]]})
    page = searxng_search(client, "mvp cost springfield")
    assert page.ok and [l.url for l in page.links] == ["https://example.com/spf-mvp"]
    assert "[1] MVP Development Cost in Springfield: $25k to $80k (google, brave)" in page.text
    assert seen[0].url.host == "127.0.0.1" and seen[0].url.params["format"] == "json"

    client, _ = answer({"results": [], "unresponsive_engines": [["google", "too many requests"], ["brave", "CAPTCHA"]]})
    throttled = searxng_search(client, "anything")
    assert not throttled.ok and backoff_reason(throttled) == "rate limit" and "google: too many requests" in throttled.error

    client, _ = answer({"results": [], "unresponsive_engines": []})
    empty = searxng_search(client, "zzqx")
    assert empty.ok and empty.text.rstrip().endswith(NO_RESULTS)  # the next engine answers, no pause

    client, _ = answer({}, status=403)
    assert "json under search.formats" in (searxng_search(client, "x").error or "")


def test_tavily_answers_within_its_daily_budget_and_steps_aside_without_a_key(tmp_path):
    import httpx
    from explorer.search import tavily_search, no_results

    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(200, json={"results": [{"title": "Mia's Northside Bakery contact", "url": "https://miasnorthside.com/contact", "content": "info@miasnorthside.com 139 Smith St"}]})

    client = httpx.Client(transport=httpx.MockTransport(handler))
    usage = tmp_path / "tavily-usage.json"
    page = tavily_search(client, "Northside bakery contact", "k", per_day=2, usage_file=usage)
    assert page.ok and page.links[0].url == "https://miasnorthside.com/contact" and "(tavily)" in page.title
    assert calls[0].headers["authorization"] == "Bearer k"
    assert tavily_search(client, "q2", "k", per_day=2, usage_file=usage).ok
    over = tavily_search(client, "q3", "k", per_day=2, usage_file=usage)
    assert not over.ok and "budget" in (over.error or "") and len(calls) == 2  # the third call never left the Mac
    assert "no key" in (tavily_search(client, "q", "", usage_file=usage).error or "")


def test_only_a_bot_the_owner_allows_may_name_the_special_engine():
    # owner, 2026-10-02: "keep tavily and use it for special sites (let ceo decide)"
    from explorer.actions import Search
    from explorer.config import PolicyConfig, PublishConfig
    from explorer.policy import Denylist, Policy, PolicyContext
    from conftest import DENYLIST

    c = PolicyContext(mode="web", current_page=None, actions_in_episode=0, pages_last_hour=0, open_questions=0, last_visit_by_domain={})
    plain = Policy(PolicyConfig(), PublishConfig(), Denylist.load(DENYLIST))
    v = plain.check(Search(type="search", query="Noodle Bar One owner contact", engine="tavily"), c)
    assert not v.allowed and "cannot choose the search engine" in v.reason and "The CEO" in v.reason
    assert plain.check(Search(type="search", query="Noodle Bar One owner contact"), c).allowed
    ceo = Policy(PolicyConfig(search_engines_on_request=["tavily"], refuse_repeated_searches=True), PublishConfig(), Denylist.load(DENYLIST))
    c.episode_search_queries = ["Noodle Bar One owner contact"]
    assert ceo.check(Search(type="search", query="Noodle Bar One owner contact", engine="tavily"), c).allowed  # a special retry of the same words
    assert not ceo.check(Search(type="search", query="Noodle Bar One owner contact"), c).allowed


def test_langsearch_answers_within_its_daily_budget_and_steps_aside_without_a_key(tmp_path):
    from explorer.search import langsearch_search

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["authorization"] == "Bearer k"
        return httpx.Response(200, json={"code": 200, "data": {"webPages": {"value": [
            {"name": "Maple Diner", "url": "https://maplediner.example/", "snippet": "<b>Open</b> daily"},
            {"name": "Maple Diner", "url": "https://maplediner.example/", "snippet": "a duplicate"}]}}})

    client = httpx.Client(transport=httpx.MockTransport(handler))
    usage = tmp_path / "langsearch-usage.json"
    page = langsearch_search(client, "maple diner", "k", per_day=1, usage_file=usage)
    assert page.ok and len(page.links) == 1 and "langsearch" in page.title
    assert "budget" in (langsearch_search(client, "maple diner", "k", per_day=1, usage_file=usage).error or "")
    assert "no key" in (langsearch_search(client, "maple diner", "", per_day=1, usage_file=usage).error or "")


def test_freeserp_reads_both_indexes_and_caches_a_query(tmp_path):
    from explorer.search import _FREESERP_CACHE, freeserp_search

    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        assert "freeserp.ai" in str(request.url) and request.url.params["index"] in ("web", "sites")
        return httpx.Response(200, json={"ok": True, "index": request.url.params["index"], "results": [
            {"url": "https://maplediner.example", "title": "Maple Diner", "ai_summary": "A diner in Springfield."},
            {"url": "https://maplediner.example", "title": "dup"}, {"url": "ftp://x", "title": "not a page"}]})

    _FREESERP_CACHE.clear()
    client = httpx.Client(transport=httpx.MockTransport(handler))
    page = freeserp_search(client, "diner springfield", "sites")
    assert page.ok and [l.url for l in page.links] == ["https://maplediner.example"] and "(freeserp sites)" in page.title
    assert freeserp_search(client, "Diner Springfield", "sites").title == page.title and len(calls) == 1  # cached
    freeserp_search(client, "diner springfield", "web")
    assert len(calls) == 2


def test_parallel_answers_within_its_budget_and_rests_when_credit_is_used(tmp_path):
    from explorer.search import parallel_search

    status = {"code": 200}

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["x-api-key"] == "k"
        if status["code"] != 200:
            return httpx.Response(status["code"], json={"error": "credit"})
        return httpx.Response(200, json={"results": [{"url": "https://maplediner.example/", "title": "Maple Diner", "excerpts": ["Open daily", "Springfield"]}]})

    client = httpx.Client(transport=httpx.MockTransport(handler))
    usage = tmp_path / "parallel-usage.json"
    page = parallel_search(client, "diner springfield", "k", per_day=3, usage_file=usage)
    assert page.ok and page.links[0].url == "https://maplediner.example/" and "(parallel)" in page.title
    status["code"] = 402
    assert not parallel_search(client, "q2", "k", per_day=3, usage_file=usage).ok
    assert "no key" in (parallel_search(client, "q", "", usage_file=usage).error or "")


def test_duckduckgo_mcp_turns_the_servers_numbered_answer_into_links_and_steps_aside_when_missing():
    from explorer import search as s

    text = ("Found 2 search results:\n1. Maple Diner | Home\n   URL: https://maplediner.example/\n   Summary: <b>Open</b> daily\n"
            "2. Maple Diner on Yelp\n   URL: https://www.yelp.com/biz/maple-diner\n   Summary: Reviews\n")
    rows = [(m.group(1), m.group(2)) for m in s._DDG_ITEM.finditer(text)]
    assert rows == [("Maple Diner | Home", "https://maplediner.example/"), ("Maple Diner on Yelp", "https://www.yelp.com/biz/maple-diner")]
    page = s.duckduckgo_mcp_search("x", "/nonexistent/duckduckgo-mcp-server")
    assert not page.ok and "not available" in (page.error or "")


def test_places_search_reads_the_local_overture_snapshot(tmp_path):
    """Owner, 2026-10-07: New York City's places from Overture Maps' open data, a local SQLite snapshot."""
    import sqlite3

    from explorer.search import places_search

    db = tmp_path / "nyc-places.sqlite"
    con = sqlite3.connect(db)
    con.execute("CREATE TABLE places (id TEXT, name TEXT, name_norm TEXT, category TEXT, website TEXT, phone TEXT, socials TEXT,"
                " address TEXT, locality TEXT, postcode TEXT, confidence REAL, status TEXT)")
    con.execute("INSERT INTO places VALUES ('1','Corner Cafe','corner cafe','casual_eatery','http://www.cornercafe.com/',"
                "'+15555550100','https://www.facebook.com/1','12 Main St','New York','10003',0.99,'open')")
    con.execute("INSERT INTO places VALUES ('2','Harbor Restaurant','harbor restaurant','restaurant',NULL,NULL,'','40 Oak St','New York','10009',0.9,'open')")
    con.commit(); con.close()
    page = places_search("Corner Cafe NYC", db, stop_words=("nyc",))   # the market words come from [browser] places_stop_words
    assert "website: http://www.cornercafe.com/" in page.text and "status: open" in page.text
    assert "no website listed" in places_search("Harbor Restaurant", db).text and "no social pages listed" in places_search("Harbor Restaurant", db).text
    assert not places_search("x", tmp_path / "missing.sqlite").ok
