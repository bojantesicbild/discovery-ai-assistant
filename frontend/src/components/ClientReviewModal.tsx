"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  listReviewTokens,
  createReviewToken,
  revokeReviewToken,
  listReviewSubmissions,
  type ReviewToken,
  type ReviewSubmission,
} from "@/lib/api";

interface ClientReviewModalProps {
  projectId: string;
  open: boolean;
  onClose: () => void;
}

type Tab = "links" | "submissions";

export default function ClientReviewModal({ projectId, open, onClose }: ClientReviewModalProps) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("links");

  // Open a BR or gap from inside a submission — close the modal and
  // navigate to the matching tab with a highlight so DataPanel auto-opens it.
  function openItem(kind: "reqs" | "gaps", id: string) {
    onClose();
    router.push(`/projects/${projectId}/chat?tab=${kind}&highlight=${encodeURIComponent(id)}`);
  }
  const [tokens, setTokens] = useState<ReviewToken[]>([]);
  const [submissions, setSubmissions] = useState<ReviewSubmission[]>([]);
  const [loading, setLoading] = useState(false);

  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [expandedSub, setExpandedSub] = useState<string | null>(null);

  const [clientName, setClientName] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [label, setLabel] = useState("");
  const [expiresDays, setExpiresDays] = useState(7);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    Promise.all([listReviewTokens(projectId), listReviewSubmissions(projectId)])
      .then(([t, s]) => {
        setTokens(t.tokens || []);
        setSubmissions(s.submissions || []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [open, projectId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  async function reload() {
    const [t, s] = await Promise.all([listReviewTokens(projectId), listReviewSubmissions(projectId)]);
    setTokens(t.tokens || []);
    setSubmissions(s.submissions || []);
  }

  async function handleCreate() {
    setCreating(true);
    try {
      await createReviewToken(projectId, {
        label: label || undefined,
        client_name: clientName || undefined,
        client_email: clientEmail || undefined,
        expires_in_days: expiresDays,
      });
      setShowCreate(false);
      setClientName(""); setClientEmail(""); setLabel("");
      await reload();
    } catch {}
    setCreating(false);
  }

  async function handleRevoke(tokenId: string) {
    if (!confirm("Revoke this review link? The client will no longer be able to access it.")) return;
    await revokeReviewToken(projectId, tokenId);
    await reload();
  }

  function copyUrl(url: string, id: string) {
    navigator.clipboard.writeText(url);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(15, 23, 42, 0.55)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 1000, backdropFilter: "blur(4px)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff", borderRadius: 14, width: "min(960px, 92vw)",
          maxHeight: "88vh", display: "flex", flexDirection: "column",
          boxShadow: "0 24px 64px rgba(0,0,0,0.24)", overflow: "hidden",
        }}
      >
        {/* Header — matches DirectoryModal */}
        <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "20px 28px 16px", borderBottom: "1px solid var(--gray-100)" }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 700, color: "#0f172a" }}>Client Review</div>
            <div style={{ fontSize: 12, color: "var(--gray-500)", marginTop: 2 }}>
              Secure links for clients to confirm requirements and answer open gaps.
            </div>
          </div>
          <div style={{ flex: 1 }} />
          <button
            onClick={() => setShowCreate(true)}
            style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "8px 14px", borderRadius: 8, border: "none",
              background: "var(--green)", color: "var(--dark)",
              fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "var(--font)",
              boxShadow: "0 2px 8px rgba(0,229,160,0.22)",
            }}
          >
            <svg viewBox="0 0 24 24" style={{ width: 12, height: 12, stroke: "currentColor", fill: "none", strokeWidth: 2.5 }}>
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Generate Link
          </button>
          <button
            onClick={onClose}
            style={{
              width: 32, height: 32, borderRadius: 8, border: "none",
              background: "var(--gray-50)", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            <svg viewBox="0 0 24 24" style={{ width: 16, height: 16, stroke: "var(--gray-600)", fill: "none", strokeWidth: 2 }}>
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Body — horizontal tabs (like Gaps/Constraints/Conflicts) + content */}
        <div style={{ flex: 1, overflow: "auto", padding: "16px 24px 24px", minHeight: 0 }}>
          {/* Segmented tab group */}
          <div style={{
            display: "flex", gap: 4, padding: 3,
            background: "var(--gray-50)", borderRadius: 10,
            marginBottom: 16, width: "fit-content",
          }}>
            {([
              { id: "links" as const, label: "Links", count: tokens.length, color: "var(--green)" },
              { id: "submissions" as const, label: "Submissions", count: submissions.length, color: "#7c3aed" },
            ]).map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                style={{
                  padding: "7px 16px", borderRadius: 7, border: "none",
                  background: tab === t.id ? "#fff" : "transparent",
                  color: tab === t.id ? "var(--dark)" : "var(--gray-500)",
                  fontSize: 12, fontWeight: 600, cursor: "pointer",
                  fontFamily: "var(--font)",
                  boxShadow: tab === t.id ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
                  transition: "all 0.15s",
                  display: "flex", alignItems: "center", gap: 6,
                }}
              >
                {t.label}
                {t.count > 0 && (
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 8,
                    background: tab === t.id ? `${t.color}1a` : "var(--gray-100)",
                    color: tab === t.id ? t.color : "var(--gray-500)",
                  }}>{t.count}</span>
                )}
              </button>
            ))}
          </div>

          {loading && <div style={{ color: "#64748b", fontSize: 13 }}>Loading…</div>}

          {!loading && showCreate && (
            <CreateLinkForm
              clientName={clientName} setClientName={setClientName}
              clientEmail={clientEmail} setClientEmail={setClientEmail}
              label={label} setLabel={setLabel}
              expiresDays={expiresDays} setExpiresDays={setExpiresDays}
              creating={creating}
              onCancel={() => setShowCreate(false)}
              onCreate={handleCreate}
            />
          )}

          {!loading && tab === "links" && (
            <LinksList tokens={tokens} copied={copied} onCopy={copyUrl} onRevoke={handleRevoke} onCreate={() => setShowCreate(true)} />
          )}

          {!loading && tab === "submissions" && (
            <SubmissionsList submissions={submissions} expandedSub={expandedSub} setExpandedSub={setExpandedSub} onOpenItem={openItem} />
          )}
        </div>
      </div>
    </div>
  );
}


function CreateLinkForm({
  clientName, setClientName, clientEmail, setClientEmail, label, setLabel,
  expiresDays, setExpiresDays, creating, onCancel, onCreate,
}: {
  clientName: string; setClientName: (s: string) => void;
  clientEmail: string; setClientEmail: (s: string) => void;
  label: string; setLabel: (s: string) => void;
  expiresDays: number; setExpiresDays: (n: number) => void;
  creating: boolean; onCancel: () => void; onCreate: () => void;
}) {
  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "9px 14px", borderRadius: 8,
    border: "1px solid var(--gray-200)", fontSize: 13,
    fontFamily: "var(--font)", outline: "none",
  };
  return (
    <div style={{
      padding: 18, borderRadius: 12, border: "1px solid var(--green)",
      background: "#fff", marginBottom: 20,
      boxShadow: "0 4px 16px rgba(0,229,160,0.08)",
    }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: "var(--dark)", marginBottom: 14 }}>New Review Link</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
        <div>
          <label style={{ fontSize: 11, fontWeight: 600, color: "var(--gray-600)", display: "block", marginBottom: 4 }}>Client name</label>
          <input value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="e.g. Sarah Chen" style={inputStyle} />
        </div>
        <div>
          <label style={{ fontSize: 11, fontWeight: 600, color: "var(--gray-600)", display: "block", marginBottom: 4 }}>Client email <span style={{ color: "var(--gray-400)", fontWeight: 400 }}>(optional)</span></label>
          <input value={clientEmail} onChange={(e) => setClientEmail(e.target.value)} placeholder="sarah@acme.com" style={inputStyle} />
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12, marginBottom: 16 }}>
        <div>
          <label style={{ fontSize: 11, fontWeight: 600, color: "var(--gray-600)", display: "block", marginBottom: 4 }}>Label <span style={{ color: "var(--gray-400)", fontWeight: 400 }}>(optional)</span></label>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Sprint 1 review" style={inputStyle} />
        </div>
        <div>
          <label style={{ fontSize: 11, fontWeight: 600, color: "var(--gray-600)", display: "block", marginBottom: 4 }}>Expires in</label>
          <select value={expiresDays} onChange={(e) => setExpiresDays(parseInt(e.target.value))} style={{ ...inputStyle, background: "#fff" }}>
            <option value={3}>3 days</option><option value={7}>7 days</option><option value={14}>14 days</option><option value={30}>30 days</option>
          </select>
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button onClick={onCancel} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid var(--gray-200)", background: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "var(--font)", color: "var(--gray-600)" }}>Cancel</button>
        <button onClick={onCreate} disabled={creating} style={{ padding: "8px 20px", borderRadius: 8, border: "none", background: "var(--green)", color: "var(--dark)", fontSize: 13, fontWeight: 700, cursor: creating ? "default" : "pointer", fontFamily: "var(--font)", opacity: creating ? 0.6 : 1 }}>
          {creating ? "Creating..." : "Create Link"}
        </button>
      </div>
    </div>
  );
}


function LinksList({ tokens, copied, onCopy, onRevoke, onCreate }: {
  tokens: ReviewToken[];
  copied: string | null;
  onCopy: (url: string, id: string) => void;
  onRevoke: (tokenId: string) => void;
  onCreate: () => void;
}) {
  if (tokens.length === 0) {
    return (
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
        <button onClick={onCreate} style={{ padding: "8px 18px", borderRadius: 8, border: "none", background: "var(--green)", color: "var(--dark)", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "var(--font)" }}>
          Generate First Link
        </button>
      </div>
    );
  }

  return (
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
                  onClick={() => onCopy(t.shareable_url, t.id)}
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
                  onClick={() => onRevoke(t.id)}
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
  );
}


function SubmissionsList({ submissions, expandedSub, setExpandedSub, onOpenItem }: {
  submissions: ReviewSubmission[];
  expandedSub: string | null;
  setExpandedSub: (id: string | null) => void;
  onOpenItem: (kind: "reqs" | "gaps", id: string) => void;
}) {
  if (submissions.length === 0) {
    return (
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
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {submissions.map((s) => {
        const total = s.confirmed + s.discussed;
        const confirmRate = total > 0 ? Math.round((s.confirmed / total) * 100) : 0;
        const isExpanded = expandedSub === s.id;
        const rateColor = confirmRate >= 80 ? "#059669" : confirmRate >= 50 ? "#d97706" : "#dc2626";
        return (
          <div key={s.id} style={{
            borderRadius: 10, border: "1px solid var(--gray-200)",
            background: "#fff", overflow: "hidden",
          }}>
            {/* Header row — all on one line */}
            <div
              onClick={() => setExpandedSub(isExpanded ? null : s.id)}
              style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "8px 12px", cursor: "pointer",
                transition: "background 0.15s",
              }}
              onMouseEnter={e => e.currentTarget.style.background = "var(--gray-50, #f8fafc)"}
              onMouseLeave={e => e.currentTarget.style.background = "#fff"}
            >
              {/* Round badge */}
              <span style={{
                fontSize: 10, fontWeight: 800, padding: "2px 7px", borderRadius: 4,
                background: "#d1fae5", color: "#059669",
                letterSpacing: 0.3, flexShrink: 0,
              }}>
                R{s.round_number}
              </span>

              {/* Title + meta */}
              <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: "var(--dark)", whiteSpace: "nowrap" }}>
                  {s.client_name || `Round ${s.round_number}`}
                </span>
                <span style={{ fontSize: 10, color: "var(--gray-400)", whiteSpace: "nowrap" }}>
                  · {s.submitted_at ? formatDate(s.submitted_at) : ""}
                </span>
              </div>

              {/* Inline stat chips */}
              <div style={{ display: "flex", gap: 4, flexShrink: 0, alignItems: "center" }}>
                {s.confirmed > 0 && (
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 4,
                    background: "#d1fae5", color: "#059669", whiteSpace: "nowrap",
                  }}>+{s.confirmed} confirmed</span>
                )}
                {s.discussed > 0 && (
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 4,
                    background: "#fef3c7", color: "#d97706", whiteSpace: "nowrap",
                  }}>+{s.discussed} flagged</span>
                )}
                {s.gaps_answered > 0 && (
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 4,
                    background: "#ede9fe", color: "#7c3aed", whiteSpace: "nowrap",
                  }}>+{s.gaps_answered} answered</span>
                )}
                {total > 0 && (
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 4,
                    background: "var(--gray-100)", color: rateColor, whiteSpace: "nowrap",
                  }} title="Confirmation rate">{confirmRate}%</span>
                )}
              </div>

              {/* Chevron */}
              <svg viewBox="0 0 24 24" style={{
                width: 12, height: 12, stroke: "var(--gray-400)", fill: "none", strokeWidth: 2.5,
                flexShrink: 0,
                transform: isExpanded ? "rotate(180deg)" : "none", transition: "transform 0.15s",
              }}>
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </div>

            {isExpanded && <SubmissionDetail s={s} onOpenItem={onOpenItem} />}
          </div>
        );
      })}
    </div>
  );
}


function SubmissionDetail({ s, onOpenItem }: {
  s: ReviewSubmission;
  onOpenItem: (kind: "reqs" | "gaps", id: string) => void;
}) {
  const reqActions = (s.requirement_actions || []).filter(a => a.action !== "skip");
  const gapAnswers = (s.gap_actions || []).filter(a => a.action === "answer");
  const empty = reqActions.length === 0 && gapAnswers.length === 0;

  return (
    <div style={{ borderTop: "1px solid var(--gray-100)", padding: 16, background: "var(--gray-50, #f8fafc)" }}>
      {reqActions.length > 0 && (
        <div style={{ marginBottom: gapAnswers.length > 0 ? 16 : 0 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "var(--gray-500)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>
            Requirement Responses ({reqActions.length})
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {reqActions.map((a, i) => (
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
                  <IdLink id={a.req_id} onClick={() => onOpenItem("reqs", a.req_id)} />
                  {a.note && (
                    <div style={{ fontSize: 11, color: "var(--gray-600)", marginTop: 3, lineHeight: 1.4, fontStyle: "italic" }}>
                      &ldquo;{a.note}&rdquo;
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {gapAnswers.length > 0 && (
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, color: "var(--gray-500)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>
            Gap Answers ({gapAnswers.length})
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {gapAnswers.map((a, i) => (
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
                  <IdLink id={a.gap_id} onClick={() => onOpenItem("gaps", a.gap_id)} />
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

      {empty && (
        <div style={{ fontSize: 12, color: "var(--gray-500)", textAlign: "center", padding: 12 }}>
          No detailed responses recorded.
        </div>
      )}
    </div>
  );
}


function IdLink({ id, onClick }: { id: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title={`Open ${id}`}
      style={{
        background: "none", border: "none", padding: 0, cursor: "pointer",
        fontSize: 12, fontWeight: 600, color: "var(--dark)",
        fontFamily: "var(--font)", textAlign: "left",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.color = "var(--green)";
        e.currentTarget.style.textDecoration = "underline";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = "var(--dark)";
        e.currentTarget.style.textDecoration = "none";
      }}
    >{id}</button>
  );
}


function tokenStatus(t: ReviewToken): { label: string; color: string; bg: string; icon: string } {
  if (t.submitted_at) return { label: "Submitted", color: "#059669", bg: "#d1fae5", icon: "M5 13l4 4L19 7" };
  if (t.revoked_at) return { label: "Revoked", color: "#dc2626", bg: "#fee2e2", icon: "M6 18L18 6M6 6l12 12" };
  if (new Date(t.expires_at) < new Date()) return { label: "Expired", color: "#d97706", bg: "#fef3c7", icon: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" };
  // Active → full chain-link glyph (two subpaths); the previous single-path
  // version rendered as a lone "C" shape.
  return {
    label: "Active", color: "#2563eb", bg: "#dbeafe",
    icon: "M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101 M10.172 13.828a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.102 1.101",
  };
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
