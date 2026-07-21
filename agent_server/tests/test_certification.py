"""certification-sealed annotation snapshots (Shane, 2026-07-08) — pure logic tests.

The DB paths follow v2_graph's proven patterns; what needs locking here is the
CHECKSUM CANONICALIZATION the drift tripwire depends on: stable across dict
ordering / missing keys, sensitive to any real graph change.
"""

from src.persistence.certification import canonical_checksum


def test_checksum_stable_across_ordering_and_missing_keys():
    g1 = {"nodes": [{"id": "n1", "label": "WHM10"}], "ports": [], "edges": [],
          "continuations": [], "grounds": []}
    g2 = {"grounds": [], "edges": [], "continuations": [],
          "ports": [], "nodes": [{"label": "WHM10", "id": "n1"}]}
    assert canonical_checksum(g1) == canonical_checksum(g2)
    # extra non-graph keys (source, updatedAt from load_v2_graph) are ignored
    g3 = {**g1, "source": "human", "updatedAt": "2026-07-08T23:00:00"}
    assert canonical_checksum(g3) == canonical_checksum(g1)
    # missing keys normalize to empty
    assert canonical_checksum({"nodes": []}) == canonical_checksum(
        {"nodes": [], "ports": [], "edges": [], "continuations": [], "grounds": []})


def test_checksum_detects_any_graph_change():
    base = {"nodes": [{"id": "n1", "bbox": {"x": 1390, "y": 860, "width": 409, "height": 814}}],
            "ports": [], "edges": [], "continuations": [], "grounds": []}
    moved = {"nodes": [{"id": "n1", "bbox": {"x": 1390, "y": 860, "width": 410, "height": 814}}],
             "ports": [], "edges": [], "continuations": [], "grounds": []}
    assert canonical_checksum(base) != canonical_checksum(moved)
    assert canonical_checksum(None) == canonical_checksum(
        {"nodes": [], "ports": [], "edges": [], "continuations": [], "grounds": []})
