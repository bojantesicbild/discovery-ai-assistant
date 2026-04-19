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
import { MeetingPrepTab } from "./datapanel/meeting-prep-tab";
import { ReadinessPanel } from "./datapanel/readiness";
import { RequirementsTab } from "./datapanel/tabs/requirements-tab";
import { DocumentsTab } from "./datapanel/tabs/documents-tab";
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
          <RequirementsTab
            requirements={requirements}
            setRequirements={setRequirements}
            reqsTable={reqsTable}
            priorityFilter={priorityFilter}
            setPriorityFilter={setPriorityFilter}
            statusFilter={statusFilter}
            setStatusFilter={setStatusFilter}
            unreadCount={unreadCounts.requirement}
            markTabSeenAll={markTabSeenAll}
            markRowSeen={markRowSeen}
            openRequirement={openRequirement}
            onNavigate={onNavigate}
            clientFeedback={clientFeedback}
            proposals={proposals}
          />
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
          <DocumentsTab
            projectId={projectId}
            documents={documents}
            gmailOpen={gmailOpen}
            setGmailOpen={setGmailOpen}
            gmailConnected={gmailConnected}
            driveOpen={driveOpen}
            setDriveOpen={setDriveOpen}
            driveConnected={driveConnected}
            openDocument={openDocument}
            loadData={loadData}
          />
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



