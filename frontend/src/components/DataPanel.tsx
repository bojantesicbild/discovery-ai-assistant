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
import RequirementDetailView from "./datapanel/requirement-detail-view";
import ConnectionsSection from "./datapanel/connections-section";
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
  // Manual collapse (chevron) — persisted so the PM's preference sticks.
  const [heroManuallyCollapsed, setHeroManuallyCollapsed] = usePersistedState<boolean>(
    "datapanel:heroCollapsed", false,
  );
  // Scroll-driven collapse — transient, resets on remount/tab swap.
  // Set by the scroll listener hooked onto .reqs-scroll below.
  const [heroScrollCollapsed, setHeroScrollCollapsed] = useState(false);
  const heroCollapsed = heroManuallyCollapsed || heroScrollCollapsed;
  const setHeroCollapsed = setHeroManuallyCollapsed;
  const [activeTab, setActiveTab] = usePersistedState<string>(
    `datapanel:tab:${projectId}`,
    initialTab || "reqs",
  );

  // Auto-collapse hero when the active tab's scroll surface moves past
  // a small threshold. Re-attaches when activeTab changes because each
  // tab mounts its own .reqs-scroll node. Transient — unmount clears.
  useEffect(() => {
    setHeroScrollCollapsed(false);
    // Next tick so the tab's DOM has mounted.
    const timer = setTimeout(() => {
      const panel = document.querySelector(".data-panel");
      const scroller = panel?.querySelector(".reqs-scroll") as HTMLElement | null;
      if (!scroller) return;
      const THRESHOLD = 40;
      const onScroll = () => setHeroScrollCollapsed(scroller.scrollTop > THRESHOLD);
      onScroll();
      scroller.addEventListener("scroll", onScroll, { passive: true });
      (scroller as any)._collapseCleanup = () => scroller.removeEventListener("scroll", onScroll);
    }, 0);
    return () => {
      clearTimeout(timer);
      const panel = document.querySelector(".data-panel");
      const scroller = panel?.querySelector(".reqs-scroll") as any;
      scroller?._collapseCleanup?.();
    };
  }, [activeTab]);

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

  // Auto-open highlighted item after data loads. BR / gap / constraint
  // all open the detail panel (same behavior users get from clicking a
  // finding-id chip in chat); contradiction falls back to inline-expand
  // because there's no detail-panel builder for it yet.
  useEffect(() => {
    if (!highlightId) return;

    if (initialTab === "reqs") {
      const req = requirements.find((r) => r.req_id === highlightId);
      if (req) openRequirement(req);
    } else if (initialTab === "gaps") {
      // highlightId can be either GAP-NNN or CON-NNN or CTR-NNN since
      // all three live under tab=gaps via sub-sections. Dispatch by prefix.
      if (highlightId.startsWith("GAP-")) {
        const gap = gaps.find((g) => g.gap_id === highlightId);
        if (gap) openGap(gap);
      } else if (highlightId.startsWith("CON-")) {
        // CON ids are positional (CON-NNN = row index N). Grab the
        // matching constraint by parsing the number.
        const idx = parseInt(highlightId.slice(4), 10) - 1;
        const con = Number.isFinite(idx) ? constraints[idx] : undefined;
        if (con) openConstraint(con, idx);
      } else if (highlightId.startsWith("CTR-")) {
        const ct = contradictions.find((c) => String(c.id).startsWith(highlightId));
        if (ct) setExpandedRow(ct.id);
      }
    } else if (initialTab === "constraints") {
      const idx = highlightId.startsWith("CON-")
        ? parseInt(highlightId.slice(4), 10) - 1
        : constraints.findIndex((c) => String(c.id).startsWith(highlightId));
      const con = idx >= 0 ? constraints[idx] : undefined;
      if (con) openConstraint(con, idx);
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
    const handleClose = () => {
      if (detailStack.length > 1) {
        popDetail();
      } else {
        setDetail(null);
        onNavigate?.(activeTab);
      }
    };
    const handleLinkClick = (href: string) => {
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
    };
    const slotTopContent = (() => {
      if (!detail.itemKey || !detail.itemKind) return undefined;
      const reqFb = detail.itemKind === "requirement" ? clientFeedback.requirements[detail.itemKey] : undefined;
      const gapFb = detail.itemKind === "gap" ? clientFeedback.gaps[detail.itemKey] : undefined;
      const hasAnything = reqFb || gapFb || detail.gapResolution;
      if (!hasAnything) return undefined;
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
    })();

    // For requirements, the ApiRequirement lookup drives the inline
    // tracked-changes view; fall back to MarkdownPanel when the record
    // can't be found in local state (shouldn't happen, but harmless).
    const reqForDetail = detail.itemKind === "requirement" && detail.itemKey
      ? requirements.find((r) => r.req_id === detail.itemKey)
      : undefined;

    if (detail.itemKind === "requirement" && reqForDetail) {
      const pendingProps = proposals.filter((p) => p.target_req_id === detail.itemKey);
      return (
        <div className="data-panel" style={{ flex: 1, width: "100%" }}>
          <RequirementDetailView
            req={reqForDetail}
            projectId={projectId}
            proposals={pendingProps}
            onClose={handleClose}
            actions={detail.actions}
            onAction={detail.onAction}
            history={detail.history}
            slotTop={slotTopContent}
            slotBottom={
              <ConnectionsSection
                projectId={projectId}
                displayId={reqForDetail.req_id}
                onNavigate={onNavigate}
              />
            }
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
            onLinkClick={handleLinkClick}
          />
        </div>
      );
    }

    return (
      <div className="data-panel" style={{ flex: 1, width: "100%" }}>
        <MarkdownPanel
          title={detail.title}
          content={detail.content}
          meta={detail.meta}
          onClose={handleClose}
          actions={detail.actions}
          onAction={detail.onAction}
          history={detail.history}
          slotTop={slotTopContent}
          slotBottom={(() => {
            // Non-requirement kinds get:
            //   1. ProposedUpdatesSection (legacy gap-driven proposals)
            //   2. ConnectionsSection (new — graph neighbourhood)
            // Both render only when there's data to show.
            const parts: React.ReactNode[] = [];
            if (detail.itemKind === "requirement" && detail.itemKey) {
              const pendingProps = proposals.filter((p) => p.target_req_id === detail.itemKey);
              if (pendingProps.length > 0) {
                parts.push(
                  <ProposedUpdatesSection
                    key="props"
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
              }
            }
            // Connections section for gap / constraint — BRs use the
            // RequirementDetailView branch above. itemKey is the display id.
            if (detail.itemKey
                && (detail.itemKind === "gap" || (detail.meta?.id && String(detail.meta.id).startsWith("CON-")))) {
              const displayId =
                detail.itemKind === "gap"
                  ? detail.itemKey
                  : String(detail.meta?.id || detail.itemKey);
              parts.push(
                <ConnectionsSection
                  key="connections"
                  projectId={projectId}
                  displayId={displayId}
                  onNavigate={onNavigate}
                />
              );
            }
            return parts.length > 0 ? <>{parts}</> : undefined;
          })()}
          onLinkClick={handleLinkClick}
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
    <div className={`data-panel${heroCollapsed ? " hero-collapsed" : ""}`} style={{ flex: 1, width: "100%" }}>
      {/* Design v2 hero — bigger ring + eyebrow + headline + stats.
          Collapsible so the PM can reclaim vertical space when reviewing
          long card lists. State persists via usePersistedState below. */}
      <div className="dp-header">
        <div className="dp-readiness" onClick={openReadinessPanel}>
          <div className="dp-rb-ring">
            <svg viewBox="0 0 72 72">
              <circle cx="36" cy="36" r="32" className="bg" />
              <circle
                cx="36" cy="36" r="32" className="fg"
                style={{
                  strokeDasharray: 2 * Math.PI * 32,
                  strokeDashoffset: 2 * Math.PI * 32 * (1 - score / 100),
                }}
              />
            </svg>
            <div className="dp-rb-val">{Math.round(score)}%</div>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="dp-rb-label">Discovery Readiness</div>
            <div className="dp-rb-sub">
              {score >= 85 ? "Ready for handoff" : score >= 65 ? "Conditionally ready" : "Not ready for handoff"}
            </div>
            <div className="dp-rb-stats">
              <span className="num">{requirements.length}</span> requirements ·{" "}
              <span className={`num${openContras.length ? " num-bad" : " num-ok"}`}>{openContras.length}</span> open contradictions ·{" "}
              <span className={`num${openGaps.length ? " num-bad" : " num-ok"}`}>{openGaps.length}</span> gaps
            </div>
          </div>
        </div>
        <button
          className="hero-collapse-btn"
          onClick={(e) => { e.stopPropagation(); setHeroCollapsed((v) => !v); }}
          title={heroCollapsed ? "Expand readiness" : "Collapse readiness"}
          aria-label="Toggle readiness details"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 15l-6-6-6 6" />
          </svg>
        </button>
        {!heroCollapsed && (
          <button className="hero-info-btn" onClick={openReadinessPanel}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 16v-4M12 8h.01" />
            </svg>
            Info
          </button>
        )}
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
              {count !== null && count > 0 && (
                <span className="tab-count">
                  {count}
                  <span className="tab-count-label">total</span>
                </span>
              )}
              {unread > 0 && (
                <span className="tab-new" title={`${unread} unread`}>
                  {unread} new
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



