"use client";

import { useEffect, useState } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import { readVaultFile, type VaultFile } from "@/lib/api";
import { renderMarkdown } from "@/lib/markdown";

export default function VaultFilePage() {
  const params = useParams();
  const search = useSearchParams();
  const router = useRouter();
  const projectId = params.projectId as string;
  const path = search.get("path") || "";

  const [file, setFile] = useState<VaultFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!path) {
      setError("No path specified");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    readVaultFile(projectId, path)
      .then((f) => setFile(f))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [projectId, path]);

  const filename = path.split("/").pop() || path;

  return (
    <div style={{ padding: "24px 32px", maxWidth: 960, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <button
          onClick={() => router.back()}
          style={{
            padding: "6px 12px", borderRadius: 6, border: "1px solid var(--gray-200)",
            background: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 600, color: "#475569",
            fontFamily: "inherit",
          }}
        >
          ← Back
        </button>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 10, color: "#94a3b8", fontFamily: "monospace", marginBottom: 2 }}>
            {path}
          </div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#0f172a" }}>{filename}</div>
        </div>
        {file?.modified && (
          <div style={{ fontSize: 10, color: "#94a3b8" }}>
            Modified {new Date(file.modified).toLocaleString()}
          </div>
        )}
      </div>

      {loading && (
        <div style={{ padding: "48px 16px", textAlign: "center", color: "#94a3b8" }}>
          Loading…
        </div>
      )}

      {error && (
        <div style={{
          padding: 16, borderRadius: 8,
          background: "#fef2f2", color: "#991b1b", border: "1px solid #fecaca",
          fontSize: 13,
        }}>
          ⚠ {error}
        </div>
      )}

      {file && !loading && (
        <div
          className="md-body"
          style={{
            background: "#fff", padding: "24px 32px", borderRadius: 10,
            border: "1px solid var(--gray-100)", fontSize: 14, lineHeight: 1.6, color: "#0f172a",
          }}
          dangerouslySetInnerHTML={{ __html: renderMarkdown(file.content) }}
        />
      )}
    </div>
  );
}
