"""The first-run answers file (queue 572): valid TOML with the keys the engine and the Validator read, quotes and
newlines kept, domains cleaned."""
from __future__ import annotations

import sys
import tomllib
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import family_answers as fa  # noqa: E402


def test_answers_render_as_the_engine_reads_them():
    d = tomllib.loads(fa.render({"NAME": 'Cobalt "Web" Studio', "SELLS": "websites and booking", "BUYERS": "cafés, salons",
                                 "PLACE": "Springfield, IL", "OWNER": "Sam", "DOMAINS": "https://www.Cobalt.example/, cobalt.example",
                                 "STEER": "bakeries first"}))
    assert d["company"]["name"] == 'Cobalt "Web" Studio'
    assert d["company"]["signoff"] == 'Regards,\nSam\n-- Cobalt "Web" Studio'
    assert d["company"]["own_domains"] == ["cobalt.example"]
    assert d["target"]["market"] == "Springfield, IL" and d["target"]["market_short"] == "Springfield"
    assert d["target"]["trades"] == "cafés, salons" and d["target"]["segment"] == "small businesses"
    assert d["team"][0]["name"] == "Sam"
    assert d["steer"] == "bakeries first"


def test_a_missing_answer_writes_nothing(tmp_path, monkeypatch):
    for k in ("NAME", "SELLS", "BUYERS", "PLACE"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setenv("NAME", "X")
    f = tmp_path / "family.toml"
    assert fa.main(["x", str(f)]) == 1
    assert not f.exists()
