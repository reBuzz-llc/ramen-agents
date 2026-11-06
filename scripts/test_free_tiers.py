"""Tests for free-tiers.py: the services come from free-tiers.toml, statuses follow the share used, and a service with no
number says "not measurable" rather than guessing. No network: the S3 and Neon paths are only checked for their refusals.

    python -m pytest -q scripts/test_free_tiers.py
"""
import datetime as dt
import importlib.util
import json
from pathlib import Path

spec = importlib.util.spec_from_file_location("ft", Path(__file__).with_name("free-tiers.py"))
ft = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ft)
TODAY = dt.date(2026, 11, 6)


def fleet(tmp_path: Path, toml: str, shared: dict | None = None) -> Path:
    (tmp_path / "common-data" / "configs").mkdir(parents=True)
    (tmp_path / "common-data" / "keys").mkdir()
    (tmp_path / "common-data" / "shared-state").mkdir()
    (tmp_path / "common-data" / "configs" / "free-tiers.toml").write_text(toml)
    for name, data in (shared or {}).items():
        (tmp_path / "common-data" / "shared-state" / name).write_text(json.dumps(data))
    return tmp_path


def test_status_words_from_the_share():
    assert ft.row("x", "y", 10, 100, "GB", "", "")["status"] == "ok"
    assert ft.row("x", "y", 80, 100, "GB", "", "")["status"] == "near"
    assert ft.row("x", "y", 101, 100, "GB", "", "")["status"] == "over"
    assert ft.row("x", "y", None, 100, "GB", "", "not measurable: ...")["status"] == "unknown"


def test_no_list_means_no_rows(tmp_path):
    assert ft.build(TODAY, tmp_path)["rows"] == []


def test_json_none_and_missing_keys(tmp_path):
    bots = fleet(tmp_path, '''
[[service]]
name = "Portal database"
what = "size"
limit = 500
unit = "MB"
resets = "not monthly"
measure = "json"
file = "db-standby.json"
field = "db_mb"

[[service]]
name = "Host"
what = "transfer"
limit = 100
unit = "GB/month"
resets = "monthly"
measure = "none"
where = "the console"

[[service]]
name = "Files"
what = "bucket"
limit = 1
unit = "GB"
measure = "s3-bucket"
key_file = "s3.key"

[[service]]
name = "Neon"
what = "transfer"
limit = 5
measure = "neon-api"
key_file = "neon-api.key"
''', {"db-standby.json": {"db_mb": 420.0, "at": "2026-11-06T02:31:00"}})
    size, host, files, neon = ft.build(TODAY, bots)["rows"]
    assert (size["used"], size["status"]) == (420.0, "near")
    assert host["used"] is None and host["how"] == "not measurable: the console" and host["resets"] == "2026-12-01"
    assert files["status"] == "unknown" and "no key file" in files["how"]
    assert neon["status"] == "unknown" and "no Neon API key" in neon["how"]


def test_json_not_written_yet(tmp_path):
    bots = fleet(tmp_path, '[[service]]\nname = "DB"\nwhat = "size"\nlimit = 500\nmeasure = "json"\nfile = "db-standby.json"\nfield = "db_mb"\n')
    assert ft.build(TODAY, bots)["rows"][0]["how"].startswith("not measurable yet")


def test_a_broken_list_is_one_row_not_a_crash(tmp_path):
    bots = fleet(tmp_path, "[[service]\nname = ")
    rows = ft.build(TODAY, bots)["rows"]
    assert len(rows) == 1 and rows[0]["how"].startswith("not readable")


def test_the_example_parses():
    example = Path(__file__).parent.parent / "common-data" / "configs" / "free-tiers.example.toml"
    services = ft.tomllib.loads(example.read_text())["service"]
    assert {s["measure"] for s in services} <= {"none", "json", "s3-bucket", "neon-api"}
