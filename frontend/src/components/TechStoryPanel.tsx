"use client";

import { useCallback, useEffect, useState } from "react";
import {
  listTechDocs,
  getTechDoc,
  getStory,
  getVaultFile,
  syncTechDocs,
  updateTechDocStatus,
  updateStoryStatus,
  type ApiTechDoc,
  type ApiStory,
} from "@/lib/api";
import { SourcePill, LinkedItemPillRow } from "./SourcePill";
import { FilterChip } from "./datapanel/pills";
import MarkdownPanel from "./MarkdownPanel";
import { usePersistedState } from "@/lib/persistedState";
import { useTableState } from "@/lib/tableState";
import { Pagination } from "./TableControls";
import { useScrollCollapse } from "./datapanel/finding-card";

// Sibling of DataPanel for the Phase 2 tech-story chain.
//
// Same interaction shape as Discovery: click a row → opens the artifact
// in a MarkdownPanel detail view. Detail-stack supports nested navigation
// (TD detail → click child story → pushes US detail; close pops back to
// the TD). Vault markdown is fetched on demand via the existing
// /api/projects/:id/wiki/file endpoint.

interface TechStoryPanelProps {
  projectId: string;
  refreshKey?: number;
  highlightId?: string;
}

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  reviewed: "Reviewed",
  approved: "Approved",
  superseded: "Superseded",
  todo: "To do",
  in_progress: "In progress",
  done: "Done",
  dropped: "Dropped",
};

// Status transition order — matches the backend allow-lists in
// app/api/tech_story.py. Render as buttons in the detail view; the
// current status is highlighted, click sends the PATCH.
const TD_STATUSES: string[] = ["draft", "reviewed", "approved", "superseded"];
const US_STATUSES: string[] = ["todo", "in_progress", "done", "dropped"];

// Color hint per action — read by MarkdownPanel for the action-button
// tint. Mirrors STATUS_BAR_COLOR for the US trio so the same
// semantics show up everywhere status is communicated.
const STATUS_COLOR: Record<string, string> = {
  draft: "var(--ink-3)",
  reviewed: "var(--should)",
  approved: "var(--confirmed)",
  superseded: "var(--must)",
  todo: "var(--ink-3)",
  in_progress: "var(--should)",
  done: "var(--confirmed)",
  dropped: "var(--must)",
};

const TD_STATUS_FILTERS: { value: string; label: string }[] = [
  { value: "all", label: "All" },
  { value: "draft", label: "Draft" },
  { value: "reviewed", label: "Reviewed" },
  { value: "approved", label: "Approved" },
  { value: "superseded", label: "Superseded" },
];
const US_STATUS_FILTERS: { value: string; label: string }[] = [
  { value: "all", label: "All" },
  { value: "todo", label: "To do" },
  { value: "in_progress", label: "In progress" },
  { value: "done", label: "Done" },
  { value: "dropped", label: "Dropped" },
];

function StatusPill({ status }: { status: string }) {
  // Map onto DataPanel's existing gap-status-pill variants so the
  // colours read identically in both surfaces.
  const cls =
    status === "approved" || status === "done"
      ? "resolved"
      : status === "dropped" || status === "superseded"
      ? "dropped"
      : status === "reviewed" || status === "in_progress"
      ? "in-progress"
      : "open";
  return (
    <span className={`gap-status-pill ${cls}`}>
      {STATUS_LABEL[status] || status}
    </span>
  );
}

// ─── Detail-stack types ────────────────────────────────────────────

interface DetailEntry {
  kind: "td" | "us" | "breakdown";
  /** TD-NNN or US-NNN. Drives status PATCH + slotBottom rendering. */
  displayId: string;
  title: string;
  content: string;
  meta: Record<string, string>;
  /** Current status — used to mark the active button in the action row.
   *  Empty string for breakdown entries (no transitions). */
  currentStatus: string;
  /** Only set on TD entries — child stories rendered in slotBottom. */
  stories?: ApiStory[];
}

// Map a TD's id to its breakdown file. Per the agent convention
// (assistants/.claude/agents/story-story-agent.md), the breakdown for
// TD-NNN always lives at docs/stories/TD-NNN/breakdown.md regardless
// of slug — the BR id is no longer encoded in the path.
function breakdownPathFromTd(td: ApiTechDoc): string | null {
  const m = td.td_id.match(/^TD-(\d+)$/i);
  if (!m) return null;
  return `docs/stories/TD-${m[1]}/breakdown.md`;
}

// Color hint per US status, used by the stacked status bar on each TD
// card and the count chips below it. "done" pulls the brand accent
// (the logo green) so progress reads as on-brand rather than a generic
// success color — matches the donut ring's filled stroke.
const STATUS_BAR_COLOR: Record<string, string> = {
  todo: "var(--ink-4)",        // neutral gray
  in_progress: "var(--should)",// amber — work in flight
  done: "var(--accent)",       // logo green — settled
  dropped: "var(--must)",      // red — out of scope
};
const STATUS_ORDER: string[] = ["todo", "in_progress", "done", "dropped"];

function storyCountsByStatus(stories: ApiStory[]): Record<string, number> {
  const out: Record<string, number> = { todo: 0, in_progress: 0, done: 0, dropped: 0 };
  for (const s of stories) out[s.status] = (out[s.status] || 0) + 1;
  return out;
}

// Compact donut ring showing the % of stories under a TD that are
// "done". Mirrors Discovery's hero ring but smaller — used inline in
// TD card headers and the Stories tab grouped-view header so progress
// reads at a glance without expanding anything.
function MiniRing({ pct, size = 36, stroke = 4 }: { pct: number; size?: number; stroke?: number }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (Math.max(0, Math.min(100, pct)) / 100) * c;
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ display: "block" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={stroke}
          strokeDasharray={c}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: "stroke-dashoffset 400ms cubic-bezier(.2,.8,.2,1)" }}
        />
      </svg>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: size <= 32 ? 9 : 10,
          fontWeight: 700,
          color: pct === 0 ? "var(--ink-3)" : "var(--ink)",
          fontVariantNumeric: "tabular-nums",
          letterSpacing: "-.02em",
        }}
      >
        {pct}%
      </div>
    </div>
  );
}

function StoryStatusBar({ stories }: { stories: ApiStory[] }) {
  if (stories.length === 0) return null;
  const counts = storyCountsByStatus(stories);
  const total = stories.length;
  const segments = STATUS_ORDER.filter((s) => counts[s] > 0);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div
        style={{
          display: "flex",
          width: "100%",
          height: 4,
          borderRadius: 999,
          overflow: "hidden",
          background: "var(--line)",
        }}
      >
        {segments.map((s) => (
          <div
            key={s}
            title={`${counts[s]} ${STATUS_LABEL[s]}`}
            style={{
              width: `${(counts[s] / total) * 100}%`,
              background: STATUS_BAR_COLOR[s],
            }}
          />
        ))}
      </div>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 12,
          fontSize: 11,
          color: "var(--ink-3)",
        }}
      >
        {segments.map((s) => (
          <span key={s} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: STATUS_BAR_COLOR[s],
                display: "inline-block",
              }}
            />
            {counts[s]} {STATUS_LABEL[s].toLowerCase()}
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── Subcomponents ─────────────────────────────────────────────────

function StoryRow({
  story,
  projectId,
  onOpen,
}: {
  story: ApiStory;
  projectId: string;
  onOpen: (s: ApiStory) => void;
}) {
  // Tabular row, mirrors Discovery's BR/Gap row rhythm: small ID chip,
  // title with optional secondary line, status at the right edge.
  // Bottom border only — a run of rows reads as one list, not as
  // floating cards.
  const acCount = story.acceptance_criteria.length;
  return (
    <div onClick={() => onOpen(story)} className="ts-row">
      <SourcePill
        displayId={story.us_id}
        projectId={projectId}
        onClick={() => onOpen(story)}
      />
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 500,
            color: "var(--ink)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {story.title}
        </div>
        {acCount > 0 && (
          <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 2 }}>
            {acCount} acceptance {acCount === 1 ? "criterion" : "criteria"}
          </div>
        )}
      </div>
      <StatusPill status={story.status} />
    </div>
  );
}

function TechDocCard({
  td,
  projectId,
  onOpen,
  onOpenStory,
  onOpenBreakdown,
}: {
  td: ApiTechDoc;
  projectId: string;
  onOpen: (td: ApiTechDoc) => void;
  onOpenStory: (us_id: string) => void;
  onOpenBreakdown: (td: ApiTechDoc) => void;
}) {
  const stories = td.stories || [];
  const [pillsOpen, setPillsOpen] = useState(false);
  const breakdownAvailable = breakdownPathFromTd(td) !== null;
  const counts = storyCountsByStatus(stories);
  const donePct = stories.length
    ? Math.round((counts.done / stories.length) * 100)
    : 0;
  // Hide the ring on TDs with no stories yet (it would always read 0%
  // and the absence is more honest than a permanently-empty donut).
  const showRing = stories.length > 0;

  // Keep clicks on inner buttons from bubbling up to the card-open
  // handler — this is the same trick BR rows use to differentiate
  // "open detail" from "act on this row".
  const stop = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    fn();
  };

  return (
    <div onClick={() => onOpen(td)} className="ts-card">
      {/* Header: id pill, title, ring, status. */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
        <SourcePill
          displayId={td.td_id}
          projectId={projectId}
          onClick={() => onOpen(td)}
        />
        <h3
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 14,
            fontWeight: 600,
            margin: 0,
            color: "var(--ink)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            letterSpacing: "-.01em",
          }}
        >
          {td.title}
        </h3>
        {showRing && <MiniRing pct={donePct} size={32} stroke={3} />}
        <StatusPill status={td.status} />
      </div>

      {/* Source row */}
      {td.source_brs.length > 0 && (
        <div style={{ marginBottom: stories.length > 0 ? 12 : 0 }}>
          <LinkedItemPillRow
            direction="source"
            label="From"
            ids={td.source_brs}
            projectId={projectId}
          />
        </div>
      )}

      {/* Stories progress: status bar + count chips. Pill list lives
          behind the "Show story IDs" toggle so the card stays calm
          when a TD has many children. */}
      {stories.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: "var(--ink-3)",
              letterSpacing: ".06em",
              textTransform: "uppercase",
            }}
          >
            Stories · {stories.length}
          </div>
          <StoryStatusBar stories={stories} />
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              flexWrap: "wrap",
              marginTop: 4,
            }}
          >
            <button
              type="button"
              onClick={stop(() => setPillsOpen((v) => !v))}
              className="panel-filter-btn"
              style={{ display: "inline-flex", alignItems: "center", gap: 5 }}
            >
              <span style={{ transform: pillsOpen ? "rotate(90deg)" : "none", transition: "transform .15s", display: "inline-block" }}>›</span>
              {pillsOpen ? "Hide story IDs" : "Show story IDs"}
            </button>
            {breakdownAvailable && (
              <button
                type="button"
                onClick={stop(() => onOpenBreakdown(td))}
                className="panel-filter-btn"
                title="Open the per-TD story breakdown plan"
                style={{ display: "inline-flex", alignItems: "center", gap: 5 }}
              >
                <span aria-hidden style={{ fontSize: 11 }}>📋</span> View breakdown plan
              </button>
            )}
          </div>
          {pillsOpen && (
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                marginTop: 4,
                padding: "8px 10px",
                background: "var(--surface-2)",
                border: "1px solid var(--line)",
                borderRadius: "var(--radius-sm)",
              }}
            >
              <LinkedItemPillRow
                direction="target"
                label={`Stories (${stories.length})`}
                ids={stories.map((s) => s.us_id)}
                projectId={projectId}
                onPillClick={(id) => onOpenStory(id)}
              />
            </div>
          )}
        </div>
      )}

      {/* No stories yet — surface only the breakdown link if it exists. */}
      {stories.length === 0 && breakdownAvailable && (
        <div style={{ marginTop: 10 }}>
          <button
            type="button"
            onClick={stop(() => onOpenBreakdown(td))}
            className="panel-filter-btn"
          >
            📋 View breakdown plan
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Main panel ────────────────────────────────────────────────────

export default function TechStoryPanel({
  projectId,
  refreshKey = 0,
  highlightId,
}: TechStoryPanelProps) {
  const [techDocs, setTechDocs] = useState<ApiTechDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailStack, setDetailStack] = useState<DetailEntry[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const detail = detailStack.length > 0 ? detailStack[detailStack.length - 1] : null;
  // Active tab persists per-project so the surface remembers whether
  // the user was last in TD-mode or US-mode.
  const [activeTab, setActiveTab] = usePersistedState<"docs" | "stories">(
    `techstory:activeTab:${projectId}`,
    "docs",
  );
  // Per-tab filter + search are independent — flipping tabs preserves
  // each side's context. The TD list filters by TD status (draft /
  // reviewed / approved / superseded); the Stories tab filters by US
  // status (todo / in_progress / done / dropped). Different domains,
  // different keys.
  const [statusFilter, setStatusFilter] = usePersistedState<string>(
    `techstory:statusFilter:${projectId}`,
    "all",
  );
  const [search, setSearch] = usePersistedState<string>(
    `techstory:search:${projectId}`,
    "",
  );
  const [storyStatusFilter, setStoryStatusFilter] = usePersistedState<string>(
    `techstory:storyStatusFilter:${projectId}`,
    "all",
  );
  const [storySearch, setStorySearch] = usePersistedState<string>(
    `techstory:storySearch:${projectId}`,
    "",
  );
  const [groupByTd, setGroupByTd] = usePersistedState<boolean>(
    `techstory:storyGroupByTd:${projectId}`,
    true,
  );
  // Pagination state per tab — same hook Discovery's tabs use, so the
  // footer (page controls + size selector) reads identically. Persisted
  // sort key isn't user-visible yet on this surface, but useTableState
  // requires one; we sort by display id which is the natural order.
  const tdsTable = useTableState(`techstory:tds:${projectId}`, "td_id", "asc", 10);
  const storiesTable = useTableState(`techstory:stories:${projectId}`, "us_id", "asc", 10);
  // Scroll-driven hero collapse, mirroring DataPanel's `.hero-collapsed`
  // pattern. Reset on tab change so flipping back to a freshly-mounted
  // tab doesn't show a collapsed hero from the previous tab's scroll.
  const [heroCollapsed, setHeroCollapsed] = useState(false);
  // Tighter threshold than Discovery's default (40px). The TD/stories
  // surface is shorter than Discovery's card list, so a 40px gate
  // would feel sluggish — 16px collapses after roughly one row of
  // movement, which reads as "the hero gets out of the way as soon
  // as you start scanning."
  const docsScrollRef = useScrollCollapse(setHeroCollapsed, 16);
  const storiesScrollRef = useScrollCollapse(setHeroCollapsed, 16);
  useEffect(() => { setHeroCollapsed(false); }, [activeTab]);

  // ── Data load ────────────────────────────────────────────────────
  // Fetch the full TD set (with stories) every cycle and apply BOTH
  // tab filters client-side. This lets the Stories tab work against
  // the same dataset without re-fetching when the user flips tabs,
  // and avoids the case where a TD-level filter on the docs tab
  // hides stories the user wanted to see on the stories tab.
  const reload = useCallback(async () => {
    const data = await listTechDocs(projectId, { includeStories: true });
    return data.items || [];
  }, [projectId]);

  // Mirror DataPanel's auto-refresh cadence — 15s interval that walks
  // vault → DB and then reloads the list. Sync is best-effort: when it
  // fails (FS hiccup, transient lock) we still try the list against
  // whatever the DB already has, so the panel doesn't blank out.
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      try {
        await syncTechDocs(projectId).catch(() => null);
        const items = await reload();
        if (!cancelled) setTechDocs(items);
      } catch {
        if (!cancelled) setTechDocs([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    tick();
    const intervalId = setInterval(tick, 15000);
    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [projectId, refreshKey, reload]);

  // ── Vault content fetch ──────────────────────────────────────────
  const fetchContent = useCallback(
    async (filePath: string | null, fallbackBody: string): Promise<string> => {
      if (!filePath) return fallbackBody;
      try {
        const data = await getVaultFile(projectId, filePath);
        return (data?.content as string) || fallbackBody;
      } catch {
        return (
          fallbackBody +
          `\n\n*— Could not read \`${filePath}\` from the vault. The file may not be committed yet.*`
        );
      }
    },
    [projectId],
  );

  // ── Open handlers ────────────────────────────────────────────────
  const openTechDoc = useCallback(
    async (td: ApiTechDoc, mode: "replace" | "push" = "replace") => {
      setDetailLoading(true);
      // Fetch the canonical record to make sure stories are populated even
      // when the caller only had a stub (e.g. opened from a US click that
      // followed a deep-link).
      let full = td;
      if (!td.stories) {
        try {
          full = await getTechDoc(projectId, td.td_id);
        } catch {
          /* fall back to whatever we have */
        }
      }
      const fallbackBody =
        full.summary ||
        "*This tech doc has no summary yet. Run /generate-tech-doc in chat to populate the vault file.*";
      const content = await fetchContent(full.file_path, fallbackBody);
      const meta: Record<string, string> = {
        Status: STATUS_LABEL[full.status] || full.status,
      };
      if (full.source_brs.length > 0) meta["Sources"] = full.source_brs.join(", ");
      if (full.file_path) meta["File"] = full.file_path;
      const entry: DetailEntry = {
        kind: "td",
        displayId: full.td_id,
        title: `${full.td_id} · ${full.title}`,
        content,
        meta,
        currentStatus: full.status,
        stories: full.stories || [],
      };
      setDetailStack((prev) => (mode === "push" ? [...prev, entry] : [entry]));
      setDetailLoading(false);
    },
    [projectId, fetchContent],
  );

  const openBreakdown = useCallback(
    async (td: ApiTechDoc, mode: "replace" | "push" = "push") => {
      const path = breakdownPathFromTd(td);
      if (!path) return;
      setDetailLoading(true);
      const fallbackBody =
        `*No breakdown plan found at \`${path}\`.*\n\n` +
        "The breakdown is written by `story-story-agent` after it runs " +
        "against this tech doc. Ask the assistant to generate the story " +
        "breakdown if it hasn't been done yet.";
      const content = await fetchContent(path, fallbackBody);
      const entry: DetailEntry = {
        kind: "breakdown",
        displayId: td.td_id,
        title: `${td.td_id} · Story breakdown plan`,
        content,
        meta: {
          "Tech Doc": `${td.td_id} · ${td.title}`,
          File: path,
        },
        currentStatus: "",
      };
      setDetailStack((prev) => (mode === "push" ? [...prev, entry] : [entry]));
      setDetailLoading(false);
    },
    [fetchContent],
  );

  const openStory = useCallback(
    async (s: ApiStory, mode: "replace" | "push" = "push") => {
      setDetailLoading(true);
      // Build a clean fallback body that surfaces ACs and source quote
      // so the panel is useful even before the agent has written a
      // dedicated PBI markdown file.
      const acBlock = s.acceptance_criteria.length
        ? "\n\n## Acceptance criteria\n\n" +
          s.acceptance_criteria.map((a, i) => `${i + 1}. ${a}`).join("\n")
        : "";
      const fallbackBody =
        (s.summary || "*This story has no summary yet.*") + acBlock;
      const content = await fetchContent(s.file_path, fallbackBody);
      // Parent TD lookup — best-effort, used only for the meta line.
      const parent = techDocs.find((td) => td.id === s.tech_doc_id);
      const meta: Record<string, string> = {
        Status: STATUS_LABEL[s.status] || s.status,
      };
      if (s.source_brs.length > 0) meta["Sources"] = s.source_brs.join(", ");
      if (parent) meta["Tech Doc"] = `${parent.td_id} · ${parent.title}`;
      if (s.file_path) meta["File"] = s.file_path;
      const entry: DetailEntry = {
        kind: "us",
        displayId: s.us_id,
        title: `${s.us_id} · ${s.title}`,
        content,
        meta,
        currentStatus: s.status,
      };
      setDetailStack((prev) => (mode === "push" ? [...prev, entry] : [entry]));
      setDetailLoading(false);
    },
    [techDocs, fetchContent],
  );

  // ── Client-side filters ─────────────────────────────────────────
  // Both tabs draw from the same `techDocs` payload — see reload()
  // above. The filters here are local so flipping tabs is instant
  // and TD-level filters never shadow stories on the other tab.

  const filteredTds = (() => {
    const q = search.trim().toLowerCase();
    return techDocs.filter((td) => {
      if (statusFilter !== "all" && td.status !== statusFilter) return false;
      if (!q) return true;
      if (td.td_id.toLowerCase().includes(q)) return true;
      if (td.title.toLowerCase().includes(q)) return true;
      if ((td.summary || "").toLowerCase().includes(q)) return true;
      if (td.source_brs.some((b) => b.toLowerCase().includes(q))) return true;
      return false;
    });
  })();

  // All stories across all TDs, with parent ref attached for the
  // Stories tab. Sorted by us_id so the project-wide sequence reads
  // chronologically.
  const allStories: { story: ApiStory; td: ApiTechDoc }[] = techDocs.flatMap((td) =>
    (td.stories || []).map((story) => ({ story, td })),
  );

  const filteredStories = (() => {
    const q = storySearch.trim().toLowerCase();
    return allStories.filter(({ story }) => {
      if (storyStatusFilter !== "all" && story.status !== storyStatusFilter) return false;
      if (!q) return true;
      if (story.us_id.toLowerCase().includes(q)) return true;
      if (story.title.toLowerCase().includes(q)) return true;
      if ((story.summary || "").toLowerCase().includes(q)) return true;
      if (story.source_brs.some((b) => b.toLowerCase().includes(q))) return true;
      return false;
    });
  })();

  // Story counts for the project-wide hero on the Stories tab.
  const storyCountsAll = storyCountsByStatus(allStories.map((x) => x.story));

  // ── Build-readiness calculator ───────────────────────────────────
  // Headline score = ((done + 0.5 * in_progress) / total_stories) × 100.
  // The half-credit on in-flight stories captures momentum that the
  // raw "done %" misses (a project that's 0% done but 50% in flight
  // is materially closer to release than one that's all `todo`).
  // 0 stories → 0% rather than NaN; tier defaults to "bad" so the
  // empty-project hero invites the user to seed work, not declare
  // victory.
  const buildPct = allStories.length
    ? Math.round(
        ((storyCountsAll.done + 0.5 * (storyCountsAll.in_progress || 0)) /
          allStories.length) * 100
      )
    : 0;
  const buildTier: "ok" | "warn" | "bad" =
    buildPct >= 85 ? "ok" : buildPct >= 65 ? "warn" : "bad";
  const buildLabel: string =
    buildTier === "ok" ? "Ready to ship"
      : buildTier === "warn" ? "In flight"
      : allStories.length === 0 ? "No stories yet" : "Early days";
  const approvedTdCount = techDocs.filter((td) => td.status === "approved").length;

  // ── Pagination slices ───────────────────────────────────────────
  const tdsTotalPages = Math.max(1, Math.ceil(filteredTds.length / tdsTable.pageSize));
  const tdsPageStart = (tdsTable.page - 1) * tdsTable.pageSize;
  const tdsPageEnd = Math.min(tdsPageStart + tdsTable.pageSize, filteredTds.length);
  const visibleTds = filteredTds.slice(tdsPageStart, tdsPageEnd);

  const storiesTotalPages = Math.max(1, Math.ceil(filteredStories.length / storiesTable.pageSize));
  const storiesPageStart = (storiesTable.page - 1) * storiesTable.pageSize;
  const storiesPageEnd = Math.min(storiesPageStart + storiesTable.pageSize, filteredStories.length);
  const visibleStories = filteredStories.slice(storiesPageStart, storiesPageEnd);

  // When a filter narrows results past the current page, clamp back
  // to the last valid page so the user doesn't land on an empty view.
  useEffect(() => {
    if (tdsTable.page > tdsTotalPages) tdsTable.setPage(tdsTotalPages);
  }, [tdsTotalPages, tdsTable]);
  useEffect(() => {
    if (storiesTable.page > storiesTotalPages) storiesTable.setPage(storiesTotalPages);
  }, [storiesTotalPages, storiesTable]);

  // Look up a story by US-NNN across all loaded TDs and open it. Used
  // by the US pills on a TD card and by ?highlight=US-NNN deep links.
  const openStoryById = useCallback(
    async (usId: string) => {
      // Fast path: look in the already-loaded story arrays.
      for (const td of techDocs) {
        const hit = (td.stories || []).find((s) => s.us_id === usId);
        if (hit) {
          await openStory(hit);
          return;
        }
      }
      // Slow path: fetch from API (covers stories on TDs that weren't
      // returned by the list endpoint, although include_stories=true
      // should make this rare).
      try {
        const s = await getStory(projectId, usId);
        await openStory(s);
      } catch {
        /* swallow — the pill becomes a no-op rather than a hard error */
      }
    },
    [techDocs, projectId, openStory],
  );

  // ── Deep-link auto-open (?highlight=…) ───────────────────────────
  useEffect(() => {
    if (!highlightId || techDocs.length === 0 || detail) return;
    if (highlightId.startsWith("TD-")) {
      const td = techDocs.find((t) => t.td_id === highlightId);
      if (td) openTechDoc(td);
    } else if (highlightId.startsWith("US-")) {
      openStoryById(highlightId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightId, techDocs]);

  // ── Detail close / pop ───────────────────────────────────────────
  const handleClose = useCallback(() => {
    setDetailStack((prev) => prev.slice(0, -1));
  }, []);

  // ── Status transition handler ────────────────────────────────────
  // Triggered by MarkdownPanel's action bar buttons. Patches the
  // backend, refreshes the list so the card pill updates, and rebuilds
  // the detail entry with the new status (so the active button shifts).
  const handleStatusChange = useCallback(
    async (newStatus: string) => {
      if (!detail) return;
      if (detail.currentStatus === newStatus) return; // no-op
      try {
        if (detail.kind === "td") {
          await updateTechDocStatus(projectId, detail.displayId, newStatus);
        } else {
          await updateStoryStatus(projectId, detail.displayId, newStatus);
        }
        const items = await reload();
        setTechDocs(items);
        if (detail.kind === "td") {
          const td = items.find((t) => t.td_id === detail.displayId);
          if (td) await openTechDoc(td, "replace");
        } else {
          const story = items
            .flatMap((t) => t.stories || [])
            .find((s) => s.us_id === detail.displayId);
          if (story) await openStory(story, "replace");
        }
      } catch (e) {
        // Surface but don't crash — the detail view stays on the old
        // status, the user can retry.
        console.error("status update failed", e);
      }
    },
    [detail, projectId, reload, openTechDoc, openStory],
  );

  // ── Detail render ────────────────────────────────────────────────
  if (detail) {
    // Status actions only on TD/US — the breakdown is read-only with
    // no status of its own.
    let actions: { label: string; value: string; color: string }[] | undefined;
    let onAction: ((value: string) => void) | undefined;
    if (detail.kind === "td" || detail.kind === "us") {
      const statusList = detail.kind === "td" ? TD_STATUSES : US_STATUSES;
      actions = statusList.map((s) => ({
        label:
          STATUS_LABEL[s] +
          (detail.currentStatus === s ? "  ✓" : ""),
        value: s,
        color: STATUS_COLOR[s] || "var(--ink-3, #888)",
      }));
      onAction = handleStatusChange;
    }

    let slotBottom: React.ReactNode | undefined;
    if (detail.kind === "td") {
      // The TD detail view gets the same status bar + breakdown button
      // the card has, so the value of "tldr" stays consistent between
      // the list and detail surfaces.
      const childStories = detail.stories || [];
      const td = techDocs.find((t) => t.td_id === detail.displayId);
      const breakdownAvailable = td ? breakdownPathFromTd(td) !== null : false;
      slotBottom = (
        <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 14 }}>
          {childStories.length > 0 && (
            <div>
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: 8,
                  fontSize: 11,
                  fontWeight: 700,
                  color: "var(--ink-3, #888)",
                  letterSpacing: ".06em",
                  textTransform: "uppercase",
                  marginBottom: 8,
                }}
              >
                <span>Stories · {childStories.length}</span>
                <span style={{ flex: 1 }} />
                {breakdownAvailable && td && (
                  <button
                    type="button"
                    onClick={() => openBreakdown(td, "push")}
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: "var(--accent, #2563eb)",
                      background: "transparent",
                      border: "1px solid var(--accent, #2563eb)",
                      borderRadius: 6,
                      padding: "3px 9px",
                      cursor: "pointer",
                      fontFamily: "inherit",
                      letterSpacing: 0,
                      textTransform: "none",
                    }}
                  >
                    📋 View breakdown plan
                  </button>
                )}
              </div>
              <div style={{ marginBottom: 10 }}>
                <StoryStatusBar stories={childStories} />
              </div>
              {childStories.map((s) => (
                <StoryRow
                  key={s.id}
                  story={s}
                  projectId={projectId}
                  onOpen={(story) => openStory(story, "push")}
                />
              ))}
            </div>
          )}
          {childStories.length === 0 && breakdownAvailable && td && (
            <div>
              <button
                type="button"
                onClick={() => openBreakdown(td, "push")}
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: "var(--accent, #2563eb)",
                  background: "transparent",
                  border: "1px solid var(--accent, #2563eb)",
                  borderRadius: 6,
                  padding: "5px 12px",
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                📋 View breakdown plan
              </button>
            </div>
          )}
        </div>
      );
    }

    return (
      <div className="data-panel" style={{ flex: 1, width: "100%" }}>
        <MarkdownPanel
          title={detail.title}
          content={detail.content}
          meta={detail.meta}
          onClose={handleClose}
          readOnly
          actions={actions}
          onAction={onAction}
          slotBottom={slotBottom}
        />
        {detailLoading && (
          <div
            style={{
              position: "absolute",
              top: 12,
              right: 16,
              fontSize: 11,
              color: "var(--ink-3, #888)",
            }}
          >
            Loading…
          </div>
        )}
      </div>
    );
  }

  // ── List render ──────────────────────────────────────────────────
  return (
    <div className={`data-panel${heroCollapsed ? " hero-collapsed" : ""}`} style={{ flex: 1, width: "100%" }}>
      {/* Hero — Discovery's exact `.dp-readiness` markup so the
          existing `.dp-header` height transition + `.hero-collapsed`
          collapse animation apply for free. The score is the Phase 2
          equivalent of Discovery's readiness: weighted combination
          of done + half-credit-for-in-flight stories. */}
      <div className="dp-header">
        {(() => {
          const c = 2 * Math.PI * 32;
          return (
            <div className={`dp-readiness rd-tier-${buildTier}`}>
              <div className="dp-rb-ring">
                <svg viewBox="0 0 72 72">
                  <circle cx="36" cy="36" r="32" className="bg" />
                  <circle
                    cx="36"
                    cy="36"
                    r="32"
                    className="fg"
                    style={{
                      strokeDasharray: c,
                      strokeDashoffset: c * (1 - buildPct / 100),
                    }}
                  />
                </svg>
                <div className="dp-rb-val">{buildPct}%</div>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="dp-rb-label">Phase 2 — Build progress</div>
                <div className="dp-rb-sub">{buildLabel}</div>
                <div className="dp-rb-stats">
                  <span className="num">{techDocs.length}</span> tech doc{techDocs.length !== 1 ? "s" : ""}
                  {" · "}
                  <span className={`num${approvedTdCount > 0 ? " num-ok" : ""}`}>{approvedTdCount}</span> approved
                  {" · "}
                  <span className="num">{allStories.length}</span> stor{allStories.length !== 1 ? "ies" : "y"}
                  {" · "}
                  <span className={`num${storyCountsAll.done > 0 ? " num-ok" : ""}`}>{storyCountsAll.done || 0}</span> done
                  {(storyCountsAll.in_progress || 0) > 0 && <>
                    {" · "}<span className="num">{storyCountsAll.in_progress}</span> in flight
                  </>}
                  {(storyCountsAll.dropped || 0) > 0 && <>
                    {" · "}<span className="num num-bad">{storyCountsAll.dropped}</span> dropped
                  </>}
                </div>
              </div>
            </div>
          );
        })()}
      </div>

      <div className="dp-tabs">
        <div
          className={`dp-tab${activeTab === "docs" ? " active" : ""}`}
          onClick={() => setActiveTab("docs")}
        >
          Tech Docs
          {techDocs.length > 0 && (
            <span className="tab-count">
              {techDocs.length}
              <span className="tab-count-label">total</span>
            </span>
          )}
        </div>
        <div
          className={`dp-tab${activeTab === "stories" ? " active" : ""}`}
          onClick={() => setActiveTab("stories")}
        >
          Stories
          {allStories.length > 0 && (
            <span className="tab-count">
              {allStories.length}
              <span className="tab-count-label">total</span>
            </span>
          )}
        </div>
      </div>

      <div className="dp-body">
        <div className={`dp-tab-content${activeTab === "docs" ? " active" : ""}`}
             style={{ display: activeTab === "docs" ? undefined : "none" }}>
          {/* Filter + search — empty-state path skips the row so first-
           *  time projects don't see filter UI for nothing. */}
          {!loading && (techDocs.length > 0 || statusFilter !== "all" || search.trim()) && (
            <div
              className="filters"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                flexWrap: "wrap",
                padding: "10px 32px 12px",
                marginBottom: 0,
                borderBottom: "1px solid var(--line)",
              }}
            >
              <div style={{ position: "relative", flex: "1 1 200px", minWidth: 0 }}>
                <svg
                  viewBox="0 0 24 24"
                  aria-hidden
                  style={{
                    position: "absolute",
                    left: 10,
                    top: "50%",
                    transform: "translateY(-50%)",
                    width: 13,
                    height: 13,
                    color: "var(--ink-4)",
                    stroke: "currentColor",
                    fill: "none",
                    strokeWidth: 2,
                  }}
                >
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search title, TD-id, BR-id…"
                  style={{
                    width: "100%",
                    fontSize: 12,
                    padding: "6px 28px 6px 30px",
                    border: "1px solid var(--line)",
                    borderRadius: 999,
                    background: "var(--surface)",
                    color: "var(--ink)",
                    outline: "none",
                    fontFamily: "inherit",
                  }}
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => setSearch("")}
                    title="Clear"
                    style={{
                      position: "absolute",
                      right: 8,
                      top: "50%",
                      transform: "translateY(-50%)",
                      width: 16,
                      height: 16,
                      padding: 0,
                      border: "none",
                      background: "none",
                      color: "var(--ink-4)",
                      cursor: "pointer",
                      fontSize: 14,
                      lineHeight: 1,
                    }}
                  >
                    ×
                  </button>
                )}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
                {TD_STATUS_FILTERS.map((f) => (
                  <FilterChip
                    key={f.value}
                    value={f.value}
                    label={f.label}
                    active={statusFilter === f.value}
                    onClick={() => setStatusFilter(f.value)}
                  />
                ))}
              </div>
            </div>
          )}
          <div className="reqs-scroll" ref={docsScrollRef} style={{ paddingTop: 14 }}>
          {loading ? (
            <div
              style={{
                padding: "40px 16px",
                textAlign: "center",
                fontSize: 13,
                color: "var(--ink-3, #888)",
              }}
            >
              Loading tech docs…
            </div>
          ) : filteredTds.length === 0 ? (
            (statusFilter !== "all" || search.trim()) ? (
              <div
                style={{
                  padding: "40px 24px",
                  textAlign: "center",
                  color: "var(--ink-3, #888)",
                }}
              >
                <div style={{ fontSize: 13, marginBottom: 10 }}>
                  No tech docs match the current filter.
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setStatusFilter("all");
                    setSearch("");
                  }}
                  style={{
                    fontSize: 12,
                    fontWeight: 500,
                    padding: "5px 12px",
                    border: "1px solid var(--border, #e5e5e5)",
                    borderRadius: 6,
                    background: "var(--surface, #fff)",
                    color: "var(--ink-2, #444)",
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  Clear filters
                </button>
              </div>
            ) : (
            <div
              style={{
                padding: "60px 24px",
                textAlign: "center",
                color: "var(--ink-3, #888)",
              }}
            >
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 500,
                  color: "var(--ink-2, #444)",
                  marginBottom: 8,
                }}
              >
                No tech docs yet
              </div>
              <div style={{ fontSize: 12, lineHeight: 1.6 }}>
                Once Discovery has signed-off requirements, ask the assistant to{" "}
                <code
                  style={{
                    fontFamily: "monospace",
                    background: "var(--surface-2, #f0f0f0)",
                    padding: "1px 6px",
                    borderRadius: 4,
                  }}
                >
                  /generate-tech-doc &lt;feature&gt;
                </code>
                . The story-tech-agent writes to{" "}
                <code style={{ fontFamily: "monospace" }}>docs/tech-docs/</code>{" "}
                and the index lands here.
              </div>
            </div>
            )
          ) : (
            <div>
              {visibleTds.map((td) => (
                <TechDocCard
                  key={td.id}
                  td={td}
                  projectId={projectId}
                  onOpen={openTechDoc}
                  onOpenStory={openStoryById}
                  onOpenBreakdown={(target) => openBreakdown(target, "replace")}
                />
              ))}
            </div>
          )}
          </div>
          {!loading && filteredTds.length > 0 && (
            <Pagination
              state={tdsTable}
              total={filteredTds.length}
              pageStart={tdsPageStart}
              pageEnd={tdsPageEnd}
              totalPages={tdsTotalPages}
            />
          )}
        </div>

        {/* ── Stories tab ───────────────────────────────────────── */}
        <div className={`dp-tab-content${activeTab === "stories" ? " active" : ""}`}
             style={{ display: activeTab === "stories" ? undefined : "none" }}>
          {!loading && (allStories.length > 0 || storyStatusFilter !== "all" || storySearch.trim()) && (
            <div
              className="filters"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                flexWrap: "wrap",
                padding: "10px 32px 12px",
                marginBottom: 0,
                borderBottom: "1px solid var(--line)",
              }}
            >
              <div style={{ position: "relative", flex: "1 1 200px", minWidth: 0 }}>
                <svg
                  viewBox="0 0 24 24"
                  aria-hidden
                  style={{
                    position: "absolute",
                    left: 10,
                    top: "50%",
                    transform: "translateY(-50%)",
                    width: 13,
                    height: 13,
                    color: "var(--ink-4)",
                    stroke: "currentColor",
                    fill: "none",
                    strokeWidth: 2,
                  }}
                >
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <input
                  type="search"
                  value={storySearch}
                  onChange={(e) => setStorySearch(e.target.value)}
                  placeholder="Search title, US-id, BR-id…"
                  style={{
                    width: "100%",
                    fontSize: 12,
                    padding: "6px 28px 6px 30px",
                    border: "1px solid var(--line)",
                    borderRadius: 999,
                    background: "var(--surface)",
                    color: "var(--ink)",
                    outline: "none",
                    fontFamily: "inherit",
                  }}
                />
                {storySearch && (
                  <button
                    type="button"
                    onClick={() => setStorySearch("")}
                    title="Clear"
                    style={{
                      position: "absolute",
                      right: 8,
                      top: "50%",
                      transform: "translateY(-50%)",
                      width: 16,
                      height: 16,
                      padding: 0,
                      border: "none",
                      background: "none",
                      color: "var(--ink-4)",
                      cursor: "pointer",
                      fontSize: 14,
                      lineHeight: 1,
                    }}
                  >
                    ×
                  </button>
                )}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
                {US_STATUS_FILTERS.map((f) => (
                  <FilterChip
                    key={f.value}
                    value={f.value}
                    label={f.label}
                    active={storyStatusFilter === f.value}
                    onClick={() => setStoryStatusFilter(f.value)}
                  />
                ))}
              </div>
              <button
                type="button"
                onClick={() => setGroupByTd(!groupByTd)}
                className="panel-filter-btn"
                title={groupByTd ? "Switch to flat list" : "Group by parent tech doc"}
                style={{ display: "inline-flex", alignItems: "center", gap: 5 }}
              >
                {groupByTd ? "▤ Grouped" : "≡ Flat"}
              </button>
            </div>
          )}

          {/* Project-wide story progress hero — only shown when there's
              data so the Stories tab doesn't show a 0/0 bar before the
              agent has run. The project-wide hero above already
              carries the headline numbers, so we don't repeat them
              inside the tab body. */}
          <div className="reqs-scroll" ref={storiesScrollRef} style={{ paddingTop: 14 }}>
          {loading ? (
            <div
              style={{
                padding: "40px 16px",
                textAlign: "center",
                fontSize: 13,
                color: "var(--ink-3, #888)",
              }}
            >
              Loading stories…
            </div>
          ) : filteredStories.length === 0 ? (
            (storyStatusFilter !== "all" || storySearch.trim()) ? (
              <div
                style={{
                  padding: "40px 24px",
                  textAlign: "center",
                  color: "var(--ink-3)",
                }}
              >
                <div style={{ fontSize: 13, marginBottom: 10 }}>
                  No stories match the current filter.
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setStoryStatusFilter("all");
                    setStorySearch("");
                  }}
                  style={{
                    fontSize: 12,
                    fontWeight: 500,
                    padding: "5px 12px",
                    border: "1px solid var(--line)",
                    borderRadius: 6,
                    background: "var(--surface)",
                    color: "var(--ink-2)",
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  Clear filters
                </button>
              </div>
            ) : (
              <div
                style={{
                  padding: "60px 24px",
                  textAlign: "center",
                  color: "var(--ink-3)",
                }}
              >
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: 500,
                    color: "var(--ink-2)",
                    marginBottom: 8,
                  }}
                >
                  No stories yet
                </div>
                <div style={{ fontSize: 12, lineHeight: 1.6 }}>
                  Once a tech doc exists, ask the assistant to break it into PBIs (story-story-agent). Stories land here grouped by their parent tech doc.
                </div>
              </div>
            )
          ) : groupByTd ? (
            <StoriesGroupedByTd
              filtered={visibleStories}
              projectId={projectId}
              onOpenStory={(s) => openStory(s, "replace")}
              onOpenTd={(td) => openTechDoc(td, "replace")}
            />
          ) : (
            <div className="ts-group">
              {visibleStories.map(({ story }) => (
                <StoryRow
                  key={story.id}
                  story={story}
                  projectId={projectId}
                  onOpen={(s) => openStory(s, "replace")}
                />
              ))}
            </div>
          )}
          </div>
          {!loading && filteredStories.length > 0 && (
            <Pagination
              state={storiesTable}
              total={filteredStories.length}
              pageStart={storiesPageStart}
              pageEnd={storiesPageEnd}
              totalPages={storiesTotalPages}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// Stories list grouped by parent TD. Each group renders a TD header
// (clickable → opens TD detail) and the matching stories underneath.
// Empty TDs (no matching story after filter) are skipped so the user
// only sees groups with content.
function StoriesGroupedByTd({
  filtered,
  projectId,
  onOpenStory,
  onOpenTd,
}: {
  filtered: { story: ApiStory; td: ApiTechDoc }[];
  projectId: string;
  onOpenStory: (s: ApiStory) => void;
  onOpenTd: (td: ApiTechDoc) => void;
}) {
  // Preserve the order TDs appeared in (sorted by td_id at the source).
  const groups = new Map<string, { td: ApiTechDoc; stories: ApiStory[] }>();
  for (const { story, td } of filtered) {
    const g = groups.get(td.id);
    if (g) g.stories.push(story);
    else groups.set(td.id, { td, stories: [story] });
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {Array.from(groups.values()).map(({ td, stories }) => {
        const counts = storyCountsByStatus(stories);
        const pct = stories.length ? Math.round((counts.done / stories.length) * 100) : 0;
        return (
          <div key={td.id} className="ts-group">
            <div className="ts-group-head" onClick={() => onOpenTd(td)}>
              <SourcePill displayId={td.td_id} projectId={projectId} onClick={() => onOpenTd(td)} />
              <span
                style={{
                  flex: 1,
                  minWidth: 0,
                  fontSize: 14,
                  fontWeight: 600,
                  color: "var(--ink)",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  letterSpacing: "-.01em",
                }}
              >
                {td.title}
              </span>
              <span style={{ fontSize: 11, fontWeight: 600, color: "var(--ink-3)" }}>
                {counts.done} / {stories.length} done
              </span>
              <MiniRing pct={pct} size={32} stroke={3} />
            </div>
            {stories.map((story) => (
              <StoryRow key={story.id} story={story} projectId={projectId} onOpen={onOpenStory} />
            ))}
          </div>
        );
      })}
    </div>
  );
}
