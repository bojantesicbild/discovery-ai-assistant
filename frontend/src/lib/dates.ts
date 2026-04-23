// Shared date-formatting helpers for finding cards + tables.

// Compact "age" label for row subscripts. Today's items show the local
// HH:mm so the PM can tell multiple same-day extractions apart; older
// items collapse to "3d" / "2w" / "4mo" / "1y". Returns empty string
// when the ISO is null/unparseable so callers don't have to null-check.
export function formatAge(iso: string | null | undefined): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (isNaN(t)) return "";
  const ms = Date.now() - t;
  if (ms < 0) return "now";
  const hours = ms / 3_600_000;
  // Same calendar day → show time-of-day (14:32). More informative than
  // "4h" because the PM can see when in the day it happened.
  const now = new Date();
  const when = new Date(t);
  if (
    now.getFullYear() === when.getFullYear() &&
    now.getMonth() === when.getMonth() &&
    now.getDate() === when.getDate()
  ) {
    return when.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  if (hours < 24) return `${Math.floor(hours)}h`;
  const days = hours / 24;
  if (days < 7) return `${Math.floor(days)}d`;
  const weeks = days / 7;
  if (weeks < 5) return `${Math.floor(weeks)}w`;
  const months = days / 30;
  if (months < 12) return `${Math.floor(months)}mo`;
  return `${Math.floor(months / 12)}y`;
}


// Detail-view meta line: "<yyyy-mm-dd HH:mm> · <age>" or, when a close
// date is supplied, "<yyyy-mm-dd HH:mm> · <days open before close>".
// Returns null when the raise date is missing.
export function formatRaisedMeta(
  createdAt: string | null | undefined,
  closedAt?: string | null,
): string | null {
  if (!createdAt) return null;
  const raised = new Date(createdAt);
  const endPoint = closedAt ? new Date(closedAt) : new Date();
  const days = Math.max(0, Math.floor((endPoint.getTime() - raised.getTime()) / 86_400_000));
  // Local date + time so "today 14:32" is obviously different from
  // "today 09:15" — useful when multiple extractions run in a day.
  const dateStr = raised.toLocaleDateString([], { year: "numeric", month: "2-digit", day: "2-digit" });
  const timeStr = raised.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const ageText = closedAt
    ? (days === 0 ? "closed same day" : `${days}d open before close`)
    : (days === 0 ? "today" : `${days}d old`);
  return `${dateStr} ${timeStr} · ${ageText}`;
}
