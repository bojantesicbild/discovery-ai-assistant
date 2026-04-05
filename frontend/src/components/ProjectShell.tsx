"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { getProject } from "@/lib/api";
import Sidebar from "./Sidebar";
import Topbar from "./Topbar";

type DocumentUploadedCallback = () => void;

const DocumentUploadContext = createContext<{
  subscribe: (cb: DocumentUploadedCallback) => () => void;
}>({ subscribe: () => () => {} });

export function useOnDocumentUploaded(cb: DocumentUploadedCallback) {
  const { subscribe } = useContext(DocumentUploadContext);
  useEffect(() => subscribe(cb), [subscribe, cb]);
}

export default function ProjectShell({ children }: { children: React.ReactNode }) {
  const params = useParams();
  const projectId = params.projectId as string;
  const [projectName, setProjectName] = useState("Project");
  const [collapsed, setCollapsed] = useState(false);
  const listenersRef = useRef(new Set<DocumentUploadedCallback>());

  useEffect(() => {
    getProject(projectId)
      .then((p) => setProjectName(p.name))
      .catch(() => {});
  }, [projectId]);

  const subscribe = useCallback((cb: DocumentUploadedCallback) => {
    listenersRef.current.add(cb);
    return () => { listenersRef.current.delete(cb); };
  }, []);

  const handleDocumentUploaded = useCallback(() => {
    listenersRef.current.forEach((cb) => cb());
  }, []);

  return (
    <DocumentUploadContext.Provider value={{ subscribe }}>
      <div className="app" style={{ display: "flex", height: "100vh" }}>
        <Sidebar collapsed={collapsed} onToggleCollapsed={() => setCollapsed((c) => !c)} />
        <main
          className="main-content"
          style={{ marginLeft: collapsed ? 64 : undefined }}
        >
          <Topbar
            projectId={projectId}
            projectName={projectName}
            onDocumentUploaded={handleDocumentUploaded}
          />
          {children}
        </main>
      </div>
    </DocumentUploadContext.Provider>
  );
}
