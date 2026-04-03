"use client";

interface TopbarProps {
  projectName?: string;
  onUpload?: () => void;
}

export default function Topbar({ projectName = "NacXwan", onUpload }: TopbarProps) {
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
        <button className="btn-primary" onClick={onUpload}>
          <svg viewBox="0 0 24 24">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Upload Document
        </button>
      </div>
    </header>
  );
}
