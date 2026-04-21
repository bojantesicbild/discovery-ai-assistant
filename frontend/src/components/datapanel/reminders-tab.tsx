"use client";

// Reminders tab — list + detail for all project reminders.
// Sits next to Requirements / Gaps / Meeting Prep / Handoff / Documents.
// The bell-popover Reminders list stays as a quick-glance; this tab is
// the full browseable surface: filters, search, per-reminder activity
// timeline, and the brief content inline (no navigation to Meeting Prep).

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

const STATUS_COLORS: Record<string, { dot: string; bg: string; fg: string }> = {
  pending:    { dot: "#F59E0B", bg: "#fffbeb", fg: "#92400e" },
  processing: { dot: "#2563eb", bg: "#eff6ff", fg: "#1e40af" },
  prepared:   { dot: "#00E5A0", bg: "#f0fdf8", fg: "#065f46" },
  delivered:  { dot: "#64748b", bg: "#f1f5f9", fg: "#334155" },
  canceled:   { dot: "#94a3b8", bg: "#f8fafc", fg: "#64748b" },
  failed:     { dot: "#EF4444", bg: "#fef2f2", fg: "#991b1b" },
};

const OUTPUT_KIND_COLORS: Record<string, { bg: string; fg: string; label: string }> = {
  notification: { bg: "#f1f5f9", fg: "#475569", label: "Notification" },
  status:       { bg: "#eff6ff", fg: "#1e40af", label: "Status brief" },
  agenda:       { bg: "#f3e8ff", fg: "#7c3aed", label: "Meeting agenda" },
  research:     { bg: "#fef3c7", fg: "#a16207", label: "Research" },
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

  // Re-poll every 30s so the active list reflects recent fires without
  // a manual refresh. Matches the bell-badge polling cadence.
  useEffect(() => {
    const t = setInterval(() => { reload().catch(() => {}); }, 30000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Load detail when a row is expanded
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

    // Active first (soonest due), then past/closed (most recent first).
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
    // Reflect in URL so deep links work (bell → Discovery tab →
    // specific reminder expanded).
    const params = new URLSearchParams(searchParams.toString());
    if (next) params.set("r", next); else params.delete("r");
    router.replace(`?${params.toString()}`, { scroll: false });
  }

  if (loading && reminders.length === 0) {
    return <div style={{ padding: "40px 16px", textAlign: "center", color: "#94a3b8", fontSize: 13 }}>Loading reminders…</div>;
  }

  return (
    <div style={{ padding: "12px 4px 40px" }}>
      {/* Filters + search */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
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
              onClick={() => setFilter(key)}
              style={{
                padding: "5px 10px", borderRadius: 16, border: "1px solid var(--gray-200)",
                background: on ? "#0f172a" : "#fff",
                color: on ? "#fff" : "#475569",
                fontSize: 11, fontWeight: 600, cursor: "pointer",
                fontFamily: "inherit",
                display: "inline-flex", alignItems: "center", gap: 5,
              }}
            >
              {label}
              <span style={{
                fontSize: 10, padding: "1px 6px", borderRadius: 8,
                background: on ? "rgba(255,255,255,0.2)" : "var(--gray-100)",
                color: on ? "#fff" : "#64748b",
              }}>
                {count}
              </span>
            </button>
          );
        })}
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search subject, person, text…"
          style={{
            flex: "1 1 200px", minWidth: 180, padding: "6px 10px", borderRadius: 8,
            border: "1px solid var(--gray-200)", fontSize: 12,
            fontFamily: "inherit", outline: "none",
          }}
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
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {filtered.map((r) => {
            const sc = STATUS_COLORS[r.status] || STATUS_COLORS.pending;
            const ok = OUTPUT_KIND_COLORS[r.output_kind || "notification"];
            const rec = recurrenceLabel(r.recurrence || "none");
            const expanded = expandedId === r.id;
            const overdue = r.status === "pending" && new Date(r.due_at).getTime() < Date.now();
            return (
              <div
                key={r.id}
                style={{
                  border: "1px solid var(--gray-100)", borderRadius: 10,
                  background: "#fff",
                  boxShadow: expanded ? "0 2px 12px rgba(0,0,0,0.06)" : "none",
                  transition: "box-shadow 0.15s",
                }}
              >
                <button
                  onClick={() => toggleRow(r.id)}
                  style={{
                    width: "100%", textAlign: "left", cursor: "pointer",
                    padding: "12px 14px", border: "none", background: "transparent",
                    fontFamily: "inherit",
                    display: "flex", flexDirection: "column", gap: 4,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0, background: sc.dot }} />
                    <span style={{ fontSize: 13, fontWeight: 600, color: "#0f172a", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {subjectLabel(r)}
                    </span>
                    <span style={{
                      fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 4,
                      background: ok.bg, color: ok.fg,
                      letterSpacing: "0.03em", textTransform: "uppercase",
                    }}>{ok.label}</span>
                    <span style={{
                      fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 4,
                      background: sc.bg, color: sc.fg,
                      letterSpacing: "0.03em", textTransform: "uppercase",
                    }}>{r.status}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: "#64748b", paddingLeft: 16, flexWrap: "wrap" }}>
                    <span style={{ color: overdue ? "#b91c1c" : "#64748b", fontWeight: overdue ? 600 : 400 }}>
                      {overdue ? "Overdue · " : ""}
                      {formatDue(r.due_at)}
                    </span>
                    <span>· {channelLabel(r.channel)}</span>
                    {rec && <span style={{ color: "#0e7490", fontWeight: 600 }}>· ↻ {rec}</span>}
                    {(r.occurrence_count ?? 0) > 0 && (
                      <span>· {r.occurrence_count} past fires</span>
                    )}
                  </div>
                </button>

                {expanded && (
                  <div style={{ borderTop: "1px solid var(--gray-100)", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 12 }}>
                    {detailLoading ? (
                      <div style={{ color: "#94a3b8", fontSize: 12 }}>Loading…</div>
                    ) : detail && detail.reminder.id === r.id ? (
                      <DetailBody detail={detail} onCancel={() => handleCancel(r.id)} />
                    ) : (
                      <div style={{ color: "#94a3b8", fontSize: 12 }}>Couldn&apos;t load details.</div>
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
  const ok = OUTPUT_KIND_COLORS[r.output_kind || "notification"];

  return (
    <>
      {/* Metadata grid */}
      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 12px", fontSize: 12 }}>
        <span style={{ color: "#94a3b8" }}>Original request</span>
        <span style={{ color: "#0f172a" }}>{r.raw_request || "—"}</span>
        <span style={{ color: "#94a3b8" }}>Due</span>
        <span style={{ color: "#0f172a" }}>
          {new Date(r.due_at).toLocaleString()}{" "}
          <span style={{ color: "#94a3b8" }}>({new Date(r.due_at).toUTCString().slice(17, 22)} UTC)</span>
        </span>
        <span style={{ color: "#94a3b8" }}>Output kind</span>
        <span style={{ color: ok.fg, fontWeight: 600 }}>{ok.label}</span>
        <span style={{ color: "#94a3b8" }}>Channel</span>
        <span style={{ color: "#0f172a" }}>{channelLabel(r.channel)}</span>
        {r.recurrence && r.recurrence !== "none" && (
          <>
            <span style={{ color: "#94a3b8" }}>Recurrence</span>
            <span style={{ color: "#0f172a" }}>
              {r.recurrence}
              {r.recurrence_end_at ? ` until ${new Date(r.recurrence_end_at).toLocaleDateString()}` : " (no end)"}
              {(r.occurrence_count ?? 0) > 0 ? ` · ${r.occurrence_count} past fires` : ""}
            </span>
          </>
        )}
        {r.external_ref && (
          <>
            <span style={{ color: "#94a3b8" }}>External link</span>
            <a href={r.external_ref} target="_blank" rel="noopener noreferrer" style={{ color: "#059669", textDecoration: "underline" }}>
              {r.channel === "calendar" ? "Open event in Google Calendar" : "Open link"}
            </a>
          </>
        )}
        {r.error_message && (
          <>
            <span style={{ color: "#94a3b8" }}>Last error</span>
            <span style={{ color: "#991b1b" }}>{r.error_message}</span>
          </>
        )}
      </div>

      {/* Brief / output inline */}
      {r.output_kind === "notification" ? (
        <div style={{ padding: 10, borderRadius: 8, background: "var(--gray-50, #f8fafc)", color: "#64748b", fontSize: 12, fontStyle: "italic" }}>
          Notification-only reminder — no output file.
        </div>
      ) : detail.brief_content ? (
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 }}>
            {r.output_kind === "status" ? "Status brief" : "Meeting agenda"}
          </div>
          <div
            className="md-body"
            style={{
              padding: "14px 16px", borderRadius: 8, border: "1px solid var(--gray-100)",
              background: "#fff", fontSize: 12, lineHeight: 1.55, color: "#0f172a",
              maxHeight: 480, overflow: "auto",
            }}
            dangerouslySetInnerHTML={{ __html: renderMarkdown(detail.brief_content) }}
          />
        </div>
      ) : detail.brief_exists ? (
        <div style={{ color: "#94a3b8", fontSize: 12 }}>Brief exists but is too large to render inline.</div>
      ) : null}

      {/* Activity timeline */}
      {detail.activity.length > 0 && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 }}>
            Activity
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {detail.activity.map((a, i) => (
              <div key={i} style={{ display: "flex", gap: 10, fontSize: 12, color: "#475569" }}>
                <span style={{ width: 18, flexShrink: 0, color: "#94a3b8", textAlign: "center" }}>{activityIcon(a.action)}</span>
                <span style={{ flex: 1 }}>{a.summary}</span>
                <span style={{ color: "#94a3b8", fontSize: 10, whiteSpace: "nowrap" }}>
                  {new Date(a.created_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Actions */}
      {cancelable && (
        <div>
          <button
            onClick={onCancel}
            style={{
              fontSize: 11, fontWeight: 600, color: "#b91c1c",
              background: "#fff", border: "1px solid #fecaca",
              borderRadius: 6, padding: "5px 12px", cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Cancel reminder
          </button>
        </div>
      )}
    </>
  );
}
