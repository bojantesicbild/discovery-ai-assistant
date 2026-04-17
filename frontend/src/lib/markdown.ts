// Lightweight Markdown → HTML renderer.
// Used by MarkdownPanel (PM view) and the public review page.
// Output uses CSS vars (--dark, --gray-200, --green, etc.) — callers must
// load globals.css for correct styling.
export function renderMarkdown(text: string): string {
  // 0. Pre-pass: extract fenced code blocks (```lang ... ```) into a map.
  // Must run before the table and inline-backtick passes — otherwise
  // table detection or inline `code` regex will chew on the block's body.
  // Dataview/dataviewjs fences are Obsidian-plugin-only: the plugin
  // renders them as live tables inside Obsidian, but in this web viewer
  // they'd show as raw query text. Replace them with a muted hint so the
  // wiki reads cleanly; PMs who want the live table open the same file
  // in Obsidian. Other languages render as a normal <pre><code> block.
  const fences: Record<string, string> = {};
  let fenceIdx = 0;
  const afterFences: string[] = [];
  {
    const rawLines = text.split("\n");
    let j = 0;
    while (j < rawLines.length) {
      const open = rawLines[j].match(/^```\s*(\S*)\s*$/);
      if (!open) {
        afterFences.push(rawLines[j]);
        j++;
        continue;
      }
      const lang = (open[1] || "").toLowerCase();
      const bodyLines: string[] = [];
      j++;
      while (j < rawLines.length && !/^```\s*$/.test(rawLines[j])) {
        bodyLines.push(rawLines[j]);
        j++;
      }
      j++; // consume closing fence (if present)

      let html: string;
      if (lang === "dataview" || lang === "dataviewjs") {
        html = '<div style="padding:8px 12px;margin:10px 0;border:1px dashed var(--gray-200);border-radius:var(--radius-xs);color:var(--gray-500);font-size:12px;font-style:italic">Live view — open this file in Obsidian to see the table</div>';
      } else {
        const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        html = `<pre style="margin:10px 0;padding:12px;background:var(--gray-50);border:1px solid var(--gray-200);border-radius:var(--radius-xs);overflow-x:auto;font-size:12px;font-family:monospace;color:var(--dark)"><code>${esc(bodyLines.join("\n"))}</code></pre>`;
      }
      const key = `__FENCE_${fenceIdx++}__`;
      fences[key] = html;
      afterFences.push(key);
    }
  }

  // 1. Extract tables into a map, replace with placeholders
  const tables: Record<string, string> = {};
  const lines = afterFences;
  const cleaned: string[] = [];
  let i = 0;
  let tableIdx = 0;

  while (i < lines.length) {
    if (
      lines[i].includes("|") &&
      i + 1 < lines.length &&
      /^\|?\s*[-:]+[-| :]*$/.test(lines[i + 1])
    ) {
      const tableLines: string[] = [];
      tableLines.push(lines[i]);
      i++;
      const separatorLine = lines[i];
      i++;
      while (i < lines.length && lines[i].includes("|") && lines[i].trim() !== "") {
        tableLines.push(lines[i]);
        i++;
      }

      const alignments = separatorLine
        .split("|")
        .filter((c) => c.trim())
        .map((c) => {
          const t = c.trim();
          if (t.startsWith(":") && t.endsWith(":")) return "center";
          if (t.endsWith(":")) return "right";
          return "left";
        });

      const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const parseCells = (line: string) =>
        line.split("|").filter((_, idx, arr) => idx > 0 && idx < arr.length - (line.endsWith("|") ? 1 : 0)).map((c) => c.trim());

      const headerCells = parseCells(tableLines[0]);
      let h = '<table style="width:100%;border-collapse:collapse;margin:12px 0;font-size:12px"><thead><tr>';
      headerCells.forEach((cell, ci) => {
        const a = alignments[ci] || "left";
        h += `<th style="text-align:${a};padding:8px 12px;border:1px solid var(--gray-200);background:var(--gray-50);font-weight:600;color:var(--dark)">${esc(cell)}</th>`;
      });
      h += "</tr></thead><tbody>";
      for (let r = 1; r < tableLines.length; r++) {
        const cells = parseCells(tableLines[r]);
        h += "<tr>";
        cells.forEach((cell, ci) => {
          const a = alignments[ci] || "left";
          h += `<td style="text-align:${a};padding:6px 12px;border:1px solid var(--gray-200);color:var(--gray-600)">${esc(cell)}</td>`;
        });
        h += "</tr>";
      }
      h += "</tbody></table>";

      const key = `__TABLE_${tableIdx++}__`;
      tables[key] = h;
      cleaned.push(key);
    } else {
      cleaned.push(lines[i]);
      i++;
    }
  }

  // 2. Process the rest as markdown (tables are now just placeholder strings)
  let html = cleaned.join("\n")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/^### (.+)$/gm, '<h3 style="font-size:14px;font-weight:700;margin:12px 0 2px;color:var(--dark)">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 style="font-size:16px;font-weight:700;margin:14px 0 2px;color:var(--dark)">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 style="font-size:18px;font-weight:800;margin:16px 0 4px;color:var(--dark)">$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code style="padding:1px 6px;background:var(--gray-100);border-radius:4px;font-size:12px;font-family:monospace">$1</code>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="md-link" style="color:var(--green);text-decoration:underline;cursor:pointer">$1</a>')
    .replace(/^- (.+)$/gm, '<li class="chat-li">$1</li>')
    .replace(/^\d+\. (.+)$/gm, '<li class="chat-oli">$1</li>')
    .replace(/^&gt; (.+)$/gm, '<blockquote style="border-left:3px solid var(--green);padding:8px 14px;margin:10px 0;background:var(--green-light);border-radius:0 var(--radius-xs) var(--radius-xs) 0;font-size:12px;color:var(--gray-600)">$1</blockquote>')
    .replace(/^---$/gm, '<hr style="border:none;border-top:1px solid var(--gray-200);margin:16px 0">')
    .replace(/\n\n/g, '</p><p style="margin:6px 0">')
    .replace(/\n/g, '<br>');

  html = '<p style="margin:6px 0">' + html + '</p>';

  html = html.replace(/(<li[^>]*>.*?<\/li>(\s*<br>)?)+/g, (match) => {
    const isOrdered = /class="chat-oli"/.test(match);
    const tag = isOrdered ? 'ol' : 'ul';
    const cls = isOrdered ? 'chat-ol' : 'chat-ul';
    return `<${tag} class="${cls}">` + match.replace(/<br>/g, '') + `</${tag}>`;
  });

  // Strip stray <br> right after a heading or list — they're just noise
  // from the newline that followed the block element in the source.
  html = html.replace(/(<\/h[1-6]>|<\/ul>|<\/ol>)\s*<br>/g, '$1');
  // Collapse empty paragraphs left behind when \n\n hugs a block element.
  html = html.replace(/<p[^>]*>\s*(<br>\s*)*<\/p>/g, '');
  html = html.replace(/<p[^>]*>\s*(<h[1-6][^>]*>)/g, '$1');
  html = html.replace(/(<\/h[1-6]>)\s*<\/p>/g, '$1');

  // 3. Re-insert tables
  for (const [key, tableHtml] of Object.entries(tables)) {
    html = html.replace(key, tableHtml);
  }

  // 4. Re-insert fenced code blocks (extracted in the pre-pass)
  for (const [key, fenceHtml] of Object.entries(fences)) {
    html = html.replace(key, fenceHtml);
  }

  return html;
}
