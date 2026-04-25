"use client";

// People tab — browse-all-stakeholders surface. Each row shows the
// person's name, role, and organization in the same .req-style card
// shell other tabs use. Clicking a row navigates to the right-pane
// PersonDetailView via ?tab=people&highlight=Name (handled in
// DataPanel where activeTab === "people" + highlightId short-
// circuits the body).

import { useEffect, useMemo, useState } from "react";
import { listStakeholders, type ApiStakeholder } from "@/lib/api";
import { EmptyState } from "./pills";


interface Props {
  projectId: string;
  onNavigate?: (tab: string, displayId?: string) => void;
}


// Tinted count badge for a single finding kind. `count === 0` renders
// muted so empty kinds fade into the row instead of competing visually
// with non-empty ones.
function CountBadge({
  label, count, kind,
}: {
  label: string;
  count: number;
  kind: "green" | "amber" | "orange" | "red";
}) {
  const empty = count === 0;
  return (
    <span className={`person-count-badge ${empty ? "empty" : kind}`}>
      <span className="n">{count}</span>
      <span className="lbl">{label}</span>
    </span>
  );
}


export function PeopleTab({ projectId, onNavigate }: Props) {
  const [people, setPeople] = useState<ApiStakeholder[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listStakeholders(projectId)
      .then((d) => { if (!cancelled) setPeople(d.items || []); })
      .catch(() => { if (!cancelled) setPeople([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectId]);

  // Same person can be extracted from multiple documents; fold to one
  // entry per name, picking the row with the most populated metadata.
  const unique = useMemo(() => {
    const byName = new Map<string, ApiStakeholder>();
    for (const p of people) {
      const key = (p.name || "").toLowerCase();
      const existing = byName.get(key);
      const completeness = (s: ApiStakeholder) =>
        (s.role?.length || 0)
        + (s.organization?.length || 0)
        + (s.decision_authority?.length || 0)
        + (Array.isArray(s.interests) ? s.interests.length : 0);
      if (!existing || completeness(p) > completeness(existing)) {
        byName.set(key, p);
      }
    }
    return Array.from(byName.values()).sort((a, b) =>
      (a.name || "").localeCompare(b.name || ""),
    );
  }, [people]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return unique;
    return unique.filter((p) => {
      const blob = `${p.name || ""} ${p.role || ""} ${p.organization || ""}`.toLowerCase();
      return blob.includes(q);
    });
  }, [unique, search]);

  if (loading && people.length === 0) {
    return (
      <div className="rem-loading" style={{ textAlign: "center", padding: "40px 16px" }}>
        Loading people…
      </div>
    );
  }

  if (people.length === 0) {
    return (
      <EmptyState
        icon="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 7a4 4 0 100-8 4 4 0 000 8M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"
        text="No stakeholders extracted yet. Upload a document and the agent will surface the people named in it."
      />
    );
  }

  return (
    <div style={{ padding: "12px 32px 20px" }}>
      <div style={{ marginBottom: 14 }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search people, roles, organizations…"
          className="rem-search"
        />
      </div>

      <div className="people-grid">
        {filtered.map((p) => {
          const counts = p.finding_counts || { requirements: 0, gaps: 0, constraints: 0, contradictions: 0 };
          return (
            <button
              key={p.id}
              type="button"
              className="people-card"
              onClick={() => onNavigate?.("people", p.name)}
            >
              <div className="people-card-top">
                <div className="people-card-avatar">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                </div>
                <div className="people-card-body">
                  <div className="people-card-name">{p.name}</div>
                  {/* Prefer role_title (short, post-037). Fall back to
                   *  role only when it's chip-length; otherwise hide
                   *  the full paragraph here — it'll render in the
                   *  detail view's Role section instead. */}
                  {p.role_title ? (
                    <div className="people-card-role">{p.role_title}</div>
                  ) : p.role && p.role.length <= 60 ? (
                    <div className="people-card-role">{p.role}</div>
                  ) : null}
                  {p.organization && (
                    <div className="people-card-org">{p.organization}</div>
                  )}
                </div>
                <svg className="people-card-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <line x1="5" y1="12" x2="19" y2="12" />
                  <polyline points="13 6 19 12 13 18" />
                </svg>
              </div>
              <div className="people-card-counts">
                <CountBadge label="BR"  count={counts.requirements}    kind="green"  />
                <CountBadge label="Gap" count={counts.gaps}            kind="amber"  />
                <CountBadge label="Con" count={counts.constraints}     kind="orange" />
                <CountBadge label="Ctr" count={counts.contradictions}  kind="red"    />
              </div>
            </button>
          );
        })}
        {filtered.length === 0 && (
          <div className="rem-loading" style={{ gridColumn: "1 / -1" }}>
            No people match {`"${search}"`}.
          </div>
        )}
      </div>
    </div>
  );
}
