"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface Requirement {
  req_id: string;
  title: string;
  priority: string;
  description: string;
  user_perspective?: string;
  business_rules?: string[];
  status: string;
}

interface Gap {
  gap_id: string;
  question: string;
  severity: string;
  area: string;
  blocked_reqs?: string[];
  suggested_action?: string;
}

interface ReviewData {
  project_name: string;
  client_name?: string;
  round_number: number;
  already_submitted: boolean;
  requirements: Record<string, Requirement[]>;
  gaps: Gap[];
}

type ReqAction = "confirm" | "discuss" | "skip";
type GapActionType = "answer" | "skip";

const PRIORITY_ORDER = ["must", "should", "could", "wont"];
const PRIORITY_LABELS: Record<string, string> = {
  must: "Must Have",
  should: "Should Have",
  could: "Could Have",
  wont: "Won't Have",
};
const PRIORITY_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  must: { bg: "#fef2f2", text: "#dc2626", border: "#fecaca" },
  should: { bg: "#fffbeb", text: "#d97706", border: "#fde68a" },
  could: { bg: "#eff6ff", text: "#2563eb", border: "#bfdbfe" },
  wont: { bg: "#f9fafb", text: "#6b7280", border: "#e5e7eb" },
};

export default function ClientReviewPage() {
  const params = useParams();
  const token = params.token as string;

  const [data, setData] = useState<ReviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [reqActions, setReqActions] = useState<Record<string, ReqAction>>({});
  const [reqNotes, setReqNotes] = useState<Record<string, string>>({});
  const [gapActions, setGapActions] = useState<Record<string, GapActionType>>({});
  const [gapAnswers, setGapAnswers] = useState<Record<string, string>>({});

  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitResult, setSubmitResult] = useState<{
    confirmed: number; discussed: number; gaps_answered: number; readiness_score?: number;
  } | null>(null);

  useEffect(() => {
    fetch(`${API_URL}/api/review/${token}`)
      .then(async (r) => {
        if (!r.ok) {
          const err = await r.json().catch(() => ({ detail: "Link is invalid or has expired." }));
          throw new Error(err.detail);
        }
        return r.json();
      })
      .then((d) => { setData(d); if (d.already_submitted) setSubmitted(true); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [token]);

  async function handleSubmit() {
    if (!data) return;
    setSubmitting(true);
    try {
      const allReqs = Object.values(data.requirements).flat();
      const res = await fetch(`${API_URL}/api/review/${token}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requirement_actions: allReqs.map((r) => ({
            req_id: r.req_id,
            action: reqActions[r.req_id] || "skip",
            note: reqNotes[r.req_id] || null,
          })),
          gap_actions: data.gaps.map((g) => ({
            gap_id: g.gap_id,
            action: gapActions[g.gap_id] || "skip",
            answer: gapAnswers[g.gap_id] || null,
          })),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Submission failed" }));
        throw new Error(err.detail);
      }
      const result = await res.json();
      setSubmitResult(result);
      setSubmitted(true);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  const totalReqs = data ? Object.values(data.requirements).flat().length : 0;
  const actedOn = Object.values(reqActions).filter((a) => a !== "skip").length
    + Object.values(gapActions).filter((a) => a !== "skip").length;

  // Override the app-wide body overflow:hidden for this standalone page
  useEffect(() => {
    document.body.style.overflow = "auto";
    document.body.style.height = "auto";
    return () => {
      document.body.style.overflow = "";
      document.body.style.height = "";
    };
  }, []);

  // ── Loading / Error / Submitted states ──
  if (loading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f8fafc" }}>
        <div style={{ textAlign: "center", color: "#94a3b8" }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>Loading review...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f8fafc" }}>
        <div style={{ textAlign: "center", maxWidth: 400, padding: 40 }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🔒</div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: "#0f172a", marginBottom: 8 }}>Link unavailable</h1>
          <p style={{ fontSize: 14, color: "#64748b", lineHeight: 1.6 }}>{error}</p>
          <p style={{ fontSize: 12, color: "#94a3b8", marginTop: 16 }}>Contact your project manager for a new link.</p>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f8fafc" }}>
        <div style={{ textAlign: "center", maxWidth: 480, padding: 40 }}>
          <div style={{ width: 64, height: 64, borderRadius: "50%", background: "#d1fae5", color: "#059669", margin: "0 auto 20px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28 }}>✓</div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "#0f172a", marginBottom: 8 }}>Thank you for your review!</h1>
          <p style={{ fontSize: 14, color: "#64748b", lineHeight: 1.6, marginBottom: 20 }}>
            Your project manager has been notified and will follow up on any items you flagged for discussion.
          </p>
          {submitResult && (
            <div style={{ display: "flex", gap: 16, justifyContent: "center", marginBottom: 20 }}>
              <StatPill label="Confirmed" value={submitResult.confirmed} color="#059669" />
              <StatPill label="For discussion" value={submitResult.discussed} color="#d97706" />
              <StatPill label="Gaps answered" value={submitResult.gaps_answered} color="#2563eb" />
            </div>
          )}
          {submitResult?.readiness_score !== undefined && (
            <div style={{ fontSize: 13, color: "#64748b" }}>
              Project readiness: <strong style={{ color: "#0f172a" }}>{submitResult.readiness_score}%</strong>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (!data) return null;

  // ── Main review view ──
  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc" }}>
      {/* Header */}
      <div style={{
        position: "sticky", top: 0, zIndex: 50,
        background: "#fff", borderBottom: "1px solid #e2e8f0",
        padding: "16px 24px",
        display: "flex", alignItems: "center", gap: 16,
      }}>
        <div style={{
          width: 40, height: 40, borderRadius: 10, background: "#00E5A0",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontWeight: 800, color: "#0f172a", fontSize: 16,
        }}>C</div>
        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: 16, fontWeight: 700, color: "#0f172a", margin: 0 }}>
            {data.project_name}
          </h1>
          <div style={{ fontSize: 12, color: "#64748b" }}>
            Review round {data.round_number}{data.client_name && ` · ${data.client_name}`}
          </div>
        </div>
        <div style={{ fontSize: 12, color: "#64748b" }}>
          {actedOn} of {totalReqs + data.gaps.length} items reviewed
        </div>
      </div>

      {/* Content */}
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "24px 16px 120px" }}>
        {/* Instructions */}
        <div style={{
          padding: 16, borderRadius: 12, background: "#fff",
          border: "1px solid #e2e8f0", marginBottom: 24,
        }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: "#0f172a", marginBottom: 6 }}>
            How this works
          </div>
          <div style={{ fontSize: 13, color: "#64748b", lineHeight: 1.6 }}>
            Review each requirement below. Click <strong style={{ color: "#059669" }}>Confirm</strong> if it&rsquo;s
            correct, <strong style={{ color: "#d97706" }}>Discuss</strong> if something needs clarification, or
            leave it as-is to skip. For open questions, provide your answer if you can.
            Click <strong>Submit</strong> when you&rsquo;re done.
          </div>
        </div>

        {/* Requirements by priority */}
        {PRIORITY_ORDER.map((priority) => {
          const reqs = data.requirements[priority] || [];
          if (reqs.length === 0) return null;
          const colors = PRIORITY_COLORS[priority];
          return (
            <div key={priority} style={{ marginBottom: 24 }}>
              <div style={{
                display: "flex", alignItems: "center", gap: 8, marginBottom: 12,
              }}>
                <span style={{
                  fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 12,
                  background: colors.bg, color: colors.text, border: `1px solid ${colors.border}`,
                  textTransform: "uppercase", letterSpacing: 0.5,
                }}>
                  {PRIORITY_LABELS[priority]}
                </span>
                <span style={{ fontSize: 12, color: "#94a3b8" }}>{reqs.length} item{reqs.length !== 1 ? "s" : ""}</span>
              </div>

              {reqs.map((req) => {
                const action = reqActions[req.req_id];
                return (
                  <div key={req.req_id} style={{
                    background: "#fff", borderRadius: 12, padding: 18,
                    border: action === "confirm" ? "2px solid #059669" : action === "discuss" ? "2px solid #d97706" : "1px solid #e2e8f0",
                    marginBottom: 10, transition: "border 0.15s",
                  }}>
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 10, color: "#94a3b8", fontFamily: "monospace", marginBottom: 4 }}>{req.req_id}</div>
                        <div style={{ fontSize: 14, fontWeight: 600, color: "#0f172a", marginBottom: 6 }}>{req.title}</div>
                        <div style={{ fontSize: 13, color: "#475569", lineHeight: 1.6 }}>{req.description}</div>
                        {req.user_perspective && (
                          <div style={{ fontSize: 12, color: "#64748b", marginTop: 6, fontStyle: "italic" }}>{req.user_perspective}</div>
                        )}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                      <ActionBtn
                        label="Confirm"
                        active={action === "confirm"}
                        color="#059669"
                        bg="#d1fae5"
                        onClick={() => setReqActions((prev) => ({ ...prev, [req.req_id]: action === "confirm" ? "skip" : "confirm" }))}
                      />
                      <ActionBtn
                        label="Discuss"
                        active={action === "discuss"}
                        color="#d97706"
                        bg="#fef3c7"
                        onClick={() => setReqActions((prev) => ({ ...prev, [req.req_id]: action === "discuss" ? "skip" : "discuss" }))}
                      />
                    </div>
                    {action === "discuss" && (
                      <textarea
                        value={reqNotes[req.req_id] || ""}
                        onChange={(e) => setReqNotes((prev) => ({ ...prev, [req.req_id]: e.target.value }))}
                        placeholder="What needs clarification?"
                        style={{
                          width: "100%", marginTop: 10, padding: "10px 12px",
                          borderRadius: 8, border: "1px solid #fde68a",
                          background: "#fffbeb", fontSize: 13, resize: "vertical",
                          minHeight: 60, fontFamily: "var(--font)", outline: "none",
                        }}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}

        {/* Gaps */}
        {data.gaps.length > 0 && (
          <div style={{ marginBottom: 24 }}>
            <div style={{
              display: "flex", alignItems: "center", gap: 8, marginBottom: 12,
            }}>
              <span style={{
                fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 12,
                background: "#fef2f2", color: "#dc2626", border: "1px solid #fecaca",
                textTransform: "uppercase", letterSpacing: 0.5,
              }}>
                Open Questions
              </span>
              <span style={{ fontSize: 12, color: "#94a3b8" }}>{data.gaps.length} item{data.gaps.length !== 1 ? "s" : ""}</span>
            </div>

            {data.gaps.map((gap) => {
              const action = gapActions[gap.gap_id];
              return (
                <div key={gap.gap_id} style={{
                  background: "#fff", borderRadius: 12, padding: 18,
                  border: action === "answer" ? "2px solid #2563eb" : "1px solid #e2e8f0",
                  marginBottom: 10,
                }}>
                  <div style={{ fontSize: 10, color: "#94a3b8", fontFamily: "monospace", marginBottom: 4 }}>{gap.gap_id}</div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "#0f172a", marginBottom: 6 }}>{gap.question}</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                    <span style={{
                      fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 8,
                      background: gap.severity === "high" ? "#fef2f2" : "#fef3c7",
                      color: gap.severity === "high" ? "#dc2626" : "#d97706",
                    }}>{gap.severity}</span>
                    <span style={{ fontSize: 10, color: "#94a3b8" }}>{gap.area}</span>
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                    <ActionBtn
                      label="I can answer this"
                      active={action === "answer"}
                      color="#2563eb"
                      bg="#dbeafe"
                      onClick={() => setGapActions((prev) => ({ ...prev, [gap.gap_id]: action === "answer" ? "skip" : "answer" }))}
                    />
                  </div>
                  {action === "answer" && (
                    <textarea
                      value={gapAnswers[gap.gap_id] || ""}
                      onChange={(e) => setGapAnswers((prev) => ({ ...prev, [gap.gap_id]: e.target.value }))}
                      placeholder="Your answer..."
                      style={{
                        width: "100%", marginTop: 10, padding: "10px 12px",
                        borderRadius: 8, border: "1px solid #bfdbfe",
                        background: "#eff6ff", fontSize: 13, resize: "vertical",
                        minHeight: 60, fontFamily: "var(--font)", outline: "none",
                      }}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Sticky footer */}
      <div style={{
        position: "fixed", bottom: 0, left: 0, right: 0,
        background: "#fff", borderTop: "1px solid #e2e8f0",
        padding: "12px 24px",
        display: "flex", alignItems: "center", justifyContent: "center", gap: 16,
      }}>
        <div style={{ fontSize: 12, color: "#64748b" }}>
          {actedOn > 0 ? `${actedOn} item${actedOn !== 1 ? "s" : ""} reviewed` : "Review items above, then submit"}
        </div>
        <button
          onClick={handleSubmit}
          disabled={submitting || actedOn === 0}
          style={{
            padding: "10px 28px", borderRadius: 10, border: "none",
            background: actedOn === 0 ? "#e2e8f0" : "#00E5A0",
            color: actedOn === 0 ? "#94a3b8" : "#0f172a",
            fontSize: 14, fontWeight: 700, cursor: actedOn === 0 ? "default" : "pointer",
            fontFamily: "var(--font)",
            boxShadow: actedOn > 0 ? "0 2px 8px rgba(0,229,160,0.3)" : "none",
          }}
        >
          {submitting ? "Submitting..." : "Submit Review"}
        </button>
      </div>
    </div>
  );
}


function ActionBtn({ label, active, color, bg, onClick }: {
  label: string; active: boolean; color: string; bg: string; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "6px 14px", borderRadius: 8,
        border: active ? `2px solid ${color}` : "1px solid #e2e8f0",
        background: active ? bg : "#fff",
        color: active ? color : "#64748b",
        fontSize: 12, fontWeight: 600, cursor: "pointer",
        fontFamily: "var(--font)", transition: "all 0.15s",
      }}
    >
      {active ? "✓ " : ""}{label}
    </button>
  );
}


function StatPill({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontSize: 22, fontWeight: 800, color }}>{value}</div>
      <div style={{ fontSize: 11, color: "#64748b" }}>{label}</div>
    </div>
  );
}
