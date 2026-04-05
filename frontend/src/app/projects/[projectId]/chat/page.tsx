"use client";

import { useCallback, useState } from "react";
import { useParams, useSearchParams, useRouter, usePathname } from "next/navigation";
import { useOnDocumentUploaded } from "@/components/ProjectShell";
import ChatPanel from "@/components/ChatPanel";
import DataPanel from "@/components/DataPanel";
import SplitLayout from "@/components/SplitLayout";

export default function DiscoveryChatPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const projectId = params.projectId as string;
  const [refreshKey, setRefreshKey] = useState(0);

  const tab = searchParams.get("tab") || undefined;
  const highlight = searchParams.get("highlight") || undefined;

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);
  useOnDocumentUploaded(refresh);

  const handleNavigate = useCallback((newTab: string, itemId?: string) => {
    const params = new URLSearchParams();
    params.set("tab", newTab);
    if (itemId) params.set("highlight", itemId);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }, [router, pathname]);

  return (
    <SplitLayout
      left={<ChatPanel projectId={projectId} onDataChanged={refresh} />}
      right={
        <DataPanel
          projectId={projectId}
          refreshKey={refreshKey}
          initialTab={tab}
          highlightId={highlight}
          onNavigate={handleNavigate}
        />
      }
      defaultLeftPercent={45}
    />
  );
}
