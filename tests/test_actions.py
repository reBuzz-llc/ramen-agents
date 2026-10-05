import json

import pytest
from pydantic import ValidationError

from explorer.actions import Decision, Follow, Note, action_key, decision_schema, parse_decision


def test_parse_plain_json():
    d = parse_decision('{"thought": "go", "action": {"type": "follow", "link": 2}}')
    assert isinstance(d.action, Follow)
    assert d.action.link == 2


def test_parse_with_fences_and_chatter():
    text = 'Sure! ```json\n{"thought": "x", "action": {"type": "note", "title": "t", "body": "b"}}\n```'
    d = parse_decision(text)
    assert isinstance(d.action, Note)
    assert d.action.tags == []
    assert d.action.answers_question is None


def test_unknown_action_type_rejected():
    with pytest.raises(ValidationError):
        parse_decision('{"thought": "", "action": {"type": "download", "url": "x"}}')


def test_missing_field_rejected():
    with pytest.raises(ValidationError):
        parse_decision('{"thought": "", "action": {"type": "note", "title": "only title"}}')


def test_no_json_rejected():
    with pytest.raises(ValueError):
        parse_decision("I would like to open a page please")


def test_schema_keeps_property_names_and_drops_annotations():
    schema = decision_schema()
    text = json.dumps(schema)
    note = schema["$defs"]["Note"]
    assert "title" in note["properties"]
    assert "body" in note["properties"]
    assert set(note["required"]) >= {"type", "title", "body"}
    assert '"description"' not in text
    assert '"default"' not in text
    assert schema["properties"]["action"]["oneOf"]


def test_action_key_uses_resolved_url():
    follow = Follow(type="follow", link=3)
    assert action_key(follow, resolved_url="fake://tides.html") == "open:fake://tides.html"
    assert action_key(follow) == "follow:3"
    assert action_key(Decision(action=Note(type="note", title=" Hi ", body="b")).action) == "note:hi"
