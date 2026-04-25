"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Reminder } from "@/lib/api";

// Status → display label + variant slug. Variants map to CSS rules
// in panels.css (.notif-status.pending, .processing, .delivered…)
// so adding a new status only needs a CSS entry, not new inline
// hex codes scattered through the markup.
const STATUS_VARIANT: Record<string, { label: string; variant: string }> = {
  pending:    { label: "pending",    variant: "pending" },
  processing: { label: "processing", variant: "processing" },
  prepared:   { label: "prepared",   variant: "prepared" },
  delivered:  { label: "delivered",  variant: "delivered" },
  canceled:   { label: "canceled",   variant: "canceled" },
  failed:     { label: "failed",     variant: "failed" },
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
  if (ch === "calendar") return "Google Calendar";
  return ch;
}

function recurrenceLabel(rec: string): string | null {
  if (!rec || rec === "none") return null;
  if (rec === "weekdays") return "weekdays";
  return rec;
}


interface Props {
  projectId: string;
  reminders: Reminder[];
  loading: boolean;
  onCancel: (reminderId: string) => Promise<void>;
  onOpen?: () => void;
}


export default function RemindersPanel({ projectId, reminders, loading, onCancel, onOpen }: Props) {
  const [canceling, setCanceling] = useState<string | null>(null);
  const router = useRouter();

  function openInTab(reminderId: string) {
    router.push(`/projects/${projectId}/chat?tab=reminders&r=${reminderId}`);
    onOpen?.();
  }

  if (loading) {
    return (
      <div className="notif-empty" style={{ paddingTop: 28, paddingBottom: 28 }}>
        <span>Loading reminders…</span>
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
      <div className="notif-empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
        <span>No reminders yet</span>
        <span className="notif-empty-hint">
          Ask in chat: <code>&quot;remind me about BR-003 tomorrow&quot;</code>
        </span>
      </div>
    );
  }

  return (
    <ul className="notif-list">
      {ordered.map((r, idx) => {
        const sv = STATUS_VARIANT[r.status] || STATUS_VARIANT.pending;
        const showDivider = idx > 0 && idx === active.length;
        const isOverdue =
          r.status === "pending" && new Date(r.due_at).getTime() < Date.now();
        const isActive = ["pending", "processing", "prepared"].includes(r.status);
        const recur = recurrenceLabel(r.recurrence || "none");
        const fileTail = r.prep_output_path
          ? r.prep_output_path.replace(".memory-bank/docs/meeting-prep/", "")
          : null;
        return (
          <li key={r.id}>
            {showDivider && <div className="notif-list-divider">Past</div>}
            <div
              role="button"
              tabIndex={0}
              className={`notif-item rmd-item${isActive ? " unread" : ""}${isOverdue ? " overdue" : ""}`}
              onClick={() => openInTab(r.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  openInTab(r.id);
                }
              }}
            >
              <span className={`notif-item-dot rmd-dot rmd-dot-${sv.variant}`} aria-hidden />
              <div className="notif-item-body">
                <div className="notif-item-head">
                  <span className="notif-item-title">{subjectLabel(r)}</span>
                  <span className={`rmd-status rmd-status-${sv.variant}`}>
                    {sv.label}
                  </span>
                </div>
                <div className="rmd-meta">
                  <time
                    className={`rmd-due${isOverdue ? " overdue" : ""}`}
                    title={new Date(r.due_at).toLocaleString()}
                  >
                    {isOverdue && "Overdue · "}
                    {formatDue(r.due_at)}
                  </time>
                  {r.person && <span className="rmd-meta-bit">with {r.person}</span>}
                  <span className="rmd-meta-bit" title={`channel: ${r.channel}`}>
                    {channelLabel(r.channel)}
                  </span>
                  {recur && (
                    <span
                      className="rmd-meta-bit rmd-recur"
                      title={`Recurring: ${r.recurrence}${r.recurrence_end_at ? ` until ${new Date(r.recurrence_end_at).toLocaleDateString()}` : " (no end)"}${(r.occurrence_count ?? 0) > 0 ? ` · ${r.occurrence_count} past fires` : ""}`}
                    >
                      ↻ {recur}
                    </span>
                  )}
                </div>
                {fileTail && <div className="rmd-file">{fileTail}</div>}
                {r.error_message && <div className="rmd-error">{r.error_message}</div>}
                {CANCELABLE.has(r.status) && (
                  <button
                    type="button"
                    className="rmd-cancel"
                    disabled={canceling === r.id}
                    onClick={async (e) => {
                      e.stopPropagation();
                      setCanceling(r.id);
                      try { await onCancel(r.id); } finally { setCanceling(null); }
                    }}
                  >
                    {canceling === r.id ? "Canceling…" : "Cancel"}
                  </button>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
