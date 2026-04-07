"use client";

import { useEffect, useState } from "react";
import { listGmailMessages, importGmailMessages, getIntegrationSettings, updateIntegrationSettings, GmailMessage } from "@/lib/api";
import SyncSettingsBlock from "./SyncSettingsBlock";

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

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style={{ display: "inline-flex", alignItems: "center", gap: 7, cursor: "pointer", fontSize: 11, fontWeight: 600, color: "var(--dark)" }}>
      <span
        onClick={() => onChange(!checked)}
        style={{
          width: 30, height: 17, borderRadius: 9, padding: 2, flexShrink: 0,
          background: checked ? "var(--green)" : "var(--gray-200)",
          transition: "background 0.15s", display: "inline-flex", alignItems: "center",
        }}
      >
        <span style={{
          width: 13, height: 13, borderRadius: "50%", background: "#fff",
          transform: checked ? "translateX(13px)" : "translateX(0)",
          transition: "transform 0.15s",
          boxShadow: "0 1px 3px rgba(0,0,0,0.15)",
        }} />
      </span>
      {label}
    </label>
  );
}

interface GmailImportPanelProps {
  projectId: string;
  onClose: () => void;
  onImported?: () => void;
}

type DateRange = "1d" | "7d" | "30d" | "90d" | "365d" | "any";
type Folder = "any" | "inbox" | "sent" | "starred" | "important";

interface Filters {
  from: string;
  to: string;
  subject: string;
  dateRange: DateRange;
  folder: Folder;
  hasAttachment: boolean;
  unreadOnly: boolean;
}

const DEFAULT_FILTERS: Filters = {
  from: "",
  to: "",
  subject: "",
  dateRange: "30d",
  folder: "any",
  hasAttachment: false,
  unreadOnly: false,
};

function buildQuery(f: Filters, advancedRaw: string): string {
  if (advancedRaw.trim()) return advancedRaw.trim();
  const parts: string[] = [];
  if (f.from.trim()) parts.push(`from:${f.from.trim()}`);
  if (f.to.trim()) parts.push(`to:${f.to.trim()}`);
  if (f.subject.trim()) {
    const s = f.subject.trim();
    parts.push(s.includes(" ") ? `subject:"${s}"` : `subject:${s}`);
  }
  if (f.dateRange !== "any") parts.push(`newer_than:${f.dateRange}`);
  if (f.folder !== "any") parts.push(`in:${f.folder}`);
  if (f.hasAttachment) parts.push("has:attachment");
  if (f.unreadOnly) parts.push("is:unread");
  return parts.join(" ");
}

export default function GmailImportPanel({ projectId, onClose, onImported }: GmailImportPanelProps) {
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [advancedRaw, setAdvancedRaw] = useState("");
  const [messages, setMessages] = useState<GmailMessage[]>([]);
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
    setAdvancedRaw("");
  }

  async function load() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const q = buildQuery(filters, advancedRaw);
      const data = await listGmailMessages(projectId, q || undefined, 50);
      setMessages(data.messages || []);
      setSelected(new Set());
    } catch (e: any) {
      setError(e.message || "Failed to load Gmail messages");
      setMessages([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    (async () => {
      try {
        const { settings } = await getIntegrationSettings(projectId, "gmail");
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
      await updateIntegrationSettings(projectId, "gmail", {
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
    if (selected.size === messages.length) setSelected(new Set());
    else setSelected(new Set(messages.map((m) => m.id)));
  }

  async function handleImport() {
    if (selected.size === 0) return;
    setImporting(true);
    setError(null);
    try {
      const res = await importGmailMessages(projectId, Array.from(selected));
      setResult({ imported: res.imported.length, skipped: res.skipped.length });
      setSelected(new Set());
      onImported?.();
    } catch (e: any) {
      setError(e.message || "Import failed");
    } finally {
      setImporting(false);
    }
  }

  function shortFrom(from: string) {
    const m = from.match(/^([^<]+)<([^>]+)>$/);
    if (m) return m[1].trim().replace(/^"|"$/g, "");
    return from;
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
            <div style={{ fontSize: 15, fontWeight: 800, color: "var(--dark)" }}>Import from Gmail</div>
            <div style={{ fontSize: 11, color: "var(--gray-500)" }}>Pick emails to ingest as documents — they&rsquo;ll run through the same extraction pipeline.</div>
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
          {/* Row 1: From + Subject */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
            <FilterField label="From" hint="email or @domain.com">
              <input
                type="text"
                value={filters.from}
                onChange={(e) => update("from", e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") load(); }}
                placeholder="someone@acme.com"
                style={inputStyle}
              />
            </FilterField>
            <FilterField label="Subject contains">
              <input
                type="text"
                value={filters.subject}
                onChange={(e) => update("subject", e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") load(); }}
                placeholder="kickoff, requirements, ..."
                style={inputStyle}
              />
            </FilterField>
          </div>

          {/* Row 2: Date range + Folder */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
            <FilterField label="Date range">
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
            <FilterField label="Folder">
              <select
                value={filters.folder}
                onChange={(e) => update("folder", e.target.value as Folder)}
                style={inputStyle}
              >
                <option value="any">All mail</option>
                <option value="inbox">Inbox</option>
                <option value="sent">Sent</option>
                <option value="starred">Starred</option>
                <option value="important">Important</option>
              </select>
            </FilterField>
          </div>

          {/* Row 3: Toggles + actions on one row */}
          <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
            <Toggle
              label="Has attachment"
              checked={filters.hasAttachment}
              onChange={(v) => update("hasAttachment", v)}
            />
            <Toggle
              label="Unread only"
              checked={filters.unreadOnly}
              onChange={(v) => update("unreadOnly", v)}
            />
            <button
              onClick={() => setAdvancedOpen((o) => !o)}
              style={{
                background: "none", border: "none", padding: 0,
                fontSize: 11, color: "var(--gray-500)", cursor: "pointer",
                fontFamily: "var(--font)", fontWeight: 600,
              }}
            >
              {advancedOpen ? "Hide advanced" : "Advanced"}
            </button>
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

          {/* Advanced raw query (overrides everything) */}
          {advancedOpen && (
            <div style={{ marginTop: 12 }}>
              <FilterField label="Raw Gmail query (overrides filters above)">
                <input
                  type="text"
                  value={advancedRaw}
                  onChange={(e) => setAdvancedRaw(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") load(); }}
                  placeholder='e.g. label:Discovery has:attachment newer_than:60d'
                  style={{ ...inputStyle, fontFamily: "monospace", fontSize: 11 }}
                />
              </FilterField>
            </div>
          )}
        </div>

        {/* Messages */}
        <div style={{ flex: 1, overflow: "auto", background: "var(--gray-50)" }}>
          {error && (
            <div style={{ margin: 16, padding: 12, borderRadius: 8, background: "#fef2f2", border: "1px solid #fecaca", color: "#991b1b", fontSize: 12 }}>
              {error}
            </div>
          )}

          {result && (
            <div style={{ margin: 16, padding: 12, borderRadius: 8, background: "var(--green-light)", border: "1px solid var(--green)", color: "var(--dark)", fontSize: 12 }}>
              ✓ Imported {result.imported} email{result.imported !== 1 ? "s" : ""}{result.skipped > 0 ? `, skipped ${result.skipped} (already imported or errors)` : ""}. Check the Documents list — extraction is running in the background.
            </div>
          )}

          {loading && messages.length === 0 ? (
            <div style={{ padding: 40, textAlign: "center", color: "var(--gray-400)", fontSize: 12 }}>Loading messages...</div>
          ) : messages.length === 0 && !loading ? (
            <div style={{ padding: 40, textAlign: "center", color: "var(--gray-400)", fontSize: 12 }}>
              No messages found for that query.
            </div>
          ) : (
            <div style={{ padding: "8px 0" }}>
              {messages.map((m) => {
                const isSelected = selected.has(m.id);
                return (
                  <div
                    key={m.id}
                    onClick={() => toggle(m.id)}
                    style={{
                      display: "flex", gap: 12, padding: "10px 22px",
                      background: isSelected ? "var(--green-light)" : "transparent",
                      borderBottom: "1px solid var(--gray-100)",
                      cursor: "pointer", transition: "background 0.1s",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggle(m.id)}
                      onClick={(e) => e.stopPropagation()}
                      style={{ marginTop: 3, flexShrink: 0, accentColor: "var(--green)" }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: "var(--dark)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                          {shortFrom(m.from)}
                        </span>
                        <span style={{ fontSize: 10, color: "var(--gray-400)", flexShrink: 0 }}>{relativeDate(m.date)}</span>
                      </div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--dark)", marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {m.subject}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--gray-500)", overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
                        {m.snippet}
                      </div>
                    </div>
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
            disabled={messages.length === 0}
            style={{
              padding: "8px 14px", borderRadius: 8, border: "1px solid var(--gray-200)",
              background: "#fff", color: "var(--gray-600)", fontSize: 11, fontWeight: 600,
              cursor: messages.length === 0 ? "default" : "pointer", fontFamily: "var(--font)",
            }}
          >
            {selected.size === messages.length && messages.length > 0 ? "Deselect all" : "Select all"}
          </button>
          <div style={{ flex: 1, fontSize: 11, color: "var(--gray-500)" }}>
            {selected.size > 0 ? `${selected.size} selected` : `${messages.length} message${messages.length !== 1 ? "s" : ""}`}
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
              transition: "all 0.15s",
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
