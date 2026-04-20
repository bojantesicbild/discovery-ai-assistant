"use client";

import { useState } from "react";
import { Reminder } from "@/lib/api";

// Status → (dot color, label) used to color the leading dot and the
// textual status chip. Covers every value in models/reminder.py:STATUSES.
const STATUS_COLORS: Record<string, { dot: string; label: string; bg: string; fg: string }> = {
  pending:    { dot: "#F59E0B", label: "pending",    bg: "#fffbeb", fg: "#92400e" },
  processing: { dot: "#2563eb", label: "processing", bg: "#eff6ff", fg: "#1e40af" },
  prepared:   { dot: "#00E5A0", label: "prepared",   bg: "#f0fdf8", fg: "#065f46" },
  delivered:  { dot: "#64748b", label: "delivered",  bg: "#f1f5f9", fg: "#334155" },
  canceled:   { dot: "#94a3b8", label: "canceled",   bg: "#f8fafc", fg: "#64748b" },
  failed:     { dot: "#EF4444", label: "failed",     bg: "#fef2f2", fg: "#991b1b" },
};

const CANCELABLE = new Set(["pending", "processing", "prepared", "failed"]);

function formatDue(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const now = new Date();
  const same = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  if (same) return `Today ${time}`;
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
  if (d.toDateString() === tomorrow.toDateString()) return `Tomorrow ${time}`;
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday ${time}`;
  const sameYear = d.getFullYear() === now.getFullYear();
  const date = sameYear
    ? d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })
    : d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
  return `${date} ${time}`;
}

function subjectLabel(r: Reminder): string {
  if (r.subject_id) return r.subject_id;
  const raw = (r.raw_request || "").trim();
  if (!raw) return r.subject_type;
  return raw.length > 60 ? raw.slice(0, 60) + "…" : raw;
}

function channelLabel(ch: string): string {
  if (ch === "in_app") return "in-app";
  return ch;
}

interface Props {
  projectId: string;
  reminders: Reminder[];
  loading: boolean;
  onCancel: (reminderId: string) => Promise<void>;
}

export default function RemindersPanel({ reminders, loading, onCancel }: Props) {
  const [canceling, setCanceling] = useState<string | null>(null);

  if (loading) {
    return (
      <div style={{ padding: "24px 16px", textAlign: "center", color: "#94a3b8", fontSize: 13 }}>
        Loading reminders…
      </div>
    );
  }

  // Sort: active first (pending/processing/prepared) by due_at asc,
  // then closed (delivered/canceled/failed) by delivered_at or due_at desc.
  const active = reminders.filter((r) => ["pending", "processing", "prepared"].includes(r.status));
  const closed = reminders.filter((r) => !["pending", "processing", "prepared"].includes(r.status));
  active.sort((a, b) => (a.due_at || "").localeCompare(b.due_at || ""));
  closed.sort((a, b) => (b.delivered_at || b.due_at || "").localeCompare(a.delivered_at || a.due_at || ""));
  const ordered = [...active, ...closed];

  if (ordered.length === 0) {
    return (
      <div style={{ padding: "24px 16px", textAlign: "center", color: "#94a3b8", fontSize: 13 }}>
        <div style={{ marginBottom: 6 }}>No reminders yet</div>
        <div style={{ fontSize: 11 }}>
          Ask in chat: <span style={{ fontFamily: "monospace", color: "#475569" }}>
            &quot;remind me to check BR-003 with Sara tomorrow&quot;
          </span>
        </div>
      </div>
    );
  }

  return (
    <div>
      {ordered.map((r, idx) => {
        const sc = STATUS_COLORS[r.status] || STATUS_COLORS.pending;
        const showDivider = idx > 0 && idx === active.length;
        const isOverdue =
          r.status === "pending" && new Date(r.due_at).getTime() < Date.now();
        return (
          <div key={r.id}>
            {showDivider && (
              <div style={{
                padding: "8px 16px 4px", fontSize: 10, color: "#94a3b8",
                fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase",
                background: "#f8fafc", borderTop: "1px solid var(--gray-100)",
              }}>
                Past
              </div>
            )}
            <div style={{
              padding: "10px 16px", borderBottom: "1px solid var(--gray-50)",
              display: "flex", flexDirection: "column", gap: 4,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span title={r.status} style={{
                  width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
                  background: sc.dot,
                }} />
                <span style={{ fontSize: 12, fontWeight: 600, color: "#0f172a", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {subjectLabel(r)}
                </span>
                <span style={{
                  fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 4,
                  background: sc.bg, color: sc.fg, letterSpacing: "0.03em",
                  textTransform: "uppercase",
                }}>
                  {sc.label}
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: "#64748b", paddingLeft: 16 }}>
                <span title={new Date(r.due_at).toLocaleString()} style={{ color: isOverdue ? "#b91c1c" : "#64748b", fontWeight: isOverdue ? 600 : 400 }}>
                  {isOverdue ? "Overdue · " : ""}
                  {formatDue(r.due_at)}
                </span>
                {r.person && <span>· with {r.person}</span>}
                <span title={`channel: ${r.channel}`}>· {channelLabel(r.channel)}</span>
              </div>
              {r.prep_output_path && (
                <div style={{ fontSize: 10, color: "#94a3b8", paddingLeft: 16, fontFamily: "monospace" }}>
                  {r.prep_output_path.replace(".memory-bank/docs/meeting-prep/", "")}
                </div>
              )}
              {r.error_message && (
                <div style={{ fontSize: 10, color: "#991b1b", paddingLeft: 16 }}>
                  {r.error_message}
                </div>
              )}
              {CANCELABLE.has(r.status) && (
                <div style={{ paddingLeft: 16, marginTop: 2 }}>
                  <button
                    disabled={canceling === r.id}
                    onClick={async () => {
                      setCanceling(r.id);
                      try { await onCancel(r.id); } finally { setCanceling(null); }
                    }}
                    style={{
                      fontSize: 10, fontWeight: 600, color: "#b91c1c",
                      background: "transparent", border: "1px solid #fecaca",
                      borderRadius: 4, padding: "3px 8px", cursor: "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    {canceling === r.id ? "Canceling…" : "Cancel"}
                  </button>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
