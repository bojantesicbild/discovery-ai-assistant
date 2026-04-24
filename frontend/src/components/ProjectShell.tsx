"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { getProject } from "@/lib/api";
import { usePersistedState } from "@/lib/persistedState";
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


// Context so the Topbar can render the sidebar-toggle button, even
// though the collapse state lives here. Keeps the visual control
// next to its siblings (search, actions) without lifting state.
export const SidebarContext = createContext<{ expanded: boolean; toggle: () => void }>({
  expanded: false,
  toggle: () => {},
});
export function useSidebar() { return useContext(SidebarContext); }


export default function ProjectShell({ children }: { children: React.ReactNode }) {
  const params = useParams();
  const projectId = params.projectId as string;
  const [projectName, setProjectName] = useState("Project");
  // Sidebar collapsed is a personal preference — global, not per-project.
  // Stored as "expanded" (inverse of old collapsed) to match the new CSS
  // contract where .app.sidebar-expanded is the state class.
  const [expanded, setExpanded] = usePersistedState<boolean>("sidebar:expanded", false);
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

  const toggle = useCallback(() => setExpanded((v) => !v), [setExpanded]);

  return (
    <DocumentUploadContext.Provider value={{ subscribe }}>
      <SidebarContext.Provider value={{ expanded, toggle }}>
        <div className={expanded ? "app sidebar-expanded" : "app"}>
          <Sidebar />
          <main className="main-content">
            <Topbar
              projectId={projectId}
              projectName={projectName}
              onDocumentUploaded={handleDocumentUploaded}
            />
            {children}
          </main>
        </div>
      </SidebarContext.Provider>
    </DocumentUploadContext.Provider>
  );
}
