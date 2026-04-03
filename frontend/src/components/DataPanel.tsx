"use client";

import { useEffect, useState } from "react";
import {
  getDashboard, listRequirements, listContradictions, listDocuments,
  deleteDocument, listConstraints, listDecisions, listStakeholders,
  listAssumptions, listScope, updateRequirement,
} from "@/lib/api";
import MarkdownPanel from "./MarkdownPanel";

interface DataPanelProps {
  projectId: string;
  refreshKey?: number;
}

interface DetailView {
  title: string;
  content: string;
  meta?: Record<string, string>;
  actions?: { label: string; value: string; color: string }[];
  onAction?: (value: string) => void;
}

const TABS = [
  { id: "reqs", label: "Business Requirements" },
  { id: "constraints", label: "Constraints" },
  { id: "decisions", label: "Decisions" },
  { id: "stakeholders", label: "Stakeholders" },
  { id: "assumptions", label: "Assumptions" },
  { id: "scope", label: "Scope" },
  { id: "contradictions", label: "Contradictions" },
  { id: "docs", label: "Documents" },
];

export default function DataPanel({ projectId, refreshKey = 0 }: DataPanelProps) {
  const [activeTab, setActiveTab] = useState("reqs");
  const [dashboard, setDashboard] = useState<any>(null);
  const [requirements, setRequirements] = useState<any[]>([]);
  const [contradictions, setContradictions] = useState<any[]>([]);
  const [documents, setDocuments] = useState<any[]>([]);
  const [constraintsData, setConstraintsData] = useState<any[]>([]);
  const [decisionsData, setDecisionsData] = useState<any[]>([]);
  const [stakeholdersData, setStakeholdersData] = useState<any[]>([]);
  const [assumptionsData, setAssumptionsData] = useState<any[]>([]);
  const [scopeData, setScopeData] = useState<any[]>([]);
  const [detail, setDetail] = useState<DetailView | null>(null);
  const [priorityFilter, setPriorityFilter] = useState<string>("all");

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 15000);
    return () => clearInterval(interval);
  }, [projectId, refreshKey]);

  async function loadData() {
    try {
      const [dash, reqs, contras, docs, cons, decs, stks, asms, scps] = await Promise.all([
        getDashboard(projectId),
        listRequirements(projectId),
        listContradictions(projectId),
        listDocuments(projectId),
        listConstraints(projectId),
        listDecisions(projectId),
        listStakeholders(projectId),
        listAssumptions(projectId),
        listScope(projectId),
      ]);
      setDashboard(dash);
      setRequirements(reqs.items || []);
      setContradictions(contras.items || []);
      setDocuments(docs.documents || []);
      setConstraintsData(cons.items || []);
      setDecisionsData(decs.items || []);
      setStakeholdersData(stks.items || []);
      setAssumptionsData(asms.items || []);
      setScopeData(scps.items || []);
    } catch {
      // Backend might not be ready
    }
  }

  const readiness = dashboard?.readiness;
  const score = readiness?.score ?? 0;
  const circumference = 2 * Math.PI * 15; // r=15 for viewBox 36
  const offset = circumference - (score / 100) * circumference;

  function openRequirement(req: any) {
    const md = [
      `# ${req.req_id}: ${req.title}`,
      "",
      `**Type:** ${req.type} | **Priority:** ${req.priority} | **Status:** ${req.status} | **Confidence:** ${req.confidence}`,
      "",
      "## Description",
      req.description || "No description",
      "",
      req.user_perspective ? `## User Perspective\n${req.user_perspective}` : "",
      "",
      req.business_rules?.length ? `## Business Rules\n${req.business_rules.map((r: string) => `- ${r}`).join("\n")}` : "",
      "",
      req.edge_cases?.length ? `## Edge Cases\n${req.edge_cases.map((e: string) => `- ${e}`).join("\n")}` : "",
      "",
      "## Source",
      `> ${req.source_quote || "No source quote"}`,
    ].filter(Boolean).join("\n");

    setDetail({
      title: `${req.req_id}: ${req.title}`,
      content: md,
      meta: {
        priority: req.priority,
        status: req.status,
        type: req.type,
        confidence: req.confidence,
      },
      actions: [
        { label: "Confirm", value: "confirmed", color: "#059669" },
        { label: "Discussed", value: "discussed", color: "var(--info)" },
        { label: "Drop", value: "dropped", color: "var(--danger)" },
      ],
      onAction: async (action: string) => {
        await updateRequirement(projectId, req.req_id, { status: action });
        loadData();
        setDetail(null);
      },
    });
  }

  function openDocument(doc: any) {
    const md = [
      `# ${doc.filename}`,
      "",
      `**Type:** ${doc.file_type} | **Size:** ${doc.file_size_bytes ? `${(doc.file_size_bytes / 1024).toFixed(1)} KB` : "unknown"} | **Status:** ${doc.pipeline_stage}`,
      "",
      `**Uploaded:** ${doc.created_at ? new Date(doc.created_at).toLocaleString() : "unknown"}`,
      "",
      doc.items_extracted > 0 ? `**Extracted:** ${doc.items_extracted} items` : "",
      doc.contradictions_found > 0 ? `**Contradictions:** ${doc.contradictions_found} found` : "",
      "",
      doc.pipeline_error ? `## Pipeline Error\n\`\`\`\n${doc.pipeline_error}\n\`\`\`` : "",
      "",
      "## Processing Pipeline",
      `- Classification: ${doc.chunking_template || "auto"}`,
      `- Stage: ${doc.pipeline_stage}`,
      doc.pipeline_started_at ? `- Started: ${new Date(doc.pipeline_started_at).toLocaleString()}` : "",
      doc.pipeline_completed_at ? `- Completed: ${new Date(doc.pipeline_completed_at).toLocaleString()}` : "",
    ].filter(Boolean).join("\n");

    setDetail({
      title: doc.filename,
      content: md,
      meta: {
        type: doc.file_type,
        status: doc.pipeline_stage,
      },
    });
  }

  // If a detail view is open, show the markdown panel
  if (detail) {
    return (
      <div className="data-panel" style={{ flex: 1, width: "100%" }}>
        <MarkdownPanel
          title={detail.title}
          content={detail.content}
          meta={detail.meta}
          onClose={() => setDetail(null)}
          actions={detail.actions}
          onAction={detail.onAction}
        />
      </div>
    );
  }

  return (
    <div className="data-panel" style={{ flex: 1, width: "100%" }}>
      {/* Header with readiness ring */}
      <div className="dp-header">
        <div className="dp-readiness">
          <div className="dp-rb-ring">
            <svg viewBox="0 0 36 36">
              <circle cx="18" cy="18" r="15" className="bg" />
              <circle
                cx="18" cy="18" r="15" className="fg"
                style={{
                  strokeDasharray: circumference,
                  strokeDashoffset: offset,
                }}
              />
            </svg>
            <div className="dp-rb-val">{Math.round(score)}%</div>
          </div>
          <div>
            <div className="dp-rb-label">Discovery Readiness</div>
            <div className="dp-rb-sub">
              {score >= 85 ? "Ready for handoff" : score >= 65 ? "Conditionally ready" : "Not ready"} ·{" "}
              {dashboard?.requirements_count ?? 0} business requirements
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="dp-tabs">
        {TABS.map((tab) => {
          let count: number | null = null;
          if (tab.id === "reqs") count = requirements.length;
          if (tab.id === "constraints") count = constraintsData.length;
          if (tab.id === "decisions") count = decisionsData.length;
          if (tab.id === "stakeholders") count = stakeholdersData.length;
          if (tab.id === "assumptions") count = assumptionsData.length;
          if (tab.id === "scope") count = scopeData.length;
          if (tab.id === "contradictions") count = contradictions.length;
          if (tab.id === "docs") count = documents.length;

          return (
            <div
              key={tab.id}
              className={`dp-tab${activeTab === tab.id ? " active" : ""}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
              {count !== null && <span className="tab-count">{count}</span>}
            </div>
          );
        })}
      </div>

      {/* Tab content */}
      <div className="dp-body">
        {/* Requirements tab */}
        {activeTab === "reqs" && (
          <div className="dp-tab-content active">
            <div className="panel-filter">
              {["all", "must", "should", "could"].map((f) => (
                <button
                  key={f}
                  className={`panel-filter-btn${priorityFilter === f ? " active" : ""}`}
                  onClick={() => setPriorityFilter(f)}
                  style={{ textTransform: "capitalize" }}
                >
                  {f === "all" ? "All" : f}
                </button>
              ))}
            </div>
            {requirements.length === 0 ? (
              <div style={{ textAlign: "center", padding: 40, color: "var(--gray-400)", fontSize: 13 }}>
                No business requirements extracted yet. Upload documents to get started.
              </div>
            ) : (
              <table className="panel-table">
                <thead>
                  <tr>
                    <th style={{ width: 30 }}></th>
                    <th>ID</th>
                    <th>Business Requirement</th>
                    <th>Priority</th>
                    <th>Status</th>
                    <th>Confidence</th>
                  </tr>
                </thead>
                <tbody>
                  {requirements.filter((r: any) => priorityFilter === "all" || r.priority === priorityFilter).map((req: any) => (
                    <tr key={req.id || req.req_id} onClick={() => openRequirement(req)} style={{ cursor: "pointer" }}>
                      <td className="chevron-cell">
                        <svg viewBox="0 0 24 24" style={{ width: 14, height: 14, stroke: "var(--gray-400)", fill: "none", strokeWidth: 2 }}>
                          <polyline points="9 18 15 12 9 6" />
                        </svg>
                      </td>
                      <td style={{ fontWeight: 700, color: "var(--green)", whiteSpace: "nowrap" }}>{req.req_id}</td>
                      <td>
                        <div style={{ fontWeight: 600, fontSize: 12 }}>{req.title}</div>
                        <div style={{ fontSize: 11, color: "var(--gray-500)", marginTop: 2 }}>{req.description?.slice(0, 80)}{req.description?.length > 80 ? "..." : ""}</div>
                      </td>
                      <td>
                        <span className={`pri-badge ${req.priority}`}>{req.priority?.toUpperCase()}</span>
                      </td>
                      <td>
                        <span className={`fact-status ${req.status}`}>
                          <span style={{ width: 5, height: 5, borderRadius: "50%", background: "currentColor" }} />
                          {req.status}
                        </span>
                      </td>
                      <td style={{ fontSize: 11, color: "var(--gray-500)" }}>{req.confidence}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* Contradictions tab */}
        {activeTab === "contradictions" && (
          <div className="dp-tab-content active">
            {contradictions.length === 0 ? (
              <div style={{ textAlign: "center", padding: 40, color: "var(--gray-400)", fontSize: 13 }}>
                No contradictions detected.
              </div>
            ) : (
              <table className="panel-table">
                <thead>
                  <tr>
                    <th>Type A</th>
                    <th>Type B</th>
                    <th>Explanation</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {contradictions.map((c: any) => (
                    <tr key={c.id}>
                      <td>{c.item_a_type}</td>
                      <td>{c.item_b_type}</td>
                      <td>{c.explanation}</td>
                      <td>
                        <span className={`fact-status ${c.resolved ? "confirmed" : "assumed"}`}>
                          {c.resolved ? "Resolved" : "Open"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* Documents tab */}
        {activeTab === "docs" && (
          <div className="dp-tab-content active">
            {documents.length === 0 ? (
              <div style={{ textAlign: "center", padding: 40, color: "var(--gray-400)", fontSize: 13 }}>
                No documents uploaded yet. Click &ldquo;Upload Document&rdquo; to get started.
              </div>
            ) : (
              <table className="panel-table">
                <thead>
                  <tr>
                    <th>File</th>
                    <th>Type</th>
                    <th>Size</th>
                    <th>Status</th>
                    <th>Extracted</th>
                    <th>Date</th>
                    <th style={{ width: 40 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {documents.map((doc: any) => (
                    <tr key={doc.id} onClick={() => openDocument(doc)} style={{ cursor: "pointer" }}>
                      <td style={{ fontWeight: 600 }}>{doc.filename}</td>
                      <td>
                        <span className="pri-badge could" style={{ textTransform: "uppercase" }}>
                          {doc.file_type}
                        </span>
                      </td>
                      <td style={{ color: "var(--gray-500)" }}>
                        {doc.file_size_bytes ? `${(doc.file_size_bytes / 1024).toFixed(1)} KB` : "—"}
                      </td>
                      <td>
                        <span className={`fact-status ${
                          doc.pipeline_stage === "completed" ? "confirmed" :
                          doc.pipeline_stage === "failed" ? "assumed" : "pending"
                        }`}>
                          <span style={{ width: 5, height: 5, borderRadius: "50%", background: "currentColor" }} />
                          {doc.pipeline_stage}
                        </span>
                      </td>
                      <td>
                        {doc.items_extracted > 0 ? (
                          <span>
                            {doc.items_extracted} items
                            {doc.contradictions_found > 0 && (
                              <span style={{ color: "var(--danger)", marginLeft: 4, fontSize: 10 }}>
                                +{doc.contradictions_found} conflicts
                              </span>
                            )}
                          </span>
                        ) : (
                          <span style={{ color: "var(--gray-400)" }}>—</span>
                        )}
                      </td>
                      <td style={{ color: "var(--gray-500)", whiteSpace: "nowrap" }}>
                        {doc.created_at ? new Date(doc.created_at).toLocaleDateString() : "—"}
                      </td>
                      <td>
                        <button
                          title="Delete document"
                          style={{
                            width: 26, height: 26, borderRadius: 6,
                            border: "1px solid var(--gray-200)", background: "var(--white)",
                            display: "inline-flex", alignItems: "center", justifyContent: "center",
                            cursor: "pointer", transition: "all 0.15s",
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = "var(--danger-light)";
                            e.currentTarget.style.borderColor = "var(--danger)";
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = "var(--white)";
                            e.currentTarget.style.borderColor = "var(--gray-200)";
                          }}
                          onClick={async (e) => {
                            e.stopPropagation();
                            if (!confirm(`Delete ${doc.filename}?`)) return;
                            try {
                              await deleteDocument(projectId, doc.id);
                              loadData();
                            } catch {
                              alert("Delete failed");
                            }
                          }}
                        >
                          <svg viewBox="0 0 24 24" style={{ width: 12, height: 12, stroke: "var(--danger)", fill: "none", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" }}>
                            <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                          </svg>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* Constraints tab */}
        {activeTab === "constraints" && (
          <div className="dp-tab-content active">
            {constraintsData.length === 0 ? (
              <div style={{ textAlign: "center", padding: 40, color: "var(--gray-400)", fontSize: 13 }}>No constraints extracted yet.</div>
            ) : (
              <table className="panel-table">
                <thead><tr><th>Type</th><th>Description</th><th>Impact</th><th>Status</th></tr></thead>
                <tbody>
                  {constraintsData.map((c: any, i: number) => (
                    <tr key={c.id || i} onClick={() => setDetail({ title: `${c.type} Constraint`, content: `# ${c.type} Constraint\n\n${c.description}\n\n## Impact\n${c.impact}\n\n## Source\n> ${c.source_quote || "N/A"}`, meta: { type: c.type, status: c.status } })} style={{ cursor: "pointer" }}>
                      <td><span className="pri-badge should" style={{ textTransform: "capitalize" }}>{c.type}</span></td>
                      <td style={{ maxWidth: 300 }}>{c.description}</td>
                      <td style={{ color: "var(--gray-500)", fontSize: 11 }}>{c.impact?.slice(0, 80)}</td>
                      <td><span className={`fact-status ${c.status === "confirmed" ? "confirmed" : "assumed"}`}><span style={{ width: 5, height: 5, borderRadius: "50%", background: "currentColor" }} />{c.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* Decisions tab */}
        {activeTab === "decisions" && (
          <div className="dp-tab-content active">
            {decisionsData.length === 0 ? (
              <div style={{ textAlign: "center", padding: 40, color: "var(--gray-400)", fontSize: 13 }}>No decisions recorded yet.</div>
            ) : (
              <table className="panel-table">
                <thead><tr><th>Decision</th><th>Decided By</th><th>Rationale</th><th>Status</th></tr></thead>
                <tbody>
                  {decisionsData.map((d: any, i: number) => (
                    <tr key={d.id || i} onClick={() => setDetail({ title: d.title, content: `# ${d.title}\n\n**Decided by:** ${d.decided_by || "unknown"}\n**Status:** ${d.status}\n\n## Rationale\n${d.rationale}\n\n${d.alternatives?.length ? `## Alternatives Considered\n${d.alternatives.map((a: string) => `- ${a}`).join("\n")}` : ""}`, meta: { status: d.status, decided_by: d.decided_by || "unknown" } })} style={{ cursor: "pointer" }}>
                      <td style={{ fontWeight: 600 }}>{d.title}</td>
                      <td>{d.decided_by || "—"}</td>
                      <td style={{ color: "var(--gray-500)", fontSize: 11, maxWidth: 250 }}>{d.rationale?.slice(0, 80)}</td>
                      <td><span className={`fact-status ${d.status === "confirmed" ? "confirmed" : "pending"}`}><span style={{ width: 5, height: 5, borderRadius: "50%", background: "currentColor" }} />{d.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* Stakeholders tab */}
        {activeTab === "stakeholders" && (
          <div className="dp-tab-content active">
            {stakeholdersData.length === 0 ? (
              <div style={{ textAlign: "center", padding: 40, color: "var(--gray-400)", fontSize: 13 }}>No stakeholders identified yet.</div>
            ) : (
              <table className="panel-table">
                <thead><tr><th>Name</th><th>Role</th><th>Organization</th><th>Authority</th><th>Interests</th></tr></thead>
                <tbody>
                  {stakeholdersData.map((s: any, i: number) => (
                    <tr key={s.id || i} onClick={() => setDetail({ title: s.name, content: `# ${s.name}\n\n**Role:** ${s.role}\n**Organization:** ${s.organization}\n**Decision Authority:** ${s.decision_authority}\n\n## Interests\n${(s.interests || []).map((i: string) => `- ${i}`).join("\n") || "None specified"}`, meta: { role: s.role, authority: s.decision_authority } })} style={{ cursor: "pointer" }}>
                      <td style={{ fontWeight: 600 }}>{s.name}</td>
                      <td>{s.role}</td>
                      <td style={{ color: "var(--gray-500)" }}>{s.organization}</td>
                      <td><span className={`fact-status ${s.decision_authority === "final" ? "confirmed" : s.decision_authority === "recommender" ? "assumed" : "pending"}`}><span style={{ width: 5, height: 5, borderRadius: "50%", background: "currentColor" }} />{s.decision_authority}</span></td>
                      <td style={{ fontSize: 11, color: "var(--gray-500)" }}>{(s.interests || []).join(", ") || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* Assumptions tab */}
        {activeTab === "assumptions" && (
          <div className="dp-tab-content active">
            {assumptionsData.length === 0 ? (
              <div style={{ textAlign: "center", padding: 40, color: "var(--gray-400)", fontSize: 13 }}>No assumptions identified yet.</div>
            ) : (
              <table className="panel-table">
                <thead><tr><th>Assumption</th><th>Basis</th><th>Risk if Wrong</th><th>Validated</th></tr></thead>
                <tbody>
                  {assumptionsData.map((a: any, i: number) => (
                    <tr key={a.id || i} onClick={() => setDetail({ title: "Assumption", content: `# Assumption\n\n${a.statement}\n\n## Basis\n${a.basis}\n\n## Risk if Wrong\n${a.risk_if_wrong}\n\n${a.needs_validation_by ? `## Needs Validation By\n${a.needs_validation_by}` : ""}`, meta: { validated: a.validated ? "yes" : "no" } })} style={{ cursor: "pointer" }}>
                      <td style={{ maxWidth: 200 }}>{a.statement}</td>
                      <td style={{ color: "var(--gray-500)", fontSize: 11, maxWidth: 180 }}>{a.basis?.slice(0, 60)}</td>
                      <td style={{ color: "var(--danger)", fontSize: 11, maxWidth: 180 }}>{a.risk_if_wrong?.slice(0, 60)}</td>
                      <td><span className={`fact-status ${a.validated ? "confirmed" : "assumed"}`}><span style={{ width: 5, height: 5, borderRadius: "50%", background: "currentColor" }} />{a.validated ? "validated" : "unvalidated"}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* Scope tab */}
        {activeTab === "scope" && (
          <div className="dp-tab-content active">
            {scopeData.length === 0 ? (
              <div style={{ textAlign: "center", padding: 40, color: "var(--gray-400)", fontSize: 13 }}>No scope items defined yet.</div>
            ) : (
              <table className="panel-table">
                <thead><tr><th>Item</th><th>In/Out</th><th>Rationale</th></tr></thead>
                <tbody>
                  {scopeData.map((s: any, i: number) => (
                    <tr key={s.id || i} onClick={() => setDetail({ title: s.description, content: `# Scope Item\n\n${s.description}\n\n**${s.in_scope ? "IN SCOPE" : "OUT OF SCOPE"}**\n\n## Rationale\n${s.rationale}`, meta: { scope: s.in_scope ? "in" : "out" } })} style={{ cursor: "pointer" }}>
                      <td>{s.description}</td>
                      <td><span className={`fact-status ${s.in_scope ? "confirmed" : "assumed"}`}><span style={{ width: 5, height: 5, borderRadius: "50%", background: "currentColor" }} />{s.in_scope ? "In scope" : "Out of scope"}</span></td>
                      <td style={{ color: "var(--gray-500)", fontSize: 11 }}>{s.rationale?.slice(0, 80)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
