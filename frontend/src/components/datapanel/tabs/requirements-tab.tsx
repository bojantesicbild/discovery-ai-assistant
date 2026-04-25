"use client";

// Requirements tab — Design v2 card layout. Renders the same data the
// old .panel-table did but as .req cards via the shared FindingCard
// shell. Filter UI is a single search input + two FilterDropdown
// triggers for priority / status. Both pieces live in the parent
// datapanel/ directory so gaps-tab and other future tabs share them.

import { useState } from "react";
import { ReqClientBadge, EmptyState } from "../pills";
import type {
  ApiRequirement, ReqClientFeedback, GapClientFeedback, ProposedUpdate,
  FindingType,
} from "@/lib/api";
import { applyTableState, type TableState } from "@/lib/tableState";
import { Pagination } from "../../TableControls";
import { FilterDropdown } from "../filter-dropdown";
import {
  FindingCard, CardKebab, CardWarnBadge,
  formatCardDate, useScrollCollapse,
} from "../finding-card";


interface RequirementsTabProps {
  requirements: ApiRequirement[];
  setRequirements: React.Dispatch<React.SetStateAction<ApiRequirement[]>>;
  reqsTable: TableState;
  priorityFilter: string;
  setPriorityFilter: (v: string) => void;
  statusFilter: string;
  setStatusFilter: (v: string) => void;
  unreadCount: number;
  markTabSeenAll: (findingType: FindingType, setter?: (updater: (prev: any[]) => any[]) => void) => Promise<void>;
  markRowSeen: (findingType: FindingType, findingId: string, setter?: (updater: (prev: any[]) => any[]) => void) => Promise<void>;
  openRequirement: (req: ApiRequirement) => void;
  onNavigate?: (tab: string, itemId?: string) => void;
  clientFeedback: {
    requirements: Record<string, ReqClientFeedback>;
    gaps: Record<string, GapClientFeedback>;
  };
  proposals: ProposedUpdate[];
  onScrollCollapse?: (collapsed: boolean) => void;
}


const PRIORITY_OPTIONS = [
  { value: "all", label: "All priorities" },
  { value: "must", label: "Must" },
  { value: "should", label: "Should" },
  { value: "could", label: "Could" },
];

const STATUS_OPTIONS = [
  { value: "all", label: "All statuses" },
  { value: "confirmed", label: "Confirmed" },
  { value: "discussed", label: "Discussed" },
  { value: "proposed", label: "Proposed" },
];


export function RequirementsTab({
  requirements, setRequirements, reqsTable,
  priorityFilter, setPriorityFilter, statusFilter, setStatusFilter,
  unreadCount, markTabSeenAll, markRowSeen,
  openRequirement, onNavigate, clientFeedback, proposals,
  onScrollCollapse,
}: RequirementsTabProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const scrollRef = useScrollCollapse(onScrollCollapse);

  if (requirements.length === 0) {
    return (
      <div className="dp-tab-content active">
        <EmptyState
          icon="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"
          text="No requirements extracted yet. Upload documents to get started."
        />
      </div>
    );
  }

  const q = searchQuery.trim().toLowerCase();
  const filtered = requirements.filter((r) => {
    if (priorityFilter !== "all" && r.priority !== priorityFilter) return false;
    if (statusFilter !== "all" && r.status !== statusFilter) return false;
    if (q) {
      const blob = `${r.req_id} ${r.title} ${r.source_person || ""} ${r.source_doc || ""}`.toLowerCase();
      if (!blob.includes(q)) return false;
    }
    return true;
  });
  const { visible, filteredCount, totalPages, pageStart, pageEnd } = applyTableState(
    filtered, reqsTable,
    ["req_id", "title", "type", "priority", "status", "source_person"],
  );

  // Group new vs earlier (new = not-yet-seen)
  const newThisSession = visible.filter((r) => !r.seen_at);
  const earlier = visible.filter((r) => r.seen_at);

  function renderCard(req: ApiRequirement, isNew: boolean) {
    const pendingCount = proposals.filter((p) => p.target_req_id === req.req_id).length;
    const fb = clientFeedback.requirements[req.req_id];
    const pri = (req.priority || "could").toLowerCase();
    const status = (req.status || "proposed").toLowerCase();
    const typeLabel = (req.type || "").replace("_", " ");
    const date = formatCardDate(req.created_at);

    const onCardClick = () => {
      openRequirement(req);
      onNavigate?.("reqs", req.req_id);
      if (req.id && !req.seen_at) markRowSeen("requirement", req.id, setRequirements);
    };

    return (
      <FindingCard
        key={`${isNew ? "new" : "e"}-${req.id || req.req_id}`}
        id={req.req_id}
        idTag={<span className="v">v{req.version || 1}</span>}
        timeLabel={date.time}
        dateLabel={date.date}
        dateTooltip={date.tooltip}
        title={req.title}
        isNew={isNew}
        onClick={onCardClick}
        meta={
          <>
            {req.priority && <span className={`pri ${pri}`}>{req.priority}</span>}
            {req.type && <span className="type">{typeLabel}</span>}
            <span className={`status ${status}`}>
              <span className="dot" />
              {req.status}
            </span>
            {req.source_doc && (
              <span className="source-tag" title={req.source_doc}>{req.source_doc}</span>
            )}
            {fb && <ReqClientBadge fb={fb} />}
          </>
        }
        actions={
          <>
            {pendingCount > 0 && (
              <CardWarnBadge
                count={pendingCount}
                title={`${pendingCount} pending proposed update${pendingCount !== 1 ? "s" : ""}`}
              />
            )}
            <CardKebab onClick={(e) => { e.stopPropagation(); onCardClick(); }} />
          </>
        }
      />
    );
  }

  return (
    <div className="dp-tab-content active">
      {/* Filters row — pinned at the top via flex flex-shrink: 0 */}
      <div className="filters" style={{ padding: "12px 32px 12px" }}>
        <div className="filter-search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" />
          </svg>
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter requirements…"
          />
        </div>
        <FilterDropdown
          label="Priority"
          value={priorityFilter}
          options={PRIORITY_OPTIONS}
          onChange={setPriorityFilter}
        />
        <FilterDropdown
          label="Status"
          value={statusFilter}
          options={STATUS_OPTIONS}
          onChange={setStatusFilter}
        />
        {unreadCount > 0 && (
          <button
            onClick={() => markTabSeenAll("requirement", setRequirements)}
            title="Mark all requirements as read"
            className="panel-filter-btn active"
            style={{ marginLeft: "auto" }}
          >
            ✓ Mark all read ({unreadCount})
          </button>
        )}
      </div>

      <div className="reqs-scroll" ref={scrollRef}>
        <div className="reqs-list" style={{ padding: "8px 0 16px" }}>
          {newThisSession.length > 0 && (
            <>
              <div className="req-group-label">
                New this session · {newThisSession.length}
              </div>
              {newThisSession.map((req) => renderCard(req, true))}
            </>
          )}
          {earlier.length > 0 && (
            <>
              {newThisSession.length > 0 && (
                <div className="req-group-label">Earlier</div>
              )}
              {earlier.map((req) => renderCard(req, false))}
            </>
          )}
        </div>
      </div>

      <Pagination
        state={reqsTable}
        total={filteredCount}
        pageStart={pageStart}
        pageEnd={pageEnd}
        totalPages={totalPages}
      />
    </div>
  );
}
