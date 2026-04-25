"use client";

// Right-pane detail view for non-BR finding kinds (gap, constraint,
// contradiction, document). Shares the .req-detail visual language
// with RequirementDetailView via the same CSS skeleton + the helpers
// in detail-shell.tsx (history hook, history view, kebab menu,
// status-button class mapping). The body slot here renders markdown
// (vs BR's tracked-changes diff body), so detail-builders ship the
// same markdown shape they used to feed MarkdownPanel.
//
// Caller responsibilities:
//   - displayId / title — header text (e.g. "GAP-007", question)
//   - chips, metaLine — kind-specific React slots so Gap can show
//     severity/status, Constraint shows type, Contradiction shows
//     resolved+area, etc. Layout is identical across kinds.
//   - content — markdown string
//   - actions / onAction — optional Set-status row buttons
//   - history — flips on the Content/History sub-tab pair
//   - slotTop / slotBottom — adapter slots, e.g. ConnectionsSection
//
// Hero behaviour matches BR's: scroll past 24px collapses the chip
// row and meta line via the .compact class on .req-detail (CSS in
// panels.css owns the actual collapse animation).

import { useEffect, useRef, useState, type ReactNode } from "react";
import { renderMarkdown } from "@/lib/markdown";
import {
  useDetailHistory, DetailHistoryView, HeroOverflowMenu,
  SourceCitation, statusActionClass,
} from "./detail-shell";


type Action = { label: string; value: string; color: string };


interface FindingDetailViewProps {
  displayId: string;          // "GAP-007" / "CON-003" / etc.
  version?: number;           // currently only BR uses this; reserved
  title: string;
  chips?: ReactNode;          // hero chip row (e.g. severity + status)
  metaLine?: ReactNode;       // hero meta line under the chips
  content?: string;           // markdown body — omit when bodyContent provided
  // Optional body replacement. When given, renders instead of the
  // markdown card — used by contradictions, which need a structured
  // side-A vs side-B layout that markdown can't express well.
  bodyContent?: ReactNode;
  // Source citation card rendered after the markdown body using the
  // shared SourceCitation component (same look as BR). Pass when the
  // item has a source quote or source document — kind-specific data
  // lives in detail-builders / detail-meta.
  source?: { quote?: string | null; filename?: string | null; docId?: string | null };
  actions?: Action[];
  onAction?: (value: string) => void;
  history?: { projectId: string; itemType: string; itemId: string };
  onClose: () => void;
  onLinkClick?: (href: string) => boolean | void;
  slotTop?: ReactNode;
  slotBottom?: ReactNode;
}


export default function FindingDetailView({
  displayId, version, title, chips, metaLine, content, bodyContent, source,
  actions, onAction, history, onClose, onLinkClick,
  slotTop, slotBottom,
}: FindingDetailViewProps) {
  const [activeView, setActiveView] = useState<"content" | "history">("content");
  const { entries: historyEntries, loading: historyLoading } = useDetailHistory(
    history,
    activeView === "history",
  );
  const [compact, setCompact] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  // Reset to Content sub-tab whenever the item id changes.
  useEffect(() => {
    setActiveView("content");
  }, [history?.itemId]);

  function onBodyScroll(e: React.UIEvent<HTMLDivElement>) {
    const top = e.currentTarget.scrollTop;
    setCompact((wasCompact) => {
      if (wasCompact && top < 4) return false;
      if (!wasCompact && top > 24) return true;
      return wasCompact;
    });
  }

  // Body click delegation — markdown links use class="md-link". Catch
  // the click and route through onLinkClick so doc:// / br:// hrefs
  // open the linked detail in-place instead of a hard browser nav.
  function onBodyClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!onLinkClick) return;
    const target = e.target as HTMLElement;
    const a = target.closest<HTMLAnchorElement>("a.md-link");
    if (!a) return;
    const href = a.getAttribute("href") || "";
    const handled = onLinkClick(href);
    if (handled !== false) e.preventDefault();
  }

  return (
    <div className={`req-detail${compact ? " compact" : ""}`}>
      {/* Hero — same 4-row stack as BR detail (back/id/menu → title →
       *  chips → meta line) so muscle memory carries across kinds. */}
      <div className="req-detail-hero">
        <div className="req-detail-hero-top">
          <button type="button" className="req-detail-back" onClick={onClose} aria-label="Back">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <span className="req-detail-id-pair">
            <span className="id">{displayId}</span>
            {version !== undefined && version > 0 && <span className="v">v{version}</span>}
          </span>
          <h1 className="req-detail-title-h1">{title}</h1>
          <HeroOverflowMenu displayId={displayId} />
        </div>

        {chips && <div className="req-detail-hero-chips">{chips}</div>}
        {metaLine && <div className="req-detail-hero-meta">{metaLine}</div>}
      </div>

      {/* Sub-tabs (Content / History) merged with status actions on
       *  one row. Same markup as BR. */}
      {(history || (actions && actions.length > 0)) && (
        <div className="req-detail-tab-row">
          {history ? (
            <div className="req-detail-subtabs">
              {(["content", "history"] as const).map((view) => (
                <button
                  key={view}
                  type="button"
                  onClick={() => setActiveView(view)}
                  className={`req-detail-subtab${activeView === view ? " active" : ""}`}
                >
                  {view}
                </button>
              ))}
            </div>
          ) : <span />}

          {actions && actions.length > 0 && (
            <div className="req-detail-actions">
              <span className="label">Set status</span>
              {actions.map((action) => (
                <button
                  key={`${action.value}-${action.label}`}
                  type="button"
                  className={`btn-status ${statusActionClass(action.value, action.label)}`}
                  onClick={() => onAction?.(action.value)}
                >
                  {action.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Body */}
      <div
        className="req-detail-body"
        ref={bodyRef}
        onScroll={onBodyScroll}
        onClick={onBodyClick}
      >
        {activeView === "history" && history ? (
          <DetailHistoryView loading={historyLoading} entries={historyEntries} />
        ) : (
          <>
            {slotTop}
            {/* bodyContent (custom React tree) wins over the markdown
             *  card. Skip the empty white card when content is empty
             *  too — sparse items shouldn't render a hollow box. */}
            {bodyContent
              ? bodyContent
              : (content && content.trim().length > 0 && (
                <div
                  className="req-detail-content-card md-body"
                  style={{ fontSize: 13, lineHeight: 1.7, color: "var(--ink)" }}
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
                />
              ))}
            {source && (source.quote || source.filename) && (
              <SourceCitation
                quote={source.quote}
                filename={source.filename}
                docId={source.docId}
                onLinkClick={onLinkClick}
              />
            )}
            {slotBottom}
          </>
        )}
      </div>
    </div>
  );
}
