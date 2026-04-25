"use client";

// Shared building blocks for the right-pane detail view (BR / gap /
// constraint / contradiction / document). All kinds use the same
// .req-detail CSS skeleton from panels.css; this module holds the
// pieces that don't change with kind:
//
//   - useDetailHistory(history)  — fetches + caches the activity log
//                                   for the active item, with reset
//                                   when the item id changes.
//   - DetailHistoryView          — renders the fetched entries.
//   - HeroOverflowMenu           — kebab in the hero with copy-id /
//                                   copy-link actions.
//   - statusActionClass          — maps Action.value/label onto a
//                                   .btn-status colour variant.
//
// RequirementDetailView and FindingDetailView both compose these +
// their kind-specific body so the visual language stays in lockstep.

import { useEffect, useMemo, useRef, useState } from "react";
import { getItemHistory, type HistoryEntry } from "@/lib/api";


export type DetailHistoryRef = {
  projectId: string;
  itemType: string;
  itemId: string;
};


// Hook: returns the history list for the current item plus the
// loading flag. Data is reset to null whenever `itemId` changes so
// switching detail views doesn't show the previous item's log.
// Internally also exposes `reload` for callers that mutate state and
// want to refresh (e.g. after accepting a proposal).
export function useDetailHistory(history: DetailHistoryRef | undefined, active: boolean) {
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!active || !history || entries) return;
    setLoading(true);
    getItemHistory(history.projectId, history.itemType, history.itemId)
      .then((res) => setEntries(res.history))
      .catch(() => setEntries([]))
      .finally(() => setLoading(false));
  }, [active, history, entries]);

  // Reset whenever the item changes — same pattern both detail views
  // had inline.
  useEffect(() => {
    setEntries(null);
  }, [history?.itemId]);

  return useMemo(() => ({ entries, loading }), [entries, loading]);
}


// Renders the list returned by useDetailHistory. Handles loading +
// empty + populated cases. Shape mirrors the previous inline JSX in
// RequirementDetailView so the markup is byte-identical.
export function DetailHistoryView({
  loading, entries,
}: {
  loading: boolean;
  entries: HistoryEntry[] | null;
}) {
  if (loading) return <div className="detail-empty">Loading history…</div>;
  if (!entries || entries.length === 0) {
    return <div className="detail-empty">No history yet.</div>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {entries.map((entry) => (
        <div key={entry.id} className={`history-entry ${entry.action}`}>
          <div className="history-entry-head">
            <span className={`history-entry-action ${entry.action}`}>{entry.action}</span>
            {entry.source_filename && (
              <span className="history-entry-meta">
                from <strong>{entry.source_filename}</strong>
              </span>
            )}
            <span className="history-entry-ts">
              {entry.created_at ? new Date(entry.created_at).toLocaleString() : ""}
            </span>
          </div>
          {entry.action === "update" && Object.keys(entry.old_value || {}).length > 0 && (
            <div className="history-entry-diff">
              {Object.keys(entry.old_value).map((field) => (
                <div key={field} style={{ marginTop: 2 }}>
                  <span className="field">{field}: </span>
                  <span className="old">{String(entry.old_value[field] ?? "")}</span>
                  <span style={{ color: "var(--ink-4)" }}> → </span>
                  <span className="new">{String(entry.new_value[field] ?? "")}</span>
                </div>
              ))}
            </div>
          )}
          {entry.action === "create" && (
            <div className="history-entry-create-line">
              {Object.entries(entry.new_value || {}).map(([k, v]) => (
                <span key={k} style={{ marginRight: 8 }}>
                  <span style={{ color: "var(--ink-3)" }}>{k}:</span> {String(v)}
                </span>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}


// Kebab in the detail hero — Copy ID + Copy link. Closes on outside
// click. The link target is whatever the page URL currently is, so it
// reflects the deep-link query (?tab=reqs&highlight=BR-001 etc.).
export function HeroOverflowMenu({
  displayId,
}: {
  displayId: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [open]);

  function copyId() { try { navigator.clipboard.writeText(displayId); } catch {} }
  function copyLink() { try { navigator.clipboard.writeText(window.location.href); } catch {} }

  return (
    <div ref={ref} style={{ position: "relative", marginLeft: "auto" }}>
      <button
        type="button"
        className="req-detail-overflow"
        onClick={() => setOpen((o) => !o)}
        aria-label="More actions"
        title="More actions"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="5" r="1.4" /><circle cx="12" cy="12" r="1.4" /><circle cx="12" cy="19" r="1.4" />
        </svg>
      </button>
      {open && (
        <div className="req-detail-overflow-menu" role="menu">
          <button type="button" onClick={() => { copyId(); setOpen(false); }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ width: 13, height: 13 }}>
              <rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
            Copy ID ({displayId})
          </button>
          <button type="button" onClick={() => { copyLink(); setOpen(false); }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ width: 13, height: 13 }}>
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </svg>
            Copy link
          </button>
        </div>
      )}
    </div>
  );
}


// Map an Action (label/value) onto one of the four .btn-status
// variants in panels.css. The detail-builders ship action values per
// item kind, so match each one to its semantic colour:
//
//   confirm  (green)  — BR confirm,        gap resolve
//   dismiss  (red)    — BR drop,           gap dismiss
//   info     (blue)   — gap "Add to Meeting" (neutral, non-state-change)
//   discuss  (amber)  — BR mark-as-discussed, gap reopen, fallback
//
// Without these mappings every non-confirm, non-drop button fell into
// `discuss` (amber) so all three gap actions ended up the same colour.
export function statusActionClass(value: string, label: string): string {
  const v = (value || "").toLowerCase();
  const l = (label || "").toLowerCase();
  if (
    v === "confirmed" || v === "resolve" || v === "resolved" ||
    l === "confirm" || l === "resolve"
  ) return "confirm";
  if (
    v === "dropped" || v === "dismissed" || v === "dismiss" ||
    l === "drop" || l === "dismiss"
  ) return "dismiss";
  if (v === "meeting" || l.includes("meeting")) return "info";
  return "discuss";
}


// Status chip helper for the hero — picks the .status / .status.confirmed
// / .status.discussed class so confirmed reads as the strong neon pill
// and the rest stay quiet dot+label chips.
export function statusChipClasses(status: string): string {
  if (status === "confirmed" || status === "resolved") return "status confirmed";
  if (status === "discussed") return "status discussed";
  return "status";
}


// File icon used inside SourceBlock + the inline source-citation card.
const FileIconSvg = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
    <polyline points="14 2 14 8 20 8" />
  </svg>
);


// Source-citation card rendered in the BR / finding body — file
// icon + filename header + the original source quote underneath. The
// header is a clickable doc:// anchor when both docId + onLinkClick
// are provided so the user can jump to the source document.
export function SourceCitation({
  quote, filename, docId, onLinkClick,
}: {
  quote?: string | null;
  filename?: string | null;
  docId?: string | null;
  onLinkClick?: (href: string) => boolean | void;
}) {
  if (!quote && !filename) return null;
  const clickable = !!filename && !!docId && !!onLinkClick;
  const FileIcon = (
    <svg className="file-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
  const OpenArrow = (
    <svg className="open-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="13 6 19 12 13 18" />
    </svg>
  );
  const headerInner = (
    <>
      {FileIcon}
      <span className="file-name">{filename || "Source"}</span>
      {clickable && OpenArrow}
    </>
  );
  return (
    <div className="source-citation">
      {filename && (
        clickable ? (
          <a
            href={`doc://${docId}`}
            className="source-citation-header clickable"
            onClick={(e) => {
              if (!onLinkClick) return;
              const handled = onLinkClick(`doc://${docId}`);
              if (handled !== false) e.preventDefault();
            }}
          >
            {headerInner}
          </a>
        ) : (
          <div className="source-citation-header">{headerInner}</div>
        )
      )}
      {quote && (
        <div className="source-citation-body">{quote}</div>
      )}
    </div>
  );
}


// Source-doc chip rendered in the hero meta line. Clickable when the
// caller passes both docId and onLinkClick — anchor href is doc://uuid
// and the click is intercepted so the panel can resolve in-place.
// `mergedCount` stamps "+N merged" for items merged from multiple
// docs (BR with version > 1). Pass 0 / undefined to skip.
export function SourceBlock({
  filename, docId, mergedCount, onLinkClick,
}: {
  filename: string;
  docId?: string | null;
  mergedCount?: number;
  onLinkClick?: (href: string) => boolean | void;
}) {
  const clickable = !!docId && !!onLinkClick;
  const merged = mergedCount && mergedCount > 1 ? mergedCount : 0;
  const Body = (
    <>
      {FileIconSvg}
      <span>{filename}</span>
      {merged > 0 && <span className="merge-tag">+{merged - 1} merged</span>}
    </>
  );
  if (clickable) {
    return (
      <a
        href={`doc://${docId}`}
        className="req-detail-source-block clickable"
        title={`Open ${filename}${merged > 0 ? ` · merged from ${merged} docs` : ""}`}
        onClick={(e) => {
          if (!onLinkClick) return;
          const handled = onLinkClick(`doc://${docId}`);
          if (handled !== false) e.preventDefault();
        }}
      >
        {Body}
      </a>
    );
  }
  return (
    <span
      className="req-detail-source-block"
      title={merged > 0 ? `${filename} · merged from ${merged} docs` : filename}
    >
      {Body}
    </span>
  );
}
