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
import type { FindingType } from "@/lib/api";
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
  openContradiction: (c: ApiContradiction, index: number) => void;
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
  openGap, openConstraint, openContradiction, clientFeedback,
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
      <div className="dp-subtabs">
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
          contradictions={contradictions}
          setContradictions={setContradictions}
          contraTable={contraTable}
          contraFilter={contraFilter}
          setContraFilter={setContraFilter}
          unread={unreadCounts.contradiction}
          markTabSeenAll={markTabSeenAll}
          markRowSeen={markRowSeen}
          openContradiction={openContradiction}
          onNavigate={onNavigate}
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
  contradictions, setContradictions, contraTable,
  contraFilter, setContraFilter,
  unread, markTabSeenAll, markRowSeen,
  openContradiction, onNavigate,
  onScrollCollapse,
}: {
  contradictions: ApiContradiction[];
  setContradictions: React.Dispatch<React.SetStateAction<ApiContradiction[]>>;
  contraTable: TableState;
  contraFilter: string;
  setContraFilter: (v: string) => void;
  unread: number;
  markTabSeenAll: (t: FindingType, s?: SetterFn) => Promise<void>;
  markRowSeen: (t: FindingType, id: string, s?: SetterFn) => Promise<void>;
  openContradiction: (c: ApiContradiction, index: number) => void;
  onNavigate?: (tab: string, itemId?: string) => void;
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
    // Positional CTR-NNN — matches the backend's _display_for /
    // resolve_display_id ordering (created_at, id) so chat references
    // and connection-graph navigation land on the same row.
    const absoluteIndex = contradictions.findIndex((x) => x.id === c.id);
    const ctrId = `CTR-${String(absoluteIndex + 1).padStart(3, "0")}`;
    const date = formatCardDate(c.created_at);
    const onCardClick = () => {
      openContradiction(c, absoluteIndex);
      onNavigate?.("contradictions", ctrId);
      if (c.id && !c.seen_at) markRowSeen("contradiction", c.id, setContradictions as SetterFn);
    };
    const area = c.area || (c.item_a_type && c.item_a_type !== "unknown" ? c.item_a_type : "");
    return (
      <FindingCard
        key={c.id}
        id={ctrId}
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
        actions={<CardKebab onClick={(e) => { e.stopPropagation(); onCardClick(); }} />}
      />
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
