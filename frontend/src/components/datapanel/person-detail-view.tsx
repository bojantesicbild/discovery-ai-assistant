"use client";

// Person (stakeholder) detail — right-pane view shown when the user
// clicks a person chip in connections, or lands on
// ?tab=people&highlight=Name.
//
// Mirrors the BR detail-view chrome (back button + hero + content
// card) so the right pane reads consistently regardless of what kind
// of item is open. Renders:
//
//   - Hero: 👤 + name + role + org + decision-authority chip
//   - Findings sections: BRs / Gaps / Constraints / Conflicts where
//     this person is named source_person (or item_a/b_person on
//     contradictions). Each row is clickable and navigates to the
//     corresponding finding via onNavigate.

import { useEffect, useState } from "react";
import { getStakeholderByName, type PersonFindingsBundle } from "@/lib/api";


interface Props {
  projectId: string;
  name: string;
  onClose: () => void;
  onNavigate?: (tab: string, displayId?: string) => void;
}


export default function PersonDetailView({ projectId, name, onClose, onNavigate }: Props) {
  const [data, setData] = useState<PersonFindingsBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getStakeholderByName(projectId, name)
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setError(e?.message || "Failed to load person"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectId, name]);

  if (loading) {
    return (
      <div className="req-detail">
        <div className="req-detail-hero">
          <div className="req-detail-hero-top">
            <button type="button" className="req-detail-back" onClick={onClose} aria-label="Back">
              <svg viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6" /></svg>
            </button>
          </div>
        </div>
        <div className="req-detail-body">
          <div className="detail-empty">Loading…</div>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="req-detail">
        <div className="req-detail-hero">
          <div className="req-detail-hero-top">
            <button type="button" className="req-detail-back" onClick={onClose} aria-label="Back">
              <svg viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6" /></svg>
            </button>
          </div>
        </div>
        <div className="req-detail-body">
          <div className="detail-empty">Couldn&apos;t load person details.</div>
        </div>
      </div>
    );
  }

  const { stakeholder, findings } = data;
  const totalFindings =
    findings.requirements.length + findings.gaps.length +
    findings.constraints.length + findings.contradictions.length;

  return (
    <div className="req-detail">
      <div className="req-detail-hero">
        <div className="req-detail-hero-top">
          <button type="button" className="req-detail-back" onClick={onClose} aria-label="Back">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <div className="person-avatar">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
          </div>
          <h1 className="req-detail-title-h1">{stakeholder.name}</h1>
        </div>

        <div className="req-detail-hero-chips">
          {stakeholder.role && (
            <span className="chip purple">{stakeholder.role}</span>
          )}
          {stakeholder.decision_authority && (
            <span className="chip xs uppercase amber">Decides: {stakeholder.decision_authority}</span>
          )}
          <span className="chip xs">
            {totalFindings} finding{totalFindings === 1 ? "" : "s"} raised
          </span>
        </div>

        {(stakeholder.organization || stakeholder.interests) && (
          <div className="req-detail-hero-meta">
            {stakeholder.organization && <span><strong>{stakeholder.organization}</strong></span>}
            {stakeholder.organization && stakeholder.interests && <span className="sep">·</span>}
            {stakeholder.interests && <span>Interests: {stakeholder.interests}</span>}
          </div>
        )}
      </div>

      <div className="req-detail-body">
        {totalFindings === 0 ? (
          <div className="detail-empty">No findings raised by {stakeholder.name} yet.</div>
        ) : (
          <div className="req-detail-content-card">
            {findings.requirements.length > 0 && (
              <PersonFindingGroup title={`Requirements (${findings.requirements.length})`}>
                {findings.requirements.map((r) => (
                  <PersonFindingRow
                    key={r.id}
                    onClick={() => onNavigate?.("reqs", r.req_id)}
                    badge={r.req_id}
                    badgeKind="green"
                    title={r.title}
                    meta={`${r.priority} · ${r.status}`}
                  />
                ))}
              </PersonFindingGroup>
            )}

            {findings.gaps.length > 0 && (
              <PersonFindingGroup title={`Gaps (${findings.gaps.length})`}>
                {findings.gaps.map((g) => (
                  <PersonFindingRow
                    key={g.id}
                    onClick={() => onNavigate?.("gaps", g.gap_id)}
                    badge={g.gap_id}
                    badgeKind="amber"
                    title={g.question}
                    meta={`${g.severity} · ${g.status}`}
                  />
                ))}
              </PersonFindingGroup>
            )}

            {findings.constraints.length > 0 && (
              <PersonFindingGroup title={`Constraints (${findings.constraints.length})`}>
                {findings.constraints.map((c) => (
                  <PersonFindingRow
                    key={c.id}
                    onClick={() => c.display_id && onNavigate?.("constraints", c.display_id)}
                    badge={c.display_id || "CON"}
                    badgeKind="orange"
                    title={c.description}
                    meta={`${c.type} · ${c.status}`}
                  />
                ))}
              </PersonFindingGroup>
            )}

            {findings.contradictions.length > 0 && (
              <PersonFindingGroup title={`Conflicts (${findings.contradictions.length})`}>
                {findings.contradictions.map((c) => (
                  <PersonFindingRow
                    key={c.id}
                    onClick={() => c.display_id && onNavigate?.("contradictions", c.display_id)}
                    badge={c.display_id || "CTR"}
                    badgeKind="red"
                    title={c.title}
                    meta={c.resolved ? "resolved" : "open"}
                  />
                ))}
              </PersonFindingGroup>
            )}
          </div>
        )}
      </div>
    </div>
  );
}


function PersonFindingGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <>
      <div className="field-header">{title}</div>
      <div className="person-finding-group">{children}</div>
    </>
  );
}


function PersonFindingRow({
  badge, badgeKind, title, meta, onClick,
}: {
  badge: string;
  badgeKind: "green" | "amber" | "orange" | "red";
  title: string;
  meta: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className="person-finding-row" onClick={onClick}>
      <span className={`chip xs ${badgeKind}`} style={{ fontFamily: "var(--font-mono)" }}>{badge}</span>
      <span className="person-finding-title">{title}</span>
      <span className="person-finding-meta">{meta}</span>
    </button>
  );
}
