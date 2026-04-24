"use client";

// Requirements tab — Design v2 card layout. Renders the same data the
// old .panel-table did but as .req cards with id/version/date in the
// left column + title + meta pills. Filter UI is v2: a single search
// input + two fd (filter-dropdown) triggers for priority / status.

import { useState, useRef, useEffect } from "react";
import {
  FilterChip, ReqClientBadge, SourceBadges, EmptyState,
} from "../pills";
import type {
  ApiRequirement, ReqClientFeedback, GapClientFeedback, ProposedUpdate,
} from "@/lib/api";
import type { FindingType } from "@/lib/api";
import { applyTableState, type TableState } from "@/lib/tableState";
import { formatAge } from "@/lib/dates";
import { Pagination } from "../../TableControls";


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
}: RequirementsTabProps) {
  const [searchQuery, setSearchQuery] = useState("");

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

  // Filter + search. Keep sort/pagination through applyTableState.
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

  return (
    <div className="dp-tab-content active">
      {/* Filters row — search + priority + status dropdowns */}
      <div className="filters" style={{ padding: "4px 0 14px" }}>
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

      {/* Card list — NEW THIS SESSION group + EARLIER group */}
      <div className="reqs-list" style={{ padding: 0 }}>
        {newThisSession.length > 0 && (
          <>
            <div className="req-group-label">
              New this session · {newThisSession.length}
            </div>
            {newThisSession.map((req) => (
              <RequirementCard
                key={`new-${req.id || req.req_id}`}
                req={req}
                isNew
                proposals={proposals}
                clientFeedback={clientFeedback}
                onClick={() => {
                  openRequirement(req);
                  onNavigate?.("reqs", req.req_id);
                  if (req.id && !req.seen_at) markRowSeen("requirement", req.id, setRequirements);
                }}
              />
            ))}
          </>
        )}
        {earlier.length > 0 && (
          <>
            {newThisSession.length > 0 && (
              <div className="req-group-label">Earlier</div>
            )}
            {earlier.map((req) => (
              <RequirementCard
                key={`e-${req.id || req.req_id}`}
                req={req}
                proposals={proposals}
                clientFeedback={clientFeedback}
                onClick={() => {
                  openRequirement(req);
                  onNavigate?.("reqs", req.req_id);
                }}
              />
            ))}
          </>
        )}
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


/* ── Requirement card ───────────────────────────────────────────────── */

function RequirementCard({
  req, isNew, proposals, clientFeedback, onClick,
}: {
  req: ApiRequirement;
  isNew?: boolean;
  proposals: ProposedUpdate[];
  clientFeedback: { requirements: Record<string, ReqClientFeedback>; gaps: Record<string, GapClientFeedback> };
  onClick: () => void;
}) {
  const pendingCount = proposals.filter((p) => p.target_req_id === req.req_id).length;
  const fb = clientFeedback.requirements[req.req_id];
  const pri = (req.priority || "could").toLowerCase();
  const status = (req.status || "proposed").toLowerCase();
  const typeLabel = (req.type || "").replace("_", " ");
  const dateLabel = req.created_at ? formatAge(req.created_at) : "";

  return (
    <div
      className={`req${isNew ? " new" : ""}`}
      onClick={onClick}
      title={req.title}
    >
      <div className="req-id">
        <span className="id">{req.req_id}</span>
        <span className="v">v{req.version || 1}</span>
        {dateLabel && (
          <span
            className="d"
            title={req.created_at ? new Date(req.created_at).toLocaleString() : ""}
          >
            {dateLabel}
          </span>
        )}
      </div>

      <div className="req-body">
        <div className="req-title">{req.title}</div>
        <div className="req-meta">
          {req.priority && (
            <span className={`pri ${pri}`}>{req.priority}</span>
          )}
          {req.type && (
            <span className="type">{typeLabel}</span>
          )}
          <span className={`status ${status}`}>
            <span className="dot" />
            {req.status}
          </span>
          {req.source_doc && (
            <span className="source-tag" title={req.source_doc}>
              {req.source_doc}
            </span>
          )}
          {fb && <ReqClientBadge fb={fb} />}
        </div>
      </div>

      <div className="req-action">
        {pendingCount > 0 && (
          <span
            className="req-warn"
            title={`${pendingCount} pending proposed update${pendingCount !== 1 ? "s" : ""}`}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            {pendingCount}
          </span>
        )}
        <button
          className="kebab"
          onClick={(e) => { e.stopPropagation(); onClick(); }}
          title="Open details"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="5" r="1" />
            <circle cx="12" cy="12" r="1" />
            <circle cx="12" cy="19" r="1" />
          </svg>
        </button>
      </div>
    </div>
  );
}


/* ── Filter dropdown ────────────────────────────────────────────────── */

function FilterDropdown({
  label, value, options, onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const isActive = value && value !== "all";
  const activeOpt = options.find((o) => o.value === value);

  return (
    <div className={`fd${open ? " open" : ""}`} ref={ref}>
      <button
        type="button"
        className={`fd-trigger${isActive ? " has-value" : ""}`}
        data-v={isActive ? value : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="fd-value-dot" />
        <span className="fd-label">
          {isActive ? activeOpt?.label : label}
        </span>
        <svg className="fd-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M6 9l6 6 6-6" />
        </svg>
        {isActive && (
          <span
            className="fd-clear"
            onClick={(e) => { e.stopPropagation(); onChange("all"); setOpen(false); }}
            title="Clear filter"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
              <path d="M6 6l12 12M6 18L18 6" />
            </svg>
          </span>
        )}
      </button>
      {open && (
        <div className="fd-menu">
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`fd-opt${opt.value === value ? " active" : ""}`}
              data-value={opt.value === "all" ? undefined : opt.value}
              onClick={() => { onChange(opt.value); setOpen(false); }}
            >
              <span className="opt-dot" />
              {opt.label}
              <svg className="opt-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
