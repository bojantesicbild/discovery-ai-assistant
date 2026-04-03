"use client";

import { useEffect, useState } from "react";
import { getDashboard, listRequirements, listContradictions } from "@/lib/api";

interface DataPanelProps {
  projectId: string;
}

const TABS = [
  { id: "facts", label: "Facts" },
  { id: "reqs", label: "Requirements" },
  { id: "gaps", label: "Gaps" },
  { id: "contradictions", label: "Contradictions" },
  { id: "docs", label: "Documents" },
  { id: "meetings", label: "Meeting Notes" },
];

export default function DataPanel({ projectId }: DataPanelProps) {
  const [activeTab, setActiveTab] = useState("reqs");
  const [dashboard, setDashboard] = useState<any>(null);
  const [requirements, setRequirements] = useState<any[]>([]);
  const [contradictions, setContradictions] = useState<any[]>([]);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 30000);
    return () => clearInterval(interval);
  }, [projectId]);

  async function loadData() {
    try {
      const [dash, reqs, contras] = await Promise.all([
        getDashboard(projectId),
        listRequirements(projectId),
        listContradictions(projectId),
      ]);
      setDashboard(dash);
      setRequirements(reqs.items || []);
      setContradictions(contras.items || []);
    } catch {
      // Backend might not be ready
    }
  }

  const readiness = dashboard?.readiness;
  const score = readiness?.score ?? 0;
  const circumference = 2 * Math.PI * 15; // r=15 for viewBox 36
  const offset = circumference - (score / 100) * circumference;

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
              {dashboard?.requirements_count ?? 0} requirements
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
                No requirements extracted yet. Upload documents to get started.
              </div>
            ) : (
              <table className="panel-table">
                <thead>
                  <tr>
                    <th style={{ width: 30 }}></th>
                    <th>ID</th>
                    <th>Requirement</th>
                    <th>Priority</th>
                    <th>Status</th>
                    <th>Confidence</th>
                  </tr>
                </thead>
                <tbody>
                  {requirements.map((req: any) => (
                    <tr key={req.id || req.req_id}>
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

        {/* Placeholder tabs */}
        {["facts", "gaps", "docs", "meetings"].includes(activeTab) && (
          <div className="dp-tab-content active">
            <div style={{ textAlign: "center", padding: 40, color: "var(--gray-400)", fontSize: 13 }}>
              {activeTab === "facts" && "Facts view — extracted facts will appear here after document processing."}
              {activeTab === "gaps" && "Gap analysis — run gap analysis from the chat to see results here."}
              {activeTab === "docs" && "Documents — uploaded documents and their processing status."}
              {activeTab === "meetings" && "Meeting notes — meeting summaries and extracted decisions."}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
