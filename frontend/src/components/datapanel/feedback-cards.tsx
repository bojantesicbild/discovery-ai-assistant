"use client";

// Client-review feedback cards that render above a requirement or gap
// detail view: the closure banner, the standalone client-answer banner,
// and the pending-proposals diff list. Extracted from DataPanel.tsx so
// the main file can focus on orchestration.

import { useState } from "react";
import type {
  ReqClientFeedback,
  GapClientFeedback,
  ProposedUpdate,
} from "@/lib/api";


export interface GapResolution {
  kind: "resolved" | "dismissed";
  text: string;
  attribution?: string | null;
  closedAt?: string | null;
  closedBy?: string | null;
}


export function GapResolutionCard({ r, clientAnswer }: {
  r: GapResolution;
  clientAnswer?: GapClientFeedback;
}) {
  const isDismissed = r.kind === "dismissed";
  const label = isDismissed ? "Dismissed" : "Resolved";

  const when = r.closedAt ? new Date(r.closedAt).toLocaleString() : null;
  const who = r.closedBy || null;

  const answerWhen = clientAnswer?.submitted_at ? new Date(clientAnswer.submitted_at).toLocaleString() : null;
  const answerWho = clientAnswer?.client_name || "client";

  return (
    <div className={`resolution-banner ${r.kind}`}>
      <div className="resolution-banner-head">
        <span>{isDismissed ? "✕" : "✓"} {label}</span>
        {(when || who) && (
          <span className="sub">
            ·{when ? ` ${when}` : ""}{who ? ` by ${who}` : ""}
          </span>
        )}
      </div>
      {r.text && <div className="resolution-banner-body">{r.text}</div>}
      {r.attribution && !clientAnswer && (
        <div className="resolution-banner-attrib">— {r.attribution}</div>
      )}

      {clientAnswer?.answer && (
        <div className="resolution-evidence">
          <div className="resolution-evidence-label">Based on client answer</div>
          <div className="resolution-evidence-meta">
            {answerWho} · review round {clientAnswer.round}{answerWhen ? ` · ${answerWhen}` : ""}
          </div>
          <div className="resolution-evidence-quote">
            &ldquo;{clientAnswer.answer}&rdquo;
          </div>
        </div>
      )}
    </div>
  );
}


export function ClientFeedbackCard({ kind, fb }: {
  kind: "requirement" | "gap";
  fb: ReqClientFeedback | GapClientFeedback;
}) {
  const when = fb.submitted_at ? new Date(fb.submitted_at).toLocaleString() : null;
  const who = fb.client_name || "client";

  let label: string;
  let variant: string;
  let body: string | null;

  if (kind === "requirement") {
    const r = fb as ReqClientFeedback;
    if (r.action === "confirm") {
      label = "Confirmed by client";
      variant = "confirm";
    } else {
      label = "Flagged for discussion by client";
      variant = "discuss";
    }
    body = r.note;
  } else {
    const g = fb as GapClientFeedback;
    label = "Answered by client";
    variant = "answer";
    body = g.answer;
  }

  return (
    <div className={`feedback-card ${variant}`}>
      <div className="feedback-card-head">
        <span>{label}</span>
        <span className="sub">· {who} · review round {fb.round}{when ? ` · ${when}` : ""}</span>
      </div>
      {body && <div className="feedback-card-body">&ldquo;{body}&rdquo;</div>}
    </div>
  );
}


export type ProposalAction =
  | { kind: "accept"; overrideValue?: string | string[] }
  | { kind: "reject" };

export function InlineProposals({
  proposals,
  onAction,
}: {
  proposals: ProposedUpdate[];
  onAction: (id: string, decision: ProposalAction) => void | Promise<void>;
}) {
  const [editing, setEditing] = useState<Record<string, string>>({});

  if (proposals.length === 0) return null;

  return (
    <div className="inline-proposals">
      <div className="inline-proposals-notice">
        <strong>
          {proposals.length} pending update{proposals.length !== 1 ? "s" : ""}
        </strong>{" "}
        from recent client answers — accept to apply, reject to discard. Nothing is applied without your approval.
      </div>

      {proposals.map((p) => {
        const isList = p.proposed_field !== "description";
        const proposedList = Array.isArray(p.proposed_value) ? p.proposed_value : [String(p.proposed_value)];
        const currentList = Array.isArray(p.current_value) ? p.current_value : p.current_value ? [String(p.current_value)] : [];
        const fieldLabel = p.proposed_field.replace(/_/g, " ");
        const editVal = editing[p.id];
        const isEditing = editVal !== undefined;

        return (
          <div key={p.id} className="inline-proposal-card">
            <div className="inline-proposal-head">
              <span className="chip xs uppercase blue">{p.target_req_id}</span>
              <span className="inline-proposal-title">{p.req_title || "Requirement"}</span>
              <span className="inline-proposal-source">
                from {p.source_gap_id}{p.review_round ? ` · review round ${p.review_round}` : ""}
              </span>
            </div>

            {p.gap_question && (
              <div className="prop-card-qa">
                <strong>Question:</strong> {p.gap_question}
              </div>
            )}
            {p.client_answer && (
              <div className="prop-card-quote">{p.client_answer}</div>
            )}

            <div className="inline-proposal-section-label">
              Proposed change — {fieldLabel}
            </div>
            <div className="inline-proposal-diff-cols">
              <div>
                <div className="prop-diff-label current">Current</div>
                {currentList.length === 0 ? (
                  <div style={{ fontSize: 12, color: "var(--ink-4)", fontStyle: "italic" }}>(empty)</div>
                ) : (
                  <ul className="prop-diff-current-list">
                    {currentList.map((v, i) => <li key={i}>{v}</li>)}
                  </ul>
                )}
              </div>
              <div>
                <div className="prop-diff-label new">
                  {isList ? "+ Adding" : "Replacing with"}
                </div>
                {isEditing ? (
                  <textarea
                    className="inline-proposal-edit"
                    value={editVal}
                    onChange={(e) => setEditing((prev) => ({ ...prev, [p.id]: e.target.value }))}
                  />
                ) : (
                  <ul className="prop-diff-new-list">
                    {proposedList.map((v, i) => <li key={i}>{v}</li>)}
                  </ul>
                )}
              </div>
            </div>

            {p.rationale && !isEditing && (
              <div className="prop-rationale">{p.rationale}</div>
            )}

            <div className="inline-proposal-actions">
              <button
                type="button"
                className="btn-accept"
                onClick={() => {
                  const override = isEditing
                    ? (isList ? editVal.split("\n").map((s) => s.trim()).filter(Boolean) : editVal)
                    : undefined;
                  onAction(p.id, { kind: "accept", overrideValue: override });
                  setEditing((prev) => {
                    const next = { ...prev };
                    delete next[p.id];
                    return next;
                  });
                }}
              >{isEditing ? "✓ Save & accept" : "Accept"}</button>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => {
                  if (isEditing) {
                    setEditing((prev) => {
                      const next = { ...prev };
                      delete next[p.id];
                      return next;
                    });
                  } else {
                    const initial = isList ? proposedList.join("\n") : String(p.proposed_value);
                    setEditing((prev) => ({ ...prev, [p.id]: initial }));
                  }
                }}
                style={{
                  padding: "6px 14px", borderRadius: 8, fontSize: 12, fontWeight: 600,
                }}
              >{isEditing ? "Cancel edit" : "Edit"}</button>
              <button
                type="button"
                className="btn-reject"
                onClick={() => onAction(p.id, { kind: "reject" })}
              >Reject</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
