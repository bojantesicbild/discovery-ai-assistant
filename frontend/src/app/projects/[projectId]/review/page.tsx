"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8008";

interface ReviewToken {
  id: string;
  token: string;
  label: string | null;
  client_name: string | null;
  client_email: string | null;
  expires_at: string;
  revoked_at: string | null;
  submitted_at: string | null;
  round_number: number;
  created_at: string | null;
  shareable_url: string;
}

interface Submission {
  id: string;
  round_number: number;
  client_name: string | null;
  submitted_at: string | null;
  confirmed: number;
  discussed: number;
  gaps_answered: number;
  requirement_actions?: { req_id: string; action: string; note?: string }[];
  gap_actions?: { gap_id: string; action: string; answer?: string }[];
}

function fetchAuth(path: string, options: RequestInit = {}) {
  const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
  return fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...((options.headers as Record<string, string>) || {}),
    },
  });
}

export default function ReviewManagementPage() {
  const params = useParams();
  const projectId = params.projectId as string;

  const [tokens, setTokens] = useState<ReviewToken[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [expandedSub, setExpandedSub] = useState<string | null>(null);

  // Create form
  const [clientName, setClientName] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [label, setLabel] = useState("");
  const [expiresDays, setExpiresDays] = useState(7);

  useEffect(() => { loadData(); }, [projectId]);

  async function loadData() {
    try {
      const [tokensRes, subsRes] = await Promise.all([
        fetchAuth(`/api/projects/${projectId}/review-tokens`),
        fetchAuth(`/api/projects/${projectId}/review-submissions`),
      ]);
      if (tokensRes.ok) { const d = await tokensRes.json(); setTokens(d.tokens || []); }
      if (subsRes.ok) { const d = await subsRes.json(); setSubmissions(d.submissions || []); }
    } catch {}
    setLoading(false);
  }

  async function handleCreate() {
    setCreating(true);
    try {
      const res = await fetchAuth(`/api/projects/${projectId}/review-tokens`, {
        method: "POST",
        body: JSON.stringify({
          label: label || undefined,
          client_name: clientName || undefined,
          client_email: clientEmail || undefined,
          expires_in_days: expiresDays,
        }),
      });
      if (res.ok) { setShowCreate(false); setClientName(""); setClientEmail(""); setLabel(""); loadData(); }
    } catch {}
    setCreating(false);
  }

  async function handleRevoke(tokenId: string) {
    if (!confirm("Revoke this review link? The client will no longer be able to access it.")) return;
    await fetchAuth(`/api/projects/${projectId}/review-tokens/${tokenId}`, { method: "DELETE" });
    loadData();
  }

  function copyUrl(url: string, id: string) {
    navigator.clipboard.writeText(url);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  }

  function tokenStatus(t: ReviewToken): { label: string; color: string; bg: string; icon: string } {
    if (t.submitted_at) return { label: "Submitted", color: "#059669", bg: "#d1fae5", icon: "M5 13l4 4L19 7" };
    if (t.revoked_at) return { label: "Revoked", color: "#dc2626", bg: "#fee2e2", icon: "M6 18L18 6M6 6l12 12" };
    if (new Date(t.expires_at) < new Date()) return { label: "Expired", color: "#d97706", bg: "#fef3c7", icon: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" };
    return { label: "Active", color: "#2563eb", bg: "#dbeafe", icon: "M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101" };
  }

  function formatDate(d: string | null) {
    if (!d) return "";
    const date = new Date(d);
    const diff = Date.now() - date.getTime();
    const days = Math.floor(diff / 86400000);
    if (days === 0) return "Today";
    if (days === 1) return "Yesterday";
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  }

  // Stats
  const totalRounds = tokens.length;
  const submittedCount = tokens.filter(t => t.submitted_at).length;
  const activeCount = tokens.filter(t => !t.revoked_at && !t.submitted_at && new Date(t.expires_at) >= new Date()).length;
  const totalConfirmed = submissions.reduce((sum, s) => sum + s.confirmed, 0);
  const totalDiscussed = submissions.reduce((sum, s) => sum + s.discussed, 0);
  const totalGapsAnswered = submissions.reduce((sum, s) => sum + s.gaps_answered, 0);

  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "9px 14px", borderRadius: 8,
    border: "1px solid var(--gray-200)", fontSize: 13,
    fontFamily: "var(--font)", outline: "none",
  };

  if (loading) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#94a3b8" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ width: 32, height: 32, border: "3px solid var(--gray-200)", borderTopColor: "var(--green)", borderRadius: "50%", animation: "spin 0.8s linear infinite", margin: "0 auto 12px" }} />
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          <span style={{ fontSize: 13 }}>Loading reviews...</span>
        </div>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, overflow: "auto" }}>
      <div style={{ padding: "24px 28px" }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: 14, marginBottom: 24 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 10,
            background: "linear-gradient(135deg, var(--green), #059669)",
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          }}>
            <svg viewBox="0 0 24 24" style={{ width: 20, height: 20, stroke: "#fff", fill: "none", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" }}>
              <path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
              <circle cx="8.5" cy="7" r="4" />
              <path d="M20 8v6M23 11h-6" />
            </svg>
          </div>
          <div style={{ flex: 1 }}>
            <h1 style={{ fontSize: 20, fontWeight: 800, color: "var(--dark)", margin: 0 }}>Client Review</h1>
            <p style={{ fontSize: 12, color: "var(--gray-500)", margin: "2px 0 0" }}>
              Generate secure review links for clients to confirm requirements and answer open gaps.
            </p>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="btn-primary"
            style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "9px 18px", borderRadius: 10, border: "none",
              background: "var(--green)", color: "var(--dark)",
              fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "var(--font)",
              boxShadow: "0 2px 8px rgba(0,229,160,0.25)",
            }}
          >
            <svg viewBox="0 0 24 24" style={{ width: 14, height: 14, stroke: "currentColor", fill: "none", strokeWidth: 2.5 }}>
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Generate Link
          </button>
        </div>

        {/* Stats row */}
        {totalRounds > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 24 }}>
            {[
              { label: "Total Rounds", value: totalRounds, color: "var(--dark)" },
              { label: "Awaiting", value: activeCount, color: "#2563eb" },
              { label: "Confirmed", value: totalConfirmed, color: "#059669" },
              { label: "Gaps Answered", value: totalGapsAnswered, color: "#8b5cf6" },
            ].map((stat) => (
              <div key={stat.label} style={{
                padding: "14px 16px", borderRadius: 10,
                background: "#fff", border: "1px solid var(--gray-200)",
              }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: "var(--gray-500)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>
                  {stat.label}
                </div>
                <div style={{ fontSize: 24, fontWeight: 800, color: stat.color, lineHeight: 1 }}>{stat.value}</div>
              </div>
            ))}
          </div>
        )}

        {/* Create form */}
        {showCreate && (
          <div style={{
            padding: 22, borderRadius: 12, border: "1px solid var(--green)",
            background: "#fff", marginBottom: 24,
            boxShadow: "0 4px 16px rgba(0,229,160,0.08)",
          }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "var(--dark)", marginBottom: 16 }}>New Review Link</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: "var(--gray-600)", display: "block", marginBottom: 4 }}>Client name</label>
                <input value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="e.g. Sarah Chen" style={inputStyle}
                  onFocus={e => e.target.style.borderColor = "var(--green)"} onBlur={e => e.target.style.borderColor = "var(--gray-200)"} />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: "var(--gray-600)", display: "block", marginBottom: 4 }}>Client email <span style={{ color: "var(--gray-400)", fontWeight: 400 }}>(optional)</span></label>
                <input value={clientEmail} onChange={(e) => setClientEmail(e.target.value)} placeholder="sarah@acme.com" style={inputStyle}
                  onFocus={e => e.target.style.borderColor = "var(--green)"} onBlur={e => e.target.style.borderColor = "var(--gray-200)"} />
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12, marginBottom: 18 }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: "var(--gray-600)", display: "block", marginBottom: 4 }}>Label <span style={{ color: "var(--gray-400)", fontWeight: 400 }}>(optional)</span></label>
                <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Sprint 1 review" style={inputStyle}
                  onFocus={e => e.target.style.borderColor = "var(--green)"} onBlur={e => e.target.style.borderColor = "var(--gray-200)"} />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: "var(--gray-600)", display: "block", marginBottom: 4 }}>Expires in</label>
                <select value={expiresDays} onChange={(e) => setExpiresDays(parseInt(e.target.value))} style={{ ...inputStyle, background: "#fff" }}>
                  <option value={3}>3 days</option><option value={7}>7 days</option><option value={14}>14 days</option><option value={30}>30 days</option>
                </select>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setShowCreate(false)} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid var(--gray-200)", background: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "var(--font)", color: "var(--gray-600)" }}>Cancel</button>
              <button onClick={handleCreate} disabled={creating} style={{ padding: "8px 20px", borderRadius: 8, border: "none", background: "var(--green)", color: "var(--dark)", fontSize: 13, fontWeight: 700, cursor: creating ? "default" : "pointer", fontFamily: "var(--font)", opacity: creating ? 0.6 : 1 }}>
                {creating ? "Creating..." : "Create Link"}
              </button>
            </div>
          </div>
        )}

        {/* Two-column layout */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, alignItems: "start" }}>

          {/* LEFT: Review Links */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--gray-500)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 }}>
              Review Links {tokens.length > 0 && <span style={{ color: "var(--gray-400)" }}>({tokens.length})</span>}
            </div>

            {tokens.length === 0 ? (
              <div style={{
                padding: "40px 20px", textAlign: "center", borderRadius: 12,
                border: "2px dashed var(--gray-200)", background: "#fff",
              }}>
                <svg viewBox="0 0 24 24" style={{ width: 32, height: 32, stroke: "var(--gray-300)", fill: "none", strokeWidth: 1.5, margin: "0 auto 12px", display: "block" }}>
                  <path d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101" />
                  <path d="M10.172 13.828a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.102 1.101" />
                </svg>
                <div style={{ fontSize: 14, fontWeight: 700, color: "var(--dark)", marginBottom: 4 }}>No review links yet</div>
                <div style={{ fontSize: 12, color: "var(--gray-500)", lineHeight: 1.5, marginBottom: 16 }}>
                  Generate a link to send to your client for requirement confirmation.
                </div>
                <button onClick={() => setShowCreate(true)} style={{ padding: "8px 18px", borderRadius: 8, border: "none", background: "var(--green)", color: "var(--dark)", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "var(--font)" }}>
                  Generate First Link
                </button>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {tokens.map((t) => {
                  const status = tokenStatus(t);
                  const isActive = !t.revoked_at && !t.submitted_at && new Date(t.expires_at) >= new Date();
                  const daysLeft = Math.max(0, Math.ceil((new Date(t.expires_at).getTime() - Date.now()) / 86400000));
                  return (
                    <div key={t.id} style={{
                      padding: "14px 16px", borderRadius: 12,
                      border: `1px solid ${isActive ? "var(--green)" : "var(--gray-200)"}`,
                      background: "#fff",
                      boxShadow: isActive ? "0 1px 6px rgba(0,229,160,0.08)" : "none",
                    }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <div style={{
                          width: 34, height: 34, borderRadius: 8,
                          background: status.bg, color: status.color,
                          display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                        }}>
                          <svg viewBox="0 0 24 24" style={{ width: 16, height: 16, stroke: "currentColor", fill: "none", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" }}>
                            <path d={status.icon} />
                          </svg>
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                            <span style={{ fontSize: 13, fontWeight: 700, color: "var(--dark)" }}>Round {t.round_number}</span>
                            <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 7px", borderRadius: 5, background: status.bg, color: status.color, textTransform: "uppercase", letterSpacing: 0.4 }}>{status.label}</span>
                            {t.label && <span style={{ fontSize: 11, color: "var(--gray-500)" }}>{t.label}</span>}
                          </div>
                          <div style={{ fontSize: 10, color: "var(--gray-500)", display: "flex", flexWrap: "wrap", gap: 4 }}>
                            {t.client_name && <><span>{t.client_name}</span><span style={{ color: "var(--gray-300)" }}>|</span></>}
                            <span style={isActive && daysLeft <= 2 ? { color: "#d97706" } : undefined}>
                              {isActive ? (daysLeft === 0 ? "Expires today" : `${daysLeft}d left`) : `Expired ${formatDate(t.expires_at)}`}
                            </span>
                            {t.submitted_at && <><span style={{ color: "var(--gray-300)" }}>|</span><span style={{ color: "#059669", fontWeight: 600 }}>Submitted {formatDate(t.submitted_at)}</span></>}
                          </div>
                        </div>
                      </div>
                      {isActive && (
                        <div style={{ display: "flex", gap: 6, marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--gray-100)" }}>
                          <button
                            onClick={() => copyUrl(t.shareable_url, t.id)}
                            style={{
                              flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
                              padding: "6px 0", borderRadius: 6,
                              border: "1px solid var(--gray-200)", background: "#fff",
                              fontSize: 11, fontWeight: 600, cursor: "pointer",
                              fontFamily: "var(--font)", color: copied === t.id ? "#059669" : "var(--dark)",
                            }}
                          >
                            <svg viewBox="0 0 24 24" style={{ width: 11, height: 11, stroke: "currentColor", fill: "none", strokeWidth: 2 }}>
                              {copied === t.id ? <path d="M5 13l4 4L19 7" /> : <><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" /></>}
                            </svg>
                            {copied === t.id ? "Copied!" : "Copy Link"}
                          </button>
                          <button
                            onClick={() => handleRevoke(t.id)}
                            style={{
                              padding: "6px 12px", borderRadius: 6,
                              border: "1px solid var(--gray-200)", background: "#fff",
                              fontSize: 11, fontWeight: 600, cursor: "pointer",
                              fontFamily: "var(--font)", color: "var(--gray-500)",
                            }}
                          >
                            Revoke
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* RIGHT: Submission History */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--gray-500)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 }}>
              Submission History {submissions.length > 0 && <span style={{ color: "var(--gray-400)" }}>({submissions.length})</span>}
            </div>

            {submissions.length === 0 ? (
              <div style={{
                padding: "40px 20px", textAlign: "center", borderRadius: 12,
                border: "2px dashed var(--gray-200)", background: "#fff",
              }}>
                <svg viewBox="0 0 24 24" style={{ width: 32, height: 32, stroke: "var(--gray-300)", fill: "none", strokeWidth: 1.5, margin: "0 auto 12px", display: "block" }}>
                  <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                  <path d="M9 14l2 2 4-4" />
                </svg>
                <div style={{ fontSize: 14, fontWeight: 700, color: "var(--dark)", marginBottom: 4 }}>No submissions yet</div>
                <div style={{ fontSize: 12, color: "var(--gray-500)", lineHeight: 1.5 }}>
                  Submissions will appear here when clients complete their reviews.
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {submissions.map((s) => {
                  const total = s.confirmed + s.discussed;
                  const confirmRate = total > 0 ? Math.round((s.confirmed / total) * 100) : 0;
                  const isExpanded = expandedSub === s.id;
                  return (
                    <div key={s.id} style={{
                      borderRadius: 12, border: "1px solid var(--gray-200)",
                      background: "#fff", overflow: "hidden",
                    }}>
                      {/* Summary — clickable */}
                      <div
                        onClick={() => setExpandedSub(isExpanded ? null : s.id)}
                        style={{
                          padding: "14px 16px", cursor: "pointer",
                          transition: "background 0.15s",
                        }}
                        onMouseEnter={e => e.currentTarget.style.background = "var(--gray-50, #f8fafc)"}
                        onMouseLeave={e => e.currentTarget.style.background = "#fff"}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                          <div style={{
                            width: 34, height: 34, borderRadius: 8,
                            background: "linear-gradient(135deg, #d1fae5, #a7f3d0)",
                            color: "#059669",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            fontWeight: 800, fontSize: 12, flexShrink: 0,
                          }}>
                            R{s.round_number}
                          </div>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--dark)" }}>
                              Round {s.round_number}{s.client_name ? ` — ${s.client_name}` : ""}
                            </div>
                            <div style={{ fontSize: 10, color: "var(--gray-500)", marginTop: 2 }}>
                              {s.submitted_at && formatDate(s.submitted_at)}
                            </div>
                          </div>
                          <svg viewBox="0 0 24 24" style={{
                            width: 14, height: 14, stroke: "var(--gray-400)", fill: "none", strokeWidth: 2,
                            transform: isExpanded ? "rotate(180deg)" : "none", transition: "transform 0.2s",
                          }}>
                            <polyline points="6 9 12 15 18 9" />
                          </svg>
                        </div>

                        {/* Mini stats */}
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                          <div style={{ padding: "8px 10px", borderRadius: 6, background: "#f0fdf4", textAlign: "center" }}>
                            <div style={{ fontSize: 18, fontWeight: 800, color: "#059669", lineHeight: 1 }}>{s.confirmed}</div>
                            <div style={{ fontSize: 9, fontWeight: 600, color: "#059669", marginTop: 2, opacity: 0.7 }}>Confirmed</div>
                          </div>
                          <div style={{ padding: "8px 10px", borderRadius: 6, background: "#fef3c7", textAlign: "center" }}>
                            <div style={{ fontSize: 18, fontWeight: 800, color: "#d97706", lineHeight: 1 }}>{s.discussed}</div>
                            <div style={{ fontSize: 9, fontWeight: 600, color: "#d97706", marginTop: 2, opacity: 0.7 }}>Flagged</div>
                          </div>
                          <div style={{ padding: "8px 10px", borderRadius: 6, background: "#ede9fe", textAlign: "center" }}>
                            <div style={{ fontSize: 18, fontWeight: 800, color: "#7c3aed", lineHeight: 1 }}>{s.gaps_answered}</div>
                            <div style={{ fontSize: 9, fontWeight: 600, color: "#7c3aed", marginTop: 2, opacity: 0.7 }}>Gaps Answered</div>
                          </div>
                        </div>

                        {/* Progress bar */}
                        {total > 0 && (
                          <div style={{ marginTop: 10 }}>
                            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                              <span style={{ fontSize: 9, fontWeight: 600, color: "var(--gray-500)" }}>Confirmation rate</span>
                              <span style={{ fontSize: 10, fontWeight: 700, color: confirmRate >= 80 ? "#059669" : confirmRate >= 50 ? "#d97706" : "#dc2626" }}>{confirmRate}%</span>
                            </div>
                            <div style={{ height: 5, borderRadius: 3, background: "var(--gray-100)", overflow: "hidden" }}>
                              <div style={{ height: "100%", borderRadius: 3, width: `${confirmRate}%`, background: confirmRate >= 80 ? "#059669" : confirmRate >= 50 ? "#d97706" : "#dc2626", transition: "width 0.5s ease" }} />
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Expanded: Full response details */}
                      {isExpanded && (
                        <div style={{ borderTop: "1px solid var(--gray-100)", padding: "16px", background: "var(--gray-50, #f8fafc)" }}>
                          {/* Requirement responses */}
                          {s.requirement_actions && s.requirement_actions.length > 0 && (
                            <div style={{ marginBottom: 16 }}>
                              <div style={{ fontSize: 10, fontWeight: 700, color: "var(--gray-500)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>
                                Requirement Responses ({s.requirement_actions.filter(a => a.action !== "skip").length})
                              </div>
                              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                                {s.requirement_actions.filter(a => a.action !== "skip").map((a, i) => (
                                  <div key={i} style={{
                                    padding: "10px 12px", borderRadius: 8,
                                    background: "#fff", border: "1px solid var(--gray-200)",
                                    display: "flex", alignItems: "flex-start", gap: 10,
                                  }}>
                                    <span style={{
                                      fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 4,
                                      background: a.action === "confirm" ? "#d1fae5" : "#fef3c7",
                                      color: a.action === "confirm" ? "#059669" : "#d97706",
                                      textTransform: "uppercase", flexShrink: 0, marginTop: 1,
                                    }}>
                                      {a.action === "confirm" ? "Confirmed" : "Discuss"}
                                    </span>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--dark)" }}>{a.req_id}</div>
                                      {a.note && (
                                        <div style={{ fontSize: 11, color: "var(--gray-600)", marginTop: 3, lineHeight: 1.4, fontStyle: "italic" }}>
                                          "{a.note}"
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Gap responses */}
                          {s.gap_actions && s.gap_actions.filter(a => a.action === "answer").length > 0 && (
                            <div>
                              <div style={{ fontSize: 10, fontWeight: 700, color: "var(--gray-500)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>
                                Gap Answers ({s.gap_actions.filter(a => a.action === "answer").length})
                              </div>
                              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                                {s.gap_actions.filter(a => a.action === "answer").map((a, i) => (
                                  <div key={i} style={{
                                    padding: "10px 12px", borderRadius: 8,
                                    background: "#fff", border: "1px solid var(--gray-200)",
                                  }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                                      <span style={{
                                        fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 4,
                                        background: "#ede9fe", color: "#7c3aed",
                                        textTransform: "uppercase",
                                      }}>
                                        Answered
                                      </span>
                                      <span style={{ fontSize: 12, fontWeight: 600, color: "var(--dark)" }}>{a.gap_id}</span>
                                    </div>
                                    {a.answer && (
                                      <div style={{
                                        fontSize: 11, color: "var(--gray-600)", lineHeight: 1.5,
                                        padding: "8px 10px", borderRadius: 6,
                                        background: "var(--gray-50, #f8fafc)", border: "1px solid var(--gray-100)",
                                        marginTop: 4,
                                      }}>
                                        {a.answer}
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* No actions */}
                          {(!s.requirement_actions || s.requirement_actions.filter(a => a.action !== "skip").length === 0) &&
                           (!s.gap_actions || s.gap_actions.filter(a => a.action === "answer").length === 0) && (
                            <div style={{ fontSize: 12, color: "var(--gray-500)", textAlign: "center", padding: 12 }}>
                              No detailed responses recorded.
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
