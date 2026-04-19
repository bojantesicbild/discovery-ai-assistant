"use client";

// Requirements tab — priority + status filter row, search, markdown
// table, client-feedback column, and pagination. Extracted from
// DataPanel.tsx with a typed props contract so the tab owns no data
// fetching, just rendering.

import {
  FilterChip, TypeBadge, PriBadge, StatusPill,
  ReqClientBadge, SourceBadges, EmptyState,
} from "../pills";
import type {
  ApiRequirement, ReqClientFeedback, GapClientFeedback, ProposedUpdate,
} from "@/lib/api";
import type { FindingType } from "@/lib/api";
import { applyTableState, type TableState } from "@/lib/tableState";
import { TableSearch, SortableHeader, Pagination } from "../../TableControls";


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


export function RequirementsTab({
  requirements, setRequirements, reqsTable,
  priorityFilter, setPriorityFilter, statusFilter, setStatusFilter,
  unreadCount, markTabSeenAll, markRowSeen,
  openRequirement, onNavigate, clientFeedback, proposals,
}: RequirementsTabProps) {
  return (
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
        {unreadCount > 0 && (
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
            ✓ Mark all read ({unreadCount})
          </button>
        )}
      </div>
      {requirements.length === 0 ? (
        <EmptyState icon="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" text="No requirements extracted yet. Upload documents to get started." />
      ) : (() => {
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
  );
}
