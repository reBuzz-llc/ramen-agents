"""No script here presents an automated client as a person's browser. A plain agent name, or the engine's own "compatible; ...
Explorer" string that says it is a bot, is fine."""
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DISGUISE = re.compile("Mozilla/5" + r"\.0 \((?:Macintosh|Windows|X11|iPhone|iPad|Linux)|Apple" + "WebKit/|Chrome/" + r"\d")


def test_the_pattern_catches_a_browser_string_and_passes_an_honest_one():
    assert DISGUISE.search("Mozilla/5" + ".0 (Macintosh; Intel Mac OS X 10_15_7) Apple" + "WebKit/537.36")
    assert not DISGUISE.search("Mozilla/5.0 (compatible; Lead EnricherExplorer/0.1; curiosity agent)")
    assert not DISGUISE.search("ramen-agents-validator/1.0 (email check)")


def test_no_tracked_script_carries_one():
    files = subprocess.run(["git", "ls-files", "*.py", "*.sh", "*.mjs"], cwd=ROOT, capture_output=True, text=True, check=True).stdout.split()
    hits = [f for f in files if (ROOT / f).is_file() and not f.startswith("webapp/node_modules") and DISGUISE.search((ROOT / f).read_text(errors="ignore"))]
    assert hits == []
