"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { getMe } from "@/lib/api";
import { useUnreadCounts } from "@/lib/useUnreadCounts";
import NewProjectModal from "./NewProjectModal";

const NAV_ITEMS = [
  { label: "Main", items: [
    { href: "/", label: "Overview", icon: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></> },
  ]},
  { label: "Phases", items: [
    { href: "/discovery", label: "Discovery", icon: <><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></>, badge: "4" },
    { href: "/story-tech", label: "Story & Tech", icon: <><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></> },
    { href: "/code", label: "Code", icon: <><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></> },
    { href: "/qa", label: "QA", icon: <><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></> },
  ]},
  { label: "System", items: [
    { href: "/documents", label: "Documents", icon: <><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/></> },
    { href: "/knowledge", label: "Knowledge Base", icon: <><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></> },
    { href: "/settings", label: "Settings", icon: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></> },
  ]},
];

interface SidebarProps {
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}

function getInitials(name: string): string {
  return name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
}

export default function Sidebar({ collapsed: controlledCollapsed, onToggleCollapsed }: SidebarProps) {
  const pathname = usePathname();
  const [internalCollapsed, setInternalCollapsed] = useState(false);
  const [showNewProject, setShowNewProject] = useState(false);
  const [user, setUser] = useState<{ name: string; email: string } | null>(null);

  const collapsed = controlledCollapsed ?? internalCollapsed;
  const toggleCollapsed = onToggleCollapsed ?? (() => setInternalCollapsed((c) => !c));

  useEffect(() => {
    getMe()
      .then((u) => setUser({ name: u.name, email: u.email }))
      .catch(() => {});
  }, []);

  // Extract projectId from pathname for project-scoped links
  const projectIdMatch = pathname?.match(/\/projects\/([^/]+)/);
  const projectId = projectIdMatch ? projectIdMatch[1] : null;

  // Per-user unread counts for the active project. The hook handles the
  // empty-projectId case gracefully (returns zeros without polling).
  const { counts: unreadCounts } = useUnreadCounts(projectId || "");
  const discoveryUnread = projectId ? unreadCounts.total : 0;

  return (
    <>
    <aside className={`sidebar${collapsed ? " collapsed" : ""}`}>
      <div className="sidebar-logo">
        <h1>C{!collapsed && "rnogorchi"}<span></span></h1>
      </div>

      <nav className="sidebar-nav">
        {/* New Project button */}
        <button
          onClick={() => setShowNewProject(true)}
          title={collapsed ? "New Project" : undefined}
          style={{
            display: "flex", alignItems: "center", justifyContent: collapsed ? "center" : undefined,
            gap: 8,
            width: "100%", padding: "8px 12px", marginBottom: 8,
            background: "var(--green)", color: "var(--dark)",
            border: "none", borderRadius: "var(--radius-sm)",
            fontSize: 13, fontWeight: 600, fontFamily: "var(--font)",
            cursor: "pointer", transition: "all 0.15s",
            overflow: "hidden", whiteSpace: "nowrap",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "var(--green-hover)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "var(--green)")}
        >
          <svg viewBox="0 0 24 24" style={{ width: 16, height: 16, flexShrink: 0, stroke: "currentColor", fill: "none", strokeWidth: 2 }}>
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          {!collapsed && "New Project"}
        </button>
        {NAV_ITEMS.map((section) => (
          <div key={section.label}>
            <div className="nav-label" style={collapsed ? { visibility: "hidden" } : undefined}>{section.label}</div>
            {section.items.map((item) => {
              // Build the actual href — knowledge and code are project-scoped
              const resolvedHref = (item.href === "/knowledge" || item.href === "/code") && projectId
                ? `/projects/${projectId}${item.href}`
                : item.href;

              const isActive = item.href === "/discovery"
                ? (pathname?.startsWith("/discovery") || pathname?.startsWith("/projects")) && !pathname?.includes("/knowledge") && !pathname?.includes("/code")
                : item.href === "/knowledge"
                  ? pathname?.includes("/knowledge")
                  : item.href === "/code"
                    ? pathname?.includes("/code")
                    : pathname === item.href;

              // Dynamic badge: Discovery shows the live unread count for
              // the current project (overriding the static placeholder).
              // Hidden when zero so the icon stays clean.
              let badge: string | null = null;
              if (item.href === "/discovery" && discoveryUnread > 0) {
                badge = String(discoveryUnread);
              } else if (item.badge && item.href !== "/discovery") {
                badge = item.badge;
              }

              return (
                <Link
                  key={item.href}
                  href={resolvedHref}
                  className={`nav-item${isActive ? " active" : ""}${collapsed ? " collapsed" : ""}`}
                  title={collapsed ? item.label : undefined}
                >
                  <div className="nav-icon">
                    <svg viewBox="0 0 24 24">{item.icon}</svg>
                  </div>
                  {!collapsed && item.label}
                  {!collapsed && badge && <span className="nav-badge">{badge}</span>}
                </Link>
              );
            })}
          </div>
        ))}

      </nav>

      <div className="sidebar-bottom">
        <button
          className={`nav-item${collapsed ? " collapsed" : ""}`}
          onClick={toggleCollapsed}
          title={collapsed ? "Expand" : undefined}
          style={{ border: "none", background: "none", fontFamily: "var(--font)", width: "100%", textAlign: "left" }}
        >
          <div className="nav-icon">
            <svg viewBox="0 0 24 24" style={{ transform: collapsed ? "rotate(180deg)" : "none", transition: "transform 0.3s" }}>
              <polyline points="11 17 6 12 11 7" />
              <polyline points="18 17 13 12 18 7" />
            </svg>
          </div>
          {!collapsed && "Collapse"}
        </button>

        <div className={`sidebar-user${collapsed ? " collapsed" : ""}`} title={collapsed && user ? user.name : undefined}>
          <div className="user-avatar">{user ? getInitials(user.name) : "?"}</div>
          {!collapsed && (
            <div className="user-info">
              <div className="user-name">{user?.name || "Loading..."}</div>
              <div className="user-role">{user?.email || ""}</div>
            </div>
          )}
        </div>
      </div>
    </aside>
    <NewProjectModal open={showNewProject} onClose={() => setShowNewProject(false)} />
    </>
  );
}
