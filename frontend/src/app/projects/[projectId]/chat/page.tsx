"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { getProject } from "@/lib/api";
import Sidebar from "@/components/Sidebar";
import Topbar from "@/components/Topbar";
import ChatPanel from "@/components/ChatPanel";
import DataPanel from "@/components/DataPanel";
import SplitLayout from "@/components/SplitLayout";

export default function DiscoveryChatPage() {
  const params = useParams();
  const projectId = params.projectId as string;
  const [refreshKey, setRefreshKey] = useState(0);
  const [projectName, setProjectName] = useState("Project");

  useEffect(() => {
    getProject(projectId)
      .then((p) => setProjectName(p.name))
      .catch(() => {});
  }, [projectId]);

  return (
    <div className="app" style={{ display: "flex", height: "100vh" }}>
      <Sidebar />

      <main className="main-content">
        <Topbar
          projectId={projectId}
          projectName={projectName}
          onDocumentUploaded={() => setRefreshKey((k) => k + 1)}
        />

        <SplitLayout
          left={<ChatPanel projectId={projectId} onDataChanged={() => setRefreshKey((k) => k + 1)} />}
          right={<DataPanel projectId={projectId} refreshKey={refreshKey} />}
          defaultLeftPercent={45}
        />
      </main>
    </div>
  );
}
