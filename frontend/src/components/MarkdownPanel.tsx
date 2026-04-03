"use client";

import { useState } from "react";

interface MarkdownPanelProps {
  title: string;
  content: string;
  meta?: Record<string, string>;
  onClose: () => void;
  onSave?: (content: string) => void;
  readOnly?: boolean;
}

export default function MarkdownPanel({
  title,
  content,
  meta,
  onClose,
  onSave,
  readOnly = false,
}: MarkdownPanelProps) {
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState(content);

  function handleSave() {
    onSave?.(editContent);
    setEditing(false);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--white)" }}>
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", gap: 10, padding: "10px 16px",
        borderBottom: "1px solid var(--gray-200)", flexShrink: 0,
      }}>
        <button
          onClick={onClose}
          style={{
            width: 28, height: 28, borderRadius: "var(--radius-xs)",
            border: "1px solid var(--gray-200)", background: "var(--white)",
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer", transition: "all 0.15s",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "var(--gray-50)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "var(--white)"; }}
        >
          <svg viewBox="0 0 24 24" style={{ width: 14, height: 14, stroke: "var(--gray-500)", fill: "none", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" }}>
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</div>
        </div>
        {!readOnly && (
          <div style={{ display: "flex", gap: 6 }}>
            {editing ? (
              <>
                <button
                  onClick={() => { setEditing(false); setEditContent(content); }}
                  style={{
                    padding: "5px 12px", borderRadius: "var(--radius-xs)",
                    border: "1px solid var(--gray-200)", background: "var(--white)",
                    fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "var(--font)",
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  className="btn-primary"
                  style={{ padding: "5px 14px", fontSize: 12 }}
                >
                  Save
                </button>
              </>
            ) : (
              <button
                onClick={() => setEditing(true)}
                style={{
                  padding: "5px 12px", borderRadius: "var(--radius-xs)",
                  border: "1px solid var(--gray-200)", background: "var(--white)",
                  fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "var(--font)",
                  display: "flex", alignItems: "center", gap: 4,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--green)"; e.currentTarget.style.color = "#059669"; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--gray-200)"; e.currentTarget.style.color = "inherit"; }}
              >
                <svg viewBox="0 0 24 24" style={{ width: 12, height: 12, stroke: "currentColor", fill: "none", strokeWidth: 2 }}>
                  <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
                Edit
              </button>
            )}
          </div>
        )}
      </div>

      {/* Meta badges */}
      {meta && Object.keys(meta).length > 0 && (
        <div style={{
          display: "flex", flexWrap: "wrap", gap: 8, padding: "10px 16px",
          borderBottom: "1px solid var(--gray-100)",
        }}>
          {Object.entries(meta).map(([key, value]) => (
            <div key={key} style={{
              display: "flex", alignItems: "center", gap: 4,
              fontSize: 11, color: "var(--gray-500)",
            }}>
              <span style={{ fontWeight: 600, color: "var(--gray-400)", textTransform: "uppercase", letterSpacing: "0.5px" }}>{key}:</span>
              <span style={{
                padding: "1px 8px", borderRadius: 10, fontSize: 10, fontWeight: 600,
                background: value === "must" ? "var(--danger-light)" : value === "confirmed" ? "var(--green-light)" : "var(--gray-100)",
                color: value === "must" ? "var(--danger)" : value === "confirmed" ? "#059669" : "var(--gray-600)",
              }}>
                {value}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Content */}
      <div style={{ flex: 1, overflow: "auto", padding: 16 }}>
        {editing ? (
          <textarea
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            style={{
              width: "100%", height: "100%", minHeight: 400,
              padding: 14, border: "1px solid var(--gray-200)",
              borderRadius: "var(--radius-sm)", fontSize: 13,
              fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
              lineHeight: 1.6, resize: "none", outline: "none",
              background: "var(--gray-50)", color: "var(--dark)",
            }}
            onFocus={(e) => { e.target.style.borderColor = "var(--green)"; e.target.style.boxShadow = "0 0 0 3px var(--green-light)"; }}
            onBlur={(e) => { e.target.style.borderColor = "var(--gray-200)"; e.target.style.boxShadow = "none"; }}
          />
        ) : (
          <div
            style={{
              fontSize: 13, lineHeight: 1.7, color: "var(--dark)",
              fontFamily: "var(--font)",
            }}
            dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
          />
        )}
      </div>
    </div>
  );
}


function renderMarkdown(text: string): string {
  // Simple markdown → HTML renderer (no dependency needed)
  let html = text
    // Escape HTML
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    // Headers
    .replace(/^### (.+)$/gm, '<h3 style="font-size:14px;font-weight:700;margin:18px 0 8px;color:var(--dark)">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 style="font-size:16px;font-weight:700;margin:20px 0 10px;color:var(--dark)">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 style="font-size:18px;font-weight:800;margin:24px 0 12px;color:var(--dark)">$1</h1>')
    // Bold
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // Italic
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Code inline
    .replace(/`([^`]+)`/g, '<code style="padding:1px 6px;background:var(--gray-100);border-radius:4px;font-size:12px;font-family:monospace">$1</code>')
    // Bullet lists
    .replace(/^- (.+)$/gm, '<li style="margin:4px 0;padding-left:4px">$1</li>')
    // Numbered lists
    .replace(/^\d+\. (.+)$/gm, '<li style="margin:4px 0;padding-left:4px">$1</li>')
    // Blockquote
    .replace(/^> (.+)$/gm, '<blockquote style="border-left:3px solid var(--green);padding:8px 14px;margin:10px 0;background:var(--green-light);border-radius:0 var(--radius-xs) var(--radius-xs) 0;font-size:12px;color:var(--gray-600)">$1</blockquote>')
    // Horizontal rule
    .replace(/^---$/gm, '<hr style="border:none;border-top:1px solid var(--gray-200);margin:16px 0">')
    // Paragraphs (double newline)
    .replace(/\n\n/g, '</p><p style="margin:10px 0">')
    // Single newline
    .replace(/\n/g, '<br>');

  // Wrap in paragraph
  html = '<p style="margin:10px 0">' + html + '</p>';

  // Wrap consecutive <li> in <ul>
  html = html.replace(/(<li[^>]*>.*?<\/li>(\s*<br>)?)+/g, (match) => {
    return '<ul style="padding-left:20px;margin:8px 0">' + match.replace(/<br>/g, '') + '</ul>';
  });

  return html;
}
