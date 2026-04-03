"use client";

import { useParams } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import Topbar from "@/components/Topbar";
import ChatPanel from "@/components/ChatPanel";
import DataPanel from "@/components/DataPanel";

export default function DiscoveryChatPage() {
  const params = useParams();
  const projectId = params.projectId as string;

  return (
    <div className="app" style={{ display: "flex", height: "100vh" }}>
      <Sidebar />

      <main className="main-content">
        <Topbar projectName="NacXwan" />

        <div className="content-area">
          <ChatPanel projectId={projectId} />
          <div className="split-divider" />
          <DataPanel projectId={projectId} />
        </div>
      </main>
    </div>
  );
}
