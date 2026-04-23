"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { uploadDocument, listProjects, searchProject, getNotifications, getNotificationCount, markNotificationRead, listReminders, cancelReminder, Reminder } from "@/lib/api";
import DirectoryModal from "./DirectoryModal";
import ClientReviewModal from "./ClientReviewModal";
import RemindersPanel from "./RemindersPanel";

interface Project {
  id: string;
  name: string;
  client_name: string;
  status: string;
}

interface SearchResult {
  type: string;
  id: string;
  title: string;
  priority?: string;
  status?: string;
}

interface TopbarProps {
  projectId: string;
  projectName?: string;
  onDocumentUploaded?: () => void;
}

const TYPE_ICONS: Record<string, string> = {
  requirement: "BR",
  gap: "GAP",
  constraint: "CON",
  contradiction: "CTD",
  stakeholder: "STK",
};

const TYPE_COLORS: Record<string, string> = {
  requirement: "#059669",
  gap: "#F59E0B",
  constraint: "#F97316",
  contradiction: "#EF4444",
  stakeholder: "#7c3aed",
};

/**
 * Render a notification timestamp compactly:
 *   - Today  → "14:23"
 *   - Yesterday → "Yest 14:23"
 *   - This year → "Apr 6, 14:23"
 *   - Older  → "Apr 6 2025, 14:23"
 *
 * The full ISO is shown as a `title` tooltip for the curious.
 */
function formatNotificationDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const now = new Date();
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return time;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return `Yest ${time}`;
  const sameYear = d.getFullYear() === now.getFullYear();
  const dateStr = sameYear
    ? d.toLocaleDateString([], { month: "short", day: "numeric" })
    : d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
  return `${dateStr}, ${time}`;
}

export default function Topbar({ projectId, projectName = "Project", onDocumentUploaded }: TopbarProps) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const [uploading, setUploading] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [notifCount, setNotifCount] = useState(0);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [notifTotal, setNotifTotal] = useState(0);
  const [notifLoadingMore, setNotifLoadingMore] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);
  const NOTIF_PAGE_SIZE = 6;
  // Reminders tab inside the bell popover — see Reminders section in assistants/CLAUDE.md.
  const [panelTab, setPanelTab] = useState<"notifications" | "reminders">("notifications");
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [remindersLoading, setRemindersLoading] = useState(false);
  const [activeReminderCount, setActiveReminderCount] = useState(0);
  const [directoryOpen, setDirectoryOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);

  // Let other components (e.g., ChatPanel's review-submitted notice) open
  // the review modal without prop-threading through ProjectShell.
  useEffect(() => {
    const onOpen = () => setReviewOpen(true);
    window.addEventListener("open-client-review", onOpen);
    return () => window.removeEventListener("open-client-review", onOpen);
  }, []);

  // Auto-open directory when returning from OAuth callback
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("integration_connected") || url.searchParams.get("integration_error")) {
      setDirectoryOpen(true);
    }
  }, []);

  // Poll notification count
  useEffect(() => {
    const load = () => getNotificationCount(projectId).then((d) => setNotifCount(d.count || 0)).catch(() => {});
    load();
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, [projectId]);

  // Poll active-reminder count (pending / processing / prepared) so the
  // tab badge reflects live state without opening the popover.
  useEffect(() => {
    const load = async () => {
      try {
        const rows = await listReminders(projectId);
        const active = (rows || []).filter((r) => ["pending", "processing", "prepared"].includes(r.status));
        setActiveReminderCount(active.length);
      } catch {
        /* ignore */
      }
    };
    load();
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, [projectId]);

  // Load reminders when the Reminders tab is opened
  useEffect(() => {
    if (!notifOpen || panelTab !== "reminders") return;
    setRemindersLoading(true);
    listReminders(projectId)
      .then((rows) => setReminders(rows || []))
      .catch(() => setReminders([]))
      .finally(() => setRemindersLoading(false));
  }, [notifOpen, panelTab, projectId]);

  // Load first page of notifications when dropdown opens
  useEffect(() => {
    if (notifOpen) {
      getNotifications(projectId, NOTIF_PAGE_SIZE, 0)
        .then((d) => {
          setNotifications(d.notifications || []);
          setNotifTotal(d.total || 0);
        })
        .catch(() => {});
    }
  }, [notifOpen, projectId]);

  async function loadMoreNotifications() {
    if (notifLoadingMore) return;
    setNotifLoadingMore(true);
    try {
      const d = await getNotifications(projectId, NOTIF_PAGE_SIZE, notifications.length);
      // Append rather than replace
      setNotifications((prev) => [...prev, ...(d.notifications || [])]);
      setNotifTotal(d.total || 0);
    } catch {
      /* ignore */
    } finally {
      setNotifLoadingMore(false);
    }
  }

  // Close notification dropdown on outside click
  useEffect(() => {
    if (!notifOpen) return;
    function handleClick(e: MouseEvent) {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setNotifOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [notifOpen]);

  // Fetch projects for dropdown
  useEffect(() => {
    if (dropdownOpen) {
      listProjects()
        .then((data) => setProjects(data.projects || []))
        .catch(() => {});
    }
  }, [dropdownOpen]);

  // Close project dropdown on outside click
  useEffect(() => {
    if (!dropdownOpen) return;
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [dropdownOpen]);

  // Close search results on outside click
  useEffect(() => {
    if (!searchOpen) return;
    function handleClick(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [searchOpen]);

  // Debounced search
  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (value.length < 2) {
      setSearchResults([]);
      setSearchOpen(false);
      return;
    }

    setSearchLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const data = await searchProject(projectId, value);
        setSearchResults(data.results || []);
        setSearchOpen(true);
      } catch {
        setSearchResults([]);
      }
      setSearchLoading(false);
    }, 300);
  }, [projectId]);

  async function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setUploading(true);
    for (const file of Array.from(files)) {
      try {
        await uploadDocument(projectId, file);
      } catch (err: any) {
        alert(`Upload failed: ${err.message}`);
      }
    }
    setUploading(false);
    onDocumentUploaded?.();
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function switchProject(id: string) {
    setDropdownOpen(false);
    router.push(`/projects/${id}/chat`);
  }

  const TYPE_TO_TAB: Record<string, string> = {
    requirement: "reqs",
    gap: "gaps",
    constraint: "constraints",
    contradiction: "contradictions",
    stakeholder: "reqs",
  };

  function handleResultClick(result: SearchResult) {
    setSearchOpen(false);
    setSearchQuery("");
    const tab = TYPE_TO_TAB[result.type] || "reqs";
    router.push(`/projects/${projectId}/chat?tab=${tab}&highlight=${encodeURIComponent(result.id)}`);
  }

  return (
    <header className="topbar">
      <div className="project-selector-wrapper" ref={dropdownRef}>
        <button
          className="project-selector"
          onClick={() => setDropdownOpen((o) => !o)}
          style={{ cursor: "pointer", background: "none", border: "none", fontFamily: "var(--font)" }}
        >
          <div className="project-dot" />
          <span className="project-name">{projectName}</span>
          <svg
            style={{
              width: 16, height: 16, color: "var(--gray-400)",
              transform: dropdownOpen ? "rotate(180deg)" : "none",
              transition: "transform 0.2s",
            }}
            viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>

        {dropdownOpen && (
          <div className="project-dropdown">
            <div className="project-dropdown-header">Switch Project</div>
            {projects.length === 0 && (
              <div className="project-dropdown-empty">Loading...</div>
            )}
            {projects.map((p) => (
              <button
                key={p.id}
                className={`project-dropdown-item${p.id === projectId ? " active" : ""}`}
                onClick={() => switchProject(p.id)}
              >
                <div
                  className="project-dot"
                  style={p.id === projectId ? { background: "var(--green)" } : { background: "var(--gray-400)" }}
                />
                <div className="project-dropdown-item-info">
                  <span className="project-dropdown-item-name">{p.name}</span>
                  <span className="project-dropdown-item-client">{p.client_name}</span>
                </div>
                {p.id === projectId && (
                  <svg style={{ width: 16, height: 16, color: "var(--green)", marginLeft: "auto", flexShrink: 0 }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="search-bar" ref={searchRef}>
        <svg viewBox="0 0 24 24" style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", width: 16, height: 16, color: "var(--gray-400)", stroke: "currentColor", fill: "none", strokeWidth: 2 }}>
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          type="text"
          placeholder="Search requirements, facts, documents..."
          value={searchQuery}
          onChange={(e) => handleSearchChange(e.target.value)}
          onFocus={() => { if (searchResults.length > 0) setSearchOpen(true); }}
        />
        {searchLoading && (
          <div style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", fontSize: 12, color: "var(--gray-400)" }}>
            ...
          </div>
        )}

        {searchOpen && (
          <div className="search-dropdown">
            {searchResults.length === 0 ? (
              <div className="search-dropdown-empty">
                No results for &ldquo;{searchQuery}&rdquo;
              </div>
            ) : (
              <>
                <div className="search-dropdown-header">
                  {searchResults.length} result{searchResults.length !== 1 ? "s" : ""}
                </div>
                {searchResults.map((r, i) => (
                  <button
                    key={`${r.type}-${r.id}-${i}`}
                    className="search-result-item"
                    onClick={() => handleResultClick(r)}
                  >
                    <span
                      className="search-result-badge"
                      style={{ background: `${TYPE_COLORS[r.type] || "#6b7280"}15`, color: TYPE_COLORS[r.type] || "#6b7280" }}
                    >
                      {TYPE_ICONS[r.type] || r.type.slice(0, 3).toUpperCase()}
                    </span>
                    <div className="search-result-info">
                      <span className="search-result-title">{r.title}</span>
                      <span className="search-result-meta">
                        {r.id}
                        {r.priority && <> &middot; {r.priority}</>}
                        {r.status && <> &middot; {r.status}</>}
                      </span>
                    </div>
                  </button>
                ))}
              </>
            )}
          </div>
        )}
      </div>

      <div className="topbar-actions">
        <div ref={notifRef} style={{ position: "relative" }}>
          <button className="icon-btn" title="Notifications" onClick={() => setNotifOpen((o) => !o)} style={{ position: "relative" }}>
            <svg viewBox="0 0 24 24">
              <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 01-3.46 0" />
            </svg>
            {notifCount > 0 && (
              <span style={{
                position: "absolute", top: 2, right: 2,
                width: 16, height: 16, borderRadius: "50%",
                background: "#EF4444", color: "#fff",
                fontSize: 9, fontWeight: 700,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                {notifCount > 9 ? "9+" : notifCount}
              </span>
            )}
          </button>

          {notifOpen && (
            <div style={{
              position: "absolute", top: "calc(100% + 8px)", right: 0,
              width: 380, maxHeight: 520, overflow: "hidden",
              background: "#fff", border: "1px solid var(--gray-200)",
              borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
              zIndex: 200, display: "flex", flexDirection: "column",
            }}>
              {/* Tabs — segmented pill, matches ClientReviewModal style */}
              <div style={{
                display: "flex", gap: 4, padding: 6,
                borderBottom: "1px solid var(--gray-100)",
                background: "var(--gray-50, #f8fafc)",
              }}>
                {([
                  { id: "notifications", label: "Notifications", badge: notifCount },
                  { id: "reminders", label: "Reminders", badge: activeReminderCount },
                ] as const).map((t) => {
                  const active = panelTab === t.id;
                  return (
                    <button
                      key={t.id}
                      onClick={() => setPanelTab(t.id)}
                      style={{
                        flex: 1, padding: "7px 10px", borderRadius: 7,
                        border: "none", cursor: "pointer", fontFamily: "inherit",
                        background: active ? "#fff" : "transparent",
                        color: active ? "#0f172a" : "#64748b",
                        fontWeight: active ? 700 : 600,
                        fontSize: 12,
                        boxShadow: active ? "0 1px 2px rgba(0,0,0,0.06)" : "none",
                        display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
                      }}
                    >
                      <span>{t.label}</span>
                      {t.badge > 0 && (
                        <span style={{
                          minWidth: 18, height: 18, padding: "0 5px", borderRadius: 9,
                          background: active ? "#00E5A0" : "#e2e8f0",
                          color: active ? "#064e3b" : "#475569",
                          fontSize: 10, fontWeight: 700,
                          display: "inline-flex", alignItems: "center", justifyContent: "center",
                        }}>
                          {t.badge > 99 ? "99+" : t.badge}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              <div style={{ flex: 1, overflow: "auto" }}>
                {panelTab === "notifications" ? (
                  <>
                    {notifTotal > 0 && (
                      <div style={{
                        padding: "8px 16px", fontSize: 10, color: "#94a3b8",
                        fontWeight: 600, textAlign: "right",
                      }}>
                        {notifications.length} of {notifTotal}
                      </div>
                    )}
                    {notifications.length === 0 ? (
                      <div style={{ padding: "24px 16px", textAlign: "center", color: "#94a3b8", fontSize: 13 }}>
                        No notifications yet
                      </div>
                    ) : (
                      <>
                        {notifications.map((n: any) => (
                          <div
                            key={n.id}
                            onClick={async () => {
                              if (!n.read) {
                                await markNotificationRead(projectId, n.id);
                                setNotifCount((c) => Math.max(0, c - 1));
                                setNotifications((prev) => prev.map((x) => x.id === n.id ? { ...x, read: true } : x));
                              }
                            }}
                            style={{
                              padding: "10px 16px", borderBottom: "1px solid var(--gray-50)",
                              cursor: "pointer", background: n.read ? "#fff" : "#f0fdf8",
                              transition: "background 0.1s",
                            }}
                          >
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <span style={{
                                width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
                                background: n.read ? "#e2e8f0" : "#00E5A0",
                              }} />
                              <span style={{ fontSize: 12, fontWeight: 600, color: "#0f172a", flex: 1 }}>{n.title}</span>
                              <span style={{ fontSize: 10, color: "#94a3b8", whiteSpace: "nowrap" }} title={n.created_at ? new Date(n.created_at).toLocaleString() : ""}>
                                {formatNotificationDate(n.created_at)}
                              </span>
                            </div>
                            <div style={{ fontSize: 11, color: "#64748b", marginTop: 3, paddingLeft: 16 }}>{n.body}</div>
                          </div>
                        ))}
                        {notifications.length < notifTotal && (
                          <button
                            onClick={loadMoreNotifications}
                            disabled={notifLoadingMore}
                            style={{
                              width: "100%", padding: "10px 16px",
                              background: "#f8fafc", border: "none",
                              borderTop: "1px solid var(--gray-100)",
                              fontSize: 12, fontWeight: 600, color: "#059669",
                              cursor: notifLoadingMore ? "wait" : "pointer",
                              fontFamily: "inherit",
                            }}
                          >
                            {notifLoadingMore
                              ? "Loading…"
                              : `Load more (${notifTotal - notifications.length} remaining)`}
                          </button>
                        )}
                      </>
                    )}
                  </>
                ) : (
                  <RemindersPanel
                    projectId={projectId}
                    reminders={reminders}
                    loading={remindersLoading}
                    onOpen={() => setNotifOpen(false)}
                    onCancel={async (rid) => {
                      await cancelReminder(projectId, rid);
                      setReminders((prev) => prev.map((r) => r.id === rid ? { ...r, status: "canceled" } : r));
                      setActiveReminderCount((c) => Math.max(0, c - 1));
                    }}
                  />
                )}
              </div>
            </div>
          )}
        </div>

        <button
          className="icon-btn"
          title="Client Review — generate links, view submissions"
          onClick={() => setReviewOpen(true)}
        >
          <svg viewBox="0 0 24 24">
            <path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
            <circle cx="8.5" cy="7" r="4" />
            <path d="M20 8v6" />
            <path d="M23 11h-6" />
          </svg>
        </button>

        <button
          className="icon-btn"
          title="Directory — Connectors, Skills, Plugins"
          onClick={() => setDirectoryOpen(true)}
        >
          <svg viewBox="0 0 24 24">
            <rect x="3" y="3" width="7" height="7" />
            <rect x="14" y="3" width="7" height="7" />
            <rect x="14" y="14" width="7" height="7" />
            <rect x="3" y="14" width="7" height="7" />
          </svg>
        </button>

        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".pdf,.docx,.doc,.xlsx,.xls,.csv,.pptx,.ppt,.eml,.txt,.md,.png,.jpg,.jpeg"
          onChange={handleFiles}
          style={{ display: "none" }}
          id="topbar-upload"
        />
        <button
          className="btn-primary"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          style={uploading ? { opacity: 0.6 } : {}}
        >
          <svg viewBox="0 0 24 24">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          {uploading ? "Uploading..." : "Upload Document"}
        </button>
      </div>

      <DirectoryModal
        projectId={projectId}
        open={directoryOpen}
        onClose={() => setDirectoryOpen(false)}
      />
      <ClientReviewModal
        projectId={projectId}
        open={reviewOpen}
        onClose={() => setReviewOpen(false)}
      />
    </header>
  );
}
