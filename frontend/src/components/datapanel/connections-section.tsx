"use client";

// Connections section — reusable card rendered on every finding detail
// view (BR / gap / constraint / contradiction). Consumes the response
// from GET /api/projects/:id/findings/:display_id/connections and
// renders two visual tiers:
//
//   EXPLICIT (top)  — rows in the relationships table with
//                     confidence in {explicit, proposed}. Clickable
//                     chips, hoverable source quote, retract button.
//   DERIVED  (bottom, muted) — groups inferred at query time (shared
//                     source doc, shared stakeholder). No actions —
//                     just "also worth noting".
//
// Kind colors match Topbar.TYPE_COLORS so the rest of the UI reads as
// one visual language.

import { useEffect, useState } from "react";
import type {
  ConnectionsResponse, ConnectionEdge, DerivedConnectionGroup,
  ConnectionKind, ConnectionConfidence, ConnectionRef,
} from "@/lib/api";
import { getConnections } from "@/lib/api";


const KIND_COLOR: Record<ConnectionKind, string> = {
  requirement:   "#059669",  // green — matches Topbar
  gap:           "#F59E0B",  // amber
  constraint:    "#F97316",  // orange
  contradiction: "#EF4444",  // red
  stakeholder:   "#7c3aed",  // purple
  document:      "#1d4ed8",  // blue
};


const KIND_TAB: Record<ConnectionKind, string> = {
  requirement:   "reqs",
  gap:           "gaps",
  constraint:    "constraints",
  contradiction: "contradictions",
  stakeholder:   "people",
  document:      "docs",
};


// Human-friendly rel-type labels. Unknown types render the raw string.
const REL_TYPE_LABEL: Record<string, string> = {
  blocks:       "Blocks",
  blocked_by:   "Blocked by",
  affects:      "Affects",
  affected_by:  "Affected by",
  raised_by:    "Raised by",
  raised:       "Raised",
  derived_from: "From document",
  source_of:    "Source of",
  contradicts:  "Contradicts",
  co_extracted: "Co-extracted with",
  mentions:     "Mentions",
  proposes_patch: "Proposed patch to",
  has_proposal: "Has proposed patch",
};


function humaniseRel(rel: string): string {
  return REL_TYPE_LABEL[rel] || rel.replace(/_/g, " ");
}


// Clickable chip styled by kind. Single source of truth so BR/gap/con
// chips look identical everywhere.
function KindChip({
  ref, projectId, onNavigate,
}: {
  ref: ConnectionRef;
  projectId: string;
  onNavigate?: (tab: string, displayId?: string) => void;
}) {
  const color = KIND_COLOR[ref.kind] || "#6b7280";
  return (
    <a
      href={`/projects/${projectId}/chat?tab=${KIND_TAB[ref.kind]}&highlight=${encodeURIComponent(ref.display_id)}`}
      onClick={(e) => {
        if (!onNavigate) return;
        e.preventDefault();
        onNavigate(KIND_TAB[ref.kind], ref.display_id);
      }}
      title={ref.label}
      style={{
        display: "inline-block",
        whiteSpace: "nowrap",
        padding: "2px 8px",
        borderRadius: 10,
        fontSize: 11,
        fontWeight: 600,
        cursor: "pointer",
        textDecoration: "none",
        background: `${color}15`,
        color: color,
        border: `1px solid ${color}30`,
      }}
    >{ref.display_id}</a>
  );
}


function ConfidencePill({ c }: { c: ConnectionConfidence }) {
  const style = c === "explicit"
    ? { bg: "#ecfdf5", fg: "#047857", border: "#a7f3d0" }
    : c === "proposed"
    ? { bg: "#fffbeb", fg: "#b45309", border: "#fde68a" }
    : { bg: "var(--gray-100)", fg: "var(--gray-500)", border: "var(--gray-200)" };
  return (
    <span style={{
      fontSize: 9, fontWeight: 700, letterSpacing: 0.4,
      textTransform: "uppercase",
      padding: "1px 6px", borderRadius: 8,
      background: style.bg, color: style.fg,
      border: `1px solid ${style.border}`,
    }}>{c}</span>
  );
}


function EdgeRow({
  edge, projectId, onNavigate,
}: {
  edge: ConnectionEdge;
  projectId: string;
  onNavigate?: (tab: string, displayId?: string) => void;
}) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
      padding: "6px 0",
    }}>
      <span style={{
        fontSize: 11, color: "var(--gray-600)", fontWeight: 600,
        minWidth: 120,
      }}>{humaniseRel(edge.rel_type)}</span>
      <KindChip ref={edge.neighbor} projectId={projectId} onNavigate={onNavigate} />
      <span style={{ fontSize: 11, color: "var(--gray-500)", flex: 1, minWidth: 0,
                     whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {edge.neighbor.label}
      </span>
      <ConfidencePill c={edge.confidence} />
      {edge.source_doc && (
        <span
          title={edge.source_quote || edge.source_doc}
          style={{
            fontSize: 10, color: "var(--gray-500)",
            padding: "1px 6px", borderRadius: 8,
            background: "var(--gray-100)",
            border: "1px solid var(--gray-200)",
            whiteSpace: "nowrap", maxWidth: 200,
            overflow: "hidden", textOverflow: "ellipsis",
          }}
        >📄 {edge.source_doc}</span>
      )}
    </div>
  );
}


function DerivedGroup({
  group, projectId, onNavigate,
}: {
  group: DerivedConnectionGroup;
  projectId: string;
  onNavigate?: (tab: string, displayId?: string) => void;
}) {
  const label = group.kind === "shared_source_doc"
    ? `Same document (${group.key})`
    : `Same stakeholder (${group.key})`;
  return (
    <div style={{ padding: "6px 0" }}>
      <div style={{
        fontSize: 10, fontWeight: 600, color: "var(--gray-500)",
        textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4,
      }}>{label}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {group.members.map((m) => (
          <KindChip key={m.uuid} ref={m} projectId={projectId} onNavigate={onNavigate} />
        ))}
      </div>
    </div>
  );
}


interface Props {
  projectId: string;
  displayId: string;     // BR-004, GAP-007, CON-002, CTR-005, filename, person name
  refreshKey?: number;   // bump to force a re-fetch (e.g. after extraction)
  onNavigate?: (tab: string, displayId?: string) => void;
}


export default function ConnectionsSection({
  projectId, displayId, refreshKey, onNavigate,
}: Props) {
  const [data, setData] = useState<ConnectionsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getConnections(projectId, displayId)
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setError(e?.message || "failed to load"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectId, displayId, refreshKey]);

  if (loading) return null;  // avoid flicker; the data panel has its own skeleton
  if (error || !data) return null;

  const totalExplicit = data.outgoing.length + data.incoming.length;
  const totalDerived = data.derived.reduce((a, g) => a + g.members.length, 0);
  if (totalExplicit === 0 && totalDerived === 0) return null;

  return (
    <div style={{
      marginTop: 20, borderRadius: 12,
      border: "1px solid var(--gray-200)",
      background: "var(--white)", overflow: "hidden",
    }}>
      <div style={{
        padding: "10px 14px", borderBottom: "1px solid var(--gray-200)",
        background: "#fafafa",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--dark)" }}>
            Connections
          </span>
          <span style={{ fontSize: 11, color: "var(--gray-500)" }}>
            {totalExplicit} explicit
            {totalDerived > 0 && ` · ${totalDerived} derived`}
          </span>
        </div>
      </div>

      <div style={{ padding: "10px 14px" }}>
        {/* Explicit tier — outgoing then incoming */}
        {data.outgoing.length > 0 && (
          <div style={{ marginBottom: totalDerived > 0 || data.incoming.length > 0 ? 8 : 0 }}>
            {data.outgoing.map((e, i) => (
              <EdgeRow key={`out-${i}`} edge={e} projectId={projectId} onNavigate={onNavigate} />
            ))}
          </div>
        )}
        {data.incoming.length > 0 && (
          <div style={{ marginBottom: totalDerived > 0 ? 8 : 0 }}>
            {data.incoming.map((e, i) => (
              <EdgeRow key={`in-${i}`} edge={e} projectId={projectId} onNavigate={onNavigate} />
            ))}
          </div>
        )}

        {/* Derived tier — muted, compact */}
        {data.derived.length > 0 && (
          <div style={{
            marginTop: totalExplicit > 0 ? 10 : 0,
            paddingTop: totalExplicit > 0 ? 10 : 0,
            borderTop: totalExplicit > 0 ? "1px dashed var(--gray-200)" : "none",
            opacity: 0.85,
          }}>
            <div style={{
              fontSize: 10, fontWeight: 700, color: "var(--gray-500)",
              textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4,
            }}>Also related (inferred)</div>
            {data.derived.map((g, i) => (
              <DerivedGroup key={i} group={g} projectId={projectId} onNavigate={onNavigate} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
