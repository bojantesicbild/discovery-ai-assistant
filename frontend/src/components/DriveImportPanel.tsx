"use client";

import { useEffect, useState } from "react";
import { listDriveFiles, importDriveFiles, getIntegrationSettings, updateIntegrationSettings, DriveFile } from "@/lib/api";
import SyncSettingsBlock from "./SyncSettingsBlock";

interface DriveImportPanelProps {
  projectId: string;
  onClose: () => void;
  onImported?: () => void;
}

type FileType = "any" | "doc" | "sheet" | "slide" | "pdf" | "office";
type DateRange = "1d" | "7d" | "30d" | "90d" | "365d" | "any";

interface Filters {
  name: string;
  type: FileType;
  dateRange: DateRange;
  folderUrl: string;
}

const DEFAULT_FILTERS: Filters = {
  name: "",
  type: "any",
  dateRange: "30d",
  folderUrl: "",
};

const TYPE_TO_MIME: Record<FileType, string[]> = {
  any: [],
  doc: ["application/vnd.google-apps.document"],
  sheet: ["application/vnd.google-apps.spreadsheet"],
  slide: ["application/vnd.google-apps.presentation"],
  pdf: ["application/pdf"],
  office: [
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ],
};

function parseFolderId(value: string): string | null {
  if (!value) return null;
  const m = value.match(/folders\/([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  if (/^[a-zA-Z0-9_-]{10,}$/.test(value.trim())) return value.trim();
  return null;
}

function buildDriveQuery(f: Filters): string {
  const parts: string[] = ["trashed = false"];
  if (f.name.trim()) {
    const n = f.name.trim().replace(/'/g, "\\'");
    parts.push(`name contains '${n}'`);
  }
  const mimes = TYPE_TO_MIME[f.type];
  if (mimes.length > 0) {
    const orClause = mimes.map((m) => `mimeType = '${m}'`).join(" or ");
    parts.push(`(${orClause})`);
  }
  if (f.dateRange !== "any") {
    const days = parseInt(f.dateRange);
    const since = new Date(Date.now() - days * 86400000).toISOString();
    parts.push(`modifiedTime > '${since}'`);
  }
  const folderId = parseFolderId(f.folderUrl);
  if (folderId) parts.push(`'${folderId}' in parents`);
  return parts.join(" and ");
}

const FILE_ICONS: Record<string, { color: string; label: string }> = {
  "application/vnd.google-apps.document": { color: "#4285f4", label: "DOC" },
  "application/vnd.google-apps.spreadsheet": { color: "#0f9d58", label: "XLS" },
  "application/vnd.google-apps.presentation": { color: "#f4b400", label: "PPT" },
  "application/pdf": { color: "#ef4444", label: "PDF" },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": { color: "#2563eb", label: "DOCX" },
  "application/msword": { color: "#2563eb", label: "DOC" },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": { color: "#059669", label: "XLSX" },
  "text/plain": { color: "#64748b", label: "TXT" },
  "text/markdown": { color: "#64748b", label: "MD" },
  "text/csv": { color: "#059669", label: "CSV" },
};

function fileIconBadge(mime: string) {
  return FILE_ICONS[mime] || { color: "#94a3b8", label: mime.split("/").pop()?.slice(0, 4).toUpperCase() || "?" };
}

export default function DriveImportPanel({ projectId, onClose, onImported }: DriveImportPanelProps) {
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ imported: number; skipped: number } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [syncEnabled, setSyncEnabled] = useState(false);
  const [syncInterval, setSyncInterval] = useState(60);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [lastImported, setLastImported] = useState<number | null>(null);

  function update<K extends keyof Filters>(key: K, value: Filters[K]) {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }

  function resetFilters() {
    setFilters(DEFAULT_FILTERS);
  }

  async function load() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const q = buildDriveQuery(filters);
      const data = await listDriveFiles(projectId, q, 50);
      setFiles(data.files || []);
      setSelected(new Set());
    } catch (e: any) {
      setError(e.message || "Failed to load Drive files");
      setFiles([]);
    } finally {
      setLoading(false);
    }
  }

  // Load saved defaults on mount, then trigger first search
  useEffect(() => {
    (async () => {
      try {
        const { settings } = await getIntegrationSettings(projectId, "google_drive");
        if (settings && Object.keys(settings).length > 0) {
          setFilters((prev) => ({ ...prev, ...settings }));
          if (typeof settings.sync_enabled === "boolean") setSyncEnabled(settings.sync_enabled);
          if (typeof settings.sync_interval_minutes === "number") setSyncInterval(settings.sync_interval_minutes);
          if (settings.last_synced_at) setLastSyncedAt(settings.last_synced_at);
          if (typeof settings.last_sync_imported === "number") setLastImported(settings.last_sync_imported);
        }
      } catch {}
      load();
    })();
    // eslint-disable-next-line
  }, []);

  async function saveAsDefaults() {
    setSavingSettings(true);
    try {
      await updateIntegrationSettings(projectId, "google_drive", {
        ...filters,
        sync_enabled: syncEnabled,
        sync_interval_minutes: syncInterval,
        last_synced_at: lastSyncedAt,
        last_sync_imported: lastImported,
      });
      setSettingsOpen(false);
    } catch (e: any) {
      setError(e.message || "Failed to save defaults");
    } finally {
      setSavingSettings(false);
    }
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    const supported = files.filter((f) => f.supported);
    if (selected.size === supported.length) setSelected(new Set());
    else setSelected(new Set(supported.map((f) => f.id)));
  }

  async function handleImport() {
    if (selected.size === 0) return;
    setImporting(true);
    setError(null);
    try {
      const res = await importDriveFiles(projectId, Array.from(selected));
      setResult({ imported: res.imported.length, skipped: res.skipped.length });
      setSelected(new Set());
      onImported?.();
    } catch (e: any) {
      setError(e.message || "Import failed");
    } finally {
      setImporting(false);
    }
  }

  function relativeDate(dateStr: string) {
    if (!dateStr) return "";
    try {
      const d = new Date(dateStr);
      const diff = Date.now() - d.getTime();
      const days = Math.floor(diff / 86400000);
      if (days === 0) return "today";
      if (days === 1) return "yesterday";
      if (days < 7) return `${days}d ago`;
      return d.toLocaleDateString();
    } catch {
      return dateStr;
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(15,23,42,0.45)",
        zIndex: 1100, display: "flex", justifyContent: "flex-end",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(640px, 96vw)", background: "#fff", height: "100%",
          display: "flex", flexDirection: "column", overflow: "hidden",
          boxShadow: "-12px 0 40px rgba(0,0,0,0.18)",
        }}
      >
        {/* Header */}
        <div style={{ padding: "18px 22px 14px", borderBottom: "1px solid var(--gray-100)", display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10, background: "var(--green)",
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
            color: "var(--dark)", fontSize: 14, fontWeight: 800,
          }}>
            G
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: "var(--dark)" }}>Import from Google Drive</div>
            <div style={{ fontSize: 11, color: "var(--gray-500)" }}>Pick files to ingest as documents — Google Docs export to markdown, others download as-is.</div>
          </div>
          <button
            onClick={() => setSettingsOpen((o) => !o)}
            title="Default filters"
            style={{ width: 30, height: 30, borderRadius: 7, border: "1px solid var(--gray-200)", background: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
          >
            <svg viewBox="0 0 24 24" style={{ width: 14, height: 14, stroke: "var(--gray-600)", fill: "none", strokeWidth: 2 }}>
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" />
            </svg>
          </button>
          <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: 6, border: "none", background: "var(--gray-100)", cursor: "pointer", fontSize: 16, color: "var(--gray-600)" }}>×</button>
        </div>

        {/* Filters */}
        <div style={{ padding: "14px 22px 12px", borderBottom: "1px solid var(--gray-100)", background: "#fff" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
            <FilterField label="Name contains">
              <input
                type="text"
                value={filters.name}
                onChange={(e) => update("name", e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") load(); }}
                placeholder="kickoff, requirements, ..."
                style={inputStyle}
              />
            </FilterField>
            <FilterField label="File type">
              <select
                value={filters.type}
                onChange={(e) => update("type", e.target.value as FileType)}
                style={inputStyle}
              >
                <option value="any">Any type</option>
                <option value="doc">Google Docs</option>
                <option value="sheet">Google Sheets</option>
                <option value="slide">Google Slides</option>
                <option value="pdf">PDF</option>
                <option value="office">Office files</option>
              </select>
            </FilterField>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
            <FilterField label="Modified">
              <select
                value={filters.dateRange}
                onChange={(e) => update("dateRange", e.target.value as DateRange)}
                style={inputStyle}
              >
                <option value="1d">Last 24 hours</option>
                <option value="7d">Last 7 days</option>
                <option value="30d">Last 30 days</option>
                <option value="90d">Last 90 days</option>
                <option value="365d">Last year</option>
                <option value="any">Any time</option>
              </select>
            </FilterField>
            <FilterField label="Folder" hint="optional Drive folder URL or ID">
              <input
                type="text"
                value={filters.folderUrl}
                onChange={(e) => update("folderUrl", e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") load(); }}
                placeholder="https://drive.google.com/drive/folders/..."
                style={inputStyle}
              />
            </FilterField>
          </div>

          {/* Actions row */}
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <div style={{ flex: 1 }} />
            <button
              onClick={resetFilters}
              style={{
                padding: "7px 14px", borderRadius: 8, border: "1px solid var(--gray-200)",
                background: "#fff", color: "var(--gray-600)", fontSize: 12, fontWeight: 600,
                cursor: "pointer", fontFamily: "var(--font)",
              }}
            >
              Reset
            </button>
            <button
              onClick={load}
              disabled={loading}
              style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "7px 18px", borderRadius: 8, border: "none",
                background: "var(--green)", color: "var(--dark)",
                fontSize: 12, fontWeight: 700,
                cursor: loading ? "default" : "pointer", opacity: loading ? 0.6 : 1,
                fontFamily: "var(--font)",
                boxShadow: "0 1px 2px rgba(0,229,160,0.25)",
              }}
            >
              <svg viewBox="0 0 24 24" style={{ width: 13, height: 13, stroke: "currentColor", fill: "none", strokeWidth: 2.5 }}>
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              {loading ? "Searching..." : "Search"}
            </button>
          </div>

          {/* Settings panel */}
          {settingsOpen && (
            <div style={{ marginTop: 12 }}>
              <div style={{ padding: 12, background: "var(--gray-50)", border: "1px solid var(--gray-100)", borderRadius: 8 }}>
                <div style={{ fontSize: 11, color: "var(--gray-600)", marginBottom: 8, lineHeight: 1.5 }}>
                  Save the current filters as defaults. They&rsquo;ll be preloaded the next time you open this panel.
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                  <button
                    onClick={() => setSettingsOpen(false)}
                    style={{
                      padding: "6px 12px", borderRadius: 7, border: "1px solid var(--gray-200)",
                      background: "#fff", color: "var(--gray-600)", fontSize: 11, fontWeight: 600,
                      cursor: "pointer", fontFamily: "var(--font)",
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={saveAsDefaults}
                    disabled={savingSettings}
                    style={{
                      padding: "6px 14px", borderRadius: 7, border: "none",
                      background: "var(--green)", color: "var(--dark)",
                      fontSize: 11, fontWeight: 700,
                      cursor: savingSettings ? "default" : "pointer", opacity: savingSettings ? 0.6 : 1,
                      fontFamily: "var(--font)",
                    }}
                  >
                    {savingSettings ? "Saving..." : "Save as defaults"}
                  </button>
                </div>
              </div>
              <SyncSettingsBlock
                enabled={syncEnabled}
                intervalMinutes={syncInterval}
                lastSyncedAt={lastSyncedAt}
                lastImported={lastImported}
                onToggle={setSyncEnabled}
                onIntervalChange={setSyncInterval}
              />
            </div>
          )}
        </div>

        {/* Files */}
        <div style={{ flex: 1, overflow: "auto", background: "var(--gray-50)" }}>
          {error && (
            <div style={{ margin: 16, padding: 12, borderRadius: 8, background: "#fef2f2", border: "1px solid #fecaca", color: "#991b1b", fontSize: 12 }}>
              {error}
            </div>
          )}

          {result && (
            <div style={{ margin: 16, padding: 12, borderRadius: 8, background: "var(--green-light)", border: "1px solid var(--green)", color: "var(--dark)", fontSize: 12 }}>
              ✓ Imported {result.imported} file{result.imported !== 1 ? "s" : ""}{result.skipped > 0 ? `, skipped ${result.skipped}` : ""}. Extraction is running in the background.
            </div>
          )}

          {loading && files.length === 0 ? (
            <div style={{ padding: 40, textAlign: "center", color: "var(--gray-400)", fontSize: 12 }}>Loading files...</div>
          ) : files.length === 0 && !loading ? (
            <div style={{ padding: 40, textAlign: "center", color: "var(--gray-400)", fontSize: 12 }}>
              No files match these filters.
            </div>
          ) : (
            <div style={{ padding: "8px 0" }}>
              {files.map((f) => {
                const isSelected = selected.has(f.id);
                const supported = f.supported;
                const icon = fileIconBadge(f.mimeType);
                const owner = f.owners?.[0]?.displayName || "";
                return (
                  <div
                    key={f.id}
                    onClick={() => supported && toggle(f.id)}
                    style={{
                      display: "flex", gap: 12, padding: "10px 22px",
                      background: isSelected ? "var(--green-light)" : "transparent",
                      borderBottom: "1px solid var(--gray-100)",
                      cursor: supported ? "pointer" : "not-allowed",
                      opacity: supported ? 1 : 0.5,
                      transition: "background 0.1s",
                    }}
                    title={supported ? f.name : `Unsupported file type: ${f.mimeType}`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      disabled={!supported}
                      onChange={() => toggle(f.id)}
                      onClick={(e) => e.stopPropagation()}
                      style={{ marginTop: 3, flexShrink: 0, accentColor: "var(--green)" }}
                    />
                    <div style={{
                      width: 36, height: 36, borderRadius: 8, flexShrink: 0,
                      background: `${icon.color}15`, color: icon.color,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 9, fontWeight: 800,
                      border: `1px solid ${icon.color}30`,
                    }}>
                      {icon.label}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--dark)", marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {f.name}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--gray-500)", display: "flex", alignItems: "center", gap: 8 }}>
                        {owner && <span>{owner}</span>}
                        {owner && <span>·</span>}
                        <span>{relativeDate(f.modifiedTime)}</span>
                        {!supported && (
                          <>
                            <span>·</span>
                            <span style={{ color: "var(--danger)" }}>unsupported</span>
                          </>
                        )}
                      </div>
                    </div>
                    {f.webViewLink && (
                      <a
                        href={f.webViewLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        style={{ alignSelf: "center", color: "var(--gray-400)", fontSize: 11 }}
                        title="Open in Drive"
                      >
                        <svg viewBox="0 0 24 24" style={{ width: 14, height: 14, stroke: "currentColor", fill: "none", strokeWidth: 2 }}>
                          <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
                          <polyline points="15 3 21 3 21 9" />
                          <line x1="10" y1="14" x2="21" y2="3" />
                        </svg>
                      </a>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: "14px 22px", borderTop: "1px solid var(--gray-100)", display: "flex", alignItems: "center", gap: 10, background: "#fff" }}>
          <button
            onClick={toggleAll}
            disabled={files.filter((f) => f.supported).length === 0}
            style={{
              padding: "8px 14px", borderRadius: 8, border: "1px solid var(--gray-200)",
              background: "#fff", color: "var(--gray-600)", fontSize: 11, fontWeight: 600,
              cursor: "pointer", fontFamily: "var(--font)",
            }}
          >
            {selected.size === files.filter((f) => f.supported).length && selected.size > 0 ? "Deselect all" : "Select all"}
          </button>
          <div style={{ flex: 1, fontSize: 11, color: "var(--gray-500)" }}>
            {selected.size > 0 ? `${selected.size} selected` : `${files.length} file${files.length !== 1 ? "s" : ""}`}
          </div>
          <button
            onClick={onClose}
            style={{
              padding: "8px 14px", borderRadius: 8, border: "1px solid var(--gray-200)",
              background: "#fff", color: "var(--gray-600)", fontSize: 12, fontWeight: 600,
              cursor: "pointer", fontFamily: "var(--font)",
            }}
          >
            Close
          </button>
          <button
            onClick={handleImport}
            disabled={selected.size === 0 || importing}
            style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "9px 20px", borderRadius: 8, border: "none",
              background: selected.size === 0 ? "var(--gray-100)" : "var(--green)",
              color: selected.size === 0 ? "var(--gray-400)" : "var(--dark)",
              fontSize: 13, fontWeight: 700,
              cursor: selected.size === 0 || importing ? "default" : "pointer",
              fontFamily: "var(--font)",
              boxShadow: selected.size === 0 ? "none" : "0 2px 6px rgba(0,229,160,0.3)",
            }}
          >
            <svg viewBox="0 0 24 24" style={{ width: 14, height: 14, stroke: "currentColor", fill: "none", strokeWidth: 2.5 }}>
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            {importing ? "Importing..." : selected.size > 0 ? `Import ${selected.size}` : "Import"}
          </button>
        </div>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "7px 10px",
  borderRadius: 7,
  border: "1px solid var(--gray-200)",
  background: "#fff",
  fontSize: 12,
  fontFamily: "var(--font)",
  color: "var(--dark)",
  outline: "none",
};

function FilterField({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "block" }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: "var(--gray-600)", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.4, display: "flex", alignItems: "center", gap: 6 }}>
        <span>{label}</span>
        {hint && <span style={{ fontSize: 9, fontWeight: 500, color: "var(--gray-400)", textTransform: "none", letterSpacing: 0 }}>{hint}</span>}
      </div>
      {children}
    </label>
  );
}
