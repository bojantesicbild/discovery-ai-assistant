"use client";

import { useEffect, useRef, useState } from "react";
import { chatStream, getConversation } from "@/lib/api";

interface Message {
  role: "user" | "assistant";
  content: string;
  time?: string;
  toolCalls?: string[];
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
  const [currentTool, setCurrentTool] = useState<string | null>(null);
  const [showWorkflows, setShowWorkflows] = useState(false);
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
          })));
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
    const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    setMessages((prev) => [...prev, { role: "user", content: text, time }]);
    setIsStreaming(true);

    let assistantContent = "";
    let toolCalls: string[] = [];
    setMessages((prev) => [...prev, { role: "assistant", content: "", time, toolCalls: [] }]);

    chatStream(
      projectId,
      text,
      (chunk) => {
        assistantContent += chunk;
        setCurrentTool(null);
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = { role: "assistant", content: assistantContent, time, toolCalls };
          return updated;
        });
      },
      () => {
        setIsStreaming(false);
        setCurrentTool(null);
        // If any write tool was called, refresh the data panel
        if (toolCalls.some(t => t.includes("update") || t.includes("validate") || t.includes("resolve"))) {
          onDataChanged?.();
        }
      },
      (error) => {
        if (error.includes("Rate limit")) return; // Ignore rate limit warnings
        assistantContent += `\n\n[Error: ${error}]`;
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = { role: "assistant", content: assistantContent, time, toolCalls };
          return updated;
        });
        setIsStreaming(false);
        setCurrentTool(null);
      },
      (tool) => {
        const friendlyName = tool
          .replace("mcp__discovery__", "")
          .replace("ToolSearch", "searching tools")
          .replace(/_/g, " ");
        toolCalls.push(friendlyName);
        setCurrentTool(friendlyName);
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = { role: "assistant", content: assistantContent, time, toolCalls: [...toolCalls] };
          return updated;
        });
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
      {/* Session header */}
      <div className="chat-session-header">
        <div className="chat-session-icon">AI</div>
        <div className="chat-session-title">Discovery Chat</div>
        <div className="chat-session-badge">Active</div>
      </div>

      {/* Messages */}
      <div className="chat-messages" id="chatMessages">
        {messages.length === 0 && (
          <div style={{ textAlign: "center", padding: "60px 20px" }}>
            <div style={{ fontSize: 40, marginBottom: 16 }}>🔍</div>
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
              </div>
              <div className="msg-bubble">
                {/* Tool activity indicator */}
                {msg.role === "assistant" && msg.toolCalls && msg.toolCalls.length > 0 && (
                  <div style={{
                    display: "flex", flexWrap: "wrap", gap: 4, marginBottom: msg.content ? 8 : 0,
                    paddingBottom: msg.content ? 8 : 0,
                    borderBottom: msg.content ? "1px solid var(--gray-100)" : "none",
                  }}>
                    {msg.toolCalls.map((tool, ti) => (
                      <span key={ti} style={{
                        fontSize: 10, fontWeight: 600, padding: "2px 8px",
                        borderRadius: 10, background: "var(--green-light)", color: "#059669",
                        display: "inline-flex", alignItems: "center", gap: 3,
                      }}>
                        <span style={{ width: 4, height: 4, borderRadius: "50%", background: "currentColor" }} />
                        {tool}
                      </span>
                    ))}
                  </div>
                )}
                {/* Message content */}
                {msg.content ? (
                  msg.role === "assistant" ? (
                    <div dangerouslySetInnerHTML={{ __html: renderChatMarkdown(msg.content) }} />
                  ) : (
                    msg.content
                  )
                ) : (isStreaming && i === messages.length - 1 ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--gray-400)" }}>
                    <span className="typing-dots" style={{
                      display: "inline-flex", gap: 3,
                    }}>
                      <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--green)", animation: "pulse 1.5s infinite", animationDelay: "0s" }} />
                      <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--green)", animation: "pulse 1.5s infinite", animationDelay: "0.3s" }} />
                      <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--green)", animation: "pulse 1.5s infinite", animationDelay: "0.6s" }} />
                    </span>
                    <span style={{ fontSize: 12 }}>
                      {currentTool ? `Querying ${currentTool}...` : "Thinking..."}
                    </span>
                  </div>
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
          Type <strong>/</strong> for workflows · Drop files to upload
        </div>
      </div>
    </div>
  );
}


function renderChatMarkdown(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/^### (.+)$/gm, '<strong style="display:block;margin:10px 0 4px;font-size:13px">$1</strong>')
    .replace(/^## (.+)$/gm, '<strong style="display:block;margin:12px 0 4px;font-size:14px">$1</strong>')
    .replace(/^# (.+)$/gm, '<strong style="display:block;margin:14px 0 6px;font-size:15px">$1</strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code style="padding:1px 5px;background:var(--gray-100);border-radius:3px;font-size:12px;font-family:monospace">$1</code>')
    .replace(/^- (.+)$/gm, '<div style="padding-left:12px;margin:2px 0">• $1</div>')
    .replace(/^\d+\. (.+)$/gm, '<div style="padding-left:12px;margin:2px 0">$1</div>')
    .replace(/^---$/gm, '<hr style="border:none;border-top:1px solid var(--gray-200);margin:8px 0">')
    .replace(/\n\n/g, '<div style="height:8px"></div>')
    .replace(/\n/g, '<br>');
}
