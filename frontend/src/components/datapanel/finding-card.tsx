"use client";

// Generic detail-finding card. The same .req / .req-id / .req-body /
// .req-meta / .req-action CSS skeleton from panels.css is used for
// every item kind on the discovery page (BR, gap, constraint,
// contradiction). Naming kept "req-*" in the stylesheet because that's
// where the design originated — semantically the card is item-agnostic,
// hence this wrapper.
//
// Slots:
//   id             — display id ("BR-024", "GAP-007", …)
//   idTag?         — chip rendered next to the id (priority for BR,
//                    severity for gap, type for constraint)
//   timeLabel?     — HH:MM (drawn from created_at)
//   dateLabel?     — Apr 22, 2026
//   title          — main row title (req title, gap question, …)
//   meta?          — slot for the chip row beneath the title
//   actions?       — slot for the right-hand column (warn pill, kebab)
//
// `isNew` adds the unread highlight ring used by the New-this-session
// group; `onClick` opens the detail drawer; the wrapper title attr
// shows the full text on hover so truncated titles stay legible.

import { useCallback, type ReactNode } from "react";


interface FindingCardProps {
  id: string;
  idTag?: ReactNode;
  timeLabel?: string;
  dateLabel?: string;
  dateTooltip?: string;
  title: string;
  meta?: ReactNode;
  actions?: ReactNode;
  isNew?: boolean;
  onClick: () => void;
}


export function FindingCard({
  id, idTag, timeLabel, dateLabel, dateTooltip,
  title, meta, actions, isNew, onClick,
}: FindingCardProps) {
  // `title` is rendered as the visible heading in .req-title (below).
  // We deliberately don't pass it to the wrapper `title=…` attribute
  // any more — the native browser tooltip was duplicating the
  // already-visible text and clouding the hover state.
  return (
    <div
      className={`req${isNew ? " new" : ""}`}
      onClick={onClick}
    >
      <div className="req-id">
        <div className="req-id-head">
          <span className="id">{id}</span>
          {idTag}
        </div>
        {timeLabel && <span className="t">{timeLabel}</span>}
        {dateLabel && (
          <span className="d" title={dateTooltip}>{dateLabel}</span>
        )}
      </div>

      <div className="req-body">
        <div className="req-title">{title}</div>
        {meta && <div className="req-meta">{meta}</div>}
      </div>

      {(actions !== undefined) && (
        <div className="req-action">{actions}</div>
      )}
    </div>
  );
}


// Default kebab — matches the .kebab style. Useful for tabs that
// don't need any extra action besides "open detail" (which is what
// the row click already does), so the kebab just re-opens.
export function CardKebab({ onClick, title = "Open details" }: {
  onClick: (e: React.MouseEvent) => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      className="kebab"
      onClick={onClick}
      title={title}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="5" r="1" />
        <circle cx="12" cy="12" r="1" />
        <circle cx="12" cy="19" r="1" />
      </svg>
    </button>
  );
}


// Warn pill — used to surface pending-proposal counts on BR cards.
// Reusable for any "needs attention" badge on the right of a card.
export function CardWarnBadge({ count, title }: { count: number; title?: string }) {
  return (
    <span className="req-warn" title={title}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
      {count}
    </span>
  );
}


// Scroll-collapse hook — returns a ref callback that wires onto a
// scroll surface and fires `onCollapse(true)` once the user has
// scrolled past `threshold` (default 40px), `false` when back at
// the top. Used by every tab so the readiness hero collapses as the
// user scrolls a long card list. Cleanup runs automatically when
// the node unmounts or the ref swaps, so caller doesn't need to
// remove the listener.
export function useScrollCollapse(
  onCollapse: ((collapsed: boolean) => void) | undefined,
  threshold = 40,
) {
  return useCallback((node: HTMLDivElement | null) => {
    if (!node || !onCollapse) return;
    const update = () => onCollapse(node.scrollTop > threshold);
    update();
    node.addEventListener("scroll", update, { passive: true });
    (node as unknown as { _scrollCleanup?: () => void })._scrollCleanup =
      () => node.removeEventListener("scroll", update);
  }, [onCollapse, threshold]);
}


// Format a JS Date / ISO string into the (timeLabel, dateLabel,
// tooltip) triplet that the card renders. Used by every tab.
export function formatCardDate(iso: string | null | undefined): {
  time: string; date: string; tooltip: string;
} {
  if (!iso) return { time: "", date: "", tooltip: "" };
  const d = new Date(iso);
  return {
    time: d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    date: d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }),
    tooltip: d.toLocaleString(),
  };
}
