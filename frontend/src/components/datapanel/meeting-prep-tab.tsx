"use client";

// Meeting Prep tab — generate a meeting agenda from the current state,
// stream chat drafts, persist to vault + Gmail. Extracted from
// DataPanel.tsx; the tab owns all its own state so it lifts out cleanly.

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  getMeetingAgenda, saveMeetingAgenda, createNewAgenda, chatStream,
  listIntegrations,
} from "@/lib/api";
import type { ApiRequirement, ApiGap, ApiConstraint, ApiContradiction } from "@/lib/api";
import { EmptyState } from "./pills";


export function MeetingPrepTab({ projectId, contradictions, gaps, requirements, constraints, dashboard }: {
  projectId: string; contradictions: ApiContradiction[]; gaps: ApiGap[]; requirements: ApiRequirement[]; constraints: ApiConstraint[]; dashboard: any;
}) {
  const searchParams = useSearchParams();
  const requestedFile = searchParams.get("file");
  const [phase, setPhase] = useState<"pick" | "agenda">("pick");
  const [agenda, setAgenda] = useState("");
  const [activeFilename, setActiveFilename] = useState<string | null>(null);
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
  const [agendaHistory, setAgendaHistory] = useState<any[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  // Item selection state
  const [statuses, setStatuses] = useState<Record<string, "approved" | "dismissed">>({});
  function approve(id: string) {
    setStatuses((s) => ({ ...s, [id]: s[id] === "approved" ? undefined as any : "approved" }));
  }
  function dismiss(id: string) {
    setStatuses((s) => ({ ...s, [id]: s[id] === "dismissed" ? undefined as any : "dismissed" }));
  }

  // Cross-component event: when a user clicks "Add to Meeting" from a
  // gap (or other) detail elsewhere in the app, auto-approve the item
  // here so they land on the picker with it already selected.
  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ type: string; id: string }>;
      const id = ce.detail?.id;
      if (!id) return;
      setStatuses((s) => ({ ...s, [id]: "approved" }));
      setPhase("pick"); // make sure we're on the picker, not the agenda
    };
    window.addEventListener("add-to-meeting", handler);
    return () => window.removeEventListener("add-to-meeting", handler);
  }, []);
  function selectAllInSection(ids: string[]) {
    const allApproved = ids.every((id) => statuses[id] === "approved");
    setStatuses((s) => {
      const next = { ...s };
      ids.forEach((id) => { next[id] = allApproved ? undefined as any : "approved"; });
      return next;
    });
  }
  const getStatus = (id: string) => statuses[id];

  // Derived data
  const openGaps = gaps.filter((g) => g.status === "open");
  const highGaps = openGaps.filter((g: any) => g.severity === "high");
  const unconfirmedMust = requirements.filter((r: any) => r.status !== "confirmed" && (r.priority === "must" || r.priority === "should"));

  const approvedItems = [
    ...openGaps.filter((g: any) => getStatus(g.id) === "approved"),
    ...unconfirmedMust.filter((r: any) => getStatus(r.req_id) === "approved"),
    ...contradictions.filter((c: any) => getStatus(c.id) === "approved"),
  ];
  const approvedCount = approvedItems.length + customTopics.length;

  // Time estimation
  const estimatedMin =
    contradictions.filter((c: any) => getStatus(c.id) === "approved").length * 10
    + openGaps.filter((g: any) => getStatus(g.id) === "approved" && g.severity === "high").length * 5
    + openGaps.filter((g: any) => getStatus(g.id) === "approved" && g.severity !== "high").length * 3
    + unconfirmedMust.filter((r: any) => getStatus(r.req_id) === "approved").length * 2
    + customTopics.length * 5;

  // Check Gmail connection for "Draft in Gmail" button
  useEffect(() => {
    listIntegrations(projectId)
      .then((d) => setGmailConnected((d.integrations || []).some((i: any) => i.connector_id === "gmail" && i.status === "active")))
      .catch(() => {});
  }, [projectId]);

  // Load saved agenda + history on mount (and whenever the user deep-links
  // to a specific file via ?file=..., e.g. from a reminder lifecycle card).
  useEffect(() => {
    (async () => {
      // Load history
      try {
        const { listMeetingAgendas } = await import("@/lib/api");
        const hist = await listMeetingAgendas(projectId);
        setAgendaHistory(hist.agendas || []);
      } catch {}
      // Load the requested file if present; otherwise fall back to latest.
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

  // Listen for chat response completion — the agent writes the agenda
  // to a .md file in the vault. Read it via the dedicated endpoint.
  useEffect(() => {
    if (!generating) return;
    function handleChatDone() {
      // Wait briefly for file writes to flush, then read the file
      setTimeout(async () => {
        try {
          const { getMeetingAgendaFromVault } = await import("@/lib/api");
          const vault = await getMeetingAgendaFromVault(projectId);
          if (vault.content) {
            setAgenda(vault.content);
            setPhase("agenda");
            // Also persist to DB
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
    // Build a clean, readable chat message from selected items
    const selectedGaps = openGaps.filter((g: any) => getStatus(g.id) === "approved");
    const selectedReqs = unconfirmedMust.filter((r: any) => getStatus(r.req_id) === "approved");
    const selectedContras = contradictions.filter((c: any) => getStatus(c.id) === "approved");
    const dismissedItems = [
      ...openGaps.filter((g: any) => getStatus(g.id) === "dismissed").map((g: any) => g.question?.slice(0, 60)),
      ...unconfirmedMust.filter((r: any) => getStatus(r.req_id) === "dismissed").map((r: any) => r.title?.slice(0, 60)),
    ].filter(Boolean);

    const readiness = dashboard?.readiness?.score || 0;

    let message = `Prepare meeting agenda · **${approvedCount} items** · est. ${estimatedMin} min · readiness ${readiness}%\n\n`;

    if (selectedContras.length > 0) {
      message += `**Decisions (${selectedContras.length})**\n`;
      selectedContras.forEach((c: any) => { message += `- ${c.explanation?.slice(0, 80)}\n`; });
      message += `\n`;
    }
    if (selectedReqs.length > 0) {
      message += `**Confirm (${selectedReqs.length})**\n`;
      selectedReqs.forEach((r: any) => { message += `- ${r.title}\n`; });
      message += `\n`;
    }
    if (selectedGaps.length > 0) {
      message += `**Questions (${selectedGaps.length})**\n`;
      selectedGaps.forEach((g: any) => { message += `- ${g.question?.slice(0, 80)}\n`; });
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
    // Dispatch to ChatPanel
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
        // Keep the link visible — don't auto-hide when we have a URL
      } else {
        setTimeout(() => setDraftSent(false), 3000);
      }
    } catch (e: any) {
      alert(e.message || "Failed to create Gmail draft");
    }
    setDraftingEmail(false);
  }

  function handleCopy() {
    navigator.clipboard.writeText(agenda);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleCopyAsEmail() {
    // Wrap the agenda in a professional email template
    const projectName = dashboard?.project_name || "the project";
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
      <div style={{ display: "flex", gap: 4, marginLeft: "auto", flexShrink: 0 }}>
        <button title={st === "approved" ? "Remove from agenda" : "Add to agenda"} onClick={(e) => { e.stopPropagation(); approve(id); }}
          style={{ width: 26, height: 26, borderRadius: 6, border: "none", background: st === "approved" ? "#d1fae5" : "var(--gray-100)", color: st === "approved" ? "#059669" : "var(--gray-400)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>
          ✓
        </button>
        <button title={st === "dismissed" ? "Restore" : "Dismiss"} onClick={(e) => { e.stopPropagation(); dismiss(id); }}
          style={{ width: 26, height: 26, borderRadius: 6, border: "none", background: st === "dismissed" ? "#fee2e2" : "var(--gray-100)", color: st === "dismissed" ? "#EF4444" : "var(--gray-400)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12 }}>
          ✕
        </button>
      </div>
    );
  }

  // ── PHASE 2: Agenda viewer/editor ──
  if (phase === "agenda" && agenda) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--dark)" }}>
              Meeting Agenda {roundNumber > 0 && <span style={{ fontSize: 11, color: "var(--gray-500)" }}>· Round {roundNumber}</span>}
            </div>
          </div>
          <button onClick={() => { setPhase("pick"); }} style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid var(--gray-200)", background: "#fff", fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "var(--font)", color: "var(--gray-600)" }}>
            ← Back to items
          </button>
          {!editMode && (
            <>
              <button onClick={handleCopyAsEmail} style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid var(--gray-200)", background: "#fff", fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "var(--font)", color: "var(--gray-600)" }}>
                {copiedEmail ? "✓ Copied!" : "Copy as Email"}
              </button>
              {gmailConnected && (
                draftSent && draftUrl ? (
                  <a href={draftUrl} target="_blank" rel="noopener noreferrer" style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid #059669", background: "#ecfdf5", fontSize: 11, fontWeight: 600, fontFamily: "var(--font)", color: "#059669", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4 }}>
                    ✓ Open draft in Gmail →
                  </a>
                ) : (
                  <button onClick={handleDraftInGmail} disabled={draftingEmail} style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid var(--gray-200)", background: "#fff", fontSize: 11, fontWeight: 600, cursor: draftingEmail ? "default" : "pointer", fontFamily: "var(--font)", color: "var(--gray-600)", opacity: draftingEmail ? 0.6 : 1 }}>
                    {draftingEmail ? "Creating..." : "Draft in Gmail"}
                  </button>
                )
              )}
              <button onClick={handleDownload} style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid var(--gray-200)", background: "#fff", fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "var(--font)", color: "var(--gray-600)" }}>
                Download
              </button>
            </>
          )}
          <button onClick={() => { if (editMode) handleSave(); setEditMode(!editMode); }}
            style={{ padding: "6px 14px", borderRadius: 8, border: editMode ? "1px solid var(--green)" : "1px solid var(--gray-200)", background: editMode ? "var(--green-light)" : "#fff", fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "var(--font)", color: editMode ? "var(--green-hover)" : "var(--gray-600)" }}>
            {editMode ? (saving ? "Saving..." : saved ? "✓ Saved" : "Save & Preview") : "Edit"}
          </button>
        </div>
        {editMode ? (
          <textarea value={agenda} onChange={(e) => setAgenda(e.target.value)}
            style={{ width: "100%", minHeight: 500, padding: "16px 18px", borderRadius: 10, border: "1px solid var(--green-mid)", background: "#fff", fontSize: 13, lineHeight: 1.7, fontFamily: "monospace", resize: "vertical", outline: "none" }} />
        ) : (
          <div style={{ padding: "20px 24px", borderRadius: 10, border: "1px solid var(--gray-200)", background: "#fff", fontSize: 13, lineHeight: 1.7 }}
            className="chat-markdown-body"
            dangerouslySetInnerHTML={{ __html: _renderMeetingMd(agenda) }} />
        )}
      </div>
    );
  }

  // ── PHASE 1: Item picker ──
  const allItems = openGaps.length + unconfirmedMust.length + contradictions.length;

  return (
    <div className="mp-container">
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--dark)" }}>Prepare Meeting Agenda</div>
          <div style={{ fontSize: 11, color: "var(--gray-500)" }}>
            Select items to discuss · {approvedCount} selected · est. {estimatedMin} min
          </div>
        </div>
        {agenda && (
          <button onClick={() => setPhase("agenda")} style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid var(--gray-200)", background: "#fff", fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "var(--font)", color: "var(--gray-600)" }}>
            View Last Agenda →
          </button>
        )}
        <button onClick={handleGenerate} disabled={generating || approvedCount === 0}
          style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 18px", borderRadius: 8, border: "none", background: approvedCount === 0 ? "var(--gray-100)" : "var(--green)", color: approvedCount === 0 ? "var(--gray-400)" : "var(--dark)", fontSize: 12, fontWeight: 700, cursor: approvedCount === 0 ? "default" : "pointer", fontFamily: "var(--font)", boxShadow: approvedCount > 0 ? "0 1px 3px rgba(0,229,160,0.25)" : "none" }}>
          <svg viewBox="0 0 24 24" style={{ width: 13, height: 13, stroke: "currentColor", fill: "none", strokeWidth: 2.5 }}>
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
          </svg>
          {generating ? "Generating in chat..." : approvedCount > 0 ? `Generate Agenda · ${approvedCount} items` : "Select items first"}
        </button>
      </div>

      {generating && (
        <div style={{ padding: "12px 16px", borderRadius: 10, background: "var(--green-light)", border: "1px solid var(--green)", marginBottom: 12, fontSize: 12, color: "var(--dark)" }}>
          ✨ The agent is generating your agenda in the <strong>chat panel</strong> (left side). You can watch it work in real time. The agenda will appear here when it's done.
        </div>
      )}

      {/* Agenda history */}
      {agendaHistory.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <button
            onClick={() => setShowHistory(!showHistory)}
            style={{
              display: "flex", alignItems: "center", gap: 6, width: "100%",
              padding: "8px 12px", borderRadius: 8,
              border: "1px solid var(--gray-100)", background: "var(--gray-50)",
              fontSize: 12, fontWeight: 600, color: "var(--gray-600)",
              cursor: "pointer", fontFamily: "var(--font)",
            }}
          >
            <svg viewBox="0 0 24 24" style={{ width: 13, height: 13, stroke: "currentColor", fill: "none", strokeWidth: 2 }}>
              <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
            </svg>
            Past Agendas ({agendaHistory.length})
            <svg viewBox="0 0 24 24" style={{ width: 12, height: 12, stroke: "currentColor", fill: "none", strokeWidth: 2, marginLeft: "auto", transform: showHistory ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          {showHistory && (
            <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
              {agendaHistory.map((a: any) => (
                <button
                  key={a.id}
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
                  style={{
                    display: "flex", alignItems: "center", gap: 10,
                    padding: "8px 12px", borderRadius: 8,
                    border: "1px solid var(--gray-100)", background: "#fff",
                    cursor: "pointer", fontFamily: "var(--font)", textAlign: "left",
                    width: "100%",
                  }}
                >
                  <span style={{
                    width: 24, height: 24, borderRadius: 6, flexShrink: 0,
                    background: "var(--green-light)", color: "var(--green-hover)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 11, fontWeight: 800,
                  }}>
                    {a.round_number}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--dark)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      Round {a.round_number} {a.edited_at ? "(edited)" : ""}
                    </div>
                    <div style={{ fontSize: 10, color: "var(--gray-500)" }}>
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
          {/* Contradictions / Decisions */}
          {contradictions.length > 0 && (
            <div className="mp-section">
              <div className="mp-section-head" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div className="mp-section-icon" style={{ background: "#EF444420", color: "#EF4444" }}>!</div>
                <div className="mp-section-title" style={{ flex: 1 }}>Decisions Needed ({contradictions.filter((c: any) => getStatus(c.id) !== "dismissed").length})</div>
                <button onClick={() => selectAllInSection(contradictions.map((c: any) => c.id))} style={{ fontSize: 10, fontWeight: 600, color: "var(--gray-500)", background: "none", border: "none", cursor: "pointer", fontFamily: "var(--font)", padding: "2px 6px" }}>
                  {contradictions.every((c: any) => getStatus(c.id) === "approved") ? "Deselect all" : "Select all"}
                </button>
              </div>
              {contradictions.map((c: any) => {
                const st = getStatus(c.id);
                if (st === "dismissed") return null;
                return (
                  <div key={c.id} className="mp-item" style={{ border: "1px solid var(--gray-100)", borderLeftWidth: 3, borderLeftColor: st === "approved" ? "#059669" : "transparent", padding: "10px 12px", borderRadius: 8, marginBottom: 6, display: "flex", alignItems: "center", gap: 10, background: st === "approved" ? "#f0fdf4" : "#fff" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--dark)" }}>{c.explanation?.slice(0, 80)}</div>
                      <div style={{ fontSize: 11, color: "var(--gray-500)", marginTop: 2 }}>~10 min · affects {c.item_a_type || "requirement"}</div>
                    </div>
                    <ItemActions id={c.id} />
                  </div>
                );
              })}
            </div>
          )}

          {/* Unconfirmed requirements */}
          {unconfirmedMust.length > 0 && (
            <div className="mp-section">
              <div className="mp-section-head" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div className="mp-section-icon" style={{ background: "#3B82F620", color: "#3B82F6" }}>✓</div>
                <div className="mp-section-title" style={{ flex: 1 }}>Requirements to Confirm ({unconfirmedMust.filter((r: any) => getStatus(r.req_id) !== "dismissed").length})</div>
                <button onClick={() => selectAllInSection(unconfirmedMust.map((r: any) => r.req_id))} style={{ fontSize: 10, fontWeight: 600, color: "var(--gray-500)", background: "none", border: "none", cursor: "pointer", fontFamily: "var(--font)", padding: "2px 6px" }}>
                  {unconfirmedMust.every((r: any) => getStatus(r.req_id) === "approved") ? "Deselect all" : "Select all"}
                </button>
              </div>
              {unconfirmedMust.map((r: any) => {
                const st = getStatus(r.req_id);
                if (st === "dismissed") return null;
                return (
                  <div key={r.req_id} className="mp-item" style={{ border: "1px solid var(--gray-100)", borderLeftWidth: 3, borderLeftColor: st === "approved" ? "#059669" : "transparent", padding: "10px 12px", borderRadius: 8, marginBottom: 6, display: "flex", alignItems: "center", gap: 10, background: st === "approved" ? "#f0fdf4" : "#fff" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--dark)" }}>{r.req_id}: {r.title}</div>
                      <div style={{ fontSize: 11, color: "var(--gray-500)", marginTop: 2 }}>~2 min · {r.priority} priority · {r.status}</div>
                    </div>
                    <ItemActions id={r.req_id} />
                  </div>
                );
              })}
            </div>
          )}

          {/* Open gaps */}
          {openGaps.length > 0 && (
            <div className="mp-section">
              <div className="mp-section-head" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div className="mp-section-icon" style={{ background: "#F59E0B20", color: "#F59E0B" }}>?</div>
                <div className="mp-section-title" style={{ flex: 1 }}>Open Questions ({openGaps.filter((g: any) => getStatus(g.id) !== "dismissed").length})</div>
                <button onClick={() => selectAllInSection(openGaps.map((g: any) => g.id))} style={{ fontSize: 10, fontWeight: 600, color: "var(--gray-500)", background: "none", border: "none", cursor: "pointer", fontFamily: "var(--font)", padding: "2px 6px" }}>
                  {openGaps.every((g: any) => getStatus(g.id) === "approved") ? "Deselect all" : "Select all"}
                </button>
              </div>
              {openGaps.map((g: any) => {
                const st = getStatus(g.id);
                if (st === "dismissed") return null;
                return (
                  <div key={g.id} className="mp-item" style={{ border: "1px solid var(--gray-100)", borderLeftWidth: 3, borderLeftColor: st === "approved" ? "#059669" : "transparent", padding: "10px 12px", borderRadius: 8, marginBottom: 6, display: "flex", alignItems: "center", gap: 10, background: st === "approved" ? "#f0fdf4" : "#fff" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--dark)" }}>{g.question?.slice(0, 80)}</div>
                      <div style={{ fontSize: 11, color: "var(--gray-500)", marginTop: 2 }}>~{g.severity === "high" ? 5 : 3} min · {g.severity} severity{g.blocked_reqs?.length ? ` · blocks ${g.blocked_reqs.join(", ")}` : ""}</div>
                    </div>
                    <ItemActions id={g.id} />
                  </div>
                );
              })}
            </div>
          )}

          {/* Custom topics */}
          <div className="mp-section">
            <div className="mp-section-head">
              <div className="mp-section-icon" style={{ background: "#8B5CF620", color: "#8B5CF6" }}>+</div>
              <div className="mp-section-title">Custom Topics ({customTopics.length})</div>
            </div>
            {customTopics.map((t, i) => (
              <div key={i} className="mp-item" style={{ borderLeft: "3px solid #8B5CF6" }}>
                <div className="mp-item-content">
                  <div className="mp-item-title">{t}</div>
                  <div className="mp-item-meta">~5 min</div>
                </div>
                <button onClick={() => setCustomTopics((prev) => prev.filter((_, j) => j !== i))}
                  style={{ width: 26, height: 26, borderRadius: 6, border: "none", background: "var(--gray-100)", color: "var(--gray-400)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12 }}>
                  ✕
                </button>
              </div>
            ))}
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <input value={customTopic} onChange={(e) => setCustomTopic(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") addCustomTopic(); }}
                placeholder="Add a topic..."
                style={{ flex: 1, padding: "7px 12px", borderRadius: 8, border: "1px solid var(--gray-200)", fontSize: 12, fontFamily: "var(--font)", outline: "none" }} />
              <button onClick={addCustomTopic} disabled={!customTopic.trim()}
                style={{ padding: "7px 14px", borderRadius: 8, border: "none", background: customTopic.trim() ? "var(--purple-light, #f3e8ff)" : "var(--gray-100)", color: customTopic.trim() ? "#7c3aed" : "var(--gray-400)", fontSize: 11, fontWeight: 600, cursor: customTopic.trim() ? "pointer" : "default", fontFamily: "var(--font)" }}>
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
  // Use the same CSS classes as renderChatMarkdown in ChatPanel
  // so the agenda preview matches the chat's typography exactly.
  let html = md;

  // Headings — chat classes + slightly larger h1 for agenda title
  html = html.replace(/^### (.+)$/gm, '<h4 class="chat-h4">$1</h4>');
  html = html.replace(/^## (.+)$/gm, '<h3 class="chat-h3" style="margin-top:14px">$1</h3>');
  html = html.replace(/^# (.+)$/gm, '<h2 class="chat-h2" style="font-size:17px;margin-bottom:6px">$1</h2>');

  // Horizontal rules
  html = html.replace(/^---$/gm, '<hr class="chat-hr">');

  // Bold + italic
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");

  // Checkboxes — collect consecutive, use chat-ul with checkbox prefix
  html = html.replace(/((?:^- \[ \] .+$\n?)+)/gm, (block) => {
    const items = block.trim().split("\n").map((l: string) => l.replace(/^- \[ \] /, ""));
    return '<ul class="chat-ul" style="list-style:none;padding-left:12px">' +
      items.map((i: string) => `<li class="chat-li" style="display:flex;gap:6px;align-items:flex-start"><span style="color:var(--gray-300);flex-shrink:0">☐</span><span>${i}</span></li>`).join("") +
      "</ul>";
  });

  // Unordered lists — collect consecutive lines
  html = html.replace(/((?:^- .+$\n?)+)/gm, (block) => {
    const items = block.trim().split("\n").map((l: string) => l.replace(/^- /, ""));
    return '<ul class="chat-ul">' + items.map((i: string) => `<li class="chat-li">${i}</li>`).join("") + "</ul>";
  });

  // Ordered lists — collect consecutive lines
  html = html.replace(/((?:^\d+\. .+$\n?)+)/gm, (block) => {
    const items = block.trim().split("\n").map((l: string) => l.replace(/^\d+\. /, ""));
    return '<ol class="chat-ol">' + items.map((i: string) => `<li class="chat-oli">${i}</li>`).join("") + "</ol>";
  });

  // Paragraphs + line breaks
  html = html.replace(/\n\n/g, '<div class="chat-paragraph-break"></div>');
  html = html.replace(/\n/g, "<br>");

  return html;
}


