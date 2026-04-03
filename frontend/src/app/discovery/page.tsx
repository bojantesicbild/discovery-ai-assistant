"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { listProjects } from "@/lib/api";
import Sidebar from "@/components/Sidebar";

export default function DiscoveryPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Redirect to first project's chat if one exists
    listProjects()
      .then((data) => {
        if (data.projects?.length > 0) {
          router.replace(`/projects/${data.projects[0].id}/chat`);
        } else {
          setLoading(false);
        }
      })
      .catch(() => setLoading(false));
  }, [router]);

  if (loading) {
    return (
      <div className="app" style={{ display: "flex", height: "100vh" }}>
        <Sidebar />
        <main className="main-content" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ color: "var(--gray-400)", fontSize: 14 }}>Loading...</div>
        </main>
      </div>
    );
  }

  return (
    <div className="app" style={{ display: "flex", height: "100vh" }}>
      <Sidebar />
      <main className="main-content" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>🔍</div>
          <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>No discovery projects</h2>
          <p style={{ color: "var(--gray-500)", fontSize: 14, marginBottom: 24 }}>
            Create a project from the home page to start discovery.
          </p>
          <a href="/" className="btn-primary" style={{ display: "inline-flex", textDecoration: "none" }}>
            Go to Projects
          </a>
        </div>
      </main>
    </div>
  );
}
