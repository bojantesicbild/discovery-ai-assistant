"use client";

import { useEffect, useState, useCallback } from "react";
import {
  type Learning,
  type LearningCategory,
  dismissLearning,
  listActiveLearnings,
  listPromotionCandidates,
  promoteLearning,
} from "@/lib/api";

// Category → short label + accent. Kept in sync with LEARNING_CATEGORIES
// in backend/app/models/learning.py.
const CATEGORY_META: Record<LearningCategory, { label: string; tone: string }> = {
  pm_preference: { label: "PM Preference", tone: "bg-purple-50 text-purple-700 border-purple-200" },
  domain_fact: { label: "Domain Fact", tone: "bg-blue-50 text-blue-700 border-blue-200" },
  workflow_pattern: { label: "Workflow Pattern", tone: "bg-green-50 text-green-700 border-green-200" },
  anti_pattern: { label: "Anti-Pattern", tone: "bg-red-50 text-red-700 border-red-200" },
};

export default function LearningsPanel({ projectId }: { projectId: string }) {
  const [candidates, setCandidates] = useState<Learning[]>([]);
  const [active, setActive] = useState<Learning[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [cand, act] = await Promise.all([
        listPromotionCandidates(projectId, { limit: 20 }),
        listActiveLearnings(projectId, { limit: 10 }),
      ]);
      setCandidates(cand.candidates);
      setActive(act.learnings);
    } catch {
      // API not running or no learnings yet — render the empty state.
    }
    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handlePromote(lr: Learning) {
    setBusyId(lr.id);
    try {
      await promoteLearning(projectId, lr.id);
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function handleDismiss(lr: Learning) {
    setBusyId(lr.id);
    try {
      await dismissLearning(projectId, lr.id);
      await load();
    } finally {
      setBusyId(null);
    }
  }

  if (loading) return null;
  if (candidates.length === 0 && active.length === 0) return null;

  return (
    <div className="bg-white rounded-xl border p-5 mb-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold">Learnings</h2>
        <span className="text-xs text-gray-400">
          Patterns the agent observed across sessions. Promote to keep them as Tier-1 context.
        </span>
      </div>

      {candidates.length > 0 && (
        <div className="mb-4">
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
            Promotion Candidates ({candidates.length})
          </div>
          <div className="space-y-2">
            {candidates.map((lr) => (
              <LearningCard
                key={lr.id}
                learning={lr}
                busy={busyId === lr.id}
                showActions
                onPromote={() => handlePromote(lr)}
                onDismiss={() => handleDismiss(lr)}
              />
            ))}
          </div>
        </div>
      )}

      {active.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
            Active ({active.length})
          </div>
          <div className="space-y-2">
            {active.map((lr) => (
              <LearningCard
                key={lr.id}
                learning={lr}
                busy={busyId === lr.id}
                showActions={lr.status !== "promoted"}
                onPromote={() => handlePromote(lr)}
                onDismiss={() => handleDismiss(lr)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function LearningCard({
  learning,
  busy,
  showActions,
  onPromote,
  onDismiss,
}: {
  learning: Learning;
  busy: boolean;
  showActions: boolean;
  onPromote: () => void;
  onDismiss: () => void;
}) {
  const meta = CATEGORY_META[learning.category];
  const promoted = learning.status === "promoted";
  return (
    <div className="border rounded-lg p-3 flex items-start gap-3">
      <span className={`shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded border ${meta.tone}`}>
        {meta.label}
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-sm text-gray-800 leading-snug">
          {promoted && <span className="mr-1 text-yellow-500" title="Promoted">★</span>}
          {learning.content}
        </div>
        <div className="text-xs text-gray-400 mt-1">
          {learning.reference_count} reference{learning.reference_count === 1 ? "" : "s"}
          {learning.last_relevant_at && (
            <> · last seen {new Date(learning.last_relevant_at).toLocaleDateString()}</>
          )}
        </div>
      </div>
      {showActions && (
        <div className="flex gap-2 shrink-0">
          {!promoted && (
            <button
              disabled={busy}
              onClick={onPromote}
              className="text-xs px-2 py-1 rounded border border-green-300 bg-green-50 text-green-700 hover:bg-green-100 disabled:opacity-50"
            >
              Promote
            </button>
          )}
          <button
            disabled={busy}
            onClick={onDismiss}
            className="text-xs px-2 py-1 rounded border border-gray-300 bg-gray-50 text-gray-600 hover:bg-gray-100 disabled:opacity-50"
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
