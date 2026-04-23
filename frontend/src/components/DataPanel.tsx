"use client";

import { useEffect, useState } from "react";
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
  GapResolutionCard, ClientFeedbackCard,
  type GapResolution,
} from "./datapanel/feedback-cards";
import { ProposedUpdatesSection } from "./datapanel/proposed-updates-section";
import { HandoffTab } from "./datapanel/handoff-tab";
import { MeetingPrepTab } from "./datapanel/meeting-prep-tab";
import { RemindersTab } from "./datapanel/reminders-tab";
import { ReadinessPanel } from "./datapanel/readiness";
import { RequirementsTab } from "./datapanel/tabs/requirements-tab";
import { DocumentsTab } from "./datapanel/tabs/documents-tab";
import { GapsTab } from "./datapanel/tabs/gaps-tab";
import {
  buildRequirementView, buildConstraintView, buildGapView,
  buildDocumentPlaceholder, buildDocumentFullView,
} from "./datapanel/detail-builders";
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
  { id: "reminders", label: "Reminders", icon: "M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0" },
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

  // React to external tab/highlight changes. `initialTab` comes from the
  // ?tab=… URL param; several legacy callers still emit "constraints" /
  // "contradictions" but those aren't real tabs — they're subsections of
  // the gaps tab. Map them into (activeTab, gapSection) before setting.
  useEffect(() => {
    if (!initialTab) return;
    if (initialTab === "constraints") {
      setActiveTab("gaps");
      setGapSection("constraints");
    } else if (initialTab === "contradictions" || initialTab === "conflicts") {
      setActiveTab("gaps");
      setGapSection("conflicts");
    } else if (initialTab === "decisions" || initialTab === "scope" || initialTab === "assumptions") {
      // Legacy taxonomy — these kinds no longer exist. Fall back to gaps.
      setActiveTab("gaps");
    } else {
      setActiveTab(initialTab);
    }
  }, [initialTab]);

  // Auto-open highlighted item after data loads.
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
    } else if (initialTab === "contradictions" || initialTab === "conflicts") {
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
            const hasAnything = reqFb || gapFb || detail.gapResolution;
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
              </>
            );
          })()}
          slotBottom={(() => {
            if (detail.itemKind !== "requirement" || !detail.itemKey) return undefined;
            const pendingProps = proposals.filter((p) => p.target_req_id === detail.itemKey);
            if (pendingProps.length === 0) return undefined;
            return (
              <ProposedUpdatesSection
                proposals={pendingProps}
                onAccept={async (id) => {
                  try {
                    await acceptProposal(projectId, id);
                    await loadData();
                  } catch (e) {
                    console.error("Proposal accept failed", e);
                  }
                }}
                onReject={async (id, reason) => {
                  try {
                    await rejectProposal(projectId, id, reason || undefined);
                    await loadData();
                  } catch (e) {
                    console.error("Proposal reject failed", e);
                  }
                }}
              />
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
          <GapsTab
            projectId={projectId}
            gaps={gaps}
            setGaps={setGaps}
            constraints={constraints}
            setConstraints={setConstraints}
            contradictions={contradictions}
            setContradictions={setContradictions}
            gapsTable={gapsTable}
            consTable={consTable}
            contraTable={contraTable}
            gapSection={gapSection}
            setGapSection={setGapSection}
            gapStatusFilter={gapStatusFilter}
            setGapStatusFilter={setGapStatusFilter}
            contraFilter={contraFilter}
            setContraFilter={setContraFilter}
            unreadCounts={{
              gap: unreadCounts.gap,
              constraint: unreadCounts.constraint,
              contradiction: unreadCounts.contradiction,
            }}
            markTabSeenAll={markTabSeenAll}
            markRowSeen={markRowSeen}
            openGap={openGap}
            openConstraint={openConstraint}
            clientFeedback={clientFeedback}
            expandedRow={expandedRow}
            setExpandedRow={setExpandedRow}
            onNavigate={onNavigate}
            loadData={loadData}
          />
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

        {/* ── REMINDERS ── */}
        {activeTab === "reminders" && (
          <div className="dp-tab-content active">
            <RemindersTab projectId={projectId} />
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
    const view: DetailView = {
      ...buildRequirementView(req, projectId),
      onAction: async (action: string) => {
        await updateRequirement(projectId, req.req_id, { status: action });
        loadData(); setDetail(null);
      },
    };
    if (mode === "push") pushDetail(view);
    else setDetail(view);
  }

  function openConstraint(con: ApiConstraint, index: number) {
    setDetail({
      ...buildConstraintView(con, index, projectId),
      onAction: async (action: string) => {
        await updateConstraintStatus(projectId, con.id, action as "confirmed" | "assumed" | "negotiable");
        loadData();
        setDetail(null);
      },
    });
  }

  function openGap(gap: ApiGap) {
    setDetail({
      ...buildGapView(gap, requirements, projectId),
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
          // MeetingPrepTab listens for this event and auto-approves the
          // item in its picker when the user jumps to that tab.
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
    const placeholder = buildDocumentPlaceholder(doc);
    if (mode === "push") pushDetail(placeholder);
    else setDetail(placeholder);

    try {
      const data = await getDocumentContent(projectId, doc.id);
      updateTopDetail(buildDocumentFullView(doc, data.content, data.message));
    } catch {
      // Keep showing metadata if content fetch fails
    }
  }
}


// Meeting questions are crafted by the discovery-prep-agent with full
// project context when the user generates an agenda. No client-side
// regex synthesis — we removed `_generateGapQuestion` because it was
// keyword-matching that produced recursive gibberish for any gap whose
// title already contained its trigger word.



/* ── Meeting Prep Tab ── */



