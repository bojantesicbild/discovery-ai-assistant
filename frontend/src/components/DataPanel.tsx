"use client";

import { Fragment, useEffect, useState } from "react";
import {
  getDashboard, listRequirements, listContradictions, listDocuments,
  deleteDocument, updateRequirement, resolveContradiction, listGaps, resolveGap, updateConstraintStatus,
  listConstraints, listHandoffDocs, getHandoffDoc, generateHandoffStream,
  getDocumentContent, getReadiness, getReadinessTrajectory, getLatestDigest,
  listIntegrations, getMeetingAgenda, saveMeetingAgenda, createNewAgenda,
  chatStream, getWikiFiles, getWikiFile,
  listMeetingAgendas, getMeetingAgendaByRound,
  markFindingSeen, markFindingsTypeSeenAll, type FindingType,
  getClientFeedback, type ReqClientFeedback, type GapClientFeedback,
  listProposedUpdates, acceptProposal, rejectProposal, type ProposedUpdate,
  type ApiRequirement, type ApiGap, type ApiConstraint, type ApiContradiction, type ApiDocument,
} from "@/lib/api";
import MarkdownPanel from "./MarkdownPanel";
import GmailImportPanel from "./GmailImportPanel";
import DriveImportPanel from "./DriveImportPanel";
import {
  Chevron, TypeBadge, PriBadge, SevBadge, StatusPill, GapStatusPill,
  FilterChip, ReqClientBadge, GapClientBadge, SourceBadges, SourceBadge,
  EmptyState,
} from "./datapanel/pills";
import {
  GapResolutionCard, ClientFeedbackCard, InlineProposals,
  type GapResolution,
} from "./datapanel/feedback-cards";
import { HandoffTab } from "./datapanel/handoff-tab";
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
  /** Filter key used to rebuild the interactive slot on state refresh.
   *  For requirements, this is the req_id — so that when proposals change
   *  (accept/reject), the rerendered detail view picks up the new list. */
  itemKey?: string;
  itemKind?: "requirement" | "gap";
  /** Closure info for gaps — rendered as metadata above the body, not in
   *  the markdown. Shape is defined next to GapResolutionCard so this type
   *  and the component stay in lockstep. */
  gapResolution?: GapResolution;
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
  const [requirements, setRequirements] = useState<ApiRequirement[]>([]);
  const [contradictions, setContradictions] = useState<ApiContradiction[]>([]);
  const [documents, setDocuments] = useState<ApiDocument[]>([]);
  const [gmailOpen, setGmailOpen] = useState(false);
  const [gmailConnected, setGmailConnected] = useState(false);
  const [driveOpen, setDriveOpen] = useState(false);
  const [driveConnected, setDriveConnected] = useState(false);
  const [gaps, setGaps] = useState<ApiGap[]>([]);
  const [constraints, setConstraints] = useState<ApiConstraint[]>([]);
  const [clientFeedback, setClientFeedback] = useState<{
    requirements: Record<string, ReqClientFeedback>;
    gaps: Record<string, GapClientFeedback>;
  }>({ requirements: {}, gaps: {} });
  // Detail view is a stack so nested navigation (e.g., BR → click source
  // link → opens that document) can pop back to the parent on close
  // instead of dropping the user all the way back to the table view.
  // setDetail() replaces the current top of stack (for first-level opens);
  // pushDetail() adds a new layer (for nested in-content links).
  const [detailStack, setDetailStack] = useState<DetailView[]>([]);
  const detail = detailStack.length > 0 ? detailStack[detailStack.length - 1] : null;
  const setDetail = (view: DetailView | null) => {
    if (view === null) setDetailStack([]);
    else setDetailStack((prev) => (prev.length > 0 ? [...prev.slice(0, -1), view] : [view]));
  };
  const pushDetail = (view: DetailView) => setDetailStack((prev) => [...prev, view]);
  const popDetail = () => setDetailStack((prev) => prev.slice(0, -1));
  // Top-of-stack updater — used by openDocument to swap its own
  // placeholder for real content without clobbering a pushed parent.
  const updateTopDetail = (view: DetailView) =>
    setDetailStack((prev) => (prev.length > 0 ? [...prev.slice(0, -1), view] : [view]));
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
  // Gaps get their own status filter — previously shared priorityFilter with
  // Requirements, which caused "Must"-on-reqs to silently hide all gaps.
  const [gapStatusFilter, setGapStatusFilter] = usePersistedState<string>(
    `datapanel:gapStatusFilter:${projectId}`,
    "all",
  );
  const [proposals, setProposals] = useState<ProposedUpdate[]>([]);
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
      const req = requirements.find((r) => r.req_id === highlightId);
      if (req) openRequirement(req);
    } else if (initialTab === "gaps") {
      const gap = gaps.find((g) => g.gap_id === highlightId);
      if (gap) setExpandedRow(gap.id);
    } else if (initialTab === "constraints") {
      const con = constraints.find((c) => String(c.id).startsWith(highlightId));
      if (con) setExpandedRow(con.id);
    } else if (initialTab === "contradictions") {
      const ct = contradictions.find((c) => String(c.id).startsWith(highlightId));
      if (ct) setExpandedRow(ct.id);
    } else if (initialTab === "docs") {
      // highlightId may be either a document UUID or a filename. Match either.
      const doc = documents.find((d) => d.id === highlightId || d.filename === highlightId);
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
      const [dash, reqs, contras, docs, gapsData, consData, feedback, props] = await Promise.all([
        getDashboard(projectId),
        listRequirements(projectId),
        listContradictions(projectId),
        listDocuments(projectId),
        listGaps(projectId),
        listConstraints(projectId),
        getClientFeedback(projectId).catch(() => ({ requirements: {}, gaps: {} })),
        listProposedUpdates(projectId, "pending").catch(() => ({ items: [] as ProposedUpdate[], total: 0 })),
      ]);
      setDashboard(dash);
      setRequirements(reqs.items || []);
      setContradictions(contras.items || []);
      setDocuments(docs.documents || []);
      setGaps(gapsData.items || []);
      setConstraints(consData.items || []);
      setClientFeedback(feedback);
      setProposals(props.items || []);
    } catch {}
  }

  const readiness = dashboard?.readiness;
  const score = readiness?.score ?? 0;
  const circumference = 2 * Math.PI * 15;
  const offset = circumference - (score / 100) * circumference;

  const openContras = contradictions.filter((c) => !c.resolved);
  const openGaps = gaps.filter((g) => g.status === "open");

  // If detail view is open
  if (detail) {
    return (
      <div className="data-panel" style={{ flex: 1, width: "100%" }}>
        <MarkdownPanel
          title={detail.title}
          content={detail.content}
          meta={detail.meta}
          onClose={() => {
            if (detailStack.length > 1) {
              popDetail();
            } else {
              setDetail(null);
              onNavigate?.(activeTab);
            }
          }}
          actions={detail.actions}
          onAction={detail.onAction}
          history={detail.history}
          slotTop={(() => {
            if (!detail.itemKey || !detail.itemKind) return undefined;
            const reqFb = detail.itemKind === "requirement" ? clientFeedback.requirements[detail.itemKey] : undefined;
            const gapFb = detail.itemKind === "gap" ? clientFeedback.gaps[detail.itemKey] : undefined;
            const pendingProps = detail.itemKind === "requirement"
              ? proposals.filter((p) => p.target_req_id === detail.itemKey)
              : [];
            const hasAnything = reqFb || gapFb || pendingProps.length > 0 || detail.gapResolution;
            if (!hasAnything) return undefined;
            // Gap closure + client answer → single combined card.
            // Everything else stays independent.
            const combinedGapClosure = detail.gapResolution && gapFb?.answer;
            return (
              <>
                {detail.gapResolution && (
                  <GapResolutionCard
                    r={detail.gapResolution}
                    clientAnswer={combinedGapClosure ? gapFb : undefined}
                  />
                )}
                {reqFb && <ClientFeedbackCard kind="requirement" fb={reqFb} />}
                {gapFb && !combinedGapClosure && <ClientFeedbackCard kind="gap" fb={gapFb} />}
                {pendingProps.length > 0 && (
                  <InlineProposals
                    proposals={pendingProps}
                    onAction={async (id, decision) => {
                      try {
                        if (decision.kind === "accept") {
                          await acceptProposal(projectId, id, decision.overrideValue);
                        } else {
                          await rejectProposal(projectId, id);
                        }
                        await loadData();
                      } catch (e) {
                        console.error("Proposal action failed", e);
                      }
                    }}
                  />
                )}
              </>
            );
          })()}
          onLinkClick={(href: string) => {
            // In-app links push onto the detail stack so the close
            // button returns to the caller's view (e.g., the gap that
            // linked to a BR) instead of the table.
            if (href.startsWith("doc://")) {
              const docId = href.slice("doc://".length);
              const doc = documents.find((d) => d.id === docId);
              if (doc) openDocument(doc, "push");
              // Fallback stub when the doc isn't in local state — openDocument
              // hits the API and updates the panel with the real fields.
              else openDocument({ id: docId, filename: "document" } as ApiDocument, "push");
              return true;
            }
            if (href.startsWith("br://")) {
              const key = href.slice("br://".length);
              const req = requirements.find((r) => r.id === key || r.req_id === key);
              if (req) openRequirement(req, "push");
              return true;
            }
            return false;
          }}
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
            {/* Filter row — priority + status chips, colored by value */}
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 6 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: "var(--gray-400)", letterSpacing: 0.5, textTransform: "uppercase", marginRight: 2 }}>Priority</span>
              {["all", "must", "should", "could"].map((f) => (
                <FilterChip key={`p-${f}`} value={f} label={f === "all" ? "All" : f} active={priorityFilter === f} onClick={() => setPriorityFilter(f)} />
              ))}
              <span style={{ fontSize: 10, fontWeight: 700, color: "var(--gray-400)", letterSpacing: 0.5, textTransform: "uppercase", marginLeft: 8, marginRight: 2 }}>Status</span>
              {["all", "confirmed", "discussed", "proposed"].map((f) => (
                <FilterChip key={`s-${f}`} value={f} label={f === "all" ? "All" : f} active={statusFilter === f} onClick={() => setStatusFilter(f)} />
              ))}
            </div>
            {/* Search row — full width, with unread-mark-all on the right */}
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
              <TableSearch state={reqsTable} placeholder="Search requirements…" />
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
              const filtered = requirements.filter((r) =>
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
                        <SortableHeader label="ID" columnKey="req_id" state={reqsTable} />
                        <SortableHeader label="Requirement" columnKey="title" state={reqsTable} />
                        <SortableHeader label="Type / Pri" columnKey="priority" state={reqsTable} />
                        <SortableHeader label="Status" columnKey="status" state={reqsTable} />
                        <SortableHeader label="Source" columnKey="source_doc" state={reqsTable} />
                      </tr>
                    </thead>
                    <tbody>
                      {visible.map((req) => (
                        <tr
                          key={req.id || req.req_id}
                          onClick={() => {
                            openRequirement(req);
                            onNavigate?.("reqs", req.req_id);
                            if (req.id && !req.seen_at) markRowSeen("requirement", req.id, setRequirements);
                          }}
                          className="clickable-row"
                          title={req.title}
                          style={!req.seen_at ? { background: "rgba(0, 229, 160, 0.14)" } : undefined}
                        >
                          <td style={{
                            whiteSpace: "nowrap", lineHeight: 1.2,
                            borderLeft: !req.seen_at ? "3px solid var(--green)" : undefined,
                          }}>
                            <div style={{ fontWeight: 700, color: "var(--green)", fontSize: 12 }}>{req.req_id}</div>
                            {req.version > 1 && (
                              <div style={{ fontSize: 9, color: "var(--gray-400)", fontWeight: 600 }}>v{req.version}</div>
                            )}
                          </td>
                          <td>
                            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                              <div className="cell-title" style={{ fontWeight: 600, fontSize: 12, flex: 1, minWidth: 0 }}>{req.title}</div>
                              {(() => {
                                const pendingCount = proposals.filter((p) => p.target_req_id === req.req_id).length;
                                if (pendingCount === 0) return null;
                                return (
                                  <span
                                    title={`${pendingCount} pending client-driven update${pendingCount !== 1 ? "s" : ""}`}
                                    style={{
                                      fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: 10,
                                      background: "#eff6ff", color: "#1d4ed8",
                                      border: "1px solid #bfdbfe", whiteSpace: "nowrap",
                                      flexShrink: 0,
                                    }}
                                  >⚠ {pendingCount}</span>
                                );
                              })()}
                            </div>
                          </td>
                          <td>
                            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                              <TypeBadge type={req.type} />
                              <PriBadge priority={req.priority} />
                            </div>
                          </td>
                          <td>
                            {(() => {
                              const fb = clientFeedback.requirements[req.req_id];
                              // Collapse to the client badge when PM status and
                              // client action agree (both would show the same
                              // word). Keep both when they disagree — that's
                              // a signal the PM needs to notice.
                              const aligned = fb && (
                                (fb.action === "confirm" && req.status === "confirmed") ||
                                (fb.action === "discuss" && req.status === "discussed")
                              );
                              if (fb && aligned) {
                                return <ReqClientBadge fb={fb} />;
                              }
                              return (
                                <div style={{ display: "flex", flexDirection: "column", gap: 3, alignItems: "flex-start" }}>
                                  <StatusPill status={req.status} />
                                  {fb && <ReqClientBadge fb={fb} />}
                                </div>
                              );
                            })()}
                          </td>
                          <td style={{ fontSize: 10, color: "var(--gray-500)", maxWidth: 120 }}>
                            <SourceBadges sourceDoc={req.source_doc || undefined} sources={req.sources} version={req.version} person={req.source_person || undefined} />
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
            {/* Filter row — status chips, colored by value */}
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
                  // Custom severity sort: high > medium > low
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
                          <div style={{
                            fontFamily: "'SF Mono', 'Fira Code', monospace",
                            fontSize: 11, color: "var(--gray-600)",
                          }}>{gap.gap_id}</div>
                          <div style={{ marginTop: 2 }}>
                            <SevBadge severity={gap.severity} />
                          </div>
                        </td>
                        <td style={{ fontWeight: 500 }} title={gap.question}>
                          <div className="cell-title">{gap.question}</div>
                        </td>
                        <td style={{ color: "var(--gray-500)", fontSize: 11 }}>{gap.area}</td>
                        <td>
                          {(() => {
                            const fb = clientFeedback.gaps[gap.gap_id];
                            // Collapse when PM has resolved AND client has answered —
                            // the client badge carries both signals (+ round number).
                            const aligned = fb && gap.status === "resolved";
                            if (fb && aligned) {
                              return <GapClientBadge fb={fb} />;
                            }
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
                        <th style={{ width: 60 }}>ID</th>
                        <SortableHeader label="Type" columnKey="type" state={consTable} />
                        <SortableHeader label="Constraint" columnKey="description" state={consTable} />
                        <SortableHeader label="Impact" columnKey="impact" state={consTable} />
                        <SortableHeader label="Status" columnKey="status" state={consTable} />
                      </tr>
                    </thead>
                    <tbody>
                      {visible.map((c, i) => {
                        // CON-NNN is derived from the constraint's position
                        // in the full constraints list (API returns them in
                        // stable created_at order).
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
                          <td
                            className="chevron-cell"
                            style={!c.seen_at ? { borderLeft: "4px solid var(--green)" } : undefined}
                          >
                            <Chevron />
                          </td>
                          <td style={{ fontFamily: "'SF Mono', 'Fira Code', monospace", fontSize: 11, color: "var(--gray-600)", whiteSpace: "nowrap" }}>
                            {conId}
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
              const filtered = contradictions.filter((c) =>
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
              projectId={projectId}
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
                  {documents.map((doc) => (
                    <tr key={doc.id} onClick={() => openDocument(doc)} className="clickable-row">
                      <td style={{ fontWeight: 600 }}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                          {doc.filename}
                          <SourceBadge source={doc.classification?.source as string | undefined} autoSynced={doc.classification?.auto_synced as boolean | undefined} />
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

  function openRequirement(req: ApiRequirement, mode: "replace" | "push" = "replace") {
    // Build the Sources section: one clickable link per source document.
    // Format: "- [filename.md](doc://<uuid>)". Links are intercepted by
    // the MarkdownPanel (see onLinkClick below) and resolve to the
    // document's content panel — same mechanism as clicking a row in
    // the Documents tab.
    const sourceLines: string[] = [];
    if (req.source_doc && req.source_doc_id) {
      sourceLines.push(`- [${req.source_doc}](doc://${req.source_doc_id})`);
    } else if (req.source_doc) {
      sourceLines.push(`- ${req.source_doc}`);
    }
    (req.sources || []).forEach((s) => {
      const name = s.filename || s.doc_id?.slice(0, 8) || "document";
      if (s.doc_id) sourceLines.push(`- [${name}](doc://${s.doc_id})`);
      else sourceLines.push(`- ${name}`);
    });

    const md = [
      `# ${req.req_id}: ${req.title}`,
      "", "## Description", req.description || "No description",
      req.user_perspective ? `\n## User Perspective\n${req.user_perspective}` : "",
      `\n## Business Rules\n${req.business_rules?.length
        ? req.business_rules.map((r: string) => `- ${r}`).join("\n")
        : "*None captured.*"}`,
      `\n## Acceptance Criteria\n${req.acceptance_criteria?.length
        ? req.acceptance_criteria.map((ac: string) => `- ${ac}`).join("\n")
        : "*None captured.*"}`,
      `\n## Edge Cases\n${req.edge_cases?.length
        ? req.edge_cases.map((e: string) => `- ${e}`).join("\n")
        : "*None captured.*"}`,
      sourceLines.length ? `\n## Sources\n${sourceLines.join("\n")}` : "",
    ].filter(Boolean).join("\n");

    const reqMeta: Record<string, string> = {
      priority: req.priority,
      status: req.status,
      confidence: req.confidence,
      version: `v${req.version || 1}${req.version > 1 ? ` · merged from ${1 + (req.sources?.length || 0)} docs` : ""}`,
      source: req.source_doc || "unknown",
    };
    if (req.source_person) reqMeta.requested_by = req.source_person;

    const view: DetailView = {
      title: `${req.req_id}: ${req.title}`, content: md,
      meta: reqMeta,
      history: req.id ? { projectId, itemType: "requirement", itemId: req.id } : undefined,
      actions: _reqActionsForStatus(req.status),
      onAction: async (action: string) => {
        await updateRequirement(projectId, req.req_id, { status: action });
        loadData(); setDetail(null);
      },
      itemKey: req.req_id,
      itemKind: "requirement",
    };
    if (mode === "push") pushDetail(view);
    else setDetail(view);
  }

  function openConstraint(con: any, index: number) {
    // Constraints have no persistent display id in the DB. We assign
    // CON-001, CON-002, … at render time based on the stable order
    // returned by the API (created_at + id), so the UI number matches
    // the vault's markdown filename sequence.
    const conId = `CON-${String(index + 1).padStart(3, "0")}`;

    // Use the description as the human-readable title — the previous
    // "{type} Constraint" auto-derivation was uninformative (every
    // technology constraint had the same title). First ~80 chars of
    // description, stripped of trailing punctuation.
    const desc = (con.description || "").trim();
    const shortTitle = desc.length > 80 ? desc.slice(0, 77).trimEnd() + "…" : desc;
    const headerTitle = shortTitle || `${con.type} constraint (no description)`;

    const sourceLines: string[] = [];
    if (con.source_doc && con.source_doc_id) {
      sourceLines.push(`- [${con.source_doc}](doc://${con.source_doc_id})`);
    } else if (con.source_doc) {
      sourceLines.push(`- ${con.source_doc}`);
    }

    // Age info → meta chip, no longer inlined as markdown.
    let raisedValue: string | null = null;
    if (con.created_at) {
      const raised = new Date(con.created_at);
      const days = Math.max(0, Math.floor((Date.now() - raised.getTime()) / 86_400_000));
      const raisedDate = raised.toISOString().slice(0, 10);
      const ageText = days === 0 ? "today" : `${days}d old`;
      raisedValue = `${raisedDate} · ${ageText}`;
    }

    const md = [
      `# ${conId}: ${headerTitle}`,
      desc && desc.length > 80 ? `\n${desc}` : "", // full description if truncated in title
      con.impact ? `\n## Impact\n${con.impact}` : "",
      con.source_quote ? `\n## Source Quote\n> ${con.source_quote}` : "",
      sourceLines.length ? `\n## Source Document\n${sourceLines.join("\n")}` : "",
    ].filter(Boolean).join("\n");

    // Status transition actions — only offer the statuses that aren't
    // already current. Confirmed is the strongest state; negotiable is
    // softest; assumed is the default when newly extracted.
    const allStatuses: Array<{ label: string; value: string; color: string }> = [
      { label: "Mark Confirmed",  value: "confirmed",  color: "#10b981" },
      { label: "Mark Assumed",    value: "assumed",    color: "#f59e0b" },
      { label: "Mark Negotiable", value: "negotiable", color: "#6366f1" },
    ];
    const actions = allStatuses.filter((a) => a.value !== con.status);

    const conMeta: Record<string, string> = { id: conId, type: con.type, status: con.status };
    if (raisedValue) conMeta.raised = raisedValue;

    setDetail({
      title: `${conId}: ${headerTitle}`,
      content: md,
      meta: conMeta,
      history: con.id ? { projectId, itemType: "constraint", itemId: con.id } : undefined,
      actions,
      onAction: async (action: string) => {
        await updateConstraintStatus(projectId, con.id, action as "confirmed" | "assumed" | "negotiable");
        loadData();
        setDetail(null);
      },
    });
  }

  function openGap(gap: ApiGap) {
    // Resolve each blocked BR id to its uuid (if we have it in state) so
    // the "Blocks" line renders as clickable links into the BR detail.
    const blocksLine = (gap.blocked_reqs || []).length
      ? "**Blocks:** " + gap.blocked_reqs.map((brId: string) => {
          const req = requirements.find((r) => r.req_id === brId);
          return req ? `[${brId}](br://${req.id})` : brId;
        }).join(", ")
      : "";

    const sourceLines: string[] = [];
    if (gap.source_doc && gap.source_doc_id) {
      sourceLines.push(`- [${gap.source_doc}](doc://${gap.source_doc_id})`);
    } else if (gap.source_doc) {
      sourceLines.push(`- ${gap.source_doc}`);
    }
    (gap.sources || []).forEach((s) => {
      const name = s.filename || s.doc_id?.slice(0, 8) || "document";
      if (s.doc_id) sourceLines.push(`- [${name}](doc://${s.doc_id})`);
      else sourceLines.push(`- ${name}`);
    });

    let gapResolution: DetailView["gapResolution"] = undefined;
    if ((gap.status === "resolved" || gap.status === "dismissed") && gap.resolution) {
      const parts = (gap.resolution as string).split("\n\n— Answered via ");
      gapResolution = {
        kind: gap.status as "resolved" | "dismissed",
        text: parts[0],
        attribution: parts.length > 1 ? parts[1] : null,
        closedAt: gap.closed_at || null,
        closedBy: gap.closed_by || null,
      };
    }

    // Age info — raise date + current age (open) or time-to-close (closed)
    // goes into the meta chip row; no longer inlined as markdown.
    let raisedValue: string | null = null;
    if (gap.created_at) {
      const raised = new Date(gap.created_at);
      const endPoint = gap.closed_at ? new Date(gap.closed_at) : new Date();
      const days = Math.max(0, Math.floor((endPoint.getTime() - raised.getTime()) / 86_400_000));
      const raisedDate = raised.toISOString().slice(0, 10);
      const ageText =
        gap.closed_at
          ? (days === 0 ? "closed same day" : `${days}d open before close`)
          : (days === 0 ? "today" : `${days}d old`);
      raisedValue = `${raisedDate} · ${ageText}`;
    }

    // "Suggested Action" is an instruction for the PM while the gap is
    // open. Once closed, it becomes historical context, so reframe the
    // heading to avoid sounding like a to-do.
    const suggestedActionHeading = (gap.status === "resolved" || gap.status === "dismissed")
      ? "Originally suggested action"
      : "Suggested Action";

    const md = [
      `# ${gap.gap_id}: ${gap.question}`,
      blocksLine ? `\n${blocksLine}` : "",
      gap.suggested_action ? `\n## ${suggestedActionHeading}\n${gap.suggested_action}` : "",
      gap.source_quote && gap.source_quote !== "extracted from document"
        ? `\n## Source Quote\n> ${gap.source_quote}`
        : "",
      sourceLines.length ? `\n## Source Document\n${sourceLines.join("\n")}` : "",
    ].filter(Boolean).join("\n");

    const isOpen = gap.status === "open";
    const actions = isOpen
      ? [
          { label: "Resolve", value: "resolve", color: "#10b981" },
          { label: "Add to Meeting", value: "meeting", color: "#6366f1" },
          { label: "Dismiss", value: "dismiss", color: "#ef4444" },
        ]
      : [{ label: "Reopen", value: "reopen", color: "#6b7280" }];

    const gapMeta: Record<string, string> = {
      severity: gap.severity,
      status: gap.status,
      area: gap.area || "general",
    };
    if (raisedValue) gapMeta.raised = raisedValue;
    if (gap.assignee) gapMeta.owner = gap.assignee;
    if (gap.source_person) gapMeta.ask = gap.source_person;

    setDetail({
      title: `${gap.gap_id}: ${gap.question}`,
      content: md,
      meta: gapMeta,
      history: gap.id ? { projectId, itemType: "gap", itemId: gap.id } : undefined,
      itemKey: gap.gap_id,
      itemKind: "gap",
      gapResolution,
      actions,
      onAction: async (action: string) => {
        if (action === "resolve") {
          const answer = prompt("Resolution — what was the answer?");
          if (answer) {
            await resolveGap(projectId, gap.gap_id, answer, "resolved");
            loadData();
            setDetail(null);
          }
        } else if (action === "dismiss") {
          const reason = prompt("Why dismiss this gap? (e.g., duplicate, out of scope, obsolete)") || "Dismissed";
          await resolveGap(projectId, gap.gap_id, reason, "dismissed");
          loadData();
          setDetail(null);
        } else if (action === "meeting") {
          // Mark the gap as selected for the next meeting and jump the
          // user to the Meeting Prep tab. MeetingPrepTab listens for
          // this event and auto-approves the item in its picker.
          window.dispatchEvent(new CustomEvent("add-to-meeting", { detail: { type: "gap", id: gap.id } }));
          onNavigate?.("meeting");
          setDetail(null);
        } else if (action === "reopen") {
          if (confirm("Reopen this gap? The current resolution will be kept in history.")) {
            await resolveGap(projectId, gap.gap_id, "", "open");
            loadData();
            setDetail(null);
          }
        }
      },
    });
  }

  /**
   * Open a document in the detail panel.
   * @param doc — document record
   * @param mode — "replace" (default; overwrites current detail) or "push"
   *               (adds on top of the stack so the close button returns to
   *               the caller's view, e.g. a BR that linked here).
   */
  async function openDocument(doc: ApiDocument, mode: "replace" | "push" = "replace") {
    const metaLines = [
      `# ${doc.filename}`,
      "", `**Type:** ${doc.file_type} | **Status:** ${doc.pipeline_stage}`,
      doc.file_size_bytes ? `**Size:** ${(doc.file_size_bytes / 1024).toFixed(1)} KB` : "",
      `**Uploaded:** ${doc.created_at ? new Date(doc.created_at).toLocaleString() : "unknown"}`,
      doc.items_extracted > 0 ? `**Extracted:** ${doc.items_extracted} items` : "",
      doc.pipeline_error ? `\n## Pipeline Error\n\`\`\`\n${doc.pipeline_error}\n\`\`\`` : "",
    ].filter(Boolean).join("\n");

    const meta = { type: doc.file_type, status: doc.pipeline_stage };
    const placeholder = { title: doc.filename, content: metaLines + "\n\n---\n\n*Loading content...*", meta };

    if (mode === "push") pushDetail(placeholder);
    else setDetail(placeholder);

    try {
      const data = await getDocumentContent(projectId, doc.id);
      const body = data.content
        ? metaLines + "\n\n---\n\n## Content\n\n" + data.content
        : metaLines + (data.message ? `\n\n---\n\n*${data.message}*` : "");
      updateTopDetail({ title: doc.filename, content: body, meta });
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
  const openContras = contradictions.filter((c) => !c.resolved).length;
  const openGaps = gaps.filter((g) => g.status === "open").length;

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
          {checks.map((c, i) => {
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
            {checks.filter((c: any) => c.status !== "covered").map((c, i) => (
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

function _reqActionsForStatus(status: string): { label: string; value: string; color: string }[] {
  switch (status) {
    case "confirmed":
      return [
        { label: "Revert to Proposed", value: "proposed", color: "#6B7280" },
        { label: "Drop", value: "dropped", color: "#EF4444" },
      ];
    case "dropped":
      return [
        { label: "Reopen", value: "proposed", color: "#3B82F6" },
      ];
    case "discussed":
      return [
        { label: "Confirm", value: "confirmed", color: "#059669" },
        { label: "Drop", value: "dropped", color: "#EF4444" },
      ];
    default: // proposed, draft
      return [
        { label: "Confirm", value: "confirmed", color: "#059669" },
        { label: "Mark as Discussed", value: "discussed", color: "#3B82F6" },
        { label: "Drop", value: "dropped", color: "#EF4444" },
      ];
  }
}


// Meeting questions are crafted by the discovery-prep-agent with full
// project context when the user generates an agenda. No client-side
// regex synthesis — we removed `_generateGapQuestion` because it was
// keyword-matching that produced recursive gibberish for any gap whose
// title already contained its trigger word.

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

function MeetingPrepTab({ projectId, contradictions, gaps, requirements, constraints, dashboard }: {
  projectId: string; contradictions: any[]; gaps: any[]; requirements: any[]; constraints: any[]; dashboard: any;
}) {
  const [phase, setPhase] = useState<"pick" | "agenda">("pick");
  const [agenda, setAgenda] = useState("");
  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [roundNumber, setRoundNumber] = useState(0);
  const [copied, setCopied] = useState(false);
  const [copiedEmail, setCopiedEmail] = useState(false);
  const [draftingEmail, setDraftingEmail] = useState(false);
  const [draftSent, setDraftSent] = useState(false);
  const [draftUrl, setDraftUrl] = useState<string | null>(null);
  const [gmailConnected, setGmailConnected] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [customTopic, setCustomTopic] = useState("");
  const [customTopics, setCustomTopics] = useState<string[]>([]);
  const [agendaHistory, setAgendaHistory] = useState<any[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  // Item selection state
  const [statuses, setStatuses] = useState<Record<string, "approved" | "dismissed">>({});
  function approve(id: string) {
    setStatuses((s) => ({ ...s, [id]: s[id] === "approved" ? undefined as any : "approved" }));
  }
  function dismiss(id: string) {
    setStatuses((s) => ({ ...s, [id]: s[id] === "dismissed" ? undefined as any : "dismissed" }));
  }

  // Cross-component event: when a user clicks "Add to Meeting" from a
  // gap (or other) detail elsewhere in the app, auto-approve the item
  // here so they land on the picker with it already selected.
  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ type: string; id: string }>;
      const id = ce.detail?.id;
      if (!id) return;
      setStatuses((s) => ({ ...s, [id]: "approved" }));
      setPhase("pick"); // make sure we're on the picker, not the agenda
    };
    window.addEventListener("add-to-meeting", handler);
    return () => window.removeEventListener("add-to-meeting", handler);
  }, []);
  function selectAllInSection(ids: string[]) {
    const allApproved = ids.every((id) => statuses[id] === "approved");
    setStatuses((s) => {
      const next = { ...s };
      ids.forEach((id) => { next[id] = allApproved ? undefined as any : "approved"; });
      return next;
    });
  }
  const getStatus = (id: string) => statuses[id];

  // Derived data
  const openGaps = gaps.filter((g) => g.status === "open");
  const highGaps = openGaps.filter((g: any) => g.severity === "high");
  const unconfirmedMust = requirements.filter((r: any) => r.status !== "confirmed" && (r.priority === "must" || r.priority === "should"));

  const approvedItems = [
    ...openGaps.filter((g: any) => getStatus(g.id) === "approved"),
    ...unconfirmedMust.filter((r: any) => getStatus(r.req_id) === "approved"),
    ...contradictions.filter((c: any) => getStatus(c.id) === "approved"),
  ];
  const approvedCount = approvedItems.length + customTopics.length;

  // Time estimation
  const estimatedMin =
    contradictions.filter((c: any) => getStatus(c.id) === "approved").length * 10
    + openGaps.filter((g: any) => getStatus(g.id) === "approved" && g.severity === "high").length * 5
    + openGaps.filter((g: any) => getStatus(g.id) === "approved" && g.severity !== "high").length * 3
    + unconfirmedMust.filter((r: any) => getStatus(r.req_id) === "approved").length * 2
    + customTopics.length * 5;

  // Check Gmail connection for "Draft in Gmail" button
  useEffect(() => {
    listIntegrations(projectId)
      .then((d) => setGmailConnected((d.integrations || []).some((i: any) => i.connector_id === "gmail" && i.status === "active")))
      .catch(() => {});
  }, [projectId]);

  // Load saved agenda + history on mount
  useEffect(() => {
    (async () => {
      // Load history
      try {
        const { listMeetingAgendas } = await import("@/lib/api");
        const hist = await listMeetingAgendas(projectId);
        setAgendaHistory(hist.agendas || []);
      } catch {}
      // Load latest agenda — vault file first, then DB
      try {
        const { getMeetingAgendaFromVault } = await import("@/lib/api");
        const vault = await getMeetingAgendaFromVault(projectId);
        if (vault.content) {
          setAgenda(vault.content);
          setPhase("agenda");
          return;
        }
      } catch {}
      try {
        const db = await getMeetingAgenda(projectId);
        if (db.content_md) {
          setAgenda(db.content_md);
          setRoundNumber(db.round_number || 0);
          setPhase("agenda");
        }
      } catch {}
    })();
  }, [projectId]);

  // Listen for chat response completion — the agent writes the agenda
  // to a .md file in the vault. Read it via the dedicated endpoint.
  useEffect(() => {
    if (!generating) return;
    function handleChatDone() {
      // Wait briefly for file writes to flush, then read the file
      setTimeout(async () => {
        try {
          const { getMeetingAgendaFromVault } = await import("@/lib/api");
          const vault = await getMeetingAgendaFromVault(projectId);
          if (vault.content) {
            setAgenda(vault.content);
            setPhase("agenda");
            // Also persist to DB
            createNewAgenda(projectId, vault.content).then(() => {
              setRoundNumber((r) => r + 1);
            }).catch(() => {});
          }
        } catch {}
        setGenerating(false);
      }, 2000);
    }
    window.addEventListener("chat-response-done", handleChatDone);
    return () => window.removeEventListener("chat-response-done", handleChatDone);
  }, [generating, projectId]);

  function handleGenerate() {
    // Build a clean, readable chat message from selected items
    const selectedGaps = openGaps.filter((g: any) => getStatus(g.id) === "approved");
    const selectedReqs = unconfirmedMust.filter((r: any) => getStatus(r.req_id) === "approved");
    const selectedContras = contradictions.filter((c: any) => getStatus(c.id) === "approved");
    const dismissedItems = [
      ...openGaps.filter((g: any) => getStatus(g.id) === "dismissed").map((g: any) => g.question?.slice(0, 60)),
      ...unconfirmedMust.filter((r: any) => getStatus(r.req_id) === "dismissed").map((r: any) => r.title?.slice(0, 60)),
    ].filter(Boolean);

    const readiness = dashboard?.readiness?.score || 0;

    let message = `Prepare meeting agenda · **${approvedCount} items** · est. ${estimatedMin} min · readiness ${readiness}%\n\n`;

    if (selectedContras.length > 0) {
      message += `**Decisions (${selectedContras.length})**\n`;
      selectedContras.forEach((c: any) => { message += `- ${c.explanation?.slice(0, 80)}\n`; });
      message += `\n`;
    }
    if (selectedReqs.length > 0) {
      message += `**Confirm (${selectedReqs.length})**\n`;
      selectedReqs.forEach((r: any) => { message += `- ${r.title}\n`; });
      message += `\n`;
    }
    if (selectedGaps.length > 0) {
      message += `**Questions (${selectedGaps.length})**\n`;
      selectedGaps.forEach((g: any) => { message += `- ${g.question?.slice(0, 80)}\n`; });
      message += `\n`;
    }
    if (customTopics.length > 0) {
      message += `**Custom**\n`;
      customTopics.forEach((t) => { message += `- ${t}\n`; });
      message += `\n`;
    }
    if (dismissedItems.length > 0) {
      message += `**Parking lot:** ${dismissedItems.slice(0, 5).join(", ")}\n`;
    }

    setGenerating(true);
    // Dispatch to ChatPanel
    window.dispatchEvent(new CustomEvent("send-chat", { detail: { text: message } }));
  }

  async function handleSave() {
    setSaving(true);
    try {
      await saveMeetingAgenda(projectId, agenda);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {}
    setSaving(false);
  }

  async function handleDraftInGmail() {
    setDraftingEmail(true);
    try {
      const { createGmailDraft } = await import("@/lib/api");
      const projectName = dashboard?.project_name || "Discovery";
      const subject = `Discovery Meeting Agenda — ${projectName}`;
      const body = `Hi team,\n\nPlease find below the agenda for our upcoming discovery meeting. I'd appreciate if you could review it before our session.\n\n${agenda}\n\nPlease let me know if you'd like to add any topics.\n\nBest regards`;
      const result = await createGmailDraft(projectId, subject, body);
      setDraftSent(true);
      if (result.gmail_url) {
        setDraftUrl(result.gmail_url);
        // Keep the link visible — don't auto-hide when we have a URL
      } else {
        setTimeout(() => setDraftSent(false), 3000);
      }
    } catch (e: any) {
      alert(e.message || "Failed to create Gmail draft");
    }
    setDraftingEmail(false);
  }

  function handleCopy() {
    navigator.clipboard.writeText(agenda);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleCopyAsEmail() {
    // Wrap the agenda in a professional email template
    const projectName = dashboard?.project_name || "the project";
    const emailBody = `Hi team,

Please find below the agenda for our upcoming discovery meeting. I'd appreciate if you could review it before our session so we can make the most of our time together.

${agenda}

Please let me know if you'd like to add any topics or if any of the items above need clarification before we meet.

Looking forward to a productive session.

Best regards`;

    navigator.clipboard.writeText(emailBody);
    setCopiedEmail(true);
    setTimeout(() => setCopiedEmail(false), 2000);
  }

  function handleDownload() {
    const blob = new Blob([agenda], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `meeting-agenda-round-${roundNumber || "draft"}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function addCustomTopic() {
    if (customTopic.trim()) {
      setCustomTopics((prev) => [...prev, customTopic.trim()]);
      setCustomTopic("");
    }
  }

  function ItemActions({ id }: { id: string }) {
    const st = getStatus(id);
    return (
      <div style={{ display: "flex", gap: 4, marginLeft: "auto", flexShrink: 0 }}>
        <button title={st === "approved" ? "Remove from agenda" : "Add to agenda"} onClick={(e) => { e.stopPropagation(); approve(id); }}
          style={{ width: 26, height: 26, borderRadius: 6, border: "none", background: st === "approved" ? "#d1fae5" : "var(--gray-100)", color: st === "approved" ? "#059669" : "var(--gray-400)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>
          ✓
        </button>
        <button title={st === "dismissed" ? "Restore" : "Dismiss"} onClick={(e) => { e.stopPropagation(); dismiss(id); }}
          style={{ width: 26, height: 26, borderRadius: 6, border: "none", background: st === "dismissed" ? "#fee2e2" : "var(--gray-100)", color: st === "dismissed" ? "#EF4444" : "var(--gray-400)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12 }}>
          ✕
        </button>
      </div>
    );
  }

  // ── PHASE 2: Agenda viewer/editor ──
  if (phase === "agenda" && agenda) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--dark)" }}>
              Meeting Agenda {roundNumber > 0 && <span style={{ fontSize: 11, color: "var(--gray-500)" }}>· Round {roundNumber}</span>}
            </div>
          </div>
          <button onClick={() => { setPhase("pick"); }} style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid var(--gray-200)", background: "#fff", fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "var(--font)", color: "var(--gray-600)" }}>
            ← Back to items
          </button>
          {!editMode && (
            <>
              <button onClick={handleCopyAsEmail} style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid var(--gray-200)", background: "#fff", fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "var(--font)", color: "var(--gray-600)" }}>
                {copiedEmail ? "✓ Copied!" : "Copy as Email"}
              </button>
              {gmailConnected && (
                draftSent && draftUrl ? (
                  <a href={draftUrl} target="_blank" rel="noopener noreferrer" style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid #059669", background: "#ecfdf5", fontSize: 11, fontWeight: 600, fontFamily: "var(--font)", color: "#059669", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4 }}>
                    ✓ Open draft in Gmail →
                  </a>
                ) : (
                  <button onClick={handleDraftInGmail} disabled={draftingEmail} style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid var(--gray-200)", background: "#fff", fontSize: 11, fontWeight: 600, cursor: draftingEmail ? "default" : "pointer", fontFamily: "var(--font)", color: "var(--gray-600)", opacity: draftingEmail ? 0.6 : 1 }}>
                    {draftingEmail ? "Creating..." : "Draft in Gmail"}
                  </button>
                )
              )}
              <button onClick={handleDownload} style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid var(--gray-200)", background: "#fff", fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "var(--font)", color: "var(--gray-600)" }}>
                Download
              </button>
            </>
          )}
          <button onClick={() => { if (editMode) handleSave(); setEditMode(!editMode); }}
            style={{ padding: "6px 14px", borderRadius: 8, border: editMode ? "1px solid var(--green)" : "1px solid var(--gray-200)", background: editMode ? "var(--green-light)" : "#fff", fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "var(--font)", color: editMode ? "var(--green-hover)" : "var(--gray-600)" }}>
            {editMode ? (saving ? "Saving..." : saved ? "✓ Saved" : "Save & Preview") : "Edit"}
          </button>
        </div>
        {editMode ? (
          <textarea value={agenda} onChange={(e) => setAgenda(e.target.value)}
            style={{ width: "100%", minHeight: 500, padding: "16px 18px", borderRadius: 10, border: "1px solid var(--green-mid)", background: "#fff", fontSize: 13, lineHeight: 1.7, fontFamily: "monospace", resize: "vertical", outline: "none" }} />
        ) : (
          <div style={{ padding: "20px 24px", borderRadius: 10, border: "1px solid var(--gray-200)", background: "#fff", fontSize: 13, lineHeight: 1.7 }}
            className="chat-markdown-body"
            dangerouslySetInnerHTML={{ __html: _renderMeetingMd(agenda) }} />
        )}
      </div>
    );
  }

  // ── PHASE 1: Item picker ──
  const allItems = openGaps.length + unconfirmedMust.length + contradictions.length;

  return (
    <div className="mp-container">
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--dark)" }}>Prepare Meeting Agenda</div>
          <div style={{ fontSize: 11, color: "var(--gray-500)" }}>
            Select items to discuss · {approvedCount} selected · est. {estimatedMin} min
          </div>
        </div>
        {agenda && (
          <button onClick={() => setPhase("agenda")} style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid var(--gray-200)", background: "#fff", fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "var(--font)", color: "var(--gray-600)" }}>
            View Last Agenda →
          </button>
        )}
        <button onClick={handleGenerate} disabled={generating || approvedCount === 0}
          style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 18px", borderRadius: 8, border: "none", background: approvedCount === 0 ? "var(--gray-100)" : "var(--green)", color: approvedCount === 0 ? "var(--gray-400)" : "var(--dark)", fontSize: 12, fontWeight: 700, cursor: approvedCount === 0 ? "default" : "pointer", fontFamily: "var(--font)", boxShadow: approvedCount > 0 ? "0 1px 3px rgba(0,229,160,0.25)" : "none" }}>
          <svg viewBox="0 0 24 24" style={{ width: 13, height: 13, stroke: "currentColor", fill: "none", strokeWidth: 2.5 }}>
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
          </svg>
          {generating ? "Generating in chat..." : approvedCount > 0 ? `Generate Agenda · ${approvedCount} items` : "Select items first"}
        </button>
      </div>

      {generating && (
        <div style={{ padding: "12px 16px", borderRadius: 10, background: "var(--green-light)", border: "1px solid var(--green)", marginBottom: 12, fontSize: 12, color: "var(--dark)" }}>
          ✨ The agent is generating your agenda in the <strong>chat panel</strong> (left side). You can watch it work in real time. The agenda will appear here when it's done.
        </div>
      )}

      {/* Agenda history */}
      {agendaHistory.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <button
            onClick={() => setShowHistory(!showHistory)}
            style={{
              display: "flex", alignItems: "center", gap: 6, width: "100%",
              padding: "8px 12px", borderRadius: 8,
              border: "1px solid var(--gray-100)", background: "var(--gray-50)",
              fontSize: 12, fontWeight: 600, color: "var(--gray-600)",
              cursor: "pointer", fontFamily: "var(--font)",
            }}
          >
            <svg viewBox="0 0 24 24" style={{ width: 13, height: 13, stroke: "currentColor", fill: "none", strokeWidth: 2 }}>
              <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
            </svg>
            Past Agendas ({agendaHistory.length})
            <svg viewBox="0 0 24 24" style={{ width: 12, height: 12, stroke: "currentColor", fill: "none", strokeWidth: 2, marginLeft: "auto", transform: showHistory ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          {showHistory && (
            <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
              {agendaHistory.map((a: any) => (
                <button
                  key={a.id}
                  onClick={async () => {
                    try {
                      const { getMeetingAgendaByRound } = await import("@/lib/api");
                      const data = await getMeetingAgendaByRound(projectId, a.round_number);
                      if (data.content_md) {
                        setAgenda(data.content_md);
                        setRoundNumber(a.round_number);
                        setPhase("agenda");
                      }
                    } catch {}
                  }}
                  style={{
                    display: "flex", alignItems: "center", gap: 10,
                    padding: "8px 12px", borderRadius: 8,
                    border: "1px solid var(--gray-100)", background: "#fff",
                    cursor: "pointer", fontFamily: "var(--font)", textAlign: "left",
                    width: "100%",
                  }}
                >
                  <span style={{
                    width: 24, height: 24, borderRadius: 6, flexShrink: 0,
                    background: "var(--green-light)", color: "var(--green-hover)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 11, fontWeight: 800,
                  }}>
                    {a.round_number}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--dark)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      Round {a.round_number} {a.edited_at ? "(edited)" : ""}
                    </div>
                    <div style={{ fontSize: 10, color: "var(--gray-500)" }}>
                      {a.created_at ? new Date(a.created_at).toLocaleDateString() : ""}
                      {a.preview ? ` · ${a.preview.slice(0, 60)}...` : ""}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {allItems === 0 ? (
        <EmptyState icon="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" text="No items for the agenda. All requirements confirmed, no gaps or contradictions." />
      ) : (
        <>
          {/* Contradictions / Decisions */}
          {contradictions.length > 0 && (
            <div className="mp-section">
              <div className="mp-section-head" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div className="mp-section-icon" style={{ background: "#EF444420", color: "#EF4444" }}>!</div>
                <div className="mp-section-title" style={{ flex: 1 }}>Decisions Needed ({contradictions.filter((c: any) => getStatus(c.id) !== "dismissed").length})</div>
                <button onClick={() => selectAllInSection(contradictions.map((c: any) => c.id))} style={{ fontSize: 10, fontWeight: 600, color: "var(--gray-500)", background: "none", border: "none", cursor: "pointer", fontFamily: "var(--font)", padding: "2px 6px" }}>
                  {contradictions.every((c: any) => getStatus(c.id) === "approved") ? "Deselect all" : "Select all"}
                </button>
              </div>
              {contradictions.map((c: any) => {
                const st = getStatus(c.id);
                if (st === "dismissed") return null;
                return (
                  <div key={c.id} className="mp-item" style={{ border: "1px solid var(--gray-100)", borderLeftWidth: 3, borderLeftColor: st === "approved" ? "#059669" : "transparent", padding: "10px 12px", borderRadius: 8, marginBottom: 6, display: "flex", alignItems: "center", gap: 10, background: st === "approved" ? "#f0fdf4" : "#fff" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--dark)" }}>{c.explanation?.slice(0, 80)}</div>
                      <div style={{ fontSize: 11, color: "var(--gray-500)", marginTop: 2 }}>~10 min · affects {c.item_a_type || "requirement"}</div>
                    </div>
                    <ItemActions id={c.id} />
                  </div>
                );
              })}
            </div>
          )}

          {/* Unconfirmed requirements */}
          {unconfirmedMust.length > 0 && (
            <div className="mp-section">
              <div className="mp-section-head" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div className="mp-section-icon" style={{ background: "#3B82F620", color: "#3B82F6" }}>✓</div>
                <div className="mp-section-title" style={{ flex: 1 }}>Requirements to Confirm ({unconfirmedMust.filter((r: any) => getStatus(r.req_id) !== "dismissed").length})</div>
                <button onClick={() => selectAllInSection(unconfirmedMust.map((r: any) => r.req_id))} style={{ fontSize: 10, fontWeight: 600, color: "var(--gray-500)", background: "none", border: "none", cursor: "pointer", fontFamily: "var(--font)", padding: "2px 6px" }}>
                  {unconfirmedMust.every((r: any) => getStatus(r.req_id) === "approved") ? "Deselect all" : "Select all"}
                </button>
              </div>
              {unconfirmedMust.map((r: any) => {
                const st = getStatus(r.req_id);
                if (st === "dismissed") return null;
                return (
                  <div key={r.req_id} className="mp-item" style={{ border: "1px solid var(--gray-100)", borderLeftWidth: 3, borderLeftColor: st === "approved" ? "#059669" : "transparent", padding: "10px 12px", borderRadius: 8, marginBottom: 6, display: "flex", alignItems: "center", gap: 10, background: st === "approved" ? "#f0fdf4" : "#fff" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--dark)" }}>{r.req_id}: {r.title}</div>
                      <div style={{ fontSize: 11, color: "var(--gray-500)", marginTop: 2 }}>~2 min · {r.priority} priority · {r.status}</div>
                    </div>
                    <ItemActions id={r.req_id} />
                  </div>
                );
              })}
            </div>
          )}

          {/* Open gaps */}
          {openGaps.length > 0 && (
            <div className="mp-section">
              <div className="mp-section-head" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div className="mp-section-icon" style={{ background: "#F59E0B20", color: "#F59E0B" }}>?</div>
                <div className="mp-section-title" style={{ flex: 1 }}>Open Questions ({openGaps.filter((g: any) => getStatus(g.id) !== "dismissed").length})</div>
                <button onClick={() => selectAllInSection(openGaps.map((g: any) => g.id))} style={{ fontSize: 10, fontWeight: 600, color: "var(--gray-500)", background: "none", border: "none", cursor: "pointer", fontFamily: "var(--font)", padding: "2px 6px" }}>
                  {openGaps.every((g: any) => getStatus(g.id) === "approved") ? "Deselect all" : "Select all"}
                </button>
              </div>
              {openGaps.map((g: any) => {
                const st = getStatus(g.id);
                if (st === "dismissed") return null;
                return (
                  <div key={g.id} className="mp-item" style={{ border: "1px solid var(--gray-100)", borderLeftWidth: 3, borderLeftColor: st === "approved" ? "#059669" : "transparent", padding: "10px 12px", borderRadius: 8, marginBottom: 6, display: "flex", alignItems: "center", gap: 10, background: st === "approved" ? "#f0fdf4" : "#fff" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--dark)" }}>{g.question?.slice(0, 80)}</div>
                      <div style={{ fontSize: 11, color: "var(--gray-500)", marginTop: 2 }}>~{g.severity === "high" ? 5 : 3} min · {g.severity} severity{g.blocked_reqs?.length ? ` · blocks ${g.blocked_reqs.join(", ")}` : ""}</div>
                    </div>
                    <ItemActions id={g.id} />
                  </div>
                );
              })}
            </div>
          )}

          {/* Custom topics */}
          <div className="mp-section">
            <div className="mp-section-head">
              <div className="mp-section-icon" style={{ background: "#8B5CF620", color: "#8B5CF6" }}>+</div>
              <div className="mp-section-title">Custom Topics ({customTopics.length})</div>
            </div>
            {customTopics.map((t, i) => (
              <div key={i} className="mp-item" style={{ borderLeft: "3px solid #8B5CF6" }}>
                <div className="mp-item-content">
                  <div className="mp-item-title">{t}</div>
                  <div className="mp-item-meta">~5 min</div>
                </div>
                <button onClick={() => setCustomTopics((prev) => prev.filter((_, j) => j !== i))}
                  style={{ width: 26, height: 26, borderRadius: 6, border: "none", background: "var(--gray-100)", color: "var(--gray-400)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12 }}>
                  ✕
                </button>
              </div>
            ))}
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <input value={customTopic} onChange={(e) => setCustomTopic(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") addCustomTopic(); }}
                placeholder="Add a topic..."
                style={{ flex: 1, padding: "7px 12px", borderRadius: 8, border: "1px solid var(--gray-200)", fontSize: 12, fontFamily: "var(--font)", outline: "none" }} />
              <button onClick={addCustomTopic} disabled={!customTopic.trim()}
                style={{ padding: "7px 14px", borderRadius: 8, border: "none", background: customTopic.trim() ? "var(--purple-light, #f3e8ff)" : "var(--gray-100)", color: customTopic.trim() ? "#7c3aed" : "var(--gray-400)", fontSize: 11, fontWeight: 600, cursor: customTopic.trim() ? "pointer" : "default", fontFamily: "var(--font)" }}>
                Add
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}


function _renderMeetingMd(md: string): string {
  // Use the same CSS classes as renderChatMarkdown in ChatPanel
  // so the agenda preview matches the chat's typography exactly.
  let html = md;

  // Headings — chat classes + slightly larger h1 for agenda title
  html = html.replace(/^### (.+)$/gm, '<h4 class="chat-h4">$1</h4>');
  html = html.replace(/^## (.+)$/gm, '<h3 class="chat-h3" style="margin-top:14px">$1</h3>');
  html = html.replace(/^# (.+)$/gm, '<h2 class="chat-h2" style="font-size:17px;margin-bottom:6px">$1</h2>');

  // Horizontal rules
  html = html.replace(/^---$/gm, '<hr class="chat-hr">');

  // Bold + italic
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");

  // Checkboxes — collect consecutive, use chat-ul with checkbox prefix
  html = html.replace(/((?:^- \[ \] .+$\n?)+)/gm, (block) => {
    const items = block.trim().split("\n").map((l: string) => l.replace(/^- \[ \] /, ""));
    return '<ul class="chat-ul" style="list-style:none;padding-left:12px">' +
      items.map((i: string) => `<li class="chat-li" style="display:flex;gap:6px;align-items:flex-start"><span style="color:var(--gray-300);flex-shrink:0">☐</span><span>${i}</span></li>`).join("") +
      "</ul>";
  });

  // Unordered lists — collect consecutive lines
  html = html.replace(/((?:^- .+$\n?)+)/gm, (block) => {
    const items = block.trim().split("\n").map((l: string) => l.replace(/^- /, ""));
    return '<ul class="chat-ul">' + items.map((i: string) => `<li class="chat-li">${i}</li>`).join("") + "</ul>";
  });

  // Ordered lists — collect consecutive lines
  html = html.replace(/((?:^\d+\. .+$\n?)+)/gm, (block) => {
    const items = block.trim().split("\n").map((l: string) => l.replace(/^\d+\. /, ""));
    return '<ol class="chat-ol">' + items.map((i: string) => `<li class="chat-oli">${i}</li>`).join("") + "</ol>";
  });

  // Paragraphs + line breaks
  html = html.replace(/\n\n/g, '<div class="chat-paragraph-break"></div>');
  html = html.replace(/\n/g, "<br>");

  return html;
}


