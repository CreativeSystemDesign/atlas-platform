"""Playbook — blessed plays as retrievable doctrine (Shane's design 2026-07-06).

Governance invariants: ONLY a bless event mints (praise-parse ban — nothing
self-blesses); no text, no card (the WHY is the card); minting is
server-automatic off the event path; v1 lookup is deterministic key match
behind the stable lookup(situation) interface.
"""

from __future__ import annotations

import asyncio
import json
import threading
import time

from src.canvas_copilot import playbook

SNAP = {
    "page": 11,
    "nodes": [{"id": "node-elb51", "label": "ELB51",
               "bbox": {"x": 700, "y": 1300, "width": 164, "height": 175}}],
    "ports": [], "edges": [], "continuations": [],
}

BLESS = {"kind": "bless", "page": 11, "x": 780, "y": 1390,
         "text": "hugs the breaker symbol; 100mA attached as evidence, fully outside",
         "target": {"component_id": "node-elb51", "component_label": "ELB51"}}


def _iso(monkeypatch, tmp_path):
    monkeypatch.setattr(playbook, "_ROOT", tmp_path / "playbook")
    monkeypatch.setattr(playbook, "_CARDS", tmp_path / "playbook" / "cards")

    def fake_render(**kw):
        p = tmp_path / f"crop-{time.time_ns()}.png"
        p.write_bytes(b"\x89PNG fake")
        return {"debug_path": str(p)}
    from src.canvas_copilot import capture
    monkeypatch.setattr(capture, "render_capture", fake_render)
    from src.canvas_copilot import yolo
    monkeypatch.setattr(yolo, "page_detections",
                        lambda page: [{"id": "y011-5", "tier": "strong", "class_name": "ELB",
                                       "confidence": 0.83,
                                       "bbox": {"x": 710, "y": 1310, "width": 140, "height": 150}}])
    monkeypatch.setattr(yolo, "model_sha", lambda: "sha-test")


def test_mint_assembles_a_scale_ready_card(monkeypatch, tmp_path):
    _iso(monkeypatch, tmp_path)
    card = playbook.mint(BLESS, SNAP)
    assert card is not None and card["schema_version"] == 1
    s = card["situation"]
    assert s["element_label"] == "ELB51" and s["label_family"] == "ELB"
    assert s["det"]["class_name"] == "ELB" and s["detector_version"] == "sha-test"
    assert s["region"]["width"] == 164 + 120  # component bbox + 2*pad
    assert card["shane_text"].startswith("hugs the breaker")
    assert set(card["assets"]) == {"crop_overlay", "crop_print"}
    assert card["embedding"] is None  # v2 computes retroactively from crops
    # persisted + human index updated
    on_disk = json.loads((playbook._CARDS / f"{card['id']}.json").read_text())
    assert on_disk["id"] == card["id"]
    assert "ELB51" in (playbook._ROOT / "INDEX.md").read_text()


def test_no_text_no_card(monkeypatch, tmp_path):
    _iso(monkeypatch, tmp_path)
    assert playbook.mint({**BLESS, "text": "  "}, SNAP) is None
    assert not (tmp_path / "playbook" / "cards").exists()


def test_lookup_matches_family_and_class_most_recent_first(monkeypatch, tmp_path):
    _iso(monkeypatch, tmp_path)
    playbook.mint(BLESS, SNAP)
    assert playbook.lookup({"label_family": "ELB"})  # family key
    assert playbook.lookup({"class_name": "ELB"})    # detector-class key
    assert playbook.lookup({"label_family": "MS"}) == []
    assert playbook.lookup({}) == []  # no key, no guessing


def test_bless_event_mints_server_automatically(monkeypatch, tmp_path):
    from src.canvas_copilot import bridge

    minted = threading.Event()
    seen = {}

    def fake_mint(ev, snap):
        seen.update(ev=ev, snap=snap)
        minted.set()
    monkeypatch.setattr(playbook, "mint", fake_mint)
    bridge.put_state(SNAP, [BLESS])
    assert minted.wait(timeout=5), "bless event did not trigger a mint"
    assert seen["ev"]["text"].startswith("hugs")
    assert seen["snap"].get("page") == 11


def test_playbook_tool_lists_and_serves_cards(monkeypatch, tmp_path):
    from src.canvas_copilot import tools

    _iso(monkeypatch, tmp_path)
    card = playbook.mint(BLESS, SNAP)
    out = json.loads(asyncio.run(tools.playbook_tool.handler({}))["content"][0]["text"])
    assert out["plays"] and out["plays"][0]["family"] == "ELB"
    res = asyncio.run(tools.playbook_tool.handler({"card_id": card["id"]}))
    assert any(c.get("type") == "image" for c in res["content"])
    body = json.loads(res["content"][0]["text"])
    assert body["shane_text"].startswith("hugs") and "embedding" not in body
