"use client";

// Handoff tab — document generation UI (Discovery Brief, MVP Scope,
// Functional Requirements). Extracted from DataPanel.tsx; the tab
// manages its own state so it can live in its own file without threading
// anything through DataPanel.

import { useEffect, useState } from "react";
import { listHandoffDocs, getHandoffDoc, generateHandoffStream } from "@/lib/api";


export function HandoffTab({ projectId }: { projectId: string }) {
  const [docs, setDocs] = useState<any[]>([]);
  const [generations, setGenerations] = useState<any[]>([]);
  const [selectedDoc, setSelectedDoc] = useState<string | null>(null);
  const [docContent, setDocContent] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [genLog, setGenLog] = useState<string[]>([]);
  const [expandedGen, setExpandedGen] = useState<number | null>(null);
  const [fileViewer, setFileViewer] = useState<{ path: string; name: string; content: string } | null>(null);

  async function openFile(path: string) {
    try {
      const token = localStorage.getItem("token") || "";
      const base = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
      const res = await fetch(`${base}/api/projects/${projectId}/file?path=${encodeURIComponent(path)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      setFileViewer(data);
    } catch {}
  }

  function handleContentClick(e: React.MouseEvent) {
    const target = e.target as HTMLElement;
    const link = target.closest("a[data-file]") as HTMLElement | null;
    if (link) {
      e.preventDefault();
      const filePath = link.getAttribute("data-file") || "";
      // Try multiple possible locations
      const candidates = [
        filePath,
        filePath.startsWith(".") ? filePath : `.memory-bank/${filePath}`,
        `.memory-bank/docs/discovery/${filePath.split("/").pop()}`,
      ];
      tryOpenFile(candidates);
    }
  }

  async function tryOpenFile(paths: string[]) {
    const token = localStorage.getItem("token") || "";
    const base = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
    for (const p of paths) {
      try {
        const res = await fetch(`${base}/api/projects/${projectId}/file?path=${encodeURIComponent(p)}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          setFileViewer(await res.json());
          return;
        }
      } catch {}
    }
  }

  function loadData() {
    listHandoffDocs(projectId).then((d) => {
      setDocs(d.documents || []);
      setGenerations(d.generations || []);
    }).catch(() => {});
  }

  useEffect(() => { loadData(); }, [projectId]);

  function handleGenerate() {
    setGenerating(true);
    setGenLog(["Starting handoff document generation..."]);
    generateHandoffStream(
      projectId,
      (text) => setGenLog((prev) => [...prev.slice(-20), text.slice(0, 80)]),
      (generated) => {
        setGenerating(false);
        setGenLog((prev) => [...prev, `Done! Generated: ${generated.join(", ")}`]);
        loadData();
      },
      (tool) => setGenLog((prev) => [...prev.slice(-20), `Using: ${tool}`]),
      (error) => {
        setGenerating(false);
        setGenLog((prev) => [...prev, `Error: ${error}`]);
      },
    );
  }

  function viewDoc(docType: string) {
    setSelectedDoc(docType);
    setDocContent(null);
    getHandoffDoc(projectId, docType).then((d) => {
      setDocContent(d.content || "Document not yet generated.");
    });
  }

  if (fileViewer) {
    return (
      <div style={{ padding: 16 }}>
        <button onClick={() => setFileViewer(null)} style={{
          display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 600,
          color: "var(--gray-500)", background: "none", border: "none", cursor: "pointer",
          marginBottom: 12, padding: 0, fontFamily: "var(--font)",
        }}>
          &larr; Back
        </button>
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--dark)", marginBottom: 4 }}>📄 {fileViewer.name}</div>
        <div style={{ fontSize: 10, color: "var(--gray-400)", marginBottom: 12, fontFamily: "monospace" }}>{fileViewer.path}</div>
        <div style={{ fontSize: 13, lineHeight: 1.5, color: "var(--gray-700)" }} onClick={handleContentClick} dangerouslySetInnerHTML={{ __html: renderHandoffMarkdown(fileViewer.content) }} />
      </div>
    );
  }

  if (selectedDoc && docContent !== null) {
    return (
      <div style={{ padding: 16 }}>
        <button onClick={() => setSelectedDoc(null)} style={{
          display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 600,
          color: "var(--gray-500)", background: "none", border: "none", cursor: "pointer",
          marginBottom: 12, padding: 0, fontFamily: "var(--font)",
        }}>
          &larr; Back to Handoff
        </button>
        <div style={{ fontSize: 13, lineHeight: 1.5, color: "var(--gray-700)" }} onClick={handleContentClick} dangerouslySetInnerHTML={{ __html: renderHandoffMarkdown(docContent) }} />
      </div>
    );
  }

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--dark)" }}>Handoff Documents</div>
          <div style={{ fontSize: 11, color: "var(--gray-400)", marginTop: 2 }}>
            3 deliverables for Phase 2 handoff
          </div>
        </div>
        <button
          onClick={handleGenerate}
          disabled={generating}
          style={{
            padding: "8px 16px", borderRadius: 8, border: "none",
            background: generating ? "var(--gray-200)" : "var(--green)",
            color: generating ? "var(--gray-500)" : "white",
            fontSize: 12, fontWeight: 600, cursor: generating ? "not-allowed" : "pointer",
            fontFamily: "var(--font)",
          }}
        >
          {generating ? "Generating..." : "Generate All"}
        </button>
      </div>

      {/* Document cards */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {[
          { type: "discovery_brief", label: "Discovery Brief", desc: "Client overview, business context, target users, market analysis" },
          { type: "mvp_scope_freeze", label: "MVP Scope Freeze", desc: "Core features, out of scope, platform decisions, sign-off" },
          { type: "functional_requirements", label: "Functional Requirements", desc: "Detailed requirements with user stories and business rules" },
        ].map((d) => {
          const info = docs.find((x: any) => x.type === d.type);
          const generated = info?.generated;
          return (
            <div key={d.type} style={{
              padding: "14px 16px", border: "1px solid var(--gray-200)", borderRadius: 10,
              background: generated ? "#f0fdf8" : "var(--white)",
              cursor: generated ? "pointer" : "default",
              transition: "all 0.15s",
            }}
            onClick={() => generated && viewDoc(d.type)}
            onMouseEnter={(e) => generated && (e.currentTarget.style.borderColor = "var(--green)")}
            onMouseLeave={(e) => (e.currentTarget.style.borderColor = "var(--gray-200)")}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{
                  width: 32, height: 32, borderRadius: 8,
                  background: generated ? "#d1fae5" : "var(--gray-100)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  color: generated ? "#059669" : "var(--gray-400)", fontSize: 14,
                }}>
                  {generated ? "\u2713" : "\u2014"}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--dark)" }}>{d.label}</div>
                  <div style={{ fontSize: 11, color: "var(--gray-400)", marginTop: 1 }}>{d.desc}</div>
                </div>
                {generated && (
                  <span style={{ fontSize: 10, fontWeight: 600, color: "#059669", background: "#d1fae5", padding: "2px 8px", borderRadius: 6 }}>
                    Generated
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Generation log */}
      {genLog.length > 0 && (
        <div style={{
          marginTop: 14, padding: 12, background: "#1a1a2e", borderRadius: 8,
          maxHeight: 150, overflow: "auto", fontSize: 11, fontFamily: "monospace", color: "#a1a1aa",
        }}>
          {genLog.map((line, i) => (
            <div key={i} style={{ marginBottom: 2 }}>{line}</div>
          ))}
        </div>
      )}

      {/* Generation history */}
      {generations.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--gray-400)", marginBottom: 8 }}>
            Generation History
          </div>
          {generations.map((gen: any) => (
            <div key={gen.version} style={{
              marginBottom: 6, border: "1px solid var(--gray-200)", borderRadius: 8, overflow: "hidden",
            }}>
              <div
                onClick={() => setExpandedGen(expandedGen === gen.version ? null : gen.version)}
                style={{
                  display: "flex", alignItems: "center", gap: 8, padding: "8px 12px",
                  cursor: "pointer", background: "var(--gray-50)", transition: "background 0.15s",
                }}
              >
                <span style={{
                  fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 4,
                  background: gen.status === "completed" ? "#d1fae5" : gen.status === "partial" ? "#FEF3C7" : "#fee2e2",
                  color: gen.status === "completed" ? "#059669" : gen.status === "partial" ? "#D97706" : "#EF4444",
                }}>v{gen.version}</span>
                <span style={{ fontSize: 11, fontWeight: 500, flex: 1 }}>
                  {gen.status === "completed" ? "3/3 docs" : gen.status === "partial" ? `${gen.documents?.length}/3 docs` : "Failed"}
                </span>
                {gen.errors?.length > 0 && (
                  <span style={{ fontSize: 9, fontWeight: 600, color: "#EF4444" }}>{gen.errors.length} error{gen.errors.length > 1 ? "s" : ""}</span>
                )}
                <span style={{ fontSize: 10, color: "var(--gray-400)" }}>
                  {gen.duration_ms ? `${(gen.duration_ms / 1000).toFixed(0)}s` : ""} · {gen.created_at ? new Date(gen.created_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : ""}
                </span>
              </div>
              {expandedGen === gen.version && gen.logs?.length > 0 && (
                <div style={{
                  padding: 10, background: "#1a1a2e", fontSize: 10, fontFamily: "monospace",
                  color: "#a1a1aa", maxHeight: 200, overflow: "auto",
                }}>
                  {gen.logs.map((line: string, i: number) => (
                    <div key={i} style={{
                      marginBottom: 2,
                      color: line.includes("ERROR") ? "#EF4444" : line.includes("WARNING") ? "#F59E0B" : line.includes("COMPLETED") ? "#059669" : "#a1a1aa",
                    }}>{line}</div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function renderHandoffMarkdown(text: string): string {
  let html = text
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  // Tables
  html = html.replace(/((?:^\|.+\|[ ]*$\n?)+)/gm, (tableBlock) => {
    const rows = tableBlock.trim().split("\n").filter(r => r.trim());
    if (rows.length < 2) return tableBlock;
    const isSep = (r: string) => /^\|[\s\-:|]+\|$/.test(r) && r.includes("-");
    const parse = (row: string) => row.split("|").slice(1, -1).map(c => c.trim());
    const header = rows[0];
    const body = rows.filter((r, i) => i > 0 && !isSep(r));
    if (body.length === 0) return tableBlock;
    const hCells = parse(header);
    let t = '\x00BLOCK<div class="chat-table-wrap"><table class="chat-table"><thead><tr>';
    hCells.forEach(c => { t += `<th>${_inl(c)}</th>`; });
    t += "</tr></thead><tbody>";
    body.forEach(row => {
      const cells = parse(row);
      t += "<tr>";
      cells.forEach((c, ci) => { t += `<td${ci === 0 ? ' class="chat-td-label"' : ""}>${_inl(c)}</td>`; });
      t += "</tr>";
    });
    t += "</tbody></table></div>BLOCK\x00";
    return t;
  });

  // Headings
  html = html
    .replace(/^#### (.+)$/gm, (_m, t) => `\x00BLOCK<h4 class="chat-h4">${_inl(t)}</h4>BLOCK\x00`)
    .replace(/^### (.+)$/gm, (_m, t) => `\x00BLOCK<h3 class="chat-h3">${_inl(t)}</h3>BLOCK\x00`)
    .replace(/^## (.+)$/gm, (_m, t) => `\x00BLOCK<div class="ho-h2">${_inl(t)}</div>BLOCK\x00`)
    .replace(/^# (.+)$/gm, (_m, t) => `\x00BLOCK<div class="ho-h1">${_inl(t)}</div>BLOCK\x00`);

  // Lists — collect consecutive
  html = html.replace(/((?:^- .+$\n?)+)/gm, (block) => {
    const items = block.trim().split("\n").map(l => l.replace(/^- /, ""));
    return '\x00BLOCK<ul class="chat-ul">' + items.map(i => `<li class="chat-li">${_inl(i)}</li>`).join("") + "</ul>BLOCK\x00";
  });
  html = html.replace(/((?:^\d+\. .+$\n?)+)/gm, (block) => {
    const items = block.trim().split("\n").map(l => l.replace(/^\d+\. /, ""));
    return '\x00BLOCK<ol class="chat-ol">' + items.map(i => `<li class="chat-oli">${_inl(i)}</li>`).join("") + "</ol>BLOCK\x00";
  });

  // Horizontal rule
  html = html.replace(/^---$/gm, '\x00BLOCK<hr class="chat-hr">BLOCK\x00');

  // Process text segments only — inline formatting + line breaks
  const parts = html.split(/\x00BLOCK|BLOCK\x00/);
  html = parts.map((part, i) => {
    if (i % 2 === 1) return part; // block element — already processed
    part = _inl(part);
    return part
      .replace(/\n\n+/g, '<div class="chat-paragraph-break"></div>')
      .replace(/\n/g, "<br>");
  }).join("");

  return html;
}

const FILE_STYLE = 'padding:1px 6px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:4px;font-size:0.88em;font-family:monospace;color:#2563eb;cursor:pointer;text-decoration:none;display:inline-block';
const CODE_STYLE = 'padding:1px 5px;background:#f0fdf4;border:1px solid #dcfce7;border-radius:4px;font-size:0.88em;font-family:monospace;color:#16a34a';
const WIKI_STYLE = 'color:#059669;font-weight:600;cursor:pointer;border-bottom:1px dashed #059669;text-decoration:none';
const BADGE_STYLES: Record<string, string> = {
  confirmed: 'font-size:8px;font-weight:700;padding:1px 5px;border-radius:3px;background:#d1fae5;color:#059669;vertical-align:middle;letter-spacing:0.3px;white-space:nowrap',
  assumed: 'font-size:8px;font-weight:700;padding:1px 5px;border-radius:3px;background:#FEF3C7;color:#D97706;vertical-align:middle;letter-spacing:0.3px;white-space:nowrap',
  notcovered: 'font-size:8px;font-weight:700;padding:1px 5px;border-radius:3px;background:#fee2e2;color:#EF4444;vertical-align:middle;letter-spacing:0.3px;white-space:nowrap',
};

function _inl(t: string): string {
  const slots: string[] = [];
  const slot = (html: string) => { slots.push(html); return `\x01S${slots.length - 1}\x01`; };

  // File paths in backticks → slot
  t = t.replace(/`([^`]*\.(?:md|json|yaml|yml|txt|py|ts|tsx|js|sh))`/g, (_m, path) => {
    const name = path.split("/").pop() || path;
    return slot(`<a style="${FILE_STYLE}" data-file="${path}" title="${path}">📄 ${name}</a>`);
  });
  // Remaining backticks → slot
  t = t.replace(/`([^`]+)`/g, (_m, code) => slot(`<code style="${CODE_STYLE}">${code}</code>`));
  // Directory paths → slot
  t = t.replace(/(?<!["a-zA-Z])(\.?[\w.-]+(?:\/[\w.-]+)+\/)/g, (_m, path) => slot(`<a style="${FILE_STYLE}" data-file="${path}" title="${path}">📁 ${path}</a>`));
  // Bare file paths → slot
  t = t.replace(/(?<!["\/a-zA-Z\x01])((?:[\w.-]+\/)+[\w.-]+\.(?:md|json|yaml|yml|txt|py|ts|tsx|js|sh))(?![a-zA-Z])/g, (_m, path) => {
    const name = path.split("/").pop() || path;
    return slot(`<a style="${FILE_STYLE}" data-file="${path}" title="${path}">📄 ${name}</a>`);
  });
  // Wikilinks
  t = t.replace(/\[\[([^\]]+)\]\]/g, (_m, target) => slot(`<a style="${WIKI_STYLE}" data-wiki="${target}">${target}</a>`));
  // Attribution badges
  t = t.replace(/\[CONFIRMED([^\]]*)\]/g, (_m, s) => slot(`<span style="${BADGE_STYLES.confirmed}">CONFIRMED${s}</span>`));
  t = t.replace(/\[ASSUMED([^\]]*)\]/g, (_m, s) => slot(`<span style="${BADGE_STYLES.assumed}">ASSUMED${s}</span>`));
  t = t.replace(/\[NOT COVERED([^\]]*)\]/g, (_m, s) => slot(`<span style="${BADGE_STYLES.notcovered}">NOT COVERED${s}</span>`));
  // Bold / italic
  t = t.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/\*(.+?)\*/g, '<em>$1</em>');
  // Restore slots
  t = t.replace(/\x01S(\d+)\x01/g, (_m, i) => slots[parseInt(i)]);
  return t;
}

