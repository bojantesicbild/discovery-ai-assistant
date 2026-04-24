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

import { useEffect, useState } from "react";
import type {
  ConnectionsResponse, ConnectionEdge, DerivedConnectionGroup,
  ConnectionKind, ConnectionConfidence, ConnectionRef,
} from "@/lib/api";
import { getConnections } from "@/lib/api";


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


function KindChip({
  ref, projectId, onNavigate,
}: {
  ref: ConnectionRef;
  projectId: string;
  onNavigate?: (tab: string, displayId?: string) => void;
}) {
  return (
    <a
      href={`/projects/${projectId}/chat?tab=${KIND_TAB[ref.kind]}&highlight=${encodeURIComponent(ref.display_id)}`}
      onClick={(e) => {
        if (!onNavigate) return;
        e.preventDefault();
        onNavigate(KIND_TAB[ref.kind], ref.display_id);
      }}
      title={ref.label}
      className="kind-chip"
      data-kind={ref.kind}
    >{ref.display_id}</a>
  );
}


function ConfidencePill({ c }: { c: ConnectionConfidence }) {
  return <span className={`confidence-pill ${c}`}>{c}</span>;
}


function EdgeRow({
  edge, projectId, onNavigate,
}: {
  edge: ConnectionEdge;
  projectId: string;
  onNavigate?: (tab: string, displayId?: string) => void;
}) {
  return (
    <div className="conn-row">
      <span className="rel">{humaniseRel(edge.rel_type)}</span>
      <KindChip ref={edge.neighbor} projectId={projectId} onNavigate={onNavigate} />
      <span className="label">{edge.neighbor.label}</span>
      <ConfidencePill c={edge.confidence} />
      {edge.source_doc && (
        <span className="source" title={edge.source_quote || edge.source_doc}>
          📄 {edge.source_doc}
        </span>
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
    <div className="group">
      <div className="group-label">{label}</div>
      <div className="group-members">
        {group.members.map((m) => (
          <KindChip key={m.uuid} ref={m} projectId={projectId} onNavigate={onNavigate} />
        ))}
      </div>
    </div>
  );
}


interface Props {
  projectId: string;
  displayId: string;
  refreshKey?: number;
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

  if (loading) return null;
  if (error || !data) return null;

  const totalExplicit = data.outgoing.length + data.incoming.length;
  const totalDerived = data.derived.reduce((a, g) => a + g.members.length, 0);
  if (totalExplicit === 0 && totalDerived === 0) return null;

  return (
    <div className="conn-section">
      <div className="conn-head">
        <span className="title">Connections</span>
        <span className="count">
          {totalExplicit} explicit
          {totalDerived > 0 && ` · ${totalDerived} derived`}
        </span>
      </div>

      <div className="conn-body">
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

        {data.derived.length > 0 && (
          <div className="conn-derived" style={totalExplicit === 0 ? { marginTop: 0, paddingTop: 0, borderTop: "none" } : undefined}>
            <div className="group-label">Also related (inferred)</div>
            {data.derived.map((g, i) => (
              <DerivedGroup key={i} group={g} projectId={projectId} onNavigate={onNavigate} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
