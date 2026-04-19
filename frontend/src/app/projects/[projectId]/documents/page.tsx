"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { listDocuments, uploadDocument, listIntegrations, type ApiDocument } from "@/lib/api";
import GmailImportPanel from "@/components/GmailImportPanel";

type Document = ApiDocument;

export default function DocumentsPage() {
  const params = useParams();
  const projectId = params.projectId as string;
  const [documents, setDocuments] = useState<Document[]>([]);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [gmailOpen, setGmailOpen] = useState(false);
  const [gmailConnected, setGmailConnected] = useState(false);

  useEffect(() => {
    loadDocuments();
    const interval = setInterval(loadDocuments, 10000); // Poll for pipeline status
    return () => clearInterval(interval);
  }, [projectId]);

  useEffect(() => {
    listIntegrations(projectId)
      .then((d) => setGmailConnected((d.integrations || []).some((i) => i.connector_id === "gmail" && i.status === "active")))
      .catch(() => {});
  }, [projectId]);

  async function loadDocuments() {
    try {
      const data = await listDocuments(projectId);
      setDocuments(data.documents || []);
    } catch {
      // API not running
    }
    setLoading(false);
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setUploading(true);
    for (const file of Array.from(files)) {
      try {
        await uploadDocument(projectId, file);
      } catch (err: any) {
        alert(`Upload failed for ${file.name}: ${err.message}`);
      }
    }
    setUploading(false);
    loadDocuments();
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function stageIcon(stage: string) {
    switch (stage) {
      case "completed": return "&#9989;";
      case "failed": return "&#10060;";
      case "queued": return "&#9203;";
      default: return "&#9881;"; // processing
    }
  }

  function stageLabel(stage: string) {
    const labels: Record<string, string> = {
      queued: "Queued",
      classifying: "Classifying...",
      parsing: "Parsing...",
      extracting: "Extracting...",
      deduplicating: "Deduplicating...",
      storing: "Storing...",
      evaluating: "Evaluating...",
      completed: "Completed",
      failed: "Failed",
    };
    return labels[stage] || stage;
  }

  function formatSize(bytes: number | null) {
    if (!bytes) return "—";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  return (
    <div className="p-6 max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold">Documents</h1>
        <div style={{ display: "flex", gap: 8 }}>
          {gmailConnected && (
            <button
              onClick={() => setGmailOpen(true)}
              style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "8px 14px", borderRadius: 8,
                border: "1px solid var(--gray-200)", background: "#fff",
                color: "var(--dark)", fontSize: 13, fontWeight: 600,
                cursor: "pointer", fontFamily: "var(--font)",
              }}
            >
              <span style={{
                width: 18, height: 18, borderRadius: 5, background: "var(--green)",
                color: "var(--dark)", display: "inline-flex", alignItems: "center", justifyContent: "center",
                fontSize: 10, fontWeight: 800,
              }}>G</span>
              Import from Gmail
            </button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".pdf,.docx,.doc,.xlsx,.xls,.csv,.pptx,.ppt,.eml,.txt,.md,.png,.jpg,.jpeg"
            onChange={handleUpload}
            className="hidden"
            id="file-upload"
          />
          <label
            htmlFor="file-upload"
            className={`px-4 py-2 bg-blue-600 text-white rounded-lg cursor-pointer hover:bg-blue-700 transition ${
              uploading ? "opacity-50 pointer-events-none" : ""
            }`}
          >
            {uploading ? "Uploading..." : "Upload Documents"}
          </label>
        </div>
      </div>

      {gmailOpen && (
        <GmailImportPanel
          projectId={projectId}
          onClose={() => setGmailOpen(false)}
          onImported={() => loadDocuments()}
        />
      )}

      {loading ? (
        <div className="text-gray-400 py-10 text-center">Loading documents...</div>
      ) : documents.length === 0 ? (
        <div className="text-center py-20">
          <div className="text-5xl mb-4">&#128196;</div>
          <h2 className="text-xl font-semibold mb-2">No documents uploaded</h2>
          <p className="text-gray-500 mb-6">Upload meeting notes, emails, specs, or any client documents.</p>
          <label
            htmlFor="file-upload"
            className="px-6 py-3 bg-blue-600 text-white rounded-lg cursor-pointer hover:bg-blue-700"
          >
            Upload First Document
          </label>
        </div>
      ) : (
        <div className="bg-white rounded-xl border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-gray-50">
                <th className="text-left px-4 py-3 font-medium text-gray-500">File</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Type</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Size</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Status</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Extracted</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Date</th>
              </tr>
            </thead>
            <tbody>
              {documents.map((doc) => (
                <tr key={doc.id} className="border-b last:border-0 hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium">{doc.filename}</td>
                  <td className="px-4 py-3 text-gray-500">{doc.file_type}</td>
                  <td className="px-4 py-3 text-gray-500">{formatSize(doc.file_size_bytes)}</td>
                  <td className="px-4 py-3">
                    <span className="flex items-center gap-1">
                      <span dangerouslySetInnerHTML={{ __html: stageIcon(doc.pipeline_stage) }} />
                      <span className={doc.pipeline_stage === "failed" ? "text-red-600" : ""}>
                        {stageLabel(doc.pipeline_stage)}
                      </span>
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {doc.items_extracted > 0 ? (
                      <span>
                        {doc.items_extracted} items
                        {doc.contradictions_found > 0 && (
                          <span className="text-red-500 ml-1">({doc.contradictions_found} conflicts)</span>
                        )}
                      </span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {new Date(doc.created_at).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
