"use client";

// Presentation-only helpers shared across DataPanel tabs. No state, no
// data fetching — just pills, badges, and empty-state markers. Extracted
// from DataPanel.tsx so the main file can focus on orchestration.

import type { ReqClientFeedback, GapClientFeedback } from "@/lib/api";


export function Chevron({ open }: { open?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" style={{ width: 14, height: 14, stroke: "var(--ink-3)", fill: "none", strokeWidth: 2, transition: "transform 0.2s", transform: open ? "rotate(90deg)" : "none" }}>
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}


const TYPE_VARIANT: Record<string, { label: string; variant: string }> = {
  functional:     { label: "Functional", variant: "blue" },
  non_functional: { label: "Non-Func",   variant: "purple" },
  business:       { label: "Business",   variant: "green" },
  technical:      { label: "Technical",  variant: "amber" },
  organizational: { label: "Org",        variant: "red" },
};

export function TypeBadge({ type }: { type: string }) {
  const t = TYPE_VARIANT[type] || { label: type || "—", variant: "" };
  return <span className={`chip xs uppercase ${t.variant}`}>{t.label}</span>;
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


export function FilterChip({
  value: _value, label, active, onClick,
}: {
  value: string; label: string; active: boolean; onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`panel-filter-btn${active ? " active" : ""}`}
    >
      {label}
    </button>
  );
}


export function ReqClientBadge({ fb }: { fb: ReqClientFeedback | undefined }) {
  if (!fb) return <span className="empty-dash">—</span>;
  const meta = fb.action === "confirm"
    ? { icon: "✓", label: "Confirmed", variant: "green" }
    : { icon: "◐", label: "Discuss",   variant: "amber" };
  const tip = [
    `${meta.label} by ${fb.client_name || "client"} · round ${fb.round}`,
    fb.note ? `"${fb.note}"` : null,
    fb.submitted_at ? new Date(fb.submitted_at).toLocaleString() : null,
  ].filter(Boolean).join("\n");
  return (
    <span title={tip} className={`chip xs ${meta.variant}`}>
      {meta.icon} {meta.label}
      <span style={{ fontWeight: 600, opacity: 0.7 }}>r{fb.round}</span>
    </span>
  );
}


export function GapClientBadge({ fb }: { fb: GapClientFeedback | undefined }) {
  if (!fb) return <span className="empty-dash">—</span>;
  const tip = [
    `Answered by ${fb.client_name || "client"} · round ${fb.round}`,
    fb.answer ? `"${fb.answer}"` : null,
    fb.submitted_at ? new Date(fb.submitted_at).toLocaleString() : null,
  ].filter(Boolean).join("\n");
  return (
    <span title={tip} className="chip xs blue">
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
  const allNames: string[] = [];
  if (sourceDoc) allNames.push(sourceDoc);
  if (sources) {
    for (const s of sources) {
      const name = s.filename || s.doc_id?.slice(0, 8) || "doc";
      if (!allNames.includes(name)) allNames.push(name);
    }
  }

  if (allNames.length === 0) return <span className="empty-dash">—</span>;

  const primary = allNames[0];
  const extraCount = allNames.length - 1;
  const truncated = primary.length > 20 ? primary.slice(0, 18) + "…" : primary;
  const tooltip = [
    person ? `By: ${person}` : null,
    allNames.length === 1 ? primary : `Sources:\n- ${allNames.join("\n- ")}`,
  ].filter(Boolean).join("\n\n");

  return (
    <div title={tooltip} className="source-cluster">
      <svg viewBox="0 0 24 24">
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/>
      </svg>
      <span>{truncated}</span>
      {extraCount > 0 && <span className="extra">+{extraCount}</span>}
    </div>
  );
}


const SOURCE_META: Record<string, { label: string; variant: string }> = {
  gmail:        { label: "Gmail", variant: "red" },
  google_drive: { label: "Drive", variant: "blue" },
  slack:        { label: "Slack", variant: "purple" },
};

export function SourceBadge({ source, autoSynced }: { source?: string; autoSynced?: boolean }) {
  if (!source || source === "upload") return null;
  const m = SOURCE_META[source] || { label: source, variant: "" };
  return (
    <span
      title={autoSynced ? `Auto-synced from ${m.label}` : `Imported from ${m.label}`}
      className={`chip xs uppercase ${m.variant}`}
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
    <div className="empty-state">
      <svg viewBox="0 0 24 24" className="empty-state-icon">
        <path d={icon} />
      </svg>
      <div className="empty-state-text">{text}</div>
    </div>
  );
}
