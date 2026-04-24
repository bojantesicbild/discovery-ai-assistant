"use client";

// Reminders tab — list + detail for all project reminders.
// Sits next to Requirements / Gaps / Meeting Prep / Handoff / Documents.

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  listReminders,
  getReminder,
  cancelReminder,
  type Reminder,
  type ReminderDetail,
} from "@/lib/api";
import { renderMarkdown } from "@/lib/markdown";
import { EmptyState } from "./pills";

type FilterKey = "all" | "active" | "recurring" | "past" | "failed";

const OUTPUT_KIND: Record<string, { label: string; variant: string }> = {
  notification: { label: "Notification",     variant: "" },
  status:       { label: "Status brief",     variant: "blue" },
  agenda:       { label: "Meeting agenda",   variant: "purple" },
  research:     { label: "Research",         variant: "amber" },
};

const STATUS_VARIANT: Record<string, string> = {
  pending:    "amber",
  processing: "blue",
  prepared:   "green",
  delivered:  "",
  canceled:   "",
  failed:     "red",
};

function channelLabel(ch: string): string {
  if (ch === "in_app") return "in-app";
  if (ch === "calendar") return "Google Calendar";
  return ch;
}

function recurrenceLabel(rec: string): string | null {
  if (!rec || rec === "none") return null;
  return rec === "weekdays" ? "weekdays" : rec;
}

function subjectLabel(r: Reminder): string {
  if (r.subject_id) return r.person ? `${r.subject_id} · with ${r.person}` : r.subject_id;
  if (r.person) return `with ${r.person}`;
  const raw = (r.raw_request || "").trim();
  return raw.length > 80 ? raw.slice(0, 80) + "…" : raw || r.subject_type;
}

function formatDue(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const now = new Date();
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  const same = d.toDateString() === now.toDateString();
  if (same) return `Today ${time}`;
  const t = new Date(now); t.setDate(now.getDate() + 1);
  if (d.toDateString() === t.toDateString()) return `Tomorrow ${time}`;
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return `Yesterday ${time}`;
  const sameYear = d.getFullYear() === now.getFullYear();
  const date = sameYear
    ? d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })
    : d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
  return `${date} ${time}`;
}

function activityIcon(action: string): string {
  if (action.includes("scheduled")) return "🗓";
  if (action.includes("prep_started")) return "▶";
  if (action.includes("prep_done") || action.includes("status_rendered")) return "✓";
  if (action.includes("prep_retry")) return "↻";
  if (action.includes("prep_failed") || action.includes("deliver")) return action.includes("failed") ? "⚠" : "📬";
  if (action.includes("canceled")) return "✕";
  if (action.includes("rescheduled")) return "→";
  return "·";
}


export function RemindersTab({ projectId }: { projectId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterKey>("active");
  const [expandedId, setExpandedId] = useState<string | null>(
    searchParams.get("r")
  );
  const [detail, setDetail] = useState<ReminderDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  async function reload() {
    setLoading(true);
    try {
      const rows = await listReminders(projectId);
      setReminders(rows || []);
    } catch {
      setReminders([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { reload(); }, [projectId]);

  useEffect(() => {
    const t = setInterval(() => { reload().catch(() => {}); }, 30000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    if (!expandedId) {
      setDetail(null);
      return;
    }
    setDetailLoading(true);
    getReminder(projectId, expandedId)
      .then(setDetail)
      .catch(() => setDetail(null))
      .finally(() => setDetailLoading(false));
  }, [expandedId, projectId]);

  const filtered = useMemo(() => {
    const isActive = (r: Reminder) => ["pending", "processing", "prepared"].includes(r.status);
    const isRecurring = (r: Reminder) => !!r.recurrence && r.recurrence !== "none";
    const isPast = (r: Reminder) => ["delivered", "canceled"].includes(r.status);
    const isFailed = (r: Reminder) => r.status === "failed";

    let rows = reminders;
    if (filter === "active") rows = rows.filter(isActive);
    else if (filter === "recurring") rows = rows.filter(isRecurring);
    else if (filter === "past") rows = rows.filter(isPast);
    else if (filter === "failed") rows = rows.filter(isFailed);

    if (search.trim()) {
      const needle = search.toLowerCase();
      rows = rows.filter(
        (r) =>
          (r.subject_id || "").toLowerCase().includes(needle) ||
          (r.person || "").toLowerCase().includes(needle) ||
          (r.raw_request || "").toLowerCase().includes(needle),
      );
    }

    return [...rows].sort((a, b) => {
      const aActive = ["pending", "processing", "prepared"].includes(a.status);
      const bActive = ["pending", "processing", "prepared"].includes(b.status);
      if (aActive !== bActive) return aActive ? -1 : 1;
      if (aActive) return (a.due_at || "").localeCompare(b.due_at || "");
      return (b.delivered_at || b.due_at || "").localeCompare(a.delivered_at || a.due_at || "");
    });
  }, [reminders, filter, search]);

  const counts = useMemo(() => ({
    all: reminders.length,
    active: reminders.filter((r) => ["pending", "processing", "prepared"].includes(r.status)).length,
    recurring: reminders.filter((r) => r.recurrence && r.recurrence !== "none").length,
    past: reminders.filter((r) => ["delivered", "canceled"].includes(r.status)).length,
    failed: reminders.filter((r) => r.status === "failed").length,
  }), [reminders]);

  async function handleCancel(reminderId: string) {
    await cancelReminder(projectId, reminderId);
    setReminders((prev) => prev.map((r) => r.id === reminderId ? { ...r, status: "canceled" } : r));
    if (detail?.reminder.id === reminderId) {
      setDetail({ ...detail, reminder: { ...detail.reminder, status: "canceled" } });
    }
  }

  function toggleRow(rid: string) {
    const next = expandedId === rid ? null : rid;
    setExpandedId(next);
    const params = new URLSearchParams(searchParams.toString());
    if (next) params.set("r", next); else params.delete("r");
    router.replace(`?${params.toString()}`, { scroll: false });
  }

  if (loading && reminders.length === 0) {
    return <div className="rem-loading" style={{ textAlign: "center", padding: "40px 16px" }}>Loading reminders…</div>;
  }

  return (
    <div style={{ padding: "12px 4px 40px" }}>
      {/* Filters + search */}
      <div className="rem-filters">
        {([
          ["all",       "All",       counts.all],
          ["active",    "Active",    counts.active],
          ["recurring", "Recurring", counts.recurring],
          ["past",      "Past",      counts.past],
          ["failed",    "Failed",    counts.failed],
        ] as const).map(([key, label, count]) => {
          const on = filter === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={`panel-filter-btn${on ? " active" : ""}`}
            >
              {label}
              <span className="count-pill">{count}</span>
            </button>
          );
        })}
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search subject, person, text…"
          className="rem-search"
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0"
          text={
            reminders.length === 0
              ? 'No reminders yet. Ask in chat: "remind me about BR-001 tomorrow".'
              : "No reminders match this filter."
          }
        />
      ) : (
        <div className="rem-list">
          {filtered.map((r) => {
            const ok = OUTPUT_KIND[r.output_kind || "notification"];
            const statusVariant = STATUS_VARIANT[r.status] || "";
            const rec = recurrenceLabel(r.recurrence || "none");
            const expanded = expandedId === r.id;
            const overdue = r.status === "pending" && new Date(r.due_at).getTime() < Date.now();
            return (
              <div key={r.id} className={`rem-row${expanded ? " expanded" : ""}`}>
                <button type="button" className="rem-head" onClick={() => toggleRow(r.id)}>
                  <div className="rem-head-row">
                    <span className={`rem-status-dot ${r.status}`} />
                    <span className="rem-title">{subjectLabel(r)}</span>
                    <span className={`chip xs uppercase ${ok.variant}`}>{ok.label}</span>
                    <span className={`chip xs uppercase ${statusVariant}`}>{r.status}</span>
                  </div>
                  <div className="rem-meta">
                    <span className={overdue ? "overdue" : ""}>
                      {overdue ? "Overdue · " : ""}
                      {formatDue(r.due_at)}
                    </span>
                    <span>· {channelLabel(r.channel)}</span>
                    {rec && <span className="recur">· ↻ {rec}</span>}
                    {(r.occurrence_count ?? 0) > 0 && (
                      <span>· {r.occurrence_count} past fires</span>
                    )}
                  </div>
                </button>

                {expanded && (
                  <div className="rem-detail">
                    {detailLoading ? (
                      <div className="rem-loading">Loading…</div>
                    ) : detail && detail.reminder.id === r.id ? (
                      <DetailBody detail={detail} onCancel={() => handleCancel(r.id)} />
                    ) : (
                      <div className="rem-loading">Couldn&apos;t load details.</div>
                    )}
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


function DetailBody({ detail, onCancel }: { detail: ReminderDetail; onCancel: () => void }) {
  const r = detail.reminder;
  const cancelable = ["pending", "processing", "prepared", "failed"].includes(r.status);
  const ok = OUTPUT_KIND[r.output_kind || "notification"];

  return (
    <>
      <div className="rem-grid">
        <span className="label">Original request</span>
        <span className="value">{r.raw_request || "—"}</span>
        <span className="label">Due</span>
        <span className="value">
          {new Date(r.due_at).toLocaleString()}{" "}
          <span className="value-muted">({new Date(r.due_at).toUTCString().slice(17, 22)} UTC)</span>
        </span>
        <span className="label">Output kind</span>
        <span className="value" style={{ fontWeight: 600 }}>{ok.label}</span>
        <span className="label">Channel</span>
        <span className="value">{channelLabel(r.channel)}</span>
        {r.recurrence && r.recurrence !== "none" && (
          <>
            <span className="label">Recurrence</span>
            <span className="value">
              {r.recurrence}
              {r.recurrence_end_at ? ` until ${new Date(r.recurrence_end_at).toLocaleDateString()}` : " (no end)"}
              {(r.occurrence_count ?? 0) > 0 ? ` · ${r.occurrence_count} past fires` : ""}
            </span>
          </>
        )}
        {r.external_ref && (
          <>
            <span className="label">External link</span>
            <a href={r.external_ref} target="_blank" rel="noopener noreferrer">
              {r.channel === "calendar" ? "Open event in Google Calendar" : "Open link"}
            </a>
          </>
        )}
        {r.error_message && (
          <>
            <span className="label">Last error</span>
            <span className="value-error">{r.error_message}</span>
          </>
        )}
      </div>

      {r.output_kind === "notification" ? (
        <div className="rem-note">
          Notification-only reminder — no output file.
        </div>
      ) : detail.brief_content ? (
        <div>
          <div className="rem-section-label">
            {r.output_kind === "status" ? "Status brief" : "Meeting agenda"}
          </div>
          <div
            className="rem-brief md-body"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(detail.brief_content) }}
          />
        </div>
      ) : detail.brief_exists ? (
        <div className="rem-loading">Brief exists but is too large to render inline.</div>
      ) : null}

      {detail.activity.length > 0 && (
        <div>
          <div className="rem-section-label">Activity</div>
          <div className="rem-activity">
            {detail.activity.map((a, i) => (
              <div key={i} className="rem-activity-row">
                <span className="icon">{activityIcon(a.action)}</span>
                <span className="summary">{a.summary}</span>
                <span className="ts">
                  {new Date(a.created_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {cancelable && (
        <div>
          <button type="button" className="btn-danger-ghost" onClick={onCancel}>
            Cancel reminder
          </button>
        </div>
      )}
    </>
  );
}
