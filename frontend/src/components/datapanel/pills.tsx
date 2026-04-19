"use client";

// Presentation-only helpers shared across DataPanel tabs. No state, no
// data fetching — just pills, badges, and empty-state markers. Extracted
// from DataPanel.tsx so the main file can focus on orchestration.

import type { ReqClientFeedback, GapClientFeedback } from "@/lib/api";


export function Chevron({ open }: { open?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" style={{ width: 14, height: 14, stroke: "var(--gray-400)", fill: "none", strokeWidth: 2, transition: "transform 0.2s", transform: open ? "rotate(90deg)" : "none" }}>
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}


export function TypeBadge({ type }: { type: string }) {
  const labels: Record<string, { label: string; bg: string; color: string }> = {
    functional: { label: "Functional", bg: "#dbeafe", color: "#2563eb" },
    non_functional: { label: "Non-Func", bg: "#f3e8ff", color: "#7c3aed" },
    business: { label: "Business", bg: "#d1fae5", color: "#059669" },
    technical: { label: "Technical", bg: "#fef3c7", color: "#d97706" },
    organizational: { label: "Org", bg: "#fee2e2", color: "#dc2626" },
  };
  const t = labels[type] || { label: type || "—", bg: "#f3f4f6", color: "#6b7280" };
  return (
    <span style={{
      fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 4,
      background: t.bg, color: t.color, whiteSpace: "nowrap", textTransform: "uppercase",
      letterSpacing: "0.3px",
    }}>
      {t.label}
    </span>
  );
}


export function PriBadge({ priority }: { priority: string }) {
  const cls = priority === "must" ? "high" : priority === "should" ? "medium" : "low";
  return <span className={`sev-badge ${cls}`}>{priority?.toUpperCase()}</span>;
}


export function SevBadge({ severity }: { severity: string }) {
  return <span className={`sev-badge ${severity}`}>{severity.charAt(0).toUpperCase() + severity.slice(1)}</span>;
}


export function StatusPill({ status, label }: { status: string; label?: string }) {
  const display = label || status;
  const cls = status === "confirmed" || status === "resolved" ? "resolved" : status === "dropped" || status === "failed" ? "dropped" : status === "discussed" ? "in-progress" : "open";
  return (
    <span className={`gap-status-pill ${cls}`}>
      <span style={{ width: 5, height: 5, borderRadius: "50%", background: "currentColor", display: "inline-block" }} />
      {" "}{display}
    </span>
  );
}


export function GapStatusPill({ status }: { status: string }) {
  return <span className={`gap-status-pill ${status}`}>{status.replace("-", " ")}</span>;
}


// Color map for filter chips — each value lights up in its status color
// when active, matching the corresponding badge/pill elsewhere in the UI.
const FILTER_CHIP_COLORS: Record<string, { bg: string; fg: string; border: string }> = {
  // priority
  must: { bg: "#fef2f2", fg: "#dc2626", border: "#fecaca" },
  should: { bg: "#fffbeb", fg: "#d97706", border: "#fde68a" },
  could: { bg: "#eff6ff", fg: "#2563eb", border: "#bfdbfe" },
  wont: { bg: "#f3f4f6", fg: "#6b7280", border: "#e5e7eb" },
  // req status
  confirmed: { bg: "#d1fae5", fg: "#059669", border: "#a7f3d0" },
  discussed: { bg: "#fef3c7", fg: "#b45309", border: "#fde68a" },
  proposed: { bg: "#fef3c7", fg: "#d97706", border: "#fde68a" },
  // gap status
  open: { bg: "#fef3c7", fg: "#b45309", border: "#fde68a" },
  resolved: { bg: "#d1fae5", fg: "#059669", border: "#a7f3d0" },
  dismissed: { bg: "#f3f4f6", fg: "#6b7280", border: "#e5e7eb" },
  // default (All)
  all: { bg: "var(--green-light)", fg: "#059669", border: "var(--green)" },
};

export function FilterChip({
  value, label, active, onClick,
}: {
  value: string; label: string; active: boolean; onClick: () => void;
}) {
  const c = FILTER_CHIP_COLORS[value] || FILTER_CHIP_COLORS.all;
  return (
    <button
      onClick={onClick}
      style={{
        padding: "3px 10px", borderRadius: 16,
        fontSize: 11, fontWeight: 600,
        border: `1px solid ${active ? c.border : "var(--gray-200)"}`,
        background: active ? c.bg : "var(--white)",
        color: active ? c.fg : "var(--gray-500)",
        cursor: "pointer", transition: "all 0.15s",
        fontFamily: "var(--font)",
        textTransform: "capitalize",
        whiteSpace: "nowrap",
      }}
    >{label}</button>
  );
}


export function ReqClientBadge({ fb }: { fb: ReqClientFeedback | undefined }) {
  if (!fb) return <span style={{ color: "var(--gray-300)", fontSize: 11 }}>—</span>;
  const meta = fb.action === "confirm"
    ? { icon: "✓", label: "Confirmed", color: "#059669", bg: "#d1fae5", border: "#a7f3d0" }
    : { icon: "◐", label: "Discuss", color: "#b45309", bg: "#fef3c7", border: "#fde68a" };
  const tip = [
    `${meta.label} by ${fb.client_name || "client"} · round ${fb.round}`,
    fb.note ? `"${fb.note}"` : null,
    fb.submitted_at ? new Date(fb.submitted_at).toLocaleString() : null,
  ].filter(Boolean).join("\n");
  return (
    <span
      title={tip}
      style={{
        display: "inline-flex", alignItems: "center", gap: 4,
        fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 10,
        background: meta.bg, color: meta.color, border: `1px solid ${meta.border}`,
        whiteSpace: "nowrap",
      }}
    >
      {meta.icon} {meta.label}
      <span style={{ fontWeight: 600, opacity: 0.7 }}>r{fb.round}</span>
    </span>
  );
}


export function GapClientBadge({ fb }: { fb: GapClientFeedback | undefined }) {
  if (!fb) return <span style={{ color: "var(--gray-300)", fontSize: 11 }}>—</span>;
  const tip = [
    `Answered by ${fb.client_name || "client"} · round ${fb.round}`,
    fb.answer ? `"${fb.answer}"` : null,
    fb.submitted_at ? new Date(fb.submitted_at).toLocaleString() : null,
  ].filter(Boolean).join("\n");
  return (
    <span
      title={tip}
      style={{
        display: "inline-flex", alignItems: "center", gap: 4,
        fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 10,
        background: "#dbeafe", color: "#1d4ed8", border: "1px solid #bfdbfe",
        whiteSpace: "nowrap",
      }}
    >
      ✎ Answered
      <span style={{ fontWeight: 600, opacity: 0.7 }}>r{fb.round}</span>
    </span>
  );
}


export function SourceBadges({ sourceDoc, sources, person }: {
  sourceDoc?: string;
  sources?: Array<{ filename?: string; doc_id?: string }>;
  version?: number;
  person?: string;
}) {
  // Build the deduped list of source filenames — primary first, extras after
  const allNames: string[] = [];
  if (sourceDoc) allNames.push(sourceDoc);
  if (sources) {
    for (const s of sources) {
      const name = s.filename || s.doc_id?.slice(0, 8) || "doc";
      if (!allNames.includes(name)) allNames.push(name);
    }
  }

  if (allNames.length === 0) return <span style={{ color: "var(--gray-300)" }}>—</span>;

  const primary = allNames[0];
  const extraCount = allNames.length - 1;
  const truncated = primary.length > 20 ? primary.slice(0, 18) + "…" : primary;
  // Combined tooltip so hover reveals all sources + person
  const tooltip = [
    person ? `By: ${person}` : null,
    allNames.length === 1 ? primary : `Sources:\n- ${allNames.join("\n- ")}`,
  ].filter(Boolean).join("\n\n");

  return (
    <div title={tooltip} style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      fontSize: 11, color: "var(--gray-600)", whiteSpace: "nowrap",
    }}>
      <svg viewBox="0 0 24 24" style={{ width: 11, height: 11, stroke: "currentColor", fill: "none", strokeWidth: 2, flexShrink: 0 }}>
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/>
      </svg>
      <span>{truncated}</span>
      {extraCount > 0 && (
        <span style={{
          fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 8,
          background: "var(--gray-100)", color: "var(--gray-500)",
        }}>+{extraCount}</span>
      )}
    </div>
  );
}


export function SourceBadge({ source, autoSynced }: { source?: string; autoSynced?: boolean }) {
  if (!source || source === "upload") return null;
  const meta: Record<string, { label: string; color: string; bg: string; border: string }> = {
    gmail: { label: "Gmail", color: "#dc2626", bg: "#fef2f2", border: "#fecaca" },
    google_drive: { label: "Drive", color: "#2563eb", bg: "#eff6ff", border: "#bfdbfe" },
    slack: { label: "Slack", color: "#7c3aed", bg: "#f5f3ff", border: "#ddd6fe" },
  };
  const m = meta[source] || { label: source, color: "#64748b", bg: "#f1f5f9", border: "#e2e8f0" };
  return (
    <span
      title={autoSynced ? `Auto-synced from ${m.label}` : `Imported from ${m.label}`}
      style={{
        display: "inline-flex", alignItems: "center", gap: 4,
        fontSize: 9, fontWeight: 700, padding: "2px 7px", borderRadius: 10,
        background: m.bg, color: m.color, border: `1px solid ${m.border}`,
        textTransform: "uppercase", letterSpacing: 0.4,
      }}
    >
      {autoSynced && (
        <svg viewBox="0 0 24 24" style={{ width: 9, height: 9, fill: "none", stroke: "currentColor", strokeWidth: 3 }}>
          <polyline points="23 4 23 10 17 10" />
          <path d="M3.51 9a9 9 0 0114.85-3.36L23 10" />
        </svg>
      )}
      {m.label}
    </span>
  );
}


export function EmptyState({ icon, text }: { icon: string; text: string }) {
  return (
    <div style={{ textAlign: "center", padding: "48px 24px", color: "var(--gray-400)" }}>
      <svg viewBox="0 0 24 24" style={{ width: 32, height: 32, stroke: "var(--gray-300)", fill: "none", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round", margin: "0 auto 12px" }}>
        <path d={icon} />
      </svg>
      <div style={{ fontSize: 13, maxWidth: 280, margin: "0 auto" }}>{text}</div>
    </div>
  );
}
