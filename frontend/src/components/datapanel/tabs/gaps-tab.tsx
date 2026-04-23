"use client";

// Gaps tab with three sub-sections: Gaps | Constraints | Conflicts.
// Each sub-section has its own table, filter, and detail interactions.
// Extracted from DataPanel.tsx so the ~420 lines of sub-section render
// don't dwarf the main orchestration. Uses a typed props contract; no
// internal data fetching.

import { Fragment, useState } from "react";
import {
  Chevron, SevBadge, FilterChip, StatusPill, GapStatusPill,
  GapClientBadge, EmptyState,
} from "../pills";
import { TableSearch, SortableHeader, Pagination } from "../../TableControls";
import { applyTableState, type TableState } from "@/lib/tableState";
import { formatAge } from "@/lib/dates";
import { resolveContradiction, type FindingType } from "@/lib/api";
import type {
  ApiGap, ApiConstraint, ApiContradiction,
  ReqClientFeedback, GapClientFeedback,
} from "@/lib/api";


interface GapsTabProps {
  projectId: string;
  gaps: ApiGap[];
  setGaps: React.Dispatch<React.SetStateAction<ApiGap[]>>;
  constraints: ApiConstraint[];
  setConstraints: React.Dispatch<React.SetStateAction<ApiConstraint[]>>;
  contradictions: ApiContradiction[];
  setContradictions: React.Dispatch<React.SetStateAction<ApiContradiction[]>>;
  gapsTable: TableState;
  consTable: TableState;
  contraTable: TableState;
  gapSection: "gaps" | "constraints" | "conflicts";
  setGapSection: (s: "gaps" | "constraints" | "conflicts") => void;
  gapStatusFilter: string;
  setGapStatusFilter: (v: string) => void;
  contraFilter: string;
  setContraFilter: (v: string) => void;
  unreadCounts: { gap: number; constraint: number; contradiction: number };
  markTabSeenAll: (findingType: FindingType, setter?: (updater: (prev: any[]) => any[]) => void) => Promise<void>;
  markRowSeen: (findingType: FindingType, findingId: string, setter?: (updater: (prev: any[]) => any[]) => void) => Promise<void>;
  openGap: (gap: ApiGap) => void;
  openConstraint: (c: ApiConstraint, index: number) => void;
  clientFeedback: {
    requirements: Record<string, ReqClientFeedback>;
    gaps: Record<string, GapClientFeedback>;
  };
  expandedRow: string | null;
  setExpandedRow: (id: string | null) => void;
  onNavigate?: (tab: string, itemId?: string) => void;
  loadData: () => void;
}


export function GapsTab({
  projectId, gaps, setGaps, constraints, setConstraints, contradictions, setContradictions,
  gapsTable, consTable, contraTable,
  gapSection, setGapSection, gapStatusFilter, setGapStatusFilter,
  contraFilter, setContraFilter,
  unreadCounts, markTabSeenAll, markRowSeen,
  openGap, openConstraint, clientFeedback,
  expandedRow, setExpandedRow, onNavigate, loadData,
}: GapsTabProps) {
  return (
    <div className="dp-tab-content active">
      {/* Section pills: Gaps | Constraints | Conflicts */}
      <div style={{ display: "flex", gap: 4, padding: 3, background: "var(--gray-50)", borderRadius: 10, marginBottom: 12 }}>
        {([
          { id: "gaps" as const, label: "Gaps", count: gaps.length, color: "#F59E0B" },
          { id: "constraints" as const, label: "Constraints", count: constraints.length, color: "#d97706" },
          { id: "conflicts" as const, label: "Conflicts", count: contradictions.length, color: "#EF4444" },
        ]).map((sec) => (
          <button
            key={sec.id}
            onClick={() => setGapSection(sec.id)}
            style={{
              flex: 1, padding: "7px 12px", borderRadius: 7, border: "none",
              background: gapSection === sec.id ? "#fff" : "transparent",
              color: gapSection === sec.id ? "var(--dark)" : "var(--gray-500)",
              fontSize: 12, fontWeight: 600, cursor: "pointer",
              fontFamily: "var(--font)",
              boxShadow: gapSection === sec.id ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
              transition: "all 0.15s",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
            }}
          >
            {sec.label}
            {sec.count > 0 && (
              <span style={{
                fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 8,
                background: gapSection === sec.id ? `${sec.color}20` : "var(--gray-100)",
                color: gapSection === sec.id ? sec.color : "var(--gray-500)",
              }}>
                {sec.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Gaps sub-section ── */}
      {gapSection === "gaps" && (<>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 6 }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: "var(--gray-400)", letterSpacing: 0.5, textTransform: "uppercase", marginRight: 2 }}>Status</span>
        {["all", "open", "resolved", "dismissed"].map((f) => (
          <FilterChip key={`gs-${f}`} value={f} label={f === "all" ? "All" : f.replace("-", " ")} active={gapStatusFilter === f} onClick={() => setGapStatusFilter(f)} />
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
        <TableSearch state={gapsTable} placeholder="Search gaps…" />
        {unreadCounts.gap > 0 && (
          <button
            onClick={() => markTabSeenAll("gap", setGaps)}
            title="Mark all gaps as read"
            style={{
              marginLeft: "auto", padding: "4px 10px", borderRadius: 6,
              background: "var(--green-light)", color: "#059669",
              border: "1px solid var(--green-mid)",
              fontSize: 11, fontWeight: 600, cursor: "pointer",
            }}
          >
            ✓ Mark all read ({unreadCounts.gap})
          </button>
        )}
      </div>
      {gaps.length === 0 ? (
        <EmptyState icon="M12 9v2m0 4h.01" text="No gaps detected. Run gap analysis from the chat to identify missing requirements." />
      ) : (() => {
        const filtered = gaps.filter((g) => gapStatusFilter === "all" || g.status === gapStatusFilter);
        const { visible, filteredCount, totalPages, pageStart, pageEnd } = applyTableState(
          filtered,
          gapsTable,
          ["gap_id", "question", "area", "severity", "status", "source_person"],
          (item, key) => {
            if (key === "severity") {
              const order: Record<string, number> = { high: 0, medium: 1, low: 2 };
              return order[item.severity] ?? 99;
            }
            return (item as unknown as Record<string, unknown>)[key];
          },
        );
        return (
          <>
            <table className="panel-table">
              <thead>
                <tr>
                  <SortableHeader label="ID" columnKey="gap_id" state={gapsTable} />
                  <SortableHeader label="Gap Question" columnKey="question" state={gapsTable} />
                  <SortableHeader label="Area" columnKey="area" state={gapsTable} />
                  <SortableHeader label="Status" columnKey="status" state={gapsTable} />
                </tr>
              </thead>
              <tbody>
                {visible.map((gap) => (
                  <Fragment key={gap.id}>
                    <tr
                      className="clickable-row"
                      style={!gap.seen_at ? { background: "rgba(0, 229, 160, 0.14)" } : undefined}
                      onClick={() => {
                        onNavigate?.("gaps", gap.gap_id);
                        if (gap.id && !gap.seen_at) markRowSeen("gap", gap.id, setGaps);
                        openGap(gap);
                      }}
                    >
                      <td style={{
                        whiteSpace: "nowrap", lineHeight: 1.2,
                        borderLeft: !gap.seen_at ? "3px solid var(--green)" : undefined,
                      }}>
                        <div style={{ fontFamily: "'SF Mono', 'Fira Code', monospace", fontSize: 11, color: "var(--gray-600)" }}>{gap.gap_id}</div>
                        <div style={{ marginTop: 2 }}><SevBadge severity={gap.severity} /></div>
                        {gap.created_at && (
                          <div
                            style={{ fontSize: 9, color: "var(--gray-400)", fontWeight: 500, marginTop: 2 }}
                            title={new Date(gap.created_at).toLocaleString()}
                          >{formatAge(gap.created_at)}</div>
                        )}
                      </td>
                      <td style={{ fontWeight: 500 }} title={gap.question}>
                        <div className="cell-title">{gap.question}</div>
                      </td>
                      <td style={{ color: "var(--gray-500)", fontSize: 11 }}>{gap.area}</td>
                      <td>
                        {(() => {
                          const fb = clientFeedback.gaps[gap.gap_id];
                          // Collapse when PM has resolved AND client has answered.
                          const aligned = fb && gap.status === "resolved";
                          if (fb && aligned) return <GapClientBadge fb={fb} />;
                          return (
                            <div style={{ display: "flex", flexDirection: "column", gap: 3, alignItems: "flex-start" }}>
                              <GapStatusPill status={gap.status} />
                              {fb && <GapClientBadge fb={fb} />}
                            </div>
                          );
                        })()}
                      </td>
                    </tr>
                  </Fragment>
                ))}
              </tbody>
            </table>
            <Pagination state={gapsTable} total={filteredCount} pageStart={pageStart} pageEnd={pageEnd} totalPages={totalPages} />
          </>
        );
      })()}
      </>)}

      {/* ── Constraints sub-section ── */}
      {gapSection === "constraints" && (
        <div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
            <TableSearch state={consTable} placeholder="Search constraints…" />
            {unreadCounts.constraint > 0 && (
              <button
                onClick={() => markTabSeenAll("constraint", setConstraints)}
                title="Mark all constraints as read"
                style={{
                  marginLeft: "auto", padding: "4px 10px", borderRadius: 6,
                  background: "var(--green-light)", color: "#059669",
                  border: "1px solid var(--green-mid)",
                  fontSize: 11, fontWeight: 600, cursor: "pointer",
                }}
              >
                ✓ Mark all read ({unreadCounts.constraint})
              </button>
            )}
          </div>
          {constraints.length === 0 ? (
            <EmptyState icon="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4" text="No constraints extracted yet." />
          ) : (() => {
            const { visible, filteredCount, totalPages, pageStart, pageEnd } = applyTableState(
              constraints, consTable, ["type", "description", "impact", "status"],
            );
            return (
              <>
                <table className="panel-table">
                  <thead>
                    <tr>
                      <th style={{ width: 20 }}></th>
                      <th style={{ width: 60 }}>ID</th>
                      <SortableHeader label="Type" columnKey="type" state={consTable} />
                      <SortableHeader label="Constraint" columnKey="description" state={consTable} />
                      <SortableHeader label="Impact" columnKey="impact" state={consTable} />
                      <SortableHeader label="Status" columnKey="status" state={consTable} />
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((c, i) => {
                      const absoluteIndex = constraints.findIndex((x) => x.id === c.id);
                      const conId = `CON-${String(absoluteIndex + 1).padStart(3, "0")}`;
                      return (
                        <tr
                          key={c.id || i}
                          className="clickable-row"
                          style={!c.seen_at ? { background: "rgba(0, 229, 160, 0.14)" } : undefined}
                          onClick={() => {
                            openConstraint(c, absoluteIndex);
                            onNavigate?.("constraints", conId);
                            if (c.id && !c.seen_at) markRowSeen("constraint", c.id, setConstraints);
                          }}
                        >
                          <td className="chevron-cell" style={!c.seen_at ? { borderLeft: "4px solid var(--green)" } : undefined}>
                            <Chevron />
                          </td>
                          <td style={{ fontFamily: "'SF Mono', 'Fira Code', monospace", fontSize: 11, color: "var(--gray-600)", whiteSpace: "nowrap", lineHeight: 1.2 }}>
                            {conId}
                            {c.created_at && (
                              <div
                                style={{ fontSize: 9, color: "var(--gray-400)", fontWeight: 500, marginTop: 2, fontFamily: "var(--font)" }}
                                title={new Date(c.created_at).toLocaleString()}
                              >{formatAge(c.created_at)}</div>
                            )}
                          </td>
                          <td>
                            <span className="sev-badge" style={{
                              background: c.type === "budget" ? "#EF444420" : c.type === "technology" ? "#3B82F620" : "#F59E0B20",
                              color: c.type === "budget" ? "#EF4444" : c.type === "technology" ? "#3B82F6" : "#F59E0B",
                            }}>{c.type}</span>
                          </td>
                          <td>
                            <div style={{ fontWeight: 500, fontSize: 12 }}>{c.description?.slice(0, 80)}{c.description?.length > 80 ? "..." : ""}</div>
                          </td>
                          <td style={{ fontSize: 11, color: "var(--gray-500)", maxWidth: 200 }}>{c.impact?.slice(0, 60)}</td>
                          <td><StatusPill status={c.status} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <Pagination state={consTable} total={filteredCount} pageStart={pageStart} pageEnd={pageEnd} totalPages={totalPages} />
              </>
            );
          })()}
        </div>
      )}

      {/* ── Conflicts sub-section ── */}
      {gapSection === "conflicts" && (
        <div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
            <TableSearch state={contraTable} placeholder="Search contradictions…" />
            <div className="panel-filter" style={{ marginBottom: 0 }}>
              {["all", "open", "resolved"].map((f) => (
                <button key={f} className={`panel-filter-btn${contraFilter === f ? " active" : ""}`} onClick={() => setContraFilter(f)} style={{ textTransform: "capitalize" }}>
                  {f}
                </button>
              ))}
            </div>
            {unreadCounts.contradiction > 0 && (
              <button
                onClick={() => markTabSeenAll("contradiction", setContradictions)}
                title="Mark all contradictions as read"
                style={{
                  marginLeft: "auto", padding: "4px 10px", borderRadius: 6,
                  background: "var(--green-light)", color: "#059669",
                  border: "1px solid var(--green-mid)",
                  fontSize: 11, fontWeight: 600, cursor: "pointer",
                }}
              >
                ✓ Mark all read ({unreadCounts.contradiction})
              </button>
            )}
          </div>
          {contradictions.length === 0 ? (
            <EmptyState icon="M13 10V3L4 14h7v7l9-11h-7z" text="No contradictions detected between sources." />
          ) : (() => {
            const filtered = contradictions.filter((c) =>
              contraFilter === "all" ? true :
              contraFilter === "open" ? !c.resolved :
              c.resolved
            );
            const { visible, filteredCount, totalPages, pageStart, pageEnd } = applyTableState(
              filtered, contraTable, ["item_a_type", "item_a_ref", "item_b_ref", "explanation"],
            );
            return (
              <>
                <table className="panel-table">
                  <thead>
                    <tr>
                      <th style={{ width: 20 }}></th>
                      <th>Impact</th>
                      <SortableHeader label="Contradiction" columnKey="item_a_ref" state={contraTable} />
                      <SortableHeader label="Area" columnKey="item_a_type" state={contraTable} />
                      <SortableHeader label="Status" columnKey="resolved" state={contraTable} />
                      <th style={{ width: 70 }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((c) => (
                      <Fragment key={c.id}>
                        <tr
                          className="clickable-row"
                          style={!c.seen_at ? { background: "rgba(0, 229, 160, 0.14)" } : undefined}
                          onClick={() => {
                            const next = expandedRow === c.id ? null : c.id;
                            setExpandedRow(next);
                            onNavigate?.("contradictions", next ? String(c.id).slice(0, 8) : undefined);
                            if (c.id && !c.seen_at) markRowSeen("contradiction", c.id, setContradictions);
                          }}
                        >
                          <td className="chevron-cell" style={!c.seen_at ? { borderLeft: "4px solid var(--green)" } : undefined}>
                            <Chevron open={expandedRow === c.id} />
                          </td>
                          <td><SevBadge severity="high" /></td>
                          <td>
                            <div style={{ fontWeight: 600, fontSize: 12 }}>{_contraTitle(c)}</div>
                            <div style={{ fontSize: 11, color: "var(--gray-500)", marginTop: 2 }}>
                              {_contraSubtitle(c).slice(0, 80)}{_contraSubtitle(c).length > 80 ? "…" : ""}
                            </div>
                          </td>
                          <td style={{ color: "var(--gray-500)", fontSize: 11, whiteSpace: "nowrap", lineHeight: 1.2 }}>
                            {c.area || (c.item_a_type && c.item_a_type !== "unknown" ? c.item_a_type : "—")}
                            {c.created_at && (
                              <div
                                style={{ fontSize: 9, color: "var(--gray-400)", fontWeight: 500, marginTop: 2 }}
                                title={new Date(c.created_at).toLocaleString()}
                              >{formatAge(c.created_at)}</div>
                            )}
                          </td>
                          <td><GapStatusPill status={c.resolved ? "resolved" : "open"} /></td>
                          <td>
                            {!c.resolved && (
                              <button className="inline-action" onClick={(e) => { e.stopPropagation(); setExpandedRow(c.id); }} title="Resolve">&#10003;</button>
                            )}
                          </td>
                        </tr>
                        {expandedRow === c.id && (
                          <tr className="detail-row">
                            <td colSpan={6}>
                              <div className="contra-detail">
                                {(() => {
                                  // Resolve both sides from whichever source is available —
                                  // native fields first (side_a / side_b), then the legacy
                                  // item_a_ref / item_b_ref for ancient rows.
                                  const sideAText = c.side_a
                                    || (c.item_a_ref && !c.item_a_ref.startsWith("New ") ? c.item_a_ref : null);
                                  const sideBText = c.side_b
                                    || (c.item_b_ref && !c.item_b_ref.startsWith("New ") ? c.item_b_ref : null)
                                    || (c.explanation ? _extractConflictDetail(c.explanation) : null);
                                  return (
                                    <div className="cd-quotes">
                                      {sideAText && (
                                        <div className="cd-quote side-a">
                                          <div className="cd-quote-header">
                                            <span className="cd-quote-badge a">Side A</span>
                                            {c.item_a_source && <span className="gap-meta-chip file">{c.item_a_source}</span>}
                                            {c.item_a_person && <span className="person-chip">{c.item_a_person}</span>}
                                          </div>
                                          <div className="cd-quote-text">{sideAText}</div>
                                        </div>
                                      )}
                                      {sideAText && sideBText && <div className="cd-quote-vs">VS</div>}
                                      {sideBText && (
                                        <div className="cd-quote side-b">
                                          <div className="cd-quote-header">
                                            <span className="cd-quote-badge b">Side B</span>
                                            {c.item_b_source && <span className="gap-meta-chip" style={{ background: "#fee2e2", color: "#EF4444" }}>{c.item_b_source}</span>}
                                            {c.item_b_person && <span className="person-chip">{c.item_b_person}</span>}
                                          </div>
                                          <div className="cd-quote-text">{sideBText}</div>
                                        </div>
                                      )}
                                    </div>
                                  );
                                })()}
                                {/* Raw explanation shown ONLY on ancient rows where
                                    neither side_a/side_b nor item_*_ref resolved. */}
                                {!c.side_a && !c.side_b && !c.item_a_ref && !c.item_b_ref && c.explanation && (
                                  <div className="cd-explanation">{c.explanation}</div>
                                )}
                                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                                  {c.created_at && (
                                    <span className="gap-meta-chip">Detected {new Date(c.created_at).toLocaleDateString()}</span>
                                  )}
                                  <span className="gap-meta-chip" style={{ background: "#EF444415", color: "#EF4444" }}>
                                    {c.resolved ? "Resolved" : "Unresolved"}
                                  </span>
                                </div>
                                <div className="gap-ai-suggestion">
                                  <div className="ai-label">AI Recommendation</div>
                                  {c.suggested_resolution || "Review both sources with the people involved. Determine which statement is current and whether the earlier requirement needs updating."}
                                </div>
                                {c.resolved ? (
                                  <div className="gap-resolution-box">
                                    <div className="res-label">Resolution</div>
                                    {c.resolution_note}
                                  </div>
                                ) : (
                                  <ContraResolveForm
                                    onResolve={async (note) => {
                                      await resolveContradiction(projectId, c.id, note);
                                      setExpandedRow(null);
                                      loadData();
                                    }}
                                  />
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
                <Pagination state={contraTable} total={filteredCount} pageStart={pageStart} pageEnd={pageEnd} totalPages={totalPages} />
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
}


function _extractConflictDetail(explanation: string): string {
  if (!explanation) return "Conflicting information from new document";
  const m1 = explanation.match(/[Nn]ew document[^.]*says\s+(.+?)(?:\.|$)/);
  if (m1) return m1[1].trim();
  const m2 = explanation.match(/new document says:?\s*"?(.+?)(?:"|$)/i);
  if (m2) return m2[1].trim();
  const m3 = explanation.match(/—\s*(.+?)(?:\.|$)/);
  if (m3) return m3[1].trim();
  const m4 = explanation.match(/(?:New|but)\s+(.{20,120})/i);
  if (m4) return m4[1].trim().replace(/\.$/, "");
  return explanation.slice(0, 120);
}


// Contradictions have first-class fields (title / side_a / side_b /
// area) since migration 025. Most rows read straight from those. The
// fallbacks below handle:
//   - pre-025 rows that haven't been re-extracted (title NULL)
//   - rows where the agent mapped to real DB rows via item_a_ref
function _contraTitle(c: ApiContradiction): string {
  if (c.title) return c.title.slice(0, 60);
  if (c.item_a_ref && !c.item_a_ref.startsWith("New ")) {
    return c.item_a_ref.slice(0, 60);
  }
  const expl = (c.explanation || "").trim();
  if (!expl) return "Contradiction";
  // Legacy pre-025 fallback — old MCP wrote "<title>: <body>" here.
  const colon = expl.indexOf(":");
  if (colon > 0 && colon < 80) return expl.slice(0, colon).trim();
  return expl.slice(0, 60);
}

function _contraSubtitle(c: ApiContradiction): string {
  // Combine the two sides when both present — "X  ↔  Y".
  if (c.side_a && c.side_b) return `${c.side_a}  ↔  ${c.side_b}`;
  if (c.side_b) return c.side_b;
  if (c.side_a) return c.side_a;
  // Legacy fallback for pre-025 rows.
  if (c.item_b_ref && !c.item_b_ref.startsWith("New ")) return `vs ${c.item_b_ref}`;
  const expl = (c.explanation || "").trim();
  const colon = expl.indexOf(":");
  const body = colon > 0 && colon < 80 ? expl.slice(colon + 1).trim() : expl;
  return body || "Conflict detected";
}


function ContraResolveForm({ onResolve }: { onResolve: (note: string) => void }) {
  const [note, setNote] = useState("");
  return (
    <div className="cd-decision">
      <div className="cd-decision-label">Your Decision</div>
      <textarea
        placeholder="Type your decision to resolve this contradiction..."
        value={note}
        onChange={(e) => setNote(e.target.value)}
        className="gap-resolve-input"
      />
      <div className="cd-decision-actions">
        <button className="cd-action-btn primary" disabled={!note.trim()} onClick={() => onResolve(note)}>Resolve</button>
        <button className="cd-action-btn info">Add to Meeting</button>
      </div>
    </div>
  );
}
