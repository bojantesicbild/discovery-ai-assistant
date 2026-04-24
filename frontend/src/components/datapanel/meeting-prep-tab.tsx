"use client";

// Meeting Prep tab — generate a meeting agenda from the current state,
// stream chat drafts, persist to vault + Gmail. Extracted from
// DataPanel.tsx; the tab owns all its own state so it lifts out cleanly.

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  getMeetingAgenda, saveMeetingAgenda, createNewAgenda,
  listIntegrations,
} from "@/lib/api";
import type { ApiRequirement, ApiGap, ApiConstraint, ApiContradiction } from "@/lib/api";
import { EmptyState } from "./pills";


type Status = "approved" | "dismissed" | undefined;

interface DashboardShape {
  project_name?: string;
  readiness?: { score?: number };
}

interface AgendaHistoryRow {
  id: string;
  round_number: number;
  edited_at?: string | null;
  created_at?: string | null;
  preview?: string | null;
}


export function MeetingPrepTab({ projectId, contradictions, gaps, requirements, constraints: _constraints, dashboard }: {
  projectId: string;
  contradictions: ApiContradiction[];
  gaps: ApiGap[];
  requirements: ApiRequirement[];
  constraints: ApiConstraint[];
  dashboard: DashboardShape;
}) {
  const searchParams = useSearchParams();
  const requestedFile = searchParams.get("file");
  const [phase, setPhase] = useState<"pick" | "agenda">("pick");
  const [agenda, setAgenda] = useState("");
  const [, setActiveFilename] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [roundNumber, setRoundNumber] = useState(0);
  const [copied, setCopied] = useState(false);
  const [copiedEmail, setCopiedEmail] = useState(false);
  const [draftingEmail, setDraftingEmail] = useState(false);
  const [draftSent, setDraftSent] = useState(false);
  const [draftUrl, setDraftUrl] = useState<string | null>(null);
  const [gmailConnected, setGmailConnected] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [customTopic, setCustomTopic] = useState("");
  const [customTopics, setCustomTopics] = useState<string[]>([]);
  const [agendaHistory, setAgendaHistory] = useState<AgendaHistoryRow[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  const [statuses, setStatuses] = useState<Record<string, Status>>({});
  function approve(id: string) {
    setStatuses((s) => ({ ...s, [id]: s[id] === "approved" ? undefined : "approved" }));
  }
  function dismiss(id: string) {
    setStatuses((s) => ({ ...s, [id]: s[id] === "dismissed" ? undefined : "dismissed" }));
  }

  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ type: string; id: string }>;
      const id = ce.detail?.id;
      if (!id) return;
      setStatuses((s) => ({ ...s, [id]: "approved" }));
      setPhase("pick");
    };
    window.addEventListener("add-to-meeting", handler);
    return () => window.removeEventListener("add-to-meeting", handler);
  }, []);

  function selectAllInSection(ids: string[]) {
    const allApproved = ids.every((id) => statuses[id] === "approved");
    setStatuses((s) => {
      const next = { ...s };
      ids.forEach((id) => { next[id] = allApproved ? undefined : "approved"; });
      return next;
    });
  }
  const getStatus = (id: string): Status => statuses[id];

  const openGaps = gaps.filter((g) => g.status === "open");
  const unconfirmedMust = requirements.filter((r) => r.status !== "confirmed" && (r.priority === "must" || r.priority === "should"));

  const approvedCount =
    openGaps.filter((g) => getStatus(g.id) === "approved").length
    + unconfirmedMust.filter((r) => getStatus(r.req_id) === "approved").length
    + contradictions.filter((c) => getStatus(c.id) === "approved").length
    + customTopics.length;

  const estimatedMin =
    contradictions.filter((c) => getStatus(c.id) === "approved").length * 10
    + openGaps.filter((g) => getStatus(g.id) === "approved" && g.severity === "high").length * 5
    + openGaps.filter((g) => getStatus(g.id) === "approved" && g.severity !== "high").length * 3
    + unconfirmedMust.filter((r) => getStatus(r.req_id) === "approved").length * 2
    + customTopics.length * 5;

  useEffect(() => {
    listIntegrations(projectId)
      .then((d) => setGmailConnected((d.integrations || []).some((i) => i.connector_id === "gmail" && i.status === "active")))
      .catch(() => {});
  }, [projectId]);

  useEffect(() => {
    (async () => {
      try {
        const { listMeetingAgendas } = await import("@/lib/api");
        const hist = await listMeetingAgendas(projectId);
        setAgendaHistory((hist.agendas || []) as AgendaHistoryRow[]);
      } catch {}
      try {
        const { getMeetingAgendaFromVault } = await import("@/lib/api");
        const vault = await getMeetingAgendaFromVault(projectId, requestedFile || undefined);
        if (vault.content) {
          setAgenda(vault.content);
          setActiveFilename(vault.filename || null);
          setPhase("agenda");
          return;
        }
      } catch {}
      try {
        const db = await getMeetingAgenda(projectId);
        if (db.content_md) {
          setAgenda(db.content_md);
          setRoundNumber(db.round_number || 0);
          setPhase("agenda");
        }
      } catch {}
    })();
  }, [projectId, requestedFile]);

  useEffect(() => {
    if (!generating) return;
    function handleChatDone() {
      setTimeout(async () => {
        try {
          const { getMeetingAgendaFromVault } = await import("@/lib/api");
          const vault = await getMeetingAgendaFromVault(projectId);
          if (vault.content) {
            setAgenda(vault.content);
            setPhase("agenda");
            createNewAgenda(projectId, vault.content).then(() => {
              setRoundNumber((r) => r + 1);
            }).catch(() => {});
          }
        } catch {}
        setGenerating(false);
      }, 2000);
    }
    window.addEventListener("chat-response-done", handleChatDone);
    return () => window.removeEventListener("chat-response-done", handleChatDone);
  }, [generating, projectId]);

  function handleGenerate() {
    const selectedGaps = openGaps.filter((g) => getStatus(g.id) === "approved");
    const selectedReqs = unconfirmedMust.filter((r) => getStatus(r.req_id) === "approved");
    const selectedContras = contradictions.filter((c) => getStatus(c.id) === "approved");
    const dismissedItems = [
      ...openGaps.filter((g) => getStatus(g.id) === "dismissed").map((g) => g.question?.slice(0, 60)),
      ...unconfirmedMust.filter((r) => getStatus(r.req_id) === "dismissed").map((r) => r.title?.slice(0, 60)),
    ].filter(Boolean);

    const readiness = dashboard?.readiness?.score || 0;

    let message = `Prepare meeting agenda · **${approvedCount} items** · est. ${estimatedMin} min · readiness ${readiness}%\n\n`;

    if (selectedContras.length > 0) {
      message += `**Decisions (${selectedContras.length})**\n`;
      selectedContras.forEach((c) => {
        const headline = c.title || c.explanation?.slice(0, 80) || "Contradiction";
        message += `- ${headline}\n`;
      });
      message += `\n`;
    }
    if (selectedReqs.length > 0) {
      message += `**Confirm (${selectedReqs.length})**\n`;
      selectedReqs.forEach((r) => { message += `- ${r.title}\n`; });
      message += `\n`;
    }
    if (selectedGaps.length > 0) {
      message += `**Questions (${selectedGaps.length})**\n`;
      selectedGaps.forEach((g) => { message += `- ${g.question?.slice(0, 80)}\n`; });
      message += `\n`;
    }
    if (customTopics.length > 0) {
      message += `**Custom**\n`;
      customTopics.forEach((t) => { message += `- ${t}\n`; });
      message += `\n`;
    }
    if (dismissedItems.length > 0) {
      message += `**Parking lot:** ${dismissedItems.slice(0, 5).join(", ")}\n`;
    }

    setGenerating(true);
    window.dispatchEvent(new CustomEvent("send-chat", { detail: { text: message } }));
  }

  async function handleSave() {
    setSaving(true);
    try {
      await saveMeetingAgenda(projectId, agenda);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {}
    setSaving(false);
  }

  async function handleDraftInGmail() {
    setDraftingEmail(true);
    try {
      const { createGmailDraft } = await import("@/lib/api");
      const projectName = dashboard?.project_name || "Discovery";
      const subject = `Discovery Meeting Agenda — ${projectName}`;
      const body = `Hi team,\n\nPlease find below the agenda for our upcoming discovery meeting. I'd appreciate if you could review it before our session.\n\n${agenda}\n\nPlease let me know if you'd like to add any topics.\n\nBest regards`;
      const result = await createGmailDraft(projectId, subject, body);
      setDraftSent(true);
      if (result.gmail_url) {
        setDraftUrl(result.gmail_url);
      } else {
        setTimeout(() => setDraftSent(false), 3000);
      }
    } catch (e) {
      alert((e as Error)?.message || "Failed to create Gmail draft");
    }
    setDraftingEmail(false);
  }

  function handleCopy() {
    navigator.clipboard.writeText(agenda);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleCopyAsEmail() {
    const emailBody = `Hi team,

Please find below the agenda for our upcoming discovery meeting. I'd appreciate if you could review it before our session so we can make the most of our time together.

${agenda}

Please let me know if you'd like to add any topics or if any of the items above need clarification before we meet.

Looking forward to a productive session.

Best regards`;

    navigator.clipboard.writeText(emailBody);
    setCopiedEmail(true);
    setTimeout(() => setCopiedEmail(false), 2000);
  }

  function handleDownload() {
    const blob = new Blob([agenda], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `meeting-agenda-round-${roundNumber || "draft"}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function addCustomTopic() {
    if (customTopic.trim()) {
      setCustomTopics((prev) => [...prev, customTopic.trim()]);
      setCustomTopic("");
    }
  }

  function ItemActions({ id }: { id: string }) {
    const st = getStatus(id);
    return (
      <div className="mp-actions">
        <button
          type="button"
          className={`mp-act-btn approve${st === "approved" ? " on" : ""}`}
          title={st === "approved" ? "Remove from agenda" : "Add to agenda"}
          onClick={(e) => { e.stopPropagation(); approve(id); }}
        >✓</button>
        <button
          type="button"
          className={`mp-act-btn dismiss${st === "dismissed" ? " on" : ""}`}
          title={st === "dismissed" ? "Restore" : "Dismiss"}
          onClick={(e) => { e.stopPropagation(); dismiss(id); }}
        >✕</button>
      </div>
    );
  }

  // ── PHASE 2: Agenda viewer/editor ──
  if (phase === "agenda" && agenda) {
    return (
      <div style={{ padding: "12px 0 40px" }}>
        <div className="mp-agenda-header">
          <div className="mp-agenda-title">
            Meeting Agenda
            {roundNumber > 0 && <span className="mp-agenda-round">· Round {roundNumber}</span>}
          </div>
          <button type="button" className="btn-ghost" onClick={() => setPhase("pick")}>← Back to items</button>
          {!editMode && (
            <>
              <button type="button" className="btn-ghost" onClick={handleCopy}>{copied ? "✓ Copied!" : "Copy"}</button>
              <button type="button" className="btn-ghost" onClick={handleCopyAsEmail}>{copiedEmail ? "✓ Copied!" : "Copy as Email"}</button>
              {gmailConnected && (
                draftSent && draftUrl ? (
                  <a href={draftUrl} target="_blank" rel="noopener noreferrer" className="mp-gmail-draft-link">
                    ✓ Open draft in Gmail →
                  </a>
                ) : (
                  <button type="button" className="btn-ghost" onClick={handleDraftInGmail} disabled={draftingEmail}>
                    {draftingEmail ? "Creating..." : "Draft in Gmail"}
                  </button>
                )
              )}
              <button type="button" className="btn-ghost" onClick={handleDownload}>Download</button>
            </>
          )}
          <button
            type="button"
            className={editMode ? "btn-primary" : "btn-ghost"}
            onClick={() => { if (editMode) handleSave(); setEditMode(!editMode); }}
          >
            {editMode ? (saving ? "Saving..." : saved ? "✓ Saved" : "Save & Preview") : "Edit"}
          </button>
        </div>
        {editMode ? (
          <textarea
            className="mp-agenda-edit"
            value={agenda}
            onChange={(e) => setAgenda(e.target.value)}
          />
        ) : (
          <div
            className="mp-agenda-body chat-markdown-body"
            dangerouslySetInnerHTML={{ __html: _renderMeetingMd(agenda) }}
          />
        )}
      </div>
    );
  }

  // ── PHASE 1: Item picker ──
  const allItems = openGaps.length + unconfirmedMust.length + contradictions.length;

  return (
    <div className="mp-container">
      <div className="mp-header">
        <div style={{ flex: 1 }}>
          <div className="mp-header-title">Prepare Meeting Agenda</div>
          <div className="mp-header-sub">
            Select items to discuss · {approvedCount} selected · est. {estimatedMin} min
          </div>
        </div>
        <div className="mp-header-right">
          {agenda && (
            <button type="button" className="btn-ghost" onClick={() => setPhase("agenda")}>
              View Last Agenda →
            </button>
          )}
          <button
            type="button"
            className="btn-primary mp-generate"
            onClick={handleGenerate}
            disabled={generating || approvedCount === 0}
          >
            <svg viewBox="0 0 24 24">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
            </svg>
            {generating ? "Generating in chat..." : approvedCount > 0 ? `Generate Agenda · ${approvedCount} items` : "Select items first"}
          </button>
        </div>
      </div>

      {generating && (
        <div className="mp-generating-note">
          ✨ The agent is generating your agenda in the <strong>chat panel</strong> (left side). You can watch it work in real time. The agenda will appear here when it&apos;s done.
        </div>
      )}

      {agendaHistory.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <button
            type="button"
            className={`mp-history-toggle${showHistory ? " open" : ""}`}
            onClick={() => setShowHistory(!showHistory)}
          >
            <svg viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
            </svg>
            Past Agendas ({agendaHistory.length})
            <svg className="chev" viewBox="0 0 24 24">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          {showHistory && (
            <div className="mp-history-list">
              {agendaHistory.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className="mp-history-item"
                  onClick={async () => {
                    try {
                      const { getMeetingAgendaByRound } = await import("@/lib/api");
                      const data = await getMeetingAgendaByRound(projectId, a.round_number);
                      if (data.content_md) {
                        setAgenda(data.content_md);
                        setRoundNumber(a.round_number);
                        setPhase("agenda");
                      }
                    } catch {}
                  }}
                >
                  <span className="mp-history-round">{a.round_number}</span>
                  <div className="mp-history-round-body">
                    <div className="mp-history-round-title">
                      Round {a.round_number} {a.edited_at ? "(edited)" : ""}
                    </div>
                    <div className="mp-history-round-meta">
                      {a.created_at ? new Date(a.created_at).toLocaleDateString() : ""}
                      {a.preview ? ` · ${a.preview.slice(0, 60)}...` : ""}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {allItems === 0 ? (
        <EmptyState icon="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" text="No items for the agenda. All requirements confirmed, no gaps or contradictions." />
      ) : (
        <>
          {contradictions.length > 0 && (
            <div className="mp-section">
              <div className="mp-section-head">
                <div className="mp-section-icon red">!</div>
                <div className="mp-section-title">Decisions Needed ({contradictions.filter((c) => getStatus(c.id) !== "dismissed").length})</div>
                <button type="button" className="mp-select-all" onClick={() => selectAllInSection(contradictions.map((c) => c.id))}>
                  {contradictions.every((c) => getStatus(c.id) === "approved") ? "Deselect all" : "Select all"}
                </button>
              </div>
              {contradictions.map((c) => {
                const st = getStatus(c.id);
                if (st === "dismissed") return null;
                return (
                  <div key={c.id} className={`mp-item${st === "approved" ? " approved" : ""}`}>
                    <div className="mp-item-content">
                      <div className="mp-item-title">{c.title || c.explanation?.slice(0, 80) || "Contradiction"}</div>
                      <div className="mp-item-meta">~10 min · {c.area || c.item_a_type || "requirement"}</div>
                    </div>
                    <ItemActions id={c.id} />
                  </div>
                );
              })}
            </div>
          )}

          {unconfirmedMust.length > 0 && (
            <div className="mp-section">
              <div className="mp-section-head">
                <div className="mp-section-icon blue">✓</div>
                <div className="mp-section-title">Requirements to Confirm ({unconfirmedMust.filter((r) => getStatus(r.req_id) !== "dismissed").length})</div>
                <button type="button" className="mp-select-all" onClick={() => selectAllInSection(unconfirmedMust.map((r) => r.req_id))}>
                  {unconfirmedMust.every((r) => getStatus(r.req_id) === "approved") ? "Deselect all" : "Select all"}
                </button>
              </div>
              {unconfirmedMust.map((r) => {
                const st = getStatus(r.req_id);
                if (st === "dismissed") return null;
                return (
                  <div key={r.req_id} className={`mp-item${st === "approved" ? " approved" : ""}`}>
                    <div className="mp-item-content">
                      <div className="mp-item-title">{r.req_id}: {r.title}</div>
                      <div className="mp-item-meta">~2 min · {r.priority} priority · {r.status}</div>
                    </div>
                    <ItemActions id={r.req_id} />
                  </div>
                );
              })}
            </div>
          )}

          {openGaps.length > 0 && (
            <div className="mp-section">
              <div className="mp-section-head">
                <div className="mp-section-icon amber">?</div>
                <div className="mp-section-title">Open Questions ({openGaps.filter((g) => getStatus(g.id) !== "dismissed").length})</div>
                <button type="button" className="mp-select-all" onClick={() => selectAllInSection(openGaps.map((g) => g.id))}>
                  {openGaps.every((g) => getStatus(g.id) === "approved") ? "Deselect all" : "Select all"}
                </button>
              </div>
              {openGaps.map((g) => {
                const st = getStatus(g.id);
                if (st === "dismissed") return null;
                return (
                  <div key={g.id} className={`mp-item${st === "approved" ? " approved" : ""}`}>
                    <div className="mp-item-content">
                      <div className="mp-item-title">{g.question?.slice(0, 80)}</div>
                      <div className="mp-item-meta">~{g.severity === "high" ? 5 : 3} min · {g.severity} severity{g.blocked_reqs?.length ? ` · blocks ${g.blocked_reqs.join(", ")}` : ""}</div>
                    </div>
                    <ItemActions id={g.id} />
                  </div>
                );
              })}
            </div>
          )}

          <div className="mp-section">
            <div className="mp-section-head">
              <div className="mp-section-icon purple">+</div>
              <div className="mp-section-title">Custom Topics ({customTopics.length})</div>
            </div>
            {customTopics.map((t, i) => (
              <div key={i} className="mp-item custom">
                <div className="mp-item-content">
                  <div className="mp-item-title">{t}</div>
                  <div className="mp-item-meta">~5 min</div>
                </div>
                <button
                  type="button"
                  className="mp-act-btn dismiss on"
                  onClick={() => setCustomTopics((prev) => prev.filter((_, j) => j !== i))}
                >✕</button>
              </div>
            ))}
            <div className="mp-custom-input">
              <input
                value={customTopic}
                onChange={(e) => setCustomTopic(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") addCustomTopic(); }}
                placeholder="Add a topic..."
              />
              <button type="button" className="mp-custom-add" onClick={addCustomTopic} disabled={!customTopic.trim()}>
                Add
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}


function _renderMeetingMd(md: string): string {
  let html = md;

  html = html.replace(/^### (.+)$/gm, '<h4 class="chat-h4">$1</h4>');
  html = html.replace(/^## (.+)$/gm, '<h3 class="chat-h3" style="margin-top:14px">$1</h3>');
  html = html.replace(/^# (.+)$/gm, '<h2 class="chat-h2" style="font-size:17px;margin-bottom:6px">$1</h2>');

  html = html.replace(/^---$/gm, '<hr class="chat-hr">');

  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");

  html = html.replace(/((?:^- \[ \] .+$\n?)+)/gm, (block) => {
    const items = block.trim().split("\n").map((l: string) => l.replace(/^- \[ \] /, ""));
    return '<ul class="chat-ul" style="list-style:none;padding-left:12px">' +
      items.map((i: string) => `<li class="chat-li" style="display:flex;gap:6px;align-items:flex-start"><span style="color:var(--ink-4);flex-shrink:0">☐</span><span>${i}</span></li>`).join("") +
      "</ul>";
  });

  html = html.replace(/((?:^- .+$\n?)+)/gm, (block) => {
    const items = block.trim().split("\n").map((l: string) => l.replace(/^- /, ""));
    return '<ul class="chat-ul">' + items.map((i: string) => `<li class="chat-li">${i}</li>`).join("") + "</ul>";
  });

  html = html.replace(/((?:^\d+\. .+$\n?)+)/gm, (block) => {
    const items = block.trim().split("\n").map((l: string) => l.replace(/^\d+\. /, ""));
    return '<ol class="chat-ol">' + items.map((i: string) => `<li class="chat-oli">${i}</li>`).join("") + "</ol>";
  });

  html = html.replace(/\n\n/g, '<div class="chat-paragraph-break"></div>');
  html = html.replace(/\n/g, "<br>");

  return html;
}
