"use client";

import { useRouter } from "next/navigation";
import type { CSSProperties, ReactNode } from "react";

// Cross-page deep link pill. Click takes the user to the page that
// owns the artifact, with the detail view auto-opened via the
// existing ?tab=…&highlight=… URL contract that DataPanel already
// reads (see frontend/src/components/DataPanel.tsx — initialTab +
// highlightId effects).
//
// Display-id prefix → destination map:
//   BR-NNN → /chat?tab=reqs&highlight=BR-NNN     (Discovery)
//   GAP-NNN → /chat?tab=gaps&highlight=GAP-NNN
//   CON-NNN → /chat?tab=gaps&highlight=CON-NNN
//   CTR-NNN → /chat?tab=gaps&highlight=CTR-NNN
//   TD-NNN  → /story-tech?highlight=TD-NNN       (Tech-Story)
//   US-NNN  → /story-tech?highlight=US-NNN
//
// Unknown prefixes render as a plain non-clickable chip so the caller
// doesn't need to filter inputs.

type PillKind = "BR" | "GAP" | "CON" | "CTR" | "TD" | "US";

interface RouteSpec {
  page: "chat" | "story-tech";
  tab?: string;
}

const ROUTES: Record<PillKind, RouteSpec> = {
  BR:  { page: "chat",       tab: "reqs" },
  GAP: { page: "chat",       tab: "gaps" },
  CON: { page: "chat",       tab: "gaps" },
  CTR: { page: "chat",       tab: "gaps" },
  TD:  { page: "story-tech" },
  US:  { page: "story-tech" },
};

const VARIANT: Record<PillKind, string> = {
  BR:  "blue",
  GAP: "amber",
  CON: "purple",
  CTR: "red",
  TD:  "green",
  US:  "amber",
};

function parseKind(displayId: string): PillKind | null {
  const prefix = displayId.split("-")[0]?.toUpperCase();
  if (prefix && prefix in ROUTES) return prefix as PillKind;
  return null;
}

interface SourcePillProps {
  /** Full display id, e.g. "BR-005", "TD-012", "US-103". */
  displayId: string;
  /** Required for routing — every pill is project-scoped. */
  projectId: string;
  /** Override the default in-app navigation (useful when the host page
   *  already has its own router and wants to handle nav itself). */
  onClick?: (displayId: string) => void;
  /** Match the existing TypeBadge / chip variants used in DataPanel
   *  so this looks native next to existing UI. Inline override only. */
  style?: CSSProperties;
}

export function SourcePill({ displayId, projectId, onClick, style }: SourcePillProps) {
  const router = useRouter();
  const kind = parseKind(displayId);

  const handleClick = (e: React.MouseEvent) => {
    if (!kind) return;
    e.stopPropagation();
    if (onClick) {
      onClick(displayId);
      return;
    }
    const route = ROUTES[kind];
    const params = new URLSearchParams();
    if (route.tab) params.set("tab", route.tab);
    params.set("highlight", displayId);
    router.push(`/projects/${projectId}/${route.page}?${params.toString()}`);
  };

  const variantCls = kind ? VARIANT[kind] : "";
  const clickable = !!kind;

  return (
    <span
      className={`chip xs uppercase ${variantCls}`}
      onClick={clickable ? handleClick : undefined}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                handleClick(e as unknown as React.MouseEvent);
              }
            }
          : undefined
      }
      style={{
        cursor: clickable ? "pointer" : "default",
        userSelect: "none",
        ...style,
      }}
      title={clickable ? `Open ${displayId}` : displayId}
    >
      {displayId}
    </span>
  );
}

interface LinkedItemPillRowProps {
  /** Direction arrow + label. "source" points back at upstream artifacts;
   *  "target" points forward at downstream artifacts. */
  direction: "source" | "target";
  label?: string;
  ids: string[];
  projectId: string;
  /** Optional override forwarded to each pill. */
  onPillClick?: (displayId: string) => void;
}

export function LinkedItemPillRow({
  direction,
  label,
  ids,
  projectId,
  onPillClick,
}: LinkedItemPillRowProps) {
  if (!ids || ids.length === 0) return null;
  const arrow = direction === "source" ? "←" : "→";
  const defaultLabel = direction === "source" ? "Sources" : "Linked";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        flexWrap: "wrap",
      }}
    >
      <span
        style={{
          fontSize: 10,
          fontWeight: 700,
          color: "var(--ink-3, #888)",
          letterSpacing: ".06em",
          textTransform: "uppercase",
        }}
      >
        {arrow} {label || defaultLabel}
      </span>
      {ids.map((id) => (
        <SourcePill
          key={id}
          displayId={id}
          projectId={projectId}
          onClick={onPillClick}
        />
      ))}
    </div>
  );
}

// Re-export as a single ReactNode helper for inline render in detail
// metadata rows where the caller wants two arrows on one line.
export function PillsLine({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        flexWrap: "wrap",
      }}
    >
      {children}
    </div>
  );
}
