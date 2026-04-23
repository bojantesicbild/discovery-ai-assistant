"use client";

// Inline tracked-changes BR detail. Replaces MarkdownPanel for requirements
// so pending agent proposals render at their affected field (green + row
// inside the AC list, New-value block under the description, etc.) instead
// of stacking in a bottom card. Every other item kind still uses
// MarkdownPanel via the caller's branch.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  getItemHistory, type HistoryEntry,
  type ApiRequirement, type ProposedUpdate, type ProposedField,
} from "@/lib/api";
import { formatAge, formatRaisedMeta } from "@/lib/dates";
import { RejectModal } from "./proposed-updates-section";


type Action = { label: string; value: string; color: string };

interface RequirementDetailViewProps {
  req: ApiRequirement;
  projectId: string;
  proposals: ProposedUpdate[];
  onClose: () => void;
  actions?: Action[];
  onAction?: (value: string) => void;
  history?: { projectId: string; itemType: string; itemId: string };
  slotTop?: React.ReactNode;
  slotBottom?: React.ReactNode;
  onAccept: (proposalId: string) => void | Promise<void>;
  onReject: (proposalId: string, reason: string) => void | Promise<void>;
  /** Optional — same contract as MarkdownPanel's onLinkClick. Consumed by
   *  the Blocked-By chips and the source document link. */
  onLinkClick?: (href: string) => boolean | void;
}


function toList(v: string | string[] | null | undefined): string[] {
  if (v == null) return [];
  if (Array.isArray(v)) return v.filter((s) => typeof s === "string" && s.length > 0);
  return [String(v)];
}


function firstString(v: string | string[] | null | undefined): string {
  const list = toList(v);
  return list[0] || "";
}


/** "2h ago" / "3d ago" / fall back to locale time. Kept compact so the
 *  proposal subtitle fits on one line next to the filename + author. */
function ago(iso: string | null | undefined): string {
  const a = formatAge(iso);
  if (!a) return "";
  // formatAge returns HH:mm for same-day — leave that as-is.
  if (/^\d{1,2}:\d{2}$/.test(a)) return a;
  return `${a} ago`;
}


function FieldHeader({ label }: { label: string }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 700, color: "var(--gray-500)",
      textTransform: "uppercase", letterSpacing: 0.6,
      marginBottom: 6, marginTop: 16,
    }}>
      {label}
    </div>
  );
}


function ProposalSubtitle({ p }: { p: ProposedUpdate }) {
  const bits: string[] = [];
  if (p.source_doc) bits.push(p.source_doc);
  if (p.source_person) bits.push(p.source_person);
  const when = ago(p.created_at);
  if (when) bits.push(when);
  if (bits.length === 0) return null;
  return (
    <div style={{ fontSize: 10, color: "var(--gray-400)", marginTop: 3 }}>
      {bits.join(" · ")}
    </div>
  );
}


function AcceptRejectButtons({
  busy, onAccept, onReject, fieldLabel,
}: {
  busy: boolean;
  onAccept: () => void;
  onReject: () => void;
  fieldLabel: string;
}) {
  return (
    <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
      <button
        aria-label={`Accept proposed ${fieldLabel}`}
        disabled={busy}
        onClick={onAccept}
        style={{
          padding: "4px 10px", borderRadius: "var(--radius-xs)",
          border: "1px solid #05966930", background: "#05966910",
          color: "#059669", fontSize: 11, fontWeight: 700,
          cursor: busy ? "wait" : "pointer", fontFamily: "var(--font)",
          transition: "background 0.15s",
        }}
        onMouseEnter={(e) => { if (!busy) e.currentTarget.style.background = "#05966920"; }}
        onMouseLeave={(e) => { if (!busy) e.currentTarget.style.background = "#05966910"; }}
      >Accept</button>
      <button
        aria-label={`Reject proposed ${fieldLabel}`}
        disabled={busy}
        onClick={onReject}
        style={{
          padding: "4px 10px", borderRadius: "var(--radius-xs)",
          border: "1px solid #ef444430", background: "#ef444410",
          color: "#dc2626", fontSize: 11, fontWeight: 600,
          cursor: busy ? "wait" : "pointer", fontFamily: "var(--font)",
          transition: "background 0.15s",
        }}
        onMouseEnter={(e) => { if (!busy) e.currentTarget.style.background = "#ef444420"; }}
        onMouseLeave={(e) => { if (!busy) e.currentTarget.style.background = "#ef444410"; }}
      >Reject</button>
    </div>
  );
}


/** Tiny uppercase label chip: "Current (1)" / "+ New (2)". Rendered above
 *  existing-list bullets and above proposed-list additions so the PM sees
 *  the before/after split at a glance even when entries run long. */
function DiffCountLabel({ kind, count }: { kind: "current" | "new"; count: number }) {
  const isNew = kind === "new";
  return (
    <div style={{
      fontSize: 9, fontWeight: 700, letterSpacing: 0.6, textTransform: "uppercase",
      color: isNew ? "#047857" : "var(--gray-500)",
      marginTop: isNew ? 8 : 0, marginBottom: 4,
    }}>
      {isNew ? `+ New (${count})` : `Current (${count})`}
    </div>
  );
}


/** Green-tinted inline block for a proposed string-field value. Used by
 *  description / user_perspective / rationale / scope_note / title /
 *  source_person. `isReplacement` distinguishes "Proposed — not yet set"
 *  (current empty) from "New value" (replaces an existing value). */
function StringProposalBlock({
  p, label, busy, onAccept, onReject, fieldLabel,
}: {
  p: ProposedUpdate;
  label: string;
  busy: boolean;
  onAccept: () => void;
  onReject: () => void;
  fieldLabel: string;
}) {
  return (
    <div
      id={`proposal-${p.id}`}
      style={{
        marginTop: 8,
        borderRadius: 8, padding: "10px 12px",
        background: "rgba(16, 185, 129, 0.08)",
        borderLeft: "3px solid #10b981",
        display: "flex", flexDirection: "column", gap: 6,
        animation: "proposalFadeIn 0.2s ease-out",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{
          fontSize: 9, fontWeight: 800, padding: "1px 6px", borderRadius: 10,
          background: "#10b981", color: "#fff", letterSpacing: 0.4,
        }}>NEW</span>
        <span style={{ fontSize: 10, fontWeight: 700, color: "#047857", textTransform: "uppercase", letterSpacing: 0.4 }}>
          {label}
        </span>
        <div style={{ marginLeft: "auto" }}>
          <AcceptRejectButtons
            busy={busy}
            onAccept={onAccept} onReject={onReject}
            fieldLabel={fieldLabel}
          />
        </div>
      </div>
      <div style={{
        fontSize: 13, color: "#065f46", fontWeight: 500,
        whiteSpace: "pre-wrap", lineHeight: 1.6,
      }}>
        {firstString(p.proposed_value) || "—"}
      </div>
      {p.rationale && (
        <div style={{
          fontSize: 11, color: "var(--gray-500)", fontStyle: "italic", lineHeight: 1.45,
        }}>{p.rationale}</div>
      )}
      <ProposalSubtitle p={p} />
    </div>
  );
}


/** One `+` row inside a bullet list for a proposed list-field entry. */
function ListProposalRow({
  p, busy, onAccept, onReject, fieldLabel,
}: {
  p: ProposedUpdate;
  busy: boolean;
  onAccept: () => void;
  onReject: () => void;
  fieldLabel: string;
}) {
  const values = toList(p.proposed_value);
  return (
    <li
      id={`proposal-${p.id}`}
      style={{
        listStyle: "none", marginLeft: -18, marginTop: 6,
        padding: "8px 10px", borderRadius: 8,
        background: "rgba(16, 185, 129, 0.08)",
        borderLeft: "3px solid #10b981",
        animation: "proposalFadeIn 0.2s ease-out",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <span style={{
          fontSize: 14, fontWeight: 800, color: "#10b981",
          lineHeight: 1.5, flexShrink: 0,
        }} aria-hidden>+</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          {values.map((v, i) => (
            <div key={i} style={{
              fontSize: 13, color: "#065f46", fontWeight: 500, lineHeight: 1.6,
              whiteSpace: "pre-wrap",
            }}>{v}</div>
          ))}
          {p.rationale && (
            <div style={{
              fontSize: 11, color: "var(--gray-500)", fontStyle: "italic", lineHeight: 1.45, marginTop: 3,
            }}>{p.rationale}</div>
          )}
          <ProposalSubtitle p={p} />
        </div>
        <AcceptRejectButtons
          busy={busy}
          onAccept={onAccept} onReject={onReject}
          fieldLabel={fieldLabel}
        />
      </div>
    </li>
  );
}


export default function RequirementDetailView({
  req,
  proposals,
  onClose,
  actions,
  onAction,
  history,
  slotTop,
  slotBottom,
  onAccept,
  onReject,
  onLinkClick,
}: RequirementDetailViewProps) {
  const [activeView, setActiveView] = useState<"content" | "history">("content");
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  // Pending-only so accepted/rejected proposals don't linger inline.
  const pending = useMemo(
    () => proposals.filter((p) => p.status === "pending"),
    [proposals],
  );

  const byField = useMemo(() => {
    const m: Partial<Record<ProposedField, ProposedUpdate[]>> = {};
    for (const p of pending) {
      (m[p.proposed_field] ||= []).push(p);
    }
    return m;
  }, [pending]);

  useEffect(() => {
    if (activeView !== "history" || !history || historyEntries) return;
    setHistoryLoading(true);
    getItemHistory(history.projectId, history.itemType, history.itemId)
      .then((res) => setHistoryEntries(res.history))
      .catch(() => setHistoryEntries([]))
      .finally(() => setHistoryLoading(false));
  }, [activeView, history, historyEntries]);

  useEffect(() => {
    setHistoryEntries(null);
    setActiveView("content");
  }, [history?.itemId]);

  async function handleAccept(id: string) {
    setBusy(id);
    try { await onAccept(id); } finally { setBusy(null); }
  }

  async function handleReject(id: string, reason: string) {
    setBusy(id);
    try { await onReject(id, reason); } finally { setBusy(null); }
  }

  function jumpToFirst() {
    if (!bodyRef.current || pending.length === 0) return;
    const firstId = pending[0].id;
    const el = bodyRef.current.querySelector(`#proposal-${CSS.escape(firstId)}`);
    if (el instanceof HTMLElement) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  // ── Field-level proposal retrieval helpers ────────────────────────────
  const stringProposal = (f: ProposedField): ProposedUpdate | undefined =>
    (byField[f] || [])[0];
  const listProposals = (f: ProposedField): ProposedUpdate[] =>
    byField[f] || [];

  const titleText = `${req.req_id}: ${req.title}`;
  const metaEntries: [string, string][] = [
    ["priority", req.priority],
    ["status", req.status],
    ["confidence", req.confidence],
    ["version", `v${req.version || 1}${req.version > 1 ? ` · merged from ${1 + (req.sources?.length || 0)} docs` : ""}`],
    ["source", req.source_doc || "unknown"],
  ];
  const raised = formatRaisedMeta(req.created_at);
  if (raised) metaEntries.push(["raised", raised]);
  if (req.source_person) metaEntries.push(["requested_by", req.source_person]);

  const blockedBy = req.blocked_by || [];
  const alternatives = req.alternatives_considered || [];
  const rationale = (req.rationale || "").trim();
  const scopeNote = (req.scope_note || "").trim();
  const userPerspective = (req.user_perspective || "").trim();

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--white)" }}>
      <style>{`
        @keyframes proposalFadeIn {
          from { opacity: 0; transform: translateY(-2px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      {/* Header — mirrors MarkdownPanel */}
      <div style={{
        display: "flex", alignItems: "center", gap: 10, padding: "10px 16px",
        borderBottom: "1px solid var(--gray-200)", flexShrink: 0,
      }}>
        <button
          onClick={onClose}
          style={{
            width: 28, height: 28, borderRadius: "var(--radius-xs)",
            border: "1px solid var(--gray-200)", background: "var(--white)",
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer", transition: "all 0.15s",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "var(--gray-50)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "var(--white)"; }}
        >
          <svg viewBox="0 0 24 24" style={{ width: 14, height: 14, stroke: "var(--gray-500)", fill: "none", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" }}>
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{titleText}</div>
        </div>
      </div>

      {/* Meta badges — same palette as MarkdownPanel */}
      <div style={{
        display: "flex", flexWrap: "wrap", gap: 8, padding: "10px 16px",
        borderBottom: "1px solid var(--gray-100)",
      }}>
        {metaEntries.map(([key, value]) => (
          <div key={key} style={{
            display: "flex", alignItems: "center", gap: 4,
            fontSize: 11, color: "var(--gray-500)",
          }}>
            <span style={{ fontWeight: 600, color: "var(--gray-400)", textTransform: "uppercase", letterSpacing: "0.5px" }}>{key}:</span>
            <span style={{
              padding: "1px 8px", borderRadius: 10, fontSize: 10, fontWeight: 600,
              ...((): { background: string; color: string } => {
                switch (value) {
                  case "must":       return { background: "var(--danger-light)", color: "var(--danger)" };
                  case "confirmed":
                  case "resolved":   return { background: "var(--green-light)", color: "#059669" };
                  case "open":       return { background: "#FEF3C7",            color: "#B45309" };
                  case "dismissed":  return { background: "var(--gray-100)",    color: "var(--gray-400)" };
                  default:           return { background: "var(--gray-100)",    color: "var(--gray-600)" };
                }
              })(),
            }}>
              {value}
            </span>
          </div>
        ))}
      </div>

      {/* Action buttons — same spot as MarkdownPanel (do not move) */}
      {actions && actions.length > 0 && (
        <div style={{
          display: "flex", gap: 8, padding: "10px 16px",
          borderBottom: "1px solid var(--gray-100)",
        }}>
          <span style={{ fontSize: 11, color: "var(--gray-400)", fontWeight: 600, alignSelf: "center", marginRight: 4 }}>
            Set status:
          </span>
          {actions.map((action) => (
            <button
              key={action.value}
              onClick={() => onAction?.(action.value)}
              style={{
                padding: "5px 14px", borderRadius: "var(--radius-xs)",
                border: `1px solid ${action.color}30`, background: `${action.color}10`,
                fontSize: 12, fontWeight: 600, cursor: "pointer",
                fontFamily: "var(--font)", color: action.color,
                transition: "all 0.15s",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = `${action.color}20`; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = `${action.color}10`; }}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}

      {/* History tabs */}
      {history && (
        <div style={{
          display: "flex", gap: 0, padding: "0 16px",
          borderBottom: "1px solid var(--gray-100)",
        }}>
          {(["content", "history"] as const).map((view) => (
            <button
              key={view}
              onClick={() => setActiveView(view)}
              style={{
                padding: "10px 14px", fontSize: 12, fontWeight: 600,
                background: "none", border: "none", cursor: "pointer",
                color: activeView === view ? "var(--green)" : "var(--gray-500)",
                borderBottom: activeView === view ? "2px solid var(--green)" : "2px solid transparent",
                marginBottom: -1, fontFamily: "var(--font)", textTransform: "capitalize",
              }}
            >
              {view}
            </button>
          ))}
        </div>
      )}

      {/* Body */}
      <div style={{ flex: 1, overflow: "auto", padding: 16 }} ref={bodyRef}>
        {activeView === "history" && history ? (
          historyLoading ? (
            <div style={{ fontSize: 12, color: "var(--gray-500)" }}>Loading history…</div>
          ) : historyEntries && historyEntries.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {historyEntries.map((entry) => (
                <div key={entry.id} style={{
                  borderLeft: `3px solid ${entry.action === "create" ? "var(--green)" : "#3B82F6"}`,
                  padding: "8px 12px", background: "var(--gray-50)",
                  borderRadius: "var(--radius-xs)",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 4,
                      background: entry.action === "create" ? "var(--green-light)" : "#DBEAFE",
                      color: entry.action === "create" ? "#059669" : "#1D4ED8",
                      textTransform: "uppercase",
                    }}>{entry.action}</span>
                    {entry.source_filename && (
                      <span style={{ fontSize: 11, color: "var(--gray-500)" }}>
                        from <strong style={{ color: "var(--dark)" }}>{entry.source_filename}</strong>
                      </span>
                    )}
                    <span style={{ flex: 1 }} />
                    <span style={{ fontSize: 10, color: "var(--gray-400)" }}>
                      {entry.created_at ? new Date(entry.created_at).toLocaleString() : ""}
                    </span>
                  </div>
                  {entry.action === "update" && Object.keys(entry.old_value || {}).length > 0 && (
                    <div style={{ fontSize: 11, lineHeight: 1.6 }}>
                      {Object.keys(entry.old_value).map((field) => (
                        <div key={field} style={{ marginTop: 2 }}>
                          <span style={{ color: "var(--gray-500)", fontWeight: 600 }}>{field}: </span>
                          <span style={{ textDecoration: "line-through", color: "var(--gray-400)" }}>
                            {String(entry.old_value[field] ?? "")}
                          </span>
                          <span style={{ color: "var(--gray-400)" }}> → </span>
                          <span style={{ color: "var(--dark)", fontWeight: 600 }}>
                            {String(entry.new_value[field] ?? "")}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  {entry.action === "create" && (
                    <div style={{ fontSize: 11, color: "var(--gray-600)" }}>
                      {Object.entries(entry.new_value || {}).map(([k, v]) => (
                        <span key={k} style={{ marginRight: 8 }}>
                          <span style={{ color: "var(--gray-500)" }}>{k}:</span> {String(v)}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 12, color: "var(--gray-500)" }}>No history yet.</div>
          )
        ) : (
          <>
            {/* Jump-to-first strip */}
            {pending.length > 0 && (
              <button
                onClick={jumpToFirst}
                style={{
                  width: "100%", textAlign: "left",
                  display: "flex", alignItems: "center", gap: 8,
                  padding: "8px 12px", marginBottom: 12,
                  borderRadius: 8, border: "1px solid #fde68a",
                  background: "#fef3c7", cursor: "pointer",
                  fontFamily: "var(--font)", color: "#92400e",
                  fontSize: 12, fontWeight: 600,
                }}
              >
                <svg viewBox="0 0 24 24" style={{ width: 14, height: 14, stroke: "currentColor", fill: "none", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" }}>
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
                <span>{pending.length} proposed update{pending.length === 1 ? "" : "s"}</span>
                <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 4, color: "#b45309" }}>
                  Jump to first
                  <svg viewBox="0 0 24 24" style={{ width: 12, height: 12, stroke: "currentColor", fill: "none", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" }}>
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </span>
              </button>
            )}

            {slotTop}

            <div style={{ fontSize: 13, lineHeight: 1.7, color: "var(--dark)", fontFamily: "var(--font)" }}>
              {/* ── Description ── */}
              <FieldSection
                label="Description"
                stringProposal={stringProposal("description")}
                fieldLabel="description"
                busyId={busy}
                onAccept={handleAccept}
                onReject={(id) => setRejecting(id)}
                current={req.description || ""}
                renderCurrent={(v) => (
                  <div style={{ whiteSpace: "pre-wrap" }}>{v || <em style={{ color: "var(--gray-400)" }}>No description</em>}</div>
                )}
                emptyLabel="Proposed — not yet set"
                hasLabelHeader
              />

              {/* ── User Perspective ── */}
              {(userPerspective || stringProposal("user_perspective")) && (
                <FieldSection
                  label="User Perspective"
                  stringProposal={stringProposal("user_perspective")}
                  fieldLabel="user perspective"
                  busyId={busy}
                  onAccept={handleAccept}
                  onReject={(id) => setRejecting(id)}
                  current={userPerspective}
                  renderCurrent={(v) => <div style={{ whiteSpace: "pre-wrap" }}>{v}</div>}
                  emptyLabel="Proposed — not yet set"
                  hasLabelHeader
                />
              )}

              {/* ── Rationale ── */}
              {(rationale || stringProposal("rationale")) && (
                <FieldSection
                  label="Rationale"
                  stringProposal={stringProposal("rationale")}
                  fieldLabel="rationale"
                  busyId={busy}
                  onAccept={handleAccept}
                  onReject={(id) => setRejecting(id)}
                  current={rationale}
                  renderCurrent={(v) => <div style={{ whiteSpace: "pre-wrap" }}>{v}</div>}
                  emptyLabel="Proposed — not yet set"
                  hasLabelHeader
                />
              )}

              {/* ── Alternatives Considered ── */}
              {(alternatives.length > 0 || listProposals("alternatives_considered").length > 0) && (() => {
                const props = listProposals("alternatives_considered");
                const hasBoth = alternatives.length > 0 && props.length > 0;
                return (
                  <>
                    <FieldHeader label="Alternatives Considered" />
                    {hasBoth && <DiffCountLabel kind="current" count={alternatives.length} />}
                    {alternatives.length > 0 && (
                      <ul style={{ margin: 0, paddingLeft: 18 }}>
                        {alternatives.map((a, i) => <li key={i}>{a}</li>)}
                      </ul>
                    )}
                    {props.length > 0 && (
                      <>
                        {hasBoth && <DiffCountLabel kind="new" count={props.length} />}
                        <ul style={{ margin: 0, paddingLeft: 18 }}>
                          {props.map((p) => (
                            <ListProposalRow
                              key={p.id} p={p}
                              busy={busy === p.id}
                              onAccept={() => handleAccept(p.id)}
                              onReject={() => setRejecting(p.id)}
                              fieldLabel="alternatives considered"
                            />
                          ))}
                        </ul>
                      </>
                    )}
                  </>
                );
              })()}

              {/* ── Business Rules ── */}
              {((req.business_rules?.length || 0) > 0 || listProposals("business_rules").length > 0) && (() => {
                const props = listProposals("business_rules");
                const rules = req.business_rules || [];
                const hasBoth = rules.length > 0 && props.length > 0;
                return (
                  <>
                    <FieldHeader label="Business Rules" />
                    {hasBoth && <DiffCountLabel kind="current" count={rules.length} />}
                    {rules.length > 0 && (
                      <ul style={{ margin: 0, paddingLeft: 18 }}>
                        {rules.map((r, i) => <li key={i}>{r}</li>)}
                      </ul>
                    )}
                    {props.length > 0 && (
                      <>
                        {hasBoth && <DiffCountLabel kind="new" count={props.length} />}
                        <ul style={{ margin: 0, paddingLeft: 18 }}>
                          {props.map((p) => (
                            <ListProposalRow
                              key={p.id} p={p}
                              busy={busy === p.id}
                              onAccept={() => handleAccept(p.id)}
                              onReject={() => setRejecting(p.id)}
                              fieldLabel="business rule"
                            />
                          ))}
                        </ul>
                      </>
                    )}
                  </>
                );
              })()}

              {/* ── Acceptance Criteria ── always rendered when any AC or AC-proposal exists */}
              {((req.acceptance_criteria?.length || 0) > 0 || listProposals("acceptance_criteria").length > 0) && (() => {
                const props = listProposals("acceptance_criteria");
                const acs = req.acceptance_criteria || [];
                const hasBoth = acs.length > 0 && props.length > 0;
                return (
                  <>
                    <FieldHeader label="Acceptance Criteria" />
                    {hasBoth && <DiffCountLabel kind="current" count={acs.length} />}
                    {acs.length > 0 && (
                      <ul style={{ margin: 0, paddingLeft: 18 }}>
                        {acs.map((ac, i) => <li key={i}>{ac}</li>)}
                      </ul>
                    )}
                    {props.length > 0 && (
                      <>
                        {hasBoth && <DiffCountLabel kind="new" count={props.length} />}
                        <ul style={{ margin: 0, paddingLeft: 18 }}>
                          {props.map((p) => (
                            <ListProposalRow
                              key={p.id} p={p}
                              busy={busy === p.id}
                              onAccept={() => handleAccept(p.id)}
                              onReject={() => setRejecting(p.id)}
                              fieldLabel="acceptance criterion"
                            />
                          ))}
                        </ul>
                      </>
                    )}
                  </>
                );
              })()}

              {/* ── Edge Cases ── */}
              {((req.edge_cases?.length || 0) > 0 || listProposals("edge_cases").length > 0) && (() => {
                const props = listProposals("edge_cases");
                const edges = req.edge_cases || [];
                const hasBoth = edges.length > 0 && props.length > 0;
                return (
                  <>
                    <FieldHeader label="Edge Cases" />
                    {hasBoth && <DiffCountLabel kind="current" count={edges.length} />}
                    {edges.length > 0 && (
                      <ul style={{ margin: 0, paddingLeft: 18 }}>
                        {edges.map((e, i) => <li key={i}>{e}</li>)}
                      </ul>
                    )}
                    {props.length > 0 && (
                      <>
                        {hasBoth && <DiffCountLabel kind="new" count={props.length} />}
                        <ul style={{ margin: 0, paddingLeft: 18 }}>
                          {props.map((p) => (
                            <ListProposalRow
                              key={p.id} p={p}
                              busy={busy === p.id}
                              onAccept={() => handleAccept(p.id)}
                              onReject={() => setRejecting(p.id)}
                              fieldLabel="edge case"
                            />
                          ))}
                        </ul>
                      </>
                    )}
                  </>
                );
              })()}

              {/* ── Scope Note ── */}
              {(scopeNote || stringProposal("scope_note")) && (
                <>
                  <FieldHeader label="Scope Note" />
                  {scopeNote && <div style={{ fontStyle: "italic", color: "var(--gray-600)" }}>{scopeNote}</div>}
                  {stringProposal("scope_note") && (() => {
                    const p = stringProposal("scope_note")!;
                    return (
                      <StringProposalBlock
                        p={p}
                        label={scopeNote ? "New value" : "Proposed — not yet set"}
                        busy={busy === p.id}
                        onAccept={() => handleAccept(p.id)}
                        onReject={() => setRejecting(p.id)}
                        fieldLabel="scope note"
                      />
                    );
                  })()}
                </>
              )}

              {/* ── Blocked By ── */}
              {(blockedBy.length > 0 || listProposals("blocked_by").length > 0) && (() => {
                const props = listProposals("blocked_by");
                const hasBoth = blockedBy.length > 0 && props.length > 0;
                return (
                  <>
                    <FieldHeader label="Blocked By" />
                    {hasBoth && <DiffCountLabel kind="current" count={blockedBy.length} />}
                    {blockedBy.length > 0 && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {blockedBy.map((b) => (
                          <a
                            key={b}
                            href={`br://${b}`}
                            onClick={(e) => {
                              if (!onLinkClick) return;
                              const handled = onLinkClick(`br://${b}`);
                              if (handled !== false) e.preventDefault();
                            }}
                            style={{
                              fontSize: 11, fontWeight: 600, padding: "2px 8px",
                              borderRadius: 10, background: "var(--gray-100)",
                              color: "var(--dark)", textDecoration: "none",
                              border: "1px solid var(--gray-200)",
                            }}
                          >{b}</a>
                        ))}
                      </div>
                    )}
                    {props.length > 0 && (
                      <>
                        {hasBoth && <DiffCountLabel kind="new" count={props.length} />}
                        <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                          {props.map((p) => (
                            <ListProposalRow
                              key={p.id} p={p}
                              busy={busy === p.id}
                              onAccept={() => handleAccept(p.id)}
                              onReject={() => setRejecting(p.id)}
                              fieldLabel="blocker"
                            />
                          ))}
                        </ul>
                      </>
                    )}
                  </>
                );
              })()}

              {/* ── People / Source Person ── */}
              {(req.source_person || stringProposal("source_person")) && (
                <>
                  <FieldHeader label="People" />
                  {req.source_person && (
                    <div style={{ fontSize: 12 }}>
                      Requested by <strong>{req.source_person}</strong>
                    </div>
                  )}
                  {stringProposal("source_person") && (() => {
                    const p = stringProposal("source_person")!;
                    return (
                      <StringProposalBlock
                        p={p}
                        label={req.source_person ? "New value" : "Proposed — not yet set"}
                        busy={busy === p.id}
                        onAccept={() => handleAccept(p.id)}
                        onReject={() => setRejecting(p.id)}
                        fieldLabel="source person"
                      />
                    );
                  })()}
                </>
              )}

              {/* ── Source ── quote + document link */}
              {(req.source_quote || req.source_doc) && (
                <>
                  <FieldHeader label="Source" />
                  {req.source_quote && (
                    <blockquote style={{
                      borderLeft: "3px solid var(--green)", padding: "8px 14px",
                      margin: "4px 0 10px", background: "var(--green-light)",
                      borderRadius: "0 var(--radius-xs) var(--radius-xs) 0",
                      fontSize: 12, color: "var(--gray-600)",
                    }}>{req.source_quote}</blockquote>
                  )}
                  {req.source_doc && (
                    req.source_doc_id ? (
                      <a
                        href={`doc://${req.source_doc_id}`}
                        onClick={(e) => {
                          if (!onLinkClick) return;
                          const handled = onLinkClick(`doc://${req.source_doc_id}`);
                          if (handled !== false) e.preventDefault();
                        }}
                        style={{ fontSize: 12, color: "#1d4ed8", textDecoration: "underline" }}
                      >{req.source_doc}</a>
                    ) : (
                      <span style={{ fontSize: 12, color: "var(--gray-500)" }}>{req.source_doc}</span>
                    )
                  )}
                </>
              )}

              {/* ── Title proposal (rare, but supported) ── */}
              {stringProposal("title") && (() => {
                const p = stringProposal("title")!;
                return (
                  <>
                    <FieldHeader label="Title" />
                    <StringProposalBlock
                      p={p}
                      label="New value"
                      busy={busy === p.id}
                      onAccept={() => handleAccept(p.id)}
                      onReject={() => setRejecting(p.id)}
                      fieldLabel="title"
                    />
                  </>
                );
              })()}
            </div>
            {slotBottom}
          </>
        )}
      </div>

      {rejecting && (
        <RejectModal
          onCancel={() => setRejecting(null)}
          onConfirm={async (reason) => {
            const id = rejecting;
            setRejecting(null);
            await handleReject(id, reason);
          }}
        />
      )}
    </div>
  );
}


/** Standard field section: header + current text + optional green proposal
 *  block. Extracted to avoid repeating the same conditional-render dance
 *  for every string field. */
function FieldSection({
  label,
  current,
  renderCurrent,
  stringProposal,
  fieldLabel,
  busyId,
  onAccept,
  onReject,
  emptyLabel,
  hasLabelHeader,
}: {
  label: string;
  current: string;
  renderCurrent: (v: string) => React.ReactNode;
  stringProposal: ProposedUpdate | undefined;
  fieldLabel: string;
  busyId: string | null;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
  emptyLabel: string;
  hasLabelHeader: boolean;
}) {
  if (!current && !stringProposal) return null;
  const hasBoth = !!current && !!stringProposal;
  return (
    <>
      {hasLabelHeader && <FieldHeader label={label} />}
      {current && (
        <>
          {/* Only label "Current" when something is about to replace it —
              otherwise the plain section is cleaner without a redundant tag. */}
          {hasBoth && <DiffCountLabel kind="current" count={1} />}
          <div style={hasBoth ? {
            padding: "8px 12px", borderRadius: 8,
            background: "var(--gray-50, #f9fafb)",
            border: "1px solid var(--gray-100)",
          } : undefined}>
            {renderCurrent(current)}
          </div>
        </>
      )}
      {stringProposal && (
        <StringProposalBlock
          p={stringProposal}
          label={current ? "New value" : emptyLabel}
          busy={busyId === stringProposal.id}
          onAccept={() => onAccept(stringProposal.id)}
          onReject={() => onReject(stringProposal.id)}
          fieldLabel={fieldLabel}
        />
      )}
    </>
  );
}
