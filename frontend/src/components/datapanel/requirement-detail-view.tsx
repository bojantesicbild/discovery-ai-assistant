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


function ago(iso: string | null | undefined): string {
  const a = formatAge(iso);
  if (!a) return "";
  if (/^\d{1,2}:\d{2}$/.test(a)) return a;
  return `${a} ago`;
}


// Map meta values to .chip variants so the meta row mirrors the rest of v2.
function metaVariant(key: string, value: string): string {
  if (key === "priority") {
    if (value === "must") return "red";
    if (value === "should") return "amber";
    if (value === "could") return "blue";
    return "";
  }
  if (key === "status") {
    if (value === "confirmed" || value === "resolved") return "green";
    if (value === "open" || value === "discussed") return "amber";
    if (value === "dismissed") return "";
    return "";
  }
  return "";
}


function ProposalSubtitle({ p }: { p: ProposedUpdate }) {
  const bits: string[] = [];
  if (p.source_doc) bits.push(p.source_doc);
  if (p.source_person) bits.push(p.source_person);
  const when = ago(p.created_at);
  if (when) bits.push(when);
  if (bits.length === 0) return null;
  return <div className="proposal-block-sub">{bits.join(" · ")}</div>;
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
    <div className="proposal-block-actions">
      <button type="button" className="btn-accept" disabled={busy} aria-label={`Accept proposed ${fieldLabel}`} onClick={onAccept}>
        Accept
      </button>
      <button type="button" className="btn-reject" disabled={busy} aria-label={`Reject proposed ${fieldLabel}`} onClick={onReject}>
        Reject
      </button>
    </div>
  );
}


function DiffCountLabel({ kind, count }: { kind: "current" | "new"; count: number }) {
  return (
    <div className={`diff-count-label ${kind}`}>
      {kind === "new" ? `+ New (${count})` : `Current (${count})`}
    </div>
  );
}


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
    <div id={`proposal-${p.id}`} className="proposal-block">
      <div className="proposal-block-head">
        <span className="proposal-block-new-tag">NEW</span>
        <span className="proposal-block-label">{label}</span>
        <AcceptRejectButtons busy={busy} onAccept={onAccept} onReject={onReject} fieldLabel={fieldLabel} />
      </div>
      <div className="proposal-block-body">{firstString(p.proposed_value) || "—"}</div>
      {p.rationale && <div className="proposal-block-rationale">{p.rationale}</div>}
      <ProposalSubtitle p={p} />
    </div>
  );
}


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
    <li id={`proposal-${p.id}`} className="proposal-row">
      <div className="proposal-row-inner">
        <span className="proposal-row-plus" aria-hidden>+</span>
        <div className="proposal-row-body">
          {values.map((v, i) => (
            <div key={i} className="proposal-row-value">{v}</div>
          ))}
          {p.rationale && <div className="proposal-block-rationale" style={{ marginTop: 3 }}>{p.rationale}</div>}
          <ProposalSubtitle p={p} />
        </div>
        <AcceptRejectButtons busy={busy} onAccept={onAccept} onReject={onReject} fieldLabel={fieldLabel} />
      </div>
    </li>
  );
}


function FieldHeader({ label }: { label: string }) {
  return <div className="field-header">{label}</div>;
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

  const stringProposal = (f: ProposedField): ProposedUpdate | undefined =>
    (byField[f] || [])[0];
  const listProposals = (f: ProposedField): ProposedUpdate[] =>
    byField[f] || [];

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
    <div className="req-detail">
      {/* Hero: back + id/version + title */}
      <div className="req-detail-hero">
        <button type="button" className="req-detail-back" onClick={onClose} aria-label="Back">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <div className="req-detail-title">
          <div className="req-detail-title-row">
            <span className="id">{req.req_id}</span>
            <span className="v">v{req.version || 1}</span>
          </div>
          <h1>{req.title}</h1>
        </div>
      </div>

      {/* Meta row — chips */}
      <div className="req-detail-meta">
        {metaEntries.map(([key, value]) => {
          const variant = metaVariant(key, value);
          return (
            <span key={key} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <span className="meta-label">{key}</span>
              <span className={`chip xs${variant ? ` ${variant}` : ""}`}>{value}</span>
            </span>
          );
        })}
      </div>

      {/* Action buttons */}
      {actions && actions.length > 0 && (
        <div className="req-detail-actions">
          <span className="label">Set status:</span>
          {actions.map((action) => {
            const cls = action.value === "confirmed" ? "confirm" : action.value === "dismissed" ? "dismiss" : "discuss";
            return (
              <button
                key={action.value}
                type="button"
                className={`btn-status ${cls}`}
                onClick={() => onAction?.(action.value)}
              >
                {action.label}
              </button>
            );
          })}
        </div>
      )}

      {/* History sub-tabs */}
      {history && (
        <div className="req-detail-subtabs">
          {(["content", "history"] as const).map((view) => (
            <button
              key={view}
              type="button"
              onClick={() => setActiveView(view)}
              className={`req-detail-subtab${activeView === view ? " active" : ""}`}
            >
              {view}
            </button>
          ))}
        </div>
      )}

      {/* Body */}
      <div className="req-detail-body" ref={bodyRef}>
        {activeView === "history" && history ? (
          historyLoading ? (
            <div className="detail-empty">Loading history…</div>
          ) : historyEntries && historyEntries.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {historyEntries.map((entry) => (
                <div key={entry.id} className={`history-entry ${entry.action}`}>
                  <div className="history-entry-head">
                    <span className={`history-entry-action ${entry.action}`}>{entry.action}</span>
                    {entry.source_filename && (
                      <span className="history-entry-meta">
                        from <strong>{entry.source_filename}</strong>
                      </span>
                    )}
                    <span className="history-entry-ts">
                      {entry.created_at ? new Date(entry.created_at).toLocaleString() : ""}
                    </span>
                  </div>
                  {entry.action === "update" && Object.keys(entry.old_value || {}).length > 0 && (
                    <div className="history-entry-diff">
                      {Object.keys(entry.old_value).map((field) => (
                        <div key={field} style={{ marginTop: 2 }}>
                          <span className="field">{field}: </span>
                          <span className="old">{String(entry.old_value[field] ?? "")}</span>
                          <span style={{ color: "var(--ink-4)" }}> → </span>
                          <span className="new">{String(entry.new_value[field] ?? "")}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {entry.action === "create" && (
                    <div className="history-entry-create-line">
                      {Object.entries(entry.new_value || {}).map(([k, v]) => (
                        <span key={k} style={{ marginRight: 8 }}>
                          <span style={{ color: "var(--ink-3)" }}>{k}:</span> {String(v)}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="detail-empty">No history yet.</div>
          )
        ) : (
          <>
            {pending.length > 0 && (
              <button type="button" className="dp-notice-strip" onClick={jumpToFirst}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
                <span>{pending.length} proposed update{pending.length === 1 ? "" : "s"}</span>
                <span className="jump">
                  Jump to first
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </span>
              </button>
            )}

            {slotTop}

            <div style={{ fontSize: 13, lineHeight: 1.7, color: "var(--ink)" }}>
              <FieldSection
                label="Description"
                stringProposal={stringProposal("description")}
                fieldLabel="description"
                busyId={busy}
                onAccept={handleAccept}
                onReject={(id) => setRejecting(id)}
                current={req.description || ""}
                renderCurrent={(v) => (
                  <div style={{ whiteSpace: "pre-wrap" }}>{v || <em style={{ color: "var(--ink-4)" }}>No description</em>}</div>
                )}
                emptyLabel="Proposed — not yet set"
                hasLabelHeader
              />

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

              {(scopeNote || stringProposal("scope_note")) && (
                <>
                  <FieldHeader label="Scope Note" />
                  {scopeNote && <div style={{ fontStyle: "italic", color: "var(--ink-3)" }}>{scopeNote}</div>}
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

              {(blockedBy.length > 0 || listProposals("blocked_by").length > 0) && (() => {
                const props = listProposals("blocked_by");
                const hasBoth = blockedBy.length > 0 && props.length > 0;
                return (
                  <>
                    <FieldHeader label="Blocked By" />
                    {hasBoth && <DiffCountLabel kind="current" count={blockedBy.length} />}
                    {blockedBy.length > 0 && (
                      <div className="blocked-chip-row">
                        {blockedBy.map((b) => (
                          <a
                            key={b}
                            href={`br://${b}`}
                            className="blocked-chip"
                            onClick={(e) => {
                              if (!onLinkClick) return;
                              const handled = onLinkClick(`br://${b}`);
                              if (handled !== false) e.preventDefault();
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

              {(req.source_person || stringProposal("source_person")) && (
                <>
                  <FieldHeader label="People" />
                  {req.source_person && (
                    <div className="people-line">
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

              {(req.source_quote || req.source_doc) && (
                <>
                  <FieldHeader label="Source" />
                  {req.source_quote && (
                    <blockquote className="source-quote">{req.source_quote}</blockquote>
                  )}
                  {req.source_doc && (
                    req.source_doc_id ? (
                      <a
                        href={`doc://${req.source_doc_id}`}
                        className="source-doc-link"
                        onClick={(e) => {
                          if (!onLinkClick) return;
                          const handled = onLinkClick(`doc://${req.source_doc_id}`);
                          if (handled !== false) e.preventDefault();
                        }}
                      >{req.source_doc}</a>
                    ) : (
                      <span className="source-doc-plain">{req.source_doc}</span>
                    )
                  )}
                </>
              )}

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
          {hasBoth && <DiffCountLabel kind="current" count={1} />}
          <div className={hasBoth ? "field-current-box" : undefined}>
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
