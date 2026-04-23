"use client";

import { useEffect, useState } from "react";
import { getItemHistory, type HistoryEntry } from "@/lib/api";
import { renderMarkdown } from "@/lib/markdown";

interface MarkdownPanelProps {
  title: string;
  content: string;
  meta?: Record<string, string>;
  onClose: () => void;
  onSave?: (content: string) => void;
  actions?: { label: string; value: string; color: string }[];
  onAction?: (value: string) => void;
  readOnly?: boolean;
  history?: { projectId: string; itemType: string; itemId: string };
  /** Called when an in-content link is clicked. Receives the href; return
   *  true if handled (the default anchor navigation is suppressed). Used
   *  for app-internal protocols like `doc://<uuid>` to cross-link between
   *  detail views without a real URL. */
  onLinkClick?: (href: string) => boolean | void;
  /** Interactive React content rendered above the markdown body (e.g.,
   *  pending client-review proposals for this item). */
  slotTop?: React.ReactNode;
}

export default function MarkdownPanel({
  title,
  content,
  meta,
  onClose,
  onSave,
  readOnly = false,
  actions,
  onAction,
  history,
  onLinkClick,
  slotTop,
}: MarkdownPanelProps) {
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState(content);
  const [activeView, setActiveView] = useState<"content" | "history">("content");
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  useEffect(() => {
    if (activeView !== "history" || !history || historyEntries) return;
    setHistoryLoading(true);
    getItemHistory(history.projectId, history.itemType, history.itemId)
      .then((res) => setHistoryEntries(res.history))
      .catch(() => setHistoryEntries([]))
      .finally(() => setHistoryLoading(false));
  }, [activeView, history, historyEntries]);

  // Reset history when the item changes
  useEffect(() => {
    setHistoryEntries(null);
    setActiveView("content");
  }, [history?.itemId]);

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
                ...((): { background: string; color: string } => {
                  // Status-aware chip palette. Green for positive states
                  // (confirmed, resolved), red for must-priority, amber
                  // for attention (open), muted grey for dismissed (so
                  // it reads as "closed, not acted on").
                  switch (value) {
                    case "must":       return { background: "var(--danger-light)", color: "var(--danger)" };
                    case "confirmed":
                    case "resolved":   return { background: "var(--green-light)", color: "#059669" };
                    case "open":       return { background: "#FEF3C7",            color: "#B45309" };
                    case "dismissed":  return { background: "var(--gray-100)",    color: "var(--gray-400)" };
                    case "Unvalidated assumption": return { background: "#FEF3C7", color: "#B45309" };
                    case "Undecided":  return { background: "#dbeafe",            color: "#1d4ed8" };
                    default:           return { background: "var(--gray-100)",    color: "var(--gray-600)" };
                  }
                })(),
              }}>
                {value}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Action buttons */}
      {actions && actions.length > 0 && (
        <div style={{
          display: "flex", gap: 8, padding: "10px 16px",
          borderBottom: "1px solid var(--gray-100)",
        }}>
          <span style={{ fontSize: 11, color: "var(--gray-400)", fontWeight: 600, alignSelf: "center", marginRight: 4 }}>
            Set status:
          </span>
          {actions.map((action) => (
            <button
              key={action.value}
              onClick={() => onAction?.(action.value)}
              style={{
                padding: "5px 14px", borderRadius: "var(--radius-xs)",
                border: `1px solid ${action.color}30`, background: `${action.color}10`,
                fontSize: 12, fontWeight: 600, cursor: "pointer",
                fontFamily: "var(--font)", color: action.color,
                transition: "all 0.15s",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = `${action.color}20`; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = `${action.color}10`; }}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}

      {/* Tabs (only when history is available) */}
      {history && (
        <div style={{
          display: "flex", gap: 0, padding: "0 16px",
          borderBottom: "1px solid var(--gray-100)",
        }}>
          {(["content", "history"] as const).map((view) => (
            <button
              key={view}
              onClick={() => setActiveView(view)}
              style={{
                padding: "10px 14px", fontSize: 12, fontWeight: 600,
                background: "none", border: "none", cursor: "pointer",
                color: activeView === view ? "var(--green)" : "var(--gray-500)",
                borderBottom: activeView === view ? "2px solid var(--green)" : "2px solid transparent",
                marginBottom: -1, fontFamily: "var(--font)", textTransform: "capitalize",
              }}
            >
              {view}
            </button>
          ))}
        </div>
      )}

      {/* Content */}
      <div style={{ flex: 1, overflow: "auto", padding: 16 }}>
        {activeView === "history" && history ? (
          historyLoading ? (
            <div style={{ fontSize: 12, color: "var(--gray-500)" }}>Loading history…</div>
          ) : historyEntries && historyEntries.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {historyEntries.map((entry) => (
                <div key={entry.id} style={{
                  borderLeft: `3px solid ${entry.action === "create" ? "var(--green)" : "#3B82F6"}`,
                  padding: "8px 12px", background: "var(--gray-50)",
                  borderRadius: "var(--radius-xs)",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 4,
                      background: entry.action === "create" ? "var(--green-light)" : "#DBEAFE",
                      color: entry.action === "create" ? "#059669" : "#1D4ED8",
                      textTransform: "uppercase",
                    }}>{entry.action}</span>
                    {entry.source_filename && (
                      <span style={{ fontSize: 11, color: "var(--gray-500)" }}>
                        from <strong style={{ color: "var(--dark)" }}>{entry.source_filename}</strong>
                      </span>
                    )}
                    <span style={{ flex: 1 }} />
                    <span style={{ fontSize: 10, color: "var(--gray-400)" }}>
                      {entry.created_at ? new Date(entry.created_at).toLocaleString() : ""}
                    </span>
                  </div>
                  {entry.action === "update" && Object.keys(entry.old_value || {}).length > 0 && (
                    <div style={{ fontSize: 11, lineHeight: 1.6 }}>
                      {Object.keys(entry.old_value).map((field) => (
                        <div key={field} style={{ marginTop: 2 }}>
                          <span style={{ color: "var(--gray-500)", fontWeight: 600 }}>{field}: </span>
                          <span style={{ textDecoration: "line-through", color: "var(--gray-400)" }}>
                            {String(entry.old_value[field] ?? "")}
                          </span>
                          <span style={{ color: "var(--gray-400)" }}> → </span>
                          <span style={{ color: "var(--dark)", fontWeight: 600 }}>
                            {String(entry.new_value[field] ?? "")}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  {entry.action === "create" && (
                    <div style={{ fontSize: 11, color: "var(--gray-600)" }}>
                      {Object.entries(entry.new_value || {}).map(([k, v]) => (
                        <span key={k} style={{ marginRight: 8 }}>
                          <span style={{ color: "var(--gray-500)" }}>{k}:</span> {String(v)}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 12, color: "var(--gray-500)" }}>No history yet.</div>
          )
        ) : editing ? (
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
          <>
            {slotTop}
            <div
              style={{
                fontSize: 13, lineHeight: 1.7, color: "var(--dark)",
                fontFamily: "var(--font)",
              }}
              onClick={(e) => {
                if (!onLinkClick) return;
                let el: HTMLElement | null = e.target as HTMLElement;
                while (el && el.tagName !== "A") el = el.parentElement;
                if (!el) return;
                const href = (el as HTMLAnchorElement).getAttribute("href") || "";
                const handled = onLinkClick(href);
                if (handled !== false) e.preventDefault();
              }}
              dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
            />
          </>
        )}
      </div>
    </div>
  );
}
