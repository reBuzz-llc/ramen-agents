"""The target market is named once, in common-data/knowledge/target.toml, and filled into cards and bios."""
import os
import time

from explorer.target import Target

from conftest import make_controller


def test_fill_replaces_only_known_placeholders(tmp_path):
    f = tmp_path / "target.toml"
    f.write_text('market = "Austin, Texas"\nmarket_short = "Austin"\nsegment = "small businesses"\ntrades = "restaurants, clinics"\nareas = "East Austin, Downtown"\n')
    t = Target(f)
    assert t.fill('{market} {segment}: {trades}; search "info@" {market_short} bakery; {"type":"lead"} {unknown}') == \
        'Austin, Texas small businesses: restaurants, clinics; search "info@" Austin bakery; {"type":"lead"} {unknown}'
    assert Target(tmp_path / "missing.toml").fill("clients in {market}") == "clients in the target market"  # no place in code


def test_the_prompt_follows_the_target_file(cfg):
    path = cfg.root.parent / "common-data" / "knowledge" / "target.toml"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text('market = "Springfield"\nsegment = "small businesses"\n')
    cfg.agent.bio = "Finds customers in {market}."
    (cfg.root / "persona.md").write_text("You hunt {market} {segment}.")
    cfg.agent.persona_file = "persona.md"
    c = make_controller(cfg)
    assert "Finds customers in Springfield." in c.system and "You hunt Springfield small businesses." in c.system
    path.write_text('market = "Austin"\nsegment = "restaurants"\n')
    os.utime(path, (time.time() + 5, time.time() + 5))
    c._observe(c.memory.current_episode() or c.memory.db.query("SELECT * FROM episodes WHERE id = ?", (c.memory.start_episode(None),))[0])
    assert "You hunt Austin restaurants." in c.system and "Springfield" not in c.system
    path.unlink()


def test_market_slug_names_the_candidates_files(tmp_path):
    f = tmp_path / "target.toml"
    f.write_text('market = "Springfield"\n')
    t = Target(f)
    assert t.fill("candidates-{market_slug}-*.md") == "candidates-springfield-*.md"
    assert Target(tmp_path / "none.toml").fill("candidates-{market_slug}-*.md") == "candidates-market-*.md"


def test_slug_matches_the_candidates_feed():
    from explorer.target import slug

    assert [slug(x) for x in ("Springfield", "São Paulo", "Hell's Kitchen", "Zürich  (Old Town)", "")] == \
        ["springfield", "sao-paulo", "hell-s-kitchen", "zurich-old-town", "market"]


def test_the_site_check_question_follows_the_target_file(tmp_path):
    from explorer.config import SiteGateConfig

    f = tmp_path / "target.toml"
    f.write_text('market = "Austin, Texas"\nsegment = "dental practices"\ntrades = "general and cosmetic dentists"\n')
    q = Target(f).fill(SiteGateConfig().audience)
    assert "dental practices" in q and "general and cosmetic dentists" in q and "{" not in q and "restaurant" not in q
