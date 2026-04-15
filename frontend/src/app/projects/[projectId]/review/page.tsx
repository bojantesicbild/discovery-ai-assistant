"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

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

  // Create form
  const [clientName, setClientName] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [label, setLabel] = useState("");
  const [expiresDays, setExpiresDays] = useState(7);

  useEffect(() => {
    loadData();
  }, [projectId]);

  async function loadData() {
    try {
      const [tokensRes, subsRes] = await Promise.all([
        fetchAuth(`/api/projects/${projectId}/review-tokens`),
        fetchAuth(`/api/projects/${projectId}/review-submissions`),
      ]);
      if (tokensRes.ok) {
        const d = await tokensRes.json();
        setTokens(d.tokens || []);
      }
      if (subsRes.ok) {
        const d = await subsRes.json();
        setSubmissions(d.submissions || []);
      }
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
      if (res.ok) {
        setShowCreate(false);
        setClientName("");
        setClientEmail("");
        setLabel("");
        loadData();
      }
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

  function tokenStatus(t: ReviewToken): { label: string; color: string; bg: string } {
    if (t.submitted_at) return { label: "Submitted", color: "#059669", bg: "#d1fae5" };
    if (t.revoked_at) return { label: "Revoked", color: "#dc2626", bg: "#fee2e2" };
    if (new Date(t.expires_at) < new Date()) return { label: "Expired", color: "#d97706", bg: "#fef3c7" };
    return { label: "Active", color: "#2563eb", bg: "#dbeafe" };
  }

  function relativeDate(d: string | null) {
    if (!d) return "";
    const diff = Date.now() - new Date(d).getTime();
    const days = Math.floor(diff / 86400000);
    if (days === 0) return "today";
    if (days === 1) return "yesterday";
    if (days < 30) return `${days}d ago`;
    return new Date(d).toLocaleDateString();
  }

  if (loading) {
    return <div style={{ padding: 40, color: "#94a3b8", textAlign: "center" }}>Loading...</div>;
  }

  return (
    <div style={{ padding: "24px 28px", maxWidth: 800, flex: 1, overflow: "auto" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: "var(--dark)", margin: 0 }}>Client Review</h1>
        <div style={{ flex: 1 }} />
        <button
          onClick={() => setShowCreate(true)}
          style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "9px 18px", borderRadius: 10, border: "none",
            background: "var(--green)", color: "var(--dark)",
            fontSize: 13, fontWeight: 700, cursor: "pointer",
            fontFamily: "var(--font)",
            boxShadow: "0 2px 6px rgba(0,229,160,0.3)",
          }}
        >
          <svg viewBox="0 0 24 24" style={{ width: 14, height: 14, stroke: "currentColor", fill: "none", strokeWidth: 2.5 }}>
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Generate Review Link
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <div style={{
          padding: 20, borderRadius: 12, border: "1px solid var(--gray-200)",
          background: "#fff", marginBottom: 20,
        }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--dark)", marginBottom: 14 }}>
            New Review Link
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: "var(--gray-600)", display: "block", marginBottom: 4 }}>Client name</label>
              <input
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                placeholder="e.g. Sarah Chen"
                style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid var(--gray-200)", fontSize: 13, fontFamily: "var(--font)" }}
              />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: "var(--gray-600)", display: "block", marginBottom: 4 }}>Client email (optional)</label>
              <input
                value={clientEmail}
                onChange={(e) => setClientEmail(e.target.value)}
                placeholder="sarah@acme.com"
                style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid var(--gray-200)", fontSize: 13, fontFamily: "var(--font)" }}
              />
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12, marginBottom: 16 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: "var(--gray-600)", display: "block", marginBottom: 4 }}>Label (optional)</label>
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. Sprint 1 review"
                style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid var(--gray-200)", fontSize: 13, fontFamily: "var(--font)" }}
              />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: "var(--gray-600)", display: "block", marginBottom: 4 }}>Expires in</label>
              <select
                value={expiresDays}
                onChange={(e) => setExpiresDays(parseInt(e.target.value))}
                style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid var(--gray-200)", fontSize: 13, fontFamily: "var(--font)" }}
              >
                <option value={3}>3 days</option>
                <option value={7}>7 days</option>
                <option value={14}>14 days</option>
                <option value={30}>30 days</option>
              </select>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button
              onClick={() => setShowCreate(false)}
              style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid var(--gray-200)", background: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "var(--font)", color: "var(--gray-600)" }}
            >
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={creating}
              style={{
                padding: "8px 20px", borderRadius: 8, border: "none",
                background: "var(--green)", color: "var(--dark)",
                fontSize: 13, fontWeight: 700, cursor: creating ? "default" : "pointer",
                fontFamily: "var(--font)", opacity: creating ? 0.6 : 1,
              }}
            >
              {creating ? "Creating..." : "Create Link"}
            </button>
          </div>
        </div>
      )}

      {/* Token list */}
      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--dark)", marginBottom: 10 }}>
        Review Links ({tokens.length})
      </div>
      {tokens.length === 0 ? (
        <div style={{
          padding: "40px 20px", textAlign: "center", borderRadius: 12,
          border: "1px solid var(--gray-200)", background: "#fff", color: "var(--gray-400)",
        }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>📋</div>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>No review links yet</div>
          <div style={{ fontSize: 12 }}>Generate a link to send to your client for requirement confirmation.</div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 32 }}>
          {tokens.map((t) => {
            const status = tokenStatus(t);
            const isActive = !t.revoked_at && !t.submitted_at && new Date(t.expires_at) >= new Date();
            return (
              <div key={t.id} style={{
                padding: "14px 18px", borderRadius: 12, border: "1px solid var(--gray-200)",
                background: "#fff", display: "flex", alignItems: "center", gap: 14,
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "var(--dark)" }}>
                      Round {t.round_number}
                    </span>
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 8,
                      background: status.bg, color: status.color,
                      textTransform: "uppercase", letterSpacing: 0.4,
                    }}>
                      {status.label}
                    </span>
                    {t.label && <span style={{ fontSize: 11, color: "var(--gray-500)" }}>{t.label}</span>}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--gray-500)", display: "flex", gap: 12 }}>
                    {t.client_name && <span>{t.client_name}</span>}
                    <span>Expires: {new Date(t.expires_at).toLocaleDateString()}</span>
                    {t.created_at && <span>Created: {relativeDate(t.created_at)}</span>}
                    {t.submitted_at && <span style={{ color: "#059669" }}>Submitted: {relativeDate(t.submitted_at)}</span>}
                  </div>
                </div>
                {isActive && (
                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      onClick={() => copyUrl(t.shareable_url, t.id)}
                      style={{
                        padding: "6px 14px", borderRadius: 8,
                        border: "1px solid var(--gray-200)", background: "#fff",
                        fontSize: 11, fontWeight: 600, cursor: "pointer",
                        fontFamily: "var(--font)", color: "var(--dark)",
                      }}
                    >
                      {copied === t.id ? "✓ Copied!" : "Copy Link"}
                    </button>
                    <button
                      onClick={() => handleRevoke(t.id)}
                      style={{
                        padding: "6px 12px", borderRadius: 8,
                        border: "1px solid #fecaca", background: "#fff",
                        fontSize: 11, fontWeight: 600, cursor: "pointer",
                        fontFamily: "var(--font)", color: "#dc2626",
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

      {/* Submission history */}
      {submissions.length > 0 && (
        <>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--dark)", marginBottom: 10 }}>
            Submission History ({submissions.length})
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {submissions.map((s) => (
              <div key={s.id} style={{
                padding: "14px 18px", borderRadius: 12, border: "1px solid var(--gray-200)",
                background: "#fff", display: "flex", alignItems: "center", gap: 14,
              }}>
                <div style={{
                  width: 36, height: 36, borderRadius: "50%",
                  background: "#d1fae5", color: "#059669",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontWeight: 700, fontSize: 14, flexShrink: 0,
                }}>✓</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--dark)" }}>
                    Round {s.round_number}{s.client_name ? ` — ${s.client_name}` : ""}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--gray-500)", marginTop: 2 }}>
                    {s.confirmed} confirmed · {s.discussed} flagged · {s.gaps_answered} gaps answered
                    {s.submitted_at && ` · ${relativeDate(s.submitted_at)}`}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
