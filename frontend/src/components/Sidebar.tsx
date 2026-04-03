"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

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

export default function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside className={`sidebar${collapsed ? " collapsed" : ""}`} style={collapsed ? { width: 64 } : {}}>
      <div className="sidebar-logo">
        <h1>Crnogorchi<span></span></h1>
      </div>

      <nav className="sidebar-nav">
        {NAV_ITEMS.map((section) => (
          <div key={section.label}>
            <div className="nav-label">{section.label}</div>
            {section.items.map((item) => {
              const isActive = item.href === "/discovery"
                ? pathname?.startsWith("/discovery") || pathname?.startsWith("/projects")
                : pathname === item.href;

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`nav-item${isActive ? " active" : ""}`}
                >
                  <div className="nav-icon">
                    <svg viewBox="0 0 24 24">{item.icon}</svg>
                  </div>
                  {!collapsed && item.label}
                  {!collapsed && item.badge && <span className="nav-badge">{item.badge}</span>}
                </Link>
              );
            })}
          </div>
        ))}

        <div style={{ flex: 1 }} />

        <button
          className="nav-item"
          onClick={() => setCollapsed(!collapsed)}
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
      </nav>

      <div className="sidebar-user">
        <div className="user-avatar">BT</div>
        {!collapsed && (
          <div className="user-info">
            <div className="user-name">Bojan Tesic</div>
            <div className="user-role">Product Owner</div>
          </div>
        )}
      </div>
    </aside>
  );
}
