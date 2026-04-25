"use client";

// Readiness detail panel — opened from the hero info-icon. Self-
// contained: hero ring + status, six-stat grid, trajectory chart,
// checklist. All styling lives in panels.css under .rd-* so the
// visuals match the rest of the discovery panel (no more inline
// hex colours or rgba shadows hand-rolled here).

import type { ApiRequirement, ApiGap, ApiConstraint, ApiContradiction } from "@/lib/api";


type CheckStatus = "covered" | "partial" | "missing";
interface CheckItem {
  status: CheckStatus;
  check: string;
  detail?: string | null;
  items?: string[];
}
interface TrajectoryPoint {
  score: number;
  created_at?: string | null;
}
interface Trajectory {
  history: TrajectoryPoint[];
  velocity_per_day?: number | null;
  eta_days?: number | null;
  eta_date?: string | null;
  trend?: "ready" | "improving" | "stalled" | "regressing" | null;
}


export function ReadinessPanel({
  onClose, score, checks, trajectory,
  requirements, gaps, contradictions, constraints,
}: {
  onClose: () => void;
  score: number;
  checks: CheckItem[];
  trajectory: Trajectory | null;
  requirements: ApiRequirement[];
  gaps: ApiGap[];
  contradictions: ApiContradiction[];
  constraints: ApiConstraint[];
}) {
  const passed = checks.filter((c) => c.status === "covered").length;
  const partial = checks.filter((c) => c.status === "partial").length;
  const missing = checks.filter((c) => c.status === "missing").length;
  const tier = score >= 85 ? "ok" : score >= 65 ? "warn" : "bad";
  const tierLabel = tier === "ok" ? "Ready for Handoff" : tier === "warn" ? "Conditionally Ready" : "Not Ready";
  const confirmedReqs = requirements.filter((r) => r.status === "confirmed").length;
  const mustReqs = requirements.filter((r) => r.priority === "must").length;
  const openContras = contradictions.filter((c) => !c.resolved).length;
  const openGaps = gaps.filter((g) => g.status === "open").length;

  // Ring math — single arc that fills proportionally.
  const ringR = 52;
  const ringC = 2 * Math.PI * ringR;

  return (
    <div className="rd-panel">
      {/* Header — matches the BR detail's hero pattern: icon back + title. */}
      <header className="rd-head">
        <button
          type="button"
          className="icon-btn"
          onClick={onClose}
          title="Back"
          aria-label="Back"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <h1 className="rd-title">Discovery Readiness</h1>
      </header>

      <div className="rd-scroll">
        {/* Hero — ring + status pill + tier breakdown bar */}
        <section className={`rd-hero rd-tier-${tier}`}>
          <div className="rd-ring">
            <svg
              width="104"
              height="104"
              viewBox="0 0 120 120"
              className="rd-ring-svg"
            >
              {/* Inline stroke attrs as a belt-and-suspenders fallback —
               *  some browsers / Tailwind base layers can shadow the
               *  stroke property on bare SVG elements. */}
              <circle
                cx="60" cy="60" r={ringR}
                fill="none"
                stroke="var(--line)"
                strokeWidth="10"
                className="rd-ring-bg"
              />
              <circle
                cx="60" cy="60" r={ringR}
                fill="none"
                stroke="var(--accent)"
                strokeWidth="10"
                strokeLinecap="round"
                strokeDasharray={ringC}
                strokeDashoffset={ringC - (score / 100) * ringC}
                className="rd-ring-fg"
              />
            </svg>
            <div className="rd-ring-num">{Math.round(score)}<span>%</span></div>
          </div>
          <div className="rd-hero-body">
            <span className={`rd-status rd-status-${tier}`}>{tierLabel}</span>
            <div className="rd-bar">
              {passed > 0 && <span className="rd-bar-seg ok" style={{ flexGrow: passed }} />}
              {partial > 0 && <span className="rd-bar-seg warn" style={{ flexGrow: partial }} />}
              {missing > 0 && <span className="rd-bar-seg bad" style={{ flexGrow: missing }} />}
            </div>
            <div className="rd-bar-legend">
              <span><i className="dot ok" /><strong>{passed}</strong> passed</span>
              <span><i className="dot warn" /><strong>{partial}</strong> partial</span>
              <span><i className="dot bad" /><strong>{missing}</strong> missing</span>
            </div>
          </div>
        </section>

        {/* Six-card stat grid */}
        <section className="rd-stats">
          <StatCard
            tone="accent"
            value={requirements.length}
            label="Requirements"
            sub={`${confirmedReqs} confirmed`}
            icon={<svg viewBox="0 0 24 24"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>}
          />
          <StatCard
            tone="info"
            value={mustReqs}
            label="MUST priority"
            sub={`of ${requirements.length}`}
            icon={<svg viewBox="0 0 24 24"><path d="M12 22s-8-4.5-8-11.8A8 8 0 0112 2a8 8 0 018 8.2c0 7.3-8 11.8-8 11.8z" /><circle cx="12" cy="10" r="3" /></svg>}
          />
          <StatCard
            tone="purple"
            value={`${passed}/${checks.length}`}
            label="Checks passed"
            sub={missing > 0 ? `${missing} missing` : `${partial} partial`}
            icon={<svg viewBox="0 0 24 24"><path d="M9 12l2 2 4-4" /><circle cx="12" cy="12" r="9" /></svg>}
          />
          <StatCard
            tone={openGaps > 0 ? "warn" : "muted"}
            value={openGaps}
            label="Open gaps"
            sub={`${gaps.length} total`}
            valueWarn={openGaps > 0}
            icon={<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 015 0c0 1.5-2.5 2-2.5 4M12 17h.01" /></svg>}
          />
          <StatCard
            tone={openContras > 0 ? "danger" : "muted"}
            value={openContras}
            label="Contradictions"
            sub="open"
            valueWarn={openContras > 0}
            icon={<svg viewBox="0 0 24 24"><path d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>}
          />
          <StatCard
            tone="amber"
            value={constraints.length}
            label="Constraints"
            sub="defined"
            icon={<svg viewBox="0 0 24 24"><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 018 0v4" /></svg>}
          />
        </section>

        {/* Trajectory — full card with header (label + delta + ETA) + chart */}
        {trajectory && trajectory.history && trajectory.history.length >= 2 && (
          <TrajectoryCard trajectory={trajectory} />
        )}

        {/* Checklist */}
        <section className="rd-checklist">
          <header className="rd-checklist-head">
            <span className="rd-checklist-label">Checklist</span>
            <span className="rd-checklist-count">{passed} <span>of</span> {checks.length}</span>
          </header>
          <div className="rd-checklist-list">
            {checks.map((c, i) => (
              <ChecklistRow key={i} c={c} />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}


/* ── Sub-components ──────────────────────────────────────────────── */

function StatCard({
  tone, value, label, sub, icon, valueWarn,
}: {
  tone: "accent" | "info" | "purple" | "warn" | "danger" | "amber" | "muted";
  value: number | string;
  label: string;
  sub: string;
  icon: React.ReactNode;
  valueWarn?: boolean;
}) {
  return (
    <div className={`rd-stat rd-stat-${tone}`}>
      <div className="rd-stat-icon">{icon}</div>
      <div className="rd-stat-body">
        <div className={`rd-stat-value${valueWarn ? " warn" : ""}`}>{value}</div>
        <div className="rd-stat-label">{label}</div>
        <div className="rd-stat-sub">{sub}</div>
      </div>
    </div>
  );
}


function ChecklistRow({ c }: { c: CheckItem }) {
  const tone = c.status === "covered" ? "ok" : c.status === "partial" ? "warn" : "bad";
  const glyph = c.status === "covered" ? "✓" : c.status === "partial" ? "!" : "✗";
  return (
    <div className={`rd-check rd-check-${tone}`}>
      <span className="rd-check-glyph" aria-hidden>{glyph}</span>
      <div className="rd-check-body">
        <div className="rd-check-name">{c.check}</div>
        {c.detail && <div className="rd-check-detail">{c.detail}</div>}
        {c.items && c.items.length > 0 && (
          <div className="rd-check-chips">
            {c.items.slice(0, 3).map((item, j) => (
              <span key={j} className="rd-check-chip">{item}</span>
            ))}
            {c.items.length > 3 && <span className="rd-check-chip-more">+{c.items.length - 3}</span>}
          </div>
        )}
      </div>
    </div>
  );
}


function TrajectoryCard({ trajectory }: { trajectory: Trajectory }) {
  const pts = trajectory.history;
  const scores = pts.map((p) => p.score);
  const minS = Math.min(...scores, 0);
  const maxS = Math.max(...scores, 100);
  const range = maxS - minS || 1;
  const w = 600, h = 90, pad = 8;
  const points = pts.map((p, i) => {
    const x = pad + (i / (pts.length - 1)) * (w - 2 * pad);
    const y = h - pad - ((p.score - minS) / range) * (h - 2 * pad);
    return `${x},${y}`;
  });
  const line85y = h - pad - ((85 - minS) / range) * (h - 2 * pad);
  const lastPt = pts[pts.length - 1];

  const velocity = trajectory.velocity_per_day;
  const velocityTone = velocity == null ? "neutral"
    : velocity > 0 ? "ok"
    : velocity < 0 ? "bad"
    : "neutral";

  return (
    <section className="rd-traj">
      <header className="rd-traj-head">
        <span className="rd-traj-label">Readiness trajectory</span>
        <span className="rd-traj-meta">
          {velocity != null && (
            <span className={`rd-traj-velocity ${velocityTone}`}>
              {velocity > 0 ? "+" : ""}{velocity}%/day
            </span>
          )}
          {trajectory.trend === "ready" ? (
            <span className="rd-traj-eta ready">Ready</span>
          ) : trajectory.eta_days != null && trajectory.eta_days > 0 ? (
            <span className="rd-traj-eta">
              <span className="rd-traj-eta-label">ETA</span>
              ~{trajectory.eta_days}d
              {trajectory.eta_date && <span className="dim">{trajectory.eta_date}</span>}
            </span>
          ) : null}
        </span>
      </header>
      <svg viewBox={`0 0 ${w} ${h}`} className="rd-traj-svg" preserveAspectRatio="none">
        <defs>
          <linearGradient id="rd-traj-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.32" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <line x1={pad} y1={line85y} x2={w - pad} y2={line85y} className="rd-traj-target" />
        <text x={w - pad - 4} y={line85y - 4} textAnchor="end" className="rd-traj-target-label">85%</text>
        <polygon
          points={`${pad},${h - pad} ${points.join(" ")} ${w - pad},${h - pad}`}
          fill="url(#rd-traj-grad)"
        />
        <polyline points={points.join(" ")} className="rd-traj-line" />
        {lastPt && (() => {
          const x = pad + (w - 2 * pad);
          const y = h - pad - ((lastPt.score - minS) / range) * (h - 2 * pad);
          return <circle cx={x} cy={y} r={4} className="rd-traj-tip" />;
        })()}
      </svg>
    </section>
  );
}
