"use client";

// Handoff tab — document generation UI (Discovery Brief, MVP Scope,
// Functional Requirements). Extracted from DataPanel.tsx; the tab
// manages its own state so it can live in its own file without threading
// anything through DataPanel.

import { useEffect, useState } from "react";
import { listHandoffDocs, getHandoffDoc, generateHandoffStream } from "@/lib/api";


interface HandoffDoc { type: string; generated?: boolean }
interface HandoffGeneration {
  version: number;
  status: string;
  documents?: unknown[];
  errors?: unknown[];
  duration_ms?: number;
  created_at?: string;
  logs?: string[];
}

export function HandoffTab({ projectId }: { projectId: string }) {
  const [docs, setDocs] = useState<HandoffDoc[]>([]);
  const [generations, setGenerations] = useState<HandoffGeneration[]>([]);
  const [selectedDoc, setSelectedDoc] = useState<string | null>(null);
  const [docContent, setDocContent] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [genLog, setGenLog] = useState<string[]>([]);
  const [expandedGen, setExpandedGen] = useState<number | null>(null);
  const [fileViewer, setFileViewer] = useState<{ path: string; name: string; content: string } | null>(null);

  function handleContentClick(e: React.MouseEvent) {
    const target = e.target as HTMLElement;
    const link = target.closest("a[data-file]") as HTMLElement | null;
    if (link) {
      e.preventDefault();
      const filePath = link.getAttribute("data-file") || "";
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
      setDocs((d.documents || []) as HandoffDoc[]);
      setGenerations((d.generations || []) as HandoffGeneration[]);
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
        <button type="button" className="ho-viewer-back" onClick={() => setFileViewer(null)}>
          &larr; Back
        </button>
        <div className="ho-viewer-title">📄 {fileViewer.name}</div>
        <div className="ho-viewer-path">{fileViewer.path}</div>
        <div className="ho-viewer-body" onClick={handleContentClick} dangerouslySetInnerHTML={{ __html: renderHandoffMarkdown(fileViewer.content) }} />
      </div>
    );
  }

  if (selectedDoc && docContent !== null) {
    return (
      <div style={{ padding: 16 }}>
        <button type="button" className="ho-viewer-back" onClick={() => setSelectedDoc(null)}>
          &larr; Back to Handoff
        </button>
        <div className="ho-viewer-body" onClick={handleContentClick} dangerouslySetInnerHTML={{ __html: renderHandoffMarkdown(docContent) }} />
      </div>
    );
  }

  return (
    <div style={{ padding: 16 }}>
      <div className="ho-header">
        <div>
          <div className="ho-header-title">Handoff Documents</div>
          <div className="ho-header-sub">3 deliverables for Phase 2 handoff</div>
        </div>
        <button type="button" className="btn-primary" onClick={handleGenerate} disabled={generating}>
          {generating ? "Generating..." : "Generate All"}
        </button>
      </div>

      <div className="ho-cards">
        {[
          { type: "discovery_brief", label: "Discovery Brief", desc: "Client overview, business context, target users, market analysis" },
          { type: "mvp_scope_freeze", label: "MVP Scope Freeze", desc: "Core features, out of scope, platform decisions, sign-off" },
          { type: "functional_requirements", label: "Functional Requirements", desc: "Detailed requirements with user stories and business rules" },
        ].map((d) => {
          const info = docs.find((x) => x.type === d.type);
          const generated = !!info?.generated;
          return (
            <div
              key={d.type}
              className={`ho-card${generated ? " generated clickable" : ""}`}
              onClick={() => generated && viewDoc(d.type)}
            >
              <div className="ho-card-icon">{generated ? "\u2713" : "\u2014"}</div>
              <div className="ho-card-body">
                <div className="ho-card-title">{d.label}</div>
                <div className="ho-card-desc">{d.desc}</div>
              </div>
              {generated && <span className="chip xs uppercase green">Generated</span>}
            </div>
          );
        })}
      </div>

      {genLog.length > 0 && (
        <div className="ho-log">
          {genLog.map((line, i) => (
            <div key={i} className="line">{line}</div>
          ))}
        </div>
      )}

      {generations.length > 0 && (
        <div className="ho-history">
          <div className="ho-history-label">Generation History</div>
          {generations.map((gen) => {
            const statusVariant = gen.status === "completed" ? "green" : gen.status === "partial" ? "amber" : "red";
            return (
              <div key={gen.version} className="ho-gen">
                <div
                  className="ho-gen-head"
                  onClick={() => setExpandedGen(expandedGen === gen.version ? null : gen.version)}
                >
                  <span className={`chip xs ${statusVariant}`}>v{gen.version}</span>
                  <span className="ho-gen-count">
                    {gen.status === "completed" ? "3/3 docs" : gen.status === "partial" ? `${gen.documents?.length}/3 docs` : "Failed"}
                  </span>
                  {gen.errors && gen.errors.length > 0 && (
                    <span className="ho-gen-err">{gen.errors.length} error{gen.errors.length > 1 ? "s" : ""}</span>
                  )}
                  <span className="ho-gen-ts">
                    {gen.duration_ms ? `${(gen.duration_ms / 1000).toFixed(0)}s` : ""} · {gen.created_at ? new Date(gen.created_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : ""}
                  </span>
                </div>
                {expandedGen === gen.version && gen.logs && gen.logs.length > 0 && (
                  <div className="ho-gen-log">
                    {gen.logs.map((line: string, i: number) => {
                      const cls = line.includes("ERROR") ? "err" : line.includes("WARNING") ? "warn" : line.includes("COMPLETED") ? "ok" : "";
                      return <div key={i} className={`line ${cls}`}>{line}</div>;
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function renderHandoffMarkdown(text: string): string {
  let html = text
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

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

  html = html
    .replace(/^#### (.+)$/gm, (_m, t) => `\x00BLOCK<h4 class="chat-h4">${_inl(t)}</h4>BLOCK\x00`)
    .replace(/^### (.+)$/gm, (_m, t) => `\x00BLOCK<h3 class="chat-h3">${_inl(t)}</h3>BLOCK\x00`)
    .replace(/^## (.+)$/gm, (_m, t) => `\x00BLOCK<div class="ho-h2">${_inl(t)}</div>BLOCK\x00`)
    .replace(/^# (.+)$/gm, (_m, t) => `\x00BLOCK<div class="ho-h1">${_inl(t)}</div>BLOCK\x00`);

  html = html.replace(/((?:^- .+$\n?)+)/gm, (block) => {
    const items = block.trim().split("\n").map(l => l.replace(/^- /, ""));
    return '\x00BLOCK<ul class="chat-ul">' + items.map(i => `<li class="chat-li">${_inl(i)}</li>`).join("") + "</ul>BLOCK\x00";
  });
  html = html.replace(/((?:^\d+\. .+$\n?)+)/gm, (block) => {
    const items = block.trim().split("\n").map(l => l.replace(/^\d+\. /, ""));
    return '\x00BLOCK<ol class="chat-ol">' + items.map(i => `<li class="chat-oli">${_inl(i)}</li>`).join("") + "</ol>BLOCK\x00";
  });

  html = html.replace(/^---$/gm, '\x00BLOCK<hr class="chat-hr">BLOCK\x00');

  const parts = html.split(/\x00BLOCK|BLOCK\x00/);
  html = parts.map((part, i) => {
    if (i % 2 === 1) return part;
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

  t = t.replace(/`([^`]*\.(?:md|json|yaml|yml|txt|py|ts|tsx|js|sh))`/g, (_m, path) => {
    const name = path.split("/").pop() || path;
    return slot(`<a style="${FILE_STYLE}" data-file="${path}" title="${path}">📄 ${name}</a>`);
  });
  t = t.replace(/`([^`]+)`/g, (_m, code) => slot(`<code style="${CODE_STYLE}">${code}</code>`));
  t = t.replace(/(?<!["a-zA-Z])(\.?[\w.-]+(?:\/[\w.-]+)+\/)/g, (_m, path) => slot(`<a style="${FILE_STYLE}" data-file="${path}" title="${path}">📁 ${path}</a>`));
  t = t.replace(/(?<!["\/a-zA-Z\x01])((?:[\w.-]+\/)+[\w.-]+\.(?:md|json|yaml|yml|txt|py|ts|tsx|js|sh))(?![a-zA-Z])/g, (_m, path) => {
    const name = path.split("/").pop() || path;
    return slot(`<a style="${FILE_STYLE}" data-file="${path}" title="${path}">📄 ${name}</a>`);
  });
  t = t.replace(/\[\[([^\]]+)\]\]/g, (_m, target) => slot(`<a style="${WIKI_STYLE}" data-wiki="${target}">${target}</a>`));
  t = t.replace(/\[CONFIRMED([^\]]*)\]/g, (_m, s) => slot(`<span style="${BADGE_STYLES.confirmed}">CONFIRMED${s}</span>`));
  t = t.replace(/\[ASSUMED([^\]]*)\]/g, (_m, s) => slot(`<span style="${BADGE_STYLES.assumed}">ASSUMED${s}</span>`));
  t = t.replace(/\[NOT COVERED([^\]]*)\]/g, (_m, s) => slot(`<span style="${BADGE_STYLES.notcovered}">NOT COVERED${s}</span>`));
  t = t.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/\*(.+?)\*/g, '<em>$1</em>');
  t = t.replace(/\x01S(\d+)\x01/g, (_m, i) => slots[parseInt(i)]);
  return t;
}
