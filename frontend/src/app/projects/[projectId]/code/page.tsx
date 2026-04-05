"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { listRepos, addRepo, removeRepo, getRepoPulls, listRequirements, listConstraints } from "@/lib/api";

interface Repo {
  id: string;
  name: string;
  url: string;
  provider: string;
  default_branch: string;
  last_synced_at: string | null;
}

interface PR {
  number: number;
  title: string;
  state: string;
  merged: boolean;
  author: string;
  author_avatar: string;
  created_at: string;
  updated_at: string;
  merged_at: string | null;
  url: string;
  additions: number;
  deletions: number;
  changed_files: number;
  draft: boolean;
  labels: string[];
  head_branch: string;
  base_branch: string;
}

const TABS = [
  { id: "prs", label: "Pull Requests" },
  { id: "decisions", label: "Decisions & Learnings" },
  { id: "context", label: "Discovery Context" },
];

export default function CodePage() {
  const params = useParams();
  const projectId = params.projectId as string;

  const [repos, setRepos] = useState<Repo[]>([]);
  const [selectedRepo, setSelectedRepo] = useState<string | null>(null);
  const [pulls, setPulls] = useState<PR[]>([]);
  const [loadingPulls, setLoadingPulls] = useState(false);
  const [activeTab, setActiveTab] = useState("prs");
  const [showAddRepo, setShowAddRepo] = useState(false);
  const [newRepo, setNewRepo] = useState({ name: "", url: "", access_token: "" });
  const [decisions, setDecisions] = useState<any[]>([]);
  const [requirements, setRequirements] = useState<any[]>([]);
  const [constraints, setConstraints] = useState<any[]>([]);
  const [dlFilter, setDlFilter] = useState("all");

  useEffect(() => {
    loadRepos();
    loadDecisions();
  }, [projectId]);

  async function loadRepos() {
    try {
      const data = await listRepos(projectId);
      setRepos(data);
      if (data.length > 0 && !selectedRepo) {
        setSelectedRepo(data[0].id);
      }
    } catch {}
  }

  async function loadDecisions() {
    try {
      const [reqs, cons] = await Promise.all([
        listRequirements(projectId),
        listConstraints(projectId),
      ]);
      setRequirements(reqs.items || []);
      setConstraints(cons.items || []);
    } catch {}
  }

  useEffect(() => {
    if (selectedRepo) {
      setLoadingPulls(true);
      getRepoPulls(projectId, selectedRepo)
        .then((data) => setPulls(data.pulls || []))
        .catch(() => setPulls([]))
        .finally(() => setLoadingPulls(false));
    }
  }, [selectedRepo, projectId]);

  async function handleAddRepo(e: React.FormEvent) {
    e.preventDefault();
    try {
      const repo = await addRepo(projectId, {
        name: newRepo.name,
        url: newRepo.url,
        access_token: newRepo.access_token || undefined,
      });
      setRepos((r) => [...r, repo]);
      setSelectedRepo(repo.id);
      setShowAddRepo(false);
      setNewRepo({ name: "", url: "", access_token: "" });
    } catch (err: any) {
      alert(err.message || "Failed to add repo");
    }
  }

  async function handleRemoveRepo(repoId: string) {
    if (!confirm("Remove this repository?")) return;
    await removeRepo(projectId, repoId);
    setRepos((r) => r.filter((x) => x.id !== repoId));
    if (selectedRepo === repoId) setSelectedRepo(repos.find((r) => r.id !== repoId)?.id || null);
  }

  const openPRs = pulls.filter((p) => p.state === "open");
  const mergedPRs = pulls.filter((p) => p.merged);

  function timeAgo(dateStr: string) {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "auto" }}>
      {/* Phase banner */}
      <div style={{
        padding: "20px 24px", background: "linear-gradient(135deg, #1e1b4b 0%, #312e81 100%)",
        color: "#fff", borderBottom: "1px solid #e2e8f0",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 10px", borderRadius: 12, background: "rgba(255,255,255,0.15)" }}>
            Phase 3
          </span>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Code Assistant</h1>
        </div>
        <p style={{ fontSize: 13, color: "rgba(255,255,255,0.7)", margin: 0 }}>
          Track pull requests, technical decisions, and connect code to discovery artifacts.
        </p>
        <div style={{ display: "flex", gap: 24, marginTop: 12 }}>
          <Stat label="Open PRs" value={openPRs.length} color="#818cf8" />
          <Stat label="Merged" value={mergedPRs.length} color="#00E5A0" />
          <Stat label="Repos" value={repos.length} color="#f59e0b" />
          <Stat label="Requirements" value={requirements.length} color="#06b6d4" />
        </div>
      </div>

      {/* Repo selector + tabs */}
      <div style={{
        display: "flex", alignItems: "center", gap: 12, padding: "10px 24px",
        borderBottom: "1px solid #e2e8f0", background: "#fff",
      }}>
        {/* Repo pills */}
        <div style={{ display: "flex", gap: 6 }}>
          {repos.map((r) => (
            <button
              key={r.id}
              onClick={() => setSelectedRepo(r.id)}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "5px 12px", borderRadius: 6, border: "none",
                background: selectedRepo === r.id ? "#00E5A0" : "#f1f5f9",
                color: selectedRepo === r.id ? "#1A1A1A" : "#64748b",
                fontSize: 12, fontWeight: 600, cursor: "pointer",
                fontFamily: "var(--font)", transition: "all 0.15s",
              }}
            >
              <svg viewBox="0 0 16 16" style={{ width: 14, height: 14, fill: "currentColor" }}>
                <path d="M2 2.5A2.5 2.5 0 014.5 0h8.75a.75.75 0 01.75.75v12.5a.75.75 0 01-.75.75h-2.5a.75.75 0 110-1.5h1.75v-2h-8a1 1 0 00-.714 1.7.75.75 0 01-1.072 1.05A2.495 2.495 0 012 11.5v-9zm10.5-1h-8a1 1 0 00-1 1v6.708A2.486 2.486 0 014.5 9h8V1.5z"/>
              </svg>
              {r.name}
            </button>
          ))}
          <button
            onClick={() => setShowAddRepo(true)}
            style={{
              display: "flex", alignItems: "center", gap: 4,
              padding: "5px 10px", borderRadius: 6,
              border: "1px dashed #d1d5db", background: "none",
              color: "#94a3b8", fontSize: 12, fontWeight: 500,
              cursor: "pointer", fontFamily: "var(--font)",
            }}
          >
            + Add Repo
          </button>
        </div>

        <div style={{ flex: 1 }} />

        {/* Tabs */}
        <div style={{ display: "flex", gap: 0 }}>
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                padding: "6px 16px", border: "none", borderBottom: activeTab === tab.id ? "2px solid #818cf8" : "2px solid transparent",
                background: "none", color: activeTab === tab.id ? "#312e81" : "#64748b",
                fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "var(--font)",
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, padding: "20px 24px", overflow: "auto" }}>
        {/* Add repo modal */}
        {showAddRepo && (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <form onSubmit={handleAddRepo} style={{ background: "#fff", borderRadius: 12, padding: 24, width: 420, boxShadow: "0 16px 48px rgba(0,0,0,0.15)" }}>
              <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>Add Repository</h2>
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4, color: "#374151" }}>Name</label>
                <input
                  value={newRepo.name}
                  onChange={(e) => setNewRepo({ ...newRepo, name: e.target.value })}
                  placeholder="e.g. frontend"
                  required
                  style={{ width: "100%", padding: "8px 12px", border: "1px solid #e2e8f0", borderRadius: 6, fontSize: 13, fontFamily: "var(--font)" }}
                />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4, color: "#374151" }}>GitHub URL</label>
                <input
                  value={newRepo.url}
                  onChange={(e) => setNewRepo({ ...newRepo, url: e.target.value })}
                  placeholder="https://github.com/owner/repo"
                  required
                  style={{ width: "100%", padding: "8px 12px", border: "1px solid #e2e8f0", borderRadius: 6, fontSize: 13, fontFamily: "var(--font)" }}
                />
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4, color: "#374151" }}>Access Token <span style={{ fontWeight: 400, color: "#94a3b8" }}>(optional, for private repos)</span></label>
                <input
                  value={newRepo.access_token}
                  onChange={(e) => setNewRepo({ ...newRepo, access_token: e.target.value })}
                  placeholder="ghp_..."
                  type="password"
                  style={{ width: "100%", padding: "8px 12px", border: "1px solid #e2e8f0", borderRadius: 6, fontSize: 13, fontFamily: "var(--font)" }}
                />
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <button type="button" onClick={() => setShowAddRepo(false)} style={{ padding: "8px 16px", border: "none", background: "#f1f5f9", borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "var(--font)", color: "#64748b" }}>Cancel</button>
                <button type="submit" style={{ padding: "8px 16px", border: "none", background: "#00E5A0", borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "var(--font)", color: "#1A1A1A" }}>Add Repository</button>
              </div>
            </form>
          </div>
        )}

        {/* No repos state */}
        {repos.length === 0 && activeTab === "prs" && (
          <div style={{ textAlign: "center", padding: "60px 0", color: "#94a3b8" }}>
            <svg viewBox="0 0 24 24" style={{ width: 48, height: 48, stroke: "currentColor", fill: "none", strokeWidth: 1.5, margin: "0 auto 12px" }}>
              <polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" />
            </svg>
            <p style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>No repositories connected</p>
            <p style={{ fontSize: 13, marginBottom: 16 }}>Add a GitHub repository to track pull requests.</p>
            <button onClick={() => setShowAddRepo(true)} style={{ padding: "8px 20px", border: "none", background: "#00E5A0", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "var(--font)", color: "#1A1A1A" }}>
              + Add Repository
            </button>
          </div>
        )}

        {/* Pull Requests tab */}
        {activeTab === "prs" && repos.length > 0 && (
          <div>
            {loadingPulls ? (
              <div style={{ textAlign: "center", padding: 40, color: "#94a3b8", fontSize: 13 }}>Loading pull requests...</div>
            ) : pulls.length === 0 ? (
              <div style={{ textAlign: "center", padding: 40, color: "#94a3b8", fontSize: 13 }}>No pull requests found for this repository.</div>
            ) : (
              <>
                {/* Open PRs */}
                {openPRs.length > 0 && (
                  <div style={{ marginBottom: 24 }}>
                    <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10, color: "#0f172a" }}>
                      Open Pull Requests
                      <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 10, background: "#dbeafe", color: "#2563eb" }}>{openPRs.length}</span>
                    </h2>
                    {openPRs.map((pr) => <PRCard key={pr.number} pr={pr} timeAgo={timeAgo} />)}
                  </div>
                )}

                {/* Merged PRs */}
                {mergedPRs.length > 0 && (
                  <div>
                    <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10, color: "#0f172a" }}>
                      Recently Merged
                      <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 10, background: "#d1fae5", color: "#059669" }}>{mergedPRs.length}</span>
                    </h2>
                    {mergedPRs.slice(0, 10).map((pr) => <PRCard key={pr.number} pr={pr} timeAgo={timeAgo} />)}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Decisions & Learnings tab */}
        {activeTab === "decisions" && (
          <div>
            <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
              {["all", "requirement", "constraint", "decision"].map((f) => (
                <button
                  key={f}
                  onClick={() => setDlFilter(f)}
                  style={{
                    padding: "5px 14px", borderRadius: 6, border: "none",
                    background: dlFilter === f ? "#818cf8" : "#f1f5f9",
                    color: dlFilter === f ? "#fff" : "#64748b",
                    fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "var(--font)",
                  }}
                >
                  {f === "all" ? "All" : f.charAt(0).toUpperCase() + f.slice(1) + "s"}
                </button>
              ))}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              {[
                ...(dlFilter === "all" || dlFilter === "requirement" ? requirements.map((r: any) => ({ ...r, _type: "requirement", _title: r.title, _desc: r.description, _status: r.status })) : []),
                ...(dlFilter === "all" || dlFilter === "constraint" ? constraints.map((c: any) => ({ ...c, _type: "constraint", _title: `${c.type}: ${c.description?.slice(0, 60)}`, _desc: c.impact, _status: c.status })) : []),
              ].map((item, i) => (
                <div key={item.id || i} style={{
                  padding: 16, borderRadius: 10, border: "1px solid #e2e8f0", background: "#fff",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 4,
                      background: item._type === "requirement" ? "#d1fae520" : item._type === "constraint" ? "#fef3c720" : "#dbeafe20",
                      color: item._type === "requirement" ? "#059669" : item._type === "constraint" ? "#d97706" : "#2563eb",
                      textTransform: "uppercase",
                    }}>
                      {item._type}
                    </span>
                    {item._status && (
                      <span style={{ fontSize: 10, color: "#94a3b8" }}>{item._status}</span>
                    )}
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#0f172a", marginBottom: 4 }}>{item._title}</div>
                  {item._desc && (
                    <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.5 }}>{item._desc.slice(0, 120)}{item._desc.length > 120 ? "..." : ""}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Discovery Context tab */}
        {activeTab === "context" && (
          <div>
            <p style={{ fontSize: 13, color: "#64748b", marginBottom: 20, lineHeight: 1.6 }}>
              Inputs from the Discovery phase that inform code implementation. These requirements, constraints, and decisions were captured during client discovery and should guide technical decisions.
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div style={{ padding: 20, borderRadius: 10, border: "1px solid #e2e8f0", background: "#fff" }}>
                <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>Requirements ({requirements.length})</h3>
                {requirements.slice(0, 8).map((r: any) => (
                  <div key={r.req_id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: "1px solid #f1f5f9" }}>
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 4,
                      background: r.priority === "must" ? "#fee2e2" : "#dbeafe",
                      color: r.priority === "must" ? "#ef4444" : "#3b82f6",
                    }}>
                      {r.priority?.toUpperCase()}
                    </span>
                    <span style={{ fontSize: 12, color: "#0f172a", flex: 1 }}>{r.title}</span>
                    <span style={{ fontSize: 10, color: "#94a3b8" }}>{r.req_id}</span>
                  </div>
                ))}
              </div>
              <div style={{ padding: 20, borderRadius: 10, border: "1px solid #e2e8f0", background: "#fff" }}>
                <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>Constraints ({constraints.length})</h3>
                {constraints.map((c: any, i: number) => (
                  <div key={c.id || i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: "1px solid #f1f5f9" }}>
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 4,
                      background: c.type === "budget" ? "#fee2e2" : c.type === "technology" ? "#dbeafe" : "#fef3c7",
                      color: c.type === "budget" ? "#ef4444" : c.type === "technology" ? "#3b82f6" : "#d97706",
                    }}>
                      {c.type}
                    </span>
                    <span style={{ fontSize: 12, color: "#0f172a", flex: 1 }}>{c.description?.slice(0, 60)}</span>
                    <span style={{ fontSize: 10, color: "#94a3b8" }}>{c.status}</span>
                  </div>
                ))}
                {constraints.length === 0 && <p style={{ fontSize: 12, color: "#94a3b8" }}>No constraints defined yet.</p>}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function PRCard({ pr, timeAgo }: { pr: PR; timeAgo: (d: string) => string }) {
  return (
    <a
      href={pr.url}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        display: "flex", alignItems: "center", gap: 12, padding: "12px 16px",
        borderRadius: 10, border: "1px solid #e2e8f0", background: "#fff",
        marginBottom: 8, textDecoration: "none", transition: "all 0.15s",
        cursor: "pointer",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#818cf8"; e.currentTarget.style.background = "#faf5ff"; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#e2e8f0"; e.currentTarget.style.background = "#fff"; }}
    >
      {/* Status icon */}
      <div style={{
        width: 28, height: 28, borderRadius: "50%",
        background: pr.merged ? "#d1fae5" : pr.draft ? "#f1f5f9" : "#dbeafe",
        color: pr.merged ? "#059669" : pr.draft ? "#94a3b8" : "#2563eb",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 14, flexShrink: 0,
      }}>
        {pr.merged ? "✓" : pr.draft ? "◐" : "○"}
      </div>

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: "#818cf8" }}>#{pr.number}</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: "#0f172a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{pr.title}</span>
        </div>
        <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>
          {pr.author} · {pr.head_branch} → {pr.base_branch} · {timeAgo(pr.updated_at)}
        </div>
      </div>

      {/* Labels */}
      {pr.labels.length > 0 && (
        <div style={{ display: "flex", gap: 4 }}>
          {pr.labels.slice(0, 2).map((l) => (
            <span key={l} style={{ fontSize: 9, fontWeight: 600, padding: "2px 6px", borderRadius: 4, background: "#f1f5f9", color: "#64748b" }}>{l}</span>
          ))}
        </div>
      )}

      {/* Diff stats */}
      <div style={{ fontSize: 11, color: "#94a3b8", textAlign: "right", flexShrink: 0 }}>
        <span style={{ color: "#059669" }}>+{pr.additions}</span>
        {" "}
        <span style={{ color: "#ef4444" }}>-{pr.deletions}</span>
        <div style={{ fontSize: 10 }}>{pr.changed_files} files</div>
      </div>
    </a>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div>
      <div style={{ fontSize: 22, fontWeight: 800, color }}>{value}</div>
      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.6)" }}>{label}</div>
    </div>
  );
}
