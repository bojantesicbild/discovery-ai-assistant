"use client";

// Per-kind hero chip + meta-line renderers for FindingDetailView.
// detail-builders.ts owns the markdown body shape; this file owns the
// structured pills above it. Both feed the same FindingDetailView so
// every kind (gap / constraint / contradiction / document) inherits
// the same hero layout that BR uses.
//
// Each function returns a ReactNode for the slot (`chips` or
// `metaLine`) — the caller plugs it straight into the JSX.

import type { ReactNode } from "react";
import type {
  ApiGap, ApiConstraint, ApiContradiction, ApiDocument,
} from "@/lib/api";
import { formatAge } from "@/lib/dates";
import { SourceBlock, statusChipClasses } from "./detail-shell";


// ── Gap ────────────────────────────────────────────────────────────

export function gapChips(gap: ApiGap): ReactNode {
  return (
    <>
      {gap.severity && (
        <span className={`sev-badge ${gap.severity}`}>
          {gap.severity[0].toUpperCase()}{gap.severity.slice(1)}
        </span>
      )}
      {gap.status && (
        <span className={statusChipClasses(gap.status)}>
          {gap.status !== "resolved" && gap.status !== "confirmed" && (
            <span className="dot" />
          )}
          {gap.status}
        </span>
      )}
      {gap.area && <span className="chip xs">{gap.area}</span>}
    </>
  );
}


export function gapMetaLine(
  gap: ApiGap,
  onLinkClick?: (href: string) => boolean | void,
): ReactNode {
  const ageStr = formatAge(gap.created_at);
  return (
    <>
      {gap.source_doc && (
        <SourceBlock
          filename={gap.source_doc}
          docId={gap.source_doc_id}
          onLinkClick={onLinkClick}
        />
      )}
      {ageStr && (
        <span title={gap.created_at ? new Date(gap.created_at).toLocaleString() : undefined}>
          Raised {ageStr}
        </span>
      )}
      {gap.source_person && (
        <>
          <span className="sep">·</span>
          <span>by <strong>{gap.source_person}</strong></span>
        </>
      )}
    </>
  );
}


// ── Constraint ─────────────────────────────────────────────────────

export function constraintChips(con: ApiConstraint): ReactNode {
  return (
    <>
      {con.type && <span className="chip xs uppercase">{con.type}</span>}
      {con.status && (
        <span className={statusChipClasses(con.status)}>
          {con.status !== "confirmed" && <span className="dot" />}
          {con.status}
        </span>
      )}
    </>
  );
}


export function constraintMetaLine(
  con: ApiConstraint,
  onLinkClick?: (href: string) => boolean | void,
): ReactNode {
  const ageStr = formatAge(con.created_at);
  return (
    <>
      {con.source_doc && (
        <SourceBlock
          filename={con.source_doc}
          docId={con.source_doc_id}
          onLinkClick={onLinkClick}
        />
      )}
      {ageStr && (
        <span title={con.created_at ? new Date(con.created_at).toLocaleString() : undefined}>
          Raised {ageStr}
        </span>
      )}
      {con.source_person && (
        <>
          <span className="sep">·</span>
          <span>by <strong>{con.source_person}</strong></span>
        </>
      )}
    </>
  );
}


// ── Contradiction ──────────────────────────────────────────────────

export function contradictionChips(c: ApiContradiction): ReactNode {
  const status = c.resolved ? "resolved" : "open";
  return (
    <>
      <span className="sev-badge high">High</span>
      <span className={statusChipClasses(status)}>
        {status !== "resolved" && <span className="dot" />}
        {status}
      </span>
      {c.area && c.area !== "unknown" && <span className="chip xs">{c.area}</span>}
    </>
  );
}


export function contradictionMetaLine(
  c: ApiContradiction,
): ReactNode {
  const ageStr = formatAge(c.created_at);
  if (!ageStr) return null;
  return (
    <span title={c.created_at ? new Date(c.created_at).toLocaleString() : undefined}>
      Detected {ageStr}
    </span>
  );
}


// ── Document ───────────────────────────────────────────────────────

export function documentChips(doc: ApiDocument): ReactNode {
  return (
    <>
      {doc.file_type && <span className="chip xs uppercase">{doc.file_type}</span>}
      {doc.pipeline_stage && (
        <span className={statusChipClasses(doc.pipeline_stage)}>
          {doc.pipeline_stage !== "completed" && <span className="dot" />}
          {doc.pipeline_stage}
        </span>
      )}
    </>
  );
}


export function documentMetaLine(doc: ApiDocument): ReactNode {
  const uploadedAge = formatAge(doc.created_at);
  return (
    <>
      {doc.file_size_bytes && (
        <span>{(doc.file_size_bytes / 1024).toFixed(1)} KB</span>
      )}
      {uploadedAge && (
        <>
          {doc.file_size_bytes && <span className="sep">·</span>}
          <span title={doc.created_at ? new Date(doc.created_at).toLocaleString() : undefined}>
            Uploaded {uploadedAge}
          </span>
        </>
      )}
      {doc.items_extracted > 0 && (
        <>
          <span className="sep">·</span>
          <span>{doc.items_extracted} extracted</span>
        </>
      )}
    </>
  );
}
