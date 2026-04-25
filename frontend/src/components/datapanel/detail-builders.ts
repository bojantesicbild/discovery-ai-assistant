// Pure view-builders for the DataPanel detail slot. Each open* entry
// point in DataPanel.tsx does two things: (1) turn a domain record
// into a markdown body + meta chips + action list (pure), and (2)
// wire in an async onAction callback (stateful). This file owns step
// 1 for requirements, constraints, gaps, and documents; the component
// composes these with its callbacks.

import type {
  ApiRequirement, ApiConstraint, ApiGap, ApiDocument, ApiContradiction,
} from "@/lib/api";
import { formatRaisedMeta } from "@/lib/dates";
import type { GapResolution } from "./feedback-cards";


export type Action = { label: string; value: string; color: string };

export interface DetailViewBase {
  title: string;
  content: string;
  meta?: Record<string, string>;
  actions?: Action[];
  history?: { projectId: string; itemType: string; itemId: string };
  itemKey?: string;
  itemKind?: "requirement" | "gap" | "constraint" | "contradiction";
  gapResolution?: GapResolution;
}


function _sourceLines(sourceDoc: string | null | undefined, sourceDocId: string | null | undefined, sources?: { filename?: string | null; doc_id?: string | null }[]): string[] {
  const out: string[] = [];
  if (sourceDoc && sourceDocId) out.push(`- [${sourceDoc}](doc://${sourceDocId})`);
  else if (sourceDoc) out.push(`- ${sourceDoc}`);
  (sources || []).forEach((s) => {
    const name = s.filename || s.doc_id?.slice(0, 8) || "document";
    if (s.doc_id) out.push(`- [${name}](doc://${s.doc_id})`);
    else out.push(`- ${name}`);
  });
  return out;
}


export function reqActionsForStatus(status: string): Action[] {
  switch (status) {
    case "confirmed":
      return [
        { label: "Revert to Proposed", value: "proposed", color: "#6B7280" },
        { label: "Drop", value: "dropped", color: "#EF4444" },
      ];
    case "dropped":
      return [{ label: "Reopen", value: "proposed", color: "#3B82F6" }];
    case "discussed":
      return [
        { label: "Confirm", value: "confirmed", color: "#059669" },
        { label: "Drop", value: "dropped", color: "#EF4444" },
      ];
    default:
      return [
        { label: "Confirm", value: "confirmed", color: "#059669" },
        { label: "Mark as Discussed", value: "discussed", color: "#3B82F6" },
        { label: "Drop", value: "dropped", color: "#EF4444" },
      ];
  }
}


export function buildRequirementView(req: ApiRequirement, projectId: string): DetailViewBase {
  const sourceLines = _sourceLines(req.source_doc, req.source_doc_id, req.sources);
  const scopeNote = (req.scope_note || "").trim();
  const rationale = (req.rationale || "").trim();
  const alternatives = req.alternatives_considered || [];
  const blockedBy = req.blocked_by || [];

  const md = [
    `# ${req.req_id}: ${req.title}`,
    scopeNote ? `\n*${scopeNote}*` : "",
    "", "## Description", req.description || "No description",
    req.user_perspective ? `\n## User Perspective\n${req.user_perspective}` : "",
    rationale ? `\n## Rationale\n${rationale}` : "",
    alternatives.length ? `\n## Alternatives Considered\n${alternatives.map((a) => `- ${a}`).join("\n")}` : "",
    `\n## Business Rules\n${req.business_rules?.length
      ? req.business_rules.map((r: string) => `- ${r}`).join("\n")
      : "*None captured.*"}`,
    `\n## Acceptance Criteria\n${req.acceptance_criteria?.length
      ? req.acceptance_criteria.map((ac: string) => `- ${ac}`).join("\n")
      : "*None captured.*"}`,
    `\n## Edge Cases\n${req.edge_cases?.length
      ? req.edge_cases.map((e: string) => `- ${e}`).join("\n")
      : "*None captured.*"}`,
    blockedBy.length ? `\n## Blocked By\n${blockedBy.map((b) => `- [${b}](br://${b})`).join("\n")}` : "",
    sourceLines.length ? `\n## Sources\n${sourceLines.join("\n")}` : "",
  ].filter(Boolean).join("\n");

  const meta: Record<string, string> = {
    priority: req.priority,
    status: req.status,
    confidence: req.confidence,
    version: `v${req.version || 1}${req.version > 1 ? ` · merged from ${1 + (req.sources?.length || 0)} docs` : ""}`,
    source: req.source_doc || "unknown",
  };
  const raised = formatRaisedMeta(req.created_at);
  if (raised) meta.raised = raised;
  if (req.source_person) meta.requested_by = req.source_person;

  return {
    title: `${req.req_id}: ${req.title}`,
    content: md,
    meta,
    history: req.id ? { projectId, itemType: "requirement", itemId: req.id } : undefined,
    actions: reqActionsForStatus(req.status),
    itemKey: req.req_id,
    itemKind: "requirement",
  };
}


export function buildConstraintView(con: ApiConstraint, index: number, projectId: string): DetailViewBase {
  // Constraints have no persistent display id — assign CON-001, CON-002, …
  // based on the stable API order so UI ids match the vault markdown.
  const conId = `CON-${String(index + 1).padStart(3, "0")}`;

  const desc = (con.description || "").trim();
  const shortTitle = desc.length > 80 ? desc.slice(0, 77).trimEnd() + "…" : desc;
  const headerTitle = shortTitle || `${con.type} constraint (no description)`;

  const raisedValue = formatRaisedMeta(con.created_at);
  const workaround = (con.workaround || "").trim();
  const affects = con.affects_reqs || [];

  // Body follows BR / gap pattern: no H1 (hero shows it), no source
  // quote / document sections (FindingDetailView renders <SourceCitation>
  // separately). Sections that have content render as field-headers.
  const md = [
    desc && desc.length > 80 ? desc : "",
    con.impact ? `\n## Impact\n${con.impact}` : "",
    workaround ? `\n## Workaround\n${workaround}` : "",
    affects.length ? `\n## Affected Requirements\n${affects.map((r) => `- [${r}](br://${r})`).join("\n")}` : "",
  ].filter(Boolean).join("\n");

  const allStatuses: Action[] = [
    { label: "Mark Confirmed",  value: "confirmed",  color: "#10b981" },
    { label: "Mark Assumed",    value: "assumed",    color: "#f59e0b" },
    { label: "Mark Negotiable", value: "negotiable", color: "#6366f1" },
  ];
  const actions = allStatuses.filter((a) => a.value !== con.status);

  const meta: Record<string, string> = { id: conId, type: con.type, status: con.status };
  if (raisedValue) meta.raised = raisedValue;
  if (con.source_person) meta.raised_by = con.source_person;

  return {
    title: `${conId}: ${headerTitle}`,
    content: md,
    meta,
    history: con.id ? { projectId, itemType: "constraint", itemId: con.id } : undefined,
    actions,
    itemKey: conId,
    itemKind: "constraint",
  };
}


export function buildContradictionView(
  c: ApiContradiction,
  index: number,
  projectId: string,
): DetailViewBase {
  // Contradictions follow the constraint pattern: positional CTR-NNN
  // matches the backend's resolve_display_id() ordering (created_at,
  // id) so deep-links from connections / chat resolve to the same row.
  const ctrId = `CTR-${String(index + 1).padStart(3, "0")}`;
  const headerTitle = _contraTitle(c);

  // Body is rendered by <ConflictBody> in the panel — it owns the
  // side-A/B comparison + AI suggestion + resolution layout. We keep
  // an empty content string so FindingDetailView's bodyContent slot
  // wins and the markdown card never renders.
  const md = "";

  const actions: Action[] = c.resolved
    ? [{ label: "Reopen", value: "reopen", color: "#6b7280" }]
    : [
        { label: "Resolve", value: "resolve", color: "#10b981" },
        { label: "Add to Meeting", value: "meeting", color: "#6366f1" },
      ];

  const meta: Record<string, string> = {
    id: ctrId,
    severity: "high",
    status: c.resolved ? "resolved" : "open",
  };
  if (c.area && c.area !== "unknown") meta.area = c.area;
  // ApiContradiction has no closed_at field — formatRaisedMeta handles
  // null fine and just returns the raise date + age.
  const raisedValue = formatRaisedMeta(c.created_at);
  if (raisedValue) meta.raised = raisedValue;

  return {
    title: `${ctrId}: ${headerTitle}`,
    content: md,
    meta,
    history: c.id ? { projectId, itemType: "contradiction", itemId: c.id } : undefined,
    actions,
    itemKey: ctrId,
    itemKind: "contradiction",
  };
}


function _contraTitle(c: ApiContradiction): string {
  if (c.title) return c.title.slice(0, 80);
  if (c.item_a_ref && !c.item_a_ref.startsWith("New ")) return c.item_a_ref.slice(0, 80);
  const expl = (c.explanation || "").trim();
  if (!expl) return "Contradiction";
  const colon = expl.indexOf(":");
  if (colon > 0 && colon < 80) return expl.slice(0, colon).trim();
  return expl.slice(0, 80);
}


export function buildGapView(
  gap: ApiGap,
  requirements: ApiRequirement[],
  projectId: string,
): DetailViewBase {
  // Resolve blocked BR ids to uuids so "Blocks" renders as BR-detail links.
  const blocksLine = (gap.blocked_reqs || []).length
    ? "**Blocks:** " + gap.blocked_reqs.map((brId: string) => {
        const req = requirements.find((r) => r.req_id === brId);
        return req ? `[${brId}](br://${req.id})` : brId;
      }).join(", ")
    : "";

  let gapResolution: GapResolution | undefined;
  if ((gap.status === "resolved" || gap.status === "dismissed") && gap.resolution) {
    const parts = (gap.resolution as string).split("\n\n— Answered via ");
    gapResolution = {
      kind: gap.status as "resolved" | "dismissed",
      text: parts[0],
      attribution: parts.length > 1 ? parts[1] : null,
      closedAt: gap.closed_at || null,
      closedBy: gap.closed_by || null,
    };
  }

  // Age info: raise date + age for open, or time-to-close for closed.
  const raisedValue = formatRaisedMeta(gap.created_at, gap.closed_at);

  // "Suggested Action" reframes to historical once the gap is closed.
  const suggestedActionHeading = (gap.status === "resolved" || gap.status === "dismissed")
    ? "Originally suggested action"
    : "Suggested Action";

  // Body follows BR's pattern: no H1 (hero already shows GAP-NNN +
  // question), no "## Question" repeat. Each section is a field-
  // header with substantive content underneath. Source quote +
  // document render outside the body via <SourceCitation>.
  //
  // Section order (migration 038):
  //   Why it matters → Default we're running on / Options on the table
  //   → Validation plan → Blocks → (legacy Suggested Action fallback)
  // Each section omits when its source is empty so a sparse legacy
  // gap renders the same shape it always has.
  const sections: string[] = [];

  if (gap.impact_summary) {
    sections.push(`## Why it matters\n${gap.impact_summary}`);
  }
  if (gap.kind === "unvalidated_assumption" && gap.assumed_default) {
    sections.push(`## Default we're running on\n${gap.assumed_default}`);
  }
  if (gap.kind === "undecided" && gap.options && gap.options.length > 0) {
    const opts = gap.options.map((o) => `- ${o}`).join("\n");
    sections.push(`## Options on the table\n${opts}`);
  }
  if (gap.validation_plan && gap.validation_plan.length > 0) {
    const steps = gap.validation_plan
      .map((s, i) => `${i + 1}. ${s}`)
      .join("\n");
    sections.push(`## Validation plan\n${steps}`);
  } else if (gap.suggested_action) {
    // Legacy fallback — pre-038 rows used a free-form paragraph.
    // Keep it under the same heading so old + new gaps look the same.
    sections.push(`## ${suggestedActionHeading}\n${gap.suggested_action}`);
  }
  if (blocksLine) sections.push(blocksLine);

  const md = sections.join("\n\n");

  const isOpen = gap.status === "open";
  const actions: Action[] = isOpen
    ? [
        { label: "Resolve", value: "resolve", color: "#10b981" },
        { label: "Add to Meeting", value: "meeting", color: "#6366f1" },
        { label: "Dismiss", value: "dismiss", color: "#ef4444" },
      ]
    : [{ label: "Reopen", value: "reopen", color: "#6b7280" }];

  const meta: Record<string, string> = {
    severity: gap.severity,
    status: gap.status,
    area: gap.area || "general",
  };
  // Kind badge — only shown for non-default kinds (missing_info stays boring).
  if (gap.kind === "unvalidated_assumption") meta.kind = "Unvalidated assumption";
  else if (gap.kind === "undecided") meta.kind = "Undecided";
  if (raisedValue) meta.raised = raisedValue;
  if (gap.assignee) meta.owner = gap.assignee;
  if (gap.source_person) meta.ask = gap.source_person;

  return {
    title: `${gap.gap_id}: ${gap.question}`,
    content: md,
    meta,
    history: gap.id ? { projectId, itemType: "gap", itemId: gap.id } : undefined,
    itemKey: gap.gap_id,
    itemKind: "gap",
    gapResolution,
    actions,
  };
}


function _documentMetaLines(doc: ApiDocument): string {
  return [
    `# ${doc.filename}`,
    "", `**Type:** ${doc.file_type} | **Status:** ${doc.pipeline_stage}`,
    doc.file_size_bytes ? `**Size:** ${(doc.file_size_bytes / 1024).toFixed(1)} KB` : "",
    `**Uploaded:** ${doc.created_at ? new Date(doc.created_at).toLocaleString() : "unknown"}`,
    doc.items_extracted > 0 ? `**Extracted:** ${doc.items_extracted} items` : "",
    doc.pipeline_error ? `\n## Pipeline Error\n\`\`\`\n${doc.pipeline_error}\n\`\`\`` : "",
  ].filter(Boolean).join("\n");
}


export function buildDocumentPlaceholder(doc: ApiDocument): DetailViewBase {
  const metaLines = _documentMetaLines(doc);
  return {
    title: doc.filename,
    content: metaLines + "\n\n---\n\n*Loading content...*",
    meta: { type: doc.file_type, status: doc.pipeline_stage },
  };
}


export function buildDocumentFullView(
  doc: ApiDocument,
  content: string | null | undefined,
  message: string | null | undefined,
): DetailViewBase {
  const metaLines = _documentMetaLines(doc);
  const body = content
    ? metaLines + "\n\n---\n\n## Content\n\n" + content
    : metaLines + (message ? `\n\n---\n\n*${message}*` : "");
  return {
    title: doc.filename,
    content: body,
    meta: { type: doc.file_type, status: doc.pipeline_stage },
  };
}
