"use client";

// Readiness detail panel — shown when the user clicks the readiness
// score in the DataPanel header. Self-contained: renders breakdown,
// trajectory, missing items, and a close button. Extracted from
// DataPanel.tsx where it was accreting inline.

import type { ApiRequirement, ApiGap, ApiConstraint, ApiContradiction } from "@/lib/api";


export function ReadinessPanel({ onClose, score, checks, trajectory, requirements, gaps, contradictions, constraints }: {
  onClose: () => void; score: number; checks: any[]; trajectory: any;
  requirements: any[]; gaps: any[]; contradictions: any[]; constraints: any[];
}) {
  const passed = checks.filter((c: any) => c.status === "covered").length;
  const partial = checks.filter((c: any) => c.status === "partial").length;
  const missing = checks.filter((c: any) => c.status === "missing").length;
  const statusLabel = score >= 85 ? "Ready for Handoff" : score >= 65 ? "Conditionally Ready" : "Not Ready";
  const statusColor = score >= 85 ? "#059669" : score >= 65 ? "#d97706" : "#ef4444";
  const confirmedReqs = requirements.filter((r: any) => r.status === "confirmed").length;
  const mustReqs = requirements.filter((r: any) => r.priority === "must").length;
  const openContras = contradictions.filter((c) => !c.resolved).length;
  const openGaps = gaps.filter((g) => g.status === "open").length;

  // Ring math
  const circumference = 2 * Math.PI * 54;
  const offset = circumference - (score / 100) * circumference;

  // SVG icon paths for stat cards
  const icons = {
    reqs: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2",
    target: "M12 22s-8-4.5-8-11.8A8 8 0 0112 2a8 8 0 018 8.2c0 7.3-8 11.8-8 11.8z M12 13a3 3 0 100-6 3 3 0 000 6z",
    check: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z",
    question: "M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01",
    bolt: "M13 10V3L4 14h7v7l9-11h-7z",
    lock: "M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z",
  };
  const StatIcon = ({ d, color, size = 20 }: { d: string; color: string; size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Header */}
      <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--gray-100)", flexShrink: 0, display: "flex", alignItems: "center", gap: 12 }}>
        <button onClick={onClose} style={{
          display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 600,
          color: "var(--gray-500)", background: "none", border: "none", cursor: "pointer",
          padding: 0, fontFamily: "var(--font)",
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
          Back
        </button>
        <div style={{ flex: 1 }} />
        <div style={{ fontSize: 12, fontWeight: 700, color: "var(--dark)" }}>Discovery Readiness</div>
      </div>

      {/* Scrollable content */}
      <div style={{ flex: 1, overflowY: "auto", padding: "16px 16px" }}>

        {/* Score + status row */}
        <div style={{ display: "flex", gap: 16, alignItems: "center", marginBottom: 16 }}>
          <div style={{ position: "relative", width: 80, height: 80, flexShrink: 0 }}>
            <svg viewBox="0 0 120 120" style={{ width: 80, height: 80, transform: "rotate(-90deg)" }}>
              <circle cx="60" cy="60" r="52" fill="none" stroke="var(--gray-100)" strokeWidth="8" />
              <circle cx="60" cy="60" r="52" fill="none"
                stroke="var(--green)" strokeWidth="8" strokeLinecap="round"
                strokeDasharray={2 * Math.PI * 52} strokeDashoffset={2 * Math.PI * 52 - (score / 100) * 2 * Math.PI * 52}
                style={{ transition: "stroke-dashoffset 0.8s ease" }}
              />
            </svg>
            <div style={{
              position: "absolute", inset: 0, display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center",
            }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: "var(--dark)" }}>{Math.round(score)}%</div>
            </div>
          </div>

          <div style={{ flex: 1 }}>
            <div style={{
              fontSize: 10, fontWeight: 700,
              color: statusColor === "#059669" ? "#059669" : statusColor === "#d97706" ? "#d97706" : "#ef4444",
              background: statusColor === "#059669" ? "#d1fae5" : statusColor === "#d97706" ? "#fef3c7" : "#fee2e2",
              display: "inline-block", padding: "3px 10px", borderRadius: 6,
              textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 8,
            }}>
              {statusLabel}
            </div>

            {/* Progress */}
            <div style={{ display: "flex", gap: 2, height: 5, borderRadius: 3, overflow: "hidden", background: "var(--gray-100)" }}>
              <div style={{ width: `${(passed / checks.length) * 100}%`, background: "var(--green)", borderRadius: 3, transition: "width 0.6s" }} />
              <div style={{ width: `${(partial / checks.length) * 100}%`, background: "#fbbf24", borderRadius: 3, transition: "width 0.6s" }} />
              <div style={{ width: `${(missing / checks.length) * 100}%`, background: "#ef4444", borderRadius: 3, transition: "width 0.6s" }} />
            </div>
            <div style={{ display: "flex", gap: 12, marginTop: 4, fontSize: 9, color: "var(--gray-500)" }}>
              <span style={{ display: "flex", alignItems: "center", gap: 3 }}><span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--green)" }} />{passed} passed</span>
              <span style={{ display: "flex", alignItems: "center", gap: 3 }}><span style={{ width: 5, height: 5, borderRadius: "50%", background: "#fbbf24" }} />{partial} partial</span>
              <span style={{ display: "flex", alignItems: "center", gap: 3 }}><span style={{ width: 5, height: 5, borderRadius: "50%", background: "#ef4444" }} />{missing} missing</span>
            </div>
          </div>
        </div>

        {/* Stats grid */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 18 }}>
          {[
            { label: "Requirements", value: requirements.length, sub: `${confirmedReqs} confirmed`, icon: icons.reqs, color: "#059669" },
            { label: "MUST Priority", value: mustReqs, sub: `of ${requirements.length}`, icon: icons.target, color: "#2563eb" },
            { label: "Checks Passed", value: `${passed}/${checks.length}`, sub: `${missing} missing`, icon: icons.check, color: "#7c3aed" },
            { label: "Open Gaps", value: openGaps, sub: `${gaps.length} total`, icon: icons.question, color: openGaps > 0 ? "#ef4444" : "#6b7280", warn: openGaps > 0 },
            { label: "Contradictions", value: openContras, sub: "open", icon: icons.bolt, color: openContras > 0 ? "#ef4444" : "#6b7280", warn: openContras > 0 },
            { label: "Constraints", value: constraints.length, sub: "defined", icon: icons.lock, color: "#d97706" },
          ].map((s, i) => (
            <div key={i} style={{
              padding: "12px 14px", borderRadius: 12, background: "#fff",
              border: "1px solid var(--gray-100)", display: "flex", alignItems: "center", gap: 14,
              boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
            }}>
              <div style={{
                width: 40, height: 40, borderRadius: 10, flexShrink: 0,
                background: `${s.color}10`, display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <StatIcon d={s.icon} color={s.color} size={22} />
              </div>
              <div>
                <div style={{ fontSize: 20, fontWeight: 800, color: s.warn ? "#ef4444" : "var(--dark)", letterSpacing: "-0.5px", lineHeight: 1 }}>{s.value}</div>
                <div style={{ fontSize: 10, fontWeight: 600, color: "var(--gray-500)", marginTop: 2 }}>{s.label}</div>
                <div style={{ fontSize: 9, color: "var(--gray-400)" }}>{s.sub}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Trajectory chart */}
        {trajectory && trajectory.history && trajectory.history.length >= 2 && (() => {
          const pts = trajectory.history;
          const scores = pts.map((p: any) => p.score);
          const minS = Math.min(...scores, 0);
          const maxS = Math.max(...scores, 100);
          const range = maxS - minS || 1;
          const w = 600, h = 80, pad = 8;
          const points = pts.map((p: any, i: number) => {
            const x = pad + (i / (pts.length - 1)) * (w - 2 * pad);
            const y = h - pad - ((p.score - minS) / range) * (h - 2 * pad);
            return `${x},${y}`;
          });
          const line85y = h - pad - ((85 - minS) / range) * (h - 2 * pad);

          return (
            <div style={{
              marginBottom: 16, padding: "12px 14px", borderRadius: 12,
              background: "#fff", border: "1px solid var(--gray-100)",
              boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
            }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "var(--gray-400)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                  Readiness Trajectory
                </div>
                <div style={{ display: "flex", gap: 10, fontSize: 10 }}>
                  {trajectory.velocity_per_day !== null && (
                    <span style={{ color: trajectory.velocity_per_day > 0 ? "#059669" : trajectory.velocity_per_day < 0 ? "#ef4444" : "var(--gray-500)", fontWeight: 700 }}>
                      {trajectory.velocity_per_day > 0 ? "+" : ""}{trajectory.velocity_per_day}%/day
                    </span>
                  )}
                  {trajectory.eta_days !== null && trajectory.eta_days > 0 && (
                    <span style={{ color: "var(--gray-500)" }}>
                      ETA: ~{trajectory.eta_days}d ({trajectory.eta_date})
                    </span>
                  )}
                  {trajectory.trend === "ready" && (
                    <span style={{ color: "#059669", fontWeight: 700 }}>Ready!</span>
                  )}
                </div>
              </div>
              <div style={{ position: "relative" }}
                onMouseLeave={() => {
                  const tip = document.getElementById("traj-tip");
                  if (tip) tip.style.display = "none";
                }}
              >
                <svg viewBox={`0 0 ${w} ${h}`} style={{ width: "100%", height: 80, display: "block" }}>
                  {/* 85% threshold line */}
                  <line x1={pad} y1={line85y} x2={w - pad} y2={line85y} stroke="#059669" strokeWidth="1" strokeDasharray="4 3" opacity="0.4" />
                  <text x={w - pad - 2} y={line85y - 3} textAnchor="end" fontSize="7" fill="#059669" opacity="0.6">85%</text>
                  {/* Area fill */}
                  <polygon
                    points={`${pad},${h - pad} ${points.join(" ")} ${w - 2 * pad + pad},${h - pad}`}
                    fill="url(#trajectoryGrad)" opacity="0.3"
                  />
                  {/* Line */}
                  <polyline points={points.join(" ")} fill="none" stroke="#00E5A0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  {/* Dots with hover */}
                  {pts.map((p: any, i: number) => {
                    const x = pad + (i / (pts.length - 1)) * (w - 2 * pad);
                    const y = h - pad - ((p.score - minS) / range) * (h - 2 * pad);
                    const isLast = i === pts.length - 1;
                    return (
                      <g key={i}
                        onMouseEnter={(e) => {
                          const tip = document.getElementById("traj-tip");
                          if (!tip) return;
                          const date = p.created_at ? new Date(p.created_at).toLocaleDateString([], { month: "short", day: "numeric" }) : "";
                          const time = p.created_at ? new Date(p.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
                          tip.textContent = `${p.score}% · ${date} ${time}`;
                          tip.style.display = "block";
                          const svg = (e.target as SVGElement).closest("svg");
                          if (!svg) return;
                          const rect = svg.getBoundingClientRect();
                          const pctX = x / w;
                          const pctY = y / h;
                          tip.style.left = `${pctX * rect.width}px`;
                          tip.style.top = `${pctY * rect.height - 28}px`;
                        }}
                        onMouseLeave={() => {
                          const tip = document.getElementById("traj-tip");
                          if (tip) tip.style.display = "none";
                        }}
                        style={{ cursor: "default" }}
                      >
                        <circle cx={x} cy={y} r={12} fill="transparent" />
                        <circle cx={x} cy={y} r={isLast ? 4 : 2.5} fill={isLast ? "#00E5A0" : "#059669"} stroke="#fff" strokeWidth={isLast ? 2 : 0} />
                      </g>
                    );
                  })}
                  <defs>
                    <linearGradient id="trajectoryGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#00E5A0" />
                      <stop offset="100%" stopColor="#00E5A0" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                </svg>
                {/* Tooltip */}
                <div id="traj-tip" style={{
                  display: "none", position: "absolute", pointerEvents: "none",
                  background: "#1a1a2e", color: "#fff", fontSize: 10, fontWeight: 600,
                  padding: "3px 8px", borderRadius: 5, whiteSpace: "nowrap",
                  transform: "translateX(-50%)", boxShadow: "0 2px 6px rgba(0,0,0,0.2)",
                }} />
              </div>
            </div>
          );
        })()}

        {/* Checklist header */}
        <div style={{
          fontSize: 10, fontWeight: 700, color: "var(--gray-400)",
          textTransform: "uppercase", letterSpacing: "0.8px",
          display: "flex", alignItems: "center", gap: 8, marginBottom: 8,
        }}>
          <span>Checklist</span>
          <div style={{ flex: 1, height: 1, background: "var(--gray-200)" }} />
          <span style={{ color: "var(--green)", fontWeight: 800, fontSize: 11 }}>{passed}/{checks.length}</span>
        </div>

        {/* Check items */}
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {checks.map((c, i) => {
            const isOk = c.status === "covered";
            const isWarn = c.status === "partial";
            return (
              <div key={i} style={{
                padding: "9px 12px", borderRadius: 10, display: "flex", alignItems: "flex-start", gap: 10,
                background: isOk ? "#fff" : isWarn ? "#fffbeb" : "#fef2f2",
                border: `1px solid ${isOk ? "var(--gray-100)" : isWarn ? "#fde68a" : "#fecaca"}`,
                boxShadow: isOk ? "none" : `0 0 0 1px ${isWarn ? "#fde68a40" : "#fecaca40"}`,
              }}>
                <div style={{
                  width: 24, height: 24, borderRadius: 8, flexShrink: 0,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  background: isOk ? "#00E5A020" : isWarn ? "#fbbf2420" : "#ef444420",
                  color: isOk ? "#00E5A0" : isWarn ? "#d97706" : "#ef4444",
                  fontSize: 13, fontWeight: 700,
                }}>
                  {isOk ? "✓" : isWarn ? "!" : "✗"}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "var(--dark)" }}>{c.check}</div>
                  {c.detail && <div style={{ fontSize: 10, color: "var(--gray-500)", marginTop: 2 }}>{c.detail}</div>}
                  {c.items && c.items.length > 0 && (
                    <div style={{ marginTop: 4, display: "flex", flexWrap: "wrap", gap: 3 }}>
                      {c.items.slice(0, 3).map((item: string, j: number) => (
                        <span key={j} style={{
                          fontSize: 9, padding: "1px 6px", borderRadius: 4,
                          background: "var(--gray-50)", border: "1px solid var(--gray-100)",
                          color: "var(--gray-600)", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        }}>
                          {item}
                        </span>
                      ))}
                      {c.items.length > 3 && (
                        <span style={{ fontSize: 9, color: "var(--gray-400)", alignSelf: "center" }}>+{c.items.length - 3}</span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Next steps */}
        {(missing > 0 || partial > 0) && (
          <div style={{
            marginTop: 14, padding: "12px 14px", borderRadius: 10,
            background: "var(--gray-50)", border: "1px solid var(--gray-200)",
          }}>
            <div style={{
              fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px",
              color: "var(--gray-500)", marginBottom: 8, display: "flex", alignItems: "center", gap: 6,
            }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 11.08V12a10 10 0 11-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
              </svg>
              Next Steps to Improve Readiness
            </div>
            {checks.filter((c: any) => c.status !== "covered").map((c, i) => (
              <div key={i} style={{
                fontSize: 12, padding: "4px 0", display: "flex", alignItems: "flex-start", gap: 8,
              }}>
                <span style={{
                  width: 18, height: 18, borderRadius: 5, display: "inline-flex", alignItems: "center", justifyContent: "center",
                  background: c.status === "missing" ? "#fee2e2" : "#fef3c7",
                  color: c.status === "missing" ? "#ef4444" : "#d97706",
                  fontSize: 10, fontWeight: 700, flexShrink: 0, marginTop: 1,
                }}>
                  {c.status === "missing" ? "+" : "↑"}
                </span>
                <div>
                  <span style={{ fontWeight: 600, color: "var(--dark)" }}>{c.check}</span>
                  {c.detail && <span style={{ color: "var(--gray-500)", fontSize: 10 }}> — {c.detail}</span>}
                </div>
              </div>
            ))}
          </div>
        )}

        <div style={{ height: 16 }} />
      </div>
    </div>
  );
}





