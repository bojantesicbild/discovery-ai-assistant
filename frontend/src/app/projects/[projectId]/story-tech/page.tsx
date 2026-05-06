"use client";

import { useCallback, useState } from "react";
import { useParams, useSearchParams, useRouter, usePathname } from "next/navigation";
import { useOnDocumentUploaded } from "@/components/ProjectShell";
import ChatPanel from "@/components/ChatPanel";
import TechStoryPanel from "@/components/TechStoryPanel";
import SplitLayout from "@/components/SplitLayout";

// Phase 2 surface — tech docs + their child stories. Mirrors the
// /chat page layout (ChatPanel left, panel right) so the user can flip
// between Discovery and Story-Tech without losing the chat history
// (Conversation is project-scoped per ARCHITECTURE.md §10).
//
// Cross-page deep-link contract: ?highlight=<TD-NNN | US-NNN> auto-
// expands the parent TD on mount. The same ?highlight= contract used
// on /chat for BR-NNN, so SourcePill can navigate freely between the
// two surfaces.

export default function StoryTechPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const projectId = params.projectId as string;
  const [refreshKey, setRefreshKey] = useState(0);

  const highlight = searchParams.get("highlight") || undefined;

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);
  // ChatPanel reuses the document-upload event so any new vault file
  // (e.g. a freshly-generated tech doc) triggers a list refresh.
  useOnDocumentUploaded(refresh);

  // Replace-route helper. The TechStoryPanel doesn't surface tabs yet
  // (single-tab MVP), so this is currently only used to clear ?highlight=
  // when the user closes a detail view in the future.
  const _handleNavigate = useCallback(
    (highlightId?: string) => {
      const next = new URLSearchParams();
      if (highlightId) next.set("highlight", highlightId);
      router.replace(
        `${pathname}${next.toString() ? `?${next.toString()}` : ""}`,
        { scroll: false },
      );
    },
    [router, pathname],
  );

  return (
    <SplitLayout
      left={<ChatPanel projectId={projectId} onDataChanged={refresh} />}
      right={
        <TechStoryPanel
          projectId={projectId}
          refreshKey={refreshKey}
          highlightId={highlight}
        />
      }
      defaultLeftPercent={45}
      storageKey="split:story-tech"
    />
  );
}
