"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { getDashboard, type DashboardResponse } from "@/lib/api";

export default function DashboardPage() {
  const params = useParams();
  const projectId = params.projectId as string;
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDashboard();
    const interval = setInterval(loadDashboard, 30000); // Poll every 30s
    return () => clearInterval(interval);
  }, [projectId]);

  async function loadDashboard() {
    try {
      const d = await getDashboard(projectId);
      setData(d);
    } catch {
      // API not running
    }
    setLoading(false);
  }

  if (loading) return <div className="p-6 text-gray-400">Loading dashboard...</div>;
  if (!data) return <div className="p-6 text-gray-400">Could not load dashboard. Is the backend running?</div>;

  const r = data.readiness;
  const statusColor = r.status === "ready" ? "text-green-600" : r.status === "conditional" ? "text-yellow-600" : "text-red-600";
  const statusBg = r.status === "ready" ? "bg-green-50" : r.status === "conditional" ? "bg-yellow-50" : "bg-red-50";
  const components = Object.entries(r.components || {});

  return (
    <div className="p-6 max-w-5xl">
      <h1 className="text-xl font-bold mb-6">Discovery Dashboard</h1>

      {/* Readiness */}
      <div className={`rounded-xl border p-6 mb-6 ${statusBg}`}>
        <div className="flex items-start justify-between gap-6">
          <div>
            <div className="text-sm font-medium text-gray-500 uppercase tracking-wide">Readiness</div>
            <div className={`text-4xl font-bold ${statusColor}`}>{r.score}%</div>
            <div className={`text-sm font-medium mt-1 capitalize ${statusColor}`}>{r.status.replace("_", " ")}</div>
          </div>
          <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-3">
            {components.map(([key, c]) => {
              const pct = Math.round((c.score || 0) * 100);
              return (
                <div key={key} className="bg-white/60 rounded-lg border border-gray-100 p-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-semibold text-gray-700 capitalize">{c.label || key}</span>
                    <span className="text-xs font-bold text-gray-900">{pct}%</span>
                  </div>
                  <div className="w-full h-2 bg-gray-200 rounded-full mb-2">
                    <div className="h-2 bg-blue-500 rounded-full" style={{ width: `${Math.min(pct, 100)}%` }} />
                  </div>
                  {c.summary && (
                    <div className="text-xs text-gray-500 leading-relaxed">{c.summary}</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="Requirements" value={data.requirements_count} sub={`${data.requirements_confirmed} confirmed`} />
        <StatCard label="Constraints" value={data.constraints_count} />
        <StatCard label="People" value={data.stakeholders_count} />
        <StatCard label="Open Gaps" value={data.gaps_open} color={data.gaps_open > 0 ? "red" : undefined} />
        <StatCard label="Contradictions" value={data.contradictions_unresolved} color={data.contradictions_unresolved > 0 ? "red" : undefined} />
        <StatCard label="Documents" value={data.documents_count} sub={data.documents_processing > 0 ? `${data.documents_processing} processing` : undefined} />
      </div>

      {/* Activity */}
      <div className="bg-white rounded-xl border p-5">
        <h2 className="font-semibold mb-3">Recent Activity</h2>
        {data.recent_activity.length === 0 ? (
          <p className="text-gray-400 text-sm">No activity yet. Upload a document to get started.</p>
        ) : (
          <div className="space-y-2">
            {data.recent_activity.map((activity, i) => (
              <div key={i} className="flex items-start gap-3 text-sm">
                <span className="text-gray-400 w-16 shrink-0">
                  {activity.created_at ? new Date(activity.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}
                </span>
                <span className="text-gray-700">{activity.summary}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, sub, color }: { label: string; value: number | string; sub?: string; color?: string }) {
  const textColor = color === "red" ? "text-red-600" : "text-gray-900";
  return (
    <div className="bg-white rounded-xl border p-4">
      <div className="text-xs text-gray-500 uppercase tracking-wide">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${textColor}`}>{value}</div>
      {sub && <div className="text-xs text-gray-400 mt-1">{sub}</div>}
    </div>
  );
}
