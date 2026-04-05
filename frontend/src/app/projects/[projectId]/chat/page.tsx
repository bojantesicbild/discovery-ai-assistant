"use client";

import { useCallback, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { useOnDocumentUploaded } from "@/components/ProjectShell";
import ChatPanel from "@/components/ChatPanel";
import DataPanel from "@/components/DataPanel";
import SplitLayout from "@/components/SplitLayout";

export default function DiscoveryChatPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const projectId = params.projectId as string;
  const [refreshKey, setRefreshKey] = useState(0);

  const tab = searchParams.get("tab") || undefined;
  const highlight = searchParams.get("highlight") || undefined;

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);
  useOnDocumentUploaded(refresh);

  return (
    <SplitLayout
      left={<ChatPanel projectId={projectId} onDataChanged={refresh} />}
      right={<DataPanel projectId={projectId} refreshKey={refreshKey} initialTab={tab} highlightId={highlight} />}
      defaultLeftPercent={45}
    />
  );
}
