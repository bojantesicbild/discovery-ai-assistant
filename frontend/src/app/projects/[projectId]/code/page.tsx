"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { listRepos, addRepo, removeRepo, getRepoPulls, getRepoCommits, getRepoInfo, getRepoBranches, getRepoWorkflows, listRequirements, listConstraints, listDecisions } from "@/lib/api";
import BrandLoader from "@/components/BrandLoader";

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
  { id: "commits", label: "Commits" },
  { id: "branches", label: "Branches" },
  { id: "ci", label: "CI" },
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
  const [pullsError, setPullsError] = useState<string | null>(null);
  const [commits, setCommits] = useState<any[]>([]);
  const [pageLoading, setPageLoading] = useState(true);
  const [repoInfo, setRepoInfo] = useState<any | null>(null);
  const [branches, setBranches] = useState<any[]>([]);
  const [workflowRuns, setWorkflowRuns] = useState<any[]>([]);
  const [selectedBranch, setSelectedBranch] = useState<string>("");
  const [prState, setPrState] = useState<"all" | "open" | "closed">("all");
  const [search, setSearch] = useState("");
  const [lastSynced, setLastSynced] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [branchMenuOpen, setBranchMenuOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("prs");
  const [showAddRepo, setShowAddRepo] = useState(false);
  const [newRepo, setNewRepo] = useState({ name: "", url: "", access_token: "" });
  const [decisions, setDecisions] = useState<any[]>([]);
  const [decisionItems, setDecisionItems] = useState<any[]>([]);
  const [requirements, setRequirements] = useState<any[]>([]);
  const [constraints, setConstraints] = useState<any[]>([]);
  const [dlFilter, setDlFilter] = useState("all");

  useEffect(() => {
    setPageLoading(true);
    (async () => {
      const [repoList] = await Promise.all([
        listRepos(projectId).catch(() => [] as Repo[]),
        loadDecisions(),
      ]);
      setRepos(repoList);
      if (repoList.length === 0) {
        setPageLoading(false);
        return;
      }
      const first = repoList[0];
      setSelectedRepo(first.id);
      // Wait for first repo's details before hiding the loader
      await Promise.all([
        getRepoPulls(projectId, first.id).then((d) => setPulls(d.pulls || [])).catch((err) => { setPulls([]); setPullsError(err.message || "Failed to load pull requests"); }),
        getRepoCommits(projectId, first.id).then((d) => setCommits(d.commits || [])).catch(() => setCommits([])),
        getRepoInfo(projectId, first.id).then((d) => setRepoInfo(d)).catch(() => setRepoInfo(null)),
        getRepoBranches(projectId, first.id).then((d) => setBranches(d.branches || [])).catch(() => setBranches([])),
        getRepoWorkflows(projectId, first.id).then((d) => setWorkflowRuns(d.runs || [])).catch(() => setWorkflowRuns([])),
      ]);
      setLastSynced(new Date());
      setPageLoading(false);
    })();
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
      const [reqs, cons, decs] = await Promise.all([
        listRequirements(projectId),
        listConstraints(projectId),
        listDecisions(projectId),
      ]);
      setRequirements(reqs.items || []);
      setConstraints(cons.items || []);
      setDecisionItems(decs.items || []);
    } catch {}
  }

  const loadRepoData = useCallback(async (repoId: string, branch?: string, state?: "all" | "open" | "closed") => {
    setLoadingPulls(true);
    setPullsError(null);
    await Promise.all([
      getRepoPulls(projectId, repoId, state || "all", branch || undefined)
        .then((d) => setPulls(d.pulls || []))
        .catch((err) => { setPulls([]); setPullsError(err.message || "Failed to load pull requests"); }),
      getRepoCommits(projectId, repoId, branch || undefined)
        .then((d) => setCommits(d.commits || []))
        .catch(() => setCommits([])),
      getRepoInfo(projectId, repoId).then((d) => setRepoInfo(d)).catch(() => setRepoInfo(null)),
      getRepoBranches(projectId, repoId).then((d) => setBranches(d.branches || [])).catch(() => setBranches([])),
      getRepoWorkflows(projectId, repoId).then((d) => setWorkflowRuns(d.runs || [])).catch(() => setWorkflowRuns([])),
    ]);
    setLoadingPulls(false);
    setLastSynced(new Date());
  }, [projectId]);

  // Reload when branch or PR state changes (not on initial mount — handled by the mount effect)
  useEffect(() => {
    if (!selectedRepo || pageLoading) return;
    loadRepoData(selectedRepo, selectedBranch, prState);
  }, [selectedBranch, prState]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reload all data when switching repos (after initial load)
  useEffect(() => {
    if (!selectedRepo || pageLoading) return;
    setSelectedBranch("");
    loadRepoData(selectedRepo, "", prState);
  }, [selectedRepo]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleRefresh() {
    if (!selectedRepo || refreshing) return;
    setRefreshing(true);
    try {
      await loadRepoData(selectedRepo, selectedBranch, prState);
    } finally {
      setRefreshing(false);
    }
  }

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

  const searchLower = search.trim().toLowerCase();
  const matchesPR = (p: PR) => !searchLower || p.title.toLowerCase().includes(searchLower) || p.author.toLowerCase().includes(searchLower) || String(p.number).includes(searchLower);
  const matchesCommit = (c: any) => !searchLower || c.message?.toLowerCase().includes(searchLower) || c.author?.toLowerCase().includes(searchLower) || c.sha?.includes(searchLower);
  const filteredPulls = pulls.filter(matchesPR);
  const openPRs = filteredPulls.filter((p) => p.state === "open" && !p.merged);
  const mergedPRs = filteredPulls.filter((p) => p.merged);
  const closedPRs = filteredPulls.filter((p) => p.state === "closed" && !p.merged);
  const filteredCommits = commits.filter(matchesCommit);

  function timeAgo(dateStr: string) {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  if (pageLoading) {
    return (
      <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "auto", background: "#fff" }}>
        <BrandLoader label="Loading code assistant" />
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "auto" }}>
      {/* Page header — matches app light + green palette */}
      <div style={{
        position: "relative", padding: "22px 28px 18px",
        background: "#fff", borderBottom: "1px solid var(--gray-200)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
          <span style={{
            fontSize: 10, fontWeight: 700, padding: "3px 10px", borderRadius: 20,
            background: "var(--green-light)", color: "var(--green-hover)",
            letterSpacing: 0.6, textTransform: "uppercase",
          }}>
            Phase 3 · Code
          </span>
          <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0, letterSpacing: -0.3, color: "var(--dark)" }}>
            Code Assistant
          </h1>
        </div>
        <p style={{ fontSize: 12, color: "var(--gray-500)", margin: 0, marginBottom: 18 }}>
          Track pull requests, commits, branches, and CI — connect code to discovery artifacts.
        </p>

        {repoInfo ? (
          <div style={{ display: "flex", alignItems: "flex-start", gap: 20, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 280px", minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
                <div style={{
                  width: 38, height: 38, borderRadius: 10,
                  background: "var(--green)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  boxShadow: "0 4px 12px rgba(0,229,160,0.25)", flexShrink: 0,
                }}>
                  <svg viewBox="0 0 16 16" style={{ width: 18, height: 18, fill: "var(--dark)" }}>
                    <path d="M2 2.5A2.5 2.5 0 014.5 0h8.75a.75.75 0 01.75.75v12.5a.75.75 0 01-.75.75h-2.5a.75.75 0 110-1.5h1.75v-2h-8a1 1 0 00-.714 1.7.75.75 0 01-1.072 1.05A2.495 2.495 0 012 11.5v-9zm10.5-1h-8a1 1 0 00-1 1v6.708A2.486 2.486 0 014.5 9h8V1.5z"/>
                  </svg>
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 16, fontWeight: 800, color: "var(--dark)", letterSpacing: -0.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {repoInfo.full_name}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 3 }}>
                    {repoInfo.language && (
                      <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--gray-600)" }}>
                        <span style={{ width: 8, height: 8, borderRadius: "50%", background: langColor(repoInfo.language) }} />
                        {repoInfo.language}
                      </span>
                    )}
                    <span style={{
                      fontSize: 9, padding: "2px 8px", borderRadius: 10,
                      background: repoInfo.private ? "var(--danger-light)" : "var(--green-light)",
                      color: repoInfo.private ? "var(--danger)" : "var(--green-hover)",
                      fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4,
                    }}>
                      {repoInfo.private ? "Private" : "Public"}
                    </span>
                    <span style={{ fontSize: 11, color: "var(--gray-500)" }}>
                      default: <code style={{ color: "var(--dark)", background: "var(--gray-100)", padding: "1px 6px", borderRadius: 4 }}>{repoInfo.default_branch}</code>
                    </span>
                  </div>
                </div>
              </div>
              {repoInfo.description && (
                <p style={{ fontSize: 12, color: "var(--gray-500)", margin: "8px 0 0", lineHeight: 1.5, maxWidth: 520 }}>
                  {repoInfo.description}
                </p>
              )}
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <MetricPill icon="pr" label="Open PRs" value={openPRs.length} accent="var(--green)" />
              <MetricPill icon="merge" label="Merged" value={mergedPRs.length} accent="var(--purple)" />
              <MetricPill icon="commit" label="Commits" value={commits.length} accent="var(--info)" />
              <MetricPill icon="branch" label="Branches" value={branches.length} accent="var(--orange)" />
              <MetricPill icon="star" label="Stars" value={repoInfo.stars} accent="var(--warning)" />
              <MetricPill icon="issue" label="Issues" value={repoInfo.open_issues} accent="var(--danger)" />
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <MetricPill icon="pr" label="Open PRs" value={openPRs.length} accent="var(--green)" />
            <MetricPill icon="merge" label="Merged" value={mergedPRs.length} accent="var(--purple)" />
            <MetricPill icon="repo" label="Repos" value={repos.length} accent="var(--orange)" />
            <MetricPill icon="req" label="Requirements" value={requirements.length} accent="var(--info)" />
          </div>
        )}
      </div>

      {/* Repo selector + tabs */}
      <div style={{
        display: "flex", alignItems: "center", gap: 12, padding: "12px 24px",
        borderBottom: "1px solid #e2e8f0",
        background: "linear-gradient(180deg, #fafbfc 0%, #ffffff 100%)",
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

        {/* Branch switcher */}
        {repos.length > 0 && branches.length > 0 && (
          <div style={{ position: "relative" }}>
            <button
              onClick={() => setBranchMenuOpen((o) => !o)}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "6px 12px", borderRadius: 8,
                border: "1px solid var(--gray-200)", background: "#fff",
                fontSize: 11, fontWeight: 600, color: "var(--dark)",
                cursor: "pointer", fontFamily: "var(--font)",
              }}
            >
              <svg viewBox="0 0 16 16" style={{ width: 12, height: 12, fill: "var(--green-hover)" }}>
                <path d="M11.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122V6A2.5 2.5 0 0110 8.5H6a1 1 0 00-1 1v1.128a2.251 2.251 0 11-1.5 0V5.372a2.25 2.25 0 111.5 0v1.836A2.492 2.492 0 016 7h4a1 1 0 001-1v-.628A2.25 2.25 0 019.5 3.25zM4.25 12a.75.75 0 100 1.5.75.75 0 000-1.5zM3.5 3.25a.75.75 0 111.5 0 .75.75 0 01-1.5 0z"/>
              </svg>
              <code style={{ fontFamily: "monospace", fontSize: 11 }}>{selectedBranch || repoInfo?.default_branch || "default"}</code>
              <svg viewBox="0 0 24 24" style={{ width: 12, height: 12, fill: "none", stroke: "var(--gray-400)", strokeWidth: 2, transform: branchMenuOpen ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            {branchMenuOpen && (
              <div style={{
                position: "absolute", top: "calc(100% + 6px)", right: 0,
                width: 240, maxHeight: 300, overflow: "auto",
                background: "#fff", border: "1px solid var(--gray-200)",
                borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.08)",
                zIndex: 100, padding: 4,
              }}>
                <button
                  onClick={() => { setSelectedBranch(""); setBranchMenuOpen(false); }}
                  style={{
                    display: "flex", alignItems: "center", gap: 8, width: "100%",
                    padding: "6px 10px", border: "none", borderRadius: 6,
                    background: selectedBranch === "" ? "var(--green-light)" : "transparent",
                    cursor: "pointer", fontFamily: "var(--font)",
                    fontSize: 11, fontWeight: 600, color: "var(--dark)",
                    textAlign: "left",
                  }}
                >
                  <span style={{ fontSize: 10, color: "var(--gray-500)" }}>default</span>
                  <code style={{ fontFamily: "monospace", fontSize: 11 }}>{repoInfo?.default_branch}</code>
                </button>
                <div style={{ height: 1, background: "var(--gray-100)", margin: "4px 0" }} />
                {branches.map((b: any) => (
                  <button
                    key={b.name}
                    onClick={() => { setSelectedBranch(b.name); setBranchMenuOpen(false); }}
                    style={{
                      display: "flex", alignItems: "center", gap: 8, width: "100%",
                      padding: "6px 10px", border: "none", borderRadius: 6,
                      background: selectedBranch === b.name ? "var(--green-light)" : "transparent",
                      cursor: "pointer", fontFamily: "var(--font)",
                      fontSize: 11, fontWeight: 500, color: "var(--dark)",
                      textAlign: "left",
                    }}
                  >
                    <code style={{ fontFamily: "monospace", fontSize: 11, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.name}</code>
                    <span style={{ fontFamily: "monospace", fontSize: 9, color: "var(--gray-400)" }}>{b.sha?.slice(0, 7)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Search */}
        {repos.length > 0 && (
          <div style={{ position: "relative" }}>
            <svg viewBox="0 0 24 24" style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", width: 12, height: 12, stroke: "var(--gray-400)", fill: "none", strokeWidth: 2 }}>
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter..."
              style={{
                padding: "6px 10px 6px 26px", borderRadius: 8,
                border: "1px solid var(--gray-200)", background: "#fff",
                fontSize: 11, width: 140, fontFamily: "var(--font)", color: "var(--dark)",
                outline: "none",
              }}
            />
          </div>
        )}

        {/* Refresh */}
        {repos.length > 0 && (
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            title={lastSynced ? `Last synced ${timeAgo(lastSynced.toISOString())}` : "Refresh"}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "6px 12px", borderRadius: 8,
              border: "1px solid var(--gray-200)", background: "#fff",
              fontSize: 11, fontWeight: 600, color: "var(--dark)",
              cursor: refreshing ? "default" : "pointer",
              fontFamily: "var(--font)", opacity: refreshing ? 0.6 : 1,
            }}
          >
            <svg
              viewBox="0 0 24 24"
              style={{
                width: 12, height: 12, fill: "none", stroke: "var(--green-hover)", strokeWidth: 2.5,
                animation: refreshing ? "spin 1s linear infinite" : "none",
              }}
            >
              <polyline points="23 4 23 10 17 10" />
              <polyline points="1 20 1 14 7 14" />
              <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
            </svg>
            {lastSynced ? timeAgo(lastSynced.toISOString()) : "Sync"}
            <style jsx>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </button>
        )}

        {/* Tabs */}
        <div style={{ display: "flex", gap: 4, padding: 3, background: "#f1f5f9", borderRadius: 10 }}>
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                padding: "6px 14px", border: "none", borderRadius: 7,
                background: activeTab === tab.id ? "#fff" : "transparent",
                color: activeTab === tab.id ? "#0f172a" : "#64748b",
                fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "var(--font)",
                boxShadow: activeTab === tab.id ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
                transition: "all 0.15s",
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
            {/* State toggle */}
            <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
              {(["all", "open", "closed"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setPrState(s)}
                  style={{
                    padding: "5px 14px", borderRadius: 8, border: "1px solid var(--gray-200)",
                    background: prState === s ? "var(--green)" : "#fff",
                    color: prState === s ? "var(--dark)" : "var(--gray-600)",
                    fontSize: 11, fontWeight: 700, cursor: "pointer",
                    fontFamily: "var(--font)", textTransform: "capitalize",
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
            {loadingPulls ? (
              <div style={{ textAlign: "center", padding: 40, color: "#94a3b8", fontSize: 13 }}>Loading pull requests...</div>
            ) : pullsError ? (
              <div style={{ padding: 16, borderRadius: 8, background: "#fef2f2", border: "1px solid #fecaca", color: "#991b1b", fontSize: 13 }}>
                <strong>Error loading pull requests:</strong> {pullsError}
                <div style={{ marginTop: 6, fontSize: 12, color: "#b91c1c" }}>
                  If this is a private repository, add a GitHub access token when adding the repo. If public, the GitHub API may be rate-limited — adding a token increases limits.
                </div>
              </div>
            ) : filteredPulls.length === 0 ? (
              <div style={{ textAlign: "center", padding: 40, color: "var(--gray-400)", fontSize: 13 }}>
                {searchLower ? `No pull requests match "${search}".` : "No pull requests found for this repository."}
              </div>
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
                  <div style={{ marginBottom: 24 }}>
                    <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10, color: "#0f172a" }}>
                      Recently Merged
                      <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 10, background: "#d1fae5", color: "#059669" }}>{mergedPRs.length}</span>
                    </h2>
                    {mergedPRs.slice(0, 10).map((pr) => <PRCard key={pr.number} pr={pr} timeAgo={timeAgo} />)}
                  </div>
                )}

                {/* Closed (not merged) PRs */}
                {closedPRs.length > 0 && (
                  <div>
                    <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10, color: "#0f172a" }}>
                      Closed
                      <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 10, background: "#f1f5f9", color: "#64748b" }}>{closedPRs.length}</span>
                    </h2>
                    {closedPRs.slice(0, 10).map((pr) => <PRCard key={pr.number} pr={pr} timeAgo={timeAgo} />)}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Commits tab — grouped timeline */}
        {activeTab === "commits" && repos.length > 0 && (
          <div>
            {filteredCommits.length === 0 ? (
              <div style={{ textAlign: "center", padding: 40, color: "#94a3b8", fontSize: 13 }}>
                {searchLower ? `No commits match "${search}".` : "No commits found."}
              </div>
            ) : (
              <div style={{ position: "relative", paddingLeft: 28 }}>
                {/* vertical timeline line */}
                <div style={{ position: "absolute", left: 11, top: 8, bottom: 8, width: 2, background: "linear-gradient(180deg, #e2e8f0 0%, #f1f5f9 100%)" }} />
                {groupCommitsByDay(filteredCommits).map((group) => (
                  <div key={group.label} style={{ marginBottom: 18 }}>
                    <div style={{
                      position: "relative", marginLeft: -28, marginBottom: 8,
                      display: "inline-block", padding: "3px 12px", borderRadius: 14,
                      background: "#0f172a", color: "#fff", fontSize: 10, fontWeight: 700,
                      textTransform: "uppercase", letterSpacing: 0.6,
                    }}>
                      {group.label}
                    </div>
                    {group.items.map((c: any) => (
                      <div key={c.sha} style={{ position: "relative", marginBottom: 6 }}>
                        {/* dot on timeline */}
                        <div style={{
                          position: "absolute", left: -22, top: 14,
                          width: 12, height: 12, borderRadius: "50%",
                          background: "#fff", border: "2px solid #00E5A0",
                          boxShadow: "0 0 0 3px rgba(0,229,160,0.15)",
                        }} />
                        <a href={c.url} target="_blank" rel="noopener noreferrer" style={{
                          display: "flex", alignItems: "center", gap: 12, padding: "10px 14px",
                          borderRadius: 10, border: "1px solid #e2e8f0", background: "#fff",
                          textDecoration: "none", transition: "all 0.15s",
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#06b6d4"; e.currentTarget.style.boxShadow = "0 4px 12px rgba(6,182,212,0.08)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#e2e8f0"; e.currentTarget.style.boxShadow = "none"; }}
                        >
                          <code style={{
                            fontSize: 10, fontFamily: "monospace", fontWeight: 700,
                            padding: "3px 8px", borderRadius: 6,
                            background: "#f0f9ff", color: "#0369a1",
                          }}>{c.sha}</code>
                          <span style={{ fontSize: 13, color: "#0f172a", fontWeight: 500, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.message}</span>
                          {c.author_avatar ? (
                            <img src={c.author_avatar} alt={c.author} style={{ width: 20, height: 20, borderRadius: "50%", border: "1px solid #e2e8f0" }} />
                          ) : (
                            <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#f1f5f9", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 700, color: "#64748b" }}>
                              {c.author?.[0]?.toUpperCase() || "?"}
                            </div>
                          )}
                          <span style={{ fontSize: 11, color: "#64748b", fontWeight: 500 }}>{c.author}</span>
                          <span style={{ fontSize: 10, color: "#94a3b8", minWidth: 60, textAlign: "right" }}>{timeAgo(c.date)}</span>
                        </a>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Branches tab — cards */}
        {activeTab === "branches" && repos.length > 0 && (
          <div>
            {branches.length === 0 ? (
              <div style={{ textAlign: "center", padding: 40, color: "#94a3b8", fontSize: 13 }}>No branches found.</div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
                {branches.map((b: any) => {
                  const isDefault = repoInfo && b.name === repoInfo.default_branch;
                  return (
                    <div key={b.name} style={{
                      position: "relative", padding: "14px 16px", borderRadius: 12,
                      border: "1px solid #e2e8f0", background: "#fff",
                      transition: "all 0.15s", overflow: "hidden",
                    }}>
                      {isDefault && (
                        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: "linear-gradient(90deg, #00E5A0, #06b6d4)" }} />
                      )}
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                        <div style={{
                          width: 28, height: 28, borderRadius: 8,
                          background: isDefault ? "linear-gradient(135deg, #00E5A0, #06b6d4)" : "#eef2ff",
                          display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                        }}>
                          <svg viewBox="0 0 16 16" style={{ width: 14, height: 14, fill: isDefault ? "#0f172a" : "#6366f1" }}>
                            <path d="M11.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122V6A2.5 2.5 0 0110 8.5H6a1 1 0 00-1 1v1.128a2.251 2.251 0 11-1.5 0V5.372a2.25 2.25 0 111.5 0v1.836A2.492 2.492 0 016 7h4a1 1 0 001-1v-.628A2.25 2.25 0 019.5 3.25zM4.25 12a.75.75 0 100 1.5.75.75 0 000-1.5zM3.5 3.25a.75.75 0 111.5 0 .75.75 0 01-1.5 0z"/>
                          </svg>
                        </div>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {b.name}
                          </div>
                          <code style={{ fontSize: 10, fontFamily: "monospace", color: "#94a3b8" }}>{b.sha?.slice(0, 7)}</code>
                        </div>
                        {isDefault && (
                          <span style={{
                            fontSize: 9, fontWeight: 700, padding: "2px 8px", borderRadius: 10,
                            background: "#d1fae5", color: "#059669", textTransform: "uppercase", letterSpacing: 0.4,
                          }}>
                            Default
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* CI tab — status cards */}
        {activeTab === "ci" && repos.length > 0 && (
          <div>
            {workflowRuns.length === 0 ? (
              <div style={{ textAlign: "center", padding: 60, color: "#94a3b8" }}>
                <svg viewBox="0 0 24 24" style={{ width: 40, height: 40, stroke: "currentColor", fill: "none", strokeWidth: 1.5, margin: "0 auto 10px" }}>
                  <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
                </svg>
                <p style={{ fontSize: 13, fontWeight: 600 }}>No workflow runs yet</p>
                <p style={{ fontSize: 11 }}>GitHub Actions workflows will appear here once they run.</p>
              </div>
            ) : (
              workflowRuns.map((r: any) => {
                const success = r.conclusion === "success";
                const failure = r.conclusion === "failure";
                const running = r.status === "in_progress" || r.status === "queued";
                const stripeColor = success ? "#00E5A0" : failure ? "#ef4444" : running ? "#f59e0b" : "#94a3b8";
                const icon = success ? "✓" : failure ? "✕" : running ? "◐" : "○";
                const iconBg = success ? "#d1fae5" : failure ? "#fee2e2" : running ? "#fef3c7" : "#f1f5f9";
                const iconFg = success ? "#059669" : failure ? "#dc2626" : running ? "#d97706" : "#64748b";
                const label = r.conclusion || r.status;
                return (
                  <a key={r.id} href={r.url} target="_blank" rel="noopener noreferrer" style={{
                    position: "relative", display: "flex", alignItems: "center", gap: 14,
                    padding: "14px 18px 14px 22px", borderRadius: 12, border: "1px solid #e2e8f0",
                    background: "#fff", marginBottom: 8, textDecoration: "none",
                    transition: "all 0.2s", overflow: "hidden",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = stripeColor; e.currentTarget.style.transform = "translateY(-1px)"; e.currentTarget.style.boxShadow = "0 6px 16px rgba(15,23,42,0.06)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#e2e8f0"; e.currentTarget.style.transform = "none"; e.currentTarget.style.boxShadow = "none"; }}
                  >
                    <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 4, background: stripeColor }} />
                    <div style={{
                      width: 36, height: 36, borderRadius: 10,
                      background: iconBg, color: iconFg,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 18, fontWeight: 700, flexShrink: 0,
                    }}>
                      {icon}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: "#0f172a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</span>
                        <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 8px", borderRadius: 10, background: iconBg, color: iconFg, textTransform: "uppercase", letterSpacing: 0.4 }}>
                          {label}
                        </span>
                      </div>
                      <div style={{ fontSize: 11, color: "#64748b", display: "flex", alignItems: "center", gap: 10 }}>
                        {r.workflow && <code style={{ fontFamily: "monospace", color: "#818cf8" }}>{r.workflow}</code>}
                        <span>·</span>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                          <svg viewBox="0 0 16 16" style={{ width: 10, height: 10, fill: "currentColor" }}>
                            <path d="M11.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122V6A2.5 2.5 0 0110 8.5H6a1 1 0 00-1 1v1.128a2.251 2.251 0 11-1.5 0V5.372a2.25 2.25 0 111.5 0v1.836A2.492 2.492 0 016 7h4a1 1 0 001-1v-.628A2.25 2.25 0 019.5 3.25z"/>
                          </svg>
                          {r.branch}
                        </span>
                        <span>·</span>
                        <span style={{ textTransform: "capitalize" }}>{r.event}</span>
                        {r.actor && <><span>·</span><span>{r.actor}</span></>}
                      </div>
                    </div>
                    <span style={{ fontSize: 11, color: "#94a3b8", flexShrink: 0 }}>{timeAgo(r.created_at)}</span>
                  </a>
                );
              })
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
                ...(dlFilter === "all" || dlFilter === "decision" ? decisionItems.map((d: any) => ({ ...d, _type: "decision", _title: d.title, _desc: d.rationale, _status: d.status })) : []),
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
  const stripeColor = pr.merged ? "#8b5cf6" : pr.draft ? "#94a3b8" : "#00E5A0";
  const statusLabel = pr.merged ? "Merged" : pr.draft ? "Draft" : "Open";
  const statusBg = pr.merged ? "#ede9fe" : pr.draft ? "#f1f5f9" : "#d1fae5";
  const statusFg = pr.merged ? "#7c3aed" : pr.draft ? "#64748b" : "#059669";
  const hasStats = pr.additions > 0 || pr.deletions > 0 || pr.changed_files > 0;

  return (
    <a
      href={pr.url}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        position: "relative", display: "flex", alignItems: "center", gap: 14,
        padding: "14px 18px 14px 22px", borderRadius: 12, border: "1px solid #e2e8f0",
        background: "#fff", marginBottom: 10, textDecoration: "none",
        transition: "all 0.2s", cursor: "pointer", overflow: "hidden",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = stripeColor;
        e.currentTarget.style.transform = "translateY(-1px)";
        e.currentTarget.style.boxShadow = "0 6px 16px rgba(15,23,42,0.06)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = "#e2e8f0";
        e.currentTarget.style.transform = "none";
        e.currentTarget.style.boxShadow = "none";
      }}
    >
      {/* Left colored stripe */}
      <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 4, background: stripeColor }} />

      {/* Author avatar */}
      {pr.author_avatar ? (
        <img src={pr.author_avatar} alt={pr.author} style={{ width: 36, height: 36, borderRadius: "50%", flexShrink: 0, border: "2px solid #f1f5f9" }} />
      ) : (
        <div style={{ width: 36, height: 36, borderRadius: "50%", background: "#f1f5f9", color: "#64748b", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, flexShrink: 0 }}>
          {pr.author?.[0]?.toUpperCase() || "?"}
        </div>
      )}

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 10, background: statusBg, color: statusFg, textTransform: "uppercase", letterSpacing: 0.4 }}>
            {statusLabel}
          </span>
          <span style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8" }}>#{pr.number}</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#0f172a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0, flex: 1 }}>
            {pr.title}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 11, color: "#64748b", flexWrap: "wrap" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <svg viewBox="0 0 16 16" style={{ width: 11, height: 11, fill: "currentColor" }}>
              <path d="M8 8a3 3 0 100-6 3 3 0 000 6zm2-3a2 2 0 11-4 0 2 2 0 014 0zm4 8c0 1-1 1-1 1H3s-1 0-1-1 1-4 6-4 6 3 6 4zm-1-.004c-.001-.246-.154-.986-.832-1.664C11.516 10.68 10.289 10 8 10c-2.29 0-3.516.68-4.168 1.332-.678.678-.83 1.418-.832 1.664h10z"/>
            </svg>
            {pr.author}
          </span>
          <span style={{
            display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px",
            background: "#f8fafc", borderRadius: 6, border: "1px solid #e2e8f0",
            fontFamily: "monospace", fontSize: 10,
          }}>
            <span style={{ color: "#818cf8" }}>{pr.head_branch}</span>
            <svg viewBox="0 0 24 24" style={{ width: 10, height: 10, fill: "none", stroke: "#94a3b8", strokeWidth: 2.5 }}>
              <polyline points="9 18 15 12 9 6" />
            </svg>
            <span style={{ color: "#06b6d4" }}>{pr.base_branch}</span>
          </span>
          <span style={{ color: "#94a3b8" }}>{timeAgo(pr.updated_at)}</span>
          {pr.labels.slice(0, 3).map((l) => (
            <span key={l} style={{ fontSize: 9, fontWeight: 600, padding: "2px 7px", borderRadius: 10, background: "#eef2ff", color: "#6366f1" }}>{l}</span>
          ))}
        </div>
      </div>

      {/* Diff stats */}
      {hasStats && (
        <div style={{ textAlign: "right", flexShrink: 0, paddingLeft: 8, borderLeft: "1px solid #f1f5f9" }}>
          <div style={{ fontSize: 12, fontWeight: 700 }}>
            <span style={{ color: "#059669" }}>+{pr.additions}</span>
            <span style={{ color: "#cbd5e1", margin: "0 3px" }}>·</span>
            <span style={{ color: "#ef4444" }}>−{pr.deletions}</span>
          </div>
          <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 2 }}>{pr.changed_files} file{pr.changed_files !== 1 ? "s" : ""}</div>
        </div>
      )}
    </a>
  );
}

function MetricPill({ icon, label, value, accent }: { icon: string; label: string; value: number | string; accent: string }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10,
      padding: "8px 14px 8px 10px", borderRadius: 10,
      background: "var(--gray-50)",
      border: "1px solid var(--gray-200)",
      minWidth: 112,
    }}>
      <div style={{
        width: 30, height: 30, borderRadius: 8,
        background: "#fff", color: accent,
        border: `1px solid ${accent}`,
        display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
      }}>
        <MetricIcon kind={icon} />
      </div>
      <div style={{ lineHeight: 1.1 }}>
        <div style={{ fontSize: 17, fontWeight: 800, color: "var(--dark)" }}>{value}</div>
        <div style={{ fontSize: 9, color: "var(--gray-500)", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 2, fontWeight: 600 }}>{label}</div>
      </div>
    </div>
  );
}

function MetricIcon({ kind }: { kind: string }) {
  const common = { width: 14, height: 14, fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (kind) {
    case "pr":
      return <svg viewBox="0 0 24 24" {...common}><circle cx="18" cy="18" r="3" /><circle cx="6" cy="6" r="3" /><path d="M13 6h3a2 2 0 012 2v7" /><line x1="6" y1="9" x2="6" y2="21" /></svg>;
    case "merge":
      return <svg viewBox="0 0 24 24" {...common}><circle cx="18" cy="18" r="3" /><circle cx="6" cy="6" r="3" /><path d="M6 21V9a9 9 0 009 9" /></svg>;
    case "commit":
      return <svg viewBox="0 0 24 24" {...common}><circle cx="12" cy="12" r="4" /><line x1="1.05" y1="12" x2="7" y2="12" /><line x1="17.01" y1="12" x2="22.96" y2="12" /></svg>;
    case "branch":
      return <svg viewBox="0 0 24 24" {...common}><line x1="6" y1="3" x2="6" y2="15" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M18 9a9 9 0 01-9 9" /></svg>;
    case "star":
      return <svg viewBox="0 0 24 24" {...common}><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>;
    case "issue":
      return <svg viewBox="0 0 24 24" {...common}><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>;
    case "repo":
      return <svg viewBox="0 0 24 24" {...common}><path d="M4 19.5A2.5 2.5 0 016.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" /></svg>;
    case "req":
      return <svg viewBox="0 0 24 24" {...common}><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" /></svg>;
    default:
      return null;
  }
}

function langColor(lang: string): string {
  const map: Record<string, string> = {
    TypeScript: "#3178c6", JavaScript: "#f1e05a", Python: "#3572A5",
    Go: "#00ADD8", Rust: "#dea584", Java: "#b07219", "C++": "#f34b7d",
    C: "#555555", Ruby: "#701516", PHP: "#4F5D95", Swift: "#F05138",
    Kotlin: "#A97BFF", HTML: "#e34c26", CSS: "#563d7c", Shell: "#89e051",
    Vue: "#41b883", Svelte: "#ff3e00",
  };
  return map[lang] || "#94a3b8";
}

function groupCommitsByDay(commits: any[]): { label: string; items: any[] }[] {
  const groups: Record<string, any[]> = {};
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterday = today - 86400000;
  const weekAgo = today - 7 * 86400000;
  for (const c of commits) {
    const t = new Date(c.date).getTime();
    let label: string;
    if (t >= today) label = "Today";
    else if (t >= yesterday) label = "Yesterday";
    else if (t >= weekAgo) label = "This week";
    else label = new Date(c.date).toLocaleDateString(undefined, { month: "short", year: "numeric" });
    (groups[label] ||= []).push(c);
  }
  const order = ["Today", "Yesterday", "This week"];
  const keys = Object.keys(groups).sort((a, b) => {
    const ai = order.indexOf(a); const bi = order.indexOf(b);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return 0;
  });
  return keys.map((k) => ({ label: k, items: groups[k] }));
}
