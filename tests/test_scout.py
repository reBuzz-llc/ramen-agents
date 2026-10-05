"""The scout: a `provider` find must rest on pages it read; it lands in a report the owner reviews."""
from __future__ import annotations

from pathlib import Path

from explorer import fleet
from explorer.actions import Decision, Provider
from explorer.config import Config, PolicyConfig, PublishConfig, ScoutConfig, load_config
from explorer.model import ModelResult
from explorer.policy import Denylist, Policy, PolicyContext, is_meta_topic
from explorer.scout import existing_names, record_provider

from conftest import make_controller


def provider(**over) -> Provider:
    spec = dict(
        type="provider", name="SambaNova Cloud", base_url="https://api.sambanova.ai/v1",
        free_terms="free, ~30 req/min, no card", needs_card=False, models=["Meta-Llama-3.3-70B-Instruct"],
        why="OpenAI-compatible, generous free tier, no card; the fleet can use it by dropping in a key.",
        sources=["https://cloud.sambanova.ai/pricing"],
    )
    spec.update(over)
    return Provider(**spec)


def ctx(**over) -> PolicyContext:
    base = dict(mode="web", current_page=None, actions_in_episode=0, pages_last_hour=0, open_questions=0,
                last_visit_by_domain={}, visited_urls={"https://cloud.sambanova.ai/pricing"})
    base.update(over)
    return PolicyContext(**base)


def test_meta_filter_allows_provider_research_but_still_blocks_rate_limit_bypass():
    assert not is_meta_topic("free LLM API providers with no credit card")
    assert not is_meta_topic("SambaNova Cloud free tier API key")  # 'api key' no longer trips it
    assert is_meta_topic("how to bypass rate limits")
    assert is_meta_topic("Wikipedia did not help")


def test_policy_requires_evidence_and_rarity():
    off = Policy(PolicyConfig(), PublishConfig(), Denylist())
    assert "not enabled" in off.check(provider(), ctx()).reason
    p = Policy(PolicyConfig(), PublishConfig(), Denylist(), scout=ScoutConfig(enabled=True, max_per_day=2))
    assert p.check(provider(), ctx()).allowed
    assert "endpoint" in p.check(provider(base_url="ftp://x"), ctx()).reason
    assert "pages you read" in p.check(provider(sources=[]), ctx()).reason
    unread = p.check(provider(sources=["https://never-opened.example/"]), ctx())
    assert not unread.allowed and "page you opened" in unread.reason
    dup = p.check(provider(), ctx(recent_provider_names={"sambanova cloud"}))
    assert not dup.allowed and dup.permanent
    assert "this episode" in p.check(provider(), ctx(providers_in_episode=1)).reason
    assert "daily limit" in p.check(provider(), ctx(providers_today=2)).reason


def test_provider_already_keyed_by_the_fleet_is_refused():
    """The scout kept re-recording OpenRouter/Mistral/Gemini, which the fleet already has keys for.
    A provider the fleet already holds a key for is not a new find; one it has no key for still is."""
    p = Policy(PolicyConfig(), PublishConfig(), Denylist(), scout=ScoutConfig(enabled=True))
    have = {"openrouter", "mistral", "gemini"}
    for name, url, src in [
        ("OpenRouter", "https://openrouter.ai/api/v1", "https://openrouter.ai/docs"),
        ("Google Gemini", "https://generativelanguage.googleapis.com/v1", "https://ai.google.dev/pricing"),
        ("Mistral", "https://api.mistral.ai/v1", "https://mistral.ai/pricing"),
    ]:
        v = p.check(provider(name=name, base_url=url, sources=[src]),
                    ctx(visited_urls={src}, fleet_provider_names=have))
        assert not v.allowed and v.permanent and "already has a key" in v.reason
    # SambaNova is a KNOWN provider but the fleet has no key for it: still a worthwhile find.
    assert p.check(provider(), ctx(fleet_provider_names=have)).allowed


def test_record_provider_writes_and_dedupes(tmp_path: Path):
    cfg = ScoutConfig(enabled=True, report_file=str(tmp_path / "providers-found.md"))
    path = record_provider(cfg, provider())
    text = path.read_text()
    assert text.startswith("# Free AI providers and tools the scout has found")
    assert "## SambaNova Cloud" in text and "https://api.sambanova.ai/v1" in text and "no card required" in text
    assert "keys/sambanova-cloud.key" in text
    assert existing_names(path) == {"sambanova cloud"}
    record_provider(cfg, provider(name="Cerebras", base_url="https://api.cerebras.ai/v1"))
    assert existing_names(path) == {"sambanova cloud", "cerebras"}
    assert path.read_text().count("# Free AI providers") == 1  # header written once


class Scout:
    def __init__(self):
        self.step = 0

    def decide(self, system, obs):
        self.step += 1
        from explorer.actions import Open
        action = Open(type="open", url="fake://tides.html") if self.step == 1 else provider(sources=["fake://tides.html"])
        return ModelResult(decision=Decision(thought="scout", action=action))

    def complete(self, system, prompt):
        return "summary"


def test_scout_records_a_provider_and_tells_the_owner(cfg, tmp_path: Path):
    cfg.agent.name = "Scout"
    cfg.agent.mode = "fake"
    cfg.scout = ScoutConfig(enabled=True, report_file=str(tmp_path / "providers-found.md"))
    scout = make_controller(cfg, model=Scout())
    assert "provider:" in scout.system and "record a free, card-free provider or tool" in scout.system
    scout.run(max_cycles=2)
    rows = scout.memory.db.query("SELECT action_type, verdict FROM actions ORDER BY id")
    assert [(r["action_type"], r["verdict"]) for r in rows] == [("open", "allowed"), ("provider", "allowed")]
    assert "## SambaNova Cloud" in (tmp_path / "providers-found.md").read_text()
    assert any("free AI provider" in r["text"] for r in scout.memory.recent_chat(5))


def test_scout_persona_writes_a_scout_section(tmp_path: Path):
    folder = fleet.new_bot("Scout", tmp_path / "bots", persona="scout", port=8792)
    text = (folder / "config.toml").read_text()
    assert "[scout]" in text and "enabled = true" in text
    cfg = load_config(folder / "config.toml")
    assert cfg.scout.enabled and cfg.scout.report_file.endswith("providers-found.md")
    assert (folder / "persona.md").read_text().startswith("You are the scout")


def test_openrouter_is_a_known_free_provider_again():
    from explorer.config import KNOWN_PROVIDERS, ModelConfig
    from explorer.model import provider_config

    assert "openrouter" in KNOWN_PROVIDERS
    prov = provider_config("openrouter", ModelConfig())
    assert prov.base_url == "https://openrouter.ai/api/v1" and prov.model.endswith(":free")
    assert prov.api_key_file.endswith("/openrouter.key")


def test_agent_finds_become_board_rows_only_for_clearnet_sites(cfg, tmp_path, monkeypatch):
    # owner, 2026-09-26: "allow oniA to write on <the onion board>"; the fence: nothing read over Tor leaves the Mac
    from explorer.actions import Provider
    from explorer.notion import FakeNotion

    cfg.scout.enabled, cfg.scout.kind = True, "agent"
    cfg.scout.report_file = str(tmp_path / "agents.md")
    cfg.scout.notion_database_id = "264b6fb8-ada2-cfe6-4126-8bd85f6d9173"
    from conftest import make_controller

    c = make_controller(cfg)
    fake = FakeNotion()
    c._agent_board_client, c._agent_board_tried = fake, True
    r = c._execute_provider(Provider(type="provider", name="AGENTS.inc", base_url="https://www.agents.inc", free_terms="free tier, no card",
                                     why="ready-made agents for news radar and company research", sources=["https://www.agents.inc/about"]))
    assert r.ok and "and the board" in r.summary
    assert fake.rows[-1]["title"] == "AGENTS.inc" and fake.rows[-1]["Website"] == "https://www.agents.inc"
    assert fake.rows[-1]["Card"] == "no card" and fake.rows[-1]["Source"] == "https://www.agents.inc/about" and fake.rows[-1]["Found by"] == cfg.agent.name
    r = c._execute_provider(Provider(type="provider", name="OnionShare", base_url="http://lldan5gahapx5k7iafb3s4ikijc4ni7gx5iywdflkba5y2ezyg6sjgyd.onion/",
                                     free_terms="open source", why="file sharing over Tor", sources=["http://lldan5gahapx5k7iafb3s4ikijc4ni7gx5iywdflkba5y2ezyg6sjgyd.onion/"]))
    assert r.ok and len(fake.rows) == 1 and "not a clearnet site" in (r.feedback or "")


def test_agent_entries_need_a_clearnet_website():
    from explorer.actions import Provider
    from explorer.config import PolicyConfig, PublishConfig, ScoutConfig
    from explorer.policy import Denylist, Policy, PolicyContext
    from conftest import DENYLIST

    policy = Policy(PolicyConfig(), PublishConfig(), Denylist.load(DENYLIST), scout=ScoutConfig(enabled=True, kind="agent"))
    ctx = PolicyContext(mode="web", current_page=None, actions_in_episode=0, pages_last_hour=0, open_questions=0, last_visit_by_domain={})
    ctx.visited_urls = {"http://abc.onion/", "https://www.agents.inc/"}
    onion = Provider(type="provider", name="OnionShare", base_url="http://abc.onion/", free_terms="free", why="file sharing", sources=["http://abc.onion/"])
    assert "clearnet" in policy.check(onion, ctx).reason
    clear = Provider(type="provider", name="AGENTS.inc", base_url="https://www.agents.inc", free_terms="free tier", why="agents", sources=["https://www.agents.inc/"])
    assert "clearnet" not in policy.check(clear, ctx).reason


def test_a_find_is_called_what_it_is():
    """Owner, 2026-10-02: the Scout recorded an email checker and the owner was told "Found a free AI provider"."""
    import datetime as dt

    from explorer.actions import Provider
    from explorer.scout import entry_markdown, find_category, find_label

    def find(**kw):
        base = dict(type="provider", name="X", base_url="https://x.example/", free_terms="free, no card", why="useful")
        return Provider(**{**base, **kw})

    checker = find(name="EmailVerify.io", base_url="https://www.emailverify.io/api/",
                   free_terms="100 free verification credits monthly", models=["email-verify", "bulk-email-verify", "email-finder"])
    assert (find_category(checker), find_label(checker)) == ("verification", "verification tool")
    entry = entry_markdown(checker, dt.datetime(2026, 10, 2))
    assert "not a model provider" in entry and "Suggested key file" not in entry and "**What it does:** email-verify" in entry

    llm = find(name="SambaNova Cloud", base_url="https://api.sambanova.ai/v1", models=["Meta-Llama-3.3-70B-Instruct"])
    assert find_label(llm) == "AI provider" and "Suggested key file" in entry_markdown(llm, dt.datetime(2026, 10, 2))
    # What the model says wins over the guess; an unrecognised find is a tool, never an AI provider by default.
    assert find_category(find(category="Search", models=["llama"])) == "search"
    assert find_category(find(category="model", why="validates things")) == "model"
    assert find_category(find(name="Jina Reader", why="a page reader API that returns clean text")) == "search"
    assert find_category(find(name="Thing", why="a handy service")) == "tool"
