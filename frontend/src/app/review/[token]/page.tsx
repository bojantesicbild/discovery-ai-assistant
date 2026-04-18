"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { renderMarkdown } from "@/lib/markdown";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface HandoffDoc {
  type: string;
  label: string;
  size: number;
}

interface Requirement {
  req_id: string;
  title: string;
  priority: string;
  description: string;
  user_perspective?: string;
  business_rules?: string[];
  acceptance_criteria?: string[];
  edge_cases?: string[];
  source_quote?: string | null;
  source_doc?: string | null;
  status: string;
}

interface Gap {
  gap_id: string;
  question: string;
  severity: string;
  area: string;
  blocked_reqs?: string[];
  suggested_action?: string;
  source_quote?: string | null;
  source_doc?: string | null;
}

interface ReviewData {
  project_name: string;
  client_name?: string;
  round_number: number;
  already_submitted: boolean;
  requirements: Record<string, Requirement[]>;
  gaps: Gap[];
}

type ReqAction = "confirm" | "discuss" | "skip";
type GapActionType = "answer" | "skip";

const PRIORITY_ORDER = ["must", "should", "could", "wont"] as const;
const PRIORITY_LABELS: Record<string, string> = {
  must: "Must Have",
  should: "Should Have",
  could: "Could Have",
  wont: "Won't Have",
};
const PRIORITY_SHORT: Record<string, string> = {
  must: "Must",
  should: "Should",
  could: "Could",
  wont: "Won't",
};
const PRIORITY_COLORS: Record<string, { bg: string; text: string; border: string; fill: string }> = {
  must: { bg: "#fef2f2", text: "#dc2626", border: "#fecaca", fill: "#dc2626" },
  should: { bg: "#fffbeb", text: "#d97706", border: "#fde68a", fill: "#d97706" },
  could: { bg: "#eff6ff", text: "#2563eb", border: "#bfdbfe", fill: "#2563eb" },
  wont: { bg: "#f9fafb", text: "#6b7280", border: "#e5e7eb", fill: "#6b7280" },
};
const PRIORITY_RANK: Record<string, number> = { must: 0, should: 1, could: 2, wont: 3 };

const STORAGE_KEY = (token: string) => `review:${token}:progress`;

interface StoredProgress {
  reqActions: Record<string, ReqAction>;
  reqNotes: Record<string, string>;
  gapActions: Record<string, GapActionType>;
  gapAnswers: Record<string, string>;
  savedAt: number;
}

function loadProgress(token: string): StoredProgress | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY(token));
    if (!raw) return null;
    return JSON.parse(raw) as StoredProgress;
  } catch { return null; }
}

function saveProgress(token: string, p: StoredProgress) {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(STORAGE_KEY(token), JSON.stringify(p)); } catch {}
}

function clearProgress(token: string) {
  if (typeof window === "undefined") return;
  try { window.localStorage.removeItem(STORAGE_KEY(token)); } catch {}
}

const reqElemId = (id: string) => `review-req-${id}`;
const gapElemId = (id: string) => `review-gap-${id}`;

function reqToMarkdown(req: Requirement): string {
  const lines: string[] = [];
  lines.push(`# ${req.req_id}: ${req.title}`);
  lines.push("");
  lines.push(`**Priority:** ${req.priority.toUpperCase()}  ·  **Status:** ${req.status}`);
  if (req.user_perspective) {
    lines.push("");
    lines.push(`> ${req.user_perspective.replace(/\n/g, "\n> ")}`);
  }
  lines.push("");
  lines.push("## Description");
  lines.push(req.description || "_No description._");
  if (req.business_rules && req.business_rules.length > 0) {
    lines.push("");
    lines.push("## Business Rules");
    for (const r of req.business_rules) lines.push(`- ${r}`);
  }
  if (req.acceptance_criteria && req.acceptance_criteria.length > 0) {
    lines.push("");
    lines.push("## Acceptance Criteria");
    for (const ac of req.acceptance_criteria) lines.push(`- ${ac}`);
  }
  if (req.edge_cases && req.edge_cases.length > 0) {
    lines.push("");
    lines.push("## Edge Cases");
    for (const e of req.edge_cases) lines.push(`- ${e}`);
  }
  if (req.source_quote) {
    lines.push("");
    lines.push("## From the Source");
    lines.push(`> ${req.source_quote.replace(/\n/g, "\n> ")}`);
  }
  if (req.source_doc) {
    lines.push("");
    lines.push(`_Source: ${req.source_doc}_`);
  }
  return lines.join("\n");
}

function gapToMarkdown(gap: Gap): string {
  const lines: string[] = [];
  lines.push(`# ${gap.gap_id}`);
  lines.push("");
  lines.push(`## ${gap.question}`);
  lines.push("");
  lines.push(`**Severity:** ${gap.severity}  ·  **Area:** ${gap.area}`);
  if (gap.blocked_reqs && gap.blocked_reqs.length > 0) {
    lines.push("");
    lines.push(`**Blocks:** ${gap.blocked_reqs.join(", ")}`);
  }
  if (gap.suggested_action) {
    lines.push("");
    lines.push("## Suggested Action");
    lines.push(gap.suggested_action);
  }
  if (gap.source_quote) {
    lines.push("");
    lines.push("## From the Source");
    lines.push(`> ${gap.source_quote.replace(/\n/g, "\n> ")}`);
  }
  if (gap.source_doc) {
    lines.push("");
    lines.push(`_Source: ${gap.source_doc}_`);
  }
  return lines.join("\n");
}

function scrollToId(elemId: string) {
  const el = document.getElementById(elemId);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.add("review-flash");
  window.setTimeout(() => el.classList.remove("review-flash"), 1200);
}

export default function ClientReviewPage() {
  const params = useParams();
  const token = params.token as string;

  const [data, setData] = useState<ReviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [reqActions, setReqActions] = useState<Record<string, ReqAction>>({});
  const [reqNotes, setReqNotes] = useState<Record<string, string>>({});
  const [gapActions, setGapActions] = useState<Record<string, GapActionType>>({});
  const [gapAnswers, setGapAnswers] = useState<Record<string, string>>({});

  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [activeItem, setActiveItem] = useState<string | null>(null); // "req:BR-001" or "gap:GAP-02"

  // Handoff doc viewer state
  const [handoffDocs, setHandoffDocs] = useState<HandoffDoc[]>([]);
  const [handoffOpen, setHandoffOpen] = useState<string | null>(null); // doc_type currently viewing
  const [handoffContent, setHandoffContent] = useState<Record<string, string>>({});
  const [handoffLoading, setHandoffLoading] = useState(false);

  // Per-item detail modal
  const [itemDetail, setItemDetail] = useState<{ title: string; content: string } | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitResult, setSubmitResult] = useState<{
    confirmed: number; discussed: number; gaps_answered: number; readiness_score?: number;
  } | null>(null);

  // ── Load review data, hydrate from localStorage ──
  useEffect(() => {
    fetch(`${API_URL}/api/review/${token}`)
      .then(async (r) => {
        if (!r.ok) {
          const err = await r.json().catch(() => ({ detail: "Link is invalid or has expired." }));
          throw new Error(err.detail);
        }
        return r.json();
      })
      .then((d) => {
        setData(d);
        if (d.already_submitted) setSubmitted(true);
        const stored = loadProgress(token);
        if (stored && !d.already_submitted) {
          setReqActions(stored.reqActions || {});
          setReqNotes(stored.reqNotes || {});
          setGapActions(stored.gapActions || {});
          setGapAnswers(stored.gapAnswers || {});
          setSavedAt(stored.savedAt || null);
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [token]);

  // ── Load list of available handoff docs (lightweight) ──
  useEffect(() => {
    fetch(`${API_URL}/api/review/${token}/handoff`)
      .then((r) => (r.ok ? r.json() : { docs: [] }))
      .then((d) => setHandoffDocs(d.docs || []))
      .catch(() => setHandoffDocs([]));
  }, [token]);

  const openHandoff = useCallback(async (docType: string) => {
    setHandoffOpen(docType);
    if (handoffContent[docType] !== undefined) return; // already cached
    setHandoffLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/review/${token}/handoff/${docType}`);
      const d = await res.json();
      setHandoffContent((prev) => ({ ...prev, [docType]: d.content || "" }));
    } catch {
      setHandoffContent((prev) => ({ ...prev, [docType]: "" }));
    } finally {
      setHandoffLoading(false);
    }
  }, [token, handoffContent]);

  // ── Debounced autosave ──
  const saveTimer = useRef<number | null>(null);
  useEffect(() => {
    if (!data || submitted) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      const now = Date.now();
      saveProgress(token, { reqActions, reqNotes, gapActions, gapAnswers, savedAt: now });
      setSavedAt(now);
    }, 500);
    return () => { if (saveTimer.current) window.clearTimeout(saveTimer.current); };
  }, [reqActions, reqNotes, gapActions, gapAnswers, data, submitted, token]);

  // ── Build ordered item list + relation maps ──
  const { allReqs, orderedItems, reqToGaps, gapToReqs, gapClusters } = useMemo(() => {
    const allReqs: Requirement[] = [];
    if (data) {
      for (const p of PRIORITY_ORDER) {
        for (const r of data.requirements[p] || []) allReqs.push(r);
      }
    }
    const reqById = new Map<string, Requirement>();
    allReqs.forEach((r) => reqById.set(r.req_id, r));

    const reqToGaps: Record<string, Gap[]> = {};
    const gapToReqs: Record<string, { req_id: string; priority: string }[]> = {};
    const gapCluster = new Map<string, string>(); // gap_id -> cluster key ("must"|"should"|"could"|"wont"|"standalone")

    for (const g of data?.gaps || []) {
      const blocked = (g.blocked_reqs || []).filter((id) => reqById.has(id));
      gapToReqs[g.gap_id] = blocked.map((id) => ({ req_id: id, priority: reqById.get(id)!.priority }));
      for (const id of blocked) {
        if (!reqToGaps[id]) reqToGaps[id] = [];
        reqToGaps[id].push(g);
      }
      // effective cluster = highest-priority req this gap blocks
      const rank = blocked
        .map((id) => PRIORITY_RANK[reqById.get(id)!.priority] ?? 99)
        .reduce<number>((a, b) => Math.min(a, b), 99);
      const cluster = rank < 99 ? PRIORITY_ORDER[rank] : "standalone";
      gapCluster.set(g.gap_id, cluster);
    }

    // Ordered items for keyboard nav: reqs by priority, then gaps by cluster
    const ordered: string[] = [];
    for (const p of PRIORITY_ORDER) {
      for (const r of data?.requirements[p] || []) ordered.push(`req:${r.req_id}`);
    }
    const clusterOrder = [...PRIORITY_ORDER, "standalone"];
    const gapClusters: { key: string; gaps: Gap[] }[] = clusterOrder.map((k) => ({
      key: k,
      gaps: (data?.gaps || []).filter((g) => gapCluster.get(g.gap_id) === k),
    })).filter((c) => c.gaps.length > 0);
    for (const c of gapClusters) {
      for (const g of c.gaps) ordered.push(`gap:${g.gap_id}`);
    }

    return { allReqs, orderedItems: ordered, reqToGaps, gapToReqs, gapClusters };
  }, [data]);

  // ── Submit ──
  async function handleSubmit() {
    if (!data) return;
    setSubmitting(true);
    try {
      const res = await fetch(`${API_URL}/api/review/${token}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requirement_actions: allReqs.map((r) => ({
            req_id: r.req_id,
            action: reqActions[r.req_id] || "skip",
            note: reqNotes[r.req_id] || null,
          })),
          gap_actions: data.gaps.map((g) => ({
            gap_id: g.gap_id,
            action: gapActions[g.gap_id] || "skip",
            answer: gapAnswers[g.gap_id] || null,
          })),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Submission failed" }));
        throw new Error(err.detail);
      }
      const result = await res.json();
      setSubmitResult(result);
      setSubmitted(true);
      clearProgress(token);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  // ── Progress stats ──
  const tierStats = useMemo(() => {
    const stats: { key: string; label: string; done: number; total: number; color: typeof PRIORITY_COLORS[string] }[] = [];
    for (const p of PRIORITY_ORDER) {
      const reqs = data?.requirements[p] || [];
      if (reqs.length === 0) continue;
      const done = reqs.filter((r) => reqActions[r.req_id]).length;
      stats.push({ key: p, label: PRIORITY_SHORT[p], done, total: reqs.length, color: PRIORITY_COLORS[p] });
    }
    if (data && data.gaps.length > 0) {
      const done = data.gaps.filter((g) => gapActions[g.gap_id]).length;
      stats.push({
        key: "gaps",
        label: "Open?",
        done,
        total: data.gaps.length,
        color: { bg: "#f5f3ff", text: "#7c3aed", border: "#ddd6fe", fill: "#7c3aed" },
      });
    }
    return stats;
  }, [data, reqActions, gapActions]);

  const totalItems = (data ? allReqs.length + data.gaps.length : 0);
  const actedOn = Object.keys(reqActions).length + Object.keys(gapActions).length;
  const pctComplete = totalItems === 0 ? 0 : Math.round((actedOn / totalItems) * 100);

  // ── Keyboard navigation ──
  const currentIndex = useMemo(() => {
    if (!activeItem) return -1;
    return orderedItems.indexOf(activeItem);
  }, [activeItem, orderedItems]);

  const focusItem = useCallback((itemKey: string) => {
    setActiveItem(itemKey);
    const [kind, id] = itemKey.split(":");
    scrollToId(kind === "req" ? reqElemId(id) : gapElemId(id));
  }, []);

  const setReqAction = useCallback((reqId: string, action: ReqAction | undefined) => {
    setReqActions((prev) => {
      const next = { ...prev };
      if (!action || prev[reqId] === action) delete next[reqId];
      else next[reqId] = action;
      return next;
    });
  }, []);

  const setGapAction = useCallback((gapId: string, action: GapActionType | undefined) => {
    setGapActions((prev) => {
      const next = { ...prev };
      if (!action || prev[gapId] === action) delete next[gapId];
      else next[gapId] = action;
      return next;
    });
  }, []);

  useEffect(() => {
    if (submitted || !data) return;
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (target && (target.tagName === "TEXTAREA" || target.tagName === "INPUT")) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === "?" && e.shiftKey) {
        setShowShortcuts((s) => !s);
        return;
      }
      if (e.key === "Escape") {
        setShowShortcuts(false);
        return;
      }
      if (!orderedItems.length) return;

      if (e.key === "j" || e.key === "J" || e.key === "ArrowDown") {
        e.preventDefault();
        const next = currentIndex < 0 ? 0 : Math.min(orderedItems.length - 1, currentIndex + 1);
        focusItem(orderedItems[next]);
        return;
      }
      if (e.key === "k" || e.key === "K" || e.key === "ArrowUp") {
        e.preventDefault();
        const next = currentIndex < 0 ? 0 : Math.max(0, currentIndex - 1);
        focusItem(orderedItems[next]);
        return;
      }
      if (!activeItem) return;
      const [kind, id] = activeItem.split(":");
      if (kind === "req") {
        if (e.key === "1" || e.key === "c" || e.key === "C") { setReqAction(id, "confirm"); return; }
        if (e.key === "2" || e.key === "d" || e.key === "D") { setReqAction(id, "discuss"); return; }
        if (e.key === "3" || e.key === "s" || e.key === "S") { setReqAction(id, "skip"); return; }
      } else if (kind === "gap") {
        if (e.key === "1" || e.key === "a" || e.key === "A") { setGapAction(id, "answer"); return; }
        if (e.key === "3" || e.key === "s" || e.key === "S") { setGapAction(id, "skip"); return; }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [orderedItems, currentIndex, activeItem, focusItem, setReqAction, setGapAction, submitted, data]);

  // ── Scroll to first unreviewed on initial load ──
  const initialScrollDone = useRef(false);
  useEffect(() => {
    if (!data || submitted || initialScrollDone.current) return;
    if (!orderedItems.length) return;
    initialScrollDone.current = true;
    // only auto-scroll if there's saved progress (user is resuming)
    if (!savedAt) return;
    const firstUnreviewed = orderedItems.find((item) => {
      const [kind, id] = item.split(":");
      if (kind === "req") return !reqActions[id];
      return !gapActions[id];
    });
    if (firstUnreviewed) {
      // small delay so layout settles
      window.setTimeout(() => focusItem(firstUnreviewed), 300);
    }
  }, [data, submitted, orderedItems, reqActions, gapActions, savedAt, focusItem]);

  // Override body overflow for this standalone page
  useEffect(() => {
    document.body.style.overflow = "auto";
    document.body.style.height = "auto";
    return () => {
      document.body.style.overflow = "";
      document.body.style.height = "";
    };
  }, []);

  // ── Loading / Error / Submitted states ──
  if (loading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f8fafc" }}>
        <div style={{ textAlign: "center", color: "#94a3b8" }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>Loading review...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f8fafc" }}>
        <div style={{ textAlign: "center", maxWidth: 400, padding: 40 }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🔒</div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: "#0f172a", marginBottom: 8 }}>Link unavailable</h1>
          <p style={{ fontSize: 14, color: "#64748b", lineHeight: 1.6 }}>{error}</p>
          <p style={{ fontSize: 12, color: "#94a3b8", marginTop: 16 }}>Contact your project manager for a new link.</p>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f8fafc" }}>
        <div style={{ textAlign: "center", maxWidth: 480, padding: 40 }}>
          <div style={{ width: 64, height: 64, borderRadius: "50%", background: "#d1fae5", color: "#059669", margin: "0 auto 20px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28 }}>✓</div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "#0f172a", marginBottom: 8 }}>Thank you for your review!</h1>
          <p style={{ fontSize: 14, color: "#64748b", lineHeight: 1.6, marginBottom: 20 }}>
            Your project manager has been notified and will follow up on any items you flagged for discussion.
          </p>
          {submitResult && (
            <div style={{ display: "flex", gap: 16, justifyContent: "center", marginBottom: 20 }}>
              <StatPill label="Confirmed" value={submitResult.confirmed} color="#059669" />
              <StatPill label="For discussion" value={submitResult.discussed} color="#d97706" />
              <StatPill label="Gaps answered" value={submitResult.gaps_answered} color="#2563eb" />
            </div>
          )}
          {submitResult?.readiness_score !== undefined && (
            <div style={{ fontSize: 13, color: "#64748b" }}>
              Project readiness: <strong style={{ color: "#0f172a" }}>{submitResult.readiness_score}%</strong>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (!data) return null;

  // ── Main review view ──
  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc" }}>
      <style>{`
        @keyframes reviewFlash {
          0% { box-shadow: 0 0 0 0 rgba(0, 229, 160, 0); }
          30% { box-shadow: 0 0 0 4px rgba(0, 229, 160, 0.35); }
          100% { box-shadow: 0 0 0 0 rgba(0, 229, 160, 0); }
        }
        .review-flash { animation: reviewFlash 1s ease-out; }
        .review-card { transition: border 0.15s, box-shadow 0.2s; }
        .review-card.active { box-shadow: 0 0 0 3px rgba(0, 229, 160, 0.25); }
      `}</style>

      {/* Sticky header */}
      <div style={{
        position: "sticky", top: 0, zIndex: 50,
        background: "#fff", borderBottom: "1px solid #e2e8f0",
        padding: "14px 24px",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 12 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 10, background: "#00E5A0",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontWeight: 800, color: "#0f172a", fontSize: 16,
          }}>{(data.client_name || data.project_name).charAt(0).toUpperCase()}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1 style={{ fontSize: 16, fontWeight: 700, color: "#0f172a", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {data.project_name}
            </h1>
            <div style={{ fontSize: 12, color: "#64748b" }}>
              Review round {data.round_number}{data.client_name && ` · ${data.client_name}`}
            </div>
          </div>
          {handoffDocs.length > 0 && (
            <button
              onClick={() => openHandoff(handoffDocs.find((d) => d.type === "discovery_brief")?.type || handoffDocs[0].type)}
              title="Read the full Discovery Brief"
              style={{
                padding: "6px 12px", borderRadius: 8,
                border: "1px solid #a7f3d0", background: "#f0fdf4", color: "#059669",
                fontSize: 12, fontWeight: 700, cursor: "pointer",
                fontFamily: "var(--font)",
                display: "inline-flex", alignItems: "center", gap: 6,
                whiteSpace: "nowrap",
              }}
            >📖 Read full document</button>
          )}
          <button
            onClick={() => setShowShortcuts((s) => !s)}
            title="Keyboard shortcuts (press ?)"
            style={{
              padding: "6px 10px", borderRadius: 8,
              border: "1px solid #e2e8f0", background: "#fff", color: "#64748b",
              fontSize: 11, fontWeight: 600, cursor: "pointer",
              fontFamily: "var(--font)",
            }}
          >⌘ ?</button>
          <div style={{ fontSize: 12, color: savedAt ? "#059669" : "#94a3b8", whiteSpace: "nowrap" }}>
            {savedAt ? <>✓ Saved</> : "Not saved yet"}
          </div>
        </div>

        {/* Progress bar per tier */}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          {tierStats.map((t) => {
            const pct = t.total === 0 ? 0 : (t.done / t.total) * 100;
            const complete = t.done === t.total;
            return (
              <div key={t.key} style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                <span style={{
                  fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 10,
                  background: complete ? "#d1fae5" : t.color.bg,
                  color: complete ? "#059669" : t.color.text,
                  border: `1px solid ${complete ? "#a7f3d0" : t.color.border}`,
                  letterSpacing: 0.3, whiteSpace: "nowrap",
                }}>
                  {complete && "✓ "}{t.label} {t.done}/{t.total}
                </span>
                <div style={{
                  width: 56, height: 6, borderRadius: 3,
                  background: "#f1f5f9", overflow: "hidden",
                }}>
                  <div style={{
                    width: `${pct}%`, height: "100%",
                    background: complete ? "#059669" : t.color.fill,
                    transition: "width 0.3s, background 0.3s",
                  }} />
                </div>
              </div>
            );
          })}
          <div style={{ flex: 1, minWidth: 60 }} />
          <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600 }}>
            {actedOn} / {totalItems} · {pctComplete}%
          </div>
        </div>
      </div>

      {/* Shortcuts panel */}
      {showShortcuts && (
        <div style={{
          position: "sticky", top: 84, zIndex: 49,
          background: "#0f172a", color: "#e2e8f0",
          padding: "12px 24px", fontSize: 12, display: "flex",
          gap: 24, justifyContent: "center", flexWrap: "wrap",
        }}>
          <span><KbdKey>J</KbdKey> <KbdKey>K</KbdKey> navigate</span>
          <span><KbdKey>1</KbdKey> confirm · <KbdKey>2</KbdKey> discuss · <KbdKey>3</KbdKey> skip</span>
          <span><KbdKey>A</KbdKey> answer (on questions)</span>
          <span><KbdKey>?</KbdKey> toggle this help</span>
        </div>
      )}

      {/* Content */}
      <div style={{ maxWidth: 760, margin: "0 auto", padding: "24px 16px 140px" }}>
        {/* Instructions */}
        <div style={{
          padding: 16, borderRadius: 12, background: "#fff",
          border: "1px solid #e2e8f0", marginBottom: 24,
        }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: "#0f172a", marginBottom: 6 }}>
            How this works
          </div>
          <div style={{ fontSize: 13, color: "#64748b", lineHeight: 1.6 }}>
            Review each requirement below. Mark <strong style={{ color: "#059669" }}>Confirm</strong> if it&rsquo;s correct,
            {" "}<strong style={{ color: "#d97706" }}>Discuss</strong> if something needs clarification, or
            {" "}<strong>Skip</strong> if it&rsquo;s not applicable. Answer any open questions you can — your answers unblock related
            requirements. Your progress is saved automatically, so you can leave and come back.
          </div>
        </div>

        {/* Requirements by priority */}
        {PRIORITY_ORDER.map((priority) => {
          const reqs = data.requirements[priority] || [];
          if (reqs.length === 0) return null;
          const colors = PRIORITY_COLORS[priority];
          const doneCount = reqs.filter((r) => reqActions[r.req_id]).length;
          return (
            <div key={priority} style={{ marginBottom: 24 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <span style={{
                  fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 12,
                  background: colors.bg, color: colors.text, border: `1px solid ${colors.border}`,
                  textTransform: "uppercase", letterSpacing: 0.5,
                }}>
                  {PRIORITY_LABELS[priority]}
                </span>
                <span style={{ fontSize: 12, color: "#94a3b8" }}>
                  {doneCount}/{reqs.length} reviewed
                </span>
              </div>

              {reqs.map((req) => {
                const action = reqActions[req.req_id];
                const blockingGaps = reqToGaps[req.req_id] || [];
                const unresolvedBlockers = blockingGaps.filter((g) => gapActions[g.gap_id] !== "answer");
                const isActive = activeItem === `req:${req.req_id}`;
                return (
                  <div
                    key={req.req_id}
                    id={reqElemId(req.req_id)}
                    className={`review-card${isActive ? " active" : ""}`}
                    onClick={() => setActiveItem(`req:${req.req_id}`)}
                    style={{
                      background: "#fff", borderRadius: 12, padding: 18,
                      border: action === "confirm" ? "2px solid #059669"
                        : action === "discuss" ? "2px solid #d97706"
                        : action === "skip" ? "2px solid #cbd5e1"
                        : "1px solid #e2e8f0",
                      marginBottom: 10, cursor: "pointer",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 10, color: "#94a3b8", fontFamily: "monospace", marginBottom: 4 }}>{req.req_id}</div>
                        <div style={{ fontSize: 14, fontWeight: 600, color: "#0f172a", marginBottom: 6 }}>{req.title}</div>
                        <div style={{ fontSize: 13, color: "#475569", lineHeight: 1.6 }}>{req.description}</div>
                        {req.user_perspective && (
                          <div style={{ fontSize: 12, color: "#64748b", marginTop: 6, fontStyle: "italic" }}>{req.user_perspective}</div>
                        )}
                        {unresolvedBlockers.length > 0 && (
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
                            <span style={{ fontSize: 11, color: "#64748b", alignSelf: "center" }}>Blocked by:</span>
                            {unresolvedBlockers.map((g) => (
                              <button
                                key={g.gap_id}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setActiveItem(`gap:${g.gap_id}`);
                                  scrollToId(gapElemId(g.gap_id));
                                }}
                                style={{
                                  fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 10,
                                  background: "#fef3c7", color: "#b45309",
                                  border: "1px solid #fde68a", cursor: "pointer",
                                  fontFamily: "var(--font)",
                                }}
                              >⚠ {g.gap_id}</button>
                            ))}
                          </div>
                        )}
                        {blockingGaps.length > 0 && unresolvedBlockers.length === 0 && (
                          <div style={{ fontSize: 11, color: "#059669", marginTop: 10, fontWeight: 600 }}>
                            ✓ All blockers answered
                          </div>
                        )}
                      </div>
                    </div>
                    <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                      <SegmentedControl
                        options={[
                          { key: "confirm", label: "Confirm", color: "#059669", bg: "#d1fae5" },
                          { key: "discuss", label: "Discuss", color: "#d97706", bg: "#fef3c7" },
                          { key: "skip", label: "Skip", color: "#64748b", bg: "#f1f5f9" },
                        ]}
                        active={action}
                        onSelect={(k) => setReqAction(req.req_id, k as ReqAction)}
                      />
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setItemDetail({ title: `${req.req_id}: ${req.title}`, content: reqToMarkdown(req) });
                        }}
                        style={{
                          padding: "6px 10px", borderRadius: 8,
                          border: "1px solid #e2e8f0", background: "transparent", color: "#64748b",
                          fontSize: 11, fontWeight: 600, cursor: "pointer",
                          fontFamily: "var(--font)",
                          display: "inline-flex", alignItems: "center", gap: 4,
                        }}
                      >📄 View details</button>
                    </div>
                    {action === "discuss" && (
                      <textarea
                        value={reqNotes[req.req_id] || ""}
                        onChange={(e) => setReqNotes((prev) => ({ ...prev, [req.req_id]: e.target.value }))}
                        onClick={(e) => e.stopPropagation()}
                        placeholder="What needs clarification?"
                        style={{
                          width: "100%", marginTop: 10, padding: "10px 12px",
                          borderRadius: 8, border: "1px solid #fde68a",
                          background: "#fffbeb", fontSize: 13, resize: "vertical",
                          minHeight: 60, fontFamily: "var(--font)", outline: "none",
                        }}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}

        {/* Gaps — grouped by the priority of the reqs they block */}
        {gapClusters.map((cluster) => {
          const clusterMeta = cluster.key === "standalone"
            ? { title: "Other open questions", color: PRIORITY_COLORS.could, subtitle: "Not blocking any specific requirement" }
            : {
                title: `Blocking ${PRIORITY_LABELS[cluster.key]}s`,
                color: PRIORITY_COLORS[cluster.key],
                subtitle: `Answering these unblocks ${cluster.key} requirements`,
              };
          return (
            <div key={cluster.key} style={{ marginBottom: 24 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <span style={{
                  fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 12,
                  background: "#f5f3ff", color: "#7c3aed", border: "1px solid #ddd6fe",
                  textTransform: "uppercase", letterSpacing: 0.5,
                }}>
                  Open Questions
                </span>
                <span style={{
                  fontSize: 11, fontWeight: 600, color: clusterMeta.color.text,
                }}>
                  · {clusterMeta.title}
                </span>
                <span style={{ fontSize: 12, color: "#94a3b8" }}>
                  {cluster.gaps.length} item{cluster.gaps.length !== 1 ? "s" : ""}
                </span>
              </div>
              <div style={{ fontSize: 12, color: "#64748b", marginBottom: 12, marginLeft: 2 }}>
                {clusterMeta.subtitle}
              </div>

              {cluster.gaps.map((gap) => {
                const action = gapActions[gap.gap_id];
                const unblocks = gapToReqs[gap.gap_id] || [];
                const isActive = activeItem === `gap:${gap.gap_id}`;
                return (
                  <div
                    key={gap.gap_id}
                    id={gapElemId(gap.gap_id)}
                    className={`review-card${isActive ? " active" : ""}`}
                    onClick={() => setActiveItem(`gap:${gap.gap_id}`)}
                    style={{
                      background: "#fff", borderRadius: 12, padding: 18,
                      border: action === "answer" ? "2px solid #2563eb"
                        : action === "skip" ? "2px solid #cbd5e1"
                        : "1px solid #e2e8f0",
                      marginBottom: 10, cursor: "pointer",
                    }}
                  >
                    <div style={{ fontSize: 10, color: "#94a3b8", fontFamily: "monospace", marginBottom: 4 }}>{gap.gap_id}</div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "#0f172a", marginBottom: 6 }}>{gap.question}</div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                      <span style={{
                        fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 8,
                        background: gap.severity === "high" ? "#fef2f2" : "#fef3c7",
                        color: gap.severity === "high" ? "#dc2626" : "#d97706",
                      }}>{gap.severity}</span>
                      <span style={{ fontSize: 10, color: "#94a3b8" }}>{gap.area}</span>
                    </div>
                    {unblocks.length > 0 && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4, marginBottom: 10 }}>
                        <span style={{ fontSize: 11, color: "#64748b", alignSelf: "center" }}>Unblocks:</span>
                        {unblocks.map((u) => (
                          <button
                            key={u.req_id}
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveItem(`req:${u.req_id}`);
                              scrollToId(reqElemId(u.req_id));
                            }}
                            style={{
                              fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 10,
                              background: PRIORITY_COLORS[u.priority]?.bg || "#f1f5f9",
                              color: PRIORITY_COLORS[u.priority]?.text || "#64748b",
                              border: `1px solid ${PRIORITY_COLORS[u.priority]?.border || "#e2e8f0"}`,
                              cursor: "pointer", fontFamily: "var(--font)",
                            }}
                          >↻ {u.req_id}</button>
                        ))}
                      </div>
                    )}
                    <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                      <SegmentedControl
                        options={[
                          { key: "answer", label: "I can answer", color: "#2563eb", bg: "#dbeafe" },
                          { key: "skip", label: "Skip", color: "#64748b", bg: "#f1f5f9" },
                        ]}
                        active={action}
                        onSelect={(k) => setGapAction(gap.gap_id, k as GapActionType)}
                      />
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setItemDetail({ title: `${gap.gap_id}: ${gap.question}`, content: gapToMarkdown(gap) });
                        }}
                        style={{
                          padding: "6px 10px", borderRadius: 8,
                          border: "1px solid #e2e8f0", background: "transparent", color: "#64748b",
                          fontSize: 11, fontWeight: 600, cursor: "pointer",
                          fontFamily: "var(--font)",
                          display: "inline-flex", alignItems: "center", gap: 4,
                        }}
                      >📄 View details</button>
                    </div>
                    {action === "answer" && (
                      <textarea
                        value={gapAnswers[gap.gap_id] || ""}
                        onChange={(e) => setGapAnswers((prev) => ({ ...prev, [gap.gap_id]: e.target.value }))}
                        onClick={(e) => e.stopPropagation()}
                        placeholder={gap.suggested_action || "Your answer..."}
                        style={{
                          width: "100%", marginTop: 10, padding: "10px 12px",
                          borderRadius: 8, border: "1px solid #bfdbfe",
                          background: "#eff6ff", fontSize: 13, resize: "vertical",
                          minHeight: 60, fontFamily: "var(--font)", outline: "none",
                        }}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {/* Sticky footer */}
      <div style={{
        position: "fixed", bottom: 0, left: 0, right: 0,
        background: "#fff", borderTop: "1px solid #e2e8f0",
        padding: "12px 24px",
        display: "flex", alignItems: "center", justifyContent: "center", gap: 16,
      }}>
        <div style={{ fontSize: 12, color: "#64748b" }}>
          {actedOn > 0 ? `${actedOn} of ${totalItems} reviewed` : "Review items above, then submit"}
        </div>
        <button
          onClick={handleSubmit}
          disabled={submitting || actedOn === 0}
          style={{
            padding: "10px 28px", borderRadius: 10, border: "none",
            background: actedOn === 0 ? "#e2e8f0" : "#00E5A0",
            color: actedOn === 0 ? "#94a3b8" : "#0f172a",
            fontSize: 14, fontWeight: 700, cursor: actedOn === 0 ? "default" : "pointer",
            fontFamily: "var(--font)",
            boxShadow: actedOn > 0 ? "0 2px 8px rgba(0,229,160,0.3)" : "none",
          }}
        >
          {submitting ? "Submitting..." : "Submit Review"}
        </button>
      </div>

      {/* Handoff doc viewer modal */}
      {handoffOpen && (
        <HandoffDocModal
          docs={handoffDocs}
          activeType={handoffOpen}
          onSelect={openHandoff}
          content={handoffContent[handoffOpen]}
          loading={handoffLoading}
          onClose={() => setHandoffOpen(null)}
        />
      )}

      {/* Per-item detail modal (BR or Gap) */}
      {itemDetail && (
        <MarkdownModal
          title={itemDetail.title}
          content={itemDetail.content}
          onClose={() => setItemDetail(null)}
        />
      )}
    </div>
  );
}


function SegmentedControl<T extends string>({
  options, active, onSelect,
}: {
  options: { key: T; label: string; color: string; bg: string }[];
  active: T | undefined;
  onSelect: (k: T | undefined) => void;
}) {
  return (
    <div style={{
      display: "inline-flex",
      borderRadius: 10, border: "1px solid #e2e8f0",
      overflow: "hidden", background: "#fff",
    }}>
      {options.map((opt, i) => {
        const isActive = active === opt.key;
        return (
          <button
            key={opt.key}
            onClick={(e) => {
              e.stopPropagation();
              onSelect(isActive ? undefined : opt.key);
            }}
            style={{
              padding: "7px 14px",
              borderLeft: i === 0 ? "none" : "1px solid #e2e8f0",
              border: "none",
              background: isActive ? opt.bg : "transparent",
              color: isActive ? opt.color : "#64748b",
              fontSize: 12, fontWeight: isActive ? 700 : 600,
              cursor: "pointer",
              fontFamily: "var(--font)",
              transition: "background 0.15s, color 0.15s",
            }}
          >
            {isActive ? "✓ " : ""}{opt.label}
          </button>
        );
      })}
    </div>
  );
}


function KbdKey({ children }: { children: React.ReactNode }) {
  return (
    <kbd style={{
      display: "inline-block", padding: "1px 6px", borderRadius: 4,
      background: "#1e293b", border: "1px solid #334155",
      fontSize: 10, fontFamily: "monospace", fontWeight: 700,
      color: "#f1f5f9", margin: "0 2px",
    }}>{children}</kbd>
  );
}


function HandoffDocModal({
  docs, activeType, onSelect, content, loading, onClose,
}: {
  docs: HandoffDoc[];
  activeType: string;
  onSelect: (type: string) => void;
  content: string | undefined;
  loading: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  const activeLabel = docs.find((d) => d.type === activeType)?.label || "Document";

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 100,
        background: "rgba(15, 23, 42, 0.55)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 20, animation: "handoffFadeIn 0.15s ease-out",
      }}
    >
      <style>{`
        @keyframes handoffFadeIn { from { opacity: 0 } to { opacity: 1 } }
      `}</style>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff", borderRadius: 16,
          width: "100%", maxWidth: 880, maxHeight: "92vh",
          display: "flex", flexDirection: "column",
          boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
          overflow: "hidden",
        }}
      >
        {/* Modal header */}
        <div style={{
          display: "flex", alignItems: "center", gap: 12,
          padding: "14px 20px", borderBottom: "1px solid #e2e8f0",
          background: "#fff",
        }}>
          <div style={{ fontSize: 18 }}>📖</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#0f172a" }}>{activeLabel}</div>
            <div style={{ fontSize: 11, color: "#64748b" }}>Context for the items you're reviewing</div>
          </div>
          {docs.length > 1 && (
            <div style={{ display: "flex", gap: 4, padding: 3, background: "#f1f5f9", borderRadius: 8 }}>
              {docs.map((d) => (
                <button
                  key={d.type}
                  onClick={() => onSelect(d.type)}
                  style={{
                    padding: "5px 10px", borderRadius: 6, border: "none",
                    background: d.type === activeType ? "#fff" : "transparent",
                    color: d.type === activeType ? "#0f172a" : "#64748b",
                    fontSize: 11, fontWeight: 600, cursor: "pointer",
                    fontFamily: "var(--font)",
                    boxShadow: d.type === activeType ? "0 1px 2px rgba(0,0,0,0.08)" : "none",
                  }}
                >{d.label}</button>
              ))}
            </div>
          )}
          <button
            onClick={onClose}
            title="Close (Esc)"
            style={{
              padding: "6px 10px", borderRadius: 8,
              border: "1px solid #e2e8f0", background: "#fff", color: "#64748b",
              fontSize: 12, fontWeight: 700, cursor: "pointer",
              fontFamily: "var(--font)",
            }}
          >✕</button>
        </div>

        {/* Modal body */}
        <div style={{
          flex: 1, overflowY: "auto", padding: "20px 32px",
          lineHeight: 1.7, fontSize: 13, color: "#334155",
        }}>
          {loading && content === undefined ? (
            <div style={{ textAlign: "center", color: "#94a3b8", padding: 40, fontSize: 13 }}>
              Loading document…
            </div>
          ) : !content ? (
            <div style={{ textAlign: "center", color: "#94a3b8", padding: 40, fontSize: 13 }}>
              This document hasn't been generated yet.
            </div>
          ) : (
            <div
              className="handoff-doc-content"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
            />
          )}
        </div>
      </div>
    </div>
  );
}


function MarkdownModal({
  title, content, onClose,
}: {
  title: string;
  content: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 100,
        background: "rgba(15, 23, 42, 0.55)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 20, animation: "handoffFadeIn 0.15s ease-out",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff", borderRadius: 16,
          width: "100%", maxWidth: 720, maxHeight: "92vh",
          display: "flex", flexDirection: "column",
          boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
          overflow: "hidden",
        }}
      >
        <div style={{
          display: "flex", alignItems: "center", gap: 12,
          padding: "14px 20px", borderBottom: "1px solid #e2e8f0",
        }}>
          <div style={{ fontSize: 18 }}>📄</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 14, fontWeight: 700, color: "#0f172a",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>{title}</div>
            <div style={{ fontSize: 11, color: "#64748b" }}>Full item details</div>
          </div>
          <button
            onClick={onClose}
            title="Close (Esc)"
            style={{
              padding: "6px 10px", borderRadius: 8,
              border: "1px solid #e2e8f0", background: "#fff", color: "#64748b",
              fontSize: 12, fontWeight: 700, cursor: "pointer",
              fontFamily: "var(--font)",
            }}
          >✕</button>
        </div>
        <div style={{
          flex: 1, overflowY: "auto", padding: "20px 32px",
          lineHeight: 1.7, fontSize: 13, color: "#334155",
        }}>
          <div dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }} />
        </div>
      </div>
    </div>
  );
}


function StatPill({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontSize: 22, fontWeight: 800, color }}>{value}</div>
      <div style={{ fontSize: 11, color: "#64748b" }}>{label}</div>
    </div>
  );
}
