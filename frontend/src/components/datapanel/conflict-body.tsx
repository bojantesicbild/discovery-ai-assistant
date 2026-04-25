"use client";

// Body for the contradiction detail view. Two opposing sides each get
// their own card with a bold colored top strip + a quote body + a
// person avatar / source chip. Side A reads as "the prior /
// established position" (slate-blue), Side B as "the new / conflicting
// position" (amber). A black "VS" badge sits in the gutter between
// them as a focal point. Below the comparison, the AI recommendation
// gets a sparkle icon and an accent-tinted card so it reads as advice
// rather than a verdict; the resolution lands in a neutral card with
// a checkmark when the conflict is closed.

import type { ApiContradiction } from "@/lib/api";


function pickSideAText(c: ApiContradiction): string {
  return c.side_a
    || (c.item_a_ref && !c.item_a_ref.startsWith("New ") ? c.item_a_ref : "")
    || "";
}


function pickSideBText(c: ApiContradiction): string {
  if (c.side_b) return c.side_b;
  if (c.item_b_ref && !c.item_b_ref.startsWith("New ")) return c.item_b_ref;
  return _extractFromExplanation(c.explanation || "");
}


function _extractFromExplanation(expl: string): string {
  if (!expl) return "";
  const m1 = expl.match(/[Nn]ew document[^.]*says\s+(.+?)(?:\.|$)/);
  if (m1) return m1[1].trim();
  const m2 = expl.match(/new document says:?\s*"?(.+?)(?:"|$)/i);
  if (m2) return m2[1].trim();
  const m3 = expl.match(/—\s*(.+?)(?:\.|$)/);
  if (m3) return m3[1].trim();
  return expl.slice(0, 200);
}


function initials(name: string): string {
  if (!name) return "";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}


function PersonAvatar({ name }: { name: string }) {
  if (!name) return null;
  return (
    <span className="ctr-person" title={name}>
      <span className="ctr-person-avatar" aria-hidden>{initials(name)}</span>
      <span className="ctr-person-name">{name}</span>
    </span>
  );
}


function SourceChip({ filename }: { filename: string }) {
  if (!filename) return null;
  return (
    <span className="ctr-source-chip" title={filename}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
        <polyline points="14 2 14 8 20 8" />
      </svg>
      {filename}
    </span>
  );
}


function SideCard({
  side, label, text, source, person,
}: {
  side: "a" | "b";
  label: string;
  text: string;
  source?: string | null;
  person?: string | null;
}) {
  return (
    <article className="ctr-side" data-side={side}>
      <header className="ctr-side-head">
        <span className="ctr-side-tag">{label}</span>
        <span className="ctr-side-meta">
          {source && <SourceChip filename={source} />}
          {person && <PersonAvatar name={person} />}
        </span>
      </header>
      <p className="ctr-side-quote">{text}</p>
    </article>
  );
}


export function ConflictBody({ c }: { c: ApiContradiction }) {
  const sideAText = pickSideAText(c);
  const sideBText = pickSideBText(c);
  const sideASource = c.side_a_source || c.item_a_source;
  const sideAPerson = c.side_a_person || c.item_a_person;
  const sideBSource = c.side_b_source || c.item_b_source;
  const sideBPerson = c.side_b_person || c.item_b_person;

  const hasBothSides = !!(sideAText && sideBText);

  return (
    <div className="ctr-body">
      {(sideAText || sideBText) && (
        <div className="ctr-comparison">
          {sideAText && (
            <SideCard
              side="a"
              label="Prior position"
              text={sideAText}
              source={sideASource}
              person={sideAPerson}
            />
          )}
          {hasBothSides && (
            <div className="ctr-vs-rail" aria-hidden>
              <span className="ctr-vs-pill">VS</span>
            </div>
          )}
          {sideBText && (
            <SideCard
              side="b"
              label="New position"
              text={sideBText}
              source={sideBSource}
              person={sideBPerson}
            />
          )}
        </div>
      )}

      {!sideAText && !sideBText && c.explanation && (
        <div className="ctr-explanation">{c.explanation}</div>
      )}

      {c.impact_summary && (
        <section className="ctr-impact">
          <header className="ctr-impact-head">
            <span className="ctr-impact-icon" aria-hidden>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
            </span>
            <span className="ctr-impact-label">Impact if unresolved</span>
          </header>
          <p className="ctr-impact-body">{c.impact_summary}</p>
        </section>
      )}

      {c.resolution_options && c.resolution_options.length > 0 && (
        <section className="ctr-options">
          <header className="ctr-options-head">
            <span className="ctr-options-icon" aria-hidden>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 11 12 14 22 4" />
                <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
              </svg>
            </span>
            <span className="ctr-options-label">Resolution options</span>
          </header>
          <ul className="ctr-options-list">
            {c.resolution_options.map((opt, i) => (
              <li key={i}>{opt}</li>
            ))}
          </ul>
        </section>
      )}

      {c.suggested_resolution && (
        <section className="ctr-recommendation">
          <header className="ctr-recommendation-head">
            <span className="ctr-recommendation-icon" aria-hidden>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
              </svg>
            </span>
            <span className="ctr-recommendation-label">AI Recommendation</span>
          </header>
          <p className="ctr-recommendation-body">{c.suggested_resolution}</p>
        </section>
      )}

      {c.resolved && c.resolution_note && (
        <section className="ctr-resolution">
          <header className="ctr-resolution-head">
            <span className="ctr-resolution-icon" aria-hidden>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </span>
            <span className="ctr-resolution-label">Resolved</span>
          </header>
          <p className="ctr-resolution-body">{c.resolution_note}</p>
        </section>
      )}
    </div>
  );
}
