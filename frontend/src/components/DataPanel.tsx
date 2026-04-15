"use client";

import { Fragment, useEffect, useState } from "react";
import {
  getDashboard, listRequirements, listContradictions, listDocuments,
  deleteDocument, updateRequirement, resolveContradiction, listGaps, resolveGap,
  listConstraints, listHandoffDocs, getHandoffDoc, generateHandoffStream,
  getDocumentContent, getReadiness, getReadinessTrajectory, getLatestDigest,
  listIntegrations,
  markFindingSeen, markFindingsTypeSeenAll, type FindingType,
} from "@/lib/api";
import MarkdownPanel from "./MarkdownPanel";
import GmailImportPanel from "./GmailImportPanel";
import DriveImportPanel from "./DriveImportPanel";
import { usePersistedState } from "@/lib/persistedState";
import { useUnreadCounts } from "@/lib/useUnreadCounts";
import { useTableState, applyTableState } from "@/lib/tableState";
import { TableSearch, SortableHeader, Pagination } from "./TableControls";

interface DataPanelProps {
  projectId: string;
  refreshKey?: number;
  initialTab?: string;
  highlightId?: string;
  onNavigate?: (tab: string, itemId?: string) => void;
}

interface DetailView {
  title: string;
  content: string;
  meta?: Record<string, string>;
  actions?: { label: string; value: string; color: string }[];
  onAction?: (value: string) => void;
  history?: { projectId: string; itemType: string; itemId: string };
}

const TABS = [
  { id: "reqs", label: "Requirements", icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" },
  { id: "gaps", label: "Gaps", icon: "M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" },
  { id: "meeting", label: "Meeting Prep", icon: "M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 7a4 4 0 100-8 4 4 0 000 8M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" },
  { id: "handoff", label: "Handoff", icon: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" },
  { id: "docs", label: "Documents", icon: "M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z M14 2v6h6" },
];

// Maps DataPanel tab id → backend finding type. Tabs that don't have an
// underlying finding type (meeting, handoff, docs) are absent.
const TAB_TO_FINDING_TYPE: Record<string, FindingType | undefined> = {
  reqs: "requirement",
  gaps: "gap",
  // constraints + contradictions are subsections of the gaps tab now
};

export default function DataPanel({ projectId, refreshKey = 0, initialTab, highlightId, onNavigate }: DataPanelProps) {
  // Active tab persists per-project so each project remembers where you were.
  // initialTab (from URL) overrides the persisted value when present.
  const [activeTab, setActiveTab] = usePersistedState<string>(
    `datapanel:tab:${projectId}`,
    initialTab || "reqs",
  );
  const [dashboard, setDashboard] = useState<any>(null);
  const [requirements, setRequirements] = useState<any[]>([]);
  const [contradictions, setContradictions] = useState<any[]>([]);
  const [documents, setDocuments] = useState<any[]>([]);
  const [gmailOpen, setGmailOpen] = useState(false);
  const [gmailConnected, setGmailConnected] = useState(false);
  const [driveOpen, setDriveOpen] = useState(false);
  const [driveConnected, setDriveConnected] = useState(false);
  const [gaps, setGaps] = useState<any[]>([]);
  const [constraints, setConstraints] = useState<any[]>([]);
  const [detail, setDetail] = useState<DetailView | null>(null);
  // Per-user unread counts (polled every 15s)
  const { counts: unreadCounts, refresh: refreshUnread } = useUnreadCounts(projectId);

  // Table state (search/sort/page) per tab — persisted per project
  const reqsTable = useTableState(`reqs:${projectId}`, "req_id", "asc", 10);
  const gapsTable = useTableState(`gaps:${projectId}`, "severity", "asc", 10);
  const consTable = useTableState(`cons:${projectId}`, "type", "asc", 10);
  const contraTable = useTableState(`contra:${projectId}`, "item_a_type", "asc", 10);

  // Mark a finding seen by the current user. Optimistically updates local
  // state so the unread bar/badge clears immediately, then fires the API.
  // Used by every row's onClick handler.
  const markRowSeen = async (findingType: FindingType, findingId: string, setter?: (updater: (prev: any[]) => any[]) => void) => {
    if (setter) {
      setter((prev) => prev.map((row) => (row.id === findingId ? { ...row, seen_at: new Date().toISOString() } : row)));
    }
    try {
      await markFindingSeen(projectId, findingType, findingId);
      refreshUnread();
    } catch {
      /* best-effort */
    }
  };

  // "Mark all read" button per-tab. Bumps every finding of `findingType`
  // and refreshes the badge counts.
  const markTabSeenAll = async (findingType: FindingType, setter?: (updater: (prev: any[]) => any[]) => void) => {
    if (setter) {
      const now = new Date().toISOString();
      setter((prev) => prev.map((row) => ({ ...row, seen_at: row.seen_at || now })));
    }
    try {
      await markFindingsTypeSeenAll(projectId, findingType);
      refreshUnread();
    } catch {
      /* best-effort */
    }
  };

  // Filter selections persist per-project
  const [priorityFilter, setPriorityFilter] = usePersistedState<string>(
    `datapanel:priorityFilter:${projectId}`,
    "all",
  );
  const [statusFilter, setStatusFilter] = usePersistedState<string>(
    `datapanel:statusFilter:${projectId}`,
    "all",
  );
  const [gapSection, setGapSection] = usePersistedState<"gaps" | "constraints" | "conflicts">(
    `datapanel:gapSection:${projectId}`,
    "gaps",
  );
  const [contraFilter, setContraFilter] = usePersistedState<string>(
    `datapanel:contraFilter:${projectId}`,
    "all",
  );
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [showReadiness, setShowReadiness] = useState(false);
  const [readinessChecks, setReadinessChecks] = useState<any[]>([]);
  const [trajectory, setTrajectory] = useState<any>(null);

  async function openReadinessPanel() {
    try {
      const [rData, tData] = await Promise.all([
        getReadiness(projectId),
        getReadinessTrajectory(projectId).catch(() => null),
      ]);
      setReadinessChecks(rData.breakdown?.checks || []);
      setTrajectory(tData);
    } catch {}
    setShowReadiness(true);
  }

  // React to external tab/highlight changes
  useEffect(() => {
    if (initialTab) setActiveTab(initialTab);
  }, [initialTab]);

  // Auto-open highlighted item after data loads
  useEffect(() => {
    if (!highlightId) return;

    if (initialTab === "reqs") {
      const req = requirements.find((r: any) => r.req_id === highlightId);
      if (req) openRequirement(req);
    } else if (initialTab === "gaps") {
      const gap = gaps.find((g: any) => g.gap_id === highlightId);
      if (gap) setExpandedRow(gap.id);
    } else if (initialTab === "constraints") {
      const con = constraints.find((c: any) => String(c.id).startsWith(highlightId));
      if (con) setExpandedRow(con.id);
    } else if (initialTab === "contradictions") {
      const ct = contradictions.find((c: any) => String(c.id).startsWith(highlightId));
      if (ct) setExpandedRow(ct.id);
    } else if (initialTab === "docs") {
      // highlightId may be either a document UUID or a filename. Match either.
      const doc = documents.find((d: any) => d.id === highlightId || d.filename === highlightId);
      if (doc) openDocument(doc);
    }
  }, [highlightId, initialTab, requirements, gaps, constraints, contradictions, documents]);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 15000);
    return () => clearInterval(interval);
  }, [projectId, refreshKey]);

  useEffect(() => {
    listIntegrations(projectId)
      .then((d) => {
        const ints = d.integrations || [];
        setGmailConnected(ints.some((i) => i.connector_id === "gmail" && i.status === "active"));
        setDriveConnected(ints.some((i) => i.connector_id === "google_drive" && i.status === "active"));
      })
      .catch(() => {});
  }, [projectId]);

  async function loadData() {
    try {
      const [dash, reqs, contras, docs, gapsData, consData] = await Promise.all([
        getDashboard(projectId),
        listRequirements(projectId),
        listContradictions(projectId),
        listDocuments(projectId),
        listGaps(projectId),
        listConstraints(projectId),
      ]);
      setDashboard(dash);
      setRequirements(reqs.items || []);
      setContradictions(contras.items || []);
      setDocuments(docs.documents || []);
      setGaps(gapsData.items || []);
      setConstraints(consData.items || []);
    } catch {}
  }

  const readiness = dashboard?.readiness;
  const score = readiness?.score ?? 0;
  const circumference = 2 * Math.PI * 15;
  const offset = circumference - (score / 100) * circumference;

  const openContras = contradictions.filter((c: any) => !c.resolved);
  const openGaps = gaps.filter((g: any) => g.status === "open" || g.status === "in-progress");

  // If detail view is open
  if (detail) {
    return (
      <div className="data-panel" style={{ flex: 1, width: "100%" }}>
        <MarkdownPanel
          title={detail.title}
          content={detail.content}
          meta={detail.meta}
          onClose={() => { setDetail(null); onNavigate?.(activeTab); }}
          actions={detail.actions}
          onAction={detail.onAction}
          history={detail.history}
        />
      </div>
    );
  }

  // Readiness detail view
  if (showReadiness) {
    return (
      <div className="data-panel" style={{ flex: 1, width: "100%" }}>
        <ReadinessPanel
          onClose={() => setShowReadiness(false)}
          score={score}
          checks={readinessChecks}
          trajectory={trajectory}
          requirements={requirements}
          gaps={gaps}
          contradictions={contradictions}
          constraints={constraints}
        />
      </div>
    );
  }

  return (
    <div className="data-panel" style={{ flex: 1, width: "100%" }}>
      {/* Header with readiness ring */}
      <div className="dp-header" style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div className="dp-readiness" style={{ flex: 1, cursor: "pointer" }} onClick={openReadinessPanel}>
          <div className="dp-rb-ring">
            <svg viewBox="0 0 36 36">
              <circle cx="18" cy="18" r="15" className="bg" />
              <circle cx="18" cy="18" r="15" className="fg" style={{ strokeDasharray: circumference, strokeDashoffset: offset }} />
            </svg>
            <div className="dp-rb-val">{Math.round(score)}%</div>
          </div>
          <div style={{ flex: 1 }}>
            <div className="dp-rb-label">Discovery Readiness</div>
            <div className="dp-rb-sub">
              {score >= 85 ? "Ready for handoff" : score >= 65 ? "Conditionally ready" : "Not ready"} ·{" "}
              {requirements.length} requirements · {openContras.length} open contradictions · {openGaps.length} gaps
            </div>
          </div>
        </div>
        <button onClick={openReadinessPanel} style={{
          fontSize: 10, fontWeight: 600, color: "var(--gray-500)", display: "flex", alignItems: "center", gap: 4,
          padding: "4px 10px", borderRadius: 6, border: "1px solid var(--gray-200)",
          background: "var(--white)", cursor: "pointer", fontFamily: "var(--font)", flexShrink: 0,
        }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>
          </svg>
          Info
        </button>
      </div>

      {/* Tabs */}
      <div className="dp-tabs">
        {TABS.map((tab) => {
          let count: number | null = null;
          if (tab.id === "reqs") count = requirements.length;
          if (tab.id === "gaps") count = gaps.length;
          // constraints + contradictions are subsections of the gaps tab
          if (tab.id === "gaps") count = gaps.length + constraints.length + contradictions.length;
          if (tab.id === "docs") count = documents.length;

          // Per-tab unread count (mapped from tab id → finding type)
          const findingType = TAB_TO_FINDING_TYPE[tab.id];
          const unread = findingType ? (unreadCounts[findingType] || 0) : 0;

          return (
            <div
              key={tab.id}
              className={`dp-tab${activeTab === tab.id ? " active" : ""}`}
              onClick={() => { setActiveTab(tab.id); setExpandedRow(null); onNavigate?.(tab.id); }}
            >
              {tab.label}
              {count !== null && count > 0 && <span className="tab-count">{count}</span>}
              {unread > 0 && (
                <span
                  title={`${unread} unread`}
                  style={{
                    marginLeft: 4,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    minWidth: 16,
                    height: 16,
                    padding: "0 5px",
                    borderRadius: 8,
                    background: "var(--green)",
                    color: "#0f172a",
                    fontSize: 9,
                    fontWeight: 700,
                  }}
                >
                  {unread}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Tab content */}
      <div className="dp-body">

        {/* ── REQUIREMENTS ── */}
        {activeTab === "reqs" && (
          <div className="dp-tab-content active">
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
              <TableSearch state={reqsTable} placeholder="Search requirements…" />
              <div className="panel-filter" style={{ marginBottom: 0 }}>
                {["all", "must", "should", "could"].map((f) => (
                  <button key={f} className={`panel-filter-btn${priorityFilter === f ? " active" : ""}`} onClick={() => setPriorityFilter(f)} style={{ textTransform: "capitalize" }}>
                    {f === "all" ? "All" : f}
                  </button>
                ))}
              </div>
              <div style={{ width: 1, height: 16, background: "var(--gray-200)" }} />
              <div className="panel-filter" style={{ marginBottom: 0 }}>
                {["all", "confirmed", "discussed", "proposed"].map((f) => (
                  <button key={f} className={`panel-filter-btn${statusFilter === f ? " active" : ""}`} onClick={() => setStatusFilter(f)} style={{ textTransform: "capitalize" }}>
                    {f === "all" ? "All Status" : f}
                  </button>
                ))}
              </div>
              {unreadCounts.requirement > 0 && (
                <button
                  onClick={() => markTabSeenAll("requirement", setRequirements)}
                  title="Mark all requirements as read"
                  style={{
                    marginLeft: "auto", padding: "4px 10px", borderRadius: 6,
                    background: "var(--green-light)", color: "#059669",
                    border: "1px solid var(--green-mid)",
                    fontSize: 11, fontWeight: 600, cursor: "pointer",
                  }}
                >
                  ✓ Mark all read ({unreadCounts.requirement})
                </button>
              )}
            </div>
            {requirements.length === 0 ? (
              <EmptyState icon="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" text="No requirements extracted yet. Upload documents to get started." />
            ) : (() => {
              // Apply legacy filter chips first, then search/sort/paginate
              const filtered = requirements.filter((r: any) =>
                (priorityFilter === "all" || r.priority === priorityFilter) &&
                (statusFilter === "all" || r.status === statusFilter)
              );
              const { visible, filteredCount, totalPages, pageStart, pageEnd } = applyTableState(
                filtered,
                reqsTable,
                ["req_id", "title", "type", "priority", "status", "source_person"],
              );
              return (
                <>
                  <table className="panel-table">
                    <thead>
                      <tr>
                        <th style={{ width: 20 }}></th>
                        <SortableHeader label="ID" columnKey="req_id" state={reqsTable} />
                        <SortableHeader label="Requirement" columnKey="title" state={reqsTable} />
                        <SortableHeader label="Type" columnKey="type" state={reqsTable} />
                        <SortableHeader label="Priority" columnKey="priority" state={reqsTable} />
                        <SortableHeader label="Status" columnKey="status" state={reqsTable} />
                        <SortableHeader label="Ver" columnKey="version" state={reqsTable} width={50} />
                        <SortableHeader label="Source" columnKey="source_doc" state={reqsTable} />
                      </tr>
                    </thead>
                    <tbody>
                      {visible.map((req: any) => (
                        <tr
                          key={req.id || req.req_id}
                          onClick={() => {
                            openRequirement(req);
                            onNavigate?.("reqs", req.req_id);
                            if (req.id && !req.seen_at) markRowSeen("requirement", req.id, setRequirements);
                          }}
                          className="clickable-row"
                          style={!req.seen_at ? { background: "rgba(0, 229, 160, 0.14)" } : undefined}
                        >
                          <td
                            className="chevron-cell"
                            style={!req.seen_at ? { borderLeft: "4px solid var(--green)" } : undefined}
                          >
                            <Chevron />
                          </td>
                          <td style={{ fontWeight: 700, color: "var(--green)", whiteSpace: "nowrap" }}>
                            {req.req_id}                          </td>
                          <td>
                            <div style={{ fontWeight: 600, fontSize: 12 }}>{req.title}</div>
                          </td>
                          <td><TypeBadge type={req.type} /></td>
                          <td><PriBadge priority={req.priority} /></td>
                          <td><StatusPill status={req.status} /></td>
                          <td style={{ fontSize: 10, color: "var(--gray-500)", textAlign: "center", whiteSpace: "nowrap" }}>
                            {req.version ? `v${req.version}` : "—"}
                          </td>
                          <td style={{ fontSize: 10, color: "var(--gray-500)", maxWidth: 120 }}>
                            <SourceBadges sourceDoc={req.source_doc} sources={req.sources} version={req.version} person={req.source_person} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <Pagination
                    state={reqsTable}
                    total={filteredCount}
                    pageStart={pageStart}
                    pageEnd={pageEnd}
                    totalPages={totalPages}
                  />
                </>
              );
            })()}
          </div>
        )}

        {/* ── GAPS ── */}
        {activeTab === "gaps" && (
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
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
              <TableSearch state={gapsTable} placeholder="Search gaps…" />
              <div className="panel-filter" style={{ marginBottom: 0 }}>
                {["all", "open", "in-progress"].map((f) => (
                  <button key={f} className={`panel-filter-btn${priorityFilter === f ? " active" : ""}`} onClick={() => setPriorityFilter(f)} style={{ textTransform: "capitalize" }}>
                    {f === "all" ? "All" : f.replace("-", " ")}
                  </button>
                ))}
              </div>
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
              const filtered = gaps.filter((g: any) => priorityFilter === "all" || g.status === priorityFilter);
              const { visible, filteredCount, totalPages, pageStart, pageEnd } = applyTableState(
                filtered,
                gapsTable,
                ["gap_id", "question", "area", "severity", "status", "source_person"],
                (item, key) => {
                  // Custom severity sort: high > medium > low
                  if (key === "severity") {
                    const order: Record<string, number> = { high: 0, medium: 1, low: 2 };
                    return order[item.severity] ?? 99;
                  }
                  return item[key];
                },
              );
              return (
                <>
                  <table className="panel-table">
                    <thead>
                      <tr>
                        <th style={{ width: 20 }}></th>
                        <SortableHeader label="Severity" columnKey="severity" state={gapsTable} />
                        <SortableHeader label="Gap Question" columnKey="question" state={gapsTable} />
                        <SortableHeader label="Area" columnKey="area" state={gapsTable} />
                        <SortableHeader label="Status" columnKey="status" state={gapsTable} />
                        <th style={{ width: 70 }}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visible.map((gap: any) => (
                    <Fragment key={gap.id}>
                      <tr
                        className="clickable-row"
                        style={!gap.seen_at ? { background: "rgba(0, 229, 160, 0.14)" } : undefined}
                        onClick={() => {
                          const next = expandedRow === gap.id ? null : gap.id;
                          setExpandedRow(next);
                          onNavigate?.("gaps", next ? gap.gap_id : undefined);
                          if (gap.id && !gap.seen_at) markRowSeen("gap", gap.id, setGaps);
                        }}
                      >
                        <td
                          className="chevron-cell"
                          style={!gap.seen_at ? { borderLeft: "4px solid var(--green)" } : undefined}
                        >
                          <Chevron open={expandedRow === gap.id} />
                        </td>
                        <td><SevBadge severity={gap.severity} /></td>
                        <td style={{ fontWeight: 500 }}>
                          {gap.question}                        </td>
                        <td style={{ color: "var(--gray-500)", fontSize: 11 }}>{gap.area}</td>
                        <td><GapStatusPill status={gap.status} /></td>
                        <td>
                          <button className="inline-action" onClick={(e) => { e.stopPropagation(); }} title="Resolve">&#10003;</button>
                        </td>
                      </tr>
                      {expandedRow === gap.id && (
                        <tr className="detail-row">
                          <td colSpan={6}>
                            <div className="gap-detail">
                              {/* Suggested action */}
                              {gap.suggested_action && (
                                <div className="gap-detail-desc">{gap.suggested_action}</div>
                              )}

                              {/* Source quote */}
                              {gap.source_quote && gap.source_quote !== "extracted from document" && (
                                <div className="gap-quote-box">
                                  <div className="gap-quote-label">From document</div>
                                  <div className="gap-quote-text">"{gap.source_quote}"</div>
                                </div>
                              )}

                              {/* Suggested question */}
                              <div className="gap-ai-suggestion">
                                <div className="ai-label">
                                  <svg viewBox="0 0 24 24" style={{ width: 12, height: 12, stroke: "currentColor", fill: "none", strokeWidth: 2 }}>
                                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                                  </svg>
                                  Suggested Question for Next Meeting
                                </div>
                                {_generateGapQuestion(gap)}
                              </div>

                              {/* Metadata */}
                              <div className="gap-detail-meta">
                                {gap.source_person && (
                                  <span className="person-chip">
                                    Ask: {gap.source_person}
                                  </span>
                                )}
                                {gap.source_doc && (
                                  <span className="gap-meta-chip file">
                                    {gap.source_doc}
                                  </span>
                                )}
                                <span className="gap-meta-chip linked">
                                  {gap.gap_id}
                                </span>
                                <span className="gap-meta-chip" style={{
                                  background: gap.severity === "high" ? "#EF444415" : "#F59E0B15",
                                  color: gap.severity === "high" ? "#EF4444" : "#F59E0B",
                                }}>
                                  {gap.severity} severity
                                </span>
                                {gap.blocked_reqs?.length > 0 && (
                                  <span className="gap-meta-chip">
                                    Blocks: {gap.blocked_reqs.join(", ")}
                                  </span>
                                )}
                              </div>

                              {/* Resolution (shown when resolved) */}
                              {gap.status === "resolved" && gap.resolution && (
                                <div style={{
                                  padding: "12px 14px", borderRadius: 10, marginTop: 8,
                                  background: "#ecfdf5", border: "1px solid #a7f3d0",
                                }}>
                                  <div style={{
                                    fontSize: 10, fontWeight: 700, textTransform: "uppercase",
                                    letterSpacing: 0.5, color: "#059669", marginBottom: 6,
                                    display: "flex", alignItems: "center", gap: 6,
                                  }}>
                                    <svg viewBox="0 0 24 24" style={{ width: 12, height: 12, stroke: "currentColor", fill: "none", strokeWidth: 2.5 }}>
                                      <path d="M22 11.08V12a10 10 0 11-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
                                    </svg>
                                    Resolution
                                    {gap.resolved_by && (
                                      <span style={{ fontWeight: 500, textTransform: "none", letterSpacing: 0, color: "#047857" }}>
                                        — answered by {gap.resolved_by}
                                      </span>
                                    )}
                                  </div>
                                  <div style={{ fontSize: 13, color: "#065f46", lineHeight: 1.6 }}>
                                    {gap.resolution}
                                  </div>
                                </div>
                              )}

                              {/* Actions */}
                              <div className="gap-detail-actions">
                                <button className="gap-action-btn resolve" onClick={(e) => {
                                  e.stopPropagation();
                                  const answer = prompt("Resolution — what was the answer?");
                                  if (answer) resolveGap(projectId, gap.gap_id, answer).then(() => loadData());
                                }}>Resolve</button>
                                <button className="gap-action-btn meeting" onClick={(e) => { e.stopPropagation(); }}>Add to Meeting</button>
                                <button className="gap-action-btn dismiss" onClick={(e) => {
                                  e.stopPropagation();
                                  resolveGap(projectId, gap.gap_id, "Dismissed").then(() => loadData());
                                }}>Dismiss</button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
              <Pagination
                state={gapsTable}
                total={filteredCount}
                pageStart={pageStart}
                pageEnd={pageEnd}
                totalPages={totalPages}
              />
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
                constraints,
                consTable,
                ["type", "description", "impact", "status"],
              );
              return (
                <>
                  <table className="panel-table">
                    <thead>
                      <tr>
                        <th style={{ width: 20 }}></th>
                        <SortableHeader label="Type" columnKey="type" state={consTable} />
                        <SortableHeader label="Constraint" columnKey="description" state={consTable} />
                        <SortableHeader label="Impact" columnKey="impact" state={consTable} />
                        <SortableHeader label="Status" columnKey="status" state={consTable} />
                      </tr>
                    </thead>
                    <tbody>
                      {visible.map((c: any, i: number) => (
                        <tr
                          key={c.id || i}
                          className="clickable-row"
                          style={!c.seen_at ? { background: "rgba(0, 229, 160, 0.14)" } : undefined}
                          onClick={() => {
                            setDetail({
                              title: `${c.type} Constraint`,
                              content: `# ${c.type} Constraint\n\n${c.description}\n\n## Impact\n${c.impact}\n\n## Source\n> ${c.source_quote || "N/A"}`,
                              meta: { type: c.type, status: c.status },
                              history: c.id ? { projectId, itemType: "constraint", itemId: c.id } : undefined,
                            });
                            onNavigate?.("constraints", String(c.id).slice(0, 8));
                            if (c.id && !c.seen_at) markRowSeen("constraint", c.id, setConstraints);
                          }}
                        >
                          <td
                            className="chevron-cell"
                            style={!c.seen_at ? { borderLeft: "4px solid var(--green)" } : undefined}
                          >
                            <Chevron />
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
                      ))}
                    </tbody>
                  </table>
                  <Pagination
                    state={consTable}
                    total={filteredCount}
                    pageStart={pageStart}
                    pageEnd={pageEnd}
                    totalPages={totalPages}
                  />
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
              const filtered = contradictions.filter((c: any) =>
                contraFilter === "all" ? true :
                contraFilter === "open" ? !c.resolved :
                c.resolved
              );
              const { visible, filteredCount, totalPages, pageStart, pageEnd } = applyTableState(
                filtered,
                contraTable,
                ["item_a_type", "item_a_ref", "item_b_ref", "explanation"],
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
                      {visible.map((c: any) => (
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
                        <td
                          className="chevron-cell"
                          style={!c.seen_at ? { borderLeft: "4px solid var(--green)" } : undefined}
                        >
                          <Chevron open={expandedRow === c.id} />
                        </td>
                        <td><SevBadge severity="high" /></td>
                        <td>
                          <div style={{ fontWeight: 600, fontSize: 12 }}>{c.item_a_ref?.slice(0, 50) || "Requirement conflict"}</div>
                          <div style={{ fontSize: 11, color: "var(--gray-500)", marginTop: 2 }}>vs: {_extractConflictDetail(c.explanation).slice(0, 60)}...</div>
                        </td>
                        <td style={{ color: "var(--gray-500)", fontSize: 11 }}>{c.item_a_type}</td>
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
                              {/* Stacked source cards with VS divider */}
                              <div className="cd-quotes">
                                <div className="cd-quote side-a">
                                  <div className="cd-quote-header">
                                    <span className="cd-quote-badge a">Current</span>
                                    {c.item_a_source && <span className="gap-meta-chip file">{c.item_a_source}</span>}
                                    {c.item_a_person && <span className="person-chip">{c.item_a_person}</span>}
                                  </div>
                                  <div className="cd-quote-text">{c.item_a_ref || "Existing requirement"}</div>
                                </div>
                                <div className="cd-quote-vs">VS</div>
                                <div className="cd-quote side-b">
                                  <div className="cd-quote-header">
                                    <span className="cd-quote-badge b">Conflicting</span>
                                    {c.item_b_source && <span className="gap-meta-chip" style={{ background: "#fee2e2", color: "#EF4444" }}>{c.item_b_source}</span>}
                                    {c.item_b_person && <span className="person-chip">{c.item_b_person}</span>}
                                  </div>
                                  <div className="cd-quote-text">{c.item_b_ref && !c.item_b_ref.includes("from uploaded") ? c.item_b_ref : _extractConflictDetail(c.explanation)}</div>
                                </div>
                              </div>

                              {/* What's the conflict */}
                              <div className="cd-explanation">{c.explanation}</div>

                              {/* Metadata chips */}
                              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                                {c.created_at && (
                                  <span className="gap-meta-chip">Detected {new Date(c.created_at).toLocaleDateString()}</span>
                                )}
                                <span className="gap-meta-chip" style={{ background: "#EF444415", color: "#EF4444" }}>
                                  {c.resolved ? "Resolved" : "Unresolved"}
                                </span>
                              </div>

                              {/* AI Recommendation */}
                              <div className="gap-ai-suggestion">
                                <div className="ai-label">
                                  AI Recommendation
                                </div>
                                {c.suggested_resolution || "Review both sources with the people involved. Determine which statement is current and whether the earlier requirement needs updating."}
                              </div>

                              {/* Resolution */}
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
              <Pagination
                state={contraTable}
                total={filteredCount}
                pageStart={pageStart}
                pageEnd={pageEnd}
                totalPages={totalPages}
              />
            </>
            );
            })()}
          </div>
            )}

          </div>
        )}

        {/* ── MEETING PREP ── */}
        {activeTab === "meeting" && (
          <div className="dp-tab-content active">
            <MeetingPrepTab
              contradictions={openContras}
              gaps={gaps}
              requirements={requirements}
              constraints={constraints}
              dashboard={dashboard}
            />
          </div>
        )}

        {/* ── HANDOFF ── */}
        {activeTab === "handoff" && (
          <div className="dp-tab-content active">
            <HandoffTab projectId={projectId} />
          </div>
        )}

        {/* ── DOCUMENTS ── */}
        {activeTab === "docs" && (
          <div className="dp-tab-content active">
            {(gmailConnected || driveConnected) && (
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginBottom: 12 }}>
                {gmailConnected && (
                  <button
                    onClick={() => setGmailOpen(true)}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 6,
                      padding: "6px 12px", borderRadius: 8,
                      border: "1px solid var(--gray-200)", background: "#fff",
                      color: "var(--dark)", fontSize: 12, fontWeight: 600,
                      cursor: "pointer", fontFamily: "var(--font)",
                    }}
                  >
                    <span style={{ width: 18, height: 18, borderRadius: 5, background: "var(--green)", color: "var(--dark)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 800 }}>G</span>
                    Import from Gmail
                  </button>
                )}
                {driveConnected && (
                  <button
                    onClick={() => setDriveOpen(true)}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 6,
                      padding: "6px 12px", borderRadius: 8,
                      border: "1px solid var(--gray-200)", background: "#fff",
                      color: "var(--dark)", fontSize: 12, fontWeight: 600,
                      cursor: "pointer", fontFamily: "var(--font)",
                    }}
                  >
                    <span style={{ width: 18, height: 18, borderRadius: 5, background: "var(--green)", color: "var(--dark)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 800 }}>D</span>
                    Import from Drive
                  </button>
                )}
              </div>
            )}
            {gmailOpen && (
              <GmailImportPanel
                projectId={projectId}
                onClose={() => setGmailOpen(false)}
                onImported={() => loadData()}
              />
            )}
            {driveOpen && (
              <DriveImportPanel
                projectId={projectId}
                onClose={() => setDriveOpen(false)}
                onImported={() => loadData()}
              />
            )}
            {documents.length === 0 ? (
              <EmptyState icon="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" text='No documents uploaded yet. Click "Upload Document" to get started.' />
            ) : (
              <table className="panel-table">
                <thead>
                  <tr>
                    <th>File</th>
                    <th>Type</th>
                    <th>Status</th>
                    <th>Extracted</th>
                    <th>Date</th>
                    <th style={{ width: 40 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {documents.map((doc: any) => (
                    <tr key={doc.id} onClick={() => openDocument(doc)} className="clickable-row">
                      <td style={{ fontWeight: 600 }}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                          {doc.filename}
                          <SourceBadge source={doc.classification?.source} autoSynced={doc.classification?.auto_synced} />
                        </span>
                      </td>
                      <td><span className="type-badge">{doc.file_type?.toUpperCase()}</span></td>
                      <td><StatusPill status={doc.pipeline_stage === "completed" ? "confirmed" : doc.pipeline_stage === "failed" ? "dropped" : "pending"} label={doc.pipeline_stage} /></td>
                      <td>
                        {doc.items_extracted > 0 ? (
                          <span style={{ fontSize: 12 }}>
                            {doc.items_extracted} items
                            {doc.contradictions_found > 0 && (
                              <span style={{ color: "var(--danger)", marginLeft: 4, fontSize: 10 }}>+{doc.contradictions_found} conflicts</span>
                            )}
                          </span>
                        ) : <span style={{ color: "var(--gray-400)" }}>—</span>}
                      </td>
                      <td style={{ color: "var(--gray-500)", whiteSpace: "nowrap", fontSize: 11 }}>
                        {doc.created_at ? new Date(doc.created_at).toLocaleDateString() : "—"}
                      </td>
                      <td>
                        <button
                          title="Delete document"
                          className="delete-btn"
                          onClick={async (e) => {
                            e.stopPropagation();
                            if (!confirm(`Delete ${doc.filename}?`)) return;
                            try { await deleteDocument(projectId, doc.id); loadData(); } catch { alert("Delete failed"); }
                          }}
                        >
                          <svg viewBox="0 0 24 24" style={{ width: 12, height: 12, stroke: "var(--danger)", fill: "none", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" }}>
                            <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                          </svg>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  );

  function openRequirement(req: any) {
    const md = [
      `# ${req.req_id}: ${req.title}`,
      "", `**Priority:** ${req.priority} | **Status:** ${req.status} | **Confidence:** ${req.confidence}`,
      req.source_person ? `**Requested by:** ${req.source_person}` : "",
      "", "## Description", req.description || "No description",
      req.user_perspective ? `\n## User Perspective\n${req.user_perspective}` : "",
      req.business_rules?.length ? `\n## Business Rules\n${req.business_rules.map((r: string) => `- ${r}`).join("\n")}` : "",
      req.edge_cases?.length ? `\n## Edge Cases\n${req.edge_cases.map((e: string) => `- ${e}`).join("\n")}` : "",
      "\n## Sources",
      req.source_doc ? `**Primary:** ${req.source_doc}` : "",
      req.source_quote ? `> ${req.source_quote}` : "",
      ...(req.sources?.length ? req.sources.map((s: any, i: number) =>
        `**Source ${i + 2}:** ${s.filename || s.doc_id?.slice(0, 8) || "document"}${s.quote ? `\n> ${s.quote}` : ""}`
      ) : []),
      req.version > 1 ? `\n*Version ${req.version} — merged from ${1 + (req.sources?.length || 0)} documents*` : "",
    ].filter(Boolean).join("\n");

    setDetail({
      title: `${req.req_id}: ${req.title}`, content: md,
      meta: { priority: req.priority, status: req.status, confidence: req.confidence, version: `v${req.version || 1}`, source: req.source_doc || "unknown" },
      history: req.id ? { projectId, itemType: "requirement", itemId: req.id } : undefined,
      actions: [
        { label: "Confirm", value: "confirmed", color: "#059669" },
        { label: "Discussed", value: "discussed", color: "#3B82F6" },
        { label: "Drop", value: "dropped", color: "#EF4444" },
      ],
      onAction: async (action: string) => {
        await updateRequirement(projectId, req.req_id, { status: action });
        loadData(); setDetail(null);
      },
    });
  }

  async function openDocument(doc: any) {
    // Show metadata immediately
    const metaLines = [
      `# ${doc.filename}`,
      "", `**Type:** ${doc.file_type} | **Status:** ${doc.pipeline_stage}`,
      doc.file_size_bytes ? `**Size:** ${(doc.file_size_bytes / 1024).toFixed(1)} KB` : "",
      `**Uploaded:** ${doc.created_at ? new Date(doc.created_at).toLocaleString() : "unknown"}`,
      doc.items_extracted > 0 ? `**Extracted:** ${doc.items_extracted} items` : "",
      doc.pipeline_error ? `\n## Pipeline Error\n\`\`\`\n${doc.pipeline_error}\n\`\`\`` : "",
    ].filter(Boolean).join("\n");

    setDetail({ title: doc.filename, content: metaLines + "\n\n---\n\n*Loading content...*", meta: { type: doc.file_type, status: doc.pipeline_stage } });

    // Fetch actual file content
    try {
      const data = await getDocumentContent(projectId, doc.id);
      if (data.content) {
        const fullMd = metaLines + "\n\n---\n\n## Content\n\n" + data.content;
        setDetail({ title: doc.filename, content: fullMd, meta: { type: doc.file_type, status: doc.pipeline_stage } });
      } else {
        const fullMd = metaLines + (data.message ? `\n\n---\n\n*${data.message}*` : "");
        setDetail({ title: doc.filename, content: fullMd, meta: { type: doc.file_type, status: doc.pipeline_stage } });
      }
    } catch {
      // Keep showing metadata if content fetch fails
    }
  }
}


/* ── Readiness Panel ── */

function ReadinessPanel({ onClose, score, checks, trajectory, requirements, gaps, contradictions, constraints }: {
  onClose: () => void; score: number; checks: any[]; trajectory: any;
  requirements: any[]; gaps: any[]; contradictions: any[]; constraints: any[];
}) {
  const passed = checks.filter((c: any) => c.status === "covered").length;
  const partial = checks.filter((c: any) => c.status === "partial").length;
  const missing = checks.filter((c: any) => c.status === "missing").length;
  const statusLabel = score >= 85 ? "Ready for Handoff" : score >= 65 ? "Conditionally Ready" : "Not Ready";
  const statusColor = score >= 85 ? "#059669" : score >= 65 ? "#d97706" : "#ef4444";
  const confirmedReqs = requirements.filter((r: any) => r.status === "confirmed").length;
  const mustReqs = requirements.filter((r: any) => r.priority === "must").length;
  const openContras = contradictions.filter((c: any) => !c.resolved).length;
  const openGaps = gaps.filter((g: any) => g.status === "open" || g.status === "in-progress").length;

  // Ring math
  const circumference = 2 * Math.PI * 54;
  const offset = circumference - (score / 100) * circumference;

  // SVG icon paths for stat cards
  const icons = {
    reqs: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2",
    target: "M12 22s-8-4.5-8-11.8A8 8 0 0112 2a8 8 0 018 8.2c0 7.3-8 11.8-8 11.8z M12 13a3 3 0 100-6 3 3 0 000 6z",
    check: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z",
    question: "M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01",
    bolt: "M13 10V3L4 14h7v7l9-11h-7z",
    lock: "M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z",
  };
  const StatIcon = ({ d, color, size = 20 }: { d: string; color: string; size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Header */}
      <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--gray-100)", flexShrink: 0, display: "flex", alignItems: "center", gap: 12 }}>
        <button onClick={onClose} style={{
          display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 600,
          color: "var(--gray-500)", background: "none", border: "none", cursor: "pointer",
          padding: 0, fontFamily: "var(--font)",
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
          Back
        </button>
        <div style={{ flex: 1 }} />
        <div style={{ fontSize: 12, fontWeight: 700, color: "var(--dark)" }}>Discovery Readiness</div>
      </div>

      {/* Scrollable content */}
      <div style={{ flex: 1, overflowY: "auto", padding: "16px 16px" }}>

        {/* Score + status row */}
        <div style={{ display: "flex", gap: 16, alignItems: "center", marginBottom: 16 }}>
          <div style={{ position: "relative", width: 80, height: 80, flexShrink: 0 }}>
            <svg viewBox="0 0 120 120" style={{ width: 80, height: 80, transform: "rotate(-90deg)" }}>
              <circle cx="60" cy="60" r="52" fill="none" stroke="var(--gray-100)" strokeWidth="8" />
              <circle cx="60" cy="60" r="52" fill="none"
                stroke="var(--green)" strokeWidth="8" strokeLinecap="round"
                strokeDasharray={2 * Math.PI * 52} strokeDashoffset={2 * Math.PI * 52 - (score / 100) * 2 * Math.PI * 52}
                style={{ transition: "stroke-dashoffset 0.8s ease" }}
              />
            </svg>
            <div style={{
              position: "absolute", inset: 0, display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center",
            }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: "var(--dark)" }}>{Math.round(score)}%</div>
            </div>
          </div>

          <div style={{ flex: 1 }}>
            <div style={{
              fontSize: 10, fontWeight: 700,
              color: statusColor === "#059669" ? "#059669" : statusColor === "#d97706" ? "#d97706" : "#ef4444",
              background: statusColor === "#059669" ? "#d1fae5" : statusColor === "#d97706" ? "#fef3c7" : "#fee2e2",
              display: "inline-block", padding: "3px 10px", borderRadius: 6,
              textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 8,
            }}>
              {statusLabel}
            </div>

            {/* Progress */}
            <div style={{ display: "flex", gap: 2, height: 5, borderRadius: 3, overflow: "hidden", background: "var(--gray-100)" }}>
              <div style={{ width: `${(passed / checks.length) * 100}%`, background: "var(--green)", borderRadius: 3, transition: "width 0.6s" }} />
              <div style={{ width: `${(partial / checks.length) * 100}%`, background: "#fbbf24", borderRadius: 3, transition: "width 0.6s" }} />
              <div style={{ width: `${(missing / checks.length) * 100}%`, background: "#ef4444", borderRadius: 3, transition: "width 0.6s" }} />
            </div>
            <div style={{ display: "flex", gap: 12, marginTop: 4, fontSize: 9, color: "var(--gray-500)" }}>
              <span style={{ display: "flex", alignItems: "center", gap: 3 }}><span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--green)" }} />{passed} passed</span>
              <span style={{ display: "flex", alignItems: "center", gap: 3 }}><span style={{ width: 5, height: 5, borderRadius: "50%", background: "#fbbf24" }} />{partial} partial</span>
              <span style={{ display: "flex", alignItems: "center", gap: 3 }}><span style={{ width: 5, height: 5, borderRadius: "50%", background: "#ef4444" }} />{missing} missing</span>
            </div>
          </div>
        </div>

        {/* Stats grid */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 18 }}>
          {[
            { label: "Requirements", value: requirements.length, sub: `${confirmedReqs} confirmed`, icon: icons.reqs, color: "#059669" },
            { label: "MUST Priority", value: mustReqs, sub: `of ${requirements.length}`, icon: icons.target, color: "#2563eb" },
            { label: "Checks Passed", value: `${passed}/${checks.length}`, sub: `${missing} missing`, icon: icons.check, color: "#7c3aed" },
            { label: "Open Gaps", value: openGaps, sub: `${gaps.length} total`, icon: icons.question, color: openGaps > 0 ? "#ef4444" : "#6b7280", warn: openGaps > 0 },
            { label: "Contradictions", value: openContras, sub: "open", icon: icons.bolt, color: openContras > 0 ? "#ef4444" : "#6b7280", warn: openContras > 0 },
            { label: "Constraints", value: constraints.length, sub: "defined", icon: icons.lock, color: "#d97706" },
          ].map((s, i) => (
            <div key={i} style={{
              padding: "12px 14px", borderRadius: 12, background: "#fff",
              border: "1px solid var(--gray-100)", display: "flex", alignItems: "center", gap: 14,
              boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
            }}>
              <div style={{
                width: 40, height: 40, borderRadius: 10, flexShrink: 0,
                background: `${s.color}10`, display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <StatIcon d={s.icon} color={s.color} size={22} />
              </div>
              <div>
                <div style={{ fontSize: 20, fontWeight: 800, color: s.warn ? "#ef4444" : "var(--dark)", letterSpacing: "-0.5px", lineHeight: 1 }}>{s.value}</div>
                <div style={{ fontSize: 10, fontWeight: 600, color: "var(--gray-500)", marginTop: 2 }}>{s.label}</div>
                <div style={{ fontSize: 9, color: "var(--gray-400)" }}>{s.sub}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Trajectory chart */}
        {trajectory && trajectory.history && trajectory.history.length >= 2 && (() => {
          const pts = trajectory.history;
          const scores = pts.map((p: any) => p.score);
          const minS = Math.min(...scores, 0);
          const maxS = Math.max(...scores, 100);
          const range = maxS - minS || 1;
          const w = 600, h = 80, pad = 8;
          const points = pts.map((p: any, i: number) => {
            const x = pad + (i / (pts.length - 1)) * (w - 2 * pad);
            const y = h - pad - ((p.score - minS) / range) * (h - 2 * pad);
            return `${x},${y}`;
          });
          const line85y = h - pad - ((85 - minS) / range) * (h - 2 * pad);

          return (
            <div style={{
              marginBottom: 16, padding: "12px 14px", borderRadius: 12,
              background: "#fff", border: "1px solid var(--gray-100)",
              boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
            }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "var(--gray-400)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                  Readiness Trajectory
                </div>
                <div style={{ display: "flex", gap: 10, fontSize: 10 }}>
                  {trajectory.velocity_per_day !== null && (
                    <span style={{ color: trajectory.velocity_per_day > 0 ? "#059669" : trajectory.velocity_per_day < 0 ? "#ef4444" : "var(--gray-500)", fontWeight: 700 }}>
                      {trajectory.velocity_per_day > 0 ? "+" : ""}{trajectory.velocity_per_day}%/day
                    </span>
                  )}
                  {trajectory.eta_days !== null && trajectory.eta_days > 0 && (
                    <span style={{ color: "var(--gray-500)" }}>
                      ETA: ~{trajectory.eta_days}d ({trajectory.eta_date})
                    </span>
                  )}
                  {trajectory.trend === "ready" && (
                    <span style={{ color: "#059669", fontWeight: 700 }}>Ready!</span>
                  )}
                </div>
              </div>
              <div style={{ position: "relative" }}
                onMouseLeave={() => {
                  const tip = document.getElementById("traj-tip");
                  if (tip) tip.style.display = "none";
                }}
              >
                <svg viewBox={`0 0 ${w} ${h}`} style={{ width: "100%", height: 80, display: "block" }}>
                  {/* 85% threshold line */}
                  <line x1={pad} y1={line85y} x2={w - pad} y2={line85y} stroke="#059669" strokeWidth="1" strokeDasharray="4 3" opacity="0.4" />
                  <text x={w - pad - 2} y={line85y - 3} textAnchor="end" fontSize="7" fill="#059669" opacity="0.6">85%</text>
                  {/* Area fill */}
                  <polygon
                    points={`${pad},${h - pad} ${points.join(" ")} ${w - 2 * pad + pad},${h - pad}`}
                    fill="url(#trajectoryGrad)" opacity="0.3"
                  />
                  {/* Line */}
                  <polyline points={points.join(" ")} fill="none" stroke="#00E5A0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  {/* Dots with hover */}
                  {pts.map((p: any, i: number) => {
                    const x = pad + (i / (pts.length - 1)) * (w - 2 * pad);
                    const y = h - pad - ((p.score - minS) / range) * (h - 2 * pad);
                    const isLast = i === pts.length - 1;
                    return (
                      <g key={i}
                        onMouseEnter={(e) => {
                          const tip = document.getElementById("traj-tip");
                          if (!tip) return;
                          const date = p.created_at ? new Date(p.created_at).toLocaleDateString([], { month: "short", day: "numeric" }) : "";
                          const time = p.created_at ? new Date(p.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
                          tip.textContent = `${p.score}% · ${date} ${time}`;
                          tip.style.display = "block";
                          const svg = (e.target as SVGElement).closest("svg");
                          if (!svg) return;
                          const rect = svg.getBoundingClientRect();
                          const pctX = x / w;
                          const pctY = y / h;
                          tip.style.left = `${pctX * rect.width}px`;
                          tip.style.top = `${pctY * rect.height - 28}px`;
                        }}
                        onMouseLeave={() => {
                          const tip = document.getElementById("traj-tip");
                          if (tip) tip.style.display = "none";
                        }}
                        style={{ cursor: "default" }}
                      >
                        <circle cx={x} cy={y} r={12} fill="transparent" />
                        <circle cx={x} cy={y} r={isLast ? 4 : 2.5} fill={isLast ? "#00E5A0" : "#059669"} stroke="#fff" strokeWidth={isLast ? 2 : 0} />
                      </g>
                    );
                  })}
                  <defs>
                    <linearGradient id="trajectoryGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#00E5A0" />
                      <stop offset="100%" stopColor="#00E5A0" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                </svg>
                {/* Tooltip */}
                <div id="traj-tip" style={{
                  display: "none", position: "absolute", pointerEvents: "none",
                  background: "#1a1a2e", color: "#fff", fontSize: 10, fontWeight: 600,
                  padding: "3px 8px", borderRadius: 5, whiteSpace: "nowrap",
                  transform: "translateX(-50%)", boxShadow: "0 2px 6px rgba(0,0,0,0.2)",
                }} />
              </div>
            </div>
          );
        })()}

        {/* Checklist header */}
        <div style={{
          fontSize: 10, fontWeight: 700, color: "var(--gray-400)",
          textTransform: "uppercase", letterSpacing: "0.8px",
          display: "flex", alignItems: "center", gap: 8, marginBottom: 8,
        }}>
          <span>Checklist</span>
          <div style={{ flex: 1, height: 1, background: "var(--gray-200)" }} />
          <span style={{ color: "var(--green)", fontWeight: 800, fontSize: 11 }}>{passed}/{checks.length}</span>
        </div>

        {/* Check items */}
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {checks.map((c: any, i: number) => {
            const isOk = c.status === "covered";
            const isWarn = c.status === "partial";
            return (
              <div key={i} style={{
                padding: "9px 12px", borderRadius: 10, display: "flex", alignItems: "flex-start", gap: 10,
                background: isOk ? "#fff" : isWarn ? "#fffbeb" : "#fef2f2",
                border: `1px solid ${isOk ? "var(--gray-100)" : isWarn ? "#fde68a" : "#fecaca"}`,
                boxShadow: isOk ? "none" : `0 0 0 1px ${isWarn ? "#fde68a40" : "#fecaca40"}`,
              }}>
                <div style={{
                  width: 24, height: 24, borderRadius: 8, flexShrink: 0,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  background: isOk ? "#00E5A020" : isWarn ? "#fbbf2420" : "#ef444420",
                  color: isOk ? "#00E5A0" : isWarn ? "#d97706" : "#ef4444",
                  fontSize: 13, fontWeight: 700,
                }}>
                  {isOk ? "✓" : isWarn ? "!" : "✗"}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "var(--dark)" }}>{c.check}</div>
                  {c.detail && <div style={{ fontSize: 10, color: "var(--gray-500)", marginTop: 2 }}>{c.detail}</div>}
                  {c.items && c.items.length > 0 && (
                    <div style={{ marginTop: 4, display: "flex", flexWrap: "wrap", gap: 3 }}>
                      {c.items.slice(0, 3).map((item: string, j: number) => (
                        <span key={j} style={{
                          fontSize: 9, padding: "1px 6px", borderRadius: 4,
                          background: "var(--gray-50)", border: "1px solid var(--gray-100)",
                          color: "var(--gray-600)", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        }}>
                          {item}
                        </span>
                      ))}
                      {c.items.length > 3 && (
                        <span style={{ fontSize: 9, color: "var(--gray-400)", alignSelf: "center" }}>+{c.items.length - 3}</span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Next steps */}
        {(missing > 0 || partial > 0) && (
          <div style={{
            marginTop: 14, padding: "12px 14px", borderRadius: 10,
            background: "var(--gray-50)", border: "1px solid var(--gray-200)",
          }}>
            <div style={{
              fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px",
              color: "var(--gray-500)", marginBottom: 8, display: "flex", alignItems: "center", gap: 6,
            }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 11.08V12a10 10 0 11-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
              </svg>
              Next Steps to Improve Readiness
            </div>
            {checks.filter((c: any) => c.status !== "covered").map((c: any, i: number) => (
              <div key={i} style={{
                fontSize: 12, padding: "4px 0", display: "flex", alignItems: "flex-start", gap: 8,
              }}>
                <span style={{
                  width: 18, height: 18, borderRadius: 5, display: "inline-flex", alignItems: "center", justifyContent: "center",
                  background: c.status === "missing" ? "#fee2e2" : "#fef3c7",
                  color: c.status === "missing" ? "#ef4444" : "#d97706",
                  fontSize: 10, fontWeight: 700, flexShrink: 0, marginTop: 1,
                }}>
                  {c.status === "missing" ? "+" : "↑"}
                </span>
                <div>
                  <span style={{ fontWeight: 600, color: "var(--dark)" }}>{c.check}</span>
                  {c.detail && <span style={{ color: "var(--gray-500)", fontSize: 10 }}> — {c.detail}</span>}
                </div>
              </div>
            ))}
          </div>
        )}

        <div style={{ height: 16 }} />
      </div>
    </div>
  );
}


/* ── Small Components ── */

function Chevron({ open }: { open?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" style={{ width: 14, height: 14, stroke: "var(--gray-400)", fill: "none", strokeWidth: 2, transition: "transform 0.2s", transform: open ? "rotate(90deg)" : "none" }}>
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

function TypeBadge({ type }: { type: string }) {
  const labels: Record<string, { label: string; bg: string; color: string }> = {
    functional: { label: "Functional", bg: "#dbeafe", color: "#2563eb" },
    non_functional: { label: "Non-Func", bg: "#f3e8ff", color: "#7c3aed" },
    business: { label: "Business", bg: "#d1fae5", color: "#059669" },
    technical: { label: "Technical", bg: "#fef3c7", color: "#d97706" },
    organizational: { label: "Org", bg: "#fee2e2", color: "#dc2626" },
  };
  const t = labels[type] || { label: type || "—", bg: "#f3f4f6", color: "#6b7280" };
  return (
    <span style={{
      fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 4,
      background: t.bg, color: t.color, whiteSpace: "nowrap", textTransform: "uppercase",
      letterSpacing: "0.3px",
    }}>
      {t.label}
    </span>
  );
}

function PriBadge({ priority }: { priority: string }) {
  const cls = priority === "must" ? "high" : priority === "should" ? "medium" : "low";
  return <span className={`sev-badge ${cls}`}>{priority?.toUpperCase()}</span>;
}

function SevBadge({ severity }: { severity: string }) {
  return <span className={`sev-badge ${severity}`}>{severity.charAt(0).toUpperCase() + severity.slice(1)}</span>;
}

function StatusPill({ status, label }: { status: string; label?: string }) {
  const display = label || status;
  const cls = status === "confirmed" || status === "resolved" ? "resolved" : status === "dropped" || status === "failed" ? "dropped" : status === "discussed" || status === "in-progress" ? "in-progress" : "open";
  return (
    <span className={`gap-status-pill ${cls}`}>
      <span style={{ width: 5, height: 5, borderRadius: "50%", background: "currentColor", display: "inline-block" }} />
      {" "}{display}
    </span>
  );
}

function GapStatusPill({ status }: { status: string }) {
  return <span className={`gap-status-pill ${status}`}>{status.replace("-", " ")}</span>;
}

function SourceBadges({ sourceDoc, sources, version, person }: { sourceDoc?: string; sources?: any[]; version?: number; person?: string }) {
  const totalSources = 1 + (sources?.length || 0);
  const allNames: string[] = [];
  if (sourceDoc) allNames.push(sourceDoc);
  if (sources) {
    for (const s of sources) {
      // sources entries might not have filename, use doc_id short
      const name = s.filename || s.doc_id?.slice(0, 8) || "doc";
      if (!allNames.includes(name)) allNames.push(name);
    }
  }

  if (allNames.length === 0) return <span style={{ color: "var(--gray-300)" }}>—</span>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      {person && (
        <span className="person-chip">
          <svg viewBox="0 0 24 24" style={{ width: 10, height: 10, stroke: "currentColor", fill: "none", strokeWidth: 2, flexShrink: 0 }}>
            <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/>
          </svg>
          {person}
        </span>
      )}
      {allNames.map((name, i) => (
        <span key={i} className="source-tag" title={name}>
          <svg viewBox="0 0 24 24" style={{ width: 10, height: 10, stroke: "currentColor", fill: "none", strokeWidth: 2, flexShrink: 0 }}>
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/>
          </svg>
          {name.length > 18 ? name.slice(0, 16) + "..." : name}
        </span>
      ))}
      {(version || 1) > 1 && (
        <span style={{ fontSize: 9, fontWeight: 600, color: "#7c3aed", background: "#f3e8ff", padding: "0 5px", borderRadius: 4, width: "fit-content" }}>
          v{version}
        </span>
      )}
    </div>
  );
}

function EmptyState({ icon, text }: { icon: string; text: string }) {
  return (
    <div style={{ textAlign: "center", padding: "48px 24px", color: "var(--gray-400)" }}>
      <svg viewBox="0 0 24 24" style={{ width: 32, height: 32, stroke: "var(--gray-300)", fill: "none", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round", margin: "0 auto 12px" }}>
        <path d={icon} />
      </svg>
      <div style={{ fontSize: 13, maxWidth: 280, margin: "0 auto" }}>{text}</div>
    </div>
  );
}

function _extractConflictDetail(explanation: string): string {
  if (!explanation) return "Conflicting information from new document";
  // Try "New document from Meeting X says..." pattern
  const m1 = explanation.match(/[Nn]ew document[^.]*says\s+(.+?)(?:\.|$)/);
  if (m1) return m1[1].trim();
  // Try "but new document says:" pattern
  const m2 = explanation.match(/new document says:?\s*"?(.+?)(?:"|$)/i);
  if (m2) return m2[1].trim();
  // Try text after the dash "—"
  const m3 = explanation.match(/—\s*(.+?)(?:\.|$)/);
  if (m3) return m3[1].trim();
  // Fallback: everything after "New" or "but"
  const m4 = explanation.match(/(?:New|but)\s+(.{20,120})/i);
  if (m4) return m4[1].trim().replace(/\.$/, "");
  return explanation.slice(0, 120);
}

function _generateGapQuestion(gap: any): string {
  const title = gap.question || "";
  // Generate a concrete meeting question from the gap title
  if (title.toLowerCase().includes("authority") || title.toLowerCase().includes("who")) {
    return `"Who has the final authority on ${title.toLowerCase().replace("requirement confirmation authority definition", "confirming requirements")}? Can we agree on the decision-making process today?"`;
  }
  if (title.toLowerCase().includes("process") || title.toLowerCase().includes("how")) {
    return `"Can you walk us through how ${title.toLowerCase()} should work? What's the expected workflow?"`;
  }
  if (title.toLowerCase().includes("policy") || title.toLowerCase().includes("archival")) {
    return `"What's your preference for ${title.toLowerCase()}? Should we keep an audit trail or clean up permanently?"`;
  }
  return `"Can we clarify the requirement for '${title}'? What specifically do you need, and what's the priority?"`;
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


/* ── Meeting Prep Tab ── */

function HandoffTab({ projectId }: { projectId: string }) {
  const [docs, setDocs] = useState<any[]>([]);
  const [generations, setGenerations] = useState<any[]>([]);
  const [selectedDoc, setSelectedDoc] = useState<string | null>(null);
  const [docContent, setDocContent] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [genLog, setGenLog] = useState<string[]>([]);
  const [expandedGen, setExpandedGen] = useState<number | null>(null);
  const [fileViewer, setFileViewer] = useState<{ path: string; name: string; content: string } | null>(null);

  async function openFile(path: string) {
    try {
      const token = localStorage.getItem("token") || "";
      const base = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
      const res = await fetch(`${base}/api/projects/${projectId}/file?path=${encodeURIComponent(path)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      setFileViewer(data);
    } catch {}
  }

  function handleContentClick(e: React.MouseEvent) {
    const target = e.target as HTMLElement;
    const link = target.closest("a[data-file]") as HTMLElement | null;
    if (link) {
      e.preventDefault();
      const filePath = link.getAttribute("data-file") || "";
      // Try multiple possible locations
      const candidates = [
        filePath,
        filePath.startsWith(".") ? filePath : `.memory-bank/${filePath}`,
        `.memory-bank/docs/discovery/${filePath.split("/").pop()}`,
      ];
      tryOpenFile(candidates);
    }
  }

  async function tryOpenFile(paths: string[]) {
    const token = localStorage.getItem("token") || "";
    const base = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
    for (const p of paths) {
      try {
        const res = await fetch(`${base}/api/projects/${projectId}/file?path=${encodeURIComponent(p)}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          setFileViewer(await res.json());
          return;
        }
      } catch {}
    }
  }

  function loadData() {
    listHandoffDocs(projectId).then((d) => {
      setDocs(d.documents || []);
      setGenerations(d.generations || []);
    }).catch(() => {});
  }

  useEffect(() => { loadData(); }, [projectId]);

  function handleGenerate() {
    setGenerating(true);
    setGenLog(["Starting handoff document generation..."]);
    generateHandoffStream(
      projectId,
      (text) => setGenLog((prev) => [...prev.slice(-20), text.slice(0, 80)]),
      (generated) => {
        setGenerating(false);
        setGenLog((prev) => [...prev, `Done! Generated: ${generated.join(", ")}`]);
        loadData();
      },
      (tool) => setGenLog((prev) => [...prev.slice(-20), `Using: ${tool}`]),
      (error) => {
        setGenerating(false);
        setGenLog((prev) => [...prev, `Error: ${error}`]);
      },
    );
  }

  function viewDoc(docType: string) {
    setSelectedDoc(docType);
    setDocContent(null);
    getHandoffDoc(projectId, docType).then((d) => {
      setDocContent(d.content || "Document not yet generated.");
    });
  }

  if (fileViewer) {
    return (
      <div style={{ padding: 16 }}>
        <button onClick={() => setFileViewer(null)} style={{
          display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 600,
          color: "var(--gray-500)", background: "none", border: "none", cursor: "pointer",
          marginBottom: 12, padding: 0, fontFamily: "var(--font)",
        }}>
          &larr; Back
        </button>
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--dark)", marginBottom: 4 }}>📄 {fileViewer.name}</div>
        <div style={{ fontSize: 10, color: "var(--gray-400)", marginBottom: 12, fontFamily: "monospace" }}>{fileViewer.path}</div>
        <div style={{ fontSize: 13, lineHeight: 1.5, color: "var(--gray-700)" }} onClick={handleContentClick} dangerouslySetInnerHTML={{ __html: renderHandoffMarkdown(fileViewer.content) }} />
      </div>
    );
  }

  if (selectedDoc && docContent !== null) {
    return (
      <div style={{ padding: 16 }}>
        <button onClick={() => setSelectedDoc(null)} style={{
          display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 600,
          color: "var(--gray-500)", background: "none", border: "none", cursor: "pointer",
          marginBottom: 12, padding: 0, fontFamily: "var(--font)",
        }}>
          &larr; Back to Handoff
        </button>
        <div style={{ fontSize: 13, lineHeight: 1.5, color: "var(--gray-700)" }} onClick={handleContentClick} dangerouslySetInnerHTML={{ __html: renderHandoffMarkdown(docContent) }} />
      </div>
    );
  }

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--dark)" }}>Handoff Documents</div>
          <div style={{ fontSize: 11, color: "var(--gray-400)", marginTop: 2 }}>
            3 deliverables for Phase 2 handoff
          </div>
        </div>
        <button
          onClick={handleGenerate}
          disabled={generating}
          style={{
            padding: "8px 16px", borderRadius: 8, border: "none",
            background: generating ? "var(--gray-200)" : "var(--green)",
            color: generating ? "var(--gray-500)" : "white",
            fontSize: 12, fontWeight: 600, cursor: generating ? "not-allowed" : "pointer",
            fontFamily: "var(--font)",
          }}
        >
          {generating ? "Generating..." : "Generate All"}
        </button>
      </div>

      {/* Document cards */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {[
          { type: "discovery_brief", label: "Discovery Brief", desc: "Client overview, business context, target users, market analysis" },
          { type: "mvp_scope_freeze", label: "MVP Scope Freeze", desc: "Core features, out of scope, platform decisions, sign-off" },
          { type: "functional_requirements", label: "Functional Requirements", desc: "Detailed requirements with user stories and business rules" },
        ].map((d) => {
          const info = docs.find((x: any) => x.type === d.type);
          const generated = info?.generated;
          return (
            <div key={d.type} style={{
              padding: "14px 16px", border: "1px solid var(--gray-200)", borderRadius: 10,
              background: generated ? "#f0fdf8" : "var(--white)",
              cursor: generated ? "pointer" : "default",
              transition: "all 0.15s",
            }}
            onClick={() => generated && viewDoc(d.type)}
            onMouseEnter={(e) => generated && (e.currentTarget.style.borderColor = "var(--green)")}
            onMouseLeave={(e) => (e.currentTarget.style.borderColor = "var(--gray-200)")}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{
                  width: 32, height: 32, borderRadius: 8,
                  background: generated ? "#d1fae5" : "var(--gray-100)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  color: generated ? "#059669" : "var(--gray-400)", fontSize: 14,
                }}>
                  {generated ? "\u2713" : "\u2014"}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--dark)" }}>{d.label}</div>
                  <div style={{ fontSize: 11, color: "var(--gray-400)", marginTop: 1 }}>{d.desc}</div>
                </div>
                {generated && (
                  <span style={{ fontSize: 10, fontWeight: 600, color: "#059669", background: "#d1fae5", padding: "2px 8px", borderRadius: 6 }}>
                    Generated
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Generation log */}
      {genLog.length > 0 && (
        <div style={{
          marginTop: 14, padding: 12, background: "#1a1a2e", borderRadius: 8,
          maxHeight: 150, overflow: "auto", fontSize: 11, fontFamily: "monospace", color: "#a1a1aa",
        }}>
          {genLog.map((line, i) => (
            <div key={i} style={{ marginBottom: 2 }}>{line}</div>
          ))}
        </div>
      )}

      {/* Generation history */}
      {generations.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--gray-400)", marginBottom: 8 }}>
            Generation History
          </div>
          {generations.map((gen: any) => (
            <div key={gen.version} style={{
              marginBottom: 6, border: "1px solid var(--gray-200)", borderRadius: 8, overflow: "hidden",
            }}>
              <div
                onClick={() => setExpandedGen(expandedGen === gen.version ? null : gen.version)}
                style={{
                  display: "flex", alignItems: "center", gap: 8, padding: "8px 12px",
                  cursor: "pointer", background: "var(--gray-50)", transition: "background 0.15s",
                }}
              >
                <span style={{
                  fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 4,
                  background: gen.status === "completed" ? "#d1fae5" : gen.status === "partial" ? "#FEF3C7" : "#fee2e2",
                  color: gen.status === "completed" ? "#059669" : gen.status === "partial" ? "#D97706" : "#EF4444",
                }}>v{gen.version}</span>
                <span style={{ fontSize: 11, fontWeight: 500, flex: 1 }}>
                  {gen.status === "completed" ? "3/3 docs" : gen.status === "partial" ? `${gen.documents?.length}/3 docs` : "Failed"}
                </span>
                {gen.errors?.length > 0 && (
                  <span style={{ fontSize: 9, fontWeight: 600, color: "#EF4444" }}>{gen.errors.length} error{gen.errors.length > 1 ? "s" : ""}</span>
                )}
                <span style={{ fontSize: 10, color: "var(--gray-400)" }}>
                  {gen.duration_ms ? `${(gen.duration_ms / 1000).toFixed(0)}s` : ""} · {gen.created_at ? new Date(gen.created_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : ""}
                </span>
              </div>
              {expandedGen === gen.version && gen.logs?.length > 0 && (
                <div style={{
                  padding: 10, background: "#1a1a2e", fontSize: 10, fontFamily: "monospace",
                  color: "#a1a1aa", maxHeight: 200, overflow: "auto",
                }}>
                  {gen.logs.map((line: string, i: number) => (
                    <div key={i} style={{
                      marginBottom: 2,
                      color: line.includes("ERROR") ? "#EF4444" : line.includes("WARNING") ? "#F59E0B" : line.includes("COMPLETED") ? "#059669" : "#a1a1aa",
                    }}>{line}</div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function renderHandoffMarkdown(text: string): string {
  let html = text
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  // Tables
  html = html.replace(/((?:^\|.+\|[ ]*$\n?)+)/gm, (tableBlock) => {
    const rows = tableBlock.trim().split("\n").filter(r => r.trim());
    if (rows.length < 2) return tableBlock;
    const isSep = (r: string) => /^\|[\s\-:|]+\|$/.test(r) && r.includes("-");
    const parse = (row: string) => row.split("|").slice(1, -1).map(c => c.trim());
    const header = rows[0];
    const body = rows.filter((r, i) => i > 0 && !isSep(r));
    if (body.length === 0) return tableBlock;
    const hCells = parse(header);
    let t = '\x00BLOCK<div class="chat-table-wrap"><table class="chat-table"><thead><tr>';
    hCells.forEach(c => { t += `<th>${_inl(c)}</th>`; });
    t += "</tr></thead><tbody>";
    body.forEach(row => {
      const cells = parse(row);
      t += "<tr>";
      cells.forEach((c, ci) => { t += `<td${ci === 0 ? ' class="chat-td-label"' : ""}>${_inl(c)}</td>`; });
      t += "</tr>";
    });
    t += "</tbody></table></div>BLOCK\x00";
    return t;
  });

  // Headings
  html = html
    .replace(/^#### (.+)$/gm, (_m, t) => `\x00BLOCK<h4 class="chat-h4">${_inl(t)}</h4>BLOCK\x00`)
    .replace(/^### (.+)$/gm, (_m, t) => `\x00BLOCK<h3 class="chat-h3">${_inl(t)}</h3>BLOCK\x00`)
    .replace(/^## (.+)$/gm, (_m, t) => `\x00BLOCK<div class="ho-h2">${_inl(t)}</div>BLOCK\x00`)
    .replace(/^# (.+)$/gm, (_m, t) => `\x00BLOCK<div class="ho-h1">${_inl(t)}</div>BLOCK\x00`);

  // Lists — collect consecutive
  html = html.replace(/((?:^- .+$\n?)+)/gm, (block) => {
    const items = block.trim().split("\n").map(l => l.replace(/^- /, ""));
    return '\x00BLOCK<ul class="chat-ul">' + items.map(i => `<li class="chat-li">${_inl(i)}</li>`).join("") + "</ul>BLOCK\x00";
  });
  html = html.replace(/((?:^\d+\. .+$\n?)+)/gm, (block) => {
    const items = block.trim().split("\n").map(l => l.replace(/^\d+\. /, ""));
    return '\x00BLOCK<ol class="chat-ol">' + items.map(i => `<li class="chat-oli">${_inl(i)}</li>`).join("") + "</ol>BLOCK\x00";
  });

  // Horizontal rule
  html = html.replace(/^---$/gm, '\x00BLOCK<hr class="chat-hr">BLOCK\x00');

  // Process text segments only — inline formatting + line breaks
  const parts = html.split(/\x00BLOCK|BLOCK\x00/);
  html = parts.map((part, i) => {
    if (i % 2 === 1) return part; // block element — already processed
    part = _inl(part);
    return part
      .replace(/\n\n+/g, '<div class="chat-paragraph-break"></div>')
      .replace(/\n/g, "<br>");
  }).join("");

  return html;
}

const FILE_STYLE = 'padding:1px 6px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:4px;font-size:0.88em;font-family:monospace;color:#2563eb;cursor:pointer;text-decoration:none;display:inline-block';
const CODE_STYLE = 'padding:1px 5px;background:#f0fdf4;border:1px solid #dcfce7;border-radius:4px;font-size:0.88em;font-family:monospace;color:#16a34a';
const WIKI_STYLE = 'color:#059669;font-weight:600;cursor:pointer;border-bottom:1px dashed #059669;text-decoration:none';
const BADGE_STYLES: Record<string, string> = {
  confirmed: 'font-size:8px;font-weight:700;padding:1px 5px;border-radius:3px;background:#d1fae5;color:#059669;vertical-align:middle;letter-spacing:0.3px;white-space:nowrap',
  assumed: 'font-size:8px;font-weight:700;padding:1px 5px;border-radius:3px;background:#FEF3C7;color:#D97706;vertical-align:middle;letter-spacing:0.3px;white-space:nowrap',
  notcovered: 'font-size:8px;font-weight:700;padding:1px 5px;border-radius:3px;background:#fee2e2;color:#EF4444;vertical-align:middle;letter-spacing:0.3px;white-space:nowrap',
};

function _inl(t: string): string {
  const slots: string[] = [];
  const slot = (html: string) => { slots.push(html); return `\x01S${slots.length - 1}\x01`; };

  // File paths in backticks → slot
  t = t.replace(/`([^`]*\.(?:md|json|yaml|yml|txt|py|ts|tsx|js|sh))`/g, (_m, path) => {
    const name = path.split("/").pop() || path;
    return slot(`<a style="${FILE_STYLE}" data-file="${path}" title="${path}">📄 ${name}</a>`);
  });
  // Remaining backticks → slot
  t = t.replace(/`([^`]+)`/g, (_m, code) => slot(`<code style="${CODE_STYLE}">${code}</code>`));
  // Directory paths → slot
  t = t.replace(/(?<!["a-zA-Z])(\.?[\w.-]+(?:\/[\w.-]+)+\/)/g, (_m, path) => slot(`<a style="${FILE_STYLE}" data-file="${path}" title="${path}">📁 ${path}</a>`));
  // Bare file paths → slot
  t = t.replace(/(?<!["\/a-zA-Z\x01])((?:[\w.-]+\/)+[\w.-]+\.(?:md|json|yaml|yml|txt|py|ts|tsx|js|sh))(?![a-zA-Z])/g, (_m, path) => {
    const name = path.split("/").pop() || path;
    return slot(`<a style="${FILE_STYLE}" data-file="${path}" title="${path}">📄 ${name}</a>`);
  });
  // Wikilinks
  t = t.replace(/\[\[([^\]]+)\]\]/g, (_m, target) => slot(`<a style="${WIKI_STYLE}" data-wiki="${target}">${target}</a>`));
  // Attribution badges
  t = t.replace(/\[CONFIRMED([^\]]*)\]/g, (_m, s) => slot(`<span style="${BADGE_STYLES.confirmed}">CONFIRMED${s}</span>`));
  t = t.replace(/\[ASSUMED([^\]]*)\]/g, (_m, s) => slot(`<span style="${BADGE_STYLES.assumed}">ASSUMED${s}</span>`));
  t = t.replace(/\[NOT COVERED([^\]]*)\]/g, (_m, s) => slot(`<span style="${BADGE_STYLES.notcovered}">NOT COVERED${s}</span>`));
  // Bold / italic
  t = t.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/\*(.+?)\*/g, '<em>$1</em>');
  // Restore slots
  t = t.replace(/\x01S(\d+)\x01/g, (_m, i) => slots[parseInt(i)]);
  return t;
}


function ReadinessChecklist({ requirements, constraints, contradictions, dashboard }: {
  requirements: any[]; constraints: any[]; contradictions: any[]; dashboard: any;
}) {
  const [open, setOpen] = useState(true);

  const reqCount = dashboard?.requirements_count ?? requirements.length;
  const reqConfirmed = dashboard?.requirements_confirmed ?? requirements.filter((r: any) => r.status === "confirmed").length;
  const mustReqs = requirements.filter((r: any) => r.priority === "must").length;
  const decCount = dashboard?.decisions_count ?? 0;
  const stkCount = dashboard?.stakeholders_count ?? 0;
  const scopeIn = dashboard?.scope_in ?? 0;
  const scopeOut = dashboard?.scope_out ?? 0;
  const asmCount = dashboard?.assumptions_count ?? 0;
  const asmValidated = dashboard?.assumptions_validated ?? 0;
  const openContras = dashboard?.contradictions_unresolved ?? contradictions.length;
  const hasBudget = constraints.some((c: any) => c.type === "budget");
  const hasTimeline = constraints.some((c: any) => c.type === "timeline");
  const hasDecisionMaker = stkCount > 0; // simplified — at least one stakeholder

  const checks = [
    { label: "Decision-maker identified", pass: hasDecisionMaker, detail: hasDecisionMaker ? `${stkCount} stakeholder${stkCount !== 1 ? "s" : ""}` : "No stakeholders" },
    { label: "People identified (≥2)", pass: stkCount >= 2, detail: `${stkCount} people` },
    { label: "Requirements defined (≥5)", pass: reqCount >= 5, detail: `${reqCount} defined` },
    { label: "Requirements confirmed", pass: reqConfirmed / Math.max(reqCount, 1) >= 0.8, detail: `${reqConfirmed}/${reqCount} (${reqCount > 0 ? Math.round(reqConfirmed / reqCount * 100) : 0}%)`, partial: reqConfirmed > 0 && reqConfirmed / Math.max(reqCount, 1) < 0.8 },
    { label: "MUST requirements (≥3)", pass: mustReqs >= 3, detail: `${mustReqs} MUST` },
    { label: "Decisions documented (≥2)", pass: decCount >= 2, detail: `${decCount} decisions` },
    { label: "Scope defined (in + out)", pass: scopeIn > 0 && scopeOut > 0, detail: `${scopeIn} in, ${scopeOut} out` },
    { label: "No unresolved contradictions", pass: openContras === 0, detail: openContras > 0 ? `${openContras} open` : "All resolved" },
    { label: "Budget constraint defined", pass: hasBudget, detail: hasBudget ? "Defined" : "Missing" },
    { label: "Timeline constraint defined", pass: hasTimeline, detail: hasTimeline ? "Defined" : "Missing" },
    { label: "Assumptions validated", pass: asmValidated / Math.max(asmCount, 1) >= 0.5, detail: `${asmValidated}/${asmCount}`, partial: asmCount > 0 && asmValidated > 0 && asmValidated / Math.max(asmCount, 1) < 0.5 },
  ];

  const passed = checks.filter((c) => c.pass).length;

  return (
    <div style={{ margin: "0 0 12px", border: "1px solid var(--gray-200)", borderRadius: 10, overflow: "hidden" }}>
      <div
        onClick={() => setOpen(!open)}
        style={{
          display: "flex", alignItems: "center", gap: 10, padding: "10px 14px",
          background: "var(--gray-50)", cursor: "pointer", userSelect: "none",
        }}
      >
        <div style={{
          width: 20, height: 20, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 10, fontWeight: 700, color: "white",
          background: passed === checks.length ? "#059669" : passed >= 8 ? "#F59E0B" : "#EF4444",
        }}>
          {passed}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--dark)" }}>Readiness Checklist</div>
          <div style={{ fontSize: 10, color: "var(--gray-500)" }}>{passed}/{checks.length} checks passed</div>
        </div>
        <svg viewBox="0 0 24 24" style={{
          width: 14, height: 14, stroke: "var(--gray-400)", fill: "none", strokeWidth: 2,
          transform: open ? "rotate(180deg)" : "none", transition: "transform 0.2s",
        }}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </div>

      {open && (
        <div style={{ padding: "6px 14px 10px" }}>
          {checks.map((c, i) => (
            <div key={i} style={{
              display: "flex", alignItems: "center", gap: 8, padding: "5px 0",
              borderBottom: i < checks.length - 1 ? "1px solid var(--gray-100)" : "none",
            }}>
              <span style={{
                width: 16, height: 16, borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 10, flexShrink: 0,
                background: c.pass ? "#d1fae5" : c.partial ? "#FEF3C7" : "#fee2e2",
                color: c.pass ? "#059669" : c.partial ? "#D97706" : "#EF4444",
              }}>
                {c.pass ? "✓" : c.partial ? "◐" : "✗"}
              </span>
              <span style={{ flex: 1, fontSize: 11, color: "var(--dark)" }}>{c.label}</span>
              <span style={{
                fontSize: 10, fontWeight: 600,
                color: c.pass ? "#059669" : c.partial ? "#D97706" : "#EF4444",
              }}>
                {c.detail}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MeetingPrepTab({ contradictions, gaps, requirements, constraints, dashboard }: {
  contradictions: any[]; gaps: any[]; requirements: any[]; constraints: any[]; dashboard: any;
}) {
  const unconfirmed = requirements.filter((r: any) => r.status === "assumed" || r.status === "pending");

  // Track approved/dismissed state per item
  const [statuses, setStatuses] = useState<Record<string, "approved" | "dismissed">>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);

  function approve(id: string) {
    setStatuses((s) => ({ ...s, [id]: s[id] === "approved" ? undefined as any : "approved" }));
  }
  function dismiss(id: string) {
    setStatuses((s) => ({ ...s, [id]: s[id] === "dismissed" ? undefined as any : "dismissed" }));
  }

  const getStatus = (id: string) => statuses[id];

  // Filter out dismissed items for counts
  const activeContras = contradictions.filter((c) => getStatus(c.id) !== "dismissed");
  const activeGaps = gaps.filter((g) => getStatus(g.id) !== "dismissed");
  const activeUnconfirmed = unconfirmed.filter((r) => getStatus(r.req_id) !== "dismissed");

  const approvedCount = Object.values(statuses).filter((s) => s === "approved").length;
  const totalItems = activeContras.length + activeGaps.length + activeUnconfirmed.length;

  // Calculate time per item based on status
  function itemTime(id: string, baseMin: number) {
    const st = getStatus(id);
    if (st === "dismissed") return 0;
    return baseMin;
  }

  const approvedMin =
    contradictions.filter((c) => getStatus(c.id) === "approved").length * 10
    + gaps.filter((g) => getStatus(g.id) === "approved" && g.severity === "high").length * 5
    + gaps.filter((g) => getStatus(g.id) === "approved" && g.severity !== "high").length * 3
    + unconfirmed.filter((r) => getStatus(r.req_id) === "approved").length * 2;

  const pendingMin =
    contradictions.filter((c) => !getStatus(c.id)).length * 10
    + gaps.filter((g) => !getStatus(g.id) && g.severity === "high").length * 5
    + gaps.filter((g) => !getStatus(g.id) && g.severity !== "high").length * 3
    + unconfirmed.filter((r) => !getStatus(r.req_id)).length * 2;

  const estimatedMin = approvedMin + pendingMin;

  const allItems = contradictions.length + gaps.length + unconfirmed.length;

  if (allItems === 0) {
    return (
      <EmptyState
        icon="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"
        text="No items for the agenda. All requirements confirmed, no gaps or contradictions."
      />
    );
  }

  function ItemActions({ id }: { id: string }) {
    const st = getStatus(id);
    return (
      <div style={{ display: "flex", gap: 4, marginLeft: "auto", flexShrink: 0 }}>
        <button
          title={st === "approved" ? "Remove from agenda" : "Approve for meeting"}
          onClick={(e) => { e.stopPropagation(); approve(id); }}
          style={{
            width: 26, height: 26, borderRadius: 6, border: "none",
            background: st === "approved" ? "#d1fae5" : "var(--gray-100)",
            color: st === "approved" ? "#059669" : "var(--gray-400)",
            cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 14, transition: "all 0.15s",
          }}
        >
          ✓
        </button>
        <button
          title={st === "dismissed" ? "Restore to agenda" : "Dismiss from agenda"}
          onClick={(e) => { e.stopPropagation(); dismiss(id); }}
          style={{
            width: 26, height: 26, borderRadius: 6, border: "none",
            background: st === "dismissed" ? "#fee2e2" : "var(--gray-100)",
            color: st === "dismissed" ? "#EF4444" : "var(--gray-400)",
            cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 12, transition: "all 0.15s",
          }}
        >
          ✕
        </button>
      </div>
    );
  }

  return (
    <div className="mp-container">
      <div className="mp-header">
        <div className="mp-badge">AI-Generated Agenda</div>
        <div className="mp-title">Next Meeting — Agenda</div>
        <div className="mp-date">
          {totalItems} item{totalItems !== 1 ? "s" : ""} to discuss
          {approvedCount > 0 && <span style={{ color: "#059669", marginLeft: 6 }}>· {approvedCount} approved</span>}
        </div>
      </div>

      {/* Readiness Checklist */}
      <ReadinessChecklist
        requirements={requirements}
        constraints={constraints}
        contradictions={contradictions}
        dashboard={dashboard}
      />

      {/* Contradictions */}
      {contradictions.length > 0 && (
        <div className="mp-section">
          <div className="mp-section-head">
            <div className="mp-section-icon" style={{ background: "#EF444420", color: "#EF4444" }}>!</div>
            <div className="mp-section-title">Resolve Contradictions ({activeContras.length})</div>
          </div>
          {contradictions.map((c: any) => {
            const st = getStatus(c.id);
            const isOpen = expandedId === c.id;
            return (
              <div key={c.id}>
                <div className="mp-item" onClick={() => setExpandedId(isOpen ? null : c.id)} style={{
                  opacity: st === "dismissed" ? 0.4 : 1,
                  background: st === "approved" ? "#f0fdf8" : isOpen ? "var(--gray-50)" : undefined,
                  borderColor: st === "approved" ? "#059669" : isOpen ? "var(--green)" : undefined,
                  cursor: "pointer", transition: "all 0.2s",
                }}>
                  <div className="mp-item-priority high">Critical</div>
                  <div className="mp-item-body">
                    <div className="mp-item-question">{c.explanation?.slice(0, 80)}</div>
                    <div className="mp-item-context">{c.item_a_type} vs {c.item_b_type}</div>
                  </div>
                  <ItemActions id={c.id} />
                  <div className="mp-time-est">~10 min</div>
                </div>
                {isOpen && (
                  <div style={{ padding: "10px 16px 14px", marginTop: -1, border: "1px solid var(--gray-200)", borderTop: "none", borderRadius: "0 0 8px 8px", background: "var(--gray-50)", fontSize: 12, lineHeight: 1.6, color: "var(--gray-600)" }}>
                    <div style={{ fontWeight: 600, color: "var(--dark)", marginBottom: 6 }}>Contradiction Details</div>
                    <div>{c.explanation}</div>
                    {c.item_a_ref && <div style={{ marginTop: 6 }}><strong>Item A:</strong> {c.item_a_ref}</div>}
                    {c.item_b_ref && <div><strong>Item B:</strong> {c.item_b_ref}</div>}
                    {c.resolution_note && <div style={{ marginTop: 6, padding: "6px 10px", background: "#d1fae5", borderRadius: 6, color: "#059669" }}><strong>Resolution:</strong> {c.resolution_note}</div>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Gaps */}
      {gaps.length > 0 && (
        <div className="mp-section">
          <div className="mp-section-head">
            <div className="mp-section-icon" style={{ background: "#F59E0B20", color: "#F59E0B" }}>?</div>
            <div className="mp-section-title">Close Gaps ({activeGaps.length})</div>
          </div>
          {gaps.sort((a: any, b: any) => a.severity === "high" ? -1 : b.severity === "high" ? 1 : 0).map((g: any) => {
            const st = getStatus(g.id);
            const isOpen = expandedId === g.id;
            return (
              <div key={g.id}>
                <div className="mp-item" onClick={() => setExpandedId(isOpen ? null : g.id)} style={{
                  opacity: st === "dismissed" ? 0.4 : 1,
                  background: st === "approved" ? "#f0fdf8" : isOpen ? "var(--gray-50)" : undefined,
                  borderColor: st === "approved" ? "#059669" : isOpen ? "var(--green)" : undefined,
                  cursor: "pointer", transition: "all 0.2s",
                }}>
                  <div className={`mp-item-priority ${g.severity}`}>{g.severity === "high" ? "High" : g.severity === "medium" ? "Med" : "Low"}</div>
                  <div className="mp-item-body">
                    <div className="mp-item-question">{g.question}</div>
                    <div className="mp-item-context">Area: {g.area}</div>
                  </div>
                  <ItemActions id={g.id} />
                  <div className="mp-time-est">~{g.severity === "high" ? 5 : 3} min</div>
                </div>
                {isOpen && (
                  <div style={{ padding: "10px 16px 14px", marginTop: -1, border: "1px solid var(--gray-200)", borderTop: "none", borderRadius: "0 0 8px 8px", background: "var(--gray-50)", fontSize: 12, lineHeight: 1.6, color: "var(--gray-600)" }}>
                    <div style={{ fontWeight: 600, color: "var(--dark)", marginBottom: 6 }}>Gap Details</div>
                    <div><strong>ID:</strong> {g.gap_id}</div>
                    <div><strong>Question:</strong> {g.question}</div>
                    <div><strong>Severity:</strong> {g.severity} · <strong>Area:</strong> {g.area}</div>
                    {g.source_quote && <div style={{ marginTop: 6, padding: "6px 10px", borderLeft: "3px solid var(--green)", background: "#f0fdf8", borderRadius: "0 6px 6px 0", fontStyle: "italic" }}>"{g.source_quote}"</div>}
                    {g.source_person && <div style={{ marginTop: 4 }}><strong>Raised by:</strong> {g.source_person}</div>}
                    {g.suggested_action && <div style={{ marginTop: 6 }}><strong>Suggested action:</strong> {g.suggested_action}</div>}
                    {g.blocked_reqs?.length > 0 && <div style={{ marginTop: 4 }}><strong>Blocks:</strong> {g.blocked_reqs.join(", ")}</div>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Unconfirmed requirements */}
      {unconfirmed.length > 0 && (
        <div className="mp-section">
          <div className="mp-section-head">
            <div className="mp-section-icon" style={{ background: "#3B82F620", color: "#3B82F6" }}>?</div>
            <div className="mp-section-title">Confirm Requirements ({activeUnconfirmed.length})</div>
          </div>
          {unconfirmed.map((r: any) => {
            const st = getStatus(r.req_id);
            const isOpen = expandedId === r.req_id;
            return (
              <div key={r.req_id}>
                <div className="mp-item" onClick={() => setExpandedId(isOpen ? null : r.req_id)} style={{
                  opacity: st === "dismissed" ? 0.4 : 1,
                  background: st === "approved" ? "#f0fdf8" : isOpen ? "var(--gray-50)" : undefined,
                  borderColor: st === "approved" ? "#059669" : isOpen ? "var(--green)" : undefined,
                  cursor: "pointer", transition: "all 0.2s",
                }}>
                  <div className={`mp-item-priority ${r.priority === "must" ? "high" : "medium"}`}>{r.priority === "must" ? "Must" : "Should"}</div>
                  <div className="mp-item-body">
                    <div className="mp-item-question">{r.title}</div>
                    <div className="mp-item-context">{r.req_id} · Status: {r.status}</div>
                  </div>
                  <ItemActions id={r.req_id} />
                  <div className="mp-time-est">~2 min</div>
                </div>
                {isOpen && (
                  <div style={{ padding: "10px 16px 14px", marginTop: -1, border: "1px solid var(--gray-200)", borderTop: "none", borderRadius: "0 0 8px 8px", background: "var(--gray-50)", fontSize: 12, lineHeight: 1.6, color: "var(--gray-600)" }}>
                    <div style={{ fontWeight: 600, color: "var(--dark)", marginBottom: 6 }}>Requirement Details</div>
                    <div><strong>ID:</strong> {r.req_id} · <strong>Priority:</strong> {r.priority} · <strong>Confidence:</strong> {r.confidence}</div>
                    <div style={{ marginTop: 6 }}>{r.description}</div>
                    {r.user_perspective && <div style={{ marginTop: 6 }}><strong>User perspective:</strong> {r.user_perspective}</div>}
                    {r.business_rules?.length > 0 && (
                      <div style={{ marginTop: 6 }}>
                        <strong>Business rules:</strong>
                        <ul style={{ margin: "4px 0 0 16px", padding: 0 }}>
                          {r.business_rules.map((rule: string, i: number) => <li key={i}>{rule}</li>)}
                        </ul>
                      </div>
                    )}
                    {r.source_quote && <div style={{ marginTop: 6, padding: "6px 10px", borderLeft: "3px solid var(--green)", background: "#f0fdf8", borderRadius: "0 6px 6px 0", fontStyle: "italic" }}>"{r.source_quote}"</div>}
                    {r.source_doc && <div style={{ marginTop: 4 }}><strong>Source:</strong> {r.source_doc}</div>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Total */}
      <div className="mp-total">
        <div className="mp-total-label">Estimated meeting duration</div>
        <div className="mp-total-val">{estimatedMin} min</div>
        {(approvedMin > 0 || pendingMin > 0) && (
          <div style={{ display: "flex", gap: 12, marginTop: 6, fontSize: 11 }}>
            {approvedMin > 0 && (
              <span style={{ color: "#059669", fontWeight: 600 }}>
                {approvedMin} min approved
              </span>
            )}
            {pendingMin > 0 && (
              <span style={{ color: "var(--gray-400)", fontWeight: 500 }}>
                {pendingMin} min pending
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function SourceBadge({ source, autoSynced }: { source?: string; autoSynced?: boolean }) {
  if (!source || source === "upload") return null;
  const meta: Record<string, { label: string; color: string; bg: string; border: string }> = {
    gmail: { label: "Gmail", color: "#dc2626", bg: "#fef2f2", border: "#fecaca" },
    google_drive: { label: "Drive", color: "#2563eb", bg: "#eff6ff", border: "#bfdbfe" },
    slack: { label: "Slack", color: "#7c3aed", bg: "#f5f3ff", border: "#ddd6fe" },
  };
  const m = meta[source] || { label: source, color: "#64748b", bg: "#f1f5f9", border: "#e2e8f0" };
  return (
    <span
      title={autoSynced ? `Auto-synced from ${m.label}` : `Imported from ${m.label}`}
      style={{
        display: "inline-flex", alignItems: "center", gap: 4,
        fontSize: 9, fontWeight: 700, padding: "2px 7px", borderRadius: 10,
        background: m.bg, color: m.color, border: `1px solid ${m.border}`,
        textTransform: "uppercase", letterSpacing: 0.4,
      }}
    >
      {autoSynced && (
        <svg viewBox="0 0 24 24" style={{ width: 9, height: 9, fill: "none", stroke: "currentColor", strokeWidth: 3 }}>
          <polyline points="23 4 23 10 17 10" />
          <path d="M3.51 9a9 9 0 0114.85-3.36L23 10" />
        </svg>
      )}
      {m.label}
    </span>
  );
}
