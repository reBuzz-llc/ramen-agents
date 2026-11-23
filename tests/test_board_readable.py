"""The check a caller makes before it sends text that must have its contact names hidden."""
from __future__ import annotations

import json

import pytest

from explorer.common import masking
from explorer.portal_store import PortalLeadStore


@pytest.fixture
def cache(tmp_path, monkeypatch):
    keys = tmp_path / "common-data" / "keys"
    keys.mkdir(parents=True)
    monkeypatch.setenv("EXPLORER_KEYS_DIR", str(keys))
    path = tmp_path / "common-data" / "shared-state" / "portal-leads-cache.json"
    path.parent.mkdir(parents=True)
    return path


@pytest.mark.parametrize("text,want", [
    ('{"rows": {"a": {"business": "X"}}}', True),
    ('{"rows": {}}', True),                     # an empty board is a board that was read
    ('{"rows": []}', False),
    ("{}", False),
    ("[]", False),
    ("not json", False),
])
def test_what_counts_as_readable(cache, text, want):
    cache.write_text(text)
    assert masking.board_readable() is want


def test_no_file_is_not_readable(cache):
    assert masking.board_readable() is False


def test_a_first_pull_of_an_empty_board_makes_it_readable(cache):
    import httpx

    def board(request):
        return httpx.Response(200, json={"leads": [], "rows": [], "rev": 0, "next": 0, "more": False})
    store = PortalLeadStore("http://board.invalid", "k", "test", http=httpx.Client(base_url="http://board.invalid", transport=httpx.MockTransport(board)), cache=cache)
    assert masking.board_readable() is False
    store.refresh(force=True)
    assert masking.board_readable() is True and json.loads(cache.read_text())["rows"] == {}
