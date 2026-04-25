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
  if (p.status === "accepted") return <span className="chip xs uppercase green">Accepted</span>;
  if (p.status === "rejected") {
    return (
      <span
        title={p.rejection_reason || undefined}
        className="chip xs uppercase red"
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

  return (
    <div className="prop-diff">
      {!currentEmpty && (
        <div>
          <div className="prop-diff-label current">Current</div>
          {isList ? (
            <ul className="prop-diff-current-list">
              {currentList.map((v, i) => <li key={i}>{v}</li>)}
            </ul>
          ) : (
            <div className="prop-diff-current-text">{currentList[0]}</div>
          )}
        </div>
      )}
      <div>
        <div className="prop-diff-label new">
          {currentEmpty ? "New value" : isList ? "+ Adding" : "Replacing with"}
        </div>
        {isList ? (
          <ul className="prop-diff-new-list">
            {proposedList.map((v, i) => <li key={i}>{v}</li>)}
          </ul>
        ) : (
          <div className="prop-diff-new-text">{proposedList[0] || "—"}</div>
        )}
      </div>
    </div>
  );
}


function SourceChips({ p }: { p: ProposedUpdate }) {
  const chips: { label: string; title?: string; cls: string }[] = [];
  if (p.source_doc) {
    chips.push({ label: p.source_doc, title: `Source document${p.source_doc_id ? ` (${p.source_doc_id})` : ""}`, cls: "doc" });
  }
  if (p.source_person) {
    chips.push({ label: p.source_person, title: "Source person", cls: "person" });
  }
  if (p.source_gap_id) {
    chips.push({ label: p.source_gap_id, title: p.gap_question || "Source gap", cls: "gap" });
  }
  if (chips.length === 0) return null;
  return (
    <div className="prop-source-chips">
      {chips.map((c, i) => (
        <span key={i} title={c.title} className={`prop-source-chip ${c.cls}`}>{c.label}</span>
      ))}
    </div>
  );
}


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
      className="modal-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className="modal-card">
        <div className="modal-title">Reject proposal</div>
        <div className="modal-hint">
          Why? (optional, helps the agent not re-propose)
        </div>
        <textarea
          className="modal-textarea"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Out of scope for this phase, already covered by BR-012, etc."
          autoFocus
        />
        <div className="modal-actions">
          <button type="button" className="btn-ghost" onClick={onCancel}>Cancel</button>
          <button type="button" className="btn-danger" onClick={() => onConfirm(reason.trim())}>Reject</button>
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
  const [anim, setAnim] = useState<{ id: string; kind: "accepting" | "rejecting" } | null>(null);

  if (proposals.length === 0) return null;

  const pendingCount = proposals.filter((p) => p.status === "pending").length;

  async function runAccept(id: string) {
    setBusy(id);
    setAnim({ id, kind: "accepting" });
    const animDelay = new Promise<void>((r) => setTimeout(r, 760));
    try {
      await Promise.all([animDelay, onAccept(id)]);
    } finally {
      setBusy(null);
      setAnim(null);
    }
  }

  async function runReject(id: string, reason: string) {
    setBusy(id);
    setAnim({ id, kind: "rejecting" });
    const animDelay = new Promise<void>((r) => setTimeout(r, 520));
    try {
      await Promise.all([animDelay, onReject(id, reason)]);
    } finally {
      setBusy(null);
      setAnim(null);
    }
  }

  return (
    <div className="prop-section">
      <button
        type="button"
        className={`prop-head ${collapsed ? "closed" : "open"}`}
        onClick={() => setCollapsed((c) => !c)}
      >
        <svg className="chev" viewBox="0 0 24 24">
          <polyline points="6 9 12 15 18 9" />
        </svg>
        <span className="title">Proposed updates ({pendingCount})</span>
        <span className="total">{proposals.length} total</span>
      </button>

      {!collapsed && (
        <div className="prop-body">
          {proposals.map((p) => {
            const decided = p.status !== "pending";
            const isBusy = busy === p.id;
            const when = p.created_at ? new Date(p.created_at).toLocaleString() : null;
            const animCls = anim?.id === p.id
              ? (anim.kind === "accepting" ? " accepting" : " rejecting")
              : "";

            return (
              <div key={p.id} className={`prop-card${decided ? " decided" : ""}${animCls}`}>
                <div className="prop-card-head">
                  <span className="prop-card-field">{humaniseField(p.proposed_field)}</span>
                  <SourceChips p={p} />
                  <StatusPill p={p} />
                  {when && <span className="prop-card-ts">{when}</span>}
                </div>

                {p.gap_question && (
                  <div className="prop-card-qa">
                    <strong>Q:</strong> {p.gap_question}
                  </div>
                )}
                {p.client_answer && (
                  <div className="prop-card-quote">{p.client_answer}</div>
                )}

                <DiffView p={p} />

                {p.rationale && <div className="prop-rationale">{p.rationale}</div>}

                {!decided && (
                  <div className="prop-card-actions">
                    <button
                      type="button"
                      className="btn-accept"
                      disabled={isBusy}
                      onClick={() => runAccept(p.id)}
                    >Accept</button>
                    <button
                      type="button"
                      className="btn-reject"
                      disabled={isBusy}
                      onClick={() => setRejecting(p.id)}
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
            await runReject(id, reason);
          }}
        />
      )}
    </div>
  );
}
