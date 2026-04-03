"use client";

import { useEffect, useRef, useState } from "react";
import { chatStream, getConversation } from "@/lib/api";

interface Message {
  role: "user" | "assistant";
  content: string;
  time?: string;
}

interface ChatPanelProps {
  projectId: string;
}

export default function ChatPanel({ projectId }: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
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
    setMessages((prev) => [...prev, { role: "assistant", content: "", time }]);

    chatStream(
      projectId,
      text,
      (chunk) => {
        assistantContent += chunk;
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = { role: "assistant", content: assistantContent, time };
          return updated;
        });
      },
      () => setIsStreaming(false),
      (error) => {
        assistantContent += `\n\n[Error: ${error}]`;
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = { role: "assistant", content: assistantContent, time };
          return updated;
        });
        setIsStreaming(false);
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
                {msg.content ? (
                  msg.role === "assistant" ? (
                    <div dangerouslySetInnerHTML={{ __html: renderChatMarkdown(msg.content) }} />
                  ) : (
                    msg.content
                  )
                ) : (isStreaming && i === messages.length - 1 ? (
                  <span style={{ color: "var(--gray-400)" }}>Thinking...</span>
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
      <div className="chat-input-area">
        <div className="chat-input-box">
          <textarea
            ref={textareaRef}
            rows={1}
            placeholder="Ask about requirements, gaps, readiness..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
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
