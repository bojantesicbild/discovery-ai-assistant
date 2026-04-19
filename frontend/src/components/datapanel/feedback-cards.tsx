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


/** Shape used by both the gap-detail slot and GapResolutionCard. Keeping
 *  the definition here lets DataPanel reference it without exporting its
 *  private DetailView interface. */
export interface GapResolution {
  kind: "resolved" | "dismissed";
  text: string;
  attribution?: string | null;
  closedAt?: string | null;
  closedBy?: string | null;
}


export function GapResolutionCard({ r, clientAnswer }: {
  r: GapResolution;
  /** When the gap also has a client answer, nest it as the supporting
   *  evidence that led to the resolution. Collapses two cards into one. */
  clientAnswer?: GapClientFeedback;
}) {
  const isDismissed = r.kind === "dismissed";
  const label = isDismissed ? "Dismissed" : "Resolved";
  const color = isDismissed ? "#6b7280" : "#047857";
  const bg = isDismissed ? "#f3f4f6" : "#d1fae5";
  const border = isDismissed ? "#e5e7eb" : "#a7f3d0";

  const when = r.closedAt ? new Date(r.closedAt).toLocaleString() : null;
  const who = r.closedBy || null;

  const answerWhen = clientAnswer?.submitted_at ? new Date(clientAnswer.submitted_at).toLocaleString() : null;
  const answerWho = clientAnswer?.client_name || "client";

  return (
    <div style={{
      marginBottom: 12, borderRadius: 10,
      background: bg, border: `1px solid ${border}`,
      padding: "10px 14px",
    }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
        fontSize: 12, fontWeight: 700, color, marginBottom: r.text ? 6 : 0,
      }}>
        <span>{isDismissed ? "✕" : "✓"} {label}</span>
        {(when || who) && (
          <span style={{ fontWeight: 500, opacity: 0.75 }}>
            ·{when ? ` ${when}` : ""}{who ? ` by ${who}` : ""}
          </span>
        )}
      </div>
      {r.text && (
        <div style={{
          fontSize: 13, color: "var(--dark)", lineHeight: 1.55,
          whiteSpace: "pre-wrap",
        }}>
          {r.text}
        </div>
      )}
      {r.attribution && !clientAnswer && (
        <div style={{
          fontSize: 11, color: "var(--gray-500)", marginTop: 6, fontStyle: "italic",
        }}>
          — {r.attribution}
        </div>
      )}

      {/* Nested client answer — shown as supporting evidence when both exist */}
      {clientAnswer?.answer && (
        <div style={{
          marginTop: 10, paddingTop: 10,
          borderTop: `1px dashed ${border}`,
        }}>
          <div style={{
            fontSize: 10, fontWeight: 700, letterSpacing: 0.5,
            textTransform: "uppercase", color: "var(--gray-500)",
            marginBottom: 4,
          }}>
            Based on client answer
          </div>
          <div style={{
            fontSize: 11, color: "var(--gray-500)", marginBottom: 4,
          }}>
            {answerWho} · review round {clientAnswer.round}{answerWhen ? ` · ${answerWhen}` : ""}
          </div>
          <div style={{
            fontSize: 13, color: "var(--dark)", lineHeight: 1.5,
            fontStyle: "italic", whiteSpace: "pre-wrap",
          }}>
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
  let color: string;
  let bg: string;
  let border: string;
  let body: string | null;

  if (kind === "requirement") {
    const r = fb as ReqClientFeedback;
    if (r.action === "confirm") {
      label = "Confirmed by client";
      color = "#047857"; bg = "#d1fae5"; border = "#a7f3d0";
    } else {
      label = "Flagged for discussion by client";
      color = "#b45309"; bg = "#fef3c7"; border = "#fde68a";
    }
    body = r.note;
  } else {
    const g = fb as GapClientFeedback;
    label = "Answered by client";
    color = "#1d4ed8"; bg = "#dbeafe"; border = "#bfdbfe";
    body = g.answer;
  }

  return (
    <div style={{
      marginBottom: 12, borderRadius: 10,
      background: bg, border: `1px solid ${border}`,
      padding: "10px 14px",
    }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
        fontSize: 12, fontWeight: 700, color, marginBottom: body ? 6 : 0,
      }}>
        <span>{label}</span>
        <span style={{ fontWeight: 500, opacity: 0.75 }}>
          · {who} · review round {fb.round}{when ? ` · ${when}` : ""}
        </span>
      </div>
      {body && (
        <div style={{
          fontSize: 13, color: "var(--dark)", lineHeight: 1.55,
          whiteSpace: "pre-wrap", fontStyle: "italic",
        }}>
          &ldquo;{body}&rdquo;
        </div>
      )}
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
    <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
      <div style={{
        padding: "10px 14px", borderRadius: 10,
        background: "#eff6ff", border: "1px solid #bfdbfe",
        fontSize: 12, color: "#1e40af", lineHeight: 1.5,
      }}>
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
          <div
            key={p.id}
            style={{
              background: "#fff", borderRadius: 12, padding: 16,
              border: "1px solid var(--gray-200)",
              display: "flex", flexDirection: "column", gap: 10,
            }}
          >
            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{
                fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 10,
                background: "#dbeafe", color: "#1d4ed8", border: "1px solid #bfdbfe",
                letterSpacing: 0.3,
              }}>{p.target_req_id}</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--dark)" }}>
                {p.req_title || "Requirement"}
              </span>
              <span style={{ marginLeft: "auto", fontSize: 10, color: "var(--gray-500)" }}>
                from {p.source_gap_id}{p.review_round ? ` · review round ${p.review_round}` : ""}
              </span>
            </div>

            {/* Gap question + client answer */}
            {p.gap_question && (
              <div style={{ fontSize: 12, color: "var(--gray-600)" }}>
                <strong>Question:</strong> {p.gap_question}
              </div>
            )}
            {p.client_answer && (
              <div style={{
                fontSize: 12, color: "var(--gray-600)",
                borderLeft: "3px solid var(--green)",
                padding: "6px 10px", background: "var(--green-light)",
                borderRadius: "0 6px 6px 0",
              }}>
                {p.client_answer}
              </div>
            )}

            {/* Proposed patch */}
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--gray-500)", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 4 }}>
              Proposed change — {fieldLabel}
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {/* Current */}
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontSize: 10, color: "var(--gray-500)", marginBottom: 4 }}>Current</div>
                {currentList.length === 0 ? (
                  <div style={{ fontSize: 12, color: "var(--gray-400)", fontStyle: "italic" }}>(empty)</div>
                ) : (
                  <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: "var(--gray-600)" }}>
                    {currentList.map((v, i) => <li key={i}>{v}</li>)}
                  </ul>
                )}
              </div>
              {/* Proposed */}
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontSize: 10, color: "#059669", marginBottom: 4, fontWeight: 600 }}>
                  {isList ? "+ Adding" : "Replacing with"}
                </div>
                {isEditing ? (
                  <textarea
                    value={editVal}
                    onChange={(e) => setEditing((prev) => ({ ...prev, [p.id]: e.target.value }))}
                    style={{
                      width: "100%", minHeight: 60, padding: "8px 10px",
                      borderRadius: 6, border: "1px solid var(--gray-200)",
                      fontSize: 12, fontFamily: "var(--font)", resize: "vertical",
                    }}
                  />
                ) : (
                  <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: "#047857", fontWeight: 500 }}>
                    {proposedList.map((v, i) => <li key={i}>{v}</li>)}
                  </ul>
                )}
              </div>
            </div>

            {p.rationale && !isEditing && (
              <div style={{ fontSize: 11, color: "var(--gray-500)", fontStyle: "italic" }}>
                {p.rationale}
              </div>
            )}

            {/* Actions */}
            <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
              <button
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
                style={{
                  padding: "6px 14px", borderRadius: 8, border: "none",
                  background: "var(--green)", color: "var(--dark)",
                  fontSize: 12, fontWeight: 700, cursor: "pointer",
                  fontFamily: "var(--font)",
                }}
              >{isEditing ? "✓ Save & accept" : "Accept"}</button>
              <button
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
                  padding: "6px 14px", borderRadius: 8,
                  border: "1px solid var(--gray-200)", background: "#fff",
                  color: "var(--gray-600)",
                  fontSize: 12, fontWeight: 600, cursor: "pointer",
                  fontFamily: "var(--font)",
                }}
              >{isEditing ? "Cancel edit" : "Edit"}</button>
              <button
                onClick={() => onAction(p.id, { kind: "reject" })}
                style={{
                  padding: "6px 14px", borderRadius: 8,
                  border: "1px solid #fecaca", background: "#fff",
                  color: "#dc2626",
                  fontSize: 12, fontWeight: 600, cursor: "pointer",
                  fontFamily: "var(--font)",
                }}
              >Reject</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
