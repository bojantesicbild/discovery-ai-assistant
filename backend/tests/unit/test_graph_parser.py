"""Unit tests for graph_parser.

Covers the regressions that actually bit us in production:
- Obsidian alias wikilinks [[target|display]] used to create phantom
  `target|display` nodes next to the real target.
- LLM-hallucinated IDs (gap.blocked_reqs pointing at a non-existent
  BR-012) used to render as phantom nodes in the graph.
- Person-name wikilinks need to preserve capitalization (otherwise
  Sarah_Chen becomes sarah-chen and no longer matches the file-backed
  node).
"""
from __future__ import annotations

from pathlib import Path
from textwrap import dedent

import pytest

from app.services.graph_parser import (
    _guess_type,
    _normalize_id,
    parse_knowledge_graph,
)


class TestNormalizeId:
    def test_br_pattern_uppercased(self):
        assert _normalize_id("br-005") == "BR-005"
        assert _normalize_id("BR-005") == "BR-005"

    def test_gap_pattern_uppercased(self):
        assert _normalize_id("gap-001") == "GAP-001"

    def test_person_name_preserved(self):
        assert _normalize_id("Sarah Chen") == "Sarah Chen"
        assert _normalize_id("John Doe Smith") == "John Doe Smith"

    def test_slug_lowercased(self):
        # Single-word or lowercase inputs get slugified — the 2+-
        # capitalized-words branch preserves person names, so the
        # slug path only applies to the remainder.
        assert _normalize_id("discovery brief") == "discovery-brief"
        assert _normalize_id("Some_Thing!") == "some-thing"


class TestGuessType:
    @pytest.mark.parametrize("name,expected", [
        ("BR-005", "requirement"),
        ("DEC-001", "decision"),
        ("CON-003", "constraint"),
        ("GAP-012", "gap"),
        ("brief.md", "document"),
        ("Project Brief", "document"),
        ("Sarah Chen", "stakeholder"),
        ("Contradictions", "contradiction"),
    ])
    def test_patterns(self, name: str, expected: str):
        assert _guess_type(name) == expected


@pytest.fixture
def vault(tmp_path: Path) -> Path:
    """Build a minimal vault with the pieces graph_parser cares about."""
    (tmp_path / "requirements").mkdir()
    (tmp_path / "requirements" / "BR-001.md").write_text(dedent("""\
        ---
        id: BR-001
        title: User login
        category: requirement
        priority: must
        ---
        Users authenticate via [[Sarah_Chen|Sarah Chen]] — stakeholder owner.

        Blocked by [[GAP-999]] (phantom — does not exist).

        See [[BR-002]] — related requirement.
    """))
    (tmp_path / "requirements" / "BR-002.md").write_text(dedent("""\
        ---
        id: BR-002
        title: Session timeout
        category: requirement
        ---
        Timeout after 30 min of inactivity.
    """))
    (tmp_path / "stakeholders").mkdir()
    (tmp_path / "stakeholders" / "Sarah_Chen.md").write_text(dedent("""\
        ---
        id: Sarah_Chen
        title: Sarah Chen
        category: stakeholder
        ---
        Product owner.
    """))
    # Index file that should be skipped as an edge source.
    (tmp_path / "requirements" / "requirements.md").write_text(dedent("""\
        ---
        category: requirements-index
        ---
        - [[BR-001]]
        - [[BR-002]]
    """))
    return tmp_path


class TestParseKnowledgeGraph:
    def test_alias_wikilink_does_not_create_phantom(self, vault: Path):
        graph = parse_knowledge_graph(vault)
        ids = {n["id"] for n in graph["nodes"]}
        assert "Sarah_Chen" in ids
        # The pipe-alias form must not survive as its own node.
        assert not any("|" in nid for nid in ids)

    def test_alias_edge_points_to_real_node(self, vault: Path):
        graph = parse_knowledge_graph(vault)
        sarah_edges = [e for e in graph["edges"] if e["target"] == "Sarah_Chen"]
        assert len(sarah_edges) >= 1

    def test_phantom_br_gap_ids_skipped(self, vault: Path):
        graph = parse_knowledge_graph(vault)
        ids = {n["id"] for n in graph["nodes"]}
        # GAP-999 was referenced but has no file — phantom-skip rule
        # must keep it out of the graph.
        assert "GAP-999" not in ids

    def test_index_file_not_a_node(self, vault: Path):
        graph = parse_knowledge_graph(vault)
        labels = {n["label"] for n in graph["nodes"]}
        # requirements.md has `category: requirements-index` → skipped
        assert not any("Requirements" == lbl for lbl in labels if lbl.startswith("Requirements"))

    def test_index_file_not_an_edge_source(self, vault: Path):
        graph = parse_knowledge_graph(vault)
        # No edge should originate from the index file's implied id
        source_ids = {e["source"] for e in graph["edges"]}
        assert "requirements" not in source_ids
