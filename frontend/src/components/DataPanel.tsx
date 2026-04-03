"use client";

import { useEffect, useState } from "react";
import { getDashboard, listRequirements, listContradictions, listDocuments, deleteDocument } from "@/lib/api";
import MarkdownPanel from "./MarkdownPanel";

interface DataPanelProps {
  projectId: string;
  refreshKey?: number;
}

interface DetailView {
  title: string;
  content: string;
  meta?: Record<string, string>;
}

const TABS = [
  { id: "facts", label: "Facts" },
  { id: "reqs", label: "Business Requirements" },
  { id: "gaps", label: "Gaps" },
  { id: "contradictions", label: "Contradictions" },
  { id: "docs", label: "Documents" },
  { id: "meetings", label: "Meeting Notes" },
];

export default function DataPanel({ projectId, refreshKey = 0 }: DataPanelProps) {
  const [activeTab, setActiveTab] = useState("reqs");
  const [dashboard, setDashboard] = useState<any>(null);
  const [requirements, setRequirements] = useState<any[]>([]);
  const [contradictions, setContradictions] = useState<any[]>([]);
  const [documents, setDocuments] = useState<any[]>([]);
  const [detail, setDetail] = useState<DetailView | null>(null);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 15000);
    return () => clearInterval(interval);
  }, [projectId, refreshKey]);

  async function loadData() {
    try {
      const [dash, reqs, contras, docs] = await Promise.all([
        getDashboard(projectId),
        listRequirements(projectId),
        listContradictions(projectId),
        listDocuments(projectId),
      ]);
      setDashboard(dash);
      setRequirements(reqs.items || []);
      setContradictions(contras.items || []);
      setDocuments(docs.documents || []);
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
      <div className="data-panel" style={{ flex: "0 0 55%" }}>
        <MarkdownPanel
          title={detail.title}
          content={detail.content}
          meta={detail.meta}
          onClose={() => setDetail(null)}
        />
      </div>
    );
  }

  return (
    <div className="data-panel" style={{ flex: "0 0 55%" }}>
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
          if (tab.id === "reqs") count = dashboard?.requirements_count ?? 0;
          if (tab.id === "contradictions") count = dashboard?.contradictions_unresolved ?? 0;
          if (tab.id === "docs") count = dashboard?.documents_count ?? 0;
          if (tab.id === "gaps") count = dashboard?.contradictions_unresolved ?? 0;

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
              <button className="panel-filter-btn active">All</button>
              <button className="panel-filter-btn">Must</button>
              <button className="panel-filter-btn">Should</button>
              <button className="panel-filter-btn">Could</button>
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
                  {requirements.map((req: any) => (
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

        {/* Placeholder tabs */}
        {["facts", "gaps", "meetings"].includes(activeTab) && (
          <div className="dp-tab-content active">
            <div style={{ textAlign: "center", padding: 40, color: "var(--gray-400)", fontSize: 13 }}>
              {activeTab === "facts" && "Facts view — extracted facts will appear here after document processing."}
              {activeTab === "gaps" && "Gap analysis — run gap analysis from the chat to see results here."}
              {activeTab === "meetings" && "Meeting notes — meeting summaries and extracted decisions."}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
