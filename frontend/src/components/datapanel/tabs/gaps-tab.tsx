"use client";

// Gaps tab — Design v2 card layout. Mirrors RequirementsTab's
// FindingCard pattern across three sub-sections (Gaps | Constraints |
// Conflicts) so the discovery panel reads consistently. Each
// sub-section keeps its own data + filter state but shares the same
// shell: filter row up top, scroll area in the middle with grouped
// New / Earlier cards, pagination footer pinned at the bottom.
//
// Conflicts have one extra mechanic: clicking a card toggles an
// inline "Resolve" panel beneath it (side-A / side-B quotes + AI rec
// + resolve form). That logic was preserved from the previous table
// version; only the row chrome changed.

import { useState } from "react";
import {
  SevBadge, GapStatusPill, GapClientBadge, EmptyState,
} from "../pills";
import { applyTableState, type TableState } from "@/lib/tableState";
import { resolveContradiction, type FindingType } from "@/lib/api";
import type {
  ApiGap, ApiConstraint, ApiContradiction,
  ReqClientFeedback, GapClientFeedback,
} from "@/lib/api";
import { Pagination } from "../../TableControls";
import { FilterDropdown } from "../filter-dropdown";
import { FindingCard, CardKebab, formatCardDate, useScrollCollapse } from "../finding-card";


// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SetterFn = (updater: (prev: any[]) => any[]) => void;


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
  markTabSeenAll: (findingType: FindingType, setter?: SetterFn) => Promise<void>;
  markRowSeen: (findingType: FindingType, findingId: string, setter?: SetterFn) => Promise<void>;
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
  onScrollCollapse?: (collapsed: boolean) => void;
}


const GAP_STATUS_OPTIONS = [
  { value: "all",       label: "All statuses" },
  { value: "open",      label: "Open" },
  { value: "resolved",  label: "Resolved" },
  { value: "dismissed", label: "Dismissed" },
];

const CONFLICT_STATUS_OPTIONS = [
  { value: "all",      label: "All statuses" },
  { value: "open",     label: "Open" },
  { value: "resolved", label: "Resolved" },
];


export function GapsTab({
  projectId, gaps, setGaps, constraints, setConstraints, contradictions, setContradictions,
  gapsTable, consTable, contraTable,
  gapSection, setGapSection, gapStatusFilter, setGapStatusFilter,
  contraFilter, setContraFilter,
  unreadCounts, markTabSeenAll, markRowSeen,
  openGap, openConstraint, clientFeedback,
  expandedRow, setExpandedRow, onNavigate, loadData,
  onScrollCollapse,
}: GapsTabProps) {
  // Reset the readiness-hero collapse state when the user switches
  // sub-tabs — each sub-section owns its own scroll surface, so a
  // fresh switch should always start at the top.
  function switchSection(s: "gaps" | "constraints" | "conflicts") {
    onScrollCollapse?.(false);
    setGapSection(s);
  }

  return (
    <div className="dp-tab-content active">
      {/* Sub-tabs: Gaps | Constraints | Conflicts */}
      <div className="dp-subtabs" style={{ padding: "12px 32px 0" }}>
        {([
          { id: "gaps" as const,        label: "Gaps",        count: gaps.length },
          { id: "constraints" as const, label: "Constraints", count: constraints.length },
          { id: "conflicts" as const,   label: "Conflicts",   count: contradictions.length },
        ]).map((sec) => (
          <button
            key={sec.id}
            type="button"
            className={`dp-subtab${gapSection === sec.id ? " active" : ""}`}
            onClick={() => switchSection(sec.id)}
          >
            {sec.label}
            {sec.count > 0 && <span className="count-pill">{sec.count}</span>}
          </button>
        ))}
      </div>

      {gapSection === "gaps" && (
        <GapsSection
          gaps={gaps}
          setGaps={setGaps}
          gapsTable={gapsTable}
          gapStatusFilter={gapStatusFilter}
          setGapStatusFilter={setGapStatusFilter}
          unread={unreadCounts.gap}
          markTabSeenAll={markTabSeenAll}
          markRowSeen={markRowSeen}
          openGap={openGap}
          clientFeedback={clientFeedback}
          onNavigate={onNavigate}
          onScrollCollapse={onScrollCollapse}
        />
      )}

      {gapSection === "constraints" && (
        <ConstraintsSection
          constraints={constraints}
          setConstraints={setConstraints}
          consTable={consTable}
          unread={unreadCounts.constraint}
          markTabSeenAll={markTabSeenAll}
          markRowSeen={markRowSeen}
          openConstraint={openConstraint}
          onNavigate={onNavigate}
          onScrollCollapse={onScrollCollapse}
        />
      )}

      {gapSection === "conflicts" && (
        <ConflictsSection
          projectId={projectId}
          contradictions={contradictions}
          setContradictions={setContradictions}
          contraTable={contraTable}
          contraFilter={contraFilter}
          setContraFilter={setContraFilter}
          unread={unreadCounts.contradiction}
          markTabSeenAll={markTabSeenAll}
          markRowSeen={markRowSeen}
          expandedRow={expandedRow}
          setExpandedRow={setExpandedRow}
          onNavigate={onNavigate}
          loadData={loadData}
          onScrollCollapse={onScrollCollapse}
        />
      )}
    </div>
  );
}


/* ── Gaps sub-section ─────────────────────────────────────────────── */

function GapsSection({
  gaps, setGaps, gapsTable,
  gapStatusFilter, setGapStatusFilter,
  unread, markTabSeenAll, markRowSeen,
  openGap, clientFeedback, onNavigate, onScrollCollapse,
}: {
  gaps: ApiGap[];
  setGaps: React.Dispatch<React.SetStateAction<ApiGap[]>>;
  gapsTable: TableState;
  gapStatusFilter: string;
  setGapStatusFilter: (v: string) => void;
  unread: number;
  markTabSeenAll: (t: FindingType, s?: SetterFn) => Promise<void>;
  markRowSeen: (t: FindingType, id: string, s?: SetterFn) => Promise<void>;
  openGap: (g: ApiGap) => void;
  clientFeedback: { requirements: Record<string, ReqClientFeedback>; gaps: Record<string, GapClientFeedback> };
  onNavigate?: (tab: string, itemId?: string) => void;
  onScrollCollapse?: (collapsed: boolean) => void;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const scrollRef = useScrollCollapse(onScrollCollapse);

  if (gaps.length === 0) {
    return (
      <EmptyState
        icon="M12 9v2m0 4h.01"
        text="No gaps detected. Run gap analysis from the chat to identify missing requirements."
      />
    );
  }

  const q = searchQuery.trim().toLowerCase();
  const filtered = gaps.filter((g) => {
    if (gapStatusFilter !== "all" && g.status !== gapStatusFilter) return false;
    if (q) {
      const blob = `${g.gap_id} ${g.question} ${g.area || ""} ${g.source_person || ""}`.toLowerCase();
      if (!blob.includes(q)) return false;
    }
    return true;
  });
  const { visible, filteredCount, totalPages, pageStart, pageEnd } = applyTableState(
    filtered, gapsTable,
    ["gap_id", "question", "area", "severity", "status", "source_person"],
    (item, key) => {
      if (key === "severity") {
        const order: Record<string, number> = { high: 0, medium: 1, low: 2 };
        return order[(item as ApiGap).severity] ?? 99;
      }
      return (item as unknown as Record<string, unknown>)[key];
    },
  );

  const newCards = visible.filter((g) => !g.seen_at);
  const earlierCards = visible.filter((g) => g.seen_at);

  function renderCard(g: ApiGap, isNew: boolean) {
    const date = formatCardDate(g.created_at);
    const fb = clientFeedback.gaps[g.gap_id];
    const onCardClick = () => {
      onNavigate?.("gaps", g.gap_id);
      if (g.id && !g.seen_at) markRowSeen("gap", g.id, setGaps as SetterFn);
      openGap(g);
    };
    return (
      <FindingCard
        key={`${isNew ? "new" : "e"}-${g.id || g.gap_id}`}
        id={g.gap_id}
        timeLabel={date.time}
        dateLabel={date.date}
        dateTooltip={date.tooltip}
        title={g.question}
        isNew={isNew}
        onClick={onCardClick}
        meta={
          <>
            <SevBadge severity={g.severity} />
            <GapStatusPill status={g.status} />
            {g.area && <span className="type">{g.area}</span>}
            {g.source_doc && (
              <span className="source-tag" title={g.source_doc}>{g.source_doc}</span>
            )}
            {fb && <GapClientBadge fb={fb} />}
          </>
        }
        actions={<CardKebab onClick={(e) => { e.stopPropagation(); onCardClick(); }} />}
      />
    );
  }

  return (
    <>
      <FiltersRow
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder="Filter gaps…"
        filters={
          <FilterDropdown
            label="Status"
            value={gapStatusFilter}
            options={GAP_STATUS_OPTIONS}
            onChange={setGapStatusFilter}
          />
        }
        unread={unread}
        unreadLabel={`Mark all read (${unread})`}
        onMarkAllRead={() => markTabSeenAll("gap", setGaps as SetterFn)}
      />
      <div className="reqs-scroll" ref={scrollRef}>
        <div className="reqs-list" style={{ padding: "8px 0 16px" }}>
          {newCards.length > 0 && (
            <>
              <div className="req-group-label">New this session · {newCards.length}</div>
              {newCards.map((g) => renderCard(g, true))}
            </>
          )}
          {earlierCards.length > 0 && (
            <>
              {newCards.length > 0 && <div className="req-group-label">Earlier</div>}
              {earlierCards.map((g) => renderCard(g, false))}
            </>
          )}
        </div>
      </div>
      <Pagination state={gapsTable} total={filteredCount} pageStart={pageStart} pageEnd={pageEnd} totalPages={totalPages} />
    </>
  );
}


/* ── Constraints sub-section ──────────────────────────────────────── */

function ConstraintsSection({
  constraints, setConstraints, consTable,
  unread, markTabSeenAll, markRowSeen,
  openConstraint, onNavigate, onScrollCollapse,
}: {
  constraints: ApiConstraint[];
  setConstraints: React.Dispatch<React.SetStateAction<ApiConstraint[]>>;
  consTable: TableState;
  unread: number;
  markTabSeenAll: (t: FindingType, s?: SetterFn) => Promise<void>;
  markRowSeen: (t: FindingType, id: string, s?: SetterFn) => Promise<void>;
  openConstraint: (c: ApiConstraint, index: number) => void;
  onNavigate?: (tab: string, itemId?: string) => void;
  onScrollCollapse?: (collapsed: boolean) => void;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const scrollRef = useScrollCollapse(onScrollCollapse);

  if (constraints.length === 0) {
    return (
      <EmptyState
        icon="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4"
        text="No constraints extracted yet."
      />
    );
  }

  const q = searchQuery.trim().toLowerCase();
  const filtered = constraints.filter((c) => {
    if (!q) return true;
    const blob = `${c.type || ""} ${c.description || ""} ${c.impact || ""} ${c.status || ""}`.toLowerCase();
    return blob.includes(q);
  });
  const { visible, filteredCount, totalPages, pageStart, pageEnd } = applyTableState(
    filtered, consTable, ["type", "description", "impact", "status"],
  );

  const newCards = visible.filter((c) => !c.seen_at);
  const earlierCards = visible.filter((c) => c.seen_at);

  function renderCard(c: ApiConstraint, isNew: boolean) {
    const absoluteIndex = constraints.findIndex((x) => x.id === c.id);
    const conId = `CON-${String(absoluteIndex + 1).padStart(3, "0")}`;
    const date = formatCardDate(c.created_at);
    const desc = c.description || "(no description)";
    const onCardClick = () => {
      openConstraint(c, absoluteIndex);
      onNavigate?.("constraints", conId);
      if (c.id && !c.seen_at) markRowSeen("constraint", c.id, setConstraints as SetterFn);
    };
    return (
      <FindingCard
        key={`${isNew ? "new" : "e"}-${c.id || conId}`}
        id={conId}
        timeLabel={date.time}
        dateLabel={date.date}
        dateTooltip={date.tooltip}
        title={desc}
        isNew={isNew}
        onClick={onCardClick}
        meta={
          <>
            {c.type && <span className="type">{c.type}</span>}
            <GapStatusPill status={c.status || "assumed"} />
            {c.impact && (
              <span className="source-tag" title={c.impact}>
                {c.impact.length > 60 ? c.impact.slice(0, 60) + "…" : c.impact}
              </span>
            )}
          </>
        }
        actions={<CardKebab onClick={(e) => { e.stopPropagation(); onCardClick(); }} />}
      />
    );
  }

  return (
    <>
      <FiltersRow
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder="Filter constraints…"
        unread={unread}
        unreadLabel={`Mark all read (${unread})`}
        onMarkAllRead={() => markTabSeenAll("constraint", setConstraints as SetterFn)}
      />
      <div className="reqs-scroll" ref={scrollRef}>
        <div className="reqs-list" style={{ padding: "8px 0 16px" }}>
          {newCards.length > 0 && (
            <>
              <div className="req-group-label">New this session · {newCards.length}</div>
              {newCards.map((c) => renderCard(c, true))}
            </>
          )}
          {earlierCards.length > 0 && (
            <>
              {newCards.length > 0 && <div className="req-group-label">Earlier</div>}
              {earlierCards.map((c) => renderCard(c, false))}
            </>
          )}
        </div>
      </div>
      <Pagination state={consTable} total={filteredCount} pageStart={pageStart} pageEnd={pageEnd} totalPages={totalPages} />
    </>
  );
}


/* ── Conflicts sub-section ────────────────────────────────────────── */

function ConflictsSection({
  projectId, contradictions, setContradictions, contraTable,
  contraFilter, setContraFilter,
  unread, markTabSeenAll, markRowSeen,
  expandedRow, setExpandedRow, onNavigate, loadData,
  onScrollCollapse,
}: {
  projectId: string;
  contradictions: ApiContradiction[];
  setContradictions: React.Dispatch<React.SetStateAction<ApiContradiction[]>>;
  contraTable: TableState;
  contraFilter: string;
  setContraFilter: (v: string) => void;
  unread: number;
  markTabSeenAll: (t: FindingType, s?: SetterFn) => Promise<void>;
  markRowSeen: (t: FindingType, id: string, s?: SetterFn) => Promise<void>;
  expandedRow: string | null;
  setExpandedRow: (id: string | null) => void;
  onNavigate?: (tab: string, itemId?: string) => void;
  loadData: () => void;
  onScrollCollapse?: (collapsed: boolean) => void;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const scrollRef = useScrollCollapse(onScrollCollapse);

  if (contradictions.length === 0) {
    return (
      <EmptyState
        icon="M13 10V3L4 14h7v7l9-11h-7z"
        text="No contradictions detected between sources."
      />
    );
  }

  const q = searchQuery.trim().toLowerCase();
  const filtered = contradictions.filter((c) => {
    if (contraFilter === "open" && c.resolved) return false;
    if (contraFilter === "resolved" && !c.resolved) return false;
    if (q) {
      const blob = `${c.title || ""} ${c.item_a_ref || ""} ${c.item_b_ref || ""} ${c.explanation || ""} ${c.area || ""}`.toLowerCase();
      if (!blob.includes(q)) return false;
    }
    return true;
  });
  const { visible, filteredCount, totalPages, pageStart, pageEnd } = applyTableState(
    filtered, contraTable, ["item_a_type", "item_a_ref", "item_b_ref", "explanation"],
  );

  const newCards = visible.filter((c) => !c.seen_at);
  const earlierCards = visible.filter((c) => c.seen_at);

  function renderCard(c: ApiContradiction, isNew: boolean) {
    const date = formatCardDate(c.created_at);
    const conflictId = String(c.id).slice(0, 8);
    const isOpen = expandedRow === c.id;
    const onCardClick = () => {
      const next = isOpen ? null : c.id;
      setExpandedRow(next);
      onNavigate?.("contradictions", next ? conflictId : undefined);
      if (c.id && !c.seen_at) markRowSeen("contradiction", c.id, setContradictions as SetterFn);
    };
    const area = c.area || (c.item_a_type && c.item_a_type !== "unknown" ? c.item_a_type : "");
    return (
      <div key={c.id}>
        <FindingCard
          id={`CTR-${conflictId}`}
          timeLabel={date.time}
          dateLabel={date.date}
          dateTooltip={date.tooltip}
          title={_contraTitle(c)}
          isNew={isNew}
          onClick={onCardClick}
          meta={
            <>
              <SevBadge severity="high" />
              <GapStatusPill status={c.resolved ? "resolved" : "open"} />
              {area && <span className="type">{area}</span>}
              <span className="source-tag" title={_contraSubtitle(c)}>
                {_contraSubtitle(c).slice(0, 60)}{_contraSubtitle(c).length > 60 ? "…" : ""}
              </span>
            </>
          }
          actions={<CardKebab onClick={(e) => { e.stopPropagation(); onCardClick(); }} title={isOpen ? "Collapse" : "Expand"} />}
        />
        {isOpen && (
          <ContradictionDetail
            contradiction={c}
            projectId={projectId}
            onResolved={() => { setExpandedRow(null); loadData(); }}
          />
        )}
      </div>
    );
  }

  return (
    <>
      <FiltersRow
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder="Filter conflicts…"
        filters={
          <FilterDropdown
            label="Status"
            value={contraFilter}
            options={CONFLICT_STATUS_OPTIONS}
            onChange={setContraFilter}
          />
        }
        unread={unread}
        unreadLabel={`Mark all read (${unread})`}
        onMarkAllRead={() => markTabSeenAll("contradiction", setContradictions as SetterFn)}
      />
      <div className="reqs-scroll" ref={scrollRef}>
        <div className="reqs-list" style={{ padding: "8px 0 16px" }}>
          {newCards.length > 0 && (
            <>
              <div className="req-group-label">New this session · {newCards.length}</div>
              {newCards.map((c) => renderCard(c, true))}
            </>
          )}
          {earlierCards.length > 0 && (
            <>
              {newCards.length > 0 && <div className="req-group-label">Earlier</div>}
              {earlierCards.map((c) => renderCard(c, false))}
            </>
          )}
        </div>
      </div>
      <Pagination state={contraTable} total={filteredCount} pageStart={pageStart} pageEnd={pageEnd} totalPages={totalPages} />
    </>
  );
}


/* ── Contradiction expanded detail (preserved from previous version) ── */

function ContradictionDetail({
  contradiction: c, projectId, onResolved,
}: {
  contradiction: ApiContradiction;
  projectId: string;
  onResolved: () => void;
}) {
  const sideAText = c.side_a
    || (c.item_a_ref && !c.item_a_ref.startsWith("New ") ? c.item_a_ref : null);
  const sideBText = c.side_b
    || (c.item_b_ref && !c.item_b_ref.startsWith("New ") ? c.item_b_ref : null)
    || (c.explanation ? _extractConflictDetail(c.explanation) : null);

  return (
    <div className="finding-detail" style={{ margin: "0 0 12px 124px" }}>
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
              {c.item_b_source && <span className="gap-meta-chip" style={{ background: "var(--must-soft)", color: "var(--must)" }}>{c.item_b_source}</span>}
              {c.item_b_person && <span className="person-chip">{c.item_b_person}</span>}
            </div>
            <div className="cd-quote-text">{sideBText}</div>
          </div>
        )}
      </div>
      {!c.side_a && !c.side_b && !c.item_a_ref && !c.item_b_ref && c.explanation && (
        <div className="cd-explanation">{c.explanation}</div>
      )}
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
            onResolved();
          }}
        />
      )}
    </div>
  );
}


/* ── Shared filters row (used by all three sub-sections) ──────────── */

function FiltersRow({
  searchValue, onSearchChange, searchPlaceholder,
  filters, unread, unreadLabel, onMarkAllRead,
}: {
  searchValue: string;
  onSearchChange: (v: string) => void;
  searchPlaceholder: string;
  filters?: React.ReactNode;
  unread: number;
  unreadLabel: string;
  onMarkAllRead: () => void;
}) {
  return (
    <div className="filters" style={{ padding: "12px 32px 12px" }}>
      <div className="filter-search">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-3.5-3.5" />
        </svg>
        <input
          value={searchValue}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={searchPlaceholder}
        />
      </div>
      {filters}
      {unread > 0 && (
        <button
          type="button"
          onClick={onMarkAllRead}
          title={unreadLabel}
          className="panel-filter-btn active"
          style={{ marginLeft: "auto" }}
        >
          ✓ {unreadLabel}
        </button>
      )}
    </div>
  );
}


/* ── Helpers ──────────────────────────────────────────────────────── */

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


function _contraTitle(c: ApiContradiction): string {
  if (c.title) return c.title.slice(0, 80);
  if (c.item_a_ref && !c.item_a_ref.startsWith("New ")) return c.item_a_ref.slice(0, 80);
  const expl = (c.explanation || "").trim();
  if (!expl) return "Contradiction";
  const colon = expl.indexOf(":");
  if (colon > 0 && colon < 80) return expl.slice(0, colon).trim();
  return expl.slice(0, 80);
}

function _contraSubtitle(c: ApiContradiction): string {
  if (c.side_a && c.side_b) return `${c.side_a}  ↔  ${c.side_b}`;
  if (c.side_b) return c.side_b;
  if (c.side_a) return c.side_a;
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
        <button type="button" className="cd-action-btn primary" disabled={!note.trim()} onClick={() => onResolve(note)}>Resolve</button>
        <button type="button" className="cd-action-btn info">Add to Meeting</button>
      </div>
    </div>
  );
}
