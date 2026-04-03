"use client";

import { useRef, useState } from "react";
import { uploadDocument } from "@/lib/api";

interface TopbarProps {
  projectId: string;
  projectName?: string;
  onDocumentUploaded?: () => void;
}

export default function Topbar({ projectId, projectName = "NacXwan", onDocumentUploaded }: TopbarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setUploading(true);
    for (const file of Array.from(files)) {
      try {
        await uploadDocument(projectId, file);
      } catch (err: any) {
        alert(`Upload failed: ${err.message}`);
      }
    }
    setUploading(false);
    onDocumentUploaded?.();
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <header className="topbar">
      <div className="project-selector">
        <div className="project-dot" />
        <span className="project-name">{projectName}</span>
        <svg style={{ width: 16, height: 16, color: "var(--gray-400)" }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </div>

      <div className="search-bar">
        <svg viewBox="0 0 24 24" style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", width: 16, height: 16, color: "var(--gray-400)", stroke: "currentColor", fill: "none", strokeWidth: 2 }}>
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input type="text" placeholder="Search requirements, facts, documents..." />
      </div>

      <div className="topbar-actions">
        <button className="icon-btn" title="Notifications">
          <svg viewBox="0 0 24 24">
            <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 01-3.46 0" />
          </svg>
        </button>

        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".pdf,.docx,.doc,.xlsx,.xls,.csv,.pptx,.ppt,.eml,.txt,.md,.png,.jpg,.jpeg"
          onChange={handleFiles}
          style={{ display: "none" }}
          id="topbar-upload"
        />
        <button
          className="btn-primary"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          style={uploading ? { opacity: 0.6 } : {}}
        >
          <svg viewBox="0 0 24 24">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          {uploading ? "Uploading..." : "Upload Document"}
        </button>
      </div>
    </header>
  );
}
