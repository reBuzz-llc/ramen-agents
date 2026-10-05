"""A desk-agent serving the fleet over the chatroom (desktop.serve_chatroom) treats room posts as
untrusted requests and ingests at most DESKTOP_SERVE_REQUEST_CAP of them per episode, so a flood of
requests (a looping bot, or web content injected via a bot's post) cannot monopolise its GUI session."""
from __future__ import annotations

from pathlib import Path

from explorer.chatroom import Chatroom
from explorer.config import MessagingConfig
from explorer.controller import DESKTOP_SERVE_REQUEST_CAP

from conftest import make_controller


def test_a_serving_deskagent_caps_requests_ingested_per_episode(cfg, tmp_path: Path):
    cfg.agent.mode = "desktop"
    cfg.desktop.serve_chatroom = True
    cfg.messaging = MessagingConfig(enabled=True, room=True, room_file=str(tmp_path / "chatroom.jsonl"))
    c = make_controller(cfg)
    assert c._serving_chatroom

    room = Chatroom(tmp_path / "chatroom.jsonl")
    for i in range(12):
        room.post("Someone", f"please do GUI thing {i}")

    ep = c._ensure_episode()  # resets the per-episode ingest counter
    for _ in range(5):  # several observations in one episode, marker not advanced between them
        c._observe(ep)

    # The cap is on NEW requests ingested per episode (shown_room), not the read-only transcript.
    assert c._room_ingested_episode == DESKTOP_SERVE_REQUEST_CAP


def test_a_normal_bot_is_not_capped_this_way(cfg, tmp_path: Path):
    cfg.agent.mode = "fake"  # not a serving desk-agent
    cfg.messaging = MessagingConfig(enabled=True, room=True, room_file=str(tmp_path / "chatroom.jsonl"))
    c = make_controller(cfg)
    assert not c._serving_chatroom
