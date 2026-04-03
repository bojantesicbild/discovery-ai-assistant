"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createProject } from "@/lib/api";

interface NewProjectModalProps {
  open: boolean;
  onClose: () => void;
}

export default function NewProjectModal({ open, onClose }: NewProjectModalProps) {
  const router = useRouter();
  const [form, setForm] = useState({ name: "", client_name: "", project_type: "Greenfield" });
  const [creating, setCreating] = useState(false);

  if (!open) return null;

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    try {
      const project = await createProject(form);
      setForm({ name: "", client_name: "", project_type: "Greenfield" });
      onClose();
      router.push(`/projects/${project.id}/chat`);
    } catch (err: any) {
      alert(err.message);
    }
    setCreating(false);
  }

  return (
    <div
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
        display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <form
        onSubmit={handleCreate}
        style={{
          background: "var(--white)", borderRadius: "var(--radius)", padding: 28,
          width: "100%", maxWidth: 440, boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
        }}
      >
        <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 20 }}>New Discovery Project</h2>

        <div style={{ marginBottom: 16 }}>
          <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6, color: "var(--gray-600)" }}>
            Project Name
          </label>
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="NacXwan Outlook Add-in"
            required
            style={{
              width: "100%", padding: "10px 14px", border: "1px solid var(--gray-200)",
              borderRadius: "var(--radius-sm)", fontSize: 14, fontFamily: "var(--font)",
              outline: "none", transition: "border-color 0.15s",
            }}
            onFocus={(e) => e.target.style.borderColor = "var(--green)"}
            onBlur={(e) => e.target.style.borderColor = "var(--gray-200)"}
          />
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6, color: "var(--gray-600)" }}>
            Client Name
          </label>
          <input
            value={form.client_name}
            onChange={(e) => setForm({ ...form, client_name: e.target.value })}
            placeholder="NacXwan Technologies"
            required
            style={{
              width: "100%", padding: "10px 14px", border: "1px solid var(--gray-200)",
              borderRadius: "var(--radius-sm)", fontSize: 14, fontFamily: "var(--font)",
              outline: "none",
            }}
            onFocus={(e) => e.target.style.borderColor = "var(--green)"}
            onBlur={(e) => e.target.style.borderColor = "var(--gray-200)"}
          />
        </div>

        <div style={{ marginBottom: 24 }}>
          <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6, color: "var(--gray-600)" }}>
            Project Type
          </label>
          <select
            value={form.project_type}
            onChange={(e) => setForm({ ...form, project_type: e.target.value })}
            style={{
              width: "100%", padding: "10px 14px", border: "1px solid var(--gray-200)",
              borderRadius: "var(--radius-sm)", fontSize: 14, fontFamily: "var(--font)",
              background: "var(--white)", outline: "none",
            }}
          >
            <option>Greenfield</option>
            <option>Add-on</option>
            <option>Feature Extension</option>
            <option>API</option>
            <option>Mobile</option>
            <option>Custom</option>
          </select>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 12 }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: "9px 20px", border: "1px solid var(--gray-200)", borderRadius: "var(--radius-sm)",
              background: "var(--white)", fontSize: 13, fontWeight: 600, fontFamily: "var(--font)",
              cursor: "pointer", color: "var(--gray-600)",
            }}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={creating}
            className="btn-primary"
            style={{ padding: "9px 24px", opacity: creating ? 0.6 : 1 }}
          >
            {creating ? "Creating..." : "Create Project"}
          </button>
        </div>
      </form>
    </div>
  );
}
