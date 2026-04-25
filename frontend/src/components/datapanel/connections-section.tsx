"use client";

// Connections section — reusable card rendered on every finding detail
// view (BR / gap / constraint / contradiction). Consumes the response
// from GET /api/projects/:id/findings/:display_id/connections and
// renders it across four tabs:
//
//   ALL       — explicit + derived combined, dir-arrow column shows
//               outgoing/incoming/derived at a glance
//   OUTGOING  — explicit edges where this item is the source
//   INCOMING  — explicit edges where this item is the target
//   DERIVED   — inferred-at-query-time groups (shared source doc /
//               stakeholder), shown as chip clusters per group
//
// Features:
//   - Filter by neighbor kind (BR / gap / constraint / etc.) via a
//     small toggle pill row
//   - Per-row kebab menu with Jump-to-neighbor, Copy ID, Retract
//     (proposed only). Clicking a row navigates; the kebab is for
//     side-actions
//   - Group-by-kind toggle that swaps the row list for chip clusters
//     grouped by neighbor kind. Useful when an item connects to many
//     things — visual density drops 3×.

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ConnectionsResponse, ConnectionEdge,
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

const KIND_LABEL: Record<ConnectionKind, string> = {
  requirement:   "BR",
  gap:           "Gap",
  constraint:    "Constraint",
  contradiction: "Conflict",
  stakeholder:   "Person",
  document:      "Doc",
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


type Tab = "all" | "outgoing" | "incoming" | "derived";


function KindChip({
  target, projectId, onNavigate,
}: {
  target: ConnectionRef;
  projectId: string;
  onNavigate?: (tab: string, displayId?: string) => void;
}) {
  return (
    <a
      href={`/projects/${projectId}/chat?tab=${KIND_TAB[target.kind]}&highlight=${encodeURIComponent(target.display_id)}`}
      onClick={(e) => {
        if (!onNavigate) return;
        e.preventDefault();
        onNavigate(KIND_TAB[target.kind], target.display_id);
      }}
      title={target.label}
      className="kind-chip"
      data-kind={target.kind}
    >{target.display_id}</a>
  );
}


function ConfidencePill({ c }: { c: ConnectionConfidence }) {
  return <span className={`confidence-pill ${c}`}>{c}</span>;
}


type EdgeDir = "out" | "in" | "derived";


function DirArrow({ dir }: { dir: EdgeDir }) {
  if (dir === "derived") {
    return (
      <svg className="dir-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" /><circle cx="12" cy="12" r="9" strokeDasharray="2 3" />
      </svg>
    );
  }
  return (
    <svg className={`dir-arrow ${dir}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <line x1="5" y1="12" x2="19" y2="12" /><polyline points="13 6 19 12 13 18" />
    </svg>
  );
}


function EdgeRow({
  edge, dir, projectId, onNavigate, hideRel,
}: {
  edge: ConnectionEdge;
  dir: EdgeDir;
  projectId: string;
  onNavigate?: (tab: string, displayId?: string) => void;
  hideRel?: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.parentElement?.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [menuOpen]);

  function jump() {
    onNavigate?.(KIND_TAB[edge.neighbor.kind], edge.neighbor.display_id);
  }

  // Derived rows always drop the rel-type column — "Same document" /
  // "Same stakeholder" is already conveyed by the DERIVED confidence
  // pill + the source-doc chip on the right, so repeating it as the
  // first column is redundant. Explicit rows keep their rel unless
  // the parent passed hideRel (uniform-rel-across-view collapse).
  const skipRel = hideRel || dir === "derived";
  return (
    <div className={`conn-row${dir === "derived" ? " derived" : ""}`}>
      <DirArrow dir={dir} />
      {!skipRel && <span className="rel">{humaniseRel(edge.rel_type)}</span>}
      <KindChip target={edge.neighbor} projectId={projectId} onNavigate={onNavigate} />
      <span className="label">{edge.neighbor.label}</span>
      <ConfidencePill c={edge.confidence} />
      {edge.source_doc && (
        <span className="source" title={edge.source_quote || edge.source_doc}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
          {edge.source_doc}
        </span>
      )}
      <button
        ref={menuRef}
        type="button"
        className={`conn-row-kebab${menuOpen ? " open" : ""}`}
        onClick={(e) => { e.stopPropagation(); setMenuOpen((o) => !o); }}
        aria-label="Row actions"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="5" r="1.4" /><circle cx="12" cy="12" r="1.4" /><circle cx="12" cy="19" r="1.4" />
        </svg>
      </button>
      {menuOpen && (
        <div className="conn-row-menu" onClick={(e) => e.stopPropagation()}>
          <button type="button" onClick={() => { jump(); setMenuOpen(false); }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14" /><polyline points="12 5 19 12 12 19" />
            </svg>
            Jump to {edge.neighbor.display_id}
          </button>
          <button type="button" onClick={() => {
            try { navigator.clipboard.writeText(edge.neighbor.display_id); } catch {}
            setMenuOpen(false);
          }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
            Copy ID
          </button>
          {edge.source_doc && (
            <button type="button" onClick={() => {
              try { navigator.clipboard.writeText(edge.source_doc!); } catch {}
              setMenuOpen(false);
            }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
              Copy source filename
            </button>
          )}
        </div>
      )}
    </div>
  );
}


function GroupedByKind({
  edges, projectId, onNavigate,
}: {
  edges: { edge: ConnectionEdge; dir: EdgeDir }[];
  projectId: string;
  onNavigate?: (tab: string, displayId?: string) => void;
}) {
  const groups = useMemo(() => {
    const m = new Map<ConnectionKind, ConnectionRef[]>();
    for (const { edge } of edges) {
      const k = edge.neighbor.kind;
      const existing = m.get(k) || [];
      if (!existing.some((r) => r.uuid === edge.neighbor.uuid)) {
        existing.push(edge.neighbor);
      }
      m.set(k, existing);
    }
    return Array.from(m.entries()).sort((a, b) => b[1].length - a[1].length);
  }, [edges]);

  if (groups.length === 0) return null;

  return (
    <>
      {groups.map(([kind, refs]) => (
        <div key={kind} className="conn-group">
          <div className="conn-group-head">
            <span className="conn-group-label">{KIND_LABEL[kind] || kind}</span>
            <span className="conn-group-count">· {refs.length}</span>
          </div>
          <div className="conn-group-members">
            {refs.map((r) => (
              <KindChip key={r.uuid} target={r} projectId={projectId} onNavigate={onNavigate} />
            ))}
          </div>
        </div>
      ))}
    </>
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
  const [tab, setTab] = useState<Tab>("all");
  const [grouped, setGrouped] = useState(false);
  const [kindFilter, setKindFilter] = useState<ConnectionKind | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    if (!filterOpen) return;
    const handler = (e: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) {
        setFilterOpen(false);
      }
    };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [filterOpen]);

  // Flatten edges with direction for unified rendering
  const allEdges = useMemo(() => {
    if (!data) return [];
    const out: { edge: ConnectionEdge; dir: EdgeDir }[] = [];
    data.outgoing.forEach((e) => out.push({ edge: e, dir: "out" }));
    data.incoming.forEach((e) => out.push({ edge: e, dir: "in" }));
    // Synthesize derived edges into the same shape so they live in the
    // same list — the UI knows they're derived from the dir flag.
    data.derived.forEach((g) => {
      g.members.forEach((m) => {
        out.push({
          edge: {
            neighbor: m,
            rel_type: g.kind === "shared_source_doc" ? "Same document" : "Same stakeholder",
            confidence: "derived",
            source_doc: g.kind === "shared_source_doc" ? g.key : undefined,
          } as ConnectionEdge,
          dir: "derived",
        });
      });
    });
    return out;
  }, [data]);

  const tabFiltered = useMemo(() => {
    return allEdges.filter(({ dir }) => {
      if (tab === "all") return true;
      if (tab === "outgoing") return dir === "out";
      if (tab === "incoming") return dir === "in";
      if (tab === "derived") return dir === "derived";
      return true;
    });
  }, [allEdges, tab]);

  const finalEdges = useMemo(() => {
    if (!kindFilter) return tabFiltered;
    return tabFiltered.filter(({ edge }) => edge.neighbor.kind === kindFilter);
  }, [tabFiltered, kindFilter]);

  // Counts per tab — unfiltered by kindFilter so they reflect totals.
  const counts = useMemo(() => {
    return {
      all: allEdges.length,
      outgoing: allEdges.filter((e) => e.dir === "out").length,
      incoming: allEdges.filter((e) => e.dir === "in").length,
      derived: allEdges.filter((e) => e.dir === "derived").length,
    };
  }, [allEdges]);

  // Available kinds in current tab — populates the filter dropdown.
  const availableKinds = useMemo(() => {
    const set = new Set<ConnectionKind>();
    tabFiltered.forEach(({ edge }) => set.add(edge.neighbor.kind));
    return Array.from(set);
  }, [tabFiltered]);

  // Uniform rel-type detection — when every visible row shares the
  // same rel_type, the per-row column is redundant. Hide it and show
  // the rel as a single chip in the section head instead. Most common
  // case: the Derived tab where everything is "Same document".
  const uniformRel = useMemo(() => {
    if (finalEdges.length < 2) return null;
    const first = finalEdges[0].edge.rel_type;
    return finalEdges.every(({ edge }) => edge.rel_type === first) ? first : null;
  }, [finalEdges]);

  if (loading) return null;
  if (error || !data) return null;

  if (counts.all === 0) return null;

  return (
    <div className="conn-section">
      <div className="conn-head">
        <div className="conn-head-left">
          <div className="title-icon">
            <svg viewBox="0 0 24 24">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </svg>
          </div>
          <span className="title">Connections</span>
          <span className="count">{counts.all}</span>
        </div>
        <div className="conn-head-right">
          {availableKinds.length > 1 && (
            <div ref={filterRef} style={{ position: "relative" }}>
              <button
                type="button"
                className={`conn-filter-btn${kindFilter ? " active" : ""}`}
                onClick={() => setFilterOpen((o) => !o)}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
                </svg>
                {kindFilter ? KIND_LABEL[kindFilter] : "All kinds"}
                {kindFilter && (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ width: 10, height: 10 }}
                    onClick={(e) => { e.stopPropagation(); setKindFilter(null); }}
                  ><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                )}
              </button>
              {filterOpen && (
                <div className="req-detail-overflow-menu" role="menu">
                  <button type="button" onClick={() => { setKindFilter(null); setFilterOpen(false); }}>
                    All kinds ({tabFiltered.length})
                  </button>
                  {availableKinds.map((k) => {
                    const c = tabFiltered.filter(({ edge }) => edge.neighbor.kind === k).length;
                    return (
                      <button key={k} type="button" onClick={() => { setKindFilter(k); setFilterOpen(false); }}>
                        {KIND_LABEL[k] || k} ({c})
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
          <button
            type="button"
            className={`conn-toggle-btn${grouped ? " on" : ""}`}
            title={grouped ? "Show rows" : "Group by kind"}
            onClick={() => setGrouped((g) => !g)}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ width: 11, height: 11 }}>
              <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
            </svg>
            Group
          </button>
        </div>
      </div>

      <div className="conn-tabs">
        {([
          ["all",      "All",      counts.all],
          ["outgoing", "Outgoing", counts.outgoing],
          ["incoming", "Incoming", counts.incoming],
          ["derived",  "Derived",  counts.derived],
        ] as const).map(([k, label, c]) => (
          <button
            key={k}
            type="button"
            className={`conn-tab${tab === k ? " active" : ""}`}
            onClick={() => setTab(k)}
            disabled={c === 0 && k !== "all"}
            style={c === 0 && k !== "all" ? { opacity: 0.4, cursor: "default" } : undefined}
          >
            {label}
            <span className="tab-c">{c}</span>
          </button>
        ))}
      </div>

      {uniformRel && !grouped && finalEdges.length > 0 && (
        <div className="conn-uniform-rel">
          <span className="conn-uniform-rel-label">All rows</span>
          <span className="conn-uniform-rel-chip">{humaniseRel(uniformRel)}</span>
        </div>
      )}

      <div className="conn-body">
        {finalEdges.length === 0 ? (
          <div className="conn-empty">
            {kindFilter
              ? `No ${KIND_LABEL[kindFilter] || kindFilter} connections in this view.`
              : "No connections in this view."}
          </div>
        ) : grouped ? (
          <GroupedByKind edges={finalEdges} projectId={projectId} onNavigate={onNavigate} />
        ) : (
          finalEdges.map(({ edge, dir }, i) => (
            <EdgeRow
              key={`${dir}-${edge.neighbor.uuid}-${i}`}
              edge={edge}
              dir={dir}
              projectId={projectId}
              onNavigate={onNavigate}
              hideRel={!!uniformRel}
            />
          ))
        )}
      </div>
    </div>
  );
}
