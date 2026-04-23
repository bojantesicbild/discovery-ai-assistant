"use client";

// Collapsible card rendered below a BR detail body. Shows every pending
// agent-proposed patch for that requirement — extraction-driven or
// client-review — with a side-by-side diff and accept/reject controls.
// Reject opens a modal asking for an optional "why?" so the agent can
// avoid re-proposing the same pattern next run.

import { useState } from "react";
import type { ProposedUpdate, ProposedField } from "@/lib/api";


const FIELD_LABELS: Record<ProposedField, string> = {
  description: "Description",
  user_perspective: "User Perspective",
  rationale: "Rationale",
  scope_note: "Scope Note",
  title: "Title",
  source_person: "Source Person",
  acceptance_criteria: "Acceptance Criteria",
  business_rules: "Business Rules",
  edge_cases: "Edge Cases",
  alternatives_considered: "Alternatives Considered",
  blocked_by: "Blocked By",
};

const LIST_FIELDS: ProposedField[] = [
  "acceptance_criteria",
  "business_rules",
  "edge_cases",
  "alternatives_considered",
  "blocked_by",
];


function humaniseField(f: ProposedField): string {
  return FIELD_LABELS[f] || f.replace(/_/g, " ");
}


function toList(v: string | string[] | null | undefined): string[] {
  if (v == null) return [];
  if (Array.isArray(v)) return v.filter((s) => typeof s === "string" && s.length > 0);
  return [String(v)];
}


function StatusPill({ p }: { p: ProposedUpdate }) {
  if (p.status === "accepted") {
    return (
      <span style={{
        fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 10,
        background: "var(--green-light)", color: "#059669",
        border: "1px solid #a7f3d0", letterSpacing: 0.3,
      }}>Accepted</span>
    );
  }
  if (p.status === "rejected") {
    return (
      <span
        title={p.rejection_reason || undefined}
        style={{
          fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 10,
          background: "#fee2e2", color: "#b91c1c",
          border: "1px solid #fecaca", letterSpacing: 0.3,
        }}
      >
        Rejected{p.rejection_reason ? ` — ${p.rejection_reason}` : ""}
      </span>
    );
  }
  return null;
}


function DiffView({ p }: { p: ProposedUpdate }) {
  const isList = LIST_FIELDS.includes(p.proposed_field);
  const currentList = toList(p.current_value);
  const proposedList = toList(p.proposed_value);

  const currentEmpty = currentList.length === 0;

  // Stack vertically — side-by-side columns get unreadably narrow
  // inside the detail panel, especially when list entries have no
  // whitespace short enough for flexbox to break on. When current is
  // empty, skip the Current block entirely and let the proposed block
  // render at full width with a neutral "New value" label.
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 6 }}>
      {!currentEmpty && (
        <div>
          <div style={{
            fontSize: 10, color: "var(--gray-500)", marginBottom: 4,
            fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5,
          }}>Current</div>
          {isList ? (
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: "var(--gray-600)", fontStyle: "italic", lineHeight: 1.5 }}>
              {currentList.map((v, i) => <li key={i}>{v}</li>)}
            </ul>
          ) : (
            <div style={{ fontSize: 12, color: "var(--gray-600)", fontStyle: "italic", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
              {currentList[0]}
            </div>
          )}
        </div>
      )}
      <div>
        <div style={{
          fontSize: 10, color: "#059669", marginBottom: 4,
          fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5,
        }}>
          {currentEmpty ? "New value" : isList ? "+ Adding" : "Replacing with"}
        </div>
        {isList ? (
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: "#047857", fontWeight: 500, lineHeight: 1.5 }}>
            {proposedList.map((v, i) => <li key={i}>{v}</li>)}
          </ul>
        ) : (
          <div style={{
            fontSize: 12, color: "#047857", fontWeight: 500,
            whiteSpace: "pre-wrap", background: "var(--green-light)",
            padding: "8px 12px", borderRadius: 6,
            border: "1px solid var(--green-mid)", lineHeight: 1.5,
          }}>
            {proposedList[0] || "—"}
          </div>
        )}
      </div>
    </div>
  );
}


function SourceChips({ p }: { p: ProposedUpdate }) {
  const chips: { label: string; title?: string; color: string; bg: string; border: string }[] = [];
  if (p.source_doc) {
    chips.push({
      label: p.source_doc, title: `Source document${p.source_doc_id ? ` (${p.source_doc_id})` : ""}`,
      color: "#1d4ed8", bg: "#eff6ff", border: "#bfdbfe",
    });
  }
  if (p.source_person) {
    chips.push({
      label: p.source_person, title: "Source person",
      color: "#6d28d9", bg: "#f5f3ff", border: "#ddd6fe",
    });
  }
  if (p.source_gap_id) {
    chips.push({
      label: p.source_gap_id, title: p.gap_question || "Source gap",
      color: "#b45309", bg: "#fef3c7", border: "#fde68a",
    });
  }
  if (chips.length === 0) return null;
  return (
    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
      {chips.map((c, i) => (
        <span
          key={i}
          title={c.title}
          style={{
            fontSize: 10, fontWeight: 600, padding: "1px 7px", borderRadius: 10,
            background: c.bg, color: c.color, border: `1px solid ${c.border}`,
            whiteSpace: "nowrap", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis",
          }}
        >{c.label}</span>
      ))}
    </div>
  );
}


// Shared across ProposedUpdatesSection and RequirementDetailView — inline
// tracked-changes rows reuse the same modal so reject UX stays identical.
export function RejectModal({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");

  return (
    <div
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
        display: "flex", alignItems: "center", justifyContent: "center", zIndex: 300,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div
        style={{
          background: "var(--white)", borderRadius: "var(--radius)", padding: 22,
          width: "100%", maxWidth: 420, boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>Reject proposal</div>
        <div style={{ fontSize: 12, color: "var(--gray-500)", marginBottom: 12, lineHeight: 1.5 }}>
          Why? (optional, helps the agent not re-propose)
        </div>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Out of scope for this phase, already covered by BR-012, etc."
          autoFocus
          style={{
            width: "100%", minHeight: 80, padding: "10px 12px",
            border: "1px solid var(--gray-200)", borderRadius: "var(--radius-sm)",
            fontSize: 13, fontFamily: "var(--font)", resize: "vertical",
            outline: "none", lineHeight: 1.5,
          }}
          onFocus={(e) => { e.currentTarget.style.borderColor = "var(--green)"; }}
          onBlur={(e) => { e.currentTarget.style.borderColor = "var(--gray-200)"; }}
        />
        <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
          <button
            onClick={onCancel}
            style={{
              padding: "7px 14px", borderRadius: "var(--radius-xs)",
              border: "1px solid var(--gray-200)", background: "var(--white)",
              fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "var(--font)",
            }}
          >Cancel</button>
          <button
            onClick={() => onConfirm(reason.trim())}
            style={{
              padding: "7px 14px", borderRadius: "var(--radius-xs)", border: "none",
              background: "#dc2626", color: "#fff",
              fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "var(--font)",
            }}
          >Reject</button>
        </div>
      </div>
    </div>
  );
}


interface ProposedUpdatesSectionProps {
  proposals: ProposedUpdate[];
  onAccept: (proposalId: string) => void | Promise<void>;
  onReject: (proposalId: string, reason: string) => void | Promise<void>;
}


export function ProposedUpdatesSection({ proposals, onAccept, onReject }: ProposedUpdatesSectionProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  if (proposals.length === 0) return null;

  const pendingCount = proposals.filter((p) => p.status === "pending").length;

  return (
    <div style={{
      marginTop: 20, borderRadius: 12, border: "1px solid var(--gray-200)",
      background: "var(--white)", overflow: "hidden",
    }}>
      {/* Collapsible header */}
      <button
        onClick={() => setCollapsed((c) => !c)}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 8,
          padding: "10px 14px", border: "none", background: "#fafafa",
          borderBottom: collapsed ? "none" : "1px solid var(--gray-200)",
          cursor: "pointer", fontFamily: "var(--font)",
          textAlign: "left",
        }}
      >
        <svg
          viewBox="0 0 24 24"
          style={{
            width: 12, height: 12, stroke: "var(--gray-500)", fill: "none",
            strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round",
            transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)",
            transition: "transform 0.15s",
          }}
        ><polyline points="6 9 12 15 18 9" /></svg>
        <span style={{ fontSize: 13, fontWeight: 700, color: "var(--dark)" }}>
          Proposed updates ({pendingCount})
        </span>
        <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--gray-500)" }}>
          {proposals.length} total
        </span>
      </button>

      {!collapsed && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: 14 }}>
          {proposals.map((p) => {
            const decided = p.status !== "pending";
            const isBusy = busy === p.id;
            const when = p.created_at ? new Date(p.created_at).toLocaleString() : null;

            return (
              <div
                key={p.id}
                style={{
                  borderRadius: 10, padding: 12,
                  border: "1px solid var(--gray-200)", background: "var(--white)",
                  opacity: decided ? 0.7 : 1,
                  display: "flex", flexDirection: "column", gap: 8,
                }}
              >
                {/* Row header */}
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{
                    fontSize: 11, fontWeight: 700, color: "var(--dark)",
                  }}>{humaniseField(p.proposed_field)}</span>
                  <SourceChips p={p} />
                  <StatusPill p={p} />
                  {when && (
                    <span style={{ marginLeft: "auto", fontSize: 10, color: "var(--gray-400)" }}>
                      {when}
                    </span>
                  )}
                </div>

                {/* Gap question / client answer (gap-driven flavour) */}
                {p.gap_question && (
                  <div style={{ fontSize: 11, color: "var(--gray-600)" }}>
                    <strong>Q:</strong> {p.gap_question}
                  </div>
                )}
                {p.client_answer && (
                  <div style={{
                    fontSize: 11, color: "var(--gray-600)",
                    borderLeft: "3px solid var(--green)",
                    padding: "4px 8px", background: "var(--green-light)",
                    borderRadius: "0 6px 6px 0",
                  }}>
                    {p.client_answer}
                  </div>
                )}

                {/* Diff */}
                <DiffView p={p} />

                {/* Rationale */}
                {p.rationale && (
                  <div style={{
                    fontSize: 11, color: "var(--gray-500)", fontStyle: "italic", lineHeight: 1.45,
                  }}>
                    {p.rationale}
                  </div>
                )}

                {/* Actions */}
                {!decided && (
                  <div style={{ display: "flex", gap: 8, marginTop: 2 }}>
                    <button
                      disabled={isBusy}
                      onClick={async () => {
                        setBusy(p.id);
                        try { await onAccept(p.id); } finally { setBusy(null); }
                      }}
                      style={{
                        padding: "6px 14px", borderRadius: "var(--radius-xs)",
                        border: "1px solid #05966930", background: "#05966910",
                        color: "#059669", fontSize: 12, fontWeight: 700,
                        cursor: isBusy ? "wait" : "pointer", fontFamily: "var(--font)",
                        transition: "all 0.15s",
                      }}
                      onMouseEnter={(e) => { if (!isBusy) e.currentTarget.style.background = "#05966920"; }}
                      onMouseLeave={(e) => { if (!isBusy) e.currentTarget.style.background = "#05966910"; }}
                    >Accept</button>
                    <button
                      disabled={isBusy}
                      onClick={() => setRejecting(p.id)}
                      style={{
                        padding: "6px 14px", borderRadius: "var(--radius-xs)",
                        border: "1px solid #ef444430", background: "#ef444410",
                        color: "#dc2626", fontSize: 12, fontWeight: 600,
                        cursor: isBusy ? "wait" : "pointer", fontFamily: "var(--font)",
                        transition: "all 0.15s",
                      }}
                      onMouseEnter={(e) => { if (!isBusy) e.currentTarget.style.background = "#ef444420"; }}
                      onMouseLeave={(e) => { if (!isBusy) e.currentTarget.style.background = "#ef444410"; }}
                    >Reject</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {rejecting && (
        <RejectModal
          onCancel={() => setRejecting(null)}
          onConfirm={async (reason) => {
            const id = rejecting;
            setRejecting(null);
            setBusy(id);
            try { await onReject(id, reason); } finally { setBusy(null); }
          }}
        />
      )}
    </div>
  );
}
