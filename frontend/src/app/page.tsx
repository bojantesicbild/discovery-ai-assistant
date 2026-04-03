"use client";

import { useEffect, useState } from "react";
import { listProjects, createProject } from "@/lib/api";
import Link from "next/link";

interface Project {
  id: string;
  name: string;
  client_name: string;
  project_type: string;
  status: string;
  documents_count: number;
  readiness_score: number | null;
  created_at: string;
}

export default function HomePage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newProject, setNewProject] = useState({ name: "", client_name: "", project_type: "Greenfield" });

  useEffect(() => {
    loadProjects();
  }, []);

  async function loadProjects() {
    try {
      const data = await listProjects();
      setProjects(data.projects || []);
    } catch {
      // API not running yet — show empty state
    }
    setLoading(false);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    try {
      await createProject(newProject);
      setShowCreate(false);
      setNewProject({ name: "", client_name: "", project_type: "Greenfield" });
      loadProjects();
    } catch (err: any) {
      alert(err.message);
    }
  }

  function readinessColor(score: number | null) {
    if (score === null) return "bg-gray-200";
    if (score >= 85) return "bg-green-500";
    if (score >= 65) return "bg-yellow-500";
    return "bg-red-500";
  }

  function readinessLabel(score: number | null) {
    if (score === null) return "No data";
    if (score >= 85) return "Ready";
    if (score >= 65) return "Conditional";
    return "Not Ready";
  }

  return (
    <div className="max-w-6xl mx-auto px-6 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold">Discovery AI Assistant</h1>
          <p className="text-gray-500 mt-1">Structured client discovery for software projects</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
        >
          New Project
        </button>
      </div>

      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <form onSubmit={handleCreate} className="bg-white rounded-xl p-6 w-full max-w-md shadow-xl">
            <h2 className="text-lg font-semibold mb-4">Create Discovery Project</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium mb-1">Project Name</label>
                <input
                  value={newProject.name}
                  onChange={(e) => setNewProject({ ...newProject, name: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2"
                  placeholder="NacXwan Outlook Add-in"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Client Name</label>
                <input
                  value={newProject.client_name}
                  onChange={(e) => setNewProject({ ...newProject, client_name: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2"
                  placeholder="NacXwan Technologies"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Project Type</label>
                <select
                  value={newProject.project_type}
                  onChange={(e) => setNewProject({ ...newProject, project_type: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2"
                >
                  <option>Greenfield</option>
                  <option>Add-on</option>
                  <option>Feature Extension</option>
                  <option>API</option>
                  <option>Mobile</option>
                  <option>Custom</option>
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button type="button" onClick={() => setShowCreate(false)} className="px-4 py-2 text-gray-600 hover:text-gray-900">
                Cancel
              </button>
              <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                Create
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Project list */}
      {loading ? (
        <div className="text-center py-20 text-gray-400">Loading projects...</div>
      ) : projects.length === 0 ? (
        <div className="text-center py-20">
          <div className="text-5xl mb-4">&#128269;</div>
          <h2 className="text-xl font-semibold mb-2">No discovery projects yet</h2>
          <p className="text-gray-500 mb-6">Create your first project to start structured client discovery.</p>
          <button
            onClick={() => setShowCreate(true)}
            className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Create First Project
          </button>
        </div>
      ) : (
        <div className="grid gap-4">
          {projects.map((project) => (
            <Link
              key={project.id}
              href={`/projects/${project.id}/chat`}
              className="block bg-white rounded-xl border border-gray-200 p-5 hover:border-blue-300 hover:shadow-sm transition"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-lg">{project.name}</h3>
                  <p className="text-gray-500 text-sm">{project.client_name} &middot; {project.project_type}</p>
                </div>
                <div className="text-right">
                  <div className="flex items-center gap-2">
                    <div className={`w-3 h-3 rounded-full ${readinessColor(project.readiness_score)}`} />
                    <span className="text-sm font-medium">
                      {project.readiness_score !== null ? `${project.readiness_score}%` : "--"}
                    </span>
                  </div>
                  <p className="text-xs text-gray-400 mt-1">{readinessLabel(project.readiness_score)}</p>
                </div>
              </div>
              <div className="flex gap-4 mt-3 text-sm text-gray-500">
                <span>{project.documents_count} documents</span>
                <span>Created {new Date(project.created_at).toLocaleDateString()}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
