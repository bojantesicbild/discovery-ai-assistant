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
    // 1. Extract tables before escaping. Style hooks live on .kg-wiki-body
    // table/th/td selectors in knowledge.css — markup stays plain.
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

        const renderCell = (cell: string) => {
          const escaped = esc(cell);
          return escaped.replace(/\[\[([^\]]+)\]\]/g, (_m, target) =>
            `<a class="wiki-link" data-target="${target}">${target}</a>`,
          );
        };

        const hdrCells = parseCells(tableLines[0]);
        let h = '<table><thead><tr>';
        hdrCells.forEach((cell, ci) => {
          h += `<th style="text-align:${aligns[ci] || "left"}">${renderCell(cell)}</th>`;
        });
        h += "</tr></thead><tbody>";
        for (let r = 1; r < tableLines.length; r++) {
          const cells = parseCells(tableLines[r]);
          h += "<tr>";
          cells.forEach((cell, ci) => {
            h += `<td style="text-align:${aligns[ci] || "left"}">${renderCell(cell)}</td>`;
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

    // 2. Process remaining text — markup stays plain, styles live in
    // knowledge.css under .kg-wiki-body. No more inline style="…".
    let html = cleaned.join("\n")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/\[\[([^\]]+)\]\]/g, (_m, target) =>
        `<a class="wiki-link" data-target="${target}">${target}</a>`,
      )
      .replace(/^### (.+)$/gm, "<h3>$1</h3>")
      .replace(/^## (.+)$/gm, "<h2>$1</h2>")
      .replace(/^# (.+)$/gm, "<h1>$1</h1>")
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/^- (.+)$/gm, "<li>$1</li>")
      .replace(/^\d+\. (.+)$/gm, "<li>$1</li>")
      .replace(/^&gt; (.+)$/gm, "<blockquote>$1</blockquote>")
      .replace(/^---$/gm, "<hr>")
      .replace(/\n\n/g, "</p><p>")
      .replace(/\n/g, "<br>");

    html = "<p>" + html + "</p>";
    html = html.replace(/(<li[^>]*>.*?<\/li>(\s*<br>)?)+/g, (match) =>
      "<ul>" + match.replace(/<br>/g, "") + "</ul>",
    );

    for (const [key, tableHtml] of Object.entries(tables)) {
      html = html.replace(key, tableHtml);
    }

    return html;
  }

  if (loading) return <div className="kg-wiki-loading">Loading wiki…</div>;

  return (
    <div className="kg-wiki">
      {/* File tree sidebar */}
      <div className="kg-wiki-tree">
        {sortedFolders.map((folder) => {
          const folderFiles = grouped.get(folder) || [];
          const isExpanded = expandedFolders.has(folder);
          const label = folder || "Overview";

          return (
            <div key={folder}>
              <button
                type="button"
                className="kg-wiki-folder-head"
                aria-expanded={isExpanded}
                onClick={() => toggleFolder(folder)}
              >
                <span className="kg-wiki-folder-chev">▶</span>
                {label}
                <span className="kg-wiki-folder-count">{folderFiles.length}</span>
              </button>
              {isExpanded && folderFiles.map((f) => {
                const isActive = selectedPath === f.path;
                const statusIcon = STATUS_ICONS[f.status] || "";
                const statusColor = STATUS_COLORS[f.status] || "var(--ink-4)";
                return (
                  <button
                    key={f.path}
                    type="button"
                    className={`kg-wiki-file${isActive ? " active" : ""}`}
                    onClick={() => openFile(f.path)}
                  >
                    {statusIcon && (
                      <span className="kg-wiki-file-status" style={{ color: statusColor }}>{statusIcon}</span>
                    )}
                    <span className="kg-wiki-file-name">{f.id || f.title}</span>
                  </button>
                );
              })}
            </div>
          );
        })}

        <div className="kg-wiki-footer">
          <div className="label">Open in Obsidian</div>
          <button
            type="button"
            className="kg-wiki-footer-path"
            onClick={() => { navigator.clipboard.writeText(`.runtime/projects/${projectId}/.memory-bank`); }}
            title="Click to copy path"
          >
            .runtime/projects/{projectId.slice(0, 8)}…/.memory-bank
          </button>
        </div>
      </div>

      {/* Content panel */}
      <div className="kg-wiki-content">
        {!selectedPath ? (
          <div className="kg-wiki-empty">Select a file to view</div>
        ) : (
          <>
            <div className="kg-wiki-crumb">
              discovery <span className="sep">/</span>
              <span className="leaf">{selectedPath.replace(".md", "")}</span>
            </div>

            {Object.keys(frontmatter).length > 0 && (
              <div className="kg-wiki-meta">
                {Object.entries(frontmatter).map(([key, value]) => {
                  if (!value || key === "description" || key === "category") return null;
                  // Long values (e.g. multi-sentence role descriptions)
                  // make terrible chip text — clamp to a short preview.
                  const display = typeof value === "string" && value.length > 60
                    ? value.slice(0, 60).trim() + "…"
                    : value;
                  const color =
                    key === "priority" ? (value === "must" ? "var(--must)" : value === "should" ? "var(--should)" : "var(--could)")
                    : key === "status" ? (STATUS_COLORS[value as string] || "var(--ink-3)")
                    : key === "confidence" ? (value === "high" ? "var(--accent-ink)" : value === "low" ? "var(--must)" : "var(--should)")
                    : "var(--ink-3)";
                  return (
                    <span
                      key={key}
                      className="kg-wiki-meta-pill"
                      style={{ color, background: `color-mix(in srgb, ${color} 12%, transparent)` }}
                      title={typeof value === "string" ? value : undefined}
                    >
                      <span className="key">{key}:</span>
                      {display}
                    </span>
                  );
                })}
              </div>
            )}

            <div
              className="kg-wiki-body"
              dangerouslySetInnerHTML={{ __html: renderWikiMarkdown(content) }}
              onClick={(e) => {
                const target = (e.target as HTMLElement).closest("[data-target]");
                if (target) {
                  e.preventDefault();
                  handleWikiLinkClick(target.getAttribute("data-target") || "");
                }
              }}
            />

            {backlinks.length > 0 && (
              <div className="kg-wiki-backlinks">
                <div className="kg-wiki-backlinks-label">
                  Referenced By ({backlinks.length})
                </div>
                <div className="kg-wiki-backlinks-list">
                  {backlinks.map((bl) => (
                    <button
                      key={bl.path}
                      type="button"
                      className="kg-wiki-backlink"
                      onClick={() => openFile(bl.path)}
                    >
                      <span className="kg-wiki-backlink-dot" />
                      <span className="kg-wiki-backlink-title">{bl.title}</span>
                      <span className="kg-wiki-backlink-id">{bl.id}</span>
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
