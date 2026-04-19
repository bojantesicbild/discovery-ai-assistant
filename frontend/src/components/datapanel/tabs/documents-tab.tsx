"use client";

// Documents tab — list of uploaded documents with pipeline status,
// delete, and Gmail/Drive import panels. Extracted from DataPanel.tsx
// so the main file can focus on orchestration.

import { SourceBadge, StatusPill, EmptyState } from "../pills";
import GmailImportPanel from "../../GmailImportPanel";
import DriveImportPanel from "../../DriveImportPanel";
import { deleteDocument, type ApiDocument } from "@/lib/api";


interface DocumentsTabProps {
  projectId: string;
  documents: ApiDocument[];
  gmailOpen: boolean;
  setGmailOpen: (open: boolean) => void;
  gmailConnected: boolean;
  driveOpen: boolean;
  setDriveOpen: (open: boolean) => void;
  driveConnected: boolean;
  openDocument: (doc: ApiDocument) => void;
  loadData: () => void;
}


export function DocumentsTab({
  projectId, documents,
  gmailOpen, setGmailOpen, gmailConnected,
  driveOpen, setDriveOpen, driveConnected,
  openDocument, loadData,
}: DocumentsTabProps) {
  return (
    <div className="dp-tab-content active">
      {(gmailConnected || driveConnected) && (
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginBottom: 12 }}>
          {gmailConnected && (
            <button
              onClick={() => setGmailOpen(true)}
              style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "6px 12px", borderRadius: 8,
                border: "1px solid var(--gray-200)", background: "#fff",
                color: "var(--dark)", fontSize: 12, fontWeight: 600,
                cursor: "pointer", fontFamily: "var(--font)",
              }}
            >
              <span style={{ width: 18, height: 18, borderRadius: 5, background: "var(--green)", color: "var(--dark)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 800 }}>G</span>
              Import from Gmail
            </button>
          )}
          {driveConnected && (
            <button
              onClick={() => setDriveOpen(true)}
              style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "6px 12px", borderRadius: 8,
                border: "1px solid var(--gray-200)", background: "#fff",
                color: "var(--dark)", fontSize: 12, fontWeight: 600,
                cursor: "pointer", fontFamily: "var(--font)",
              }}
            >
              <span style={{ width: 18, height: 18, borderRadius: 5, background: "var(--green)", color: "var(--dark)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 800 }}>D</span>
              Import from Drive
            </button>
          )}
        </div>
      )}
      {gmailOpen && (
        <GmailImportPanel
          projectId={projectId}
          onClose={() => setGmailOpen(false)}
          onImported={() => loadData()}
        />
      )}
      {driveOpen && (
        <DriveImportPanel
          projectId={projectId}
          onClose={() => setDriveOpen(false)}
          onImported={() => loadData()}
        />
      )}
      {documents.length === 0 ? (
        <EmptyState icon="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" text='No documents uploaded yet. Click "Upload Document" to get started.' />
      ) : (
        <table className="panel-table">
          <thead>
            <tr>
              <th>File</th>
              <th>Type</th>
              <th>Status</th>
              <th>Extracted</th>
              <th>Date</th>
              <th style={{ width: 40 }}></th>
            </tr>
          </thead>
          <tbody>
            {documents.map((doc) => (
              <tr key={doc.id} onClick={() => openDocument(doc)} className="clickable-row">
                <td style={{ fontWeight: 600 }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                    {doc.filename}
                    <SourceBadge source={doc.classification?.source as string | undefined} autoSynced={doc.classification?.auto_synced as boolean | undefined} />
                  </span>
                </td>
                <td><span className="type-badge">{doc.file_type?.toUpperCase()}</span></td>
                <td><StatusPill status={doc.pipeline_stage === "completed" ? "confirmed" : doc.pipeline_stage === "failed" ? "dropped" : "pending"} label={doc.pipeline_stage} /></td>
                <td>
                  {doc.items_extracted > 0 ? (
                    <span style={{ fontSize: 12 }}>
                      {doc.items_extracted} items
                      {doc.contradictions_found > 0 && (
                        <span style={{ color: "var(--danger)", marginLeft: 4, fontSize: 10 }}>+{doc.contradictions_found} conflicts</span>
                      )}
                    </span>
                  ) : <span style={{ color: "var(--gray-400)" }}>—</span>}
                </td>
                <td style={{ color: "var(--gray-500)", whiteSpace: "nowrap", fontSize: 11 }}>
                  {doc.created_at ? new Date(doc.created_at).toLocaleDateString() : "—"}
                </td>
                <td>
                  <button
                    title="Delete document"
                    className="delete-btn"
                    onClick={async (e) => {
                      e.stopPropagation();
                      if (!confirm(`Delete ${doc.filename}?`)) return;
                      try { await deleteDocument(projectId, doc.id); loadData(); } catch { alert("Delete failed"); }
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
  );
}
