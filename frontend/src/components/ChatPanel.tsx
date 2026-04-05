"use client";

import { useEffect, useRef, useState } from "react";
import { chatStream, getConversation, clearConversation } from "@/lib/api";

interface Message {
  role: "user" | "assistant";
  content: string;
  time?: string;
  toolCalls?: string[];
  thinkingCount?: number;
  activityLog?: { type: string; content?: string; tool?: string }[];
  stats?: { numTurns?: number; durationMs?: number };
}

interface ActiveStatus {
  phase: "idle" | "thinking" | "tool" | "writing" | "retry";
  detail?: string;
  toolType?: string;
  retryInfo?: string;
  thinkingCount: number;
  toolCount: number;
  startTime: number;
}

const WORKFLOWS = [
  {
    label: "Generate Handoff Docs",
    desc: "Discovery Brief, Scope Freeze, Requirements",
    prompt: "Run the discovery-docs-agent to generate all handoff documents.",
    icon: <><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></>,
  },
  {
    label: "Gap Analysis",
    desc: "Find missing requirements and blocking gaps",
    prompt: "Run the discovery-gap-agent to analyze all control points and identify gaps.",
    icon: <><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></>,
  },
  {
    label: "Meeting Prep",
    desc: "Prepare agenda for next client meeting",
    prompt: "Run the discovery-prep-agent to prepare the next client meeting agenda.",
    icon: <><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></>,
  },
  {
    label: "Readiness Report",
    desc: "Full readiness score with breakdown",
    prompt: "Get the current readiness score and give me a detailed breakdown of each area. What's covered, what's partial, and what's missing?",
    icon: <><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></>,
  },
];

interface ChatPanelProps {
  projectId: string;
  onDataChanged?: () => void;
}

export default function ChatPanel({ projectId, onDataChanged }: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [showWorkflows, setShowWorkflows] = useState(false);
  const [status, setStatus] = useState<ActiveStatus>({
    phase: "idle", thinkingCount: 0, toolCount: 0, startTime: 0,
  });
  const [lastStats, setLastStats] = useState<{ numTurns?: number; durationMs?: number } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Load conversation history on mount
  useEffect(() => {
    getConversation(projectId)
      .then((data) => {
        if (data.messages?.length > 0) {
          setMessages(data.messages.map((m: any) => ({
            role: m.role,
            content: m.content,
            toolCalls: m.toolCalls || [],
            thinkingCount: m.thinkingCount || 0,
            activityLog: m.activityLog || [],
            stats: m.stats,
            time: m.timestamp ? formatTimestamp(m.timestamp) : undefined,
          })));
          // Load last stats from most recent assistant message
          const lastAssistant = [...data.messages].reverse().find((m: any) => m.role === "assistant");
          if (lastAssistant?.stats) setLastStats(lastAssistant.stats);
        }
      })
      .catch(() => {});
  }, [projectId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault();
    if (!input.trim() || isStreaming) return;
    sendMessage(input.trim());
  }

  function sendMessage(text: string) {
    setInput("");
    const now = new Date();
    const time = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    setMessages((prev) => [...prev, { role: "user", content: text, time }]);
    setIsStreaming(true);
    setStatus({ phase: "thinking", thinkingCount: 0, toolCount: 0, startTime: Date.now() });

    let assistantContent = "";
    let toolCalls: string[] = [];
    let thinkingCount = 0;
    setMessages((prev) => [...prev, { role: "assistant", content: "", time, toolCalls: [] }]);

    chatStream(
      projectId,
      text,
      // onText
      (chunk) => {
        assistantContent += chunk;
        setStatus((s) => ({ ...s, phase: "writing", detail: undefined }));
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = { role: "assistant", content: assistantContent, time, toolCalls, thinkingCount };
          return updated;
        });
      },
      // onDone
      (stats) => {
        setIsStreaming(false);
        setStatus({ phase: "idle", thinkingCount: 0, toolCount: 0, startTime: 0 });
        if (stats) setLastStats(stats);
        // Refresh data panel if write tools were called
        if (toolCalls.some(t => t.includes("update") || t.includes("validate") || t.includes("resolve") || t.includes("Edit") || t.includes("Write"))) {
          onDataChanged?.();
        }
      },
      // onError
      (error) => {
        if (error.includes("Rate limit")) return;
        assistantContent += `\n\n[Error: ${error}]`;
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = { role: "assistant", content: assistantContent, time, toolCalls, thinkingCount };
          return updated;
        });
        setIsStreaming(false);
        setStatus({ phase: "idle", thinkingCount: 0, toolCount: 0, startTime: 0 });
      },
      // onTool
      (tool, toolType) => {
        toolCalls.push(tool);
        setStatus((s) => ({
          ...s,
          phase: "tool",
          detail: tool,
          toolType: toolType || "other",
          toolCount: s.toolCount + 1,
        }));
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = { role: "assistant", content: assistantContent, time, toolCalls: [...toolCalls], thinkingCount };
          return updated;
        });
      },
      // onThinking
      () => {
        thinkingCount++;
        setStatus((s) => ({
          ...s,
          phase: "thinking",
          detail: undefined,
          thinkingCount: s.thinkingCount + 1,
        }));
      },
      // onRetry
      (attempt, maxRetries) => {
        setStatus((s) => ({
          ...s,
          phase: "retry",
          retryInfo: `Retry ${attempt}/${maxRetries}`,
        }));
      },
    );
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  const suggestions = [
    "What are the gaps?",
    "Prepare meeting agenda",
    "Show readiness score",
    "Extract business requirements",
  ];

  return (
    <div className="chat-panel" style={{ flex: 1, width: "100%" }}>
      {/* Session header with status bar */}
      <div className="chat-session-header" style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 16px" }}>
        <div className="chat-session-icon" style={{ width: 28, height: 28, fontSize: 11 }}>AI</div>
        <div className="chat-session-title" style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>Discovery Chat</div>

        {/* Claude Code-style status bar */}
        <StatusBar status={status} lastStats={lastStats} isStreaming={isStreaming} />

        {messages.length > 0 && !isStreaming && (
          <button
            onClick={async () => {
              if (confirm("Clear conversation and start fresh?")) {
                await clearConversation(projectId);
                setMessages([]);
              }
            }}
            title="Clear conversation"
            style={{
              background: "none", border: "1px solid var(--gray-200)", borderRadius: 6,
              padding: "4px 8px", cursor: "pointer", fontSize: 11, color: "var(--gray-400)",
              fontFamily: "var(--font)", display: "flex", alignItems: "center", gap: 4,
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14"/></svg>
            Clear
          </button>
        )}
      </div>

      {/* Messages */}
      <div className="chat-messages" id="chatMessages">
        {messages.length === 0 && (
          <div style={{ textAlign: "center", padding: "60px 20px" }}>
            <div style={{ fontSize: 40, marginBottom: 16 }}>&#128269;</div>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Discovery AI Assistant</div>
            <div style={{ fontSize: 13, color: "var(--gray-500)", maxWidth: 360, margin: "0 auto 20px" }}>
              Upload client documents and ask about requirements, gaps, meeting prep, or generate handoff docs.
            </div>
            <div className="msg-suggestions" style={{ justifyContent: "center" }}>
              {suggestions.map((s) => (
                <button key={s} className="msg-suggestion" onClick={() => sendMessage(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`chat-msg ${msg.role === "user" ? "user" : "ai"}`}>
            <div className={`msg-avatar ${msg.role === "user" ? "user-avatar" : "ai-avatar"}`}>
              {msg.role === "user" ? "BT" : "AI"}
            </div>
            <div className="msg-body">
              <div className="msg-sender">
                {msg.role === "user" ? "You" : "Discovery Assistant"}
                {msg.role === "assistant" && msg.thinkingCount ? (
                  <span style={{
                    fontSize: 9, fontWeight: 600, padding: "1px 7px",
                    borderRadius: 8, background: "#f3e8ff", color: "#7c3aed",
                    marginLeft: 2,
                  }}>
                    {msg.thinkingCount} thinking
                  </span>
                ) : null}
              </div>
              <div className="msg-bubble">
                {/* Tool activity panel */}
                {msg.role === "assistant" && msg.toolCalls && msg.toolCalls.length > 0 && (
                  <ActivityPanel
                    tools={msg.toolCalls}
                    isLive={isStreaming && i === messages.length - 1}
                    currentTool={isStreaming && i === messages.length - 1 ? status.detail : undefined}
                    thinkingCount={msg.thinkingCount}
                    activityLog={msg.activityLog}
                  />
                )}
                {/* Message content */}
                {msg.content ? (
                  msg.role === "assistant" ? (
                    <div dangerouslySetInnerHTML={{ __html: renderChatMarkdown(msg.content) }} />
                  ) : (
                    msg.content
                  )
                ) : (isStreaming && i === messages.length - 1 ? (
                  <ActiveIndicator status={status} />
                ) : "")}
              </div>
              {msg.time && <div className="msg-time">{msg.time}</div>}
            </div>
          </div>
        ))}

        {/* Suggestions after AI response */}
        {messages.length > 0 && !isStreaming && messages[messages.length - 1]?.role === "assistant" && (
          <div className="msg-suggestions">
            {suggestions.map((s) => (
              <button key={s} className="msg-suggestion" onClick={() => sendMessage(s)}>
                {s}
              </button>
            ))}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="chat-input-area" style={{ position: "relative" }}>
        {/* Workflow popup */}
        {showWorkflows && (
          <div style={{
            position: "absolute", bottom: "calc(100% + 4px)", left: 0, width: 300,
            background: "var(--white)", border: "1px solid var(--gray-200)",
            borderRadius: "var(--radius)", boxShadow: "0 8px 32px rgba(0,0,0,0.12)",
            zIndex: 50, overflow: "hidden",
          }}>
            <div style={{ padding: "12px 16px 8px", borderBottom: "1px solid var(--gray-100)" }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.8px", color: "var(--gray-400)" }}>
                Workflows
              </div>
            </div>
            <div style={{ padding: 6 }}>
              {WORKFLOWS.map((wf) => (
                <div
                  key={wf.label}
                  onClick={() => { setShowWorkflows(false); sendMessage(wf.prompt); }}
                  style={{
                    display: "flex", alignItems: "center", gap: 12, padding: "10px 12px",
                    borderRadius: "var(--radius-sm)", cursor: "pointer", transition: "all 0.15s",
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = "var(--gray-50)"}
                  onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                >
                  <div style={{
                    width: 32, height: 32, borderRadius: "var(--radius-sm)",
                    border: "1px solid var(--gray-200)", background: "var(--gray-50)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    color: "var(--gray-500)", flexShrink: 0,
                  }}>
                    <svg viewBox="0 0 24 24" style={{ width: 16, height: 16, stroke: "currentColor", fill: "none", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" }}>
                      {wf.icon}
                    </svg>
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--dark)" }}>{wf.label}</div>
                    <div style={{ fontSize: 11, color: "var(--gray-400)", marginTop: 1 }}>{wf.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="chat-input-box">
          <button
            onClick={() => setShowWorkflows(!showWorkflows)}
            disabled={isStreaming}
            style={{
              width: 34, height: 34, borderRadius: "var(--radius-sm)",
              border: "1px solid var(--gray-200)", background: showWorkflows ? "var(--green-light)" : "var(--white)",
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer", transition: "all 0.2s", flexShrink: 0, margin: "3px 4px",
              color: showWorkflows ? "var(--green)" : "var(--gray-500)",
              transform: showWorkflows ? "rotate(45deg)" : "none",
            }}
          >
            <svg viewBox="0 0 24 24" style={{ width: 18, height: 18, stroke: "currentColor", fill: "none", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" }}>
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
          <textarea
            ref={textareaRef}
            rows={1}
            placeholder="Ask about requirements, gaps, readiness..."
            value={input}
            onChange={(e) => { setInput(e.target.value); if (showWorkflows) setShowWorkflows(false); }}
            onKeyDown={handleKeyDown}
            disabled={isStreaming}
          />
          <button
            className="send-btn"
            onClick={() => handleSubmit()}
            disabled={isStreaming || !input.trim()}
          >
            <svg viewBox="0 0 24 24">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>
        <div className="chat-hint">
          Type <strong>/</strong> for workflows
        </div>
      </div>
    </div>
  );
}


/* ── Claude Code-style Status Bar ── */

function StatusBar({ status, lastStats, isStreaming }: {
  status: ActiveStatus;
  lastStats: { numTurns?: number; durationMs?: number } | null;
  isStreaming: boolean;
}) {
  const elapsed = isStreaming && status.startTime
    ? Math.floor((Date.now() - status.startTime) / 1000)
    : 0;

  // Update elapsed time every second while streaming
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!isStreaming) return;
    const timer = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(timer);
  }, [isStreaming]);

  const barStyle: React.CSSProperties = {
    display: "flex", alignItems: "center", gap: 6, fontSize: 11,
    fontFamily: "monospace", color: "var(--gray-500)",
  };

  const pillStyle = (bg: string, fg: string): React.CSSProperties => ({
    display: "inline-flex", alignItems: "center", gap: 4,
    padding: "2px 8px", borderRadius: 10,
    background: bg, color: fg, fontSize: 10, fontWeight: 600,
    whiteSpace: "nowrap",
  });

  const dotStyle = (color: string, animate = false): React.CSSProperties => ({
    width: 5, height: 5, borderRadius: "50%", background: color, flexShrink: 0,
    animation: animate ? "pulse 1.5s infinite" : "none",
  });

  if (isStreaming) {
    return (
      <div style={barStyle}>
        {/* Active phase indicator */}
        {status.phase === "thinking" && (
          <span style={pillStyle("var(--purple-light, #f3e8ff)", "#7c3aed")}>
            <span style={dotStyle("#7c3aed", true)} />
            Thinking{status.thinkingCount > 1 ? ` (${status.thinkingCount})` : ""}
          </span>
        )}
        {status.phase === "tool" && (
          <span style={pillStyle(
            status.toolType === "mcp" ? "var(--blue-light, #dbeafe)" :
            status.toolType === "read" ? "var(--gray-100, #f3f4f6)" :
            status.toolType === "write" ? "var(--orange-light, #fff7ed)" :
            "var(--gray-100)",
            status.toolType === "mcp" ? "#2563eb" :
            status.toolType === "read" ? "#6b7280" :
            status.toolType === "write" ? "#ea580c" :
            "#6b7280"
          )}>
            <span style={dotStyle(
              status.toolType === "mcp" ? "#2563eb" :
              status.toolType === "write" ? "#ea580c" : "#6b7280", true
            )} />
            {status.detail || "Tool"}
          </span>
        )}
        {status.phase === "writing" && (
          <span style={pillStyle("var(--green-light, #d1fae5)", "#059669")}>
            <span style={dotStyle("#059669", true)} />
            Writing
          </span>
        )}
        {status.phase === "retry" && (
          <span style={pillStyle("#fef3c7", "#d97706")}>
            <span style={dotStyle("#d97706", true)} />
            {status.retryInfo || "Retrying"}
          </span>
        )}

        {/* Counters */}
        {status.toolCount > 0 && (
          <span style={{ color: "var(--gray-400)" }}>
            {status.toolCount} tool{status.toolCount !== 1 ? "s" : ""}
          </span>
        )}

        {/* Elapsed time */}
        <span style={{ color: "var(--gray-400)" }}>
          {formatElapsed(elapsed)}
        </span>
      </div>
    );
  }

  // Idle state — show last session stats
  if (lastStats?.numTurns) {
    return (
      <div style={barStyle}>
        <span style={pillStyle("var(--green-light, #d1fae5)", "#059669")}>
          <span style={dotStyle("#059669")} />
          Ready
        </span>
        <span style={{ color: "var(--gray-400)" }}>
          {lastStats.numTurns} turn{lastStats.numTurns !== 1 ? "s" : ""}
          {lastStats.durationMs ? ` / ${(lastStats.durationMs / 1000).toFixed(1)}s` : ""}
        </span>
      </div>
    );
  }

  return (
    <div style={barStyle}>
      <span style={pillStyle("var(--green-light, #d1fae5)", "#059669")}>
        <span style={dotStyle("#059669")} />
        Ready
      </span>
    </div>
  );
}


/* ── Activity Panel (Claude Code-style tool timeline) ── */

function ActivityPanel({ tools, isLive, currentTool, thinkingCount, activityLog }: {
  tools: string[];
  isLive: boolean;
  currentTool?: string;
  thinkingCount?: number;
  activityLog?: { type: string; content?: string; tool?: string }[];
}) {
  const [expanded, setExpanded] = useState(false);

  // Group tools by type for summary
  const groups = groupTools(tools);
  const hasAgent = tools.some(t => t === "Agent" || t.startsWith("Agent"));

  // Last meaningful entry for collapsed view
  const logEntries = activityLog || [];
  const lastEntry = logEntries.length > 0 ? logEntries[logEntries.length - 1] : null;

  return (
    <div className="activity-panel">
      {/* Summary bar — always visible */}
      <div className="activity-summary" onClick={() => setExpanded(!expanded)}>
        <div className="activity-summary-left">
          <span className="activity-count">{tools.length} action{tools.length !== 1 ? "s" : ""}</span>
          {Object.entries(groups).map(([type, count]) => (
            <span key={type} className={`activity-type-chip ${type}`}>
              {count} {type}
            </span>
          ))}
          {thinkingCount ? (
            <span className="activity-type-chip thinking">{thinkingCount} thinking</span>
          ) : null}
          {/* Last action preview when collapsed */}
          {!expanded && lastEntry && (
            <span style={{ fontSize: 10, color: lastEntry.type === "error" ? "#EF4444" : "var(--gray-500)", marginLeft: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 200 }}>
              {lastEntry.type === "tool" ? lastEntry.tool : lastEntry.content?.slice(0, 50)}
            </span>
          )}
        </div>
        <button className="activity-expand-btn">
          {expanded ? "Hide" : "Show"}
          <svg viewBox="0 0 24 24" style={{ width: 10, height: 10, stroke: "currentColor", fill: "none", strokeWidth: 2.5, transform: expanded ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </button>
      </div>

      {/* Expanded activity log (text + tools interleaved) */}
      {expanded && (activityLog && activityLog.length > 0 ? (
        <div className="activity-list">
          {activityLog.map((entry, i) => (
            <div key={i} className={`activity-item ${entry.type === "tool" ? inferToolType(entry.tool || "") : entry.type}`}>
              <div className={`activity-dot ${entry.type === "tool" ? inferToolType(entry.tool || "") : entry.type === "error" ? "mcp" : entry.type === "thinking" ? "agent" : ""}`} />
              <span className="activity-label" style={{
                color: entry.type === "error" ? "#EF4444" : entry.type === "text" ? "var(--gray-600)" : undefined,
                fontStyle: entry.type === "text" ? "normal" : undefined,
                fontSize: entry.type === "text" ? 10 : undefined,
              }}>
                {entry.type === "tool" ? entry.tool : entry.type === "thinking" ? "Thinking..." : entry.type === "error" ? `Error: ${entry.content}` : entry.content}
              </span>
            </div>
          ))}
        </div>
      ) : tools.length > 0 ? (
        <div className="activity-list">
          {tools.map((tool, i) => {
            const type = inferToolType(tool);
            const isCurrent = isLive && tool === currentTool;
            const isLast = isLive && i === tools.length - 1 && !currentTool;
            return (
              <div key={i} className={`activity-item ${type}${isCurrent || isLast ? " active" : ""}`}>
                <div className={`activity-dot ${type}${isCurrent || isLast ? " pulse" : ""}`} />
                <span className="activity-label">{tool}</span>
                {(isCurrent || isLast) && <span className="activity-running">running</span>}
              </div>
            );
          })}
          {isLive && (
            <div className="activity-item active" style={{ opacity: 0.5 }}>
              <div className="activity-dot pulse" />
              <span className="activity-label" style={{ fontStyle: "italic" }}>...</span>
            </div>
          )}
        </div>
      ) : null)}
    </div>
  );
}

function groupTools(tools: string[]): Record<string, number> {
  const groups: Record<string, number> = {};
  for (const tool of tools) {
    const type = inferToolType(tool);
    const label = type === "mcp" ? "mcp" : type === "read" ? "read" : type === "write" ? "write" : type === "bash" ? "bash" : "other";
    groups[label] = (groups[label] || 0) + 1;
  }
  return groups;
}

function inferToolType(tool: string): string {
  if (tool.startsWith("Read ") || tool.startsWith("Grep ") || tool.startsWith("Glob ")) return "read";
  if (tool.startsWith("Edit ") || tool.startsWith("Write ")) return "write";
  if (tool.startsWith("Bash")) return "bash";
  if (tool === "searching tools") return "search";
  if (tool === "Agent" || tool.startsWith("Agent")) return "agent";
  return "mcp";
}


/* ── Active Indicator (inside message bubble while streaming) ── */

function ActiveIndicator({ status }: { status: ActiveStatus }) {
  const phases: Record<string, { label: string; color: string }> = {
    thinking: { label: "Thinking...", color: "#7c3aed" },
    tool: { label: status.detail ? `Running ${status.detail}...` : "Running tool...", color: "#2563eb" },
    writing: { label: "Writing response...", color: "#059669" },
    retry: { label: status.retryInfo || "Retrying...", color: "#d97706" },
    idle: { label: "Thinking...", color: "var(--gray-400)" },
  };
  const p = phases[status.phase] || phases.idle;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, color: p.color }}>
      <span style={{ display: "inline-flex", gap: 3 }}>
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: p.color, animation: "pulse 1.5s infinite", animationDelay: "0s" }} />
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: p.color, animation: "pulse 1.5s infinite", animationDelay: "0.3s" }} />
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: p.color, animation: "pulse 1.5s infinite", animationDelay: "0.6s" }} />
      </span>
      <span style={{ fontSize: 12 }}>{p.label}</span>
    </div>
  );
}


/* ── Helpers ── */

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  // Same day: just time. Otherwise: date + time
  if (d.toDateString() === now.toDateString()) return time;
  const date = d.toLocaleDateString([], { month: "short", day: "numeric" });
  return `${date}, ${time}`;
}

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m${s.toString().padStart(2, "0")}s`;
}


function renderChatMarkdown(text: string): string {
  // Escape HTML
  let html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Code blocks (``` ... ```)
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_m, lang, code) => {
    return `\x00BLOCK<div class="chat-codeblock"><div class="chat-codeblock-header">${lang || "code"}</div><pre><code>${code.trimEnd()}</code></pre></div>BLOCK\x00`;
  });

  // Tables — detect consecutive lines starting with |
  html = html.replace(/((?:^\|.+\|[ ]*$\n?)+)/gm, (tableBlock) => {
    const rows = tableBlock.trim().split("\n").filter(r => r.trim());
    if (rows.length < 2) return tableBlock;

    const isSeparator = (r: string) => /^\|[\s\-:|]+\|$/.test(r) && r.includes("-");

    const parseRow = (row: string) =>
      row.split("|").slice(1, -1).map(c => c.trim());

    const headerRow = rows[0];
    const bodyRows = rows.filter((r, i) => i > 0 && !isSeparator(r));

    if (bodyRows.length === 0) return tableBlock;

    const headerCells = parseRow(headerRow);

    let table = '\x00BLOCK<div class="chat-table-wrap"><table class="chat-table"><thead><tr>';
    headerCells.forEach(c => { table += `<th>${renderInline(c)}</th>`; });
    table += "</tr></thead><tbody>";
    bodyRows.forEach(row => {
      const cells = parseRow(row);
      table += "<tr>";
      cells.forEach((c, ci) => {
        const content = renderInline(c);
        table += ci === 0 ? `<td class="chat-td-label">${content}</td>` : `<td>${content}</td>`;
      });
      table += "</tr>";
    });
    table += "</tbody></table></div>BLOCK\x00";
    return table;
  });

  // Headings
  html = html.replace(/^### (.+)$/gm, (_m, t) => `\x00BLOCK<h4 class="chat-h4">${renderInline(t)}</h4>BLOCK\x00`);
  html = html.replace(/^## (.+)$/gm, (_m, t) => `\x00BLOCK<h3 class="chat-h3">${renderInline(t)}</h3>BLOCK\x00`);
  html = html.replace(/^# (.+)$/gm, (_m, t) => `\x00BLOCK<h2 class="chat-h2">${renderInline(t)}</h2>BLOCK\x00`);

  // Horizontal rule
  html = html.replace(/^---$/gm, '\x00BLOCK<hr class="chat-hr">BLOCK\x00');

  // Unordered list items — collect consecutive
  html = html.replace(/((?:^- .+$\n?)+)/gm, (block) => {
    const items = block.trim().split("\n").map(l => l.replace(/^- /, ""));
    return '\x00BLOCK<ul class="chat-ul">' + items.map(i => `<li class="chat-li">${renderInline(i)}</li>`).join("") + "</ul>BLOCK\x00";
  });

  // Ordered list items — collect consecutive
  html = html.replace(/((?:^\d+\. .+$\n?)+)/gm, (block) => {
    const items = block.trim().split("\n").map(l => l.replace(/^\d+\. /, ""));
    return '\x00BLOCK<ol class="chat-ol">' + items.map(i => `<li class="chat-oli">${renderInline(i)}</li>`).join("") + "</ol>BLOCK\x00";
  });

  // Process text segments only — inline formatting + line breaks
  const parts = html.split(/\x00BLOCK|BLOCK\x00/);
  html = parts.map((part, i) => {
    if (i % 2 === 1) return part; // block element — already processed
    // Inline formatting on remaining text
    part = renderInline(part);
    // Line breaks
    return part
      .replace(/\n\n+/g, '<div class="chat-paragraph-break"></div>')
      .replace(/\n/g, "<br>");
  }).join("");

  return html;
}

function renderInline(text: string): string {
  const slots: string[] = [];
  const slot = (html: string) => { slots.push(html); return `\x01S${slots.length - 1}\x01`; };
  let t = text;

  const FS = 'style="padding:1px 6px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:4px;font-size:0.88em;font-family:monospace;color:#2563eb;cursor:pointer;text-decoration:none;display:inline-block"';
  const CS = 'style="padding:1px 5px;background:#f0fdf4;border:1px solid #dcfce7;border-radius:4px;font-size:0.88em;font-family:monospace;color:#16a34a"';
  const WS = 'style="color:#059669;font-weight:600;cursor:pointer;border-bottom:1px dashed #059669;text-decoration:none"';

  // File paths in backticks → slot
  t = t.replace(/`([^`]*\.(?:md|json|yaml|yml|txt|py|ts|tsx|js|sh))`/g, (_m, path) => {
    const name = path.split("/").pop() || path;
    return slot(`<a ${FS} data-file="${path}" title="${path}">📄 ${name}</a>`);
  });
  // Remaining backticks → slot
  t = t.replace(/`([^`]+)`/g, (_m, code) => slot(`<code ${CS}>${code}</code>`));
  // Directory paths → slot
  t = t.replace(/(?<!["a-zA-Z])(\.?[\w.-]+(?:\/[\w.-]+)+\/)/g, (_m, path) => slot(`<a ${FS} data-file="${path}" title="${path}">📁 ${path}</a>`));
  // Bare file paths → slot
  t = t.replace(/(?<!["\/a-zA-Z\x01])((?:[\w.-]+\/)+[\w.-]+\.(?:md|json|yaml|yml|txt|py|ts|tsx|js|sh))(?![a-zA-Z])/g, (_m, path) => {
    const name = path.split("/").pop() || path;
    return slot(`<a ${FS} data-file="${path}" title="${path}">📄 ${name}</a>`);
  });
  // Wikilinks
  t = t.replace(/\[\[([^\]]+)\]\]/g, (_m, target) => slot(`<a ${WS} data-wiki="${target}">${target}</a>`));
  // Bold / italic
  t = t.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/\*(.+?)\*/g, '<em>$1</em>');
  // Restore slots
  t = t.replace(/\x01S(\d+)\x01/g, (_m, i) => slots[parseInt(i)]);
  return t;
}
