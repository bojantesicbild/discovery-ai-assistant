"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { getDashboard } from "@/lib/api";

interface DashboardData {
  readiness: {
    score: number;
    status: string;
    breakdown: { business: number; functional: number; technical: number; scope: number };
  };
  requirements_count: number;
  requirements_confirmed: number;
  constraints_count: number;
  decisions_count: number;
  stakeholders_count: number;
  assumptions_count: number;
  assumptions_validated: number;
  scope_in: number;
  scope_out: number;
  contradictions_unresolved: number;
  documents_count: number;
  documents_processing: number;
  recent_activity: { action: string; summary: string; created_at: string }[];
}

export default function DashboardPage() {
  const params = useParams();
  const projectId = params.projectId as string;
  const [data, setData] = useState<DashboardData | null>(null);
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

  return (
    <div className="p-6 max-w-5xl">
      <h1 className="text-xl font-bold mb-6">Discovery Dashboard</h1>

      {/* Readiness */}
      <div className={`rounded-xl border p-6 mb-6 ${statusBg}`}>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium text-gray-500 uppercase tracking-wide">Readiness</div>
            <div className={`text-4xl font-bold ${statusColor}`}>{r.score}%</div>
            <div className={`text-sm font-medium mt-1 capitalize ${statusColor}`}>{r.status.replace("_", " ")}</div>
          </div>
          <div className="text-right space-y-1">
            {Object.entries(r.breakdown || {}).map(([area, score]) => (
              <div key={area} className="flex items-center gap-2">
                <span className="text-xs text-gray-500 w-20 text-right capitalize">{area}</span>
                <div className="w-32 h-2 bg-gray-200 rounded-full">
                  <div
                    className="h-2 bg-blue-500 rounded-full"
                    style={{ width: `${Math.min(score as number, 100)}%` }}
                  />
                </div>
                <span className="text-xs font-medium w-8">{Math.round(score as number)}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="Requirements" value={data.requirements_count} sub={`${data.requirements_confirmed} confirmed`} />
        <StatCard label="Constraints" value={data.constraints_count} />
        <StatCard label="Decisions" value={data.decisions_count} />
        <StatCard label="Stakeholders" value={data.stakeholders_count} />
        <StatCard label="Assumptions" value={data.assumptions_count} sub={`${data.assumptions_validated} validated`} />
        <StatCard label="Scope (in/out)" value={`${data.scope_in}/${data.scope_out}`} />
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
