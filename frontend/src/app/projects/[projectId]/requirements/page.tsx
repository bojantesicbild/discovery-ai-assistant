"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { listRequirements } from "@/lib/api";

interface Requirement {
  id: string;
  req_id: string;
  title: string;
  type: string;
  priority: string;
  description: string;
  user_perspective: string | null;
  business_rules: string[];
  status: string;
  confidence: string;
  source_quote: string;
}

export default function RequirementsPage() {
  const params = useParams();
  const projectId = params.projectId as string;
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [filter, setFilter] = useState({ priority: "", status: "", type: "" });
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    loadRequirements();
  }, [projectId, filter]);

  async function loadRequirements() {
    try {
      const params: Record<string, string> = {};
      if (filter.priority) params.priority = filter.priority;
      if (filter.status) params.status = filter.status;
      if (filter.type) params.type = filter.type;
      const data = await listRequirements(projectId, params);
      setRequirements(data.items || []);
    } catch {
      // API not running
    }
    setLoading(false);
  }

  function priorityBadge(p: string) {
    const colors: Record<string, string> = {
      must: "bg-red-100 text-red-700",
      should: "bg-yellow-100 text-yellow-700",
      could: "bg-blue-100 text-blue-700",
      wont: "bg-gray-100 text-gray-500",
    };
    return colors[p] || "bg-gray-100 text-gray-500";
  }

  function statusBadge(s: string) {
    const colors: Record<string, string> = {
      confirmed: "bg-green-100 text-green-700",
      discussed: "bg-blue-100 text-blue-700",
      proposed: "bg-gray-100 text-gray-600",
      changed: "bg-yellow-100 text-yellow-700",
      dropped: "bg-red-100 text-red-500 line-through",
    };
    return colors[s] || "bg-gray-100 text-gray-500";
  }

  return (
    <div className="p-6 max-w-5xl">
      <h1 className="text-xl font-bold mb-4">Requirements</h1>

      {/* Filters */}
      <div className="flex gap-3 mb-6">
        <select value={filter.priority} onChange={(e) => setFilter({ ...filter, priority: e.target.value })} className="border rounded-lg px-3 py-2 text-sm">
          <option value="">All Priorities</option>
          <option value="must">Must</option>
          <option value="should">Should</option>
          <option value="could">Could</option>
          <option value="wont">Won&apos;t</option>
        </select>
        <select value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value })} className="border rounded-lg px-3 py-2 text-sm">
          <option value="">All Statuses</option>
          <option value="confirmed">Confirmed</option>
          <option value="discussed">Discussed</option>
          <option value="proposed">Proposed</option>
          <option value="changed">Changed</option>
          <option value="dropped">Dropped</option>
        </select>
        <select value={filter.type} onChange={(e) => setFilter({ ...filter, type: e.target.value })} className="border rounded-lg px-3 py-2 text-sm">
          <option value="">All Types</option>
          <option value="functional">Functional</option>
          <option value="non_functional">Non-Functional</option>
        </select>
      </div>

      {loading ? (
        <div className="text-gray-400 py-10 text-center">Loading requirements...</div>
      ) : requirements.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          No requirements extracted yet. Upload client documents to get started.
        </div>
      ) : (
        <div className="space-y-3">
          {requirements.map((req) => (
            <div key={req.id} className="bg-white rounded-xl border p-4">
              <div
                className="flex items-start justify-between cursor-pointer"
                onClick={() => setExpanded(expanded === req.id ? null : req.id)}
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-mono text-gray-400">{req.req_id}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${priorityBadge(req.priority)}`}>
                      {req.priority.toUpperCase()}
                    </span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${statusBadge(req.status)}`}>
                      {req.status}
                    </span>
                    <span className="text-xs text-gray-400">{req.type === "functional" ? "FR" : "NFR"}</span>
                  </div>
                  <h3 className="font-medium">{req.title}</h3>
                  <p className="text-sm text-gray-600 mt-1">{req.description}</p>
                </div>
                <span className="text-gray-400 ml-4">{expanded === req.id ? "&#9650;" : "&#9660;"}</span>
              </div>

              {expanded === req.id && (
                <div className="mt-4 pt-4 border-t space-y-3 text-sm">
                  {req.user_perspective && (
                    <div>
                      <span className="font-medium text-gray-500">User Perspective:</span>
                      <p className="text-gray-700 mt-1">{req.user_perspective}</p>
                    </div>
                  )}
                  {req.business_rules.length > 0 && (
                    <div>
                      <span className="font-medium text-gray-500">Business Rules:</span>
                      <ul className="list-disc list-inside mt-1 text-gray-700">
                        {req.business_rules.map((rule, i) => <li key={i}>{rule}</li>)}
                      </ul>
                    </div>
                  )}
                  <div>
                    <span className="font-medium text-gray-500">Source:</span>
                    <blockquote className="mt-1 pl-3 border-l-2 border-gray-300 text-gray-600 italic">
                      &ldquo;{req.source_quote}&rdquo;
                    </blockquote>
                  </div>
                  <div className="flex gap-4 text-gray-400 text-xs">
                    <span>Confidence: {req.confidence}</span>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
