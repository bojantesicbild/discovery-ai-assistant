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
import { formatAge } from "@/lib/dates";
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


// Hero chip helpers.
// The status chip uses the canonical .status / .status.confirmed /
// .status.discussed pattern (dot + label) so it matches RequirementsTab
// rows. Confidence stays a neutral .chip with the literal label.
function statusChipClasses(status: string): string {
  if (status === "confirmed" || status === "resolved") return "status confirmed";
  if (status === "discussed") return "status discussed";
  return "status"; // proposed / pending / open
}


// Map an Action (label/value) onto one of the three .btn-status
// variants in panels.css. The detail-builders ship Drop with
// value="dropped" — the previous switch only matched "dismissed",
// so Drop fell through to discuss (amber) instead of dismiss (red).
function statusActionClass(value: string, label: string): string {
  const v = (value || "").toLowerCase();
  const l = (label || "").toLowerCase();
  if (v === "confirmed" || l === "confirm") return "confirm";
  if (v === "dropped" || v === "dismissed" || l === "drop") return "dismiss";
  return "discuss";
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


type AnimKind = "accepting" | "rejecting" | null;

function StringProposalBlock({
  p, label, busy, anim, onAccept, onReject, fieldLabel,
}: {
  p: ProposedUpdate;
  label: string;
  busy: boolean;
  anim: AnimKind;
  onAccept: () => void;
  onReject: () => void;
  fieldLabel: string;
}) {
  const animCls = anim === "accepting" ? " accepting" : anim === "rejecting" ? " rejecting" : "";
  return (
    <div id={`proposal-${p.id}`} className={`proposal-block${animCls}`}>
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
  p, busy, anim, onAccept, onReject, fieldLabel,
}: {
  p: ProposedUpdate;
  busy: boolean;
  anim: AnimKind;
  onAccept: () => void;
  onReject: () => void;
  fieldLabel: string;
}) {
  const values = toList(p.proposed_value);
  const animCls = anim === "accepting" ? " accepting" : anim === "rejecting" ? " rejecting" : "";
  return (
    <li id={`proposal-${p.id}`} className={`proposal-row${animCls}`}>
      <div className="proposal-row-inner">
        <span className="proposal-row-plus" aria-hidden>+</span>
        <div className="proposal-row-body">
          {values.map((v, i) => (
            <div key={i} className="proposal-row-value">{v}</div>
          ))}
          {p.rationale && <div className="proposal-block-rationale" style={{ marginTop: 3, padding: 0 }}>{p.rationale}</div>}
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
  // Animation state — which proposal id is currently animating, and
  // which kind (accepting → checkmark burst + collapse, rejecting →
  // shake + slide-out). Cleared when the animation + API both finish.
  const [anim, setAnim] = useState<{ id: string; kind: "accepting" | "rejecting" } | null>(null);
  // Compact header state — chips + meta collapse once the body scrolls
  // past ~24px. Hysteresis (24 down, 4 up) so a 1-pixel jiggle near the
  // boundary doesn't toggle the class repeatedly.
  const [compact, setCompact] = useState(false);
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
    setAnim({ id, kind: "accepting" });
    // Hold the proposal in the DOM for the full 800ms animation
    // sequence — pulse → checkmark burst → collapse. The API call
    // runs in parallel so we don't introduce latency.
    const animDelay = new Promise<void>((r) => setTimeout(r, 760));
    try {
      await Promise.all([animDelay, onAccept(id)]);
    } finally {
      setBusy(null);
      setAnim(null);
    }
  }

  async function handleReject(id: string, reason: string) {
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

  function animFor(id: string): AnimKind {
    return anim?.id === id ? anim.kind : null;
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

  const blockedBy = req.blocked_by || [];
  const alternatives = req.alternatives_considered || [];
  const rationale = (req.rationale || "").trim();
  const scopeNote = (req.scope_note || "").trim();
  const userPerspective = (req.user_perspective || "").trim();

  const ageStr = formatAge(req.created_at);
  const mergedFromCount = (req.version || 1) > 1 ? 1 + (req.sources?.length || 0) : 0;

  function onBodyScroll(e: React.UIEvent<HTMLDivElement>) {
    const top = e.currentTarget.scrollTop;
    setCompact((wasCompact) => {
      if (wasCompact && top < 4) return false;
      if (!wasCompact && top > 24) return true;
      return wasCompact;
    });
  }

  return (
    <div className={`req-detail${compact ? " compact" : ""}`}>
      {/* Hero — 4 stacked rows: top (back/id/menu) → title → chip trio → meta */}
      <div className="req-detail-hero">
        <div className="req-detail-hero-top">
          <button type="button" className="req-detail-back" onClick={onClose} aria-label="Back">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <span className="req-detail-id-pair">
            <span className="id">{req.req_id}</span>
            <span className="v">v{req.version || 1}</span>
          </span>
          <HeroOverflowMenu
            displayId={req.req_id}
            onCopyId={() => navigator.clipboard.writeText(req.req_id)}
            onCopyLink={() => {
              try { navigator.clipboard.writeText(window.location.href); } catch {}
            }}
          />
        </div>

        <h1 className="req-detail-title-h1">{req.title}</h1>

        <div className="req-detail-hero-chips">
          {req.priority && <span className={`pri ${req.priority}`}>{req.priority}</span>}
          {req.status && (
            <span className={statusChipClasses(req.status)}>
              {req.status !== "confirmed" && req.status !== "resolved" && <span className="dot" />}
              {req.status}
            </span>
          )}
          {req.confidence && <span className="chip xs">{req.confidence} confidence</span>}
        </div>

        <div className="req-detail-hero-meta">
          {req.source_doc && (
            <SourceBlock
              filename={req.source_doc}
              docId={req.source_doc_id}
              mergedCount={mergedFromCount}
              onLinkClick={onLinkClick}
            />
          )}
          {ageStr && (
            <span title={req.created_at ? new Date(req.created_at).toLocaleString() : undefined}>
              Raised {ageStr}
            </span>
          )}
          {req.source_person && (
            <>
              <span className="sep">·</span>
              <span>by <strong>{req.source_person}</strong></span>
            </>
          )}
        </div>
      </div>

      {/* Action buttons */}
      {actions && actions.length > 0 && (
        <div className="req-detail-actions">
          <span className="label">Set status</span>
          {actions.map((action) => {
            const cls = statusActionClass(action.value, action.label);
            return (
              <button
                key={`${action.value}-${action.label}`}
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
      <div className="req-detail-body" ref={bodyRef} onScroll={onBodyScroll}>
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

            <div className="req-detail-content-card" style={{ fontSize: 13, lineHeight: 1.7, color: "var(--ink)" }}>
              <FieldSection
                label="Description"
                stringProposal={stringProposal("description")}
                fieldLabel="description"
                busyId={busy} animState={anim}
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
                  busyId={busy} animState={anim}
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
                  busyId={busy} animState={anim}
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
                              busy={busy === p.id} anim={animFor(p.id)}
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
                              busy={busy === p.id} anim={animFor(p.id)}
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
                              busy={busy === p.id} anim={animFor(p.id)}
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
                              busy={busy === p.id} anim={animFor(p.id)}
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
                        busy={busy === p.id} anim={animFor(p.id)}
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
                              busy={busy === p.id} anim={animFor(p.id)}
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
                        busy={busy === p.id} anim={animFor(p.id)}
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
                  <SourceCitation
                    quote={req.source_quote}
                    filename={req.source_doc}
                    docId={req.source_doc_id}
                    onLinkClick={onLinkClick}
                  />
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
                      busy={busy === p.id} anim={animFor(p.id)}
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


function SourceCitation({
  quote, filename, docId, onLinkClick,
}: {
  quote?: string | null;
  filename?: string | null;
  docId?: string | null;
  onLinkClick?: (href: string) => boolean | void;
}) {
  if (!quote && !filename) return null;
  const clickable = !!filename && !!docId && !!onLinkClick;
  const FileIcon = (
    <svg className="file-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
  const OpenArrow = (
    <svg className="open-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="13 6 19 12 13 18" />
    </svg>
  );

  const headerInner = (
    <>
      {FileIcon}
      <span className="file-name">{filename || "Source"}</span>
      {clickable && OpenArrow}
    </>
  );

  return (
    <div className="source-citation">
      {filename && (
        clickable ? (
          <a
            href={`doc://${docId}`}
            className="source-citation-header clickable"
            onClick={(e) => {
              if (!onLinkClick) return;
              const handled = onLinkClick(`doc://${docId}`);
              if (handled !== false) e.preventDefault();
            }}
          >
            {headerInner}
          </a>
        ) : (
          <div className="source-citation-header">{headerInner}</div>
        )
      )}
      {quote && (
        <div className="source-citation-body">{quote}</div>
      )}
    </div>
  );
}


function SourceBlock({
  filename, docId, mergedCount, onLinkClick,
}: {
  filename: string;
  docId?: string | null;
  mergedCount: number;
  onLinkClick?: (href: string) => boolean | void;
}) {
  const clickable = !!docId && !!onLinkClick;
  const Icon = (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
  const Body = (
    <>
      {Icon}
      <span>{filename}</span>
      {mergedCount > 0 && (
        <span className="merge-tag">+{mergedCount - 1} merged</span>
      )}
    </>
  );
  if (clickable) {
    return (
      <a
        href={`doc://${docId}`}
        className="req-detail-source-block clickable"
        title={`Open ${filename}${mergedCount > 1 ? ` · merged from ${mergedCount} docs` : ""}`}
        onClick={(e) => {
          if (!onLinkClick) return;
          const handled = onLinkClick(`doc://${docId}`);
          if (handled !== false) e.preventDefault();
        }}
      >
        {Body}
      </a>
    );
  }
  return (
    <span
      className="req-detail-source-block"
      title={mergedCount > 1 ? `${filename} · merged from ${mergedCount} docs` : filename}
    >
      {Body}
    </span>
  );
}


function HeroOverflowMenu({
  displayId, onCopyId, onCopyLink,
}: {
  displayId: string;
  onCopyId: () => void;
  onCopyLink: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative", marginLeft: "auto" }}>
      <button
        type="button"
        className="req-detail-overflow"
        onClick={() => setOpen((o) => !o)}
        aria-label="More actions"
        title="More actions"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="5" r="1.4" /><circle cx="12" cy="12" r="1.4" /><circle cx="12" cy="19" r="1.4" />
        </svg>
      </button>
      {open && (
        <div className="req-detail-overflow-menu" role="menu">
          <button type="button" onClick={() => { onCopyId(); setOpen(false); }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ width: 13, height: 13 }}>
              <rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
            Copy ID ({displayId})
          </button>
          <button type="button" onClick={() => { onCopyLink(); setOpen(false); }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ width: 13, height: 13 }}>
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </svg>
            Copy link
          </button>
        </div>
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
  animState,
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
  animState: { id: string; kind: "accepting" | "rejecting" } | null;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
  emptyLabel: string;
  hasLabelHeader: boolean;
}) {
  if (!current && !stringProposal) return null;
  const hasBoth = !!current && !!stringProposal;
  const proposalAnim: AnimKind = stringProposal && animState?.id === stringProposal.id ? animState.kind : null;
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
          anim={proposalAnim}
          onAccept={() => onAccept(stringProposal.id)}
          onReject={() => onReject(stringProposal.id)}
          fieldLabel={fieldLabel}
        />
      )}
    </>
  );
}
