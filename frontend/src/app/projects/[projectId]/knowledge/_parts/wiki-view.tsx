"use client";

// Wiki view — renders the knowledge-base vault as a file tree + markdown
// viewer, with backlinks. Used as an alternate view inside the
// knowledge page. Extracted so the main page can focus on the canvas
// graph renderer.

import { useEffect, useMemo, useState } from "react";
import { getWikiFiles, getWikiFile } from "@/lib/api";


export interface WikiFile {
  path: string;
  name: string;
  folder: string;
  id: string;
  title: string;
  category: string;
  status: string;
  priority: string;
  date: string;
}

export interface WikiBacklink {
  path: string;
  id: string;
  title: string;
  category: string;
}

const STATUS_ICONS: Record<string, string> = {
  confirmed: "✓",
  discussed: "◐",
  open: "?",
  tentative: "~",
  proposed: "○",
};

const STATUS_COLORS: Record<string, string> = {
  confirmed: "#00E5A0",
  discussed: "#F59E0B",
  open: "#EF4444",
  tentative: "#94a3b8",
  proposed: "#3B82F6",
};

export function WikiView({ projectId, onSelectNode }: { projectId: string; onSelectNode: (id: string) => void }) {
  const [files, setFiles] = useState<WikiFile[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [content, setContent] = useState<string>("");
  const [frontmatter, setFrontmatter] = useState<Record<string, string>>({});
  const [backlinks, setBacklinks] = useState<WikiBacklink[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(["", "requirements", "gaps", "constraints"]));

  useEffect(() => {
    getWikiFiles(projectId).then((data) => {
      setFiles(data.files || []);
      setLoading(false);
      // Auto-select index.md or first file
      const idx = (data.files || []).find((f: WikiFile) => f.name === "index");
      if (idx) openFile(idx.path);
      else if (data.files?.length > 0) openFile(data.files[0].path);
    }).catch(() => setLoading(false));
  }, [projectId]);

  async function openFile(path: string) {
    setSelectedPath(path);
    try {
      const data = await getWikiFile(projectId, path);
      setContent(data.body || "");
      setFrontmatter(data.frontmatter || {});
      setBacklinks(data.backlinks || []);
    } catch {
      setContent("*Failed to load file*");
    }
  }

  function handleWikiLinkClick(target: string) {
    // Try to find the file by ID or name
    const normalized = target.toLowerCase().trim();
    const match = files.find((f) =>
      f.id.toLowerCase() === normalized ||
      f.name.toLowerCase() === normalized ||
      f.path.toLowerCase().replace(".md", "") === normalized ||
      f.path.toLowerCase().endsWith(`/${normalized}.md`)
    );
    if (match) {
      openFile(match.path);
    } else {
      onSelectNode(target);
    }
  }

  // Group files by folder
  const grouped = new Map<string, WikiFile[]>();
  for (const f of files) {
    const folder = f.folder || "";
    if (!grouped.has(folder)) grouped.set(folder, []);
    grouped.get(folder)!.push(f);
  }

  const folderOrder = ["", "requirements", "gaps", "constraints"];
  const sortedFolders = [...grouped.keys()].sort((a, b) => {
    const ai = folderOrder.indexOf(a);
    const bi = folderOrder.indexOf(b);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });

  function toggleFolder(folder: string) {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folder)) next.delete(folder);
      else next.add(folder);
      return next;
    });
  }

  function renderWikiMarkdown(md: string): string {
    // 1. Extract tables and wikilinks before escaping
    const tables: Record<string, string> = {};
    const lines = md.split("\n");
    const cleaned: string[] = [];
    let li = 0;
    let tIdx = 0;

    while (li < lines.length) {
      if (
        lines[li].includes("|") &&
        li + 1 < lines.length &&
        /^\|?\s*[-:]+[-| :]*$/.test(lines[li + 1])
      ) {
        const tableLines: string[] = [];
        tableLines.push(lines[li]);
        li++;
        const sepLine = lines[li];
        li++;
        while (li < lines.length && lines[li].includes("|") && lines[li].trim() !== "") {
          tableLines.push(lines[li]);
          li++;
        }

        const aligns = sepLine.split("|").filter((c) => c.trim()).map((c) => {
          const t = c.trim();
          if (t.startsWith(":") && t.endsWith(":")) return "center";
          if (t.endsWith(":")) return "right";
          return "left";
        });

        const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        const parseCells = (line: string) =>
          line.split("|").filter((_, idx, arr) => idx > 0 && idx < arr.length - (line.endsWith("|") ? 1 : 0)).map((c) => c.trim());

        // Render wikilinks inside table cells
        const renderCell = (cell: string) => {
          const escaped = esc(cell);
          return escaped.replace(/\[\[([^\]]+)\]\]/g, (_m, target) =>
            `<a class="wiki-link" data-target="${target}" style="color:#00E5A0;font-weight:600;cursor:pointer;border-bottom:1px dashed #00E5A0;text-decoration:none">${target}</a>`
          );
        };

        const hdrCells = parseCells(tableLines[0]);
        let h = '<table style="width:100%;border-collapse:collapse;margin:12px 0;font-size:12px"><thead><tr>';
        hdrCells.forEach((cell, ci) => {
          h += `<th style="text-align:${aligns[ci] || "left"};padding:8px 12px;border:1px solid #e2e8f0;background:#f8fafc;font-weight:600;color:#0f172a">${renderCell(cell)}</th>`;
        });
        h += "</tr></thead><tbody>";
        for (let r = 1; r < tableLines.length; r++) {
          const cells = parseCells(tableLines[r]);
          h += "<tr>";
          cells.forEach((cell, ci) => {
            h += `<td style="text-align:${aligns[ci] || "left"};padding:6px 12px;border:1px solid #e2e8f0;color:#4b5563">${renderCell(cell)}</td>`;
          });
          h += "</tr>";
        }
        h += "</tbody></table>";
        const key = `__TBL_${tIdx++}__`;
        tables[key] = h;
        cleaned.push(key);
      } else {
        cleaned.push(lines[li]);
        li++;
      }
    }

    // 2. Process remaining text
    let html = cleaned.join("\n")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/\[\[([^\]]+)\]\]/g, (_m, target) =>
        `<a class="wiki-link" data-target="${target}" style="color:#00E5A0;font-weight:600;cursor:pointer;border-bottom:1px dashed #00E5A0;text-decoration:none">${target}</a>`
      )
      .replace(/^### (.+)$/gm, '<h3 style="font-size:14px;font-weight:700;margin:16px 0 6px;color:#0f172a">$1</h3>')
      .replace(/^## (.+)$/gm, '<h2 style="font-size:16px;font-weight:700;margin:18px 0 8px;color:#0f172a">$1</h2>')
      .replace(/^# (.+)$/gm, '<h1 style="font-size:18px;font-weight:800;margin:20px 0 10px;color:#0f172a">$1</h1>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`([^`]+)`/g, '<code style="padding:1px 5px;background:#f0fdf4;border:1px solid #dcfce7;border-radius:4px;font-size:0.88em;font-family:monospace;color:#16a34a">$1</code>')
      .replace(/^- (.+)$/gm, '<li style="margin:3px 0;padding-left:4px">$1</li>')
      .replace(/^\d+\. (.+)$/gm, '<li style="margin:3px 0;padding-left:4px">$1</li>')
      .replace(/^&gt; (.+)$/gm, '<blockquote style="border-left:3px solid #00E5A0;padding:6px 12px;margin:8px 0;background:#f0fdf8;border-radius:0 6px 6px 0;font-size:12px;color:#4b5563;font-style:italic">$1</blockquote>')
      .replace(/^---$/gm, '<hr style="border:none;border-top:1px solid #e2e8f0;margin:14px 0">')
      .replace(/\n\n/g, '</p><p style="margin:8px 0">')
      .replace(/\n/g, '<br>');

    html = '<p style="margin:8px 0">' + html + '</p>';
    html = html.replace(/(<li[^>]*>.*?<\/li>(\s*<br>)?)+/g, (match) =>
      '<ul style="padding-left:18px;margin:6px 0">' + match.replace(/<br>/g, '') + '</ul>'
    );

    // 3. Re-insert tables
    for (const [key, tableHtml] of Object.entries(tables)) {
      html = html.replace(key, tableHtml);
    }

    return html;
  }

  if (loading) return <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#94a3b8" }}>Loading wiki...</div>;

  return (
    <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
      {/* File tree sidebar */}
      <div style={{
        width: 240, flexShrink: 0, borderRight: "1px solid #e2e8f0",
        background: "#fafbfc", overflowY: "auto", padding: "12px 0",
      }}>
        {sortedFolders.map((folder) => {
          const folderFiles = grouped.get(folder) || [];
          const isExpanded = expandedFolders.has(folder);
          const label = folder || "Overview";

          return (
            <div key={folder}>
              <div
                onClick={() => toggleFolder(folder)}
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "6px 14px", cursor: "pointer", userSelect: "none",
                  fontSize: 11, fontWeight: 700, textTransform: "uppercase",
                  letterSpacing: "0.5px", color: "#64748b",
                }}
              >
                <span style={{ fontSize: 10, transition: "transform 0.2s", transform: isExpanded ? "rotate(90deg)" : "none" }}>
                  ▶
                </span>
                {label}
                <span style={{ fontSize: 10, color: "#94a3b8", fontWeight: 500, marginLeft: "auto" }}>{folderFiles.length}</span>
              </div>
              {isExpanded && folderFiles.map((f) => {
                const isActive = selectedPath === f.path;
                const statusIcon = STATUS_ICONS[f.status] || "";
                const statusColor = STATUS_COLORS[f.status] || "#94a3b8";
                return (
                  <div
                    key={f.path}
                    onClick={() => openFile(f.path)}
                    style={{
                      display: "flex", alignItems: "center", gap: 6,
                      padding: "5px 14px 5px 28px", cursor: "pointer",
                      background: isActive ? "#f0fdf8" : "transparent",
                      borderRight: isActive ? "2px solid #00E5A0" : "2px solid transparent",
                      fontSize: 12, color: isActive ? "#0f172a" : "#4b5563",
                      fontWeight: isActive ? 600 : 400,
                      transition: "all 0.1s",
                    }}
                  >
                    {statusIcon && <span style={{ color: statusColor, fontSize: 11 }}>{statusIcon}</span>}
                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {f.id || f.title}
                    </span>
                  </div>
                );
              })}
            </div>
          );
        })}

        {/* Obsidian hint */}
        <div style={{
          padding: "10px 14px", borderTop: "1px solid #e2e8f0",
          fontSize: 10, color: "#94a3b8", lineHeight: 1.4,
        }}>
          <div style={{ fontWeight: 600, marginBottom: 2 }}>Open in Obsidian</div>
          <div
            style={{ fontFamily: "monospace", fontSize: 9, cursor: "pointer", wordBreak: "break-all" }}
            onClick={() => { navigator.clipboard.writeText(`.runtime/projects/${projectId}/.memory-bank`); }}
            title="Click to copy path"
          >
            .runtime/projects/{projectId.slice(0, 8)}.../.memory-bank
          </div>
        </div>
      </div>

      {/* Content panel */}
      <div style={{ flex: 1, overflow: "auto", padding: "16px 24px" }}>
        {!selectedPath ? (
          <div style={{ color: "#94a3b8", textAlign: "center", paddingTop: 60 }}>
            <p style={{ fontSize: 15, fontWeight: 500 }}>Select a file to view</p>
          </div>
        ) : (
          <>
            {/* Breadcrumb */}
            <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 8 }}>
              discovery / {selectedPath.replace(".md", "")}
            </div>

            {/* Frontmatter badges */}
            {Object.keys(frontmatter).length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
                {Object.entries(frontmatter).map(([key, value]) => {
                  if (!value || key === "description" || key === "category") return null;
                  const color =
                    key === "priority" ? (value === "must" ? "#EF4444" : value === "should" ? "#F59E0B" : "#3B82F6")
                    : key === "status" ? (STATUS_COLORS[value] || "#94a3b8")
                    : key === "confidence" ? (value === "high" ? "#00E5A0" : value === "low" ? "#EF4444" : "#F59E0B")
                    : "#64748b";
                  return (
                    <span key={key} style={{
                      fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 6,
                      background: `${color}15`, color,
                    }}>
                      {key}: {value}
                    </span>
                  );
                })}
              </div>
            )}

            {/* Rendered content */}
            <div
              style={{ fontSize: 13, lineHeight: 1.7, color: "#1e293b" }}
              dangerouslySetInnerHTML={{ __html: renderWikiMarkdown(content) }}
              onClick={(e) => {
                const target = (e.target as HTMLElement).closest("[data-target]");
                if (target) {
                  e.preventDefault();
                  handleWikiLinkClick(target.getAttribute("data-target") || "");
                }
              }}
            />

            {/* Backlinks */}
            {backlinks.length > 0 && (
              <div style={{ marginTop: 24, paddingTop: 16, borderTop: "1px solid #e2e8f0" }}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", color: "#94a3b8", marginBottom: 8 }}>
                  Referenced By ({backlinks.length})
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {backlinks.map((bl) => (
                    <button
                      key={bl.path}
                      onClick={() => openFile(bl.path)}
                      style={{
                        display: "flex", alignItems: "center", gap: 8,
                        padding: "6px 10px", borderRadius: 6,
                        border: "1px solid #e2e8f0", background: "#fff",
                        cursor: "pointer", fontFamily: "var(--font)", textAlign: "left",
                        fontSize: 12, color: "#0f172a", transition: "all 0.1s",
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#00E5A0"; e.currentTarget.style.background = "#f0fdf8"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#e2e8f0"; e.currentTarget.style.background = "#fff"; }}
                    >
                      <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#00E5A0", flexShrink: 0 }} />
                      <span style={{ flex: 1 }}>{bl.title}</span>
                      <span style={{ fontSize: 10, color: "#94a3b8" }}>{bl.id}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
