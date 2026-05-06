"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { chatStream, getConversation, clearConversation } from "@/lib/api";
import { useTopSentinel } from "@/lib/useTopSentinel";

interface Segment {
  type: "text" | "activity";
  content?: string;
  tools?: string[];
  thinkingCount?: number;
}

// Stats persisted on every assistant message — turn metadata + the
// Claude Code usage block so the chat header can render the context-
// window pill without re-asking the runner.
interface ChatStats {
  numTurns?: number;
  durationMs?: number;
  contextTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  model?: string;
}

interface Message {
  role: "user" | "assistant" | "system";
  content: string;
  time?: string;
  toolCalls?: string[];
  thinkingCount?: number;
  activityLog?: { type: string; content?: string; tool?: string }[];
  stats?: ChatStats;
  segments?: Segment[];
  // Source attribution — where the message was initiated from. "web" =
  // typed by the PM in the chat; "slack" = inbound Slack; "pipeline" =
  // auto-triggered by the document pipeline (extraction, ingest notices);
  // "reminder" = auto-triggered by the reminder scanner when a reminder
  // fires. Any non-"web" source is something the PM didn't start, so the
  // UI labels them with a TriggerBadge so it's obvious.
  source?: "web" | "slack" | "pipeline" | "reminder";
  slack_user_name?: string;
  slack_user_id?: string;
  slack_channel_id?: string;
  slack_channel_name?: string;
  slack_thread_ts?: string;
  // System message metadata (pipeline notices)
  kind?: string;
  data?: Record<string, any>;
  // Stable server id (uuid hex). Used for reconcile-by-id during polling.
  // Falls back to `${role}:${timestamp}` for legacy server messages.
  _key?: string;
  // True while a Slack-triggered run is still in progress.
  _processing?: boolean;
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

/** Reconstruct segments from activityLog for historical messages */
function rebuildSegments(activityLog?: { type: string; content?: string; tool?: string }[]): Segment[] | undefined {
  if (!activityLog || activityLog.length === 0) return undefined;

  const segments: Segment[] = [];
  let currentTools: string[] = [];
  let currentThinking = 0;
  let currentText = "";

  const flushActivity = () => {
    if (currentTools.length > 0 || currentThinking > 0) {
      segments.push({ type: "activity", tools: [...currentTools], thinkingCount: currentThinking });
      currentTools = [];
      currentThinking = 0;
    }
  };

  const flushText = () => {
    if (currentText) {
      segments.push({ type: "text", content: currentText });
      currentText = "";
    }
  };

  for (const entry of activityLog) {
    if (entry.type === "tool") {
      flushText();
      currentTools.push(entry.tool || "unknown");
    } else if (entry.type === "thinking") {
      flushText();
      currentThinking++;
    } else if (entry.type === "text") {
      flushActivity();
      currentText += (currentText ? "\n" : "") + (entry.content || "");
    }
  }
  flushActivity();
  flushText();

  return segments.length > 0 ? segments : undefined;
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

// Model registry. `id` is the alias the backend hands to Claude Code's
// --model flag (the bare aliases work; explicit IDs are accepted too).
// `contextWindow` is the per-turn ceiling we render in the context-
// usage pill — most models cap at 200K, the 1M-context Opus opts in.
const MODELS: { id: string; label: string; contextWindow: number }[] = [
  { id: "opus",                   label: "Opus 4.6",       contextWindow: 200_000 },
  { id: "claude-opus-4-7[1m]",    label: "Opus 4.7 (1M)",  contextWindow: 1_000_000 },
  { id: "sonnet",                 label: "Sonnet 4.6",     contextWindow: 200_000 },
  { id: "haiku",                  label: "Haiku 4.5",      contextWindow: 200_000 },
];
const DEFAULT_MODEL_ID = "opus";

function modelLabel(id: string): string {
  return MODELS.find((m) => m.id === id)?.label || id;
}

// Tools the discovery agent currently has registered — surfaced via the
// "13 tools" chip popover so the PM can see what's actually available
// without diving into the agent definition. Grouped for readability;
// the count comes from .length so updates here keep the chip accurate.
const TOOLS: { name: string; group: "discovery" | "files" | "shell"; desc: string }[] = [
  { name: "get_requirements",    group: "discovery", desc: "List extracted requirements (BR-* records)" },
  { name: "get_gaps",            group: "discovery", desc: "List open gaps blocking handoff" },
  { name: "get_constraints",     group: "discovery", desc: "List active project constraints" },
  { name: "get_contradictions",  group: "discovery", desc: "List unresolved contradictions between sources" },
  { name: "get_stakeholders",    group: "discovery", desc: "List people involved and their roles" },
  { name: "propose_update",      group: "discovery", desc: "Stage a change to a finding for your review" },
  { name: "validate_extraction", group: "discovery", desc: "Run quality checks against extracted findings" },
  { name: "Read",                group: "files",     desc: "Read a file in the project workspace" },
  { name: "Edit",                group: "files",     desc: "Modify an existing file in place" },
  { name: "Write",               group: "files",     desc: "Create or fully replace a file" },
  { name: "Grep",                group: "files",     desc: "Search file contents by regex" },
  { name: "Glob",                group: "files",     desc: "Find files by pathname pattern" },
  { name: "Bash",                group: "shell",     desc: "Run a shell command in the project root" },
];

interface ChatPanelProps {
  projectId: string;
  onDataChanged?: () => void;
}

export default function ChatPanel({ projectId, onDataChanged }: ChatPanelProps) {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [showWorkflows, setShowWorkflows] = useState(false);
  const [status, setStatus] = useState<ActiveStatus>({
    phase: "idle", thinkingCount: 0, toolCount: 0, startTime: 0,
  });
  const [lastStats, setLastStats] = useState<ChatStats | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Model selection — applies per chat turn and persists across reloads
  // via localStorage. Claude Code's --resume keeps the same session_id
  // when the model flag changes, so swapping mid-conversation is
  // continuous (not a reset). Default opus matches the UI label history.
  const [selectedModel, setSelectedModel] = useState<string>(() => {
    if (typeof window === "undefined") return DEFAULT_MODEL_ID;
    const stored = window.localStorage.getItem("discoveryChat:model");
    if (stored && MODELS.some((m) => m.id === stored)) return stored;
    return DEFAULT_MODEL_ID;
  });
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [toolsMenuOpen, setToolsMenuOpen] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("discoveryChat:model", selectedModel);
  }, [selectedModel]);

  // Keep lastStats in sync with whatever the most recent assistant
  // message persisted — covers Slack-triggered runs that finish while
  // the page is open (polling reconcile updates msg.stats; without this
  // the context-window pill would only refresh on web-stream end /
  // page reload).
  useEffect(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role === "assistant" && m.stats?.numTurns) {
        setLastStats(m.stats);
        return;
      }
    }
  }, [messages]);

  // Cursor pagination state — the chat now loads the newest page on
  // mount and fetches older pages on scroll-up. `oldestCursor` is opaque
  // (server decides shape); when the server returns null we know there
  // is no more history and the top sentinel disappears.
  const [oldestCursor, setOldestCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState<boolean>(false);
  const [isFetchingOlder, setIsFetchingOlder] = useState<boolean>(false);
  // "↓ N new" pill — incremented by the polling reconcile when a brand-new
  // message arrives while the user is scrolled up reading older history.
  const [hasNewBelow, setHasNewBelow] = useState<number>(0);

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  // Snapshot scrollHeight + scrollTop right before a prepend. The
  // useLayoutEffect that fires after the prepend renders restores the
  // delta so the user's reading position never jumps.
  const pendingAnchorRef = useRef<{ prevScrollHeight: number; prevScrollTop: number } | null>(null);
  // Tracks whether the user is currently pinned to the bottom (within a
  // small threshold). Used to gate auto-scroll on new messages — we
  // never yank a scrolled-up reader down to the bottom.
  const isPinnedToBottomRef = useRef<boolean>(true);
  // Initial mount: snap to bottom synchronously the first time messages
  // render. Later renders use smooth scroll only when pinned.
  const didInitialScrollRef = useRef<boolean>(false);

  // Map a raw server message into our local Message shape
  const mapMessage = (m: any): Message => ({
    role: m.role,
    content: m.content,
    toolCalls: m.toolCalls || [],
    thinkingCount: m.thinkingCount || 0,
    activityLog: m.activityLog || [],
    stats: m.stats,
    time: m.timestamp ? formatTimestamp(m.timestamp) : undefined,
    segments: m.segments || rebuildSegments(m.activityLog),
    source: m.source,
    slack_user_name: m.slack_user_name,
    slack_user_id: m.slack_user_id,
    slack_channel_id: m.slack_channel_id,
    slack_channel_name: m.slack_channel_name,
    slack_thread_ts: m.slack_thread_ts,
    kind: m.kind,
    data: m.data,
    // Prefer the stable server id (uuid hex). Fall back to timestamp-based
    // key for legacy messages persisted before stable ids were introduced.
    _key: m.id || (m.timestamp ? `${m.role}:${m.timestamp}` : undefined),
    _processing: m._processing || false,
  });

  // Load the newest page of conversation history on mount. Older pages
  // are fetched lazily as the user scrolls up — see loadOlder() below.
  useEffect(() => {
    // Reset on project switch — otherwise we'd briefly show the previous
    // project's tail with the new project's pagination cursor.
    setMessages([]);
    setOldestCursor(null);
    setHasMore(false);
    setHasNewBelow(0);
    didInitialScrollRef.current = false;
    isPinnedToBottomRef.current = true;

    getConversation(projectId)
      .then((data) => {
        if (data.messages?.length > 0) {
          setMessages(data.messages.map(mapMessage));
          const lastAssistant = [...data.messages].reverse().find((m: any) => m.role === "assistant");
          if (lastAssistant?.stats) setLastStats(lastAssistant.stats);
        }
        setOldestCursor(data.next_cursor ?? null);
        setHasMore(Boolean(data.next_cursor));
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Poll for new messages from the shared conversation (Slack inbound).
  // Only runs while the page is visible and we're NOT actively streaming
  // a web-initiated turn (the SSE stream owns updates during that window).
  // Always queries the newest page (no cursor) — older history is
  // immutable once paginated in, no need to refetch it.
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      if (cancelled || isStreaming || document.hidden) return;
      try {
        const data = await getConversation(projectId);
        if (cancelled) return;
        const incoming: Message[] = (data.messages || []).map(mapMessage);
        let appended = 0;
        setMessages((prev) => {
          // Reconcile incoming server messages with local state.
          // Two paths:
          // 1. Existing message with same _key → UPDATE in place (this is
          //    how progressive Slack updates grow on screen).
          // 2. New message with unrecognized _key → try to upgrade a
          //    keyless local message (from web SSE streaming), else append.
          const next = [...prev];
          const indexByKey = new Map<string, number>();
          next.forEach((m, i) => { if (m._key) indexByKey.set(m._key, i); });
          let mutated = false;

          for (const msg of incoming) {
            if (!msg._key) continue;

            const existingIdx = indexByKey.get(msg._key);
            if (existingIdx !== undefined) {
              // Update existing entry — useful for progressive Slack runs
              // where the server keeps writing fresh content/segments to
              // the same id. Always replace so _processing flips and
              // segments/tool_calls grow.
              const local = next[existingIdx];
              const updated: Message = {
                ...local,
                content: msg.content || local.content,
                segments: msg.segments || local.segments,
                toolCalls: msg.toolCalls?.length ? msg.toolCalls : local.toolCalls,
                thinkingCount: msg.thinkingCount ?? local.thinkingCount,
                activityLog: msg.activityLog || local.activityLog,
                stats: msg.stats ?? local.stats,
                _processing: msg._processing,
              };
              // Only mark mutated if something actually changed.
              if (
                updated.content !== local.content ||
                updated._processing !== local._processing ||
                (updated.segments?.length || 0) !== (local.segments?.length || 0) ||
                (updated.toolCalls?.length || 0) !== (local.toolCalls?.length || 0)
              ) {
                next[existingIdx] = updated;
                mutated = true;
              }
              continue;
            }

            // Try to upgrade a local keyless entry (web SSE stream) by
            // matching on role + content overlap.
            const localIdx = next.findIndex((m) => {
              if (m._key) return false;
              if (m.role !== msg.role) return false;
              if (!m.content || !msg.content) return m.role === msg.role;
              return (
                m.content === msg.content ||
                (m.content.length > 5 && msg.content.startsWith(m.content.slice(0, Math.min(40, m.content.length)))) ||
                (msg.content.length > 5 && m.content.startsWith(msg.content.slice(0, Math.min(40, msg.content.length))))
              );
            });
            if (localIdx >= 0) {
              const local = next[localIdx];
              next[localIdx] = {
                ...local,
                _key: msg._key,
                source: msg.source ?? local.source,
                slack_user_name: msg.slack_user_name ?? local.slack_user_name,
                slack_user_id: msg.slack_user_id ?? local.slack_user_id,
                slack_channel_id: msg.slack_channel_id ?? local.slack_channel_id,
                slack_channel_name: msg.slack_channel_name ?? local.slack_channel_name,
                slack_thread_ts: msg.slack_thread_ts ?? local.slack_thread_ts,
                content: (msg.content && msg.content.length > (local.content?.length || 0)) ? msg.content : local.content,
                _processing: msg._processing ?? local._processing,
              };
              indexByKey.set(msg._key, localIdx);
              mutated = true;
            } else {
              indexByKey.set(msg._key, next.length);
              next.push(msg);
              appended += 1;
              mutated = true;
            }
          }
          return mutated ? next : prev;
        });
        // Drive the "↓ N new" pill — only when the user is currently
        // scrolled up reading older history. If they're pinned at the
        // bottom, the auto-scroll effect will smoothly bring the new
        // message into view and the pill stays at zero.
        if (appended > 0 && !isPinnedToBottomRef.current) {
          setHasNewBelow((n) => n + appended);
        }
      } catch {
        /* ignore polling errors */
      }
    };
    const interval = setInterval(tick, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, isStreaming]);

  // Restore scroll anchor after a "load older" prepend. Runs in the
  // commit phase BEFORE paint, so the user never sees the jump that
  // would happen if we did this in useEffect.
  useLayoutEffect(() => {
    const anchor = pendingAnchorRef.current;
    if (!anchor) return;
    const el = scrollerRef.current;
    if (!el) return;
    const delta = el.scrollHeight - anchor.prevScrollHeight;
    el.scrollTop = anchor.prevScrollTop + delta;
    pendingAnchorRef.current = null;
  }, [messages]);

  // Initial mount: snap to the bottom synchronously the first time we
  // have messages so the user lands at the latest turn with no flash.
  useLayoutEffect(() => {
    if (didInitialScrollRef.current) return;
    if (messages.length === 0) return;
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    didInitialScrollRef.current = true;
    isPinnedToBottomRef.current = true;
  }, [messages.length]);

  // Subsequent message changes (new turn arrives, stream chunk lands):
  // smooth-scroll to the bottom only when the user is already pinned
  // there. Scrolled-up readers get the "↓ N new" pill instead.
  useEffect(() => {
    if (!didInitialScrollRef.current) return;
    if (pendingAnchorRef.current) return;  // a prepend just ran — don't fight it
    if (!isPinnedToBottomRef.current) return;
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Track pinning by listening to scroll events on the chat body. 64px
  // threshold means "close enough to the bottom to count as pinned" —
  // generous enough that a slow stream still auto-scrolls without the
  // user feeling locked, tight enough that a deliberate scroll-up
  // disengages it immediately.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const onScroll = () => {
      const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
      const pinned = dist < 64;
      isPinnedToBottomRef.current = pinned;
      if (pinned) setHasNewBelow(0);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  // Tab returns from hidden → poll immediately so the user doesn't have
  // to wait up to 5s for the next interval tick to see fresh messages.
  useEffect(() => {
    function onVisible() {
      if (document.hidden || isStreaming) return;
      getConversation(projectId)
        .then((data) => {
          const incoming: Message[] = (data.messages || []).map(mapMessage);
          // Reuse the same reconcile shape as the polling loop: in-place
          // update by _key, append unknown keys.
          setMessages((prev) => {
            const next = [...prev];
            const indexByKey = new Map<string, number>();
            next.forEach((m, i) => { if (m._key) indexByKey.set(m._key, i); });
            let mutated = false;
            for (const msg of incoming) {
              if (!msg._key) continue;
              const existingIdx = indexByKey.get(msg._key);
              if (existingIdx !== undefined) {
                next[existingIdx] = { ...next[existingIdx], ...msg };
                mutated = true;
              } else {
                indexByKey.set(msg._key, next.length);
                next.push(msg);
                mutated = true;
              }
            }
            return mutated ? next : prev;
          });
        })
        .catch(() => {});
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, isStreaming]);

  // Fetch the next older page and prepend it. The IntersectionObserver
  // sentinel at the top of the list calls this on enter; the scroll
  // anchor is captured BEFORE state mutates so the restoration pass
  // can compute the right delta.
  const loadOlder = useCallback(async () => {
    if (!hasMore || isFetchingOlder || !oldestCursor) return;
    const el = scrollerRef.current;
    if (!el) return;
    pendingAnchorRef.current = {
      prevScrollHeight: el.scrollHeight,
      prevScrollTop: el.scrollTop,
    };
    setIsFetchingOlder(true);
    try {
      const data = await getConversation(projectId, { cursor: oldestCursor });
      const older: Message[] = (data.messages || []).map(mapMessage);
      setMessages((prev) => [...older, ...prev]);
      setOldestCursor(data.next_cursor ?? null);
      setHasMore(Boolean(data.next_cursor));
    } catch {
      // Failed fetch: clear the anchor so we don't restore against a
      // stale snapshot on the next render.
      pendingAnchorRef.current = null;
    } finally {
      setIsFetchingOlder(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, oldestCursor, hasMore, isFetchingOlder]);

  const topSentinelRef = useTopSentinel({
    onEnter: loadOlder,
    enabled: hasMore && !isFetchingOlder,
  });

  function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault();
    if (!input.trim() || isStreaming) return;
    sendMessage(input.trim());
  }

  // Listen for cross-component "send-chat" events (e.g. from Meeting Prep's Generate button)
  useEffect(() => {
    function handleSendChat(e: Event) {
      const detail = (e as CustomEvent).detail;
      if (detail?.text) {
        sendMessage(detail.text);
      }
    }
    window.addEventListener("send-chat", handleSendChat);
    return () => window.removeEventListener("send-chat", handleSendChat);
  });

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
    // Segments track interleaved text/activity blocks. Activity segments
    // grow IN-PLACE as tools/thinking events arrive — so the user can
    // see the cumulative tool list build up during a run instead of
    // only the most-recent tool name. Once a text chunk arrives we
    // freeze the last activity segment by starting a new text segment.
    let segments: Segment[] = [];

    const ensureActivitySegment = () => {
      const last = segments[segments.length - 1];
      if (!last || last.type !== "activity") {
        segments.push({ type: "activity", tools: [], thinkingCount: 0 });
      }
    };
    const ensureTextSegment = () => {
      const last = segments[segments.length - 1];
      if (!last || last.type !== "text") {
        segments.push({ type: "text", content: "" });
      }
    };
    // Kept for compatibility with the onError path (which used to
    // flush before tearing down). With in-place segments there is
    // nothing to flush, but we keep the symbol so the call site below
    // doesn't need a special case.
    const flushActivity = () => { /* segments are always live */ };

    const updateMsg = () => {
      setMessages((prev) => {
        const updated = [...prev];
        updated[updated.length - 1] = {
          role: "assistant", content: assistantContent, time,
          toolCalls: [...toolCalls], thinkingCount,
          segments: [...segments],
        };
        return updated;
      });
    };

    setMessages((prev) => [...prev, { role: "assistant", content: "", time, toolCalls: [], segments: [] }]);

    chatStream(
      projectId,
      text,
      // onText
      (chunk) => {
        ensureTextSegment();
        assistantContent += chunk;
        const lastSeg = segments[segments.length - 1];
        if (lastSeg && lastSeg.type === "text") {
          lastSeg.content = (lastSeg.content || "") + chunk;
        }
        setStatus((s) => ({ ...s, phase: "writing", detail: undefined }));
        updateMsg();
      },
      // onDone
      (stats) => {
        setIsStreaming(false);
        setStatus({ phase: "idle", thinkingCount: 0, toolCount: 0, startTime: 0 });
        if (stats) setLastStats(stats);
        // Final update with stats
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = {
            ...updated[updated.length - 1],
            stats, segments: [...segments],
          };
          return updated;
        });
        if (toolCalls.some(t => t.includes("update") || t.includes("validate") || t.includes("resolve") || t.includes("Edit") || t.includes("Write"))) {
          onDataChanged?.();
        }
        // Notify other components (e.g. MeetingPrepTab) that a chat response completed
        window.dispatchEvent(new CustomEvent("chat-response-done", {
          detail: { text: assistantContent },
        }));
      },
      // onError
      (error) => {
        if (error.includes("Rate limit")) return;
        assistantContent += `\n\n[Error: ${error}]`;
        flushActivity();
        updateMsg();
        setIsStreaming(false);
        setStatus({ phase: "idle", thinkingCount: 0, toolCount: 0, startTime: 0 });
      },
      // onTool
      (tool, toolType) => {
        toolCalls.push(tool);
        ensureActivitySegment();
        const seg = segments[segments.length - 1];
        if (seg.type === "activity") {
          // Spread to a fresh array — React diffs on reference equality
          // for the segments prop, so mutating in place wouldn't trigger
          // a re-render of the InlineActivity panel.
          seg.tools = [...(seg.tools || []), tool];
        }
        setStatus((s) => ({
          ...s,
          phase: "tool",
          detail: tool,
          toolType: toolType || "other",
          toolCount: s.toolCount + 1,
        }));
        updateMsg();
      },
      // onThinking
      () => {
        thinkingCount++;
        ensureActivitySegment();
        const seg = segments[segments.length - 1];
        if (seg.type === "activity") {
          seg.thinkingCount = (seg.thinkingCount || 0) + 1;
        }
        setStatus((s) => ({
          ...s,
          phase: "thinking",
          detail: undefined,
          thinkingCount: s.thinkingCount + 1,
        }));
        updateMsg();
      },
      // onRetry
      (attempt, maxRetries) => {
        setStatus((s) => ({
          ...s,
          phase: "retry",
          retryInfo: `Retry ${attempt}/${maxRetries}`,
        }));
      },
      // model — picked in the composer, persisted in localStorage
      selectedModel,
    );
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  return (
    <div className="chat-panel" style={{ flex: 1, width: "100%" }}>
      {/* Design v2 chat header — bubble + title + tools-chip on the left,
          live StatusBar + Clear on the right. */}
      <header className="chat-header">
        <div className="chat-title">
          <div className="bubble">AI</div>
          <div>
            <h2>Discovery Chat</h2>
            {/* Was a <p> — switched to <div> because the tools popover
             *  renders block-level <div>s inside, which HTML forbids
             *  inside <p> (causes a hydration error). */}
            <div style={{ position: "relative", fontSize: 13, color: "var(--ink-3)" }}>
              <button
                type="button"
                className="tools-chip"
                onClick={() => setToolsMenuOpen((v) => !v)}
                aria-haspopup="dialog"
                aria-expanded={toolsMenuOpen}
                title="Available tools"
                style={{
                  border: "none", background: "var(--surface-2)",
                  cursor: "pointer", fontFamily: "inherit",
                  display: "inline-flex", alignItems: "center", gap: 6,
                  padding: "2px 8px", borderRadius: 999,
                }}
              >
                <span className="dot" />
                {TOOLS.length} tools
              </button>
              {toolsMenuOpen && (
                <>
                  <div
                    onClick={() => setToolsMenuOpen(false)}
                    style={{ position: "fixed", inset: 0, zIndex: 100 }}
                  />
                  <div
                    role="dialog"
                    style={{
                      position: "absolute", top: "calc(100% + 6px)", left: 0,
                      zIndex: 101, width: 320, maxHeight: 420, overflow: "auto",
                      background: "var(--surface)",
                      border: "1px solid var(--line)",
                      borderRadius: 10,
                      boxShadow: "0 8px 24px rgba(15,23,42,0.10)",
                      padding: 10,
                    }}
                  >
                    {(["discovery", "files", "shell"] as const).map((g) => {
                      const items = TOOLS.filter((t) => t.group === g);
                      if (items.length === 0) return null;
                      const heading =
                        g === "discovery" ? "Discovery MCP" :
                        g === "files" ? "File operations" :
                        "Shell";
                      return (
                        <div key={g} style={{ marginBottom: g === "shell" ? 0 : 10 }}>
                          <div style={{
                            fontSize: 9, fontWeight: 700, letterSpacing: 0.4,
                            textTransform: "uppercase",
                            color: "var(--ink-4)", marginBottom: 6,
                            paddingLeft: 4,
                          }}>
                            {heading}
                          </div>
                          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                            {items.map((t) => (
                              <div key={t.name} style={{
                                display: "flex", flexDirection: "column", gap: 2,
                                padding: "5px 8px", borderRadius: 6,
                                background: "transparent",
                              }}
                                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-2)")}
                                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                              >
                                <span style={{
                                  fontFamily: "var(--font-mono)",
                                  fontSize: 11, fontWeight: 600,
                                  color: "var(--ink)",
                                  letterSpacing: "-0.01em",
                                }}>
                                  {t.name}
                                </span>
                                <span style={{
                                  fontSize: 11, color: "var(--ink-3)", lineHeight: 1.35,
                                }}>
                                  {t.desc}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
        <div className="chat-actions">
          <StatusBar status={status} lastStats={lastStats} isStreaming={isStreaming} modelId={selectedModel} />
          {messages.length > 0 && !isStreaming && (
            <button
              className="ghost-btn"
              onClick={async () => {
                if (confirm("Clear conversation and start fresh?")) {
                  await clearConversation(projectId);
                  setMessages([]);
                }
              }}
              title="Clear conversation"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
              </svg>
              Clear
            </button>
          )}
        </div>
      </header>

      {/* Messages — Design v2 .chat-body-wrap + .chat-body with edge fades */}
      <div className="chat-body-wrap">
      <div
        ref={scrollerRef}
        className="chat-body"
        id="chatMessages"
        onClick={(e) => {
          // Delegate clicks on file chips + internal markdown links.
          // - `[text](/…)` internal markdown link → route as-is.
          // - `<a data-file="…">` chips from the agent's auto-decoration:
          //     files under docs/meeting-prep/ → Meeting Prep tab with the
          //     specific file pre-loaded (nicer than a bare vault viewer
          //     for briefs the user acts on).
          //     Everything else → plain vault viewer.
          const target = e.target as HTMLElement;
          const anchor = target.closest("a");
          if (!anchor) return;
          const route = anchor.getAttribute("data-route");
          if (route) {
            e.preventDefault();
            router.push(route);
            return;
          }
          const findingId = anchor.getAttribute("data-finding-id");
          const findingTab = anchor.getAttribute("data-finding-tab");
          if (findingId && findingTab) {
            e.preventDefault();
            router.push(`/projects/${projectId}/chat?tab=${findingTab}&highlight=${findingId}`);
            return;
          }
          const file = anchor.getAttribute("data-file");
          if (file) {
            e.preventDefault();
            const basename = file.split("/").pop() || file;
            const isMeetingPrepFile =
              file.includes("docs/meeting-prep/") || file.startsWith("meeting-prep/");
            // Status briefs live in meeting-prep/ too but are distinct
            // files (`YYYY-MM-DD-status-<subj>-<id>.md`) — they belong
            // in the Reminders tab's expanded detail, not the Meeting
            // Prep editor.
            if (isMeetingPrepFile && basename.includes("-status-")) {
              router.push(`/projects/${projectId}/chat?tab=reminders`);
            } else if (isMeetingPrepFile) {
              router.push(`/projects/${projectId}/chat?tab=meeting&file=${encodeURIComponent(basename)}`);
            } else {
              router.push(`/projects/${projectId}/vault?path=${encodeURIComponent(file)}`);
            }
          }
        }}
      >
        {messages.length === 0 && (
          <div style={{ textAlign: "center", padding: "60px 20px" }}>
            <div style={{ fontSize: 40, marginBottom: 16 }}>&#128269;</div>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Discovery AI Assistant</div>
            <div style={{ fontSize: 13, color: "var(--gray-500)", maxWidth: 360, margin: "0 auto 20px" }}>
              Upload client documents and ask about requirements, gaps, meeting prep, or generate handoff docs.
            </div>
          </div>
        )}

        {/* Top-of-list sentinel for invisible infinite scroll. While more
            history is available, an IntersectionObserver fires loadOlder
            when this element comes into view; once next_cursor is null
            the sentinel unmounts and the observer disconnects. The
            skeleton reuses .msg-card.ghost so the loading vibe matches
            the live-stream ghost above. */}
        {hasMore && (
          <div ref={topSentinelRef} className="chat-history-sentinel">
            {isFetchingOlder && (
              <div className="msg-card ghost" style={{ margin: "8px 0" }}>
                <div className="ghost-body">
                  <div className="skeleton w1" />
                  <div className="skeleton w2" />
                </div>
              </div>
            )}
          </div>
        )}

        {messages.map((msg, i) => {
          if (msg.role === "system") {
            // Group only consecutive system messages of the same kind.
            // This keeps document ingestions and review submissions in
            // separate, distinctly styled groups.
            const prev = i > 0 ? messages[i - 1] : null;
            if (prev && prev.role === "system" && (prev.kind || "system") === (msg.kind || "system")) return null;
            const run: Message[] = [];
            let j = i;
            const thisKind = msg.kind || "system";
            while (j < messages.length && messages[j].role === "system" && (messages[j].kind || "system") === thisKind) {
              run.push(messages[j]);
              j++;
            }
            return <SystemNoticeGroup key={`sys-${i}`} messages={run} projectId={projectId} />;
          }
          // Design v2 shell: .msg > .msg-meta + .msg-card > .msg-content.
          // User messages get right-aligned dark treatment via .msg.user.
          const senderName =
            msg.role === "user"
              ? (msg.source === "slack" ? (msg.slack_user_name || "Slack user") : "You")
              : "Discovery Assistant";
          // Empty assistant bubble mid-stream → ghost state (spinner +
          // skeleton). Same treatment for pipeline/reminder/Slack runs
          // that started server-side (msg._processing) — uploads and
          // reminder fires should look the same as a live chat turn,
          // not a stale "Agent thinking…" line. When content starts
          // arriving we flip to the normal msg-content render.
          const isLiveStreamTarget = isStreaming && i === messages.length - 1;
          // Activity-only segments (thinking, tool calls) shouldn't count
          // as "real" content — otherwise the ghost UI flips off the
          // moment the agent emits its first thinking event, even though
          // the user has nothing to read yet. Only TEXT segments (or
          // top-level content) end the ghost state.
          const hasTextSegment = (msg.segments || []).some((s) => s.type === "text" && s.content);
          const hasContent = Boolean(msg.content) || hasTextSegment;
          // Server-side runs (document extraction, reminder prep) keep the
          // ghost up for the entire in-flight window even when the agent
          // dribbles intermediate reasoning text into the message — those
          // partial chunks are noisy mid-thought, not the final summary
          // the PM should be reading. The ghost replaces them with a
          // clean "still working" surface and the real text appears
          // when extraction finishes (kind flips to *_done).
          const isInflightServerRun =
            msg.role === "assistant" && (
              (msg.source === "pipeline" && msg.kind === "extraction_running") ||
              (msg.source === "reminder" && msg.kind === "reminder_prep")
            );
          const showGhost =
            msg.role === "assistant" && (
              isInflightServerRun ||
              (!hasContent && (isLiveStreamTarget || !!msg._processing))
            );
          // Phase progression for the dot indicator — real status from
          // the stream (thinking / tool / writing / retry), not a synthetic
          // counter. Dots light up as the stream advances through phases.
          const PHASES = ["thinking", "tool", "writing"] as const;
          const phaseIndex = isLiveStreamTarget
            ? Math.max(0, PHASES.indexOf(status.phase as any))
            : 0;
          return (
          <div key={i} className={`msg ${msg.role === "user" ? "user" : ""}`}>
            <div className="msg-meta">
              <strong>{senderName}</strong>
              {msg.source === "slack" && <SlackBadge msg={msg} />}
              {msg.source === "pipeline" && (
                <TriggerBadge
                  source="pipeline"
                  kind={msg.kind}
                  filename={(msg.data as { filename?: string } | undefined)?.filename}
                />
              )}
              {msg.source === "reminder" && (
                <TriggerBadge
                  source="reminder"
                  kind={msg.kind}
                  reminderLabel={(msg.data as { label?: string } | undefined)?.label}
                />
              )}
              {/* Live in-flight — green pill + streaming dots matches
                  the design's "Thinking…" pattern. Completed messages
                  show nothing here (the tools-bar below already
                  surfaces tool + thinking counts). */}
              {isLiveStreamTarget && (
                <span className="chip green">
                  {status.phase === "writing" ? "Writing" :
                   status.phase === "tool" ? "Using tools" :
                   status.phase === "retry" ? "Retrying" : "Thinking"}
                  <span className="streaming-dots"><span /><span /><span /></span>
                </span>
              )}
              {msg.time && <span className="ts">{msg.time}</span>}
            </div>
            <div className={`msg-card${showGhost ? " ghost" : ""}${isLiveStreamTarget ? " live" : ""}`}>
              {showGhost ? (
                <>
                  <div className="ghost-head">
                    <span className="ghost-spinner" />
                    <span className="ghost-status">
                      {isLiveStreamTarget
                        ? (status.detail || (
                            status.phase === "writing" ? "Writing response" :
                            status.phase === "tool" ? "Calling tools" :
                            "Thinking"
                          ))
                        : msg.source === "pipeline"
                          // Filename already lives in the meta line — keep
                          // the ghost head generic so the user doesn't
                          // read the same string twice.
                          ? (msg.toolCalls && msg.toolCalls.length > 0 ? "Calling tools" : "Thinking")
                        : msg.source === "reminder"
                          ? "Preparing reminder"
                        : msg.source === "slack"
                          ? "Agent thinking"
                        : "Thinking"}
                      <span className="cursor" />
                    </span>
                    {/* Live counter pill — phase dots (thinking → tool →
                        writing) for the chat-stream case, simple counters
                        for server-side runs (uploads, reminders) where we
                        only know totals. Either way the user sees what
                        the agent is doing, not a generic spinner. */}
                    {(() => {
                      const pipelineToolCount = msg.toolCalls?.length || 0;
                      const pipelineThinkingCount = msg.thinkingCount || 0;
                      const liveHasCounts = isLiveStreamTarget && (status.toolCount > 0 || status.thinkingCount > 0);
                      const pipelineHasCounts = !isLiveStreamTarget && (pipelineToolCount > 0 || pipelineThinkingCount > 0);
                      if (!liveHasCounts && !pipelineHasCounts) return null;
                      const tools = isLiveStreamTarget ? status.toolCount : pipelineToolCount;
                      const thinks = isLiveStreamTarget ? status.thinkingCount : pipelineThinkingCount;
                      return (
                        <span className="ghost-steps" title="Live agent status">
                          {isLiveStreamTarget && PHASES.map((_, idx) => (
                            <span
                              key={idx}
                              className={`step-dot${idx === phaseIndex ? " active" : ""}`}
                            />
                          ))}
                          <span>
                            {tools > 0 && `${tools} tool${tools !== 1 ? "s" : ""}`}
                            {tools > 0 && thinks > 0 && " · "}
                            {thinks > 0 && `${thinks} thinking`}
                          </span>
                        </span>
                      );
                    })()}
                  </div>
                  <div className="ghost-body">
                    {/* Latest tool call surfaces inline so the ghost reads
                        as "what the agent is doing right now", not just a
                        generic skeleton. Live-stream uses status.detail
                        (the tool currently running); server-side runs
                        pick the most recent entry from msg.toolCalls. */}
                    {(() => {
                      const liveDetail = isLiveStreamTarget && status.phase === "tool" ? status.detail : null;
                      const pipelineLast = !isLiveStreamTarget && msg.toolCalls && msg.toolCalls.length > 0
                        ? msg.toolCalls[msg.toolCalls.length - 1]
                        : null;
                      const detail = liveDetail || pipelineLast;
                      if (!detail) return null;
                      return (
                        <div className="ghost-tool">
                          <span className="tool-dot" />
                          <span className="tool-name">{detail}</span>
                        </div>
                      );
                    })()}
                    <div className="skeleton w1" />
                    <div className="skeleton w2" />
                  </div>
                </>
              ) : msg.role === "assistant" && msg.segments && msg.segments.length > 0 ? (
                // Interleaved segments — preserve source order. Activity
                // segments render as flush card-level siblings (.msg-card-
                // tools); text segments each get their own .msg-content
                // block so padding lands per-text-chunk, not around the
                // whole conversation body. Activity blocks' bottom
                // border visually separates them from adjacent content.
                <>
                  {msg.segments.map((seg, si) => {
                    const isLastSegment = si === msg.segments.length - 1;
                    // The last activity segment of a still-streaming
                    // message gets the "live" treatment: auto-expanded,
                    // current-tool indicator at the top, accent border.
                    const isLiveSeg =
                      isLiveStreamTarget &&
                      isLastSegment &&
                      seg.type === "activity" &&
                      (status.phase === "tool" || status.phase === "thinking");
                    return seg.type === "activity" ? (
                      <InlineActivity
                        key={si}
                        tools={seg.tools || []}
                        thinkingCount={seg.thinkingCount}
                        isLive={isLiveSeg}
                        currentTool={isLiveSeg && status.phase === "tool" ? status.detail : undefined}
                        currentToolType={isLiveSeg ? status.toolType : undefined}
                        isThinkingLive={isLiveSeg && status.phase === "thinking"}
                      />
                    ) : (
                      <div key={si} className="msg-content">
                        <div dangerouslySetInnerHTML={{ __html: renderChatMarkdown(seg.content || "") }} />
                      </div>
                    );
                  })}
                  {/* Fallback indicator only when there's no activity
                      segment yet (very first thinking before any tool
                      lands) or when the agent is purely writing text. */}
                  {isLiveStreamTarget &&
                    status.phase !== "idle" &&
                    status.phase !== "writing" &&
                    !msg.segments.some((s) => s.type === "activity") && (
                    <div className="msg-content">
                      <ActiveIndicator status={status} />
                    </div>
                  )}
                  {msg._processing && !isLiveStreamTarget && (
                    <div className="msg-content">
                      <ProcessingIndicator
                        source={msg.source}
                        currentTool={msg.toolCalls && msg.toolCalls.length > 0 ? msg.toolCalls[msg.toolCalls.length - 1] : undefined}
                      />
                    </div>
                  )}
                </>
              ) : msg.role === "assistant" ? (
                // Non-segment assistant — ActivityPanel (if any) sits as
                // a sibling above .msg-content for the same flush-top
                // treatment.
                <>
                  {msg.toolCalls && msg.toolCalls.length > 0 && (
                    <ActivityPanel
                      tools={msg.toolCalls}
                      isLive={isLiveStreamTarget}
                      currentTool={isLiveStreamTarget ? status.detail : undefined}
                      thinkingCount={msg.thinkingCount}
                      activityLog={msg.activityLog}
                    />
                  )}
                  <div className="msg-content">
                    {msg.content ? (
                      <div dangerouslySetInnerHTML={{ __html: renderChatMarkdown(msg.content) }} />
                    ) : msg._processing ? (
                      <ProcessingIndicator
                        source={msg.source}
                        currentTool={msg.toolCalls && msg.toolCalls.length > 0 ? msg.toolCalls[msg.toolCalls.length - 1] : undefined}
                      />
                    ) : null}
                    {isLiveStreamTarget && msg.content && status.phase !== "idle" && status.phase !== "writing" && (
                      <div style={{ marginTop: 8, paddingTop: 6, borderTop: "1px solid var(--line)" }}>
                        <ActiveIndicator status={status} />
                      </div>
                    )}
                    {msg._processing && msg.content && !isLiveStreamTarget && (
                      <div style={{ marginTop: 8, paddingTop: 6, borderTop: "1px solid var(--line)" }}>
                        <ProcessingIndicator
                        source={msg.source}
                        currentTool={msg.toolCalls && msg.toolCalls.length > 0 ? msg.toolCalls[msg.toolCalls.length - 1] : undefined}
                      />
                      </div>
                    )}
                  </div>
                </>
              ) : msg.role === "user" ? (
                <div className="msg-content">
                  <div dangerouslySetInnerHTML={{ __html: renderChatMarkdown(msg.content) }} />
                </div>
              ) : (
                <div className="msg-content">{msg.content}</div>
              )}
            </div>
          </div>
          );
        })}

        {/* Quick-action suggestion chips removed — the design treats the
            chat as a free-form input; pre-baked prompts added noise. If
            they come back in the future, use .qa-chip / .msg-suggestion
            from chat.css. */}

        <div ref={messagesEndRef} />
      </div>
      {/* "↓ N new" pill — only renders when at least one new message
          arrived while the user was scrolled up reading older history.
          Click jumps to the bottom and zeroes the counter. */}
      {hasNewBelow > 0 && (
        <button
          type="button"
          className="chat-new-below"
          onClick={() => {
            messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
            setHasNewBelow(0);
          }}
        >
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 5v14M5 12l7 7 7-7" />
          </svg>
          {hasNewBelow} new
        </button>
      )}
      </div>

      {/* Design v2 composer — input on top, action footer below with
          a tray on the left (workflows trigger) + model + send. */}
      <div className="composer" style={{ position: "relative" }}>
        {showWorkflows && (
          <div
            style={{
              position: "absolute", bottom: "calc(100% - 6px)", left: 20, width: 300,
              background: "var(--surface)", border: "1px solid var(--line)",
              borderRadius: "var(--radius)", boxShadow: "var(--shadow-lg)",
              zIndex: 50, overflow: "hidden",
            }}
          >
            <div style={{ padding: "12px 16px 8px", borderBottom: "1px solid var(--line)" }}>
              <div
                style={{
                  fontSize: 11, fontWeight: 700, textTransform: "uppercase",
                  letterSpacing: "0.08em", color: "var(--ink-4)",
                }}
              >
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
                    borderRadius: "var(--radius-sm)", cursor: "pointer", transition: "background 0.15s",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-2)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  <div
                    style={{
                      width: 32, height: 32, borderRadius: "var(--radius-sm)",
                      border: "1px solid var(--line)", background: "var(--surface-2)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      color: "var(--ink-3)", flexShrink: 0,
                    }}
                  >
                    <svg
                      viewBox="0 0 24 24"
                      style={{
                        width: 16, height: 16, stroke: "currentColor", fill: "none",
                        strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round",
                      }}
                    >
                      {wf.icon}
                    </svg>
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>{wf.label}</div>
                    <div style={{ fontSize: 11, color: "var(--ink-4)", marginTop: 1 }}>{wf.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="composer-box">
          <div className="composer-input-wrap">
            <textarea
              ref={textareaRef}
              rows={1}
              placeholder="Ask about requirements, gaps, readiness…"
              value={input}
              onChange={(e) => { setInput(e.target.value); if (showWorkflows) setShowWorkflows(false); }}
              onKeyDown={handleKeyDown}
              disabled={isStreaming}
            />
          </div>
          <div className="composer-footer">
            <div className="composer-tray">
              <button
                type="button"
                className="tray-btn"
                onClick={() => setShowWorkflows(!showWorkflows)}
                disabled={isStreaming}
                title="Workflows"
                style={{
                  color: showWorkflows ? "var(--accent-ink)" : undefined,
                  background: showWorkflows ? "var(--accent-soft)" : undefined,
                }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                <span className="tray-kbd">/</span>
              </button>
            </div>

            <div style={{ flex: 1, fontSize: 11, color: "var(--ink-4)" }}>
              Type <strong style={{ color: "var(--ink-2)" }}>/</strong> for workflows
            </div>

            <div className="composer-right" style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 8 }}>
              {/* Context-window ring — same vocabulary as the readiness
                  hero: track + tier-coloured fill + numeric % center.
                  Reads lastStats.contextTokens (persisted on the latest
                  assistant message) so it survives a refresh. */}
              {(lastStats?.contextTokens || 0) > 0 && (
                <ContextWindowRing
                  tokens={lastStats?.contextTokens || 0}
                  modelId={lastStats?.model || selectedModel}
                />
              )}
              <button
                type="button"
                className="model-pill"
                title="Pick model — applied to the next turn (session continues)"
                onClick={() => setModelMenuOpen((v) => !v)}
                aria-haspopup="listbox"
                aria-expanded={modelMenuOpen}
              >
                <span className="model-dot" />
                {modelLabel(selectedModel)}
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </button>
              {modelMenuOpen && (
                <>
                  {/* Click-outside catcher */}
                  <div
                    onClick={() => setModelMenuOpen(false)}
                    style={{ position: "fixed", inset: 0, zIndex: 100 }}
                  />
                  <div
                    role="listbox"
                    style={{
                      position: "absolute", bottom: "calc(100% + 6px)", right: 0,
                      zIndex: 101, minWidth: 220,
                      background: "var(--surface)",
                      border: "1px solid var(--line)",
                      borderRadius: 10,
                      boxShadow: "0 8px 24px rgba(15,23,42,0.10)",
                      padding: 6, display: "flex", flexDirection: "column", gap: 2,
                    }}
                  >
                    {MODELS.map((m) => {
                      const active = m.id === selectedModel;
                      return (
                        <button
                          key={m.id}
                          type="button"
                          role="option"
                          aria-selected={active}
                          onClick={() => { setSelectedModel(m.id); setModelMenuOpen(false); }}
                          style={{
                            display: "flex", alignItems: "center", gap: 8,
                            padding: "7px 10px", borderRadius: 7,
                            border: "none", textAlign: "left", cursor: "pointer",
                            background: active ? "var(--accent-soft)" : "transparent",
                            color: active ? "var(--accent-ink)" : "var(--ink)",
                            fontFamily: "var(--font)", fontSize: 12, fontWeight: 600,
                          }}
                          onMouseEnter={(e) => {
                            if (!active) e.currentTarget.style.background = "var(--surface-2)";
                          }}
                          onMouseLeave={(e) => {
                            if (!active) e.currentTarget.style.background = "transparent";
                          }}
                        >
                          <span style={{
                            width: 6, height: 6, borderRadius: "50%",
                            background: active ? "var(--accent)" : "var(--ink-4)",
                            flexShrink: 0,
                          }} />
                          <span style={{ flex: 1 }}>{m.label}</span>
                          <span style={{
                            fontFamily: "var(--font-mono)",
                            fontSize: 10, color: "var(--ink-3)",
                            fontVariantNumeric: "tabular-nums",
                          }}>
                            {m.contextWindow >= 1_000_000
                              ? `${m.contextWindow / 1_000_000}M`
                              : `${m.contextWindow / 1_000}K`}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
              <button
                type="button"
                className="send-btn"
                onClick={() => handleSubmit()}
                disabled={isStreaming || !input.trim()}
                title="Send"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}


/* ── Claude Code-style Status Bar ── */

function ContextWindowRing({ tokens, modelId }: { tokens: number; modelId: string }) {
  // Mini ring matching the readiness hero's vocabulary: track on
  // var(--line), fill tier-mapped (green < 70%, amber 70-89%, red ≥ 90%),
  // numeric % inside. Sits in the composer footer next to the model
  // pill — small enough to read as a status icon, big enough to read
  // the percentage at a glance.
  const ceiling = MODELS.find((m) => m.id === modelId)?.contextWindow || 200_000;
  const pct = Math.min(100, Math.max(0, (tokens / ceiling) * 100));
  const fillColor =
    pct >= 90 ? "var(--must, #B91C1C)" :
    pct >= 70 ? "#B45309" :
    "var(--accent)";
  const fmt = (n: number) =>
    n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` :
    n >= 1_000 ? `${Math.round(n / 1_000)}K` :
    `${n}`;
  // SVG ring geometry. r=22 + strokeWidth=8 in a 60×60 viewBox keeps
  // the ring crisp while leaving room for the centered % label.
  const ringR = 22;
  const ringC = 2 * Math.PI * ringR;
  const dashOffset = ringC - (pct / 100) * ringC;

  return (
    <span
      title={`Context window — ${tokens.toLocaleString()} of ${ceiling.toLocaleString()} tokens used (${fmt(tokens)}/${fmt(ceiling)})`}
      style={{
        position: "relative",
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        width: 28, height: 28,
        flexShrink: 0,
      }}
    >
      <svg width="28" height="28" viewBox="0 0 60 60">
        <circle
          cx="30" cy="30" r={ringR}
          fill="none"
          stroke="var(--line)"
          strokeWidth="8"
        />
        <circle
          cx="30" cy="30" r={ringR}
          fill="none"
          stroke={fillColor}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={ringC}
          strokeDashoffset={dashOffset}
          transform="rotate(-90 30 30)"
          style={{ transition: "stroke-dashoffset .25s ease, stroke .15s ease" }}
        />
      </svg>
      <span style={{
        position: "absolute",
        fontFamily: "var(--font-mono)",
        fontSize: 9, fontWeight: 700,
        fontVariantNumeric: "tabular-nums",
        color: "var(--ink-2)",
        letterSpacing: "-0.02em",
      }}>
        {Math.round(pct)}
      </span>
    </span>
  );
}


function StatusBar({ status, lastStats, isStreaming, modelId }: {
  status: ActiveStatus;
  lastStats: ChatStats | null;
  isStreaming: boolean;
  modelId: string;
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
            status.toolType === "agent" ? "var(--accent-soft, #E0FFEF)" :
            status.toolType === "mcp" ? "var(--blue-light, #dbeafe)" :
            status.toolType === "read" ? "var(--gray-100, #f3f4f6)" :
            status.toolType === "write" ? "var(--orange-light, #fff7ed)" :
            "var(--gray-100)",
            status.toolType === "agent" ? "var(--accent-ink, #003D24)" :
            status.toolType === "mcp" ? "#2563eb" :
            status.toolType === "read" ? "#6b7280" :
            status.toolType === "write" ? "#ea580c" :
            "#6b7280"
          )}>
            <span style={dotStyle(
              status.toolType === "agent" ? "var(--accent-ink, #003D24)" :
              status.toolType === "mcp" ? "#2563eb" :
              status.toolType === "write" ? "#ea580c" : "#6b7280", true
            )} />
            {status.toolType === "agent" && status.detail
              ? `Running ${agentNameFromLabel(status.detail)}`
              : (status.detail || "Tool")}
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

  // Context-window status moved to the composer footer (next to the
  // model dropdown) — modelId / lastStats are still passed in for
  // future header use, but the StatusBar itself only carries the
  // streaming/idle pill + turn-stats now.
  void modelId;

  // Idle state — show last session stats
  if (lastStats?.numTurns) {
    return (
      <div style={barStyle}>
        <span style={pillStyle("var(--accent-soft)", "var(--accent-ink)")}>
          <span style={dotStyle("var(--accent)")} />
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
      <span style={pillStyle("var(--accent-soft)", "var(--accent-ink)")}>
        <span style={dotStyle("var(--accent)")} />
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

  // Design v2 tools-bar: collapsed shows "N tool calls · breakdown" with
  // chevron; expanded shows a detail row of act-chips + the full log.
  // "N tool calls" = actual tool invocations only. Thinking blocks
  // surface as a separate ", N thinking" entry in the summary, not
  // as part of the count.
  const totalActions = tools.length;
  const summaryParts: string[] = [];
  const groupBadges: { cls: string; label: string }[] = [];
  const mcpCount = groups.mcp || 0;
  const readCount = (groups.read || 0);
  const writeCount = (groups.write || 0) + (groups.bash || 0);
  const agentCount = groups.agent || 0;
  const otherCount = (groups.other || 0) + (groups.search || 0);
  // Agent calls get their own slot in the summary so the user sees
  // exactly which sub-agent ran (e.g. "1 agent · story-tech-agent").
  if (agentCount > 0) {
    const firstAgent = tools.find((t) => inferToolType(t) === "agent");
    const name = firstAgent ? agentNameFromLabel(firstAgent) : "agent";
    const more = agentCount > 1 ? ` (+${agentCount - 1})` : "";
    summaryParts.push(`${agentCount} agent · ${name}${more}`);
    groupBadges.push({ cls: "a-agent", label: `${agentCount} agent${more ? ` ${more}` : ""}` });
  }
  if (mcpCount > 0) { summaryParts.push(`${mcpCount} MCP`); groupBadges.push({ cls: "a-mcp", label: `${mcpCount} MCP` }); }
  if (readCount + writeCount + otherCount > 0) {
    const n = readCount + writeCount + otherCount;
    summaryParts.push(`${n} other`);
    groupBadges.push({ cls: "a-other", label: `${n} other` });
  }
  if (thinkingCount && thinkingCount > 0) {
    summaryParts.push(`${thinkingCount} thinking`);
    groupBadges.push({ cls: "a-think", label: `${thinkingCount} thinking` });
  }
  const summary = summaryParts.length ? `· ${summaryParts.join(", ")}` : "";

  return (
    <div className={`msg-card-tools${expanded ? " expanded" : ""}`}>
      {/* Collapsed toggle — matches design's .tools-bar > .tools-toggle */}
      <div className="tools-bar">
        <button className="tools-toggle" type="button" onClick={() => setExpanded(!expanded)}>
          <svg className="tt-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
          </svg>
          <span className="tt-count">{totalActions} tool call{totalActions !== 1 ? "s" : ""}</span>
          {summary && <span className="tt-summary">{summary}</span>}
          <svg className="tt-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
      </div>

      {/* Expanded breakdown — chips first, then per-tool log */}
      {expanded && (
        <>
          <div className="tools-detail">
            {groupBadges.map((b) => (
              <span key={b.cls} className={`act-chip ${b.cls}`}>
                <span className="dot" />{b.label}
              </span>
            ))}
          </div>
          {(activityLog && activityLog.length > 0) ? (
            <div className="activity-list">
              {activityLog.map((entry, i) => (
                <div
                  key={i}
                  className={`activity-item ${entry.type === "tool" ? inferToolType(entry.tool || "") : entry.type}`}
                >
                  <div className={`activity-dot ${entry.type === "tool" ? inferToolType(entry.tool || "") : entry.type === "thinking" ? "agent" : ""}`} />
                  <span className="activity-label">
                    {entry.type === "tool" ? entry.tool
                      : entry.type === "thinking" ? "Thinking…"
                      : entry.type === "error" ? `Error: ${entry.content}`
                      : entry.content}
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
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function groupTools(tools: string[]): Record<string, number> {
  const groups: Record<string, number> = {};
  for (const tool of tools) {
    const type = inferToolType(tool);
    const label =
      type === "mcp" ? "mcp" :
      type === "read" ? "read" :
      type === "write" ? "write" :
      type === "bash" ? "bash" :
      type === "agent" ? "agent" : "other";
    groups[label] = (groups[label] || 0) + 1;
  }
  return groups;
}

// Pull "story-tech-agent" out of "@agent-story-tech-agent" — used for
// the live running indicator so the user sees the actual agent name
// instead of a generic "Agent" label.
function agentNameFromLabel(label: string): string {
  if (label.startsWith("@agent-")) return label.slice("@agent-".length);
  if (label.startsWith("@agent")) return label.slice("@agent".length).replace(/^[\s·\-]+/, "") || "agent";
  return label;
}

function inferToolType(tool: string): string {
  if (tool.startsWith("Read ") || tool.startsWith("Grep ") || tool.startsWith("Glob ")) return "read";
  if (tool.startsWith("Edit ") || tool.startsWith("Write ")) return "write";
  if (tool.startsWith("Bash")) return "bash";
  if (tool === "searching tools") return "search";
  // New convention: backend emits `@agent-<name>` for sub-agent calls.
  // Keep legacy "Agent" / "Agent " match so older transcripts still
  // render with the agent style.
  if (tool.startsWith("@agent") || tool === "Agent" || tool.startsWith("Agent ")) return "agent";
  return "mcp";
}


/* ── Inline Activity (compact tool block between text segments) ── */

function InlineActivity({ tools, thinkingCount, isLive, currentTool, currentToolType, isThinkingLive }: {
  tools: string[];
  thinkingCount?: number;
  isLive: boolean;
  /** Tool currently executing — drives the "Running …" header. */
  currentTool?: string;
  currentToolType?: string;
  /** True when the agent is between tools, currently thinking. */
  isThinkingLive?: boolean;
}) {
  // Live activity auto-expands so the user sees the cumulative tool
  // log as it builds. They can still collapse if they prefer.
  const [expanded, setExpanded] = useState<boolean>(isLive);
  // Re-open whenever a stream starts, even if the user previously
  // collapsed the same panel. Without this the second turn in a row
  // stays collapsed because `expanded` was already false.
  useEffect(() => { if (isLive) setExpanded(true); }, [isLive]);
  const groups = groupTools(tools);
  const total = tools.length;

  // Compose the "· 1 agent · story-tech-agent, 2 MCP, 1 other, 2 thinking"
  // summary + detail chips.
  const mcpCount = groups.mcp || 0;
  const agentCount = groups.agent || 0;
  const otherCount = (groups.read || 0) + (groups.write || 0) + (groups.bash || 0)
    + (groups.search || 0) + (groups.other || 0);
  const summaryParts: string[] = [];
  const chips: { cls: string; label: string }[] = [];
  if (agentCount) {
    const firstAgent = tools.find((t) => inferToolType(t) === "agent");
    const name = firstAgent ? agentNameFromLabel(firstAgent) : "agent";
    const more = agentCount > 1 ? ` (+${agentCount - 1})` : "";
    summaryParts.push(`${agentCount} agent · ${name}${more}`);
    chips.push({ cls: "a-agent", label: `${agentCount} agent${more ? ` ${more}` : ""}` });
  }
  if (mcpCount) { summaryParts.push(`${mcpCount} MCP`); chips.push({ cls: "a-mcp", label: `${mcpCount} MCP` }); }
  if (otherCount) { summaryParts.push(`${otherCount} other`); chips.push({ cls: "a-other", label: `${otherCount} other` }); }
  if (thinkingCount) { summaryParts.push(`${thinkingCount} thinking`); chips.push({ cls: "a-think", label: `${thinkingCount} thinking` }); }
  const summary = summaryParts.length ? `· ${summaryParts.join(", ")}` : "";

  // Live header: above the chip strip when streaming, replaces the
  // ActiveIndicator-at-the-bottom pattern. Shows the current running
  // tool or the "thinking" state — always visible alongside the
  // cumulative log so the user sees both the past and the present.
  const liveType = currentTool ? inferToolType(currentTool) : null;
  const liveLabel = currentTool
    ? (liveType === "agent" ? agentNameFromLabel(currentTool) : currentTool)
    : null;

  return (
    <div className={`msg-card-tools${expanded ? " expanded" : ""}${isLive ? " live" : ""}`}>
      <div className="tools-bar">
        <button className="tools-toggle" type="button" onClick={() => setExpanded(!expanded)}>
          <svg className="tt-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
          </svg>
          <span className="tt-count">{total} tool call{total !== 1 ? "s" : ""}</span>
          {summary && <span className="tt-summary">{summary}</span>}
          <svg className="tt-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
      </div>
      {isLive && (liveLabel || isThinkingLive) && (
        <div className={`activity-live activity-live-${liveType || "thinking"}`}>
          <span className="activity-live-dots" aria-hidden>
            <span /><span /><span />
          </span>
          <span className="activity-live-label">
            {isThinkingLive
              ? "Thinking…"
              : liveType === "agent"
                ? <>Running <strong>{liveLabel}</strong></>
                : <>Running <strong>{liveLabel}</strong></>}
          </span>
        </div>
      )}
      {expanded && (
        <>
          <div className="tools-detail">
            {chips.map((c) => (
              <span key={c.cls} className={`act-chip ${c.cls}`}>
                <span className="dot" />{c.label}
              </span>
            ))}
          </div>
          {tools.length > 0 && (
            <div className="activity-list">
              {tools.map((tool, i) => {
                const type = inferToolType(tool);
                const isCurrent = isLive && i === tools.length - 1 && !!currentTool;
                return (
                  <div key={i} className={`activity-item ${type}${isCurrent ? " current" : ""}`}>
                    <div className={`activity-dot ${type}`} />
                    <span className="activity-label">{tool}</span>
                    {isCurrent && <span className="activity-current-tag">running</span>}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}


/* ── Active Indicator (inside message bubble while streaming) ── */

/* ── Processing indicator (for Slack-triggered runs in progress) ── */

function ProcessingIndicator({ source, currentTool }: { source?: string; currentTool?: string }) {
  const label =
    source === "slack" ? "Agent thinking (via Slack)" :
    source === "pipeline" ? "Extracting" :
    source === "reminder" ? "Preparing reminder" :
    "Agent thinking";
  // Same accent-green chip + streaming-dots vocabulary as the meta
  // badge — keeps the visual language of "live work in progress"
  // unified across the meta line and the in-bubble indicator.
  // When a tool call is active, show its name inline so the user sees
  // exactly what the agent is doing right now (e.g. "Extracting · vault.read(...)").
  return (
    <span className="chip green" style={{ marginTop: 2, maxWidth: "100%", overflow: "hidden" }}>
      {label}
      {currentTool && (
        <>
          <span style={{ opacity: 0.55 }}>·</span>
          <span style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10.5,
            opacity: 0.85,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            maxWidth: 320,
          }}>
            {currentTool}
          </span>
        </>
      )}
      <span className="streaming-dots"><span /><span /><span /></span>
    </span>
  );
}


/* ── Slack source badge ── */

/* ── Grouped system notices (consecutive ingestion notices as one list) ── */

function SystemNoticeGroup({ messages, projectId }: { messages: Message[]; projectId: string }) {
  if (messages.length === 0) return null;
  const kind = messages[0].kind || "system";
  const isClientReview = kind === "client_review_submitted";

  // Header theming by kind
  const headerStyle = isClientReview
    ? { color: "#7c3aed", background: "#f5f3ff" }
    : { color: "#059669", background: "var(--green-light)" };

  const headerIcon = isClientReview ? (
    <svg viewBox="0 0 24 24" style={{ width: 11, height: 11, stroke: "currentColor", fill: "none", strokeWidth: 2.5 }}>
      <path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
      <circle cx="8.5" cy="7" r="4" />
      <path d="M20 8v6M23 11h-6" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" style={{ width: 11, height: 11, stroke: "currentColor", fill: "none", strokeWidth: 2.5 }}>
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );

  const headerLabel = isClientReview
    ? `${messages.length} client review${messages.length !== 1 ? "s" : ""} submitted`
    : `${messages.length} document${messages.length !== 1 ? "s" : ""} processed`;

  return (
    <div style={{
      // Indent left to align with chat message bubbles (avatar 30px + gap 12px)
      margin: "10px 0 10px 42px",
      borderRadius: 10,
      background: "#fff",
      border: "1px solid var(--gray-200)",
      boxShadow: "0 1px 3px rgba(15, 23, 42, 0.04)",
      // Responsive: grow with the chat panel width, capped to match
      // .chat-msg max-width (1100px) minus the 42px left indent.
      width: "calc(100% - 42px - 16px)",
      maxWidth: "min(calc(92% - 42px), 1058px)",
      alignSelf: "flex-start",
      flexShrink: 0,
      // Clip child row backgrounds to the rounded corners so the bottom
      // border isn't covered by the last row's flat edge.
      overflow: "hidden",
    }}>
      <div style={{
        padding: "6px 12px",
        fontSize: 10,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: 0.6,
        color: headerStyle.color,
        background: headerStyle.background,
        borderBottom: "1px solid var(--gray-100)",
        borderTopLeftRadius: 9,
        borderTopRightRadius: 9,
        display: "flex",
        alignItems: "center",
        gap: 6,
      }}>
        {headerIcon}
        {headerLabel}
      </div>
      {messages.map((msg, i) => (
        <SystemNotice
          key={(msg as Message)._key || i}
          msg={msg}
          projectId={projectId}
          grouped
          isFirst={i === 0}
          isLast={i === messages.length - 1}
        />
      ))}
    </div>
  );
}


function SystemNotice({
  msg,
  projectId,
  grouped = false,
  isFirst = true,
  isLast = true,
}: {
  msg: Message;
  projectId: string;
  grouped?: boolean;
  isFirst?: boolean;
  isLast?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [expanded, setExpanded] = useState(false);
  const data = (msg.data || {}) as Record<string, unknown>;

  // Client review submission has a distinct shape — render a separate row.
  if (msg.kind === "client_review_submitted") {
    return (
      <ClientReviewNotice
        msg={msg}
        projectId={projectId}
        grouped={grouped}
        isFirst={isFirst}
        isLast={isLast}
      />
    );
  }

  const source = (data.source as string) || "upload";
  const auto = Boolean(data.auto_synced);
  const filename = (data.filename as string) || "Document";
  const documentId = data.document_id as string | undefined;
  const counts = (data.counts as Record<string, number>) || {};
  const readinessAfter = (data.readiness_after ?? data.readiness) as number | undefined;
  const readinessBefore = data.readiness_before as number | undefined;
  const readinessDelta = data.readiness_delta as number | undefined;
  const gapIds = (data.gap_ids as string[] | undefined) || [];
  const reqIds = (data.req_ids as string[] | undefined) || [];

  // void unused projectId param so TS doesn't complain (we keep it in
  // the signature for future per-project routing if needed)
  void projectId;

  const sourceMeta: Record<string, { label: string; color: string; bg: string; border: string; dot: string }> = {
    gmail: { label: "Gmail", color: "#dc2626", bg: "#fef2f2", border: "#fecaca", dot: "#dc2626" },
    google_drive: { label: "Drive", color: "#2563eb", bg: "#eff6ff", border: "#bfdbfe", dot: "#2563eb" },
    slack: { label: "Slack", color: "#7c3aed", bg: "#f5f3ff", border: "#ddd6fe", dot: "#7c3aed" },
    upload: { label: "Upload", color: "#059669", bg: "#ecfdf5", border: "#a7f3d0", dot: "#059669" },
  };
  const m = sourceMeta[source] || sourceMeta.upload;

  const navigate = (tab: string, highlight?: string) => {
    const params = new URLSearchParams();
    params.set("tab", tab);
    if (highlight) params.set("highlight", highlight);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const openDoc = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (documentId) navigate("docs", documentId);
    else navigate("docs", filename);
  };

  // Compact inline chips: short labels, tiny padding.
  type Chip = { short: string; full: string; tab: string; color: string };
  const chips: Chip[] = [];
  if (counts.requirements) chips.push({ short: `+${counts.requirements} reqs`, full: `${counts.requirements} requirement${counts.requirements !== 1 ? "s" : ""}`, tab: "reqs", color: "#059669" });
  if (counts.gaps) chips.push({ short: `+${counts.gaps} gaps`, full: `${counts.gaps} gap${counts.gaps !== 1 ? "s" : ""}`, tab: "gaps", color: "#d97706" });
  if (counts.constraints) chips.push({ short: `+${counts.constraints} cons`, full: `${counts.constraints} constraint${counts.constraints !== 1 ? "s" : ""}`, tab: "constraints", color: "#0891b2" });
  if (counts.contradictions) chips.push({ short: `+${counts.contradictions} ctra`, full: `${counts.contradictions} contradiction${counts.contradictions !== 1 ? "s" : ""}`, tab: "contradictions", color: "#dc2626" });
  if (counts.stakeholders) chips.push({ short: `+${counts.stakeholders} ppl`, full: `${counts.stakeholders} ${counts.stakeholders !== 1 ? "people" : "person"}`, tab: "reqs", color: "#7c3aed" });

  const hasDetails = (gapIds.length + reqIds.length) > 0 ||
    (typeof readinessBefore === "number" && readinessBefore !== readinessAfter);

  // When inside a SystemNoticeGroup, the wrapping container owns the
  // border/background — each row is just a thin line item with a hairline
  // divider above it (except the first row).
  const wrapperStyle: React.CSSProperties = grouped
    ? {
        borderTop: isFirst ? "none" : "1px solid var(--gray-100, #f1f5f9)",
        background: m.bg,
        fontSize: 11,
        color: "var(--gray-700)",
      }
    : {
        margin: "4px 0",
        borderRadius: 8,
        background: m.bg,
        border: `1px solid ${m.border}`,
        fontSize: 11,
        color: "var(--gray-700)",
      };

  void isLast; // reserved — could later add bottom rounding only on last row

  return (
    <div style={wrapperStyle}>
      {/* Single compact row */}
      <div
        onClick={hasDetails ? () => setExpanded(!expanded) : undefined}
        style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "4px 10px",
          cursor: hasDetails ? "pointer" : "default",
          minHeight: 22,
        }}
      >
        {/* Source dot */}
        <span style={{
          width: 6, height: 6, borderRadius: "50%",
          background: m.dot, flexShrink: 0,
        }} title={m.label} />

        {/* Filename — clickable, opens doc */}
        <button
          onClick={openDoc}
          title={`Open ${filename}`}
          style={{
            background: "none", border: "none", padding: 0, cursor: "pointer",
            fontSize: 12, fontWeight: 600, color: "var(--dark)",
            textAlign: "left", minWidth: 0, maxWidth: 280,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            fontFamily: "inherit", flexShrink: 1,
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = m.color)}
          onMouseLeave={(e) => (e.currentTarget.style.color = "var(--dark)")}
        >
          {filename}
        </button>

        {/* Inline chips */}
        {chips.length > 0 && (
          <div style={{ display: "flex", gap: 4, flexShrink: 0, alignItems: "center" }}>
            {chips.map((chip, i) => (
              <button
                key={i}
                onClick={(e) => { e.stopPropagation(); navigate(chip.tab); }}
                title={chip.full}
                style={{
                  padding: "1px 6px", borderRadius: 4,
                  background: "rgba(255,255,255,0.7)", color: chip.color,
                  border: "none", fontSize: 10, fontWeight: 600,
                  cursor: "pointer", fontFamily: "inherit",
                  whiteSpace: "nowrap",
                }}
              >
                {chip.short}
              </button>
            ))}
          </div>
        )}

        {/* Spacer pushes readiness to the right */}
        <div style={{ flex: 1 }} />

        {/* Readiness with delta — right aligned */}
        {typeof readinessAfter === "number" && (
          <span style={{ fontSize: 10, color: "var(--gray-500)", whiteSpace: "nowrap", flexShrink: 0 }}>
            <strong style={{ color: "var(--dark)" }}>{readinessAfter}%</strong>
            {typeof readinessDelta === "number" && readinessDelta !== 0 && (
              <span style={{
                marginLeft: 3,
                color: readinessDelta > 0 ? "#16a34a" : "#dc2626",
                fontWeight: 700,
              }}>
                {readinessDelta > 0 ? "+" : ""}{readinessDelta}
              </span>
            )}
          </span>
        )}

        {/* Tiny source badge */}
        <span style={{
          fontSize: 8, fontWeight: 700, padding: "1px 5px", borderRadius: 4,
          background: "#fff", color: m.color, border: `1px solid ${m.border}`,
          textTransform: "uppercase", letterSpacing: 0.3, flexShrink: 0,
          display: "inline-flex", alignItems: "center", gap: 3,
        }}>
          {auto && (
            <svg viewBox="0 0 24 24" style={{ width: 7, height: 7, fill: "none", stroke: "currentColor", strokeWidth: 3 }}>
              <polyline points="23 4 23 10 17 10" />
              <path d="M3.51 9a9 9 0 0114.85-3.36L23 10" />
            </svg>
          )}
          {m.label}
        </span>

        {/* Expand chevron */}
        {hasDetails && (
          <svg viewBox="0 0 24 24" style={{
            width: 10, height: 10, stroke: "var(--gray-400)", fill: "none",
            strokeWidth: 2.5, flexShrink: 0,
            transform: expanded ? "rotate(180deg)" : "none",
            transition: "transform 0.15s",
          }}>
            <polyline points="6 9 12 15 18 9" />
          </svg>
        )}
      </div>

      {/* Expanded details — only renders when there's something to show */}
      {expanded && hasDetails && (
        <div style={{
          padding: "0 10px 8px 24px",
          display: "flex", flexDirection: "column", gap: 6,
        }}>
          {/* Readiness delta detail */}
          {typeof readinessBefore === "number" && readinessBefore !== readinessAfter && (
            <div style={{ fontSize: 10, color: "var(--gray-500)" }}>
              Readiness changed: <strong>{readinessBefore}%</strong> → <strong>{readinessAfter}%</strong>
            </div>
          )}

          {/* Item id badges */}
          {(reqIds.length > 0 || gapIds.length > 0) && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
              {reqIds.slice(0, 8).map((id) => (
                <button
                  key={id}
                  onClick={(e) => { e.stopPropagation(); navigate("reqs", id); }}
                  title={`Open ${id}`}
                  style={{
                    padding: "1px 6px", borderRadius: 4,
                    background: "#fff", color: "#059669",
                    border: "1px solid #a7f3d0",
                    fontSize: 9, fontWeight: 700, cursor: "pointer",
                    fontFamily: "monospace",
                  }}
                >
                  {id}
                </button>
              ))}
              {reqIds.length > 8 && (
                <span style={{ fontSize: 9, color: "var(--gray-400)", alignSelf: "center" }}>
                  +{reqIds.length - 8}
                </span>
              )}
              {gapIds.slice(0, 8).map((id) => (
                <button
                  key={id}
                  onClick={(e) => { e.stopPropagation(); navigate("gaps", id); }}
                  title={`Open ${id}`}
                  style={{
                    padding: "1px 6px", borderRadius: 4,
                    background: "#fff", color: "#d97706",
                    border: "1px solid #fde68a",
                    fontSize: 9, fontWeight: 700, cursor: "pointer",
                    fontFamily: "monospace",
                  }}
                >
                  {id}
                </button>
              ))}
              {gapIds.length > 8 && (
                <span style={{ fontSize: 9, color: "var(--gray-400)", alignSelf: "center" }}>
                  +{gapIds.length - 8}
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Client review submission notice ── */

function ClientReviewNotice({
  msg,
  projectId,
  grouped = false,
  isFirst = true,
  isLast = true,
}: {
  msg: Message;
  projectId: string;
  grouped?: boolean;
  isFirst?: boolean;
  isLast?: boolean;
}) {
  const data = (msg.data || {}) as Record<string, unknown>;
  const round = (data.round as number) ?? 1;
  const clientName = (data.client_name as string) || "Client";
  const confirmed = (data.confirmed as number) || 0;
  const discussed = (data.discussed as number) || 0;
  const gapsAnswered = (data.gaps_answered as number) || 0;
  const readiness = data.readiness as number | undefined;

  const theme = { bg: "#f5f3ff", border: "#ddd6fe", color: "#7c3aed", chipBg: "#ede9fe" };

  const openReview = (e: React.MouseEvent) => {
    e.stopPropagation();
    // Topbar listens for this event and opens ClientReviewModal — avoids
    // threading props through ProjectShell just to open a modal.
    window.dispatchEvent(new CustomEvent("open-client-review"));
  };

  const wrapperStyle: React.CSSProperties = grouped
    ? {
        borderTop: isFirst ? "none" : "1px solid var(--gray-100, #f1f5f9)",
        background: theme.bg,
        fontSize: 11, color: "var(--gray-700)",
      }
    : {
        margin: "4px 0", borderRadius: 8,
        background: theme.bg, border: `1px solid ${theme.border}`,
        fontSize: 11, color: "var(--gray-700)",
      };

  void isLast;

  return (
    <div style={wrapperStyle}>
      {/* Single compact row — mirrors DocumentIngestNotice layout */}
      <div
        style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "4px 10px",
          minHeight: 22,
        }}
      >
        {/* Source dot (purple = review) */}
        <span style={{
          width: 6, height: 6, borderRadius: "50%",
          background: theme.color, flexShrink: 0,
        }} title="Client review" />

        {/* Round + client name — shrinkable with ellipsis */}
        <button
          onClick={openReview}
          title={`Open review round ${round}`}
          style={{
            background: "none", border: "none", padding: 0, cursor: "pointer",
            textAlign: "left", minWidth: 0, maxWidth: 280,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            fontFamily: "inherit", flexShrink: 1,
            display: "inline-flex", alignItems: "center", gap: 5,
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = theme.color)}
          onMouseLeave={(e) => (e.currentTarget.style.color = "var(--dark)")}
        >
          <span style={{
            fontSize: 9, fontWeight: 800, padding: "1px 5px", borderRadius: 3,
            background: "#fff", color: theme.color, border: `1px solid ${theme.border}`,
            letterSpacing: 0.3, flexShrink: 0,
          }}>
            R{round}
          </span>
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--dark)" }}>
            {clientName}
          </span>
        </button>

        {/* Inline chips — nowrap, flex-shrink 0 so they stay on one line */}
        <div style={{ display: "flex", gap: 4, flexShrink: 0, alignItems: "center" }}>
          {confirmed > 0 && (
            <span style={{
              padding: "1px 6px", borderRadius: 4,
              background: "rgba(255,255,255,0.7)", color: "#059669",
              fontSize: 10, fontWeight: 600, whiteSpace: "nowrap",
            }}>
              +{confirmed} confirmed
            </span>
          )}
          {discussed > 0 && (
            <span style={{
              padding: "1px 6px", borderRadius: 4,
              background: "rgba(255,255,255,0.7)", color: "#d97706",
              fontSize: 10, fontWeight: 600, whiteSpace: "nowrap",
            }}>
              +{discussed} flagged
            </span>
          )}
          {gapsAnswered > 0 && (
            <span style={{
              padding: "1px 6px", borderRadius: 4,
              background: "rgba(255,255,255,0.7)", color: theme.color,
              fontSize: 10, fontWeight: 600, whiteSpace: "nowrap",
            }}>
              +{gapsAnswered} answered
            </span>
          )}
        </div>

        {/* Spacer pushes right cluster */}
        <div style={{ flex: 1 }} />

        {/* Readiness */}
        {typeof readiness === "number" && (
          <span style={{ fontSize: 10, color: "var(--gray-500)", whiteSpace: "nowrap", flexShrink: 0 }}>
            <strong style={{ color: "var(--dark)" }}>{readiness}%</strong>
          </span>
        )}

        {/* Source pill (REVIEW) */}
        <span style={{
          fontSize: 8, fontWeight: 700, padding: "1px 5px", borderRadius: 4,
          background: "#fff", color: theme.color, border: `1px solid ${theme.border}`,
          textTransform: "uppercase", letterSpacing: 0.3, flexShrink: 0,
        }}>
          Review
        </span>
      </div>

    </div>
  );
}


// Badge that surfaces "this message was NOT typed by you" — for pipeline
// extractions (document upload → agent runs) and reminder fires (scanner
// → prep agent runs). Puts the trigger source next to the Discovery
// Assistant label so the PM can tell at a glance that an assistant
// message came from an automated path rather than their own chat turn.
//
// Inline SVGs (not emoji) so the badges match the rest of the app's icon
// language — same 24-viewBox, stroke-based style used in Topbar + Sidebar.
// Single icon set, sized + stroked to match every other meta-line glyph.
// Inline so the meta stays self-contained (no extra import surface).
const _IconDoc = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
    <polyline points="14 2 14 8 20 8" />
  </svg>
);
const _IconAlert = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
    <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);
const _IconBell = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
    <path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.73 21a2 2 0 01-3.46 0" />
  </svg>
);

function TriggerBadge({ source, kind, filename, reminderLabel }: {
  source: "pipeline" | "reminder";
  kind?: string;
  filename?: string;
  reminderLabel?: string;
}) {
  // Every pipeline + reminder kind renders as plain meta-line text with a
  // single small icon — no green/amber pill, no separate chip surface.
  // The meaningful context (filename / reminder label) is the actual signal
  // the user looks for; chip colour added redundant noise on top of the
  // ghost skeleton, the activity panel, or the surrounding meta items.
  type Tone = "default" | "danger" | "muted";
  type Bit = { icon: React.ReactNode; text: string; tone: Tone; running: boolean; tooltip: string };

  const bit: Bit | null = (() => {
    if (source === "pipeline") {
      const fn = filename || "document";
      const tooltip = "Auto-triggered by a document upload.";
      if (kind === "extraction_running") {
        return { icon: <_IconDoc />, text: `Extracting ${fn}`, tone: "default", running: true, tooltip };
      }
      if (kind === "extraction_failed") {
        return { icon: <_IconAlert />, text: `Failed to extract ${fn}`, tone: "danger", running: false, tooltip };
      }
      // extraction_done (and the historic "Upload" fallback)
      return { icon: <_IconDoc />, text: `Extracted from ${fn}`, tone: "muted", running: false, tooltip };
    }
    // reminder
    const lbl = reminderLabel || "reminder";
    const tooltip = "Auto-triggered by a reminder firing. Scheduled by you earlier.";
    if (kind === "reminder_prep") {
      return { icon: <_IconBell />, text: `Preparing ${lbl}`, tone: "default", running: true, tooltip };
    }
    if (kind === "reminder_prep_failed") {
      return { icon: <_IconAlert />, text: `Reminder failed: ${lbl}`, tone: "danger", running: false, tooltip };
    }
    // reminder_prep_done / reminder_delivered / fallback
    return { icon: <_IconBell />, text: `Reminder · ${lbl}`, tone: "muted", running: false, tooltip };
  })();

  if (!bit) return null;

  const color =
    bit.tone === "danger" ? "var(--must, #B91C1C)" :
    bit.tone === "muted"  ? "var(--ink-3)" :
    "var(--ink-2)";

  return (
    <>
      <span className="dot-sep">·</span>
      <span
        title={bit.tooltip}
        style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          color, minWidth: 0, maxWidth: 360,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          fontWeight: 500,
        }}
      >
        {bit.icon}
        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{bit.text}</span>
        {bit.running && <span className="streaming-dots"><span /><span /><span /></span>}
      </span>
    </>
  );
}


function SlackBadge({ msg }: { msg: Message }) {
  const channel = msg.slack_channel_name ? `#${msg.slack_channel_name}` : null;
  const isAssistant = msg.role === "assistant";
  return (
    <span
      title={
        isAssistant
          ? `Replied in Slack${channel ? ` (${channel})` : ""}`
          : `Sent from Slack${channel ? ` in ${channel}` : ""}`
      }
      style={{
        display: "inline-flex", alignItems: "center", gap: 4,
        fontSize: 9, fontWeight: 600, padding: "2px 7px",
        borderRadius: 8, background: "#f3e8ff", color: "#7c3aed",
        marginLeft: 4,
      }}
    >
      <svg viewBox="0 0 24 24" style={{ width: 9, height: 9, fill: "currentColor" }}>
        <path d="M5.04 15.165a2.523 2.523 0 0 1-2.52 2.523A2.523 2.523 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.524h2.52v2.524zm1.27 0a2.527 2.527 0 0 1 2.521-2.524 2.527 2.527 0 0 1 2.522 2.524v6.31A2.527 2.527 0 0 1 8.832 24a2.527 2.527 0 0 1-2.521-2.525v-6.31zM8.832 5.042a2.523 2.523 0 0 1-2.521-2.523A2.523 2.523 0 0 1 8.832 0a2.527 2.527 0 0 1 2.522 2.522v2.523H8.832zm0 1.271a2.523 2.523 0 0 1 2.522 2.522 2.523 2.523 0 0 1-2.522 2.522H2.522A2.527 2.527 0 0 1 0 8.836a2.523 2.523 0 0 1 2.522-2.523h6.31zm10.124 2.522a2.523 2.523 0 0 1 2.522-2.522A2.523 2.523 0 0 1 24 8.836a2.523 2.523 0 0 1-2.522 2.522h-2.522V8.835zm-1.27 0a2.523 2.523 0 0 1-2.523 2.522 2.527 2.527 0 0 1-2.522-2.522v-6.31A2.527 2.527 0 0 1 15.163 0a2.523 2.523 0 0 1 2.522 2.522v6.313zm-2.523 10.122a2.523 2.523 0 0 1 2.522 2.522A2.523 2.523 0 0 1 15.163 24a2.523 2.523 0 0 1-2.522-2.522v-2.522h2.522zm0-1.27a2.523 2.523 0 0 1-2.522-2.522 2.523 2.523 0 0 1 2.522-2.523h6.31A2.527 2.527 0 0 1 24 15.165a2.523 2.523 0 0 1-2.522 2.522h-6.31z"/>
      </svg>
      {isAssistant ? "→ Slack" : "Slack"}
      {channel && <span style={{ opacity: 0.7 }}>· {channel}</span>}
    </span>
  );
}


function ActiveIndicator({ status }: { status: ActiveStatus }) {
  // For sub-agent calls, surface the canonical agent name so the user
  // sees "Running story-tech-agent…" instead of a generic "Agent" or a
  // long "@agent-…" string.
  const toolLabel = status.detail
    ? (status.toolType === "agent"
        ? `Running ${agentNameFromLabel(status.detail)}...`
        : `Running ${status.detail}...`)
    : "Running tool...";
  const toolColor = status.toolType === "agent" ? "var(--accent-ink, #003D24)" : "#2563eb";
  const phases: Record<string, { label: string; color: string }> = {
    thinking: { label: "Thinking...", color: "#7c3aed" },
    tool: { label: toolLabel, color: toolColor },
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

  // Ordered list items — collect consecutive, tolerating a blank line between items
  // (LLMs often emit each item as "1." with blank-line separators; we merge into one <ol>
  // so the browser auto-numbers 1, 2, 3, … regardless of the source digit.)
  html = html.replace(/((?:^\d+\. .+$\n(?:\n(?=\d+\. ))?)+)/gm, (block) => {
    const items = block.trim().split(/\n+/).map(l => l.replace(/^\d+\. /, ""));
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

  // Standard markdown [text](url) links — preserve BEFORE backtick/path
  // handling so a link like [📄 brief.md](/projects/.../vault?path=...) survives
  // intact instead of the backtick-less filename getting auto-linked by the
  // bare-file-path pass below.
  t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label, href) => {
    const isInternal = href.startsWith("/") && !href.startsWith("//");
    const attrs = isInternal
      ? `data-route="${href}" style="color:#059669;font-weight:600;cursor:pointer;border-bottom:1px dashed #059669;text-decoration:none"`
      : `href="${href}" target="_blank" rel="noopener noreferrer" style="color:#059669;text-decoration:underline"`;
    return slot(`<a ${attrs}>${label}</a>`);
  });
  // File paths in backticks → slot
  t = t.replace(/`([^`]*\.(?:md|json|yaml|yml|txt|py|ts|tsx|js|sh))`/g, (_m, path) => {
    const name = path.split("/").pop() || path;
    return slot(`<a ${FS} data-file="${path}" title="${path}">📄 ${name}</a>`);
  });
  // Remaining backticks → slot
  t = t.replace(/`([^`]+)`/g, (_m, code) => slot(`<code ${CS}>${code}</code>`));
  // Directory paths → slot. Guard against finding-id strings like
  // "GAP-008/009/010" backtracking into "GAP-008/009/" — the trailing
  // slash satisfies the regex even when no real path is intended. The
  // bare finding-id substitution below tokenizes each id individually.
  t = t.replace(/(?<!["a-zA-Z])(\.?[\w.-]+(?:\/[\w.-]+)+\/)/g, (m, path) => {
    if (/^(BR|GAP|CON|CTR)-\d/.test(path)) return m;
    return slot(`<a ${FS} data-file="${path}" title="${path}">📁 ${path}</a>`);
  });
  // Bare file paths → slot
  t = t.replace(/(?<!["\/a-zA-Z\x01])((?:[\w.-]+\/)+[\w.-]+\.(?:md|json|yaml|yml|txt|py|ts|tsx|js|sh))(?![a-zA-Z])/g, (_m, path) => {
    const name = path.split("/").pop() || path;
    return slot(`<a ${FS} data-file="${path}" title="${path}">📄 ${name}</a>`);
  });
  // Wikilinks
  t = t.replace(/\[\[([^\]]+)\]\]/g, (_m, target) => slot(`<a ${WS} data-wiki="${target}">${target}</a>`));
  // Bare finding IDs in prose → tokenized .chat-ref pills. Styling
  // lives in chat.css; per-kind variant classes (.chat-ref-br,
  // .chat-ref-gap, etc.) paint the accent color. Keeps the renderer
  // free of inline styles so theme changes propagate.
  t = t.replace(/\b(BR|GAP|CON|CTR)-\d{3,}\b/g, (id, prefix) => {
    const tabMap: Record<string, string> = {
      BR: "reqs", GAP: "gaps",
      CON: "constraints", CTR: "contradictions",
    };
    const tab = tabMap[prefix];
    const variant = prefix.toLowerCase();
    return slot(
      `<a data-finding-id="${id}" data-finding-tab="${tab}" ` +
      `class="chat-ref chat-ref-${variant}">${id}</a>`
    );
  });
  // Bold / italic
  t = t.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/\*(.+?)\*/g, '<em>$1</em>');
  // Restore slots
  t = t.replace(/\x01S(\d+)\x01/g, (_m, i) => slots[parseInt(i)]);
  return t;
}
